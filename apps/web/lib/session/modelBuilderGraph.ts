import type { SetStateAction } from "react";
import type {
  MeshBuildIntent,
  ModelBuilderGraphCurrentModulesNode,
  ModelBuilderGraphObjectNode,
  ModelBuilderGraphV2,
  ScriptBuilderCurrentModuleEntry,
  ScriptBuilderExcitationAnalysisEntry,
  ScriptBuilderGeometryEntry,
  ScriptBuilderInitialState,
  ScriptBuilderMeshState,
  ScriptBuilderSolverState,
  ScriptBuilderStageState,
  ScriptBuilderState,
  ScriptBuilderUniverseState,
} from "./types";

interface ModelBuilderGraphDefaults {
  revision?: number;
  solver?: ScriptBuilderSolverState;
  mesh?: ScriptBuilderMeshState;
  initialState?: ScriptBuilderInitialState | null;
}

const EMPTY_SOLVER: ScriptBuilderSolverState = {
  integrator: "",
  fixed_timestep: "",
  relax_algorithm: "",
  torque_tolerance: "",
  energy_tolerance: "",
  max_relax_steps: "",
};

const EMPTY_MESH: ScriptBuilderMeshState = {
  algorithm_2d: 6,
  algorithm_3d: 1,
  hmax: "",
  hmin: "",
  size_factor: 1,
  size_from_curvature: 0,
  growth_rate: "",
  narrow_regions: 0,
  smoothing_steps: 1,
  optimize: "",
  optimize_iterations: 1,
  compute_quality: false,
  per_element_quality: false,
  adaptive_enabled: false,
  adaptive_policy: "auto",
  adaptive_theta: 0.3,
  adaptive_h_min: "",
  adaptive_h_max: "",
  adaptive_max_passes: 2,
  adaptive_error_tolerance: "1e-3",
};

function applyStateAction<T>(prev: T, action: SetStateAction<T>): T {
  return typeof action === "function" ? (action as (value: T) => T)(prev) : action;
}

function buildObjectNode(geometry: ScriptBuilderGeometryEntry): ModelBuilderGraphObjectNode {
  const geometryId = `geo-${geometry.name}`;
  return {
    id: geometry.name,
    kind: "ferromagnet",
    name: geometry.name,
    label: geometry.name,
    geometry,
    object_mesh: geometry.mesh ?? null,
    tree: {
      geometry: geometryId,
      material: `mat-${geometry.name}`,
      region: `reg-${geometry.name}`,
      mesh: `${geometryId}-mesh`,
    },
  };
}

function buildCurrentModulesNode(
  modules: ScriptBuilderCurrentModuleEntry[],
  excitationAnalysis: ScriptBuilderExcitationAnalysisEntry | null,
): ModelBuilderGraphCurrentModulesNode {
  return {
    id: "current_modules",
    kind: "current_modules",
    label: "Antennas / RF",
    modules,
    excitation_analysis: excitationAnalysis,
  };
}

export function createModelBuilderGraphV2(
  builder?: Partial<ScriptBuilderState> | null,
): ModelBuilderGraphV2 {
  return {
    version: "model_builder.v2",
    source_of_truth: "repo_head",
    authoring_schema: "mesh-first-fem.v1",
    revision: builder?.revision ?? 0,
    study: {
      id: "study",
      kind: "study",
      label: "Study",
      backend: builder?.backend ?? null,
      demag_realization: builder?.demag_realization ?? null,
      solver: builder?.solver ?? EMPTY_SOLVER,
      universe_mesh: builder?.universe ?? null,
      shared_domain_mesh: builder?.mesh ?? EMPTY_MESH,
      mesh_defaults: builder?.mesh ?? EMPTY_MESH,
      stages: builder?.stages ?? [],
      initial_state: builder?.initial_state ?? null,
    },
    universe: {
      id: "universe",
      kind: "universe",
      label: "Universe",
      value: builder?.universe ?? null,
    },
    objects: {
      id: "objects",
      kind: "objects",
      label: "Objects",
      items: (builder?.geometries ?? []).map(buildObjectNode),
    },
    current_modules: buildCurrentModulesNode(
      builder?.current_modules ?? [],
      builder?.excitation_analysis ?? null,
    ),
  };
}

export function buildModelBuilderGraphV2(
  builder: ScriptBuilderState | null | undefined,
): ModelBuilderGraphV2 | null {
  if (!builder) {
    return null;
  }
  return createModelBuilderGraphV2(builder);
}

