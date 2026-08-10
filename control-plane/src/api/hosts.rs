use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::auth::{random_token, sha256_hex, AdminSession};
use crate::error::AppError;
use crate::policy;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{EnrollTokenResponse, HostSummary, UpdateHostRequest};
use serde_json::json;
use uuid::Uuid;

type HostRow = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<DateTime<Utc>>,
    DateTime<Utc>,
    String,
    i64,
);

fn map_host(row: HostRow) -> HostSummary {
    HostSummary {
        id: row.0,
        name: row.1,
        status: row.2,
        os: row.3,
        arch: row.4,
        agent_version: row.5,
        last_seen_at: row.6.map(|t| t.to_rfc3339()),
        created_at: row.7.to_rfc3339(),
        labels: policy::labels_from_json(&row.8),
        cordoned: row.9 != 0,
    }
}

pub async fn list(
    admin: AdminSession,
    State(state): State<AppState>,
) -> Result<Json<Vec<HostSummary>>, AppError> {
    let rows: Vec<HostRow> = sqlx::query_as(
        "SELECT id, name, status, os, arch, agent_version, last_seen_at, created_at, \
         COALESCE(labels_json, '{}'), COALESCE(cordoned, 0) \
         FROM hosts WHERE tenant_id = ? ORDER BY created_at DESC",
    )
    .bind(&admin.tenant.id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows.into_iter().map(map_host).collect()))
}

pub async fn get(
    admin: AdminSession,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<HostSummary>, AppError> {
    let row: Option<HostRow> = sqlx::query_as(
        "SELECT id, name, status, os, arch, agent_version, last_seen_at, created_at, \
         COALESCE(labels_json, '{}'), COALESCE(cordoned, 0) \
         FROM hosts WHERE id = ? AND tenant_id = ?",
    )
    .bind(&id)
    .bind(&admin.tenant.id)
    .fetch_optional(&state.pool)
    .await?;
    Ok(Json(map_host(row.ok_or(AppError::NotFound)?)))
}

pub async fn update(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdateHostRequest>,
) -> Result<Json<HostSummary>, AppError> {
    if matches!(admin.tenant.role.as_str(), "viewer" | "auditor") {
        return Err(AppError::Forbidden);
    }
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM hosts WHERE id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&admin.tenant.id)
            .fetch_optional(&state.pool)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }
    if let Some(labels) = &req.labels {
        sqlx::query("UPDATE hosts SET labels_json = ? WHERE id = ? AND tenant_id = ?")
            .bind(policy::labels_to_json(labels))
            .bind(&id)
            .bind(&admin.tenant.id)
            .execute(&state.pool)
            .await?;
    }
    if let Some(cordoned) = req.cordoned {
        sqlx::query("UPDATE hosts SET cordoned = ? WHERE id = ? AND tenant_id = ?")
            .bind(if cordoned { 1 } else { 0 })
            .bind(&id)
            .bind(&admin.tenant.id)
            .execute(&state.pool)
            .await?;
    }
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "host.update",
        Some("host"),
        Some(&id),
        RESULT_SUCCESS,
        Some(json!({ "cordoned": req.cordoned, "labels": req.labels })),
    )
    .await;
    get(admin, State(state), Path(id)).await
}

pub async fn delete(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM workloads WHERE host_id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&admin.tenant.id)
            .fetch_one(&state.pool)
            .await?;
    if count.0 > 0 {
        return Err(AppError::Conflict("host still has workloads".into()));
    }
    let vols: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM volumes WHERE host_id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&admin.tenant.id)
            .fetch_one(&state.pool)
            .await?;
    if vols.0 > 0 {
        return Err(AppError::Conflict("host still has volumes".into()));
    }
    state.registry.remove(&id).await;
    sqlx::query("DELETE FROM hosts WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&admin.tenant.id)
        .execute(&state.pool)
        .await?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "host.delete",
        Some("host"),
        Some(&id),
        RESULT_SUCCESS,
        None,
    )
    .await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub async fn enroll_token(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<EnrollTokenResponse>, AppError> {
    let token = random_token(32);
    let hash = sha256_hex(&token);
    let id = Uuid::now_v7().to_string();
    let expires = Utc::now() + chrono::Duration::hours(24);
    sqlx::query(
        "INSERT INTO enrollment_tokens (id, token_hash, expires_at, tenant_id) VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&hash)
    .bind(expires)
    .bind(&admin.tenant.id)
    .execute(&state.pool)
    .await?;
    let install_command = format!(
        "curl -fsSL {base}/install.sh | sudo NAME=$(hostname) sh -s -- --server {base} --token {token}",
        base = state.public_base_url.as_str(),
        token = token,
    );
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "host.enroll_token.create",
        Some("enrollment_token"),
        Some(&id),
        RESULT_SUCCESS,
        Some(json!({ "expires_at": expires.to_rfc3339() })),
    )
    .await;
    Ok(Json(EnrollTokenResponse {
        token,
        install_command,
        expires_at: expires.to_rfc3339(),
    }))
}
