use crate::agent_ws::log_event;
use crate::state::AppState;
use chrono::Utc;
use std::time::Duration;

const HEARTBEAT_TIMEOUT_SECS: i64 = 45;
const DISPATCHED_TIMEOUT_SECS: i64 = 60;

pub async fn run(state: AppState) {
    let mut tick = tokio::time::interval(Duration::from_secs(10));
    loop {
        tick.tick().await;
        if let Err(e) = sweep_offline(&state).await {
            tracing::error!(error = ?e, "sweep_offline");
        }
        if let Err(e) = requeue_stuck(&state).await {
            tracing::error!(error = ?e, "requeue_stuck");
        }
    }
}

async fn sweep_offline(state: &AppState) -> anyhow::Result<()> {
    let cutoff = Utc::now() - chrono::Duration::seconds(HEARTBEAT_TIMEOUT_SECS);
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM hosts WHERE status='online' AND (last_seen_at IS NULL OR last_seen_at < ?)",
    )
    .bind(cutoff)
    .fetch_all(&state.pool)
    .await?;
    for (id,) in rows {
        sqlx::query("UPDATE hosts SET status='offline' WHERE id = ?")
            .bind(&id)
            .execute(&state.pool)
            .await?;
        log_event(state, Some(&id), None, None, "agent.timeout", "marked offline (no heartbeat)").await;
    }
    Ok(())
}

async fn requeue_stuck(state: &AppState) -> anyhow::Result<()> {
    let cutoff = Utc::now() - chrono::Duration::seconds(DISPATCHED_TIMEOUT_SECS);
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, host_id FROM tasks WHERE status='dispatched' AND (dispatched_at IS NULL OR dispatched_at < ?)",
    )
    .bind(cutoff)
    .fetch_all(&state.pool)
    .await?;
    for (task_id, host_id) in rows {
        sqlx::query("UPDATE tasks SET status='queued' WHERE id = ?")
            .bind(&task_id)
            .execute(&state.pool)
            .await?;
        tracing::warn!(%task_id, %host_id, "task requeued (no result before timeout)");
    }
    Ok(())
}
