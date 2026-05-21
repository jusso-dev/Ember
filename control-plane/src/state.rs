use crate::agent_ws::Registry;
use sqlx::SqlitePool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub admin_hash: Option<Arc<String>>,
    pub registry: Registry,
    pub public_base_url: Arc<String>,
}

impl AppState {
    pub fn new(pool: SqlitePool, admin_hash: Option<String>, public_base_url: String) -> Self {
        Self {
            pool,
            admin_hash: admin_hash.map(Arc::new),
            registry: Registry::new(),
            public_base_url: Arc::new(public_base_url),
        }
    }
}
