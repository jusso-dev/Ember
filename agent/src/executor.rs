use crate::{docker, volumes};
use ember_shared::protocol::{AgentMsg, Command, ContainerSummary, LogsResultData, TaskResultData};

pub async fn list_containers() -> anyhow::Result<Vec<ContainerSummary>> {
    docker::list_ember_containers().await
}

/// Execute a server command and produce the agent message that reports the
/// outcome back to the control plane. Most commands produce a `TaskResult`,
/// but log-fetch requests produce a separate `LogsResult` variant so the
/// control plane doesn't need to drag log payloads through the persistent
/// task table.
pub async fn execute(task_id: String, cmd: &Command) -> AgentMsg {
    match cmd {
        Command::Ping => msg_task(task_id, ok(None, None)),
        Command::RunContainer(spec) => msg_task(
            task_id,
            match docker::run_container(spec).await {
                Ok(cid) => TaskResultData {
                    success: true,
                    message: None,
                    container_id: Some(cid),
                    host_path: None,
                },
                Err(e) => err(format!("run_container: {e:#}")),
            },
        ),
        Command::StopContainer { name, timeout_s } => msg_task(
            task_id,
            match docker::stop_container(name, *timeout_s).await {
                Ok(()) => ok(None, None),
                Err(e) => err(format!("stop_container: {e:#}")),
            },
        ),
        Command::RemoveContainer { name, force } => msg_task(
            task_id,
            match docker::remove_container(name, *force).await {
                Ok(()) => ok(None, None),
                Err(e) => err(format!("remove_container: {e:#}")),
            },
        ),
        Command::CreateVolume(spec) => msg_task(
            task_id,
            match volumes::create(&spec.volume_id, &spec.backend, spec.size_mb).await {
                Ok(path) => ok(None, Some(path)),
                Err(e) => err(format!("create_volume: {e:#}")),
            },
        ),
        Command::DeleteVolume(spec) => msg_task(
            task_id,
            match volumes::delete(&spec.volume_id, &spec.backend).await {
                Ok(()) => ok(None, None),
                Err(e) => err(format!("delete_volume: {e:#}")),
            },
        ),
        Command::FetchContainerLogs {
            name, tail_lines, ..
        } => {
            let result = match docker::container_logs(name, *tail_lines).await {
                Ok(lines) => LogsResultData {
                    success: true,
                    message: None,
                    truncated: lines.len() as u32 >= *tail_lines,
                    lines,
                },
                Err(e) => LogsResultData {
                    success: false,
                    message: Some(format!("container_logs: {e:#}")),
                    lines: vec![],
                    truncated: false,
                },
            };
            AgentMsg::LogsResult {
                task_id,
                result,
            }
        }
    }
}

fn msg_task(task_id: String, result: TaskResultData) -> AgentMsg {
    AgentMsg::TaskResult { task_id, result }
}

fn ok(container_id: Option<String>, host_path: Option<String>) -> TaskResultData {
    TaskResultData {
        success: true,
        message: None,
        container_id,
        host_path,
    }
}

fn err(message: String) -> TaskResultData {
    TaskResultData {
        success: false,
        message: Some(message),
        container_id: None,
        host_path: None,
    }
}
