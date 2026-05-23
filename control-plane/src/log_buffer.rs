use chrono::{DateTime, Utc};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
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

    pub fn snapshot(&self, limit: usize, min_level: Option<&str>) -> Vec<LogEntry> {
        let q = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let min_rank = min_level.map(level_rank).unwrap_or(0);
        let mut out: Vec<LogEntry> = q
            .iter()
            .rev()
            .filter(|e| level_rank(&e.level) >= min_rank)
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
}

impl BufferLayer {
    pub fn new(buffer: Arc<LogBuffer>) -> Self {
        Self { buffer }
    }
}

#[derive(Default)]
struct MessageVisitor {
    message: Option<String>,
    fields: Vec<(String, String)>,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = Some(format!("{:?}", value));
        } else {
            self.fields
                .push((field.name().to_string(), format!("{:?}", value)));
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = Some(value.to_string());
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

        self.buffer.push(LogEntry {
            ts: Utc::now(),
            level: metadata.level().to_string(),
            target: metadata.target().to_string(),
            message: trimmed,
        });
    }
}
