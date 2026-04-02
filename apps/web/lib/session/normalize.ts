/* ── Session state normalizers ──
 * All functions that normalize raw JSON wire data into typed SessionState. */

import type {
  CurrentDisplaySelection,
  DisplayKind,
  FemLiveMesh,
  FemLiveMeshObjectSegment,
  FemMeshPart,
  LatestFields,
  LiveState,
  MeshCommandTarget,
  ModelBuilderGraphV2,
  MeshWorkspaceState,
  PreviewConfig,
  PreviewState,
  RuntimeStatusKind,
  RuntimeStatusState,
  SceneDocument,
  ScriptBuilderState,
  SessionState,
} from "./types";
import { createModelBuilderGraphV2 } from "./modelBuilderGraph";
import {
  buildSceneDocumentFromScriptBuilder,
  buildScriptBuilderFromSceneDocument,
} from "./sceneDocument";

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

export function normalizeMeshCommandTarget(raw: unknown): MeshCommandTarget | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === "study_domain") {
    return { kind: "study_domain" };
  }
  if (kind === "adaptive_followup") {
    return { kind: "adaptive_followup" };
  }
  return null;
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

function normalizeFemMeshPartRole(
  raw: unknown,
): "air" | "magnetic_object" | "interface" | "outer_boundary" {
  switch (raw) {
    case "air":
    case "magnetic_object":
    case "interface":
    case "outer_boundary":
      return raw;
    default:
      return "magnetic_object";
  }
}

function normalizeFemLiveMeshObjectSegments(raw: unknown): FemLiveMeshObjectSegment[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((value) => value && typeof value === "object")
    .map((value) => {
      const segment = value as Record<string, unknown>;
      return {
        object_id: String(segment.object_id ?? ""),
        geometry_id: typeof segment.geometry_id === "string" ? segment.geometry_id : null,
        node_start: Number(segment.node_start ?? 0),
        node_count: Number(segment.node_count ?? 0),
        element_start: Number(segment.element_start ?? 0),
        element_count: Number(segment.element_count ?? 0),
        boundary_face_start: Number(segment.boundary_face_start ?? 0),
        boundary_face_count: Number(segment.boundary_face_count ?? 0),
      };
    });
}

function normalizeMeshPart(raw: Record<string, unknown>): FemMeshPart {
  return {
    id: String(raw.id ?? ""),
    label: String(raw.label ?? ""),
    role: normalizeFemMeshPartRole(raw.role),
    object_id: typeof raw.object_id === "string" ? raw.object_id : null,
    geometry_id: typeof raw.geometry_id === "string" ? raw.geometry_id : null,
    material_id: typeof raw.material_id === "string" ? raw.material_id : null,
    element_start: Number(raw.element_start ?? 0),
    element_count: Number(raw.element_count ?? 0),
    boundary_face_start: Number(raw.boundary_face_start ?? 0),
    boundary_face_count: Number(raw.boundary_face_count ?? 0),
    node_start: Number(raw.node_start ?? 0),
    node_count: Number(raw.node_count ?? 0),
    bounds_min: normalizeVec3(raw.bounds_min),
    bounds_max: normalizeVec3(raw.bounds_max),
  };
}

function normalizeMeshParts(raw: unknown): FemMeshPart[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((value) => value && typeof value === "object")
    .map((value) => normalizeMeshPart(value as Record<string, unknown>));
}

