"use client";

import { useMemo } from "react";
import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { fmtExpOrDash, fmtSIOrDash, fmtStepValue } from "../../runs/control-room/shared";
import { MetricField, buildSparkSeries } from "./primitives";

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
    <>
      <div className="grid grid-cols-2 gap-3">
        <MetricField
          label="Step"
          title="Current integration step number"
          value={fmtStepValue(ctx.effectiveStep, ctx.hasSolverTelemetry)}
          sparkData={sparkSeries.step}
          sparkColor="var(--ide-text-2)"
        />
        <MetricField
          label="Time"
          title="Simulated physical time"
          value={fmtSIOrDash(ctx.effectiveTime, "s", ctx.hasSolverTelemetry)}
        />
        <MetricField
          label="Δt"
          title="Current time-step size"
          value={fmtSIOrDash(ctx.effectiveDt, "s", ctx.hasSolverTelemetry)}
          sparkData={sparkSeries.dt}
          sparkColor="#8b5cf6"
        />
        <MetricField
          label="max dm/dt"
          title="Maximum magnetisation rate of change"
          value={fmtExpOrDash(ctx.effectiveDmDt, ctx.hasSolverTelemetry)}
          sparkData={sparkSeries.dmDt}
          sparkColor="#10b981"
          valueTone={
            ctx.hasSolverTelemetry && ctx.effectiveDmDt > 0 && ctx.effectiveDmDt < (Number(ctx.solverSettings.torqueTolerance) || 1e-5)
              ? "success"
              : undefined
          }
        />
        <MetricField
          label="max |H_eff|"
          title="Maximum effective field magnitude"
          value={fmtExpOrDash(ctx.effectiveHEff, ctx.hasSolverTelemetry)}
          sparkData={sparkSeries.hEff}
          sparkColor="#3b82f6"
        />
        <MetricField
          label="max |H_demag|"
          title="Maximum demagnetising field magnitude"
          value={fmtExpOrDash(ctx.effectiveHDemag, ctx.hasSolverTelemetry)}
          sparkData={sparkSeries.hDemag}
          sparkColor="#f59e0b"
        />
      </div>
      {!ctx.hasSolverTelemetry && (
        <div className="text-xs text-muted-foreground leading-relaxed mt-4 p-3 rounded-md bg-muted/30 border border-border/40">{ctx.solverNotStartedMessage}</div>
      )}
    </>
  );
}
