/* ── ControlRoom pure helper functions ──
 * Stateless functions extracted from ControlRoomContext.tsx to reduce file size. */

import type {
  DisplaySelection,
  ScriptBuilderStageState,
  ScriptBuilderState,
  SessionManifest,
} from "../../../lib/useSessionStream";
import type {
  ScriptBuilderCurrentModuleEntry,
  ScriptBuilderExcitationAnalysisEntry,
  ScriptBuilderGeometryEntry,
  ScriptBuilderUniverseState,
} from "../../../lib/session/types";
import { DEFAULT_SOLVER_SETTINGS } from "../../panels/SolverSettingsPanel";
import type { SolverSettingsState } from "../../panels/SolverSettingsPanel";
import { DEFAULT_MESH_OPTIONS } from "../../panels/MeshSettingsPanel";
import type { MeshOptionsState } from "../../panels/MeshSettingsPanel";
import type { SolverPlanSummary } from "./types";
import { asVec3 } from "./shared";

/* ── Record / typing helpers ── */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/* ── Display selection comparison ── */

export function sameDisplaySelection(
  left: DisplaySelection | null | undefined,
  right: DisplaySelection | null | undefined,
): boolean {
  if (!left || !right) return false;
  return (
    left.quantity === right.quantity &&
    left.kind === right.kind &&
    left.component === right.component &&
    left.layer === right.layer &&
    left.all_layers === right.all_layers &&
    left.x_chosen_size === right.x_chosen_size &&
    left.y_chosen_size === right.y_chosen_size &&
    left.every_n === right.every_n &&
    left.max_points === right.max_points &&
    left.auto_scale_enabled === right.auto_scale_enabled
  );
}

/* ── Command kind label ── */

export function commandKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "display_selection_update": return "Display selection";
    case "preview_update": return "Display update";
    case "preview_refresh": return "Preview refresh";
    case "run": return "Run";
    case "relax": return "Relax";
    case "pause": return "Pause";
    case "resume": return "Resume";
    case "stop":
    case "break": return "Stop";
    case "solve": return "Compute";
    case "remesh": return "Remesh";
    case "save_vtk": return "Export VTK";
    default: return kind && kind.trim().length > 0 ? kind : "Command";
  }
}

/* ── Script-builder ↔ settings conversion ── */

export function solverSettingsFromBuilder(
  builder: ScriptBuilderState["solver"],
): SolverSettingsState {
  return {
    ...DEFAULT_SOLVER_SETTINGS,
    integrator: builder.integrator || DEFAULT_SOLVER_SETTINGS.integrator,
    fixedTimestep: builder.fixed_timestep,
    relaxAlgorithm: builder.relax_algorithm || DEFAULT_SOLVER_SETTINGS.relaxAlgorithm,
    torqueTolerance: builder.torque_tolerance,
    energyTolerance: builder.energy_tolerance,
    maxRelaxSteps: builder.max_relax_steps,
  };
}

export function meshOptionsFromBuilder(
  builder: ScriptBuilderState["mesh"],
): MeshOptionsState {
  return {
    ...DEFAULT_MESH_OPTIONS,
    algorithm2d: builder.algorithm_2d,
    algorithm3d: builder.algorithm_3d,
    hmax: builder.hmax,
    hmin: builder.hmin,
    sizeFactor: builder.size_factor,
    sizeFromCurvature: builder.size_from_curvature,
    smoothingSteps: builder.smoothing_steps,
    optimize: builder.optimize,
    optimizeIters: builder.optimize_iterations,
    computeQuality: builder.compute_quality,
    perElementQuality: builder.per_element_quality,
    adaptiveEnabled: builder.adaptive_enabled ?? false,
    adaptivePolicy: builder.adaptive_policy || "auto",
    adaptiveTheta: builder.adaptive_theta ?? 0.3,
    adaptiveHMin: builder.adaptive_h_min || "",
    adaptiveHMax: builder.adaptive_h_max || "",
    adaptiveMaxPasses: builder.adaptive_max_passes ?? 2,
    adaptiveErrorTolerance: builder.adaptive_error_tolerance || "1e-3",
  };
}

