use bollard::container::{
    Config, CreateContainerOptions, ListContainersOptions, RemoveContainerOptions,
    StartContainerOptions, StopContainerOptions,
};
use bollard::image::CreateImageOptions;
use bollard::models::{HostConfig, PortBinding};
use bollard::Docker;
use ember_shared::protocol::{ContainerSummary, RunContainerSpec};
use futures_util::StreamExt;
use std::collections::HashMap;

pub fn client() -> anyhow::Result<Docker> {
    Docker::connect_with_local_defaults().map_err(Into::into)
}

pub async fn list_ember_containers() -> anyhow::Result<Vec<ContainerSummary>> {
    let d = client()?;
    let mut filters = HashMap::new();
    filters.insert("label".to_string(), vec!["ember.managed=true".to_string()]);
    let opts = ListContainersOptions {
        all: true,
        filters,
        ..Default::default()
    };
    let list = d.list_containers(Some(opts)).await?;
    let out = list
        .into_iter()
        .map(|c| {
            let name = c
                .names
                .as_ref()
                .and_then(|n| n.first())
                .map(|s| s.trim_start_matches('/').to_string())
                .unwrap_or_default();
            ContainerSummary {
                name,
                state: c.state.unwrap_or_else(|| "unknown".into()),
                container_id: c.id,
            }
        })
        .collect();
    Ok(out)
}

pub async fn pull_image(d: &Docker, image: &str) -> anyhow::Result<()> {
    let opts = CreateImageOptions {
        from_image: image.to_string(),
        ..Default::default()
    };
    let mut stream = d.create_image(Some(opts), None, None);
    while let Some(item) = stream.next().await {
        if let Err(e) = item {
            anyhow::bail!("pull image {image}: {e}");
        }
    }
    Ok(())
}

pub async fn run_container(spec: &RunContainerSpec) -> anyhow::Result<String> {
    let d = client()?;
    pull_image(&d, &spec.image).await?;

    // Remove any pre-existing container with the same name (idempotent re-run).
    let _ = d
        .remove_container(
            &spec.name,
            Some(RemoveContainerOptions {
                force: true,
                ..Default::default()
            }),
        )
        .await;

    let env: Vec<String> = spec.env.iter().map(|(k, v)| format!("{k}={v}")).collect();

    let mut exposed: HashMap<String, HashMap<(), ()>> = HashMap::new();
    let mut port_bindings: HashMap<String, Option<Vec<PortBinding>>> = HashMap::new();
    for p in &spec.ports {
        let key = format!("{}/{}", p.container_port, p.protocol);
        exposed.insert(key.clone(), HashMap::new());
        port_bindings.insert(
            key,
            Some(vec![PortBinding {
                host_ip: Some("0.0.0.0".to_string()),
                host_port: Some(p.host_port.to_string()),
            }]),
        );
    }

    let binds: Vec<String> = spec
        .mounts
        .iter()
        .map(|m| {
            format!(
                "{}:{}{}",
                m.host_path,
                m.container_path,
                if m.read_only { ":ro" } else { "" }
            )
        })
        .collect();

    let mut labels = HashMap::new();
    labels.insert("ember.managed".to_string(), "true".to_string());
    labels.insert("ember.workload_id".to_string(), spec.workload_id.clone());

    let host_cfg = HostConfig {
        port_bindings: Some(port_bindings),
        binds: if binds.is_empty() { None } else { Some(binds) },
        restart_policy: Some(bollard::models::RestartPolicy {
            name: Some(bollard::models::RestartPolicyNameEnum::UNLESS_STOPPED),
            ..Default::default()
        }),
        ..Default::default()
    };

    let cfg: Config<String> = Config {
        image: Some(spec.image.clone()),
        env: Some(env),
        exposed_ports: if exposed.is_empty() { None } else { Some(exposed) },
        labels: Some(labels),
        cmd: spec.command.clone(),
        host_config: Some(host_cfg),
        ..Default::default()
    };

    let created = d
        .create_container(
            Some(CreateContainerOptions {
                name: spec.name.clone(),
                platform: None,
            }),
            cfg,
        )
        .await?;
    d.start_container(&spec.name, None::<StartContainerOptions<String>>)
        .await?;
    Ok(created.id)
}

pub async fn stop_container(name: &str, timeout_s: u32) -> anyhow::Result<()> {
    let d = client()?;
    let opts = StopContainerOptions { t: timeout_s as i64 };
    match d.stop_container(name, Some(opts)).await {
        Ok(_) => Ok(()),
        Err(bollard::errors::Error::DockerResponseServerError { status_code, .. })
            if status_code == 404 || status_code == 304 =>
        {
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

pub async fn remove_container(name: &str, force: bool) -> anyhow::Result<()> {
    let d = client()?;
    let opts = RemoveContainerOptions {
        force,
        ..Default::default()
    };
    match d.remove_container(name, Some(opts)).await {
        Ok(_) => Ok(()),
        Err(bollard::errors::Error::DockerResponseServerError { status_code, .. })
            if status_code == 404 =>
        {
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}
