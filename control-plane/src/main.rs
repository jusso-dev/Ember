mod agent_ws;
mod api;
mod auth;
mod config;
mod db;
mod error;
mod reconciler;
mod scheduler;
mod state;

use anyhow::Context;
use std::net::SocketAddr;
use tracing_subscriber::{prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=info")),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cfg = config::Config::from_env()?;
    let pool = db::connect(&cfg.db_url).await.context("connect db")?;
    db::migrate(&pool).await.context("migrate db")?;

    let admin_hash = match &cfg.admin_password {
        Some(pw) => Some(auth::hash_password(pw).context("hash admin password")?),
        None => {
            tracing::warn!("EMBER_ADMIN_PASSWORD not set; login is disabled");
            None
        }
    };

    let app_state = state::AppState::new(pool.clone(), admin_hash, cfg.public_base_url.clone());

    tokio::spawn(reconciler::run(app_state.clone()));

    let app = api::router(app_state);

    let addr: SocketAddr = cfg.bind_addr.parse().context("parse bind addr")?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "ember control-plane listening");
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}
