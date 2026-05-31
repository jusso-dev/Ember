use crate::agent_ws::{container_name, log_event};
use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::auth::AdminSession;
use crate::error::AppError;
use crate::scheduler;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{
    Command, CreateWorkloadRequest, MountSpec, RunContainerSpec, WorkloadSummary,
};
use serde_json::json;
use uuid::Uuid;

pub async fn list(
    admin: AdminSession,
    State(state): State<AppState>,
) -> Result<Json<Vec<WorkloadSummary>>, AppError> {
    let rows: Vec<(
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        DateTime<Utc>,
    )> = sqlx::query_as(
        "SELECT w.id, w.name, w.host_id, h.name, w.image, w.desired_state, w.observed_state, \
         w.container_id, w.last_error, w.created_at \
         FROM workloads w JOIN hosts h ON h.id = w.host_id \
         WHERE w.tenant_id = ? \
         ORDER BY w.created_at DESC",
    )
    .bind(&admin.tenant.id)
    .fetch_all(&state.pool)
    .await?;
    let out = rows
        .into_iter()
        .map(|t| WorkloadSummary {
            id: t.0,
            name: t.1,
            host_id: t.2,
            host_name: t.3,
            image: t.4,
            desired_state: t.5,
            observed_state: t.6,
            container_id: t.7,
            last_error: t.8,
            created_at: t.9.to_rfc3339(),
        })
        .collect();
    Ok(Json(out))
}

