use crate::auth::{bearer_token, sha256_hex};
use crate::error::AppError;
use crate::scheduler;
use crate::state::{AppState, StreamLogEvent};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use chrono::Utc;
use ember_shared::protocol::{AgentLogLine, AgentMsg, LogLine, ServerMsg};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

pub type HostId = String;

#[derive(Clone)]
pub struct Registry {
    inner: Arc<Mutex<HashMap<HostId, mpsc::UnboundedSender<ServerMsg>>>>,
}

impl Registry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn insert(&self, host_id: HostId, tx: mpsc::UnboundedSender<ServerMsg>) {
        self.inner.lock().await.insert(host_id, tx);
    }

    pub async fn remove(&self, host_id: &str) {
        self.inner.lock().await.remove(host_id);
    }

    pub async fn send(&self, host_id: &str, msg: ServerMsg) -> bool {
        let guard = self.inner.lock().await;
        match guard.get(host_id) {
            Some(tx) => tx.send(msg).is_ok(),
            None => false,
        }
    }
}

pub async fn ws_upgrade(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
    req: axum::http::Request<axum::body::Body>,
) -> Result<Response, AppError> {
    let (parts, _body) = req.into_parts();
    let token = bearer_token(&parts).ok_or(AppError::Unauthorized)?;
    let token_hash = sha256_hex(&token);

    let row: Option<(String,)> = sqlx::query_as("SELECT id FROM hosts WHERE agent_token_hash = ?")
        .bind(&token_hash)
        .fetch_optional(&state.pool)
        .await
        .map_err(AppError::Sqlx)?;
    let host_id = match row {
        Some((id,)) => id,
        None => return Err(AppError::Unauthorized),
    };

    Ok(ws.on_upgrade(move |socket| handle_socket(state, host_id, socket)))
}

async fn handle_socket(state: AppState, host_id: String, socket: WebSocket) {
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMsg>();
    state.registry.insert(host_id.clone(), tx).await;
    mark_online(&state, &host_id, None, None, None).await;
    log_event(
        &state,
        Some(&host_id),
        None,
        None,
        "agent.connect",
        "agent connected",
    )
    .await;

    let (mut ws_tx, mut ws_rx) = socket.split();

    // Replay queued tasks on connect.
    if let Err(e) = scheduler::replay_queued(&state, &host_id).await {
        tracing::error!(error = ?e, host = %host_id, "replay queued tasks failed");
    }

    let writer = {
        let host_id = host_id.clone();
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                let text = match serde_json::to_string(&msg) {
                    Ok(t) => t,
                    Err(e) => {
                        tracing::error!(error = ?e, "serialize ServerMsg");
                        continue;
                    }
                };
                if ws_tx.send(Message::Text(text)).await.is_err() {
                    tracing::info!(host = %host_id, "ws writer closed");
                    break;
                }
            }
            let _ = ws_tx.close().await;
        })
    };

    while let Some(frame) = ws_rx.next().await {
        let msg = match frame {
            Ok(Message::Text(s)) => s,
            Ok(Message::Close(_)) => break,
            Ok(_) => continue,
            Err(e) => {
                tracing::info!(error = ?e, host = %host_id, "ws read err");
                break;
            }
        };
        let parsed: AgentMsg = match serde_json::from_str(&msg) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!(error = ?e, payload = %msg, "bad AgentMsg");
                continue;
            }
        };
        if let Err(e) = handle_agent_msg(&state, &host_id, parsed).await {
            tracing::error!(error = ?e, host = %host_id, "handle agent msg");
        }
    }

    state.registry.remove(&host_id).await;
    writer.abort();
    mark_offline(&state, &host_id).await;
    log_event(
        &state,
        Some(&host_id),
        None,
        None,
        "agent.disconnect",
        "agent disconnected",
    )
    .await;
}

