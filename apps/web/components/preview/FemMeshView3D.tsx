"use client";

import { useEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { rotateCameraAroundTarget, setCameraPresetAroundTarget, focusCameraOnBounds, fitCameraToBounds } from "./camera/cameraHelpers";
import { computeFaceAspectRatios } from "./r3f/colorUtils";
import type {
  FemLiveMeshObjectSegment,
  FemMeshPart,
  MeshQualityStats,
  MeshEntityViewState,
  MeshEntityViewStateMap,
} from "../../lib/session/types";
import { defaultMeshEntityViewState } from "../../lib/session/types";
import type {
  AntennaOverlay,
  BuilderObjectOverlay,
  FocusObjectRequest,
  ObjectViewMode,
} from "../runs/control-room/shared";
import { FieldLegend } from "./field/FieldLegend";
import { DraggableViewportBlock } from "./DraggableViewportBlock";
import { combineMeshQualityStats } from "./fem/femQualityUtils";
import { partMeshTint, partEdgeTint, colorLegendGradient, colorLegendLabel } from "./fem/femColorUtils";
import { FemViewportToolbar } from "./fem/FemViewportToolbar";
import { FemPartExplorerPanel } from "./fem/FemPartExplorerPanel";
import { FemViewportScene } from "./fem/FemViewportScene";
import { FemContextMenu, FemHoverTooltip } from "./fem/FemContextMenu";
import { FemRefineToolbar, FemSelectionHUD } from "./fem/FemSelectionHUD";
import {
  GLYPH_BUDGET_MIN,
  PREVIEW_MAX_POINTS_DEFAULT,
  glyphBudgetToMaxPoints,
  maxPointsToGlyphBudget,
} from "./fem/vectorDensityBudget";
import HslSphere from "./HslSphere";
import ViewCube from "./ViewCube";
import ScientificViewportShell from "./shared/ScientificViewportShell";
import type { ViewportQualityProfileId } from "./shared/viewportQualityProfiles";
import { exportCanvasAsImage } from "./export/FigureExport";
import {
  ViewportOverlayManager,
  type ViewportOverlayDescriptor,
} from "./ViewportOverlayManager";
import TextureTransformGizmo, {
  type TextureGizmoMode,
  type TexturePreviewProxy,
} from "./TextureTransformGizmo";
import type { TextureTransform3D } from "@/lib/textureTransform";
import { FRONTEND_DIAGNOSTIC_FLAGS } from "@/lib/debug/frontendDiagnosticFlags";
import { recordFrontendRender } from "@/lib/debug/frontendPerfDebug";

const STABLE_ORIGIN: [number, number, number] = [0, 0, 0];

const AIR_OBJECT_SEGMENT_ID = "__air__";
const RENDER_MODE_DISPLAY_PRESETS: Record<
  RenderMode,
  {
    opacity: number;
    showArrows: boolean;
    clipEnabled: boolean;
    clipAxis: ClipAxis;
    clipPos: number;
    vectorDomainFilter: FemVectorDomainFilter;
    ferromagnetVisibilityMode: FemFerromagnetVisibilityMode;
    shrinkFactor: number;
    qualityProfile: ViewportQualityProfileId;
  }
> = {
  surface: {
    opacity: 85,
    showArrows: false,
    clipEnabled: false,
    clipAxis: "x",
    clipPos: 50,
    vectorDomainFilter: "auto",
    ferromagnetVisibilityMode: "hide",
    shrinkFactor: 1,
    qualityProfile: "interactive",
  },
  "surface+edges": {
    opacity: 72,
    showArrows: false,
    clipEnabled: false,
    clipAxis: "x",
    clipPos: 50,
    vectorDomainFilter: "auto",
    ferromagnetVisibilityMode: "hide",
    shrinkFactor: 1,
    qualityProfile: "interactive",
  },
  wireframe: {
    opacity: 65,
    showArrows: false,
    clipEnabled: false,
    clipAxis: "x",
    clipPos: 50,
    vectorDomainFilter: "auto",
    ferromagnetVisibilityMode: "hide",
    shrinkFactor: 1,
    qualityProfile: "interactive",
  },
  points: {
    opacity: 100,
    showArrows: false,
    clipEnabled: false,
    clipAxis: "x",
    clipPos: 50,
    vectorDomainFilter: "auto",
    ferromagnetVisibilityMode: "hide",
    shrinkFactor: 1,
    qualityProfile: "interactive",
  },
};

/* ── Types ─────────────────────────────────────────────────────────── */

export interface FemMeshData {
  nodes: number[];
  elements: number[];
  boundaryFaces: number[];
  nNodes: number;
  nElements: number;
  fieldData?: { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> };
  activeMask?: boolean[] | null;
  quantityDomain?: "magnetic_only" | "full_domain" | "surface_only" | null;
}

export interface MeshSelectionSnapshot {
  selectedFaceIndices: number[];
  primaryFaceIndex: number | null;
}

export type FemColorField = "orientation" | "x" | "y" | "z" | "magnitude" | "quality" | "sicn" | "none";
export type FemArrowColorMode = "orientation" | "x" | "y" | "z" | "magnitude" | "monochrome";
export type RenderMode = "surface" | "surface+edges" | "wireframe" | "points";
export type ClipAxis = "x" | "y" | "z";
export type FemVectorDomainFilter = "auto" | "magnetic_only" | "full_domain" | "airbox_only";
export type FemFerromagnetVisibilityMode = "hide" | "ghost";

/* ── Opacity constants (extracted from hardcoded values) ── */
const DIMMED_MIN_MAGNETIC = 14;
const DIMMED_MIN_AIR = 8;
const SELECTED_LIFT_MAGNETIC = 96;
const SELECTED_LIFT_AIR = 52;

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
  arrowColorMode?: FemArrowColorMode;
  arrowMonoColor?: string;
  arrowAlpha?: number;
  arrowLengthScale?: number;
  arrowThickness?: number;
  vectorDomainFilter?: FemVectorDomainFilter;
  ferromagnetVisibilityMode?: FemFerromagnetVisibilityMode;
  previewMaxPoints?: number;
  showOrientationLegend?: boolean;
  qualityPerFace?: number[] | null;
  shrinkFactor?: number;
  onRenderModeChange?: (value: RenderMode) => void;
  onOpacityChange?: (value: number) => void;
  onClipEnabledChange?: (value: boolean) => void;
  onClipAxisChange?: (value: ClipAxis) => void;
  onClipPosChange?: (value: number) => void;
  onShowArrowsChange?: (value: boolean) => void;
  onArrowColorModeChange?: (value: FemArrowColorMode) => void;
  onArrowMonoColorChange?: (value: string) => void;
  onArrowAlphaChange?: (value: number) => void;
  onArrowLengthScaleChange?: (value: number) => void;
  onArrowThicknessChange?: (value: number) => void;
  onVectorDomainFilterChange?: (value: FemVectorDomainFilter) => void;
  onFerromagnetVisibilityModeChange?: (value: FemFerromagnetVisibilityMode) => void;
  onPreviewMaxPointsChange?: (maxPoints: number) => void;
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
  activeTextureTransform?: TextureTransform3D | null;
  textureGizmoMode?: TextureGizmoMode;
  activeTexturePreviewProxy?: TexturePreviewProxy;
  activeTransformScope?: "object" | "texture" | null;
  onTextureTransformChange?: (next: TextureTransform3D) => void;
  onTextureTransformCommit?: (next: TextureTransform3D) => void;
}

interface RenderLayer {
  part: FemMeshPart;
  viewState: MeshEntityViewState;
  boundaryFaceIndices: number[] | null;
  elementIndices: number[] | null;
  nodeMask: Uint8Array | null;
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

function uniqueSortedMarkers(markers: readonly number[]): number[] {
  return Array.from(new Set(markers.filter((value) => Number.isFinite(value) && value >= 0))).sort(
    (left, right) => left - right,
  );
}

function countActiveNodes(mask: ArrayLike<number | boolean> | null | undefined): number {
  if (!mask || mask.length === 0) {
    return 0;
  }
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      count += 1;
    }
  }
  return count;
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
): Uint8Array | null {
  if (segmentIds.size === 0) {
    return null;
  }
  const nodeMask = new Uint8Array(nNodes);
  let sawNode = false;
  for (const segment of objectSegments) {
    if (!segmentIds.has(segment.object_id)) {
      continue;
    }
    const start = Math.max(0, Math.trunc(segment.node_start));
    const count = Math.max(0, Math.trunc(segment.node_count));
    const end = Math.min(start + count, nNodes);
    for (let nodeIndex = start; nodeIndex < end; nodeIndex += 1) {
      nodeMask[nodeIndex] = 1;
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
): Uint8Array | null {
  if (part.node_indices.length > 0) {
    const nodeMask = new Uint8Array(nNodes);
    let sawNode = false;
    for (const nodeIndex of part.node_indices) {
      if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nNodes) {
        continue;
      }
      nodeMask[nodeIndex] = 1;
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
  const nodeMask = new Uint8Array(nNodes);
  for (let nodeIndex = start; nodeIndex < end; nodeIndex += 1) {
    nodeMask[nodeIndex] = 1;
  }
  return nodeMask;
}

const SUPPORTED_ARROW_COLOR_FIELDS: ReadonlySet<FemArrowColorMode> = new Set([
  "orientation",
  "x",
  "y",
  "z",
  "magnitude",
]);

/* ── Global R3F Logic Components ───────────────────────────────────── */

function FemClipPlanes({ enabled, axis, posPercentage, geomSize }: { enabled: boolean; axis: ClipAxis; posPercentage: number; geomSize: [number, number, number] }) {
  const { gl } = useThree();
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  useEffect(() => {
    rendererRef.current = gl;
  }, [gl]);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }
    renderer.localClippingEnabled = enabled;
    if (!enabled) {
      renderer.clippingPlanes = [];
      return;
    }
    const axisSize = axis === "x" ? geomSize[0] : axis === "y" ? geomSize[1] : geomSize[2];
    const pos = ((posPercentage / 100) - 0.5) * axisSize;
    const normal = new THREE.Vector3(axis === "x" ? -1 : 0, axis === "y" ? -1 : 0, axis === "z" ? -1 : 0);
    renderer.clippingPlanes = [new THREE.Plane(normal, pos)];
  }, [enabled, axis, posPercentage, geomSize]);
  return null;
}

