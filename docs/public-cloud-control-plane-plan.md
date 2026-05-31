# Ember Public Cloud Control Plane Plan

## Research Basis

Public cloud control planes share a small set of durable patterns:

- Hierarchical scope: organization, folders/subscriptions/accounts/projects, regions, resources. Google Cloud documents this as an organization-to-folder-to-project resource hierarchy; Azure landing zones use management groups, subscriptions, policy, identity, networking, and monitoring as design areas.
- Vending paths: AWS Control Tower Account Factory turns account creation into a governed workflow. Ember should use the same shape for host enrollment, workload launch, storage provisioning, and future account/project vending.
- Guardrails and policy inheritance: AWS Control Tower controls, Azure Policy, and Google Organization Policy all separate resource creation from policy checks.
- Evidence plane: NIST SP 800-92 and OWASP logging guidance point to audit integrity, retention, reviewability, and off-platform forwarding as core requirements, not polish.
- Telemetry interoperability: OpenTelemetry and OTLP are the modern path for logs/traces/metrics export; SIEM/webhook/file/syslog paths are still needed for customer environments.

Primary references:

- AWS Control Tower controls: https://docs.aws.amazon.com/controltower/latest/controlreference/controls.html
- AWS Account Factory: https://docs.aws.amazon.com/controltower/latest/userguide/account-factory.html
- Azure landing zones: https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/
- Azure Policy overview: https://learn.microsoft.com/en-us/azure/governance/policy/overview
- Google Cloud resource hierarchy: https://cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy
- Google Cloud Asset Inventory: https://cloud.google.com/asset-inventory/docs/overview
- OpenTelemetry logs: https://opentelemetry.io/docs/concepts/signals/logs/
- NIST SP 800-92: https://csrc.nist.gov/pubs/sp/800/92/final
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

## Product Direction

Ember should feel like a compact public cloud foundation, not just a Docker dashboard:

- **Cloud foundation page**: one operator view for landing-zone hierarchy, guardrail posture, provisioning lanes, and evidence-plane health.
- **Tenant-scoped resources**: hosts, volumes, workloads, events, workload logs, agent logs, and control-plane logs resolve through the active tenant.
- **Evidence by default**: sensitive reads are audited, mutation details include safe before-state diffs, audit rows are hash chained, exports are rate limited, and verification is one click.
- **Log control plane**: pull for backfill, SSE for follow mode, stored logs for post-mortems, and explicit caps for concurrency and payload size.
- **External security integration**: audit rows can flow to file/syslog sinks and signed webhooks. OTLP remains the next production export layer for full tracing/log signal parity.

## Issue Execution Map

- #3 Stream workload logs: add `StreamContainerLogs` and `CancelLogStream`, control-plane SSE endpoint, agent follow task, stream cleanup, and stored chunk persistence.
- #4 Persist workload logs: add `workload_logs` plus FTS table/triggers, persist live/pull lines, expose stored query filters, and add UI source/date controls.
- #5 Persist control-plane logs: add bounded tracing persistence channel, `control_plane_logs`, stored query filters, and retention pruning.
- #6 Host agent logs: add `AgentLogs` protocol, `agent_logs` table, host log API, tenant scoping, and crash event surfacing.
- #7 Audit coverage: record sensitive reads, denied access attempts, export/verify actions, and workload before snapshots without secret values.
- #8 Tamper-evident audit and retention: add `prev_hash`/`row_hash`, serialized audit writer, verifier API, tenant retention, and prune audit rows.
- #9 External sinks: add `EMBER_AUDIT_SINK` for DB/file/syslog, webhook tables, signed webhook delivery worker, and Access UI management.
- #10 Tenant-scoped logs/resources: add tenant IDs and filters to hosts, volumes, workloads, events, logs, and enrollment tokens.
- #11 Audit export/date/pagination: add date range, cursor pagination, CSV/JSONL export, export rate limit, and UI controls.
- #12 Log fetch limits: add per-host semaphore, per-user fixed-window request budget, 4 MiB response cap, agent-side semaphore, and agent tail validation.

## Remaining Hardening Targets

- Add first-class OTLP wiring with `tracing-opentelemetry` for control-plane and agent spans/logs.
- Replace the current fixed-window limiter with a distributed token bucket before multi-replica deployment.
- Add a policy engine abstraction for placement and workload admission once Ember supports more than host-local Docker.
- Add integration tests that create two tenants and verify cross-tenant 404s for every resource/log path.