function normalizeFemLiveMesh(raw: unknown): FemLiveMesh | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const mesh = raw as Record<string, unknown>;
  const nodes = Array.isArray(mesh.nodes)
    ? mesh.nodes
        .filter((node) => Array.isArray(node) && node.length >= 3)
        .map((node) => [Number(node[0] ?? 0), Number(node[1] ?? 0), Number(node[2] ?? 0)] as [
          number,
          number,
          number,
        ])
    : [];
  const elements = Array.isArray(mesh.elements)
    ? mesh.elements
        .filter((element) => Array.isArray(element) && element.length >= 4)
        .map((element) => [
          Number(element[0] ?? 0),
          Number(element[1] ?? 0),
          Number(element[2] ?? 0),
          Number(element[3] ?? 0),
        ] as [number, number, number, number])
    : [];
  const boundaryFaces = Array.isArray(mesh.boundary_faces)
    ? mesh.boundary_faces
        .filter((face) => Array.isArray(face) && face.length >= 3)
        .map((face) => [Number(face[0] ?? 0), Number(face[1] ?? 0), Number(face[2] ?? 0)] as [
          number,
          number,
          number,
        ])
    : [];
  return {
    mesh_name: typeof mesh.mesh_name === "string" ? mesh.mesh_name : null,
    mesh_id: typeof mesh.mesh_id === "string" ? mesh.mesh_id : null,
    nodes,
    elements,
    element_markers: Array.isArray(mesh.element_markers)
      ? mesh.element_markers.map((value) => Number(value ?? 0))
      : [],
    boundary_faces: boundaryFaces,
    boundary_markers: Array.isArray(mesh.boundary_markers)
      ? mesh.boundary_markers.map((value) => Number(value ?? 0))
      : [],
    object_segments: normalizeFemLiveMeshObjectSegments(mesh.object_segments),
    mesh_parts: normalizeMeshParts(mesh.mesh_parts),
    domain_mesh_mode:
      typeof mesh.domain_mesh_mode === "string" ? mesh.domain_mesh_mode : null,
    domain_frame: normalizeDomainFrame(mesh.domain_frame),
    generation_id: typeof mesh.generation_id === "string" ? mesh.generation_id : null,
  };
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
    quantity_domain:
      raw.quantity_domain === "magnetic_only" || raw.quantity_domain === "surface_only"
        ? raw.quantity_domain
        : "full_domain",
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
    fem_mesh: normalizeFemLiveMesh(raw.fem_mesh),
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
    backend:
      typeof raw.backend === "string" && raw.backend.trim().length > 0
        ? raw.backend
        : null,
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
      growth_rate: String(raw.mesh?.growth_rate ?? ""),
      narrow_regions: Number(raw.mesh?.narrow_regions ?? 0),
      smoothing_steps: Number(raw.mesh?.smoothing_steps ?? 1),
      optimize: String(raw.mesh?.optimize ?? ""),
      optimize_iterations: Number(raw.mesh?.optimize_iterations ?? 1),
      compute_quality: Boolean(raw.mesh?.compute_quality),
      per_element_quality: Boolean(raw.mesh?.per_element_quality),
      adaptive_enabled: Boolean(raw.mesh?.adaptive_enabled),
      adaptive_policy: String(raw.mesh?.adaptive_policy ?? "auto"),
      adaptive_theta: Number(raw.mesh?.adaptive_theta ?? 0.3),
      adaptive_h_min: String(raw.mesh?.adaptive_h_min ?? ""),
      adaptive_h_max: String(raw.mesh?.adaptive_h_max ?? ""),
      adaptive_max_passes: Number(raw.mesh?.adaptive_max_passes ?? 2),
      adaptive_error_tolerance: String(raw.mesh?.adaptive_error_tolerance ?? "1e-3"),
    },
    universe:
      raw.universe && typeof raw.universe === "object"
        ? {
            mode: String(raw.universe.mode ?? "auto"),
            size: normalizeVec3(raw.universe.size),
            center: normalizeVec3(raw.universe.center),
            padding: normalizeVec3(raw.universe.padding),
            airbox_hmax:
              raw.universe.airbox_hmax != null
                ? Number(raw.universe.airbox_hmax)
                : null,
          }
        : null,
    domain_frame: normalizeDomainFrame(raw.domain_frame),
    stages: Array.isArray(raw.stages)
      ? raw.stages.map((stage: any) => ({
          kind: String(stage?.kind ?? "run"),
          entrypoint_kind: String(stage?.entrypoint_kind ?? ""),
          integrator: String(stage?.integrator ?? ""),
          fixed_timestep: String(stage?.fixed_timestep ?? ""),
          until_seconds: String(stage?.until_seconds ?? ""),
          relax_algorithm: String(stage?.relax_algorithm ?? ""),
          torque_tolerance: String(stage?.torque_tolerance ?? ""),
          energy_tolerance: String(stage?.energy_tolerance ?? ""),
          max_steps: String(stage?.max_steps ?? ""),
        }))
      : [],
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
    geometries: Array.isArray(raw.geometries)
      ? raw.geometries.map((geo: any) => ({
          name: String(geo?.name ?? ""),
          region_name:
            typeof geo?.region_name === "string" && geo.region_name.trim().length > 0
              ? geo.region_name
              : null,
          geometry_kind: String(geo?.geometry_kind ?? ""),
          geometry_params: (geo?.geometry_params && typeof geo.geometry_params === "object") ? geo.geometry_params : {},
          bounds_min: normalizeVec3(geo?.bounds_min),
          bounds_max: normalizeVec3(geo?.bounds_max),
          material: {
            Ms: geo?.material?.Ms != null ? Number(geo.material.Ms) : null,
            Aex: geo?.material?.Aex != null ? Number(geo.material.Aex) : null,
            alpha: Number(geo?.material?.alpha ?? 0.01),
            Dind: geo?.material?.Dind != null ? Number(geo.material.Dind) : null,
          },
          magnetization: {
            kind: String(geo?.magnetization?.kind ?? "uniform"),
            value: Array.isArray(geo?.magnetization?.value) ? geo.magnetization.value.map(Number) : null,
            seed: geo?.magnetization?.seed != null ? Number(geo.magnetization.seed) : null,
            source_path: typeof geo?.magnetization?.source_path === "string" ? geo.magnetization.source_path : null,
            source_format: typeof geo?.magnetization?.source_format === "string" ? geo.magnetization.source_format : null,
            dataset: typeof geo?.magnetization?.dataset === "string" ? geo.magnetization.dataset : null,
            sample_index: geo?.magnetization?.sample_index != null ? Number(geo.magnetization.sample_index) : null,
          },
          mesh: geo?.mesh && typeof geo.mesh === "object" ? {
            mode: geo.mesh.mode === "custom" ? "custom" : "inherit",
            hmax: String(geo.mesh.hmax ?? ""),
            hmin: String(geo.mesh.hmin ?? ""),
            order: geo.mesh.order != null ? Number(geo.mesh.order) : null,
            source: typeof geo.mesh.source === "string" ? geo.mesh.source : null,
            algorithm_2d: geo.mesh.algorithm_2d != null ? Number(geo.mesh.algorithm_2d) : null,
            algorithm_3d: geo.mesh.algorithm_3d != null ? Number(geo.mesh.algorithm_3d) : null,
            size_factor: geo.mesh.size_factor != null ? Number(geo.mesh.size_factor) : null,
            size_from_curvature: geo.mesh.size_from_curvature != null ? Number(geo.mesh.size_from_curvature) : null,
            growth_rate: String(geo.mesh.growth_rate ?? ""),
            narrow_regions: geo.mesh.narrow_regions != null ? Number(geo.mesh.narrow_regions) : null,
            smoothing_steps: geo.mesh.smoothing_steps != null ? Number(geo.mesh.smoothing_steps) : null,
            optimize: typeof geo.mesh.optimize === "string" ? geo.mesh.optimize : null,
            optimize_iterations: geo.mesh.optimize_iterations != null ? Number(geo.mesh.optimize_iterations) : null,
            compute_quality: typeof geo.mesh.compute_quality === "boolean" ? geo.mesh.compute_quality : null,
            per_element_quality: typeof geo.mesh.per_element_quality === "boolean" ? geo.mesh.per_element_quality : null,
            size_fields: Array.isArray(geo.mesh.size_fields)
              ? geo.mesh.size_fields.map((field: any) => ({
                  kind: String(field?.kind ?? ""),
                  params:
                    field?.params && typeof field.params === "object"
                      ? field.params
                      : {},
                }))
              : [],
            operations: Array.isArray(geo.mesh.operations)
              ? geo.mesh.operations.map((operation: any) => ({
                  kind: String(operation?.kind ?? ""),
                  params:
                    operation?.params && typeof operation.params === "object"
                      ? operation.params
                      : {},
                }))
              : [],
            build_requested: Boolean(geo.mesh.build_requested),
          } : null,
        }))
      : [],
    current_modules: Array.isArray(raw.current_modules)
      ? raw.current_modules.map((module: any) => ({
          kind: String(module?.kind ?? "antenna_field_source"),
          name: String(module?.name ?? ""),
          solver: String(module?.solver ?? "mqs_2p5d_az"),
          air_box_factor: Number(module?.air_box_factor ?? 12),
          antenna_kind: String(module?.antenna_kind ?? ""),
          antenna_params:
            module?.antenna_params && typeof module.antenna_params === "object"
              ? module.antenna_params
              : {},
          drive: {
            current_a: Number(module?.drive?.current_a ?? 0),
            frequency_hz:
              module?.drive?.frequency_hz != null
                ? Number(module.drive.frequency_hz)
                : null,
            phase_rad: Number(module?.drive?.phase_rad ?? 0),
            waveform:
              module?.drive?.waveform && typeof module.drive.waveform === "object"
                ? module.drive.waveform
                : null,
          },
        }))
      : [],
    excitation_analysis:
      raw.excitation_analysis && typeof raw.excitation_analysis === "object"
        ? {
            source: String(raw.excitation_analysis.source ?? ""),
            method: String(raw.excitation_analysis.method ?? ""),
            propagation_axis:
              normalizeVec3(raw.excitation_analysis.propagation_axis) ?? [1, 0, 0],
            k_max_rad_per_m:
              raw.excitation_analysis.k_max_rad_per_m != null
                ? Number(raw.excitation_analysis.k_max_rad_per_m)
                : null,
            samples: Number(raw.excitation_analysis.samples ?? 256),
          }
        : null,
  };
}

