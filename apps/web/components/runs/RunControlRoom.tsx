"use client";

import { useMemo } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import EngineConsole from "../panels/EngineConsole";
import TopHeader from "../shell/TopHeader";
import RibbonBar from "../shell/RibbonBar";
import StatusBar from "../shell/StatusBar";
import RunSidebar from "./control-room/RunSidebar";
import { ViewportBar, ViewportCanvasArea } from "./control-room/ViewportPanels";
import FullmagLogo from "../brand/FullmagLogo";
import type { ScriptBuilderCurrentModuleEntry } from "../../lib/session/types";
import { DEFAULT_CONVERGENCE_THRESHOLD } from "../panels/SolverSettingsPanel";
import {
  ControlRoomProvider,
  useControlRoom,
} from "./control-room/ControlRoomContext";
import {
  PANEL_SIZES,
  fmtDuration,
  resolveAntennaNodeName,
  resolveSelectedObjectId,
  fmtSIOrDash,
  fmtStepValue,
} from "./control-room/shared";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";

function nextAntennaName(
  prefix: string,
  modules: readonly ScriptBuilderCurrentModuleEntry[],
): string {
  let index = modules.length + 1;
  while (modules.some((module) => module.name === `${prefix}_${index}`)) {
    index += 1;
  }
  return `${prefix}_${index}`;
}

function makeRibbonAntenna(
  kind: "MicrostripAntenna" | "CPWAntenna",
  modules: readonly ScriptBuilderCurrentModuleEntry[],
): ScriptBuilderCurrentModuleEntry {
  return {
    kind: "antenna_field_source",
    name: nextAntennaName(kind === "CPWAntenna" ? "cpw" : "microstrip", modules),
    solver: "mqs_2p5d_az",
    air_box_factor: 12,
    antenna_kind: kind,
    antenna_params:
      kind === "CPWAntenna"
        ? {
            signal_width: 1e-6,
            gap: 0.25e-6,
            ground_width: 1e-6,
            thickness: 100e-9,
            height_above_magnet: 200e-9,
            preview_length: 5e-6,
            center_x: 0,
            center_y: 0,
            current_distribution: "uniform",
          }
        : {
            width: 1e-6,
            thickness: 100e-9,
            height_above_magnet: 200e-9,
            preview_length: 5e-6,
            center_x: 0,
            center_y: 0,
            current_distribution: "uniform",
          },
    drive: {
      current_a: 0.01,
      frequency_hz: null,
      phase_rad: 0,
      waveform: null,
    },
  };
}

/* ── Inner shell (consumes context) ── */

