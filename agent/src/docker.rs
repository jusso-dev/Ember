use bollard::container::{
    Config, CreateContainerOptions, ListContainersOptions, LogOutput, LogsOptions,
    RemoveContainerOptions, StartContainerOptions, StopContainerOptions,
};
use bollard::image::CreateImageOptions;
use bollard::models::{HostConfig, PortBinding};
use bollard::Docker;
use ember_shared::protocol::{AgentMsg, ContainerSummary, LogLine, RunContainerSpec};
use futures_util::StreamExt;
use std::collections::HashMap;

const MAX_LOG_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

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
        exposed_ports: if exposed.is_empty() {
            None
        } else {
            Some(exposed)
        },
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
    let opts = StopContainerOptions {
        t: timeout_s as i64,
    };
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

pub async fn container_logs(name: &str, tail: u32) -> anyhow::Result<(Vec<LogLine>, bool)> {
    let d = client()?;
    let opts = LogsOptions::<String> {
        stdout: true,
        stderr: true,
        follow: false,
        timestamps: true,
        tail: tail.to_string(),
        ..Default::default()
    };
    let mut stream = d.logs(name, Some(opts));
    let mut out: Vec<LogLine> = Vec::new();
    let mut total_bytes = 0usize;
    let mut truncated = false;
    while let Some(item) = stream.next().await {
        let (stream_name, bytes) = match item {
            Ok(LogOutput::StdOut { message }) => ("stdout", message),
            Ok(LogOutput::StdErr { message }) => ("stderr", message),
            Ok(LogOutput::Console { message }) => ("stdout", message),
            Ok(LogOutput::StdIn { .. }) => continue,
            Err(bollard::errors::Error::DockerResponseServerError { status_code, .. })
                if status_code == 404 =>
            {
                anyhow::bail!("container '{name}' not found");
            }
            Err(e) => return Err(e.into()),
        };
        let text = String::from_utf8_lossy(&bytes).to_string();
        for raw in text.lines() {
            let (ts, msg) = split_timestamp(raw);
            let line = LogLine {
                stream: stream_name.to_string(),
                timestamp: ts,
                message: msg,
            };
            total_bytes += log_line_bytes(&line);
            out.push(line);
            while total_bytes > MAX_LOG_RESPONSE_BYTES && !out.is_empty() {
                total_bytes = total_bytes.saturating_sub(log_line_bytes(&out.remove(0)));
                truncated = true;
            }
        }
    }
    Ok((out, truncated))
}

pub async fn follow_container_logs(
    name: String,
    subscription_id: String,
    workload_id: String,
    out_tx: tokio::sync::mpsc::UnboundedSender<AgentMsg>,
) {
    let result = follow_container_logs_inner(&name, &subscription_id, &workload_id, &out_tx).await;
    let reason = match result {
        Ok(()) => "container log stream ended".to_string(),
        Err(e) => format!("container log stream failed: {e:#}"),
    };
    let _ = out_tx.send(AgentMsg::LogStreamEnded {
        subscription_id,
        reason,
    });
}

async fn follow_container_logs_inner(
    name: &str,
    subscription_id: &str,
    workload_id: &str,
    out_tx: &tokio::sync::mpsc::UnboundedSender<AgentMsg>,
) -> anyhow::Result<()> {
    let d = client()?;
    let opts = LogsOptions::<String> {
        stdout: true,
        stderr: true,
        follow: true,
        timestamps: true,
        tail: "0".into(),
        ..Default::default()
    };
    let mut stream = d.logs(name, Some(opts));
    while let Some(item) = stream.next().await {
        let (stream_name, bytes) = match item {
            Ok(LogOutput::StdOut { message }) => ("stdout", message),
            Ok(LogOutput::StdErr { message }) => ("stderr", message),
            Ok(LogOutput::Console { message }) => ("stdout", message),
            Ok(LogOutput::StdIn { .. }) => continue,
            Err(e) => return Err(e.into()),
        };
        let text = String::from_utf8_lossy(&bytes).to_string();
        let lines = text
            .lines()
            .map(|raw| {
                let (ts, msg) = split_timestamp(raw);
                LogLine {
                    stream: stream_name.to_string(),
                    timestamp: ts,
                    message: msg,
                }
            })
            .collect::<Vec<_>>();
        if !lines.is_empty()
            && out_tx
                .send(AgentMsg::LogChunk {
                    subscription_id: subscription_id.to_string(),
                    workload_id: workload_id.to_string(),
                    lines,
                })
                .is_err()
        {
            break;
        }
    }
    Ok(())
}

fn split_timestamp(line: &str) -> (Option<String>, String) {
    // Docker timestamps look like "2024-01-02T03:04:05.123456789Z rest of line"
    match line.split_once(' ') {
        Some((ts, rest)) if ts.len() >= 20 && ts.contains('T') && ts.ends_with('Z') => {
            (Some(ts.to_string()), rest.to_string())
        }
        _ => (None, line.to_string()),
    }
}

fn log_line_bytes(line: &LogLine) -> usize {
    line.stream.len()
        + line.timestamp.as_ref().map(|s| s.len()).unwrap_or_default()
        + line.message.len()
        + 16
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
