#!/usr/bin/env python3
"""Run setup only on VPS (project already uploaded)."""
import secrets
import stat
import sys
from pathlib import Path

import paramiko

sys.path.insert(0, str(Path(__file__).parent))
import deploy  # noqa: E402


def main():
    if not deploy.PASSWORD:
        print(
            "DEPLOY_PASSWORD is not set. Create .deploy.env (see .deploy.env.example).",
            file=sys.stderr,
        )
        return 1

    setup = deploy.SETUP_SCRIPT.replace("__SESSION_SECRET__", secrets.token_hex(32))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {deploy.HOST}...")
    client.connect(deploy.HOST, username=deploy.USER, password=deploy.PASSWORD, timeout=30)

    code, out, _ = deploy.run_ssh(client, "node -v 2>/dev/null || echo NO_NODE")
    if "NO_NODE" in out:
        print("Node not found — will install during setup")

    sftp = client.open_sftp()
    with sftp.file("/tmp/setup-task-manager.sh", "w") as f:
        f.write(setup)
    sftp.chmod("/tmp/setup-task-manager.sh", stat.S_IRWXU)
    sftp.close()

    print("Running setup...")
    deploy.run_ssh(client, "bash /tmp/setup-task-manager.sh", timeout=900)
    client.close()
    print("Setup finished.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
