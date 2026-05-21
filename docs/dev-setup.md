# Dev setup

## Prereqs

- Rust stable (pinned in `rust-toolchain.toml`)
- Node 22+ with `pnpm`
- Docker — only needed on hosts running the `ember-agent` (the control plane itself does not need it)

## First run

```bash
# 1. Generate TS types from the shared Rust crate.
cargo test -p ember-shared

# 2. Install web deps.
(cd web && pnpm install)

# 3. Start control-plane + web together.
bash scripts/dev.sh
```

Open <http://localhost:3000>. Default admin password is `hunter2`
(override with `EMBER_ADMIN_PASSWORD=...` before running `dev.sh`).

## Try the whole flow locally

You need Docker on your dev box (for the agent to start containers) and the
control plane running. In a separate terminal:

```bash
cargo build -p ember-agent

# Mint an enrollment token in the UI (Hosts → Add host), copy it, then:
EMBER_AGENT_STATE_DIR=/tmp/ember-agent-dev1 \
EMBER_VOLUMES_DIR=/tmp/ember-volumes-dev1 \
  ./target/debug/ember-agent enroll \
    --server http://127.0.0.1:8080 \
    --token <TOKEN> \
    --name dev-1

EMBER_AGENT_STATE_DIR=/tmp/ember-agent-dev1 \
EMBER_VOLUMES_DIR=/tmp/ember-volumes-dev1 \
  ./target/debug/ember-agent run
```

Within a second or two the host shows **online** in the UI. From there:

1. **Volumes → New volume** — create a `hostdir` volume (e.g. `data`, 100 MB).
2. **Workloads → New workload** — image `nginx:alpine`, port `8081 → 80/tcp`,
   optionally attach the volume at `/usr/share/nginx/html`.
3. Browse <http://127.0.0.1:8081> to see nginx.
4. Stop / delete the workload from the UI; the container disappears on the host.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `EMBER_BIND_ADDR` | `127.0.0.1:8080` | Control-plane bind address |
| `EMBER_DB_URL` | `sqlite://ember.db?mode=rwc` | SQLite file, created on first boot |
| `EMBER_ADMIN_PASSWORD` | _(unset)_ | If unset, login is disabled |
| `EMBER_PUBLIC_BASE_URL` | `http://127.0.0.1:8080` | Used in the suggested `install.sh` curl command |
| `CONTROL_PLANE_URL` | `http://127.0.0.1:8080` | Where Next.js proxies `/api/*` |
| `EMBER_AGENT_STATE_DIR` | `/var/lib/ember-agent` | Agent state file location |
| `EMBER_VOLUMES_DIR` | `/var/lib/ember/volumes` | Where the agent creates `hostdir` volumes |

## Useful commands

```bash
cargo build --workspace
cargo run -p ember-control-plane
cargo test -p ember-shared          # regenerate web/lib/types/*.ts
(cd web && pnpm dev)
```

## What's wired and what isn't (v1 status)

- Auth: single admin password, opaque session cookie. No user table.
- Compute: Docker containers via `bollard` on the host. Restart policy
  `unless-stopped`. Containers are labeled `ember.managed=true` and
  named `ember-<workload-id-prefix>`.
- Storage: `hostdir` backend (bind-mount a directory). `loopback_ext4`
  is wired in the protocol but not implemented in the agent yet — it
  needs root and `mount`.
- Live updates: UI polls every 2–3 seconds. No SSE / WebSocket
  push to the browser yet. No log streaming.
- Reconciler: every 10 s marks hosts offline after 45 s without heartbeat,
  and requeues `dispatched` tasks that have no result after 60 s.
- No agent auto-update, no TLS termination, no multi-tenancy.
