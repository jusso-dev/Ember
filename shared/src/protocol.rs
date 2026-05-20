use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../web/lib/types/")]
pub struct Health {
    pub status: String,
    pub version: String,
}
