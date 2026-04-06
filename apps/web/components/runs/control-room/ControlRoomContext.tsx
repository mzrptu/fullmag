"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  currentLiveApiClient,
  type GpuTelemetryDevice,
  type GpuTelemetryResponse,
} from "../../../lib/liveApiClient";
import { useCurrentLiveStream } from "../../../lib/useSessionStream";
import { useWorkspaceStore } from "../../../lib/workspace/workspace-store";
import type {
  ArtifactEntry,
  CommandStatus,
  DisplaySelection,
  EngineLogEntry,
  FemLiveMesh,
  LiveState,
  MeshWorkspaceState,
  PreviewState,
  QuantityDescriptor,
  RunManifest,
  RuntimeStatusState,
  ScalarRow,
  ScriptBuilderStageState,
  SessionManifest,
} from "../../../lib/useSessionStream";
import type {
  DomainFrameState,
  FemMeshPart,
  MeshCommandTarget,
  MeshEntityViewState,
  MeshEntityViewStateMap,
  ModelBuilderGraphV2,
  SceneDocument,
  ScriptBuilderCurrentModuleEntry,
  ScriptBuilderExcitationAnalysisEntry,
  ScriptBuilderGeometryEntry,
  ScriptBuilderUniverseState,
  StudyPipelineDocumentState,
} from "../../../lib/session/types";
import {
  buildModelBuilderGraphV2,
  selectModelBuilderCurrentModules,
  selectModelBuilderExcitationAnalysis,
  selectModelBuilderGeometries,
  selectModelBuilderStudyPipeline,
  selectModelBuilderStages,
  selectModelBuilderUniverse,
  serializeModelBuilderGraphV2,
  setModelBuilderCurrentModules as applyModelBuilderCurrentModules,
  setModelBuilderDemagRealization as applyModelBuilderDemagRealization,
  setModelBuilderExcitationAnalysis as applyModelBuilderExcitationAnalysis,
  setModelBuilderGeometries as applyModelBuilderGeometries,
  setModelBuilderMeshDefaults as applyModelBuilderMeshDefaults,
  setModelBuilderRequestedRuntime as applyModelBuilderRequestedRuntime,
  setModelBuilderSolver as applyModelBuilderSolver,
  setModelBuilderStudyPipeline as applyModelBuilderStudyPipeline,
  setModelBuilderStages as applyModelBuilderStages,
  setModelBuilderUniverse as applyModelBuilderUniverse,
} from "../../../lib/session/modelBuilderGraph";
import {
  buildSceneDocumentFromScriptBuilder,
  buildScriptBuilderFromSceneDocument,
} from "../../../lib/session/sceneDocument";
import { DEFAULT_SOLVER_SETTINGS } from "../../panels/SolverSettingsPanel";
import type { SolverSettingsState } from "../../panels/SolverSettingsPanel";
import { DEFAULT_MESH_OPTIONS } from "../../panels/MeshSettingsPanel";
import type { MeshOptionsState, MeshQualityData } from "../../panels/MeshSettingsPanel";
import type {
  ClipAxis,
  FemColorField,
  FemMeshData,
  MeshSelectionSnapshot,
  RenderMode,
} from "../../preview/FemMeshView3D";
import {
  type AntennaOverlay,
  type BuilderObjectOverlay,
  type FemDockTab,
  type FocusObjectRequest,
  type ObjectViewMode,
  type SlicePlane,
  type VectorComponent,
  type ViewportScope,
  type ViewportMode,
  FEM_SLICE_COUNT,
  PREVIEW_EVERY_N_DEFAULT,
  PREVIEW_EVERY_N_PRESETS,
  PREVIEW_MAX_POINTS_DEFAULT,
  PREVIEW_MAX_POINTS_PRESETS,
  asVec3,
  boundsCenter,
  boundsExtent,
  buildObjectOverlays,
  combineBounds,
  computeMeshFaceDetail,
  fmtSI,
  materializationProgressFromMessage,
  parseOptionalNumber,
  parseStageExecutionMessage,
  resolveViewportScope,
} from "./shared";
import {
  buildScriptBuilderSignature,
  buildScriptBuilderUpdatePayload,
  commandKindLabel,
  downloadBase64File,
  extractSolverPlan,
  fileToBase64,
  latestBackendErrorFromLog,
  meshOptionsFromBuilder,
  meshOptionsToBuilder,
  sameDisplaySelection,
  solverSettingsFromBuilder,
  solverSettingsToBuilder,
} from "./helpers";
import {
  MESH_WORKSPACE_PRESETS,
  buildMeshConfigurationSignature,
  deriveMeshWorkspacePreset,
  type MeshWorkspacePresetId,
} from "./meshWorkspace";
import {
  DEFAULT_ANALYZE_SELECTION,
  nextAnalyzeRefresh,
  type AnalyzeSelectionState,
  type AnalyzeTab,
} from "./analyzeSelection";
import type {
  ActivityInfo,
  BackendErrorInfo,
  FieldStats,
  MaterialSummary,
  MeshQualitySummary,
  PreviewOption,
  QuickPreviewTarget,
  SessionFooterData,
  SolverAdaptiveSummary,
  SolverPlanSummary,
  SolverRelaxationSummary,
} from "./types";

/* ── Stable empty arrays ── */
const EMPTY_SCALAR_ROWS: ScalarRow[] = [];
const EMPTY_ENGINE_LOG: EngineLogEntry[] = [];
const EMPTY_QUANTITIES: QuantityDescriptor[] = [];
const EMPTY_ARTIFACTS: ArtifactEntry[] = [];
const DEFAULT_AIR_MESH_OPACITY = 28;
const GPU_TELEMETRY_POLL_MS = 1000;

function fmtGpuMemoryGb(valueMb: number): string {
  return `${(valueMb / 1024).toFixed(1)} GB`;
}

function runtimeEngineGpuLabelForDevice(device: GpuTelemetryDevice | null): string | null {
  if (!device) {
    return null;
  }
  return `${Math.round(device.utilization_gpu_percent)}% GPU · ${fmtGpuMemoryGb(device.memory_used_mb)}/${fmtGpuMemoryGb(device.memory_total_mb)}`;
}

function parseOptionalFiniteNumberText(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePersistedObjectViewMode(
  value: SceneDocument["editor"]["object_view_mode"],
): ObjectViewMode {
  return value === "isolate" ? "isolate" : "context";
}

function normalizePersistedMeshEntityViewState(
  value: SceneDocument["editor"]["mesh_entity_view_state"],
): MeshEntityViewStateMap {
  const next: MeshEntityViewStateMap = {};
  for (const [entityId, state] of Object.entries(value ?? {})) {
    next[entityId] = {
      visible: state.visible,
      renderMode: state.render_mode,
      opacity: state.opacity,
      colorField: state.color_field,
    };
  }
  return next;
}

function serializeMeshEntityViewStateForScene(
  value: MeshEntityViewStateMap,
): SceneDocument["editor"]["mesh_entity_view_state"] {
  const next: SceneDocument["editor"]["mesh_entity_view_state"] = {};
  for (const [entityId, state] of Object.entries(value)) {
    next[entityId] = {
      visible: state.visible,
      render_mode: state.renderMode,
      opacity: state.opacity,
      color_field: state.colorField,
    };
  }
  return next;
}

function defaultMeshPartViewState(part: FemMeshPart): MeshEntityViewState {
  return {
    visible: part.role !== "air",
    renderMode: part.role === "air" ? "wireframe" : "surface+edges",
    opacity: part.role === "air" ? 28 : part.role === "outer_boundary" ? 46 : part.role === "interface" ? 88 : 100,
    colorField: part.role === "magnetic_object" ? "orientation" : "none",
  };
}

function samePersistedMeshEntityViewState(
  left: SceneDocument["editor"]["mesh_entity_view_state"],
  right: SceneDocument["editor"]["mesh_entity_view_state"],
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    const lhs = left[key];
    const rhs = right[key];
    if (!rhs) {
      return false;
    }
    if (
      lhs.visible !== rhs.visible ||
      lhs.render_mode !== rhs.render_mode ||
      lhs.opacity !== rhs.opacity ||
      lhs.color_field !== rhs.color_field
    ) {
      return false;
    }
  }
  return true;
}

/* Context interfaces, hooks, and React context objects are in context-hooks.tsx */
export {
  useTransport,
  useViewport,
  useCommand,
  useModel,
  useControlRoom,
  TransportCtx,
  ViewportCtx,
  CommandCtx,
  ModelCtx,
} from "./context-hooks";
export type {
  TransportContextValue,
  ViewportContextValue,
  CommandContextValue,
  ModelContextValue,
  ControlRoomContextValue,
  WorkspaceMode,
} from "./context-hooks";
import {
  TransportCtx,
  ViewportCtx,
  CommandCtx,
  ModelCtx,
} from "./context-hooks";
import type {
  TransportContextValue,
  ViewportContextValue,
  CommandContextValue,
  ModelContextValue,
  WorkspaceMode,
} from "./context-hooks";