pub async fn get(
    admin: AdminSession,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<WorkloadSummary>, AppError> {
    let row: Option<(
        String,
        String,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        DateTime<Utc>,
    )> = sqlx::query_as(
        "SELECT w.id, w.name, w.host_id, h.name, w.image, w.desired_state, w.observed_state, \
         w.container_id, w.last_error, w.created_at \
         FROM workloads w JOIN hosts h ON h.id = w.host_id WHERE w.id = ? AND w.tenant_id = ?",
    )
    .bind(&id)
    .bind(&admin.tenant.id)
    .fetch_optional(&state.pool)
    .await?;
    let t = row.ok_or(AppError::NotFound)?;
    Ok(Json(WorkloadSummary {
        id: t.0,
        name: t.1,
        host_id: t.2,
        host_name: t.3,
        image: t.4,
        desired_state: t.5,
        observed_state: t.6,
        container_id: t.7,
        last_error: t.8,
        created_at: t.9.to_rfc3339(),
    }))
}

pub async fn create(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateWorkloadRequest>,
) -> Result<Json<WorkloadSummary>, AppError> {
    if req.name.trim().is_empty() || req.image.trim().is_empty() {
        return Err(AppError::BadRequest("name and image required".into()));
    }

    // Validate host exists.
    let host_row: Option<(String, String)> =
        sqlx::query_as("SELECT id, name FROM hosts WHERE id = ? AND tenant_id = ?")
            .bind(&req.host_id)
            .bind(&admin.tenant.id)
            .fetch_optional(&state.pool)
            .await?;
    let (host_id, host_name) =
        host_row.ok_or_else(|| AppError::BadRequest("host not found".into()))?;

    // Resolve volume host paths (must be ready).
    let mut mounts: Vec<MountSpec> = Vec::with_capacity(req.volumes.len());
    for att in &req.volumes {
        let vol: Option<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT id, status, host_path FROM volumes WHERE id = ? AND host_id = ? AND tenant_id = ?",
        )
        .bind(&att.volume_id)
        .bind(&host_id)
        .bind(&admin.tenant.id)
        .fetch_optional(&state.pool)
        .await?;
        let (_, status, host_path) =
            vol.ok_or_else(|| AppError::BadRequest("volume not found on host".into()))?;
        if status != "ready" {
            return Err(AppError::BadRequest(format!(
                "volume {} not ready (status={})",
                att.volume_id, status
            )));
        }
        let host_path =
            host_path.ok_or_else(|| AppError::BadRequest("volume host_path not set".into()))?;
        mounts.push(MountSpec {
            host_path,
            container_path: att.mount_path.clone(),
            read_only: att.read_only,
        });
    }

    let workload_id = Uuid::now_v7().to_string();
    let env_json = serde_json::to_string(&req.env).unwrap();
    let ports_json = serde_json::to_string(&req.ports).unwrap();
    let command_json = req
        .command
        .as_ref()
        .map(|c| serde_json::to_string(c).unwrap());

    sqlx::query(
        "INSERT INTO workloads (id, name, host_id, image, env_json, ports_json, command_json, desired_state, observed_state, tenant_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'pending', ?)",
    )
    .bind(&workload_id)
    .bind(&req.name)
    .bind(&host_id)
    .bind(&req.image)
    .bind(&env_json)
    .bind(&ports_json)
    .bind(command_json.as_deref())
    .bind(&admin.tenant.id)
    .execute(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("workload name already exists on host".into())
        }
        other => AppError::Sqlx(other),
    })?;

    // Insert attachments.
    for att in &req.volumes {
        sqlx::query(
            "INSERT INTO workload_volumes (workload_id, volume_id, mount_path, read_only) VALUES (?, ?, ?, ?)",
        )
        .bind(&workload_id)
        .bind(&att.volume_id)
        .bind(&att.mount_path)
        .bind(if att.read_only { 1 } else { 0 })
        .execute(&state.pool)
        .await?;
    }

    let spec = RunContainerSpec {
        workload_id: workload_id.clone(),
        name: container_name(&workload_id),
        image: req.image.clone(),
        env: req.env.clone(),
        ports: req.ports.clone(),
        mounts,
        command: req.command.clone(),
    };
    let _ = scheduler::enqueue(
        &state,
        &host_id,
        Some(&workload_id),
        None,
        &Command::RunContainer(spec),
    )
    .await
    .map_err(AppError::Anyhow)?;

    log_event(
        &state,
        Some(&host_id),
        Some(&workload_id),
        None,
        "workload.created",
        &format!("created '{}' image={}", req.name, req.image),
    )
    .await;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "workload.create",
        Some("workload"),
        Some(&workload_id),
        RESULT_SUCCESS,
        Some(json!({
            "name": req.name,
            "host_id": host_id,
            "image": req.image,
        })),
    )
    .await;

    Ok(Json(WorkloadSummary {
        id: workload_id,
        name: req.name,
        host_id,
        host_name,
        image: req.image,
        desired_state: "running".into(),
        observed_state: "pending".into(),
        container_id: None,
        last_error: None,
        created_at: Utc::now().to_rfc3339(),
    }))
}

pub async fn start(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let row: Option<(String, String, String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT host_id, name, image, env_json, command_json, ports_json FROM workloads WHERE id = ? AND tenant_id = ?",
    )
    .bind(&id)
    .bind(&admin.tenant.id)
    .fetch_optional(&state.pool)
    .await?;
    let (host_id, name, image, env_json, command_json, ports_json) =
        row.ok_or(AppError::NotFound)?;
    let snapshot = workload_audit_snapshot(&id, &name, &host_id, &image, &env_json, &ports_json);
    let env: Vec<(String, String)> = serde_json::from_str(&env_json).unwrap_or_default();
    let ports: Vec<ember_shared::protocol::PortMapping> =
        serde_json::from_str(&ports_json).unwrap_or_default();
    let command: Option<Vec<String>> = command_json.and_then(|s| serde_json::from_str(&s).ok());

    let mounts = fetch_mounts(&state, &id, &host_id).await?;

    sqlx::query("UPDATE workloads SET desired_state='running' WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&admin.tenant.id)
        .execute(&state.pool)
        .await?;

    let spec = RunContainerSpec {
        workload_id: id.clone(),
        name: container_name(&id),
        image,
        env,
        ports,
        mounts,
        command,
    };
    let _ = scheduler::enqueue(
        &state,
        &host_id,
        Some(&id),
        None,
        &Command::RunContainer(spec),
    )
    .await
    .map_err(AppError::Anyhow)?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "workload.start",
        Some("workload"),
        Some(&id),
        RESULT_SUCCESS,
        Some(snapshot),
    )
    .await;
    Ok(axum::http::StatusCode::ACCEPTED)
}

