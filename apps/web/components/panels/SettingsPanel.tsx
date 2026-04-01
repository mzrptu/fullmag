"use client";

import { useMemo } from "react";
import { useControlRoom } from "../runs/control-room/ControlRoomContext";
import { Button } from "../ui/button";
import MeshSettingsPanel from "./MeshSettingsPanel";
import { IntegratorSettingsPanel, RelaxationSettingsPanel } from "./SolverSettingsPanel";
import { SidebarSection, InfoRow } from "./settings/primitives";
import { humanizeToken, readBuilderContract } from "./settings/helpers";
import GeometryPanel from "./settings/GeometryPanel";
import AntennaPanel from "./settings/AntennaPanel";
import MaterialPanel from "./settings/MaterialPanel";
import MeshPanel from "./settings/MeshPanel";
import ObjectMeshPanel from "./settings/ObjectMeshPanel";
import RegionPanel from "./settings/RegionPanel";
import StudyPanel from "./settings/StudyPanel";
import UniversePanel from "./settings/UniversePanel";
import ResultsPanel from "./settings/ResultsPanel";
import SolverTelemetryPanel from "./settings/SolverTelemetryPanel";
import EnergyPanel from "./settings/EnergyPanel";
import StateIoPanel from "./settings/StateIoPanel";

/* ── Main SettingsPanel ── */
interface SettingsPanelProps {
  nodeId: string;
  nodeLabel: string | null;
}

