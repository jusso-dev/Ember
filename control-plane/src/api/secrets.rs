use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::auth::AdminSession;
use crate::crypto;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{
    CreateRegistryCredentialRequest, CreateSecretRequest, RegistryCredentialSummary, SecretSummary,
};
use serde_json::json;
use uuid::Uuid;

pub async fn list_secrets(
    admin: AdminSession,
    State(state): State<AppState>,
) -> Result<Json<Vec<SecretSummary>>, AppError> {
    let rows: Vec<(String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, name, created_at FROM secrets WHERE tenant_id = ? ORDER BY name ASC",
    )
    .bind(&admin.tenant.id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| SecretSummary {
                id: r.0,
                name: r.1,
                created_at: r.2.to_rfc3339(),
            })
            .collect(),
    ))
}

pub async fn create_secret(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateSecretRequest>,
) -> Result<Json<SecretSummary>, AppError> {
    if !matches!(
        admin.tenant.role.as_str(),
        "owner" | "admin" | "operator"
    ) {
        return Err(AppError::Forbidden);
    }
    let name = req.name.trim();
    if name.is_empty() || req.value.is_empty() {
        return Err(AppError::BadRequest("name and value required".into()));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(AppError::BadRequest(
            "secret name must be alphanumeric/._-".into(),
        ));
    }
    let id = Uuid::now_v7().to_string();
    let cipher = crypto::encrypt_secret(&req.value).map_err(AppError::Anyhow)?;
    sqlx::query(
        "INSERT INTO secrets (id, tenant_id, name, ciphertext, created_by) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&admin.tenant.id)
    .bind(name)
    .bind(&cipher)
    .bind(&admin.user.id)
    .execute(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("secret name exists".into())
        }
        other => AppError::Sqlx(other),
    })?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "secret.create",
        Some("secret"),
        Some(&id),
        RESULT_SUCCESS,
        Some(json!({ "name": name })),
    )
    .await;
    Ok(Json(SecretSummary {
        id,
        name: name.to_string(),
        created_at: Utc::now().to_rfc3339(),
    }))
}

pub async fn delete_secret(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    if !matches!(admin.tenant.role.as_str(), "owner" | "admin") {
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM secrets WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&admin.tenant.id)
        .execute(&state.pool)
        .await?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "secret.delete",
        Some("secret"),
        Some(&id),
        RESULT_SUCCESS,
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

/// Resolve env values: `secret:NAME` pulls from tenant secrets vault.
pub async fn resolve_env(
    pool: &sqlx::SqlitePool,
    tenant_id: &str,
    env: &[(String, String)],
) -> Result<Vec<(String, String)>, AppError> {
    let mut out = Vec::with_capacity(env.len());
    for (k, v) in env {
        if let Some(name) = v.strip_prefix("secret:") {
            let row: Option<(String,)> =
                sqlx::query_as("SELECT ciphertext FROM secrets WHERE tenant_id = ? AND name = ?")
                    .bind(tenant_id)
                    .bind(name.trim())
                    .fetch_optional(pool)
                    .await?;
            let cipher = row
                .ok_or_else(|| AppError::BadRequest(format!("unknown secret: {name}")))?
                .0;
            let plain = crypto::decrypt_secret(&cipher).map_err(AppError::Anyhow)?;
            out.push((k.clone(), plain));
        } else {
            out.push((k.clone(), v.clone()));
        }
    }
    Ok(out)
}

pub async fn list_registry(
    admin: AdminSession,
    State(state): State<AppState>,
) -> Result<Json<Vec<RegistryCredentialSummary>>, AppError> {
    let rows: Vec<(String, String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, registry, username, created_at FROM registry_credentials \
         WHERE tenant_id = ? ORDER BY registry ASC",
    )
    .bind(&admin.tenant.id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| RegistryCredentialSummary {
                id: r.0,
                registry: r.1,
                username: r.2,
                created_at: r.3.to_rfc3339(),
            })
            .collect(),
    ))
}

pub async fn create_registry(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateRegistryCredentialRequest>,
) -> Result<Json<RegistryCredentialSummary>, AppError> {
    if !matches!(admin.tenant.role.as_str(), "owner" | "admin") {
        return Err(AppError::Forbidden);
    }
    let id = Uuid::now_v7().to_string();
    let cipher = crypto::encrypt_secret(&req.password).map_err(AppError::Anyhow)?;
    sqlx::query(
        "INSERT INTO registry_credentials (id, tenant_id, registry, username, password_cipher) \
         VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT(tenant_id, registry) DO UPDATE SET username = excluded.username, \
           password_cipher = excluded.password_cipher",
    )
    .bind(&id)
    .bind(&admin.tenant.id)
    .bind(req.registry.trim())
    .bind(req.username.trim())
    .bind(&cipher)
    .execute(&state.pool)
    .await?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "registry_credential.upsert",
        Some("registry"),
        Some(req.registry.trim()),
        RESULT_SUCCESS,
        Some(json!({ "registry": req.registry, "username": req.username })),
    )
    .await;
    Ok(Json(RegistryCredentialSummary {
        id,
        registry: req.registry.trim().to_string(),
        username: req.username.trim().to_string(),
        created_at: Utc::now().to_rfc3339(),
    }))
}

pub async fn delete_registry(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    if !matches!(admin.tenant.role.as_str(), "owner" | "admin") {
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM registry_credentials WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&admin.tenant.id)
        .execute(&state.pool)
        .await?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "registry_credential.delete",
        Some("registry"),
        Some(&id),
        RESULT_SUCCESS,
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}
