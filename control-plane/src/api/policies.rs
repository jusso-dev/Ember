use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::auth::AdminSession;
use crate::error::AppError;
use crate::policy::{self, Policy};
use crate::state::AppState;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use ember_shared::protocol::{TenantPolicy, UpdateTenantPolicyRequest};
use serde_json::json;

pub async fn get(
    admin: AdminSession,
    State(state): State<AppState>,
) -> Result<Json<TenantPolicy>, AppError> {
    let p = policy::load(&state.pool, &admin.tenant.id).await?;
    Ok(Json(p.into()))
}

pub async fn put(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpdateTenantPolicyRequest>,
) -> Result<Json<TenantPolicy>, AppError> {
    if !matches!(admin.tenant.role.as_str(), "owner" | "admin") {
        return Err(AppError::Forbidden);
    }
    let p = Policy {
        deny_latest_tag: req.deny_latest_tag,
        image_allowlist: req.image_allowlist,
        max_workloads: req.max_workloads,
        max_volumes: req.max_volumes,
        max_volume_mb_total: req.max_volume_mb_total,
        allowed_host_ports: req.allowed_host_ports,
        require_mfa_admins: req.require_mfa_admins,
    };
    policy::upsert(&state.pool, &admin.tenant.id, &p).await?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "policy.update",
        Some("tenant"),
        Some(&admin.tenant.id),
        RESULT_SUCCESS,
        Some(json!({ "deny_latest_tag": p.deny_latest_tag })),
    )
    .await;
    Ok(Json(p.into()))
}
