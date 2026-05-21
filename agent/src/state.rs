use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    pub host_id: String,
    pub agent_token: String,
    pub server_url: String,
    pub name: String,
}

pub fn state_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("EMBER_AGENT_STATE_DIR") {
        return PathBuf::from(dir);
    }
    PathBuf::from("/var/lib/ember-agent")
}

pub fn state_file() -> PathBuf {
    state_dir().join("state.json")
}

pub fn load() -> anyhow::Result<AgentState> {
    let path = state_file();
    let raw = std::fs::read_to_string(&path)
        .with_context(|| format!("read agent state from {}", path.display()))?;
    let s: AgentState = serde_json::from_str(&raw).context("parse agent state")?;
    Ok(s)
}

pub fn save(s: &AgentState) -> anyhow::Result<()> {
    let dir = state_dir();
    std::fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
    let path = state_file();
    let raw = serde_json::to_string_pretty(s)?;
    std::fs::write(&path, raw).with_context(|| format!("write {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn host_os() -> String {
    std::env::consts::OS.into()
}

pub fn host_arch() -> String {
    std::env::consts::ARCH.into()
}

pub fn agent_version() -> String {
    env!("CARGO_PKG_VERSION").into()
}
