"use client";

import { useEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  PivotControls,
  TrackballControls,
} from "@react-three/drei";
import HslSphere from "./HslSphere";
import ViewCube from "./ViewCube";
import { cn } from "@/lib/utils";
import { FemGeometry } from "./r3f/FemGeometry";
import { FemArrows } from "./r3f/FemArrows";
import { FemHighlightView } from "./r3f/FemHighlightView";
import { rotateCameraAroundTarget, setCameraPresetAroundTarget, focusCameraOnBounds, fitCameraToBounds } from "./camera/cameraHelpers";
import SceneAxes3D from "./r3f/SceneAxes3D";
import { computeFaceAspectRatios } from "./r3f/colorUtils";
import type {
  FemLiveMeshObjectSegment,
  FemMeshPart,
  MeshQualityStats,
  MeshEntityViewState,
  MeshEntityViewStateMap,
} from "../../lib/session/types";
import type {
  AntennaOverlay,
  BuilderObjectOverlay,
  FocusObjectRequest,
  ObjectViewMode,
} from "../runs/control-room/shared";
import { FieldLegend } from "./field/FieldLegend";

const AIR_OBJECT_SEGMENT_ID = "__air__";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface FemMeshData {
  nodes: number[];
  elements: number[];
  boundaryFaces: number[];
  nNodes: number;
  nElements: number;
  fieldData?: { x: number[]; y: number[]; z: number[]; };
  activeMask?: boolean[] | null;
  quantityDomain?: "magnetic_only" | "full_domain" | "surface_only" | null;
}

export interface MeshSelectionSnapshot {
  selectedFaceIndices: number[];
  primaryFaceIndex: number | null;
}

export type FemColorField = "orientation" | "x" | "y" | "z" | "magnitude" | "quality" | "sicn" | "none";
export type RenderMode = "surface" | "surface+edges" | "wireframe" | "points";
export type ClipAxis = "x" | "y" | "z";

interface Props {
  meshData: FemMeshData;
  colorField?: FemColorField;
  fieldLabel?: string;
  showWireframe?: boolean;
  topologyKey?: string;
  toolbarMode?: "visible" | "hidden";
  renderMode?: RenderMode;
  opacity?: number;
  clipEnabled?: boolean;
  clipAxis?: ClipAxis;
  clipPos?: number;
  showArrows?: boolean;
  showOrientationLegend?: boolean;
  qualityPerFace?: number[] | null;
  shrinkFactor?: number;
  onRenderModeChange?: (value: RenderMode) => void;
  onOpacityChange?: (value: number) => void;
  onClipEnabledChange?: (value: boolean) => void;
  onClipAxisChange?: (value: ClipAxis) => void;
  onClipPosChange?: (value: number) => void;
  onShowArrowsChange?: (value: boolean) => void;
  onShrinkFactorChange?: (value: number) => void;
  onSelectionChange?: (selection: MeshSelectionSnapshot) => void;
  onRefine?: (faceIndices: number[], factor: number) => void;
  antennaOverlays?: AntennaOverlay[];
  selectedAntennaId?: string | null;
  objectOverlays?: BuilderObjectOverlay[];
  selectedObjectId?: string | null;
  selectedEntityId?: string | null;
  focusedEntityId?: string | null;
  objectViewMode?: ObjectViewMode;
  objectSegments?: FemLiveMeshObjectSegment[];
  meshParts?: FemMeshPart[];
  elementMarkers?: number[] | null;
  perDomainQuality?: Record<number, MeshQualityStats> | null;
  meshEntityViewState?: MeshEntityViewStateMap;
  onMeshPartViewStatePatch?: (
    partIds: string[],
    patch: Partial<MeshEntityViewState>,
  ) => void;
  visibleObjectIds?: string[];
  airSegmentVisible?: boolean;
  airSegmentOpacity?: number;
  focusObjectRequest?: FocusObjectRequest | null;
  worldExtent?: [number, number, number] | null;
  worldCenter?: [number, number, number] | null;
  onAntennaTranslate?: (id: string, dx: number, dy: number, dz: number) => void;
  onEntitySelect?: (id: string | null) => void;
  onEntityFocus?: (id: string | null) => void;
}

interface RenderLayer {
  part: FemMeshPart;
  viewState: MeshEntityViewState;
  boundaryFaceIndices: number[] | null;
  elementIndices: number[] | null;
  nodeMask: boolean[] | null;
  surfaceFaces: [number, number, number][] | null;
  isPrimaryForCamera: boolean;
  isMagnetic: boolean;
  isSelected: boolean;
  isDimmed: boolean;
}

type CameraProjection = "perspective" | "orthographic";
type NavigationMode = "trackball" | "cad";

interface PartQualitySummary {
  markers: number[];
  domainCount: number;
  stats: MeshQualityStats | null;
}

function uniqueSortedMarkers(markers: readonly number[]): number[] {
  return Array.from(new Set(markers.filter((value) => Number.isFinite(value) && value >= 0))).sort(
    (left, right) => left - right,
  );
}

function combineMeshQualityStats(statsList: readonly MeshQualityStats[]): MeshQualityStats | null {
  if (statsList.length === 0) {
    return null;
  }
  if (statsList.length === 1) {
    return statsList[0] ?? null;
  }
  const totalElements = statsList.reduce((sum, entry) => sum + Math.max(0, entry.n_elements), 0);
  const weight = (value: (entry: MeshQualityStats) => number) =>
    totalElements > 0
      ? statsList.reduce(
          (sum, entry) => sum + value(entry) * Math.max(0, entry.n_elements),
          0,
        ) / totalElements
      : statsList.reduce((sum, entry) => sum + value(entry), 0) / statsList.length;
  const combineHistogram = (
    extractor: (entry: MeshQualityStats) => number[] | undefined,
  ): number[] | undefined => {
    const base = extractor(statsList[0]);
    if (!base || base.length === 0) {
      return undefined;
    }
    if (!statsList.every((entry) => (extractor(entry)?.length ?? 0) === base.length)) {
      return undefined;
    }
    return base.map((_, index) =>
      statsList.reduce((sum, entry) => sum + (extractor(entry)?.[index] ?? 0), 0),
    );
  };
  return {
    n_elements: totalElements,
    sicn_min: Math.min(...statsList.map((entry) => entry.sicn_min)),
    sicn_max: Math.max(...statsList.map((entry) => entry.sicn_max)),
    sicn_mean: weight((entry) => entry.sicn_mean),
    sicn_p5: Math.min(...statsList.map((entry) => entry.sicn_p5)),
    sicn_histogram: combineHistogram((entry) => entry.sicn_histogram),
    gamma_min: Math.min(...statsList.map((entry) => entry.gamma_min)),
    gamma_mean: weight((entry) => entry.gamma_mean),
    gamma_histogram: combineHistogram((entry) => entry.gamma_histogram),
    volume_min: Math.min(...statsList.map((entry) => entry.volume_min)),
    volume_max: Math.max(...statsList.map((entry) => entry.volume_max)),
    volume_mean: weight((entry) => entry.volume_mean),
    volume_std: weight((entry) => entry.volume_std),
    avg_quality: weight((entry) => entry.avg_quality),
  };
}

function markersForPart(
  part: FemMeshPart,
  elementMarkers: readonly number[] | null | undefined,
): number[] {
  if (!elementMarkers || elementMarkers.length === 0 || part.element_count <= 0) {
    return [];
  }
  const start = Math.max(0, Math.trunc(part.element_start));
  const end = Math.min(elementMarkers.length, start + Math.max(0, Math.trunc(part.element_count)));
  if (start >= end) {
    return [];
  }
  return uniqueSortedMarkers(elementMarkers.slice(start, end));
}

function qualityToneClass(stats: MeshQualityStats | null): string {
  if (!stats) {
    return "border-border/25 bg-background/45 text-muted-foreground";
  }
  if (stats.sicn_p5 >= 0.3 && stats.gamma_min >= 0.1) {
    return "border-emerald-400/25 bg-emerald-500/12 text-emerald-100";
  }
  if (stats.sicn_p5 >= 0.1 && stats.gamma_min >= 0.03) {
    return "border-amber-400/25 bg-amber-500/12 text-amber-100";
  }
  return "border-rose-400/25 bg-rose-500/12 text-rose-100";
}

function qualityLabel(stats: MeshQualityStats | null): string {
  if (!stats) {
    return "No quality";
  }
  if (stats.sicn_p5 >= 0.3 && stats.gamma_min >= 0.1) {
    return "Good";
  }
  if (stats.sicn_p5 >= 0.1 && stats.gamma_min >= 0.03) {
    return "Fair";
  }
  return "Needs review";
}

function collectSegmentBoundaryFaceIndices(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  maxFaceCount: number,
  selectedObjectId?: string | null,
): number[] | null {
  const relevantSegments =
    selectedObjectId
      ? objectSegments.filter((segment) => segment.object_id === selectedObjectId)
      : objectSegments;
  if (relevantSegments.length === 0) {
    return null;
  }
  const faceIndices: number[] = [];
  for (const segment of relevantSegments) {
    const start = Math.max(0, Math.trunc(segment.boundary_face_start));
    const count = Math.max(0, Math.trunc(segment.boundary_face_count));
    const end = Math.min(start + count, maxFaceCount);
    for (let faceIndex = start; faceIndex < end; faceIndex += 1) {
      faceIndices.push(faceIndex);
    }
  }
  if (faceIndices.length === 0 || faceIndices.length >= maxFaceCount) {
    return null;
  }
  return faceIndices;
}