export default function SettingsPanel({ nodeId, nodeLabel }: SettingsPanelProps) {
  const ctx = useControlRoom();
  const showTelemetrySections = ctx.effectiveViewMode !== "Mesh";
  const builderContract = useMemo(() => readBuilderContract(ctx.metadata), [ctx.metadata]);
  const canSyncScriptBuilder =
    Boolean(builderContract?.rewriteStrategy === "canonical_rewrite" && ctx.sessionFooter.scriptPath);

  const renderNodeContent = () => {
    if (nodeId === "study-root") return <StudyPanel />;
    if (nodeId === "study-integrator") {
      return (
        <IntegratorSettingsPanel
          settings={ctx.solverSettings}
          onChange={ctx.setSolverSettings}
          solverRunning={ctx.workspaceStatus === "running"}
        />
      );
    }
    if (nodeId === "study-relax") {
      return (
        <RelaxationSettingsPanel
          settings={ctx.solverSettings}
          onChange={ctx.setSolverSettings}
          solverRunning={ctx.workspaceStatus === "running"}
        />
      );
    }
    if (nodeId === "study" || nodeId.startsWith("study-")) return <StudyPanel />;
    if (nodeId === "universe" || nodeId.startsWith("universe-")) return <UniversePanel />;
    if (nodeId === "mesh-size" || nodeId === "mesh-algorithm" || nodeId === "mesh-quality") {
      return (
        <MeshSettingsPanel
          options={ctx.meshOptions}
          onChange={ctx.setMeshOptions}
          quality={ctx.meshQualityData}
          generating={ctx.meshGenerating}
          onGenerate={ctx.handleMeshGenerate}
          nodeCount={ctx.effectiveFemMesh?.nodes.length}
          disabled={ctx.meshGenerating || !(ctx.awaitingCommand || ctx.isWaitingForCompute)}
          waitMode={ctx.isWaitingForCompute}
        />
      );
    }
    if (nodeId === "mesh" || nodeId.startsWith("mesh-")) return <MeshPanel />;
    if (nodeId === "antennas" || nodeId.startsWith("ant-")) return <AntennaPanel nodeId={nodeId} />;
    if (nodeId === "results" || nodeId.startsWith("res-") || nodeId === "physics" || nodeId.startsWith("phys-")) {
      if (nodeId === "res-state-io") return <StateIoPanel />;
      return <ResultsPanel />;
    }
    if (nodeId === "initial-state") return <StateIoPanel />;
    if (nodeId === "objects") return <GeometryPanel />;
    if (nodeId.startsWith("geo-") && nodeId.includes("-mesh")) {
      return <ObjectMeshPanel nodeId={nodeId} />;
    }
    if (nodeId.startsWith("reg-")) return <RegionPanel nodeId={nodeId} />;
    if (nodeId.startsWith("obj-")) {
      return <GeometryPanel nodeId={ctx.selectedObjectId ? `geo-${ctx.selectedObjectId}` : undefined} />;
    }
    if (nodeId === "materials" || nodeId.startsWith("mat-")) return <MaterialPanel nodeId={nodeId} />;
    return <GeometryPanel nodeId={nodeId} />;
  };

  return (
    <div className="flex flex-col pb-6">
      <SidebarSection
        title="Selection"
        icon="◈"
        badge={nodeLabel ?? "Workspace"}
        autoOpenKey={nodeId}
      >
        {ctx.selectedObjectId ? (
          <div className="grid gap-2 rounded-lg border border-border/40 bg-card/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[0.62rem] font-bold uppercase tracking-widest text-muted-foreground">
                  Object Actions
                </div>
                <div className="truncate font-mono text-xs text-foreground">
                  {ctx.selectedObjectId}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => {
                  ctx.setViewMode("3D");
                  ctx.requestFocusObject(ctx.selectedObjectId!);
                }}
              >
                Focus In 3D
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant={ctx.objectViewMode === "context" ? "default" : "outline"}
                type="button"
                onClick={() => ctx.setObjectViewMode("context")}
              >
                Context View
              </Button>
              <Button
                size="sm"
                variant={ctx.objectViewMode === "isolate" ? "default" : "outline"}
                type="button"
                onClick={() => ctx.setObjectViewMode("isolate")}
              >
                Isolate View
              </Button>
            </div>
          </div>
        ) : null}
        {renderNodeContent()}
      </SidebarSection>

      {showTelemetrySections && (
        <SidebarSection title="Solver Telemetry" icon="📊" badge={ctx.workspaceStatus}>
          <SolverTelemetryPanel />
        </SidebarSection>
      )}

      {showTelemetrySections && (
        <SidebarSection title="Energy" icon="⚡">
          <EnergyPanel />
        </SidebarSection>
      )}

      <SidebarSection
        title="Session"
        icon="🔗"
        badge={ctx.sessionFooter.requestedBackend ?? null}
        defaultOpen={false}
      >
        <div className="grid gap-1">
          <InfoRow label="Backend" value={ctx.sessionFooter.requestedBackend ?? "—"} />
          <InfoRow label="Runtime" value={ctx.runtimeEngineLabel ?? "—"} />
          {ctx.sessionFooter.scriptPath && (
            <InfoRow label="Script" value={ctx.sessionFooter.scriptPath.split("/").pop() ?? "—"} />
          )}
        </div>
      </SidebarSection>


      {builderContract && (
        <SidebarSection
          title="Script Builder"
          icon="📝"
          badge={builderContract.sourceKind ? humanizeToken(builderContract.sourceKind) : null}
          defaultOpen={false}
        >
          <div className="grid gap-1">
            <InfoRow label="Entrypoint" value={builderContract.entrypointKind ?? "—"} />
            <InfoRow label="API surface" value={builderContract.scriptApiSurface ? humanizeToken(builderContract.scriptApiSurface) : "—"} />
            <InfoRow label="Sync strategy" value={builderContract.rewriteStrategy ?? "—"} />
            <InfoRow label="Phase" value={builderContract.phase ? humanizeToken(builderContract.phase) : "—"} />
            <div className="grid gap-1 pt-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Editable scopes</span>
              <div className="flex flex-wrap gap-1.5">
                {builderContract.editableScopes.length > 0 ? builderContract.editableScopes.map((scope) => (
                  <span
                    key={scope}
                    className="text-[0.6rem] font-bold uppercase tracking-widest border border-border/50 bg-muted/30 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex shadow-sm w-fit"
                  >
                    {humanizeToken(scope)}
                  </span>
                )) : (
                  <span className="font-mono text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
            <div className="grid gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={!canSyncScriptBuilder || ctx.scriptSyncBusy}
                onClick={() => { void ctx.syncScriptBuilder(); }}
              >
                {ctx.scriptSyncBusy ? "Syncing Script…" : "Sync UI To Script"}
              </Button>
              <div className="text-[0.68rem] leading-relaxed text-muted-foreground">
                Rewrites the source `.py` file in canonical Fullmag form using the current builder contract plus solver and mesh settings from this control room.
              </div>
              {ctx.scriptSyncMessage && (
                <div className="text-[0.68rem] leading-relaxed text-muted-foreground p-2 rounded-md bg-muted/30 border border-border/40">
                  {ctx.scriptSyncMessage}
                </div>
              )}
            </div>
          </div>
        </SidebarSection>
      )}
    </div>
  );
}
