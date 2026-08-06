# -*- coding: utf-8 -*-
"""Deploy stockmap to VPS without touching existing task-manager."""
from __future__ import annotations

import os
import stat
import tarfile
import tempfile
from pathlib import Path

import paramiko

HOST = "176.12.69.195"
USER = "root"
PASSWORD = os.environ.get("STOCKMAP_SSH_PASSWORD", "CHANGE_ME")
REMOTE_DIR = "/opt/stockmap"
APP_PORT = 3002
DOMAIN = "stockmap.176-12-69-195.sslip.io"
LOCAL_ROOT = Path(__file__).resolve().parent

EXCLUDE_DIRS = {
    "node_modules",
    "dist",
    ".git",
    "data",
    "agent-transcripts",
    "__pycache__",
}
EXCLUDE_FILES = {".env", "deploy_remote.py"}


def run(client: paramiko.SSHClient, cmd: str, check: bool = True) -> str:
    print(f"$ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    safe_out = out.encode("ascii", errors="replace").decode("ascii")
    safe_err = err.encode("ascii", errors="replace").decode("ascii")
    if safe_out.strip():
        print(safe_out[-2000:] if len(safe_out) > 2000 else safe_out)
    if safe_err.strip():
        print(safe_err[-1000:] if len(safe_err) > 1000 else safe_err)
    if check and code != 0:
        raise RuntimeError(f"Command failed ({code}): {cmd}")
    return out


def make_archive() -> Path:
    fd, name = tempfile.mkstemp(suffix=".tar.gz")
    os.close(fd)
    path = Path(name)
    with tarfile.open(path, "w:gz") as tar:
        for root, dirs, files in os.walk(LOCAL_ROOT):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
            rel_root = Path(root).relative_to(LOCAL_ROOT)
            for f in files:
                if f in EXCLUDE_FILES or f.endswith(".pyc"):
                    continue
                if f.endswith(".db") or f.endswith(".db-wal") or f.endswith(".db-shm"):
                    continue
                full = Path(root) / f
                arcname = Path("stockmap") / rel_root / f
                tar.add(full, arcname=str(arcname).replace("\\", "/"))
    print(f"Archive: {path} ({path.stat().st_size} bytes)")
    return path


def upload(sftp: paramiko.SFTPClient, local: Path, remote: str) -> None:
    print(f"Upload {local} -> {remote}")
    sftp.put(str(local), remote)


NGINX_CONF = f"""
server {{
    listen 80;
    listen [::]:80;
    server_name {DOMAIN};

    location /.well-known/acme-challenge/ {{
        root /var/www/html;
    }}

    location / {{
        return 301 https://$host$request_uri;
    }}
}}

server {{
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {DOMAIN};

    ssl_certificate /etc/letsencrypt/live/{DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    root {REMOTE_DIR}/dist;
    index index.html;

    location /api/ {{
        proxy_pass http://127.0.0.1:{APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}

    location / {{
        try_files $uri $uri/ /index.html;
    }}

    location = /index.html {{
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }}

    location /assets/ {{
        add_header Cache-Control "public, max-age=31536000, immutable";
    }}
}}
"""

NGINX_BOOTSTRAP = f"""
server {{
    listen 80;
    listen [::]:80;
    server_name {DOMAIN};

    location /.well-known/acme-challenge/ {{
        root /var/www/html;
    }}

    location / {{
        root {REMOTE_DIR}/dist;
        try_files $uri $uri/ /index.html;
    }}

    location /api/ {{
        proxy_pass http://127.0.0.1:{APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}
}}
"""

ECOSYSTEM = f"""
module.exports = {{
  apps: [{{
    name: "stockmap",
    cwd: "{REMOTE_DIR}",
    script: "node_modules/tsx/dist/cli.mjs",
    args: "server/index.ts",
    env: {{
      NODE_ENV: "production",
      PORT: "{APP_PORT}",
      HOST: "127.0.0.1",
    }},
    max_restarts: 20,
    restart_delay: 2000,
  }}],
}};
"""


def main() -> None:
    archive = make_archive()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=60)
    sftp = client.open_sftp()

    try:
        run(client, f"mkdir -p {REMOTE_DIR} /tmp")
        upload(sftp, archive, "/tmp/stockmap.tar.gz")
        # Keep existing data dir if present
        run(
            client,
            f"mkdir -p {REMOTE_DIR}/data && "
            f"tar -xzf /tmp/stockmap.tar.gz -C /opt && "
            f"rm -f /tmp/stockmap.tar.gz",
        )

        # Ensure server listens on HOST/PORT from env (already in source; keep as safety)
        run(
            client,
            f"grep -q 'process.env.HOST' {REMOTE_DIR}/server/index.ts && echo listen_ok || echo listen_missing",
        )

        # Write ecosystem config
        with sftp.file(f"{REMOTE_DIR}/ecosystem.config.cjs", "w") as f:
            f.write(ECOSYSTEM)

        run(client, f"cd {REMOTE_DIR} && npm install")
        run(client, f"cd {REMOTE_DIR} && npm run build")

        # Start/restart only stockmap app
        run(client, f"cd {REMOTE_DIR} && pm2 delete stockmap", check=False)
        run(client, f"cd {REMOTE_DIR} && pm2 start ecosystem.config.cjs")
        run(client, "pm2 save", check=False)

        # Nginx bootstrap (HTTP) then certbot then full HTTPS config
        with sftp.file("/etc/nginx/sites-available/stockmap", "w") as f:
            f.write(NGINX_BOOTSTRAP)
        run(
            client,
            "ln -sfn /etc/nginx/sites-available/stockmap /etc/nginx/sites-enabled/stockmap && "
            "nginx -t && systemctl reload nginx",
        )

        # Certbot for subdomain — do not touch task-manager certs
        run(
            client,
            f"certbot certonly --webroot -w /var/www/html -d {DOMAIN} "
            f"--non-interactive --agree-tos --register-unsafely-without-email "
            f"--keep-until-expiring",
            check=False,
        )

        # If cert exists, write HTTPS config
        out = run(
            client,
            f"test -f /etc/letsencrypt/live/{DOMAIN}/fullchain.pem && echo HAS_CERT || echo NO_CERT",
        )
        if "HAS_CERT" in out:
            with sftp.file("/etc/nginx/sites-available/stockmap", "w") as f:
                f.write(NGINX_CONF)
            run(client, "nginx -t && systemctl reload nginx")
        else:
            print("WARN: no SSL cert yet, leaving HTTP bootstrap config")

        run(client, "pm2 ls --no-color", check=False)
        run(client, f"curl -sS -o /dev/null -w '%{{http_code}}' http://127.0.0.1:{APP_PORT}/api/objects")
        run(
            client,
            f"curl -sS -o /dev/null -w '%{{http_code}}' -H 'Host: {DOMAIN}' http://127.0.0.1/api/objects",
        )
        print("\nDONE")
        print(f"HTTP:  http://{DOMAIN}")
        print(f"HTTPS: https://{DOMAIN}")
        print(f"API:   port {APP_PORT} (task-manager stays on 3001)")
    finally:
        sftp.close()
        client.close()
        archive.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
