#!/usr/bin/env bash
# Run Ember end-to-end tests (API + Lightpanda/Playwright browser).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export E2E_CP_PORT="${E2E_CP_PORT:-18080}"
export E2E_WEB_PORT="${E2E_WEB_PORT:-13000}"
export E2E_CDP_PORT="${E2E_CDP_PORT:-19222}"

echo "==> building control-plane"
cargo build -p ember-control-plane

if [[ "${E2E_AGENT_FLOW:-}" == "1" || "${E2E_AGENT_FLOW:-}" == "true" ]]; then
  echo "==> building agent (optional agent flow enabled)"
  cargo build -p ember-agent
fi

echo "==> ensuring web deps"
(cd web && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)

if [[ "${E2E_WEB_MODE:-}" == "prod" || "${CI:-}" == "true" ]]; then
  echo "==> building web (production mode)"
  (cd web && CONTROL_PLANE_URL="http://127.0.0.1:${E2E_CP_PORT}" pnpm build)
  export E2E_WEB_MODE=prod
fi

echo "==> ensuring e2e deps"
(cd e2e && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)

echo "==> running Playwright + Lightpanda e2e"
(cd e2e && pnpm test "$@")
