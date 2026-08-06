#!/usr/bin/env python3
"""Deploy task-manager to VPS via SSH."""
import os
import stat
import sys
import tarfile
import tempfile
import secrets
from pathlib import Path

try:
    import paramiko
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])
    import paramiko


def _load_dotenv_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


_load_dotenv_file(Path(__file__).resolve().parent / ".deploy.env")

HOST = os.environ.get("DEPLOY_HOST", "176.12.69.195")
USER = os.environ.get("DEPLOY_USER", "root")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "").strip()
REMOTE_DIR = os.environ.get("DEPLOY_REMOTE_DIR", "/opt/task-manager")
PROJECT_ROOT = Path(__file__).resolve().parent

SKIP_DIRS = {"node_modules", ".git", "dist", "data", "uploads", "__pycache__"}
SKIP_FILES = {".env", ".deploy.env"}

SETUP_SCRIPT = f"""#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

wait_apt() {{
  for i in $(seq 1 60); do
    if ! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && ! fuser /var/lib/apt/lists/lock >/dev/null 2>&1; then
      return 0
    fi
    echo "Waiting for apt lock... ($i/60)"
    sleep 5
  done
  echo "apt lock timeout"
  exit 1
}}

install_node() {{
  wait_apt
  apt-get update
  apt-get install -y curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  echo "Node installed: $(node -v) npm $(npm -v)"
}}

if ! command -v node >/dev/null 2>&1; then
  install_node
else
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
  if [ "$NODE_MAJOR" -lt 22 ]; then
    install_node
  else
    echo "Node already installed: $(node -v)"
  fi
fi

if ! command -v nginx >/dev/null 2>&1; then
  wait_apt
  apt-get update
  apt-get install -y nginx
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

mkdir -p {REMOTE_DIR}/backend/data

if [ ! -f {REMOTE_DIR}/backend/.env ]; then
  cat > {REMOTE_DIR}/backend/.env << 'ENVEOF'
PORT=3001
SESSION_SECRET=__SESSION_SECRET__
DB_PATH={REMOTE_DIR}/backend/data/app.db
FRONTEND_URL=https://176-12-69-195.sslip.io
COOKIE_SECURE=true
SEED_ADMIN_NICKNAME=admin
SEED_ADMIN_PASSWORD=admin123
ENVEOF
  echo "Created new .env"
else
  echo "Keeping existing .env"
fi

# Ensure VAPID keys for Web Push
cd {REMOTE_DIR}/backend
npm install
if ! grep -q '^VAPID_PUBLIC_KEY=.' .env 2>/dev/null; then
  node --input-type=module << 'VAPIDJS'
import webpush from 'web-push';
import fs from 'fs';
const keys = webpush.generateVAPIDKeys();
let env = fs.readFileSync('.env', 'utf8');
env = env.replace(/^VAPID_PUBLIC_KEY=.*$/m, '');
env = env.replace(/^VAPID_PRIVATE_KEY=.*$/m, '');
env = env.replace(/^VAPID_SUBJECT=.*$/m, '');
env = env.trimEnd() +
  '\\nVAPID_PUBLIC_KEY=' + keys.publicKey +
  '\\nVAPID_PRIVATE_KEY=' + keys.privateKey +
  '\\nVAPID_SUBJECT=mailto:admin@task-manager.local\\n';
fs.writeFileSync('.env', env);
console.log('Generated VAPID keys');
VAPIDJS
fi

# Prefer HTTPS origin for cookies / push
if grep -q '^FRONTEND_URL=' .env; then
  sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=https://176-12-69-195.sslip.io|' .env
else
  echo 'FRONTEND_URL=https://176-12-69-195.sslip.io' >> .env
fi
if grep -q '^COOKIE_SECURE=' .env; then
  sed -i 's|^COOKIE_SECURE=.*|COOKIE_SECURE=true|' .env
else
  echo 'COOKIE_SECURE=true' >> .env
fi

npm run build

cd {REMOTE_DIR}/frontend
npm install
npm run build

# --- Stockmap mini-app ---
mkdir -p {REMOTE_DIR}/stockmap/data
if [ -d /opt/stockmap/data ] && [ ! -f {REMOTE_DIR}/stockmap/data/stockmap.db ]; then
  cp -a /opt/stockmap/data/. {REMOTE_DIR}/stockmap/data/ || true
  echo "Imported stockmap data from /opt/stockmap"
fi

cd {REMOTE_DIR}/stockmap
npm install
npm run build
pm2 delete stockmap-api 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

pm2 delete task-manager-api 2>/dev/null || true
cd {REMOTE_DIR}/backend
pm2 start dist/index.js --name task-manager-api
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash || true

cat > /etc/nginx/sites-available/task-manager << 'NGINXEOF'
server {{
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 176-12-69-195.sslip.io {HOST} _;

    location /.well-known/acme-challenge/ {{
        root /var/www/html;
    }}

    location / {{
        return 301 https://176-12-69-195.sslip.io$request_uri;
    }}
}}

server {{
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name 176-12-69-195.sslip.io;

    ssl_certificate /etc/letsencrypt/live/176-12-69-195.sslip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/176-12-69-195.sslip.io/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    root {REMOTE_DIR}/frontend/dist;
    index index.html;

    location /api/ {{
        client_max_body_size 12m;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}

    location /stockmap-api/ {{
        client_max_body_size 12m;
        proxy_pass http://127.0.0.1:3003/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}

    location /stockmap-app/ {{
        alias {REMOTE_DIR}/stockmap/dist/;
        index index.html;
    }}

    location = /sw.js {{
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Service-Worker-Allowed "/";
        try_files $uri =404;
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
NGINXEOF

# Bootstrap HTTP-only nginx first so certbot can pass ACME challenge
cat > /etc/nginx/sites-available/task-manager-bootstrap << 'BOOTSTRAP'
server {{
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 176-12-69-195.sslip.io 176.12.69.195 _;

    root /opt/task-manager/frontend/dist;
    index index.html;

    location /.well-known/acme-challenge/ {{
        root /var/www/html;
    }}

    location /api/ {{
        client_max_body_size 12m;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}

    location /stockmap-api/ {{
        client_max_body_size 12m;
        proxy_pass http://127.0.0.1:3003/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}

    location /stockmap-app/ {{
        alias {REMOTE_DIR}/stockmap/dist/;
        index index.html;
    }}

    location = /sw.js {{
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Service-Worker-Allowed "/";
        try_files $uri =404;
    }}

    location / {{
        try_files $uri $uri/ /index.html;
    }}
}}
BOOTSTRAP

mkdir -p /var/www/html

if [ ! -d /etc/letsencrypt/live/176-12-69-195.sslip.io ]; then
  ln -sf /etc/nginx/sites-available/task-manager-bootstrap /etc/nginx/sites-enabled/task-manager
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  wait_apt
  apt-get update
  apt-get install -y certbot python3-certbot-nginx
  certbot certonly --webroot -w /var/www/html \
    -d 176-12-69-195.sslip.io \
    --non-interactive --agree-tos --register-unsafely-without-email \
    || certbot certonly --nginx -d 176-12-69-195.sslip.io \
      --non-interactive --agree-tos --register-unsafely-without-email \
    || true
fi

if [ -d /etc/letsencrypt/live/176-12-69-195.sslip.io ]; then
  ln -sf /etc/nginx/sites-available/task-manager /etc/nginx/sites-enabled/task-manager
else
  echo "SSL cert missing — staying on HTTP bootstrap"
  ln -sf /etc/nginx/sites-available/task-manager-bootstrap /etc/nginx/sites-enabled/task-manager
  # Fall back cookies for HTTP
  sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=http://176.12.69.195|' {REMOTE_DIR}/backend/.env
  sed -i 's|^COOKIE_SECURE=.*|COOKIE_SECURE=false|' {REMOTE_DIR}/backend/.env
  pm2 restart task-manager-api
fi

rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "DEPLOY_OK"
pm2 status
curl -sk https://127.0.0.1/api/health -H 'Host: 176-12-69-195.sslip.io' || curl -s http://127.0.0.1/api/health || true
"""


