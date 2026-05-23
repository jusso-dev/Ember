use crate::agent_ws::log_event;
use crate::state::AppState;
use chrono::Utc;
use ember_shared::protocol::{Command, ServerMsg, TaskResultData};
use uuid::Uuid;

pub async fn enqueue(
    state: &AppState,
    host_id: &str,
    workload_id: Option<&str>,
    volume_id: Option<&str>,
    command: &Command,
) -> anyhow::Result<String> {
    let id = Uuid::now_v7().to_string();
    let kind = match command {
        Command::RunContainer(_) => "RunContainer",
        Command::StopContainer { .. } => "StopContainer",
        Command::RemoveContainer { .. } => "RemoveContainer",
        Command::CreateVolume(_) => "CreateVolume",
        Command::DeleteVolume(_) => "DeleteVolume",
        // Log fetches are not persisted as scheduled tasks; they are dispatched
        // directly via the WebSocket registry from `api::logs`. This arm keeps
        // the match exhaustive in case of misuse.
        Command::FetchContainerLogs { .. } => "FetchContainerLogs",
        Command::Ping => "Ping",
    };
    let payload = serde_json::to_string(command)?;
    sqlx::query(
        "INSERT INTO tasks (id, host_id, kind, payload_json, status, workload_id, volume_id) \
         VALUES (?, ?, ?, ?, 'queued', ?, ?)",
    )
    .bind(&id)
    .bind(host_id)
    .bind(kind)
    .bind(&payload)
    .bind(workload_id)
    .bind(volume_id)
    .execute(&state.pool)
    .await?;

    let dispatched = state
        .registry
        .send(
            host_id,
            ServerMsg::Command {
                task_id: id.clone(),
                command: command.clone(),
            },
        )
        .await;
    if dispatched {
        sqlx::query("UPDATE tasks SET status='dispatched', dispatched_at = ? WHERE id = ?")
            .bind(Utc::now())
            .bind(&id)
            .execute(&state.pool)
            .await?;
    }
    Ok(id)
}

pub async fn replay_queued(state: &AppState, host_id: &str) -> anyhow::Result<()> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, payload_json FROM tasks WHERE host_id = ? AND status IN ('queued','dispatched') ORDER BY created_at ASC",
    )
    .bind(host_id)
    .fetch_all(&state.pool)
    .await?;
    for (task_id, payload) in rows {
        let command: Command = serde_json::from_str(&payload)?;
        let sent = state
            .registry
            .send(
                host_id,
                ServerMsg::Command {
                    task_id: task_id.clone(),
                    command,
                },
            )
            .await;
        if sent {
            let _ = sqlx::query("UPDATE tasks SET status='dispatched', dispatched_at = ? WHERE id = ?")
                .bind(Utc::now())
                .bind(&task_id)
                .execute(&state.pool)
                .await;
        }
    }
    Ok(())
}

pub async fn record_result(
    state: &AppState,
    task_id: &str,
    host_id: &str,
    result: &TaskResultData,
) -> anyhow::Result<()> {
    let status = if result.success { "succeeded" } else { "failed" };
    let result_json = serde_json::to_string(result)?;
    sqlx::query(
        "UPDATE tasks SET status = ?, finished_at = ?, result_json = ?, error = ? WHERE id = ?",
    )
    .bind(status)
    .bind(Utc::now())
    .bind(&result_json)
    .bind(result.message.as_deref())
    .bind(task_id)
    .execute(&state.pool)
    .await?;

    // Look up which workload/volume this was for, propagate.
    let row: Option<(Option<String>, Option<String>, String)> =
        sqlx::query_as("SELECT workload_id, volume_id, kind FROM tasks WHERE id = ?")
            .bind(task_id)
            .fetch_optional(&state.pool)
            .await?;
    let Some((wl, vol, kind)) = row else { return Ok(()); };

    if let Some(wl_id) = wl.as_deref() {
        if result.success {
            match kind.as_str() {
                "RunContainer" => {
                    sqlx::query(
                        "UPDATE workloads SET observed_state='running', container_id=?, last_error=NULL WHERE id = ?",
                    )
                    .bind(result.container_id.as_deref())
                    .bind(wl_id)
                    .execute(&state.pool)
                    .await?;
                    log_event(state, Some(host_id), Some(wl_id), None, "workload.running", "container started").await;
                }
                "StopContainer" => {
                    sqlx::query(
                        "UPDATE workloads SET observed_state='stopped', last_error=NULL WHERE id = ?",
                    )
                    .bind(wl_id)
                    .execute(&state.pool)
                    .await?;
                    log_event(state, Some(host_id), Some(wl_id), None, "workload.stopped", "container stopped").await;
                }
                "RemoveContainer" => {
                    sqlx::query("DELETE FROM workloads WHERE id = ?")
                        .bind(wl_id)
                        .execute(&state.pool)
                        .await?;
                    log_event(state, Some(host_id), Some(wl_id), None, "workload.removed", "workload removed").await;
                }
                _ => {}
            }
        } else {
            let msg = result.message.clone().unwrap_or_else(|| "unknown error".into());
            sqlx::query("UPDATE workloads SET observed_state='error', last_error=? WHERE id = ?")
                .bind(&msg)
                .bind(wl_id)
                .execute(&state.pool)
                .await?;
            log_event(state, Some(host_id), Some(wl_id), None, "workload.error", &msg).await;
        }
    }

    if let Some(vol_id) = vol.as_deref() {
        if result.success {
            match kind.as_str() {
                "CreateVolume" => {
                    sqlx::query("UPDATE volumes SET status='ready', host_path=? WHERE id = ?")
                        .bind(result.host_path.as_deref())
                        .bind(vol_id)
                        .execute(&state.pool)
                        .await?;
                    log_event(state, Some(host_id), None, Some(vol_id), "volume.ready", "volume provisioned").await;
                }
                "DeleteVolume" => {
                    sqlx::query("DELETE FROM volumes WHERE id = ?")
                        .bind(vol_id)
                        .execute(&state.pool)
                        .await?;
                    log_event(state, Some(host_id), None, Some(vol_id), "volume.deleted", "volume deleted").await;
                }
                _ => {}
            }
        } else {
            let msg = result.message.clone().unwrap_or_else(|| "unknown error".into());
            sqlx::query("UPDATE volumes SET status='error' WHERE id = ?")
                .bind(vol_id)
                .execute(&state.pool)
                .await?;
            log_event(state, Some(host_id), None, Some(vol_id), "volume.error", &msg).await;
        }
    }
    Ok(())
}
