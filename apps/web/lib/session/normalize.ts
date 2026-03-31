/* ── Session state normalizers ──
 * All functions that normalize raw JSON wire data into typed SessionState. */

import type {
  CurrentDisplaySelection,
  DisplayKind,
  LatestFields,
  LiveState,
  PreviewConfig,
  PreviewState,
  RuntimeStatusKind,
  RuntimeStatusState,
  ScriptBuilderState,
  SessionState,
} from "./types";

/* ── Field helpers ── */

function flattenField(raw: any): Float64Array | null {
  if (!raw || !Array.isArray(raw.values)) {
    return null;
  }
  const source = raw.values;
  const flattened = new Float64Array(source.length * 3);
  let offset = 0;
  for (const vector of source) {
    flattened[offset] = Number(Array.isArray(vector) ? vector[0] ?? 0 : 0);
    flattened[offset + 1] = Number(Array.isArray(vector) ? vector[1] ?? 0 : 0);
    flattened[offset + 2] = Number(Array.isArray(vector) ? vector[2] ?? 0 : 0);
    offset += 3;
  }
  return flattened;
}

function toFloat64Array(raw: unknown): Float64Array | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const values = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    values[i] = Number(raw[i] ?? 0);
  }
  return values;
}

function normalizeVectorFieldValues(raw: unknown): Float64Array | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  if (raw.length === 0) {
    return new Float64Array(0);
  }
  if (Array.isArray(raw[0])) {
    const source = raw as unknown[];
    const flattened = new Float64Array(source.length * 3);
    let offset = 0;
    for (const vector of source) {
      flattened[offset] = Number(Array.isArray(vector) ? vector[0] ?? 0 : 0);
      flattened[offset + 1] = Number(Array.isArray(vector) ? vector[1] ?? 0 : 0);
      flattened[offset + 2] = Number(Array.isArray(vector) ? vector[2] ?? 0 : 0);
      offset += 3;
    }
    return flattened;
  }
  return toFloat64Array(raw);
}

function fieldGrid(raw: any): [number, number, number] | null {
  const grid = raw?.layout?.grid_cells;
  if (!Array.isArray(grid) || grid.length !== 3) {
    return null;
  }
  return [Number(grid[0]), Number(grid[1]), Number(grid[2])];
}

function normalizeLatestFields(raw: any): LatestFields {
  if (!raw || typeof raw !== "object") {
    return { fields: {}, grid: null };
  }

  const fields: Record<string, Float64Array | null> = {};
  let grid: [number, number, number] | null = null;

  for (const [quantity, value] of Object.entries(raw)) {
    const flattened = flattenField(value);
    if (flattened) {
      fields[quantity] = flattened;
    }
    if (!grid) {
      grid = fieldGrid(value);
    }
  }

  return { fields, grid };
}

/* ── Enum-like normalizers ── */

function normalizeDisplayKind(raw: unknown): DisplayKind {
  switch (raw) {
    case "spatial_scalar":
      return "spatial_scalar";
    case "global_scalar":
      return "global_scalar";
    default:
      return "vector_field";
  }
}

function normalizeRuntimeStatusKind(raw: unknown): RuntimeStatusKind {
  switch (raw) {
    case "bootstrapping":
    case "materializing":
    case "materializing_script":
    case "waiting_for_compute":
    case "awaiting_command":
    case "running":
    case "paused":
    case "breaking":
    case "closing":
    case "completed":
    case "failed":
    case "cancelled":
      return raw;
    default:
      return "unknown";
  }
}

/* ── Sub-object normalizers ── */

export function normalizeDisplaySelection(raw: any): CurrentDisplaySelection | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const selection = raw.selection;
  if (!selection || typeof selection !== "object") {
    return null;
  }
  return {
    revision: Number(raw.revision ?? 0),
    selection: {
      quantity: String(selection.quantity ?? "m"),
      kind: normalizeDisplayKind(selection.kind),
      component: String(selection.component ?? "3D"),
      layer: Number(selection.layer ?? 0),
      all_layers: Boolean(selection.all_layers),
      x_chosen_size: Number(selection.x_chosen_size ?? 0),
      y_chosen_size: Number(selection.y_chosen_size ?? 0),
      every_n: Number(selection.every_n ?? 10),
      max_points: Number(selection.max_points ?? 16384),
      auto_scale_enabled: Boolean(selection.auto_scale_enabled ?? true),
    },
  };
}

