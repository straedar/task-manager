# -*- coding: utf-8 -*-
"""Continue stockmap deploy after upload (files already on server)."""
from __future__ import annotations

import os

import paramiko

HOST = "176.12.69.195"
USER = "root"
PASSWORD = os.environ.get("STOCKMAP_SSH_PASSWORD", "CHANGE_ME")
REMOTE_DIR = "/opt/stockmap"
APP_PORT = 3002
DOMAIN = "stockmap.176-12-69-195.sslip.io"

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


def run(client: paramiko.SSHClient, cmd: str, check: bool = True) -> str:
    print(f"$ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    safe = (out + ("\n" + err if err.strip() else "")).encode("ascii", "replace").decode("ascii")
    if safe.strip():
        print(safe[-2500:] if len(safe) > 2500 else safe)
    if check and code != 0:
        raise RuntimeError(f"Command failed ({code}): {cmd}")
    return out


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=60)
    sftp = client.open_sftp()
    try:
        # Ensure node_modules complete
        run(client, f"test -d {REMOTE_DIR}/node_modules/tsx || (cd {REMOTE_DIR} && npm install)")
        run(client, f"cd {REMOTE_DIR} && npm run build")

        with sftp.file(f"{REMOTE_DIR}/ecosystem.config.cjs", "w") as f:
            f.write(ECOSYSTEM)

        run(client, f"cd {REMOTE_DIR} && pm2 delete stockmap", check=False)
        run(client, f"cd {REMOTE_DIR} && pm2 start ecosystem.config.cjs")
        run(client, "pm2 save", check=False)

        with sftp.file("/etc/nginx/sites-available/stockmap", "w") as f:
            f.write(NGINX_BOOTSTRAP)
        run(
            client,
            "ln -sfn /etc/nginx/sites-available/stockmap /etc/nginx/sites-enabled/stockmap && nginx -t && systemctl reload nginx",
        )

        run(
            client,
            f"certbot certonly --webroot -w /var/www/html -d {DOMAIN} "
            f"--non-interactive --agree-tos --register-unsafely-without-email "
            f"--keep-until-expiring",
            check=False,
        )

        out = run(
            client,
            f"test -f /etc/letsencrypt/live/{DOMAIN}/fullchain.pem && echo HAS_CERT || echo NO_CERT",
        )
        if "HAS_CERT" in out:
            with sftp.file("/etc/nginx/sites-available/stockmap", "w") as f:
                f.write(NGINX_CONF)
            run(client, "nginx -t && systemctl reload nginx")
        else:
            print("WARN: no SSL cert, HTTP only")

        run(client, "pm2 ls --no-color", check=False)
        run(client, f"curl -sS -o /dev/null -w '%{{http_code}}\\n' http://127.0.0.1:{APP_PORT}/api/objects")
        run(
            client,
            f"curl -sS -o /dev/null -w '%{{http_code}}\\n' -H 'Host: {DOMAIN}' http://127.0.0.1/api/objects",
        )
        run(
            client,
            f"curl -skS -o /dev/null -w '%{{http_code}}\\n' https://{DOMAIN}/api/objects",
            check=False,
        )
        print("\nDONE")
        print(f"URL: https://{DOMAIN}")
        print(f"Alt: http://{DOMAIN}")
    finally:
        sftp.close()
        client.close()


if __name__ == "__main__":
    main()
