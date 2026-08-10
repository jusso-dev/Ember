#!/usr/bin/env bash
# Phase A ops bootstrap + verification on the homelab host.
# Safe to re-run: skips enroll if agent state exists; recreates pet workload.
#
# Run from laptop (preferred):
#   bash scripts/homelab-phase-a.sh
# Or on host:
#   EMBER_REMOTE=local bash scripts/homelab-phase-a.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_HOST="${EMBER_DEPLOY_HOST:-homelab}"
REMOTE_DIR="${EMBER_DEPLOY_DIR:-/home/justinmiddler/apps/Ember}"
CP_URL="${EMBER_CP_URL:-http://127.0.0.1:8080}"
WEB_URL="${EMBER_WEB_URL:-http://127.0.0.1:3200}"
EMAIL="${EMBER_EMAIL:-owner@ember.e2e}"
PASSWORD="${EMBER_PASSWORD:-ember-e2e-password-1}"
PET_PORT="${EMBER_PET_PORT:-8089}"
PET_NAME="${EMBER_PET_NAME:-ember-pet-nginx}"
AGENT_NAME="${EMBER_AGENT_NAME:-homelab}"
BACKUP_NAS="${EMBER_BACKUP_NAS_DIR:-/home/justinmiddler/apps/Ember/backups-nas}"
REMOTE="${EMBER_REMOTE:-ssh}" # ssh | local

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

remote() {
  if [[ "$REMOTE" == "local" ]]; then
    bash -lc "$*"
  else
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$REMOTE_HOST" bash -lc "$(printf '%q ' "$@")"
  fi
}

# Run multi-line script on remote
remote_script() {
  if [[ "$REMOTE" == "local" ]]; then
    bash -s
  else
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$REMOTE_HOST" bash -s
  fi
}

if [[ "$REMOTE" != "local" ]]; then
  log "rsync tree → ${REMOTE_HOST}:${REMOTE_DIR}"
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
fi

log "Phase A bootstrap on ${REMOTE_HOST} (cp=${CP_URL})"

remote_script <<'REMOTE_EOF'
set -euo pipefail

REMOTE_DIR="${EMBER_DEPLOY_DIR:-/home/justinmiddler/apps/Ember}"
CP_URL="${EMBER_CP_URL:-http://127.0.0.1:8080}"
WEB_URL="${EMBER_WEB_URL:-http://127.0.0.1:3200}"
EMAIL="${EMBER_EMAIL:-owner@ember.e2e}"
PASSWORD="${EMBER_PASSWORD:-ember-e2e-password-1}"
PET_PORT="${EMBER_PET_PORT:-8089}"
PET_NAME="${EMBER_PET_NAME:-ember-pet-nginx}"
AGENT_NAME="${EMBER_AGENT_NAME:-homelab}"
BACKUP_NAS="${EMBER_BACKUP_NAS_DIR:-/home/justinmiddler/apps/Ember/backups-nas}"
COOKIE_JAR=/tmp/ember-phase-a.cookies
TOKEN_FILE=/etc/ember/api-token
STATE_DIR=/var/lib/ember-agent
INSTALL_DIR=/usr/local/bin
COMPOSE_DIR="$REMOTE_DIR"

cd "$REMOTE_DIR"
export PATH="/usr/local/bin:$PATH"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

need curl
need docker
need python3
need sudo

# --- wait for CP ---
log "wait for control plane health"
for i in $(seq 1 60); do
  if curl -fsS "$CP_URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
  [[ $i -eq 60 ]] && die "control plane not healthy at $CP_URL"
done
curl -fsS "$CP_URL/api/health"; echo

# --- auth ---
log "login as $EMAIL"
rm -f "$COOKIE_JAR"
login_body=$(curl -fsS -c "$COOKIE_JAR" -X POST "$CP_URL/api/auth/login" \
  -H 'content-type: application/json' \
  -d "$(python3 -c "import json; print(json.dumps({'email':'''$EMAIL''','password':'''$PASSWORD'''}))")")