export function buildScriptBuilderUpdatePayload(
  solverSettings: SolverSettingsState,
  meshOptions: MeshOptionsState,
  universe: ScriptBuilderUniverseState | null,
  stages: ScriptBuilderStageState[],
  geometries: ScriptBuilderGeometryEntry[],
  currentModules: ScriptBuilderCurrentModuleEntry[],
  excitationAnalysis: ScriptBuilderExcitationAnalysisEntry | null,
) {
  return {
    solver: {
      integrator: solverSettings.integrator || "",
      fixed_timestep: solverSettings.fixedTimestep,
      relax_algorithm: solverSettings.relaxAlgorithm || "",
      torque_tolerance: solverSettings.torqueTolerance,
      energy_tolerance: solverSettings.energyTolerance,
      max_relax_steps: solverSettings.maxRelaxSteps,
    },
    mesh: {
      algorithm_2d: meshOptions.algorithm2d,
      algorithm_3d: meshOptions.algorithm3d,
      hmax: meshOptions.hmax,
      hmin: meshOptions.hmin,
      size_factor: meshOptions.sizeFactor,
      size_from_curvature: meshOptions.sizeFromCurvature,
      smoothing_steps: meshOptions.smoothingSteps,
      optimize: meshOptions.optimize,
      optimize_iterations: meshOptions.optimizeIters,
      compute_quality: meshOptions.computeQuality,
      per_element_quality: meshOptions.perElementQuality,
      adaptive_enabled: meshOptions.adaptiveEnabled,
      adaptive_policy: meshOptions.adaptivePolicy,
      adaptive_theta: meshOptions.adaptiveTheta,
      adaptive_h_min: meshOptions.adaptiveHMin,
      adaptive_h_max: meshOptions.adaptiveHMax,
      adaptive_max_passes: meshOptions.adaptiveMaxPasses,
      adaptive_error_tolerance: meshOptions.adaptiveErrorTolerance,
    },
    universe,
    stages,
    geometries,
    current_modules: currentModules,
    excitation_analysis: excitationAnalysis,
  };
}

/* ── File I/O helpers ── */

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read uploaded file"));
        return;
      }
      const base64 = result.includes(",") ? result.split(",", 2)[1] ?? "" : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read uploaded file"));
    reader.readAsDataURL(file);
  });
}

export function downloadBase64File(fileName: string, contentBase64: string) {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/* ── Solver plan extraction ── */

export function extractSolverPlan(
  metadata: Record<string, unknown> | null,
  session: SessionManifest | null,
): SolverPlanSummary | null {
  const executionPlan = asRecord(metadata?.execution_plan);
  const backendPlan = asRecord(executionPlan?.backend_plan);
  if (!backendPlan) return null;

  const common = asRecord(executionPlan?.common);
  const material = asRecord(backendPlan.material);
  const adaptive = asRecord(backendPlan.adaptive_timestep);
  const relaxation = asRecord(backendPlan.relaxation);
  const planSummary = asRecord(session?.plan_summary);

  return {
    backendKind: asString(backendPlan.kind),
    requestedBackend:
      asString(common?.requested_backend) ?? asString(planSummary?.requested_backend) ?? session?.requested_backend ?? null,
    resolvedBackend:
      asString(common?.resolved_backend) ?? asString(planSummary?.resolved_backend) ?? null,
    executionMode:
      asString(common?.execution_mode) ?? asString(planSummary?.execution_mode) ?? session?.execution_mode ?? null,
    precision: asString(backendPlan.precision) ?? session?.precision ?? null,
    integrator: asString(backendPlan.integrator),
    fixedTimestep: asNumber(backendPlan.fixed_timestep),
    adaptive: adaptive
      ? {
          atol: asNumber(adaptive.atol),
          dtInitial: asNumber(adaptive.dt_initial),
          dtMin: asNumber(adaptive.dt_min),
          dtMax: asNumber(adaptive.dt_max),
          safety: asNumber(adaptive.safety),
        }
      : null,
    relaxation: relaxation
      ? {
          algorithm: asString(relaxation.algorithm),
          torqueTolerance: asNumber(relaxation.torque_tolerance),
          energyTolerance: asNumber(relaxation.energy_tolerance),
          maxSteps: asNumber(relaxation.max_steps),
        }
      : null,
    gyromagneticRatio: asNumber(backendPlan.gyromagnetic_ratio),
    exchangeBoundary: asString(backendPlan.exchange_bc),
    externalField: asVec3(backendPlan.external_field),
    exchangeEnabled: backendPlan.enable_exchange === true,
    demagEnabled: backendPlan.enable_demag === true,
    cellSize: asVec3(backendPlan.cell_size),
    gridCells: asVec3(asRecord(backendPlan.grid)?.cells),
    meshName: asString(backendPlan.mesh_name),
    meshSource: asString(backendPlan.mesh_source),
    feOrder: asNumber(backendPlan.fe_order),
    hmax: asNumber(backendPlan.hmax),
    materialName: asString(material?.name),
    materialMsat: asNumber(material?.saturation_magnetisation),
    materialAex: asNumber(material?.exchange_stiffness),
    materialAlpha: asNumber(material?.damping),
    notes: asStringArray(planSummary?.notes),
  };
}
