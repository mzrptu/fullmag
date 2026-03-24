"use client";

import Panel from "../ui/Panel";
import MetricTile from "../ui/MetricTile";

interface MetricsPanelProps {
  pid?: number;
  cpuPercent?: number;
  ramPercent?: number;
  totalSteps: number;
  elapsedMs: number;
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

export default function MetricsPanel({
  pid,
  cpuPercent,
  ramPercent,
  totalSteps,
  elapsedMs,
}: MetricsPanelProps) {
  const stepsPerSec = elapsedMs > 0 ? ((totalSteps / elapsedMs) * 1000).toFixed(1) : "—";

  return (
    <Panel
      title="Metrics"
      subtitle="Process telemetry."
      panelId="metrics"
      eyebrow="Diagnostics"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))",
          gap: "0.8rem",
        }}
      >
        {pid !== undefined && (
          <MetricTile label="PID" value={`${pid}`} />
        )}
        {cpuPercent !== undefined && (
          <MetricTile label="CPU proc." value={pct(cpuPercent)} progress={cpuPercent} tone="info" />
        )}
        {ramPercent !== undefined && (
          <MetricTile label="RAM proc." value={pct(ramPercent)} progress={ramPercent} tone="accent" />
        )}
        <MetricTile label="Total steps" value={`${totalSteps}`} />
        <MetricTile
          label="Elapsed"
          value={elapsedMs > 60000 ? `${(elapsedMs / 60000).toFixed(1)} min` : `${(elapsedMs / 1000).toFixed(1)} s`}
        />
        <MetricTile label="Steps/sec" value={stepsPerSec} tone="info" />
      </div>
    </Panel>
  );
}
