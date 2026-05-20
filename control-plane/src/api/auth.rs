use crate::auth::{
    clear_session_cookie, create_session, destroy_session, session_cookie, session_valid,
    verify_password, AdminSession, SESSION_COOKIE, SESSION_TTL_SECS,
};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::State;
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use ember_shared::protocol::{LoginRequest, SessionInfo};

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    let hash = state
        .admin_hash
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("admin password not configured".into()))?;
    if !verify_password(&body.password, hash) {
        return Err(AppError::Unauthorized);
    }
    let (token, _exp) = create_session(&state.pool).await.map_err(AppError::Anyhow)?;
    let mut headers = HeaderMap::new();
    headers.insert(SET_COOKIE, session_cookie(&token, SESSION_TTL_SECS).parse().unwrap());
    Ok((StatusCode::OK, headers, Json(SessionInfo { authenticated: true })))
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
    Ok((StatusCode::OK, out, Json(SessionInfo { authenticated: false })))
}

pub async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<SessionInfo> {
    if state.admin_hash.is_none() {
        return Json(SessionInfo { authenticated: true });
    }
    let Some(token) = read_cookie(&headers) else {
        return Json(SessionInfo { authenticated: false });
    };
    let ok = session_valid(&state.pool, &token).await.unwrap_or(false);
    Json(SessionInfo { authenticated: ok })
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
