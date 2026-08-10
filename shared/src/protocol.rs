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
    pub email: String,
    pub password: String,
    /// TOTP code when MFA is enabled for the user.
    #[serde(default)]
    pub totp_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct SessionInfo {
    pub authenticated: bool,
    pub setup_required: bool,
    pub user: Option<UserInfo>,
    pub active_tenant: Option<TenantInfo>,
    #[serde(default)]
    pub mfa_enabled: bool,
    #[serde(default)]
    pub mfa_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct UserInfo {
    pub id: String,
    pub email: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct TenantInfo {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct CreateFirstUserRequest {
    pub email: String,
    pub name: String,
    pub password: String,
    pub tenant_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct TenantMemberSummary {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub role: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct TenantInvitationSummary {
    pub id: String,
    pub email: String,
    pub role: String,
    pub expires_at: String,
    pub created_at: String,
    pub invite_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct TenantAccessSummary {
    pub tenant: TenantInfo,
    pub members: Vec<TenantMemberSummary>,
    pub invitations: Vec<TenantInvitationSummary>,
    pub role_matrix: Vec<RolePermissionSummary>,
    pub audit_webhooks: Vec<AuditWebhookSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct RolePermissionSummary {
    pub role: String,
    pub description: String,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct CreateTenantInvitationRequest {
    pub email: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct AuditWebhookSummary {
    pub id: String,
    pub url: String,
    pub event_filter: Vec<String>,
    pub failure_count: u32,
    pub last_error: Option<String>,
    pub last_delivered_at: Option<String>,
    pub created_at: String,
    pub secret_once: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct CreateAuditWebhookRequest {
    pub url: String,
    pub event_filter: Vec<String>,
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
    #[serde(default)]
    pub labels: Vec<(String, String)>,
    #[serde(default)]
    pub cordoned: bool,
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
    /// Optional; when empty, control plane places on best online host.
    #[serde(default)]
    pub host_id: Option<String>,
    pub name: String,
    pub image: String,
    pub env: Vec<(String, String)>,
    pub ports: Vec<PortMapping>,
    pub volumes: Vec<VolumeAttachment>,
    pub command: Option<Vec<String>>,
    #[serde(default)]
    pub labels: Vec<(String, String)>,
    /// Host label selector: host must have all of these labels.
    #[serde(default)]
    pub placement_labels: Vec<(String, String)>,
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
    #[serde(default)]
    pub labels: Vec<(String, String)>,
}

// --- Volumes ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct CreateVolumeRequest {
    pub host_id: String,
    pub name: String,
    /// JSON number (fits JS safely for homelab sizes).
    #[ts(type = "number")]
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
    #[ts(type = "number")]
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

// --- Audit log ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct AuditLogRow {
    pub id: i64,
    pub ts: String,
    pub actor_user_id: Option<String>,
    pub actor_email: Option<String>,
    pub actor_tenant_id: Option<String>,
    pub action: String,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub result: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct AuditLogListResponse {
    pub rows: Vec<AuditLogRow>,
    pub next_cursor: Option<i64>,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct AuditVerifyResponse {
    pub verified: bool,
    pub last_verified_id: Option<i64>,
    pub first_bad_id: Option<i64>,
}

// --- Logs (workload container + control plane) ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct LogLine {
    pub stream: String, // "stdout" | "stderr"
    pub timestamp: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct WorkloadLogsResponse {
    pub workload_id: String,
    pub host_id: String,
    pub fetched_at: String,
    pub lines: Vec<LogLine>,
    pub truncated: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct ControlPlaneLogLine {
    pub ts: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct ControlPlaneLogsResponse {
    pub lines: Vec<ControlPlaneLogLine>,
    pub capacity: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct AgentLogLine {
    pub id: Option<i64>,
    pub host_id: String,
    pub ts: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct AgentLogsResponse {
    pub host_id: String,
    pub lines: Vec<AgentLogLine>,
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
    #[ts(type = "number")]
    pub size_mb: u64,
    pub backend: String, // "hostdir" | "loopback_ext4"
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind")]
#[ts(export, export_to = "../../web/lib/types/")]
pub enum Command {
    RunContainer(RunContainerSpec),
    StopContainer {
        name: String,
        timeout_s: u32,
    },
    RemoveContainer {
        name: String,
        force: bool,
    },
    CreateVolume(VolumeProvisionSpec),
    DeleteVolume(VolumeProvisionSpec),
    FetchContainerLogs {
        workload_id: String,
        name: String,
        tail_lines: u32,
    },
    StreamContainerLogs {
        workload_id: String,
        name: String,
        subscription_id: String,
    },
    CancelLogStream {
        subscription_id: String,
    },
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
#[ts(export, export_to = "../../web/lib/types/")]
pub struct LogsResultData {
    pub success: bool,
    pub message: Option<String>,
    pub lines: Vec<LogLine>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type")]
#[ts(export, export_to = "../../web/lib/types/")]
pub enum AgentMsg {
    Hello(HelloPayload),
    Ping {
        containers: Vec<ContainerSummary>,
    },
    TaskResult {
        task_id: String,
        result: TaskResultData,
    },
    LogsResult {
        task_id: String,
        result: LogsResultData,
    },
    LogChunk {
        subscription_id: String,
        workload_id: String,
        lines: Vec<LogLine>,
    },
    LogStreamEnded {
        subscription_id: String,
        reason: String,
    },
    AgentLogs {
        batch: Vec<AgentLogLine>,
    },
}

// --- P0/P1 enterprise types ---

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct AcceptInvitationRequest {
    pub token: String,
    pub name: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct InvitationPreview {
    pub email: String,
    pub role: String,
    pub tenant_name: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct MfaSetupResponse {
    pub secret: String,
    pub otpauth_url: String,
    pub recovery_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct MfaConfirmRequest {
    pub totp_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct MfaStatus {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct CreateApiTokenRequest {
    pub name: String,
    /// Optional role override (defaults to caller's tenant role, capped at operator for safety).
    #[serde(default)]
    pub role: Option<String>,
    pub expires_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct ApiTokenSummary {
    pub id: String,
    pub name: String,
    pub token_prefix: String,
    pub role: String,
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
    pub created_at: String,
    /// Only set once on create.
    pub token_once: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct TenantPolicy {
    pub deny_latest_tag: bool,
    pub image_allowlist: Vec<String>,
    pub max_workloads: Option<u32>,
    pub max_volumes: Option<u32>,
    #[ts(type = "number | null")]
    pub max_volume_mb_total: Option<u64>,
    pub allowed_host_ports: Vec<u16>,
    pub require_mfa_admins: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct UpdateTenantPolicyRequest {
    pub deny_latest_tag: bool,
    pub image_allowlist: Vec<String>,
    pub max_workloads: Option<u32>,
    pub max_volumes: Option<u32>,
    #[ts(type = "number | null")]
    pub max_volume_mb_total: Option<u64>,
    pub allowed_host_ports: Vec<u16>,
    pub require_mfa_admins: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct CreateSecretRequest {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct SecretSummary {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct CreateRegistryCredentialRequest {
    pub registry: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct RegistryCredentialSummary {
    pub id: String,
    pub registry: String,
    pub username: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct UpdateHostRequest {
    #[serde(default)]
    pub labels: Option<Vec<(String, String)>>,
    #[serde(default)]
    pub cordoned: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct BackupResponse {
    pub path: String,
    #[ts(type = "number")]
    pub bytes: u64,
    pub created_at: String,
}
