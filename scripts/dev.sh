#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

: "${EMBER_BIND_ADDR:=127.0.0.1:8080}"
export EMBER_BIND_ADDR

cargo test -p ember-shared --quiet >/dev/null 2>&1 || cargo test -p ember-shared

echo "==> control-plane: ${EMBER_BIND_ADDR}  (create the first owner account in the web UI)"

(cd control-plane && cargo run) &
CP_PID=$!

(cd web && pnpm dev) &
WEB_PID=$!

trap 'kill $CP_PID $WEB_PID 2>/dev/null || true' EXIT INT TERM
wait
