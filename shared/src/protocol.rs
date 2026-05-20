use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct Health {
    pub status: String,
    pub version: String,
}

// --- Auth ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct LoginRequest {
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct SessionInfo {
    pub authenticated: bool,
}

// --- Hosts ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct HostSummary {
    pub id: String,
    pub name: String,
    pub status: String, // "pending" | "online" | "offline"
    pub os: Option<String>,
    pub arch: Option<String>,
    pub agent_version: Option<String>,
    pub last_seen_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct EnrollTokenResponse {
    pub token: String,
    pub install_command: String,
    pub expires_at: String,
}

// --- Agent enrollment ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct EnrollRequest {
    pub enrollment_token: String,
    pub name: String,
    pub os: String,
    pub arch: String,
    pub agent_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct EnrollResponse {
    pub host_id: String,
    pub agent_token: String,
}

// --- Workloads ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct PortMapping {
    pub host_port: u16,
    pub container_port: u16,
    pub protocol: String, // "tcp" | "udp"
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct VolumeAttachment {
    pub volume_id: String,
    pub mount_path: String,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct CreateWorkloadRequest {
    pub host_id: String,
    pub name: String,
    pub image: String,
    pub env: Vec<(String, String)>,
    pub ports: Vec<PortMapping>,
    pub volumes: Vec<VolumeAttachment>,
    pub command: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct WorkloadSummary {
    pub id: String,
    pub name: String,
    pub host_id: String,
    pub host_name: String,
    pub image: String,
    pub desired_state: String,
    pub observed_state: String,
    pub container_id: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
}

// --- Volumes ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct CreateVolumeRequest {
    pub host_id: String,
    pub name: String,
    pub size_mb: u64,
    pub backend: String, // "hostdir" | "loopback_ext4"
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct VolumeSummary {
    pub id: String,
    pub name: String,
    pub host_id: String,
    pub host_name: String,
    pub size_mb: u64,
    pub backend: String,
    pub host_path: Option<String>,
    pub status: String, // "pending" | "ready" | "error" | "deleting"
    pub created_at: String,
}

// --- Events ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct EventRow {
    pub id: i64,
    pub ts: String,
    pub host_id: Option<String>,
    pub workload_id: Option<String>,
    pub volume_id: Option<String>,
    pub kind: String,
    pub message: String,
}

// --- Wire protocol: control-plane <-> agent over WebSocket ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct ContainerSummary {
    pub name: String,
    pub state: String, // "running" | "exited" | ...
    pub container_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct RunContainerSpec {
    pub workload_id: String,
    pub name: String, // container name on the host
    pub image: String,
    pub env: Vec<(String, String)>,
    pub ports: Vec<PortMapping>,
    pub mounts: Vec<MountSpec>,
    pub command: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct MountSpec {
    pub host_path: String,
    pub container_path: String,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct VolumeProvisionSpec {
    pub volume_id: String,
    pub size_mb: u64,
    pub backend: String, // "hostdir" | "loopback_ext4"
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind")]
#[ts(export, export_to = "../../web/lib/types/")]
pub enum Command {
    RunContainer(RunContainerSpec),
    StopContainer { name: String, timeout_s: u32 },
    RemoveContainer { name: String, force: bool },
    CreateVolume(VolumeProvisionSpec),
    DeleteVolume(VolumeProvisionSpec),
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type")]
#[ts(export, export_to = "../../web/lib/types/")]
pub enum ServerMsg {
    Pong,
    Command { task_id: String, command: Command },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct HelloPayload {
    pub os: String,
    pub arch: String,
    pub agent_version: String,
    pub containers: Vec<ContainerSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct TaskResultData {
    pub success: bool,
    pub message: Option<String>,
    pub container_id: Option<String>,
    pub host_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type")]
#[ts(export, export_to = "../../web/lib/types/")]
pub enum AgentMsg {
    Hello(HelloPayload),
    Ping { containers: Vec<ContainerSummary> },
    TaskResult { task_id: String, result: TaskResultData },
}
