use clap::{Parser, Subcommand};
use tracing_subscriber::{prelude::*, EnvFilter};

#[derive(Parser)]
#[command(name = "ember-agent", version, about = "Ember mini-cloud host agent")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Enroll this host with the control plane using a one-shot token.
    Enroll {
        #[arg(long)]
        server: String,
        #[arg(long)]
        token: String,
        #[arg(long)]
        name: String,
    },
    /// Long-running mode: connect to the control plane and execute commands.
    Run,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Enroll { server, name, .. } => {
            tracing::info!(%server, %name, "enroll: not yet implemented (milestone 2)");
        }
        Cmd::Run => {
            tracing::info!("run: not yet implemented (milestone 2)");
        }
    }
    Ok(())
}
