//! Tenant admission policy for workloads and volumes.

use crate::error::AppError;
use ember_shared::protocol::{PortMapping, TenantPolicy};
use serde_json::json;
use sqlx::SqlitePool;

#[derive(Debug, Clone)]
pub struct Policy {
    pub deny_latest_tag: bool,
    pub image_allowlist: Vec<String>,
    pub max_workloads: Option<u32>,
    pub max_volumes: Option<u32>,
    pub max_volume_mb_total: Option<u64>,
    pub allowed_host_ports: Vec<u16>,
    pub require_mfa_admins: bool,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            deny_latest_tag: true,
            image_allowlist: vec![],
            max_workloads: None,
            max_volumes: None,
            max_volume_mb_total: None,
            allowed_host_ports: vec![],
            require_mfa_admins: false,
        }
    }
}

impl From<Policy> for TenantPolicy {
    fn from(p: Policy) -> Self {
        TenantPolicy {
            deny_latest_tag: p.deny_latest_tag,
            image_allowlist: p.image_allowlist,
            max_workloads: p.max_workloads,
            max_volumes: p.max_volumes,
            max_volume_mb_total: p.max_volume_mb_total,
            allowed_host_ports: p.allowed_host_ports,
            require_mfa_admins: p.require_mfa_admins,
        }
    }
}

pub async fn load(pool: &SqlitePool, tenant_id: &str) -> Result<Policy, AppError> {
    let row: Option<(i64, String, Option<i64>, Option<i64>, Option<i64>, String, i64)> =
        sqlx::query_as(
            "SELECT deny_latest_tag, image_allowlist_json, max_workloads, max_volumes, \
             max_volume_mb_total, allowed_host_ports_json, require_mfa_admins \
             FROM tenant_policies WHERE tenant_id = ?",
        )
        .bind(tenant_id)
        .fetch_optional(pool)
        .await?;

    let Some(row) = row else {
        return Ok(Policy::default());
    };

    Ok(Policy {
        deny_latest_tag: row.0 != 0,
        image_allowlist: serde_json::from_str(&row.1).unwrap_or_default(),
        max_workloads: row.2.map(|v| v.max(0) as u32),
        max_volumes: row.3.map(|v| v.max(0) as u32),
        max_volume_mb_total: row.4.map(|v| v.max(0) as u64),
        allowed_host_ports: serde_json::from_str(&row.5).unwrap_or_default(),
        require_mfa_admins: row.6 != 0,
    })
}

pub async fn upsert(pool: &SqlitePool, tenant_id: &str, policy: &Policy) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO tenant_policies \
         (tenant_id, deny_latest_tag, image_allowlist_json, max_workloads, max_volumes, \
          max_volume_mb_total, allowed_host_ports_json, require_mfa_admins, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) \
         ON CONFLICT(tenant_id) DO UPDATE SET \
           deny_latest_tag = excluded.deny_latest_tag, \
           image_allowlist_json = excluded.image_allowlist_json, \
           max_workloads = excluded.max_workloads, \
           max_volumes = excluded.max_volumes, \
           max_volume_mb_total = excluded.max_volume_mb_total, \
           allowed_host_ports_json = excluded.allowed_host_ports_json, \
           require_mfa_admins = excluded.require_mfa_admins, \
           updated_at = CURRENT_TIMESTAMP",
    )
    .bind(tenant_id)
    .bind(if policy.deny_latest_tag { 1 } else { 0 })
    .bind(serde_json::to_string(&policy.image_allowlist).unwrap_or_else(|_| "[]".into()))
    .bind(policy.max_workloads.map(|v| v as i64))
    .bind(policy.max_volumes.map(|v| v as i64))
    .bind(policy.max_volume_mb_total.map(|v| v as i64))
    .bind(serde_json::to_string(&policy.allowed_host_ports).unwrap_or_else(|_| "[]".into()))
    .bind(if policy.require_mfa_admins { 1 } else { 0 })
    .execute(pool)
    .await?;
    Ok(())
}

