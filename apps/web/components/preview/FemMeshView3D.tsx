"use client";

import { useEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { cn } from "@/lib/utils";
import { rotateCameraAroundTarget, setCameraPresetAroundTarget, focusCameraOnBounds, fitCameraToBounds } from "./camera/cameraHelpers";
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
import { combineMeshQualityStats } from "./fem/femQualityUtils";
import { partMeshTint, partEdgeTint, colorLegendGradient, colorLegendLabel } from "./fem/femColorUtils";
import { FemViewportToolbar } from "./fem/FemViewportToolbar";
import { FemPartExplorerPanel } from "./fem/FemPartExplorerPanel";
import { FemViewportScene } from "./fem/FemViewportScene";
import { FemContextMenu, FemHoverTooltip } from "./fem/FemContextMenu";
import { FemRefineToolbar, FemSelectionHUD } from "./fem/FemSelectionHUD";
import ScientificViewportShell from "./shared/ScientificViewportShell";
import type { ViewportQualityProfileId } from "./shared/viewportQualityProfiles";
import { ViewportOverlayManager, ViewportOverlaySlot } from "./ViewportOverlayManager";

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
  quantityId?: string;
  quantityOptions?: Array<{
    id: string;
    shortLabel: string;
    label?: string;
    available: boolean;
  }>;
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
  onQuantityChange?: (quantityId: string) => void;
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
  meshColor: string;
  edgeColor: string;
}

type CameraProjection = "perspective" | "orthographic";
type NavigationMode = "trackball" | "cad";

interface PartQualitySummary {
  markers: number[];
  domainCount: number;
  stats: MeshQualityStats | null;
}

function defaultMeshEntityViewState(part: FemMeshPart): MeshEntityViewState {
  return {
    visible: part.role !== "air",
    renderMode: part.role === "air" ? "wireframe" : "surface+edges",
    opacity:
      part.role === "air" ? 28 : part.role === "outer_boundary" ? 46 : part.role === "interface" ? 88 : 100,
    colorField: part.role === "magnetic_object" ? "orientation" : "none",
  };
}

