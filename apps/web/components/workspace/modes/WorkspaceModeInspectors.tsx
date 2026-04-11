"use client";

import { useViewport, useCommand, useModel } from "../../runs/control-room/context-hooks";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspaceStore } from "@/lib/workspace/workspace-store";
import { SidebarSection, InfoRow } from "../../panels/settings/primitives";

function displayLaunchName(
  displayName: string | null | undefined,
  path: string | null | undefined,
  fallback: string,
) {
  if (displayName) return displayName;
  if (path) {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? path;
  }
  return fallback;
}

/** Right inspector for Build mode — shows selected object properties */
export function BuildRightInspector() {
  const viewport = useViewport();
  const cmd = useCommand();
  const model = useModel();
  const launchIntent = useWorkspaceStore((state) => state.launchIntent);
  const selectedId = model.selectedObjectId ?? model.selectedSidebarNodeId;

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border/30 bg-card/20">
      <div className="px-3 py-2 border-b border-border/30 shrink-0">
        <span className="text-[0.72rem] font-semibold tracking-wide uppercase text-muted-foreground">Object Inspector</span>
      </div>
      <ScrollArea className="flex-1 px-2 py-2">
        {selectedId ? (
          <>
            <SidebarSection title="Selection" defaultOpen={true}>
              <InfoRow label="ID" value={selectedId} />
            </SidebarSection>
            <SidebarSection title="Workspace" defaultOpen={true}>
              <InfoRow
                label="Simulation"
                value={displayLaunchName(launchIntent?.displayName, launchIntent?.entryPath, cmd.session?.problem_name ?? "Workspace")}
              />
              <InfoRow label="Backend" value={cmd.session?.requested_backend ?? "—"} />
              <InfoRow label="Objects" value={String(model.modelBuilderGraph?.objects.items.length ?? 0)} />
            </SidebarSection>
            <SidebarSection title="Geometry" defaultOpen={true}>
              <InfoRow label="View mode" value={viewport.effectiveViewMode} />
              <InfoRow label="Mesh mode" value={cmd.isFemBackend ? "FEM workspace" : "FDM grid"} />
            </SidebarSection>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-24 gap-1 text-center px-3">
            <span className="text-[0.73rem] text-muted-foreground">No object selected</span>
            <span className="text-[0.67rem] text-muted-foreground/60">Click an object in the model tree or viewport</span>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

/** Right inspector for Study mode — shows solver settings */
export function StudyRightInspector() {
  const cmd = useCommand();
  const model = useModel();
  const stages = model.studyStages ?? [];
  const launchIntent = useWorkspaceStore((state) => state.launchIntent);

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border/30 bg-card/20">
      <div className="px-3 py-2 border-b border-border/30 shrink-0">
        <span className="text-[0.72rem] font-semibold tracking-wide uppercase text-muted-foreground">Study Inspector</span>
      </div>
      <ScrollArea className="flex-1 px-2 py-2">
        <SidebarSection title="Study Stages" defaultOpen={true}>
          {stages.length === 0 ? (
            <div className="text-[0.72rem] text-muted-foreground italic">No stages declared.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {stages.map((stage, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md bg-muted/20 px-2.5 py-1.5">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted/40 text-[0.6rem] font-bold text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="text-[0.75rem] font-medium truncate">{stage.kind}</span>
                  {stage.integrator && (
                    <span className="ml-auto shrink-0 text-[0.65rem] text-muted-foreground">{stage.integrator}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </SidebarSection>
        <SidebarSection title="Solver" defaultOpen={true}>
          <InfoRow label="Torque tol." value={model.solverSettings?.torqueTolerance ?? "—"} />
          <InfoRow label="Run until" value={cmd.runUntilInput || "—"} />
          <InfoRow label="Status" value={cmd.workspaceStatus} />
        </SidebarSection>
        <SidebarSection title="Session" defaultOpen={true}>
          <InfoRow
            label="Simulation"
            value={displayLaunchName(launchIntent?.displayName, launchIntent?.entryPath, cmd.session?.problem_name ?? "Workspace")}
          />
          <InfoRow label="Runtime" value={cmd.runtimeEngineLabel ?? "—"} />
          <InfoRow label="Command" value={cmd.commandMessage ?? "idle"} />
        </SidebarSection>
      </ScrollArea>
    </div>
  );
}

/** Right inspector for Analyze mode — display settings */
export function AnalyzeRightInspector() {
  const viewport = useViewport();
  const cmd = useCommand();
  const launchIntent = useWorkspaceStore((state) => state.launchIntent);

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border/30 bg-card/20">
      <div className="px-3 py-2 border-b border-border/30 shrink-0">
        <span className="text-[0.72rem] font-semibold tracking-wide uppercase text-muted-foreground">Display Settings</span>
      </div>
      <ScrollArea className="flex-1 px-2 py-2">
        <SidebarSection title="Active Quantity" defaultOpen={true}>
          <InfoRow label="Quantity" value={viewport.selectedQuantityLabel ?? "—"} />
        </SidebarSection>
        <SidebarSection title="Viewport" defaultOpen={true}>
          <InfoRow label="View mode" value={viewport.effectiveViewMode} />
        </SidebarSection>
        <SidebarSection title="Preview" defaultOpen={true}>
          <InfoRow label="Grid" value={`${viewport.previewGrid[0]}×${viewport.previewGrid[1]}×${viewport.previewGrid[2]}`} />
          <InfoRow label="Artifacts" value={String(cmd.artifacts.length)} />
        </SidebarSection>
        <SidebarSection title="Dataset" defaultOpen={true}>
          <InfoRow
            label="Simulation"
            value={displayLaunchName(launchIntent?.displayName, launchIntent?.entryPath, cmd.session?.problem_name ?? "Workspace")}
          />
          <InfoRow label="Status" value={cmd.workspaceStatus} />
        </SidebarSection>
      </ScrollArea>
    </div>
  );
}
