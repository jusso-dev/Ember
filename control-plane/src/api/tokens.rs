use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::auth::{random_token, sha256_hex, AdminSession};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{ApiTokenSummary, CreateApiTokenRequest};
use serde_json::json;
use uuid::Uuid;

pub async fn list(
    admin: AdminSession,
    State(state): State<AppState>,
) -> Result<Json<Vec<ApiTokenSummary>>, AppError> {
    let rows: Vec<(
        String,
        String,
        String,
        String,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        DateTime<Utc>,
    )> = sqlx::query_as(
        "SELECT id, name, token_prefix, role, expires_at, last_used_at, created_at \
         FROM api_tokens WHERE tenant_id = ? ORDER BY created_at DESC",
    )
    .bind(&admin.tenant.id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| ApiTokenSummary {
                id: r.0,
                name: r.1,
                token_prefix: r.2,
                role: r.3,
                expires_at: r.4.map(|t| t.to_rfc3339()),
                last_used_at: r.5.map(|t| t.to_rfc3339()),
                created_at: r.6.to_rfc3339(),
                token_once: None,
            })
            .collect(),
    ))
}

pub async fn create(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateApiTokenRequest>,
) -> Result<Json<ApiTokenSummary>, AppError> {
    if req.name.trim().is_empty() {
        return Err(AppError::BadRequest("name required".into()));
    }
    // Cap API tokens at operator unless caller is owner/admin requesting lower.
    let role = match req.role.as_deref().unwrap_or("operator") {
        "viewer" | "auditor" | "operator" => req.role.unwrap_or_else(|| "operator".into()),
        "admin" if matches!(admin.tenant.role.as_str(), "owner" | "admin") => "admin".into(),
        "owner" if admin.tenant.role == "owner" => "owner".into(),
        _ => {
            return Err(AppError::BadRequest(
                "role must be viewer|auditor|operator (or admin for owners)".into(),
            ))
        }
    };
    if matches!(admin.tenant.role.as_str(), "viewer" | "auditor") {
        return Err(AppError::Forbidden);
    }

    let raw = format!("ember_{}", random_token(32));
    let prefix: String = raw.chars().take(12).collect();
    let id = Uuid::now_v7().to_string();
    let expires = req
        .expires_days
        .map(|d| Utc::now() + chrono::Duration::days(d as i64));
    sqlx::query(
        "INSERT INTO api_tokens (id, tenant_id, user_id, name, token_hash, token_prefix, role, expires_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&admin.tenant.id)
    .bind(&admin.user.id)
    .bind(req.name.trim())
    .bind(sha256_hex(&raw))
    .bind(&prefix)
    .bind(&role)
    .bind(expires)
    .execute(&state.pool)
    .await?;

    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "api_token.create",
        Some("api_token"),
        Some(&id),
        RESULT_SUCCESS,
        Some(json!({ "name": req.name, "role": role })),
    )
    .await;

    Ok(Json(ApiTokenSummary {
        id,
        name: req.name.trim().to_string(),
        token_prefix: prefix,
        role,
        expires_at: expires.map(|t| t.to_rfc3339()),
        last_used_at: None,
        created_at: Utc::now().to_rfc3339(),
        token_once: Some(raw),
    }))
}

pub async fn delete(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    if matches!(admin.tenant.role.as_str(), "viewer" | "auditor") {
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM api_tokens WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&admin.tenant.id)
        .execute(&state.pool)
        .await?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "api_token.delete",
        Some("api_token"),
        Some(&id),
        RESULT_SUCCESS,
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}
