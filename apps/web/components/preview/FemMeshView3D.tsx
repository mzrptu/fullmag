"use client";

import { useEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import { computeFaceAspectRatios } from "./r3f/colorUtils";
import {
  collectPartBoundaryFaceIndices,
  collectPartElementIndices,
  collectPartNodeMask,
  markersForPart,
  SUPPORTED_ARROW_COLOR_FIELDS,
} from "./fem/femGeometryUtils";
import { FemClipPlanes, CameraAutoFit } from "./fem/FemR3FHelpers";
import { useFemVectorDomain } from "./fem/useFemVectorDomain";
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
import type { VisibleSubmeshSnapshot } from "../runs/control-room/submeshSnapshot";
import { FieldLegend } from "./field/FieldLegend";
import { combineMeshQualityStats } from "./fem/femQualityUtils";
import { partMeshTint, partEdgeTint, colorLegendGradient, colorLegendLabel } from "./fem/femColorUtils";
import { FemViewportToolbar } from "./fem/FemViewportToolbar";
import { FemViewportScene } from "./fem/FemViewportScene";
import { FemContextMenu, FemHoverTooltip } from "./fem/FemContextMenu";
import { FemRefineToolbar, FemSelectionHUD } from "./fem/FemSelectionHUD";
import {
  PREVIEW_MAX_POINTS_DEFAULT,
  glyphBudgetToMaxPoints,
} from "./fem/vectorDensityBudget";
import HslSphere from "./HslSphere";
import ViewCube from "./ViewCube";
import ScientificViewportShell from "./shared/ScientificViewportShell";
import type { ViewportQualityProfileId } from "./shared/viewportQualityProfiles";
import {
  ViewportOverlayManager,
  type ViewportOverlayDescriptor,
} from "./ViewportOverlayManager";
import TextureTransformGizmo, {
  type TextureGizmoMode,
  type TexturePreviewProxy,
} from "./TextureTransformGizmo";
import type { TextureTransform3D } from "@/lib/textureTransform";
import { useFemToolbarModel } from "./fem/useFemToolbarModel";
import { useFemSceneGeometry } from "./fem/useFemSceneGeometry";
import { FRONTEND_DIAGNOSTIC_FLAGS } from "@/lib/debug/frontendDiagnosticFlags";
import { recordFrontendRender } from "@/lib/debug/frontendPerfDebug";
import { buildVisibleLayers } from "@/features/viewport-fem/model/femRenderModel";
export type {
  FemMeshData,
  MeshSelectionSnapshot,
  FemColorField,
  FemArrowColorMode,
  RenderMode,
  ClipAxis,
  FemVectorDomainFilter,
  FemFerromagnetVisibilityMode,
  RenderLayer,
} from "./fem/femMeshTypes";
import type {
  FemMeshData,
  MeshSelectionSnapshot,
  FemColorField,
  FemArrowColorMode,
  RenderMode,
  ClipAxis,
  FemVectorDomainFilter,
  FemFerromagnetVisibilityMode,
  RenderLayer,
} from "./fem/femMeshTypes";

const STABLE_ORIGIN: [number, number, number] = [0, 0, 0];

const AIR_OBJECT_SEGMENT_ID = "__air__";
const RENDER_MODE_DISPLAY_PRESETS: Record<
  RenderMode,
  {
    opacity: number;
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
    clipEnabled: false,
    clipAxis: "x",
    clipPos: 50,
    vectorDomainFilter: "auto",
    ferromagnetVisibilityMode: "hide",
    shrinkFactor: 1,
    qualityProfile: "interactive",
  },
};

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
  partExplorerOpen?: boolean;
  onTogglePartExplorer?: () => void;
  onVisibleSubmeshSnapshotChange?: (snapshot: VisibleSubmeshSnapshot | null) => void;
}

type CameraProjection = "perspective" | "orthographic";
type NavigationMode = "trackball" | "cad";