pub fn check_image(policy: &Policy, image: &str) -> Result<(), AppError> {
    let image = image.trim();
    let tag = image.rsplit_once(':').map(|(_, t)| t).unwrap_or("latest");
    if policy.deny_latest_tag && (tag == "latest" || !image.contains(':')) {
        return Err(AppError::BadRequest(
            "policy denies :latest (and untagged) images; pin a digest or version tag".into(),
        ));
    }
    if !policy.image_allowlist.is_empty() {
        let ok = policy.image_allowlist.iter().any(|prefix| {
            image == prefix.as_str()
                || image.starts_with(&format!("{prefix}:"))
                || image.starts_with(&format!("{prefix}@"))
                || image.starts_with(prefix)
        });
        if !ok {
            return Err(AppError::BadRequest(format!(
                "image {image} not in tenant allowlist"
            )));
        }
    }
    Ok(())
}

pub fn check_ports(policy: &Policy, ports: &[PortMapping]) -> Result<(), AppError> {
    if policy.allowed_host_ports.is_empty() {
        return Ok(());
    }
    for p in ports {
        if !policy.allowed_host_ports.contains(&p.host_port) {
            return Err(AppError::BadRequest(format!(
                "host port {} not in allowed_host_ports policy",
                p.host_port
            )));
        }
    }
    Ok(())
}

pub async fn check_workload_quota(pool: &SqlitePool, tenant_id: &str, policy: &Policy) -> Result<(), AppError> {
    if let Some(max) = policy.max_workloads {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM workloads WHERE tenant_id = ? AND desired_state != 'removed'")
                .bind(tenant_id)
                .fetch_one(pool)
                .await?;
        if count as u32 >= max {
            return Err(AppError::Conflict(format!(
                "tenant workload quota reached ({max})"
            )));
        }
    }
    Ok(())
}

pub async fn check_volume_quota(
    pool: &SqlitePool,
    tenant_id: &str,
    policy: &Policy,
    new_size_mb: u64,
) -> Result<(), AppError> {
    if let Some(max) = policy.max_volumes {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM volumes WHERE tenant_id = ? AND status != 'deleting'")
                .bind(tenant_id)
                .fetch_one(pool)
                .await?;
        if count as u32 >= max {
            return Err(AppError::Conflict(format!(
                "tenant volume count quota reached ({max})"
            )));
        }
    }
    if let Some(max_mb) = policy.max_volume_mb_total {
        let (sum,): (Option<i64>,) =
            sqlx::query_as("SELECT SUM(size_mb) FROM volumes WHERE tenant_id = ? AND status != 'deleting'")
                .bind(tenant_id)
                .fetch_one(pool)
                .await?;
        let current = sum.unwrap_or(0) as u64;
        if current.saturating_add(new_size_mb) > max_mb {
            return Err(AppError::Conflict(format!(
                "tenant volume capacity quota would exceed {max_mb} MB"
            )));
        }
    }
    Ok(())
}

pub fn labels_to_json(labels: &[(String, String)]) -> String {
    let map: serde_json::Map<String, serde_json::Value> = labels
        .iter()
        .map(|(k, v)| (k.clone(), json!(v)))
        .collect();
    serde_json::Value::Object(map).to_string()
}

pub fn labels_from_json(s: &str) -> Vec<(String, String)> {
    let Ok(val) = serde_json::from_str::<serde_json::Value>(s) else {
        return vec![];
    };
    match val {
        serde_json::Value::Object(map) => map
            .into_iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
            .collect(),
        _ => vec![],
    }
}

pub fn host_matches_labels(host_labels: &[(String, String)], required: &[(String, String)]) -> bool {
    required.iter().all(|(k, v)| {
        host_labels
            .iter()
            .any(|(hk, hv)| hk == k && (v.is_empty() || hv == v))
    })
}
