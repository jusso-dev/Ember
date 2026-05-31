use crate::agent_ws::log_event;
use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::state::AppState;
use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde_json::json;
use sha2::Sha256;
use std::time::Duration;

const HEARTBEAT_TIMEOUT_SECS: i64 = 45;
const DISPATCHED_TIMEOUT_SECS: i64 = 60;

pub async fn run(state: AppState) {
    let mut tick = tokio::time::interval(Duration::from_secs(10));
    loop {
        tick.tick().await;
        if let Err(e) = sweep_offline(&state).await {
            tracing::error!(error = ?e, "sweep_offline");
        }
        if let Err(e) = requeue_stuck(&state).await {
            tracing::error!(error = ?e, "requeue_stuck");
        }
    }
}

pub async fn run_retention(state: AppState) {
    let mut tick = tokio::time::interval(Duration::from_secs(600));
    loop {
        tick.tick().await;
        if let Err(e) = prune_logs(&state).await {
            tracing::error!(error = ?e, "log retention prune failed");
        }
        if let Err(e) = prune_audit(&state).await {
            tracing::error!(error = ?e, "audit retention prune failed");
        }
    }
}

pub async fn run_audit_webhooks(state: AppState) {
    let client = Client::new();
    let mut tick = tokio::time::interval(Duration::from_secs(5));
    loop {
        tick.tick().await;
        if let Err(e) = deliver_audit_webhooks(&state, &client).await {
            tracing::error!(error = ?e, "audit webhook delivery failed");
        }
    }
}

async fn sweep_offline(state: &AppState) -> anyhow::Result<()> {
    let cutoff = Utc::now() - chrono::Duration::seconds(HEARTBEAT_TIMEOUT_SECS);
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM hosts WHERE status='online' AND (last_seen_at IS NULL OR last_seen_at < ?)",
    )
    .bind(cutoff)
    .fetch_all(&state.pool)
    .await?;
    for (id,) in rows {
        sqlx::query("UPDATE hosts SET status='offline' WHERE id = ?")
            .bind(&id)
            .execute(&state.pool)
            .await?;
        log_event(
            state,
            Some(&id),
            None,
            None,
            "agent.timeout",
            "marked offline (no heartbeat)",
        )
        .await;
    }
    Ok(())
}

async fn requeue_stuck(state: &AppState) -> anyhow::Result<()> {
    let cutoff = Utc::now() - chrono::Duration::seconds(DISPATCHED_TIMEOUT_SECS);
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, host_id FROM tasks WHERE status='dispatched' AND (dispatched_at IS NULL OR dispatched_at < ?)",
    )
    .bind(cutoff)
    .fetch_all(&state.pool)
    .await?;
    for (task_id, host_id) in rows {
        sqlx::query("UPDATE tasks SET status='queued' WHERE id = ?")
            .bind(&task_id)
            .execute(&state.pool)
            .await?;
        tracing::warn!(%task_id, %host_id, "task requeued (no result before timeout)");
    }
    Ok(())
}

async fn prune_logs(state: &AppState) -> anyhow::Result<()> {
    let control_cutoff =
        Utc::now() - chrono::Duration::days(state.config.control_plane_log_retention_days);
    sqlx::query("DELETE FROM control_plane_logs WHERE ts < ?")
        .bind(control_cutoff)
        .execute(&state.pool)
        .await?;

    let workload_cutoff =
        Utc::now() - chrono::Duration::days(state.config.workload_log_retention_days);
    sqlx::query("DELETE FROM workload_logs WHERE ts < ?")
        .bind(workload_cutoff)
        .execute(&state.pool)
        .await?;

    let agent_cutoff = Utc::now() - chrono::Duration::days(state.config.agent_log_retention_days);
    sqlx::query("DELETE FROM agent_logs WHERE ts < ?")
        .bind(agent_cutoff)
        .execute(&state.pool)
        .await?;
    Ok(())
}

async fn prune_audit(state: &AppState) -> anyhow::Result<()> {
    let tenants: Vec<(String, Option<i64>)> =
        sqlx::query_as("SELECT id, audit_retention_days FROM tenants")
            .fetch_all(&state.pool)
            .await?;

    for (tenant_id, override_days) in tenants {
        let days = override_days.unwrap_or(state.config.audit_retention_days);
        let cutoff = Utc::now() - chrono::Duration::days(days);
        let result = sqlx::query("DELETE FROM audit_logs WHERE actor_tenant_id = ? AND ts < ?")
            .bind(&tenant_id)
            .bind(cutoff)
            .execute(&state.pool)
            .await?;
        let removed = result.rows_affected();
        if removed > 0 {
            audit::record(
                state,
                &AuditActor {
                    user_id: None,
                    email: Some("system".into()),
                    tenant_id: Some(tenant_id.clone()),
                    ip_address: None,
                    user_agent: None,
                },
                "audit.prune",
                Some("audit_log"),
                None,
                RESULT_SUCCESS,
                Some(json!({
                    "rows_removed": removed,
                    "cutoff": cutoff.to_rfc3339(),
                    "retention_days": days,
                })),
            )
            .await;
        }
    }
    Ok(())
}

