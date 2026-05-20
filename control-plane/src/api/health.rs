use axum::{extract::State, Json};
use ember_shared::protocol::Health;
use sqlx::SqlitePool;

pub async fn get_health(State(_pool): State<SqlitePool>) -> Json<Health> {
    Json(Health {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}
