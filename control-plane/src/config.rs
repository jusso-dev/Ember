pub struct Config {
    pub bind_addr: String,
    pub db_url: String,
    pub admin_password: Option<String>,
    pub public_base_url: String,
    pub audit_retention_days: i64,
    pub control_plane_log_retention_days: i64,
    pub workload_log_retention_days: i64,
    pub agent_log_retention_days: i64,
    pub audit_sinks: Vec<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            bind_addr: std::env::var("EMBER_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into()),
            db_url: std::env::var("EMBER_DB_URL")
                .unwrap_or_else(|_| "sqlite://ember.db?mode=rwc".into()),
            admin_password: std::env::var("EMBER_ADMIN_PASSWORD").ok(),
            public_base_url: std::env::var("EMBER_PUBLIC_BASE_URL")
                .unwrap_or_else(|_| default_public_base_url()),
            audit_retention_days: parse_i64("EMBER_AUDIT_RETENTION_DAYS", 365),
            control_plane_log_retention_days: parse_i64(
                "EMBER_CONTROL_PLANE_LOG_RETENTION_DAYS",
                7,
            ),
            workload_log_retention_days: parse_i64("EMBER_WORKLOAD_LOG_RETENTION_DAYS", 7),
            agent_log_retention_days: parse_i64("EMBER_AGENT_LOG_RETENTION_DAYS", 7),
            audit_sinks: std::env::var("EMBER_AUDIT_SINK")
                .unwrap_or_else(|_| "db".into())
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
                .collect(),
        })
    }
}

fn parse_i64(name: &str, default: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn default_public_base_url() -> String {
    let ip = std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            let _ = socket.connect("8.8.8.8:80");
            socket.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into());
    format!("http://{ip}:3000")
}
