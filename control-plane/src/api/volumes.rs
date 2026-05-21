use crate::agent_ws::log_event;
use crate::auth::AdminSession;
use crate::error::AppError;
use crate::scheduler;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{Command, CreateVolumeRequest, VolumeProvisionSpec, VolumeSummary};
use uuid::Uuid;

pub async fn list(
    _admin: AdminSession,
    State(state): State<AppState>,
) -> Result<Json<Vec<VolumeSummary>>, AppError> {
    let rows: Vec<(
        String,
        String,
        String,
        String,
        i64,
        String,
        Option<String>,
        String,
        DateTime<Utc>,
    )> = sqlx::query_as(
        "SELECT v.id, v.name, v.host_id, h.name, v.size_mb, v.backend, v.host_path, v.status, v.created_at \
         FROM volumes v JOIN hosts h ON h.id = v.host_id \
         ORDER BY v.created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    let out = rows
        .into_iter()
        .map(|t| VolumeSummary {
            id: t.0,
            name: t.1,
            host_id: t.2,
            host_name: t.3,
            size_mb: t.4 as u64,
            backend: t.5,
            host_path: t.6,
            status: t.7,
            created_at: t.8.to_rfc3339(),
        })
        .collect();
    Ok(Json(out))
}

pub async fn create(
    _admin: AdminSession,
    State(state): State<AppState>,
    Json(req): Json<CreateVolumeRequest>,
) -> Result<Json<VolumeSummary>, AppError> {
    if req.name.trim().is_empty() {
        return Err(AppError::BadRequest("name required".into()));
    }
    if req.backend != "hostdir" && req.backend != "loopback_ext4" {
        return Err(AppError::BadRequest("backend must be hostdir or loopback_ext4".into()));
    }
    let host: Option<(String, String)> =
        sqlx::query_as("SELECT id, name FROM hosts WHERE id = ?")
            .bind(&req.host_id)
            .fetch_optional(&state.pool)
            .await?;
    let (host_id, host_name) = host.ok_or_else(|| AppError::BadRequest("host not found".into()))?;

    let volume_id = Uuid::now_v7().to_string();
    sqlx::query(
        "INSERT INTO volumes (id, name, host_id, size_mb, backend, status) \
         VALUES (?, ?, ?, ?, ?, 'pending')",
    )
    .bind(&volume_id)
    .bind(&req.name)
    .bind(&host_id)
    .bind(req.size_mb as i64)
    .bind(&req.backend)
    .execute(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("volume name already exists on host".into())
        }
        other => AppError::Sqlx(other),
    })?;

    let spec = VolumeProvisionSpec {
        volume_id: volume_id.clone(),
        size_mb: req.size_mb,
        backend: req.backend.clone(),
    };
    let _ = scheduler::enqueue(
        &state,
        &host_id,
        None,
        Some(&volume_id),
        &Command::CreateVolume(spec),
    )
    .await
    .map_err(AppError::Anyhow)?;

    log_event(
        &state,
        Some(&host_id),
        None,
        Some(&volume_id),
        "volume.created",
        &format!("create volume '{}' backend={}", req.name, req.backend),
    )
    .await;

    Ok(Json(VolumeSummary {
        id: volume_id,
        name: req.name,
        host_id,
        host_name,
        size_mb: req.size_mb,
        backend: req.backend,
        host_path: None,
        status: "pending".into(),
        created_at: Utc::now().to_rfc3339(),
    }))
}

pub async fn delete(
    _admin: AdminSession,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let row: Option<(String, i64, String)> =
        sqlx::query_as("SELECT host_id, size_mb, backend FROM volumes WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;
    let (host_id, size_mb, backend) = row.ok_or(AppError::NotFound)?;
    let in_use: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM workload_volumes WHERE volume_id = ?")
            .bind(&id)
            .fetch_one(&state.pool)
            .await?;
    if in_use.0 > 0 {
        return Err(AppError::Conflict("volume is attached to a workload".into()));
    }
    sqlx::query("UPDATE volumes SET status='deleting' WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    let _ = scheduler::enqueue(
        &state,
        &host_id,
        None,
        Some(&id),
        &Command::DeleteVolume(VolumeProvisionSpec {
            volume_id: id.clone(),
            size_mb: size_mb as u64,
            backend,
        }),
    )
    .await
    .map_err(AppError::Anyhow)?;
    Ok(axum::http::StatusCode::ACCEPTED)
}
