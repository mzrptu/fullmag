/* ── Session stream types ──
 * All interfaces and type aliases used by the session streaming pipeline. */

export interface SessionManifest {
  session_id: string;
  run_id: string;
  status: string;
  interactive_session_requested: boolean;
  script_path: string;
  problem_name: string;
  requested_backend: string;
  execution_mode: string;
  precision: string;
  artifact_dir: string;
  started_at_unix_ms: number;
  finished_at_unix_ms: number;
  plan_summary?: Record<string, unknown>;
}

export interface RunManifest {
  run_id: string;
  session_id: string;
  status: string;
  total_steps: number;
  final_time: number | null;
  final_e_ex: number | null;
  final_e_demag: number | null;
  final_e_ext: number | null;
  final_e_total: number | null;
  artifact_dir: string;
}

export interface LiveState {
  status: string;
  updated_at_unix_ms: number;
  step: number;
  time: number;
  dt: number;
  e_ex: number;
  e_demag: number;
  e_ext: number;
  e_total: number;
  max_dm_dt: number;
  max_h_eff: number;
  max_h_demag: number;
  wall_time_ns: number;
  grid: [number, number, number];
  preview_grid: [number, number, number] | null;
  preview_data_points_count: number | null;
  preview_max_points: number | null;
  preview_auto_downscaled: boolean;
  preview_auto_downscale_message: string | null;
  fem_mesh: FemLiveMesh | null;
  magnetization: Float64Array | null;
  finished: boolean;
}

export interface FemLiveMesh {
  nodes: [number, number, number][];
  elements: [number, number, number, number][];
  boundary_faces: [number, number, number][];
}

export interface ScalarRow {
  step: number;
  time: number;
  solver_dt: number;
  mx: number;
  my: number;
  mz: number;
  e_ex: number;
  e_demag: number;
  e_ext: number;
  e_total: number;
  max_dm_dt: number;
  max_h_eff: number;
  max_h_demag: number;
}

export interface EngineLogEntry {
  timestamp_unix_ms: number;
  level: string;
  message: string;
}

export interface QuantityDescriptor {
  id: string;
  label: string;
  kind: string;
  unit: string;
  location: string;
  available: boolean;
  interactive_preview: boolean;
  quick_access_label: string | null;
  scalar_metric_key: string | null;
}

export interface ArtifactEntry {
  path: string;
  kind: string;
}

export interface LatestFields {
  fields: Record<string, Float64Array | null>;
  grid: [number, number, number] | null;
}

export interface SpatialPreviewState {
  kind: "spatial";
  display_kind: "vector_field" | "spatial_scalar";
  config_revision: number;
  source_step: number;
  source_time: number;
  spatial_kind: "grid" | "mesh";
  quantity: string;
  unit: string;
  component: string;
  layer: number;
  all_layers: boolean;
  type: string;
  vector_payload_id: number | null;
  vector_field_values: Float64Array | null;
  scalar_field: [number, number, number][];
  min: number;
  max: number;
  n_comp: number;
  max_points: number;
  data_points_count: number;
  x_possible_sizes: number[];
  y_possible_sizes: number[];
  x_chosen_size: number;
  y_chosen_size: number;
  applied_x_chosen_size: number;
  applied_y_chosen_size: number;
  applied_layer_stride: number;
  auto_scale_enabled: boolean;
  auto_downscaled: boolean;
  auto_downscale_message: string | null;
  preview_grid: [number, number, number];
  fem_mesh: FemLiveMesh | null;
  original_node_count: number | null;
  original_face_count: number | null;
  active_mask: boolean[] | null;
}

export interface GlobalScalarPreviewState {
  kind: "global_scalar";
  display_kind: "global_scalar";
  config_revision: number;
  source_step: number;
  source_time: number;
  quantity: string;
  unit: string;
  value: number;
}

export type PreviewState = SpatialPreviewState | GlobalScalarPreviewState;

export interface PreviewConfig {
  revision: number;
  quantity: string;
  component: string;
  layer: number;
  all_layers: boolean;
  every_n: number;
  x_chosen_size: number;
  y_chosen_size: number;
  auto_scale_enabled: boolean;
  max_points: number;
}

export type DisplayKind = "vector_field" | "spatial_scalar" | "global_scalar";

export interface DisplaySelection {
  quantity: string;
  kind: DisplayKind;
  component: string;
  layer: number;
  all_layers: boolean;
  x_chosen_size: number;
  y_chosen_size: number;
  every_n: number;
  max_points: number;
  auto_scale_enabled: boolean;
}

export interface CurrentDisplaySelection {
  revision: number;
  selection: DisplaySelection;
}

export type RuntimeStatusKind =
  | "bootstrapping"
  | "materializing"
  | "materializing_script"
  | "waiting_for_compute"
  | "awaiting_command"
  | "running"
  | "paused"
  | "breaking"
  | "closing"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export interface RuntimeStatusState {
  kind: RuntimeStatusKind;
  code: string;
  is_busy: boolean;
  can_accept_commands: boolean;
}

export interface CommandStatus {
  session_id: string;
  seq: number | null;
  command_id: string;
  command_kind: string;
  state: "acknowledged" | "rejected" | "completed";
  issued_at_unix_ms: number | null;
  completed_at_unix_ms: number | null;
  completion_state: string | null;
  reason: string | null;
  display_selection: CurrentDisplaySelection | null;
}

