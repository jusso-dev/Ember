use crate::auth::AdminSession;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::AuditLogRow;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct AuditQuery {
    pub action: Option<String>,
    pub actor_user_id: Option<String>,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub result: Option<String>,
    pub limit: Option<i64>,
    pub since: Option<String>,
}

pub async fn list(
    admin: AdminSession,
    State(state): State<AppState>,
    Query(q): Query<AuditQuery>,
) -> Result<Json<Vec<AuditLogRow>>, AppError> {
    let limit = q.limit.unwrap_or(200).clamp(1, 2000);
    let since: Option<DateTime<Utc>> = q
        .since
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc)));

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
    )> = sqlx::query_as(
        "SELECT id, ts, actor_user_id, actor_email, actor_tenant_id, action, \
                resource_type, resource_id, result, ip_address, user_agent, details_json \
         FROM audit_logs \
         WHERE (actor_tenant_id IS NULL OR actor_tenant_id = ?) \
           AND (? IS NULL OR action = ?) \
           AND (? IS NULL OR actor_user_id = ?) \
           AND (? IS NULL OR resource_type = ?) \
           AND (? IS NULL OR resource_id = ?) \
           AND (? IS NULL OR result = ?) \
           AND (? IS NULL OR ts >= ?) \
         ORDER BY id DESC \
         LIMIT ?",
    )
    .bind(&admin.tenant.id)
    .bind(&q.action)
    .bind(&q.action)
    .bind(&q.actor_user_id)
    .bind(&q.actor_user_id)
    .bind(&q.resource_type)
    .bind(&q.resource_type)
    .bind(&q.resource_id)
    .bind(&q.resource_id)
    .bind(&q.result)
    .bind(&q.result)
    .bind(since)
    .bind(since)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    let out = rows
        .into_iter()
        .map(|t| AuditLogRow {
            id: t.0,
            ts: t.1.to_rfc3339(),
            actor_user_id: t.2,
            actor_email: t.3,
            actor_tenant_id: t.4,
            action: t.5,
            resource_type: t.6,
            resource_id: t.7,
            result: t.8,
            ip_address: t.9,
            user_agent: t.10,
            details: t.11,
        })
        .collect();
    Ok(Json(out))
}