interface PartQualitySummary {
  markers: number[];
  domainCount: number;
  stats: MeshQualityStats | null;
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
  onQuantityChange,
  activeTextureTransform = null,
  textureGizmoMode = "translate",
  activeTexturePreviewProxy = "box",
  activeTransformScope = null,
  onTextureTransformChange,
  onTextureTransformCommit,
  partExplorerOpen: controlledPartExplorerOpen,
  onTogglePartExplorer,
  onVisibleSubmeshSnapshotChange,
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
  const [internalPartExplorerOpen, setInternalPartExplorerOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const [labeledMode, setLabeledMode] = useState(false);
  const [openPopover, setOpenPopover] = useState<"quantity" | "color" | "clip" | "display" | "vectors" | "camera" | "panels" | null>(null);
  const [qualityProfile, setQualityProfile] = useState<ViewportQualityProfileId>("interactive");
  const [interactionActive, setInteractionActive] = useState(false);
  const [textureGizmoDragging, setTextureGizmoDragging] = useState(false);
  const [captureActive, setCaptureActive] = useState(false);
  const [captureOverlayHidden, setCaptureOverlayHidden] = useState(false);
  
  const [hoveredFace, setHoveredFace] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; faceIdx: number } | null>(null);
  const [selectedFaces, setSelectedFaces] = useState<number[]>([]);
  const lastSubmeshSnapshotSignatureRef = useRef<string | null>(null);
  const partExplorerOpen = controlledPartExplorerOpen ?? internalPartExplorerOpen;
  

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
  // P3 consolidation: Delegate to pure buildVisibleLayers from femRenderModel.ts
  const visibleLayers = useMemo<RenderLayer[]>(() => {
    if (!wrapperFlags.enablePartDerivedModel || !hasMeshParts) {
      return [];
    }
    return buildVisibleLayers({
      meshParts,
      partRenderDataById,
      meshEntityViewState,
      objectViewMode,
      vectorDomainFilter: effectiveVectorDomainFilter,
      ferromagnetVisibilityMode,
      selectedObjectId: selectedObjectId ?? null,
      selectedEntityId,
      focusedEntityId,
      airSegmentVisible,
    });
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
  useEffect(() => {
    if (!onVisibleSubmeshSnapshotChange) {
      return;
    }
    if (!hasMeshParts) {
      if (lastSubmeshSnapshotSignatureRef.current !== null) {
        lastSubmeshSnapshotSignatureRef.current = null;
        onVisibleSubmeshSnapshotChange(null);
      }
      return;
    }
    const items = visibleLayers.map((layer) => {
      const quality = partQualityById.get(layer.part.id) ?? null;
      return {
        id: layer.part.id,
        role: layer.part.role,
        objectId: layer.part.object_id ?? null,
        isSelected: layer.isSelected,
        isFocused: focusedEntityId === layer.part.id,
        isDimmed: layer.isDimmed,
        markers: quality?.markers ?? [],
        domainCount: quality?.domainCount ?? 0,
        qualityStats: quality?.stats ?? null,
      };
    });
    const signature = [
      `total=${meshParts.length}`,
      `visible=${visibleLayers.length}`,
      `selected=${selectedEntityId ?? ""}`,
      `focused=${focusedEntityId ?? ""}`,
      items
        .map(
          (item) =>
            `${item.id}:${item.isSelected ? 1 : 0}:${item.isFocused ? 1 : 0}:${item.isDimmed ? 1 : 0}`,
        )
        .join("|"),
    ].join("::");
    if (signature === lastSubmeshSnapshotSignatureRef.current) {
      return;
    }
    lastSubmeshSnapshotSignatureRef.current = signature;
    onVisibleSubmeshSnapshotChange({
      signature,
      generatedAtUnixMs: Date.now(),
      selectedEntityId,
      focusedEntityId,
      totalPartsCount: meshParts.length,
      visiblePartsCount: visibleLayers.length,
      items,
    });
  }, [
    focusedEntityId,
    hasMeshParts,
    meshParts.length,
    onVisibleSubmeshSnapshotChange,
    partQualityById,
    selectedEntityId,
    visibleLayers,
  ]);
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
  const {
    magneticBoundaryFaceIndices,
    magneticElementIndices,
    airBoundaryFaceIndices,
    airElementIndices,
    arrowActiveNodeMask,
    arrowBoundaryFaceIndices,
    baseArrowDensity,
    effectiveArrowDensity,
    runtimeQualityProfile,
    runtimeRenderMode,
    runtimeArrowDensity,
    shouldRenderMagneticGeometryResolved,
    shouldRenderAirGeometry,
    visibleArrowNodeCount,
  } = useFemVectorDomain({
    enableVectorDerivedModel: wrapperFlags.enableVectorDerivedModel,
    missingExactScopeSegment,
    selectedObjectId,
    magneticSegments,
    meshData,
    visibleMagneticIds,
    objectSegments,
    airSegmentIds,
    hasMeshParts,
    visibleLayers,
    effectiveVectorDomainFilter,
    ferromagnetVisibilityMode,
    resolvedPreviewMaxPoints,
    captureActive,
    interactionActive,
    qualityProfile,
    renderMode,
    airSegmentVisible,
  });
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
  const {
    toolbarStylePartIds,
    toolbarStylePartIdSet,
    toolbarColorPartIds,
    toolbarRenderMode,
    toolbarRenderModeMixed,
    toolbarOpacity,
    toolbarOpacityMixed,
    toolbarColorFieldMixed,
    toolbarColorField,
    prominentQuantityOptions,
    arrowField,
    legendField,
    effectiveShowArrows,
    arrowsBlockReason,
    arrowToolbarState,
    toolbarScopeLabel,
    fieldMagnitudeStats,
  } = useFemToolbarModel({
    hasMeshParts,
    meshParts,
    visibleLayers,
    baseViewStateByPartId,
    renderMode,
    field,
    opacity,
    arrowColorMode,
    showArrows,
    missingMagneticMask,
    visibleArrowNodeCount,
    meshData,
    baseArrowDensity,
    effectiveArrowDensity,
    qualityPerFace,
    quantityOptions,
  });
  const effectiveOpacity = opacity;

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

  const {
    dynamicGeomCenter,
    dynamicGeomSize,
    dynamicMaxDim,
    axesWorldExtent,
    axesCenter,
    sceneMaxDim,
    resolvedWorldTextureTransform,
    sceneTextureTransform,
    handleTextureTransformLiveChange,
    handleTextureTransformCommit,
    setCameraPreset,
    focusObject,
    handleViewCubeRotate,
    takeScreenshot,
  } = useFemSceneGeometry({
    meshData,
    hasMeshParts,
    visibleLayers,
    airBoundaryFaceIndices,
    magneticBoundaryFaceIndices,
    shouldRenderAirGeometry,
    shouldRenderMagneticGeometryResolved,
    enableBoundsDerivedModel: wrapperFlags.enableBoundsDerivedModel,
    enableTextureTransformModel: wrapperFlags.enableTextureTransformModel,
    enableCameraFitEffect: wrapperFlags.enableCameraFitEffect,
    enableScreenshotCapture: wrapperFlags.enableScreenshotCapture,
    activeTextureTransform,
    selectedObjectOverlay,
    objectOverlays,
    focusObjectRequest,
    viewCubeSceneRef,
    canvasRef,
    qualityProfileRef,
    onTextureTransformChange,
    onTextureTransformCommit,
    setCameraFitGeneration,
    setCaptureOverlayHidden,
    setCaptureActive,
    setQualityProfile,
  });

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
    const flags = FRONTEND_DIAGNOSTIC_FLAGS.femViewport;
    const masterReset = flags.resetDisplayStateOnRenderModeChange;

    if (hasMeshParts && toolbarStylePartIds.length > 0 && onMeshPartViewStatePatch) {
      if (masterReset && flags.resetOpacityOnRenderModeChange) {
        onMeshPartViewStatePatch(toolbarStylePartIds, {
          renderMode: next,
          opacity: preset.opacity,
        });
      } else {
        onMeshPartViewStatePatch(toolbarStylePartIds, { renderMode: next });
      }
      // D-05 fix: Only sync global meshRenderMode when toolbar acts on ALL visible
      // parts (i.e. no selection). Scoped changes to a selected object must NOT
      // overwrite the global default for the entire viewport.
      const isGlobalScope = visibleLayers.length > 0 &&
        toolbarStylePartIds.length === visibleLayers.length;
      if (isGlobalScope) {
        onRenderModeChange?.(next);
      }
    } else {
      if (onRenderModeChange) {
        onRenderModeChange(next);
      } else {
        setInternalRenderMode(next);
      }
      if (masterReset && flags.resetOpacityOnRenderModeChange) {
        if (onOpacityChange) {
          onOpacityChange(preset.opacity);
        } else {
          setInternalOpacity(preset.opacity);
        }
      }
    }

    if (!masterReset) {
      return;
    }
    // D-05 fix: Only reset global viewport settings (clip, arrows, domain, shrink, quality)
    // when the toolbar operates on the global scope, not on a scoped selection.
    const isGlobalScope = !hasMeshParts || toolbarStylePartIds.length === 0 ||
      toolbarStylePartIds.length === visibleLayers.length;
    if (!isGlobalScope) {
      return;
    }
    if (flags.resetClipOnRenderModeChange) {
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
    }
    if (flags.resetVectorDomainOnRenderModeChange) {
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
    }
    if (flags.resetShrinkOnRenderModeChange) {
      if (onShrinkFactorChange) {
        onShrinkFactorChange(preset.shrinkFactor);
      } else {
        setInternalShrinkFactor(preset.shrinkFactor);
      }
    }
    if (flags.resetQualityOnRenderModeChange) {
      setQualityProfile(preset.qualityProfile);
      updateSharedPreviewMaxPoints(PREVIEW_MAX_POINTS_DEFAULT);
    }
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
    onShrinkFactorChange,
    onVectorDomainFilterChange,
    toolbarStylePartIds,
    updateSharedPreviewMaxPoints,
    visibleLayers,
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
  useEffect(() => {
    if (activeTransformScope === "object" && textureGizmoDragging) {
      setTextureGizmoDragging(false);
    }
  }, [activeTransformScope, textureGizmoDragging]);
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
            onTogglePartExplorer={() => {
              if (onTogglePartExplorer) {
                onTogglePartExplorer();
              } else {
                setInternalPartExplorerOpen((prev) => !prev);
              }
            }}
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
    handleViewCubeRotate,
    hasMeshParts,
    interactionActive,
    labeledMode,
    legendField,
    legendOpen,
    meshData.boundaryFaces.length,
    meshData.elements.length,
    meshData.nElements,
    meshData.nNodes,
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
    onTogglePartExplorer,
    onQuantityChange,
    onRefine,
    onShowArrowsChange,
    onShrinkFactorChange,
    onVectorDomainFilterChange,
    openPopover,
    partExplorerOpen,
    prominentQuantityOptions,
    qualityProfile,
    quantityId,
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
          enableControls:
            selectionOnlyInteractionMode || textureGizmoDragging ? false : true,
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
        activeTransformScope !== "object" ? (
          <TextureTransformGizmo
            transform={sceneTextureTransform}
            mode={textureGizmoMode}
            previewProxy={activeTexturePreviewProxy}
            showPreviewProxy
            onDragStart={() => setTextureGizmoDragging(true)}
            onDragEnd={() => setTextureGizmoDragging(false)}
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
