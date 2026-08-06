#!/usr/bin/env python3
"""Run setup only on VPS (project already uploaded)."""
import stat
import sys
import secrets
from pathlib import Path

import paramiko

HOST = "176.12.69.195"
USER = "root"
PASSWORD = "EbAtMatSpm14!"
REMOTE_DIR = "/opt/task-manager"

# Import setup script builder from deploy.py
sys.path.insert(0, str(Path(__file__).parent))
import deploy  # noqa: E402

def main():
    setup = deploy.SETUP_SCRIPT.replace("__SESSION_SECRET__", secrets.token_hex(32))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    code, out, _ = deploy.run_ssh(client, "node -v 2>/dev/null || echo NO_NODE")
    if "NO_NODE" in out:
        print("Node not found — will install during setup")

    sftp = client.open_sftp()
    with sftp.file("/tmp/setup-task-manager.sh", "w") as f:
        f.write(setup)
    sftp.chmod("/tmp/setup-task-manager.sh", stat.S_IRWXU)
    sftp.close()

    code, out, err = deploy.run_ssh(client, "bash /tmp/setup-task-manager.sh", timeout=900)
    client.close()

    if "DEPLOY_OK" in out:
        print(f"\nDeployed: http://{HOST}")
        print("Login: admin / admin123")
        return 0
    print("Setup failed", file=sys.stderr)
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
