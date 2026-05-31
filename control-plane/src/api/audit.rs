use crate::audit::{self, AuditActor, RESULT_SUCCESS};
use crate::auth::AdminSession;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, Utc};
use ember_shared::protocol::{AuditLogListResponse, AuditLogRow, AuditVerifyResponse};
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

#[derive(Deserialize)]
pub struct AuditQuery {
    pub action: Option<String>,
    pub actor_user_id: Option<String>,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub result: Option<String>,
    pub limit: Option<i64>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub before_id: Option<i64>,
}

pub async fn list(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<AuditQuery>,
) -> Result<Json<AuditLogListResponse>, AppError> {
    let limit = q.limit.unwrap_or(200).clamp(1, 1000);
    let rows = fetch_rows(&state, &admin.tenant.id, &q, limit + 1).await?;
    let has_next = rows.len() > limit as usize;
    let visible_rows = rows.into_iter().take(limit as usize).collect::<Vec<_>>();
    let next_cursor = if has_next {
        visible_rows.last().map(|row| row.id)
    } else {
        None
    };
    let count = visible_rows.len() as u32;

    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "audit.read",
        Some("audit_log"),
        None,
        RESULT_SUCCESS,
        Some(json!({
            "limit": limit,
            "since": q.since,
            "until": q.until,
            "before_id": q.before_id,
            "action": q.action,
            "result": q.result,
            "count": count,
        })),
    )
    .await;

    Ok(Json(AuditLogListResponse {
        rows: visible_rows,
        next_cursor,
        count,
    }))
}

pub async fn verify(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AuditVerifyResponse>, AppError> {
    if !matches!(admin.tenant.role.as_str(), "owner" | "admin" | "auditor") {
        return Err(AppError::Forbidden);
    }
    let response = audit::verify(&state, &admin.tenant.id)
        .await
        .map_err(AppError::Anyhow)?;
    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "audit.verify",
        Some("audit_log"),
        None,
        if response.verified {
            "success"
        } else {
            "failure"
        },
        Some(json!({
            "last_verified_id": response.last_verified_id,
            "first_bad_id": response.first_bad_id,
        })),
    )
    .await;
    Ok(Json(response))
}

#[derive(Deserialize)]
pub struct ExportQuery {
    pub format: Option<String>,
    pub action: Option<String>,
    pub actor_user_id: Option<String>,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub result: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
}

pub async fn export(
    admin: AdminSession,
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ExportQuery>,
) -> Result<Response, AppError> {
    let key = format!("audit-export:{}:{}", admin.tenant.id, admin.user.id);
    if let Err(retry_after_secs) = state
        .audit_export_limiter
        .check(key, 1, Duration::from_secs(60))
        .await
    {
        return Err(AppError::TooManyRequests { retry_after_secs });
    }

    let audit_query = AuditQuery {
        action: q.action.clone(),
        actor_user_id: q.actor_user_id.clone(),
        resource_type: q.resource_type.clone(),
        resource_id: q.resource_id.clone(),
        result: q.result.clone(),
        limit: None,
        since: q.since.clone(),
        until: q.until.clone(),
        before_id: None,
    };
    let rows = fetch_rows(&state, &admin.tenant.id, &audit_query, 50_000).await?;
    let format = q.format.as_deref().unwrap_or("csv");
    let body = match format {
        "jsonl" => rows
            .iter()
            .map(|row| serde_json::to_string(row).unwrap_or_else(|_| "{}".into()))
            .collect::<Vec<_>>()
            .join("\n"),
        "csv" => rows_to_csv(&rows),
        other => {
            return Err(AppError::BadRequest(format!(
                "unsupported export format: {other}"
            )))
        }
    };
    let content_type = if format == "jsonl" {
        "application/x-ndjson"
    } else {
        "text/csv; charset=utf-8"
    };
    let filename = if format == "jsonl" {
        "ember-audit.jsonl"
    } else {
        "ember-audit.csv"
    };

    audit::record(
        &state,
        &AuditActor::from_admin(&admin, &headers),
        "audit.export",
        Some("audit_log"),
        None,
        RESULT_SUCCESS,
        Some(json!({
            "format": format,
            "row_count": rows.len(),
            "since": q.since,
            "until": q.until,
            "action": q.action,
            "result": q.result,
        })),
    )
    .await;

    let mut response = (StatusCode::OK, body).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    Ok(response)
}

async fn fetch_rows(
    state: &AppState,
    tenant_id: &str,
    q: &AuditQuery,
    limit: i64,
) -> Result<Vec<AuditLogRow>, AppError> {
    let since = parse_time(q.since.as_deref());
    let until = parse_time(q.until.as_deref());

    let rows: Vec<(
        i64,
        DateTime<Utc>,
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
         FROM audit_logs \
         WHERE actor_tenant_id = ? \
           AND (? IS NULL OR action = ?) \
           AND (? IS NULL OR actor_user_id = ?) \
           AND (? IS NULL OR resource_type = ?) \
           AND (? IS NULL OR resource_id = ?) \
           AND (? IS NULL OR result = ?) \
           AND (? IS NULL OR ts >= ?) \
           AND (? IS NULL OR ts <= ?) \
           AND (? IS NULL OR id < ?) \
         ORDER BY id DESC \
         LIMIT ?",
    )
    .bind(tenant_id)
    .bind(&q.action)
    .bind(&q.action)
    .bind(&q.actor_user_id)
    .bind(&q.actor_user_id)
    .bind(&q.resource_type)
    .bind(&q.resource_type)
    .bind(&q.resource_id)
    .bind(&q.resource_id)
    .bind(&q.result)
    .bind(&q.result)
    .bind(since)
    .bind(since)
    .bind(until)
    .bind(until)
    .bind(q.before_id)
    .bind(q.before_id)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|t| AuditLogRow {
            id: t.0,
            ts: t.1.to_rfc3339(),
            actor_user_id: t.2,
            actor_email: t.3,
            actor_tenant_id: t.4,
            action: t.5,
            resource_type: t.6,
            resource_id: t.7,
            result: t.8,
            ip_address: t.9,
            user_agent: t.10,
            details: t.11,
        })
        .collect())
}

fn parse_time(value: Option<&str>) -> Option<DateTime<Utc>> {
    value.and_then(|s| {
        DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|d| d.with_timezone(&Utc))
    })
}

fn rows_to_csv(rows: &[AuditLogRow]) -> String {
    let mut out = String::from(
        "id,ts,actor_user_id,actor_email,actor_tenant_id,action,resource_type,resource_id,result,ip_address,user_agent,details\n",
    );
    for row in rows {
        let cols = [
            row.id.to_string(),
            row.ts.clone(),
            row.actor_user_id.clone().unwrap_or_default(),
            row.actor_email.clone().unwrap_or_default(),
            row.actor_tenant_id.clone().unwrap_or_default(),
            row.action.clone(),
            row.resource_type.clone().unwrap_or_default(),
            row.resource_id.clone().unwrap_or_default(),
            row.result.clone(),
            row.ip_address.clone().unwrap_or_default(),
            row.user_agent.clone().unwrap_or_default(),
            row.details.clone().unwrap_or_default(),
        ];
        out.push_str(
            &cols
                .iter()
                .map(|value| csv_escape(value))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push('\n');
    }
    out
}

fn csv_escape(value: &str) -> String {
    if value.contains(|c| matches!(c, ',' | '"' | '\n' | '\r')) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}