function normalizeModelBuilderGraph(raw: any): ModelBuilderGraphV2 | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const projectedBuilder = normalizeScriptBuilder({
    revision: raw.revision,
    backend: raw.study?.backend,
    solver: raw.study?.solver,
    mesh: raw.study?.mesh_defaults,
    universe: raw.universe?.value,
    stages: raw.study?.stages,
    initial_state: raw.study?.initial_state,
    geometries: Array.isArray(raw.objects?.items)
      ? raw.objects.items.map((item: any) => item?.geometry ?? null).filter(Boolean)
      : [],
    current_modules: raw.current_modules?.modules,
    excitation_analysis: raw.current_modules?.excitation_analysis,
  });
  if (!projectedBuilder) {
    return null;
  }
  return createModelBuilderGraphV2(projectedBuilder);
}

function emptyScriptBuilderState(): ScriptBuilderState {
  return normalizeScriptBuilder({
    revision: 0,
    backend: null,
    solver: {},
    mesh: {},
    universe: null,
    stages: [],
    initial_state: null,
    geometries: [],
    current_modules: [],
    excitation_analysis: null,
  })!;
}

function normalizeQuat4(raw: unknown): [number, number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 4) {
    return [0, 0, 0, 1];
  }
  return [
    Number(raw[0] ?? 0),
    Number(raw[1] ?? 0),
    Number(raw[2] ?? 0),
    Number(raw[3] ?? 1),
  ];
}

