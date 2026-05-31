use crate::agent_ws::container_name;
use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::auth::AdminSession;
use crate::error::AppError;
use crate::state::{AppState, StreamLogEvent};
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{
    AgentLogLine, AgentLogsResponse, Command, ControlPlaneLogLine, ControlPlaneLogsResponse,
    LogLine, LogsResultData, ServerMsg, WorkloadLogsResponse,
};
use futures_util::Stream;
use serde::Deserialize;
use std::convert::Infallible;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::sync::oneshot;
use tokio_stream::wrappers::UnboundedReceiverStream;
use uuid::Uuid;

const LOG_FETCH_TIMEOUT_SECS: u64 = 10;
const DEFAULT_TAIL_LINES: u32 = 200;
const MAX_TAIL_LINES: u32 = 5000;
const MAX_LOG_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const LOG_REQUESTS_PER_MINUTE: u32 = 60;
const HOST_LOG_FETCH_CONCURRENCY: usize = 4;

#[derive(Deserialize)]
pub struct WorkloadLogsQuery {
    pub tail: Option<u32>,
    pub source: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub search: Option<String>,
}

pub async fn get_workload_logs(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<WorkloadLogsQuery>,
) -> Result<Json<WorkloadLogsResponse>, AppError> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT host_id, name FROM workloads WHERE id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&admin.tenant.id)
            .fetch_optional(&state.pool)
            .await?;
    let (host_id, _name) = row.ok_or(AppError::NotFound)?;
    let tail = q
        .tail
        .unwrap_or(DEFAULT_TAIL_LINES)
        .clamp(1, MAX_TAIL_LINES);

    if q.source.as_deref() == Some("stored")
        || q.since.is_some()
        || q.until.is_some()
        || q.search.is_some()
    {
        let lines = fetch_stored_workload_logs(&state, &admin.tenant.id, &id, tail, &q).await?;
        let (lines, truncated, bytes_returned) = cap_log_lines(lines, false);
        audit::record(
            &state,
            &AuditActor::from_admin(&admin, &headers),
            "workload.logs.read",
            Some("workload"),
            Some(&id),
            RESULT_SUCCESS,
            Some(serde_json::json!({
                "source": "stored",
                "lines_returned": lines.len(),
                "bytes_returned": bytes_returned,
                "truncated": truncated,
            })),
        )
        .await;
        return Ok(Json(WorkloadLogsResponse {
            workload_id: id,
            host_id,
            fetched_at: Utc::now().to_rfc3339(),
            lines,
            truncated,
            error: None,
        }));
    }

    let rate_key = format!("workload-logs:{}:{}", admin.tenant.id, admin.user.id);
    if let Err(retry_after_secs) = state
        .request_limiter
        .check(rate_key, LOG_REQUESTS_PER_MINUTE, Duration::from_secs(60))
        .await
    {
        return Err(AppError::TooManyRequests { retry_after_secs });
    }

    let Some(_host_permit) = state
        .log_fetch_guards
        .try_acquire(&host_id, HOST_LOG_FETCH_CONCURRENCY)
        .await
    else {
        return Err(AppError::TooManyRequests {
            retry_after_secs: 2,
        });
    };

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
        let response = WorkloadLogsResponse {
            workload_id: id,
            host_id,
            fetched_at: Utc::now().to_rfc3339(),
            lines: vec![],
            truncated: false,
            error: Some("host agent is not connected".into()),
        };
        return Ok(Json(response));
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

    let (lines, truncated, bytes_returned) = cap_log_lines(result.lines, result.truncated);
    persist_workload_lines(&state, &admin.tenant.id, &id, &host_id, &lines).await;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "workload.logs.read",
        Some("workload"),
        Some(&id),
        RESULT_SUCCESS,
        Some(serde_json::json!({
            "source": "live",
            "tail": tail,
            "lines_returned": lines.len(),
            "bytes_returned": bytes_returned,
            "truncated": truncated,
        })),
    )
    .await;

    Ok(Json(WorkloadLogsResponse {
        workload_id: id,
        host_id,
        fetched_at: Utc::now().to_rfc3339(),
        lines,
        truncated,
        error: if result.success { None } else { result.message },
    }))
}

