use crate::auth::{random_token, sha256_hex, AdminSession};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{EnrollTokenResponse, HostSummary};
use uuid::Uuid;

pub async fn list(
    _admin: AdminSession,
    State(state): State<AppState>,
) -> Result<Json<Vec<HostSummary>>, AppError> {
    let rows: Vec<(
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<DateTime<Utc>>,
        DateTime<Utc>,
    )> = sqlx::query_as(
        "SELECT id, name, status, os, arch, agent_version, last_seen_at, created_at \
         FROM hosts ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    let out = rows
        .into_iter()
        .map(|(id, name, status, os, arch, agent_version, last_seen_at, created_at)| HostSummary {
            id,
            name,
            status,
            os,
            arch,
            agent_version,
            last_seen_at: last_seen_at.map(|t| t.to_rfc3339()),
            created_at: created_at.to_rfc3339(),
        })
        .collect();
    Ok(Json(out))
}

pub async fn get(
    _admin: AdminSession,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<HostSummary>, AppError> {
    let row: Option<(
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<DateTime<Utc>>,
        DateTime<Utc>,
    )> = sqlx::query_as(
        "SELECT id, name, status, os, arch, agent_version, last_seen_at, created_at \
         FROM hosts WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;
    let (id, name, status, os, arch, agent_version, last_seen_at, created_at) =
        row.ok_or(AppError::NotFound)?;
    Ok(Json(HostSummary {
        id,
        name,
        status,
        os,
        arch,
        agent_version,
        last_seen_at: last_seen_at.map(|t| t.to_rfc3339()),
        created_at: created_at.to_rfc3339(),
    }))
}

pub async fn delete(
    _admin: AdminSession,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM workloads WHERE host_id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;
    if count.0 > 0 {
        return Err(AppError::Conflict("host still has workloads".into()));
    }
    let vols: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM volumes WHERE host_id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;
    if vols.0 > 0 {
        return Err(AppError::Conflict("host still has volumes".into()));
    }
    state.registry.remove(&id).await;
    sqlx::query("DELETE FROM hosts WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub async fn enroll_token(
    _admin: AdminSession,
    State(state): State<AppState>,
) -> Result<Json<EnrollTokenResponse>, AppError> {
    let token = random_token(32);
    let hash = sha256_hex(&token);
    let id = Uuid::now_v7().to_string();
    let expires = Utc::now() + chrono::Duration::hours(24);
    sqlx::query("INSERT INTO enrollment_tokens (id, token_hash, expires_at) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(&hash)
        .bind(expires)
        .execute(&state.pool)
        .await?;
    let install_command = format!(
        "curl -fsSL {base}/install.sh | sudo NAME=$(hostname) sh -s -- --server {base} --token {token}",
        base = state.public_base_url.as_str(),
        token = token,
    );
    Ok(Json(EnrollTokenResponse {
        token,
        install_command,
        expires_at: expires.to_rfc3339(),
    }))
}
