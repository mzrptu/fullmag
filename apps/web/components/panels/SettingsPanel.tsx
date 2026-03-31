"use client";

import { useMemo } from "react";
import { useControlRoom } from "../runs/control-room/ControlRoomContext";
import { Button } from "../ui/button";
import MeshSettingsPanel from "./MeshSettingsPanel";
import { IntegratorSettingsPanel, RelaxationSettingsPanel } from "./SolverSettingsPanel";
import { SidebarSection } from "./settings/primitives";
import { humanizeToken, readBuilderContract } from "./settings/helpers";
import GeometryPanel from "./settings/GeometryPanel";
import MaterialPanel from "./settings/MaterialPanel";
import MeshPanel from "./settings/MeshPanel";
import StudyPanel from "./settings/StudyPanel";
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
    if (nodeId === "mesh-size" || nodeId === "mesh-algorithm" || nodeId === "mesh-quality") {
      return (
        <MeshSettingsPanel
          options={ctx.meshOptions}
          onChange={ctx.setMeshOptions}
          quality={ctx.meshQualityData}
          generating={ctx.meshGenerating}
          onGenerate={ctx.handleMeshGenerate}
          nodeCount={ctx.effectiveFemMesh?.nodes.length}
          disabled={ctx.meshGenerating || !ctx.awaitingCommand}
          waitMode={ctx.isWaitingForCompute}
        />
      );
    }
    if (nodeId === "mesh" || nodeId.startsWith("mesh-")) return <MeshPanel />;
    if (nodeId === "results" || nodeId.startsWith("res-") || nodeId === "physics" || nodeId.startsWith("phys-")) {
      if (nodeId === "res-state-io") return <StateIoPanel />;
      return <ResultsPanel />;
    }
    if (nodeId === "initial-state") return <StateIoPanel />;
    if (nodeId === "materials" || nodeId.startsWith("mat-")) return <MaterialPanel />;
    return <GeometryPanel />;
  };

  return (
    <div className="flex flex-col pb-6">
      <SidebarSection
        title="Selection"
        badge={nodeLabel ?? "Workspace"}
        autoOpenKey={nodeId}
      >
        {renderNodeContent()}
      </SidebarSection>

      {showTelemetrySections && (
        <SidebarSection title="Solver Telemetry" badge={ctx.workspaceStatus}>
          <SolverTelemetryPanel />
        </SidebarSection>
      )}

      {showTelemetrySections && (
        <SidebarSection title="Energy">
          <EnergyPanel />
        </SidebarSection>
      )}

      <SidebarSection
        title="Session"
        badge={ctx.sessionFooter.requestedBackend ?? null}
        defaultOpen={false}
      >
        <div className="grid gap-2">
          <div className="flex items-center justify-between py-1">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Backend</span>
            <span className="font-mono text-xs text-muted-foreground truncate ml-4 text-right">{ctx.sessionFooter.requestedBackend ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Runtime</span>
            <span className="font-mono text-xs text-muted-foreground truncate ml-4 text-right">{ctx.runtimeEngineLabel ?? "—"}</span>
          </div>
          {ctx.sessionFooter.scriptPath && (
            <div className="flex items-center justify-between py-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Script</span>
              <span className="font-mono text-xs text-muted-foreground truncate ml-4 text-right" title={ctx.sessionFooter.scriptPath}>
                {ctx.sessionFooter.scriptPath.split("/").pop()}
              </span>
            </div>
          )}
        </div>
      </SidebarSection>


      {builderContract && (
        <SidebarSection
          title="Script Builder"
          badge={builderContract.sourceKind ? humanizeToken(builderContract.sourceKind) : null}
          defaultOpen={false}
        >
          <div className="grid gap-2">
            <div className="flex items-center justify-between py-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Entrypoint</span>
              <span className="font-mono text-xs text-muted-foreground truncate ml-4 text-right">
                {builderContract.entrypointKind ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Sync strategy</span>
              <span className="font-mono text-xs text-muted-foreground truncate ml-4 text-right">
                {builderContract.rewriteStrategy ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Phase</span>
              <span className="font-mono text-xs text-muted-foreground truncate ml-4 text-right">
                {builderContract.phase ? humanizeToken(builderContract.phase) : "—"}
              </span>
            </div>
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
