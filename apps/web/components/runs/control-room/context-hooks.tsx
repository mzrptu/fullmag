"use client";

/* ═══════════════════════════════════════════════════════════════════
 * SPLIT CONTEXT ARCHITECTURE
 *
 * The monolithic context is split into 4 focused domains to prevent
 * unnecessary re-renders. Each domain has its own React context and
 * useMemo, so telemetry ticks (~10×/s) don't re-render the sidebar.
 *
 * TransportContext — live telemetry (changes every SSE tick)
 * ViewportContext — viewport UI state (changes on user interaction)
 * CommandContext  — runtime/command state (changes on events)
 * ModelContext    — structural model data (changes rarely)
 *
 * The legacy useControlRoom() is preserved as a facade composing all 4.
 * ═══════════════════════════════════════════════════════════════════ */

import { createContext, useContext, useMemo } from "react";
import type {
  ArtifactEntry,
  CommandStatus,
  EngineLogEntry,
  FemLiveMesh,
  LiveState,
  PreviewState,
  QuantityDescriptor,
  RunManifest,
  RuntimeStatusState,
  ScalarRow,
  MeshWorkspaceState,
  ScriptBuilderStageState,
  ScriptBuilderState,
  SessionManifest,
} from "../../../lib/useSessionStream";
import type {
  ScriptBuilderCurrentModuleEntry,
  ScriptBuilderExcitationAnalysisEntry,
  ScriptBuilderGeometryEntry,
} from "../../../lib/session/types";
import type { SolverSettingsState } from "../../panels/SolverSettingsPanel";
import type { MeshOptionsState, MeshQualityData } from "../../panels/MeshSettingsPanel";
import type {
  ClipAxis,
  FemColorField,
  FemMeshData,
  MeshSelectionSnapshot,
  RenderMode,
} from "../../preview/FemMeshView3D";
import type {
  AntennaOverlay,
  FemDockTab,
  SlicePlane,
  VectorComponent,
  ViewportMode,
} from "./shared";
import { computeMeshFaceDetail } from "./shared";
import type {
  ActivityInfo,
  FieldStats,
  MaterialSummary,
  MeshQualitySummary,
  PreviewOption,
  QuickPreviewTarget,
  SessionFooterData,
  SolverPlanSummary,
} from "./types";
import type { MeshWorkspacePresetId } from "./meshWorkspace";

/* ── Transport: high-frequency telemetry ── */
export interface TransportContextValue {
  effectiveStep: number;
  effectiveTime: number;
  effectiveDt: number;
  effectiveDmDt: number;
  effectiveHEff: number;
  effectiveHDemag: number;
  effectiveEEx: number;
  effectiveEDemag: number;
  effectiveEExt: number;
  effectiveETotal: number;
  elapsed: number;
  stepsPerSec: number;
  liveState: LiveState | null;
  effectiveLiveState: LiveState | null;
  scalarRows: ScalarRow[];
  dmDtSpark: number[];
  dtSpark: number[];
  eTotalSpark: number[];
  preview: PreviewState | null;
  selectedVectors: Float64Array | null;
  fieldStats: FieldStats | null;
  hasSolverTelemetry: boolean;
}

/* ── Viewport: user-driven UI state ── */
export interface ViewportContextValue {
  viewMode: ViewportMode;
  effectiveViewMode: ViewportMode;
  component: VectorComponent;
  plane: SlicePlane;
  sliceIndex: number;
  selectedQuantity: string;
  consoleCollapsed: boolean;
  sidebarCollapsed: boolean;
  quantityOptions: PreviewOption[];
  previewQuantityOptions: PreviewOption[];
  quantityDescriptor: QuantityDescriptor | null;
  isVectorQuantity: boolean;
  quickPreviewTargets: QuickPreviewTarget[];
  selectedScalarValue: number | null;
  selectedQuantityLabel: string;
  selectedQuantityUnit: string | null;
  solverGrid: [number, number, number];
  previewGrid: [number, number, number];
  totalCells: number | null;
  activeCells: number | null;
  inactiveCells: number | null;
  activeMaskPresent: boolean;
  activeMask: boolean[] | null;
  maxSliceCount: number;
  effectiveVectorComponent: VectorComponent;
  emptyStateMessage: { title: string; description: string };
  previewBusy: boolean;
  previewMessage: string | null;
  previewControlsActive: boolean;
  requestedPreviewQuantity: string;
  requestedPreviewComponent: string;
  requestedPreviewLayer: number;
  requestedPreviewAllLayers: boolean;
  requestedPreviewEveryN: number;
  requestedPreviewXChosenSize: number;
  requestedPreviewYChosenSize: number;
  requestedPreviewAutoScale: boolean;
  requestedPreviewMaxPoints: number;
  previewEveryNOptions: number[];
  previewMaxPointOptions: number[];
  previewIsStale: boolean;
  previewIsBootstrapStale: boolean;
  /* Actions */
  setViewMode: React.Dispatch<React.SetStateAction<ViewportMode>>;
  setComponent: React.Dispatch<React.SetStateAction<VectorComponent>>;
  setPlane: React.Dispatch<React.SetStateAction<SlicePlane>>;
  setSliceIndex: React.Dispatch<React.SetStateAction<number>>;
  setSelectedQuantity: React.Dispatch<React.SetStateAction<string>>;
  setConsoleCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  updatePreview: (path: string, payload?: Record<string, unknown>) => Promise<void>;
  handleViewModeChange: (mode: string) => void;
  handleCapture: () => void;
  handleExport: () => void;
  requestPreviewQuantity: (nextQuantity: string) => void;
}

