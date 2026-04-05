"use client";

import type { ScriptBuilderStageState } from "../../../lib/useSessionStream";
import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { fmtExp, fmtSI, fmtSIOrDash } from "@/lib/format";
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
import { SidebarSection, InfoRow, StatusBadge } from "./primitives";
import TextField from "../../ui/TextField";
import SelectField from "../../ui/SelectField";

const EDITABLE_STAGE_STATES = new Set(["relax", "run", "eigenmodes"]);

function eigenBcConfig(stage: ScriptBuilderStageState): Record<string, unknown> {
  const config =
    stage.eigen_spin_wave_bc_config && typeof stage.eigen_spin_wave_bc_config === "object"
      ? { ...stage.eigen_spin_wave_bc_config }
      : {};
  if (typeof config.kind !== "string" || !config.kind) {
    config.kind = stage.eigen_spin_wave_bc || "free";
  }
  return config;
}

function patchEigenBcConfig(
  stage: ScriptBuilderStageState,
  patch: Record<string, unknown>,
): Partial<ScriptBuilderStageState> {
  const next = { ...eigenBcConfig(stage), ...patch };
  return {
    eigen_spin_wave_bc: String(next.kind ?? stage.eigen_spin_wave_bc ?? "free"),
    eigen_spin_wave_bc_config: next,
  };
}

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
  if (stage.kind === "eigenmodes") {
    return [
      stage.eigen_count ? `${stage.eigen_count} modes` : null,
      stage.eigen_target ? humanizeToken(stage.eigen_target) : null,
      stage.eigen_include_demag ? "demag on" : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Eigenmode analysis";
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
  if (kind === "eigenmodes") {
    return "border-violet-500/30 bg-violet-500/10 text-violet-300";
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
      <SidebarSection title="Backend Configuration" icon="⚙" defaultOpen={true}>
        <div className="flex flex-col gap-1">
          <InfoRow label="State" value={ctx.workspaceStatus} />
          <InfoRow label="Study" value={studyKindForPlan(solverPlan)} />
          <InfoRow label="Engine" value={ctx.runtimeEngineLabel ?? ctx.sessionFooter.requestedBackend ?? "—"} />
          <div className="h-px bg-border/40 my-1" />
          <InfoRow label="Backend" value={humanizeToken(solverPlan?.resolvedBackend ?? solverPlan?.backendKind ?? ctx.sessionFooter.requestedBackend)} />
          <InfoRow label="Mode" value={humanizeToken(solverPlan?.executionMode ?? ctx.session?.execution_mode)} />
          <InfoRow label="Precision" value={humanizeToken(solverPlan?.precision ?? ctx.session?.precision)} />
          <div className="h-px bg-border/40 my-1" />
          <InfoRow label="Integrator" value={integratorProfile?.label ?? humanizeToken(solverPlan?.integrator)} />
          <InfoRow label="Δt control" value={timestepModeForPlan(solverPlan)} />
          <InfoRow label="Precession" value={precessionModeForPlan(solverPlan)} />
          <div className="h-px bg-border/40 my-1" />
          <InfoRow label="γ" value={solverPlan?.gyromagneticRatio != null ? `${fmtExp(solverPlan.gyromagneticRatio)} m/(A·s)` : "—"} />
          <InfoRow label="Exchange BC" value={humanizeToken(solverPlan?.exchangeBoundary)} />
          <InfoRow label="Workload" value={workloadLabel} />
          <div className="h-px bg-border/40 my-1" />
          <InfoRow
            label="Discretization"
            value={!solverPlan
              ? "—"
              : solverPlan.backendKind === "fem"
              ? `P${solverPlan.feOrder ?? "?"} · hmax ${solverPlan.hmax != null ? fmtSI(solverPlan.hmax, "m") : "—"}`
              : `${formatGrid(solverPlan?.gridCells ?? null)} cells · ${formatVector(solverPlan?.cellSize ?? null, "m")}`}
          />
          <InfoRow label="External field" value={formatVector(solverPlan?.externalField ?? null, "T")} />

          {(solverPlan?.fixedTimestep != null || solverPlan?.adaptive) && (
            <>
              <div className="h-px bg-border/40 my-1" />
              {solverPlan?.fixedTimestep != null && <InfoRow label="Fixed Δt" value={fmtSI(solverPlan.fixedTimestep, "s")} />}
              {solverPlan?.adaptive && (
                <>
                  <InfoRow label="Adaptive atol" value={solverPlan.adaptive.atol != null ? fmtExp(solverPlan.adaptive.atol) : "—"} />
                  <InfoRow label="Adaptive dt₀" value={solverPlan.adaptive.dtInitial != null ? fmtSI(solverPlan.adaptive.dtInitial, "s") : "—"} />
                  <InfoRow label="Adaptive range" value={`${solverPlan.adaptive.dtMin != null ? fmtSI(solverPlan.adaptive.dtMin, "s") : "—"} → ${solverPlan.adaptive.dtMax != null ? fmtSI(solverPlan.adaptive.dtMax, "s") : "—"}`} />
                </>
              )}
            </>
          )}

          {solverPlan?.relaxation && (
            <>
              <div className="h-px bg-border/40 my-1" />
              <InfoRow label="Relax algorithm" value={relaxationProfile?.label ?? humanizeToken(solverPlan.relaxation.algorithm)} />
              <InfoRow label="Max steps" value={solverPlan.relaxation.maxSteps != null ? solverPlan.relaxation.maxSteps.toLocaleString() : "—"} />
              <InfoRow label="Torque tol." value={solverPlan.relaxation.torqueTolerance != null ? fmtExp(solverPlan.relaxation.torqueTolerance) : "—"} />
              <InfoRow label="Energy tol." value={solverPlan.relaxation.energyTolerance != null ? fmtExp(solverPlan.relaxation.energyTolerance) : "—"} />
            </>
          )}

          <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-border/40">
            {solverPlan?.exchangeEnabled && <StatusBadge label="Exchange" />}
            {solverPlan?.demagEnabled && <StatusBadge label="Demag" />}
            {solverPlan?.externalField?.some((value) => value !== 0) && <StatusBadge label="Zeeman" />}
            {solverPlan?.adaptive && <StatusBadge label="Adaptive Δt" />}
            {solverPlan?.relaxation && <StatusBadge label="Relaxation stage" />}
            {ctx.studyStages.some((s) => s.kind === "eigenmodes") && <StatusBadge label="Eigenmode stage" />}
          </div>

          {solverPlan?.notes.length ? (
            <div className="mt-4 flex flex-col gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md shadow-sm">
              {solverPlan.notes.map((note) => (
                <div key={note} className="text-xs text-amber-600/90 font-medium leading-relaxed">{note}</div>
              ))}
            </div>
          ) : null}
        </div>
      </SidebarSection>

      <SidebarSection title="Stage Sequence" icon="📋" defaultOpen={true}>
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
                    <div className="text-[0.7rem] text-muted-foreground mt-0.5">
                      Entrypoint: <span className="font-mono text-foreground/90">{stage.entrypoint_kind || "—"}</span>
                    </div>
                  </div>
                  <span className={`inline-flex rounded-md border px-2 py-1 text-[0.55rem] font-bold uppercase tracking-[0.18em] ${stageBadgeClass(stage.kind)}`}>
                    {humanizeToken(stage.kind)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-background/20 p-2.5 shadow-inner shadow-black/5">
                    <span className="text-[0.55rem] font-medium uppercase tracking-wider text-muted-foreground">Integrator</span>
                    <span className="font-mono text-xs text-foreground">{humanizeToken(stage.integrator)}</span>
                  </div>
                  <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-background/20 p-2.5 shadow-inner shadow-black/5">
                    <span className="text-[0.55rem] font-medium uppercase tracking-wider text-muted-foreground">Fixed Δt</span>
                    <span className="font-mono text-xs text-foreground">{stage.fixed_timestep || "adaptive / default"}</span>
                  </div>
                </div>

                {stage.kind === "run" && (
                  <div className="mt-3">
                    <TextField
                      label="Run until [s]"
                      value={stage.until_seconds || ""}
                      onchange={(e) => updateStage(index, { until_seconds: e.target.value })}
                      placeholder="1e-12"
                      disabled={stageEditingDisabled}
                      mono
                      tooltip="Target simulation physical time for this execution stage. Reaching this time completes the stage."
                    />
                  </div>
                )}

                {stage.kind === "relax" && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div className="col-span-2">
                      <SelectField
                        label="Relax algorithm"
                        value={stage.relax_algorithm || "llg_overdamped"}
                        onchange={(val) => updateStage(index, { relax_algorithm: val })}
                        disabled={stageEditingDisabled}
                        options={Object.entries(RELAXATION_PROFILES).map(([value, profile]) => ({
                          value,
                          label: profile.label,
                        }))}
                        tooltip="Algorithm used to minimize the system energy. Overdamped LLG or steepest descent are common for finding the ground state."
                      />
                    </div>
                    <div>
                      <TextField
                        label="Max steps"
                        value={stage.max_steps || ""}
                        onchange={(e) => updateStage(index, { max_steps: e.target.value })}
                        placeholder="5000"
                        disabled={stageEditingDisabled}
                        mono
                        tooltip="Maximum allowed iterations for the relaxation stage before timing out or moving on."
                      />
                    </div>
                    <div>
                      <TextField
                        label="Torque tol."
                        value={stage.torque_tolerance || ""}
                        onchange={(e) => updateStage(index, { torque_tolerance: e.target.value })}
                        placeholder="1e-6"
                        disabled={stageEditingDisabled}
                        mono
                        tooltip="Stopping criterion based on the maximum normalized torque (dm/dt) across all cells."
                      />
                    </div>
                    <div className="col-span-2">
                      <TextField
                        label="Energy tol."
                        value={stage.energy_tolerance || ""}
                        onchange={(e) => updateStage(index, { energy_tolerance: e.target.value })}
                        placeholder="disabled"
                        disabled={stageEditingDisabled}
                        mono
                        tooltip="Stopping criterion based on the fractional energy change between steps."
                      />
                    </div>
                  </div>
                )}

                {stage.kind === "eigenmodes" && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <TextField
                        label="Mode count"
                        value={stage.eigen_count || ""}
                        onchange={(e) => updateStage(index, { eigen_count: e.target.value })}
                        placeholder="10"
                        disabled={stageEditingDisabled}
                        mono
                        tooltip="Number of eigenmodes to compute."
                      />
                    </div>
                    <div>
                      <SelectField
                        label="Target"
                        value={stage.eigen_target || "lowest"}
                        onchange={(val) => updateStage(index, { eigen_target: val })}
                        disabled={stageEditingDisabled}
                        options={[
                          { value: "lowest", label: "Lowest freq." },
                          { value: "nearest", label: "Nearest to target" },
                        ]}
                        tooltip="Which part of the spectrum to extract."
                      />
                    </div>
                    <div>
                      <TextField
                        label="Target freq. [Hz]"
                        value={stage.eigen_target_frequency || ""}
                        onchange={(e) => updateStage(index, { eigen_target_frequency: e.target.value })}
                        placeholder="required for nearest"
                        disabled={stageEditingDisabled || (stage.eigen_target || "lowest") !== "nearest"}
                        mono
                        tooltip="Frequency target used when the eigen extraction mode is 'nearest'."
                      />
                    </div>
                    <div className="col-span-2">
                      <SelectField
                        label="Equilibrium source"
                        value={stage.eigen_equilibrium_source || "relax"}
                        onchange={(val) => updateStage(index, { eigen_equilibrium_source: val })}
                        disabled={stageEditingDisabled}
                        options={[
                          { value: "relax", label: "From relaxation stage" },
                          { value: "provided", label: "Supplied initial state" },
                          { value: "artifact", label: "Artifact file" },
                        ]}
                        tooltip="Origin of the equilibrium magnetization used to linearise the LLG."
                      />
                    </div>
                    <div>
                      <SelectField
                        label="Normalization"
                        value={stage.eigen_normalization || "unit_l2"}
                        onchange={(val) => updateStage(index, { eigen_normalization: val })}
                        disabled={stageEditingDisabled}
                        options={[
                          { value: "unit_l2", label: "Unit L2" },
                          { value: "unit_max_amplitude", label: "Unit max amplitude" },
                        ]}
                        tooltip="How the computed eigenvectors are normalised before output."
                      />
                    </div>
                    <div>
                      <SelectField
                        label="Damping"
                        value={stage.eigen_damping_policy || "ignore"}
                        onchange={(val) => updateStage(index, { eigen_damping_policy: val })}
                        disabled={stageEditingDisabled}
                        options={[
                          { value: "ignore", label: "Ignore damping" },
                          { value: "include", label: "Include damping" },
                        ]}
                        tooltip="Whether damping should be incorporated into the linearized eigen operator."
                      />
                    </div>
                    <div>
                      <TextField
                        label="k-vector"
                        value={stage.eigen_k_vector || ""}
                        onchange={(e) => updateStage(index, { eigen_k_vector: e.target.value })}
                        placeholder="kx, ky, kz"
                        disabled={stageEditingDisabled}
                        mono
                        tooltip="Single Bloch wave-vector sample written as comma-separated components."
                      />
                    </div>
                    <div>
                      <SelectField
                        label="Spin-wave BC"
                        value={stage.eigen_spin_wave_bc || "free"}
                        onchange={(val) => updateStage(index, patchEigenBcConfig(stage, { kind: val }))}
                        disabled={stageEditingDisabled}
                        options={[
                          { value: "free", label: "Free" },
                          { value: "pinned", label: "Pinned" },
                          { value: "periodic", label: "Periodic" },
                          { value: "floquet", label: "Floquet" },
                          { value: "surface_anisotropy", label: "Surface anisotropy" },
                        ]}
                        tooltip="Boundary semantics for the linearized spin-wave eigenproblem."
                      />
                    </div>
                    {(stage.eigen_spin_wave_bc === "periodic" || stage.eigen_spin_wave_bc === "floquet") && (
                      <div>
                        <TextField
                          label="Boundary pair id"
                          value={typeof eigenBcConfig(stage).boundary_pair_id === "string" ? String(eigenBcConfig(stage).boundary_pair_id) : ""}
                          onchange={(e) =>
                            updateStage(
                              index,
                              patchEigenBcConfig(stage, {
                                boundary_pair_id: e.target.value.trim() || null,
                              }),
                            )
                          }
                          placeholder="x_faces"
                          disabled={stageEditingDisabled}
                          mono
                          tooltip="Pair id of the periodic/Floquet boundary relation on the mesh."
                        />
                      </div>
                    )}
                    {stage.eigen_spin_wave_bc === "surface_anisotropy" && (
                      <>
                        <div>
                          <TextField
                            label="Surface Ks"
                            value={
                              typeof eigenBcConfig(stage).surface_anisotropy_ks === "number"
                                ? String(eigenBcConfig(stage).surface_anisotropy_ks)
                                : ""
                            }
                            onchange={(e) =>
                              updateStage(
                                index,
                                patchEigenBcConfig(stage, {
                                  surface_anisotropy_ks:
                                    e.target.value.trim().length > 0 ? Number(e.target.value) : null,
                                }),
                              )
                            }
                            placeholder="5e-4"
                            disabled={stageEditingDisabled}
                            mono
                            tooltip="Surface anisotropy constant Ks for the boundary operator."
                          />
                        </div>
                        <div className="col-span-2">
                          <TextField
                            label="Surface axis"
                            value={
                              Array.isArray(eigenBcConfig(stage).surface_anisotropy_axis)
                                ? (eigenBcConfig(stage).surface_anisotropy_axis as number[]).join(", ")
                                : ""
                            }
                            onchange={(e) => {
                              const raw = e.target.value.trim();
                              const parsed = raw
                                ? raw.split(",").map((component) => Number(component.trim()))
                                : [];
                              updateStage(
                                index,
                                patchEigenBcConfig(stage, {
                                  surface_anisotropy_axis:
                                    parsed.length === 3 && parsed.every(Number.isFinite)
                                      ? [parsed[0], parsed[1], parsed[2]]
                                      : null,
                                }),
                              );
                            }}
                            placeholder="0, 0, 1"
                            disabled={stageEditingDisabled}
                            mono
                            tooltip="Surface anisotropy axis as comma-separated xyz components."
                          />
                        </div>
                      </>
                    )}
                    <div className="col-span-2 flex items-center gap-2 rounded-lg border border-border/30 bg-background/20 p-2.5">
                      <input
                        type="checkbox"
                        id={`eigen-demag-${index}`}
                        checked={stage.eigen_include_demag}
                        disabled={stageEditingDisabled}
                        onChange={(e) => updateStage(index, { eigen_include_demag: e.target.checked })}
                        className="h-3.5 w-3.5 rounded accent-violet-500"
                      />
                      <label htmlFor={`eigen-demag-${index}`} className="text-xs font-medium text-foreground select-none cursor-pointer">
                        Include demagnetization in eigen operator
                      </label>
                    </div>
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
      </SidebarSection>

      <SidebarSection title="Runtime Settings" icon="🎛" defaultOpen={true}>
        <div className="flex flex-col gap-3">
          <TextField
            label="Run until [s]"
            value={ctx.runUntilInput || ""}
            onchange={(e) => ctx.setRunUntilInput(e.target.value)}
            disabled={stageEditingDisabled}
            mono
            tooltip="Simulation target time for the next interactive run command."
          />
          <div className="grid grid-cols-2 gap-3 mt-1">
            <TextField
              label="Relax steps"
              value={ctx.solverSettings.maxRelaxSteps || ""}
              onchange={(e) => ctx.setSolverSettings((c) => ({ ...c, maxRelaxSteps: e.target.value }))}
              disabled={stageEditingDisabled}
              mono
              tooltip="Maximum iterations for the next interactive relax command."
            />
            <TextField
              label="Torque tol."
              value={ctx.solverSettings.torqueTolerance || ""}
              onchange={(e) => ctx.setSolverSettings((c) => ({ ...c, torqueTolerance: e.target.value }))}
              disabled={stageEditingDisabled}
              mono
              tooltip="Torque (dm/dt) convergence threshold for the interactive relax."
            />
            <div className="col-span-2">
              <TextField
                label="Energy tol."
                value={ctx.solverSettings.energyTolerance || ""}
                onchange={(e) => ctx.setSolverSettings((c) => ({ ...c, energyTolerance: e.target.value }))}
                placeholder="disabled"
                disabled={stageEditingDisabled}
                mono
                tooltip="Fractional energy change convergence threshold."
              />
            </div>
          </div>
        </div>
      </SidebarSection>

      <SidebarSection title="Performance" icon="📊" defaultOpen={false}>
        <div className="grid gap-3">
          {insightCards.map((card) => (
            <div key={card.title} className="bg-card/50 border border-border/50 shadow-sm rounded-lg p-3.5 flex flex-col gap-1">
              <div className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground/70">{card.title}</div>
              <div className="font-bold text-[0.8rem] text-foreground mt-0.5 tracking-tight">{card.subtitle}</div>
              <div className="text-xs text-muted-foreground leading-relaxed mt-1.5">{card.body}</div>
            </div>
          ))}
        </div>
      </SidebarSection>
    </>
  );
}
