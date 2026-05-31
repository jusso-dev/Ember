-- Cloud control-plane foundation: tenant isolation, durable logs, audit
-- integrity, and external audit delivery metadata.

ALTER TABLE tenants ADD COLUMN audit_retention_days INTEGER;

ALTER TABLE enrollment_tokens ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE hosts ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE volumes ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE workloads ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;

UPDATE enrollment_tokens
SET tenant_id = (SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1)
WHERE tenant_id IS NULL;

UPDATE hosts
SET tenant_id = (SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1)
WHERE tenant_id IS NULL;

UPDATE volumes
SET tenant_id = (SELECT tenant_id FROM hosts WHERE hosts.id = volumes.host_id)
WHERE tenant_id IS NULL;

UPDATE workloads
SET tenant_id = (SELECT tenant_id FROM hosts WHERE hosts.id = workloads.host_id)
WHERE tenant_id IS NULL;

UPDATE events
SET tenant_id = COALESCE(
  (SELECT tenant_id FROM workloads WHERE workloads.id = events.workload_id),
  (SELECT tenant_id FROM volumes WHERE volumes.id = events.volume_id),
  (SELECT tenant_id FROM hosts WHERE hosts.id = events.host_id),
  (SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1)
)
WHERE tenant_id IS NULL;

CREATE INDEX enrollment_tokens_tenant ON enrollment_tokens(tenant_id);
CREATE INDEX hosts_tenant ON hosts(tenant_id, status);
CREATE INDEX volumes_tenant ON volumes(tenant_id, status);
CREATE INDEX workloads_tenant ON workloads(tenant_id, observed_state);
CREATE INDEX events_tenant_ts ON events(tenant_id, ts DESC);

ALTER TABLE audit_logs ADD COLUMN prev_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000';
ALTER TABLE audit_logs ADD COLUMN row_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000';
CREATE INDEX audit_logs_tenant_id ON audit_logs(actor_tenant_id, id DESC);

CREATE TABLE control_plane_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TIMESTAMP NOT NULL,
  level       TEXT NOT NULL,
  target      TEXT NOT NULL,
  message     TEXT NOT NULL,
  fields_json TEXT,
  tenant_id   TEXT REFERENCES tenants(id) ON DELETE SET NULL
);
CREATE INDEX control_plane_logs_ts ON control_plane_logs(ts DESC);
CREATE INDEX control_plane_logs_tenant_ts ON control_plane_logs(tenant_id, ts DESC);
CREATE INDEX control_plane_logs_level_ts ON control_plane_logs(level, ts DESC);

CREATE TABLE workload_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  workload_id TEXT NOT NULL,
  host_id     TEXT NOT NULL,
  ts          TIMESTAMP NOT NULL,
  stream      TEXT NOT NULL,
  message     TEXT NOT NULL
);
CREATE INDEX workload_logs_workload_ts ON workload_logs(workload_id, ts DESC);
CREATE INDEX workload_logs_tenant_ts ON workload_logs(tenant_id, ts DESC);
CREATE INDEX workload_logs_host_ts ON workload_logs(host_id, ts DESC);

CREATE VIRTUAL TABLE workload_logs_fts USING fts5(
  message,
  content='workload_logs',
  content_rowid='id'
);

CREATE TRIGGER workload_logs_ai AFTER INSERT ON workload_logs BEGIN
  INSERT INTO workload_logs_fts(rowid, message) VALUES (new.id, new.message);
END;

CREATE TRIGGER workload_logs_ad AFTER DELETE ON workload_logs BEGIN
  INSERT INTO workload_logs_fts(workload_logs_fts, rowid, message)
  VALUES('delete', old.id, old.message);
END;

CREATE TRIGGER workload_logs_au AFTER UPDATE ON workload_logs BEGIN
  INSERT INTO workload_logs_fts(workload_logs_fts, rowid, message)
  VALUES('delete', old.id, old.message);
  INSERT INTO workload_logs_fts(rowid, message) VALUES (new.id, new.message);
END;

CREATE TABLE agent_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  host_id   TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  ts        TIMESTAMP NOT NULL,
  level     TEXT NOT NULL,
  target    TEXT NOT NULL,
  message   TEXT NOT NULL
);
CREATE INDEX agent_logs_host_ts ON agent_logs(host_id, ts DESC);
CREATE INDEX agent_logs_tenant_ts ON agent_logs(tenant_id, ts DESC);
CREATE INDEX agent_logs_level_ts ON agent_logs(level, ts DESC);

CREATE TABLE audit_webhooks (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  secret_hash       TEXT NOT NULL,
  event_filter_json TEXT NOT NULL DEFAULT '[]',
  last_delivered_at TIMESTAMP,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_webhooks_tenant ON audit_webhooks(tenant_id);

CREATE TABLE audit_webhook_deliveries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id     TEXT NOT NULL REFERENCES audit_webhooks(id) ON DELETE CASCADE,
  audit_log_id   INTEGER NOT NULL REFERENCES audit_logs(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending',
  attempts       INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error     TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(webhook_id, audit_log_id)
);
CREATE INDEX audit_webhook_deliveries_due ON audit_webhook_deliveries(status, next_attempt_at);