/* ── Command: runtime & command state ── */
export interface CommandContextValue {
  connection: "connecting" | "connected" | "disconnected";
  error: string | null;
  session: SessionManifest | null;
  run: RunManifest | null;
  metadata: Record<string, unknown> | null;
  engineLog: EngineLogEntry[];
  quantities: QuantityDescriptor[];
  artifacts: ArtifactEntry[];
  workspaceStatus: string;
  isWaitingForCompute: boolean;
  solverNotStartedMessage: string;
  isFemBackend: boolean;
  runtimeEngineLabel: string | null;
  activity: ActivityInfo;
  sessionFooter: SessionFooterData;
  runtimeStatus: RuntimeStatusState | null;
  runtimeCanAcceptCommands: boolean;
  commandStatus: CommandStatus | null;
  activeCommandKind: string | null;
  activeCommandState: CommandStatus["state"] | null;
  canRunCommand: boolean;
  canRelaxCommand: boolean;
  canPauseCommand: boolean;
  canStopCommand: boolean;
  primaryRunAction: string;
  primaryRunLabel: string;
  interactiveEnabled: boolean;
  interactiveControlsEnabled: boolean;
  awaitingCommand: boolean;
  commandBusy: boolean;
  commandMessage: string | null;
  scriptSyncBusy: boolean;
  scriptSyncMessage: string | null;
  stateIoBusy: boolean;
  stateIoMessage: string | null;
  scriptInitialState: ScriptBuilderState["initial_state"];
  scriptBuilderGeometries: ScriptBuilderGeometryEntry[];
  scriptBuilderCurrentModules: ScriptBuilderCurrentModuleEntry[];
  scriptBuilderExcitationAnalysis: ScriptBuilderExcitationAnalysisEntry | null;
  runUntilInput: string;
  /* Actions */
  setRunUntilInput: React.Dispatch<React.SetStateAction<string>>;
  enqueueCommand: (payload: Record<string, unknown>) => Promise<void>;
  handleCompute: () => void;
  handleSimulationAction: (action: string) => void;
  handleStateExport: (format: string) => Promise<void>;
  handleStateImport: (
    file: File,
    options?: {
      format?: string;
      applyToWorkspace?: boolean;
      attachToScriptBuilder?: boolean;
    },
  ) => Promise<void>;
  syncScriptBuilder: () => Promise<void>;
}

