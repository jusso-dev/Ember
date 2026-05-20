pub struct Config {
    pub bind_addr: String,
    pub db_url: String,
    pub admin_password: Option<String>,
    pub public_base_url: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            bind_addr: std::env::var("EMBER_BIND_ADDR")
                .unwrap_or_else(|_| "127.0.0.1:8080".into()),
            db_url: std::env::var("EMBER_DB_URL")
                .unwrap_or_else(|_| "sqlite://ember.db?mode=rwc".into()),
            admin_password: std::env::var("EMBER_ADMIN_PASSWORD").ok(),
            public_base_url: std::env::var("EMBER_PUBLIC_BASE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8080".into()),
        })
    }
}
