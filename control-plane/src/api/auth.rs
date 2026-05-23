use crate::auth::{
    clear_session_cookie, create_session, destroy_session, hash_password, session_cookie,
    session_identity, users_count, verify_password, AdminSession, SESSION_COOKIE, SESSION_TTL_SECS,
};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::State;
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use ember_shared::protocol::{CreateFirstUserRequest, LoginRequest, SessionInfo, TenantInfo, UserInfo};
use uuid::Uuid;

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    let email = normalize_email(&body.email)?;
    let row: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, email, name, password_hash FROM users WHERE email = ? AND disabled_at IS NULL",
    )
    .bind(email)
    .fetch_optional(&state.pool)
    .await?;
    let Some((id, email, name, password_hash)) = row else {
        return Err(AppError::Unauthorized);
    };
    if !verify_password(&body.password, &password_hash) {
        return Err(AppError::Unauthorized);
    }
    let tenant: (String, String, String, String) = sqlx::query_as(
        "SELECT t.id, t.name, t.slug, tm.role \
         FROM tenant_memberships tm JOIN tenants t ON t.id = tm.tenant_id \
         WHERE tm.user_id = ? ORDER BY tm.created_at ASC LIMIT 1",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;
    let active_tenant = TenantInfo {
        id: tenant.0,
        name: tenant.1,
        slug: tenant.2,
        role: tenant.3,
    };
    let (token, _exp) = create_session(&state.pool, &id, &active_tenant.id)
        .await
        .map_err(AppError::Anyhow)?;
    let mut headers = HeaderMap::new();
    headers.insert(SET_COOKIE, session_cookie(&token, SESSION_TTL_SECS).parse().unwrap());
    Ok((
        StatusCode::OK,
        headers,
        Json(SessionInfo {
            authenticated: true,
            setup_required: false,
            user: Some(UserInfo {
                id,
                email,
                name,
                role: active_tenant.role.clone(),
            }),
            active_tenant: Some(active_tenant),
        }),
    ))
}

pub async fn create_first_user(
    State(state): State<AppState>,
    Json(body): Json<CreateFirstUserRequest>,
) -> Result<impl IntoResponse, AppError> {
    if users_count(&state.pool).await.map_err(AppError::Anyhow)? > 0 {
        return Err(AppError::Conflict("initial user already exists".into()));
    }

    let email = normalize_email(&body.email)?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest("password must be at least 8 characters".into()));
    }
    let tenant_name = if body.tenant_name.trim().is_empty() {
        format!("{name}'s tenant")
    } else {
        body.tenant_name.trim().to_string()
    };

    let id = Uuid::now_v7().to_string();
    let tenant_id = Uuid::now_v7().to_string();
    let tenant_slug = slugify(&tenant_name, &tenant_id);
    let role = "owner".to_string();
    let password_hash = hash_password(&body.password).map_err(AppError::Anyhow)?;
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&email)
    .bind(name)
    .bind(&password_hash)
    .bind(&role)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO tenants (id, name, slug, created_by) VALUES (?, ?, ?, ?)")
    .bind(&tenant_id)
    .bind(&tenant_name)
    .bind(&tenant_slug)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES (?, ?, ?)")
    .bind(&tenant_id)
    .bind(&id)
    .bind(&role)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let (token, _exp) = create_session(&state.pool, &id, &tenant_id)
        .await
        .map_err(AppError::Anyhow)?;
    let mut headers = HeaderMap::new();
    headers.insert(SET_COOKIE, session_cookie(&token, SESSION_TTL_SECS).parse().unwrap());
    Ok((
        StatusCode::CREATED,
        headers,
        Json(SessionInfo {
            authenticated: true,
            setup_required: false,
            user: Some(UserInfo {
                id,
                email,
                name: name.to_string(),
                role: role.clone(),
            }),
            active_tenant: Some(TenantInfo {
                id: tenant_id,
                name: tenant_name,
                slug: tenant_slug,
                role,
            }),
        }),
    ))
}

pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    if let Some(token) = read_cookie(&headers) {
        let _ = destroy_session(&state.pool, &token).await;
    }
    let mut out = HeaderMap::new();
    out.insert(SET_COOKIE, clear_session_cookie().parse().unwrap());
    let setup_required = users_count(&state.pool).await.unwrap_or(0) == 0;
    Ok((
        StatusCode::OK,
        out,
        Json(SessionInfo {
            authenticated: false,
            setup_required,
            user: None,
            active_tenant: None,
        }),
    ))
}

pub async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<SessionInfo> {
    let setup_required = users_count(&state.pool).await.unwrap_or(0) == 0;
    let Some(token) = read_cookie(&headers) else {
        return Json(SessionInfo {
            authenticated: false,
            setup_required,
            user: None,
            active_tenant: None,
        });
    };
    let identity = session_identity(&state.pool, &token).await.unwrap_or(None);
    let (user, active_tenant) = match identity {
        Some(identity) => (Some(identity.0), Some(identity.1)),
        None => (None, None),
    };
    Json(SessionInfo {
        authenticated: user.is_some(),
        setup_required,
        user,
        active_tenant,
    })
}

fn read_cookie(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(COOKIE)?.to_str().ok()?;
    for pair in raw.split(';') {
        let mut it = pair.trim().splitn(2, '=');
        let k = it.next()?;
        let v = it.next()?;
        if k == SESSION_COOKIE {
            return Some(v.to_string());
        }
    }
    None
}

// Re-export so other modules can require admin.
pub type _Admin = AdminSession;

pub(crate) fn normalize_email(email: &str) -> Result<String, AppError> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') || email.len() > 254 {
        return Err(AppError::BadRequest("valid email is required".into()));
    }
    Ok(email)
}

fn slugify(name: &str, fallback: &str) -> String {
    let mut slug = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        slug = "tenant".into();
    }
    if !fallback.is_empty() {
        slug.push('-');
        slug.push_str(&fallback.chars().take(8).collect::<String>());
    }
    slug
}