pub async fn stream_workload_logs(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Sse<LogSseStream>, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT host_id FROM workloads WHERE id = ? AND tenant_id = ?")
            .bind(&id)
            .bind(&admin.tenant.id)
            .fetch_optional(&state.pool)
            .await?;
    let (host_id,) = row.ok_or(AppError::NotFound)?;
    let rate_key = format!("workload-log-stream:{}:{}", admin.tenant.id, admin.user.id);
    if let Err(retry_after_secs) = state
        .request_limiter
        .check(rate_key, 16, Duration::from_secs(60))
        .await
    {
        return Err(AppError::TooManyRequests { retry_after_secs });
    }

    let subscription_id = Uuid::now_v7().to_string();
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    state
        .pending_log_streams
        .insert(subscription_id.clone(), tx)
        .await;
    let task_id = Uuid::now_v7().to_string();
    let dispatched = state
        .registry
        .send(
            &host_id,
            ServerMsg::Command {
                task_id,
                command: Command::StreamContainerLogs {
                    workload_id: id.clone(),
                    name: container_name(&id),
                    subscription_id: subscription_id.clone(),
                },
            },
        )
        .await;
    if !dispatched {
        let _ = state.pending_log_streams.take(&subscription_id).await;
        return Err(AppError::BadRequest("host agent is not connected".into()));
    }

    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "workload.logs.stream",
        Some("workload"),
        Some(&id),
        RESULT_SUCCESS,
        Some(serde_json::json!({ "subscription_id": subscription_id })),
    )
    .await;

    Ok(Sse::new(LogSseStream {
        inner: UnboundedReceiverStream::new(rx),
        state,
        host_id,
        subscription_id,
    })
    .keep_alive(KeepAlive::default()))
}

#[derive(Deserialize)]
pub struct ControlPlaneLogsQuery {
    pub limit: Option<u32>,
    pub level: Option<String>,
    pub source: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub search: Option<String>,
}

pub async fn get_control_plane_logs(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ControlPlaneLogsQuery>,
) -> Result<Json<ControlPlaneLogsResponse>, AppError> {
    let limit = q.limit.unwrap_or(500).clamp(1, 5000) as usize;
    let level = q.level.as_deref().filter(|s| !s.is_empty());
    let include_global = matches!(admin.tenant.role.as_str(), "owner" | "admin");
    let lines = if q.source.as_deref() == Some("stored")
        || q.since.is_some()
        || q.until.is_some()
        || q.search.is_some()
    {
        fetch_stored_control_plane_logs(
            &state,
            &admin.tenant.id,
            include_global,
            limit as i64,
            level,
            &q,
        )
        .await?
    } else {
        state
            .log_buffer
            .snapshot(limit, level, Some(&admin.tenant.id), include_global)
            .into_iter()
            .map(|e| ControlPlaneLogLine {
                ts: e.ts.to_rfc3339(),
                level: e.level,
                target: e.target,
                message: e.message,
            })
            .collect()
    };
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "control_plane.logs.read",
        Some("control_plane_log"),
        None,
        RESULT_SUCCESS,
        Some(serde_json::json!({
            "source": q.source.as_deref().unwrap_or("memory"),
            "lines_returned": lines.len(),
            "level": q.level,
            "since": q.since,
            "until": q.until,
        })),
    )
    .await;
    Ok(Json(ControlPlaneLogsResponse {
        lines,
        capacity: state.log_buffer.capacity() as u32,
    }))
}

#[derive(Deserialize)]
pub struct HostLogsQuery {
    pub limit: Option<u32>,
    pub level: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
}