export interface ScriptBuilderSolverState {
  integrator: string;
  fixed_timestep: string;
  relax_algorithm: string;
  torque_tolerance: string;
  energy_tolerance: string;
  max_relax_steps: string;
}

export interface ScriptBuilderMeshState {
  algorithm_2d: number;
  algorithm_3d: number;
  hmax: string;
  hmin: string;
  size_factor: number;
  size_from_curvature: number;
  smoothing_steps: number;
  optimize: string;
  optimize_iterations: number;
  compute_quality: boolean;
  per_element_quality: boolean;
}

export interface ScriptBuilderStageState {
  kind: string;
  entrypoint_kind: string;
  integrator: string;
  fixed_timestep: string;
  until_seconds: string;
  relax_algorithm: string;
  torque_tolerance: string;
  energy_tolerance: string;
  max_steps: string;
}

export interface ScriptBuilderInitialState {
  magnet_name: string | null;
  source_path: string;
  format: string;
  dataset: string | null;
  sample_index: number | null;
}

export interface ScriptBuilderState {
  revision: number;
  solver: ScriptBuilderSolverState;
  mesh: ScriptBuilderMeshState;
  stages: ScriptBuilderStageState[];
  initial_state: ScriptBuilderInitialState | null;
}

export interface MeshSummaryState {
  mesh_name: string;
  mesh_source: string | null;
  backend: string;
  source_kind: string;
  order: number;
  hmax: number;
  node_count: number;
  element_count: number;
  boundary_face_count: number;
  bounds_min: [number, number, number] | null;
  bounds_max: [number, number, number] | null;
  world_extent: [number, number, number] | null;
  generation_id: string;
}

export interface MeshQualitySummaryState {
  n_elements: number;
  sicn_min: number;
  sicn_max: number;
  sicn_mean: number;
  sicn_p5: number;
  gamma_min: number;
  gamma_mean: number;
  avg_quality: number;
}

export interface MeshPipelinePhaseState {
  id: string;
  label: string;
  status: "idle" | "active" | "done" | "warning";
  detail: string | null;
}

export interface MeshCapabilitiesState {
  has_volume_mesh: boolean;
  has_quality_arrays: boolean;
  supports_adaptive_remesh: boolean;
  supports_compare_snapshots: boolean;
  supports_size_field_remesh: boolean;
  supports_mesh_error_preview: boolean;
  supports_target_h_preview: boolean;
}

export interface MeshAdaptivityState {
  enabled: boolean;
  policy: string;
  pass_count: number;
  max_passes: number;
  convergence_status: string;
  last_target_h_summary: Record<string, unknown> | null;
}

export interface MeshHistoryEntryState {
  mesh_name: string;
  generation_mode: string | null;
  node_count: number;
  element_count: number;
  boundary_face_count: number;
  kind?: string;
  quality?: Record<string, unknown> | null;
  mesh_provenance?: Record<string, unknown> | null;
  size_field_stats?: Record<string, unknown> | null;
}

export interface MeshWorkspaceState {
  mesh_summary: MeshSummaryState | null;
  mesh_quality_summary: MeshQualitySummaryState | null;
  mesh_pipeline_status: MeshPipelinePhaseState[];
  mesh_capabilities: MeshCapabilitiesState | null;
  mesh_adaptivity_state: MeshAdaptivityState | null;
  mesh_history: MeshHistoryEntryState[];
}

export interface SessionState {
  session: SessionManifest;
  run: RunManifest | null;
  live_state: LiveState | null;
  runtime_status: RuntimeStatusState | null;
  metadata: Record<string, unknown> | null;
  mesh_workspace: MeshWorkspaceState | null;
  script_builder: ScriptBuilderState | null;
  scalar_rows: ScalarRow[];
  engine_log: EngineLogEntry[];
  quantities: QuantityDescriptor[];
  fem_mesh: FemLiveMesh | null;
  latest_fields: LatestFields;
  artifacts: ArtifactEntry[];
  display_selection: CurrentDisplaySelection | null;
  preview_config: PreviewConfig | null;
  preview: PreviewState | null;
  command_status: CommandStatus | null;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface UseSessionStreamResult {
  state: SessionState | null;
  connection: ConnectionStatus;
  error: string | null;
}

/* Internal event types used by the WS message dispatcher */

export interface SessionStateCurrentLiveEvent {
  kind: "session_state";
  state: unknown;
}

export interface CommandAckCurrentLiveEvent {
  kind: "command_ack";
  session_id: string;
  seq: number;
  command_id: string;
  command_kind: string;
  issued_at_unix_ms: number;
  display_selection?: unknown;
}

export interface CommandRejectedCurrentLiveEvent {
  kind: "command_rejected";
  session_id: string;
  command_id: string;
  command_kind: string;
  issued_at_unix_ms: number;
  reason: string;
}

export interface CommandCompletedCurrentLiveEvent {
  kind: "command_completed";
  session_id: string;
  seq: number;
  command_id: string;
  command_kind: string;
  completed_at_unix_ms: number;
  completion_state: string;
}

export type RuntimeCurrentLiveEvent =
  | CommandAckCurrentLiveEvent
  | CommandRejectedCurrentLiveEvent
  | CommandCompletedCurrentLiveEvent;

export interface PreviewBinaryPayload {
  payloadId: number;
  vectorFieldValues: Float64Array;
}
