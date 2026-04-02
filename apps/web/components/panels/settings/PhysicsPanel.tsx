"use client";

import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { fmtExp, fmtSI } from "../../runs/control-room/shared";
import { SidebarSection, InfoRow, StatusBadge } from "./primitives";

function formatVector(value: number[] | null | undefined, unit: string): string {
  if (!value || value.length < 3) return "—";
  return value
    .slice(0, 3)
    .map((component) => fmtSI(Number(component) || 0, unit))
    .join(" · ");
}

export default function PhysicsPanel() {
  const ctx = useControlRoom();
  const solverPlan = ctx.solverPlan;
  const material = ctx.material;

  return (
    <div className="flex flex-col pt-4 px-2">
      <SidebarSection title="Active Physics Stack" defaultOpen={true}>
        <div className="grid gap-1">
          <InfoRow
            label="Backend"
            value={solverPlan?.resolvedBackend ?? solverPlan?.backendKind ?? ctx.sessionFooter.requestedBackend ?? "—"}
          />
          <InfoRow
            label="Integrator"
            value={solverPlan?.integrator ?? ctx.solverSettings.integrator ?? "—"}
          />
          <InfoRow
            label="Exchange"
            value={material?.exchangeEnabled ? "enabled" : "disabled"}
          />
          <InfoRow
            label="Demag"
            value={material?.demagEnabled ? "enabled" : "disabled"}
          />
          <InfoRow
            label="Demag method"
            value={solverPlan?.demagEnabled ? "transfer-grid" : "disabled"}
          />
          <InfoRow
            label="Exchange BC"
            value={solverPlan?.exchangeBoundary ?? "—"}
          />
          <InfoRow
            label="External field"
            value={formatVector(material?.zeemanField ?? solverPlan?.externalField ?? null, "T")}
          />
          <InfoRow
            label="Gamma"
            value={solverPlan?.gyromagneticRatio != null ? `${fmtExp(solverPlan.gyromagneticRatio)} m/(A·s)` : "—"}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {material?.exchangeEnabled && <StatusBadge label="Exchange" />}
          {material?.demagEnabled && <StatusBadge label="Demag" />}
          {(material?.zeemanField?.some((value) => value !== 0) || solverPlan?.externalField?.some((value) => value !== 0)) && (
            <StatusBadge label="Zeeman" />
          )}
          {solverPlan?.relaxation && <StatusBadge label="Relaxation" />}
        </div>
      </SidebarSection>

      <SidebarSection title="Material Coupling" defaultOpen={true}>
        <div className="grid gap-1">
          <InfoRow label="Ms" value={material?.msat != null ? fmtSI(material.msat, "A/m") : "—"} />
          <InfoRow label="Aex" value={material?.aex != null ? fmtSI(material.aex, "J/m") : "—"} />
          <InfoRow label="Alpha" value={material?.alpha != null ? material.alpha.toPrecision(3) : "—"} />
        </div>
      </SidebarSection>

      {solverPlan?.notes.length ? (
        <SidebarSection title="Planner Notes" defaultOpen={true}>
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100/90">
            {solverPlan.notes.map((note) => (
              <div key={note}>{note}</div>
            ))}
          </div>
        </SidebarSection>
      ) : null}
    </div>
  );
}