function normalizeSceneMeshOverride(raw: any) {
  return normalizeScriptBuilder({
    revision: 0,
    backend: null,
    solver: {},
    mesh: {},
    universe: null,
    stages: [],
    initial_state: null,
    geometries: [
      {
        name: "tmp",
        geometry_kind: "Box",
        geometry_params: {},
        material: {},
        magnetization: {},
        mesh: raw ?? null,
      },
    ],
    current_modules: [],
    excitation_analysis: null,
  })?.geometries[0]?.mesh ?? null;
}

function normalizeSceneCurrentModules(raw: any) {
  const normalized = normalizeScriptBuilder({
    revision: 0,
    backend: null,
    solver: {},
    mesh: {},
    universe: null,
    stages: [],
    initial_state: null,
    geometries: [],
    current_modules: Array.isArray(raw?.modules) ? raw.modules : [],
    excitation_analysis: raw?.excitation_analysis ?? null,
  });
  return {
    modules: normalized?.current_modules ?? [],
    excitation_analysis: normalized?.excitation_analysis ?? null,
  };
}

function normalizeSceneStudy(raw: any) {
  const defaults = emptyScriptBuilderState();
  const normalized = normalizeScriptBuilder({
    revision: 0,
    backend: raw?.backend ?? null,
    solver: raw?.solver ?? {},
    mesh: raw?.mesh_defaults ?? {},
    universe: null,
    stages: Array.isArray(raw?.stages) ? raw.stages : [],
    initial_state: raw?.initial_state ?? null,
    geometries: [],
    current_modules: [],
    excitation_analysis: null,
  });
  return {
    backend: normalized?.backend ?? null,
    solver: normalized?.solver ?? defaults.solver,
    mesh_defaults: normalized?.mesh ?? defaults.mesh,
    stages: normalized?.stages ?? [],
    initial_state: normalized?.initial_state ?? null,
  };
}

