import paramiko
import sys

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("176.12.69.195", username="root", password="EbAtMatSpm14!", timeout=30)
cmds = [
    "pm2 status",
    "pm2 logs task-manager-api --lines 30 --nostream",
    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health || echo FAIL",
    "ss -tlnp | grep 3001 || netstat -tlnp | grep 3001 || true",
    "cat /opt/task-manager/backend/.env",
]
for cmd in cmds:
    print("\n===", cmd, "===")
    _i, stdout, stderr = client.exec_command(cmd, timeout=60)
    stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    sys.stdout.buffer.write((out + err).encode("utf-8", errors="replace"))
client.close()
