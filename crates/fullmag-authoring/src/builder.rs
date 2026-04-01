use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderSolverState {
    pub integrator: String,
    pub fixed_timestep: String,
    pub relax_algorithm: String,
    pub torque_tolerance: String,
    pub energy_tolerance: String,
    pub max_relax_steps: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderMeshState {
    pub algorithm_2d: i64,
    pub algorithm_3d: i64,
    pub hmax: String,
    pub hmin: String,
    pub size_factor: f64,
    pub size_from_curvature: i64,
    #[serde(default)]
    pub growth_rate: String,
    #[serde(default)]
    pub narrow_regions: i64,
    pub smoothing_steps: i64,
    pub optimize: String,
    pub optimize_iterations: i64,
    pub compute_quality: bool,
    pub per_element_quality: bool,
    #[serde(default)]
    pub adaptive_enabled: bool,
    #[serde(default = "default_adaptive_mesh_policy")]
    pub adaptive_policy: String,
    #[serde(default = "default_adaptive_mesh_theta")]
    pub adaptive_theta: f64,
    #[serde(default)]
    pub adaptive_h_min: String,
    #[serde(default)]
    pub adaptive_h_max: String,
    #[serde(default = "default_adaptive_mesh_max_passes")]
    pub adaptive_max_passes: u32,
    #[serde(default)]
    pub adaptive_error_tolerance: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderMeshSizeFieldState {
    pub kind: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderMeshOperationState {
    pub kind: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderUniverseState {
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub center: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<[f64; 3]>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct DomainFrameDeclaredUniverseState {
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub center: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<[f64; 3]>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct DomainFrameState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declared_universe: Option<DomainFrameDeclaredUniverseState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_bounds_min: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_bounds_max: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh_bounds_min: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh_bounds_max: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_extent: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_center: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_source: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderStageState {
    pub kind: String,
    pub entrypoint_kind: String,
    pub integrator: String,
    pub fixed_timestep: String,
    pub until_seconds: String,
    pub relax_algorithm: String,
    pub torque_tolerance: String,
    pub energy_tolerance: String,
    pub max_steps: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderInitialState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub magnet_name: Option<String>,
    pub source_path: String,
    pub format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_index: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderMaterialState {
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "Ms")]
    pub ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "Aex")]
    pub aex: Option<f64>,
    #[serde(default)]
    pub alpha: f64,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "Dind")]
    pub dind: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderMagnetizationState {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_index: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderPerGeometryMeshState {
    #[serde(default = "default_inherit_mesh_mode")]
    pub mode: String,
    #[serde(default)]
    pub hmax: String,
    #[serde(default)]
    pub hmin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub algorithm_2d: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub algorithm_3d: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_factor: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_from_curvature: Option<i64>,
    #[serde(default)]
    pub growth_rate: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub narrow_regions: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smoothing_steps: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub optimize: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub optimize_iterations: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compute_quality: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_element_quality: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub size_fields: Vec<ScriptBuilderMeshSizeFieldState>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operations: Vec<ScriptBuilderMeshOperationState>,
    #[serde(default)]
    pub build_requested: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderGeometryEntry {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region_name: Option<String>,
    pub geometry_kind: String,
    #[serde(default)]
    pub geometry_params: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_min: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_max: Option<[f64; 3]>,
    pub material: ScriptBuilderMaterialState,
    pub magnetization: ScriptBuilderMagnetizationState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh: Option<ScriptBuilderPerGeometryMeshState>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderDriveState {
    pub current_a: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frequency_hz: Option<f64>,
    #[serde(default)]
    pub phase_rad: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waveform: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderCurrentModuleState {
    pub kind: String,
    pub name: String,
    pub solver: String,
    pub air_box_factor: f64,
    pub antenna_kind: String,
    #[serde(default)]
    pub antenna_params: Value,
    pub drive: ScriptBuilderDriveState,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderExcitationAnalysisState {
    pub source: String,
    pub method: String,
    pub propagation_axis: [f64; 3],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k_max_rad_per_m: Option<f64>,
    pub samples: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ScriptBuilderState {
    pub revision: u64,
    pub solver: ScriptBuilderSolverState,
    pub mesh: ScriptBuilderMeshState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub universe: Option<ScriptBuilderUniverseState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_frame: Option<DomainFrameState>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stages: Vec<ScriptBuilderStageState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_state: Option<ScriptBuilderInitialState>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub geometries: Vec<ScriptBuilderGeometryEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub current_modules: Vec<ScriptBuilderCurrentModuleState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excitation_analysis: Option<ScriptBuilderExcitationAnalysisState>,
}

fn default_inherit_mesh_mode() -> String {
    "inherit".to_string()
}

fn default_adaptive_mesh_policy() -> String {
    "manual".to_string()
}

const fn default_adaptive_mesh_theta() -> f64 {
    0.3
}

const fn default_adaptive_mesh_max_passes() -> u32 {
    5
}
