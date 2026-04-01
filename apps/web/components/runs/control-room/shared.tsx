"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { FemLiveMesh } from "../../../lib/useSessionStream";
import {
  resolveSelectedObjectIdFromModelBuilderGraph,
  resolveSelectedMeshObjectIdFromModelBuilderGraph,
} from "../../../lib/session/modelBuilderGraph";
import type { ModelBuilderGraphV2, ScriptBuilderGeometryEntry } from "../../../lib/session/types";
import type { TreeNodeData } from "../../panels/ModelTree";

export type ViewportMode = "3D" | "2D" | "Mesh" | "Analyze";
export type VectorComponent = "x" | "y" | "z" | "magnitude";
export type PreviewComponent = "3D" | "x" | "y" | "z";
export type SlicePlane = "xy" | "xz" | "yz";
export type FemDockTab = "mesh" | "mesher" | "view" | "quality" | "pipeline";

export interface AntennaOverlayConductor {
  id: string;
  label: string;
  role: "signal" | "ground" | "strip";
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  currentA: number;
}

export interface AntennaOverlay {
  id: string;
  name: string;
  antennaKind: string;
  solver: string;
  conductors: AntennaOverlayConductor[];
}

export interface BuilderObjectOverlay {
  id: string;
  label: string;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

export interface FocusObjectRequest {
  objectId: string;
  revision: number;
}

export type ObjectViewMode = "context" | "isolate";

export interface MeshFaceDetail {
  faceIndex: number;
  nodeIndices: [number, number, number];
  centroid: [number, number, number];
  normal: [number, number, number];
  edgeLengths: [number, number, number];
  perimeter: number;
  area: number;
  aspectRatio: number;
}

export const FEM_SLICE_COUNT = 25;
export const PANEL_SIZES = {
  bodyMainDefault: "78%",
  bodyMainMin: "34%",
  viewportDefault: "72%",
  viewportMin: "24%",
  consoleDefault: "28%",
  consoleMin: "10%",
  consoleMax: "72%",
  femDockDefault: "24%",
  femDockMin: "16%",
  femDockMax: "50%",
  femViewportDefault: "76%",
  femViewportMin: "26%",
  sidebarDefault: "35%",
  sidebarMin: "20%",
  sidebarMax: "50%",
} as const;

export const PREVIEW_EVERY_N_DEFAULT = 10;
export const PREVIEW_EVERY_N_PRESETS = [1, 2, 5, 10, 25, 50, 100] as const;
export const PREVIEW_MAX_POINTS_DEFAULT = 16_384;
export const PREVIEW_MAX_POINTS_PRESETS = [4_096, 16_384, 65_536, 262_144, 1_048_576, 0] as const;

export {
  fmtSI,
  fmtExp,
  fmtStepValue,
  fmtSIOrDash,
  fmtExpOrDash,
  fmtDuration,
  fmtPreviewMaxPoints,
  fmtPreviewEveryN,
} from "../../../lib/format";

export function materializationProgressFromMessage(message: string | null): number {
  if (!message) return 6;
  const lower = message.toLowerCase();
  if (lower.includes("control room bootstrap verified")) return 8;
  if (lower.includes("loading python script")) return 14;
  if (lower.includes("building problemir")) return 22;
  if (lower.includes("preparing fem mesh asset")) return 32;
  if (lower.includes("generating fem mesh from geometry")) return 44;
  if (lower.includes("meshing stl surface")) return 52;
  if (lower.includes("importing stl surface")) return 60;
  if (lower.includes("classifying stl surfaces")) return 70;
  if (lower.includes("creating geometry from classified surfaces")) return 80;
  if (lower.includes("generating 3d tetrahedral mesh")) return 90;
  if (lower.includes("mesh ready") || lower.includes("fem mesh ready")) return 96;
  if (lower.includes("script materialized")) return 100;
  return 12;
}

export function parseStageExecutionMessage(
  message: string | null,
): { current: number; total: number; kind: string } | null {
  if (!message) return null;
  const match = message.match(/executing stage (\d+)\/(\d+) \(([^)]+)\)/i);
  if (!match) return null;
  return {
    current: Number(match[1]),
    total: Number(match[2]),
    kind: match[3],
  };
}

export function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function asVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if ([x, y, z].some((component) => typeof component !== "number")) return null;
  return [x as number, y as number, z as number];
}

