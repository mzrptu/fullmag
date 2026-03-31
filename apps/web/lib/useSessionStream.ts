"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiHttpError, currentLiveApiClient } from "./liveApiClient";

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
  initial_state: ScriptBuilderInitialState | null;
}

export interface SessionState {
  session: SessionManifest;
  run: RunManifest | null;
  live_state: LiveState | null;
  runtime_status: RuntimeStatusState | null;
  metadata: Record<string, unknown> | null;
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

type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface UseSessionStreamResult {
  state: SessionState | null;
  connection: ConnectionStatus;
  error: string | null;
}

interface SessionStateCurrentLiveEvent {
  kind: "session_state";
  state: unknown;
}

interface CommandAckCurrentLiveEvent {
  kind: "command_ack";
  session_id: string;
  seq: number;
  command_id: string;
  command_kind: string;
  issued_at_unix_ms: number;
  display_selection?: unknown;
}

interface CommandRejectedCurrentLiveEvent {
  kind: "command_rejected";
  session_id: string;
  command_id: string;
  command_kind: string;
  issued_at_unix_ms: number;
  reason: string;
}

interface CommandCompletedCurrentLiveEvent {
  kind: "command_completed";
  session_id: string;
  seq: number;
  command_id: string;
  command_kind: string;
  completed_at_unix_ms: number;
  completion_state: string;
}

type RuntimeCurrentLiveEvent =
  | CommandAckCurrentLiveEvent
  | CommandRejectedCurrentLiveEvent
  | CommandCompletedCurrentLiveEvent;

const PREVIEW_BINARY_FRAME_MAGIC = "FMVP";
const PREVIEW_BINARY_FRAME_HEADER_LEN = 16;
const PREVIEW_BINARY_FRAME_KIND_F64 = 1;

interface PreviewBinaryPayload {
  payloadId: number;
  vectorFieldValues: Float64Array;
}

function currentSessionHint(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get("session");
  return value && value.trim().length > 0 ? value.trim() : null;
}

function lastScalarStep(rows: ScalarRow[]): number {
  return rows.length > 0 ? rows[rows.length - 1]?.step ?? -1 : -1;
}

function lastLogTimestamp(entries: EngineLogEntry[]): number {
  return entries.length > 0 ? entries[entries.length - 1]?.timestamp_unix_ms ?? -1 : -1;
}

function previewSequence(preview: PreviewState | null): [number, number, number] {
  if (!preview) return [-1, -1, -1];
  return [preview.config_revision, preview.source_step, preview.source_time];
}

function compareLexicographic(
  lhs: [number, number, number],
  rhs: [number, number, number],
): number {
  for (let i = 0; i < lhs.length; i += 1) {
    if (lhs[i] > rhs[i]) return 1;
    if (lhs[i] < rhs[i]) return -1;
  }
  return 0;
}

function mergeSessionState(prev: SessionState | null, next: SessionState): SessionState {
  if (!prev) {
    return next;
  }
  if (prev.session.session_id !== next.session.session_id) {
    return next;
  }

  const merged: SessionState = { ...next };

  if (!merged.fem_mesh && prev.fem_mesh) {
    merged.fem_mesh = prev.fem_mesh;
  }

  const prevLiveTs = prev.live_state?.updated_at_unix_ms ?? -1;
  const nextLiveTs = next.live_state?.updated_at_unix_ms ?? -1;
  const prevLiveStep = prev.live_state?.step ?? -1;
  const nextLiveStep = next.live_state?.step ?? -1;
  const liveRegressed =
    prev.live_state != null &&
    (
      next.live_state == null ||
      nextLiveTs < prevLiveTs ||
      (nextLiveTs === prevLiveTs && nextLiveStep < prevLiveStep)
    );

  if (liveRegressed) {
    merged.live_state = prev.live_state;
    merged.latest_fields = prev.latest_fields;
    if (prev.fem_mesh) {
      merged.fem_mesh = prev.fem_mesh;
    }
  }

  const prevRunSteps = prev.run?.total_steps ?? -1;
  const nextRunSteps = next.run?.total_steps ?? -1;
  if (prev.run && next.run && nextRunSteps < prevRunSteps) {
    merged.run = prev.run;
  }

  if (
    prev.display_selection &&
    (
      !next.display_selection ||
      next.display_selection.revision < prev.display_selection.revision
    )
  ) {
    merged.display_selection = prev.display_selection;
  }

  if (
    prev.preview_config &&
    (
      !next.preview_config ||
      next.preview_config.revision < prev.preview_config.revision
    )
  ) {
    merged.preview_config = prev.preview_config;
  }

  const previewOrdering = compareLexicographic(
    previewSequence(next.preview),
    previewSequence(prev.preview),
  );
  const previewRegressed =
    prev.preview != null &&
    next.preview != null &&
    previewOrdering < 0;
  if (previewRegressed || (prev.preview != null && next.preview == null)) {
    merged.preview = prev.preview;
  }

  if (prev.runtime_status && !next.runtime_status) {
    merged.runtime_status = prev.runtime_status;
  }

  if (
    prev.script_builder &&
    (
      !next.script_builder ||
      next.script_builder.revision < prev.script_builder.revision
    )
  ) {
    merged.script_builder = prev.script_builder;
  }

  const prevScalarStep = lastScalarStep(prev.scalar_rows);
  const nextScalarStep = lastScalarStep(next.scalar_rows);
  if (nextScalarStep < prevScalarStep) {
    merged.scalar_rows = prev.scalar_rows;
  } else if (next.scalar_rows.length === prev.scalar_rows.length && nextScalarStep === prevScalarStep) {
    // Only reuse the previous array if the last row hasn't changed.
    // Compare a representative value (e_total) to detect in-place updates
    // (e.g. energy values going from 0 → real values within the same step).
    const prevLast = prev.scalar_rows[prev.scalar_rows.length - 1];
    const nextLast = next.scalar_rows[next.scalar_rows.length - 1];
    if (prevLast?.e_total === nextLast?.e_total && prevLast?.max_dm_dt === nextLast?.max_dm_dt) {
      merged.scalar_rows = prev.scalar_rows;
    }
  }

  const prevLogTs = lastLogTimestamp(prev.engine_log);
  const nextLogTs = lastLogTimestamp(next.engine_log);
  if (nextLogTs < prevLogTs) {
    merged.engine_log = prev.engine_log;
  } else if (next.engine_log.length === prev.engine_log.length) {
    merged.engine_log = prev.engine_log;
  }

  if (!merged.command_status && prev.command_status) {
    merged.command_status = prev.command_status;
  }

  return merged;
}

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

function decodePreviewBinaryFrame(data: ArrayBuffer): PreviewBinaryPayload | null {
  if (data.byteLength < PREVIEW_BINARY_FRAME_HEADER_LEN) {
    return null;
  }

  const view = new DataView(data);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== PREVIEW_BINARY_FRAME_MAGIC) {
    return null;
  }

