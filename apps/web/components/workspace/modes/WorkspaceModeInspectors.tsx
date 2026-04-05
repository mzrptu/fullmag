"use client";

import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ReactNode } from "react";

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="px-3 pt-3 pb-1.5">
        <span className="text-[0.64rem] font-semibold tracking-widest uppercase text-muted-foreground">{title}</span>
      </div>
      <div className="px-3 pb-3">{children}</div>
    </div>
  );
}

function PropRow({ label, value }: { label: string; value: string | ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-[0.73rem] text-muted-foreground shrink-0">{label}</span>
      <span className="text-[0.73rem] font-medium text-foreground text-right truncate">{value}</span>
    </div>
  );
}

/** Right inspector for Build mode — shows selected object properties */
export function BuildRightInspector() {
  const ctx = useControlRoom();
  const selectedId = ctx.selectedObjectId ?? ctx.selectedSidebarNodeId;

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border/30 bg-card/20">
      <div className="px-3 py-2 border-b border-border/30 shrink-0">
        <span className="text-[0.72rem] font-semibold tracking-wide uppercase text-muted-foreground">Object Inspector</span>
      </div>
      <ScrollArea className="flex-1">
        {selectedId ? (
          <div className="divide-y divide-border/20">
            <InspectorSection title="Selection">
              <PropRow label="ID" value={selectedId} />
            </InspectorSection>
            <InspectorSection title="Geometry">
              <div className="text-[0.72rem] text-muted-foreground italic">
                Select a geometry object to inspect its properties.
              </div>
            </InspectorSection>
          </div>
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
  const ctx = useControlRoom();
  const stages = ctx.studyStages ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border/30 bg-card/20">
      <div className="px-3 py-2 border-b border-border/30 shrink-0">
        <span className="text-[0.72rem] font-semibold tracking-wide uppercase text-muted-foreground">Study Inspector</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border/20">
          <InspectorSection title="Study stages">
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
          </InspectorSection>
          <InspectorSection title="Solver">
            <PropRow label="Torque tol." value={ctx.solverSettings?.torqueTolerance ?? "—"} />
          </InspectorSection>
        </div>
      </ScrollArea>
    </div>
  );
}

/** Right inspector for Analyze mode — display settings */
export function AnalyzeRightInspector() {
  const ctx = useControlRoom();

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border/30 bg-card/20">
      <div className="px-3 py-2 border-b border-border/30 shrink-0">
        <span className="text-[0.72rem] font-semibold tracking-wide uppercase text-muted-foreground">Display Settings</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border/20">
          <InspectorSection title="Active quantity">
            <PropRow label="Quantity" value={ctx.selectedQuantityLabel ?? "—"} />
          </InspectorSection>
          <InspectorSection title="Viewport">
            <PropRow label="View mode" value={ctx.effectiveViewMode} />
          </InspectorSection>
          <InspectorSection title="Preview">
            <PropRow label="Grid" value={`${ctx.previewGrid[0]}×${ctx.previewGrid[1]}×${ctx.previewGrid[2]}`} />
          </InspectorSection>
        </div>
      </ScrollArea>
    </div>
  );
}

/** Right inspector for Runs mode — active run details */
export function RunsRightInspector() {
  const ctx = useControlRoom();
  const run = ctx.run;

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border/30 bg-card/20">
      <div className="px-3 py-2 border-b border-border/30 shrink-0">
        <span className="text-[0.72rem] font-semibold tracking-wide uppercase text-muted-foreground">Run Details</span>
      </div>
      <ScrollArea className="flex-1">
        {run ? (
          <div className="divide-y divide-border/20">
            <InspectorSection title="Active run">
              <PropRow label="Status" value={ctx.workspaceStatus} />
              <PropRow label="Backend" value={ctx.session?.requested_backend ?? "—"} />
              <PropRow label="Precision" value={ctx.session?.precision ?? "—"} />
            </InspectorSection>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-24 gap-1 text-center px-3">
            <span className="text-[0.73rem] text-muted-foreground">No active run</span>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