function normalizeSceneDocument(raw: any): SceneDocument | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    version: "scene.v1",
    revision: Number(raw.revision ?? 0),
    scene:
      raw.scene && typeof raw.scene === "object"
        ? {
            id: String(raw.scene.id ?? ""),
            name: String(raw.scene.name ?? "Scene"),
          }
        : {
            id: "",
            name: "Scene",
          },
    universe:
      raw.universe && typeof raw.universe === "object"
        ? {
            mode: String(raw.universe.mode ?? "auto"),
            size: normalizeVec3(raw.universe.size),
            center: normalizeVec3(raw.universe.center),
            padding: normalizeVec3(raw.universe.padding),
            airbox_hmax:
              raw.universe.airbox_hmax != null
                ? Number(raw.universe.airbox_hmax)
                : null,
          }
        : null,
    objects: Array.isArray(raw.objects)
      ? raw.objects.map((object: any) => ({
          id: String(object?.id ?? ""),
          name: String(object?.name ?? object?.id ?? ""),
          geometry: {
            geometry_kind: String(object?.geometry?.geometry_kind ?? ""),
            geometry_params:
              object?.geometry?.geometry_params &&
              typeof object.geometry.geometry_params === "object"
                ? object.geometry.geometry_params
                : {},
            bounds_min: normalizeVec3(object?.geometry?.bounds_min),
            bounds_max: normalizeVec3(object?.geometry?.bounds_max),
          },
          transform: {
            translation: normalizeVec3(object?.transform?.translation) ?? [0, 0, 0],
            rotation_quat: normalizeQuat4(object?.transform?.rotation_quat),
            scale: normalizeVec3(object?.transform?.scale) ?? [1, 1, 1],
            pivot: normalizeVec3(object?.transform?.pivot) ?? [0, 0, 0],
          },
          material_ref: String(object?.material_ref ?? ""),
          region_name:
            typeof object?.region_name === "string" ? object.region_name : null,
          magnetization_ref:
            typeof object?.magnetization_ref === "string"
              ? object.magnetization_ref
              : null,
          mesh_override: normalizeSceneMeshOverride(object?.mesh_override ?? null),
          visible: Boolean(object?.visible ?? true),
          locked: Boolean(object?.locked),
          tags: Array.isArray(object?.tags)
            ? object.tags.filter((tag: unknown): tag is string => typeof tag === "string")
            : [],
        }))
      : [],
    materials: Array.isArray(raw.materials)
      ? raw.materials.map((material: any) => ({
          id: String(material?.id ?? ""),
          name: String(material?.name ?? ""),
          properties: {
            Ms: material?.properties?.Ms != null ? Number(material.properties.Ms) : null,
            Aex:
              material?.properties?.Aex != null ? Number(material.properties.Aex) : null,
            alpha: Number(material?.properties?.alpha ?? 0.01),
            Dind:
              material?.properties?.Dind != null ? Number(material.properties.Dind) : null,
          },
        }))
      : [],
    magnetization_assets: Array.isArray(raw.magnetization_assets)
      ? raw.magnetization_assets.map((asset: any) => ({
          id: String(asset?.id ?? ""),
          name: String(asset?.name ?? ""),
          kind: String(asset?.kind ?? "uniform"),
          value: Array.isArray(asset?.value) ? asset.value.map(Number) : null,
          seed: asset?.seed != null ? Number(asset.seed) : null,
          source_path: typeof asset?.source_path === "string" ? asset.source_path : null,
          source_format:
            typeof asset?.source_format === "string" ? asset.source_format : null,
          dataset: typeof asset?.dataset === "string" ? asset.dataset : null,
          sample_index: asset?.sample_index != null ? Number(asset.sample_index) : null,
          mapping: {
            space: String(asset?.mapping?.space ?? "object"),
            projection: String(asset?.mapping?.projection ?? "object_local"),
            clamp_mode: String(asset?.mapping?.clamp_mode ?? "clamp"),
          },
          texture_transform: {
            translation: normalizeVec3(asset?.texture_transform?.translation) ?? [0, 0, 0],
            rotation_quat: normalizeQuat4(asset?.texture_transform?.rotation_quat),
            scale: normalizeVec3(asset?.texture_transform?.scale) ?? [1, 1, 1],
            pivot: normalizeVec3(asset?.texture_transform?.pivot) ?? [0, 0, 0],
          },
        }))
      : [],
    current_modules: normalizeSceneCurrentModules(raw.current_modules),
    study: normalizeSceneStudy(raw.study),
    outputs: {
      items: Array.isArray(raw.outputs?.items)
        ? raw.outputs.items.filter(
            (item: unknown): item is Record<string, unknown> =>
              item != null && typeof item === "object" && !Array.isArray(item),
          )
        : [],
    },
    editor: {
      selected_object_id:
        typeof raw.editor?.selected_object_id === "string"
          ? raw.editor.selected_object_id
          : null,
      gizmo_mode:
        typeof raw.editor?.gizmo_mode === "string" ? raw.editor.gizmo_mode : null,
      transform_space:
        typeof raw.editor?.transform_space === "string"
          ? raw.editor.transform_space
          : null,
    },
  };
}

