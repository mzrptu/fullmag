"use client";

import { useEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import * as THREE from "three";
import { rotateCameraAroundTarget, setCameraPresetAroundTarget, focusCameraOnBounds } from "./camera/cameraHelpers";
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
