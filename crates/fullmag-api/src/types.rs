//! API request/response types and view models.

use fullmag_runner::{
    DisplaySelectionState, FemMeshPayload, LivePreviewField, LivePreviewRequest, RuntimeStatus,
    StepUpdate,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::AtomicU32;
use std::sync::Arc;
use tokio::sync::{broadcast, watch, Mutex, RwLock};

pub(crate) type CurrentPreviewConfig = LivePreviewRequest;
pub(crate) type CurrentDisplaySelection = DisplaySelectionState;

#[derive(Debug, Clone)]
pub(crate) struct AppState {
    pub repo_root: PathBuf,
    pub current_workspace_root: PathBuf,
    /// Per-run broadcast channels for live step updates.
    pub live_channels: Arc<RwLock<HashMap<String, broadcast::Sender<StepUpdate>>>>,
    /// Sessionless local-live workspace snapshot used by the root `/` GUI.
    pub current_live_state: Arc<RwLock<Option<SessionStateResponse>>>,
    /// Latest public snapshot JSON served to `/state` and bootstrap HTTP clients.
    pub current_live_public_snapshot: Arc<RwLock<Option<String>>>,
    /// Canonical current-workspace wire messages broadcast to SSE/WS clients.
    pub current_live_events: broadcast::Sender<CurrentLiveWireMessage>,
    /// Monotonic payload id for binary vector preview frames.
    pub current_live_vector_payload_seq: Arc<AtomicU32>,
    /// Typed display selection for the sessionless root workspace.
    pub current_display_selection: Arc<RwLock<CurrentDisplaySelection>>,
    /// In-memory sequenced control queue for the root local-live workspace.
    pub current_control_queue: Arc<Mutex<VecDeque<SessionCommand>>>,
    /// Latest queued control sequence number.
    pub current_control_events: watch::Sender<u64>,
    /// Monotonic sequence generator for the current session control stream.
    pub current_control_next_seq: Arc<Mutex<u64>>,
}

#[derive(Debug, Clone)]
pub(crate) enum CurrentLiveWireMessage {
    Text(String),
    Binary(Vec<u8>),
}

#[derive(Debug, Serialize)]
pub(crate) struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
}