function normalizeVec3(raw: unknown): [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 3) {
    return null;
  }
  return [Number(raw[0] ?? 0), Number(raw[1] ?? 0), Number(raw[2] ?? 0)];
}

function normalizeDomainFrame(raw: any) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    declared_universe:
      raw.declared_universe && typeof raw.declared_universe === "object"
        ? {
            mode: String(raw.declared_universe.mode ?? "auto"),
            size: normalizeVec3(raw.declared_universe.size),
            center: normalizeVec3(raw.declared_universe.center),
            padding: normalizeVec3(raw.declared_universe.padding),
            airbox_hmax:
              raw.declared_universe.airbox_hmax != null
                ? Number(raw.declared_universe.airbox_hmax)
                : null,
          }
        : null,
    object_bounds_min: normalizeVec3(raw.object_bounds_min),
    object_bounds_max: normalizeVec3(raw.object_bounds_max),
    mesh_bounds_min: normalizeVec3(raw.mesh_bounds_min),
    mesh_bounds_max: normalizeVec3(raw.mesh_bounds_max),
    effective_extent: normalizeVec3(raw.effective_extent),
    effective_center: normalizeVec3(raw.effective_center),
    effective_source:
      typeof raw.effective_source === "string" ? raw.effective_source : null,
  };
}