/* ── Model: structural/static model data ── */
export interface ModelContextValue {
  material: MaterialSummary | null;
  solverPlan: SolverPlanSummary | null;
  solverSettings: SolverSettingsState;
  studyStages: ScriptBuilderStageState[];
  scriptBuilderGeometries: ScriptBuilderGeometryEntry[];
  scriptBuilderCurrentModules: ScriptBuilderCurrentModuleEntry[];
  scriptBuilderExcitationAnalysis: ScriptBuilderExcitationAnalysisEntry | null;
  antennaOverlays: AntennaOverlay[];
  femMesh: FemLiveMesh | null;
  meshRenderMode: RenderMode;
  meshOpacity: number;
  meshClipEnabled: boolean;
  meshClipAxis: ClipAxis;
  meshClipPos: number;
  meshShowArrows: boolean;
  meshSelection: MeshSelectionSnapshot;
  meshOptions: MeshOptionsState;
  meshQualityData: MeshQualityData | null;
  meshGenerating: boolean;
  femDockTab: FemDockTab;
  effectiveFemMesh: FemLiveMesh | null;
  femMeshData: FemMeshData | null;
  femTopologyKey: string | null;
  femColorField: FemColorField;
  femMagnetization3DActive: boolean;
  femShouldShowArrows: boolean;
  isMeshWorkspaceView: boolean;
  meshFaceDetail: ReturnType<typeof computeMeshFaceDetail>;
  meshQualitySummary: MeshQualitySummary | null;
  meshWorkspace: MeshWorkspaceState | null;
  meshName: string | null;
  meshSource: string | null;
  meshExtent: [number, number, number] | null;
  meshBoundsMin: [number, number, number] | null;
  meshBoundsMax: [number, number, number] | null;
  meshFeOrder: number | null;
  worldExtent: [number, number, number] | null;
  meshHmax: number | null;
  mesherBackend: string | null;
  mesherSourceKind: string | null;
  mesherCurrentSettings: Record<string, unknown> | null;
  meshWorkspacePreset: MeshWorkspacePresetId;
  selectedSidebarNodeId: string | null;
  /* Actions */
  setSolverSettings: React.Dispatch<React.SetStateAction<SolverSettingsState>>;
  setStudyStages: React.Dispatch<React.SetStateAction<ScriptBuilderStageState[]>>;
  setScriptBuilderGeometries: React.Dispatch<React.SetStateAction<ScriptBuilderGeometryEntry[]>>;
  setScriptBuilderCurrentModules: React.Dispatch<
    React.SetStateAction<ScriptBuilderCurrentModuleEntry[]>
  >;
  setScriptBuilderExcitationAnalysis: React.Dispatch<
    React.SetStateAction<ScriptBuilderExcitationAnalysisEntry | null>
  >;
  setMeshRenderMode: React.Dispatch<React.SetStateAction<RenderMode>>;
  setMeshOpacity: React.Dispatch<React.SetStateAction<number>>;
  setMeshClipEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setMeshClipAxis: React.Dispatch<React.SetStateAction<ClipAxis>>;
  setMeshClipPos: React.Dispatch<React.SetStateAction<number>>;
  setMeshShowArrows: React.Dispatch<React.SetStateAction<boolean>>;
  setMeshSelection: React.Dispatch<React.SetStateAction<MeshSelectionSnapshot>>;
  setMeshOptions: React.Dispatch<React.SetStateAction<MeshOptionsState>>;
  setFemDockTab: React.Dispatch<React.SetStateAction<FemDockTab>>;
  setSelectedSidebarNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  handleMeshGenerate: () => Promise<void>;
  handleLassoRefine: (faceIndices: number[], factor: number) => Promise<void>;
  openFemMeshWorkspace: (tab?: FemDockTab) => void;
  applyMeshWorkspacePreset: (presetId: MeshWorkspacePresetId) => void;
}

/* ── Legacy combined type (for facade) ── */
export type ControlRoomContextValue = TransportContextValue & ViewportContextValue & CommandContextValue & ModelContextValue;

/* ── React contexts ── */
export const TransportCtx = createContext<TransportContextValue | null>(null);
export const ViewportCtx = createContext<ViewportContextValue | null>(null);
export const CommandCtx = createContext<CommandContextValue | null>(null);
export const ModelCtx = createContext<ModelContextValue | null>(null);

/* ── Granular hooks (new API) ── */
export function useTransport(): TransportContextValue {
  const ctx = useContext(TransportCtx);
  if (!ctx) throw new Error("useTransport must be used within <ControlRoomProvider>");
  return ctx;
}

export function useViewport(): ViewportContextValue {
  const ctx = useContext(ViewportCtx);
  if (!ctx) throw new Error("useViewport must be used within <ControlRoomProvider>");
  return ctx;
}

export function useCommand(): CommandContextValue {
  const ctx = useContext(CommandCtx);
  if (!ctx) throw new Error("useCommand must be used within <ControlRoomProvider>");
  return ctx;
}

export function useModel(): ModelContextValue {
  const ctx = useContext(ModelCtx);
  if (!ctx) throw new Error("useModel must be used within <ControlRoomProvider>");
  return ctx;
}

/* ── Legacy facade hook (backward-compatible) ── */
export function useControlRoom(): ControlRoomContextValue {
  const transport = useTransport();
  const viewport = useViewport();
  const command = useCommand();
  const model = useModel();
  return useMemo(
    () => ({ ...transport, ...viewport, ...command, ...model }),
    [transport, viewport, command, model],
  );
}