export function computeMeshFaceDetail(
  mesh: FemLiveMesh | null,
  faceIndex: number | null,
): MeshFaceDetail | null {
  if (!mesh || faceIndex == null || faceIndex < 0 || faceIndex >= mesh.boundary_faces.length) {
    return null;
  }

  const face = mesh.boundary_faces[faceIndex];
  if (!face) return null;
  const [ia, ib, ic] = face;
  const a = mesh.nodes[ia];
  const b = mesh.nodes[ib];
  const c = mesh.nodes[ic];
  if (!a || !b || !c) return null;

  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const bcx = c[0] - b[0];
  const bcy = c[1] - b[1];
  const bcz = c[2] - b[2];
  const cax = a[0] - c[0];
  const cay = a[1] - c[1];
  const caz = a[2] - c[2];

  const ab = Math.hypot(abx, aby, abz);
  const bc = Math.hypot(bcx, bcy, bcz);
  const ca = Math.hypot(cax, cay, caz);
  const perimeter = ab + bc + ca;
  const halfPerimeter = perimeter / 2;

  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const crossX = aby * acz - abz * acy;
  const crossY = abz * acx - abx * acz;
  const crossZ = abx * acy - aby * acx;
  const crossNorm = Math.hypot(crossX, crossY, crossZ);
  const area = 0.5 * crossNorm;
  const normal: [number, number, number] =
    crossNorm > 1e-30
      ? [crossX / crossNorm, crossY / crossNorm, crossZ / crossNorm]
      : [0, 0, 0];

  const maxEdge = Math.max(ab, bc, ca);
  const inradius = halfPerimeter > 0 ? area / halfPerimeter : 0;
  const aspectRatio = inradius > 1e-18 ? maxEdge / (2 * inradius) : 1;

  return {
    faceIndex,
    nodeIndices: [ia, ib, ic],
    centroid: [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3,
    ],
    normal,
    edgeLengths: [ab, bc, ca],
    perimeter,
    area,
    aspectRatio,
  };
}

export function findTreeNodeById(nodes: TreeNodeData[], id: string | null): TreeNodeData | null {
  if (!id) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findTreeNodeById(node.children ?? [], id);
    if (child) return child;
  }
  return null;
}

export function previewQuantityForTreeNode(id: string): string | null {
  if (id === "antennas" || id.startsWith("ant-")) {
    return "H_ant";
  }
  switch (id) {
    case "phys-llg":
      return "m";
    case "phys-exchange":
      return "H_ex";
    case "phys-demag":
    case "phys-demag-method":
    case "phys-demag-open-bc":
      return "H_demag";
    case "phys-zeeman":
      return "H_ext";
    default:
      return null;
  }
}

export function resolveAntennaNodeName(
  nodeId: string | null | undefined,
  antennaNames: readonly string[],
): string | null {
  if (!nodeId || !nodeId.startsWith("ant-")) {
    return null;
  }
  const orderedNames = [...antennaNames].sort((left, right) => right.length - left.length);
  for (const name of orderedNames) {
    const prefix = `ant-${name}`;
    if (nodeId === prefix || nodeId.startsWith(`${prefix}-`)) {
      return name;
    }
  }
  return null;
}

function isFiniteVec3(value: [number, number, number] | null | undefined): value is [number, number, number] {
  return Boolean(
    value &&
      value.length === 3 &&
      value.every((component) => typeof component === "number" && Number.isFinite(component)),
  );
}

function normalizeBounds(
  boundsMin: [number, number, number] | null,
  boundsMax: [number, number, number] | null,
): { boundsMin: [number, number, number]; boundsMax: [number, number, number] } | null {
  if (!isFiniteVec3(boundsMin) || !isFiniteVec3(boundsMax)) {
    return null;
  }
  const normalizedMin = boundsMin.map((component, index) =>
    Math.min(component, boundsMax[index]),
  ) as [number, number, number];
  const normalizedMax = boundsMin.map((component, index) =>
    Math.max(component, boundsMax[index]),
  ) as [number, number, number];
  if (normalizedMax.some((component, index) => component - normalizedMin[index] <= 0)) {
    return null;
  }
  return { boundsMin: normalizedMin, boundsMax: normalizedMax };
}

