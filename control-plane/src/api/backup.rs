use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::auth::AdminSession;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use chrono::Utc;
use ember_shared::protocol::BackupResponse;
use serde_json::json;
use std::path::PathBuf;

pub async fn create(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<BackupResponse>, AppError> {
    if admin.tenant.role != "owner" && admin.tenant.role != "admin" {
        return Err(AppError::Forbidden);
    }

    let db_url = state.config.db_url.clone();
    let db_path = sqlite_path_from_url(&db_url)
        .ok_or_else(|| AppError::BadRequest("backup only supported for file sqlite URLs".into()))?;

    let backup_dir = std::env::var("EMBER_BACKUP_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("backups"));
    std::fs::create_dir_all(&backup_dir).map_err(|e| AppError::Anyhow(e.into()))?;

    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    let dest = backup_dir.join(format!("ember-{stamp}.db"));

    // Online-ish backup: checkpoint WAL then copy.
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&state.pool)
        .await
        .ok();
    std::fs::copy(&db_path, &dest).map_err(|e| AppError::Anyhow(e.into()))?;
    let bytes = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);

    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "backup.create",
        Some("database"),
        None,
        RESULT_SUCCESS,
        Some(json!({ "path": dest.display().to_string(), "bytes": bytes })),
    )
    .await;

    Ok(Json(BackupResponse {
        path: dest.display().to_string(),
        bytes,
        created_at: Utc::now().to_rfc3339(),
    }))
}

fn sqlite_path_from_url(url: &str) -> Option<PathBuf> {
    // sqlite://ember.db?mode=rwc  or  sqlite:///abs/path.db?mode=rwc
    let rest = url.strip_prefix("sqlite:")?;
    let rest = rest.trim_start_matches('/');
    let path = rest.split('?').next()?.trim();
    if path.is_empty() {
        return None;
    }
    // url may be sqlite:///data/ember.db → after strip: /data/ember.db or data/ember.db
    let path = if url.starts_with("sqlite:///") {
        format!("/{}", path.trim_start_matches('/'))
    } else {
        path.to_string()
    };
    Some(PathBuf::from(path))
}
