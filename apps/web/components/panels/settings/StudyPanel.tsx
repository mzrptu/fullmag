"use client";

import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { fmtExp, fmtSI, fmtSIOrDash } from "../../runs/control-room/shared";
import {
  BACKEND_PROFILES,
  INTEGRATOR_PROFILES,
  RELAXATION_PROFILES,
  PRECISION_PROFILES,
} from "./profiles";
import {
  humanizeToken,
  formatVector,
  formatGrid,
  studyKindForPlan,
  timestepModeForPlan,
  precessionModeForPlan,
} from "./helpers";

export default function StudyPanel() {
  const ctx = useControlRoom();
  const solverPlan = ctx.solverPlan;
  const backendProfile = solverPlan?.backendKind ? BACKEND_PROFILES[solverPlan.backendKind] : null;
  const integratorProfile = solverPlan?.integrator ? INTEGRATOR_PROFILES[solverPlan.integrator] : null;
  const precisionProfile = solverPlan?.precision ? PRECISION_PROFILES[solverPlan.precision] : null;
  const relaxationProfile = solverPlan?.relaxation?.algorithm
    ? RELAXATION_PROFILES[solverPlan.relaxation.algorithm]
    : null;
  const workloadLabel = ctx.isFemBackend && ctx.femMesh
    ? `${ctx.femMesh.nodes.length.toLocaleString()} nodes · ${ctx.femMesh.elements.length.toLocaleString()} tets`
    : ctx.totalCells && ctx.totalCells > 0
      ? `${ctx.totalCells.toLocaleString()} cells`
      : "—";

  const insightCards = [
    {
      title: "Backend Profile",
      subtitle: backendProfile?.label ?? humanizeToken(solverPlan?.backendKind),
      body: backendProfile
        ? `${backendProfile.performance} ${backendProfile.physics}`
        : "Backend metadata will appear here as soon as the live workspace publishes the execution plan.",
    },
    {
      title: "Integrator Behavior",
      subtitle: integratorProfile?.label ?? humanizeToken(solverPlan?.integrator),
      body: integratorProfile
        ? `${integratorProfile.performance} ${integratorProfile.physics}`
        : "Integrator details are not available yet for this workspace.",
    },
    {
      title: "Precision And Stability",
      subtitle: precisionProfile?.label ?? humanizeToken(solverPlan?.precision ?? ctx.session?.precision),
      body: precisionProfile
        ? `${precisionProfile.performance} ${precisionProfile.physics}`
        : "Precision metadata is not available yet.",
    },
    {
      title: solverPlan?.relaxation ? "Relaxation Physics" : "Live Performance Snapshot",
      subtitle: solverPlan?.relaxation
        ? (relaxationProfile?.label ?? humanizeToken(solverPlan.relaxation.algorithm))
        : ctx.activity.label,
      body: solverPlan?.relaxation
        ? (relaxationProfile
          ? `${relaxationProfile.performance} ${relaxationProfile.physics}`
          : "Relaxation is active, but a richer algorithm profile is not available yet.")
        : `Current throughput: ${ctx.stepsPerSec > 0 ? `${ctx.stepsPerSec.toFixed(1)} st/s` : "—"}. Current dt: ${fmtSIOrDash(ctx.effectiveDt, "s", ctx.hasSolverTelemetry)}. Active workload: ${workloadLabel}.`,
    },
  ];

  return (
    <>
      <div className="flex flex-col py-4 border-b border-border/40 last:border-0">
        <div className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground mb-4">Active Backend Configuration</div>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">State</span>
            <span className="font-mono text-xs text-foreground">{ctx.workspaceStatus}</span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Study</span>
            <span className="font-mono text-xs text-foreground">{studyKindForPlan(solverPlan)}</span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Engine</span>
            <span className="font-mono text-xs text-foreground">{ctx.runtimeEngineLabel ?? ctx.sessionFooter.requestedBackend ?? "—"}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Backend</span>
            <span className="font-mono text-xs text-foreground">{humanizeToken(solverPlan?.resolvedBackend ?? solverPlan?.backendKind ?? ctx.sessionFooter.requestedBackend)}</span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Mode</span>
            <span className="font-mono text-xs text-foreground">{humanizeToken(solverPlan?.executionMode ?? ctx.session?.execution_mode)}</span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Precision</span>
            <span className="font-mono text-xs text-foreground">{humanizeToken(solverPlan?.precision ?? ctx.session?.precision)}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Integrator</span>
            <span className="font-mono text-xs text-foreground">{integratorProfile?.label ?? humanizeToken(solverPlan?.integrator)}</span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Δt control</span>
            <span className="font-mono text-xs text-foreground">{timestepModeForPlan(solverPlan)}</span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Precession</span>
            <span className="font-mono text-xs text-foreground">{precessionModeForPlan(solverPlan)}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">γ</span>
            <span className="font-mono text-xs text-foreground">{solverPlan?.gyromagneticRatio != null ? `${fmtExp(solverPlan.gyromagneticRatio)} m/(A·s)` : "—"}</span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Exchange BC</span>
            <span className="font-mono text-xs text-foreground">{humanizeToken(solverPlan?.exchangeBoundary)}</span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Workload</span>
            <span className="font-mono text-xs text-foreground">{workloadLabel}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Discretization</span>
            <span className="font-mono text-xs text-foreground">
              {!solverPlan
                ? "—"
                : solverPlan.backendKind === "fem"
                ? `P${solverPlan.feOrder ?? "?"} · hmax ${solverPlan.hmax != null ? fmtSI(solverPlan.hmax, "m") : "—"}`
                : `${formatGrid(solverPlan?.gridCells ?? null)} cells · ${formatVector(solverPlan?.cellSize ?? null, "m")}`}
            </span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">External field</span>
            <span className="font-mono text-xs text-foreground">{formatVector(solverPlan?.externalField ?? null, "T")}</span>
          </div>
        </div>

        {(solverPlan?.fixedTimestep != null || solverPlan?.adaptive) && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Fixed Δt</span>
              <span className="font-mono text-xs text-foreground">{solverPlan?.fixedTimestep != null ? fmtSI(solverPlan.fixedTimestep, "s") : "—"}</span>
            </div>
            <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Adaptive atol</span>
              <span className="font-mono text-xs text-foreground">{solverPlan?.adaptive?.atol != null ? fmtExp(solverPlan.adaptive.atol) : "—"}</span>
            </div>
            <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Adaptive dt₀</span>
              <span className="font-mono text-xs text-foreground">{solverPlan?.adaptive?.dtInitial != null ? fmtSI(solverPlan.adaptive.dtInitial, "s") : "—"}</span>
            </div>
            <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Adaptive range</span>
              <span className="font-mono text-xs text-foreground">
                {solverPlan?.adaptive
                  ? `${solverPlan.adaptive.dtMin != null ? fmtSI(solverPlan.adaptive.dtMin, "s") : "—"} → ${solverPlan.adaptive.dtMax != null ? fmtSI(solverPlan.adaptive.dtMax, "s") : "—"}`
                  : "—"}
              </span>
            </div>
          </div>
        )}

        {solverPlan?.relaxation && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Relax algorithm</span>
              <span className="font-mono text-xs text-foreground">{relaxationProfile?.label ?? humanizeToken(solverPlan.relaxation.algorithm)}</span>
            </div>
            <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Max steps</span>
              <span className="font-mono text-xs text-foreground">{solverPlan.relaxation.maxSteps != null ? solverPlan.relaxation.maxSteps.toLocaleString() : "—"}</span>
            </div>
            <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Torque tol.</span>
              <span className="font-mono text-xs text-foreground">{solverPlan.relaxation.torqueTolerance != null ? fmtExp(solverPlan.relaxation.torqueTolerance) : "—"}</span>
            </div>
            <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Energy tol.</span>
              <span className="font-mono text-xs text-foreground">{solverPlan.relaxation.energyTolerance != null ? fmtExp(solverPlan.relaxation.energyTolerance) : "—"}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mt-5">
          {solverPlan?.exchangeEnabled && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Exchange</span>}
          {solverPlan?.demagEnabled && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Demag</span>}
          {solverPlan?.externalField?.some((value) => value !== 0) && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Zeeman</span>}
          {solverPlan?.adaptive && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Adaptive Δt</span>}
          {solverPlan?.relaxation && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Relaxation stage</span>}
        </div>

        {solverPlan?.notes.length ? (
          <div className="mt-5 flex flex-col gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md shadow-sm">
            {solverPlan.notes.map((note) => (
              <div key={note} className="text-xs text-amber-600/90 font-medium leading-relaxed">{note}</div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col py-4 border-b border-border/40 last:border-0">
        <div className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground mb-4">Performance And Physics</div>
        <div className="grid gap-3">
          {insightCards.map((card) => (
            <div key={card.title} className="bg-card/50 border border-border/50 shadow-sm rounded-lg p-3.5 flex flex-col gap-1 inline-flex">
              <div className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground/70">{card.title}</div>
              <div className="font-bold text-[0.8rem] text-foreground mt-0.5 tracking-tight">{card.subtitle}</div>
              <div className="text-xs text-muted-foreground leading-relaxed mt-1.5">{card.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col py-4 border-b border-border/40 last:border-0">
        <div className="text-[0.6rem] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4">Next Interactive Command</div>
        <div className="flex flex-col gap-3 p-3 bg-muted/30 border border-border/50 rounded-lg shadow-inner">
          <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
            Run until [s]
            <input
              className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50"
              value={ctx.runUntilInput}
              onChange={(e) => ctx.setRunUntilInput(e.target.value)}
              disabled={ctx.commandBusy || !ctx.awaitingCommand}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
            Relax steps
            <input className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50" value={ctx.solverSettings.maxRelaxSteps}
              onChange={(e) => ctx.setSolverSettings((c) => ({ ...c, maxRelaxSteps: e.target.value }))}
              disabled={ctx.commandBusy || !ctx.awaitingCommand} />
          </label>
          <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
            Torque tol.
            <input className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50" value={ctx.solverSettings.torqueTolerance}
              onChange={(e) => ctx.setSolverSettings((c) => ({ ...c, torqueTolerance: e.target.value }))}
              disabled={ctx.commandBusy || !ctx.awaitingCommand} />
          </label>
          <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground col-span-2">
            Energy tol.
            <input className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50" value={ctx.solverSettings.energyTolerance}
              onChange={(e) => ctx.setSolverSettings((c) => ({ ...c, energyTolerance: e.target.value }))}
              placeholder="disabled" disabled={ctx.commandBusy || !ctx.awaitingCommand} />
          </label>
        </div>
      </div>
    </>
  );
}
