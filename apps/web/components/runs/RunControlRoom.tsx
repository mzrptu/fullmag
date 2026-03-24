"use client";

import { useEffect, useMemo, useState } from "react";
import { useSessionStream } from "../../lib/useSessionStream";
import Header from "../ui/Header";
import ConsolePanel from "../panels/ConsolePanel";
import SolverPanel from "../panels/SolverPanel";
import MeshPanel from "../panels/MeshPanel";
import MetricsPanel from "../panels/MetricsPanel";
import MagnetizationSlice2D from "../preview/MagnetizationSlice2D";
import MagnetizationView3D from "../preview/MagnetizationView3D";
import Panel from "../ui/Panel";
import SegmentedControl from "../ui/SegmentedControl";
import StatusBadge from "../ui/StatusBadge";
import EmptyState from "../ui/EmptyState";
import SelectField from "../ui/SelectField";

interface RunControlRoomProps {
  sessionId: string;
}

type ViewportMode = "2D" | "3D";
type VectorComponent = "x" | "y" | "z" | "magnitude";
type SlicePlane = "xy" | "xz" | "yz";

const COMPONENT_OPTIONS = [
  { value: "magnitude", label: "|v|" },
  { value: "x", label: "x" },
  { value: "y", label: "y" },
  { value: "z", label: "z" },
];

const PLANE_OPTIONS = [
  { value: "xy", label: "XY" },
  { value: "xz", label: "XZ" },
  { value: "yz", label: "YZ" },
];

const SCALAR_FIELDS: Record<string, keyof NonNullable<ReturnType<typeof useSessionStream>["state"]>["scalar_rows"][number]> = {
  E_ex: "e_ex",
  E_demag: "e_demag",
  E_ext: "e_ext",
  E_total: "e_total",
};

