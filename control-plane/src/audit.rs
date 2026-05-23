use crate::auth::AdminSession;
use crate::state::AppState;
use axum::http::HeaderMap;
use serde_json::Value;

pub const RESULT_SUCCESS: &str = "success";
pub const RESULT_FAILURE: &str = "failure";

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
    let details_json = details.map(|v| v.to_string());
    let res = sqlx::query(
        "INSERT INTO audit_logs (
            actor_user_id, actor_email, actor_tenant_id,
            action, resource_type, resource_id, result,
            ip_address, user_agent, details_json
         ) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(&actor.user_id)
    .bind(&actor.email)
    .bind(&actor.tenant_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(result)
    .bind(&actor.ip_address)
    .bind(&actor.user_agent)
    .bind(details_json)
    .execute(&state.pool)
    .await;
    if let Err(e) = res {
        tracing::error!(error = ?e, action = %action, "audit log insert failed");
    }
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