def should_skip(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    parts = rel.parts
    if parts and parts[0] in SKIP_DIRS:
        return True
    if any(p in SKIP_DIRS for p in parts):
        return True
    if path.name in SKIP_FILES:
        return True
    return False


def create_archive() -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
    tmp.close()
    with tarfile.open(tmp.name, "w:gz") as tar:
        for item in PROJECT_ROOT.rglob("*"):
            if should_skip(item, PROJECT_ROOT):
                continue
            if item.is_file():
                arcname = (Path("task-manager") / item.relative_to(PROJECT_ROOT)).as_posix()
                tar.add(item, arcname=arcname)
    return tmp.name


def safe_print(text: str) -> None:
    if not text:
        return
    snippet = text[-4000:] if len(text) > 4000 else text
    sys.stdout.buffer.write(snippet.encode("utf-8", errors="replace") + b"\n")


def run_ssh(client: paramiko.SSHClient, command: str, timeout: int = 600) -> tuple[int, str, str]:
    print(f"\n>>> {command[:120]}...")
    _stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        safe_print(out)
    if err and exit_code != 0:
        safe_print(err)
    return exit_code, out, err


def main() -> int:
    if not PASSWORD:
        print(
            "DEPLOY_PASSWORD is not set.\n"
            "Create .deploy.env in the project root (see .deploy.env.example).",
            file=sys.stderr,
        )
        return 1

    session_secret = secrets.token_hex(32)
    setup = SETUP_SCRIPT.replace("__SESSION_SECRET__", session_secret)

    archive = create_archive()
    print(f"Archive: {archive} ({os.path.getsize(archive) // 1024} KB)")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    run_ssh(
        client,
        f"""
        if [ -d {REMOTE_DIR}/backend/data ]; then
          cp -a {REMOTE_DIR}/backend/data /tmp/task-manager-data-backup
          echo "Database backed up"
        fi
        if [ -d {REMOTE_DIR}/stockmap/data ]; then
          cp -a {REMOTE_DIR}/stockmap/data /tmp/stockmap-data-backup
          echo "Stockmap data backed up"
        fi
        if [ -f {REMOTE_DIR}/backend/.env ]; then
          cp {REMOTE_DIR}/backend/.env /tmp/task-manager.env-backup
          echo ".env backed up"
        fi
        rm -rf {REMOTE_DIR}
        """,
    )

    print("Uploading project...")
    sftp = client.open_sftp()
    remote_archive = "/tmp/task-manager.tar.gz"
    sftp.put(archive, remote_archive)
    sftp.close()
    os.unlink(archive)

    run_ssh(
        client,
        f"""
        tar -xzf {remote_archive} -C /opt
        if [ -d /tmp/task-manager-data-backup ]; then
          mkdir -p {REMOTE_DIR}/backend
          cp -a /tmp/task-manager-data-backup {REMOTE_DIR}/backend/data
          rm -rf /tmp/task-manager-data-backup
          echo "Database restored"
        fi
        if [ -d /tmp/stockmap-data-backup ]; then
          mkdir -p {REMOTE_DIR}/stockmap
          cp -a /tmp/stockmap-data-backup {REMOTE_DIR}/stockmap/data
          rm -rf /tmp/stockmap-data-backup
          echo "Stockmap data restored"
        fi
        if [ -f /tmp/task-manager.env-backup ]; then
          mkdir -p {REMOTE_DIR}/backend
          cp /tmp/task-manager.env-backup {REMOTE_DIR}/backend/.env
          rm -f /tmp/task-manager.env-backup
          echo ".env restored"
        fi
        """,
        timeout=120,
    )

    run_ssh(client, f"rm -f {remote_archive}")

    sftp = client.open_sftp()
    with sftp.file("/tmp/setup-task-manager.sh", "w") as f:
        f.write(setup)
    sftp.chmod("/tmp/setup-task-manager.sh", stat.S_IRWXU)
    sftp.close()

    code, out, err = run_ssh(client, "bash /tmp/setup-task-manager.sh", timeout=900)
    client.close()

    if "DEPLOY_OK" in out:
        print(f"\nDeployed: https://176-12-69-195.sslip.io")
        print(f"(IP fallback: http://{HOST})")
        print("Login: admin / admin123")
        return 0

    print("\nDeploy may have failed. Check output above.", file=sys.stderr)
    return 1 if code != 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