/** Auto-fit the R3F camera to the geometry bounding sphere whenever maxDim changes. */
function CameraAutoFit({ maxDim, generation, controlsRef }: { maxDim: number; generation: number; controlsRef?: React.MutableRefObject<any> }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    if (maxDim <= 0 || generation === 0) return;
    fitCameraToBounds(camera, maxDim, undefined, controlsRef?.current ?? undefined);
    invalidate();
  }, [camera, controlsRef, invalidate, maxDim, generation]);
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
  arrowColorMode: controlledArrowColorMode,
  arrowMonoColor: controlledArrowMonoColor,
  arrowAlpha: controlledArrowAlpha,
  arrowLengthScale: controlledArrowLengthScale,
  arrowThickness: controlledArrowThickness,
  vectorDomainFilter: controlledVectorDomainFilter,
  ferromagnetVisibilityMode: controlledFerromagnetVisibilityMode,
  previewMaxPoints,
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
  onArrowColorModeChange,
  onArrowMonoColorChange,
  onArrowAlphaChange,
  onArrowLengthScaleChange,
  onArrowThicknessChange,
  onVectorDomainFilterChange,
  onFerromagnetVisibilityModeChange,
  onPreviewMaxPointsChange,
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
  onAntennaTranslate,
  onEntitySelect,
  onEntityFocus,
  onQuantityChange,
  activeTextureTransform = null,
  textureGizmoMode = "translate",
  activeTexturePreviewProxy = "box",
  activeTransformScope = null,
  onTextureTransformChange,
  onTextureTransformCommit,
}: Props) {
  if (FRONTEND_DIAGNOSTIC_FLAGS.renderDebug.enableRenderLogging) {
    recordFrontendRender("FemMeshView3DInner", {
      nNodes: meshData.nNodes,
      nElements: meshData.nElements,
      showSceneGeometry: FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showSceneGeometry,
      showPerPartGeometry: FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showPerPartGeometry,
    });
  }
  const [internalRenderMode, setInternalRenderMode] = useState<RenderMode>("surface");
  const [field, setField] = useState<FemColorField>(colorField);
  const [internalArrowColorMode, setInternalArrowColorMode] = useState<FemArrowColorMode>(
    SUPPORTED_ARROW_COLOR_FIELDS.has(colorField as FemArrowColorMode)
      ? (colorField as FemArrowColorMode)
      : "orientation",
  );
  const [internalArrowMonoColor, setInternalArrowMonoColor] = useState("#00c2ff");
  const [internalArrowAlpha, setInternalArrowAlpha] = useState(1);
  const [internalArrowLengthScale, setInternalArrowLengthScale] = useState(1);
  const [internalArrowThickness, setInternalArrowThickness] = useState(1);
  const [internalVectorDomainFilter, setInternalVectorDomainFilter] =
    useState<FemVectorDomainFilter>("auto");
  const [internalFerromagnetVisibilityMode, setInternalFerromagnetVisibilityMode] =
    useState<FemFerromagnetVisibilityMode>("hide");
  const [internalOpacity, setInternalOpacity] = useState(100);
  const [internalClipEnabled, setInternalClipEnabled] = useState(false);
  const [internalClipAxis, setInternalClipAxis] = useState<ClipAxis>("x");
  const [internalClipPos, setInternalClipPos] = useState(50);
  const [internalShowArrows, setInternalShowArrows] = useState(false);
  const [internalPreviewMaxPoints, setInternalPreviewMaxPoints] = useState(PREVIEW_MAX_POINTS_DEFAULT);
  const [internalShrinkFactor, setInternalShrinkFactor] = useState(1);
  const [cameraProjection, setCameraProjection] = useState<CameraProjection>("perspective");
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("trackball");
  const [partExplorerOpen, setPartExplorerOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const [labeledMode, setLabeledMode] = useState(false);
  const [openPopover, setOpenPopover] = useState<"quantity" | "color" | "clip" | "display" | "vectors" | "camera" | "panels" | null>(null);
  const [qualityProfile, setQualityProfile] = useState<ViewportQualityProfileId>("interactive");
  const [interactionActive, setInteractionActive] = useState(false);
  const [captureActive, setCaptureActive] = useState(false);
  const [captureOverlayHidden, setCaptureOverlayHidden] = useState(false);
  
  const [hoveredFace, setHoveredFace] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; faceIdx: number } | null>(null);
  const [selectedFaces, setSelectedFaces] = useState<number[]>([]);
  

  const [cameraFitGeneration, setCameraFitGeneration] = useState(0);

  const controlsRef = useRef<any>(null);
  const viewCubeSceneRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const qualityProfileRef = useRef<ViewportQualityProfileId>("interactive");
  const selectedObjectOverlay = useMemo(
    () =>
      selectedObjectId
        ? objectOverlays.find((overlay) => overlay.id === selectedObjectId) ?? null
        : null,
    [objectOverlays, selectedObjectId],
  );
  const renderMode = controlledRenderMode ?? internalRenderMode;
  const opacity = controlledOpacity ?? internalOpacity;
  const clipEnabled = controlledClipEnabled ?? internalClipEnabled;
  const clipAxis = controlledClipAxis ?? internalClipAxis;
  const clipPos = controlledClipPos ?? internalClipPos;
  const showArrows = controlledShowArrows ?? internalShowArrows;
  const arrowColorMode = controlledArrowColorMode ?? internalArrowColorMode;
  const arrowMonoColor = controlledArrowMonoColor ?? internalArrowMonoColor;
  const arrowAlpha = controlledArrowAlpha ?? internalArrowAlpha;
  const arrowLengthScale = controlledArrowLengthScale ?? internalArrowLengthScale;
  const arrowThickness = controlledArrowThickness ?? internalArrowThickness;
  const vectorDomainFilter = controlledVectorDomainFilter ?? internalVectorDomainFilter;
  const ferromagnetVisibilityMode =
    controlledFerromagnetVisibilityMode ?? internalFerromagnetVisibilityMode;
  const resolvedPreviewMaxPoints = previewMaxPoints ?? internalPreviewMaxPoints;
  const shrinkFactor = controlledShrinkFactor ?? internalShrinkFactor;
  const updateSharedPreviewMaxPoints = useCallback((nextMaxPoints: number) => {
    if (onPreviewMaxPointsChange) {
      onPreviewMaxPointsChange(nextMaxPoints);
      return;
    }
    setInternalPreviewMaxPoints(nextMaxPoints);
  }, [onPreviewMaxPointsChange]);
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
  const supportsAirboxOnlyVectors = meshData.quantityDomain === "full_domain";
  const wrapperFlags = FRONTEND_DIAGNOSTIC_FLAGS.femWrapper;
  const selectionOnlyInteractionMode =
    FRONTEND_DIAGNOSTIC_FLAGS.femViewport.enableSelectionOnlyInteractionMode;
  const geometryPointerInteractionsEnabled =
    wrapperFlags.enableInteractiveState &&
    selectionOnlyInteractionMode &&
    FRONTEND_DIAGNOSTIC_FLAGS.femViewport.enableGeometryPointerInteractions;
  const geometryHoverInteractionsEnabled =
    geometryPointerInteractionsEnabled &&
    FRONTEND_DIAGNOSTIC_FLAGS.femViewport.enableGeometryHoverInteractions;
  const geometryContextMenuEnabled =
    geometryPointerInteractionsEnabled && wrapperFlags.enableContextMenu;
  const effectiveVectorDomainFilter: FemVectorDomainFilter =
    vectorDomainFilter === "airbox_only" && !supportsAirboxOnlyVectors
      ? "auto"
      : vectorDomainFilter;
  const partRenderDataById = useMemo(() => {
    if (!wrapperFlags.enablePartDerivedModel) {
      return new Map<
        string,
        {
          boundaryFaceIndices: number[] | null;
          elementIndices: number[] | null;
          nodeMask: Uint8Array | null;
          surfaceFaces: [number, number, number][] | null;
        }
      >();
    }
    const cache = new Map<
      string,
      {
        boundaryFaceIndices: number[] | null;
        elementIndices: number[] | null;
        nodeMask: Uint8Array | null;
        surfaceFaces: [number, number, number][] | null;
      }
    >();
    const maxBoundaryFaceCount = Math.floor(meshData.boundaryFaces.length / 3);
    for (const part of meshParts) {
      cache.set(part.id, {
        boundaryFaceIndices: collectPartBoundaryFaceIndices(part, maxBoundaryFaceCount),
        elementIndices: collectPartElementIndices(part, meshData.nElements),
        nodeMask: collectPartNodeMask(part, meshData.nNodes),
        surfaceFaces: part.surface_faces.length > 0 ? part.surface_faces : null,
      });
    }
    return cache;
  }, [meshData.boundaryFaces.length, meshData.nElements, meshData.nNodes, meshParts, wrapperFlags.enablePartDerivedModel]);
  const visibleLayers = useMemo<RenderLayer[]>(() => {
    if (!wrapperFlags.enablePartDerivedModel || !hasMeshParts) {
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
        // Keep render mode strictly user-driven; selection must not
        // auto-promote `surface` to `surface+edges`.
        renderMode: baseViewState.renderMode,
        opacity: isDimmed
          ? Math.min(baseViewState.opacity, part.role === "air" ? DIMMED_MIN_AIR : DIMMED_MIN_MAGNETIC)
          : isSelected
            ? Math.max(baseViewState.opacity, part.role === "air" ? SELECTED_LIFT_AIR : SELECTED_LIFT_MAGNETIC)
            : baseViewState.opacity,
      };
      const isAirboxOnly = effectiveVectorDomainFilter === "airbox_only";
      const magneticHiddenInAirboxOnly =
        isAirboxOnly &&
        part.role === "magnetic_object" &&
        ferromagnetVisibilityMode === "hide";
      // Selection should force-show the part when explicitly selected,
      // including air/boundary — but the "Show Airbox Mesh" toggle is respected
      // when the selection comes indirectly from selecting a magnetic object.
      const explicitlySelected =
        (selectedAirPartId != null && part.id === selectedAirPartId) ||
        (preferredCameraPartId != null && part.id === preferredCameraPartId);
      // Respect explicit "Show Airbox Mesh" toggle even when the air part is selected.
      const selectionKeepsVisible =
        isSelected &&
        (part.role !== "air" || (explicitlySelected && airSegmentVisible));
      const visibleForMode =
        objectViewMode === "isolate" && hasSelection
          ? isSelected && (viewState.visible || selectionKeepsVisible)
          : (viewState.visible || selectionKeepsVisible);
      if (!visibleForMode || magneticHiddenInAirboxOnly) {
        continue;
      }
      const resolvedViewState: MeshEntityViewState =
        isAirboxOnly &&
        part.role === "magnetic_object" &&
        ferromagnetVisibilityMode === "ghost"
          ? {
              ...viewState,
              opacity: Math.min(viewState.opacity, 22),
              renderMode: viewState.renderMode === "points" ? "wireframe" : viewState.renderMode,
              colorField: "none",
            }
          : viewState;
      const partRenderData = partRenderDataById.get(part.id);
      layers.push({
        part,
        viewState: resolvedViewState,
        boundaryFaceIndices: partRenderData?.boundaryFaceIndices ?? null,
        elementIndices: partRenderData?.elementIndices ?? null,
        nodeMask: partRenderData?.nodeMask ?? null,
        surfaceFaces: partRenderData?.surfaceFaces ?? null,
        isPrimaryForCamera: preferredCameraPartId
          ? part.id === preferredCameraPartId
          : false,
        isMagnetic: part.role === "magnetic_object",
        isSelected,
        isDimmed,
        meshColor:
          isAirboxOnly && part.role === "magnetic_object" && ferromagnetVisibilityMode === "ghost"
            ? "#94a3b8"
            : partMeshTint(part),
        edgeColor:
          isAirboxOnly && part.role === "magnetic_object" && ferromagnetVisibilityMode === "ghost"
            ? "#cbd5e1"
            : partEdgeTint(part, isSelected, isDimmed),
      });
    }
    if (layers.length > 0 && !layers.some((layer) => layer.isPrimaryForCamera)) {
      layers[0] = { ...layers[0], isPrimaryForCamera: true };
    }
    return layers;
  }, [
    airSegmentVisible,
    effectiveVectorDomainFilter,
    ferromagnetVisibilityMode,
    focusedEntityId,
    hasMeshParts,
    meshEntityViewState,
    meshParts,
    objectViewMode,
    partRenderDataById,
    selectedEntityId,
    selectedObjectId,
    wrapperFlags.enablePartDerivedModel,
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
    if (!wrapperFlags.enableVectorDerivedModel) {
      return null;
    }
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
    wrapperFlags.enableVectorDerivedModel,
  ]);
  const magneticElementIndices = useMemo(() => {
    if (!wrapperFlags.enableVectorDerivedModel) {
      return null;
    }
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
    wrapperFlags.enableVectorDerivedModel,
  ]);
  const airBoundaryFaceIndices = useMemo(
    () =>
      !wrapperFlags.enableVectorDerivedModel
        ? null
        :
      collectSegmentBoundaryFaceIndicesByIds(
        objectSegments,
        Math.floor(meshData.boundaryFaces.length / 3),
        airSegmentIds,
      ),
    [airSegmentIds, meshData.boundaryFaces.length, objectSegments, wrapperFlags.enableVectorDerivedModel],
  );
  const airElementIndices = useMemo(
    () =>
      !wrapperFlags.enableVectorDerivedModel
        ? null
        : collectSegmentElementIndicesByIds(objectSegments, meshData.nElements, airSegmentIds),
    [airSegmentIds, meshData.nElements, objectSegments, wrapperFlags.enableVectorDerivedModel],
  );
  const magneticArrowNodeMask = useMemo(() => {
    if (!wrapperFlags.enableVectorDerivedModel) {
      return null;
    }
    if (hasMeshParts) {
      const visibleMagneticLayers = visibleLayers.filter((layer) => layer.isMagnetic);
      if (visibleMagneticLayers.length === 0) {
        return meshData.activeMask ?? null;
      }
      const baseActiveMask = meshData.activeMask;
      const combined = new Uint8Array(meshData.nNodes);
      for (const layer of visibleMagneticLayers) {
        const nodeMask = layer.nodeMask;
        if (!nodeMask) {
          continue;
        }
        for (let index = 0; index < nodeMask.length; index += 1) {
          if (nodeMask[index]) combined[index] = 1;
        }
      }
      if (!baseActiveMask || baseActiveMask.length !== meshData.nNodes) {
        return combined;
      }
      const result = new Uint8Array(meshData.nNodes);
      for (let i = 0; i < result.length; i++) {
        result[i] = combined[i] && baseActiveMask[i] ? 1 : 0;
      }
      return result;
    }
    const nodeMask = collectSegmentNodeMask(magneticSegments, meshData.nNodes, visibleMagneticIds);
    if (!nodeMask) {
      return meshData.activeMask ?? null;
    }
    const baseActiveMask = meshData.activeMask;
    if (!baseActiveMask || baseActiveMask.length !== meshData.nNodes) {
      return nodeMask;
    }
    const result = new Uint8Array(meshData.nNodes);
    for (let i = 0; i < result.length; i++) {
      result[i] = nodeMask[i] && baseActiveMask[i] ? 1 : 0;
    }
    return result;
  }, [
    hasMeshParts,
    magneticSegments,
    meshData.activeMask,
    meshData.nNodes,
    visibleLayers,
    visibleMagneticIds,
    wrapperFlags.enableVectorDerivedModel,
  ]);
  const fullDomainArrowNodeMask = useMemo(() => {
    if (!wrapperFlags.enableVectorDerivedModel) {
      return null;
    }
    if (meshData.quantityDomain !== "full_domain") {
      return null;
    }
    if (!hasMeshParts) {
      const mask = new Uint8Array(meshData.nNodes);
      mask.fill(1);
      return mask;
    }
    if (visibleLayers.length === 0) {
      return new Uint8Array(meshData.nNodes);
    }
    const combined = new Uint8Array(meshData.nNodes);
    let sawExplicitMask = false;
    for (const layer of visibleLayers) {
      const nodeMask = layer.nodeMask;
      if (!nodeMask) {
        continue;
      }
      sawExplicitMask = true;
      for (let index = 0; index < nodeMask.length; index += 1) {
        if (nodeMask[index]) combined[index] = 1;
      }
    }
    if (!sawExplicitMask) {
      const allOnes = new Uint8Array(meshData.nNodes);
      allOnes.fill(1);
      return allOnes;
    }
    return combined;
  }, [hasMeshParts, meshData.nNodes, meshData.quantityDomain, visibleLayers, wrapperFlags.enableVectorDerivedModel]);
  const airArrowNodeMask = useMemo(() => {
    if (!wrapperFlags.enableVectorDerivedModel) {
      return null;
    }
    if (hasMeshParts) {
      const airLayers = visibleLayers.filter((layer) => layer.part.role === "air");
      if (airLayers.length === 0) {
        return new Uint8Array(meshData.nNodes);
      }
      const combined = new Uint8Array(meshData.nNodes);
      for (const layer of airLayers) {
        const nodeMask = layer.nodeMask;
        if (!nodeMask) {
          continue;
        }
        for (let index = 0; index < nodeMask.length; index += 1) {
          if (nodeMask[index]) combined[index] = 1;
        }
      }
      return combined;
    }
    const nodeMask = collectSegmentNodeMask(objectSegments, meshData.nNodes, airSegmentIds);
    return nodeMask ?? new Uint8Array(meshData.nNodes);
  }, [airSegmentIds, hasMeshParts, meshData.nNodes, objectSegments, visibleLayers, wrapperFlags.enableVectorDerivedModel]);
  const resolvedVectorDomain: "magnetic_only" | "full_domain" | "airbox_only" = useMemo(() => {
    if (effectiveVectorDomainFilter === "airbox_only") {
      return "airbox_only";
    }
    if (effectiveVectorDomainFilter === "full_domain") {
      return "full_domain";
    }
    if (effectiveVectorDomainFilter === "magnetic_only") {
      return "magnetic_only";
    }
    return meshData.quantityDomain === "full_domain" ? "full_domain" : "magnetic_only";
  }, [effectiveVectorDomainFilter, meshData.quantityDomain]);
  const arrowActiveNodeMask = useMemo(() => {
    if (resolvedVectorDomain === "full_domain") {
      return fullDomainArrowNodeMask;
    }
    if (resolvedVectorDomain === "airbox_only") {
      return airArrowNodeMask;
    }
    return magneticArrowNodeMask;
  }, [airArrowNodeMask, fullDomainArrowNodeMask, magneticArrowNodeMask, resolvedVectorDomain]);
  const arrowBoundaryFaceIndices = useMemo(() => {
    if (resolvedVectorDomain === "full_domain") {
      return null;
    }
    if (resolvedVectorDomain === "airbox_only") {
      return airBoundaryFaceIndices;
    }
    return magneticBoundaryFaceIndices;
  }, [airBoundaryFaceIndices, magneticBoundaryFaceIndices, resolvedVectorDomain]);
  const baseArrowDensity = useMemo(
    () => maxPointsToGlyphBudget(resolvedPreviewMaxPoints),
    [resolvedPreviewMaxPoints],
  );
  const baselineArrowNodeCount = useMemo(() => {
    if (meshData.nNodes <= 0) {
      return 0;
    }
    if (resolvedVectorDomain === "full_domain") {
      return meshData.nNodes;
    }
    if (meshData.activeMask && meshData.activeMask.length === meshData.nNodes) {
      const count = countActiveNodes(meshData.activeMask);
      return count > 0 ? count : meshData.nNodes;
    }
    return meshData.nNodes;
  }, [meshData.activeMask, meshData.nNodes, resolvedVectorDomain]);
  const visibleArrowNodeCount = useMemo(() => {
    if (
      arrowActiveNodeMask &&
      arrowActiveNodeMask.length === meshData.nNodes
    ) {
      return countActiveNodes(arrowActiveNodeMask);
    }
    return baselineArrowNodeCount;
  }, [arrowActiveNodeMask, baselineArrowNodeCount, meshData.nNodes]);
  const effectiveArrowDensity = useMemo(() => {
    if (baseArrowDensity <= 0 || baselineArrowNodeCount <= 0 || visibleArrowNodeCount <= 0) {
      return 0;
    }
    const visibleRatio = Math.min(
      1,
      Math.max(0, visibleArrowNodeCount / baselineArrowNodeCount),
    );
    const scaled = Math.round(baseArrowDensity * visibleRatio);
    if (visibleRatio >= 0.999) {
      return Math.max(1, Math.min(baseArrowDensity, scaled));
    }
    const minBudget = Math.min(GLYPH_BUDGET_MIN, baseArrowDensity);
    return Math.max(minBudget, Math.min(baseArrowDensity, scaled));
  }, [baseArrowDensity, baselineArrowNodeCount, visibleArrowNodeCount]);
  const runtimeQualityProfile = useMemo<ViewportQualityProfileId>(() => {
    if (FRONTEND_DIAGNOSTIC_FLAGS.femViewport.forceLowQualityProfile) {
      return "interactive-lite";
    }
    if (captureActive) {
      return "capture";
    }
    return interactionActive ? "interactive-lite" : qualityProfile;
  }, [captureActive, interactionActive, qualityProfile]);
  const runtimeRenderMode = useMemo<RenderMode>(() => {
    if (!interactionActive) {
      return renderMode;
    }
    if (renderMode === "surface+edges" || renderMode === "points") {
      return "surface";
    }
    return renderMode;
  }, [interactionActive, renderMode]);
  const runtimeArrowDensity = useMemo(() => {
    if (!interactionActive || effectiveArrowDensity <= 0) {
      return effectiveArrowDensity;
    }
    return Math.max(GLYPH_BUDGET_MIN, Math.round(effectiveArrowDensity * 0.45));
  }, [effectiveArrowDensity, interactionActive]);
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
  const shouldRenderMagneticGeometryResolved =
    shouldRenderMagneticGeometry &&
    !(
      effectiveVectorDomainFilter === "airbox_only" &&
      ferromagnetVisibilityMode === "hide"
    );
  const shouldRenderAirGeometry =
    !hasMeshParts &&
    (!selectedObjectId || effectiveVectorDomainFilter === "airbox_only") &&
    airSegmentVisible &&
    airSegmentIds.size > 0 &&
    hasAirDisplayContent;
  const baseViewStateByPartId = useMemo(() => {
    const next = new Map<string, MeshEntityViewState>();
    if (!hasMeshParts) {
      return next;
    }
    for (const part of meshParts) {
      next.set(part.id, meshEntityViewState[part.id] ?? defaultMeshEntityViewState(part));
    }
    return next;
  }, [hasMeshParts, meshEntityViewState, meshParts]);
  
  const topologySignature = topologyKey ?? `${meshData.nNodes}:${meshData.nElements}:${meshData.boundaryFaces.length}`;
  const toolbarStylePartIds = useMemo(() => {
    if (!hasMeshParts) {
      return [] as string[];
    }
    // When a specific part is selected, scope toolbar to that part only.
    // Otherwise, target all visible parts (global mode).
    const selectedLayer = visibleLayers.find((layer) => layer.isSelected);
    if (selectedLayer) {
      return [selectedLayer.part.id];
    }
    return visibleLayers.map((layer) => layer.part.id);
  }, [hasMeshParts, visibleLayers]);
  const toolbarStylePartIdSet = useMemo(
    () => new Set(toolbarStylePartIds),
    [toolbarStylePartIds],
  );
  const toolbarColorPartIds = useMemo(() => {
    if (!hasMeshParts) {
      return [] as string[];
    }
    const magneticIds = visibleLayers
      .filter(
        (layer) =>
          toolbarStylePartIdSet.has(layer.part.id) && layer.part.role === "magnetic_object",
      )
      .map((layer) => layer.part.id);
    if (magneticIds.length > 0) {
      return magneticIds;
    }
    const nonAirIds = visibleLayers
      .filter((layer) => toolbarStylePartIdSet.has(layer.part.id) && layer.part.role !== "air")
      .map((layer) => layer.part.id);
    return nonAirIds.length > 0 ? nonAirIds : toolbarStylePartIds;
  }, [hasMeshParts, toolbarStylePartIdSet, toolbarStylePartIds, visibleLayers]);
  const toolbarRenderMode = useMemo(() => {
    if (!hasMeshParts || toolbarStylePartIds.length === 0) {
      return renderMode;
    }
    const values = Array.from(
      new Set(
        toolbarStylePartIds
          .map((partId) => baseViewStateByPartId.get(partId)?.renderMode)
          .filter((value): value is RenderMode => Boolean(value)),
      ),
    );
    if (values.length === 1) {
      return values[0] ?? renderMode;
    }
    return renderMode;
  }, [baseViewStateByPartId, hasMeshParts, renderMode, toolbarStylePartIds]);
  const toolbarRenderModeMixed = useMemo(() => {
    if (!hasMeshParts || toolbarStylePartIds.length <= 1) return false;
    const modes = new Set(
      toolbarStylePartIds
        .map((id) => baseViewStateByPartId.get(id)?.renderMode)
        .filter(Boolean),
    );
    return modes.size > 1;
  }, [baseViewStateByPartId, hasMeshParts, toolbarStylePartIds]);
  const toolbarRepresentativePartId = useMemo(() => {
    if (!hasMeshParts || toolbarStylePartIds.length === 0) {
      return null;
    }
    const targetLayers = visibleLayers.filter((layer) => toolbarStylePartIdSet.has(layer.part.id));
    const magneticId = targetLayers.find((layer) => layer.part.role === "magnetic_object")?.part.id;
    if (magneticId) {
      return magneticId;
    }
    const nonAirId = targetLayers.find((layer) => layer.part.role !== "air")?.part.id;
    return nonAirId ?? targetLayers[0]?.part.id ?? null;
  }, [hasMeshParts, toolbarStylePartIdSet, toolbarStylePartIds.length, visibleLayers]);
  const toolbarOpacity = useMemo(() => {
    if (!hasMeshParts || !toolbarRepresentativePartId) {
      return opacity;
    }
    return baseViewStateByPartId.get(toolbarRepresentativePartId)?.opacity ?? opacity;
  }, [baseViewStateByPartId, hasMeshParts, opacity, toolbarRepresentativePartId]);
  const toolbarOpacityMixed = useMemo(() => {
    if (!hasMeshParts || toolbarStylePartIds.length <= 1) return false;
    const values = new Set(
      toolbarStylePartIds
        .map((id) => baseViewStateByPartId.get(id)?.opacity)
        .filter((v): v is number => v != null),
    );
    return values.size > 1;
  }, [baseViewStateByPartId, hasMeshParts, toolbarStylePartIds]);
  const toolbarColorFieldMixed = useMemo(() => {
    if (!hasMeshParts || toolbarColorPartIds.length <= 1) return false;
    const values = new Set(
      toolbarColorPartIds
        .map((id) => baseViewStateByPartId.get(id)?.colorField)
        .filter(Boolean),
    );
    return values.size > 1;
  }, [baseViewStateByPartId, hasMeshParts, toolbarColorPartIds]);
  const toolbarColorField = useMemo(() => {
    if (!hasMeshParts || toolbarColorPartIds.length === 0) {
      return field;
    }
    const values = Array.from(
      new Set(
        toolbarColorPartIds
          .map((partId) => baseViewStateByPartId.get(partId)?.colorField)
          .filter((value): value is FemColorField => Boolean(value)),
      ),
    );
    if (values.length === 1) {
      return values[0] ?? field;
    }
    return field;
  }, [baseViewStateByPartId, field, hasMeshParts, toolbarColorPartIds]);
  const prominentQuantityOptions = useMemo(
    () => quantityOptions.filter((option) => option.available),
    [quantityOptions],
  );
  const effectiveOpacity = opacity;
  const arrowField: FemColorField =
    arrowColorMode === "monochrome"
      ? "orientation"
      : SUPPORTED_ARROW_COLOR_FIELDS.has(arrowColorMode)
        ? (arrowColorMode as FemColorField)
        : "orientation";
  const legendField = hasMeshParts
    ? (() => {
      const selectedPartId = visibleLayers.find((layer) => layer.isSelected)?.part.id ?? null;
      if (selectedPartId) {
        const selectedField = baseViewStateByPartId.get(selectedPartId)?.colorField;
        if (selectedField) {
          return selectedField;
        }
      }
      const magneticPartId = visibleLayers.find((layer) => layer.isMagnetic)?.part.id ?? null;
      if (magneticPartId) {
        const magneticField = baseViewStateByPartId.get(magneticPartId)?.colorField;
        if (magneticField) {
          return magneticField;
        }
      }
      return toolbarColorField;
    })()
    : toolbarColorField;
  const effectiveShowArrows =
    showArrows &&
    !missingMagneticMask &&
    visibleArrowNodeCount > 0;
  const arrowsBlockReason = useMemo<string | null>(() => {
    if (!showArrows) return null;
    if (missingMagneticMask) return "No magnetic field data available for vector display";
    if (visibleArrowNodeCount <= 0) return "No visible nodes match current vector domain filter";
    return null;
  }, [missingMagneticMask, showArrows, visibleArrowNodeCount]);
  const toolbarScopeLabel = useMemo<string | null>(() => {
    if (!hasMeshParts || toolbarStylePartIds.length === 0) return null;
    if (toolbarStylePartIds.length === 1) {
      const part = meshParts.find((p) => p.id === toolbarStylePartIds[0]);
      return part ? `Selected: ${part.label ?? part.id}` : "Selected: 1 part";
    }
    return `All visible (${toolbarStylePartIds.length})`;
  }, [hasMeshParts, meshParts, toolbarStylePartIds]);
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
    if (controlledArrowColorMode != null) {
      return;
    }
    setInternalArrowColorMode(
      SUPPORTED_ARROW_COLOR_FIELDS.has(colorField as FemArrowColorMode)
        ? (colorField as FemArrowColorMode)
        : "orientation",
    );
  }, [colorField, controlledArrowColorMode]);
  useEffect(() => {
    setSelectedFaces([]); setHoveredFace(null); setCtxMenu(null);
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
  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = () => setCtxMenu(null);
    window.addEventListener("click", dismiss, { once: true });
    return () => window.removeEventListener("click", dismiss);
  }, [ctxMenu]);

  const { dynamicGeomCenter, dynamicGeomSize, dynamicMaxDim } = useMemo(() => {
    if (!wrapperFlags.enableBoundsDerivedModel) {
      return {
        dynamicGeomCenter: new THREE.Vector3(0, 0, 0),
        dynamicGeomSize: [1, 1, 1] as [number, number, number],
        dynamicMaxDim: 1,
      };
    }
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
      if (shouldRenderMagneticGeometryResolved) tryAddFaceIndices(magneticBoundaryFaceIndices);
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
  }, [
    airBoundaryFaceIndices,
    hasMeshParts,
    magneticBoundaryFaceIndices,
    meshData.boundaryFaces,
    meshData.nodes,
    shouldRenderAirGeometry,
    shouldRenderMagneticGeometryResolved,
    visibleLayers,
    wrapperFlags.enableBoundsDerivedModel,
  ]);

  const resolvedWorldTextureTransform = useMemo(() => {
    if (!activeTextureTransform) {
      return null;
    }
    const transform: TextureTransform3D = {
      translation: [...activeTextureTransform.translation] as [number, number, number],
      rotation_quat: [...activeTextureTransform.rotation_quat] as [number, number, number, number],
      scale: [...activeTextureTransform.scale] as [number, number, number],
      pivot: [...activeTextureTransform.pivot] as [number, number, number],
    };
    const isDefaultTranslation = transform.translation.every((value) => Math.abs(value) < 1e-18);
    const isDefaultScale = transform.scale.every((value) => Math.abs(value - 1) < 1e-9);
    if (!selectedObjectOverlay || (!isDefaultTranslation && !isDefaultScale)) {
      return transform;
    }
    const boundsCenter: [number, number, number] = [
      0.5 * (selectedObjectOverlay.boundsMin[0] + selectedObjectOverlay.boundsMax[0]),
      0.5 * (selectedObjectOverlay.boundsMin[1] + selectedObjectOverlay.boundsMax[1]),
      0.5 * (selectedObjectOverlay.boundsMin[2] + selectedObjectOverlay.boundsMax[2]),
    ];
    const boundsExtent: [number, number, number] = [
      Math.max(1e-12, selectedObjectOverlay.boundsMax[0] - selectedObjectOverlay.boundsMin[0]),
      Math.max(1e-12, selectedObjectOverlay.boundsMax[1] - selectedObjectOverlay.boundsMin[1]),
      Math.max(1e-12, selectedObjectOverlay.boundsMax[2] - selectedObjectOverlay.boundsMin[2]),
    ];
    return {
      ...transform,
      translation: isDefaultTranslation ? boundsCenter : transform.translation,
      scale: isDefaultScale ? boundsExtent : transform.scale,
      pivot: isDefaultTranslation ? boundsCenter : transform.pivot,
    };
  }, [activeTextureTransform, selectedObjectOverlay]);

  const sceneTextureTransform = useMemo(() => {
    if (!wrapperFlags.enableTextureTransformModel) {
      return null;
    }
    if (!resolvedWorldTextureTransform) {
      return null;
    }
    return {
      translation: [
        resolvedWorldTextureTransform.translation[0] - dynamicGeomCenter.x,
        resolvedWorldTextureTransform.translation[1] - dynamicGeomCenter.y,
        resolvedWorldTextureTransform.translation[2] - dynamicGeomCenter.z,
      ] as [number, number, number],
      rotation_quat: [...resolvedWorldTextureTransform.rotation_quat] as [number, number, number, number],
      scale: [...resolvedWorldTextureTransform.scale] as [number, number, number],
      pivot: [
        resolvedWorldTextureTransform.pivot[0] - dynamicGeomCenter.x,
        resolvedWorldTextureTransform.pivot[1] - dynamicGeomCenter.y,
        resolvedWorldTextureTransform.pivot[2] - dynamicGeomCenter.z,
      ] as [number, number, number],
    } as TextureTransform3D;
  }, [dynamicGeomCenter.x, dynamicGeomCenter.y, dynamicGeomCenter.z, resolvedWorldTextureTransform, wrapperFlags.enableTextureTransformModel]);

  const handleTextureTransformLiveChange = useCallback(
    (next: TextureTransform3D) => {
      if (!onTextureTransformChange) {
        return;
      }
      onTextureTransformChange({
        translation: [
          next.translation[0] + dynamicGeomCenter.x,
          next.translation[1] + dynamicGeomCenter.y,
          next.translation[2] + dynamicGeomCenter.z,
        ] as [number, number, number],
        rotation_quat: [...next.rotation_quat] as [number, number, number, number],
        scale: [...next.scale] as [number, number, number],
        pivot: [
          next.pivot[0] + dynamicGeomCenter.x,
          next.pivot[1] + dynamicGeomCenter.y,
          next.pivot[2] + dynamicGeomCenter.z,
        ] as [number, number, number],
      });
    },
    [dynamicGeomCenter.x, dynamicGeomCenter.y, dynamicGeomCenter.z, onTextureTransformChange],
  );

  const handleTextureTransformCommit = useCallback(
    (next: TextureTransform3D) => {
      if (!onTextureTransformCommit) {
        return;
      }
      onTextureTransformCommit({
        translation: [
          next.translation[0] + dynamicGeomCenter.x,
          next.translation[1] + dynamicGeomCenter.y,
          next.translation[2] + dynamicGeomCenter.z,
        ] as [number, number, number],
        rotation_quat: [...next.rotation_quat] as [number, number, number, number],
        scale: [...next.scale] as [number, number, number],
        pivot: [
          next.pivot[0] + dynamicGeomCenter.x,
          next.pivot[1] + dynamicGeomCenter.y,
          next.pivot[2] + dynamicGeomCenter.z,
        ] as [number, number, number],
      });
    },
    [dynamicGeomCenter.x, dynamicGeomCenter.y, dynamicGeomCenter.z, onTextureTransformCommit],
  );

  const lastFittedGeomRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!wrapperFlags.enableCameraFitEffect) {
      return;
    }
    const m = dynamicMaxDim;
    const c = dynamicGeomCenter;
    const sig = `${m.toFixed(4)}_${c.x.toFixed(4)}_${c.y.toFixed(4)}_${c.z.toFixed(4)}`;
    if (lastFittedGeomRef.current !== sig) {
      lastFittedGeomRef.current = sig;
      setCameraFitGeneration((g) => g + 1);
    }
  }, [dynamicMaxDim, dynamicGeomCenter, wrapperFlags.enableCameraFitEffect]);

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

  const takeScreenshot = useCallback(async () => {
    if (!wrapperFlags.enableScreenshotCapture) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const previousProfile = qualityProfileRef.current;
    setCaptureOverlayHidden(true);
    setCaptureActive(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    exportCanvasAsImage(canvas, `fem-mesh-${Date.now()}`, {
      pixelRatio: 4,
      backgroundColor: "#171726",
      format: "png",
    });
    setCaptureActive(false);
    setQualityProfile(previousProfile);
    setCaptureOverlayHidden(false);
  }, [wrapperFlags.enableScreenshotCapture]);

  const faceAspectRatios = useMemo(
    () => computeFaceAspectRatios(meshData.nodes, meshData.boundaryFaces),
    [meshData.nodes, meshData.boundaryFaces],
  );

  const hoveredFaceInfo = useMemo(() => {
    if (!wrapperFlags.enableHoverTooltip) {
      return null;
    }
    if (!hoveredFace) return null;
    const idx = hoveredFace.idx;
    const ar = faceAspectRatios[idx] ?? 0;
    return { faceIdx: idx, ar, sicn: qualityPerFace?.[idx] };
  }, [faceAspectRatios, hoveredFace, qualityPerFace, wrapperFlags.enableHoverTooltip]);
  const applyToolbarRenderMode = useCallback((next: RenderMode) => {
    const preset = RENDER_MODE_DISPLAY_PRESETS[next];
    const resetDisplayState =
      FRONTEND_DIAGNOSTIC_FLAGS.femViewport.resetDisplayStateOnRenderModeChange;

    if (hasMeshParts && toolbarStylePartIds.length > 0 && onMeshPartViewStatePatch) {
      if (resetDisplayState) {
        onMeshPartViewStatePatch(toolbarStylePartIds, {
          renderMode: next,
          opacity: preset.opacity,
        });
      } else {
        onMeshPartViewStatePatch(toolbarStylePartIds, { renderMode: next });
      }
      // Sync global meshRenderMode so chip display & serialization stay accurate.
      onRenderModeChange?.(next);
    } else {
      if (onRenderModeChange) {
        onRenderModeChange(next);
      } else {
        setInternalRenderMode(next);
      }
      if (resetDisplayState) {
        if (onOpacityChange) {
          onOpacityChange(preset.opacity);
        } else {
          setInternalOpacity(preset.opacity);
        }
      }
    }

    if (!resetDisplayState) {
      return;
    }
    if (onClipEnabledChange) {
      onClipEnabledChange(preset.clipEnabled);
    } else {
      setInternalClipEnabled(preset.clipEnabled);
    }
    if (onClipAxisChange) {
      onClipAxisChange(preset.clipAxis);
    } else {
      setInternalClipAxis(preset.clipAxis);
    }
    if (onClipPosChange) {
      onClipPosChange(preset.clipPos);
    } else {
      setInternalClipPos(preset.clipPos);
    }
    if (onShowArrowsChange) {
      onShowArrowsChange(preset.showArrows);
    } else {
      setInternalShowArrows(preset.showArrows);
    }
    if (onVectorDomainFilterChange) {
      onVectorDomainFilterChange(preset.vectorDomainFilter);
    } else {
      setInternalVectorDomainFilter(preset.vectorDomainFilter);
    }
    if (onFerromagnetVisibilityModeChange) {
      onFerromagnetVisibilityModeChange(preset.ferromagnetVisibilityMode);
    } else {
      setInternalFerromagnetVisibilityMode(preset.ferromagnetVisibilityMode);
    }
    if (onShrinkFactorChange) {
      onShrinkFactorChange(preset.shrinkFactor);
    } else {
      setInternalShrinkFactor(preset.shrinkFactor);
    }
    setQualityProfile(preset.qualityProfile);
    updateSharedPreviewMaxPoints(PREVIEW_MAX_POINTS_DEFAULT);
    setOpenPopover(null);
  }, [
    hasMeshParts,
    onClipAxisChange,
    onClipEnabledChange,
    onClipPosChange,
    onFerromagnetVisibilityModeChange,
    onMeshPartViewStatePatch,
    onOpacityChange,
    onRenderModeChange,
    onShowArrowsChange,
    onShrinkFactorChange,
    onVectorDomainFilterChange,
    toolbarStylePartIds,
    updateSharedPreviewMaxPoints,
  ]);
  const applyToolbarOpacity = useCallback((next: number) => {
    if (hasMeshParts && toolbarStylePartIds.length > 0 && onMeshPartViewStatePatch) {
      onMeshPartViewStatePatch(toolbarStylePartIds, { opacity: next });
      return;
    }
    if (onOpacityChange) {
      onOpacityChange(next);
    } else {
      setInternalOpacity(next);
    }
  }, [hasMeshParts, onMeshPartViewStatePatch, onOpacityChange, toolbarStylePartIds]);
  const applyToolbarColorField = useCallback((next: FemColorField) => {
    setField(next);
    if (hasMeshParts && toolbarColorPartIds.length > 0 && onMeshPartViewStatePatch) {
      onMeshPartViewStatePatch(toolbarColorPartIds, { colorField: next });
      return;
    }
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
    arrowColorMode === "orientation";
  useEffect(() => {
    qualityProfileRef.current = qualityProfile;
  }, [qualityProfile]);
  useEffect(() => {
    if (interactionActive) {
      setHoveredFace(null);
    }
  }, [interactionActive]);
  useEffect(() => {
    if (geometryPointerInteractionsEnabled) {
      return;
    }
    setHoveredFace(null);
    setCtxMenu(null);
    setSelectedFaces([]);
  }, [geometryPointerInteractionsEnabled]);
  const overlayItems = useMemo<ViewportOverlayDescriptor[]>(() => {
    if (!wrapperFlags.enableOverlayItemsModel) {
      return [];
    }
    if (captureOverlayHidden) {
      return [];
    }
    const items: ViewportOverlayDescriptor[] = [];
    if (FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showToolbar && toolbarMode !== "hidden") {
      items.push({
        id: "toolbar",
        anchor: "top-left",
        priority: 1,
        minWidth: 1080,
        collapseTarget: "icon",
        render: ({ variant }) => (
          <FemViewportToolbar
            compact={variant !== "full"}
            renderMode={toolbarRenderMode}
            surfaceColorField={toolbarColorField}
            arrowColorMode={arrowColorMode}
            arrowMonoColor={arrowMonoColor}
            arrowAlpha={arrowAlpha}
            arrowLengthScale={arrowLengthScale}
            arrowThickness={arrowThickness}
            projection={cameraProjection}
            navigation={navigationMode}
            qualityProfile={qualityProfile}
            clipEnabled={clipEnabled}
            clipAxis={clipAxis}
            clipPos={clipPos}
            arrowsVisible={showArrows}
            arrowDensity={baseArrowDensity}
            effectiveArrowDensity={effectiveArrowDensity}
            vectorDomainFilter={effectiveVectorDomainFilter}
            supportsAirboxOnlyVectors={supportsAirboxOnlyVectors}
            ferromagnetVisibilityMode={ferromagnetVisibilityMode}
            opacity={toolbarOpacity}
            shrinkFactor={shrinkFactor}
            showShrink={meshData.elements.length >= 4}
            labeledMode={variant === "full" ? labeledMode : false}
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
            onArrowColorModeChange={(next) => {
              if (onArrowColorModeChange) {
                onArrowColorModeChange(next);
              } else {
                setInternalArrowColorMode(next);
              }
            }}
            onArrowMonoColorChange={(next) => {
              if (onArrowMonoColorChange) {
                onArrowMonoColorChange(next);
              } else {
                setInternalArrowMonoColor(next);
              }
            }}
            onArrowAlphaChange={(next) => {
              if (onArrowAlphaChange) {
                onArrowAlphaChange(next);
              } else {
                setInternalArrowAlpha(next);
              }
            }}
            onArrowLengthScaleChange={(next) => {
              if (onArrowLengthScaleChange) {
                onArrowLengthScaleChange(next);
              } else {
                setInternalArrowLengthScale(next);
              }
            }}
            onArrowThicknessChange={(next) => {
              if (onArrowThicknessChange) {
                onArrowThicknessChange(next);
              } else {
                setInternalArrowThickness(next);
              }
            }}
            onProjectionChange={setCameraProjection}
            onNavigationChange={setNavigationMode}
            onQualityProfileChange={setQualityProfile}
            onClipEnabledChange={(v) => {
              if (onClipEnabledChange) {
                onClipEnabledChange(v);
              } else {
                setInternalClipEnabled(v);
              }
            }}
            onClipAxisChange={(a) => {
              if (onClipAxisChange) {
                onClipAxisChange(a);
              } else {
                setInternalClipAxis(a);
              }
            }}
            onClipPosChange={(v) => {
              if (onClipPosChange) {
                onClipPosChange(v);
              } else {
                setInternalClipPos(v);
              }
            }}
            onArrowsVisibleChange={(v) => {
              if (onShowArrowsChange) {
                onShowArrowsChange(v);
              } else {
                setInternalShowArrows(v);
              }
            }}
            onArrowDensityChange={(nextBudget) => {
              updateSharedPreviewMaxPoints(glyphBudgetToMaxPoints(nextBudget));
            }}
            onVectorDomainFilterChange={(next) => {
              if (onVectorDomainFilterChange) {
                onVectorDomainFilterChange(next);
              } else {
                setInternalVectorDomainFilter(next);
              }
            }}
            onFerromagnetVisibilityModeChange={(next) => {
              if (onFerromagnetVisibilityModeChange) {
                onFerromagnetVisibilityModeChange(next);
              } else {
                setInternalFerromagnetVisibilityMode(next);
              }
            }}
            onOpacityChange={applyToolbarOpacity}
            onShrinkFactorChange={(v) => {
              if (onShrinkFactorChange) {
                onShrinkFactorChange(v);
              } else {
                setInternalShrinkFactor(v);
              }
            }}
            onLabeledModeChange={setLabeledMode}
            onToggleLegend={() => setLegendOpen((prev) => !prev)}
            onTogglePartExplorer={() => setPartExplorerOpen((prev) => !prev)}
            onCameraPreset={setCameraPreset}
            onCapture={takeScreenshot}
            quantityId={quantityId}
            quantityOptions={prominentQuantityOptions}
            onQuantityChange={onQuantityChange}
            renderModeMixed={toolbarRenderModeMixed}
            opacityMixed={toolbarOpacityMixed}
            colorFieldMixed={toolbarColorFieldMixed}
            arrowsRequested={showArrows}
            arrowsBlockReason={arrowsBlockReason}
            toolbarScopeLabel={toolbarScopeLabel}
            interactionSimplified={interactionActive}
          />
        ),
      });
    }
    if (FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showWarnings && missingExactScopeSegment && selectedObjectId) {
      items.push({
        id: "segment-warning",
        anchor: "top-left",
        priority: 2,
        minWidth: 960,
        collapseTarget: "drawer",
        render: () => (
          <div className="pointer-events-none rounded-xl border border-error/25 bg-background/85 px-4 py-3 text-sm text-error/90 shadow-lg backdrop-blur-md">
            Object mesh segmentation unavailable for shared-domain FEM: `{selectedObjectId}`
          </div>
        ),
      });
    }
    if (FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showWarnings && missingMagneticMask) {
      items.push({
        id: "mask-warning",
        anchor: "top-left",
        priority: 3,
        minWidth: 960,
        collapseTarget: "drawer",
        render: () => (
          <div className="pointer-events-none rounded-xl border border-warning/25 bg-background/85 px-4 py-3 text-sm text-warning/90 shadow-lg backdrop-blur-md">
            Magnetic masking unavailable for shared-domain FEM. View shows built airbox.
          </div>
        ),
      });
    }
    if (FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showViewCube) {
      items.push({
        id: "gizmo-stack",
        anchor: "top-right",
        priority: 3,
        render: () => (
          <div className="flex flex-col items-end gap-2">
            <ViewCube
              sceneRef={viewCubeSceneRef}
              onRotate={handleViewCubeRotate}
              onReset={() => setCameraPreset("reset")}
              embedded
            />
          </div>
        ),
      });
    }
    if (FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showPartExplorer && hasMeshParts && partExplorerOpen) {
      items.push({
        id: "part-explorer",
        anchor: "right",
        priority: 2,
        minWidth: 1280,
        collapseTarget: "drawer",
        render: ({ variant }) =>
          variant === "drawer" ? (
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
          ) : (
            <DraggableViewportBlock defaultOffset={{ x: 0, y: variant === "full" ? 10 : 6 }}>
              {({ dragHandleProps }) => (
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
                  dragHandleProps={dragHandleProps}
                />
              )}
            </DraggableViewportBlock>
          ),
      });
    }
    if (FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showFieldLegend && legendOpen) {
      items.push({
        id: "field-legend",
        anchor: "bottom-left",
        priority: 4,
        render: ({ variant }) => (
          <FieldLegend
            compact={variant !== "full"}
            className="pointer-events-none z-10"
            colorLabel={colorLegendLabel(legendField, fieldLabel)}
            lengthLabel={
              effectiveShowArrows
                ? arrowColorMode === "orientation"
                  ? "vector magnitude, arrow color = orientation"
                  : arrowColorMode === "monochrome"
                    ? "vector magnitude, arrow color = monochrome"
                    : `vector magnitude, arrow color = ${colorLegendLabel(arrowField, fieldLabel)}`
                : undefined
            }
            min={legendField === "none" ? undefined : fieldMagnitudeStats?.min}
            max={legendField === "none" ? undefined : fieldMagnitudeStats?.max}
            mean={legendField === "none" ? undefined : fieldMagnitudeStats?.mean}
            gradient={colorLegendGradient(legendField)}
          />
        ),
      });
    }
    if (FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showOrientationSphere && effectiveShowOrientationLegend) {
      items.push({
        id: "orientation-legend",
        anchor: "bottom-left",
        priority: 5,
        render: ({ variant }) => (
          <HslSphere
            sceneRef={viewCubeSceneRef}
            axisConvention="identity"
            compact={variant !== "full"}
            embedded
          />
        ),
      });
    }
    if (FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showSelectionHud) {
      items.push({
        id: "selection-hud",
        anchor: "bottom-center",
        priority: 5,
        render: ({ variant }) => (
          <>
            <FemSelectionHUD
              compact={variant !== "full"}
              nNodes={meshData.nNodes}
              nElements={meshData.nElements}
              nFaces={meshData.boundaryFaces.length / 3}
              clipEnabled={clipEnabled}
              clipAxis={clipAxis}
              clipPos={clipPos}
              selectedFacesCount={selectedFaces.length}
            />
            {onRefine ? (
              <FemRefineToolbar
                className={variant === "icon" ? "max-w-full flex-wrap justify-center" : undefined}
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
          </>
        ),
      });
    }
    return items;
  }, [
    applyToolbarColorField,
    applyToolbarOpacity,
    applyToolbarRenderMode,
    arrowField,
    arrowColorMode,
    arrowMonoColor,
    arrowAlpha,
    arrowLengthScale,
    arrowThickness,
    arrowsBlockReason,
    baseArrowDensity,
    cameraProjection,
    captureOverlayHidden,
    clipAxis,
    clipEnabled,
    clipPos,
    effectiveShowArrows,
    effectiveArrowDensity,
    effectiveShowOrientationLegend,
    fieldLabel,
    fieldMagnitudeStats?.max,
    fieldMagnitudeStats?.mean,
    fieldMagnitudeStats?.min,
    focusedEntityId,
    handlePartSelect,
    handleRoleVisibility,
    handleViewCubeRotate,
    hasMeshParts,
    inspectedMeshPart,
    inspectedPartQuality,
    interactionActive,
    labeledMode,
    legendField,
    legendOpen,
    meshData.boundaryFaces.length,
    meshData.elements.length,
    meshData.nElements,
    meshData.nNodes,
    meshEntityViewState,
    meshParts,
    missingExactScopeSegment,
    missingMagneticMask,
    navigationMode,
    onClipAxisChange,
    onClipEnabledChange,
    onClipPosChange,
    onArrowAlphaChange,
    onArrowColorModeChange,
    onArrowLengthScaleChange,
    onArrowMonoColorChange,
    onArrowThicknessChange,
    onFerromagnetVisibilityModeChange,
    onEntityFocus,
    onQuantityChange,
    onRefine,
    onShowArrowsChange,
    onShrinkFactorChange,
    onVectorDomainFilterChange,
    openPopover,
    partExplorerGroups,
    partExplorerOpen,
    partQualityById,
    patchSinglePart,
    prominentQuantityOptions,
    qualityProfile,
    quantityId,
    roleVisibilitySummary,
    selectedEntityId,
    selectedFaces,
    selectedObjectId,
    setCameraPreset,
    shrinkFactor,
    showArrows,
    supportsAirboxOnlyVectors,
    takeScreenshot,
    toolbarColorField,
    toolbarColorFieldMixed,
    toolbarMode,
    toolbarOpacity,
    toolbarOpacityMixed,
    toolbarRenderMode,
    toolbarRenderModeMixed,
    toolbarScopeLabel,
    effectiveVectorDomainFilter,
    ferromagnetVisibilityMode,
    updateSharedPreviewMaxPoints,
    viewCubeSceneRef,
    visibleLayers.length,
    wrapperFlags.enableOverlayItemsModel,
  ]);
  return (
    <div className="relative flex flex-1 w-[100%] h-[100%] min-w-0 min-h-0 bg-background overflow-hidden rounded-md fem-canvas-container">
      <ScientificViewportShell
        toolbar={
          null
        }
        hud={null}
        projection={cameraProjection}
        navigation={navigationMode}
        qualityProfile={runtimeQualityProfile}
        renderPolicy={{
          mode: "always",
          hidden: false,
          interactionActive,
        }}
        onInteractionChange={setInteractionActive}
        target={STABLE_ORIGIN}
        bridgeRef={viewCubeSceneRef}
        controlsRef={controlsRef}
        onViewCubeRotate={handleViewCubeRotate}
        onResetView={() => setCameraPreset("reset")}
        renderDefaultGizmos={false}
        onPointerMissed={geometryPointerInteractionsEnabled ? () => setSelectedFaces([]) : undefined}
        onCanvasContextMenu={(e) => e.preventDefault()}
        onCanvasCreated={({ gl }) => {
          canvasRef.current = gl.domElement;
        }}
        diagnosticOverrides={{
          enableControls: selectionOnlyInteractionMode ? false : true,
          forceFrameloopMode: "always",
        }}
      >
        {!missingExactScopeSegment ? (
          <>
          {FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showCameraAutoFit && wrapperFlags.enableCameraFitEffect ? (
            <CameraAutoFit maxDim={dynamicMaxDim} generation={cameraFitGeneration} controlsRef={controlsRef} />
          ) : null}
          {FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showClipPlanesHelper ? (
            <FemClipPlanes enabled={clipEnabled} axis={clipAxis} posPercentage={clipPos} geomSize={dynamicGeomSize} />
          ) : null}
          <FemViewportScene
            meshData={meshData}
            hasMeshParts={hasMeshParts}
            visibleLayers={visibleLayers}
            shouldRenderAirGeometry={shouldRenderAirGeometry}
            airBoundaryFaceIndices={airBoundaryFaceIndices}
            airElementIndices={airElementIndices}
            airSegmentOpacity={airSegmentOpacity}
            shouldRenderMagneticGeometry={shouldRenderMagneticGeometryResolved}
            magneticVisibilityMode={
              effectiveVectorDomainFilter === "airbox_only"
                ? ferromagnetVisibilityMode
                : "ghost"
            }
            field={field}
            renderMode={runtimeRenderMode}
            effectiveOpacity={effectiveOpacity}
            magneticBoundaryFaceIndices={magneticBoundaryFaceIndices}
            magneticElementIndices={magneticElementIndices}
            qualityPerFace={qualityPerFace}
            shrinkFactor={shrinkFactor}
            clipEnabled={clipEnabled}
            clipAxis={clipAxis}
            clipPos={clipPos}
            dynamicGeomCenter={dynamicGeomCenter}
            dynamicMaxDim={dynamicMaxDim}
            effectiveShowArrows={effectiveShowArrows}
            arrowField={arrowField}
            arrowDensity={runtimeArrowDensity}
            arrowColorMode={arrowColorMode}
            arrowMonoColor={arrowMonoColor}
            arrowAlpha={arrowAlpha}
            arrowLengthScale={arrowLengthScale}
            arrowThickness={arrowThickness}
            arrowActiveNodeMask={arrowActiveNodeMask}
            arrowBoundaryFaceIndices={arrowBoundaryFaceIndices}
            selectedFaces={selectedFaces}
            antennaOverlays={antennaOverlays}
            focusedEntityId={focusedEntityId}
            selectedAntennaId={selectedAntennaId}
            onAntennaTranslate={onAntennaTranslate}
            axesWorldExtent={axesWorldExtent}
            axesCenter={axesCenter}
            onFaceClick={geometryPointerInteractionsEnabled ? handleFaceClick : undefined}
            onFaceHover={geometryHoverInteractionsEnabled && !interactionActive ? handleFaceHover : undefined}
            onFaceUnhover={geometryHoverInteractionsEnabled ? handleFaceUnhover : undefined}
            onFaceContextMenu={geometryContextMenuEnabled ? handleFaceContextMenu : undefined}
            showSceneGeometry={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showSceneGeometry}
            showPerPartGeometry={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showPerPartGeometry}
            showAirGeometry={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showAirGeometry}
            showMagneticGeometry={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showMagneticGeometry}
            showSurfacePass={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showSurfacePass}
            showSurfaceHiddenEdgesPass={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showSurfaceHiddenEdgesPass}
            showSurfaceVisibleEdgesPass={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showSurfaceVisibleEdgesPass}
            showVolumeHiddenEdgesPass={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showVolumeHiddenEdgesPass}
            showVolumeVisibleEdgesPass={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showVolumeVisibleEdgesPass}
            showPointsPass={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showPointsPass}
            enableGeometryCompaction={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.enableGeometryCompaction}
            enableGeometryNormals={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.enableGeometryNormals}
            enableGeometryVertexColors={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.enableGeometryVertexColors}
            enableGeometryPointerInteractions={geometryPointerInteractionsEnabled}
            enableGeometryHoverInteractions={geometryHoverInteractionsEnabled}
            showArrowLayer={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showArrowLayer}
            showSelectionHighlight={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showSelectionHighlight}
            showAntennaOverlays={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showAntennaOverlays}
            showSceneAxes={FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showSceneAxes}
          />
          </>
        ) : null}

        {wrapperFlags.enableTextureTransformGizmo &&
        FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showTextureTransformGizmo &&
        sceneTextureTransform &&
        activeTransformScope === "texture" ? (
          <TextureTransformGizmo
            transform={sceneTextureTransform}
            mode={textureGizmoMode}
            previewProxy={activeTexturePreviewProxy}
            onLiveChange={handleTextureTransformLiveChange}
            onCommit={handleTextureTransformCommit}
            visible
          />
        ) : null}
      </ScientificViewportShell>
      {!captureOverlayHidden && wrapperFlags.enableOverlayManager ? <ViewportOverlayManager items={overlayItems} /> : null}

      {!captureOverlayHidden &&
      geometryHoverInteractionsEnabled &&
      wrapperFlags.enableHoverTooltip &&
      FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showHoverTooltip ? (
        <FemHoverTooltip hoveredFace={hoveredFace} hoveredFaceInfo={hoveredFaceInfo} />
      ) : null}

      {!captureOverlayHidden &&
      geometryContextMenuEnabled &&
      FRONTEND_DIAGNOSTIC_FLAGS.femViewport.showContextMenu ? (
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
            if (onClipEnabledChange) {
              onClipEnabledChange(next);
            } else {
              setInternalClipEnabled(next);
            }
            setCtxMenu(null);
          }}
          onClearSelection={() => {
            setSelectedFaces([]);
            setCtxMenu(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default memo(FemMeshView3DInner);
