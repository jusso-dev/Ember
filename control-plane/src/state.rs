use crate::agent_ws::Registry;
use sqlx::SqlitePool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub registry: Registry,
    pub public_base_url: Arc<String>,
}

impl AppState {
    pub fn new(pool: SqlitePool, public_base_url: String) -> Self {
        Self {
            pool,
            registry: Registry::new(),
            public_base_url: Arc::new(public_base_url),
        }
    }
}
