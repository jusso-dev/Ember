use crate::error::AppError;
use crate::state::AppState;
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use sha2::{Digest, Sha256};

pub const SESSION_COOKIE: &str = "ember_session";
pub const SESSION_TTL_SECS: i64 = 60 * 60 * 24 * 7; // 7 days

pub fn hash_password(pw: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("argon2 hash: {e}"))?
        .to_string();
    Ok(hash)
}

pub fn verify_password(pw: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(pw.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

pub fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

pub fn sha256_hex(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    hex::encode(digest)
}

pub async fn create_session(pool: &sqlx::SqlitePool) -> anyhow::Result<(String, DateTime<Utc>)> {
    let token = random_token(32);
    let expires = Utc::now() + chrono::Duration::seconds(SESSION_TTL_SECS);
    sqlx::query("INSERT INTO sessions (token, expires_at) VALUES (?, ?)")
        .bind(&token)
        .bind(expires)
        .execute(pool)
        .await?;
    Ok((token, expires))
}

pub async fn destroy_session(pool: &sqlx::SqlitePool, token: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM sessions WHERE token = ?")
        .bind(token)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn session_valid(pool: &sqlx::SqlitePool, token: &str) -> anyhow::Result<bool> {
    let row: Option<(DateTime<Utc>,)> =
        sqlx::query_as("SELECT expires_at FROM sessions WHERE token = ?")
            .bind(token)
            .fetch_optional(pool)
            .await?;
    Ok(match row {
        Some((exp,)) => exp > Utc::now(),
        None => false,
    })
}

pub fn session_cookie(token: &str, max_age_secs: i64) -> String {
    format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_secs}"
    )
}

pub fn clear_session_cookie() -> String {
    format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
}

fn cookie_from_header(parts: &Parts) -> Option<String> {
    let header = parts.headers.get(axum::http::header::COOKIE)?.to_str().ok()?;
    for pair in header.split(';') {
        let mut it = pair.trim().splitn(2, '=');
        let k = it.next()?;
        let v = it.next()?;
        if k == SESSION_COOKIE {
            return Some(v.to_string());
        }
    }
    None
}

pub struct AdminSession;

#[async_trait]
impl FromRequestParts<AppState> for AdminSession {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if state.admin_hash.is_none() {
            return Err(AppError::Unauthorized);
        }
        let token = cookie_from_header(parts).ok_or(AppError::Unauthorized)?;
        let ok = session_valid(&state.pool, &token)
            .await
            .map_err(AppError::Anyhow)?;
        if ok {
            Ok(AdminSession)
        } else {
            Err(AppError::Unauthorized)
        }
    }
}

pub fn bearer_token(parts: &Parts) -> Option<String> {
    let header = parts
        .headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    header.strip_prefix("Bearer ").map(|s| s.to_string())
}
