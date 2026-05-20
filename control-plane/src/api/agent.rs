use crate::agent_ws::log_event;
use crate::auth::{random_token, sha256_hex};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{EnrollRequest, EnrollResponse};
use uuid::Uuid;

pub async fn enroll(
    State(state): State<AppState>,
    Json(req): Json<EnrollRequest>,
) -> Result<Json<EnrollResponse>, AppError> {
    let token_hash = sha256_hex(&req.enrollment_token);

    let row: Option<(String, DateTime<Utc>, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT id, expires_at, consumed_at FROM enrollment_tokens WHERE token_hash = ?",
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await?;

    let (tok_id, expires_at, consumed_at) =
        row.ok_or_else(|| AppError::Unauthorized)?;
    if consumed_at.is_some() {
        return Err(AppError::Unauthorized);
    }
    if expires_at < Utc::now() {
        return Err(AppError::Unauthorized);
    }

    if req.name.trim().is_empty() {
        return Err(AppError::BadRequest("name required".into()));
    }

    let agent_token = random_token(32);
    let agent_hash = sha256_hex(&agent_token);
    let host_id = Uuid::now_v7().to_string();

    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO hosts (id, name, agent_token_hash, os, arch, agent_version, status) \
         VALUES (?, ?, ?, ?, ?, ?, 'pending')",
    )
    .bind(&host_id)
    .bind(&req.name)
    .bind(&agent_hash)
    .bind(&req.os)
    .bind(&req.arch)
    .bind(&req.agent_version)
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict(format!("host name already exists: {}", req.name))
        }
        other => AppError::Sqlx(other),
    })?;
    sqlx::query("UPDATE enrollment_tokens SET consumed_at = ? WHERE id = ?")
        .bind(Utc::now())
        .bind(&tok_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    log_event(
        &state,
        Some(&host_id),
        None,
        None,
        "agent.enrolled",
        &format!("host '{}' enrolled", req.name),
    )
    .await;

    Ok(Json(EnrollResponse {
        host_id,
        agent_token,
    }))
}
