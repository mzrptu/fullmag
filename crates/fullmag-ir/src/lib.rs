use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExecutionMode {
    Strict,
    Extended,
    Hybrid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BackendTarget {
    Auto,
    Fdm,
    Fem,
    Hybrid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MaterialIR {
    pub name: String,
    pub saturation_magnetisation: f64,
    pub exchange_stiffness: f64,
    pub damping: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProblemIR {
    pub ir_version: String,
    pub name: String,
    pub mode: ExecutionMode,
    pub backend: BackendTarget,
    pub geometry_ref: String,
    pub materials: Vec<MaterialIR>,
    pub energy_terms: Vec<String>,
    pub outputs: Vec<String>,
}

impl ProblemIR {
    pub fn bootstrap_example() -> Self {
        Self {
            ir_version: "0.1.0-draft".to_string(),
            name: "dw_track".to_string(),
            mode: ExecutionMode::Strict,
            backend: BackendTarget::Auto,
            geometry_ref: "track.step".to_string(),
            materials: vec![MaterialIR {
                name: "Py".to_string(),
                saturation_magnetisation: 800e3,
                exchange_stiffness: 13e-12,
                damping: 0.01,
            }],
            energy_terms: vec![
                "exchange".to_string(),
                "demag".to_string(),
                "dmi(interfacial)".to_string(),
                "zeeman".to_string(),
            ],
            outputs: vec!["field:m".to_string(), "scalar:E_total".to_string()],
        }
    }
}