async fn handle_agent_msg(state: &AppState, host_id: &str, msg: AgentMsg) -> anyhow::Result<()> {
    match msg {
        AgentMsg::Hello(h) => {
            mark_online(
                state,
                host_id,
                Some(&h.os),
                Some(&h.arch),
                Some(&h.agent_version),
            )
            .await;
            reconcile_observed(state, host_id, &h.containers).await;
        }
        AgentMsg::Ping { containers } => {
            touch_last_seen(state, host_id).await;
            reconcile_observed(state, host_id, &containers).await;
            state.registry.send(host_id, ServerMsg::Pong).await;
        }
        AgentMsg::TaskResult { task_id, result } => {
            scheduler::record_result(state, &task_id, host_id, &result).await?;
        }
        AgentMsg::LogsResult { task_id, result } => {
            if let Some(tx) = state.pending_logs.take(&task_id).await {
                let _ = tx.send(result);
            } else {
                tracing::debug!(task_id = %task_id, "logs result with no pending request");
            }
        }
        AgentMsg::LogChunk {
            subscription_id,
            workload_id,
            lines,
        } => {
            persist_workload_log_chunk(state, host_id, &workload_id, &lines).await;
            let _ = state
                .pending_log_streams
                .send(&subscription_id, StreamLogEvent::Lines(lines))
                .await;
        }
        AgentMsg::LogStreamEnded {
            subscription_id,
            reason,
        } => {
            let _ = state
                .pending_log_streams
                .send(&subscription_id, StreamLogEvent::Ended(reason))
                .await;
            let _ = state.pending_log_streams.take(&subscription_id).await;
        }
        AgentMsg::AgentLogs { batch } => {
            persist_agent_logs(state, host_id, &batch).await;
        }
    }
    Ok(())
}

async fn mark_online(
    state: &AppState,
    host_id: &str,
    os: Option<&str>,
    arch: Option<&str>,
    agent_version: Option<&str>,
) {
    let now = Utc::now();
    let res = sqlx::query(
        "UPDATE hosts SET status='online', last_seen_at = ?, \
         os = COALESCE(?, os), arch = COALESCE(?, arch), agent_version = COALESCE(?, agent_version) \
         WHERE id = ?",
    )
    .bind(now)
    .bind(os)
    .bind(arch)
    .bind(agent_version)
    .bind(host_id)
    .execute(&state.pool)
    .await;
    if let Err(e) = res {
        tracing::error!(error = ?e, "mark_online");
    }
}

async fn mark_offline(state: &AppState, host_id: &str) {
    let res = sqlx::query("UPDATE hosts SET status='offline' WHERE id = ?")
        .bind(host_id)
        .execute(&state.pool)
        .await;
    if let Err(e) = res {
        tracing::error!(error = ?e, "mark_offline");
    }
}

async fn touch_last_seen(state: &AppState, host_id: &str) {
    let now = Utc::now();
    let _ = sqlx::query("UPDATE hosts SET last_seen_at = ?, status='online' WHERE id = ?")
        .bind(now)
        .bind(host_id)
        .execute(&state.pool)
        .await;
}

async fn reconcile_observed(
    state: &AppState,
    host_id: &str,
    containers: &[ember_shared::protocol::ContainerSummary],
) {
    // Map container name -> (state, container_id)
    let by_name: HashMap<&str, &ember_shared::protocol::ContainerSummary> =
        containers.iter().map(|c| (c.name.as_str(), c)).collect();

    let rows: Vec<(String, String)> =
        match sqlx::query_as("SELECT id, name FROM workloads WHERE host_id = ?")
            .bind(host_id)
            .fetch_all(&state.pool)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(error = ?e, "fetch workloads");
                return;
            }
        };

    for (id, name) in rows {
        let container_name = container_name(&id);
        let (observed, container_id) = match by_name.get(container_name.as_str()) {
            Some(c) => (c.state.clone(), c.container_id.clone()),
            None => ("absent".to_string(), None),
        };
        let _ =
            sqlx::query("UPDATE workloads SET observed_state = ?, container_id = ? WHERE id = ?")
                .bind(&observed)
                .bind(container_id.as_deref())
                .bind(&id)
                .execute(&state.pool)
                .await;
        let _ = name; // unused; we keyed by id-derived container_name
    }
}

