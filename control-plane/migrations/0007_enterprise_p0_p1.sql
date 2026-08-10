-- P0/P1 enterprise control plane: MFA secret, recovery codes, API tokens,
-- policy, tags, secrets, registry credentials, host labels/cordon.
-- Note: users.mfa_enabled already exists from 0003_users.sql.

ALTER TABLE users ADD COLUMN mfa_secret TEXT;

CREATE TABLE mfa_recovery_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mfa_recovery_user ON mfa_recovery_codes(user_id);

CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  role         TEXT NOT NULL,
  expires_at   TIMESTAMP,
  last_used_at TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX api_tokens_tenant ON api_tokens(tenant_id);
CREATE INDEX api_tokens_hash ON api_tokens(token_hash);

CREATE TABLE tenant_policies (
  tenant_id              TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  deny_latest_tag        INTEGER NOT NULL DEFAULT 1,
  image_allowlist_json   TEXT NOT NULL DEFAULT '[]',
  max_workloads          INTEGER,
  max_volumes            INTEGER,
  max_volume_mb_total    INTEGER,
  allowed_host_ports_json TEXT NOT NULL DEFAULT '[]',
  require_mfa_admins     INTEGER NOT NULL DEFAULT 0,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE secrets (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  ciphertext   TEXT NOT NULL,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, name)
);
CREATE INDEX secrets_tenant ON secrets(tenant_id);

CREATE TABLE registry_credentials (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  registry        TEXT NOT NULL,
  username        TEXT NOT NULL,
  password_cipher TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, registry)
);

CREATE TABLE resource_tags (
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_id, key)
);
CREATE INDEX resource_tags_tenant_key ON resource_tags(tenant_id, key, value);

ALTER TABLE hosts ADD COLUMN labels_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE hosts ADD COLUMN cordoned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE workloads ADD COLUMN labels_json TEXT NOT NULL DEFAULT '{}';