/* ── Provider ── */
export function ControlRoomProvider({ children }: { children: ReactNode }) {
  const { state, connection, error } = useCurrentLiveStream();

  /* ── Local UI state ── */
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const _setMode = useWorkspaceStore((s) => s.setMode);
  const setWorkspaceMode = useCallback(
    (v: WorkspaceMode | ((prev: WorkspaceMode) => WorkspaceMode)) => {
      _setMode(typeof v === "function" ? v(workspaceMode) : v);
    },
    [_setMode, workspaceMode],
  );
  const [viewMode, setViewMode] = useState<ViewportMode>("3D");
  const [component, setComponent] = useState<VectorComponent>("magnitude");
  const [plane, setPlane] = useState<SlicePlane>("xy");
  const [sliceIndex, setSliceIndex] = useState(0);
  const [selectedQuantity, setSelectedQuantity] = useState("m");
  const [consoleCollapsed, setConsoleCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [femDockTab, setFemDockTab] = useState<FemDockTab>("mesh");
  const [meshRenderMode, setMeshRenderMode] = useState<RenderMode>("surface");
  const [meshOpacity, setMeshOpacity] = useState(100);
  const [meshClipEnabled, setMeshClipEnabled] = useState(false);
  const [meshClipAxis, setMeshClipAxis] = useState<ClipAxis>("x");
  const [meshClipPos, setMeshClipPos] = useState(50);
  const [meshShowArrows, setMeshShowArrows] = useState(true);
  const [runUntilInput, setRunUntilInput] = useState("1e-12");
  const [selectedSidebarNodeId, setSelectedSidebarNodeId] = useState<string | null>(null);
  const [analyzeSelection, setAnalyzeSelection] =
    useState<AnalyzeSelectionState>(DEFAULT_ANALYZE_SELECTION);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [viewportScope, setViewportScope] = useState<ViewportScope>("universe");
  const [focusObjectRequest, setFocusObjectRequest] = useState<FocusObjectRequest | null>(null);
  const [objectViewMode, setObjectViewMode] = useState<ObjectViewMode>("context");
  const [activeTransformScope, setActiveTransformScope] = useState<"object" | "texture" | null>(null);
  const [airMeshVisible, setAirMeshVisible] = useState(false);
  const [airMeshOpacity, setAirMeshOpacity] = useState(DEFAULT_AIR_MESH_OPACITY);
  const [meshEntityViewState, setMeshEntityViewState] = useState<MeshEntityViewStateMap>({});
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [focusedEntityId, setFocusedEntityId] = useState<string | null>(null);
  const [commandPostInFlight, setCommandPostInFlight] = useState(false);
  const [commandErrorMessage, setCommandErrorMessage] = useState<string | null>(null);
  const [scriptSyncBusy, setScriptSyncBusy] = useState(false);
  const [scriptSyncMessage, setScriptSyncMessage] = useState<string | null>(null);
  const [stateIoBusy, setStateIoBusy] = useState(false);
  const [stateIoMessage, setStateIoMessage] = useState<string | null>(null);
  const [previewPostInFlight, setPreviewPostInFlight] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [optimisticDisplaySelection, setOptimisticDisplaySelection] =
    useState<DisplaySelection | null>(null);
  const [meshOptionsState, setMeshOptionsState] = useState<MeshOptionsState>(DEFAULT_MESH_OPTIONS);
  const [meshQualityData, setMeshQualityData] = useState<MeshQualityData | null>(null);
  const [meshGenerating, setMeshGenerating] = useState(false);
  const [lastBuiltMeshConfigSignature, setLastBuiltMeshConfigSignature] = useState<string | null>(null);
  const [frontendTraceLog, setFrontendTraceLog] = useState<EngineLogEntry[]>([]);
  const femTopologyKeyRef = useRef<string | null>(null);
  const femMeshDataRef = useRef<FemMeshData | null>(null);
  const meshConfigSignatureRef = useRef<string | null>(null);
  const pendingMeshConfigSignatureRef = useRef<string | null>(null);
  const lastLoggedCommandStatusRef = useRef<string | null>(null);
  const [solverSettingsState, setSolverSettingsState] =
    useState<SolverSettingsState>(DEFAULT_SOLVER_SETTINGS);
  const [modelBuilderGraph, setModelBuilderGraph] = useState<ModelBuilderGraphV2 | null>(null);
  const [sceneDocumentDraft, setSceneDocumentDraft] = useState<SceneDocument | null>(null);
  const builderHydratedSessionRef = useRef<string | null>(null);
  const builderPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBuilderPushSignatureRef = useRef<string | null>(null);
  const [meshSelection, setMeshSelection] = useState<MeshSelectionSnapshot>({
    selectedFaceIndices: [],
    primaryFaceIndex: null,
  });

  /* ── Derived from SSE state ── */
  const session = state?.session ?? null;
  const metadata = (state?.metadata as Record<string, unknown> | null) ?? null;
  const problemMeta =
    metadata?.problem_meta && typeof metadata.problem_meta === "object"
      ? (metadata.problem_meta as Record<string, unknown>)
      : null;
  const sourceHash =
    typeof metadata?.source_hash === "string"
      ? metadata.source_hash
      : (typeof problemMeta?.source_hash === "string" ? problemMeta.source_hash : null);
  const workspaceHydrationKey = session
    ? `${session.started_at_unix_ms}:${session.run_id}:${session.script_path}:${sourceHash ?? "no-source-hash"}`
    : null;
  const openAnalyze = useCallback((next?: Partial<AnalyzeSelectionState>) => {
    startTransition(() => {
      setViewMode("Analyze");
    });
    setAnalyzeSelection((prev) => ({
      ...prev,
      ...next,
    }));
  }, []);
  const selectAnalyzeTab = useCallback((tab: AnalyzeTab) => {
    setAnalyzeSelection((prev) => ({
      ...prev,
      tab,
    }));
  }, []);
  const selectAnalyzeMode = useCallback((index: number | null) => {
    setAnalyzeSelection((prev) => ({
      ...prev,
      tab: "modes",
      selectedModeIndex: index,
    }));
  }, []);
  const refreshAnalyze = useCallback(() => {
    setAnalyzeSelection((prev) => nextAnalyzeRefresh(prev));
  }, []);
  const run = state?.run ?? null;
  const liveState = state?.live_state ?? null;
  const displaySelection = state?.display_selection ?? null;
  const previewConfig = state?.preview_config ?? null;
  const preview = state?.preview ?? null;
  const spatialPreview = preview?.kind === "spatial" ? preview : null;
  const globalScalarPreview = preview?.kind === "global_scalar" ? preview : null;
  const femMesh = state?.fem_mesh ?? liveState?.fem_mesh ?? null;
  const remoteSceneDocument = state?.scene_document ?? null;
  const meshConfigSignature = useMemo(
    () => buildMeshConfigurationSignature(sceneDocumentDraft ?? remoteSceneDocument),
    [remoteSceneDocument, sceneDocumentDraft],
  );
  meshConfigSignatureRef.current = meshConfigSignature;
  const scriptBuilder = state?.script_builder ?? null;
  const remoteModelBuilderGraph = state?.model_builder_graph ?? null;
  const scriptInitialState = scriptBuilder?.initial_state ?? null;
  const studyStages = useMemo(
    () => selectModelBuilderStages(modelBuilderGraph),
    [modelBuilderGraph],
  );
  const studyPipeline = useMemo(
    () => selectModelBuilderStudyPipeline(modelBuilderGraph),
    [modelBuilderGraph],
  );
  const scriptBuilderDemagRealization = useMemo(
    () => modelBuilderGraph?.study.demag_realization ?? null,
    [modelBuilderGraph],
  );
  const scriptBuilderUniverse = useMemo(
    () => selectModelBuilderUniverse(modelBuilderGraph),
    [modelBuilderGraph],
  );
  const scriptBuilderGeometries = useMemo(
    () => selectModelBuilderGeometries(modelBuilderGraph),
    [modelBuilderGraph],
  );
  const scriptBuilderCurrentModules = useMemo(
    () => selectModelBuilderCurrentModules(modelBuilderGraph),
    [modelBuilderGraph],
  );
  const scriptBuilderExcitationAnalysis = useMemo(
    () => selectModelBuilderExcitationAnalysis(modelBuilderGraph),
    [modelBuilderGraph],
  );
  const runtimeStatus = state?.runtime_status ?? null;
  const commandStatus = state?.command_status ?? null;
  const scalarRows = state?.scalar_rows ?? EMPTY_SCALAR_ROWS;
  const engineLog = state?.engine_log ?? EMPTY_ENGINE_LOG;
  const quantities = state?.quantities ?? EMPTY_QUANTITIES;
  const artifactsArr = state?.artifacts ?? EMPTY_ARTIFACTS;
  const meshWorkspace = (state?.mesh_workspace as MeshWorkspaceState | null) ?? null;
  const runtimeEngine = (metadata?.runtime_engine as Record<string, unknown> | undefined) ?? undefined;
  const runtimeEngineLabel = typeof runtimeEngine?.engine_label === "string" ? runtimeEngine.engine_label : null;
  const runtimeEngineAccelerator =
    typeof runtimeEngine?.accelerator === "string" ? runtimeEngine.accelerator : null;
  const runtimeEngineDeviceName =
    typeof runtimeEngine?.device_name === "string" ? runtimeEngine.device_name : null;
  const [gpuTelemetry, setGpuTelemetry] = useState<GpuTelemetryResponse | null>(null);
  const liveApi = useMemo(() => currentLiveApiClient(), []);
  const latestEngineMessage = engineLog.length > 0 ? engineLog[engineLog.length - 1]?.message ?? null : null;
  const workspaceStatus =
    runtimeStatus?.code ?? liveState?.status ?? session?.status ?? run?.status ?? "idle";
  const runtimeUsesGpu = runtimeEngineAccelerator === "gpu" || /gpu|cuda/i.test(runtimeEngineLabel ?? "");

  useEffect(() => {
    if (!runtimeUsesGpu) {
      setGpuTelemetry(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const next = await liveApi.fetchGpuTelemetry();
        if (!cancelled) {
          setGpuTelemetry(next);
        }
      } catch {
        if (!cancelled) {
          setGpuTelemetry(null);
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, GPU_TELEMETRY_POLL_MS);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [liveApi, runtimeUsesGpu]);
  const modelBuilderDefaults = useMemo(
    () => ({
      revision:
        remoteModelBuilderGraph?.revision ?? scriptBuilder?.revision ?? 0,
      solver: solverSettingsToBuilder(solverSettingsState),
      mesh: meshOptionsToBuilder(meshOptionsState),
      initialState: scriptInitialState,
    }),
    [
      meshOptionsState,
      remoteModelBuilderGraph?.revision,
      scriptBuilder?.revision,
      scriptInitialState,
      solverSettingsState,
    ],
  );

  useEffect(() => {
    setSelectedSidebarNodeId(null);
    setAnalyzeSelection(DEFAULT_ANALYZE_SELECTION);
    setSelectedObjectId(null);
    setViewportScope("universe");
    setFocusObjectRequest(null);
    setObjectViewMode("context");
    setActiveTransformScope(null);
    setAirMeshVisible(false);
    setAirMeshOpacity(DEFAULT_AIR_MESH_OPACITY);
    setMeshEntityViewState({});
    setSelectedEntityId(null);
    setFocusedEntityId(null);
  }, [workspaceHydrationKey]);

  useEffect(() => {
    const scope = resolveViewportScope(
      selectedSidebarNodeId,
      sceneDocumentDraft ?? remoteSceneDocument ?? modelBuilderGraph,
    );
    if (scope) {
      setViewportScope(scope);
    }
  }, [modelBuilderGraph, remoteSceneDocument, sceneDocumentDraft, selectedSidebarNodeId]);

  const hasSolverTelemetry =
    (liveState?.step ?? 0) > 0 ||
    (run?.total_steps ?? 0) > 0 ||
    scalarRows.length > 0 ||
    workspaceStatus === "completed" ||
    workspaceStatus === "failed";

  /* Detect FEM */
  const planSummary = session?.plan_summary as Record<string, unknown> | undefined;
  const scriptBackendHint =
    (typeof scriptBuilder?.backend === "string" ? scriptBuilder.backend : null) ??
    (typeof remoteSceneDocument?.study?.backend === "string"
      ? remoteSceneDocument.study.backend
      : null) ??
    modelBuilderGraph?.study.backend ??
    null;
  const resolvedBackend =
    (typeof planSummary?.resolved_backend === "string" ? planSummary.resolved_backend : null) ??
    ((typeof session?.requested_backend === "string" && session.requested_backend !== "auto")
      ? session.requested_backend
      : null) ??
    scriptBackendHint;
  const isFemBackend =
    resolvedBackend === "fem" || femMesh != null || spatialPreview?.spatial_kind === "mesh";

  const solverNotStartedMessage =
    workspaceStatus === "materializing_script"
      ? (isFemBackend
          ? "Solver has not started yet. FEM materialization and tetrahedral meshing are still in progress."
          : "Solver has not started yet. Workspace materialization is still in progress.")
      : workspaceStatus === "bootstrapping"
        ? "Solver has not started yet. Workspace bootstrap is still in progress."
        : workspaceStatus === "waiting_for_compute"
          ? (isFemBackend
              ? "Waiting for compute — adjust mesh in the control room, then click COMPUTE."
              : "Waiting for compute — inspect the workspace in the control room, then click COMPUTE.")
          : "Solver telemetry is not available yet.";

  const isWaitingForCompute = workspaceStatus === "waiting_for_compute";

  /* Effective solver values (fallback to run manifest when live is stale) */
  const liveIsStale = (liveState?.step ?? 0) === 0 && (run?.total_steps ?? 0) > 0;
  const effectiveStep = liveIsStale ? (run?.total_steps ?? 0) : (liveState?.step ?? run?.total_steps ?? 0);
  const effectiveTime = liveIsStale ? (run?.final_time ?? 0) : (liveState?.time ?? run?.final_time ?? 0);
  const effectiveDt = liveIsStale ? 0 : (liveState?.dt ?? 0);
  const effectiveEEx = liveIsStale ? (run?.final_e_ex ?? 0) : (liveState?.e_ex ?? run?.final_e_ex ?? 0);
  const effectiveEDemag = liveIsStale ? (run?.final_e_demag ?? 0) : (liveState?.e_demag ?? run?.final_e_demag ?? 0);
  const effectiveEExt = liveIsStale ? (run?.final_e_ext ?? 0) : (liveState?.e_ext ?? run?.final_e_ext ?? 0);
  const effectiveETotal = liveIsStale ? (run?.final_e_total ?? 0) : (liveState?.e_total ?? run?.final_e_total ?? 0);
  const effectiveDmDt = liveIsStale ? 0 : (liveState?.max_dm_dt ?? 0);
  const effectiveHEff = liveIsStale ? 0 : (liveState?.max_h_eff ?? 0);
  const effectiveHDemag = liveIsStale ? 0 : (liveState?.max_h_demag ?? 0);

  const effectiveLiveState = useMemo(() => {
    if (!liveState) return null;
    if (!liveIsStale) return liveState;
    return {
      ...liveState,
      step: effectiveStep, time: effectiveTime, dt: effectiveDt,
      e_ex: effectiveEEx, e_demag: effectiveEDemag, e_ext: effectiveEExt, e_total: effectiveETotal,
      max_dm_dt: effectiveDmDt, max_h_eff: effectiveHEff, max_h_demag: effectiveHDemag,
    };
  }, [liveState, liveIsStale, effectiveStep, effectiveTime, effectiveDt,
      effectiveEEx, effectiveEDemag, effectiveEExt, effectiveETotal,
      effectiveDmDt, effectiveHEff, effectiveHDemag]);

  /* Status bar */
  const elapsed = session
    ? (session.finished_at_unix_ms > session.started_at_unix_ms
        ? session.finished_at_unix_ms - session.started_at_unix_ms
        : Date.now() - session.started_at_unix_ms)
    : 0;
  const stepsPerSec = elapsed > 0 ? (effectiveStep / elapsed) * 1000 : 0;

  const solverPlan = useMemo(() => extractSolverPlan(metadata, session), [metadata, session]);
  const quantityDescriptorById = useMemo(
    () => new Map(quantities.map((quantity) => [quantity.id, quantity] as const)),
    [quantities],
  );
  const kindForQuantity = useCallback((quantity: string): DisplaySelection["kind"] => {
    const desc = quantityDescriptorById.get(quantity);
    if (!desc) return "vector_field";
    switch (desc.kind) {
      case "spatial_scalar":
        return "spatial_scalar";
      case "global_scalar":
        return "global_scalar";
      default:
        return "vector_field";
    }
  }, [quantityDescriptorById]);
  const solverSettings = solverSettingsState;
  const meshOptions = meshOptionsState;
  const setSolverSettings = useCallback<Dispatch<SetStateAction<SolverSettingsState>>>(
    (update) => {
      setSolverSettingsState((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        setModelBuilderGraph((currentGraph) =>
          applyModelBuilderSolver(
            currentGraph,
            solverSettingsToBuilder(next),
            modelBuilderDefaults,
          ),
        );
        return next;
      });
    },
    [modelBuilderDefaults],
  );
  const setMeshOptions = useCallback<Dispatch<SetStateAction<MeshOptionsState>>>(
    (update) => {
      setMeshOptionsState((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        setModelBuilderGraph((currentGraph) =>
          applyModelBuilderMeshDefaults(
            currentGraph,
            meshOptionsToBuilder(next, currentGraph?.study.mesh_defaults),
            modelBuilderDefaults,
          ),
        );
        return next;
      });
    },
    [modelBuilderDefaults],
  );
  const setStudyStages = useCallback<Dispatch<SetStateAction<ScriptBuilderStageState[]>>>(
    (update) => {
      setModelBuilderGraph((currentGraph) =>
        applyModelBuilderStages(currentGraph, update, modelBuilderDefaults),
      );
    },
    [modelBuilderDefaults],
  );
  const setStudyPipeline = useCallback<
    Dispatch<SetStateAction<StudyPipelineDocumentState | null>>
  >(
    (update) => {
      setModelBuilderGraph((currentGraph) =>
        applyModelBuilderStudyPipeline(currentGraph, update, modelBuilderDefaults),
      );
    },
    [modelBuilderDefaults],
  );
  const setRequestedRuntimeSelection = useCallback<
    Dispatch<
      SetStateAction<{
        requested_backend: string;
        requested_device: string;
        requested_precision: string;
        requested_mode: string;
      }>
    >
  >(
    (update) => {
      setModelBuilderGraph((currentGraph) =>
        applyModelBuilderRequestedRuntime(currentGraph, update, modelBuilderDefaults),
      );
      setSceneDocumentDraft((previousScene) => {
        if (!previousScene) {
          return previousScene;
        }
        const currentRuntime = {
          requested_backend: previousScene.study.requested_backend,
          requested_device: previousScene.study.requested_device,
          requested_precision: previousScene.study.requested_precision,
          requested_mode: previousScene.study.requested_mode,
        };
        const nextRuntime =
          typeof update === "function" ? update(currentRuntime) : update;
        return {
          ...previousScene,
          study: {
            ...previousScene.study,
            ...nextRuntime,
          },
        };
      });
    },
    [modelBuilderDefaults],
  );
  const setScriptBuilderDemagRealization = useCallback<
    Dispatch<SetStateAction<string | null>>
  >(
    (update) => {
      setModelBuilderGraph((currentGraph) =>
        applyModelBuilderDemagRealization(currentGraph, update, modelBuilderDefaults),
      );
    },
    [modelBuilderDefaults],
  );
  const setScriptBuilderUniverse = useCallback<
    Dispatch<SetStateAction<ScriptBuilderUniverseState | null>>
  >(
    (update) => {
      setModelBuilderGraph((currentGraph) =>
        applyModelBuilderUniverse(currentGraph, update, modelBuilderDefaults),
      );
    },
    [modelBuilderDefaults],
  );
  const setScriptBuilderGeometries = useCallback<
    Dispatch<SetStateAction<ScriptBuilderGeometryEntry[]>>
  >(
    (update) => {
      setModelBuilderGraph((currentGraph) =>
        applyModelBuilderGeometries(currentGraph, update, modelBuilderDefaults),
      );
    },
    [modelBuilderDefaults],
  );
  const setScriptBuilderCurrentModules = useCallback<
    Dispatch<SetStateAction<ScriptBuilderCurrentModuleEntry[]>>
  >(
    (update) => {
      setModelBuilderGraph((currentGraph) =>
        applyModelBuilderCurrentModules(currentGraph, update, modelBuilderDefaults),
      );
    },
    [modelBuilderDefaults],
  );
  const setScriptBuilderExcitationAnalysis = useCallback<
    Dispatch<SetStateAction<ScriptBuilderExcitationAnalysisEntry | null>>
  >(
    (update) => {
      setModelBuilderGraph((currentGraph) =>
        applyModelBuilderExcitationAnalysis(currentGraph, update, modelBuilderDefaults),
      );
    },
    [modelBuilderDefaults],
  );
  const localBuilderDraft = useMemo(
    () =>
      sceneDocumentDraft ??
      buildScriptBuilderUpdatePayload(
        modelBuilderGraph,
        {
          solverSettings,
          meshOptions,
          demagRealization: scriptBuilderDemagRealization,
          universe: scriptBuilderUniverse,
          stages: studyStages,
          geometries: scriptBuilderGeometries,
          currentModules: scriptBuilderCurrentModules,
          excitationAnalysis: scriptBuilderExcitationAnalysis,
        },
      ),
    [
      modelBuilderGraph,
      meshOptions,
      sceneDocumentDraft,
      solverSettings,
      scriptBuilderDemagRealization,
      scriptBuilderUniverse,
      studyStages,
      scriptBuilderGeometries,
      scriptBuilderCurrentModules,
      scriptBuilderExcitationAnalysis,
    ],
  );
  const sceneObjects = useMemo(
    () => localBuilderDraft?.objects ?? remoteSceneDocument?.objects ?? [],
    [localBuilderDraft, remoteSceneDocument],
  );
  const meshPerGeometryPayload = useMemo(
    () =>
      sceneObjects.map((object) => ({
        geometry: object.name,
        mode: object.mesh_override?.mode ?? "inherit",
        hmax: object.mesh_override?.hmax ?? "",
        hmin: object.mesh_override?.hmin ?? "",
        order: object.mesh_override?.order ?? null,
        source: object.mesh_override?.source ?? null,
        algorithm_2d: object.mesh_override?.algorithm_2d ?? null,
        algorithm_3d: object.mesh_override?.algorithm_3d ?? null,
        size_factor: object.mesh_override?.size_factor ?? null,
        size_from_curvature: object.mesh_override?.size_from_curvature ?? null,
        growth_rate: object.mesh_override?.growth_rate ?? "",
        narrow_regions: object.mesh_override?.narrow_regions ?? null,
        smoothing_steps: object.mesh_override?.smoothing_steps ?? null,
        optimize: object.mesh_override?.optimize ?? null,
        optimize_iterations: object.mesh_override?.optimize_iterations ?? null,
        compute_quality: object.mesh_override?.compute_quality ?? null,
        per_element_quality: object.mesh_override?.per_element_quality ?? null,
        size_fields: object.mesh_override?.size_fields ?? [],
        operations: object.mesh_override?.operations ?? [],
        build_requested: object.mesh_override?.build_requested ?? false,
      })),
    [sceneObjects],
  );
  const setSceneDocument = useCallback<Dispatch<SetStateAction<SceneDocument | null>>>(
    (update) => {
      const baseScene = sceneDocumentDraft ?? localBuilderDraft;
      const nextScene =
        typeof update === "function"
          ? (update as (current: SceneDocument | null) => SceneDocument | null)(baseScene)
          : update;
      setSceneDocumentDraft(nextScene);
      setModelBuilderGraph(() => {
        if (!nextScene) {
          return null;
        }
        const nextGraph = buildModelBuilderGraphV2(buildScriptBuilderFromSceneDocument(nextScene));
        if (!nextGraph) {
          return null;
        }
        nextGraph.study.requested_backend = nextScene.study.requested_backend;
        nextGraph.study.requested_device = nextScene.study.requested_device;
        nextGraph.study.requested_precision = nextScene.study.requested_precision;
        nextGraph.study.requested_mode = nextScene.study.requested_mode;
        return nextGraph;
      });
    },
    [localBuilderDraft, sceneDocumentDraft],
  );
  useEffect(() => {
    if (!selectedObjectId) {
      return;
    }
    if (
      sceneObjects.some(
        (object) => object.id === selectedObjectId || object.name === selectedObjectId,
      )
    ) {
      return;
    }
    setSelectedObjectId(null);
  }, [sceneObjects, selectedObjectId]);
  const localBuilderSignature = useMemo(
    () =>
      sceneDocumentDraft != null
        ? JSON.stringify(sceneDocumentDraft)
        : buildScriptBuilderSignature(modelBuilderGraph, {
            solverSettings,
            meshOptions,
            demagRealization: scriptBuilderDemagRealization,
            universe: scriptBuilderUniverse,
            stages: studyStages,
            geometries: scriptBuilderGeometries,
            currentModules: scriptBuilderCurrentModules,
            excitationAnalysis: scriptBuilderExcitationAnalysis,
          }),
    [
      modelBuilderGraph,
      meshOptions,
      sceneDocumentDraft,
      solverSettings,
      scriptBuilderDemagRealization,
      scriptBuilderUniverse,
      studyStages,
      scriptBuilderGeometries,
      scriptBuilderCurrentModules,
      scriptBuilderExcitationAnalysis,
    ],
  );
  const remoteBuilderSignature = useMemo(
    () => {
      if (remoteModelBuilderGraph) {
        return buildScriptBuilderSignature(remoteModelBuilderGraph, {
          solverSettings,
          meshOptions,
          demagRealization: scriptBuilderDemagRealization,
          universe: scriptBuilderUniverse,
          stages: studyStages,
          geometries: scriptBuilderGeometries,
          currentModules: scriptBuilderCurrentModules,
          excitationAnalysis: scriptBuilderExcitationAnalysis,
        });
      }
      if (!scriptBuilder) {
        return null;
      }
      return JSON.stringify(
        remoteSceneDocument ?? buildSceneDocumentFromScriptBuilder(scriptBuilder),
      );
    },
    [
      remoteSceneDocument,
      remoteModelBuilderGraph,
      scriptBuilder,
      meshOptions,
      solverSettings,
      scriptBuilderDemagRealization,
      scriptBuilderUniverse,
      studyStages,
      scriptBuilderGeometries,
      scriptBuilderCurrentModules,
      scriptBuilderExcitationAnalysis,
    ],
  );

  /* Hydrate solver-settings panel from the actual backend plan on first load. */
  const [solverSettingsHydrated, setSolverSettingsHydrated] = useState(false);
  useEffect(() => {
    builderHydratedSessionRef.current = null;
    lastBuilderPushSignatureRef.current = null;
    pendingMeshConfigSignatureRef.current = null;
    setLastBuiltMeshConfigSignature(null);
    setSolverSettingsHydrated(false);
    setModelBuilderGraph(null);
    setSceneDocumentDraft(null);
    if (builderPushTimerRef.current) {
      clearTimeout(builderPushTimerRef.current);
      builderPushTimerRef.current = null;
    }
  }, [workspaceHydrationKey]);

  useEffect(() => {
    if (solverSettingsHydrated || !solverPlan || scriptBuilder || remoteModelBuilderGraph) return;
    setSolverSettingsState((prev) => ({
      ...prev,
      integrator: solverPlan.integrator ?? prev.integrator,
      fixedTimestep:
        solverPlan.fixedTimestep != null ? String(solverPlan.fixedTimestep) : prev.fixedTimestep,
      relaxAlgorithm: solverPlan.relaxation?.algorithm ?? prev.relaxAlgorithm,
      torqueTolerance:
        solverPlan.relaxation?.torqueTolerance != null
          ? String(solverPlan.relaxation.torqueTolerance)
          : prev.torqueTolerance,
      energyTolerance:
        solverPlan.relaxation?.energyTolerance != null
          ? String(solverPlan.relaxation.energyTolerance)
          : prev.energyTolerance,
      maxRelaxSteps:
        solverPlan.relaxation?.maxSteps != null
          ? String(solverPlan.relaxation.maxSteps)
          : prev.maxRelaxSteps,
    }));
    setSolverSettingsHydrated(true);
  }, [remoteModelBuilderGraph, scriptBuilder, solverPlan, solverSettingsHydrated]);

  useEffect(() => {
    const incomingGraph =
      remoteModelBuilderGraph ?? (scriptBuilder ? buildModelBuilderGraphV2(scriptBuilder) : null);
    if (!workspaceHydrationKey || !incomingGraph) {
      return;
    }
    if (builderHydratedSessionRef.current === workspaceHydrationKey) {
      return;
    }
    setSolverSettingsState((prev) => ({
      ...prev,
      ...solverSettingsFromBuilder(incomingGraph.study.solver),
    }));
    setMeshOptionsState((prev) => ({
      ...prev,
      ...meshOptionsFromBuilder(incomingGraph.study.mesh_defaults),
    }));
    setModelBuilderGraph(incomingGraph);
    const hydratedScene =
      remoteSceneDocument ??
      buildSceneDocumentFromScriptBuilder({
        revision: incomingGraph.revision,
        initial_state: incomingGraph.study.initial_state,
        ...serializeModelBuilderGraphV2(incomingGraph),
      });
    hydratedScene.study.requested_backend =
      remoteSceneDocument?.study.requested_backend ?? incomingGraph.study.requested_backend;
    hydratedScene.study.requested_device =
      remoteSceneDocument?.study.requested_device ?? incomingGraph.study.requested_device;
    hydratedScene.study.requested_precision =
      remoteSceneDocument?.study.requested_precision ?? incomingGraph.study.requested_precision;
    hydratedScene.study.requested_mode =
      remoteSceneDocument?.study.requested_mode ?? incomingGraph.study.requested_mode;
    setSceneDocumentDraft(hydratedScene);
    setLastBuiltMeshConfigSignature(buildMeshConfigurationSignature(hydratedScene));
    pendingMeshConfigSignatureRef.current = null;
    setSelectedObjectId(hydratedScene.editor.selected_object_id);
    setObjectViewMode(normalizePersistedObjectViewMode(hydratedScene.editor.object_view_mode));
    setAirMeshVisible(hydratedScene.editor.air_mesh_visible ?? false);
    setAirMeshOpacity(
      typeof hydratedScene.editor.air_mesh_opacity === "number" &&
        Number.isFinite(hydratedScene.editor.air_mesh_opacity)
        ? hydratedScene.editor.air_mesh_opacity
        : DEFAULT_AIR_MESH_OPACITY,
    );
    setMeshEntityViewState(
      normalizePersistedMeshEntityViewState(hydratedScene.editor.mesh_entity_view_state),
    );
    setSelectedEntityId(hydratedScene.editor.selected_entity_id);
    setFocusedEntityId(hydratedScene.editor.focused_entity_id);
    const firstRunStage = incomingGraph.study.stages.find(
      (stage) => stage.kind === "run" && stage.until_seconds.trim().length > 0,
    );
    if (firstRunStage) {
      setRunUntilInput(firstRunStage.until_seconds);
    }
    builderHydratedSessionRef.current = workspaceHydrationKey;
    lastBuilderPushSignatureRef.current = buildScriptBuilderSignature(incomingGraph, {
      solverSettings,
      meshOptions,
      universe: incomingGraph.universe.value,
      demagRealization: incomingGraph.study.demag_realization,
      stages: incomingGraph.study.stages,
      geometries: incomingGraph.objects.items.map((objectNode) => objectNode.geometry),
      currentModules: incomingGraph.current_modules.modules,
      excitationAnalysis: incomingGraph.current_modules.excitation_analysis,
    });
    setSolverSettingsHydrated(true);
  }, [
    buildScriptBuilderSignature,
    meshOptions,
    remoteSceneDocument,
    remoteModelBuilderGraph,
    scriptBuilder,
    solverSettings,
    workspaceHydrationKey,
  ]);

  useEffect(() => {
    const persistedMeshEntityViewState = serializeMeshEntityViewStateForScene(meshEntityViewState);
    setSceneDocumentDraft((previousScene) => {
      if (!previousScene) {
        return previousScene;
      }
      const previousEditor = previousScene.editor;
      const nextAirMeshOpacity = Number.isFinite(airMeshOpacity)
        ? airMeshOpacity
        : DEFAULT_AIR_MESH_OPACITY;
      if (
        previousEditor.selected_object_id === selectedObjectId &&
        previousEditor.selected_entity_id === selectedEntityId &&
        previousEditor.focused_entity_id === focusedEntityId &&
        previousEditor.object_view_mode === objectViewMode &&
        previousEditor.active_transform_scope === activeTransformScope &&
        previousEditor.air_mesh_visible === airMeshVisible &&
        previousEditor.air_mesh_opacity === nextAirMeshOpacity &&
        samePersistedMeshEntityViewState(
          previousEditor.mesh_entity_view_state,
          persistedMeshEntityViewState,
        )
      ) {
        return previousScene;
      }
      return {
        ...previousScene,
        editor: {
          ...previousEditor,
          selected_object_id: selectedObjectId,
          selected_entity_id: selectedEntityId,
          focused_entity_id: focusedEntityId,
          object_view_mode: objectViewMode,
          active_transform_scope: activeTransformScope,
          air_mesh_visible: airMeshVisible,
          air_mesh_opacity: nextAirMeshOpacity,
          mesh_entity_view_state: persistedMeshEntityViewState,
        },
      };
    });
  }, [
    airMeshOpacity,
    airMeshVisible,
    focusedEntityId,
    meshEntityViewState,
    objectViewMode,
    activeTransformScope,
    selectedEntityId,
    selectedObjectId,
  ]);

  useEffect(() => {
    if (!workspaceHydrationKey || !modelBuilderGraph) {
      return;
    }
    const projectedScene = buildSceneDocumentFromScriptBuilder({
      revision: modelBuilderGraph.revision,
      initial_state: modelBuilderGraph.study.initial_state,
      ...serializeModelBuilderGraphV2(modelBuilderGraph),
    });
    projectedScene.study.requested_backend = modelBuilderGraph.study.requested_backend;
    projectedScene.study.requested_device = modelBuilderGraph.study.requested_device;
    projectedScene.study.requested_precision = modelBuilderGraph.study.requested_precision;
    projectedScene.study.requested_mode = modelBuilderGraph.study.requested_mode;
    setSceneDocumentDraft((previousScene) => {
      if (!previousScene) {
        return projectedScene;
      }
      return {
        ...projectedScene,
        scene: previousScene.scene,
        outputs: previousScene.outputs,
        editor: previousScene.editor,
        objects: projectedScene.objects.map((object) => {
          const existing = previousScene.objects.find(
            (candidate) => candidate.id === object.id || candidate.name === object.name,
          );
          if (!existing) {
            return object;
          }
          return {
            ...existing,
            id: object.id,
            name: object.name,
            geometry: object.geometry,
            transform: {
              ...existing.transform,
              translation: object.transform.translation,
            },
            material_ref: object.material_ref,
            region_name: object.region_name,
            magnetization_ref: object.magnetization_ref,
            mesh_override: object.mesh_override,
          };
        }),
        materials: projectedScene.materials.map((material) => {
          const existing = previousScene.materials.find(
            (candidate) => candidate.id === material.id,
          );
          return existing
            ? {
                ...existing,
                id: material.id,
                properties: material.properties,
              }
            : material;
        }),
        magnetization_assets: projectedScene.magnetization_assets.map((asset) => {
          const existing = previousScene.magnetization_assets.find(
            (candidate) => candidate.id === asset.id,
          );
          return existing
            ? {
                ...existing,
                id: asset.id,
                kind: asset.kind,
                value: asset.value,
                seed: asset.seed,
                source_path: asset.source_path,
                source_format: asset.source_format,
                dataset: asset.dataset,
                sample_index: asset.sample_index,
              }
            : asset;
        }),
      };
    });
  }, [modelBuilderGraph, workspaceHydrationKey]);

  useEffect(() => {
    if (!workspaceHydrationKey || !scriptBuilder) {
      return;
    }
    if (builderHydratedSessionRef.current !== workspaceHydrationKey) {
      return;
    }
    if (remoteBuilderSignature === localBuilderSignature) {
      lastBuilderPushSignatureRef.current = localBuilderSignature;
      return;
    }
    if (lastBuilderPushSignatureRef.current === localBuilderSignature) {
      return;
    }
    if (builderPushTimerRef.current) {
      clearTimeout(builderPushTimerRef.current);
    }
    builderPushTimerRef.current = setTimeout(() => {
      void liveApi
        .updateSceneDocument(localBuilderDraft)
        .then(() => {
          lastBuilderPushSignatureRef.current = localBuilderSignature;
        })
        .catch((builderError) => {
          console.warn("Failed to persist scene document draft", builderError);
          lastBuilderPushSignatureRef.current = null;
        });
    }, 250);
    return () => {
      if (builderPushTimerRef.current) {
        clearTimeout(builderPushTimerRef.current);
        builderPushTimerRef.current = null;
      }
    };
  }, [
    liveApi,
    localBuilderDraft,
    localBuilderSignature,
    remoteBuilderSignature,
    scriptBuilder,
    workspaceHydrationKey,
  ]);

  useEffect(() => {
    return () => {
      if (builderPushTimerRef.current) {
        clearTimeout(builderPushTimerRef.current);
      }
    };
  }, []);

  const currentStage = useMemo(() => parseStageExecutionMessage(latestEngineMessage), [latestEngineMessage]);

  const activity = useMemo<ActivityInfo>(() => {
    if (workspaceStatus === "materializing_script") {
      const pv = materializationProgressFromMessage(latestEngineMessage);
      const lowerMessage = (latestEngineMessage ?? "").toLowerCase();
      const hasGmshPercent = /\[\s*\d{1,3}%\]/.test(latestEngineMessage ?? "");
      const isLong = lowerMessage.includes("generating 3d tetrahedral mesh") && !hasGmshPercent;
      return { label: isFemBackend ? "Materializing FEM workspace" : "Materializing workspace",
               detail: latestEngineMessage ?? "Preparing geometry import and execution plan",
               progressMode: isLong ? "indeterminate" : "determinate", progressValue: pv };
    }
    if (workspaceStatus === "bootstrapping")
      return { label: "Bootstrapping workspace", detail: latestEngineMessage ?? "Starting local API and control room",
               progressMode: "indeterminate", progressValue: undefined };
    if (workspaceStatus === "running") {
      const sl = currentStage ? `Solving ${currentStage.kind} — stage ${currentStage.current}/${currentStage.total}` : "Running solver";
      return { label: sl, detail: effectiveStep > 0
        ? `Step ${effectiveStep.toLocaleString()} · t=${fmtSI(effectiveTime, "s")} · ${runtimeEngineLabel ?? session?.requested_backend?.toUpperCase() ?? "runtime"}`
        : latestEngineMessage ?? "Solver startup in progress", progressMode: "indeterminate", progressValue: undefined };
    }
    if (workspaceStatus === "paused")
      return { label: "Solver paused", detail: latestEngineMessage ?? "Interactive stage is paused and can be resumed",
               progressMode: "determinate", progressValue: 100 };
    if (workspaceStatus === "awaiting_command")
      return { label: "Interactive workspace ready", detail: latestEngineMessage ?? "Waiting for the next run or relax command",
               progressMode: "determinate", progressValue: 100 };
    if (workspaceStatus === "completed")
      return { label: "Run completed", detail: latestEngineMessage ?? "Solver finished successfully",
               progressMode: "determinate", progressValue: 100 };
    if (workspaceStatus === "failed")
      return { label: "Run failed", detail: latestEngineMessage ?? "Execution stopped with an error",
               progressMode: "determinate", progressValue: 100 };
    return { label: "Workspace idle", detail: latestEngineMessage ?? "No active task",
             progressMode: "idle", progressValue: undefined };
  }, [effectiveStep, effectiveTime, currentStage, isFemBackend, latestEngineMessage, runtimeEngineLabel, session?.requested_backend, workspaceStatus]);

  const runtimeEngineGpuDevice = useMemo<GpuTelemetryDevice | null>(() => {
    const devices = gpuTelemetry?.devices ?? [];
    if (devices.length === 0) {
      return null;
    }
    if (runtimeEngineDeviceName) {
      const exact = devices.find((device) => device.name === runtimeEngineDeviceName);
      if (exact) {
        return exact;
      }
      const partial = devices.find((device) => runtimeEngineDeviceName.includes(device.name) || device.name.includes(runtimeEngineDeviceName));
      if (partial) {
        return partial;
      }
    }
    return [...devices].sort((left, right) => right.utilization_gpu_percent - left.utilization_gpu_percent)[0] ?? null;
  }, [gpuTelemetry, runtimeEngineDeviceName]);

  const runtimeEngineGpuLabel = useMemo(
    () => runtimeEngineGpuLabelForDevice(runtimeEngineGpuDevice),
    [runtimeEngineGpuDevice],
  );

  /* Artifact / execution plan metadata */
  const artifactLayout = (metadata?.artifact_layout as Record<string, unknown> | undefined) ?? undefined;
  const femArtifactLayout = artifactLayout?.backend === "fem" ? artifactLayout : undefined;
  const meshBoundsMin = asVec3(femArtifactLayout?.bounds_min) ?? asVec3(artifactLayout?.bounds_min);
  const meshBoundsMax = asVec3(femArtifactLayout?.bounds_max) ?? asVec3(artifactLayout?.bounds_max);
  const meshExtent =
    asVec3(femArtifactLayout?.mesh_extent)
    ?? asVec3(artifactLayout?.mesh_extent)
    ?? asVec3(femArtifactLayout?.world_extent)
    ?? asVec3(artifactLayout?.world_extent);
  const layoutWorldExtent =
    asVec3(femArtifactLayout?.world_extent) ?? asVec3(artifactLayout?.world_extent);
  const layoutWorldCenter =
    asVec3(femArtifactLayout?.world_center) ?? asVec3(artifactLayout?.world_center);
  const layoutWorldExtentSource =
    typeof femArtifactLayout?.world_extent_source === "string"
      ? femArtifactLayout.world_extent_source
      : (typeof artifactLayout?.world_extent_source === "string"
          ? artifactLayout.world_extent_source
          : null);
  const meshName = typeof femArtifactLayout?.mesh_name === "string" ? femArtifactLayout.mesh_name : null;
  const meshSource = typeof femArtifactLayout?.mesh_source === "string" ? femArtifactLayout.mesh_source : null;
  const meshFeOrder = typeof femArtifactLayout?.fe_order === "number" ? femArtifactLayout.fe_order : null;
  const meshHmax = typeof femArtifactLayout?.hmax === "number" ? femArtifactLayout.hmax : null;
  const meshSummary = meshWorkspace?.mesh_summary ?? null;
  const liveMeshName = typeof femMesh?.mesh_name === "string" ? femMesh.mesh_name : null;
  const liveMeshDomainFrame = femMesh?.domain_frame ?? null;
  const builderObjectOverlays = useMemo<BuilderObjectOverlay[]>(
    () => buildObjectOverlays(scriptBuilderGeometries, femMesh),
    [femMesh, scriptBuilderGeometries],
  );
  const builderObjectBounds = useMemo(
    () => combineBounds(builderObjectOverlays),
    [builderObjectOverlays],
  );
  const builderObjectExtent = useMemo<[number, number, number] | null>(
    () =>
      builderObjectBounds
        ? boundsExtent(builderObjectBounds.boundsMin, builderObjectBounds.boundsMax)
        : null,
    [builderObjectBounds],
  );
  const builderObjectCenter = useMemo<[number, number, number] | null>(
    () =>
      builderObjectBounds
        ? boundsCenter(builderObjectBounds.boundsMin, builderObjectBounds.boundsMax)
        : null,
    [builderObjectBounds],
  );
  const domainFrame = useMemo<DomainFrameState | null>(() => {
    if (!isFemBackend) {
      return null;
    }
    if (liveMeshDomainFrame) {
      return liveMeshDomainFrame;
    }
    const builderDomainFrame = scriptBuilder?.domain_frame ?? null;
    const meshDomainFrame = meshSummary?.domain_frame ?? null;
    if (meshDomainFrame) {
      return meshDomainFrame;
    }
    if (builderDomainFrame) {
      return builderDomainFrame;
    }
    if (
      !scriptBuilderUniverse
      && !builderObjectBounds
      && !layoutWorldExtent
      && !meshBoundsMin
      && !meshBoundsMax
    ) {
      return null;
    }
    return {
      declared_universe: scriptBuilderUniverse
        ? {
            mode: scriptBuilderUniverse.mode,
            size: scriptBuilderUniverse.size,
            center: scriptBuilderUniverse.center,
            padding: scriptBuilderUniverse.padding,
            airbox_hmax: scriptBuilderUniverse.airbox_hmax,
            airbox_hmin: scriptBuilderUniverse.airbox_hmin,
            airbox_growth_rate: scriptBuilderUniverse.airbox_growth_rate,
          }
        : null,
      object_bounds_min: builderObjectBounds?.boundsMin ?? null,
      object_bounds_max: builderObjectBounds?.boundsMax ?? null,
      mesh_bounds_min: meshBoundsMin ?? null,
      mesh_bounds_max: meshBoundsMax ?? null,
      effective_extent:
        scriptBuilderUniverse?.mode === "manual" && scriptBuilderUniverse.size
          ? scriptBuilderUniverse.size
          : scriptBuilderUniverse?.mode === "auto" && builderObjectExtent
            ? builderObjectExtent.map((component, index) =>
                component + 2 * (scriptBuilderUniverse.padding?.[index] ?? 0)
              ) as [number, number, number]
            : layoutWorldExtent ?? builderObjectExtent ?? null,
      effective_center:
        scriptBuilderUniverse?.center
        ?? builderObjectCenter
        ?? layoutWorldCenter
        ?? (meshBoundsMin && meshBoundsMax ? boundsCenter(meshBoundsMin, meshBoundsMax) : null),
      effective_source:
        scriptBuilderUniverse?.mode === "manual" && scriptBuilderUniverse.size
          ? "declared_universe_manual"
          : scriptBuilderUniverse?.mode === "auto" && builderObjectExtent
            ? (
                (scriptBuilderUniverse.padding ?? [0, 0, 0]).some(
                  (component) => Math.abs(component) > 0,
                )
                  ? "declared_universe_auto_padding"
                  : "object_union_bounds"
              )
            : layoutWorldExtentSource ?? (builderObjectExtent ? "object_union_bounds" : null),
    };
  }, [
    builderObjectBounds,
    builderObjectCenter,
    builderObjectExtent,
    isFemBackend,
    layoutWorldCenter,
    layoutWorldExtent,
    layoutWorldExtentSource,
    liveMeshDomainFrame,
    meshBoundsMax,
    meshBoundsMin,
    meshSummary?.domain_frame,
    scriptBuilder?.domain_frame,
    scriptBuilderUniverse,
  ]);

  /* Unified world extent (metres) for both FDM and FEM */
  const worldExtent = useMemo<[number, number, number] | null>(() => {
    if (isFemBackend) {
      return domainFrame?.effective_extent ?? null;
    }
    // FDM: compute from grid_cells × cell_size
    const gridCells = asVec3(artifactLayout?.grid_cells);
    const cellSize = asVec3(artifactLayout?.cell_size);
    if (gridCells && cellSize) {
      return [
        gridCells[0] * cellSize[0],
        gridCells[1] * cellSize[1],
        gridCells[2] * cellSize[2],
      ];
    }
    return null;
  }, [artifactLayout, domainFrame, isFemBackend]);
  const worldCenter = useMemo<[number, number, number] | null>(() => {
    if (isFemBackend) {
      return domainFrame?.effective_center ?? null;
    }
    return scriptBuilderUniverse?.center ?? null;
  }, [domainFrame, isFemBackend, scriptBuilderUniverse]);
  const worldExtentSource = useMemo<string | null>(() => {
    if (!isFemBackend) {
      return "fdm_grid";
    }
    return domainFrame?.effective_source ?? null;
  }, [domainFrame, isFemBackend]);
  const antennaOverlays = useMemo<AntennaOverlay[]>(() => {
    if (!meshBoundsMin || !meshBoundsMax || scriptBuilderCurrentModules.length === 0) {
      return [];
    }
    const centerX0 = 0.5 * (meshBoundsMin[0] + meshBoundsMax[0]);
    const centerY0 = 0.5 * (meshBoundsMin[1] + meshBoundsMax[1]);
    const topZ = meshBoundsMax[2];
    const num = (record: Record<string, unknown>, key: string, fallback: number) =>
      typeof record[key] === "number" ? Number(record[key]) : fallback;

    return scriptBuilderCurrentModules.flatMap((module) => {
      const params = module.antenna_params ?? {};
      const centerX = centerX0 + num(params, "center_x", 0);
      const centerY = centerY0 + num(params, "center_y", 0);
      const thickness = num(params, "thickness", 100e-9);
      const previewLength = num(params, "preview_length", 5e-6);
      const heightAboveMagnet = num(params, "height_above_magnet", 0);
      const zBottom = topZ + heightAboveMagnet;
      const zTop = zBottom + thickness;
      const yMin = centerY - previewLength * 0.5;
      const yMax = centerY + previewLength * 0.5;
      const conductors: AntennaOverlay["conductors"] = [];

      if (module.antenna_kind === "MicrostripAntenna") {
        const width = num(params, "width", 1e-6);
        conductors.push({
          id: `${module.name}:strip`,
          label: module.name,
          role: "strip",
          boundsMin: [centerX - width * 0.5, yMin, zBottom],
          boundsMax: [centerX + width * 0.5, yMax, zTop],
          currentA: module.drive.current_a,
        });
      } else if (module.antenna_kind === "CPWAntenna") {
        const signalWidth = num(params, "signal_width", 1e-6);
        const gap = num(params, "gap", 0.25e-6);
        const groundWidth = num(params, "ground_width", 1e-6);
        const groundOffset = 0.5 * signalWidth + gap + 0.5 * groundWidth;
        conductors.push({
          id: `${module.name}:signal`,
          label: `${module.name} signal`,
          role: "signal",
          boundsMin: [centerX - signalWidth * 0.5, yMin, zBottom],
          boundsMax: [centerX + signalWidth * 0.5, yMax, zTop],
          currentA: module.drive.current_a,
        });
        conductors.push({
          id: `${module.name}:ground_l`,
          label: `${module.name} ground`,
          role: "ground",
          boundsMin: [centerX - groundOffset - groundWidth * 0.5, yMin, zBottom],
          boundsMax: [centerX - groundOffset + groundWidth * 0.5, yMax, zTop],
          currentA: -0.5 * module.drive.current_a,
        });
        conductors.push({
          id: `${module.name}:ground_r`,
          label: `${module.name} ground`,
          role: "ground",
          boundsMin: [centerX + groundOffset - groundWidth * 0.5, yMin, zBottom],
          boundsMax: [centerX + groundOffset + groundWidth * 0.5, yMax, zTop],
          currentA: -0.5 * module.drive.current_a,
        });
      }

      if (conductors.length === 0) {
        return [];
      }
      return [{
        id: module.name,
        name: module.name,
        antennaKind: module.antenna_kind,
        solver: module.solver,
        conductors,
      }];
    });
  }, [meshBoundsMax, meshBoundsMin, scriptBuilderCurrentModules]);
  const meshingCapabilities = (metadata?.meshing_capabilities as Record<string, unknown> | undefined) ?? undefined;
  const mesherBackend = typeof meshingCapabilities?.backend === "string" ? meshingCapabilities.backend : null;
  const mesherSourceKind = typeof meshingCapabilities?.source_kind === "string" ? meshingCapabilities.source_kind : null;
  const mesherCurrentSettings = (meshingCapabilities?.current_settings as Record<string, unknown> | undefined) ?? null;

  /* Grid */
  const _rawSolverGrid = liveState?.grid ?? state?.latest_fields.grid;
  const solverGrid = useMemo<[number, number, number]>(
    () => [_rawSolverGrid?.[0] ?? 0, _rawSolverGrid?.[1] ?? 0, _rawSolverGrid?.[2] ?? 0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [_rawSolverGrid?.[0], _rawSolverGrid?.[1], _rawSolverGrid?.[2]],
  );
  const _rawPreviewGrid =
    spatialPreview?.preview_grid ?? liveState?.preview_grid ?? state?.latest_fields.grid ?? solverGrid;
  const previewGrid = useMemo<[number, number, number]>(
    () => [_rawPreviewGrid?.[0] ?? 0, _rawPreviewGrid?.[1] ?? 0, _rawPreviewGrid?.[2] ?? 0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [_rawPreviewGrid?.[0], _rawPreviewGrid?.[1], _rawPreviewGrid?.[2]],
  );
  const totalCells = !isFemBackend ? solverGrid[0] * solverGrid[1] * solverGrid[2] : null;
  const activeCells = useMemo(() => {
    if (typeof artifactLayout?.active_cell_count === "number") return artifactLayout.active_cell_count;
    return totalCells;
  }, [artifactLayout, totalCells]);
  const inactiveCells = useMemo(() => {
    if (typeof artifactLayout?.inactive_cell_count === "number") return artifactLayout.inactive_cell_count;
    if (activeCells != null && totalCells != null) return Math.max(totalCells - activeCells, 0);
    return null;
  }, [activeCells, artifactLayout, totalCells]);
  const activeMaskPresent =
    artifactLayout?.active_mask_present === true || spatialPreview?.active_mask != null;
  const activeMask = useMemo<boolean[] | null>(() => {
    // Prefer live preview mask (resampled to preview grid) over static artifact layout mask.
    if (spatialPreview?.active_mask != null) return spatialPreview.active_mask;
    const raw = artifactLayout?.active_mask;
    if (!Array.isArray(raw)) return null;
    return raw.map((v: unknown) => Boolean(v));
  }, [spatialPreview?.active_mask, artifactLayout]);

  /* Interactive */
  const interactiveEnabled = session?.interactive_session_requested === true;
  const awaitingCommand = workspaceStatus === "awaiting_command";
  const runtimeCanAcceptCommands =
    runtimeStatus?.can_accept_commands ?? interactiveEnabled;
  const interactiveControlsEnabled =
    interactiveEnabled &&
    (awaitingCommand || isWaitingForCompute || workspaceStatus === "running" || workspaceStatus === "paused");

  /* Preview derived — keep the user's explicit viewport mode stable.
   * A transient preview payload should not silently downgrade 3D to 2D. */
  const effectiveViewMode = viewMode;
  const requestedDisplaySelection = useMemo<DisplaySelection>(() => {
    if (optimisticDisplaySelection) {
      return optimisticDisplaySelection;
    }
    const quantity =
      displaySelection?.selection.quantity ?? previewConfig?.quantity ?? preview?.quantity ?? "m";
    return {
      quantity,
      kind: displaySelection?.selection.kind ?? kindForQuantity(quantity),
      component:
        displaySelection?.selection.component ??
        previewConfig?.component ??
        spatialPreview?.component ??
        "3D",
      layer:
        displaySelection?.selection.layer ??
        previewConfig?.layer ??
        spatialPreview?.layer ??
        0,
      all_layers:
        displaySelection?.selection.all_layers ??
        previewConfig?.all_layers ??
        spatialPreview?.all_layers ??
        false,
      x_chosen_size:
        displaySelection?.selection.x_chosen_size ??
        previewConfig?.x_chosen_size ??
        spatialPreview?.x_chosen_size ??
        0,
      y_chosen_size:
        displaySelection?.selection.y_chosen_size ??
        previewConfig?.y_chosen_size ??
        spatialPreview?.y_chosen_size ??
        0,
      every_n:
        displaySelection?.selection.every_n ?? previewConfig?.every_n ?? PREVIEW_EVERY_N_DEFAULT,
      max_points:
        displaySelection?.selection.max_points ??
        previewConfig?.max_points ??
        spatialPreview?.max_points ??
        PREVIEW_MAX_POINTS_DEFAULT,
      auto_scale_enabled:
        displaySelection?.selection.auto_scale_enabled ??
        previewConfig?.auto_scale_enabled ??
        spatialPreview?.auto_scale_enabled ??
        true,
    };
  }, [displaySelection, kindForQuantity, optimisticDisplaySelection, preview, previewConfig, spatialPreview]);
  const currentPreviewRevision = displaySelection?.revision ?? previewConfig?.revision ?? null;
  const previewControlsActive = Boolean(displaySelection ?? previewConfig ?? preview);
  const requestedPreviewQuantity = requestedDisplaySelection.quantity;
  const requestedPreviewComponent = requestedDisplaySelection.component;
  const requestedPreviewLayer = requestedDisplaySelection.layer;
  const requestedPreviewAllLayers = requestedDisplaySelection.all_layers;
  const requestedPreviewEveryN = requestedDisplaySelection.every_n;
  const requestedPreviewXChosenSize = requestedDisplaySelection.x_chosen_size;
  const requestedPreviewYChosenSize = requestedDisplaySelection.y_chosen_size;
  const requestedPreviewAutoScale = requestedDisplaySelection.auto_scale_enabled;
  const requestedPreviewMaxPoints = requestedDisplaySelection.max_points;

  const previewEveryNOptions = useMemo(
    () => Array.from(new Set([...PREVIEW_EVERY_N_PRESETS, requestedPreviewEveryN])).sort((a, b) => a - b),
    [requestedPreviewEveryN],
  );
  const previewMaxPointOptions = useMemo(() => {
    const values = new Set<number>([...PREVIEW_MAX_POINTS_PRESETS, requestedPreviewMaxPoints]);
    return Array.from(values).sort((a, b) => { if (a === 0) return 1; if (b === 0) return -1; return a - b; });
  }, [requestedPreviewMaxPoints]);

  const isGlobalScalarQuantity = useCallback(
    (quantity: string | null | undefined) =>
      Boolean(quantity && quantityDescriptorById.get(quantity)?.kind === "global_scalar"),
    [quantityDescriptorById],
  );
  const previewIsStale = Boolean(
    preview &&
    currentPreviewRevision != null &&
    preview.config_revision !== currentPreviewRevision,
  );
  const previewIsBootstrapStale = Boolean(previewControlsActive && preview && effectiveStep > 0 && preview.source_step === 0);
  const displaySelectionPending = optimisticDisplaySelection != null;
  const previewBusy = previewPostInFlight || displaySelectionPending;
  const renderPreview = spatialPreview;
  const activeQuantityId =
    previewControlsActive
      ? (previewIsStale ? requestedPreviewQuantity : (preview?.quantity ?? requestedPreviewQuantity))
      : selectedQuantity;
  const isMeshPreview = renderPreview?.spatial_kind === "mesh";
  const previewVectorComponent: VectorComponent =
    renderPreview?.component && renderPreview.component !== "3D"
      ? (renderPreview.component as VectorComponent)
      : "magnitude";
  const effectiveVectorComponent = isMeshPreview ? previewVectorComponent : component;

  const appendFrontendTrace = useCallback((level: string, message: string) => {
    if (level === "error") {
      console.error(`[control-room] ${message}`);
    } else if (level === "warn") {
      console.warn(`[control-room] ${message}`);
    } else {
      console.info(`[control-room] ${message}`);
    }
    setFrontendTraceLog((prev) => {
      const next = [
        ...prev,
        {
          timestamp_unix_ms: Date.now(),
          level,
          message,
        },
      ];
      return next.length > 120 ? next.slice(next.length - 120) : next;
    });
  }, []);

  /* Callbacks */
  const enqueueCommand = useCallback(async (payload: Record<string, unknown>) => {
    setCommandPostInFlight(true);
    setCommandErrorMessage(null);
    const commandKind =
      typeof payload.kind === "string" ? payload.kind.toUpperCase() : "COMMAND";
    appendFrontendTrace("info", `TX: ${commandKind} ${JSON.stringify(payload)}`);
    try {
      await liveApi.queueCommand(payload);
      appendFrontendTrace("system", `RX: HTTP accepted ${commandKind}`);
    } catch (e) {
      appendFrontendTrace(
        "error",
        `RX: HTTP rejected ${commandKind} — ${e instanceof Error ? e.message : "Failed to queue command"}`,
      );
      setCommandErrorMessage(e instanceof Error ? e.message : "Failed to queue command");
    } finally {
      setCommandPostInFlight(false);
    }
  }, [appendFrontendTrace, liveApi]);

  const buildMeshOptionsPayload = useCallback(
    (
      options: MeshOptionsState,
      refinementZonesOverride?: MeshOptionsState["refinementZones"],
    ) => ({
      algorithm_2d: options.algorithm2d,
      algorithm_3d: options.algorithm3d,
      hmax: parseOptionalFiniteNumberText(options.hmax),
      hmin: parseOptionalFiniteNumberText(options.hmin),
      size_factor: options.sizeFactor,
      size_from_curvature: options.sizeFromCurvature,
      growth_rate: parseOptionalFiniteNumberText(options.growthRate),
      narrow_regions: options.narrowRegions,
      smoothing_steps: options.smoothingSteps,
      optimize: options.optimize || null,
      optimize_iterations: options.optimizeIters,
      compute_quality: options.computeQuality,
      per_element_quality: options.perElementQuality,
      size_fields:
        (refinementZonesOverride ?? options.refinementZones).length > 0
          ? (refinementZonesOverride ?? options.refinementZones)
          : undefined,
      per_geometry: meshPerGeometryPayload,
    }),
    [meshPerGeometryPayload],
  );

  const enqueueStudyDomainRemesh = useCallback(
    async (
      meshReason: string,
      meshOptionsPayload: Record<string, unknown>,
      meshTarget: MeshCommandTarget = { kind: "study_domain" },
    ) => {
      setCommandPostInFlight(true);
      setCommandErrorMessage(null);
      const targetKindLabel =
        meshTarget.kind === "object_mesh"
          ? `object_mesh:${meshTarget.object_id}`
          : meshTarget.kind;
      const payload = {
        kind: "remesh",
        mesh_target: meshTarget,
        mesh_reason: meshReason,
        mesh_options: meshOptionsPayload,
      };
      appendFrontendTrace("info", `TX: REMESH ${JSON.stringify(payload)}`);
      try {
        await liveApi.queueRemesh({
          mesh_options: meshOptionsPayload,
          mesh_target: meshTarget,
          mesh_reason: meshReason,
        });
        appendFrontendTrace(
          "system",
          `RX: HTTP accepted REMESH target=${targetKindLabel} reason=${meshReason}`,
        );
      } catch (e) {
        appendFrontendTrace(
          "error",
          `RX: HTTP rejected REMESH target=${targetKindLabel} — ${e instanceof Error ? e.message : "Failed to queue command"}`,
        );
        setCommandErrorMessage(
          e instanceof Error ? e.message : "Failed to queue remesh command",
        );
        throw e;
      } finally {
        setCommandPostInFlight(false);
      }
    },
    [appendFrontendTrace, liveApi],
  );

  const updatePreview = useCallback(async (path: string, payload: Record<string, unknown> = {}) => {
    const nextSelection: DisplaySelection = { ...requestedDisplaySelection };
    switch (path) {
      case "/quantity":
        nextSelection.quantity = typeof payload.quantity === "string" ? payload.quantity : nextSelection.quantity;
        nextSelection.kind = kindForQuantity(nextSelection.quantity);
        break;
      case "/component":
        nextSelection.component = typeof payload.component === "string" ? payload.component : nextSelection.component;
        break;
      case "/layer":
        nextSelection.layer = Number(payload.layer ?? nextSelection.layer);
        break;
      case "/allLayers":
        nextSelection.all_layers = Boolean(payload.allLayers ?? nextSelection.all_layers);
        break;
      case "/everyN":
        nextSelection.every_n = Number(payload.everyN ?? nextSelection.every_n);
        break;
      case "/XChosenSize":
        nextSelection.x_chosen_size = Number(payload.xChosenSize ?? nextSelection.x_chosen_size);
        break;
      case "/YChosenSize":
        nextSelection.y_chosen_size = Number(payload.yChosenSize ?? nextSelection.y_chosen_size);
        break;
      case "/autoScaleEnabled":
        nextSelection.auto_scale_enabled = Boolean(payload.autoScaleEnabled ?? nextSelection.auto_scale_enabled);
        break;
      case "/maxPoints":
        nextSelection.max_points = Number(payload.maxPoints ?? nextSelection.max_points);
        break;
      default:
        setPreviewPostInFlight(true);
        setPreviewMessage(null);
        try { await liveApi.updatePreview(path, payload); }
        catch (e) { setPreviewMessage(e instanceof Error ? e.message : "Failed to update preview"); }
        finally { setPreviewPostInFlight(false); }
        return;
    }
    setOptimisticDisplaySelection(nextSelection);
    setPreviewPostInFlight(true);
    setPreviewMessage(`Switching to ${nextSelection.quantity}`);
    try {
      await liveApi.updateDisplaySelection(nextSelection as unknown as Record<string, unknown>);
    }
    catch (e) {
      setOptimisticDisplaySelection(null);
      setPreviewMessage(e instanceof Error ? e.message : "Failed to update preview");
    }
    finally { setPreviewPostInFlight(false); }
  }, [kindForQuantity, liveApi, requestedDisplaySelection]);

  const meshGenTopologyRef = useRef<string | null>(null);
  const meshGenGenerationRef = useRef<string | null>(null);
  const femGenerationIdRef = useRef<string | null>(null);

  const handleStudyDomainMeshGenerate = useCallback(async (meshReason = "manual_ui_rebuild_selected") => {
    setMeshGenerating(true);
    meshGenTopologyRef.current = femTopologyKeyRef.current;
    meshGenGenerationRef.current = femGenerationIdRef.current;
    pendingMeshConfigSignatureRef.current = meshConfigSignatureRef.current;
    try {
      await enqueueStudyDomainRemesh(
        meshReason,
        buildMeshOptionsPayload(meshOptions),
      );
    } catch (err) {
      setCommandErrorMessage(err instanceof Error ? err.message : "Mesh generation failed");
      setMeshGenerating(false);
      meshGenTopologyRef.current = null;
      meshGenGenerationRef.current = null;
      pendingMeshConfigSignatureRef.current = null;
    }
  }, [buildMeshOptionsPayload, enqueueStudyDomainRemesh, meshOptions]);

  const handleAirboxMeshGenerate = useCallback(async () => {
    setMeshGenerating(true);
    meshGenTopologyRef.current = femTopologyKeyRef.current;
    meshGenGenerationRef.current = femGenerationIdRef.current;
    pendingMeshConfigSignatureRef.current = meshConfigSignatureRef.current;
    try {
      await enqueueStudyDomainRemesh(
        "airbox_parameter_changed",
        buildMeshOptionsPayload(meshOptions),
        { kind: "airbox" },
      );
    } catch (err) {
      setCommandErrorMessage(
        err instanceof Error ? err.message : "Airbox mesh rebuild failed",
      );
      setMeshGenerating(false);
      meshGenTopologyRef.current = null;
      meshGenGenerationRef.current = null;
      pendingMeshConfigSignatureRef.current = null;
    }
  }, [buildMeshOptionsPayload, enqueueStudyDomainRemesh, meshOptions]);

  const handleObjectMeshOverrideRebuild = useCallback(
    async (objectId?: string | null) => {
      setMeshGenerating(true);
      meshGenTopologyRef.current = femTopologyKeyRef.current;
      meshGenGenerationRef.current = femGenerationIdRef.current;
      pendingMeshConfigSignatureRef.current = meshConfigSignatureRef.current;
      try {
        const scriptPath = session?.script_path ?? null;
        if (!scriptPath) {
          throw new Error("No script path is available for the active workspace");
        }
        setScriptSyncBusy(true);
        setScriptSyncMessage(null);
        appendFrontendTrace("info", `TX: SCRIPT_SYNC ${scriptPath}`);
        if (builderPushTimerRef.current) {
          clearTimeout(builderPushTimerRef.current);
          builderPushTimerRef.current = null;
        }
        await liveApi.updateSceneDocument(localBuilderDraft);
        lastBuilderPushSignatureRef.current = localBuilderSignature;
        const response = await liveApi.syncScript();
        const syncedPath =
          typeof response.script_path === "string" && response.script_path.trim().length > 0
            ? response.script_path
            : scriptPath;
        setScriptSyncMessage(
          `Synced ${syncedPath.split("/").pop() ?? "script"} to canonical Python`,
        );
        appendFrontendTrace(
          "success",
          `RX: SCRIPT_SYNC ok — ${syncedPath.split("/").pop() ?? "script"}`,
        );
        await enqueueStudyDomainRemesh(
          objectId ? `object_mesh_override_changed:${objectId}` : "object_mesh_override_changed",
          buildMeshOptionsPayload(meshOptions),
          objectId ? { kind: "object_mesh", object_id: objectId } : { kind: "study_domain" },
        );
      } catch (err) {
        setCommandErrorMessage(
          err instanceof Error ? err.message : "Object mesh override rebuild failed",
        );
        setMeshGenerating(false);
        meshGenTopologyRef.current = null;
        meshGenGenerationRef.current = null;
        pendingMeshConfigSignatureRef.current = null;
      } finally {
        setScriptSyncBusy(false);
      }
    },
    [
      appendFrontendTrace,
      buildMeshOptionsPayload,
      enqueueStudyDomainRemesh,
      liveApi,
      localBuilderDraft,
      localBuilderSignature,
      meshOptions,
      session?.script_path,
    ],
  );

  const handleLassoRefine = useCallback(async (faceIndices: number[], factor: number) => {
    const currentFemMeshData = femMeshDataRef.current;
    if (!currentFemMeshData || faceIndices.length === 0) return;
    const nodes = currentFemMeshData.nodes;
    const faces = currentFemMeshData.boundaryFaces;
    let xmin = Infinity, ymin = Infinity, zmin = Infinity;
    let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
    for (const fi of faceIndices) {
      for (let v = 0; v < 3; v++) {
        const ni = faces[fi * 3 + v];
        const x = nodes[ni * 3], y = nodes[ni * 3 + 1], z = nodes[ni * 3 + 2];
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        if (z < zmin) zmin = z; if (z > zmax) zmax = z;
      }
    }
    const currentHmax = parseOptionalFiniteNumberText(meshOptions.hmax) ?? (meshHmax ?? 20e-9);
    const targetH = currentHmax * factor;
    const pad = currentHmax * 2;
    const zone: import("../../panels/MeshSettingsPanel").SizeFieldSpec = {
      kind: "Box",
      params: {
        VIn: targetH, VOut: currentHmax,
        XMin: xmin - pad, XMax: xmax + pad,
        YMin: ymin - pad, YMax: ymax + pad,
        ZMin: zmin - pad, ZMax: zmax + pad,
      },
    };
    const updatedZones = [...meshOptions.refinementZones, zone];
    setMeshOptions((prev) => ({ ...prev, refinementZones: updatedZones }));

    setMeshGenerating(true);
    meshGenTopologyRef.current = femTopologyKeyRef.current;
    meshGenGenerationRef.current = femGenerationIdRef.current;
    pendingMeshConfigSignatureRef.current = meshConfigSignatureRef.current;
    try {
      await enqueueStudyDomainRemesh(
        "lasso_refine",
        buildMeshOptionsPayload(meshOptions, updatedZones),
      );
    } catch (err) {
      setCommandErrorMessage(err instanceof Error ? err.message : "Lasso refine failed");
      setMeshGenerating(false);
      meshGenTopologyRef.current = null;
      meshGenGenerationRef.current = null;
      pendingMeshConfigSignatureRef.current = null;
    }
  }, [buildMeshOptionsPayload, enqueueStudyDomainRemesh, meshHmax, meshOptions]);

  const handleCompute = useCallback(() => {
    void enqueueCommand({ kind: "solve" });
  }, [enqueueCommand]);

  const openFemMeshWorkspace = useCallback((tab: FemDockTab = "mesh") => {
    startTransition(() => {
      setViewMode("Mesh");
      setFemDockTab(tab);
    });
    setMeshRenderMode((c) => (c === "surface" ? "surface+edges" : c));
  }, []);

  const requestFocusObject = useCallback((objectId: string) => {
    if (!objectId) {
      return;
    }
    setFocusObjectRequest((previous) => ({
      objectId,
      revision: previous && previous.objectId === objectId ? previous.revision + 1 : 1,
    }));
  }, []);

  const applyAntennaTranslation = useCallback((moduleName: string, dx: number, dy: number, dz: number) => {
    setScriptBuilderCurrentModules((prev) =>
      prev.map((mod) => {
        if (mod.name !== moduleName) return mod;
        const p = mod.antenna_params ?? {};
        return {
          ...mod,
          antenna_params: {
            ...p,
            center_x: (Number(p.center_x) || 0) + dx,
            center_y: (Number(p.center_y) || 0) + dy,
            height_above_magnet: (Number(p.height_above_magnet) || 0) + dz,
          },
        };
      })
    );
  }, []);

  const applyGeometryTranslation = useCallback((geometryName: string, dx: number, dy: number, dz: number) => {
    setSceneDocument((previousScene) => {
      const baseScene = previousScene ?? localBuilderDraft;
      const nextScene: SceneDocument = {
        ...baseScene,
        objects: baseScene.objects.map((object) => {
          if (object.id !== geometryName && object.name !== geometryName) {
            return object;
          }
          const translation = object.transform.translation ?? [0, 0, 0];
          return {
            ...object,
            transform: {
              ...object.transform,
              translation: [
                Number(translation[0] ?? 0) + dx,
                Number(translation[1] ?? 0) + dy,
                Number(translation[2] ?? 0) + dz,
              ],
            },
          };
        }),
      };
      return nextScene;
    });
  }, [localBuilderDraft, setSceneDocument]);

  const applyMeshWorkspacePreset = useCallback((presetId: MeshWorkspacePresetId) => {
    const preset = MESH_WORKSPACE_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;

    startTransition(() => {
      if (preset.viewMode === "2D") {
        setComponent((prev) => (prev === "magnitude" ? "x" : prev));
      }
      setViewMode(preset.viewMode);
      setFemDockTab(preset.dockTab);
      setSelectedSidebarNodeId(
        preset.dockTab === "quality"
          ? "universe-mesh-quality"
          : preset.dockTab === "mesher"
            ? "universe-mesh-size"
            : preset.dockTab === "pipeline"
              ? "universe-mesh-pipeline"
              : "universe-mesh-view",
      );
    });

    setMeshRenderMode(preset.renderMode);
    if (preset.clipEnabled !== undefined) setMeshClipEnabled(preset.clipEnabled);
    if (preset.opacity != null) setMeshOpacity(preset.opacity);
  }, []);

  const handleViewModeChange = useCallback((mode: string) => {
    if (mode === "Mesh") { if (isFemBackend) openFemMeshWorkspace("mesh"); startTransition(() => setViewMode("Mesh")); return; }
    if (mode === "2D") {
      startTransition(() => {
        setComponent((prev) => prev === "magnitude" ? "x" : prev);
      });
    }
    startTransition(() => {
      setViewMode(mode as ViewportMode);
    });
  }, [isFemBackend, openFemMeshWorkspace]);

  const handleSimulationAction = useCallback((action: string) => {
    if (action === "compute" || action === "solve") {
      handleCompute();
      return;
    }

    if (action === "run") {
      if (workspaceStatus === "paused") {
        void enqueueCommand({ kind: "resume" });
        return;
      }
      const untilSeconds = parseOptionalNumber(runUntilInput);
      if (untilSeconds == null || untilSeconds <= 0) {
        setCommandErrorMessage("Run requires a positive stop time");
        return;
      }
      void enqueueCommand({
        kind: "run",
        until_seconds: untilSeconds,
        integrator: solverSettings.integrator,
        fixed_timestep: parseOptionalNumber(solverSettings.fixedTimestep),
      });
      return;
    }

    if (action === "relax") {
      const maxSteps = parseOptionalNumber(solverSettings.maxRelaxSteps);
      if (maxSteps == null || maxSteps <= 0) {
        setCommandErrorMessage("Relax requires a positive max step count");
        return;
      }
      void enqueueCommand({
        kind: "relax",
        max_steps: maxSteps,
        torque_tolerance: parseOptionalNumber(solverSettings.torqueTolerance),
        energy_tolerance: parseOptionalNumber(solverSettings.energyTolerance),
        relax_algorithm: solverSettings.relaxAlgorithm,
        relax_alpha: parseOptionalNumber(solverSettings.relaxAlpha),
      });
      return;
    }

    if (action === "pause") {
      void enqueueCommand({ kind: "pause" });
      return;
    }

    if (action === "resume") {
      void enqueueCommand({ kind: "resume" });
      return;
    }

    if (action === "stop") {
      void enqueueCommand({ kind: "stop" });
    }
  }, [
    enqueueCommand,
    handleCompute,
    runUntilInput,
    solverSettings.fixedTimestep,
    solverSettings.integrator,
    solverSettings.energyTolerance,
    solverSettings.maxRelaxSteps,
    solverSettings.relaxAlgorithm,
    solverSettings.relaxAlpha,
    solverSettings.torqueTolerance,
    workspaceStatus,
  ]);

  const handleCapture = useCallback(() => {
    // Try viewport-scoped WebGL canvas first (R3F 3D view)
    const canvas =
      document.querySelector<HTMLCanvasElement>("#workspace-viewport canvas") ??
      document.querySelector<HTMLCanvasElement>("[class*='viewport'] canvas");
    if (canvas) {
      const link = document.createElement("a");
      link.download = `fullmag_snapshot_${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      return;
    }
    // Fallback: try any echarts instance on the page
    const echartsContainer = document.querySelector<HTMLDivElement>("[_echarts_instance_]");
    if (echartsContainer) {
      const echartsCanvas = echartsContainer.querySelector<HTMLCanvasElement>("canvas");
      if (echartsCanvas) {
        const link = document.createElement("a");
        link.download = `fullmag_snapshot_${Date.now()}.png`;
        link.href = echartsCanvas.toDataURL("image/png");
        link.click();
        return;
      }
    }
    // Last resort: any canvas
    const anyCanvas = document.querySelector<HTMLCanvasElement>("canvas");
    if (anyCanvas) {
      const link = document.createElement("a");
      link.download = `fullmag_snapshot_${Date.now()}.png`;
      link.href = anyCanvas.toDataURL("image/png");
      link.click();
    }
  }, []);

  const handleExport = useCallback(() => { void enqueueCommand({ kind: "save_vtk" }); }, [enqueueCommand]);

  const handleStateExport = useCallback(async (format: string) => {
    setStateIoBusy(true);
    setStateIoMessage(null);
    try {
      const response = await liveApi.exportState({ format }) as {
        file_name?: unknown;
        content_base64?: unknown;
        stored_path?: unknown;
      };
      const fileName =
        typeof response.file_name === "string" && response.file_name.trim().length > 0
          ? response.file_name
          : `m_state.${format}`;
      const contentBase64 =
        typeof response.content_base64 === "string" ? response.content_base64 : "";
      if (!contentBase64) {
        throw new Error("Export response did not contain file content");
      }
      downloadBase64File(fileName, contentBase64);
      setStateIoMessage(
        typeof response.stored_path === "string" && response.stored_path.trim().length > 0
          ? `Exported ${fileName} to ${response.stored_path}`
          : `Exported ${fileName}`,
      );
    } catch (error) {
      setStateIoMessage(error instanceof Error ? error.message : "Failed to export state");
    } finally {
      setStateIoBusy(false);
    }
  }, [liveApi]);

  const handleStateImport = useCallback(async (
    file: File,
    options?: {
      format?: string;
      applyToWorkspace?: boolean;
      attachToScriptBuilder?: boolean;
    },
  ) => {
    setStateIoBusy(true);
    setStateIoMessage(null);
    try {
      const contentBase64 = await fileToBase64(file);
      const response = await liveApi.importState({
        file_name: file.name,
        content_base64: contentBase64,
        format: options?.format ?? undefined,
        apply_to_workspace: options?.applyToWorkspace ?? true,
        attach_to_script_builder: options?.attachToScriptBuilder ?? true,
      }) as { stored_path?: unknown; applied_to_workspace?: unknown };
      const importedPath =
        typeof response.stored_path === "string" && response.stored_path.trim().length > 0
          ? response.stored_path
          : file.name;
      const applied =
        typeof response.applied_to_workspace === "boolean"
          ? response.applied_to_workspace
          : (options?.applyToWorkspace ?? true);
      setStateIoMessage(
        applied
          ? `Imported ${file.name} and applied it to the workspace`
          : `Imported ${file.name} to ${importedPath}`,
      );
    } catch (error) {
      setStateIoMessage(error instanceof Error ? error.message : "Failed to import state");
    } finally {
      setStateIoBusy(false);
    }
  }, [liveApi]);

  const syncScriptBuilder = useCallback(async () => {
    const scriptPath = session?.script_path ?? null;
    if (!scriptPath) {
      setScriptSyncMessage("No script path is available for the active workspace");
      appendFrontendTrace("warn", "TX: SCRIPT_SYNC skipped — no script path available");
      return;
    }

    setScriptSyncBusy(true);
    setScriptSyncMessage(null);
    appendFrontendTrace("info", `TX: SCRIPT_SYNC ${scriptPath}`);
    try {
      if (builderPushTimerRef.current) {
        clearTimeout(builderPushTimerRef.current);
        builderPushTimerRef.current = null;
      }
      await liveApi.updateSceneDocument(localBuilderDraft);
      lastBuilderPushSignatureRef.current = localBuilderSignature;
      const response = await liveApi.syncScript();
      const syncedPath =
        typeof response.script_path === "string" && response.script_path.trim().length > 0
          ? response.script_path
          : scriptPath;
      setScriptSyncMessage(`Synced ${syncedPath.split("/").pop() ?? "script"} to canonical Python`);
      appendFrontendTrace(
        "success",
        `RX: SCRIPT_SYNC ok — ${syncedPath.split("/").pop() ?? "script"}`,
      );
    } catch (error) {
      setScriptSyncMessage(error instanceof Error ? error.message : "Failed to sync script");
      appendFrontendTrace(
        "error",
        `RX: SCRIPT_SYNC failed — ${error instanceof Error ? error.message : "Failed to sync script"}`,
      );
    } finally {
      setScriptSyncBusy(false);
    }
  }, [appendFrontendTrace, liveApi, localBuilderDraft, localBuilderSignature, session?.script_path]);

  useEffect(() => {
    if (!commandStatus) return;
    const key = [
      commandStatus.command_id,
      commandStatus.state,
      commandStatus.completion_state ?? "",
      commandStatus.reason ?? "",
    ].join("|");
    if (lastLoggedCommandStatusRef.current === key) return;
    lastLoggedCommandStatusRef.current = key;

    const commandKind = commandStatus.command_kind.toUpperCase();
    if (commandStatus.state === "acknowledged") {
      appendFrontendTrace(
        "system",
        `RX: ${commandKind} ACK seq=${commandStatus.seq ?? "?"} id=${commandStatus.command_id}`,
      );
      return;
    }
    if (commandStatus.state === "rejected") {
      appendFrontendTrace(
        "error",
        `RX: ${commandKind} REJECTED — ${commandStatus.reason ?? "unknown reason"}`,
      );
      return;
    }
    appendFrontendTrace(
      commandStatus.completion_state && commandStatus.completion_state !== "ok" ? "warn" : "success",
      `RX: ${commandKind} COMPLETED${commandStatus.completion_state ? ` (${commandStatus.completion_state})` : ""}`,
    );
  }, [appendFrontendTrace, commandStatus]);

  useEffect(() => {
    if (!optimisticDisplaySelection) {
      return;
    }
    const committedSelection = displaySelection?.selection ?? null;
    if (sameDisplaySelection(optimisticDisplaySelection, committedSelection)) {
      setOptimisticDisplaySelection(null);
      setPreviewMessage(null);
    }
  }, [displaySelection, optimisticDisplaySelection]);

  useEffect(() => {
    if (commandStatus?.state === "rejected" && optimisticDisplaySelection) {
      setOptimisticDisplaySelection(null);
    }
  }, [commandStatus?.state, optimisticDisplaySelection]);

  const activeCommandKind = commandStatus?.command_kind ?? null;
  const activeCommandState = commandStatus?.state ?? null;
  const commandMessage = useMemo(() => {
    if (commandErrorMessage) {
      return commandErrorMessage;
    }
    if (commandPostInFlight) {
      return "Sending command to runtime…";
    }
    if (!commandStatus) {
      return null;
    }
    const label = commandKindLabel(commandStatus.command_kind);
    if (commandStatus.state === "rejected") {
      return commandStatus.reason ? `${label} rejected: ${commandStatus.reason}` : `${label} rejected`;
    }
    if (commandStatus.state === "acknowledged") {
      return `${label} acknowledged`;
    }
    if (commandStatus.completion_state && commandStatus.completion_state !== "ok") {
      return `${label} ${commandStatus.completion_state}`;
    }
    return `${label} completed`;
  }, [commandErrorMessage, commandPostInFlight, commandStatus]);

  const commandBusy = commandPostInFlight;
  const canRunCommand =
    interactiveEnabled &&
    (awaitingCommand || isWaitingForCompute || workspaceStatus === "paused") &&
    runtimeCanAcceptCommands &&
    !commandBusy;
  const canRelaxCommand =
    interactiveEnabled &&
    awaitingCommand &&
    runtimeCanAcceptCommands &&
    !commandBusy;
  const canPauseCommand =
    interactiveEnabled &&
    workspaceStatus === "running" &&
    runtimeCanAcceptCommands &&
    !commandBusy;
  const canStopCommand =
    interactiveEnabled &&
    (isWaitingForCompute || workspaceStatus === "running" || workspaceStatus === "paused") &&
    runtimeCanAcceptCommands &&
    !commandBusy;
  const primaryRunAction =
    isWaitingForCompute ? "compute" : workspaceStatus === "paused" ? "resume" : "run";
  const primaryRunLabel =
    isWaitingForCompute ? "Compute" : workspaceStatus === "paused" ? "Resume" : "Run";

  const requestPreviewQuantity = useCallback((nextQuantity: string) => {
    startTransition(() => {
      if (isFemBackend && effectiveViewMode === "Mesh") setViewMode("3D");
      setSelectedQuantity(nextQuantity);
    });
    if (previewControlsActive) {
      void updatePreview("/quantity", { quantity: nextQuantity });
    }
  }, [effectiveViewMode, isFemBackend, previewControlsActive, updatePreview]);

  /* Keyboard shortcuts */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "1") setViewMode("3D");
      else if (e.key === "2") setViewMode("2D");
      else if (e.key === "3") handleViewModeChange("Mesh");
      else if (e.key === "`" && e.ctrlKey) { e.preventDefault(); setConsoleCollapsed((v) => !v); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleViewModeChange]);

  /* Sparklines */
  const eTotalSpark = useMemo(() => scalarRows.slice(-40).map((r) => r.e_total ?? 0), [scalarRows]);
  const dmDtSpark = useMemo(() => scalarRows.slice(-40).map((r) => Math.log10(Math.max(r.max_dm_dt ?? 1e-15, 1e-15))), [scalarRows]);
  const dtSpark = useMemo(() => scalarRows.slice(-40).map((r) => r.solver_dt ?? 0), [scalarRows]);

  /* Quantity options */
  const quantityOptions = useMemo(
    () => (quantities).map((q) => ({
      value: q.id,
      label: q.available ? `${q.label} (${q.unit})` : `${q.label} (${q.unit}) — waiting for data`,
      disabled: !q.available,
    })),
    [quantities],
  );
  const previewQuantityOptions = useMemo(
    () => (quantities).filter((q) => q.interactive_preview).map((q) => ({
      value: q.id,
      label: q.available ? `${q.label} (${q.unit})` : `${q.label} (${q.unit}) — waiting for data`,
      disabled: !q.available,
    })),
    [quantities],
  );

  useEffect(() => {
    const options = quantityOptions;
    if (!options.length) return;
    if (!options.some((opt) => opt.value === selectedQuantity)) {
      const fallback = options.find((opt) => !opt.disabled) ?? options[0];
      setSelectedQuantity(fallback.value);
    }
  }, [quantityOptions, selectedQuantity]);

  useEffect(() => {
    if (requestedPreviewQuantity) setSelectedQuantity(requestedPreviewQuantity);
  }, [requestedPreviewQuantity]);

  const fieldMap = useMemo<Record<string, Float64Array | null>>(
    () => ({
      ...(state?.latest_fields.fields ?? {}),
      m: liveState?.magnetization ?? state?.latest_fields.fields.m ?? null,
    }),
    [liveState?.magnetization, state?.latest_fields.fields],
  );
  const renderPreviewMatchesActiveQuantity = renderPreview?.quantity === activeQuantityId;

  const selectedVectors = useMemo(() => {
    if (isGlobalScalarQuantity(activeQuantityId)) return null;
    if (renderPreviewMatchesActiveQuantity && renderPreview?.vector_field_values) {
      return renderPreview.vector_field_values;
    }
    return fieldMap[activeQuantityId] ?? null;
  }, [
    activeQuantityId,
    fieldMap,
    isGlobalScalarQuantity,
    renderPreviewMatchesActiveQuantity,
    renderPreview?.vector_field_values,
  ]);

  const quantityDescriptor = useMemo(
    () => (activeQuantityId ? quantityDescriptorById.get(activeQuantityId) ?? null : null),
    [activeQuantityId, quantityDescriptorById],
  );
  const hasVectorData = Boolean(selectedVectors && selectedVectors.length > 0);
  const isVectorQuantity =
    requestedDisplaySelection.kind === "vector_field" ||
    quantityDescriptor?.kind === "vector_field" ||
    (!isGlobalScalarQuantity(activeQuantityId) && hasVectorData);

  const quickPreviewTargets = useMemo(
    () => quantities
      .filter((quantity) => quantity.interactive_preview && quantity.quick_access_label)
      .map((quantity) => ({
        id: quantity.id,
        shortLabel: quantity.quick_access_label ?? quantity.label,
        available: quantity.available,
      })),
    [quantities],
  );

  const selectedScalarValue = useMemo(() => {
    return globalScalarPreview?.value ?? null;
  }, [globalScalarPreview]);
  const selectedQuantityLabel = quantityDescriptor?.label ?? requestedPreviewQuantity;
  const selectedQuantityUnit = quantityDescriptor?.unit ?? null;

  /* FEM mesh data */
  const effectiveFemMesh = useMemo(
    () => (isMeshPreview && renderPreview?.fem_mesh ? renderPreview.fem_mesh : femMesh),
    [femMesh, isMeshPreview, renderPreview?.fem_mesh],
  );
  const meshParts = useMemo<FemMeshPart[]>(
    () => effectiveFemMesh?.mesh_parts ?? [],
    [effectiveFemMesh],
  );
  const magneticParts = useMemo(
    () => meshParts.filter((part) => part.role === "magnetic_object"),
    [meshParts],
  );
  const airPart = useMemo(
    () => meshParts.find((part) => part.role === "air") ?? null,
    [meshParts],
  );
  const interfaceParts = useMemo(
    () => meshParts.filter((part) => part.role === "interface"),
    [meshParts],
  );
  const visibleMeshPartIds = useMemo(
    () =>
      meshParts
        .filter((part) => meshEntityViewState[part.id]?.visible ?? part.role !== "air")
        .map((part) => part.id),
    [meshEntityViewState, meshParts],
  );
  const visibleMagneticObjectIds = useMemo(
    () =>
      Array.from(
        new Set(
          meshParts
            .filter(
              (part) =>
                part.role === "magnetic_object" &&
                (meshEntityViewState[part.id]?.visible ?? true) &&
                typeof part.object_id === "string" &&
                part.object_id.length > 0,
            )
            .map((part) => part.object_id as string),
        ),
      ),
    [meshEntityViewState, meshParts],
  );
  const selectedMeshPart = useMemo(
    () => meshParts.find((part) => part.id === selectedEntityId) ?? null,
    [meshParts, selectedEntityId],
  );
  const focusedMeshPart = useMemo(
    () => meshParts.find((part) => part.id === focusedEntityId) ?? null,
    [focusedEntityId, meshParts],
  );
  const objectOverlays = useMemo<BuilderObjectOverlay[]>(
    () => buildObjectOverlays(scriptBuilderGeometries, effectiveFemMesh),
    [effectiveFemMesh, scriptBuilderGeometries],
  );
  const [flatNodes, flatFaces, flatElements] = useMemo(() => {
    if (!effectiveFemMesh) return [null, null, null];
    return [
      effectiveFemMesh.nodes.flatMap((n) => n),
      effectiveFemMesh.boundary_faces.flatMap((f) => f),
      effectiveFemMesh.elements.flatMap((element) => element),
    ];
  }, [effectiveFemMesh]);

  // Topology base: stable reference that only changes when mesh structure changes.
  // This prevents full geometry rebuild (and camera reset) on every field data update.
  const femMeshBase = useMemo<Omit<FemMeshData, "fieldData" | "activeMask" | "quantityDomain"> | null>(() => {
    if (!effectiveFemMesh || !flatNodes || !flatFaces || !flatElements) return null;
    const nNodes = effectiveFemMesh.nodes.length;
    const nElements = effectiveFemMesh.elements.length;
    return { nodes: flatNodes, elements: flatElements, boundaryFaces: flatFaces, nNodes, nElements };
  }, [effectiveFemMesh, flatNodes, flatFaces, flatElements]);

  // Field data: updated on every solver tick when selectedVectors changes.
  const femFieldData = useMemo<FemMeshData["fieldData"] | undefined>(() => {
    if (!femMeshBase || !selectedVectors || selectedVectors.length < femMeshBase.nNodes * 3) return undefined;
    const nNodes = femMeshBase.nNodes;
    const x = new Array<number>(nNodes), y = new Array<number>(nNodes), z = new Array<number>(nNodes);
    for (let i = 0; i < nNodes; i++) { x[i] = selectedVectors[i * 3] ?? 0; y[i] = selectedVectors[i * 3 + 1] ?? 0; z[i] = selectedVectors[i * 3 + 2] ?? 0; }
    return { x, y, z };
  }, [femMeshBase, selectedVectors]);

  // Combined: new object only when topology OR field data changes
  const femMeshData = useMemo<FemMeshData | null>(() => {
    if (!femMeshBase) return null;
    return {
      ...femMeshBase,
      fieldData: femFieldData,
      activeMask:
        activeMask && activeMask.length === femMeshBase.nNodes
          ? activeMask
          : null,
      quantityDomain: spatialPreview?.quantity_domain ?? "full_domain",
    };
  }, [activeMask, femFieldData, femMeshBase, spatialPreview?.quantity_domain]);
  femMeshDataRef.current = femMeshData;

  const femHasFieldData = Boolean(femMeshData?.fieldData);
  const femMagnetization3DActive = isFemBackend && effectiveViewMode === "3D" && activeQuantityId === "m" && femHasFieldData;
  const femShouldShowArrows = isFemBackend && effectiveViewMode === "3D" && femHasFieldData ? meshShowArrows : false;

  const femTopologyKey = useMemo(() => {
    if (!effectiveFemMesh) return null;
    const firstNode = effectiveFemMesh.nodes[0]?.join(",") ?? "";
    const middleNode = effectiveFemMesh.nodes[Math.floor(effectiveFemMesh.nodes.length / 2)]?.join(",") ?? "";
    const lastNode = effectiveFemMesh.nodes[effectiveFemMesh.nodes.length - 1]?.join(",") ?? "";
    const firstElement = effectiveFemMesh.elements[0]?.join(",") ?? "";
    return [
      effectiveFemMesh.nodes.length,
      femMesh?.elements.length ?? effectiveFemMesh.elements.length,
      effectiveFemMesh.boundary_faces.length,
      firstNode,
      middleNode,
      lastNode,
      firstElement,
    ].join(":");
  }, [effectiveFemMesh, femMesh?.elements.length]);

  useEffect(() => {
    if (!meshParts.length) {
      setMeshEntityViewState({});
      setSelectedEntityId(null);
      setFocusedEntityId(null);
      return;
    }
    setMeshEntityViewState((prev) => {
      const next: MeshEntityViewStateMap = {};
      for (const part of meshParts) {
        next[part.id] = prev[part.id] ?? defaultMeshPartViewState(part);
      }
      return next;
    });
  }, [effectiveFemMesh?.generation_id, meshParts]);

  useEffect(() => {
    if (selectedEntityId && !meshParts.some((part) => part.id === selectedEntityId)) {
      setSelectedEntityId(null);
    }
    if (focusedEntityId && !meshParts.some((part) => part.id === focusedEntityId)) {
      setFocusedEntityId(null);
    }
  }, [focusedEntityId, meshParts, selectedEntityId]);

  useEffect(() => {
    if (!meshParts.length) {
      return;
    }
    let nextEntityId: string | null = null;
    if (
      selectedSidebarNodeId === "universe-airbox" ||
      selectedSidebarNodeId === "universe-airbox-mesh"
    ) {
      nextEntityId = airPart?.id ?? null;
    } else if (selectedObjectId) {
      nextEntityId =
        meshParts.find(
          (part) =>
            part.role === "magnetic_object" && part.object_id === selectedObjectId,
        )?.id ?? null;
    }
    if (nextEntityId !== selectedEntityId) {
      setSelectedEntityId(nextEntityId);
    }
    if (nextEntityId !== focusedEntityId) {
      setFocusedEntityId(nextEntityId);
    }
  }, [
    airPart?.id,
    focusedEntityId,
    meshParts,
    selectedEntityId,
    selectedObjectId,
    selectedSidebarNodeId,
  ]);

  useEffect(() => {
    if (!airPart) {
      return;
    }
    setMeshEntityViewState((prev) => {
      const nextCurrent = prev[airPart.id];
      if (!nextCurrent) {
        return prev;
      }
      if (
        nextCurrent.visible === airMeshVisible &&
        nextCurrent.opacity === airMeshOpacity
      ) {
        return prev;
      }
      return {
        ...prev,
        [airPart.id]: {
          ...nextCurrent,
          visible: airMeshVisible,
          opacity: airMeshOpacity,
        },
      };
    });
  }, [airMeshOpacity, airMeshVisible, airPart]);

  // Keep femTopologyKeyRef in sync so study-domain remesh actions can snapshot the current key
  femTopologyKeyRef.current = femTopologyKey;
  femGenerationIdRef.current =
    effectiveFemMesh?.generation_id ?? meshSummary?.generation_id ?? null;

  // Clear meshGenerating once a new mesh generation arrives. Topology deltas are
  // kept as a fallback for payloads that may not carry generation ids.
  useEffect(() => {
    if (!meshGenerating) return;
    const currentGenerationId =
      effectiveFemMesh?.generation_id ?? meshSummary?.generation_id ?? null;
    const generationChanged =
      currentGenerationId != null &&
      meshGenGenerationRef.current != null &&
      currentGenerationId !== meshGenGenerationRef.current;
    const topologyChanged =
      meshGenTopologyRef.current !== null &&
      femTopologyKey !== null &&
      femTopologyKey !== meshGenTopologyRef.current;
    if (generationChanged || topologyChanged) {
      const nodeCount =
        meshSummary?.node_count
        ?? (effectiveFemMesh ? effectiveFemMesh.nodes.length : 0);
      const elementCount =
        meshSummary?.element_count
        ?? (effectiveFemMesh ? effectiveFemMesh.elements.length : 0);
      appendFrontendTrace(
        "success",
        `RX: REMESH mesh ready — ${nodeCount.toLocaleString()} nodes · ${elementCount.toLocaleString()} tetrahedra`,
      );
      setLastBuiltMeshConfigSignature(
        pendingMeshConfigSignatureRef.current ?? meshConfigSignatureRef.current,
      );
      meshGenTopologyRef.current = null;
      meshGenGenerationRef.current = null;
      pendingMeshConfigSignatureRef.current = null;
      setMeshGenerating(false);
    }
  }, [appendFrontendTrace, effectiveFemMesh, femTopologyKey, meshGenerating, meshSummary]);

  useEffect(() => {
    if (!meshGenerating) return;
    // Backend rejected or completed the remesh with an error → stop spinner
    if (
      commandStatus?.command_kind === "remesh" &&
      (commandStatus.state === "rejected" ||
        (commandStatus.completion_state != null && commandStatus.completion_state !== "ok"))
    ) {
      meshGenTopologyRef.current = null;
      meshGenGenerationRef.current = null;
      pendingMeshConfigSignatureRef.current = null;
      setMeshGenerating(false);
    }
  }, [meshGenerating, commandStatus]);

  const femColorField = useMemo<FemColorField>(() => {
    const qId = activeQuantityId;
    if (qId === "m" && effectiveViewMode === "3D" && femHasFieldData) return "orientation";
    if (effectiveVectorComponent === "x") return "x";
    if (effectiveVectorComponent === "y") return "y";
    if (effectiveVectorComponent === "z") return "z";
    return "magnitude";
  }, [activeQuantityId, effectiveVectorComponent, effectiveViewMode, femHasFieldData]);

  useEffect(() => {
    setMeshSelection({ selectedFaceIndices: [], primaryFaceIndex: null });
  }, [femTopologyKey]);

  const isMeshWorkspaceView = effectiveViewMode === "Mesh";
  const meshWorkspacePreset = useMemo(
    () => deriveMeshWorkspacePreset({ viewMode: effectiveViewMode, femDockTab, meshRenderMode }),
    [effectiveViewMode, femDockTab, meshRenderMode],
  );
  const meshConfigDirty = useMemo(
    () =>
      meshConfigSignature != null &&
      lastBuiltMeshConfigSignature != null &&
      meshConfigSignature !== lastBuiltMeshConfigSignature,
    [lastBuiltMeshConfigSignature, meshConfigSignature],
  );
  const meshFaceDetail = useMemo(
    () => computeMeshFaceDetail(effectiveFemMesh, meshSelection.primaryFaceIndex),
    [effectiveFemMesh, meshSelection.primaryFaceIndex],
  );

  const meshQualitySummary = useMemo<MeshQualitySummary | null>(() => {
    if (!effectiveFemMesh) return null;
    const nodes = effectiveFemMesh.nodes;
    const faces = effectiveFemMesh.boundary_faces;
    if (!nodes.length || !faces.length) return null;
    let min = Infinity, max = -Infinity, sum = 0, good = 0, fair = 0, poor = 0;
    for (const [ia, ib, ic] of faces) {
      const a = nodes[ia], b = nodes[ib], c = nodes[ic];
      if (!a || !b || !c) continue;
      const ab = Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
      const bc = Math.hypot(c[0]-b[0], c[1]-b[1], c[2]-b[2]);
      const ca = Math.hypot(a[0]-c[0], a[1]-c[1], a[2]-c[2]);
      const maxE = Math.max(ab, bc, ca);
      const s2 = (ab+bc+ca)/2;
      const area = Math.sqrt(Math.max(0, s2*(s2-ab)*(s2-bc)*(s2-ca)));
      const inr = s2 > 0 ? area/s2 : 0;
      const ar = inr > 1e-18 ? maxE/(2*inr) : 1;
      min = Math.min(min, ar); max = Math.max(max, ar); sum += ar;
      if (ar < 3) good++; else if (ar < 6) fair++; else poor++;
    }
    return { min, max, mean: faces.length > 0 ? sum/faces.length : 0, good, fair, poor, count: faces.length };
  }, [effectiveFemMesh]);

  /* Slice count */
  const maxSliceCount = useMemo(() => {
    if (spatialPreview?.spatial_kind === "grid") return 1;
    if (isFemBackend && femMeshData) return FEM_SLICE_COUNT;
    if (plane === "xy") return Math.max(1, previewGrid[2]);
    if (plane === "xz") return Math.max(1, previewGrid[1]);
    return Math.max(1, previewGrid[0]);
  }, [femMeshData, isFemBackend, plane, spatialPreview?.spatial_kind, previewGrid]);

  useEffect(() => {
    if (sliceIndex >= maxSliceCount) setSliceIndex(Math.max(0, maxSliceCount - 1));
  }, [maxSliceCount, sliceIndex]);

  /* Field stats */
  const fieldStats = useMemo<FieldStats | null>(() => {
    if (!selectedVectors) return null;
    const n = isFemBackend ? (effectiveFemMesh?.nodes.length ?? 0) : Math.floor(selectedVectors.length / 3);
    if (n <= 0 || selectedVectors.length < n * 3) return null;
    let sumX = 0, sumY = 0, sumZ = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const vx = selectedVectors[i*3], vy = selectedVectors[i*3+1], vz = selectedVectors[i*3+2];
      sumX += vx; sumY += vy; sumZ += vz;
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
      if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
    }
    const inv = 1/n;
    return { meanX: sumX*inv, meanY: sumY*inv, meanZ: sumZ*inv, minX, minY, minZ, maxX, maxY, maxZ };
  }, [selectedVectors, isFemBackend, effectiveFemMesh]);

  /* Material */
  const material = useMemo<MaterialSummary | null>(() => {
    if (!solverPlan) return null;
    return {
      msat: solverPlan.materialMsat,
      aex: solverPlan.materialAex,
      alpha: solverPlan.materialAlpha,
      exchangeEnabled: solverPlan.exchangeEnabled,
      demagEnabled: solverPlan.demagEnabled,
      zeemanField: solverPlan.externalField ? [...solverPlan.externalField] : null,
      name: solverPlan.materialName,
    };
  }, [solverPlan]);

  /* Empty state */
  const emptyStateMessage = useMemo(() => {
    if (isFemBackend && !femMeshData) {
      if (workspaceStatus === "materializing_script")
        return { title: "Materializing FEM mesh", description: latestEngineMessage ?? "Importing geometry and preparing the FEM mesh." };
      if (workspaceStatus === "bootstrapping")
        return { title: "Bootstrapping live workspace", description: latestEngineMessage ?? "Starting the local workspace." };
      return { title: "Waiting for FEM preview data", description: latestEngineMessage ?? "The mesh topology is not available yet." };
    }
    if (workspaceStatus === "materializing_script")
      return { title: "Materializing workspace", description: latestEngineMessage ?? "Preparing problem description and first preview." };
    return { title: "No preview data yet", description: latestEngineMessage ?? "Waiting for the first live field snapshot." };
  }, [femMeshData, isFemBackend, latestEngineMessage, workspaceStatus]);

  const sessionFooter = useMemo<SessionFooterData>(() => ({
    requestedBackend: session?.requested_backend ?? null,
    scriptPath: session?.script_path ?? null,
    artifactDir: session?.artifact_dir ?? null,
  }), [session?.requested_backend, session?.script_path, session?.artifact_dir]);
  const latestBackendError = useMemo<BackendErrorInfo | null>(
    () => latestBackendErrorFromLog(engineLog ?? []),
    [engineLog],
  );
  const mergedEngineLog = useMemo<EngineLogEntry[]>(
    () => [...(engineLog ?? []), ...frontendTraceLog],
    [engineLog, frontendTraceLog],
  );

  /* ═══════════════════════════════════════════════════════════════
   * SPLIT useMemo — each context domain has its own memo so that
   * a telemetry tick does NOT invalidate model/command/viewport.
   * ═══════════════════════════════════════════════════════════════ */

  const transportValue = useMemo<TransportContextValue>(() => ({
    effectiveStep, effectiveTime, effectiveDt, effectiveDmDt, effectiveHEff, effectiveHDemag,
    effectiveEEx, effectiveEDemag, effectiveEExt, effectiveETotal,
    elapsed, stepsPerSec,
    liveState, effectiveLiveState, scalarRows,
    dmDtSpark, dtSpark, eTotalSpark,
    preview, selectedVectors, fieldStats, hasSolverTelemetry,
  }), [
    effectiveStep, effectiveTime, effectiveDt, effectiveDmDt, effectiveHEff, effectiveHDemag,
    effectiveEEx, effectiveEDemag, effectiveEExt, effectiveETotal,
    elapsed, stepsPerSec,
    liveState, effectiveLiveState, scalarRows,
    dmDtSpark, dtSpark, eTotalSpark,
    preview, selectedVectors, fieldStats, hasSolverTelemetry,
  ]);

  const viewportValue = useMemo<ViewportContextValue>(() => ({
    workspaceMode, setWorkspaceMode,
    viewMode, effectiveViewMode, component, plane, sliceIndex, selectedQuantity,
    consoleCollapsed, sidebarCollapsed,
    quantityOptions, previewQuantityOptions, quantityDescriptor, isVectorQuantity,
    quickPreviewTargets, selectedScalarValue, selectedQuantityLabel, selectedQuantityUnit,
    solverGrid, previewGrid, totalCells, activeCells, inactiveCells, activeMaskPresent, activeMask,
    maxSliceCount, effectiveVectorComponent, emptyStateMessage,
    previewBusy, previewMessage, previewControlsActive,
    requestedPreviewQuantity, requestedPreviewComponent, requestedPreviewLayer,
    requestedPreviewAllLayers, requestedPreviewEveryN,
    requestedPreviewXChosenSize, requestedPreviewYChosenSize, requestedPreviewAutoScale,
    requestedPreviewMaxPoints, previewEveryNOptions, previewMaxPointOptions,
    previewIsStale, previewIsBootstrapStale,
    selectedVectors, fieldStats,
    setViewMode, setComponent, setPlane, setSliceIndex, setSelectedQuantity,
    setConsoleCollapsed, setSidebarCollapsed,
    updatePreview, handleViewModeChange, handleCapture, handleExport, requestPreviewQuantity,
  }), [
    workspaceMode,
    viewMode, effectiveViewMode, component, plane, sliceIndex, selectedQuantity,
    consoleCollapsed, sidebarCollapsed,
    quantityOptions, previewQuantityOptions, quantityDescriptor, isVectorQuantity,
    quickPreviewTargets, selectedScalarValue, selectedQuantityLabel, selectedQuantityUnit,
    solverGrid, previewGrid, totalCells, activeCells, inactiveCells, activeMaskPresent, activeMask,
    maxSliceCount, effectiveVectorComponent, emptyStateMessage,
    previewBusy, previewMessage, previewControlsActive,
    requestedPreviewQuantity, requestedPreviewComponent, requestedPreviewLayer,
    requestedPreviewAllLayers, requestedPreviewEveryN,
    requestedPreviewXChosenSize, requestedPreviewYChosenSize, requestedPreviewAutoScale,
    requestedPreviewMaxPoints, previewEveryNOptions, previewMaxPointOptions,
    previewIsStale, previewIsBootstrapStale,
    selectedVectors, fieldStats,
    updatePreview, handleViewModeChange, handleCapture, handleExport, requestPreviewQuantity,
  ]);

  const commandValue = useMemo<CommandContextValue>(() => ({
    connection, error, session, run, metadata, engineLog: mergedEngineLog, quantities, artifacts: artifactsArr,
    workspaceStatus, isWaitingForCompute, solverNotStartedMessage, isFemBackend, runtimeEngineLabel,
    runtimeEngineGpuLabel, runtimeEngineGpuDevice,
    activity, sessionFooter, runtimeStatus, runtimeCanAcceptCommands,
    commandStatus, activeCommandKind, activeCommandState,
    canRunCommand, canRelaxCommand, canPauseCommand, canStopCommand, primaryRunAction, primaryRunLabel,
    interactiveEnabled, interactiveControlsEnabled, awaitingCommand, commandBusy, commandMessage,
    latestBackendError,
    scriptSyncBusy, scriptSyncMessage, stateIoBusy, stateIoMessage, scriptInitialState, scriptBuilderGeometries, scriptBuilderCurrentModules, scriptBuilderExcitationAnalysis, runUntilInput,
    setRunUntilInput, enqueueCommand, handleCompute, handleSimulationAction,
    handleStateExport, handleStateImport, syncScriptBuilder,
  }), [
    connection, error, session, run, metadata, mergedEngineLog, quantities, artifactsArr,
    workspaceStatus, isWaitingForCompute, solverNotStartedMessage, isFemBackend, runtimeEngineLabel,
    runtimeEngineGpuLabel, runtimeEngineGpuDevice,
    activity, sessionFooter, runtimeStatus, runtimeCanAcceptCommands,
    commandStatus, activeCommandKind, activeCommandState,
    canRunCommand, canRelaxCommand, canPauseCommand, canStopCommand, primaryRunAction, primaryRunLabel,
    interactiveEnabled, interactiveControlsEnabled, awaitingCommand, commandBusy, commandMessage,
    latestBackendError,
    scriptSyncBusy, scriptSyncMessage, stateIoBusy, stateIoMessage, scriptInitialState, scriptBuilderGeometries, scriptBuilderCurrentModules, scriptBuilderExcitationAnalysis, runUntilInput,
    enqueueCommand, handleCompute, handleSimulationAction,
    handleStateExport, handleStateImport, syncScriptBuilder,
  ]);

  const modelValue = useMemo<ModelContextValue>(() => ({
    sceneDocument: localBuilderDraft,
    modelBuilderGraph,
    requestedRuntimeSelection: {
      requested_backend:
        localBuilderDraft?.study.requested_backend ??
        modelBuilderGraph?.study.requested_backend ??
        "auto",
      requested_device:
        localBuilderDraft?.study.requested_device ??
        modelBuilderGraph?.study.requested_device ??
        "auto",
      requested_precision:
        localBuilderDraft?.study.requested_precision ??
        modelBuilderGraph?.study.requested_precision ??
        "double",
      requested_mode:
        localBuilderDraft?.study.requested_mode ??
        modelBuilderGraph?.study.requested_mode ??
        "strict",
    },
    material, solverPlan, solverSettings, studyStages, studyPipeline, scriptBuilderDemagRealization, scriptBuilderUniverse, scriptBuilderGeometries, scriptBuilderCurrentModules, scriptBuilderExcitationAnalysis, antennaOverlays, objectOverlays, femMesh,
    meshRenderMode, meshOpacity, meshClipEnabled, meshClipAxis, meshClipPos, meshShowArrows,
    meshSelection, meshOptions, meshQualityData, meshGenerating, femDockTab,
    effectiveFemMesh, femMeshData, femTopologyKey, femColorField,
    femMagnetization3DActive, femShouldShowArrows, isMeshWorkspaceView,
    meshFaceDetail, meshQualitySummary, meshWorkspace,
    meshConfigDirty, meshConfigSignature, lastBuiltMeshConfigSignature,
    meshName: effectiveFemMesh?.mesh_name ?? meshSummary?.mesh_name ?? liveMeshName ?? meshName,
    meshSource: meshSummary?.mesh_source ?? meshSource,
    meshExtent: meshSummary?.mesh_extent ?? meshExtent,
    meshBoundsMin: meshSummary?.bounds_min ?? meshBoundsMin,
    meshBoundsMax: meshSummary?.bounds_max ?? meshBoundsMax,
    meshFeOrder: meshSummary?.order ?? meshFeOrder,
    domainFrame: effectiveFemMesh?.domain_frame ?? meshSummary?.domain_frame ?? domainFrame,
    worldExtent,
    worldCenter,
    worldExtentSource: meshSummary?.world_extent_source ?? worldExtentSource,
    meshHmax: Number.isFinite(meshSummary?.hmax ?? NaN) ? (meshSummary?.hmax ?? null) : meshHmax,
    mesherBackend, mesherSourceKind, mesherCurrentSettings,
    meshWorkspacePreset,
    selectedSidebarNodeId,
    selectedObjectId,
    viewportScope,
    focusObjectRequest,
    objectViewMode,
    activeTransformScope,
    airMeshVisible,
    airMeshOpacity,
    meshEntityViewState,
    selectedEntityId,
    focusedEntityId,
    meshParts,
    visibleMeshPartIds,
    visibleMagneticObjectIds,
    selectedMeshPart,
    focusedMeshPart,
    magneticParts,
    airPart,
    interfaceParts,
    analyzeSelection,
    setSolverSettings, setSceneDocument, setRequestedRuntimeSelection, setStudyStages, setStudyPipeline, setScriptBuilderDemagRealization, setScriptBuilderUniverse, setScriptBuilderGeometries, setScriptBuilderCurrentModules, setScriptBuilderExcitationAnalysis, setMeshRenderMode, setMeshOpacity, setMeshClipEnabled, setMeshClipAxis,
    setMeshClipPos, setMeshShowArrows, setMeshSelection, setMeshOptions, setFemDockTab,
    setSelectedSidebarNodeId, setSelectedObjectId, setViewportScope, setObjectViewMode, setActiveTransformScope, setAirMeshVisible, setAirMeshOpacity, setMeshEntityViewState, setSelectedEntityId, setFocusedEntityId, setAnalyzeSelection, openAnalyze, selectAnalyzeTab, selectAnalyzeMode, refreshAnalyze, requestFocusObject, applyAntennaTranslation, applyGeometryTranslation, handleStudyDomainMeshGenerate, handleAirboxMeshGenerate, handleObjectMeshOverrideRebuild, handleLassoRefine, openFemMeshWorkspace, applyMeshWorkspacePreset,
  }), [
    localBuilderDraft, modelBuilderGraph, material, solverPlan, solverSettings, studyStages, studyPipeline, scriptBuilderDemagRealization, scriptBuilderUniverse, scriptBuilderGeometries, scriptBuilderCurrentModules, scriptBuilderExcitationAnalysis, antennaOverlays, objectOverlays, femMesh,
    meshRenderMode, meshOpacity, meshClipEnabled, meshClipAxis, meshClipPos, meshShowArrows,
    meshSelection, meshOptions, meshQualityData, meshGenerating, femDockTab,
    effectiveFemMesh, femMeshData, femTopologyKey, femColorField,
    femMagnetization3DActive, femShouldShowArrows, isMeshWorkspaceView,
    meshFaceDetail, meshQualitySummary, meshWorkspace,
    meshConfigDirty, meshConfigSignature, lastBuiltMeshConfigSignature,
    meshSummary, meshName, meshSource, meshExtent, meshBoundsMin, meshBoundsMax, meshFeOrder, liveMeshName,
    domainFrame, worldExtent, worldCenter, worldExtentSource, meshHmax, mesherBackend, mesherSourceKind, mesherCurrentSettings,
    meshWorkspacePreset,
    selectedSidebarNodeId, selectedObjectId, viewportScope, focusObjectRequest, objectViewMode, airMeshVisible, airMeshOpacity, meshEntityViewState, selectedEntityId, focusedEntityId, meshParts, visibleMeshPartIds, visibleMagneticObjectIds, selectedMeshPart, focusedMeshPart, magneticParts, airPart, interfaceParts, analyzeSelection, requestFocusObject,
    setSceneDocument, setRequestedRuntimeSelection, setStudyStages, setStudyPipeline, setScriptBuilderDemagRealization, setScriptBuilderUniverse, setScriptBuilderGeometries, setScriptBuilderCurrentModules, setScriptBuilderExcitationAnalysis,
    handleStudyDomainMeshGenerate, handleAirboxMeshGenerate, handleObjectMeshOverrideRebuild, handleLassoRefine, openFemMeshWorkspace, applyMeshWorkspacePreset, openAnalyze, selectAnalyzeTab, selectAnalyzeMode, refreshAnalyze,
    requestFocusObject, applyAntennaTranslation, applyGeometryTranslation, setMeshOptions, setSolverSettings, activeTransformScope,
  ]);

  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full">
        <div className="flex flex-col items-center gap-3 text-muted-foreground animate-pulse">
          <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium tracking-wide">Connecting to live workspace…</span>
        </div>
      </div>
    );
  }

  return (
    <TransportCtx.Provider value={transportValue}>
      <ViewportCtx.Provider value={viewportValue}>
        <CommandCtx.Provider value={commandValue}>
          <ModelCtx.Provider value={modelValue}>
            {children}
          </ModelCtx.Provider>
        </CommandCtx.Provider>
      </ViewportCtx.Provider>
    </TransportCtx.Provider>
  );
}