function ControlRoomShell() {
  const ctx = useControlRoom();
  const spatialPreview = ctx.preview?.kind === "spatial" ? ctx.preview : null;
  const selectedAntennaName = useMemo(
    () =>
      resolveAntennaNodeName(
        ctx.selectedSidebarNodeId,
        ctx.scriptBuilderCurrentModules.map((module) => module.name),
      ),
    [ctx.selectedSidebarNodeId, ctx.scriptBuilderCurrentModules],
  );
  useKeyboardShortcuts();

  const maybePreviewAntennaField = () => {
    if (ctx.quickPreviewTargets.some((target) => target.id === "H_ant" && target.available)) {
      ctx.requestPreviewQuantity("H_ant");
    }
  };

  const handleSelectModelNode = (nodeId: string) => {
    ctx.setSelectedSidebarNodeId(nodeId);
    ctx.setSelectedObjectId(resolveSelectedObjectId(nodeId, ctx.modelBuilderGraph));
    if (ctx.sidebarCollapsed) {
      ctx.setSidebarCollapsed(false);
    }
    if (nodeId === "antennas" || nodeId.startsWith("ant-")) {
      maybePreviewAntennaField();
    }
  };

  const handleAddAntenna = (kind: "MicrostripAntenna" | "CPWAntenna") => {
    const nextModule = makeRibbonAntenna(kind, ctx.scriptBuilderCurrentModules);
    ctx.setScriptBuilderCurrentModules((prev) => [...prev, nextModule]);
    if (ctx.sidebarCollapsed) {
      ctx.setSidebarCollapsed(false);
    }
    ctx.setSelectedSidebarNodeId(`ant-${nextModule.name}`);
    ctx.setSelectedObjectId(null);
    maybePreviewAntennaField();
  };

  /* ── Loading state ── */
  if (!ctx.session) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-sm text-muted-foreground h-full bg-background relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40vw] h-[40vw] max-w-[500px] max-h-[500px] bg-primary/5 blur-[100px] rounded-full pointer-events-none" />
        
        <div className="flex flex-col items-center gap-8 relative z-10 w-full max-w-sm">
          <div className="relative flex items-center justify-center w-28 h-20">
            <div className="absolute inset-0 rounded-2xl border border-primary/20 bg-card/40 backdrop-blur-xl shadow-2xl" />
            <FullmagLogo size={96} animate className="relative z-10 drop-shadow-[0_0_20px_rgba(137,180,250,0.4)]" />
          </div>
          
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full border-[3px] border-primary/20 border-t-primary animate-spin" />
              <span className="font-bold tracking-[0.2em] text-primary/90 uppercase text-xs">
                {ctx.error ? "Connection Error" : "Initializing Workspace"}
              </span>
            </span>
            <span className="text-muted-foreground/70 text-xs font-medium">
              {ctx.error ? ctx.error : "Connecting to local Fullmag session..."}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const previewNotices = (
    <>
      {(spatialPreview?.auto_downscaled || ctx.liveState?.preview_auto_downscaled) && (
        <div
          className="px-2.5 py-1.5 border-b border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs leading-snug"
          title={
            spatialPreview?.auto_downscale_message ??
            ctx.liveState?.preview_auto_downscale_message ??
            undefined
          }
        >
          {spatialPreview?.auto_downscale_message ??
            ctx.liveState?.preview_auto_downscale_message ??
            `Preview auto-fit to ${ctx.previewGrid[0]}×${ctx.previewGrid[1]}×${ctx.previewGrid[2]}`}
        </div>
      )}
      {(ctx.previewMessage || ctx.previewIsStale || ctx.previewIsBootstrapStale) && (
        <div className="px-2.5 py-1.5 border-b border-border/40 bg-card/40 text-muted-foreground text-xs leading-snug">
          {ctx.previewMessage ??
            (ctx.previewIsBootstrapStale
              ? "Showing bootstrap preview until first live preview sample arrives"
              : "Preview update pending")}
        </div>
      )}
    </>
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-background font-sans text-foreground text-base overflow-hidden">
      <TopHeader
        problemName={ctx.session?.problem_name ?? "Local Live Workspace"}
        backend={ctx.session?.requested_backend ?? ""}
        runtimeEngine={ctx.runtimeEngineLabel ?? undefined}
        status={ctx.workspaceStatus}
        connection={ctx.connection}
        interactiveEnabled={ctx.interactiveEnabled}
        canRun={ctx.canRunCommand}
        canRelax={ctx.canRelaxCommand}
        canPause={ctx.canPauseCommand}
        canStop={ctx.canStopCommand}
        runAction={ctx.primaryRunAction}
        runLabel={ctx.primaryRunLabel}
        commandBusy={ctx.commandBusy}
        commandMessage={ctx.commandMessage}
        onSimAction={ctx.handleSimulationAction}
        viewMode={ctx.effectiveViewMode}
        onViewChange={ctx.handleViewModeChange}
        onSidebarToggle={() => ctx.setSidebarCollapsed((v) => !v)}
      />
      <RibbonBar
        viewMode={ctx.effectiveViewMode}
        isFemBackend={ctx.isFemBackend}
        solverRunning={ctx.workspaceStatus === "running"}
        sidebarVisible={!ctx.sidebarCollapsed}
        selectedNodeId={ctx.selectedSidebarNodeId}
        canRun={ctx.canRunCommand}
        canRelax={ctx.canRelaxCommand}
        canPause={ctx.canPauseCommand}
        canStop={ctx.canStopCommand}
        runAction={ctx.primaryRunAction}
        runLabel={ctx.primaryRunLabel}
        onViewChange={ctx.handleViewModeChange}
        onSidebarToggle={() => ctx.setSidebarCollapsed((v) => !v)}
        onSimAction={ctx.handleSimulationAction}
        quickPreviewTargets={ctx.quickPreviewTargets}
        selectedQuantity={ctx.requestedPreviewQuantity}
        previewPending={ctx.previewBusy}
        onQuickPreviewSelect={ctx.requestPreviewQuantity}
        onCapture={ctx.handleCapture}
        onExport={ctx.handleExport}
        onStateExport={() => void ctx.handleStateExport("json")}
        antennaSources={ctx.scriptBuilderCurrentModules.map((module) => ({
          name: module.name,
          kind: module.antenna_kind === "CPWAntenna" ? "CPW" : "Microstrip",
          currentA: module.drive.current_a,
        }))}
        selectedAntennaName={selectedAntennaName}
        onAddAntenna={handleAddAntenna}
        onSelectModelNode={handleSelectModelNode}
        meshGenerating={ctx.meshGenerating}
        onGenerateStudyMesh={ctx.handleStudyDomainMeshGenerate}
        selectedObjectId={ctx.selectedObjectId}
        onRequestObjectFocus={ctx.requestFocusObject}
        hasSharedAirboxDomain={ctx.effectiveFemMesh?.domain_mesh_mode === "shared_domain_mesh_with_air"}
        canSyncScriptBuilder={Boolean(ctx.sessionFooter.scriptPath)}
        scriptSyncBusy={ctx.scriptSyncBusy}
        onSyncScriptBuilder={() => void ctx.syncScriptBuilder()}
      />
      <PanelGroup
        orientation="horizontal"
        className="flex flex-row flex-1 min-h-0 min-w-0 overflow-hidden"
        resizeTargetMinimumSize={{ coarse: 40, fine: 12 }}
      >
        {!ctx.sidebarCollapsed && (
          <>
            <Panel
              id="workspace-sidebar"
              defaultSize={PANEL_SIZES.sidebarDefault}
              minSize={PANEL_SIZES.sidebarMin}
              maxSize={PANEL_SIZES.sidebarMax}
              collapsible
              collapsedSize="0%"
            >
              <RunSidebar />
            </Panel>
            <PanelResizeHandle className="h-full w-2 bg-transparent cursor-ew-resize flex items-center justify-center transition-colors relative hover:bg-muted/50 active:bg-muted/50 after:content-[''] after:absolute after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:w-[2px] after:h-9 after:rounded-full after:bg-border hover:after:bg-primary active:after:bg-primary z-50" />
          </>
        )}

        <Panel
          id="workspace-main"
          defaultSize={ctx.sidebarCollapsed ? "100%" : PANEL_SIZES.bodyMainDefault}
          minSize={PANEL_SIZES.bodyMainMin}
        >
          <PanelGroup
            orientation="vertical"
            className="relative flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden"
            resizeTargetMinimumSize={{ coarse: 40, fine: 10 }}
          >
            <Panel
              id="workspace-viewport"
              defaultSize={PANEL_SIZES.viewportDefault}
              minSize={PANEL_SIZES.viewportMin}
            >
                <div className="flex flex-row h-full min-h-0 min-w-0 overflow-hidden bg-background flex-1 relative ring-1 ring-inset ring-white/5">
                  <div className="flex flex-col flex-1 min-w-0 min-h-0">
                    <ViewportBar />
                    {previewNotices}
                    <ViewportCanvasArea />
                  </div>
                </div>
            </Panel>

            <PanelResizeHandle className="w-full h-1 bg-transparent cursor-ns-resize flex items-center justify-center transition-colors relative hover:bg-muted/50 active:bg-muted/50 after:content-[''] after:absolute after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:h-[2px] after:w-9 after:rounded-full after:bg-border hover:after:bg-primary active:after:bg-primary z-50" />

            <Panel
              id="workspace-console"
              defaultSize={PANEL_SIZES.consoleDefault}
              minSize={PANEL_SIZES.consoleMin}
              maxSize={PANEL_SIZES.consoleMax}
              collapsible
              collapsedSize="3%"
            >
              <div className="flex flex-col h-full bg-card/50 backdrop-blur-xl isolate overflow-hidden relative z-40 border-t border-border/60 shadow-[0_-8px_30px_rgba(0,0,0,0.3)]">
                <EngineConsole
                  session={ctx.session ?? null}
                  run={ctx.run ?? null}
                  liveState={ctx.effectiveLiveState ?? null}
                  scalarRows={ctx.scalarRows}
                  engineLog={ctx.engineLog}
                  artifacts={ctx.artifacts}
                  connection={ctx.connection}
                  error={ctx.error}
                  presentationMode="current"
                  convergenceThreshold={Number(ctx.solverSettings.torqueTolerance) || DEFAULT_CONVERGENCE_THRESHOLD}
                  commandStatus={ctx.commandStatus}
                  commandBusy={ctx.commandBusy}
                  commandMessage={ctx.commandMessage}
                  activity={ctx.activity}
                  meshWorkspace={ctx.meshWorkspace}
                />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>

      <StatusBar
        connection={ctx.connection}
        step={ctx.effectiveLiveState?.step ?? ctx.run?.total_steps ?? 0}
        stepDisplay={fmtStepValue(ctx.effectiveLiveState?.step ?? ctx.run?.total_steps ?? 0, ctx.hasSolverTelemetry)}
        simTime={fmtSIOrDash(ctx.effectiveLiveState?.time ?? ctx.run?.final_time ?? 0, "s", ctx.hasSolverTelemetry)}
        wallTime={ctx.elapsed > 0 ? fmtDuration(ctx.elapsed) : "—"}
        throughput={ctx.stepsPerSec > 0 ? `${ctx.stepsPerSec.toFixed(1)} st/s` : "—"}
        backend={ctx.session?.requested_backend ?? ""}
        runtimeEngine={ctx.runtimeEngineLabel ?? undefined}
        precision={ctx.session?.precision ?? ""}
        status={ctx.workspaceStatus}
        activityLabel={ctx.activity.label}
        activityDetail={ctx.activity.detail}
        progressMode={ctx.activity.progressMode}
        progressValue={ctx.activity.progressValue}
        commandMessage={ctx.commandMessage}
        commandState={ctx.activeCommandState}
        displayLabel={ctx.selectedQuantityLabel}
        displayDetail={
          ctx.selectedScalarValue != null
            ? `${ctx.selectedScalarValue.toExponential(4)} ${ctx.selectedQuantityUnit ?? ""}`.trim()
            : ctx.isVectorQuantity
              ? ctx.requestedPreviewComponent
              : "scalar"
        }
        previewPending={ctx.previewBusy}
        runtimeCanAcceptCommands={ctx.runtimeCanAcceptCommands}
        nodeCount={ctx.isFemBackend && ctx.femMesh
          ? `${ctx.femMesh.nodes.length.toLocaleString()} nodes`
          : ctx.totalCells && ctx.totalCells > 0
            ? `${ctx.totalCells.toLocaleString()} cells`
            : undefined}
      />
    </div>
  );
}

/* ── Public export ── */

export default function RunControlRoom() {
  return (
    <ControlRoomProvider>
      <ControlRoomShell />
    </ControlRoomProvider>
  );
}
