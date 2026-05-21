use anyhow::Context;
use std::path::PathBuf;

pub fn volumes_root() -> PathBuf {
    if let Ok(dir) = std::env::var("EMBER_VOLUMES_DIR") {
        return PathBuf::from(dir);
    }
    PathBuf::from("/var/lib/ember/volumes")
}

pub fn volume_path(volume_id: &str) -> PathBuf {
    volumes_root().join(volume_id)
}

pub async fn create(volume_id: &str, backend: &str, _size_mb: u64) -> anyhow::Result<String> {
    match backend {
        "hostdir" => {
            let path = volume_path(volume_id);
            tokio::fs::create_dir_all(&path)
                .await
                .with_context(|| format!("mkdir -p {}", path.display()))?;
            Ok(path.to_string_lossy().into_owned())
        }
        "loopback_ext4" => {
            anyhow::bail!("loopback_ext4 backend not yet implemented in this build")
        }
        other => anyhow::bail!("unknown backend: {other}"),
    }
}

pub async fn delete(volume_id: &str, backend: &str) -> anyhow::Result<()> {
    match backend {
        "hostdir" => {
            let path = volume_path(volume_id);
            if path.exists() {
                tokio::fs::remove_dir_all(&path)
                    .await
                    .with_context(|| format!("rm -rf {}", path.display()))?;
            }
            Ok(())
        }
        "loopback_ext4" => {
            anyhow::bail!("loopback_ext4 backend not yet implemented in this build")
        }
        other => anyhow::bail!("unknown backend: {other}"),
    }
}