export function ensureModelBuilderGraphV2(
  graph: ModelBuilderGraphV2 | null | undefined,
  defaults?: ModelBuilderGraphDefaults,
): ModelBuilderGraphV2 {
  if (graph) {
    return graph;
  }
  return createModelBuilderGraphV2({
    revision: defaults?.revision ?? 0,
    solver: defaults?.solver ?? EMPTY_SOLVER,
    mesh: defaults?.mesh ?? EMPTY_MESH,
    initial_state: defaults?.initialState ?? null,
  });
}

export function serializeModelBuilderGraphV2(graph: ModelBuilderGraphV2): Omit<
  ScriptBuilderState,
  "revision" | "initial_state"
> {
  return {
    backend: graph.study.backend,
    demag_realization: graph.study.demag_realization,
    solver: graph.study.solver,
    mesh: graph.study.shared_domain_mesh,
    universe: graph.universe.value,
    domain_frame: null,
    stages: graph.study.stages,
    geometries: graph.objects.items.map((objectNode) => objectNode.geometry),
    current_modules: graph.current_modules.modules,
    excitation_analysis: graph.current_modules.excitation_analysis,
  };
}

export function selectModelBuilderStages(
  graph: ModelBuilderGraphV2 | null | undefined,
): ScriptBuilderStageState[] {
  return graph?.study.stages ?? [];
}

export function selectModelBuilderUniverse(
  graph: ModelBuilderGraphV2 | null | undefined,
): ScriptBuilderUniverseState | null {
  return graph?.universe.value ?? null;
}

export function selectModelBuilderGeometries(
  graph: ModelBuilderGraphV2 | null | undefined,
): ScriptBuilderGeometryEntry[] {
  return graph?.objects.items.map((objectNode) => objectNode.geometry) ?? [];
}

export function selectModelBuilderCurrentModules(
  graph: ModelBuilderGraphV2 | null | undefined,
): ScriptBuilderCurrentModuleEntry[] {
  return graph?.current_modules.modules ?? [];
}

export function selectModelBuilderExcitationAnalysis(
  graph: ModelBuilderGraphV2 | null | undefined,
): ScriptBuilderExcitationAnalysisEntry | null {
  return graph?.current_modules.excitation_analysis ?? null;
}

export function selectModelBuilderSolver(
  graph: ModelBuilderGraphV2 | null | undefined,
): ScriptBuilderSolverState | null {
  return graph?.study.solver ?? null;
}

export function selectModelBuilderMeshDefaults(
  graph: ModelBuilderGraphV2 | null | undefined,
): ScriptBuilderMeshState | null {
  return graph?.study.shared_domain_mesh ?? graph?.study.mesh_defaults ?? null;
}

export function setModelBuilderStages(
  graph: ModelBuilderGraphV2 | null | undefined,
  action: SetStateAction<ScriptBuilderStageState[]>,
  defaults?: ModelBuilderGraphDefaults,
): ModelBuilderGraphV2 {
  const ensured = ensureModelBuilderGraphV2(graph, defaults);
  const nextStages = applyStateAction(ensured.study.stages, action);
  return {
    ...ensured,
    study: {
      ...ensured.study,
      stages: nextStages,
    },
  };
}

export function setModelBuilderDemagRealization(
  graph: ModelBuilderGraphV2 | null | undefined,
  action: SetStateAction<string | null>,
  defaults?: ModelBuilderGraphDefaults,
): ModelBuilderGraphV2 {
  const ensured = ensureModelBuilderGraphV2(graph, defaults);
  const nextValue = applyStateAction(ensured.study.demag_realization, action);
  return {
    ...ensured,
    study: {
      ...ensured.study,
      demag_realization: nextValue,
    },
  };
}

export function setModelBuilderUniverse(
  graph: ModelBuilderGraphV2 | null | undefined,
  action: SetStateAction<ScriptBuilderUniverseState | null>,
  defaults?: ModelBuilderGraphDefaults,
): ModelBuilderGraphV2 {
  const ensured = ensureModelBuilderGraphV2(graph, defaults);
  const nextUniverse = applyStateAction(ensured.universe.value, action);
  return {
    ...ensured,
    universe: {
      ...ensured.universe,
      value: nextUniverse,
    },
  };
}

export function setModelBuilderGeometries(
  graph: ModelBuilderGraphV2 | null | undefined,
  action: SetStateAction<ScriptBuilderGeometryEntry[]>,
  defaults?: ModelBuilderGraphDefaults,
): ModelBuilderGraphV2 {
  const ensured = ensureModelBuilderGraphV2(graph, defaults);
  const nextGeometries = applyStateAction(selectModelBuilderGeometries(ensured), action);
  return {
    ...ensured,
    objects: {
      ...ensured.objects,
      items: nextGeometries.map(buildObjectNode),
    },
  };
}