#[derive(Debug, Serialize)]
pub(crate) struct VisionResponse {
    pub north_star: &'static str,
    pub modes: [&'static str; 3],
    pub runtime_spine: &'static str,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct SessionManifest {
    pub session_id: String,
    pub run_id: String,
    pub status: String,
    pub interactive_session_requested: bool,
    pub script_path: String,
    pub problem_name: String,
    pub requested_backend: String,
    pub execution_mode: String,
    pub precision: String,
    pub artifact_dir: String,
    pub started_at_unix_ms: u128,
    pub finished_at_unix_ms: u128,
    pub plan_summary: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct RunManifest {
    pub run_id: String,
    pub session_id: String,
    pub status: String,
    pub total_steps: usize,
    pub final_time: Option<f64>,
    pub final_e_ex: Option<f64>,
    pub final_e_demag: Option<f64>,
    pub final_e_ext: Option<f64>,
    pub final_e_total: Option<f64>,
    pub artifact_dir: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct ArtifactEntry {
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ArtifactFileQuery {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct EigenModeQuery {
    pub index: u32,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub(crate) struct EigenDispersionRow {
    pub mode_index: u32,
    pub kx: f64,
    pub ky: f64,
    pub kz: f64,
    pub frequency_hz: f64,
    pub angular_frequency_rad_per_s: f64,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct EigenDispersionResponse {
    pub csv_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_metadata: Option<Value>,
    pub rows: Vec<EigenDispersionRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ScalarRow {
    pub step: u64,
    pub time: f64,
    pub solver_dt: f64,
    pub mx: f64,
    pub my: f64,
    pub mz: f64,
    pub e_ex: f64,
    pub e_demag: f64,
    pub e_ext: f64,
    pub e_total: f64,
    pub max_dm_dt: f64,
    pub max_h_eff: f64,
    pub max_h_demag: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct LiveState {
    pub status: String,
    pub updated_at_unix_ms: u128,
    pub latest_step: StepUpdateView,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ScriptBuilderSolverState {
    pub integrator: String,
    pub fixed_timestep: String,
    pub relax_algorithm: String,
    pub torque_tolerance: String,
    pub energy_tolerance: String,
    pub max_relax_steps: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ScriptBuilderMeshState {
    pub algorithm_2d: i64,
    pub algorithm_3d: i64,
    pub hmax: String,
    pub hmin: String,
    pub size_factor: f64,
    pub size_from_curvature: i64,
    pub smoothing_steps: i64,
    pub optimize: String,
    pub optimize_iterations: i64,
    pub compute_quality: bool,
    pub per_element_quality: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ScriptBuilderStageState {
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ScriptBuilderInitialState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub magnet_name: Option<String>,
    pub source_path: String,
    pub format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_index: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ScriptBuilderState {
    pub revision: u64,
    pub solver: ScriptBuilderSolverState,
    pub mesh: ScriptBuilderMeshState,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stages: Vec<ScriptBuilderStageState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_state: Option<ScriptBuilderInitialState>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct EngineLogEntry {
    pub timestamp_unix_ms: u128,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct StepUpdateView {
    pub step: u64,
    pub time: f64,
    pub dt: f64,
    pub e_ex: f64,
    pub e_demag: f64,
    pub e_ext: f64,
    pub e_total: f64,
    pub max_dm_dt: f64,
    pub max_h_eff: f64,
    #[serde(default)]
    pub max_h_demag: f64,
    pub wall_time_ns: u64,
    pub grid: [u32; 3],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fem_mesh: Option<FemMeshPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub magnetization: Option<Vec<f64>>,
    #[serde(skip_serializing)]
    pub preview_field: Option<LivePreviewField>,
    pub finished: bool,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct SessionStateResponse {
    pub session: SessionManifest,
    pub run: Option<RunManifest>,
    pub live_state: Option<LiveState>,
    pub runtime_status: RuntimeStatusView,
    pub metadata: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_workspace: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_builder: Option<ScriptBuilderState>,
    pub scalar_rows: Vec<ScalarRow>,
    pub engine_log: Vec<EngineLogEntry>,
    pub quantities: Vec<QuantityDescriptor>,
    pub fem_mesh: Option<FemMeshPayload>,
    pub latest_fields: LatestFields,
    #[serde(skip_serializing, default)]
    pub preview_cache: CachedPreviewFields,
    pub artifacts: Vec<ArtifactEntry>,
    pub display_selection: CurrentDisplaySelection,
    pub preview_config: CurrentPreviewConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<PreviewState>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum CurrentLiveEvent<'a> {
    SessionState { state: SessionStateEventView<'a> },
}

#[derive(Debug, Serialize)]
pub(crate) struct SessionStateEventView<'a> {
    pub session: &'a SessionManifest,
    pub run: Option<&'a RunManifest>,
    pub live_state: Option<&'a LiveState>,
    pub runtime_status: &'a RuntimeStatusView,
    pub metadata: Option<&'a Value>,
    pub script_builder: Option<&'a ScriptBuilderState>,
    pub scalar_rows: &'a [ScalarRow],
    pub engine_log: &'a [EngineLogEntry],
    pub quantities: &'a [QuantityDescriptor],
    pub fem_mesh: Option<&'a FemMeshPayload>,
    pub latest_fields: &'a LatestFields,
    pub artifacts: &'a [ArtifactEntry],
    pub display_selection: &'a CurrentDisplaySelection,
    pub preview_config: &'a CurrentPreviewConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<PreviewState>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SessionStateResponseView<'a> {
    pub session: &'a SessionManifest,
    pub run: Option<&'a RunManifest>,
    pub live_state: Option<&'a LiveState>,
    pub runtime_status: &'a RuntimeStatusView,
    pub metadata: Option<&'a Value>,
    pub script_builder: Option<&'a ScriptBuilderState>,
    pub scalar_rows: &'a [ScalarRow],
    pub engine_log: &'a [EngineLogEntry],
    pub quantities: &'a [QuantityDescriptor],
    pub fem_mesh: Option<&'a FemMeshPayload>,
    pub latest_fields: &'a LatestFields,
    pub artifacts: &'a [ArtifactEntry],
    pub display_selection: &'a CurrentDisplaySelection,
    pub preview_config: &'a CurrentPreviewConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<&'a PreviewState>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct QuantityDescriptor {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub unit: String,
    pub location: String,
    pub available: bool,
    pub interactive_preview: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quick_access_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scalar_metric_key: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(transparent)]
pub(crate) struct LatestFields(BTreeMap<String, Value>);

#[derive(Debug, Default, Clone)]
pub(crate) struct CachedPreviewFields(BTreeMap<String, LivePreviewField>);

impl LatestFields {
    pub(crate) fn get(&self, quantity: &str) -> Option<&Value> {
        self.0.get(quantity)
    }

    pub(crate) fn extend(&mut self, incoming: Self) {
        self.0.extend(incoming.0);
    }
}

impl CachedPreviewFields {
    pub(crate) fn get(&self, quantity: &str) -> Option<&LivePreviewField> {
        self.0.get(quantity)
    }

    pub(crate) fn insert(&mut self, field: LivePreviewField) {
        self.0.insert(field.quantity.clone(), field);
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum PreviewState {
    Spatial(SpatialPreviewState),
    GlobalScalar(GlobalScalarPreviewState),
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct SpatialPreviewState {
    pub display_kind: String,
    pub config_revision: u64,
    pub source_step: u64,
    pub source_time: f64,
    pub spatial_kind: String,
    pub quantity: String,
    pub unit: String,
    pub component: String,
    pub layer: usize,
    pub all_layers: bool,
    #[serde(rename = "type")]
    pub view_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vector_payload_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vector_field_values: Option<Vec<f64>>,
    pub scalar_field: Vec<[f64; 3]>,
    pub min: f64,
    pub max: f64,
    pub n_comp: usize,
    pub max_points: usize,
    pub data_points_count: usize,
    pub x_possible_sizes: Vec<usize>,
    pub y_possible_sizes: Vec<usize>,
    pub x_chosen_size: usize,
    pub y_chosen_size: usize,
    pub applied_x_chosen_size: usize,
    pub applied_y_chosen_size: usize,
    pub applied_layer_stride: usize,
    pub auto_scale_enabled: bool,
    pub auto_downscaled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_downscale_message: Option<String>,
    pub preview_grid: [usize; 3],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fem_mesh: Option<FemMeshPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_node_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_face_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_mask: Option<Vec<bool>>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct GlobalScalarPreviewState {
    pub display_kind: String,
    pub config_revision: u64,
    pub source_step: u64,
    pub source_time: f64,
    pub quantity: String,
    pub unit: String,
    pub value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeStatusView {
    pub kind: RuntimeStatus,
    pub code: String,
    pub is_busy: bool,
    pub can_accept_commands: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PreviewQuantityRequest {
    pub quantity: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PreviewComponentRequest {
    pub component: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PreviewXChosenSizeRequest {
    #[serde(rename = "xChosenSize")]
    pub x_chosen_size: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PreviewEveryNRequest {
    #[serde(rename = "everyN")]
    pub every_n: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PreviewYChosenSizeRequest {
    #[serde(rename = "yChosenSize")]
    pub y_chosen_size: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PreviewAutoScaleRequest {
    #[serde(rename = "autoScaleEnabled")]
    pub auto_scale_enabled: bool,
}

const fn default_preview_wait_timeout_ms() -> u64 {
    15_000
}

#[derive(Debug, Deserialize)]
pub(crate) struct ControlWaitQuery {
    #[serde(rename = "afterSeq", default)]
    pub after_seq: u64,
    #[serde(rename = "timeoutMs", default = "default_preview_wait_timeout_ms")]
    pub timeout_ms: u64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PreviewMaxPointsRequest {
    #[serde(rename = "maxPoints")]
    pub max_points: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PreviewLayerRequest {
    pub layer: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PreviewAllLayersRequest {
    #[serde(rename = "allLayers")]
    pub all_layers: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RunRequest {
    pub problem: fullmag_ir::ProblemIR,
    pub until_seconds: f64,
    #[serde(default = "default_output_dir")]
    pub output_dir: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ImportSessionAssetRequest {
    pub file_name: String,
    pub content_base64: String,
    pub target_realization: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ExportMagnetizationStateRequest {
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub dataset: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ExportMagnetizationStateResponse {
    pub file_name: String,
    pub format: String,
    pub stored_path: String,
    pub vector_count: usize,
    pub content_base64: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ImportMagnetizationStateRequest {
    pub file_name: String,
    pub content_base64: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub dataset: Option<String>,
    #[serde(default)]
    pub sample_index: Option<i64>,
    #[serde(default)]
    pub apply_to_workspace: bool,
    #[serde(default = "default_true")]
    pub attach_to_script_builder: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct ImportMagnetizationStateResponse {
    pub asset_id: String,
    pub session_id: String,
    pub stored_path: String,
    pub file_name: String,
    pub format: String,
    pub vector_count: usize,
    pub applied_to_workspace: bool,
    pub attached_to_script_builder: bool,
}

const fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub(crate) struct SessionAssetImportResponse {
    pub asset_id: String,
    pub session_id: String,
    pub stored_path: String,
    pub target_realization: String,
    pub summary: ImportedAssetSummary,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ScriptSyncRequest {
    #[serde(default)]
    pub overrides: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ScriptBuilderUpdateRequest {
    #[serde(default)]
    pub solver: Option<ScriptBuilderSolverState>,
    #[serde(default)]
    pub mesh: Option<ScriptBuilderMeshState>,
    #[serde(default)]
    pub stages: Option<Vec<ScriptBuilderStageState>>,
    #[serde(default)]
    pub initial_state: Option<ScriptBuilderInitialState>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ScriptSyncResponse {
    pub script_path: String,
    pub source_kind: String,
    pub entrypoint_kind: String,
    pub written: bool,
    pub bytes_written: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SessionCommandRequest {
    pub kind: String,
    #[serde(default)]
    pub until_seconds: Option<f64>,
    #[serde(default)]
    pub max_steps: Option<u64>,
    #[serde(default)]
    pub torque_tolerance: Option<f64>,
    #[serde(default)]
    pub energy_tolerance: Option<f64>,
    #[serde(default)]
    pub integrator: Option<String>,
    #[serde(default)]
    pub fixed_timestep: Option<f64>,
    #[serde(default)]
    pub relax_algorithm: Option<String>,
    #[serde(default)]
    pub relax_alpha: Option<f64>,
    #[serde(default)]
    pub mesh_options: Option<Value>,
    #[serde(default)]
    pub state_path: Option<String>,
    #[serde(default)]
    pub state_format: Option<String>,
    #[serde(default)]
    pub state_dataset: Option<String>,
    #[serde(default)]
    pub state_sample_index: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CurrentLivePublishRequest {
    pub session_id: String,
    #[serde(default)]
    pub session: Option<SessionManifest>,
    #[serde(default)]
    pub session_status: Option<String>,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub mesh_workspace: Option<Value>,
    #[serde(default)]
    pub run: Option<RunManifest>,
    #[serde(default)]
    pub live_state: Option<LiveState>,
    #[serde(default)]
    pub latest_scalar_row: Option<ScalarRow>,
    #[serde(default)]
    pub latest_fields: Option<LatestFields>,
    #[serde(default)]
    pub preview_fields: Option<Vec<LivePreviewField>>,
    #[serde(default)]
    pub clear_preview_cache: bool,
    #[serde(default)]
    pub engine_log: Option<Vec<EngineLogEntry>>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SessionCommandResponse {
    pub command_id: String,
    pub session_id: String,
    pub seq: u64,
    pub kind: String,
    pub queued_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct SessionCommand {
    pub seq: u64,
    pub command_id: String,
    pub kind: String,
    pub created_at_unix_ms: u128,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until_seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_steps: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub torque_tolerance: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub energy_tolerance: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integrator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_timestep: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relax_algorithm: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relax_alpha: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh_options: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_dataset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_sample_index: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_selection: Option<CurrentDisplaySelection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_config: Option<CurrentPreviewConfig>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ImportedAssetSummary {
    pub file_name: String,
    pub file_bytes: usize,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<BoundsSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub triangle_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary_face_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct BoundsSummary {
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub size: [f64; 3],
}

pub(crate) fn default_output_dir() -> String {
    ".fullmag/local-live/current/artifacts".to_string()
}

pub(crate) fn uuid_v4_hex() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    format!("{:016x}{:08x}", nanos, pid)
}
