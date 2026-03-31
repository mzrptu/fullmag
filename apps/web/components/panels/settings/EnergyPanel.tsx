"use client";

import { useMemo } from "react";
import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { fmtExpOrDash } from "../../runs/control-room/shared";
import { MetricField, buildSparkSeries } from "./primitives";

export default function EnergyPanel() {
  const ctx = useControlRoom();
  const sparkSeries = useMemo(() => ({
    eEx: buildSparkSeries(
      ctx.scalarRows,
      (row) => row.e_ex,
      ctx.hasSolverTelemetry ? ctx.effectiveEEx : null,
    ),
    eDemag: buildSparkSeries(
      ctx.scalarRows,
      (row) => row.e_demag,
      ctx.hasSolverTelemetry ? ctx.effectiveEDemag : null,
    ),
    eExt: buildSparkSeries(
      ctx.scalarRows,
      (row) => row.e_ext,
      ctx.hasSolverTelemetry ? ctx.effectiveEExt : null,
    ),
    eTotal: buildSparkSeries(
      ctx.scalarRows,
      (row) => row.e_total,
      ctx.hasSolverTelemetry ? ctx.effectiveETotal : null,
    ),
  }), [
    ctx.scalarRows,
    ctx.hasSolverTelemetry,
    ctx.effectiveEEx,
    ctx.effectiveEDemag,
    ctx.effectiveEExt,
    ctx.effectiveETotal,
  ]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <MetricField
          label="E_exchange"
          value={fmtExpOrDash(ctx.effectiveEEx, ctx.hasSolverTelemetry)}
          sparkData={sparkSeries.eEx}
          sparkColor="#0ea5e9"
        />
        <MetricField
          label="E_demag"
          value={fmtExpOrDash(ctx.effectiveEDemag, ctx.hasSolverTelemetry)}
          sparkData={sparkSeries.eDemag}
          sparkColor="#f59e0b"
        />
        <MetricField
          label="E_ext"
          value={fmtExpOrDash(ctx.effectiveEExt, ctx.hasSolverTelemetry)}
          sparkData={sparkSeries.eExt}
          sparkColor="#10b981"
        />
        <MetricField
          label="E_total"
          value={fmtExpOrDash(ctx.effectiveETotal, ctx.hasSolverTelemetry)}
          sparkData={sparkSeries.eTotal}
          sparkColor="#8b5cf6"
        />
      </div>
    </>
  );
}
