use crate::auth::AdminSession;
use crate::state::AppState;
use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use ember_shared::protocol::AuditVerifyResponse;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

pub const RESULT_SUCCESS: &str = "success";
pub const RESULT_FAILURE: &str = "failure";
pub const RESULT_DENIED: &str = "denied";
const ZERO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const MAX_DETAILS_BYTES: usize = 4096;

#[derive(Debug, Clone)]
pub struct AuditActor {
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub tenant_id: Option<String>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

impl AuditActor {
    pub fn from_admin(admin: &AdminSession, headers: &HeaderMap) -> Self {
        Self {
            user_id: Some(admin.user.id.clone()),
            email: Some(admin.user.email.clone()),
            tenant_id: Some(admin.tenant.id.clone()),
            ip_address: client_ip(headers),
            user_agent: user_agent(headers),
        }
    }

    pub fn anonymous(headers: &HeaderMap) -> Self {
        Self {
            user_id: None,
            email: None,
            tenant_id: None,
            ip_address: client_ip(headers),
            user_agent: user_agent(headers),
        }
    }

    pub fn with_email(mut self, email: impl Into<String>) -> Self {
        self.email = Some(email.into());
        self
    }

    pub fn with_user_id(mut self, user_id: impl Into<String>) -> Self {
        self.user_id = Some(user_id.into());
        self
    }