pub async fn get_host_logs(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(host_id): Path<String>,
    Query(q): Query<HostLogsQuery>,
) -> Result<Json<AgentLogsResponse>, AppError> {
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM hosts WHERE id = ? AND tenant_id = ?")
            .bind(&host_id)
            .bind(&admin.tenant.id)
            .fetch_optional(&state.pool)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }
    let since = parse_time(q.since.as_deref());
    let until = parse_time(q.until.as_deref());
    let level = q.level.as_deref().filter(|s| !s.is_empty());
    let limit = q.limit.unwrap_or(500).clamp(1, 5000) as i64;
    let rows: Vec<(i64, DateTime<Utc>, String, String, String)> = sqlx::query_as(
        "SELECT id, ts, level, target, message \
         FROM agent_logs \
         WHERE host_id = ? AND tenant_id = ? \
           AND (? IS NULL OR level = ?) \
           AND (? IS NULL OR ts >= ?) \
           AND (? IS NULL OR ts <= ?) \
         ORDER BY id DESC LIMIT ?",
    )
    .bind(&host_id)
    .bind(&admin.tenant.id)
    .bind(level)
    .bind(level)
    .bind(since)
    .bind(since)
    .bind(until)
    .bind(until)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;
    let mut lines = rows
        .into_iter()
        .map(|row| AgentLogLine {
            id: Some(row.0),
            host_id: host_id.clone(),
            ts: row.1.to_rfc3339(),
            level: row.2,
            target: row.3,
            message: row.4,
        })
        .collect::<Vec<_>>();
    lines.reverse();
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "host.logs.read",
        Some("host"),
        Some(&host_id),
        RESULT_SUCCESS,
        Some(serde_json::json!({ "lines_returned": lines.len(), "level": q.level })),
    )
    .await;
    Ok(Json(AgentLogsResponse { host_id, lines }))
}

fn cap_log_lines(mut lines: Vec<LogLine>, already_truncated: bool) -> (Vec<LogLine>, bool, usize) {
    let mut bytes = lines.iter().map(log_line_bytes).sum::<usize>();
    let mut truncated = already_truncated;
    while bytes > MAX_LOG_RESPONSE_BYTES && !lines.is_empty() {
        bytes = bytes.saturating_sub(log_line_bytes(&lines.remove(0)));
        truncated = true;
    }
    (lines, truncated, bytes)
}

fn log_line_bytes(line: &LogLine) -> usize {
    line.stream.len()
        + line.timestamp.as_ref().map(|s| s.len()).unwrap_or_default()
        + line.message.len()
        + 16
}

async fn persist_workload_lines(
    state: &AppState,
    tenant_id: &str,
    workload_id: &str,
    host_id: &str,
    lines: &[LogLine],
) {
    if lines.is_empty() {
        return;
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = ?e, "workload log persistence begin failed");
            return;
        }
    };
    for line in lines {
        let ts = line
            .timestamp
            .as_deref()
            .and_then(|value| parse_time(Some(value)))
            .unwrap_or_else(Utc::now);
        if let Err(e) = sqlx::query(
            "INSERT INTO workload_logs (tenant_id, workload_id, host_id, ts, stream, message) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(tenant_id)
        .bind(workload_id)
        .bind(host_id)
        .bind(ts)
        .bind(&line.stream)
        .bind(&line.message)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = ?e, "workload log persistence insert failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = ?e, "workload log persistence commit failed");
    }
}