function uniqueSortedMarkers(markers: readonly number[]): number[] {
  return Array.from(new Set(markers.filter((value) => Number.isFinite(value) && value >= 0))).sort(
    (left, right) => left - right,
  );
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

/* ── Component ─────────────────────────────────────────────────────── */

function FemMeshView3DInner({
  meshData,
  colorField = "orientation",
  fieldLabel,
  quantityId,
  quantityOptions = [],
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
  onQuantityChange,
}: Props) {
  const [internalRenderMode, setInternalRenderMode] = useState<RenderMode>("surface");
  const [field, setField] = useState<FemColorField>(colorField);
  const [arrowColorField, setArrowColorField] = useState<FemColorField>(colorField);
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
  const [openPopover, setOpenPopover] = useState<"quantity" | "color" | "clip" | "display" | "vectors" | "camera" | "panels" | null>(null);
  const [qualityProfile, setQualityProfile] = useState<ViewportQualityProfileId>("interactive");
  
  const [hoveredFace, setHoveredFace] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; faceIdx: number } | null>(null);
  const [selectedFaces, setSelectedFaces] = useState<number[]>([]);
  

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
      const defaultViewState = defaultMeshEntityViewState(part);
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
        meshColor: partMeshTint(part),
        edgeColor: partEdgeTint(part, isSelected, isDimmed),
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
        const visible = parts.filter(
          (part) => meshEntityViewState[part.id]?.visible ?? defaultMeshEntityViewState(part).visible,
        ).length;
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
  const fullDomainArrowNodeMask = useMemo(() => {
    if (meshData.quantityDomain !== "full_domain") {
      return null;
    }
    if (!hasMeshParts) {
      return new Array<boolean>(meshData.nNodes).fill(true);
    }
    if (visibleLayers.length === 0) {
      return new Array<boolean>(meshData.nNodes).fill(false);
    }
    const combined = new Array<boolean>(meshData.nNodes).fill(false);
    let sawExplicitMask = false;
    for (const layer of visibleLayers) {
      const nodeMask = layer.nodeMask;
      if (!nodeMask) {
        continue;
      }
      sawExplicitMask = true;
      for (let index = 0; index < nodeMask.length; index += 1) {
        combined[index] = combined[index] || nodeMask[index];
      }
    }
    return sawExplicitMask ? combined : new Array<boolean>(meshData.nNodes).fill(true);
  }, [hasMeshParts, meshData.nNodes, meshData.quantityDomain, visibleLayers]);
  const arrowActiveNodeMask =
    meshData.quantityDomain === "full_domain"
      ? fullDomainArrowNodeMask
      : magneticArrowNodeMask;
  const arrowBoundaryFaceIndices =
    meshData.quantityDomain === "full_domain" ? null : magneticBoundaryFaceIndices;
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
  const prominentQuantityOptions = useMemo(
    () => quantityOptions.filter((option) => option.available),
    [quantityOptions],
  );
  const effectiveOpacity = opacity;
  const arrowField = arrowColorField;
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
  useEffect(() => { setArrowColorField(colorField); }, [colorField]);
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

  const { dynamicGeomCenter, dynamicGeomSize, dynamicMaxDim } = useMemo(() => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    const tryAddFaceIndices = (indices: readonly number[] | null) => {
      if (!indices || indices.length === 0) return;
      const count = Math.floor(meshData.boundaryFaces.length / 3);
      for (const idx of indices) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= count) continue;
        const base = idx * 3;
        const faceNodes = [meshData.boundaryFaces[base], meshData.boundaryFaces[base+1], meshData.boundaryFaces[base+2]];
        for (const ni of faceNodes) {
           const nBase = ni * 3;
           const px = meshData.nodes[nBase], py = meshData.nodes[nBase+1], pz = meshData.nodes[nBase+2];
           if (px < minX) minX = px; if (px > maxX) maxX = px;
           if (py < minY) minY = py; if (py > maxY) maxY = py;
           if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
        }
      }
    };

    if (hasMeshParts) {
      for (const layer of visibleLayers) {
        if (layer.surfaceFaces && layer.surfaceFaces.length > 0) {
           for (const face of layer.surfaceFaces) {
             for (let i = 0; i < 3; i++) {
               const nBase = face[i] * 3;
               const px = meshData.nodes[nBase], py = meshData.nodes[nBase+1], pz = meshData.nodes[nBase+2];
               if (px < minX) minX = px; if (px > maxX) maxX = px;
               if (py < minY) minY = py; if (py > maxY) maxY = py;
               if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
             }
           }
        } else {
           tryAddFaceIndices(layer.boundaryFaceIndices);
        }
      }
    } else {
      if (shouldRenderAirGeometry) tryAddFaceIndices(airBoundaryFaceIndices);
      if (shouldRenderMagneticGeometry) tryAddFaceIndices(magneticBoundaryFaceIndices);
    }
    
    if (minX === Infinity) {
      minX = 0; maxX = 1; minY = 0; maxY = 1; minZ = 0; maxZ = 1;
    }
    const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
    return {
      dynamicGeomCenter: new THREE.Vector3((minX + maxX)/2, (minY + maxY)/2, (minZ + maxZ)/2),
      dynamicGeomSize: [sx, sy, sz] as [number, number, number],
      dynamicMaxDim: Math.max(sx, sy, sz)
    };
  }, [hasMeshParts, visibleLayers, shouldRenderAirGeometry, shouldRenderMagneticGeometry, airBoundaryFaceIndices, magneticBoundaryFaceIndices, meshData]);

  const lastFittedGeomRef = useRef<string | null>(null);
  
  useEffect(() => {
    const m = dynamicMaxDim;
    const c = dynamicGeomCenter;
    const sig = `${m.toFixed(4)}_${c.x.toFixed(4)}_${c.y.toFixed(4)}_${c.z.toFixed(4)}`;
    if (lastFittedGeomRef.current !== sig) {
      lastFittedGeomRef.current = sig;
      setCameraFitGeneration((g) => g + 1);
    }
  }, [dynamicMaxDim, dynamicGeomCenter]);

  const axesWorldExtent = dynamicGeomSize;
  const axesCenter = [0, 0, 0] as [number, number, number];
  const sceneMaxDim = dynamicMaxDim;

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
        overlay.boundsMin[0] - dynamicGeomCenter.x,
        overlay.boundsMin[1] - dynamicGeomCenter.y,
        overlay.boundsMin[2] - dynamicGeomCenter.z,
      ],
      max: [
        overlay.boundsMax[0] - dynamicGeomCenter.x,
        overlay.boundsMax[1] - dynamicGeomCenter.y,
        overlay.boundsMax[2] - dynamicGeomCenter.z,
      ],
    }, { fallbackMinRadius: sceneMaxDim * 0.05 });
  }, [dynamicGeomCenter, objectOverlays, sceneMaxDim]);

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
  const effectiveShowOrientationLegend =
    showOrientationLegend ||
    legendField === "orientation" ||
    arrowField === "orientation";
  return (
    <div className="relative flex flex-1 w-[100%] h-[100%] min-w-0 min-h-0 bg-background overflow-hidden rounded-md fem-canvas-container">
      <ScientificViewportShell
        toolbar={
          toolbarMode !== "hidden" ? (
            <FemViewportToolbar
              compact={hasMeshParts && meshParts.length > 0 && meshParts.length > 3}
              renderMode={toolbarRenderMode}
              surfaceColorField={toolbarColorField}
              arrowColorField={arrowField}
              projection={cameraProjection}
              navigation={navigationMode}
              qualityProfile={qualityProfile}
              clipEnabled={clipEnabled}
              clipAxis={clipAxis}
              clipPos={clipPos}
              arrowsVisible={showArrows}
              arrowDensity={arrowDensity}
              opacity={toolbarOpacity}
              shrinkFactor={shrinkFactor}
              showShrink={meshData.elements.length >= 4}
              labeledMode={labeledMode}
              legendOpen={legendOpen}
              partExplorerOpen={partExplorerOpen}
              visiblePartsCount={hasMeshParts ? visibleLayers.length : undefined}
              totalPartsCount={hasMeshParts ? meshParts.length : undefined}
              hasField={!missingMagneticMask}
              fieldLabel={fieldLabel}
              openPopover={openPopover}
              onOpenPopoverChange={(id) => setOpenPopover(id as typeof openPopover)}
              onRenderModeChange={applyToolbarRenderMode}
              onSurfaceColorFieldChange={applyToolbarColorField}
              onArrowColorFieldChange={setArrowColorField}
              onProjectionChange={setCameraProjection}
              onNavigationChange={setNavigationMode}
              onQualityProfileChange={setQualityProfile}
              onClipEnabledChange={(v) => {
                onClipEnabledChange ? onClipEnabledChange(v) : setInternalClipEnabled(v);
              }}
              onClipAxisChange={(a) => {
                onClipAxisChange ? onClipAxisChange(a) : setInternalClipAxis(a);
              }}
              onClipPosChange={(v) => {
                onClipPosChange ? onClipPosChange(v) : setInternalClipPos(v);
              }}
              onArrowsVisibleChange={(v) => {
                onShowArrowsChange ? onShowArrowsChange(v) : setInternalShowArrows(v);
              }}
              onArrowDensityChange={setArrowDensity}
              onOpacityChange={applyToolbarOpacity}
              onShrinkFactorChange={(v) => {
                onShrinkFactorChange ? onShrinkFactorChange(v) : setInternalShrinkFactor(v);
              }}
              onLabeledModeChange={setLabeledMode}
              onToggleLegend={() => setLegendOpen((prev) => !prev)}
              onTogglePartExplorer={() => setPartExplorerOpen((prev) => !prev)}
              onCameraPreset={setCameraPreset}
              onCapture={takeScreenshot}
              quantityId={quantityId}
              quantityOptions={prominentQuantityOptions}
              onQuantityChange={onQuantityChange}
            />
          ) : null
        }
        hud={
          <FemSelectionHUD
            nNodes={meshData.nNodes}
            nElements={meshData.nElements}
            nFaces={meshData.boundaryFaces.length / 3}
            clipEnabled={clipEnabled}
            clipAxis={clipAxis}
            clipPos={clipPos}
            selectedFacesCount={selectedFaces.length}
            legendOpen={legendOpen}
          />
        }
        projection={cameraProjection}
        navigation={navigationMode}
        qualityProfile={qualityProfile}
        target={[0, 0, 0]}
        bridgeRef={viewCubeSceneRef}
        controlsRef={controlsRef}
        onViewCubeRotate={handleViewCubeRotate}
        onResetView={() => setCameraPreset("reset")}
        showOrientationSphere={effectiveShowOrientationLegend}
        orientationSphereAxisConvention="identity"
        orientationSpherePositionClassName="top-[118px] right-3"
        onPointerMissed={() => setSelectedFaces([])}
        onCanvasContextMenu={(e) => e.preventDefault()}
        onCanvasCreated={({ gl }) => {
          canvasRef.current = gl.domElement;
        }}
      >
        {!missingExactScopeSegment ? (
          <FemViewportScene
            meshData={meshData}
            hasMeshParts={hasMeshParts}
            visibleLayers={visibleLayers}
            shouldRenderAirGeometry={shouldRenderAirGeometry}
            airBoundaryFaceIndices={airBoundaryFaceIndices}
            airElementIndices={airElementIndices}
            airSegmentOpacity={airSegmentOpacity}
            shouldRenderMagneticGeometry={shouldRenderMagneticGeometry}
            field={field}
            renderMode={renderMode}
            effectiveOpacity={effectiveOpacity}
            magneticBoundaryFaceIndices={magneticBoundaryFaceIndices}
            magneticElementIndices={magneticElementIndices}
            qualityPerFace={qualityPerFace}
            shrinkFactor={shrinkFactor}
            clipEnabled={clipEnabled}
            clipAxis={clipAxis}
            clipPos={clipPos}
            dynamicGeomCenter={dynamicGeomCenter}
            dynamicGeomSize={dynamicGeomSize}
            dynamicMaxDim={dynamicMaxDim}
            effectiveShowArrows={effectiveShowArrows}
            arrowField={arrowField}
            arrowDensity={arrowDensity}
            arrowActiveNodeMask={arrowActiveNodeMask}
            arrowBoundaryFaceIndices={arrowBoundaryFaceIndices}
            selectedFaces={selectedFaces}
            antennaOverlays={antennaOverlays}
            focusedEntityId={focusedEntityId}
            selectedAntennaId={selectedAntennaId}
            onAntennaTranslate={onAntennaTranslate}
            axesWorldExtent={axesWorldExtent}
            axesCenter={axesCenter}
            onFaceClick={handleFaceClick}
            onFaceHover={handleFaceHover}
            onFaceUnhover={handleFaceUnhover}
            onFaceContextMenu={handleFaceContextMenu}
            cameraFitGeneration={cameraFitGeneration}
            CameraAutoFit={CameraAutoFit}
            FemClipPlanes={FemClipPlanes}
          />
        ) : null}
      </ScientificViewportShell>
      <ViewportOverlayManager>
        {({ mode }) => (
          <>
            {missingExactScopeSegment && selectedObjectId ? (
              <ViewportOverlaySlot anchor="top-left" className="max-w-[min(56rem,calc(100%-7rem))]">
                <div className="pointer-events-none rounded-xl border border-rose-400/25 bg-background/85 px-4 py-3 text-sm text-rose-200 shadow-lg backdrop-blur-md">
                  Object mesh segmentation unavailable for shared-domain FEM: `{selectedObjectId}`
                </div>
              </ViewportOverlaySlot>
            ) : null}
            {missingMagneticMask ? (
              <ViewportOverlaySlot anchor="top-left" className="top-16 max-w-[min(56rem,calc(100%-7rem))]">
                <div className="pointer-events-none rounded-xl border border-amber-400/25 bg-background/85 px-4 py-3 text-sm text-amber-100 shadow-lg backdrop-blur-md">
                  Magnetic-region preview mask unavailable for quantity `{fieldLabel ?? "m"}`.
                </div>
              </ViewportOverlaySlot>
            ) : null}
            {legendOpen ? (
              <ViewportOverlaySlot anchor="bottom-left">
                <FieldLegend
                  compact={mode !== "full"}
                  className="pointer-events-none z-10"
                  colorLabel={colorLegendLabel(legendField, fieldLabel)}
                  lengthLabel={
                    effectiveShowArrows
                      ? arrowField === "orientation"
                        ? "vector magnitude, arrow color = orientation"
                        : `vector magnitude, arrow color = ${colorLegendLabel(arrowField, fieldLabel)}`
                      : undefined
                  }
                  min={legendField === "none" ? undefined : fieldMagnitudeStats?.min}
                  max={legendField === "none" ? undefined : fieldMagnitudeStats?.max}
                  mean={legendField === "none" ? undefined : fieldMagnitudeStats?.mean}
                  gradient={colorLegendGradient(legendField)}
                />
              </ViewportOverlaySlot>
            ) : null}
            {hasMeshParts && partExplorerOpen ? (
              <ViewportOverlaySlot
                anchor="top-right"
                className={mode === "icon" ? "top-20 w-[224px]" : "top-20"}
              >
                <FemPartExplorerPanel
                  meshParts={meshParts}
                  meshEntityViewState={meshEntityViewState}
                  partQualityById={partQualityById}
                  partExplorerGroups={partExplorerGroups}
                  roleVisibilitySummary={roleVisibilitySummary}
                  inspectedMeshPart={inspectedMeshPart}
                  inspectedPartQuality={inspectedPartQuality}
                  selectedEntityId={selectedEntityId}
                  focusedEntityId={focusedEntityId}
                  visiblePartsCount={visibleLayers.length}
                  onClose={() => setPartExplorerOpen(false)}
                  onPartSelect={handlePartSelect}
                  onEntityFocus={onEntityFocus}
                  onPatchPart={patchSinglePart}
                  onRoleVisibility={handleRoleVisibility}
                />
              </ViewportOverlaySlot>
            ) : null}
          </>
        )}
      </ViewportOverlayManager>

      {onRefine ? (
        <FemRefineToolbar
          selectedFacesCount={selectedFaces.length}
          onRefine={(factor) => {
            onRefine(selectedFaces, factor);
            setSelectedFaces([]);
          }}
          onCoarsen={(factor) => {
            onRefine(selectedFaces, factor);
            setSelectedFaces([]);
          }}
          onClear={() => setSelectedFaces([])}
        />
      ) : null}

      <FemHoverTooltip hoveredFace={hoveredFace} hoveredFaceInfo={hoveredFaceInfo} />

      <FemContextMenu
        ctxMenu={ctxMenu}
        clipEnabled={clipEnabled}
        selectedFacesCount={selectedFaces.length}
        onInspectFace={(faceIdx) => {
          setSelectedFaces([faceIdx]);
          setCtxMenu(null);
        }}
        onShowQuality={() => {
          applyToolbarColorField("quality");
          setCtxMenu(null);
        }}
        onToggleClip={() => {
          const next = !clipEnabled;
          onClipEnabledChange ? onClipEnabledChange(next) : setInternalClipEnabled(next);
          setCtxMenu(null);
        }}
        onClearSelection={() => {
          setSelectedFaces([]);
          setCtxMenu(null);
        }}
      />
    </div>
  );
}

export default memo(FemMeshView3DInner);
