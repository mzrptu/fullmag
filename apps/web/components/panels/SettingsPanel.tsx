"use client";

import { useMemo } from "react";
import { useControlRoom } from "../runs/control-room/ControlRoomContext";
import { Button } from "../ui/button";
import MeshSettingsPanel from "./MeshSettingsPanel";
import { SidebarSection, InfoRow } from "./settings/primitives";
import { humanizeToken, readBuilderContract } from "./settings/helpers";
import GeometryPanel from "./settings/GeometryPanel";
import AntennaPanel from "./settings/AntennaPanel";
import MaterialPanel from "./settings/MaterialPanel";
import MeshPanel from "./settings/MeshPanel";
import ObjectMeshPanel from "./settings/ObjectMeshPanel";
import PhysicsPanel from "./settings/PhysicsPanel";
import RegionPanel from "./settings/RegionPanel";
import StudyPanel from "./settings/StudyPanel";
import UniversePanel from "./settings/UniversePanel";
import ResultsPanel from "./settings/ResultsPanel";
import SolverTelemetryPanel from "./settings/SolverTelemetryPanel";
import EnergyPanel from "./settings/EnergyPanel";
import StateIoPanel from "./settings/StateIoPanel";
import { CORE_UI_CAPABILITIES } from "@/lib/workspace/capability-contract";
import { summarizeCapabilityCoverage } from "@/lib/workspace/capability-audit";
import { parseStudyNodeContext } from "@/lib/study-builder/node-context";

/* ── Main SettingsPanel ── */
interface SettingsPanelProps {
  nodeId: string;
}

function SessionInfoPanel() {
  const ctx = useControlRoom();

  return (
    <SidebarSection
      title="Session"
      icon="🔗"
      badge={ctx.sessionFooter.requestedBackend ?? null}
      defaultOpen={true}
    >
      <div className="grid gap-1">
        <InfoRow label="Backend" value={ctx.sessionFooter.requestedBackend ?? "—"} />
        <InfoRow label="Runtime" value={ctx.runtimeEngineLabel ?? "—"} />
        {ctx.sessionFooter.scriptPath && (
          <InfoRow label="Script" value={ctx.sessionFooter.scriptPath.split("/").pop() ?? "—"} />
        )}
      </div>
    </SidebarSection>
  );
}

