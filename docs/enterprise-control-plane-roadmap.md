# Ember as a homelab enterprise control plane

Goal: use Ember as the **primary control plane for workloads** on your homelab — the shape of Azure Resource Manager + AWS Control Tower / ECS-ish ops, **without billing**.

## How Floci fits (and does not)

| | **Floci** (your homelab) | **Ember** |
| --- | --- | --- |
| Role | Cloud **API emulator** (LocalStack-class): S3/SQS/etc. on `:4566`, Azure-ish on `:4577` | Cloud **operations control plane** for hosts, volumes, containers |
| Customer | Apps that speak AWS/Azure SDKs | Operators who enroll machines and run workloads |
| Analogy | LocalStack / Azurite | Compact ARM + Control Tower + ECS/App Service surface |

Use them **together**: Floci for app-facing cloud APIs; Ember for “what runs where, who can touch it, prove it.”

---

## Capability map (Azure / AWS → Ember)

### Already strong enough for a serious homelab v1

| Enterprise pillar | Azure / AWS analogue | Ember today |
| --- | --- | --- |
| Identity | Entra ID / IAM users | Users, Argon2, sessions, first-run owner |
| Tenancy | Subscription / Account | Tenants, memberships, roles (owner→auditor) |
| Compute nodes | VM scale set / ECS capacity providers | Host enroll + agent WS + heartbeats |
| Workloads | Container Apps / ECS tasks | Desired-state containers (start/stop/remove) |
| Storage | Managed disks / EBS-ish | `hostdir` volumes + mounts |
| Control plane jobs | ARM deployments / Step Functions-lite | Durable task queue + reconciler |
| Audit / evidence | Activity Log / CloudTrail | Hash-chained audit, export CSV/JSONL, webhooks |
| Logs | Log Analytics / CloudWatch Logs | CP logs, workload logs, agent logs (pull + store) |
| Foundation UI | Landing zone portal | Cloud foundation page, role matrix, access UI |
| Ops packaging | Marketplace images | Docker compose, health, Trivy CI, e2e suite |

SQL already scopes **hosts / workloads / volumes / events / enrollment tokens** by `tenant_id` in the hot paths (README “not fully tenant-scoped” is partly stale — still need **cross-tenant e2e proof** and NOT NULL constraints).

---

### Gaps that block “enterprise cloud CP” feel (ordered for homelab ROI)

#### P0 — Must have before trusting as daily driver

| Gap | Azure / AWS | Why it matters | E2E to add |
| --- | --- | --- | --- |
| **Invite accept + join** | Guest invite / IAM user attach | Right now invites are create/revoke only | Invite → accept link → second user login → role-gated API |
| **MFA (TOTP + recovery)** | Conditional Access / MFA | Homelab on LAN still gets probed | Login requires TOTP after enable; recovery path |
| **Tenant isolation hard proof** | Subscription isolation | One bug = cross-tenant data leak | Two tenants, assert 404/403 on every resource ID |
| **TLS + reverse proxy recipe** | Front Door / ALB | Real remote agents need HTTPS cookies/tokens | Deploy profile: Caddy/Traefik + smoke |
| **Agent packages / versioning** | AMI / agent SSM | `cargo install --git` is not production | CI release binary + `install.sh` pin + version in UI |
| **Backup / restore SQLite** | RDS snapshot | One disk death loses the CP | Documented backup job + restore drill e2e |
| **Real agent e2e on homelab** | Always-on capacity | Without host online, CP is a dashboard | Enroll agent on `homelab` → volume → nginx → health |

#### P1 — Real control plane (placement, policy, multi-host)

| Gap | Azure / AWS | Notes | E2E |
| --- | --- | --- | --- |
| **Placement policy** | Scheduler / ASG | “Run on any online host with tag X / free mem” | Create workload without host_id → lands on eligible host |
| **Resource tags + filters** | Tags / Resource Graph | Essential for multi-app fleets | Tag filter on list APIs + UI |
| **Quotas / budgets (non-billing)** | Quota | Cap containers, ports, volume MB per tenant | Create beyond quota → 409 |
| **Admission policy** | Azure Policy / SCP | Deny `:latest`, force registry allowlist | Policy deny e2e |
| **Secrets injection** | Key Vault / Secrets Manager | Env from vault ref, never store plaintext in SQLite | Mount secret → container env present, DB redacted |
| **Image pull credentials** | ACR / ECR auth | Private registries | Pull private image succeeds |
| **Networks / publish policy** | VNet / security groups | Port publish allowlist, no random host binds | Deny high port e2e |
| **SSE / push updates** | Portal live blade | Replace 2–3s poll | UI updates on event without reload |
| **Log stream follow (SSE)** | Live log tail | Issue #3 style | Follow stream gets lines |

#### P2 — Multi-tenant SaaS-grade / multi-region shape

| Gap | Azure / AWS | Notes |
| --- | --- | --- |
| Org hierarchy | Management groups / OU | `org → tenant → env` |
| Multiple regions | Regions | Region label + agent affinity |
| HA control plane | Multi-AZ control plane | Postgres + multiple CP replicas + sticky agent routing |
| OTLP / metrics | App Insights / CloudWatch | Traces + RED metrics for CP and agents |
| GitOps / desired-state packages | Bicep / Terraform / App of Apps | `ember apply -f stack.yaml` |
| Blue/green & rollbacks | Deployment slots / ECS circuit breaker | Workload revision history |
| Host maintenance | Drain / cordon | `cordon host` → no new work; drain moves or stops |
| Catalog / marketplace | Marketplace | Approved image catalog UI |
| SCIM / OIDC SSO | Entra ID / Cognito | SSO for household or lab users |
| API keys + machine users | Service principals | CI deploys without browser session |
| Webhooks (inbound) | Event Grid | External systems push events |
| Compliance packs | CIS / landing zone baseline | Prebuilt policy packs |

