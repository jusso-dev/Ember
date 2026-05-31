use crate::agent_ws::Registry;
use crate::config::Config;
use crate::log_buffer::LogBuffer;
use ember_shared::protocol::LogsResultData;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{oneshot, Mutex, OwnedSemaphorePermit, Semaphore};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub registry: Registry,
    pub public_base_url: Arc<String>,
    pub log_buffer: Arc<LogBuffer>,
    pub pending_logs: PendingLogs,
    pub pending_log_streams: PendingLogStreams,
    pub log_fetch_guards: HostSemaphoreMap,
    pub request_limiter: FixedWindowLimiter,
    pub audit_export_limiter: FixedWindowLimiter,
    pub audit_chain_lock: Arc<Mutex<()>>,
    pub config: Arc<RuntimeConfig>,
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

#[derive(Clone, Default)]
pub struct PendingLogStreams {
    inner: Arc<Mutex<HashMap<String, tokio::sync::mpsc::UnboundedSender<StreamLogEvent>>>>,
}

#[derive(Debug, Clone)]
pub enum StreamLogEvent {
    Lines(Vec<ember_shared::protocol::LogLine>),
    Ended(String),
}

impl PendingLogStreams {
    pub async fn insert(
        &self,
        subscription_id: String,
        tx: tokio::sync::mpsc::UnboundedSender<StreamLogEvent>,
    ) {
        self.inner.lock().await.insert(subscription_id, tx);
    }

    pub async fn send(&self, subscription_id: &str, event: StreamLogEvent) -> bool {
        let guard = self.inner.lock().await;
        guard
            .get(subscription_id)
            .map(|tx| tx.send(event).is_ok())
            .unwrap_or(false)
    }

    pub async fn take(
        &self,
        subscription_id: &str,
    ) -> Option<tokio::sync::mpsc::UnboundedSender<StreamLogEvent>> {
        self.inner.lock().await.remove(subscription_id)
    }
}

#[derive(Clone, Default)]
pub struct HostSemaphoreMap {
    inner: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
}

impl HostSemaphoreMap {
    pub async fn try_acquire(
        &self,
        host_id: &str,
        capacity: usize,
    ) -> Option<OwnedSemaphorePermit> {
        let semaphore = {
            let mut guard = self.inner.lock().await;
            guard
                .entry(host_id.to_string())
                .or_insert_with(|| Arc::new(Semaphore::new(capacity)))
                .clone()
        };
        semaphore.try_acquire_owned().ok()
    }
}

#[derive(Clone, Default)]
pub struct FixedWindowLimiter {
    inner: Arc<Mutex<HashMap<String, FixedWindow>>>,
}

#[derive(Debug, Clone)]
struct FixedWindow {
    started_at: Instant,
    count: u32,
}

impl FixedWindowLimiter {
    pub async fn check(
        &self,
        key: impl Into<String>,
        capacity: u32,
        window: Duration,
    ) -> Result<(), u64> {
        let now = Instant::now();
        let key = key.into();
        let mut guard = self.inner.lock().await;
        let entry = guard.entry(key).or_insert(FixedWindow {
            started_at: now,
            count: 0,
        });

        if now.duration_since(entry.started_at) >= window {
            entry.started_at = now;
            entry.count = 0;
        }

        if entry.count >= capacity {
            let retry = window
                .checked_sub(now.duration_since(entry.started_at))
                .unwrap_or_else(|| Duration::from_secs(1))
                .as_secs()
                .max(1);
            return Err(retry);
        }

        entry.count += 1;
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub audit_retention_days: i64,
    pub control_plane_log_retention_days: i64,
    pub workload_log_retention_days: i64,
    pub agent_log_retention_days: i64,
    pub audit_sinks: Vec<String>,
}

impl RuntimeConfig {
    pub fn from_config(config: &Config) -> Self {
        Self {
            audit_retention_days: config.audit_retention_days,
            control_plane_log_retention_days: config.control_plane_log_retention_days,
            workload_log_retention_days: config.workload_log_retention_days,
            agent_log_retention_days: config.agent_log_retention_days,
            audit_sinks: config.audit_sinks.clone(),
        }
    }
}

impl AppState {
    pub fn new(pool: SqlitePool, config: &Config, log_buffer: Arc<LogBuffer>) -> Self {
        Self {
            pool,
            registry: Registry::new(),
            public_base_url: Arc::new(config.public_base_url.clone()),
            log_buffer,
            pending_logs: PendingLogs::default(),
            pending_log_streams: PendingLogStreams::default(),
            log_fetch_guards: HostSemaphoreMap::default(),
            request_limiter: FixedWindowLimiter::default(),
            audit_export_limiter: FixedWindowLimiter::default(),
            audit_chain_lock: Arc::new(Mutex::new(())),
            config: Arc::new(RuntimeConfig::from_config(config)),
        }
    }
}
