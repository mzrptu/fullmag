"use client";

import { useMemo } from "react";
import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { fmtExpOrDash, fmtSIOrDash, fmtStepValue } from "../../runs/control-room/shared";
import { MetricField, buildSparkSeries, SidebarSection } from "./primitives";
import { DEFAULT_CONVERGENCE_THRESHOLD } from "../SolverSettingsPanel";

export default function SolverTelemetryPanel() {
  const ctx = useControlRoom();
  const sparkSeries = useMemo(() => ({
    step: buildSparkSeries(
      ctx.scalarRows,
      (row) => row.step,
      ctx.hasSolverTelemetry ? ctx.effectiveStep : null,
    ),
    time: buildSparkSeries(
      ctx.scalarRows,
      (row) => row.time,
      ctx.hasSolverTelemetry ? ctx.effectiveTime : null,
    ),
    dt: buildSparkSeries(
      ctx.scalarRows,
      (row) => row.solver_dt,
      ctx.hasSolverTelemetry ? ctx.effectiveDt : null,
    ),
    dmDt: buildSparkSeries(
      ctx.scalarRows,
      (row) => row.max_dm_dt,
      ctx.hasSolverTelemetry ? ctx.effectiveDmDt : null,
      (value) => Math.log10(Math.max(value, 1e-15)),
    ),
    hEff: buildSparkSeries(
      ctx.scalarRows,
      (row) => row.max_h_eff,
      ctx.hasSolverTelemetry ? ctx.effectiveHEff : null,
    ),
    hDemag: buildSparkSeries(
      ctx.scalarRows,
      (row) => row.max_h_demag,
      ctx.hasSolverTelemetry ? ctx.effectiveHDemag : null,
    ),
  }), [
    ctx.scalarRows,
    ctx.hasSolverTelemetry,
    ctx.effectiveStep,
    ctx.effectiveTime,
    ctx.effectiveDt,
    ctx.effectiveDmDt,
    ctx.effectiveHEff,
    ctx.effectiveHDemag,
  ]);

  return (
    <div className="flex flex-col gap-0 border-t border-border/20">
      <SidebarSection title="Live Telemetry" defaultOpen={true}>
        <div className="grid grid-cols-2 gap-3">
          <MetricField
            label="Step"
            tooltip="Current integration step number"
            value={fmtStepValue(ctx.effectiveStep, ctx.hasSolverTelemetry)}
            sparkData={sparkSeries.step}
            sparkColor="var(--ide-text-2)"
          />
          <MetricField
            label="Time"
            tooltip="Simulated physical time"
            value={fmtSIOrDash(ctx.effectiveTime, "s", ctx.hasSolverTelemetry)}
          />
          {ctx.hasSolverTelemetry && ctx.effectiveDt != null && (
            <MetricField
              label="Δt"
              tooltip="Current time-step size"
              value={fmtSIOrDash(ctx.effectiveDt, "s", ctx.hasSolverTelemetry)}
              sparkData={sparkSeries.dt}
              sparkColor="var(--chart-violet)"
            />
          )}
          <MetricField
            label="max dm/dt"
            tooltip="Maximum magnetisation rate of change"
            value={fmtExpOrDash(ctx.effectiveDmDt, ctx.hasSolverTelemetry)}
            sparkData={sparkSeries.dmDt}
            sparkColor="var(--chart-emerald)"
            valueTone={
              ctx.hasSolverTelemetry && ctx.effectiveDmDt > 0 && ctx.effectiveDmDt < (Number(ctx.solverSettings.torqueTolerance) || DEFAULT_CONVERGENCE_THRESHOLD)
                ? "success"
                : undefined
            }
          />
          <MetricField
            label="max |H_eff|"
            tooltip="Maximum effective field magnitude"
            value={fmtExpOrDash(ctx.effectiveHEff, ctx.hasSolverTelemetry)}
            sparkData={sparkSeries.hEff}
            sparkColor="var(--chart-blue)"
          />
          <MetricField
            label="max |H_demag|"
            tooltip="Maximum demagnetising field magnitude"
            value={fmtExpOrDash(ctx.effectiveHDemag, ctx.hasSolverTelemetry)}
            sparkData={sparkSeries.hDemag}
            sparkColor="var(--chart-amber)"
          />
        </div>
        {!ctx.hasSolverTelemetry && (
          <div className="text-xs text-muted-foreground leading-relaxed mt-4 p-3 rounded-md bg-muted/30 border border-border/40">{ctx.solverNotStartedMessage}</div>
        )}
      </SidebarSection>
    </div>
  );
}
