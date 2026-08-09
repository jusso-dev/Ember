# Ember e2e

Lightpanda + Playwright Test coverage for the flows described in the root `README.md`.

## Layout

| Path | Role |
| --- | --- |
| `tests/api/` | Playwright `request` client — control plane + Next `/api/*` proxy |
| `tests/browser/` | Lightpanda CDP via Puppeteer (same CDP server Playwright would use) |
| `helpers/stack.ts` | Starts control plane + Next.js with an isolated SQLite DB |
| `fixtures.ts` | Per-test Lightpanda process + authenticated page helpers |
| `scripts/e2e.sh` (repo root) | Build deps and run the suite |

## Why Puppeteer for the browser project?

`@playwright/test` still orchestrates the suite (reporters, projects, retries, HTML report).

Browser automation talks to **Lightpanda** over CDP with **puppeteer-core**, because Playwright’s `chromium.connectOverCDP` currently times out on navigation against local Lightpanda builds. Puppeteer is the client Lightpanda documents first and works for this stack.

Lightpanda must be started **in the same process** as the Puppeteer client (worker fixture). Spawning it only in Playwright `globalSetup` leaves a half-dead CDP server after that process exits.

## Run

```bash
# From repo root
bash scripts/e2e.sh

# API only
(cd e2e && pnpm test:api)

# Browser (Lightpanda) only
(cd e2e && pnpm test:browser)

# Optional Docker agent path from the README
E2E_AGENT_FLOW=1 bash scripts/e2e.sh
```

## Env

| Variable | Meaning |
| --- | --- |
| `E2E_CP_PORT` / `E2E_WEB_PORT` / `E2E_CDP_PORT` | Default 18080 / 13000 / 19222 |
| `E2E_WEB_MODE=prod` | Use `next start` after build |
| `E2E_EXTERNAL_STACK=1` | Do not start CP/web; use existing URLs |
| `LPD_TOKEN` / `CDP_WS_URL` | Lightpanda Cloud instead of local binary |
| `E2E_AGENT_FLOW=1` | Run enroll + volume + nginx workload path |
