"use client";

import type { EngineLogEntry } from "../../../lib/useSessionStream";
import type { MeshQualityData, MeshOptionsState } from "../../panels/MeshSettingsPanel";
import type { RenderMode } from "../../preview/FemMeshView3D";
import type { FemDockTab, ViewportMode } from "./shared";
import { type LucideIcon, Grid3x3, Box, Scissors, Activity, Zap } from "lucide-react";

export type MeshWorkspacePresetId =
  | "inspect-surface"
  | "inspect-volume"
  | "slice"
  | "quality"
  | "optimize";

export interface MeshWorkspacePreset {
  id: MeshWorkspacePresetId;
  label: string;
  shortLabel: string;
  description: string;
  viewMode: ViewportMode;
  dockTab: FemDockTab;
  renderMode: RenderMode;
  icon: LucideIcon;
  clipEnabled?: boolean;
  opacity?: number;
}

export interface MeshPipelinePhaseStatus {
  id: "import" | "classify" | "generate" | "optimize" | "quality" | "readiness";
  label: string;
  status: "idle" | "active" | "done" | "warning";
  detail: string | null;
}

export const MESH_WORKSPACE_PRESETS: MeshWorkspacePreset[] = [
  {
    id: "inspect-surface",
    label: "Inspect Surface",
    shortLabel: "Surface",
    description: "Surface skin with boundary edges and face inspection.",
    viewMode: "Mesh",
    dockTab: "view",
    renderMode: "surface+edges",
    icon: Grid3x3,
    clipEnabled: false,
    opacity: 100,
  },
  {
    id: "inspect-volume",
    label: "Inspect Volume",
    shortLabel: "Volume",
    description: "Volume-oriented wireframe to verify tetrahedral fill.",
    viewMode: "Mesh",
    dockTab: "view",
    renderMode: "wireframe",
    icon: Box,
    clipEnabled: false,
    opacity: 100,
  },
  {
    id: "slice",
    label: "Slice Workspace",
    shortLabel: "Slice",
    description: "2D cross-section through the tetra mesh.",
    viewMode: "2D",
    dockTab: "view",
    renderMode: "wireframe",
    icon: Scissors,
    clipEnabled: false,
    opacity: 100,
  },
  {
    id: "quality",
    label: "Quality Review",
    shortLabel: "Quality",
    description: "Mesh diagnostics, worst elements and quality histograms.",
    viewMode: "Mesh",
    dockTab: "quality",
    renderMode: "surface+edges",
    icon: Activity,
    clipEnabled: false,
    opacity: 100,
  },
  {
    id: "optimize",
    label: "Optimize & Generate",
    shortLabel: "Optimize",
    description: "Mesher controls, precompute policy and pipeline feedback.",
    viewMode: "Mesh",
    dockTab: "mesher",
    renderMode: "wireframe",
    icon: Zap,
    clipEnabled: true,
    opacity: 82,
  },
];

export const MESH_RENDER_MODE_OPTIONS: Array<{ value: RenderMode; label: string }> = [
  { value: "surface", label: "Surface" },
  { value: "surface+edges", label: "Surface+Edges" },
  { value: "wireframe", label: "Wireframe" },
  { value: "points", label: "Points" },
];

export function deriveMeshWorkspacePreset(args: {
  viewMode: ViewportMode;
  femDockTab: FemDockTab;
  meshRenderMode: RenderMode;
}): MeshWorkspacePresetId {
  const { viewMode, femDockTab, meshRenderMode } = args;
  if (viewMode === "2D") return "slice";
  if (femDockTab === "quality") return "quality";
  if (femDockTab === "mesher" || femDockTab === "pipeline") return "optimize";
  if (meshRenderMode === "surface") return "inspect-surface";
  return "inspect-volume";
}

export function meshWorkspaceNodeToDockTab(nodeId: string): FemDockTab | null {
  switch (nodeId) {
    case "universe-mesh-view":
    case "mesh-view":
      return "view";
    case "universe-mesh-size":
    case "universe-mesh-algorithm":
    case "mesh-size":
    case "mesh-algorithm":
      return "mesher";
    case "universe-mesh-quality":
    case "mesh-quality":
      return "quality";
    case "universe-mesh-pipeline":
    case "mesh-pipeline":
      return "pipeline";
    case "universe-mesh":
    case "mesh":
      return "mesh";
    default:
      return null;
  }
}

export function meshWorkspaceNodeToPreset(nodeId: string): MeshWorkspacePresetId | null {
  switch (nodeId) {
    case "universe-mesh-view":
    case "mesh-view":
      return "inspect-volume";
    case "universe-mesh-size":
    case "universe-mesh-algorithm":
    case "mesh-size":
    case "mesh-algorithm":
      return "optimize";
    case "universe-mesh-quality":
    case "mesh-quality":
      return "quality";
    case "universe-mesh":
    case "mesh":
      return "inspect-surface";
    default:
      return null;
  }
}

function lastMatchingLog(
  engineLog: EngineLogEntry[],
  patterns: string[],
): EngineLogEntry | null {
  for (let index = engineLog.length - 1; index >= 0; index -= 1) {
    const entry = engineLog[index];
    const lower = entry.message.toLowerCase();
    if (patterns.some((pattern) => lower.includes(pattern))) {
      return entry;
    }
  }
  return null;
}

