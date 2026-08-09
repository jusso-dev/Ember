use crate::error::AppError;
use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use ember_shared::protocol::Health;

/// Liveness + basic readiness: process up and SQLite reachable.
pub async fn get_health(State(state): State<AppState>) -> Result<Json<Health>, AppError> {
    let _: i64 = sqlx::query_scalar("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .map_err(AppError::from)?;

    Ok(Json(Health {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }))
}