echo "$login_body" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("authenticated"), d; print("session ok:", d["user"]["email"], d["active_tenant"]["role"])'

auth_hdr() {
  # Prefer API token if present
  if [[ -f "$TOKEN_FILE" ]]; then
    echo "authorization: Bearer $(sudo cat "$TOKEN_FILE")"
  else
    echo "cookie: $(python3 - <<'PY'
import http.cookiejar
jar=http.cookiejar.MozillaCookieJar("/tmp/ember-phase-a.cookies")
jar.load(ignore_discard=True, ignore_expires=True)
for c in jar:
  if c.name=="ember_session":
    print(f"ember_session={c.value}")
    break
else:
  raise SystemExit("no session cookie")
PY
)"
  fi
}

curl_auth() {
  local method="${1:-GET}" path="$2"
  shift 2 || true
  local hdr
  hdr="$(auth_hdr)"
  if [[ "$hdr" == authorization:* ]]; then
    curl -fsS -X "$method" "$CP_URL$path" -H "$hdr" -H 'content-type: application/json' "$@"
  else
    curl -fsS -b "$COOKIE_JAR" -X "$method" "$CP_URL$path" -H 'content-type: application/json' "$@"
  fi
}

# --- API token for backup (owner) ---
log "ensure owner API token for backup/automation"
if [[ ! -f "$TOKEN_FILE" ]]; then
  tok_json=$(curl -fsS -b "$COOKIE_JAR" -X POST "$CP_URL/api/tenants/current/tokens" \
    -H 'content-type: application/json' \
    -d '{"name":"homelab-phase-a","role":"owner","expires_days":365}')
  raw=$(echo "$tok_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); t=d.get("token_once"); assert t, d; print(t)')
  sudo mkdir -p /etc/ember
  printf '%s\n' "$raw" | sudo tee "$TOKEN_FILE" >/dev/null
  sudo chmod 600 "$TOKEN_FILE"
  echo "token saved $TOKEN_FILE prefix=$(echo "$raw" | cut -c1-12)"
else
  echo "token already at $TOKEN_FILE"
fi

# --- build agent binary ---
log "build ember-agent (docker cargo, may take a few minutes)"
if [[ ! -x "$INSTALL_DIR/ember-agent" ]] || [[ "${EMBER_FORCE_AGENT_BUILD:-}" == "1" ]]; then
  docker volume create ember-cargo-registry >/dev/null
  docker volume create ember-cargo-git >/dev/null
  docker volume create ember-target >/dev/null
  # Image already has rustc/cargo 1.80; project rust-toolchain.toml can force rustup
  # reinstall and leave cargo missing mid-bootstrap. Override toolchain + use image cargo.
  docker run --rm \
    -v "$REMOTE_DIR:/src:ro" \
    -v ember-cargo-registry:/usr/local/cargo/registry \
    -v ember-cargo-git:/usr/local/cargo/git \
    -v ember-target:/out \
    -w /tmp/build \
    -e CARGO_HOME=/usr/local/cargo \
    rust:1.88-slim-bookworm \
    bash -lc 'set -euo pipefail
      apt-get update -qq
      apt-get install -y -qq pkg-config libssl-dev ca-certificates >/dev/null
      export PATH="/usr/local/cargo/bin:$PATH"
      cargo --version
      cp -a /src/Cargo.toml /src/Cargo.lock /src/agent /src/shared /src/control-plane .
      # omit rust-toolchain.toml — use image toolchain (1.85+)
      mkdir -p /out
      CARGO_TARGET_DIR=/out cargo build --locked --release -p ember-agent
      ls -la /out/release/ember-agent
    '
  docker run --rm -v ember-target:/out -v /tmp:/hosttmp alpine \
    cp /out/release/ember-agent /hosttmp/ember-agent
  sudo install -m 755 /tmp/ember-agent "$INSTALL_DIR/ember-agent"
  sudo rm -f /tmp/ember-agent
fi
"$INSTALL_DIR/ember-agent" --version || true
ls -la "$INSTALL_DIR/ember-agent"

# --- enroll if needed ---
log "enroll agent if needed"
sudo mkdir -p "$STATE_DIR" /var/lib/ember/volumes
if [[ -f "$STATE_DIR/state.json" ]]; then
  echo "agent state exists; skip enroll"
  cat "$STATE_DIR/state.json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("host_id"), d.get("name"), d.get("server_url"))'
else
  enroll=$(curl -fsS -b "$COOKIE_JAR" -X POST "$CP_URL/api/hosts/enroll-token")
  token=$(echo "$enroll" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
  # Agent must talk to CP HTTP+WS directly (not Next rewrite)
  sudo env EMBER_AGENT_STATE_DIR="$STATE_DIR" EMBER_VOLUMES_DIR=/var/lib/ember/volumes \
    "$INSTALL_DIR/ember-agent" enroll \
      --server "$CP_URL" \
      --token "$token" \
      --name "$AGENT_NAME"
fi

# --- systemd agent ---
log "install + start ember-agent.service"
sudo tee /etc/ember/agent.env >/dev/null <<EOF
EMBER_AGENT_STATE_DIR=$STATE_DIR
EMBER_VOLUMES_DIR=/var/lib/ember/volumes
RUST_LOG=info
EOF
sudo cp "$REMOTE_DIR/deploy/systemd/ember-agent.service" /etc/systemd/system/ember-agent.service
# ensure unit has state env (template already has EnvironmentFile)
sudo systemctl daemon-reload
sudo systemctl enable --now ember-agent
sleep 2
sudo systemctl --no-pager --full status ember-agent | head -25 || true

log "wait for host online in control plane"
online=0
for i in $(seq 1 40); do
  hosts=$(curl -fsS -b "$COOKIE_JAR" "$CP_URL/api/hosts")
  count=$(echo "$hosts" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
  status=$(echo "$hosts" | python3 -c 'import json,sys; hs=json.load(sys.stdin); print(hs[0]["status"] if hs else "")' 2>/dev/null || true)
  echo "  try $i hosts=$count status=$status"
  if [[ "$status" == "online" ]]; then
    online=1
    echo "$hosts" | python3 -m json.tool | head -40
    break
  fi
  if [[ "$count" -ge 1 && "$i" -ge 30 ]]; then
    # enrolled but still pending/offline — dump agent logs and keep waiting a bit
    sudo journalctl -u ember-agent -n 30 --no-pager || true
  fi
  sleep 3
done
if [[ "$online" -ne 1 ]]; then
  sudo journalctl -u ember-agent -n 80 --no-pager || true
  die "host never reached online status"
fi
HOST_ID=$(curl -fsS -b "$COOKIE_JAR" "$CP_URL/api/hosts" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')
echo "HOST_ID=$HOST_ID"

# --- pet nginx workload ---
log "deploy pet workload $PET_NAME on host port $PET_PORT"
# delete existing pet if present
wls=$(curl -fsS -b "$COOKIE_JAR" "$CP_URL/api/workloads")
echo "$wls" | python3 -c "
import json,sys,urllib.request,http.cookiejar
hs=json.load(sys.stdin)
for w in hs:
  if w.get('name')=='$PET_NAME':
    print(w['id'])
" | while read -r wid; do
  [[ -n "$wid" ]] || continue
  log "delete old workload $wid"
  curl -fsS -b "$COOKIE_JAR" -X DELETE "$CP_URL/api/workloads/$wid" || true
  sleep 2
done

create_body=$(python3 - <<PY
import json
print(json.dumps({
  "host_id": "$HOST_ID",
  "name": "$PET_NAME",
  "image": "nginx:alpine",
  "env": [],
  "ports": [{"host_port": int("$PET_PORT"), "container_port": 80, "protocol": "tcp"}],
  "volumes": [],
  "command": None,
  "labels": [["app", "ember-pet"], ["managed-by", "phase-a"]],
  "placement_labels": [],
}))
PY
)
created=$(curl -fsS -b "$COOKIE_JAR" -X POST "$CP_URL/api/workloads" \
  -H 'content-type: application/json' \
  -d "$create_body")
echo "$created" | python3 -m json.tool | head -30
WID=$(echo "$created" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

log "wait for workload running + HTTP 200 on :$PET_PORT"
ok=0
for i in $(seq 1 60); do
  w=$(curl -fsS -b "$COOKIE_JAR" "$CP_URL/api/workloads/$WID")
  state=$(echo "$w" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("observed_state") or d.get("desired_state") or "")')
  err=$(echo "$w" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("last_error") or "")')
  code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PET_PORT}/" || true)
  echo "  try $i state=$state http=$code err=${err:0:80}"
  if [[ "$code" == "200" ]]; then ok=1; break; fi
  sleep 3
done
[[ "$ok" -eq 1 ]] || die "pet nginx never returned HTTP 200 on :$PET_PORT"
curl -fsS "http://127.0.0.1:${PET_PORT}/" | head -c 120; echo

# --- backup ---
log "SQLite backup via API + NAS copy"
# backups volume often root-owned after first create — CP runs as uid 10001
docker run --rm -v ember_ember-backups:/b alpine chown -R 10001:10001 /b 2>/dev/null || true
docker exec -u root ember-control-plane-1 chown -R ember:ember /data/backups 2>/dev/null || true
mkdir -p "$BACKUP_NAS"
sudo mkdir -p /etc/ember
sudo tee /etc/ember/control-plane.env >/dev/null <<EOF
EMBER_CP_URL=$CP_URL
EMBER_API_TOKEN=$(sudo cat "$TOKEN_FILE")
EMBER_BACKUP_NAS_DIR=$BACKUP_NAS
EOF
sudo chmod 600 /etc/ember/control-plane.env

# keep compose env (rsync --delete would wipe a gitignored .env)
cat > "$REMOTE_DIR/.env" <<EOF
EMBER_WEB_PORT=3200
EMBER_CP_PORT=8080
EMBER_PUBLIC_BASE_URL=${WEB_URL}
RUST_LOG=info,sqlx=warn,tower_http=info
EOF

backup_json=$(curl -fsS -b "$COOKIE_JAR" -X POST "$CP_URL/api/admin/backup")
echo "$backup_json" | python3 -m json.tool
bpath=$(echo "$backup_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["path"])')
CID=$(docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$REMOTE_DIR/.env" ps -q control-plane)
tmp_bak="/tmp/$(basename "$bpath")"
docker cp "$CID:$bpath" "$tmp_bak"
cp -a "$tmp_bak" "$BACKUP_NAS/"
host_bak="$BACKUP_NAS/$(basename "$bpath")"
ls -la "$host_bak"
python3 - <<PY
import sqlite3
c=sqlite3.connect("$host_bak")
print("integrity:", c.execute("pragma integrity_check").fetchone()[0])
print("users:", c.execute("select count(*) from users").fetchone()[0])
print("hosts:", c.execute("select count(*) from hosts").fetchone()[0])
print("workloads:", c.execute("select count(*) from workloads").fetchone()[0])
PY

sudo cp "$REMOTE_DIR/deploy/systemd/ember-backup.service" /etc/systemd/system/
sudo cp "$REMOTE_DIR/deploy/systemd/ember-backup.timer" /etc/systemd/system/
sudo tee /usr/local/bin/ember-backup-homelab.sh >/dev/null <<'WRAP'
#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source /etc/ember/control-plane.env
resp="$(curl -fsS -X POST "${EMBER_CP_URL}/api/admin/backup" \
  -H "authorization: Bearer ${EMBER_API_TOKEN}" \
  -H 'accept: application/json')"
echo "$resp"
path="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["path"])' <<<"$resp")"
CID="$(docker compose -f /home/justinmiddler/apps/Ember/docker-compose.yml --env-file /home/justinmiddler/apps/Ember/.env ps -q control-plane)"
NAS_DIR="${EMBER_BACKUP_NAS_DIR:-/home/justinmiddler/apps/Ember/backups-nas}"
mkdir -p "$NAS_DIR"
tmp="/tmp/$(basename "$path")"
docker cp "$CID:$path" "$tmp"
cp -a "$tmp" "$NAS_DIR/"
rm -f "$tmp"
echo "copied to $NAS_DIR/$(basename "$path")"
WRAP
sudo chmod 755 /usr/local/bin/ember-backup-homelab.sh
sudo sed -i 's|ExecStart=.*|ExecStart=/usr/local/bin/ember-backup-homelab.sh|' /etc/systemd/system/ember-backup.service
sudo systemctl daemon-reload
sudo systemctl enable --now ember-backup.timer
systemctl list-timers ember-backup.timer --no-pager || true

# --- restore drill ---
log "restore drill (swap live DB with just-taken backup)"
pre_users=$(curl -fsS -b "$COOKIE_JAR" "$CP_URL/api/auth/session" | python3 -c 'import json,sys; print(json.load(sys.stdin)["user"]["email"])')
docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$REMOTE_DIR/.env" stop control-plane
docker run --rm \
  -v ember_ember-db:/data \
  -v "$BACKUP_NAS:/bak:ro" \
  alpine sh -c "cp -a /data/ember.db /data/ember.db.pre-restore && cp -a /bak/$(basename "$host_bak") /data/ember.db && chown 10001:10001 /data/ember.db"
docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$REMOTE_DIR/.env" start control-plane
for i in $(seq 1 40); do
  curl -fsS "$CP_URL/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "$CP_URL/api/health"; echo
post=$(curl -fsS -c "$COOKIE_JAR" -X POST "$CP_URL/api/auth/login" \
  -H 'content-type: application/json' \
  -d "$(python3 -c "import json; print(json.dumps({'email':'''$EMAIL''','password':'''$PASSWORD'''}))")")
echo "$post" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("authenticated"); print("post-restore login:", d["user"]["email"])'
post_users=$(echo "$post" | python3 -c 'import json,sys; print(json.load(sys.stdin)["user"]["email"])')
[[ "$pre_users" == "$post_users" ]] || die "restore login email mismatch"
docker compose -f "$COMPOSE_DIR/docker-compose.yml" --env-file "$REMOTE_DIR/.env" up -d
curl -fsS -o /dev/null -w "web login page %{http_code}\n" "$WEB_URL/login"

# --- TLS edge (Kelpie :443, Tailscale :8443 — use 32443/32088) ---
log "start Ember TLS edge on localhost:32443 / :32088"
cd "$REMOTE_DIR/deploy/caddy"
docker compose -f docker-compose.edge.yml up -d
sleep 3
docker ps --filter name=ember-edge --format '{{.Names}} {{.Status}}'
code_tls=$(curl -sk -o /dev/null -w '%{http_code}' https://localhost:32443/login || true)
code_http=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:32088/login || true)
health_tls=$(curl -sk -o /dev/null -w '%{http_code}' https://localhost:32443/api/health || true)
echo "edge https login=$code_tls http login=$code_http https health=$health_tls"
[[ "$code_tls" == "200" && "$code_http" == "200" && "$health_tls" == "200" ]] || die "edge proxy failed"

# --- invite accept smoke (second user on same tenant) ---
log "invite accept smoke"
inv_email="phase-a-$(date +%s)@ember.e2e"
inv=$(curl -fsS -b "$COOKIE_JAR" -X POST "$CP_URL/api/tenants/current/invitations" \
  -H 'content-type: application/json' \
  -d "$(python3 -c "import json; print(json.dumps({'email':'''$inv_email''','role':'operator'}))")")
echo "$inv" | python3 -m json.tool | head -20
inv_url=$(echo "$inv" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("invite_url") or "")')
inv_token=$(python3 -c "from urllib.parse import urlparse,parse_qs; u=urlparse('''$inv_url'''); print(parse_qs(u.query).get('token',[''])[0])")
[[ -n "$inv_token" ]] || die "no invite token"
preview=$(curl -fsS "$CP_URL/api/invitations/preview?token=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$inv_token'''))")")
echo "$preview" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["email"]; print("preview", d["email"], d["role"])'
accept=$(curl -fsS -c /tmp/ember-invitee.cookies -X POST "$CP_URL/api/invitations/accept" \
  -H 'content-type: application/json' \
  -d "$(python3 -c "import json; print(json.dumps({'token':'''$inv_token''','name':'Phase A Invitee','password':'phase-a-invitee-99'}))")")
echo "$accept" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("authenticated"); print("invitee", d["user"]["email"], d["active_tenant"]["role"])'

# --- final summary checks ---
log "final verification matrix"
export CP_URL WEB_URL PET_PORT EMAIL PASSWORD PET_NAME
python3 - <<'PY'
import json, subprocess, os, urllib.request, http.cookiejar, ssl

cp = os.environ.get("CP_URL", "http://127.0.0.1:8080")
web = os.environ.get("WEB_URL", "http://127.0.0.1:3200")
pet = os.environ.get("PET_PORT", "8089")
email = os.environ.get("EMAIL", "owner@ember.e2e")
password = os.environ.get("PASSWORD", "ember-e2e-password-1")

def get(url, headers=None, insecure=False):
    ctx = ssl._create_unverified_context() if insecure else None
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        return r.status, r.read()

checks = []
def ok(name, cond, detail=""):
    checks.append((name, bool(cond), detail))
    print(("PASS" if cond else "FAIL"), name, detail)

# health
st, body = get(f"{cp}/api/health")
ok("cp_health", st == 200, body.decode()[:80])

# login
import urllib.request
req = urllib.request.Request(
    f"{cp}/api/auth/login",
    data=json.dumps({"email": email, "password": password}).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
# cookie jar
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
with opener.open(req, timeout=10) as r:
    sess = json.load(r)
ok("login", sess.get("authenticated"), sess.get("user", {}).get("email", ""))

cookie = "; ".join(f"{c.name}={c.value}" for c in cj)
hdr = {"cookie": cookie}

st, body = get(f"{cp}/api/hosts", hdr)
hosts = json.loads(body)
ok("hosts_enrolled", len(hosts) >= 1, f"n={len(hosts)}")

st, body = get(f"{cp}/api/workloads", hdr)
wls = json.loads(body)
pet_w = [w for w in wls if w.get("name") == os.environ.get("PET_NAME", "ember-pet-nginx")]
ok("pet_workload", len(pet_w) >= 1, pet_w[0].get("observed_state", "") if pet_w else "missing")

try:
    st, _ = get(f"http://127.0.0.1:{pet}/")
    ok("pet_http", st == 200)
except Exception as e:
    ok("pet_http", False, str(e))

try:
    st, _ = get("https://localhost:32443/login", insecure=True)
    ok("tls_edge_login", st == 200)
except Exception as e:
    ok("tls_edge_login", False, str(e))

try:
    st, _ = get("https://localhost:32443/api/health", insecure=True)
    ok("tls_edge_api", st == 200)
except Exception as e:
    ok("tls_edge_api", False, str(e))

try:
    st, _ = get("http://127.0.0.1:32088/login")
    ok("http_edge_login", st == 200)
except Exception as e:
    ok("http_edge_login", False, str(e))

agent = subprocess.run(["systemctl", "is-active", "ember-agent"], capture_output=True, text=True)
ok("agent_systemd", agent.stdout.strip() == "active", agent.stdout.strip())

timer = subprocess.run(["systemctl", "is-active", "ember-backup.timer"], capture_output=True, text=True)
ok("backup_timer", timer.stdout.strip() == "active", timer.stdout.strip())

failed = [n for n,c,_ in checks if not c]
print("---")
print(f"{len(checks)-len(failed)}/{len(checks)} checks passed")
if failed:
    raise SystemExit(f"failed: {failed}")
print("PHASE_A_OK")
PY

log "done"
REMOTE_EOF
