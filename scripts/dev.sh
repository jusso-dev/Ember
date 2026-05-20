#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

cargo test -p ember-shared --quiet >/dev/null 2>&1 || cargo test -p ember-shared

(cd control-plane && cargo run) &
CP_PID=$!

(cd web && pnpm dev) &
WEB_PID=$!

trap 'kill $CP_PID $WEB_PID 2>/dev/null || true' EXIT INT TERM
wait
