use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::auth::{random_token, sha256_hex, AdminSession};
use crate::crypto;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use ember_shared::protocol::{MfaConfirmRequest, MfaSetupResponse, MfaStatus};
use uuid::Uuid;

pub async fn status(admin: AdminSession, State(state): State<AppState>) -> Result<Json<MfaStatus>, AppError> {
    let (enabled,): (i64,) = sqlx::query_as("SELECT mfa_enabled FROM users WHERE id = ?")
        .bind(&admin.user.id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(MfaStatus {
        enabled: enabled != 0,
    }))
}

pub async fn setup_begin(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MfaSetupResponse>, AppError> {
    let secret = crypto::generate_totp_secret();
    sqlx::query("UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?")
        .bind(&secret)
        .bind(&admin.user.id)
        .execute(&state.pool)
        .await?;

    // Replace recovery codes.
    sqlx::query("DELETE FROM mfa_recovery_codes WHERE user_id = ?")
        .bind(&admin.user.id)
        .execute(&state.pool)
        .await?;
    let mut recovery_codes = Vec::with_capacity(8);
    for _ in 0..8 {
        let code = random_token(5).chars().take(10).collect::<String>().to_uppercase();
        let id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)",
        )
        .bind(&id)
        .bind(&admin.user.id)
        .bind(sha256_hex(&code))
        .execute(&state.pool)
        .await?;
        recovery_codes.push(code);
    }

    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "auth.mfa.setup_begin",
        Some("user"),
        Some(&admin.user.id),
        RESULT_SUCCESS,
        None,
    )
    .await;

    Ok(Json(MfaSetupResponse {
        secret: secret.clone(),
        otpauth_url: crypto::otpauth_url(&admin.user.email, &secret),
        recovery_codes,
    }))
}

pub async fn setup_confirm(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<MfaConfirmRequest>,
) -> Result<Json<MfaStatus>, AppError> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT mfa_secret FROM users WHERE id = ?")
            .bind(&admin.user.id)
            .fetch_optional(&state.pool)
            .await?;
    let secret = row
        .and_then(|r| r.0)
        .ok_or_else(|| AppError::BadRequest("start MFA setup first".into()))?;
    if !crypto::verify_totp(&secret, &req.totp_code) {
        return Err(AppError::BadRequest("invalid TOTP code".into()));
    }
    sqlx::query("UPDATE users SET mfa_enabled = 1 WHERE id = ?")
        .bind(&admin.user.id)
        .execute(&state.pool)
        .await?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "auth.mfa.enable",
        Some("user"),
        Some(&admin.user.id),
        RESULT_SUCCESS,
        None,
    )
    .await;
    Ok(Json(MfaStatus { enabled: true }))
}

pub async fn disable(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<MfaConfirmRequest>,
) -> Result<Json<MfaStatus>, AppError> {
    let row: Option<(i64, Option<String>)> =
        sqlx::query_as("SELECT mfa_enabled, mfa_secret FROM users WHERE id = ?")
            .bind(&admin.user.id)
            .fetch_optional(&state.pool)
            .await?;
    let (enabled, secret) = row.unwrap_or((0, None));
    if enabled == 0 {
        return Ok(Json(MfaStatus { enabled: false }));
    }
    let secret = secret.unwrap_or_default();
    if !crypto::verify_totp(&secret, &req.totp_code) {
        return Err(AppError::Unauthorized);
    }
    sqlx::query("UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?")
        .bind(&admin.user.id)
        .execute(&state.pool)
        .await?;
    sqlx::query("DELETE FROM mfa_recovery_codes WHERE user_id = ?")
        .bind(&admin.user.id)
        .execute(&state.pool)
        .await?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "auth.mfa.disable",
        Some("user"),
        Some(&admin.user.id),
        RESULT_SUCCESS,
        None,
    )
    .await;
    Ok(Json(MfaStatus { enabled: false }))
}