function normalizeRuntimeStatus(raw: any): RuntimeStatusState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const code = String(raw.code ?? "");
  const kind = normalizeRuntimeStatusKind(raw.kind ?? code);
  return {
    kind,
    code: code || kind,
    is_busy: Boolean(raw.is_busy),
    can_accept_commands: Boolean(raw.can_accept_commands),
  };
}

function normalizePreviewConfig(raw: any): PreviewConfig | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    revision: Number(raw.revision ?? 0),
    quantity: String(raw.quantity ?? "m"),
    component: String(raw.component ?? "3D"),
    layer: Number(raw.layer ?? 0),
    all_layers: Boolean(raw.all_layers),
    every_n: Number(raw.every_n ?? 10),
    x_chosen_size: Number(raw.x_chosen_size ?? 0),
    y_chosen_size: Number(raw.y_chosen_size ?? 0),
    auto_scale_enabled: Boolean(raw.auto_scale_enabled ?? true),
    max_points: Number(raw.max_points ?? 0),
  };
}

function previewConfigFromDisplaySelection(
  displaySelection: CurrentDisplaySelection | null,
): PreviewConfig | null {
  if (!displaySelection) {
    return null;
  }
  return {
    revision: displaySelection.revision,
    quantity: displaySelection.selection.quantity,
    component: displaySelection.selection.component,
    layer: displaySelection.selection.layer,
    all_layers: displaySelection.selection.all_layers,
    every_n: displaySelection.selection.every_n,
    x_chosen_size: displaySelection.selection.x_chosen_size,
    y_chosen_size: displaySelection.selection.y_chosen_size,
    auto_scale_enabled: displaySelection.selection.auto_scale_enabled,
    max_points: displaySelection.selection.max_points,
  };
}

function normalizePreviewState(
  raw: any,
  pendingVectorPayloads?: Map<number, Float64Array>,
): PreviewState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (raw.kind === "global_scalar") {
    return {
      kind: "global_scalar",
      display_kind: "global_scalar",
      config_revision: Number(raw.config_revision ?? 0),
      source_step: Number(raw.source_step ?? 0),
      source_time: Number(raw.source_time ?? 0),
      quantity: String(raw.quantity ?? ""),
      unit: String(raw.unit ?? ""),
      value: Number(raw.value ?? 0),
    };
  }
  return {
    kind: "spatial",
    display_kind:
      raw.display_kind === "spatial_scalar" ? "spatial_scalar" : "vector_field",
    config_revision: Number(raw.config_revision ?? 0),
    source_step: Number(raw.source_step ?? 0),
    source_time: Number(raw.source_time ?? 0),
    spatial_kind: raw.spatial_kind === "mesh" ? "mesh" : "grid",
    quantity: String(raw.quantity ?? ""),
    unit: String(raw.unit ?? ""),
    component: String(raw.component ?? "3D"),
    layer: Number(raw.layer ?? 0),
    all_layers: Boolean(raw.all_layers),
    type: String(raw.type ?? "3D"),
    vector_payload_id:
      raw.vector_payload_id != null ? Number(raw.vector_payload_id) : null,
    vector_field_values:
      normalizeVectorFieldValues(raw.vector_field_values) ??
      (raw.vector_payload_id != null
        ? pendingVectorPayloads?.get(Number(raw.vector_payload_id)) ?? null
        : null),
    scalar_field: Array.isArray(raw.scalar_field)
      ? raw.scalar_field
          .filter((point: unknown) => Array.isArray(point) && point.length >= 3)
          .map(
            (point: number[]) =>
              [Number(point[0]), Number(point[1]), Number(point[2])] as [
                number,
                number,
                number,
              ],
          )
      : [],
    min: Number(raw.min ?? 0),
    max: Number(raw.max ?? 0),
    n_comp: Number(raw.n_comp ?? 0),
    max_points: Number(raw.max_points ?? 0),
    data_points_count: Number(raw.data_points_count ?? 0),
    x_possible_sizes: Array.isArray(raw.x_possible_sizes)
      ? raw.x_possible_sizes.map(Number)
      : [],
    y_possible_sizes: Array.isArray(raw.y_possible_sizes)
      ? raw.y_possible_sizes.map(Number)
      : [],
    x_chosen_size: Number(raw.x_chosen_size ?? 0),
    y_chosen_size: Number(raw.y_chosen_size ?? 0),
    applied_x_chosen_size: Number(raw.applied_x_chosen_size ?? 0),
    applied_y_chosen_size: Number(raw.applied_y_chosen_size ?? 0),
    applied_layer_stride: Number(raw.applied_layer_stride ?? 1),
    auto_scale_enabled: Boolean(raw.auto_scale_enabled),
    auto_downscaled: Boolean(raw.auto_downscaled),
    auto_downscale_message: raw.auto_downscale_message ?? null,
    preview_grid:
      Array.isArray(raw.preview_grid) && raw.preview_grid.length === 3
        ? [
            Number(raw.preview_grid[0]),
            Number(raw.preview_grid[1]),
            Number(raw.preview_grid[2]),
          ]
        : [0, 0, 0],
    fem_mesh: raw.fem_mesh ?? null,
    original_node_count:
      raw.original_node_count != null ? Number(raw.original_node_count) : null,
    original_face_count:
      raw.original_face_count != null ? Number(raw.original_face_count) : null,
    active_mask: Array.isArray(raw.active_mask)
      ? raw.active_mask.map((v: unknown) => Boolean(v))
      : null,
  };
}