pub fn container_name(workload_id: &str) -> String {
    // Truncate to keep names readable but distinct.
    let short = workload_id.split('-').next().unwrap_or(workload_id);
    format!("ember-{}", short)
}

pub async fn log_event(
    state: &AppState,
    host_id: Option<&str>,
    workload_id: Option<&str>,
    volume_id: Option<&str>,
    kind: &str,
    message: &str,
) {
    let tenant_id: Option<String> = if let Some(workload_id) = workload_id {
        sqlx::query_as::<_, (Option<String>,)>("SELECT tenant_id FROM workloads WHERE id = ?")
            .bind(workload_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .and_then(|row| row.0)
    } else if let Some(volume_id) = volume_id {
        sqlx::query_as::<_, (Option<String>,)>("SELECT tenant_id FROM volumes WHERE id = ?")
            .bind(volume_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .and_then(|row| row.0)
    } else if let Some(host_id) = host_id {
        sqlx::query_as::<_, (Option<String>,)>("SELECT tenant_id FROM hosts WHERE id = ?")
            .bind(host_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .and_then(|row| row.0)
    } else {
        None
    };
    let _ = sqlx::query(
        "INSERT INTO events (host_id, workload_id, volume_id, kind, message, tenant_id) VALUES (?,?,?,?,?,?)",
    )
    .bind(host_id)
    .bind(workload_id)
    .bind(volume_id)
    .bind(kind)
    .bind(message)
    .bind(tenant_id)
    .execute(&state.pool)
    .await;
}

async fn persist_workload_log_chunk(
    state: &AppState,
    host_id: &str,
    workload_id: &str,
    lines: &[LogLine],
) {
    if lines.is_empty() {
        return;
    }
    let row: Option<(String,)> = match sqlx::query_as(
        "SELECT tenant_id FROM workloads WHERE id = ? AND host_id = ?",
    )
    .bind(workload_id)
    .bind(host_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = ?e, %workload_id, "workload log chunk tenant lookup failed");
            return;
        }
    };
    let Some((tenant_id,)) = row else { return };
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = ?e, "workload log chunk persistence begin failed");
            return;
        }
    };
    for line in lines {
        let ts = line
            .timestamp
            .as_deref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc))
            .unwrap_or_else(Utc::now);
        if let Err(e) = sqlx::query(
            "INSERT INTO workload_logs (tenant_id, workload_id, host_id, ts, stream, message) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&tenant_id)
        .bind(workload_id)
        .bind(host_id)
        .bind(ts)
        .bind(&line.stream)
        .bind(&line.message)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = ?e, "workload log chunk insert failed");
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = ?e, "workload log chunk commit failed");
    }
}

async fn persist_agent_logs(state: &AppState, host_id: &str, batch: &[AgentLogLine]) {
    if batch.is_empty() {
        return;
    }
    let row: Option<(String,)> = match sqlx::query_as("SELECT tenant_id FROM hosts WHERE id = ?")
        .bind(host_id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = ?e, %host_id, "agent log tenant lookup failed");
            return;
        }
    };
    let Some((tenant_id,)) = row else { return };
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = ?e, "agent log persistence begin failed");
            return;
        }
    };
    for line in batch {
        let ts = chrono::DateTime::parse_from_rfc3339(&line.ts)
            .map(|value| value.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());
        if let Err(e) = sqlx::query(
            "INSERT INTO agent_logs (tenant_id, host_id, ts, level, target, message) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&tenant_id)
        .bind(host_id)
        .bind(ts)
        .bind(&line.level)
        .bind(&line.target)
        .bind(&line.message)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = ?e, "agent log insert failed");
        }
        if line.level == "ERROR" && line.message.to_lowercase().contains("panic") {
            log_event(
                state,
                Some(host_id),
                None,
                None,
                "host.agent.crash",
                &line.message,
            )
            .await;
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = ?e, "agent log commit failed");
    }
}
