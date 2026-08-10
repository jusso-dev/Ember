#!/usr/bin/env bash
# Trigger control-plane backup API and optionally rsync to NAS.
set -euo pipefail

CP_URL="${EMBER_CP_URL:-http://127.0.0.1:8080}"
TOKEN="${EMBER_API_TOKEN:-}"
COOKIE="${EMBER_SESSION_COOKIE:-}"
NAS_DIR="${EMBER_BACKUP_NAS_DIR:-}"

hdr=(-H 'accept: application/json')
if [[ -n "$TOKEN" ]]; then
  hdr+=(-H "authorization: Bearer ${TOKEN}")
elif [[ -n "$COOKIE" ]]; then
  hdr+=(-H "cookie: ${COOKIE}")
else
  echo "set EMBER_API_TOKEN or EMBER_SESSION_COOKIE" >&2
  exit 1
fi

resp="$(curl -fsS -X POST "${CP_URL}/api/admin/backup" "${hdr[@]}")"
echo "$resp"

if [[ -n "$NAS_DIR" ]]; then
  path="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["path"])' <<<"$resp")"
  mkdir -p "$NAS_DIR"
  cp -a "$path" "$NAS_DIR/"
  echo "copied to ${NAS_DIR}/$(basename "$path")"
fi