async fn deliver_audit_webhooks(state: &AppState, client: &Client) -> anyhow::Result<()> {
    let due: Vec<(i64, String, String, String, i64)> = sqlx::query_as(
        "SELECT d.id, d.webhook_id, w.url, w.secret_hash, d.audit_log_id \
         FROM audit_webhook_deliveries d \
         JOIN audit_webhooks w ON w.id = d.webhook_id \
         WHERE d.status = 'pending' AND d.next_attempt_at <= CURRENT_TIMESTAMP \
         ORDER BY d.id ASC LIMIT 100",
    )
    .fetch_all(&state.pool)
    .await?;

    for (delivery_id, webhook_id, url, secret_hash, audit_log_id) in due {
        let row: Option<(
            i64,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = sqlx::query_as(
            "SELECT id, ts, actor_user_id, actor_email, actor_tenant_id, action, \
                    resource_type, resource_id, result, ip_address, user_agent, details_json \
             FROM audit_logs WHERE id = ?",
        )
        .bind(audit_log_id)
        .fetch_optional(&state.pool)
        .await?;
        let Some(row) = row else {
            sqlx::query("UPDATE audit_webhook_deliveries SET status = 'dead' WHERE id = ?")
                .bind(delivery_id)
                .execute(&state.pool)
                .await?;
            continue;
        };
        let payload = json!({
            "rows": [{
                "id": row.0,
                "ts": row.1,
                "actor_user_id": row.2,
                "actor_email": row.3,
                "actor_tenant_id": row.4,
                "action": row.5,
                "resource_type": row.6,
                "resource_id": row.7,
                "result": row.8,
                "ip_address": row.9,
                "user_agent": row.10,
                "details": row.11,
            }]
        });
        let body = payload.to_string();
        let signature = hmac_sha256(&secret_hash, &body);
        let result = client
            .post(&url)
            .header("content-type", "application/json")
            .header("x-ember-signature", format!("sha256={signature}"))
            .body(body)
            .send()
            .await;

        match result {
            Ok(response) if response.status().is_success() => {
                sqlx::query("UPDATE audit_webhook_deliveries SET status='delivered' WHERE id = ?")
                    .bind(delivery_id)
                    .execute(&state.pool)
                    .await?;
                sqlx::query(
                    "UPDATE audit_webhooks SET last_delivered_at = ?, failure_count = 0, last_error = NULL WHERE id = ?",
                )
                .bind(Utc::now())
                .bind(&webhook_id)
                .execute(&state.pool)
                .await?;
            }
            Ok(response) => {
                let status = response.status().as_u16();
                mark_webhook_failed(state, delivery_id, &webhook_id, format!("HTTP {status}"))
                    .await?;
            }
            Err(e) => {
                mark_webhook_failed(state, delivery_id, &webhook_id, e.to_string()).await?;
            }
        }
    }
    Ok(())
}

async fn mark_webhook_failed(
    state: &AppState,
    delivery_id: i64,
    webhook_id: &str,
    error: String,
) -> anyhow::Result<()> {
    let attempts: (i64,) =
        sqlx::query_as("SELECT attempts FROM audit_webhook_deliveries WHERE id = ?")
            .bind(delivery_id)
            .fetch_one(&state.pool)
            .await?;
    let next_attempt =
        Utc::now() + chrono::Duration::seconds(2_i64.pow((attempts.0 as u32).min(10)).min(3600));
    let status = if attempts.0 >= 24 { "dead" } else { "pending" };
    sqlx::query(
        "UPDATE audit_webhook_deliveries \
         SET attempts = attempts + 1, status = ?, next_attempt_at = ?, last_error = ? \
         WHERE id = ?",
    )
    .bind(status)
    .bind(next_attempt)
    .bind(&error)
    .bind(delivery_id)
    .execute(&state.pool)
    .await?;
    sqlx::query(
        "UPDATE audit_webhooks SET failure_count = failure_count + 1, last_error = ? WHERE id = ?",
    )
    .bind(error)
    .bind(webhook_id)
    .execute(&state.pool)
    .await?;
    Ok(())
}

fn hmac_sha256(secret: &str, body: &str) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(body.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}
