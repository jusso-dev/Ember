# Dev setup

## Prereqs

- Rust stable, pinned in `rust-toolchain.toml`
- Node 22+ with `pnpm`
- Docker on hosts running `ember-agent`

## First run

```bash
cargo test -p ember-shared
(cd web && pnpm install)
bash scripts/dev.sh
```

Open <http://localhost:3000> on the development machine, or use the LAN URL printed by `scripts/dev.sh` from another machine on your network.

On first run, create the owner account and tenant in the web UI. There is no default admin password.

`scripts/dev.sh` binds:

- control plane: `0.0.0.0:8080`
- web: `0.0.0.0:3000`
- public base URL: `http://<host-lan-ip>:3000`

You can override the detected address with:

```bash
HOST_IP=192.168.1.50 bash scripts/dev.sh
```

## Try The Whole Flow Locally

You need Docker on the machine running the agent. With the control plane running:

```bash
cargo build -p ember-agent
```

Mint an enrollment token in the UI: `Hosts -> Add host`.

For another homelab machine, use the generated install command:

```bash
curl -fsSL http://<ember-host-ip>:3000/install.sh | sudo NAME=$(hostname) sh -s -- --server http://<ember-host-ip>:3000 --token <TOKEN>
```

For local development, enroll and run the agent manually:

```bash
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

Within a few seconds the host shows online in the UI. From there:

1. `Volumes -> New volume`: create a `hostdir` volume.
2. `Workloads -> New workload`: use image `nginx:alpine`, port `8081 -> 80/tcp`.
3. Browse <http://127.0.0.1:8081>.
4. Stop or delete the workload from the UI.

## Environment Variables

| Var | Default | Notes |
|---|---|---|
| `EMBER_BIND_ADDR` | `0.0.0.0:8080` | Control-plane bind address |
| `EMBER_DB_URL` | `sqlite://ember.db?mode=rwc` | SQLite file, created on first boot |
| `EMBER_PUBLIC_BASE_URL` | `http://<detected-lan-ip>:3000` | Used in generated invite and install links |
| `CONTROL_PLANE_URL` | `http://127.0.0.1:8080` | Where Next.js proxies `/api/*` |
| `HOST_IP` | auto-detected | Optional dev script LAN IP override |
| `EMBER_AGENT_STATE_DIR` | `/var/lib/ember-agent` | Agent state file location |
| `EMBER_VOLUMES_DIR` | `/var/lib/ember/volumes` | Where the agent creates `hostdir` volumes |

`EMBER_ADMIN_PASSWORD` is no longer used.

## Installer Script

The web app serves `web/public/install.sh` at `/install.sh`.

The script installs `ember-agent` using:

1. `EMBER_AGENT_BIN_URL`, when set to a prebuilt binary URL.
2. `cargo install --git https://github.com/jusso-dev/Ember.git ember-agent --locked --force --root /usr/local`, when Cargo is available.

There are no official prebuilt release artifacts yet, so the fallback path requires Rust/Cargo on the target host.

## Useful Commands

```bash
cargo build --workspace
cargo run -p ember-control-plane
cargo test -p ember-shared
(cd web && pnpm dev)
```

## What's Wired And What Isn't

- Auth: Rust-owned users, tenant memberships, invitations, opaque session cookies.
- Compute: Docker containers via `bollard` on the host.
- Storage: `hostdir` backend. `loopback_ext4` is wired in the protocol but not implemented in the agent yet.
- Live updates: UI polls every 2-3 seconds. No browser push yet.
- Reconciler: every 10 seconds marks hosts offline after 45 seconds without heartbeat, and requeues stale dispatched tasks after 60 seconds.
- No official prebuilt agent binary releases yet.
- No TLS termination. Use a reverse proxy for remote deployments.