function hasAnyLog(engineLog: EngineLogEntry[], patterns: string[]): boolean {
  return lastMatchingLog(engineLog, patterns) != null;
}

export function estimateDenseSolverRamGb(nodeCount: number): number {
  return (nodeCount * nodeCount * 24) / 1e9;
}

export function extractMeshLogHighlights(
  engineLog: EngineLogEntry[],
  limit = 6,
): EngineLogEntry[] {
  const keywords = [
    "mesh",
    "remesh",
    "gmsh",
    "stl",
    "classif",
    "tetra",
    "quality",
    "coarsen",
    "optimiz",
    "surface",
    "geometry",
  ];
  return engineLog
    .filter((entry) => {
      const lower = entry.message.toLowerCase();
      return keywords.some((keyword) => lower.includes(keyword));
    })
    .slice(-limit)
    .reverse();
}

export function buildMeshPipelinePhases(args: {
  engineLog: EngineLogEntry[];
  meshSource: string | null;
  nodeCount: number;
  elementCount: number;
  meshOptions: MeshOptionsState;
  meshQualityData: MeshQualityData | null;
  workspaceStatus: string;
}): MeshPipelinePhaseStatus[] {
  const {
    engineLog,
    meshSource,
    nodeCount,
    elementCount,
    meshOptions,
    meshQualityData,
    workspaceStatus,
  } = args;

  const importEntry = lastMatchingLog(engineLog, [
    "importing stl surface",
    "loading python script",
    "preparing fem mesh asset",
    "remesh requested",
  ]);
  const classifyEntry = lastMatchingLog(engineLog, [
    "classifying stl surfaces",
    "creating geometry from classified surfaces",
  ]);
  const generateEntry = lastMatchingLog(engineLog, [
    "generating 3d tetrahedral mesh",
    "remesh complete",
    "mesh ready",
    "fem mesh ready",
  ]);
  const optimizeEntry = lastMatchingLog(engineLog, [
    "auto-coarsen",
    "optimiz",
    "smoothing",
    "relocate",
    "netgen",
    "laplace",
  ]);
  const qualityEntry = lastMatchingLog(engineLog, [
    "extracting quality metrics",
    "quality metrics",
    "sicn",
    "gamma",
  ]);
  const readinessEntry = lastMatchingLog(engineLog, [
    "est. ram",
    "available ram",
    "too large",
    "oom",
    "waiting for compute",
    "compute requested",
  ]);

  const optimizeRequested = meshOptions.optimize !== "" || meshOptions.smoothingSteps > 0;
  const qualityRequested = meshOptions.computeQuality;
  const readinessRamGb = nodeCount > 0 ? estimateDenseSolverRamGb(nodeCount) : 0;
  const readinessWarning = nodeCount > 50_000;
  const readinessLarge = nodeCount > 10_000;

  return [
    {
      id: "import",
      label: "Import",
      status: meshSource || importEntry ? "done" : "idle",
      detail: meshSource ?? importEntry?.message ?? "Waiting for source geometry",
    },
    {
      id: "classify",
      label: "Classify",
      status: classifyEntry || elementCount > 0 ? "done" : (importEntry ? "active" : "idle"),
      detail:
        classifyEntry?.message ??
        (elementCount > 0 ? "Surface classification completed during volume meshing" : "Surface healing / classification pending"),
    },
    {
      id: "generate",
      label: "Generate",
      status: elementCount > 0 || generateEntry ? "done" : (classifyEntry ? "active" : "idle"),
      detail:
        generateEntry?.message ??
        (elementCount > 0 ? `${nodeCount.toLocaleString()} nodes, ${elementCount.toLocaleString()} tetrahedra` : "Volume generation pending"),
    },
    {
      id: "optimize",
      label: "Optimize",
      status:
        optimizeEntry
          ? "done"
          : optimizeRequested
            ? "active"
            : "idle",
      detail:
        optimizeEntry?.message ??
        (optimizeRequested
          ? `Method ${meshOptions.optimize || "smoothing"} · ${meshOptions.smoothingSteps} smoothing step(s)`
          : "No optimizer policy enabled"),
    },
    {
      id: "quality",
      label: "Quality",
      status:
        meshQualityData
          ? "done"
          : qualityEntry
            ? "done"
            : qualityRequested
              ? "active"
              : "idle",
      detail:
        meshQualityData
          ? `SICN p5 ${meshQualityData.sicnP5.toFixed(3)} · gamma min ${meshQualityData.gammaMin.toFixed(3)}`
          : qualityEntry?.message ??
            (qualityRequested ? "Quality extraction requested for next remesh" : "Quality extraction disabled"),
    },
    {
      id: "readiness",
      label: "Solver Readiness",
      status:
        readinessWarning
          ? "warning"
          : readinessLarge
            ? "active"
            : (nodeCount > 0 || workspaceStatus === "waiting_for_compute" || hasAnyLog(engineLog, ["waiting for compute"]))
              ? "done"
              : "idle",
      detail:
        readinessEntry?.message ??
        (nodeCount > 0
          ? `${nodeCount.toLocaleString()} nodes · est. dense solver RAM ${readinessRamGb.toFixed(1)} GB`
          : "Mesh not ready for solver checks"),
    },
  ];
}
