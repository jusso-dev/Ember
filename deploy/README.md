# Homelab production deploy (P0)

## Stack

1. **Docker Compose** — control plane + web (`docker-compose.yml`).
2. **Caddy** — TLS reverse proxy (`deploy/caddy/Caddyfile`).
3. **Agent** — systemd unit on each host (`deploy/systemd/ember-agent.service`).
4. **Backup** — nightly timer → `POST /api/admin/backup` (`deploy/scripts/ember-backup.sh`).

## Quick path (no TLS)

```bash
bash scripts/deploy-homelab.sh
```

## TLS edge

```bash
export EMBER_DOMAIN=ember.home.arpa
export EMBER_WEB_UPSTREAM=127.0.0.1:3200
export EMBER_CP_UPSTREAM=127.0.0.1:8080
caddy run --config deploy/caddy/Caddyfile
```

Set `EMBER_PUBLIC_BASE_URL=https://$EMBER_DOMAIN` on the control plane so invite URLs and install commands use HTTPS.

## Agent always-on

```bash
# after enroll (or release install)
sudo install -m 755 ./ember-agent /usr/local/bin/ember-agent
sudo mkdir -p /etc/ember
sudo tee /etc/ember/agent.env <<EOF
EMBER_SERVER=https://ember.home.arpa
# token written by enroll; or use install.sh which stores state
EOF
sudo cp deploy/systemd/ember-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ember-agent
```

Prefer the one-shot installer from the UI once a release binary is published.

## Backup

```bash
sudo install -m 755 deploy/scripts/ember-backup.sh /usr/local/bin/ember-backup.sh
sudo cp deploy/systemd/ember-backup.{service,timer} /etc/systemd/system/
# /etc/ember/control-plane.env:
#   EMBER_CP_URL=http://127.0.0.1:8080
#   EMBER_API_TOKEN=ember_...
#   EMBER_BACKUP_NAS_DIR=/mnt/nas/ember-backups
sudo systemctl enable --now ember-backup.timer
```

Restore drill: stop CP, replace `/data/ember.db` with snapshot, start CP, hit `/api/health` + login.

## Secrets key

Set `EMBER_SECRETS_KEY` to a long random string in compose/env so secret ciphertext stays decryptable across restarts.