  const version = view.getUint8(4);
  const kind = view.getUint8(5);
  if (version !== 1 || kind !== PREVIEW_BINARY_FRAME_KIND_F64) {
    return null;
  }

  const payloadId = view.getUint32(8, true);
  const elementCount = view.getUint32(12, true);
  const expectedLength = PREVIEW_BINARY_FRAME_HEADER_LEN + elementCount * 8;
  if (data.byteLength !== expectedLength) {
    return null;
  }

  return {
    payloadId,
    vectorFieldValues: new Float64Array(data, PREVIEW_BINARY_FRAME_HEADER_LEN, elementCount),
  };
}

function attachPreviewBinaryPayload(
  prev: SessionState | null,
  payloadId: number,
  vectorFieldValues: Float64Array,
): SessionState | null {
  if (!prev || !prev.preview || prev.preview.kind !== "spatial") {
    return prev;
  }
  if (prev.preview.vector_payload_id !== payloadId) {
    return prev;
  }
  if (prev.preview.vector_field_values === vectorFieldValues) {
    return prev;
  }
  return {
    ...prev,
    preview: {
      ...prev.preview,
      vector_field_values: vectorFieldValues,
    },
  };
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

function normalizeDisplaySelection(raw: any): CurrentDisplaySelection | null {
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

function mergeCommandStatusEvent(
  prev: SessionState | null,
  raw: RuntimeCurrentLiveEvent,
): SessionState | null {
  if (!prev || prev.session.session_id !== raw.session_id) {
    return prev;
  }

  if (raw.kind === "command_ack") {
    const displaySelection =
      normalizeDisplaySelection(raw.display_selection) ?? prev.display_selection;
    return {
      ...prev,
      command_status: {
        session_id: raw.session_id,
        seq: Number(raw.seq ?? 0),
        command_id: String(raw.command_id ?? ""),
        command_kind: String(raw.command_kind ?? ""),
        state: "acknowledged",
        issued_at_unix_ms: Number(raw.issued_at_unix_ms ?? 0),
        completed_at_unix_ms: null,
        completion_state: null,
        reason: null,
        display_selection: displaySelection,
      },
    };
  }

  if (raw.kind === "command_rejected") {
    return {
      ...prev,
      command_status: {
        session_id: raw.session_id,
        seq: null,
        command_id: String(raw.command_id ?? ""),
        command_kind: String(raw.command_kind ?? ""),
        state: "rejected",
        issued_at_unix_ms: Number(raw.issued_at_unix_ms ?? 0),
        completed_at_unix_ms: null,
        completion_state: null,
        reason: String(raw.reason ?? ""),
        display_selection: prev.display_selection,
      },
    };
  }

  return {
    ...prev,
    command_status: {
      session_id: raw.session_id,
      seq: Number(raw.seq ?? 0),
      command_id: String(raw.command_id ?? ""),
      command_kind: String(raw.command_kind ?? ""),
      state: "completed",
      issued_at_unix_ms: null,
      completed_at_unix_ms: Number(raw.completed_at_unix_ms ?? 0),
      completion_state: String(raw.completion_state ?? ""),
      reason: null,
      display_selection: prev.display_selection,
    },
  };
}

function normalizeSessionState(
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

export function useCurrentLiveStream(): UseSessionStreamResult {
  const [state, setState] = useState<SessionState | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [sessionHint] = useState<string | null>(() => currentSessionHint());
  const wsRef = useRef<WebSocket | null>(null);
  const finishedRef = useRef(false);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const unmountedRef = useRef(false);
  const intentionallyClosedRef = useRef(new WeakSet<WebSocket>());
  const pendingPreviewPayloadsRef = useRef(new Map<number, Float64Array>());

  const connect = useCallback(() => {
    const client = currentLiveApiClient();
    const previousWs = wsRef.current;
    if (previousWs) {
      intentionallyClosedRef.current.add(previousWs);
      previousWs.close();
      wsRef.current = null;
    }

    client
      .fetchBootstrap()
      .then((raw) => {
        if (unmountedRef.current) {
          return;
        }
        const nextState = normalizeSessionState(raw, pendingPreviewPayloadsRef.current);
        if (sessionHint && nextState.session.session_id !== sessionHint) {
          setState(null);
          setError(null);
          return;
        }
        if (nextState.live_state?.finished) {
          finishedRef.current = true;
        }
        setState((prevState) => mergeSessionState(prevState, nextState));
      })
      .catch((bootstrapError) => {
        if (unmountedRef.current) {
          return;
        }
        if (bootstrapError instanceof ApiHttpError && bootstrapError.status === 404) {
          // Keep the last good workspace visible while the singleton live API
          // is restarting or waiting for the next snapshot. This avoids
          // remounting the entire control room and resetting 3D camera state.
          setError(null);
          return;
        }
        setError(
          bootstrapError instanceof Error ? bootstrapError.message : "Failed to load live state",
        );
      });

    const ws = client.connectWebSocket();
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current || wsRef.current !== ws) {
        return;
      }
      if (disconnectTimerRef.current !== null) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setConnection("connected");
      setError(null);
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (unmountedRef.current || wsRef.current !== ws) {
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        const payload = decodePreviewBinaryFrame(event.data);
        if (!payload) {
          return;
        }
        pendingPreviewPayloadsRef.current.set(payload.payloadId, payload.vectorFieldValues);
        if (pendingPreviewPayloadsRef.current.size > 16) {
          const oldestKey = pendingPreviewPayloadsRef.current.keys().next().value;
          if (oldestKey != null) {
            pendingPreviewPayloadsRef.current.delete(oldestKey);
          }
        }
        setState((prevState) =>
          attachPreviewBinaryPayload(prevState, payload.payloadId, payload.vectorFieldValues));
        return;
      }
      try {
        const raw = JSON.parse(event.data);
        setState((prevState) => {
          if (raw?.kind === "session_state" && raw.state) {
            const nextState = normalizeSessionState(
              (raw as SessionStateCurrentLiveEvent).state,
              pendingPreviewPayloadsRef.current,
            );
            if (sessionHint && nextState.session.session_id !== sessionHint) {
              return null;
            }
            if (nextState.live_state?.finished) {
              finishedRef.current = true;
            }
            return mergeSessionState(prevState, nextState);
          }

          if (
            typeof raw?.kind === "string" &&
            typeof raw?.session_id === "string" &&
            (
              raw.kind === "command_ack" ||
              raw.kind === "command_rejected" ||
              raw.kind === "command_completed"
            )
          ) {
            return mergeCommandStatusEvent(prevState, raw as RuntimeCurrentLiveEvent);
          }

          const nextState = normalizeSessionState(raw, pendingPreviewPayloadsRef.current);
          if (sessionHint && nextState.session.session_id !== sessionHint) {
            return null;
          }
          if (nextState.live_state?.finished) {
            finishedRef.current = true;
          }
          return mergeSessionState(prevState, nextState);
        });
      } catch (parseError) {
        console.warn("Failed to parse current live ws payload", parseError);
      }
    };

    ws.onerror = () => {
      if (
        unmountedRef.current ||
        wsRef.current !== ws ||
        intentionallyClosedRef.current.has(ws)
      ) {
        return;
      }
      ws.close();
    };

    ws.onclose = () => {
      if (
        unmountedRef.current ||
        wsRef.current !== ws ||
        intentionallyClosedRef.current.has(ws)
      ) {
        return;
      }

      if (finishedRef.current) {
        setConnection("disconnected");
        return;
      }

      // Preserve the last good workspace while reconnecting so viewer state
      // (camera, selections, local tool state) survives transient disconnects.
      setConnection("connecting");
      setError(null);

      disconnectTimerRef.current = setTimeout(() => {
        disconnectTimerRef.current = null;
        setConnection("disconnected");
      }, 2000);

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (wsRef.current === ws) {
          reconnectAttemptRef.current += 1;
          setConnection("connecting");
          connect();
        }
      }, Math.min(1500 * Math.pow(2, reconnectAttemptRef.current), 30000));
    };
  }, [sessionHint]);

  useEffect(() => {
    unmountedRef.current = false;
    finishedRef.current = false;
    setState(null);
    setConnection("connecting");
    setError(null);
    connect();
    return () => {
      unmountedRef.current = true;
      const ws = wsRef.current;
      if (ws) {
        intentionallyClosedRef.current.add(ws);
        ws.close();
        wsRef.current = null;
      }
      if (disconnectTimerRef.current !== null) {
        clearTimeout(disconnectTimerRef.current);
      }
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  return { state, connection, error };
}
