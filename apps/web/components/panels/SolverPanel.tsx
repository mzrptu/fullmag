"use client";

import Panel from "../ui/Panel";
import ReadonlyField from "../ui/ReadonlyField";

interface SolverPanelProps {
  status: string;
  totalSteps: number;
  time: number | null;
  dt: number;
  eEx: number | null;
  eTotal?: number | null;
  backend: string;
  mode: string;
  precision: string;
}

export default function SolverPanel({
  status,
  totalSteps,
  time,
  dt,
  eEx,
  eTotal,
  backend,
  mode,
  precision,
}: SolverPanelProps) {
  return (
    <Panel
      title="Solver"
      subtitle="Runtime state and numerical telemetry."
      panelId="solver"
      eyebrow="Control rail"
      tone="info"
    >
      <div style={{ display: "grid", gap: "1rem" }}>
        {/* Telemetry */}
        <section style={{ display: "grid", gap: "0.9rem" }}>
          <header style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Telemetry</h3>
            <p style={{ margin: 0, color: "var(--text-2)", fontSize: "0.88rem" }}>
              Readonly runtime signals.
            </p>
          </header>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "0.75rem",
            }}
          >
            <ReadonlyField label="Status" value={status || "idle"} />
            <ReadonlyField label="Steps" value={`${totalSteps}`} mono />
            <ReadonlyField
              label="Time"
              value={time !== null ? time.toExponential(3) : "—"}
              unit="s"
              mono
            />
            <ReadonlyField
              label="dt"
              value={dt ? dt.toExponential(3) : "—"}
              unit="s"
              mono
            />
            <ReadonlyField
              label="E_exchange"
              value={eEx !== null ? eEx.toExponential(3) : "—"}
              unit="J"
              mono
            />
            <ReadonlyField
              label="E_total"
              value={eTotal !== null && eTotal !== undefined ? eTotal.toExponential(3) : "—"}
              unit="J"
              mono
            />
          </div>
        </section>

        {/* Execution Config */}
        <section style={{ display: "grid", gap: "0.9rem" }}>
          <header style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Execution</h3>
          </header>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "0.75rem",
            }}
          >
            <ReadonlyField label="Backend" value={backend} />
            <ReadonlyField label="Mode" value={mode} />
            <ReadonlyField label="Precision" value={precision} />
          </div>
        </section>
      </div>
    </Panel>
  );
}