export function combineBounds(
  entries: readonly {
    boundsMin: [number, number, number];
    boundsMax: [number, number, number];
  }[],
): { boundsMin: [number, number, number]; boundsMax: [number, number, number] } | null {
  if (entries.length === 0) {
    return null;
  }
  const first = normalizeBounds(entries[0]?.boundsMin ?? null, entries[0]?.boundsMax ?? null);
  if (!first) {
    return null;
  }
  let nextMin = [...first.boundsMin] as [number, number, number];
  let nextMax = [...first.boundsMax] as [number, number, number];
  for (const entry of entries.slice(1)) {
    const normalized = normalizeBounds(entry.boundsMin, entry.boundsMax);
    if (!normalized) {
      continue;
    }
    nextMin = nextMin.map((component, index) =>
      Math.min(component, normalized.boundsMin[index]),
    ) as [number, number, number];
    nextMax = nextMax.map((component, index) =>
      Math.max(component, normalized.boundsMax[index]),
    ) as [number, number, number];
  }
  return { boundsMin: nextMin, boundsMax: nextMax };
}

export function boundsExtent(
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
): [number, number, number] {
  return boundsMin.map((component, index) => boundsMax[index] - component) as [
    number,
    number,
    number,
  ];
}

export function boundsCenter(
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
): [number, number, number] {
  return boundsMin.map((component, index) => 0.5 * (component + boundsMax[index])) as [
    number,
    number,
    number,
  ];
}

export function extractGeometryBoundsFromParams(
  geometry: ScriptBuilderGeometryEntry,
): { boundsMin: [number, number, number]; boundsMax: [number, number, number] } | null {
  const params = geometry.geometry_params ?? {};
  const translateRaw = Array.isArray(params.translate)
    ? params.translate
    : Array.isArray(params.translation)
      ? params.translation
      : null;
  const translation = translateRaw && translateRaw.length === 3
    ? (translateRaw.map((value) => Number(value)) as [number, number, number])
    : null;
  let boundsMin: [number, number, number] | null = null;
  let boundsMax: [number, number, number] | null = null;
  if (geometry.geometry_kind === "Box" && Array.isArray(params.size) && params.size.length === 3) {
    const [sx, sy, sz] = params.size.map((value) => Number(value)) as [number, number, number];
    if ([sx, sy, sz].every((value) => Number.isFinite(value) && value > 0)) {
      boundsMin = [-0.5 * sx, -0.5 * sy, -0.5 * sz];
      boundsMax = [0.5 * sx, 0.5 * sy, 0.5 * sz];
    }
  } else if (geometry.geometry_kind === "Cylinder") {
    const radius = Number(params.radius);
    const height = Number(params.height);
    if (Number.isFinite(radius) && radius > 0 && Number.isFinite(height) && height > 0) {
      boundsMin = [-radius, -radius, -0.5 * height];
      boundsMax = [radius, radius, 0.5 * height];
    }
  } else if (geometry.geometry_kind === "Ellipsoid") {
    const rx = Number(params.rx);
    const ry = Number(params.ry);
    const rz = Number(params.rz);
    if ([rx, ry, rz].every((value) => Number.isFinite(value) && value > 0)) {
      boundsMin = [-rx, -ry, -rz];
      boundsMax = [rx, ry, rz];
    }
  } else if (geometry.geometry_kind === "Ellipse") {
    const rx = Number(params.rx);
    const ry = Number(params.ry);
    const height = Number(params.height);
    if ([rx, ry, height].every((value) => Number.isFinite(value) && value > 0)) {
      boundsMin = [-rx, -ry, -0.5 * height];
      boundsMax = [rx, ry, 0.5 * height];
    }
  }

  if (!boundsMin || !boundsMax) {
    const declaredMin = geometry.bounds_min ?? null;
    const declaredMax = geometry.bounds_max ?? null;
    const normalizedDeclared = normalizeBounds(declaredMin, declaredMax);
    if (!normalizedDeclared) {
      return null;
    }
    boundsMin = normalizedDeclared.boundsMin;
    boundsMax = normalizedDeclared.boundsMax;
  }

  if (translation && translation.every((value) => Number.isFinite(value))) {
    boundsMin = boundsMin.map((component, index) => component + translation[index]) as [number, number, number];
    boundsMax = boundsMax.map((component, index) => component + translation[index]) as [number, number, number];
  }

  return { boundsMin, boundsMax };
}

