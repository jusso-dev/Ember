# Dev setup

## Prereqs

- Rust stable (pinned in `rust-toolchain.toml`)
- Node 22+ with `pnpm`
- Docker (only needed for Milestone 3+ when the agent actually runs containers)

## First run

```bash
# 1. Generate TS types from the shared Rust crate.
cargo test -p ember-shared

# 2. Install web deps.
(cd web && pnpm install)

# 3. Start control-plane + web together.
bash scripts/dev.sh
```

Open <http://localhost:3000>. The dashboard fetches `/api/health` (rewritten to `http://127.0.0.1:8080`) and shows `status: ok`.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `EMBER_BIND_ADDR` | `127.0.0.1:8080` | Control-plane bind address |
| `EMBER_DB_URL` | `sqlite://ember.db?mode=rwc` | SQLite file, created on first boot |
| `EMBER_ADMIN_PASSWORD` | _(unset)_ | Required for admin login (Milestone 2+) |
| `CONTROL_PLANE_URL` | `http://127.0.0.1:8080` | Where Next.js proxies `/api/*` |

## Useful commands

```bash
# Build everything.
cargo build --workspace

# Run just the control-plane.
cargo run -p ember-control-plane

# Inspect the DB.
sqlite3 ember.db ".tables"

# Regenerate TS types after changing shared/.
cargo test -p ember-shared
```
