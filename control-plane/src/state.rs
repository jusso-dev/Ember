use crate::agent_ws::Registry;
use crate::log_buffer::LogBuffer;
use ember_shared::protocol::LogsResultData;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub registry: Registry,
    pub public_base_url: Arc<String>,
    pub log_buffer: Arc<LogBuffer>,
    pub pending_logs: PendingLogs,
}

#[derive(Clone, Default)]
pub struct PendingLogs {
    inner: Arc<Mutex<HashMap<String, oneshot::Sender<LogsResultData>>>>,
}

impl PendingLogs {
    pub async fn insert(&self, task_id: String, tx: oneshot::Sender<LogsResultData>) {
        self.inner.lock().await.insert(task_id, tx);
    }

    pub async fn take(&self, task_id: &str) -> Option<oneshot::Sender<LogsResultData>> {
        self.inner.lock().await.remove(task_id)
    }
}

impl AppState {
    pub fn new(pool: SqlitePool, public_base_url: String, log_buffer: Arc<LogBuffer>) -> Self {
        Self {
            pool,
            registry: Registry::new(),
            public_base_url: Arc::new(public_base_url),
            log_buffer,
            pending_logs: PendingLogs::default(),
        }
    }
}
