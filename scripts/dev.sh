#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

detect_host_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null && return
    ipconfig getifaddr en1 2>/dev/null && return
    iface="$(route get default 2>/dev/null | awk '/interface:/{print $2}' || true)"
    if [ -n "${iface:-}" ]; then
      ipconfig getifaddr "$iface" 2>/dev/null && return
    fi
  fi
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}' && return
  fi
  echo "127.0.0.1"
}

HOST_IP="${HOST_IP:-$(detect_host_ip)}"
HOST_IP="${HOST_IP:-127.0.0.1}"
: "${EMBER_BIND_ADDR:=0.0.0.0:8080}"
: "${EMBER_PUBLIC_BASE_URL:=http://${HOST_IP}:3000}"
: "${CONTROL_PLANE_URL:=http://127.0.0.1:8080}"
export EMBER_BIND_ADDR EMBER_PUBLIC_BASE_URL CONTROL_PLANE_URL

cargo test -p ember-shared --quiet >/dev/null 2>&1 || cargo test -p ember-shared

echo "==> control-plane: ${EMBER_BIND_ADDR}  (create the first owner account in the web UI)"
echo "==> web: http://${HOST_IP}:3000"
echo "==> public base URL: ${EMBER_PUBLIC_BASE_URL}"

(cd control-plane && cargo run) &
CP_PID=$!

(cd web && pnpm dev) &
WEB_PID=$!

trap 'kill $CP_PID $WEB_PID 2>/dev/null || true' EXIT INT TERM
wait
