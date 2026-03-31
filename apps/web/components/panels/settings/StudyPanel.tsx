"use client";

import type { ScriptBuilderStageState } from "../../../lib/useSessionStream";
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

const EDITABLE_STAGE_STATES = new Set(["relax", "run"]);

function stageTitle(stage: ScriptBuilderStageState, index: number): string {
  switch (stage.kind) {
    case "relax":
      return `Stage ${index + 1} · Relax`;
    case "run":
      return `Stage ${index + 1} · Run`;
    case "eigenmodes":
      return `Stage ${index + 1} · Eigenmodes`;
    default:
      return `Stage ${index + 1} · ${humanizeToken(stage.kind)}`;
  }
}

function stageSummary(stage: ScriptBuilderStageState): string {
  if (stage.kind === "relax") {
    return [
      stage.relax_algorithm ? humanizeToken(stage.relax_algorithm) : null,
      stage.torque_tolerance ? `tol ${stage.torque_tolerance}` : null,
      stage.max_steps ? `${stage.max_steps} steps` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Relaxation stage";
  }
  if (stage.kind === "run") {
    return stage.until_seconds ? `Run until ${stage.until_seconds} s` : "Time-evolution stage";
  }
  return stage.entrypoint_kind ? humanizeToken(stage.entrypoint_kind) : "Stage details unavailable";
}

function stageBadgeClass(kind: string): string {
  if (kind === "relax") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (kind === "run") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  }
  return "border-border/40 bg-card/20 text-muted-foreground";
}

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
  const stageEditingDisabled = ctx.commandBusy || !(ctx.awaitingCommand || ctx.isWaitingForCompute);
  const firstRunStageIndex = ctx.studyStages.findIndex((stage) => stage.kind === "run");
  const firstRelaxStageIndex = ctx.studyStages.findIndex((stage) => stage.kind === "relax");

  const updateStage = (index: number, patch: Partial<ScriptBuilderStageState>) => {
    ctx.setStudyStages((current) =>
      current.map((stage, stageIndex) => (
        stageIndex === index ? { ...stage, ...patch } : stage
      )),
    );
    if (index === firstRunStageIndex && typeof patch.until_seconds === "string") {
      ctx.setRunUntilInput(patch.until_seconds);
    }
    if (index === firstRelaxStageIndex) {
      ctx.setSolverSettings((current) => ({
        ...current,
        ...(typeof patch.relax_algorithm === "string" ? { relaxAlgorithm: patch.relax_algorithm } : {}),
        ...(typeof patch.torque_tolerance === "string" ? { torqueTolerance: patch.torque_tolerance } : {}),
        ...(typeof patch.energy_tolerance === "string" ? { energyTolerance: patch.energy_tolerance } : {}),
        ...(typeof patch.max_steps === "string" ? { maxRelaxSteps: patch.max_steps } : {}),
      }));
    }
  };

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
        <div className="text-[0.6rem] font-black uppercase tracking-[0.2em] text-muted-foreground mb-4">Stage Sequence</div>
        {ctx.studyStages.length > 0 ? (
          <div className="flex flex-col gap-3">
            {ctx.studyStages.map((stage, index) => (
              <div key={`${stage.kind}-${index}-${stage.entrypoint_kind}`} className="rounded-xl border border-border/50 bg-card/30 p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-muted-foreground">
                      {stageTitle(stage, index)}
                    </div>
                    <div className="text-sm font-semibold text-foreground">{stageSummary(stage)}</div>
                    <div className="text-[0.7rem] text-muted-foreground">
                      Entrypoint: <span className="font-mono text-foreground/90">{stage.entrypoint_kind || "—"}</span>
                    </div>
                  </div>
                  <span className={`inline-flex rounded-md border px-2 py-1 text-[0.55rem] font-bold uppercase tracking-[0.18em] ${stageBadgeClass(stage.kind)}`}>
                    {humanizeToken(stage.kind)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-background/20 p-2.5">
                    <span className="text-[0.55rem] font-medium uppercase tracking-wider text-muted-foreground">Integrator</span>
                    <span className="font-mono text-xs text-foreground">{humanizeToken(stage.integrator)}</span>
                  </div>
                  <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-background/20 p-2.5">
                    <span className="text-[0.55rem] font-medium uppercase tracking-wider text-muted-foreground">Fixed Δt</span>
                    <span className="font-mono text-xs text-foreground">{stage.fixed_timestep || "adaptive / backend default"}</span>
                  </div>
                </div>

                {stage.kind === "run" && (
                  <div className="mt-3">
                    <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
                      Run until [s]
                      <input
                        className="flex h-8 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50"
                        value={stage.until_seconds}
                        onChange={(e) => updateStage(index, { until_seconds: e.target.value })}
                        placeholder="1e-12"
                        disabled={stageEditingDisabled}
                      />
                    </label>
                  </div>
                )}

                {stage.kind === "relax" && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground col-span-2">
                      Relax algorithm
                      <select
                        className="flex h-8 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50"
                        value={stage.relax_algorithm || "llg_overdamped"}
                        onChange={(e) => updateStage(index, { relax_algorithm: e.target.value })}
                        disabled={stageEditingDisabled}
                      >
                        {Object.entries(RELAXATION_PROFILES).map(([value, profile]) => (
                          <option key={value} value={value}>
                            {profile.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
                      Max steps
                      <input
                        className="flex h-8 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50"
                        value={stage.max_steps}
                        onChange={(e) => updateStage(index, { max_steps: e.target.value })}
                        placeholder="5000"
                        disabled={stageEditingDisabled}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
                      Torque tol.
                      <input
                        className="flex h-8 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50"
                        value={stage.torque_tolerance}
                        onChange={(e) => updateStage(index, { torque_tolerance: e.target.value })}
                        placeholder="1e-6"
                        disabled={stageEditingDisabled}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground col-span-2">
                      Energy tol.
                      <input
                        className="flex h-8 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50"
                        value={stage.energy_tolerance}
                        onChange={(e) => updateStage(index, { energy_tolerance: e.target.value })}
                        placeholder="disabled"
                        disabled={stageEditingDisabled}
                      />
                    </label>
                  </div>
                )}

                {!EDITABLE_STAGE_STATES.has(stage.kind) && (
                  <div className="mt-3 rounded-lg border border-border/30 bg-background/20 p-2.5 text-xs text-muted-foreground leading-relaxed">
                    This stage is visible in the builder sequence, but inline editing is not wired yet for this study kind.
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/50 bg-card/20 p-4 text-sm text-muted-foreground leading-relaxed">
            No scripted stage sequence is attached to this workspace yet. Flat scripts that call `fm.relax(...)`, `fm.run(...)`, or a sequence of both will appear here automatically.
          </div>
        )}
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
              disabled={stageEditingDisabled}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
            Relax steps
            <input className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50" value={ctx.solverSettings.maxRelaxSteps}
              onChange={(e) => ctx.setSolverSettings((c) => ({ ...c, maxRelaxSteps: e.target.value }))}
              disabled={stageEditingDisabled} />
          </label>
          <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
            Torque tol.
            <input className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50" value={ctx.solverSettings.torqueTolerance}
              onChange={(e) => ctx.setSolverSettings((c) => ({ ...c, torqueTolerance: e.target.value }))}
              disabled={stageEditingDisabled} />
          </label>
          <label className="flex flex-col gap-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground col-span-2">
            Energy tol.
            <input className="flex h-7 w-full rounded-md border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-foreground font-mono focus:border-primary focus:outline-none transition-colors shadow-sm disabled:opacity-50" value={ctx.solverSettings.energyTolerance}
              onChange={(e) => ctx.setSolverSettings((c) => ({ ...c, energyTolerance: e.target.value }))}
              placeholder="disabled" disabled={stageEditingDisabled} />
          </label>
        </div>
      </div>
    </>
  );
}
