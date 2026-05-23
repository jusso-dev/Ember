mod agent_ws;
mod api;
mod audit;
mod auth;
mod config;
mod db;
mod error;
mod log_buffer;
mod reconciler;
mod scheduler;
mod state;

use anyhow::Context;
use std::net::SocketAddr;
use tracing_subscriber::{prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let log_buffer = log_buffer::LogBuffer::new(5000);
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=info")),
        )
        .with(tracing_subscriber::fmt::layer())
        .with(log_buffer::BufferLayer::new(log_buffer.clone()))
        .init();

    let cfg = config::Config::from_env()?;
    let pool = db::connect(&cfg.db_url).await.context("connect db")?;
    db::migrate(&pool).await.context("migrate db")?;

    if cfg.admin_password.is_some() {
        tracing::warn!("EMBER_ADMIN_PASSWORD is ignored; use the first-run user setup flow");
    }

    let app_state = state::AppState::new(pool.clone(), cfg.public_base_url.clone(), log_buffer);

    tokio::spawn(reconciler::run(app_state.clone()));

    let app = api::router(app_state);

    let addr: SocketAddr = cfg.bind_addr.parse().context("parse bind addr")?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "ember control-plane listening");
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}
