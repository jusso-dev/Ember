use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

pub async fn connect(url: &str) -> anyhow::Result<SqlitePool> {
    let pool = SqlitePoolOptions::new().max_connections(8).connect(url).await?;
    Ok(pool)
}

pub async fn migrate(pool: &SqlitePool) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}
