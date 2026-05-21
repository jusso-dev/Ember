use crate::state::{self, AgentState};
use anyhow::Context;
use ember_shared::protocol::{EnrollRequest, EnrollResponse};

pub async fn run(server: &str, token: &str, name: &str) -> anyhow::Result<()> {
    let server = server.trim_end_matches('/').to_string();
    let req = EnrollRequest {
        enrollment_token: token.to_string(),
        name: name.to_string(),
        os: state::host_os(),
        arch: state::host_arch(),
        agent_version: state::agent_version(),
    };
    let url = format!("{server}/api/agent/enroll");
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&req)
        .send()
        .await
        .with_context(|| format!("POST {url}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("enroll failed: {status}: {body}");
    }
    let body: EnrollResponse = resp.json().await.context("decode EnrollResponse")?;
    let s = AgentState {
        host_id: body.host_id,
        agent_token: body.agent_token,
        server_url: server,
        name: name.to_string(),
    };
    state::save(&s)?;
    tracing::info!(host_id = %s.host_id, name = %s.name, "enrolled; state written to {}", state::state_file().display());
    Ok(())
}