#### P3 — Nice cloud theatre (skip until P0–P1 solid)

- Cost explorer UI without real billing (resource “spend” as CPU·hours estimate)
- Natural-language ops
- Full K8s backend (optional later; keep Docker as default)
- Multi-cloud agent (LXD, podman, firecracker)

---

## Target architecture (homelab production)

```text
                 ┌─────────────────────────────┐
  Browser ──────►│ Caddy/Traefik (TLS)          │
                 │  /  → ember-web              │
                 │  /api → ember-control-plane  │
                 └─────────────┬───────────────┘
                               │
                 ┌─────────────▼───────────────┐
                 │ Control plane (1+ replicas) │
                 │  SQLite→Postgres when HA    │
                 │  tasks, audit chain, RBAC   │
                 └─────────────┬───────────────┘
                               │ WSS agents
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
     agent@homelab        agent@NAS             agent@lab-PC
     Docker workloads     volumes               GPU box later

  Optional side-car: Floci (AWS/Azure API emulators) for app SDKs
```

**Hard rules for “enterprise” feel:**

1. Every mutating API is RBAC + tenant scoped + audited.
2. Desired state always reconcilable (agent offline → queue; online → converge).
3. Evidence plane: audit chain verify green; logs queryable after crash.
4. No secret plaintext in DB or audit diffs.
5. Install path is one command with pinned agent version.

---

## Phased delivery (recommended)

### Phase A — Homelab production baseline (1–2 weeks of focused work)

Ship A only → you can run real workloads daily.

1. **Agent release pipeline** — GitHub Release builds `ember-agent` (linux amd64/arm64); `install.sh` prefers release URL.
2. **TLS edge recipe** — `deploy/caddy` or Traefik labels; secure cookies when HTTPS.
3. **Invite accept flow** — complete membership lifecycle.
4. **MFA TOTP** — optional enforce for owner/admin.
5. **Backup** — nightly SQLite snapshot to NAS; restore runbook.
6. **Homelab agent always-on** — systemd unit on `homelab` (or agent container with docker.sock).
7. **E2E pack A**
   - Two-tenant isolation matrix (API).
   - Invite accept (API + browser).
   - Full agent path on homelab: enroll → volume → nginx:alpine → HTTP 200 → stop/delete.
   - Backup restore smoke (API).
   - Trivy remains gate on HIGH/CRITICAL.

### Phase B — Control plane intelligence

1. Placement (host selectors / tags).
2. Image allowlist + deny `:latest`.
3. Secrets refs (file- or vault-backed).
4. SSE for dashboard + log follow.
5. API tokens for CI (`ember deploy` from GitHub Actions on app repos).
6. **E2E pack B** — policy deny, placement, secret redaction, token auth.

### Phase C — Multi-node enterprise shape

1. Postgres mode + multi-CP.
2. OTLP export.
3. Org hierarchy + env (dev/stage/prod tenants).
4. Drain/cordon + revisioned deploys.
5. **E2E pack C** — multi-host failover of new placement; cross-env isolation.

---

## E2E strategy (enterprise-grade)

Keep three layers:

| Layer | Tool | Runs when |
| --- | --- | --- |
| Unit / contract | `cargo test`, shared `ts-rs` | Every PR |
| API e2e | Playwright request | Every PR + against homelab |
| Browser e2e | Lightpanda/Puppeteer | PR (isolated stack) + nightly on homelab |
| Chaos / agent | `E2E_AGENT_FLOW=1` on homelab | Nightly / pre-release |
| Security | Trivy fs + images | Every PR + weekly |

**New suites to add with each phase** (name them so CI stays readable):

```text
e2e/tests/api/tenant-isolation.spec.ts   # P0
e2e/tests/api/invites-accept.spec.ts     # P0
e2e/tests/api/mfa.spec.ts                # P0
e2e/tests/browser/agent-homelab.spec.ts  # P0 (homelab only)
e2e/tests/api/policy-admission.spec.ts   # P1
e2e/tests/api/placement.spec.ts          # P1
e2e/tests/api/secrets.spec.ts            # P1
```

**Implementation status (code):** Phase A + B APIs/UI/e2e/deploy recipes landed in-tree (migration `0007`, Security page, invite accept, MFA, policy, secrets, tokens, placement, SSE, Caddy/systemd/release workflow). Remaining ops: run agent 24/7, flip TLS, restore drill on real NAS, dual-tenant proof on live stack.

Success criteria for “I use this as my CP”:

- [ ] Agent online 24/7 on at least one host  
- [ ] HTTPS UI from LAN/Tailscale  
- [ ] Backup restored once for real  
- [ ] Two-tenant isolation e2e green  
- [ ] One “pet” app (nginx or real app) managed only through Ember for 7 days  

---

## Explicit non-goals (for now)

- Real billing / invoices / cost allocation to money  
- Full Kubernetes distribution  
- Pixel-perfect Azure Portal clone  
- Multi-cloud hypervisor support before Docker is excellent  

---

## Suggested next implementation slice

If you want maximum utility next, implement **Phase A in this order**:

1. systemd agent + release install path on `homelab`  
2. tenant isolation e2e matrix (prove what SQL already claims)  
3. invite accept  
4. MFA  
5. TLS edge + secure cookies  
6. SQLite backup cron  

Say which slice to start with (or “do all of Phase A”) and we implement + e2e it against the live homelab stack.