pub async fn stop(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let row: Option<(String, String, String, String, String)> =
        sqlx::query_as("SELECT host_id, name, image, env_json, ports_json FROM workloads WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&admin.tenant.id)
        .fetch_optional(&state.pool)
        .await?;
    let (host_id, name, image, env_json, ports_json) = row.ok_or(AppError::NotFound)?;
    let snapshot = workload_audit_snapshot(&id, &name, &host_id, &image, &env_json, &ports_json);
    sqlx::query("UPDATE workloads SET desired_state='stopped' WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&admin.tenant.id)
        .execute(&state.pool)
        .await?;
    let _ = scheduler::enqueue(
        &state,
        &host_id,
        Some(&id),
        None,
        &Command::StopContainer {
            name: container_name(&id),
            timeout_s: 10,
        },
    )
    .await
    .map_err(AppError::Anyhow)?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "workload.stop",
        Some("workload"),
        Some(&id),
        RESULT_SUCCESS,
        Some(snapshot),
    )
    .await;
    Ok(axum::http::StatusCode::ACCEPTED)
}

pub async fn delete(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let row: Option<(String, String, String, String, String)> =
        sqlx::query_as("SELECT host_id, name, image, env_json, ports_json FROM workloads WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&admin.tenant.id)
        .fetch_optional(&state.pool)
        .await?;
    let (host_id, name, image, env_json, ports_json) = row.ok_or(AppError::NotFound)?;
    let snapshot = workload_audit_snapshot(&id, &name, &host_id, &image, &env_json, &ports_json);
    sqlx::query("UPDATE workloads SET desired_state='removed' WHERE id = ? AND tenant_id = ?")
        .bind(&id)
        .bind(&admin.tenant.id)
        .execute(&state.pool)
        .await?;
    let _ = scheduler::enqueue(
        &state,
        &host_id,
        Some(&id),
        None,
        &Command::RemoveContainer {
            name: container_name(&id),
            force: true,
        },
    )
    .await
    .map_err(AppError::Anyhow)?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "workload.delete",
        Some("workload"),
        Some(&id),
        RESULT_SUCCESS,
        Some(snapshot),
    )
    .await;
    Ok(axum::http::StatusCode::ACCEPTED)
}

async fn fetch_mounts(
    state: &AppState,
    workload_id: &str,
    host_id: &str,
) -> Result<Vec<MountSpec>, AppError> {
    let rows: Vec<(String, i64, Option<String>)> = sqlx::query_as(
        "SELECT wv.mount_path, wv.read_only, v.host_path \
         FROM workload_volumes wv JOIN volumes v ON v.id = wv.volume_id \
         WHERE wv.workload_id = ? AND v.host_id = ?",
    )
    .bind(workload_id)
    .bind(host_id)
    .fetch_all(&state.pool)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for (mount_path, ro, host_path) in rows {
        let Some(host_path) = host_path else { continue };
        out.push(MountSpec {
            host_path,
            container_path: mount_path,
            read_only: ro != 0,
        });
    }
    Ok(out)
}

fn workload_audit_snapshot(
    id: &str,
    name: &str,
    host_id: &str,
    image: &str,
    env_json: &str,
    ports_json: &str,
) -> serde_json::Value {
    let env: Vec<(String, String)> = serde_json::from_str(env_json).unwrap_or_default();
    let ports: Vec<ember_shared::protocol::PortMapping> =
        serde_json::from_str(ports_json).unwrap_or_default();
    serde_json::json!({
        "before": {
            "id": id,
            "name": name,
            "host_id": host_id,
            "image": image,
            "env_keys": env.into_iter().map(|(key, _)| key).collect::<Vec<_>>(),
            "ports": ports,
        }
    })
}
