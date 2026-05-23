use crate::error::AppError;
use crate::state::AppState;
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use base64::Engine;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{TenantInfo, UserInfo};
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

pub async fn create_session(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    active_tenant_id: &str,
) -> anyhow::Result<(String, DateTime<Utc>)> {
    let token = random_token(32);
    let expires = Utc::now() + chrono::Duration::seconds(SESSION_TTL_SECS);
    sqlx::query("INSERT INTO sessions (token, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?)")
        .bind(&token)
        .bind(user_id)
        .bind(active_tenant_id)
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

pub async fn session_identity(
    pool: &sqlx::SqlitePool,
    token: &str,
) -> anyhow::Result<Option<(UserInfo, TenantInfo)>> {
    let row: Option<(
        DateTime<Utc>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> =
        sqlx::query_as(
            r#"
            SELECT sessions.expires_at,
                   users.id,
                   users.email,
                   users.name,
                   tenant_memberships.role,
                   tenants.id,
                   tenants.name,
                   tenants.slug,
                   tenant_memberships.role
            FROM sessions
            LEFT JOIN users ON users.id = sessions.user_id
            LEFT JOIN tenants ON tenants.id = sessions.active_tenant_id
            LEFT JOIN tenant_memberships
              ON tenant_memberships.tenant_id = tenants.id
             AND tenant_memberships.user_id = users.id
            WHERE sessions.token = ?
              AND users.disabled_at IS NULL
            "#,
        )
            .bind(token)
            .fetch_optional(pool)
            .await?;
    let Some((
        expires_at,
        Some(user_id),
        Some(email),
        Some(name),
        Some(user_role),
        Some(tenant_id),
        Some(tenant_name),
        Some(tenant_slug),
        Some(tenant_role),
    )) = row else {
        return Ok(None);
    };
    if expires_at <= Utc::now() {
        return Ok(None);
    }
    Ok(Some((
        UserInfo {
            id: user_id,
            email,
            name,
            role: user_role,
        },
        TenantInfo {
            id: tenant_id,
            name: tenant_name,
            slug: tenant_slug,
            role: tenant_role,
        },
    )))
}

pub async fn users_count(pool: &sqlx::SqlitePool) -> anyhow::Result<i64> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    Ok(count)
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

#[allow(dead_code)]
pub struct AdminSession {
    pub user: UserInfo,
    pub tenant: TenantInfo,
}

#[async_trait]
impl FromRequestParts<AppState> for AdminSession {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = cookie_from_header(parts).ok_or(AppError::Unauthorized)?;
        let identity = session_identity(&state.pool, &token)
            .await
            .map_err(AppError::Anyhow)?;
        identity
            .map(|(user, tenant)| AdminSession { user, tenant })
            .ok_or(AppError::Unauthorized)
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
