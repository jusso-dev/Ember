-- Audit log: durable record of "who did what" for the control plane.
-- Distinct from the existing `events` table which captures system-level
-- workload/volume state transitions. Audit rows are written from API
-- handlers and the agent enrollment flow.

CREATE TABLE audit_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email       TEXT,
  actor_tenant_id   TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  action            TEXT NOT NULL,
  resource_type     TEXT,
  resource_id       TEXT,
  result            TEXT NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  details_json      TEXT
);

CREATE INDEX audit_logs_ts ON audit_logs(ts DESC);
CREATE INDEX audit_logs_actor ON audit_logs(actor_user_id, ts DESC);
CREATE INDEX audit_logs_tenant ON audit_logs(actor_tenant_id, ts DESC);
CREATE INDEX audit_logs_action ON audit_logs(action, ts DESC);
CREATE INDEX audit_logs_resource ON audit_logs(resource_type, resource_id, ts DESC);
