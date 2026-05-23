use crate::agent_ws::container_name;
use crate::auth::AdminSession;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::Utc;
use ember_shared::protocol::{
    Command, ControlPlaneLogLine, ControlPlaneLogsResponse, LogsResultData, ServerMsg,
    WorkloadLogsResponse,
};
use serde::Deserialize;
use std::time::Duration;
use tokio::sync::oneshot;
use uuid::Uuid;

const LOG_FETCH_TIMEOUT_SECS: u64 = 10;
const DEFAULT_TAIL_LINES: u32 = 200;
const MAX_TAIL_LINES: u32 = 5000;

#[derive(Deserialize)]
pub struct WorkloadLogsQuery {
    pub tail: Option<u32>,
}

pub async fn get_workload_logs(
    _admin: AdminSession,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<WorkloadLogsQuery>,
) -> Result<Json<WorkloadLogsResponse>, AppError> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT host_id, name FROM workloads WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;
    let (host_id, _name) = row.ok_or(AppError::NotFound)?;
    let tail = q.tail.unwrap_or(DEFAULT_TAIL_LINES).clamp(1, MAX_TAIL_LINES);

    let task_id = Uuid::now_v7().to_string();
    let (tx, rx) = oneshot::channel::<LogsResultData>();
    state.pending_logs.insert(task_id.clone(), tx).await;

    let command = Command::FetchContainerLogs {
        workload_id: id.clone(),
        name: container_name(&id),
        tail_lines: tail,
    };
    let dispatched = state
        .registry
        .send(
            &host_id,
            ServerMsg::Command {
                task_id: task_id.clone(),
                command,
            },
        )
        .await;
    if !dispatched {
        // Drop the pending entry; agent is not connected.
        let _ = state.pending_logs.take(&task_id).await;
        return Ok(Json(WorkloadLogsResponse {
            workload_id: id,
            host_id,
            fetched_at: Utc::now().to_rfc3339(),
            lines: vec![],
            truncated: false,
            error: Some("host agent is not connected".into()),
        }));
    }

    let result = match tokio::time::timeout(Duration::from_secs(LOG_FETCH_TIMEOUT_SECS), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => {
            return Ok(Json(WorkloadLogsResponse {
                workload_id: id,
                host_id,
                fetched_at: Utc::now().to_rfc3339(),
                lines: vec![],
                truncated: false,
                error: Some("agent disconnected before delivering logs".into()),
            }));
        }
        Err(_) => {
            let _ = state.pending_logs.take(&task_id).await;
            return Ok(Json(WorkloadLogsResponse {
                workload_id: id,
                host_id,
                fetched_at: Utc::now().to_rfc3339(),
                lines: vec![],
                truncated: false,
                error: Some("timed out waiting for agent log response".into()),
            }));
        }
    };

    Ok(Json(WorkloadLogsResponse {
        workload_id: id,
        host_id,
        fetched_at: Utc::now().to_rfc3339(),
        lines: result.lines,
        truncated: result.truncated,
        error: if result.success { None } else { result.message },
    }))
}

#[derive(Deserialize)]
pub struct ControlPlaneLogsQuery {
    pub limit: Option<u32>,
    pub level: Option<String>,
}

pub async fn get_control_plane_logs(
    _admin: AdminSession,
    State(state): State<AppState>,
    Query(q): Query<ControlPlaneLogsQuery>,
) -> Result<Json<ControlPlaneLogsResponse>, AppError> {
    let limit = q.limit.unwrap_or(500).clamp(1, 5000) as usize;
    let level = q.level.as_deref().filter(|s| !s.is_empty());
    let entries = state.log_buffer.snapshot(limit, level);
    let lines = entries
        .into_iter()
        .map(|e| ControlPlaneLogLine {
            ts: e.ts.to_rfc3339(),
            level: e.level,
            target: e.target,
            message: e.message,
        })
        .collect();
    Ok(Json(ControlPlaneLogsResponse {
        lines,
        capacity: state.log_buffer.capacity() as u32,
    }))
}
