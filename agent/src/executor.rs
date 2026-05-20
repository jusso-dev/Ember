use crate::{docker, volumes};
use ember_shared::protocol::{Command, ContainerSummary, TaskResultData};

pub async fn list_containers() -> anyhow::Result<Vec<ContainerSummary>> {
    docker::list_ember_containers().await
}

pub async fn execute(cmd: &Command) -> TaskResultData {
    match cmd {
        Command::Ping => ok(None, None),
        Command::RunContainer(spec) => match docker::run_container(spec).await {
            Ok(cid) => TaskResultData {
                success: true,
                message: None,
                container_id: Some(cid),
                host_path: None,
            },
            Err(e) => err(format!("run_container: {e:#}")),
        },
        Command::StopContainer { name, timeout_s } => match docker::stop_container(name, *timeout_s).await {
            Ok(()) => ok(None, None),
            Err(e) => err(format!("stop_container: {e:#}")),
        },
        Command::RemoveContainer { name, force } => match docker::remove_container(name, *force).await {
            Ok(()) => ok(None, None),
            Err(e) => err(format!("remove_container: {e:#}")),
        },
        Command::CreateVolume(spec) => match volumes::create(&spec.volume_id, &spec.backend, spec.size_mb).await {
            Ok(path) => ok(None, Some(path)),
            Err(e) => err(format!("create_volume: {e:#}")),
        },
        Command::DeleteVolume(spec) => match volumes::delete(&spec.volume_id, &spec.backend).await {
            Ok(()) => ok(None, None),
            Err(e) => err(format!("delete_volume: {e:#}")),
        },
    }
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
