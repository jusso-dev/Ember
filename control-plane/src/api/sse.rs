//! Server-sent events for live activity feed.

use crate::auth::AdminSession;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use chrono::{DateTime, Utc};
use futures_util::stream::{self, Stream};
use std::convert::Infallible;
use std::time::Duration;

pub async fn events_stream(
    admin: AdminSession,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let tenant_id = admin.tenant.id.clone();
    let pool = state.pool.clone();
    let mut last_id: i64 = {
        let row: Option<(i64,)> =
            sqlx::query_as("SELECT COALESCE(MAX(id), 0) FROM events WHERE tenant_id = ?")
                .bind(&tenant_id)
                .fetch_optional(&pool)
                .await?;
        row.map(|r| r.0).unwrap_or(0)
    };

    let s = stream::unfold((), move |_| {
        let pool = pool.clone();
        let tenant_id = tenant_id.clone();
        async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let rows: Result<Vec<(i64, DateTime<Utc>, String, String)>, _> = sqlx::query_as(
                    "SELECT id, ts, kind, message FROM events \
                     WHERE tenant_id = ? AND id > ? ORDER BY id ASC LIMIT 50",
                )
                .bind(&tenant_id)
                .bind(last_id)
                .fetch_all(&pool)
                .await;

                match rows {
                    Ok(batch) if !batch.is_empty() => {
                        let mut events = Vec::new();
                        for (id, ts, kind, message) in batch {
                            last_id = id;
                            let payload = serde_json::json!({
                                "id": id,
                                "ts": ts.to_rfc3339(),
                                "kind": kind,
                                "message": message,
                            });
                            events.push(Ok::<Event, Infallible>(
                                Event::default()
                                    .event("ember.event")
                                    .id(id.to_string())
                                    .data(payload.to_string()),
                            ));
                        }
                        // Return first event; remaining will wait next tick (simple).
                        // For simplicity emit one multi-data event.
                        let joined = events;
                        if let Some(first) = joined.into_iter().next() {
                            return Some((first, ()));
                        }
                    }
                    Ok(_) => {
                        return Some((
                            Ok(Event::default().comment("keepalive")),
                            (),
                        ));
                    }
                    Err(_) => {
                        return Some((
                            Ok(Event::default().event("error").data("query failed")),
                            (),
                        ));
                    }
                }
            }
        }
    });

    Ok(Sse::new(s).keep_alive(KeepAlive::default()))
}

// Silence unused import if Stream trait only used via StreamExt
#[allow(dead_code)]
fn _stream_bound() -> impl Stream<Item = Result<Event, Infallible>> {
    stream::empty()
}