function ScriptBuilderInfoPanel() {
  const ctx = useControlRoom();
  const builderContract = useMemo(() => readBuilderContract(ctx.metadata), [ctx.metadata]);
  const canSyncScriptBuilder =
    Boolean(builderContract?.rewriteStrategy === "canonical_rewrite" && ctx.sessionFooter.scriptPath);

  if (!builderContract) {
    return (
      <SidebarSection title="Script Builder" icon="📝" defaultOpen={true}>
        <div className="rounded-lg border border-border/30 bg-card/30 p-3 text-[0.72rem] leading-relaxed text-muted-foreground">
          Script builder metadata is not available for this workspace yet.
        </div>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection
      title="Script Builder"
      icon="📝"
      badge={builderContract.sourceKind ? humanizeToken(builderContract.sourceKind) : null}
      defaultOpen={true}
    >
      <div className="grid gap-1">
        <InfoRow label="Entrypoint" value={builderContract.entrypointKind ?? "—"} />
        <InfoRow
          label="API surface"
          value={builderContract.scriptApiSurface ? humanizeToken(builderContract.scriptApiSurface) : "—"}
        />
        <InfoRow label="Sync strategy" value={builderContract.rewriteStrategy ?? "—"} />
        <InfoRow label="Phase" value={builderContract.phase ? humanizeToken(builderContract.phase) : "—"} />
        <div className="grid gap-1 pt-1">
          <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
            Editable scopes
          </span>
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
  );
}

export default function SettingsPanel({ nodeId }: SettingsPanelProps) {
  const ctx = useControlRoom();
  const studyNodeContext = parseStudyNodeContext(nodeId);
  const capabilitySummary = summarizeCapabilityCoverage();
  const showSolverTelemetrySection = false;
  const showEnergySection = false;
  const selectedObjectNodeId = ctx.selectedObjectId ? `geo-${ctx.selectedObjectId}` : undefined;
  const selectedObjectMeshNodeId = ctx.selectedObjectId ? `geo-${ctx.selectedObjectId}-mesh` : undefined;
  const airboxSelected =
    nodeId === "universe-airbox" || nodeId === "universe-airbox-mesh";
  const selectedObjectPartId =
    ctx.selectedObjectId
      ? ctx.meshParts.find(
          (part) =>
            part.role === "magnetic_object" && part.object_id === ctx.selectedObjectId,
        )?.id ?? null
      : null;

  const showFullFemContext = () => {
    ctx.setViewMode("3D");
    ctx.setObjectViewMode("context");
    ctx.setMeshEntityViewState((prev) => {
      const next = { ...prev };
      for (const part of ctx.meshParts) {
        const current = next[part.id];
        if (!current) continue;
        next[part.id] = { ...current, visible: true };
      }
      return next;
    });
  };

  const isolateSelectedObject = () => {
    if (!ctx.selectedObjectId) return;
    ctx.setViewMode("3D");
    ctx.setObjectViewMode("isolate");
    ctx.setMeshEntityViewState((prev) => {
      const next = { ...prev };
      for (const part of ctx.meshParts) {
        const current = next[part.id];
        if (!current) continue;
        next[part.id] = {
          ...current,
          visible:
            part.role === "magnetic_object" && part.object_id === ctx.selectedObjectId,
        };
      }
      return next;
    });
    ctx.setSelectedEntityId(selectedObjectPartId);
    ctx.setFocusedEntityId(selectedObjectPartId);
  };

  const isolateAirbox = () => {
    const airPartId = ctx.airPart?.id ?? null;
    ctx.setViewMode("3D");
    ctx.setObjectViewMode("isolate");
    ctx.setSelectedEntityId(airPartId);
    ctx.setFocusedEntityId(airPartId);
    ctx.setMeshEntityViewState((prev) => {
      const next = { ...prev };
      for (const part of ctx.meshParts) {
        const current = next[part.id];
        if (!current) continue;
        next[part.id] = { ...current, visible: part.role === "air" };
      }
      return next;
    });
  };

  const renderNodeContent = () => {
    if (nodeId === "session") return <SessionInfoPanel />;
    if (nodeId === "script-builder") return <ScriptBuilderInfoPanel />;
    if (studyNodeContext) return <StudyPanel nodeId={nodeId} />;
    if (
      nodeId === "universe-mesh" ||
      nodeId === "universe-mesh-view" ||
      nodeId === "universe-mesh-pipeline" ||
      nodeId === "universe-mesh-algorithm"
    ) {
      return (
        <>
          <MeshPanel />
          <MeshSettingsPanel
            options={ctx.meshOptions}
            onChange={ctx.setMeshOptions}
            quality={ctx.meshQualityData}
            nodeCount={ctx.effectiveFemMesh?.nodes.length}
            disabled={ctx.meshGenerating || !(ctx.awaitingCommand || ctx.isWaitingForCompute)}
            waitMode={ctx.isWaitingForCompute}
          />
        </>
      );
    }
    if (nodeId === "universe-mesh-size" || nodeId === "universe-mesh-quality") {
      return (
        <>
          <SidebarSection title="Object Mesh Defaults" defaultOpen={true}>
            <div className="rounded-lg border border-border/35 bg-background/40 p-3 text-[0.72rem] leading-relaxed text-muted-foreground">
              These settings define shared object defaults for the next study-domain remesh. They do not create a third standalone mesh, and airbox sizing is still configured separately under Universe → Airbox.
            </div>
          </SidebarSection>
          <MeshSettingsPanel
            options={ctx.meshOptions}
            onChange={ctx.setMeshOptions}
            quality={ctx.meshQualityData}
            nodeCount={ctx.effectiveFemMesh?.nodes.length}
            disabled={ctx.meshGenerating || !(ctx.awaitingCommand || ctx.isWaitingForCompute)}
            waitMode={ctx.isWaitingForCompute}
          />
        </>
      );
    }
    if (nodeId === "universe" || nodeId.startsWith("universe-")) return <UniversePanel />;
    if (nodeId === "mesh-size" || nodeId === "mesh-algorithm" || nodeId === "mesh-quality") {
      return (
        <>
          <SidebarSection title="Object Mesh Defaults" defaultOpen={true}>
            <div className="rounded-lg border border-border/35 bg-background/40 p-3 text-[0.72rem] leading-relaxed text-muted-foreground">
              These controls set shared object defaults for the final study-domain remesh. Use Universe → Airbox for air-region sizing and object nodes for local overrides.
            </div>
          </SidebarSection>
          <MeshSettingsPanel
            options={ctx.meshOptions}
            onChange={ctx.setMeshOptions}
            quality={ctx.meshQualityData}
            nodeCount={ctx.effectiveFemMesh?.nodes.length}
            disabled={ctx.meshGenerating || !(ctx.awaitingCommand || ctx.isWaitingForCompute)}
            waitMode={ctx.isWaitingForCompute}
          />
        </>
      );
    }
    if (nodeId === "mesh" || nodeId.startsWith("mesh-")) {
      return (
        <>
          <MeshPanel />
          <MeshSettingsPanel
            options={ctx.meshOptions}
            onChange={ctx.setMeshOptions}
            quality={ctx.meshQualityData}
            nodeCount={ctx.effectiveFemMesh?.nodes.length}
            disabled={ctx.meshGenerating || !(ctx.awaitingCommand || ctx.isWaitingForCompute)}
            waitMode={ctx.isWaitingForCompute}
          />
        </>
      );
    }
    if (nodeId === "antennas" || nodeId.startsWith("ant-")) return <AntennaPanel nodeId={nodeId} />;
    if (nodeId === "physics" || nodeId.startsWith("phys-")) {
      return <PhysicsPanel />;
    }
    if (nodeId === "results" || nodeId === "res-fields") return <ResultsPanel />;
    if (nodeId === "res-energy") return <EnergyPanel />;
    if (nodeId === "res-state-io" || nodeId === "res-export") return <StateIoPanel />;
    if (nodeId === "initial-state") return <StateIoPanel />;
    if (nodeId === "objects") return <GeometryPanel />;
    if (nodeId.startsWith("geo-") && nodeId.includes("-mesh")) {
      return <ObjectMeshPanel nodeId={nodeId} />;
    }
    if (nodeId.startsWith("reg-")) return <RegionPanel nodeId={nodeId} />;
    if (nodeId.startsWith("obj-")) {
      return (
        <>
          <GeometryPanel nodeId={selectedObjectNodeId} />
          <ObjectMeshPanel nodeId={selectedObjectMeshNodeId} />
        </>
      );
    }
    if (nodeId === "materials" || nodeId.startsWith("mat-")) return <MaterialPanel nodeId={nodeId} />;
    return <GeometryPanel nodeId={nodeId} />;
  };

  return (
    <div className="flex flex-col gap-1 pb-6">
      {/* ── Object Actions (only when an object is selected) ── */}
      {ctx.selectedObjectId ? (
        <section className="rounded-xl border border-border/40 bg-gradient-to-b from-card/50 to-card/20 px-4 py-3 shadow-[0_2px_12px_rgba(0,0,0,0.15)] backdrop-blur-xl mb-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground/70">
                Inspecting
              </div>
              <div className="truncate font-mono text-sm font-semibold text-foreground mt-0.5">
                {ctx.selectedObjectId}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => {
                  ctx.setViewMode("3D");
                  ctx.requestFocusObject(ctx.selectedObjectId!);
                }}
              >
                Focus 3D
              </Button>
              {ctx.isFemBackend ? (
                <>
                  <Button
                    size="sm"
                    variant={ctx.objectViewMode === "context" ? "default" : "outline"}
                    type="button"
                    onClick={showFullFemContext}
                  >
                    Context
                  </Button>
                  <Button
                    size="sm"
                    variant={ctx.objectViewMode === "isolate" ? "default" : "outline"}
                    type="button"
                    onClick={isolateSelectedObject}
                  >
                    Isolate
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </section>
      ) : airboxSelected && ctx.isFemBackend ? (
        <section className="rounded-xl border border-border/40 bg-gradient-to-b from-card/50 to-card/20 px-4 py-3 shadow-[0_2px_12px_rgba(0,0,0,0.15)] backdrop-blur-xl mb-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground/70">
                Inspecting
              </div>
              <div className="truncate font-mono text-sm font-semibold text-foreground mt-0.5">
                Airbox
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant={ctx.objectViewMode === "context" ? "default" : "outline"}
                type="button"
                onClick={showFullFemContext}
              >
                Context
              </Button>
              <Button
                size="sm"
                variant={ctx.objectViewMode === "isolate" ? "default" : "outline"}
                type="button"
                onClick={isolateAirbox}
              >
                Isolate
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Node-specific content (each sub-panel manages its own SidebarSections) ── */}
      <SidebarSection title="Capability Coverage" icon="🧭" defaultOpen={false}>
        <div className="grid gap-1">
          <InfoRow label="Total" value={String(capabilitySummary.total)} />
          <InfoRow label="Implemented" value={String(capabilitySummary.implemented)} />
          <InfoRow label="Partial" value={String(capabilitySummary.partial)} />
          <InfoRow label="Missing" value={String(capabilitySummary.missing)} />
          <div className="mt-2 flex flex-col gap-1">
            {CORE_UI_CAPABILITIES.map((item) => (
              <div key={item.id} className="rounded border border-border/30 bg-background/30 px-2 py-1 text-[0.68rem]">
                <span className="font-semibold">{item.id}</span>
                <span className="ml-1 text-muted-foreground">[{item.status}]</span>
              </div>
            ))}
          </div>
        </div>
      </SidebarSection>

      {renderNodeContent()}

      {/* ── Global sections ── */}
      {showSolverTelemetrySection && (
        <SidebarSection title="Solver Telemetry" icon="📊" badge={ctx.workspaceStatus}>
          <SolverTelemetryPanel />
        </SidebarSection>
      )}

      {showEnergySection && (
        <SidebarSection title="Energy" icon="⚡">
          <EnergyPanel />
        </SidebarSection>
      )}
    </div>
  );
}
