use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tracing::field::{Field, Visit};
use tracing::{Event, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

#[derive(Debug, Clone)]
pub struct LogEntry {
    pub ts: DateTime<Utc>,
    pub level: String,
    pub target: String,
    pub message: String,
    pub fields_json: Option<String>,
    pub tenant_id: Option<String>,
}

pub struct LogBuffer {
    capacity: usize,
    inner: Mutex<VecDeque<LogEntry>>,
}

impl LogBuffer {
    pub fn new(capacity: usize) -> Arc<Self> {
        Arc::new(Self {
            capacity,
            inner: Mutex::new(VecDeque::with_capacity(capacity)),
        })
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn push(&self, entry: LogEntry) {
        let mut q = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if q.len() == self.capacity {
            q.pop_front();
        }
        q.push_back(entry);
    }

    pub fn snapshot(
        &self,
        limit: usize,
        min_level: Option<&str>,
        tenant_id: Option<&str>,
        include_global: bool,
    ) -> Vec<LogEntry> {
        let q = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let min_rank = min_level.map(level_rank).unwrap_or(0);
        let mut out: Vec<LogEntry> = q
            .iter()
            .rev()
            .filter(|e| level_rank(&e.level) >= min_rank)
            .filter(|e| match tenant_id {
                Some(tenant_id) => {
                    e.tenant_id.as_deref() == Some(tenant_id)
                        || (include_global && e.tenant_id.is_none())
                }
                None => true,
            })
            .take(limit)
            .cloned()
            .collect();
        out.reverse();
        out
    }
}

fn level_rank(level: &str) -> u8 {
    match level {
        "TRACE" | "trace" => 0,
        "DEBUG" | "debug" => 1,
        "INFO" | "info" => 2,
        "WARN" | "warn" => 3,
        "ERROR" | "error" => 4,
        _ => 0,
    }
}

pub struct BufferLayer {
    buffer: Arc<LogBuffer>,
    persisted_tx: Option<tokio::sync::mpsc::Sender<LogEntry>>,
}

impl BufferLayer {
    pub fn new(buffer: Arc<LogBuffer>) -> Self {
        Self {
            buffer,
            persisted_tx: None,
        }
    }

    pub fn with_persisted_tx(mut self, tx: tokio::sync::mpsc::Sender<LogEntry>) -> Self {
        self.persisted_tx = Some(tx);
        self
    }
}

#[derive(Default)]
struct MessageVisitor {
    message: Option<String>,
    fields: Vec<(String, String)>,
    tenant_id: Option<String>,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = Some(format!("{:?}", value));
        } else if field.name() == "tenant_id" {
            self.tenant_id = Some(format!("{:?}", value).trim_matches('"').to_string());
        } else {
            self.fields
                .push((field.name().to_string(), format!("{:?}", value)));
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = Some(value.to_string());
        } else if field.name() == "tenant_id" {
            self.tenant_id = Some(value.to_string());
        } else {
            self.fields
                .push((field.name().to_string(), value.to_string()));
        }
    }
}

impl<S> Layer<S> for BufferLayer
where
    S: Subscriber,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);

        let mut message = visitor.message.unwrap_or_default();
        if !visitor.fields.is_empty() {
            let extras = visitor
                .fields
                .iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect::<Vec<_>>()
                .join(" ");
            if message.is_empty() {
                message = extras;
            } else {
                message.push(' ');
                message.push_str(&extras);
            }
        }

        // Strip surrounding quotes that Debug formatting can add for &str values.
        let trimmed = message.trim().to_string();

        let fields_json = if visitor.fields.is_empty() {
            None
        } else {
            Some(
                serde_json::to_string(
                    &visitor
                        .fields
                        .iter()
                        .cloned()
                        .collect::<std::collections::BTreeMap<_, _>>(),
                )
                .unwrap_or_else(|_| "{}".into()),
            )
        };

        let entry = LogEntry {
            ts: Utc::now(),
            level: metadata.level().to_string(),
            target: metadata.target().to_string(),
            message: trimmed,
            fields_json,
            tenant_id: visitor.tenant_id,
        };

        self.buffer.push(entry.clone());
        if let Some(tx) = &self.persisted_tx {
            let _ = tx.try_send(entry);
        }
    }
}

pub async fn persist_writer(pool: SqlitePool, mut rx: tokio::sync::mpsc::Receiver<LogEntry>) {
    let mut batch = Vec::with_capacity(256);
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    loop {
        tokio::select! {
            maybe_entry = rx.recv() => {
                match maybe_entry {
                    Some(entry) => {
                        batch.push(entry);
                        if batch.len() >= 256 {
                            flush(&pool, &mut batch).await;
                        }
                    }
                    None => {
                        flush(&pool, &mut batch).await;
                        break;
                    }
                }
            }
            _ = tick.tick() => {
                flush(&pool, &mut batch).await;
            }
        }
    }
}

async fn flush(pool: &SqlitePool, batch: &mut Vec<LogEntry>) {
    if batch.is_empty() {
        return;
    }

    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            eprintln!("control-plane log persistence begin failed: {e:?}");
            batch.clear();
            return;
        }
    };

    for entry in batch.drain(..) {
        if let Err(e) = sqlx::query(
            "INSERT INTO control_plane_logs (ts, level, target, message, fields_json, tenant_id) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(entry.ts)
        .bind(entry.level)
        .bind(entry.target)
        .bind(entry.message)
        .bind(entry.fields_json)
        .bind(entry.tenant_id)
        .execute(&mut *tx)
        .await
        {
            eprintln!("control-plane log persistence insert failed: {e:?}");
        }
    }

    if let Err(e) = tx.commit().await {
        eprintln!("control-plane log persistence commit failed: {e:?}");
    }
}
