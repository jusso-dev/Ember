#!/usr/bin/env sh
set -eu

REPO_URL="${EMBER_REPO_URL:-https://github.com/jusso-dev/Ember.git}"
BIN_URL="${EMBER_AGENT_BIN_URL:-}"
INSTALL_DIR="${EMBER_INSTALL_DIR:-/usr/local/bin}"
STATE_DIR="${EMBER_AGENT_STATE_DIR:-/var/lib/ember-agent}"
VOLUMES_DIR="${EMBER_VOLUMES_DIR:-/var/lib/ember/volumes}"

usage() {
  cat <<'EOF'
Usage:
  curl -fsSL http://<control-plane>:3000/install.sh | sudo NAME=$(hostname) sh -s -- --server http://<control-plane>:3000 --token <token>

Options:
  --server <url>   Ember control-plane URL.
  --token <token>  One-shot enrollment token.
  --name <name>    Host name. Defaults to $NAME or hostname.

Environment:
  EMBER_AGENT_BIN_URL    Optional URL to a prebuilt ember-agent binary.
  EMBER_REPO_URL         Git repo used for cargo install fallback.
  EMBER_INSTALL_DIR      Install directory, default /usr/local/bin.
  EMBER_AGENT_STATE_DIR  Agent state directory, default /var/lib/ember-agent.
  EMBER_VOLUMES_DIR      Volume root, default /var/lib/ember/volumes.
EOF
}

SERVER=""
TOKEN=""
HOST_NAME="${NAME:-$(hostname)}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server)
      SERVER="${2:-}"
      shift 2
      ;;
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --name)
      HOST_NAME="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "$SERVER" ] || [ -z "$TOKEN" ]; then
  usage >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$STATE_DIR" "$VOLUMES_DIR"

if [ -n "$BIN_URL" ]; then
  echo "Downloading ember-agent from $BIN_URL"
  tmp="$(mktemp)"
  curl -fsSL "$BIN_URL" -o "$tmp"
  install -m 0755 "$tmp" "$INSTALL_DIR/ember-agent"
  rm -f "$tmp"
elif command -v cargo >/dev/null 2>&1; then
  echo "Installing ember-agent from $REPO_URL with cargo"
  cargo install --git "$REPO_URL" ember-agent --locked --force --root /usr/local
else
  echo "No prebuilt binary URL was provided and cargo is not installed." >&2
  echo "Set EMBER_AGENT_BIN_URL or install Rust/Cargo, then rerun this command." >&2
  exit 1
fi

echo "Enrolling $HOST_NAME with $SERVER"
EMBER_AGENT_STATE_DIR="$STATE_DIR" EMBER_VOLUMES_DIR="$VOLUMES_DIR" \
  "$INSTALL_DIR/ember-agent" enroll \
    --server "$SERVER" \
    --token "$TOKEN" \
    --name "$HOST_NAME"

cat <<EOF

ember-agent is installed and enrolled.

Run it now:
  sudo EMBER_AGENT_STATE_DIR="$STATE_DIR" EMBER_VOLUMES_DIR="$VOLUMES_DIR" "$INSTALL_DIR/ember-agent" run

Example systemd unit:
  /etc/systemd/system/ember-agent.service

[Unit]
Description=Ember Agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Environment=EMBER_AGENT_STATE_DIR=$STATE_DIR
Environment=EMBER_VOLUMES_DIR=$VOLUMES_DIR
ExecStart=$INSTALL_DIR/ember-agent run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