    pub fn with_tenant_id(mut self, tenant_id: impl Into<String>) -> Self {
        self.tenant_id = Some(tenant_id.into());
        self
    }
}

pub async fn record(
    state: &AppState,
    actor: &AuditActor,
    action: &str,
    resource_type: Option<&str>,
    resource_id: Option<&str>,
    result: &str,
    details: Option<Value>,
) {
    let _chain = state.audit_chain_lock.lock().await;
    let ts = Utc::now();
    let details_json = details.map(|v| cap_details(v.to_string()));
    let prev_hash: String = match sqlx::query_as::<_, (String,)>(
        "SELECT row_hash FROM audit_logs ORDER BY id DESC LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some((hash,))) => hash,
        Ok(None) => ZERO_HASH.into(),
        Err(e) => {
            tracing::error!(error = ?e, action = %action, "audit previous hash lookup failed");
            ZERO_HASH.into()
        }
    };
    let row_hash = row_hash(
        &prev_hash,
        &AuditHashFields {
            ts,
            actor_user_id: actor.user_id.as_deref(),
            actor_email: actor.email.as_deref(),
            actor_tenant_id: actor.tenant_id.as_deref(),
            action,
            resource_type,
            resource_id,
            result,
            ip_address: actor.ip_address.as_deref(),
            user_agent: actor.user_agent.as_deref(),
            details_json: details_json.as_deref(),
        },
    );

    let res = sqlx::query(
        "INSERT INTO audit_logs (
            ts,
            actor_user_id, actor_email, actor_tenant_id,
            action, resource_type, resource_id, result,
            ip_address, user_agent, details_json,
            prev_hash, row_hash
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(ts)
    .bind(&actor.user_id)
    .bind(&actor.email)
    .bind(&actor.tenant_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(result)
    .bind(&actor.ip_address)
    .bind(&actor.user_agent)
    .bind(&details_json)
    .bind(&prev_hash)
    .bind(&row_hash)
    .execute(&state.pool)
    .await;

    match res {
        Ok(done) => {
            let row_id = done.last_insert_rowid();
            queue_webhook_deliveries(state, row_id, actor.tenant_id.as_deref(), action).await;
            write_external_sinks(
                state,
                row_id,
                &AuditHashFields {
                    ts,
                    actor_user_id: actor.user_id.as_deref(),
                    actor_email: actor.email.as_deref(),
                    actor_tenant_id: actor.tenant_id.as_deref(),
                    action,
                    resource_type,
                    resource_id,
                    result,
                    ip_address: actor.ip_address.as_deref(),
                    user_agent: actor.user_agent.as_deref(),
                    details_json: details_json.as_deref(),
                },
                &prev_hash,
                &row_hash,
            )
            .await;
        }
        Err(e) => {
            tracing::error!(error = ?e, action = %action, "audit log insert failed");
        }
    }
}

pub async fn verify(state: &AppState, _tenant_id: &str) -> anyhow::Result<AuditVerifyResponse> {
    let rows: Vec<(
        i64,
        DateTime<Utc>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
    )> = sqlx::query_as(
        "SELECT id, ts, actor_user_id, actor_email, actor_tenant_id, action, \
                resource_type, resource_id, result, ip_address, user_agent, details_json, \
                prev_hash, row_hash \
         FROM audit_logs \
         ORDER BY id ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    let mut expected_prev = ZERO_HASH.to_string();
    let mut last_verified_id = None;
    let mut first = true;
    for row in rows {
        let fields = AuditHashFields {
            ts: row.1,
            actor_user_id: row.2.as_deref(),
            actor_email: row.3.as_deref(),
            actor_tenant_id: row.4.as_deref(),
            action: &row.5,
            resource_type: row.6.as_deref(),
            resource_id: row.7.as_deref(),
            result: &row.8,
            ip_address: row.9.as_deref(),
            user_agent: row.10.as_deref(),
            details_json: row.11.as_deref(),
        };
        let computed = row_hash(&row.12, &fields);
        if first {
            expected_prev = row.12.clone();
            first = false;
        }
        if row.12 != expected_prev || computed != row.13 {
            return Ok(AuditVerifyResponse {
                verified: false,
                last_verified_id,
                first_bad_id: Some(row.0),
            });
        }
        expected_prev = row.13;
        last_verified_id = Some(row.0);
    }

    Ok(AuditVerifyResponse {
        verified: true,
        last_verified_id,
        first_bad_id: None,
    })
}

struct AuditHashFields<'a> {
    ts: DateTime<Utc>,
    actor_user_id: Option<&'a str>,
    actor_email: Option<&'a str>,
    actor_tenant_id: Option<&'a str>,
    action: &'a str,
    resource_type: Option<&'a str>,
    resource_id: Option<&'a str>,
    result: &'a str,
    ip_address: Option<&'a str>,
    user_agent: Option<&'a str>,
    details_json: Option<&'a str>,
}

fn row_hash(prev_hash: &str, fields: &AuditHashFields<'_>) -> String {
    let canonical = json!({
        "ts": fields.ts.to_rfc3339(),
        "actor_user_id": fields.actor_user_id,
        "actor_email": fields.actor_email,
        "actor_tenant_id": fields.actor_tenant_id,
        "action": fields.action,
        "resource_type": fields.resource_type,
        "resource_id": fields.resource_id,
        "result": fields.result,
        "ip_address": fields.ip_address,
        "user_agent": fields.user_agent,
        "details_json": fields.details_json,
    })
    .to_string();
    let mut hasher = Sha256::new();
    hasher.update(prev_hash.as_bytes());
    hasher.update(canonical.as_bytes());
    hex::encode(hasher.finalize())
}

fn cap_details(value: String) -> String {
    if value.len() <= MAX_DETAILS_BYTES {
        return value;
    }

    let mut end = MAX_DETAILS_BYTES.saturating_sub(24);
    while !value.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    format!("{}...[truncated]", &value[..end])
}

async fn queue_webhook_deliveries(
    state: &AppState,
    row_id: i64,
    tenant_id: Option<&str>,
    action: &str,
) {
    let Some(tenant_id) = tenant_id else { return };
    let webhooks: Vec<(String, String)> = match sqlx::query_as(
        "SELECT id, event_filter_json FROM audit_webhooks WHERE tenant_id = ?",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = ?e, "audit webhook lookup failed");
            return;
        }
    };

    for (webhook_id, filter_json) in webhooks {
        let actions: Vec<String> = serde_json::from_str(&filter_json).unwrap_or_default();
        if !actions.is_empty() && !actions.iter().any(|candidate| candidate == action) {
            continue;
        }
        if let Err(e) = sqlx::query(
            "INSERT OR IGNORE INTO audit_webhook_deliveries (webhook_id, audit_log_id) VALUES (?, ?)",
        )
        .bind(&webhook_id)
        .bind(row_id)
        .execute(&state.pool)
        .await
        {
            tracing::error!(error = ?e, webhook_id = %webhook_id, "audit webhook delivery enqueue failed");
        }
    }
}

async fn write_external_sinks(
    state: &AppState,
    row_id: i64,
    fields: &AuditHashFields<'_>,
    prev_hash: &str,
    row_hash: &str,
) {
    let payload = json!({
        "id": row_id,
        "ts": fields.ts.to_rfc3339(),
        "actor_user_id": fields.actor_user_id,
        "actor_email": fields.actor_email,
        "actor_tenant_id": fields.actor_tenant_id,
        "action": fields.action,
        "resource_type": fields.resource_type,
        "resource_id": fields.resource_id,
        "result": fields.result,
        "ip_address": fields.ip_address,
        "user_agent": fields.user_agent,
        "details_json": fields.details_json,
        "prev_hash": prev_hash,
        "row_hash": row_hash,
    });

    for sink in &state.config.audit_sinks {
        if sink == "db" {
            continue;
        }
        if let Some(path) = sink.strip_prefix("file://") {
            if let Err(e) = append_jsonl(path, &payload).await {
                tracing::error!(error = ?e, sink = %sink, "audit file sink failed");
            }
        } else if let Some(addr) = sink.strip_prefix("syslog://") {
            if let Err(e) = send_syslog(addr, &payload).await {
                tracing::error!(error = ?e, sink = %sink, "audit syslog sink failed");
            }
        }
    }
}

async fn append_jsonl(path: &str, payload: &Value) -> anyhow::Result<()> {
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(payload.to_string().as_bytes()).await?;
    file.write_all(b"\n").await?;
    Ok(())
}

async fn send_syslog(addr: &str, payload: &Value) -> anyhow::Result<()> {
    let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await?;
    let line = format!(
        "<134>1 {} ember-control-plane audit - - - {}",
        Utc::now().to_rfc3339(),
        payload
    );
    socket.send_to(line.as_bytes(), addr).await?;
    Ok(())
}

fn client_ip(h: &HeaderMap) -> Option<String> {
    if let Some(value) = h.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = value.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    if let Some(value) = h.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

fn user_agent(h: &HeaderMap) -> Option<String> {
    h.get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}