function collectSegmentElementIndices(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  maxElementCount: number,
  selectedObjectId?: string | null,
): number[] | null {
  const relevantSegments =
    selectedObjectId
      ? objectSegments.filter((segment) => segment.object_id === selectedObjectId)
      : objectSegments;
  if (relevantSegments.length === 0) {
    return null;
  }
  const elementIndices: number[] = [];
  for (const segment of relevantSegments) {
    const start = Math.max(0, Math.trunc(segment.element_start));
    const count = Math.max(0, Math.trunc(segment.element_count));
    const end = Math.min(start + count, maxElementCount);
    for (let elementIndex = start; elementIndex < end; elementIndex += 1) {
      elementIndices.push(elementIndex);
    }
  }
  if (elementIndices.length === 0 || elementIndices.length >= maxElementCount) {
    return null;
  }
  return elementIndices;
}

function collectSegmentBoundaryFaceIndicesByIds(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  maxFaceCount: number,
  segmentIds: ReadonlySet<string>,
): number[] | null {
  if (segmentIds.size === 0) {
    return [];
  }
  const relevantSegments = objectSegments.filter((segment) => segmentIds.has(segment.object_id));
  if (relevantSegments.length === 0) {
    return [];
  }
  const faceIndices: number[] = [];
  for (const segment of relevantSegments) {
    const start = Math.max(0, Math.trunc(segment.boundary_face_start));
    const count = Math.max(0, Math.trunc(segment.boundary_face_count));
    const end = Math.min(start + count, maxFaceCount);
    for (let faceIndex = start; faceIndex < end; faceIndex += 1) {
      faceIndices.push(faceIndex);
    }
  }
  if (faceIndices.length === 0) {
    return [];
  }
  if (faceIndices.length >= maxFaceCount) {
    return null;
  }
  return faceIndices;
}

function collectSegmentElementIndicesByIds(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  maxElementCount: number,
  segmentIds: ReadonlySet<string>,
): number[] | null {
  if (segmentIds.size === 0) {
    return [];
  }
  const relevantSegments = objectSegments.filter((segment) => segmentIds.has(segment.object_id));
  if (relevantSegments.length === 0) {
    return [];
  }
  const elementIndices: number[] = [];
  for (const segment of relevantSegments) {
    const start = Math.max(0, Math.trunc(segment.element_start));
    const count = Math.max(0, Math.trunc(segment.element_count));
    const end = Math.min(start + count, maxElementCount);
    for (let elementIndex = start; elementIndex < end; elementIndex += 1) {
      elementIndices.push(elementIndex);
    }
  }
  if (elementIndices.length === 0) {
    return [];
  }
  if (elementIndices.length >= maxElementCount) {
    return null;
  }
  return elementIndices;
}

function collectSegmentNodeMask(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  nNodes: number,
  segmentIds: ReadonlySet<string>,
): boolean[] | null {
  if (segmentIds.size === 0) {
    return null;
  }
  const nodeMask = new Array<boolean>(nNodes).fill(false);
  let sawNode = false;
  for (const segment of objectSegments) {
    if (!segmentIds.has(segment.object_id)) {
      continue;
    }
    const start = Math.max(0, Math.trunc(segment.node_start));
    const count = Math.max(0, Math.trunc(segment.node_count));
    const end = Math.min(start + count, nNodes);
    for (let nodeIndex = start; nodeIndex < end; nodeIndex += 1) {
      nodeMask[nodeIndex] = true;
      sawNode = true;
    }
  }
  return sawNode ? nodeMask : null;
}

function collectPartBoundaryFaceIndices(
  part: FemMeshPart,
  maxFaceCount: number,
): number[] | null {
  if (part.boundary_face_indices.length > 0) {
    return part.boundary_face_indices.filter(
      (faceIndex) => Number.isInteger(faceIndex) && faceIndex >= 0 && faceIndex < maxFaceCount,
    );
  }
  const start = Math.max(0, Math.trunc(part.boundary_face_start));
  const count = Math.max(0, Math.trunc(part.boundary_face_count));
  const end = Math.min(start + count, maxFaceCount);
  const faceIndices: number[] = [];
  for (let faceIndex = start; faceIndex < end; faceIndex += 1) {
    faceIndices.push(faceIndex);
  }
  if (faceIndices.length === 0) {
    return [];
  }
  if (faceIndices.length >= maxFaceCount) {
    return null;
  }
  return faceIndices;
}

function collectPartElementIndices(
  part: FemMeshPart,
  maxElementCount: number,
): number[] | null {
  const start = Math.max(0, Math.trunc(part.element_start));
  const count = Math.max(0, Math.trunc(part.element_count));
  const end = Math.min(start + count, maxElementCount);
  const elementIndices: number[] = [];
  for (let elementIndex = start; elementIndex < end; elementIndex += 1) {
    elementIndices.push(elementIndex);
  }
  if (elementIndices.length === 0) {
    return [];
  }
  if (elementIndices.length >= maxElementCount) {
    return null;
  }
  return elementIndices;
}

function collectPartNodeMask(
  part: FemMeshPart,
  nNodes: number,
): boolean[] | null {
  if (part.node_indices.length > 0) {
    const nodeMask = new Array<boolean>(nNodes).fill(false);
    let sawNode = false;
    for (const nodeIndex of part.node_indices) {
      if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nNodes) {
        continue;
      }
      nodeMask[nodeIndex] = true;
      sawNode = true;
    }
    return sawNode ? nodeMask : null;
  }
  const start = Math.max(0, Math.trunc(part.node_start));
  const count = Math.max(0, Math.trunc(part.node_count));
  const end = Math.min(start + count, nNodes);
  if (start >= end) {
    return null;
  }
  const nodeMask = new Array<boolean>(nNodes).fill(false);
  for (let nodeIndex = start; nodeIndex < end; nodeIndex += 1) {
    nodeMask[nodeIndex] = true;
  }
  return nodeMask;
}

function expandedOverlayBounds(
  overlay: BuilderObjectOverlay,
): { min: [number, number, number]; max: [number, number, number] } | null {
  const extent = [
    overlay.boundsMax[0] - overlay.boundsMin[0],
    overlay.boundsMax[1] - overlay.boundsMin[1],
    overlay.boundsMax[2] - overlay.boundsMin[2],
  ] as const;
  if (extent.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null;
  }
  const tolerance = Math.max(Math.max(...extent) * 0.02, 1e-12);
  return {
    min: [
      overlay.boundsMin[0] - tolerance,
      overlay.boundsMin[1] - tolerance,
      overlay.boundsMin[2] - tolerance,
    ],
    max: [
      overlay.boundsMax[0] + tolerance,
      overlay.boundsMax[1] + tolerance,
      overlay.boundsMax[2] + tolerance,
    ],
  };
}

const RENDER_OPTIONS: { value: RenderMode; label: string; labeledLabel: string }[] = [
  { value: "surface", label: "Surface", labeledLabel: "Surface" },
  { value: "surface+edges", label: "S+E", labeledLabel: "Surface + Edges" },
  { value: "wireframe", label: "Wire", labeledLabel: "Wireframe" },
  { value: "points", label: "Pts", labeledLabel: "Points" },
];

const COLOR_OPTIONS: { value: FemColorField; label: string; labeledLabel: string }[] = [
  { value: "orientation", label: "Ori", labeledLabel: "Orientation" },
  { value: "z", label: "m_z", labeledLabel: "Field Z" },
  { value: "x", label: "m_x", labeledLabel: "Field X" },
  { value: "y", label: "m_y", labeledLabel: "Field Y" },
  { value: "magnitude", label: "|m|", labeledLabel: "|Field|" },
  { value: "quality", label: "Qual", labeledLabel: "Quality AR" },
  { value: "sicn", label: "SICN", labeledLabel: "SICN" },
  { value: "none", label: "—", labeledLabel: "None" },
];

function partRoleTint(role: FemMeshPart["role"]): string {
  switch (role) {
    case "air":
      return "#67e8f9";
    case "interface":
      return "#f59e0b";
    case "outer_boundary":
      return "#c084fc";
    case "magnetic_object":
    default:
      return "#60a5fa";
  }
}

function colorLegendGradient(field: FemColorField): string {
  switch (field) {
    case "x":
    case "y":
    case "z":
      return "linear-gradient(to right, #3b82f6, #f8fafc, #ef4444)";
    case "magnitude":
      return "linear-gradient(to right, #0f172a, #2563eb, #7dd3fc, #f8fafc)";
    case "quality":
    case "sicn":
      return "linear-gradient(to right, #f97316, #facc15, #22c55e)";
    case "orientation":
      return "linear-gradient(to right, #ef4444, #f59e0b, #22c55e, #06b6d4, #8b5cf6)";
    case "none":
    default:
      return "linear-gradient(to right, #334155, #64748b)";
  }
}

function colorLegendLabel(field: FemColorField, fieldLabel?: string): string {
  switch (field) {
    case "orientation":
      return fieldLabel ? `${fieldLabel} orientation` : "orientation";
    case "x":
      return `${fieldLabel ?? "field"} x-component`;
    case "y":
      return `${fieldLabel ?? "field"} y-component`;
    case "z":
      return `${fieldLabel ?? "field"} z-component`;
    case "magnitude":
      return `${fieldLabel ?? "field"} magnitude`;
    case "quality":
      return "face aspect ratio";
    case "sicn":
      return "surface inverse condition number";
    case "none":
    default:
      return "part role";
  }
}

/* ── Global R3F Logic Components ───────────────────────────────────── */

function FemClipPlanes({ enabled, axis, posPercentage, geomSize }: { enabled: boolean; axis: ClipAxis; posPercentage: number; geomSize: [number, number, number] }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = enabled;
    if (!enabled) {
      gl.clippingPlanes = [];
      return;
    }
    const axisSize = axis === "x" ? geomSize[0] : axis === "y" ? geomSize[1] : geomSize[2];
    const pos = ((posPercentage / 100) - 0.5) * axisSize;
    const normal = new THREE.Vector3(axis === "x" ? -1 : 0, axis === "y" ? -1 : 0, axis === "z" ? -1 : 0);
    gl.clippingPlanes = [new THREE.Plane(normal, pos)];
  }, [gl, enabled, axis, posPercentage, geomSize]);
  return null;
}

