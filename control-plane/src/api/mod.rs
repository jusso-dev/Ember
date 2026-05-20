mod health;

use axum::{routing::get, Router};
use sqlx::SqlitePool;
use tower_http::trace::TraceLayer;

pub fn router(pool: SqlitePool) -> Router {
    Router::new()
        .route("/api/health", get(health::get_health))
        .with_state(pool)
        .layer(TraceLayer::new_for_http())
}
