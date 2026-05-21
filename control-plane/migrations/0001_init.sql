PRAGMA foreign_keys = ON;

CREATE TABLE hosts (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  agent_token_hash  TEXT NOT NULL,
  os                TEXT,
  arch              TEXT,
  agent_version     TEXT,
  status            TEXT NOT NULL,
  last_seen_at      TIMESTAMP,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE enrollment_tokens (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE volumes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  host_id     TEXT NOT NULL REFERENCES hosts(id) ON DELETE RESTRICT,
  size_mb     INTEGER NOT NULL,
  backend     TEXT NOT NULL,
  host_path   TEXT,
  status      TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(host_id, name)
);

CREATE TABLE workloads (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  host_id         TEXT NOT NULL REFERENCES hosts(id) ON DELETE RESTRICT,
  image           TEXT NOT NULL,
  env_json        TEXT NOT NULL DEFAULT '{}',
  ports_json      TEXT NOT NULL DEFAULT '[]',
  command_json    TEXT,
  desired_state   TEXT NOT NULL,
  observed_state  TEXT NOT NULL,
  container_id    TEXT,
  last_error      TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(host_id, name)
);

CREATE TABLE workload_volumes (
  workload_id  TEXT NOT NULL REFERENCES workloads(id) ON DELETE CASCADE,
  volume_id    TEXT NOT NULL REFERENCES volumes(id) ON DELETE RESTRICT,
  mount_path   TEXT NOT NULL,
  read_only    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(workload_id, volume_id)
);

CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  host_id        TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  status         TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  result_json    TEXT,
  error          TEXT,
  workload_id    TEXT REFERENCES workloads(id) ON DELETE SET NULL,
  volume_id      TEXT REFERENCES volumes(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at  TIMESTAMP,
  finished_at    TIMESTAMP
);
CREATE INDEX tasks_host_status ON tasks(host_id, status);

CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  host_id      TEXT,
  workload_id  TEXT,
  volume_id    TEXT,
  kind         TEXT NOT NULL,
  message      TEXT NOT NULL,
  data_json    TEXT
);
CREATE INDEX events_workload_ts ON events(workload_id, ts DESC);