function normalizeScriptBuilder(raw: any): ScriptBuilderState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    revision: Number(raw.revision ?? 0),
    solver: {
      integrator: String(raw.solver?.integrator ?? ""),
      fixed_timestep: String(raw.solver?.fixed_timestep ?? ""),
      relax_algorithm: String(raw.solver?.relax_algorithm ?? ""),
      torque_tolerance: String(raw.solver?.torque_tolerance ?? ""),
      energy_tolerance: String(raw.solver?.energy_tolerance ?? ""),
      max_relax_steps: String(raw.solver?.max_relax_steps ?? ""),
    },
    mesh: {
      algorithm_2d: Number(raw.mesh?.algorithm_2d ?? 6),
      algorithm_3d: Number(raw.mesh?.algorithm_3d ?? 1),
      hmax: String(raw.mesh?.hmax ?? ""),
      hmin: String(raw.mesh?.hmin ?? ""),
      size_factor: Number(raw.mesh?.size_factor ?? 1),
      size_from_curvature: Number(raw.mesh?.size_from_curvature ?? 0),
      smoothing_steps: Number(raw.mesh?.smoothing_steps ?? 1),
      optimize: String(raw.mesh?.optimize ?? ""),
      optimize_iterations: Number(raw.mesh?.optimize_iterations ?? 1),
      compute_quality: Boolean(raw.mesh?.compute_quality),
      per_element_quality: Boolean(raw.mesh?.per_element_quality),
    },
    initial_state:
      raw.initial_state && typeof raw.initial_state === "object"
        ? {
            magnet_name:
              typeof raw.initial_state.magnet_name === "string"
                ? raw.initial_state.magnet_name
                : null,
            source_path: String(raw.initial_state.source_path ?? ""),
            format: String(raw.initial_state.format ?? "json"),
            dataset:
              typeof raw.initial_state.dataset === "string"
                ? raw.initial_state.dataset
                : null,
            sample_index:
              raw.initial_state.sample_index != null
                ? Number(raw.initial_state.sample_index)
                : null,
          }
        : null,
  };
}

/* ── Top-level normalizer ── */

