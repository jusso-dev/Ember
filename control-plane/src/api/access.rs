use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::auth::{random_token, sha256_hex, AdminSession};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{
    CreateTenantInvitationRequest, RolePermissionSummary, TenantAccessSummary,
    TenantInvitationSummary, TenantMemberSummary,
};
use serde_json::json;
use uuid::Uuid;

pub async fn current(
    admin: AdminSession,
    State(state): State<AppState>,
) -> Result<Json<TenantAccessSummary>, AppError> {
    let members: Vec<(String, String, String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT users.id, users.email, users.name, tenant_memberships.role, tenant_memberships.created_at \
         FROM tenant_memberships JOIN users ON users.id = tenant_memberships.user_id \
         WHERE tenant_memberships.tenant_id = ? AND users.disabled_at IS NULL \
         ORDER BY tenant_memberships.created_at ASC",
    )
    .bind(&admin.tenant.id)
    .fetch_all(&state.pool)
    .await?;

    let invitations: Vec<(String, String, String, DateTime<Utc>, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, email, role, expires_at, created_at \
         FROM tenant_invitations \
         WHERE tenant_id = ? AND accepted_at IS NULL AND expires_at > CURRENT_TIMESTAMP \
         ORDER BY created_at DESC",
    )
    .bind(&admin.tenant.id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(TenantAccessSummary {
        tenant: admin.tenant,
        members: members
            .into_iter()
            .map(|m| TenantMemberSummary {
                user_id: m.0,
                email: m.1,
                name: m.2,
                role: m.3,
                created_at: m.4.to_rfc3339(),
            })
            .collect(),
        invitations: invitations
            .into_iter()
            .map(|i| TenantInvitationSummary {
                id: i.0,
                email: i.1,
                role: i.2,
                expires_at: i.3.to_rfc3339(),
                created_at: i.4.to_rfc3339(),
                invite_url: None,
            })
            .collect(),
        role_matrix: role_matrix(),
    }))
}

pub async fn create_invitation(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateTenantInvitationRequest>,
) -> Result<Json<TenantInvitationSummary>, AppError> {
    require_access_admin(&admin)?;
    let email = super::auth::normalize_email(&req.email)?;
    validate_invite_role(&req.role)?;

    let existing_member: Option<(String,)> = sqlx::query_as(
        "SELECT users.id FROM users \
         JOIN tenant_memberships ON tenant_memberships.user_id = users.id \
         WHERE users.email = ? AND tenant_memberships.tenant_id = ?",
    )
    .bind(&email)
    .bind(&admin.tenant.id)
    .fetch_optional(&state.pool)
    .await?;
    if existing_member.is_some() {
        return Err(AppError::Conflict("user is already a tenant member".into()));
    }

    let token = random_token(32);
    let token_hash = sha256_hex(&token);
    let id = Uuid::now_v7().to_string();
    let expires_at = Utc::now() + chrono::Duration::hours(72);
    sqlx::query(
        "INSERT INTO tenant_invitations (id, tenant_id, email, role, token_hash, expires_at, created_by) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(tenant_id, email) DO UPDATE SET \
           id = excluded.id, role = excluded.role, token_hash = excluded.token_hash, expires_at = excluded.expires_at, \
           accepted_at = NULL, created_by = excluded.created_by, created_at = CURRENT_TIMESTAMP",
    )
    .bind(&id)
    .bind(&admin.tenant.id)
    .bind(&email)
    .bind(&req.role)
    .bind(&token_hash)
    .bind(expires_at)
    .bind(&admin.user.id)
    .execute(&state.pool)
    .await?;

    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "access.invitation.create",
        Some("invitation"),
        Some(&id),
        RESULT_SUCCESS,
        Some(json!({ "email": email, "role": req.role })),
    )
    .await;

    Ok(Json(TenantInvitationSummary {
        id,
        email,
        role: req.role,
        expires_at: expires_at.to_rfc3339(),
        created_at: Utc::now().to_rfc3339(),
        invite_url: Some(format!(
            "{}/login?invite={}",
            state.public_base_url.as_str(),
            token
        )),
    }))
}

pub async fn delete_invitation(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    require_access_admin(&admin)?;
    sqlx::query("DELETE FROM tenant_invitations WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&admin.tenant.id)
        .execute(&state.pool)
        .await?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "access.invitation.delete",
        Some("invitation"),
        Some(&id),
        RESULT_SUCCESS,
        None,
    )
    .await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub async fn remove_member(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    require_access_admin(&admin)?;
    if user_id == admin.user.id {
        return Err(AppError::BadRequest("you cannot remove yourself".into()));
    }

    let target: Option<(String,)> =
        sqlx::query_as("SELECT role FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?")
            .bind(&admin.tenant.id)
            .bind(&user_id)
            .fetch_optional(&state.pool)
            .await?;
    let Some((target_role,)) = target else {
        return Err(AppError::NotFound);
    };
    if target_role == "owner" {
        let owners: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM tenant_memberships WHERE tenant_id = ? AND role = 'owner'")
                .bind(&admin.tenant.id)
                .fetch_one(&state.pool)
                .await?;
        if owners.0 <= 1 {
            return Err(AppError::BadRequest("tenant must keep at least one owner".into()));
        }
    }

    sqlx::query("DELETE FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?")
        .bind(&admin.tenant.id)
        .bind(&user_id)
        .execute(&state.pool)
        .await?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "access.member.remove",
        Some("user"),
        Some(&user_id),
        RESULT_SUCCESS,
        Some(json!({ "removed_role": target_role })),
    )
    .await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

fn require_access_admin(admin: &AdminSession) -> Result<(), AppError> {
    match admin.tenant.role.as_str() {
        "owner" | "admin" => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}

fn validate_invite_role(role: &str) -> Result<(), AppError> {
    match role {
        "admin" | "operator" | "viewer" | "auditor" => Ok(()),
        "owner" => Err(AppError::BadRequest(
            "owner role cannot be granted by invitation".into(),
        )),
        _ => Err(AppError::BadRequest("unknown tenant role".into())),
    }
}

fn role_matrix() -> Vec<RolePermissionSummary> {
    vec![
        RolePermissionSummary {
            role: "owner".into(),
            description: "Full tenant control, including users, roles, MFA policy, infrastructure, and tokens.".into(),
            permissions: vec![
                "Manage tenant settings".into(),
                "Invite and remove users".into(),
                "Manage infrastructure".into(),
                "Create enrollment tokens".into(),
            ],
        },
        RolePermissionSummary {
            role: "admin".into(),
            description: "Manage users below owner level and operate all infrastructure.".into(),
            permissions: vec![
                "Invite users".into(),
                "Manage infrastructure".into(),
                "Create enrollment tokens".into(),
            ],
        },
        RolePermissionSummary {
            role: "operator".into(),
            description: "Deploy and operate workloads, volumes, and host actions.".into(),
            permissions: vec!["Create workloads".into(), "Start and stop workloads".into(), "Create volumes".into()],
        },
        RolePermissionSummary {
            role: "viewer".into(),
            description: "Read-only access to resources and activity.".into(),
            permissions: vec!["View resources".into(), "View activity".into()],
        },
        RolePermissionSummary {
            role: "auditor".into(),
            description: "Read-only access focused on security and activity review.".into(),
            permissions: vec!["View resources".into(), "View activity".into(), "View access state".into()],
        },
    ]
}
