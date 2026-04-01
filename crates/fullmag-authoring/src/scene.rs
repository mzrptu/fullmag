use crate::{
    ScriptBuilderCurrentModuleState, ScriptBuilderExcitationAnalysisState, ScriptBuilderInitialState,
    ScriptBuilderMaterialState, ScriptBuilderMeshState, ScriptBuilderPerGeometryMeshState,
    ScriptBuilderSolverState, ScriptBuilderStageState, ScriptBuilderUniverseState,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SceneDocument {
    #[serde(default = "default_scene_version")]
    pub version: String,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub scene: SceneMetadata,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub universe: Option<ScriptBuilderUniverseState>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub objects: Vec<SceneObject>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub materials: Vec<SceneMaterialAsset>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub magnetization_assets: Vec<MagnetizationAsset>,
    #[serde(default)]
    pub current_modules: SceneCurrentModulesState,
    #[serde(default)]
    pub study: SceneStudyState,
    #[serde(default)]
    pub outputs: SceneOutputsState,
    #[serde(default)]
    pub editor: SceneEditorState,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct SceneMetadata {
    #[serde(default)]
    pub id: String,
    #[serde(default = "default_scene_name")]
    pub name: String,
}

impl Default for SceneMetadata {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: default_scene_name(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SceneObject {
    pub id: String,
    pub name: String,
    pub geometry: SceneGeometry,
    #[serde(default)]
    pub transform: Transform3D,
    pub material_ref: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub magnetization_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh_override: Option<ScriptBuilderPerGeometryMeshState>,
    #[serde(default = "default_true")]
    pub visible: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SceneGeometry {
    pub geometry_kind: String,
    #[serde(default)]
    pub geometry_params: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_min: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds_max: Option<[f64; 3]>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Transform3D {
    #[serde(default = "zero_vec3")]
    pub translation: [f64; 3],
    #[serde(default = "identity_quat")]
    pub rotation_quat: [f64; 4],
    #[serde(default = "one_vec3")]
    pub scale: [f64; 3],
    #[serde(default = "zero_vec3")]
    pub pivot: [f64; 3],
}

impl Default for Transform3D {
    fn default() -> Self {
        Self {
            translation: [0.0, 0.0, 0.0],
            rotation_quat: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0, 1.0, 1.0],
            pivot: [0.0, 0.0, 0.0],
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SceneMaterialAsset {
    pub id: String,
    pub name: String,
    pub properties: ScriptBuilderMaterialState,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct MagnetizationAsset {
    pub id: String,
    pub name: String,
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
    #[serde(default)]
    pub mapping: MagnetizationMapping,
    #[serde(default)]
    pub texture_transform: TextureTransform3D,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct MagnetizationMapping {
    #[serde(default = "default_mapping_space")]
    pub space: String,
    #[serde(default = "default_mapping_projection")]
    pub projection: String,
    #[serde(default = "default_mapping_clamp_mode")]
    pub clamp_mode: String,
}

impl Default for MagnetizationMapping {
    fn default() -> Self {
        Self {
            space: default_mapping_space(),
            projection: default_mapping_projection(),
            clamp_mode: default_mapping_clamp_mode(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct TextureTransform3D {
    #[serde(default = "zero_vec3")]
    pub translation: [f64; 3],
    #[serde(default = "identity_quat")]
    pub rotation_quat: [f64; 4],
    #[serde(default = "one_vec3")]
    pub scale: [f64; 3],
    #[serde(default = "zero_vec3")]
    pub pivot: [f64; 3],
}

impl Default for TextureTransform3D {
    fn default() -> Self {
        Self {
            translation: [0.0, 0.0, 0.0],
            rotation_quat: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0, 1.0, 1.0],
            pivot: [0.0, 0.0, 0.0],
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
pub struct SceneCurrentModulesState {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modules: Vec<ScriptBuilderCurrentModuleState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excitation_analysis: Option<ScriptBuilderExcitationAnalysisState>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
pub struct SceneStudyState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<String>,
    #[serde(default = "default_solver")]
    pub solver: ScriptBuilderSolverState,
    #[serde(default = "default_mesh")]
    pub mesh_defaults: ScriptBuilderMeshState,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stages: Vec<ScriptBuilderStageState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_state: Option<ScriptBuilderInitialState>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
pub struct SceneOutputsState {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
pub struct SceneEditorState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_object_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gizmo_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform_space: Option<String>,
}

fn default_scene_version() -> String {
    "scene.v1".to_string()
}

fn default_scene_name() -> String {
    "Scene".to_string()
}

const fn zero_vec3() -> [f64; 3] {
    [0.0, 0.0, 0.0]
}

const fn one_vec3() -> [f64; 3] {
    [1.0, 1.0, 1.0]
}

const fn identity_quat() -> [f64; 4] {
    [0.0, 0.0, 0.0, 1.0]
}

const fn default_true() -> bool {
    true
}

fn default_mapping_space() -> String {
    "object".to_string()
}

fn default_mapping_projection() -> String {
    "object_local".to_string()
}

fn default_mapping_clamp_mode() -> String {
    "clamp".to_string()
}

fn default_solver() -> ScriptBuilderSolverState {
    ScriptBuilderSolverState {
        integrator: String::new(),
        fixed_timestep: String::new(),
        relax_algorithm: String::new(),
        torque_tolerance: String::new(),
        energy_tolerance: String::new(),
        max_relax_steps: String::new(),
    }
}

fn default_mesh() -> ScriptBuilderMeshState {
    ScriptBuilderMeshState {
        algorithm_2d: 6,
        algorithm_3d: 1,
        hmax: String::new(),
        hmin: String::new(),
        size_factor: 1.0,
        size_from_curvature: 0,
        growth_rate: String::new(),
        narrow_regions: 0,
        smoothing_steps: 1,
        optimize: String::new(),
        optimize_iterations: 1,
        compute_quality: false,
        per_element_quality: false,
        adaptive_enabled: false,
        adaptive_policy: "manual".to_string(),
        adaptive_theta: 0.3,
        adaptive_h_min: String::new(),
        adaptive_h_max: String::new(),
        adaptive_max_passes: 5,
        adaptive_error_tolerance: String::new(),
    }
}
