#!/usr/bin/env bash
# Deploy Ember to the Tailscale host `homelab` (ssh Host from ~/.ssh/config).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_HOST="${EMBER_DEPLOY_HOST:-homelab}"
REMOTE_DIR="${EMBER_DEPLOY_DIR:-/home/justinmiddler/apps/Ember}"
WEB_PORT="${EMBER_WEB_PORT:-3200}"
CP_PORT="${EMBER_CP_PORT:-8080}"

echo "==> resolving public base URL on ${REMOTE_HOST}"
# Prefer LAN: this laptop often cannot reach the homelab Tailscale identity
# (different tailnet user). Override with EMBER_PUBLIC_HOST / EMBER_PUBLIC_BASE_URL.
LAN_IP="$(ssh -o BatchMode=yes "$REMOTE_HOST" "hostname -I 2>/dev/null | awk '{print \$1}'")"
TS_IP="$(ssh -o BatchMode=yes "$REMOTE_HOST" 'tailscale ip -4 2>/dev/null | head -1' || true)"
PUBLIC_HOST="${EMBER_PUBLIC_HOST:-${LAN_IP:-${TS_IP:-localhost}}}"
PUBLIC_BASE_URL="${EMBER_PUBLIC_BASE_URL:-http://${PUBLIC_HOST}:${WEB_PORT}}"
echo "    LAN=${LAN_IP:-?} TS=${TS_IP:-?} public=${PUBLIC_BASE_URL}"

echo "==> rsync to ${REMOTE_HOST}:${REMOTE_DIR}"
ssh -o BatchMode=yes "$REMOTE_HOST" "mkdir -p '${REMOTE_DIR}'"
rsync -az --delete \
  --exclude target \
  --exclude '**/node_modules' \
  --exclude '**/.next' \
  --exclude e2e/node_modules \
  --exclude e2e/test-results \
  --exclude e2e/playwright-report \
  --exclude e2e/.run-* \
  --exclude .git \
  --exclude '*.db' \
  --exclude '*.db-*' \
  "${ROOT}/" "${REMOTE_HOST}:${REMOTE_DIR}/"

echo "==> writing remote .env"
ssh -o BatchMode=yes "$REMOTE_HOST" "cat > '${REMOTE_DIR}/.env' <<EOF
EMBER_WEB_PORT=${WEB_PORT}
EMBER_CP_PORT=${CP_PORT}
EMBER_PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
RUST_LOG=info,sqlx=warn,tower_http=info
EOF"

echo "==> docker compose build + up on ${REMOTE_HOST}"
ssh -o BatchMode=yes "$REMOTE_HOST" "cd '${REMOTE_DIR}' && \
  docker compose --env-file .env build && \
  docker compose --env-file .env up -d && \
  docker compose --env-file .env ps"

echo
echo "==> deployed"
echo "  dashboard: ${PUBLIC_BASE_URL}"
echo "  health:    http://${TS_IP}:${CP_PORT}/api/health"
echo
echo "smoke:"
echo "  curl -fsS http://${TS_IP}:${CP_PORT}/api/health"
echo "  curl -fsS -o /dev/null -w '%{http_code}\\n' ${PUBLIC_BASE_URL}/login"
echo
echo "e2e against remote (from laptop):"
echo "  E2E_EXTERNAL_STACK=1 \\"
echo "  E2E_BASE_URL=${PUBLIC_BASE_URL} \\"
echo "  E2E_CP_URL=http://${TS_IP}:${CP_PORT} \\"
echo "  bash scripts/e2e.sh"