/** Auto-fit the R3F camera to the geometry bounding sphere whenever maxDim changes. */
function CameraAutoFit({ maxDim, generation }: { maxDim: number; generation: number }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    if (maxDim <= 0 || generation === 0) return;
    fitCameraToBounds(camera, maxDim);
    invalidate();
  }, [camera, invalidate, maxDim, generation]);
  return null;
}

function ViewportCamera({
  projection,
}: {
  projection: CameraProjection;
}) {
  if (projection === "orthographic") {
    return (
      <OrthographicCamera
        makeDefault
        position={[3, 2.4, 3]}
        near={0.0001}
        far={10000}
        zoom={80}
      />
    );
  }
  return (
    <PerspectiveCamera
      makeDefault
      position={[3, 2.4, 3]}
      fov={45}
      near={0.0001}
      far={10000}
    />
  );
}

function SyncedControls({ 
  controlsRefObject,
  viewCubeBridgeRef,
  navigationMode,
}: { 
  controlsRefObject: any,
  viewCubeBridgeRef: any,
  navigationMode: NavigationMode,
}) {
  const { camera } = useThree();
  useEffect(() => {
    viewCubeBridgeRef.current = { camera, controls: controlsRefObject.current };
  }, [camera, controlsRefObject, viewCubeBridgeRef]);
  if (navigationMode === "cad") {
    return (
      <OrbitControls
        ref={controlsRefObject}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.85}
        zoomSpeed={0.85}
        panSpeed={0.9}
        screenSpacePanning
        target={[0, 0, 0]}
      />
    );
  }
  return (
    <TrackballControls
      ref={controlsRefObject}
      rotateSpeed={3}
      zoomSpeed={1.2}
      panSpeed={0.8}
      target={[0, 0, 0]}
    />
  );
}

function antennaOverlayColors(role: AntennaOverlay["conductors"][number]["role"], selected: boolean) {
  if (role === "ground") {
    return selected
      ? { fill: "#67e8f9", wire: "#a5f3fc" }
      : { fill: "#0ea5e9", wire: "#67e8f9" };
  }
  return selected
    ? { fill: "#fb923c", wire: "#fdba74" }
    : { fill: "#f97316", wire: "#fb923c" };
}