export function setModelBuilderCurrentModules(
  graph: ModelBuilderGraphV2 | null | undefined,
  action: SetStateAction<ScriptBuilderCurrentModuleEntry[]>,
  defaults?: ModelBuilderGraphDefaults,
): ModelBuilderGraphV2 {
  const ensured = ensureModelBuilderGraphV2(graph, defaults);
  const nextModules = applyStateAction(ensured.current_modules.modules, action);
  return {
    ...ensured,
    current_modules: buildCurrentModulesNode(
      nextModules,
      ensured.current_modules.excitation_analysis,
    ),
  };
}

export function setModelBuilderExcitationAnalysis(
  graph: ModelBuilderGraphV2 | null | undefined,
  action: SetStateAction<ScriptBuilderExcitationAnalysisEntry | null>,
  defaults?: ModelBuilderGraphDefaults,
): ModelBuilderGraphV2 {
  const ensured = ensureModelBuilderGraphV2(graph, defaults);
  const nextAnalysis = applyStateAction(ensured.current_modules.excitation_analysis, action);
  return {
    ...ensured,
    current_modules: buildCurrentModulesNode(ensured.current_modules.modules, nextAnalysis),
  };
}

export function setModelBuilderSolver(
  graph: ModelBuilderGraphV2 | null | undefined,
  solver: ScriptBuilderSolverState,
  defaults?: ModelBuilderGraphDefaults,
): ModelBuilderGraphV2 {
  const ensured = ensureModelBuilderGraphV2(graph, defaults);
  return {
    ...ensured,
    study: {
      ...ensured.study,
      solver,
    },
  };
}

export function setModelBuilderMeshDefaults(
  graph: ModelBuilderGraphV2 | null | undefined,
  meshDefaults: ScriptBuilderMeshState,
  defaults?: ModelBuilderGraphDefaults,
): ModelBuilderGraphV2 {
  const ensured = ensureModelBuilderGraphV2(graph, defaults);
  return {
    ...ensured,
    study: {
      ...ensured.study,
      shared_domain_mesh: meshDefaults,
      mesh_defaults: meshDefaults,
    },
  };
}

export function resolveSelectedObjectIdFromModelBuilderGraph(
  graph: ModelBuilderGraphV2 | null | undefined,
  nodeId: string | null | undefined,
): string | null {
  if (!graph || !nodeId) {
    return null;
  }
  for (const objectNode of graph.objects.items) {
    const objectPrefix = `obj-${objectNode.id}`;
    const geometryPrefix = objectNode.tree.geometry;
    const materialPrefix = objectNode.tree.material;
    const regionPrefix = objectNode.tree.region;
    const meshPrefix = objectNode.tree.mesh;
    if (
      nodeId === objectPrefix ||
      nodeId.startsWith(`${objectPrefix}-`) ||
      nodeId === geometryPrefix ||
      nodeId.startsWith(`${geometryPrefix}-`) ||
      nodeId === materialPrefix ||
      nodeId.startsWith(`${materialPrefix}-`) ||
      nodeId === regionPrefix ||
      nodeId.startsWith(`${regionPrefix}-`) ||
      nodeId === meshPrefix ||
      nodeId.startsWith(`${meshPrefix}-`)
    ) {
      return objectNode.name;
    }
  }
  if ((nodeId === "geometry" || nodeId === "objects") && graph.objects.items.length === 1) {
    return graph.objects.items[0]?.name ?? null;
  }
  return null;
}

/**
 * Map a model-tree node ID to a MeshBuildIntent so the UI can dispatch
 * the correct mesh rebuild scope when the user clicks "Build Selected".
 */
export function resolveMeshBuildIntentFromNodeId(
  nodeId: string | null | undefined,
  graph: ModelBuilderGraphV2 | null | undefined,
): MeshBuildIntent | null {
  if (!graph || !nodeId) {
    return null;
  }

  // Universe-level airbox node
  if (nodeId === "universe-airbox" || nodeId.startsWith("universe-airbox-")) {
    return { mode: "selected", target: { kind: "airbox" } };
  }

  // Universe-level mesh node → full study domain rebuild
  if (nodeId === "universe-mesh" || nodeId.startsWith("universe-mesh-")) {
    return { mode: "selected", target: { kind: "study_domain" } };
  }

  // Top-level mesh node → full study domain rebuild
  if (nodeId === "mesh" || nodeId.startsWith("mesh-")) {
    return { mode: "selected", target: { kind: "study_domain" } };
  }

  // Per-object mesh node → object_mesh for that object
  for (const objectNode of graph.objects.items) {
    const meshPrefix = objectNode.tree.mesh;
    if (
      nodeId === meshPrefix ||
      nodeId.startsWith(`${meshPrefix}-`)
    ) {
      return { mode: "selected", target: { kind: "object_mesh", object_id: objectNode.name } };
    }
  }

  return null;
}