export function buildObjectOverlays(
  geometries: readonly ScriptBuilderGeometryEntry[],
): BuilderObjectOverlay[] {
  return geometries.flatMap((geometry) => {
    const bounds = extractGeometryBoundsFromParams(geometry);
    if (!bounds) {
      return [];
    }
    return [{
      id: geometry.name,
      label: geometry.name,
      boundsMin: bounds.boundsMin,
      boundsMax: bounds.boundsMax,
    }];
  });
}

export function resolveSelectedObjectId(
  nodeId: string | null | undefined,
  source: ModelBuilderGraphV2 | readonly ScriptBuilderGeometryEntry[] | null | undefined,
): string | null {
  if (!nodeId) {
    return null;
  }
  const modelBuilderGraph =
    source && !Array.isArray(source) ? (source as ModelBuilderGraphV2) : null;
  if (modelBuilderGraph) {
    return resolveSelectedObjectIdFromModelBuilderGraph(modelBuilderGraph, nodeId);
  }
  const geometries = Array.isArray(source) ? source : [];
  const ordered = [...geometries]
    .map((geometry) => geometry.name)
    .sort((left, right) => right.length - left.length);
  for (const name of ordered) {
    const objectPrefix = `obj-${name}`;
    const geoPrefix = `geo-${name}`;
    const regionPrefix = `reg-${name}`;
    const matPrefix = `mat-${name}`;
    const meshPrefix = `${geoPrefix}-mesh`;
    if (
      nodeId === objectPrefix ||
      nodeId.startsWith(`${objectPrefix}-`) ||
      nodeId === geoPrefix ||
      nodeId.startsWith(`${geoPrefix}-`) ||
      nodeId === regionPrefix ||
      nodeId.startsWith(`${regionPrefix}-`) ||
      nodeId === matPrefix ||
      nodeId.startsWith(`${matPrefix}-`) ||
      nodeId === meshPrefix ||
      nodeId.startsWith(`${meshPrefix}-`)
    ) {
      return name;
    }
  }
  if ((nodeId === "geometry" || nodeId === "objects") && geometries.length === 1) {
    return geometries[0]?.name ?? null;
  }
  return null;
}

export function resolveSelectedMeshObjectId(
  nodeId: string | null | undefined,
  source: ModelBuilderGraphV2 | readonly ScriptBuilderGeometryEntry[] | null | undefined,
): string | null {
  if (!nodeId) {
    return null;
  }
  const modelBuilderGraph =
    source && !Array.isArray(source) ? (source as ModelBuilderGraphV2) : null;
  if (modelBuilderGraph) {
    return resolveSelectedMeshObjectIdFromModelBuilderGraph(modelBuilderGraph, nodeId);
  }
  const geometries = Array.isArray(source) ? source : [];
  const ordered = [...geometries]
    .map((geometry) => geometry.name)
    .sort((left, right) => right.length - left.length);
  for (const name of ordered) {
    const meshPrefix = `geo-${name}-mesh`;
    if (nodeId === meshPrefix || nodeId.startsWith(`${meshPrefix}-`)) {
      return name;
    }
  }
  return null;
}

export function Section({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/20 last:border-0">
      <div className="flex items-center gap-2 py-2 px-3 cursor-pointer select-none hover:bg-muted/30 transition-colors" onClick={() => setOpen((v) => !v)}>
        <span className="text-[0.6rem] text-muted-foreground transition-transform data-[open=true]:rotate-90" data-open={open}>▸</span>
        <span className="text-[0.6rem] font-medium uppercase tracking-wider text-foreground mr-auto">{title}</span>
        {badge && <span className="text-[0.6rem] font-mono text-muted-foreground/70 bg-muted/40 px-1.5 py-0.5 rounded">{badge}</span>}
      </div>
      {open && <div className="px-3 pb-3 grid gap-2">{children}</div>}
    </div>
  );
}

export function DockTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="appearance-none border border-border/30 bg-card/20 text-muted-foreground text-[0.6rem] font-medium uppercase tracking-wider rounded-md py-1.5 px-2 cursor-pointer transition-all hover:bg-muted/30 data-[active=true]:bg-primary/15 data-[active=true]:border-primary/40 data-[active=true]:text-primary"
      data-active={active}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