function AntennaOverlayMeshes({
  overlays,
  geomCenter,
  selectedAntennaId,
  onAntennaTranslate,
}: {
  overlays: AntennaOverlay[];
  geomCenter: THREE.Vector3;
  selectedAntennaId?: string | null;
  onAntennaTranslate?: (id: string, dx: number, dy: number, dz: number) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  
  return (
    <group>
      {overlays.map((overlay) => {
        const selected = selectedAntennaId === overlay.id;
        const conductors = overlay.conductors.map((conductor) => {
          const size = [
            conductor.boundsMax[0] - conductor.boundsMin[0],
            conductor.boundsMax[1] - conductor.boundsMin[1],
            conductor.boundsMax[2] - conductor.boundsMin[2],
          ] as const;
          if (size.some((value) => value <= 0)) {
            return null;
          }
          const center = [
            0.5 * (conductor.boundsMin[0] + conductor.boundsMax[0]) - geomCenter.x,
            0.5 * (conductor.boundsMin[1] + conductor.boundsMax[1]) - geomCenter.y,
            0.5 * (conductor.boundsMin[2] + conductor.boundsMax[2]) - geomCenter.z,
          ] as const;
          const colors = antennaOverlayColors(conductor.role, selected);
          return (
            <group key={conductor.id}>
              <mesh position={center} renderOrder={8}>
                <boxGeometry args={size} />
                <meshStandardMaterial
                  color={colors.fill}
                  emissive={colors.fill}
                  emissiveIntensity={selected ? 0.35 : 0.18}
                  transparent
                  opacity={selected ? 0.34 : 0.16}
                  depthWrite={false}
                />
              </mesh>
              <mesh position={center} renderOrder={9}>
                <boxGeometry args={size} />
                <meshBasicMaterial
                  color={colors.wire}
                  wireframe
                  transparent
                  opacity={selected ? 0.95 : 0.72}
                  depthWrite={false}
                />
              </mesh>
            </group>
          );
        });

        if (selected && onAntennaTranslate) {
          return (
            <PivotControls
              key={overlay.id}
              depthTest={false}
              lineWidth={2}
              axisColors={["#f87171", "#4ade80", "#60a5fa"]}
              scale={75}
              fixed={true}
              onDragEnd={() => {
                if (groupRef.current) {
                  const p = groupRef.current.position;
                  onAntennaTranslate(overlay.id, p.x, p.y, p.z);
                  groupRef.current.position.set(0, 0, 0);
                }
              }}
            >
              <group ref={groupRef}>{conductors}</group>
            </PivotControls>
          );
        }
        return <group key={overlay.id}>{conductors}</group>;
      })}
    </group>
  );
}

/* ── Component ─────────────────────────────────────────────────────── */

function FemMeshView3DInner({
  meshData,
  colorField = "z",
  fieldLabel,
  toolbarMode = "visible",
  renderMode: controlledRenderMode,
  opacity: controlledOpacity,
  clipEnabled: controlledClipEnabled,
  clipAxis: controlledClipAxis,
  clipPos: controlledClipPos,
  showArrows: controlledShowArrows,
  showOrientationLegend = false,
  qualityPerFace,
  topologyKey,
  shrinkFactor: controlledShrinkFactor,
  onRenderModeChange,
  onOpacityChange,
  onClipEnabledChange,
  onClipAxisChange,
  onClipPosChange,
  onShowArrowsChange,
  onShrinkFactorChange,
  onSelectionChange,
  onRefine,
  antennaOverlays = [],
  selectedAntennaId,
  objectOverlays = [],
  selectedObjectId,
  selectedEntityId = null,
  focusedEntityId = null,
  objectViewMode = "context",
  objectSegments = [],
  meshParts = [],
  elementMarkers = null,
  perDomainQuality = null,
  meshEntityViewState = {},
  onMeshPartViewStatePatch,
  visibleObjectIds,
  airSegmentVisible = true,
  airSegmentOpacity = 28,
  focusObjectRequest = null,
  worldExtent = null,
  worldCenter = null,
  onAntennaTranslate,
  onEntitySelect,
  onEntityFocus,
}: Props) {
  const [internalRenderMode, setInternalRenderMode] = useState<RenderMode>("surface");
  const [field, setField] = useState<FemColorField>(colorField);
  const [internalOpacity, setInternalOpacity] = useState(100);
  const [internalClipEnabled, setInternalClipEnabled] = useState(false);
  const [internalClipAxis, setInternalClipAxis] = useState<ClipAxis>("x");
  const [internalClipPos, setInternalClipPos] = useState(50);
  const [showClipDrop, setShowClipDrop] = useState(false);
  const [internalShowArrows, setInternalShowArrows] = useState(false);
  const [arrowDensity, setArrowDensity] = useState(1200);
  const [internalShrinkFactor, setInternalShrinkFactor] = useState(1);
  const [cameraProjection, setCameraProjection] = useState<CameraProjection>("perspective");
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("trackball");
  const [partExplorerOpen, setPartExplorerOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(true);
  const [labeledMode, setLabeledMode] = useState(false);
  
  const [hoveredFace, setHoveredFace] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; faceIdx: number } | null>(null);
  const [selectedFaces, setSelectedFaces] = useState<number[]>([]);
  
  const [geomCenter, setGeomCenter] = useState<THREE.Vector3>(new THREE.Vector3());
  const [maxDim, setMaxDim] = useState<number>(0);
  const [geomSize, setGeomSize] = useState<[number, number, number]>([1, 1, 1]);
  const [cameraFitGeneration, setCameraFitGeneration] = useState(0);

  const controlsRef = useRef<any>(null);
  const viewCubeSceneRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceARsRef = useRef<Float32Array | null>(null);
  const renderMode = controlledRenderMode ?? internalRenderMode;
  const opacity = controlledOpacity ?? internalOpacity;
  const clipEnabled = controlledClipEnabled ?? internalClipEnabled;
  const clipAxis = controlledClipAxis ?? internalClipAxis;
  const clipPos = controlledClipPos ?? internalClipPos;
  const showArrows = controlledShowArrows ?? internalShowArrows;
  const shrinkFactor = controlledShrinkFactor ?? internalShrinkFactor;
  const hasMeshParts = meshParts.length > 0;
  const magneticSegments = useMemo(
    () => objectSegments.filter((segment) => segment.object_id !== AIR_OBJECT_SEGMENT_ID),
    [objectSegments],
  );
  const visibleMagneticIds = useMemo(() => {
    if (visibleObjectIds && visibleObjectIds.length > 0) {
      return new Set(visibleObjectIds);
    }
    return new Set(magneticSegments.map((segment) => segment.object_id));
  }, [magneticSegments, visibleObjectIds]);
  const airSegmentIds = useMemo(
    () =>
      airSegmentVisible
        ? new Set([AIR_OBJECT_SEGMENT_ID])
        : new Set<string>(),
    [airSegmentVisible],
  );
  const visibleLayers = useMemo<RenderLayer[]>(() => {
    if (!hasMeshParts) {
      return [];
    }
    const layers: RenderLayer[] = [];
    const preferredCameraPartId =
      (focusedEntityId && meshParts.some((part) => part.id === focusedEntityId)
        ? focusedEntityId
        : null)
      ?? (selectedEntityId && meshParts.some((part) => part.id === selectedEntityId)
        ? selectedEntityId
        : null);
    const selectedPart = preferredCameraPartId
      ? meshParts.find((part) => part.id === preferredCameraPartId) ?? null
      : null;
    const selectedAirPartId = selectedPart?.role === "air" ? selectedPart.id : null;
    const selectedObjectIdForHighlight =
      selectedObjectId
      ?? (selectedPart?.role === "magnetic_object" ? selectedPart.object_id : null)
      ?? null;
    const hasSelection = Boolean(selectedAirPartId || selectedObjectIdForHighlight || preferredCameraPartId);
    for (const part of meshParts) {
      const defaultViewState: MeshEntityViewState = {
        visible: true,
        renderMode:
          part.role === "air"
            ? "wireframe"
            : part.role === "outer_boundary"
              ? "surface+edges"
              : "surface+edges",
        opacity:
          part.role === "air" ? 28 : part.role === "outer_boundary" ? 46 : part.role === "interface" ? 88 : 100,
        colorField:
          part.role === "magnetic_object" ? "orientation" : "none",
      };
      const baseViewState = meshEntityViewState[part.id] ?? defaultViewState;
      const isSelected =
        selectedAirPartId != null
          ? part.id === selectedAirPartId
          : selectedObjectIdForHighlight != null
            ? part.object_id === selectedObjectIdForHighlight
            : preferredCameraPartId != null
              ? part.id === preferredCameraPartId
              : false;
      const isDimmed = hasSelection && !isSelected && objectViewMode === "context";
      const viewState: MeshEntityViewState = {
        ...baseViewState,
        renderMode:
          isSelected &&
          part.role !== "air" &&
          baseViewState.renderMode === "surface"
            ? "surface+edges"
            : baseViewState.renderMode,
        opacity: isDimmed
          ? Math.min(baseViewState.opacity, part.role === "air" ? 8 : 14)
          : isSelected
            ? Math.max(baseViewState.opacity, part.role === "air" ? 52 : 96)
            : baseViewState.opacity,
      };
      const visibleForMode =
        objectViewMode === "isolate" && hasSelection ? isSelected : viewState.visible;
      if (!visibleForMode) {
        continue;
      }
      layers.push({
        part,
        viewState,
        boundaryFaceIndices: collectPartBoundaryFaceIndices(
          part,
          Math.floor(meshData.boundaryFaces.length / 3),
        ),
        elementIndices: collectPartElementIndices(part, meshData.nElements),
        nodeMask: collectPartNodeMask(part, meshData.nNodes),
        surfaceFaces: part.surface_faces.length > 0 ? part.surface_faces : null,
        isPrimaryForCamera: preferredCameraPartId
          ? part.id === preferredCameraPartId
          : false,
        isMagnetic: part.role === "magnetic_object",
        isSelected,
        isDimmed,
      });
    }
    if (layers.length > 0 && !layers.some((layer) => layer.isPrimaryForCamera)) {
      layers[0] = { ...layers[0], isPrimaryForCamera: true };
    }
    return layers;
  }, [
    focusedEntityId,
    hasMeshParts,
    meshData.boundaryFaces.length,
    meshData.nElements,
    meshData.nNodes,
    meshEntityViewState,
    meshParts,
    objectViewMode,
    selectedEntityId,
    selectedObjectId,
  ]);
  const partExplorerGroups = useMemo(
    () => [
      {
        label: "Magnetic",
        parts: meshParts.filter((part) => part.role === "magnetic_object"),
      },
      {
        label: "Interfaces",
        parts: meshParts.filter((part) => part.role === "interface"),
      },
      {
        label: "Boundary",
        parts: meshParts.filter((part) => part.role === "outer_boundary"),
      },
      {
        label: "Air",
        parts: meshParts.filter((part) => part.role === "air"),
      },
    ].filter((group) => group.parts.length > 0),
    [meshParts],
  );
  const selectedMeshPart = useMemo(
    () => meshParts.find((part) => part.id === selectedEntityId) ?? null,
    [meshParts, selectedEntityId],
  );
  const partQualityById = useMemo(() => {
    const entries = new Map<string, PartQualitySummary>();
    for (const part of meshParts) {
      const markers = markersForPart(part, elementMarkers);
      const qualityEntries = markers
        .map((marker) => perDomainQuality?.[marker] ?? null)
        .filter((entry): entry is MeshQualityStats => Boolean(entry));
      entries.set(part.id, {
        markers,
        domainCount: qualityEntries.length,
        stats: combineMeshQualityStats(qualityEntries),
      });
    }
    return entries;
  }, [elementMarkers, meshParts, perDomainQuality]);
  const inspectedMeshPart = useMemo(() => {
    if (selectedMeshPart) {
      return selectedMeshPart;
    }
    if (objectViewMode === "isolate" && selectedObjectId) {
      return (
        meshParts.find(
          (part) => part.role === "magnetic_object" && part.object_id === selectedObjectId,
        ) ?? null
      );
    }
    return null;
  }, [meshParts, objectViewMode, selectedMeshPart, selectedObjectId]);
  const inspectedPartQuality = useMemo(
    () => (inspectedMeshPart ? partQualityById.get(inspectedMeshPart.id) ?? null : null),
    [inspectedMeshPart, partQualityById],
  );
  const roleVisibilitySummary = useMemo(
    () => {
      const summary: Array<{
        role: FemMeshPart["role"];
        label: string;
        total: number;
        visible: number;
      }> = [];
      for (const [role, label] of [
        ["air", "Air"],
        ["magnetic_object", "Objects"],
        ["interface", "Interfaces"],
        ["outer_boundary", "Boundary"],
      ] as const) {
        const parts = meshParts.filter((part) => part.role === role);
        if (parts.length === 0) {
          continue;
        }
        const visible = parts.filter((part) => meshEntityViewState[part.id]?.visible ?? true).length;
        summary.push({ role, label, total: parts.length, visible });
      }
      return summary;
    },
    [meshEntityViewState, meshParts],
  );
  const missingMagneticMask =
    meshData.quantityDomain === "magnetic_only" &&
    (!meshData.activeMask || meshData.activeMask.length !== meshData.nNodes);
  const missingExactScopeSegment =
    Boolean(selectedObjectId) &&
    meshData.nElements > 0 &&
    (hasMeshParts
      ? !meshParts.some(
          (part) => part.role === "magnetic_object" && part.object_id === selectedObjectId,
        )
      : !magneticSegments.some((segment) => segment.object_id === selectedObjectId));
  const magneticBoundaryFaceIndices = useMemo(() => {
    if (missingExactScopeSegment) {
      return null;
    }
    if (selectedObjectId) {
      return collectSegmentBoundaryFaceIndices(
        magneticSegments,
        Math.floor(meshData.boundaryFaces.length / 3),
        selectedObjectId,
      );
    }
    return collectSegmentBoundaryFaceIndicesByIds(
      magneticSegments,
      Math.floor(meshData.boundaryFaces.length / 3),
      visibleMagneticIds,
    );
  }, [
    magneticSegments,
    meshData.boundaryFaces.length,
    missingExactScopeSegment,
    selectedObjectId,
    visibleMagneticIds,
  ]);
  const magneticElementIndices = useMemo(() => {
    if (missingExactScopeSegment) {
      return null;
    }
    if (selectedObjectId) {
      return collectSegmentElementIndices(
        magneticSegments,
        meshData.nElements,
        selectedObjectId,
      );
    }
    return collectSegmentElementIndicesByIds(
      magneticSegments,
      meshData.nElements,
      visibleMagneticIds,
    );
  }, [
    magneticSegments,
    meshData.nElements,
    missingExactScopeSegment,
    selectedObjectId,
    visibleMagneticIds,
  ]);
  const airBoundaryFaceIndices = useMemo(
    () =>
      collectSegmentBoundaryFaceIndicesByIds(
        objectSegments,
        Math.floor(meshData.boundaryFaces.length / 3),
        airSegmentIds,
      ),
    [airSegmentIds, meshData.boundaryFaces.length, objectSegments],
  );
  const airElementIndices = useMemo(
    () => collectSegmentElementIndicesByIds(objectSegments, meshData.nElements, airSegmentIds),
    [airSegmentIds, meshData.nElements, objectSegments],
  );
  const magneticArrowNodeMask = useMemo(() => {
    if (hasMeshParts) {
      const visibleMagneticLayers = visibleLayers.filter((layer) => layer.isMagnetic);
      if (visibleMagneticLayers.length === 0) {
        return meshData.activeMask ?? null;
      }
      const baseActiveMask = meshData.activeMask;
      const combined = new Array<boolean>(meshData.nNodes).fill(false);
      for (const layer of visibleMagneticLayers) {
        const nodeMask = layer.nodeMask;
        if (!nodeMask) {
          continue;
        }
        for (let index = 0; index < nodeMask.length; index += 1) {
          combined[index] = combined[index] || nodeMask[index];
        }
      }
      if (!baseActiveMask || baseActiveMask.length !== meshData.nNodes) {
        return combined;
      }
      return combined.map((visible, index) => visible && baseActiveMask[index]);
    }
    const nodeMask = collectSegmentNodeMask(magneticSegments, meshData.nNodes, visibleMagneticIds);
    if (!nodeMask) {
      return meshData.activeMask ?? null;
    }
    const baseActiveMask = meshData.activeMask;
    if (!baseActiveMask || baseActiveMask.length !== meshData.nNodes) {
      return nodeMask;
    }
    return nodeMask.map((visible, index) => visible && baseActiveMask[index]);
  }, [
    hasMeshParts,
    magneticSegments,
    meshData.activeMask,
    meshData.nNodes,
    visibleLayers,
    visibleMagneticIds,
  ]);
  const hasMagneticDisplayContent = useMemo(() => {
    if (missingExactScopeSegment) {
      return false;
    }
    const faceCount =
      magneticBoundaryFaceIndices == null
        ? Math.floor(meshData.boundaryFaces.length / 3)
        : magneticBoundaryFaceIndices.length;
    const elementCount =
      magneticElementIndices == null ? meshData.nElements : magneticElementIndices.length;
    return faceCount > 0 || elementCount > 0;
  }, [
    magneticBoundaryFaceIndices,
    magneticElementIndices,
    meshData.boundaryFaces.length,
    meshData.nElements,
    missingExactScopeSegment,
  ]);
  const hasAirDisplayContent = useMemo(() => {
    const faceCount =
      airBoundaryFaceIndices == null
        ? Math.floor(meshData.boundaryFaces.length / 3)
        : airBoundaryFaceIndices.length;
    const elementCount = airElementIndices == null ? meshData.nElements : airElementIndices.length;
    return faceCount > 0 || elementCount > 0;
  }, [airBoundaryFaceIndices, airElementIndices, meshData.boundaryFaces.length, meshData.nElements]);
  const shouldRenderMagneticGeometry =
    !hasMeshParts &&
    !missingExactScopeSegment &&
    (selectedObjectId != null || visibleMagneticIds.size > 0) &&
    hasMagneticDisplayContent;
  const shouldRenderAirGeometry =
    !hasMeshParts &&
    !selectedObjectId &&
    airSegmentVisible &&
    airSegmentIds.size > 0 &&
    hasAirDisplayContent;
  
  const topologySignature = topologyKey ?? `${meshData.nNodes}:${meshData.nElements}:${meshData.boundaryFaces.length}`;
  const toolbarStylePartIds = useMemo(() => {
    if (!hasMeshParts) {
      return [] as string[];
    }
    const selectedLayerIds = visibleLayers
      .filter((layer) => layer.isSelected)
      .map((layer) => layer.part.id);
    if (selectedLayerIds.length > 0) {
      return selectedLayerIds;
    }
    return visibleLayers.map((layer) => layer.part.id);
  }, [hasMeshParts, visibleLayers]);
  const toolbarColorPartIds = useMemo(() => {
    if (!hasMeshParts) {
      return [] as string[];
    }
    const magneticIds = visibleLayers
      .filter(
        (layer) =>
          toolbarStylePartIds.includes(layer.part.id) && layer.part.role === "magnetic_object",
      )
      .map((layer) => layer.part.id);
    return magneticIds.length > 0 ? magneticIds : toolbarStylePartIds;
  }, [hasMeshParts, toolbarStylePartIds, visibleLayers]);
  const toolbarRenderMode = useMemo(() => {
    if (!hasMeshParts || toolbarStylePartIds.length === 0) {
      return renderMode;
    }
    const targetLayers = visibleLayers.filter((layer) => toolbarStylePartIds.includes(layer.part.id));
    const values = Array.from(new Set(targetLayers.map((layer) => layer.viewState.renderMode)));
    return values[0] ?? renderMode;
  }, [hasMeshParts, renderMode, toolbarStylePartIds, visibleLayers]);
  const toolbarOpacity = useMemo(() => {
    if (!hasMeshParts || toolbarStylePartIds.length === 0) {
      return opacity;
    }
    const targetLayer = visibleLayers.find((layer) => toolbarStylePartIds.includes(layer.part.id));
    return targetLayer?.viewState.opacity ?? opacity;
  }, [hasMeshParts, opacity, toolbarStylePartIds, visibleLayers]);
  const toolbarColorField = useMemo(() => {
    if (!hasMeshParts || toolbarColorPartIds.length === 0) {
      return field;
    }
    const targetLayers = visibleLayers.filter((layer) => toolbarColorPartIds.includes(layer.part.id));
    const values = Array.from(new Set(targetLayers.map((layer) => layer.viewState.colorField)));
    return values[0] ?? field;
  }, [field, hasMeshParts, toolbarColorPartIds, visibleLayers]);
  const effectiveOpacity = opacity;
  const arrowField = hasMeshParts
    ? (visibleLayers.find((layer) => layer.isMagnetic)?.viewState.colorField ?? field)
    : field;
  const legendField = hasMeshParts
    ? (visibleLayers.find((layer) => layer.isSelected)?.viewState.colorField
      ?? visibleLayers.find((layer) => layer.isMagnetic)?.viewState.colorField
      ?? toolbarColorField)
    : toolbarColorField;
  const effectiveShowArrows =
    showArrows &&
    !missingMagneticMask &&
    (hasMeshParts
      ? visibleLayers.some((layer) => layer.isMagnetic)
      : shouldRenderMagneticGeometry);
  const fieldMagnitudeStats = useMemo(() => {
    if ((legendField === "quality" || legendField === "sicn") && qualityPerFace && qualityPerFace.length > 0) {
      const values = qualityPerFace.filter((value) => Number.isFinite(value));
      if (values.length === 0) {
        return null;
      }
      const sum = values.reduce((acc, value) => acc + value, 0);
      return {
        min: Math.min(...values),
        max: Math.max(...values),
        mean: sum / values.length,
      };
    }
    if (!meshData.fieldData || meshData.nNodes === 0) {
      return null;
    }
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    for (let index = 0; index < meshData.nNodes; index += 1) {
      const x = meshData.fieldData.x[index] ?? 0;
      const y = meshData.fieldData.y[index] ?? 0;
      const z = meshData.fieldData.z[index] ?? 0;
      const value =
        legendField === "x" ? x
          : legendField === "y" ? y
          : legendField === "z" ? z
          : legendField === "magnitude" || legendField === "orientation"
            ? Math.hypot(x, y, z)
            : 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return null;
    }
    return { min, max, mean: sum / meshData.nNodes };
  }, [legendField, meshData.fieldData, meshData.nNodes, qualityPerFace]);

  useEffect(() => { setField(colorField); }, [colorField]);
  useEffect(() => {
    setSelectedFaces([]); setHoveredFace(null); setCtxMenu(null);
    faceARsRef.current = null;
    // Note: Camera auto-fit is now handled in handleGeometryCenter based on physical bounds, 
    // not purely on node counts, to prevent camera resets during remeshing operations.
  }, [topologySignature]);

  useEffect(() => {
    onSelectionChange?.({
      selectedFaceIndices: selectedFaces,
      primaryFaceIndex: selectedFaces.length > 0 ? selectedFaces[selectedFaces.length - 1] : null,
    });
  }, [onSelectionChange, selectedFaces]);

  // Click & Raycast handlers
  const handleFaceHover = useCallback((e: any) => {
    if (e.faceIndex != null) setHoveredFace({ idx: e.faceIndex, x: e.clientX, y: e.clientY });
  }, []);
  const handleFaceUnhover = useCallback(() => setHoveredFace(null), []);
  const handleFaceClick = useCallback((e: any) => {
    if (e.button !== 0 || e.faceIndex == null) return;
    e.stopPropagation();
    const fIdx = e.faceIndex;
    setSelectedFaces((prev) => {
      if (e.shiftKey || e.ctrlKey) return prev.includes(fIdx) ? prev.filter((i) => i !== fIdx) : [...prev, fIdx];
      if (prev.length === 1 && prev[0] === fIdx) return [];
      return [fIdx];
    });
  }, []);
  const handleFaceContextMenu = useCallback((e: any) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    e?.nativeEvent?.preventDefault?.();
    if (e.faceIndex != null) setCtxMenu({ x: e.clientX, y: e.clientY, faceIdx: e.faceIndex });
  }, []);
  const dismissCtxMenu = useCallback(() => setCtxMenu(null), []);

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = () => setCtxMenu(null);
    window.addEventListener("click", dismiss, { once: true });
    return () => window.removeEventListener("click", dismiss);
  }, [ctxMenu]);

  const lastFittedGeomRef = useRef<string | null>(null);
  const partFocused = hasMeshParts && visibleLayers.length <= 1;
  const axesWorldExtent = useMemo<[number, number, number]>(() => {
    if (partFocused) {
      return geomSize;
    }
    if (
      worldExtent &&
      worldExtent.every((component) => Number.isFinite(component) && component > 0)
    ) {
      return worldExtent;
    }
    return geomSize;
  }, [geomSize, partFocused, worldExtent]);
  const axesCenter = useMemo<[number, number, number]>(() => {
    if (partFocused) {
      return [0, 0, 0];
    }
    if (
      worldCenter &&
      worldCenter.every((component) => Number.isFinite(component))
    ) {
      return [
        worldCenter[0] - geomCenter.x,
        worldCenter[1] - geomCenter.y,
        worldCenter[2] - geomCenter.z,
      ];
    }
    return [0, 0, 0];
  }, [geomCenter.x, geomCenter.y, geomCenter.z, partFocused, worldCenter]);
  const sceneMaxDim = useMemo(
    () => Math.max(maxDim, axesWorldExtent[0], axesWorldExtent[1], axesWorldExtent[2]),
    [axesWorldExtent, maxDim],
  );

  const handleGeometryCenter = useCallback((c: THREE.Vector3, m: number, s: THREE.Vector3) => {
    setGeomCenter(c); setMaxDim(m); setGeomSize([s.x, s.y, s.z]);
    
    // Create a stable signature based on the bounding box dimensions and center, rounded to 4 decimals.
    // This ensures that remeshing the EXACT SAME physical geometry does not reset the camera.
    const sig = `${m.toFixed(4)}_${c.x.toFixed(4)}_${c.y.toFixed(4)}_${c.z.toFixed(4)}`;
    if (lastFittedGeomRef.current !== sig) {
      lastFittedGeomRef.current = sig;
      setCameraFitGeneration((g) => g + 1);
    }
  }, []);

  const setCameraPreset = useCallback((view: "reset" | "front" | "top" | "right") => {
    const bridge = viewCubeSceneRef.current;
    if (!bridge?.camera || !bridge?.controls) return;
    setCameraPresetAroundTarget(bridge.camera, bridge.controls, view, sceneMaxDim * 2);
  }, [sceneMaxDim]);

  const focusObject = useCallback((objectId: string) => {
    const overlay = objectOverlays.find((candidate) => candidate.id === objectId);
    const bridge = viewCubeSceneRef.current;
    if (!overlay || !bridge?.camera || !bridge?.controls) return;
    focusCameraOnBounds(bridge.camera, bridge.controls, {
      min: [
        overlay.boundsMin[0] - geomCenter.x,
        overlay.boundsMin[1] - geomCenter.y,
        overlay.boundsMin[2] - geomCenter.z,
      ],
      max: [
        overlay.boundsMax[0] - geomCenter.x,
        overlay.boundsMax[1] - geomCenter.y,
        overlay.boundsMax[2] - geomCenter.z,
      ],
    }, { fallbackMinRadius: sceneMaxDim * 0.05 });
  }, [geomCenter, objectOverlays, sceneMaxDim]);

  useEffect(() => {
    if (!focusObjectRequest) {
      return;
    }
    focusObject(focusObjectRequest.objectId);
  }, [focusObject, focusObjectRequest]);

  const handleViewCubeRotate = useCallback((quat: THREE.Quaternion) => {
    const bridge = viewCubeSceneRef.current;
    if (!bridge?.camera || !bridge?.controls) return;
    rotateCameraAroundTarget(bridge.camera, bridge.controls, quat);
  }, []);

  const takeScreenshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `fem-mesh-${Date.now()}.png`;
    a.click();
  }, []);

  // Pre-compute face aspect ratios when topology changes (fix #7: no first-hover jank)
  useEffect(() => {
    faceARsRef.current = computeFaceAspectRatios(meshData.nodes, meshData.boundaryFaces);
  }, [topologySignature, meshData.nodes, meshData.boundaryFaces]);

  const hoveredFaceInfo = useMemo(() => {
    if (!hoveredFace) return null;
    const idx = hoveredFace.idx;
    const ar = faceARsRef.current ? faceARsRef.current[idx] : 0;
    return { faceIdx: idx, ar, sicn: qualityPerFace?.[idx] };
  }, [hoveredFace, qualityPerFace]);
  const applyToolbarRenderMode = useCallback((next: RenderMode) => {
    if (hasMeshParts && toolbarStylePartIds.length > 0 && onMeshPartViewStatePatch) {
      onMeshPartViewStatePatch(toolbarStylePartIds, { renderMode: next });
      return;
    }
    onRenderModeChange ? onRenderModeChange(next) : setInternalRenderMode(next);
  }, [hasMeshParts, onMeshPartViewStatePatch, onRenderModeChange, toolbarStylePartIds]);
  const applyToolbarOpacity = useCallback((next: number) => {
    if (hasMeshParts && toolbarStylePartIds.length > 0 && onMeshPartViewStatePatch) {
      onMeshPartViewStatePatch(toolbarStylePartIds, { opacity: next });
      return;
    }
    onOpacityChange ? onOpacityChange(next) : setInternalOpacity(next);
  }, [hasMeshParts, onMeshPartViewStatePatch, onOpacityChange, toolbarStylePartIds]);
  const applyToolbarColorField = useCallback((next: FemColorField) => {
    if (hasMeshParts && toolbarColorPartIds.length > 0 && onMeshPartViewStatePatch) {
      onMeshPartViewStatePatch(toolbarColorPartIds, { colorField: next });
      return;
    }
    setField(next);
  }, [hasMeshParts, onMeshPartViewStatePatch, toolbarColorPartIds]);
  const patchSinglePart = useCallback((partId: string, patch: Partial<MeshEntityViewState>) => {
    onMeshPartViewStatePatch?.([partId], patch);
  }, [onMeshPartViewStatePatch]);
  const handlePartSelect = useCallback((partId: string) => {
    onEntitySelect?.(partId);
    onEntityFocus?.(partId);
  }, [onEntityFocus, onEntitySelect]);
  const handleRoleVisibility = useCallback((role: FemMeshPart["role"], visible: boolean) => {
    if (!onMeshPartViewStatePatch) {
      return;
    }
    const ids = meshParts.filter((part) => part.role === role).map((part) => part.id);
    onMeshPartViewStatePatch(ids, { visible });
  }, [meshParts, onMeshPartViewStatePatch]);
  return (
    <div className="relative flex flex-1 w-[100%] h-[100%] min-w-0 min-h-0 bg-background overflow-hidden rounded-md fem-canvas-container">
      <Canvas
        gl={{ antialias: true, preserveDrawingBuffer: true, localClippingEnabled: true }}
        onPointerMissed={() => setSelectedFaces([])}
        onContextMenu={(e) => e.preventDefault()}
        onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}
      >
        <ViewportCamera projection={cameraProjection} />
        <color attach="background" args={[0x1e1e2e]} /> {/* Catppuccin Mocha Base */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[1, 2, 3]} intensity={0.9} />
        <directionalLight position={[-1, -1, -2]} intensity={0.3} color={0x6688cc} />
        
        <CameraAutoFit maxDim={sceneMaxDim} generation={cameraFitGeneration} />

        <FemClipPlanes enabled={clipEnabled} axis={clipAxis} posPercentage={clipPos} geomSize={geomSize} />
        
        {!missingExactScopeSegment ? (
          <>
            {hasMeshParts
              ? visibleLayers.map((layer) => (
                  <FemGeometry
                    key={layer.part.id}
                    meshData={meshData}
                    field={layer.viewState.colorField}
                    renderMode={layer.viewState.renderMode}
                    opacity={layer.viewState.opacity}
                    customBoundaryFaces={layer.surfaceFaces}
                    displayBoundaryFaceIndices={layer.boundaryFaceIndices}
                    displayElementIndices={layer.elementIndices}
                    qualityPerFace={qualityPerFace}
                    shrinkFactor={shrinkFactor}
                    clipEnabled={clipEnabled}
                    clipAxis={clipAxis}
                    clipPos={clipPos}
                    onGeometryCenter={layer.isPrimaryForCamera ? handleGeometryCenter : undefined}
                    onFaceClick={handleFaceClick}
                    onFaceHover={handleFaceHover}
                    onFaceUnhover={handleFaceUnhover}
                    onFaceContextMenu={handleFaceContextMenu}
                  />
                ))
              : null}
            {!hasMeshParts && shouldRenderAirGeometry ? (
              <FemGeometry
                meshData={meshData}
                field={"none"}
                renderMode={renderMode}
                opacity={airSegmentOpacity}
                displayBoundaryFaceIndices={airBoundaryFaceIndices}
                displayElementIndices={airElementIndices}
                qualityPerFace={qualityPerFace}
                shrinkFactor={shrinkFactor}
                clipEnabled={clipEnabled}
                clipAxis={clipAxis}
                clipPos={clipPos}
                onGeometryCenter={handleGeometryCenter}
                onFaceClick={handleFaceClick}
                onFaceHover={handleFaceHover}
                onFaceUnhover={handleFaceUnhover}
                onFaceContextMenu={handleFaceContextMenu}
              />
            ) : null}
            {!hasMeshParts && shouldRenderMagneticGeometry ? (
              <FemGeometry
                meshData={meshData}
                field={field}
                renderMode={renderMode}
                opacity={effectiveOpacity}
                displayBoundaryFaceIndices={magneticBoundaryFaceIndices}
                displayElementIndices={magneticElementIndices}
                qualityPerFace={qualityPerFace}
                shrinkFactor={shrinkFactor}
                clipEnabled={clipEnabled}
                clipAxis={clipAxis}
                clipPos={clipPos}
                onGeometryCenter={!shouldRenderAirGeometry ? handleGeometryCenter : undefined}
                onFaceClick={handleFaceClick}
                onFaceHover={handleFaceHover}
                onFaceUnhover={handleFaceUnhover}
                onFaceContextMenu={handleFaceContextMenu}
              />
            ) : null}
            <FemArrows
              meshData={meshData}
              field={arrowField}
              arrowDensity={arrowDensity}
              center={geomCenter}
              maxDim={maxDim}
              visible={effectiveShowArrows}
              activeNodeMask={magneticArrowNodeMask}
              boundaryFaceIndices={magneticBoundaryFaceIndices}
            />
            <FemHighlightView meshData={meshData} selectedFaces={selectedFaces} center={geomCenter} />
          </>
        ) : null}
        {antennaOverlays.length > 0 && !partFocused ? (
          <AntennaOverlayMeshes
            overlays={antennaOverlays}
            geomCenter={geomCenter}
            selectedAntennaId={selectedAntennaId}
            onAntennaTranslate={onAntennaTranslate}
          />
        ) : null}
        <SceneAxes3D worldExtent={axesWorldExtent} center={axesCenter} sceneScale={[1, 1, 1]} />
        
        <SyncedControls
          controlsRefObject={controlsRef}
          viewCubeBridgeRef={viewCubeSceneRef}
          navigationMode={navigationMode}
        />
      </Canvas>
      {missingExactScopeSegment && selectedObjectId ? (
        <div className="pointer-events-none absolute inset-x-4 top-16 z-20 rounded-xl border border-rose-400/25 bg-background/85 px-4 py-3 text-sm text-rose-200 shadow-lg backdrop-blur-md">
          Object mesh segmentation unavailable for shared-domain FEM: `{selectedObjectId}`
        </div>
      ) : null}
      {missingMagneticMask ? (
        <div className="pointer-events-none absolute inset-x-4 top-16 z-20 rounded-xl border border-amber-400/25 bg-background/85 px-4 py-3 text-sm text-amber-100 shadow-lg backdrop-blur-md">
          Magnetic-region preview mask unavailable for quantity `{fieldLabel ?? "m"}`.
        </div>
      ) : null}

      {/* ─── Toolbar ────────────────────────────────── */}
      {toolbarMode !== "hidden" && (
        <div className="absolute top-2 left-2 right-2 flex flex-wrap items-center gap-1 z-10 pointer-events-none [&>*]:pointer-events-auto">
          {/* Render mode */}
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground px-1 select-none">Render</span>
            {RENDER_OPTIONS.map((opt) => (
              <button key={opt.value} className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors leading-[1.35] hover:bg-muted/50 hover:text-foreground data-[active=true]:bg-primary/20 data-[active=true]:text-primary" data-active={toolbarRenderMode === opt.value} title={opt.labeledLabel} onClick={() => applyToolbarRenderMode(opt.value)}>{labeledMode ? opt.labeledLabel : opt.label}</button>
            ))}
          </div>
          {/* Color field */}
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground px-1 select-none">Color</span>
            {COLOR_OPTIONS.map((opt) => (
              <button key={opt.value} className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors leading-[1.35] hover:bg-muted/50 hover:text-foreground data-[active=true]:bg-primary/20 data-[active=true]:text-primary" data-active={toolbarColorField === opt.value} title={opt.labeledLabel} onClick={() => applyToolbarColorField(opt.value)}>{labeledMode ? opt.labeledLabel : opt.label}</button>
            ))}
          </div>
          {/* Clip */}
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50 relative">
            <button className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors leading-[1.35] hover:bg-muted/50 hover:text-foreground data-[active=true]:bg-primary/20 data-[active=true]:text-primary" data-active={clipEnabled} onClick={() => { const v = !clipEnabled; onClipEnabledChange ? onClipEnabledChange(v) : setInternalClipEnabled(v); if (v) setShowClipDrop(true); }}>✂ Clip</button>
            {clipEnabled && <button className="appearance-none border-none bg-transparent text-muted-foreground font-semibold px-1.5 py-1 rounded cursor-pointer transition-colors leading-none text-base hover:bg-muted/50" onClick={() => setShowClipDrop((v) => !v)}>▾</button>}
            {showClipDrop && clipEnabled && (
              <div className="absolute top-[calc(100%+0.35rem)] left-0 min-w-[200px] p-2.5 rounded-md bg-popover/95 backdrop-blur-md border border-border/50 shadow-lg z-20 grid gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[0.65rem] font-semibold text-muted-foreground min-w-[48px] uppercase tracking-widest">Axis</span>
                  {(["x","y","z"] as ClipAxis[]).map(a => <button key={a} className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-1.5 py-1 rounded cursor-pointer transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary" data-active={clipAxis === a} onClick={() => onClipAxisChange ? onClipAxisChange(a) : setInternalClipAxis(a)}>{a.toUpperCase()}</button>)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[0.65rem] font-semibold text-muted-foreground min-w-[48px] uppercase tracking-widest">Pos</span>
                  <input type="range" className="flex-1 h-[3px] accent-primary" min={0} max={100} value={clipPos} onChange={(e) => { const v = Number(e.target.value); onClipPosChange ? onClipPosChange(v) : setInternalClipPos(v); }} />
                </div>
                <button className="text-muted-foreground/70 text-[0.64rem] font-semibold uppercase tracking-widest hover:bg-muted/50" onClick={() => setShowClipDrop(false)}>Close</button>
              </div>
            )}
          </div>
          {/* Opacity */}
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground px-1 select-none">Opac</span>
            <input type="range" className="w-[50px] h-[3px] accent-primary" min={10} max={100} value={toolbarOpacity} onChange={(e) => { const v = Number(e.target.value); applyToolbarOpacity(v); }} />
          </div>
          {/* Shrink */}
          {meshData.elements.length >= 4 && (
            <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
              <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground px-1 select-none" title="Shrink Elements">Shrink</span>
              <input type="range" className="w-[50px] h-[3px] accent-primary" min={10} max={100} value={Math.round(shrinkFactor * 100)} onChange={(e) => { const v = Number(e.target.value) / 100; onShrinkFactorChange ? onShrinkFactorChange(v) : setInternalShrinkFactor(v); }} />
            </div>
          )}
          {/* Arrows */}
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <button className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary" data-active={showArrows} onClick={() => { const v = !showArrows; onShowArrowsChange ? onShowArrowsChange(v) : setInternalShowArrows(v); }}>↗ Arrows</button>
            {showArrows && <input type="range" className="w-[50px] h-[3px] accent-primary" min={200} max={3000} step={100} value={arrowDensity} onChange={(e) => setArrowDensity(Number(e.target.value))} />}
          </div>
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <button
              className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary"
              data-active={cameraProjection === "orthographic"}
              onClick={() =>
                setCameraProjection((prev) =>
                  prev === "perspective" ? "orthographic" : "perspective",
                )
              }
            >
              {cameraProjection === "orthographic" ? "Ortho" : "Persp"}
            </button>
            <button
              className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary"
              data-active={navigationMode === "cad"}
              onClick={() =>
                setNavigationMode((prev) => (prev === "trackball" ? "cad" : "trackball"))
              }
            >
              {navigationMode === "cad" ? "CAD" : "Trackball"}
            </button>
          </div>
          <div className="w-px h-[20px] bg-border/50 mx-0.5 shrink-0" />
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            {(["reset", "front", "top", "right"] as const).map(view => (
              <button key={view} className="text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 hover:bg-muted/50" onClick={() => setCameraPreset(view)}>{view === "reset" ? "⟲" : view[0].toUpperCase()}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 p-1 rounded bg-card/50 backdrop-blur-md border border-border/50">
            <button
              className="text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 hover:bg-muted/50"
              onClick={() => setLegendOpen((prev) => !prev)}
            >
              Legend
            </button>
            <button
              className="text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 hover:bg-muted/50"
              onClick={() => setPartExplorerOpen((prev) => !prev)}
            >
              Parts
            </button>
            <button
              className="appearance-none border-none bg-transparent text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary hover:bg-muted/50"
              data-active={labeledMode}
              onClick={() => setLabeledMode((prev) => !prev)}
              title="Toggle compact / labeled toolbar"
            >
              {labeledMode ? "Compact" : "Labels"}
            </button>
            <button className="text-muted-foreground font-semibold px-1.5 py-1 hover:bg-muted/50" onClick={takeScreenshot} title="Screenshot">📷</button>
          </div>
        </div>
      )}

      {legendOpen && (
        <FieldLegend
          colorLabel={colorLegendLabel(legendField, fieldLabel)}
          lengthLabel={effectiveShowArrows ? "vector magnitude" : undefined}
          min={legendField === "none" ? undefined : fieldMagnitudeStats?.min}
          max={legendField === "none" ? undefined : fieldMagnitudeStats?.max}
          mean={legendField === "none" ? undefined : fieldMagnitudeStats?.mean}
          gradient={colorLegendGradient(legendField)}
        />
      )}

      {hasMeshParts && partExplorerOpen && (
        <div className="absolute right-3 top-20 z-20 w-[264px] max-h-[calc(100%-7rem)] overflow-hidden rounded-2xl border border-border/30 bg-background/88 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-border/25 px-3 py-2.5">
            <div>
              <p className="text-[0.62rem] font-semibold tracking-[0.12em] text-muted-foreground">
                {selectedMeshPart
                  ? "Selected submesh"
                  : inspectedMeshPart
                    ? "Isolated submesh"
                    : "Mesh parts"}
              </p>
              <p className="text-[0.78rem] font-medium text-foreground">
                {visibleLayers.length}/{meshParts.length} visible parts
              </p>
            </div>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[0.65rem] font-semibold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              onClick={() => setPartExplorerOpen(false)}
            >
              Hide
            </button>
          </div>
          <div className="border-b border-border/20 px-3 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              {roleVisibilitySummary.map((entry) => (
                <button
                  key={entry.role}
                  type="button"
                  className="rounded-full border border-border/25 px-2.5 py-1 text-[0.62rem] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  onClick={() => handleRoleVisibility(entry.role, entry.visible !== entry.total)}
                >
                  {entry.label} {entry.visible}/{entry.total}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[calc(100%-7.5rem)] overflow-y-auto px-3 py-3">
            {inspectedMeshPart ? (
              <div className="mb-3 rounded-2xl border border-primary/18 bg-primary/6 p-3">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-white/15"
                    style={{ backgroundColor: partRoleTint(inspectedMeshPart.role) }}
                    onClick={() => patchSinglePart(inspectedMeshPart.id, { visible: !(meshEntityViewState[inspectedMeshPart.id]?.visible ?? true) })}
                    title={(meshEntityViewState[inspectedMeshPart.id]?.visible ?? true) ? "Hide part" : "Show part"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.78rem] font-semibold text-foreground">
                      {inspectedMeshPart.label || inspectedMeshPart.id}
                    </div>
                    <div className="mt-1 text-[0.64rem] text-muted-foreground">
                      {inspectedMeshPart.role.replaceAll("_", " ")}
                      {inspectedMeshPart.object_id ? ` · ${inspectedMeshPart.object_id}` : ""}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[0.66rem]">
                      <div className="rounded-xl border border-border/18 bg-background/30 px-2.5 py-2">
                        <div className="text-muted-foreground">Tetra</div>
                        <div className="mt-1 font-mono text-foreground">
                          {inspectedMeshPart.element_count.toLocaleString()}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/18 bg-background/30 px-2.5 py-2">
                        <div className="text-muted-foreground">Nodes</div>
                        <div className="mt-1 font-mono text-foreground">
                          {inspectedMeshPart.node_count.toLocaleString()}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/18 bg-background/30 px-2.5 py-2">
                        <div className="text-muted-foreground">Faces</div>
                        <div className="mt-1 font-mono text-foreground">
                          {inspectedMeshPart.boundary_face_count.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.14em]",
                          qualityToneClass(inspectedPartQuality?.stats ?? null),
                        )}
                      >
                        {qualityLabel(inspectedPartQuality?.stats ?? null)}
                      </span>
                      {inspectedPartQuality?.markers.length ? (
                        <span className="rounded-full border border-border/20 bg-background/35 px-2 py-0.5 text-[0.58rem] font-mono text-muted-foreground">
                          markers {inspectedPartQuality.markers.join(", ")}
                        </span>
                      ) : null}
                      {inspectedPartQuality?.domainCount ? (
                        <span className="rounded-full border border-border/20 bg-background/35 px-2 py-0.5 text-[0.58rem] font-mono text-muted-foreground">
                          {inspectedPartQuality.domainCount} quality domain{inspectedPartQuality.domainCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                    {inspectedPartQuality?.stats ? (
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[0.64rem]">
                        <div className="rounded-xl border border-emerald-400/12 bg-emerald-500/5 px-2.5 py-2">
                          <div className="text-muted-foreground">Avg quality</div>
                          <div className="mt-1 font-mono text-foreground">
                            {inspectedPartQuality.stats.avg_quality.toFixed(3)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-border/18 bg-background/30 px-2.5 py-2">
                          <div className="text-muted-foreground">SICN p5</div>
                          <div className="mt-1 font-mono text-foreground">
                            {inspectedPartQuality.stats.sicn_p5.toFixed(3)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-border/18 bg-background/30 px-2.5 py-2">
                          <div className="text-muted-foreground">SICN mean</div>
                          <div className="mt-1 font-mono text-foreground">
                            {inspectedPartQuality.stats.sicn_mean.toFixed(3)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-border/18 bg-background/30 px-2.5 py-2">
                          <div className="text-muted-foreground">Gamma min</div>
                          <div className="mt-1 font-mono text-foreground">
                            {inspectedPartQuality.stats.gamma_min.toFixed(3)}
                          </div>
                        </div>
                      </div>
                    ) : inspectedMeshPart.element_count > 0 ? (
                      <div className="mt-2 rounded-xl border border-border/18 bg-background/30 px-2.5 py-2 text-[0.62rem] text-muted-foreground">
                        Quality metrics are not available for this submesh yet. Enable quality extraction before rebuilding to inspect SICN and gamma here.
                      </div>
                    ) : (
                      <div className="mt-2 rounded-xl border border-border/18 bg-background/30 px-2.5 py-2 text-[0.62rem] text-muted-foreground">
                        This part is surface-only, so volume tetrahedron quality metrics do not apply.
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className={cn(
                      "rounded-lg border px-2 py-1 text-[0.62rem] font-semibold transition-colors",
                      focusedEntityId === inspectedMeshPart.id
                        ? "border-cyan-400/30 bg-cyan-500/12 text-cyan-200"
                        : "border-border/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                    onClick={() => onEntityFocus?.(inspectedMeshPart.id)}
                  >
                    Focus
                  </button>
                </div>
              </div>
            ) : null}
            {partExplorerGroups.map((group) => (
              <div key={group.label} className="mb-3">
                <div className="px-1 pb-1.5 text-[0.64rem] font-semibold text-muted-foreground">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.parts.map((part) => {
                    const viewState = meshEntityViewState[part.id];
                    const isSelected = selectedEntityId === part.id;
                    const partQuality = partQualityById.get(part.id) ?? null;
                    return (
                      <div
                        key={part.id}
                        className={cn(
                          "rounded-xl border px-2.5 py-2 transition-colors",
                          isSelected
                            ? "border-primary/28 bg-primary/8"
                            : "border-border/18 bg-background/28 hover:bg-background/40",
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <button
                            type="button"
                            className="mt-0.5 h-3 w-3 shrink-0 rounded-full border border-white/15"
                            style={{ backgroundColor: partRoleTint(part.role) }}
                            onClick={() => patchSinglePart(part.id, { visible: !(viewState?.visible ?? true) })}
                            title={(viewState?.visible ?? true) ? "Hide part" : "Show part"}
                          />
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => handlePartSelect(part.id)}
                          >
                            <div className="truncate text-[0.72rem] font-medium text-foreground">
                              {part.label || part.id}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-2 text-[0.6rem] font-mono text-muted-foreground">
                              <span>{part.element_count.toLocaleString()} el</span>
                              <span>{part.node_count.toLocaleString()} n</span>
                              {partQuality?.stats ? (
                                <span>SICN p5 {partQuality.stats.sicn_p5.toFixed(2)}</span>
                              ) : null}
                              {part.object_id && <span>{part.object_id}</span>}
                            </div>
                          </button>
                          {isSelected ? (
                            <button
                              type="button"
                              className={cn(
                                "rounded-md border px-2 py-1 text-[0.6rem] font-semibold transition-colors",
                                focusedEntityId === part.id
                                  ? "border-cyan-400/30 bg-cyan-500/12 text-cyan-200"
                                  : "border-border/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                              )}
                              onClick={() => onEntityFocus?.(part.id)}
                            >
                              Focus
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className={cn(
          "absolute bottom-3 text-[0.65rem] text-slate-300 font-mono pointer-events-none flex items-baseline gap-3 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-md border border-slate-500/30 shadow-md z-20",
          legendOpen ? "left-[240px]" : "left-3",
        )}
      >
        <span>{meshData.nNodes.toLocaleString()} nodes</span><span className="w-[3px] h-[3px] rounded-full bg-slate-500/50" />
        <span>{meshData.nElements.toLocaleString()} tets</span><span className="w-[3px] h-[3px] rounded-full bg-slate-500/50" />
        <span>{(meshData.boundaryFaces.length / 3).toLocaleString()} faces</span>
        {clipEnabled && <><span className="w-[3px] h-[3px] rounded-full bg-slate-500/50" /><span className="text-amber-500">clip {clipAxis.toUpperCase()} @ {clipPos}%</span></>}
        {selectedFaces.length > 0 && <><span className="w-[3px] h-[3px] rounded-full bg-slate-500/50" /><span className="text-blue-400">{selectedFaces.length} selected</span></>}
      </div>

      {/* ── Lasso refine floating toolbar ── */}
      {selectedFaces.length > 0 && onRefine && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2 rounded-lg bg-slate-900/90 backdrop-blur-md border border-slate-500/30 shadow-xl z-30 pointer-events-auto">
          <span className="text-[0.65rem] font-mono text-slate-400 px-1">{selectedFaces.length} faces</span>
          <div className="w-px h-4 bg-slate-500/30" />
          <button className="text-[0.65rem] font-semibold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded hover:bg-emerald-500/10 transition-colors" onClick={() => { onRefine(selectedFaces, 0.5); setSelectedFaces([]); }}>Refine ×2</button>
          <button className="text-[0.65rem] font-semibold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded hover:bg-emerald-500/10 transition-colors" onClick={() => { onRefine(selectedFaces, 0.25); setSelectedFaces([]); }}>Refine ×4</button>
          <button className="text-[0.65rem] font-semibold uppercase tracking-widest text-amber-400 hover:text-amber-300 px-2 py-1 rounded hover:bg-amber-500/10 transition-colors" onClick={() => { onRefine(selectedFaces, 2.0); setSelectedFaces([]); }}>Coarsen ×2</button>
          <div className="w-px h-4 bg-slate-500/30" />
          <button className="text-[0.65rem] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-500/10 transition-colors" onClick={() => setSelectedFaces([])}>Clear</button>
        </div>
      )}

      <ViewCube sceneRef={viewCubeSceneRef} onRotate={handleViewCubeRotate} />
      {showOrientationLegend && <HslSphere sceneRef={viewCubeSceneRef} />}

      {hoveredFaceInfo && hoveredFace && (
        <div style={{ left: hoveredFace.x + 14, top: hoveredFace.y - 8 }} className="absolute z-40 px-2.5 py-1 rounded-md bg-slate-900/90 border border-slate-500/20 text-[0.68rem] font-mono text-slate-200/85 pointer-events-none whitespace-nowrap shadow-md">
          face #{hoveredFaceInfo.faceIdx} · AR {hoveredFaceInfo.ar.toFixed(2)}
          {hoveredFaceInfo.sicn != null && ` · SICN ${hoveredFaceInfo.sicn.toFixed(3)}`}
        </div>
      )}

      {ctxMenu && (
        <div style={{ left: ctxMenu.x, top: ctxMenu.y }} className="absolute z-50 min-w-[180px] py-1 rounded-lg bg-gradient-to-b from-slate-800/95 to-slate-900/95 border border-slate-500/20 shadow-xl backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
          <button className="flex items-center gap-2 w-full px-3.5 py-1.5 text-[0.73rem] text-slate-200 text-left hover:bg-slate-500/15" onClick={() => { setSelectedFaces([ctxMenu.faceIdx]); setCtxMenu(null); }}><span className="text-xs w-4">🔍</span> Inspect face #{ctxMenu.faceIdx}</button>
          <button className="flex items-center gap-2 w-full px-3.5 py-1.5 text-[0.73rem] text-slate-200 text-left hover:bg-slate-500/15" onClick={() => { applyToolbarColorField("quality"); setCtxMenu(null); }}><span className="text-xs w-4">📊</span> Show quality (AR)</button>
          <div className="h-px mx-2.5 my-1 bg-slate-500/15" />
          <button className="flex items-center gap-2 w-full px-3.5 py-1.5 text-[0.73rem] text-slate-200 text-left hover:bg-slate-500/15" onClick={() => { const v = !clipEnabled; onClipEnabledChange ? onClipEnabledChange(v) : setInternalClipEnabled(v); setCtxMenu(null); }}><span className="text-xs w-4">✂️</span> {clipEnabled ? "Disable clip" : "Enable clip"}</button>
          {selectedFaces.length > 0 && (
            <button className="flex items-center gap-2 w-full px-3.5 py-1.5 text-[0.73rem] text-slate-200 text-left hover:bg-slate-500/15 border-t border-slate-500/15 mt-1 pt-1.5" onClick={() => { setSelectedFaces([]); setCtxMenu(null); }}><span className="text-xs w-4 text-center opacity-70">✕</span> Clear selection</button>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(FemMeshView3DInner);