export default function RunControlRoom({ sessionId }: RunControlRoomProps) {
  const { state, connection, error } = useSessionStream(sessionId);
  const [viewMode, setViewMode] = useState<ViewportMode>("3D");
  const [component, setComponent] = useState<VectorComponent>("magnitude");
  const [plane, setPlane] = useState<SlicePlane>("xy");
  const [sliceIndex, setSliceIndex] = useState(0);
  const [selectedQuantity, setSelectedQuantity] = useState("m");

  const session = state?.session;
  const run = state?.run;
  const liveState = state?.live_state;
  const grid = (liveState?.grid ?? state?.latest_fields.grid ?? [0, 0, 0]) as [
    number,
    number,
    number,
  ];

  const quantityOptions = useMemo(
    () =>
      (state?.quantities ?? [])
        .filter((quantity) => quantity.available)
        .map((quantity) => ({
          value: quantity.id,
          label: `${quantity.label} (${quantity.unit})`,
        })),
    [state?.quantities],
  );

  useEffect(() => {
    if (!quantityOptions.length) {
      return;
    }
    if (!quantityOptions.some((option) => option.value === selectedQuantity)) {
      setSelectedQuantity(quantityOptions[0].value);
    }
  }, [quantityOptions, selectedQuantity]);

  const quantityDescriptor = useMemo(
    () => state?.quantities.find((quantity) => quantity.id === selectedQuantity) ?? null,
    [selectedQuantity, state?.quantities],
  );

  const fieldMap = useMemo(
    () => ({
      m: liveState?.magnetization ?? state?.latest_fields.m ?? null,
      H_ex: state?.latest_fields.h_ex ?? null,
      H_demag: state?.latest_fields.h_demag ?? null,
      H_ext: state?.latest_fields.h_ext ?? null,
      H_eff: state?.latest_fields.h_eff ?? null,
    }),
    [
      liveState?.magnetization,
      state?.latest_fields.h_demag,
      state?.latest_fields.h_eff,
      state?.latest_fields.h_ex,
      state?.latest_fields.h_ext,
      state?.latest_fields.m,
    ],
  );

  const selectedVectors = useMemo(() => {
    const values = fieldMap[selectedQuantity as keyof typeof fieldMap] ?? null;
    return values ? new Float64Array(values) : null;
  }, [fieldMap, selectedQuantity]);

  const scalarRows = state?.scalar_rows ?? [];
  const selectedScalarValue = useMemo(() => {
    const scalarKey = SCALAR_FIELDS[selectedQuantity];
    if (!scalarKey) {
      return null;
    }
    const lastRow = scalarRows[scalarRows.length - 1];
    return lastRow ? lastRow[scalarKey] : null;
  }, [scalarRows, selectedQuantity]);

  const events = useMemo(() => {
    if (!state) {
      return [];
    }
    const derived = [
      { kind: "session_started", session_id: state.session.session_id },
      {
        kind:
          state.session.status === "running"
            ? "run_progress"
            : state.session.status === "failed"
              ? "run_failed"
              : "run_completed",
        step: state.run?.total_steps ?? state.live_state?.step ?? 0,
        time: state.run?.final_time ?? state.live_state?.time ?? 0,
      },
    ];
    if (state.live_state?.step) {
      derived.push({
        kind: "run_progress",
        step: state.live_state.step,
        time: state.live_state.time,
      });
    }
    return derived;
  }, [state]);

  const elapsedMs = session
    ? session.finished_at_unix_ms - session.started_at_unix_ms
    : 0;

  const cellSize = useMemo(() => {
    const summary = session?.plan_summary as Record<string, unknown> | undefined;
    const raw = summary?.cell_size_m;
    return Array.isArray(raw) ? (raw as number[]) : undefined;
  }, [session?.plan_summary]);

  const maxSliceCount = useMemo(() => {
    if (plane === "xy") return Math.max(1, grid[2]);
    if (plane === "xz") return Math.max(1, grid[1]);
    return Math.max(1, grid[0]);
  }, [grid, plane]);

  useEffect(() => {
    if (sliceIndex >= maxSliceCount) {
      setSliceIndex(Math.max(0, maxSliceCount - 1));
    }
  }, [maxSliceCount, sliceIndex]);

  if (!state) {
    return (
      <div className="app-shell" style={{ padding: "1rem" }}>
        <EmptyState
          title={error ? "Connection Error" : "Connecting…"}
          description={error ?? `Connecting to session ${sessionId}…`}
          tone={error ? "danger" : "info"}
        />
      </div>
    );
  }

  const isVectorQuantity = quantityDescriptor?.kind === "vector_field";

  return (
    <div
      className="app-shell"
      style={{
        position: "relative",
        display: "flex",
        minHeight: "100vh",
        flexDirection: "column",
        padding: "1rem",
        gap: "1rem",
        background:
          "radial-gradient(circle at top left, rgba(107,167,255,0.14), transparent 32%), radial-gradient(circle at right 14%, rgba(87,200,182,0.1), transparent 24%), linear-gradient(180deg, #060d18 0%, #08101d 44%, #07101c 100%)",
        fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
        color: "var(--text-1)",
        fontSize: "15px",
      }}
    >
      <Header
        status={session?.status ?? ""}
        scriptPath={session?.script_path ?? ""}
        problemName={session?.problem_name ?? ""}
        connection={connection}
      />

      <div
        className="workspace"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--panel-gap)",
        }}
      >
        <div style={{ gridColumn: "1 / -1" }}>
          <Panel
            title="Preview"
            subtitle="Visualization-first control room. Choose the quantity you want to inspect."
            panelId="preview"
            eyebrow="Visualization"
            tone="info"
            actions={
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <StatusBadge
                  label={quantityDescriptor?.label ?? "Awaiting data"}
                  tone={isVectorQuantity ? "info" : "default"}
                />
                <SegmentedControl
                  value={viewMode}
                  options={[
                    { value: "3D", label: "3D" },
                    { value: "2D", label: "2D" },
                  ]}
                  onchange={(value) => setViewMode(value as ViewportMode)}
                />
              </div>
            }
          >
            <div style={{ display: "grid", gap: "0.9rem" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: "0.75rem",
                }}
              >
                <SelectField
                  label="Quantity"
                  value={selectedQuantity}
                  options={quantityOptions.length ? quantityOptions : [{ value: "m", label: "Magnetization" }]}
                  onchange={(value) => setSelectedQuantity(value)}
                />
                <SelectField
                  label="Component"
                  value={component}
                  options={COMPONENT_OPTIONS}
                  onchange={(value) => setComponent(value as VectorComponent)}
                />
                <SelectField
                  label="Plane"
                  value={plane}
                  options={PLANE_OPTIONS}
                  onchange={(value) => setPlane(value as SlicePlane)}
                />
                <SelectField
                  label="Slice"
                  value={sliceIndex}
                  options={Array.from({ length: maxSliceCount }, (_, index) => ({
                    value: String(index),
                    label: `${index + 1}`,
                  }))}
                  onchange={(value) => setSliceIndex(Number(value))}
                />
              </div>

              <div
                style={{
                  position: "relative",
                  minHeight: "var(--canvas-min-height)",
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border-subtle)",
                  background:
                    "linear-gradient(180deg, rgba(6,10,18,0.98), rgba(7,10,17,0.98))",
                  overflow: "hidden",
                }}
              >
                {!isVectorQuantity ? (
                  <div style={{ padding: "1.25rem" }}>
                    <EmptyState
                      title={quantityDescriptor?.label ?? "Scalar quantity"}
                      description={
                        selectedScalarValue !== null
                          ? `Latest value: ${selectedScalarValue.toExponential(4)} ${quantityDescriptor?.unit ?? ""}`
                          : "This quantity is scalar-only. Use the Scalars panel below for the time trace."
                      }
                      tone="info"
                    />
                  </div>
                ) : !selectedVectors ? (
                  <div style={{ padding: "1.25rem" }}>
                    <EmptyState
                      title="No preview data yet"
                      description="This quantity has not been published by the runner yet."
                      tone="info"
                    />
                  </div>
                ) : viewMode === "3D" ? (
                  <MagnetizationView3D
                    grid={grid}
                    vectors={selectedVectors}
                    fieldLabel={quantityDescriptor?.label ?? selectedQuantity}
                  />
                ) : (
                  <MagnetizationSlice2D
                    grid={grid}
                    vectors={selectedVectors}
                    quantityLabel={quantityDescriptor?.label ?? selectedQuantity}
                    component={component}
                    plane={plane}
                    sliceIndex={sliceIndex}
                  />
                )}
              </div>
            </div>
          </Panel>
        </div>

        <div>
          <ConsolePanel events={events} connection={connection} />
        </div>
        <div>
          <SolverPanel
            status={session?.status ?? ""}
            totalSteps={run?.total_steps ?? liveState?.step ?? 0}
            time={run?.final_time ?? liveState?.time ?? null}
            dt={liveState?.dt ?? 0}
            eEx={run?.final_e_ex ?? liveState?.e_ex ?? null}
            eTotal={run?.final_e_total ?? liveState?.e_total ?? null}
            backend={session?.requested_backend ?? ""}
            mode={session?.execution_mode ?? ""}
            precision={session?.precision ?? ""}
          />
        </div>

        <div>
          <MeshPanel grid={grid} cellSize={cellSize} />
        </div>
        <div>
          <Panel
            title="Scalars"
            subtitle="Time-series of active energies and diagnostics."
            panelId="scalars"
            eyebrow="Analysis"
          >
            {scalarRows.length > 0 ? (
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.82rem",
                  color: "var(--text-2)",
                  maxHeight: "var(--terminal-height)",
                  overflow: "auto",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <th style={{ padding: "0.3rem 0.5rem", textAlign: "left", color: "var(--text-3)" }}>Step</th>
                      <th style={{ padding: "0.3rem 0.5rem", textAlign: "left", color: "var(--text-3)" }}>Time</th>
                      <th style={{ padding: "0.3rem 0.5rem", textAlign: "left", color: "var(--text-3)" }}>E_ex</th>
                      <th style={{ padding: "0.3rem 0.5rem", textAlign: "left", color: "var(--text-3)" }}>E_demag</th>
                      <th style={{ padding: "0.3rem 0.5rem", textAlign: "left", color: "var(--text-3)" }}>E_ext</th>
                      <th style={{ padding: "0.3rem 0.5rem", textAlign: "left", color: "var(--text-3)" }}>E_total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scalarRows.slice(-20).map((row) => (
                      <tr key={`${row.step}-${row.time}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "0.25rem 0.5rem" }}>{row.step}</td>
                        <td style={{ padding: "0.25rem 0.5rem" }}>{row.time.toExponential(3)}</td>
                        <td style={{ padding: "0.25rem 0.5rem" }}>{row.e_ex.toExponential(3)}</td>
                        <td style={{ padding: "0.25rem 0.5rem" }}>{row.e_demag.toExponential(3)}</td>
                        <td style={{ padding: "0.25rem 0.5rem" }}>{row.e_ext.toExponential(3)}</td>
                        <td style={{ padding: "0.25rem 0.5rem" }}>{row.e_total.toExponential(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No scalar data yet" tone="info" compact />
            )}
          </Panel>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <MetricsPanel totalSteps={run?.total_steps ?? liveState?.step ?? 0} elapsedMs={elapsedMs} />
        </div>
      </div>
    </div>
  );
}
