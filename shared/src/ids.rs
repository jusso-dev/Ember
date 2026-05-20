use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

macro_rules! id_newtype {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
        #[ts(export, export_to = "../../web/lib/types/")]
        pub struct $name(pub String);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::now_v7().to_string())
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

id_newtype!(HostId);
id_newtype!(WorkloadId);
id_newtype!(VolumeId);
id_newtype!(TaskId);
