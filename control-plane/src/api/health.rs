use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use ember_shared::protocol::Health;

pub async fn get_health(State(_state): State<AppState>) -> Json<Health> {
    Json(Health {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}
