use crate::executor;
use crate::state::{self, AgentState};
use ember_shared::protocol::{AgentMsg, HelloPayload, ServerMsg};
use futures_util::{SinkExt, StreamExt};
use std::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

pub async fn run() -> anyhow::Result<()> {
    let s = state::load()?;
    let mut backoff = Duration::from_secs(1);
    loop {
        match connect_and_serve(&s).await {
            Ok(()) => {
                tracing::info!("ws closed; reconnecting");
                backoff = Duration::from_secs(1);
            }
            Err(e) => {
                tracing::warn!(error = ?e, "ws error; backing off {:?}", backoff);
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
            }
        }
    }
}

async fn connect_and_serve(s: &AgentState) -> anyhow::Result<()> {
    let ws_url = ws_url_from(&s.server_url);
    tracing::info!(%ws_url, "connecting");
    let mut req = ws_url.into_client_request()?;
    req.headers_mut().insert(
        "authorization",
        format!("Bearer {}", s.agent_token).parse().unwrap(),
    );
    let (ws, _resp) = tokio_tungstenite::connect_async(req).await?;
    let (mut tx, mut rx) = ws.split();

    // Hello
    let containers = executor::list_containers().await.unwrap_or_default();
    let hello = AgentMsg::Hello(HelloPayload {
        os: state::host_os(),
        arch: state::host_arch(),
        agent_version: state::agent_version(),
        containers,
    });
    tx.send(Message::Text(serde_json::to_string(&hello)?)).await?;

    // Heartbeat ticker.
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<AgentMsg>();
    let hb_tx = out_tx.clone();
    let hb_task = tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(15));
        tick.tick().await; // skip immediate
        loop {
            tick.tick().await;
            let containers = executor::list_containers().await.unwrap_or_default();
            if hb_tx.send(AgentMsg::Ping { containers }).is_err() {
                break;
            }
        }
    });

    // Writer task: pull from out_rx, send to ws.
    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            let text = match serde_json::to_string(&msg) {
                Ok(t) => t,
                Err(e) => {
                    tracing::error!(error = ?e, "serialize agent msg");
                    continue;
                }
            };
            if tx.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
        let _ = tx.close().await;
    });

    while let Some(frame) = rx.next().await {
        let text = match frame? {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };
        let msg: ServerMsg = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!(error = ?e, payload = %text, "bad ServerMsg");
                continue;
            }
        };
        match msg {
            ServerMsg::Pong => {}
            ServerMsg::Command { task_id, command } => {
                let tx_clone = out_tx.clone();
                tokio::spawn(async move {
                    let msg = executor::execute(task_id, &command).await;
                    let _ = tx_clone.send(msg);
                });
            }
        }
    }

    hb_task.abort();
    writer.abort();
    Ok(())
}

fn ws_url_from(server: &str) -> String {
    let trimmed = server.trim_end_matches('/');
    let with_scheme = if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{trimmed}")
    };
    format!("{with_scheme}/api/agent/connect")
}
