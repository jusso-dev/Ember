mod access;
mod agent;
mod audit;
mod auth;
mod events;
mod health;
mod hosts;
mod logs;
mod volumes;
mod workloads;

use crate::state::AppState;
use axum::routing::{delete, get, post};
use axum::Router;
use tower_http::trace::TraceLayer;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::get_health))
        .route("/api/auth/setup", post(auth::create_first_user))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/session", get(auth::session))
        .route("/api/hosts", get(hosts::list))
        .route("/api/hosts/enroll-token", post(hosts::enroll_token))
        .route("/api/hosts/:id", get(hosts::get).delete(hosts::delete))
        .route("/api/hosts/:id/logs", get(logs::get_host_logs))
        .route(
            "/api/workloads",
            get(workloads::list).post(workloads::create),
        )
        .route("/api/workloads/:id", get(workloads::get))
        .route("/api/workloads/:id", delete(workloads::delete))
        .route("/api/workloads/:id/start", post(workloads::start))
        .route("/api/workloads/:id/stop", post(workloads::stop))
        .route("/api/workloads/:id/logs", get(logs::get_workload_logs))
        .route(
            "/api/workloads/:id/logs/stream",
            get(logs::stream_workload_logs),
        )
        .route("/api/volumes", get(volumes::list).post(volumes::create))
        .route("/api/volumes/:id", delete(volumes::delete))
        .route("/api/events", get(events::list))
        .route("/api/audit-logs", get(audit::list))
        .route("/api/audit-logs/export", get(audit::export))
        .route("/api/audit-logs/verify", get(audit::verify))
        .route("/api/control-plane/logs", get(logs::get_control_plane_logs))
        .route("/api/tenants/current", get(access::current))
        .route(
            "/api/tenants/current/invitations",
            post(access::create_invitation),
        )
        .route(
            "/api/tenants/current/audit-webhooks",
            post(access::create_audit_webhook),
        )
        .route(
            "/api/tenants/current/invitations/:id",
            delete(access::delete_invitation),
        )
        .route(
            "/api/tenants/current/audit-webhooks/:id",
            delete(access::delete_audit_webhook),
        )
        .route(
            "/api/tenants/current/members/:id",
            delete(access::remove_member),
        )
        .route("/api/agent/enroll", post(agent::enroll))
        .route("/api/agent/connect", get(crate::agent_ws::ws_upgrade))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}
