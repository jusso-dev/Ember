use crate::auth::AdminSession;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::EventRow;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct EventsQuery {
    pub host_id: Option<String>,
    pub workload_id: Option<String>,
    pub volume_id: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    _admin: AdminSession,
    State(state): State<AppState>,
    Query(q): Query<EventsQuery>,
) -> Result<Json<Vec<EventRow>>, AppError> {
    let limit = q.limit.unwrap_or(100).clamp(1, 1000);
    let rows: Vec<(
        i64,
        DateTime<Utc>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
    )> = sqlx::query_as(
        "SELECT id, ts, host_id, workload_id, volume_id, kind, message FROM events \
         WHERE (? IS NULL OR host_id = ?) \
           AND (? IS NULL OR workload_id = ?) \
           AND (? IS NULL OR volume_id = ?) \
         ORDER BY id DESC LIMIT ?",
    )
    .bind(&q.host_id)
    .bind(&q.host_id)
    .bind(&q.workload_id)
    .bind(&q.workload_id)
    .bind(&q.volume_id)
    .bind(&q.volume_id)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;
    let out = rows
        .into_iter()
        .map(|t| EventRow {
            id: t.0,
            ts: t.1.to_rfc3339(),
            host_id: t.2,
            workload_id: t.3,
            volume_id: t.4,
            kind: t.5,
            message: t.6,
        })
        .collect();
    Ok(Json(out))
}