function normalizeMeshWorkspace(raw: any): MeshWorkspaceState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const meshSummaryRaw = raw.mesh_summary;
  const qualityRaw = raw.mesh_quality_summary;
  return {
    mesh_summary:
      meshSummaryRaw && typeof meshSummaryRaw === "object"
        ? {
            mesh_id:
              typeof meshSummaryRaw.mesh_id === "string"
                ? meshSummaryRaw.mesh_id
                : null,
            mesh_name: String(meshSummaryRaw.mesh_name ?? ""),
            mesh_source:
              typeof meshSummaryRaw.mesh_source === "string"
                ? meshSummaryRaw.mesh_source
                : null,
            backend: String(meshSummaryRaw.backend ?? ""),
            source_kind: String(meshSummaryRaw.source_kind ?? ""),
            order: Number(meshSummaryRaw.order ?? 1),
            hmax: Number(meshSummaryRaw.hmax ?? 0),
            node_count: Number(meshSummaryRaw.node_count ?? 0),
            element_count: Number(meshSummaryRaw.element_count ?? 0),
            boundary_face_count: Number(meshSummaryRaw.boundary_face_count ?? 0),
            bounds_min: normalizeVec3(meshSummaryRaw.bounds_min),
            bounds_max: normalizeVec3(meshSummaryRaw.bounds_max),
            mesh_extent:
              normalizeVec3(meshSummaryRaw.mesh_extent)
              ?? normalizeVec3(meshSummaryRaw.world_extent),
            world_extent: normalizeVec3(meshSummaryRaw.world_extent),
            world_center: normalizeVec3(meshSummaryRaw.world_center),
            world_extent_source:
              typeof meshSummaryRaw.world_extent_source === "string"
                ? meshSummaryRaw.world_extent_source
                : null,
            domain_frame: normalizeDomainFrame(meshSummaryRaw.domain_frame),
            domain_mesh_mode:
              typeof meshSummaryRaw.domain_mesh_mode === "string"
                ? meshSummaryRaw.domain_mesh_mode
                : null,
            generation_id: String(meshSummaryRaw.generation_id ?? ""),
          }
        : null,
    mesh_quality_summary:
      qualityRaw && typeof qualityRaw === "object"
        ? {
            n_elements: Number(qualityRaw.n_elements ?? 0),
            sicn_min: Number(qualityRaw.sicn_min ?? 0),
            sicn_max: Number(qualityRaw.sicn_max ?? 0),
            sicn_mean: Number(qualityRaw.sicn_mean ?? 0),
            sicn_p5: Number(qualityRaw.sicn_p5 ?? 0),
            gamma_min: Number(qualityRaw.gamma_min ?? 0),
            gamma_mean: Number(qualityRaw.gamma_mean ?? 0),
            avg_quality: Number(qualityRaw.avg_quality ?? 0),
          }
        : null,
    mesh_pipeline_status: Array.isArray(raw.mesh_pipeline_status)
      ? raw.mesh_pipeline_status.map((phase: any) => ({
          id: String(phase?.id ?? ""),
          label: String(phase?.label ?? ""),
          status:
            phase?.status === "active" ||
            phase?.status === "done" ||
            phase?.status === "warning"
              ? phase.status
              : "idle",
          detail: typeof phase?.detail === "string" ? phase.detail : null,
        }))
      : [],
    mesh_capabilities:
      raw.mesh_capabilities && typeof raw.mesh_capabilities === "object"
        ? {
            has_volume_mesh: Boolean(raw.mesh_capabilities.has_volume_mesh),
            has_quality_arrays: Boolean(raw.mesh_capabilities.has_quality_arrays),
            supports_adaptive_remesh: Boolean(raw.mesh_capabilities.supports_adaptive_remesh),
            supports_compare_snapshots: Boolean(raw.mesh_capabilities.supports_compare_snapshots),
            supports_size_field_remesh: Boolean(raw.mesh_capabilities.supports_size_field_remesh),
            supports_mesh_error_preview: Boolean(raw.mesh_capabilities.supports_mesh_error_preview),
            supports_target_h_preview: Boolean(raw.mesh_capabilities.supports_target_h_preview),
          }
        : null,
    mesh_adaptivity_state:
      raw.mesh_adaptivity_state && typeof raw.mesh_adaptivity_state === "object"
        ? {
            enabled: Boolean(raw.mesh_adaptivity_state.enabled),
            policy: String(raw.mesh_adaptivity_state.policy ?? "manual"),
            pass_count: Number(raw.mesh_adaptivity_state.pass_count ?? 0),
            max_passes: Number(raw.mesh_adaptivity_state.max_passes ?? 0),
            convergence_status: String(raw.mesh_adaptivity_state.convergence_status ?? "idle"),
            last_target_h_summary:
              raw.mesh_adaptivity_state.last_target_h_summary &&
              typeof raw.mesh_adaptivity_state.last_target_h_summary === "object"
                ? raw.mesh_adaptivity_state.last_target_h_summary
                : null,
          }
        : null,
    mesh_history: Array.isArray(raw.mesh_history)
      ? raw.mesh_history.map((entry: any) => ({
          mesh_name: String(entry?.mesh_name ?? ""),
          generation_mode:
            typeof entry?.generation_mode === "string" ? entry.generation_mode : null,
          node_count: Number(entry?.node_count ?? 0),
          element_count: Number(entry?.element_count ?? 0),
          boundary_face_count: Number(entry?.boundary_face_count ?? 0),
          kind: typeof entry?.kind === "string" ? entry.kind : undefined,
          quality:
            entry?.quality && typeof entry.quality === "object" ? entry.quality : null,
          mesh_provenance:
            entry?.mesh_provenance && typeof entry.mesh_provenance === "object"
              ? entry.mesh_provenance
              : null,
          size_field_stats:
            entry?.size_field_stats && typeof entry.size_field_stats === "object"
              ? entry.size_field_stats
              : null,
        }))
      : [],
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
  const sceneDocument =
    normalizeSceneDocument(raw.scene_document) ??
    (() => {
      const builder = normalizeScriptBuilder(raw.script_builder);
      return builder ? buildSceneDocumentFromScriptBuilder(builder) : null;
    })();
  const scriptBuilder = sceneDocument
    ? buildScriptBuilderFromSceneDocument(sceneDocument)
    : normalizeScriptBuilder(raw.script_builder);
  const modelBuilderGraph =
    (sceneDocument ? createModelBuilderGraphV2(scriptBuilder ?? undefined) : null) ??
    normalizeModelBuilderGraph(raw.model_builder_graph) ??
    (scriptBuilder ? createModelBuilderGraphV2(scriptBuilder) : null);

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
        fem_mesh: normalizeFemLiveMesh(rawLive.latest_step?.fem_mesh),
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
    mesh_workspace: normalizeMeshWorkspace(raw.mesh_workspace),
    scene_document: sceneDocument,
    script_builder: scriptBuilder,
    model_builder_graph: modelBuilderGraph,
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
    fem_mesh: normalizeFemLiveMesh(raw.fem_mesh ?? raw.live_state?.latest_step?.fem_mesh),
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
