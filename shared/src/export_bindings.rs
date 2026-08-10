//! Export ts-rs bindings into `web/lib/types/` when tests run.
//! Invoked by `cargo test -p ember-shared`.

#[cfg(test)]
mod tests {
    use crate::ids::*;
    use crate::protocol::*;
    use ts_rs::TS;

    #[test]
    fn export_typescript_bindings() {
        // Touch every exported type so `#[ts(export)]` writes bindings.
        // Order does not matter; ts-rs overwrites files.
        let _ = std::fs::create_dir_all(concat!(env!("CARGO_MANIFEST_DIR"), "/../web/lib/types"));

        macro_rules! export_all {
            ($($t:ty),+ $(,)?) => {
                $(
                    <$t as TS>::export().expect(concat!("export ", stringify!($t)));
                )+
            };
        }

        export_all!(
            Health,
            LoginRequest,
            SessionInfo,
            UserInfo,
            TenantInfo,
            CreateFirstUserRequest,
            TenantMemberSummary,
            TenantInvitationSummary,
            TenantAccessSummary,
            RolePermissionSummary,
            CreateTenantInvitationRequest,
            AuditWebhookSummary,
            CreateAuditWebhookRequest,
            HostSummary,
            EnrollTokenResponse,
            EnrollRequest,
            EnrollResponse,
            PortMapping,
            VolumeAttachment,
            CreateWorkloadRequest,
            WorkloadSummary,
            CreateVolumeRequest,
            VolumeSummary,
            EventRow,
            AuditLogRow,
            AuditLogListResponse,
            AuditVerifyResponse,
            LogLine,
            WorkloadLogsResponse,
            ControlPlaneLogLine,
            ControlPlaneLogsResponse,
            AgentLogLine,
            AgentLogsResponse,
            ContainerSummary,
            RunContainerSpec,
            MountSpec,
            Command,
            ServerMsg,
            HelloPayload,
            TaskResultData,
            LogsResultData,
            AgentMsg,
            AcceptInvitationRequest,
            InvitationPreview,
            MfaSetupResponse,
            MfaConfirmRequest,
            MfaStatus,
            CreateApiTokenRequest,
            ApiTokenSummary,
            TenantPolicy,
            UpdateTenantPolicyRequest,
            CreateSecretRequest,
            SecretSummary,
            CreateRegistryCredentialRequest,
            RegistryCredentialSummary,
            UpdateHostRequest,
            BackupResponse,
            HostId,
            WorkloadId,
            VolumeId,
            TaskId,
        );
    }
}