async fn fetch_stored_workload_logs(
    state: &AppState,
    tenant_id: &str,
    workload_id: &str,
    tail: u32,
    q: &WorkloadLogsQuery,
) -> Result<Vec<LogLine>, AppError> {
    let since = parse_time(q.since.as_deref());
    let until = parse_time(q.until.as_deref());
    let search = q.search.as_deref().filter(|s| !s.trim().is_empty());
    let rows: Vec<(DateTime<Utc>, String, String)> = sqlx::query_as(
        "SELECT ts, stream, message \
         FROM workload_logs \
         WHERE tenant_id = ? AND workload_id = ? \
           AND (? IS NULL OR ts >= ?) \
           AND (? IS NULL OR ts <= ?) \
           AND (? IS NULL OR message LIKE '%' || ? || '%') \
         ORDER BY id DESC LIMIT ?",
    )
    .bind(tenant_id)
    .bind(workload_id)
    .bind(since)
    .bind(since)
    .bind(until)
    .bind(until)
    .bind(search)
    .bind(search)
    .bind(tail as i64)
    .fetch_all(&state.pool)
    .await?;
    let mut lines = rows
        .into_iter()
        .map(|row| LogLine {
            timestamp: Some(row.0.to_rfc3339()),
            stream: row.1,
            message: row.2,
        })
        .collect::<Vec<_>>();
    lines.reverse();
    Ok(lines)
}

async fn fetch_stored_control_plane_logs(
    state: &AppState,
    tenant_id: &str,
    include_global: bool,
    limit: i64,
    level: Option<&str>,
    q: &ControlPlaneLogsQuery,
) -> Result<Vec<ControlPlaneLogLine>, AppError> {
    let since = parse_time(q.since.as_deref());
    let until = parse_time(q.until.as_deref());
    let search = q.search.as_deref().filter(|s| !s.trim().is_empty());
    let rows: Vec<(DateTime<Utc>, String, String, String)> = sqlx::query_as(
        "SELECT ts, level, target, message \
         FROM control_plane_logs \
         WHERE (tenant_id = ? OR (? AND tenant_id IS NULL)) \
           AND (? IS NULL OR level = ?) \
           AND (? IS NULL OR ts >= ?) \
           AND (? IS NULL OR ts <= ?) \
           AND (? IS NULL OR message LIKE '%' || ? || '%' OR target LIKE '%' || ? || '%') \
         ORDER BY id DESC LIMIT ?",
    )
    .bind(tenant_id)
    .bind(include_global)
    .bind(level)
    .bind(level)
    .bind(since)
    .bind(since)
    .bind(until)
    .bind(until)
    .bind(search)
    .bind(search)
    .bind(search)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;
    let mut lines = rows
        .into_iter()
        .map(|row| ControlPlaneLogLine {
            ts: row.0.to_rfc3339(),
            level: row.1,
            target: row.2,
            message: row.3,
        })
        .collect::<Vec<_>>();
    lines.reverse();
    Ok(lines)
}

fn parse_time(value: Option<&str>) -> Option<DateTime<Utc>> {
    value.and_then(|s| {
        DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|d| d.with_timezone(&Utc))
    })
}

pub struct LogSseStream {
    inner: UnboundedReceiverStream<StreamLogEvent>,
    state: AppState,
    host_id: String,
    subscription_id: String,
}

impl Stream for LogSseStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match Pin::new(&mut self.inner).poll_next(cx) {
            Poll::Ready(Some(StreamLogEvent::Lines(lines))) => {
                let event = Event::default()
                    .event("log")
                    .json_data(lines)
                    .unwrap_or_else(|_| Event::default().event("error").data("encode failed"));
                Poll::Ready(Some(Ok(event)))
            }
            Poll::Ready(Some(StreamLogEvent::Ended(reason))) => {
                Poll::Ready(Some(Ok(Event::default().event("end").data(reason))))
            }
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}

impl Drop for LogSseStream {
    fn drop(&mut self) {
        let state = self.state.clone();
        let host_id = self.host_id.clone();
        let subscription_id = self.subscription_id.clone();
        tokio::spawn(async move {
            let _ = state.pending_log_streams.take(&subscription_id).await;
            let _ = state
                .registry
                .send(
                    &host_id,
                    ServerMsg::Command {
                        task_id: Uuid::now_v7().to_string(),
                        command: Command::CancelLogStream { subscription_id },
                    },
                )
                .await;
        });
    }
}