export function normalizeSessionState(
  raw: any,
  pendingVectorPayloads?: Map<number, Float64Array>,
): SessionState {
  const rawLive = raw.live_state;
  const latestFields = normalizeLatestFields(raw.latest_fields);
  const rawPreview = raw.preview ?? null;
  const rawPreviewConfig = raw.preview_config ?? null;
  const displaySelection = normalizeDisplaySelection(raw.display_selection);
  const fallbackGrid = latestFields.grid;

  const liveState: LiveState | null = rawLive
    ? {
        status: rawLive.status,
        updated_at_unix_ms: rawLive.updated_at_unix_ms,
        step: rawLive.latest_step?.step ?? 0,
        time: rawLive.latest_step?.time ?? 0,
        dt: rawLive.latest_step?.dt ?? 0,
        e_ex: rawLive.latest_step?.e_ex ?? 0,
        e_demag: rawLive.latest_step?.e_demag ?? 0,
        e_ext: rawLive.latest_step?.e_ext ?? 0,
        e_total: rawLive.latest_step?.e_total ?? 0,
        max_dm_dt: rawLive.latest_step?.max_dm_dt ?? 0,
        max_h_eff: rawLive.latest_step?.max_h_eff ?? 0,
        max_h_demag: rawLive.latest_step?.max_h_demag ?? 0,
        wall_time_ns: rawLive.latest_step?.wall_time_ns ?? 0,
        grid: rawLive.latest_step?.grid ?? fallbackGrid ?? [0, 0, 0],
        preview_grid: rawLive.latest_step?.preview_grid ?? null,
        preview_data_points_count: rawLive.latest_step?.preview_data_points_count ?? null,
        preview_max_points: rawLive.latest_step?.preview_max_points ?? null,
        preview_auto_downscaled: Boolean(rawLive.latest_step?.preview_auto_downscaled),
        preview_auto_downscale_message: rawLive.latest_step?.preview_auto_downscale_message ?? null,
        fem_mesh: rawLive.latest_step?.fem_mesh ?? null,
        magnetization: toFloat64Array(rawLive.latest_step?.magnetization),
        finished: Boolean(rawLive.latest_step?.finished),
      }
    : null;

  return {
    session: raw.session,
    run: raw.run ?? null,
    live_state: liveState,
    runtime_status: normalizeRuntimeStatus(raw.runtime_status),
    metadata: raw.metadata ?? null,
    script_builder: normalizeScriptBuilder(raw.script_builder),
    scalar_rows: Array.isArray(raw.scalar_rows)
      ? raw.scalar_rows.map((row: any) => ({
          step: Number(row?.step ?? 0),
          time: Number(row?.time ?? 0),
          solver_dt: Number(row?.solver_dt ?? 0),
          mx: Number(row?.mx ?? 0),
          my: Number(row?.my ?? 0),
          mz: Number(row?.mz ?? 0),
          e_ex: Number(row?.e_ex ?? 0),
          e_demag: Number(row?.e_demag ?? 0),
          e_ext: Number(row?.e_ext ?? 0),
          e_total: Number(row?.e_total ?? 0),
          max_dm_dt: Number(row?.max_dm_dt ?? 0),
          max_h_eff: Number(row?.max_h_eff ?? 0),
          max_h_demag: Number(row?.max_h_demag ?? 0),
        }))
      : [],
    engine_log: Array.isArray(raw.engine_log) ? raw.engine_log : [],
    quantities: Array.isArray(raw.quantities)
      ? raw.quantities.map((quantity: any) => ({
          id: String(quantity?.id ?? ""),
          label: String(quantity?.label ?? ""),
          kind: String(quantity?.kind ?? ""),
          unit: String(quantity?.unit ?? ""),
          location: String(quantity?.location ?? ""),
          available: Boolean(quantity?.available),
          interactive_preview: Boolean(quantity?.interactive_preview),
          quick_access_label:
            typeof quantity?.quick_access_label === "string" ? quantity.quick_access_label : null,
          scalar_metric_key:
            typeof quantity?.scalar_metric_key === "string" ? quantity.scalar_metric_key : null,
        }))
      : [],
    fem_mesh: raw.fem_mesh ?? raw.live_state?.latest_step?.fem_mesh ?? null,
    latest_fields: latestFields,
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    display_selection: displaySelection,
    preview_config:
      normalizePreviewConfig(rawPreviewConfig) ??
      previewConfigFromDisplaySelection(displaySelection),
    preview: normalizePreviewState(rawPreview, pendingVectorPayloads),
    command_status: null,
  };
}
