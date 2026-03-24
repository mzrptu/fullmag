"use client";

import { useMemo } from "react";
import Panel from "../ui/Panel";
import ReadonlyField from "../ui/ReadonlyField";
import StatusBadge from "../ui/StatusBadge";

/* ── Types ─────────────────────────────────────────────────── */

interface DerivedValuesPanelProps {
  /** Flattened vector field [vx0,vy0,vz0, vx1,vy1,vz1, ...] */
  vectors: Float64Array | number[] | null;
  /** Quantity label e.g. "Magnetization" */
  quantityLabel: string;
  /** Quantity unit e.g. "A/m" */
  quantityUnit: string;
  /** Grid size for FDM, or nNodes for FEM */
  nValues: number;
  /** Current simulation step */
  step: number;
  /** Current simulation time */
  time: number;
}

/* ── Stats computation ─────────────────────────────────────── */

interface FieldStats {
  /* Per-component */
  meanX: number; meanY: number; meanZ: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  rmsX: number; rmsY: number; rmsZ: number;
  /* Magnitude */
  meanMag: number;
  minMag: number;
  maxMag: number;
  rmsMag: number;
}

function computeFieldStats(vectors: Float64Array | number[], n: number): FieldStats | null {
  if (n <= 0 || vectors.length < n * 3) return null;

  let sumX = 0, sumY = 0, sumZ = 0;
  let sumSqX = 0, sumSqY = 0, sumSqZ = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let sumMag = 0, sumSqMag = 0;
  let minMag = Infinity, maxMag = -Infinity;

  for (let i = 0; i < n; i++) {
    const vx = vectors[i * 3];
    const vy = vectors[i * 3 + 1];
    const vz = vectors[i * 3 + 2];
    const mag = Math.sqrt(vx * vx + vy * vy + vz * vz);

    sumX += vx; sumY += vy; sumZ += vz;
    sumSqX += vx * vx; sumSqY += vy * vy; sumSqZ += vz * vz;
    if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
    if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
    sumMag += mag; sumSqMag += mag * mag;
    if (mag < minMag) minMag = mag;
    if (mag > maxMag) maxMag = mag;
  }

  const inv = 1 / n;
  return {
    meanX: sumX * inv, meanY: sumY * inv, meanZ: sumZ * inv,
    minX, minY, minZ,
    maxX, maxY, maxZ,
    rmsX: Math.sqrt(sumSqX * inv),
    rmsY: Math.sqrt(sumSqY * inv),
    rmsZ: Math.sqrt(sumSqZ * inv),
    meanMag: sumMag * inv,
    minMag, maxMag,
    rmsMag: Math.sqrt(sumSqMag * inv),
  };
}

/* ── Formatting ────────────────────────────────────────────── */

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs === 0) return "0";
  if (abs >= 1e6)  return v.toExponential(3);
  if (abs >= 1e3)  return v.toFixed(1);
  if (abs >= 1)    return v.toPrecision(4);
  if (abs >= 1e-3) return v.toPrecision(4);
  return v.toExponential(3);
}

function fmtTime(t: number): string {
  if (t === 0) return "0 s";
  const abs = Math.abs(t);
  if (abs >= 1)     return `${t.toPrecision(4)} s`;
  if (abs >= 1e-3)  return `${(t * 1e3).toPrecision(4)} ms`;
  if (abs >= 1e-6)  return `${(t * 1e6).toPrecision(4)} µs`;
  if (abs >= 1e-9)  return `${(t * 1e9).toPrecision(4)} ns`;
  if (abs >= 1e-12) return `${(t * 1e12).toPrecision(4)} ps`;
  return `${t.toExponential(3)} s`;
}

/* ── Component ─────────────────────────────────────────────── */

const LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.65rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-3)",
  marginBottom: "0.15rem",
};

const CELL_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.8rem",
  color: "var(--text-1)",
};

const HEADER_STYLE: React.CSSProperties = {
  fontSize: "0.68rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-3)",
  padding: "0.3rem 0",
};

export default function DerivedValuesPanel({
  vectors,
  quantityLabel,
  quantityUnit,
  nValues,
  step,
  time,
}: DerivedValuesPanelProps) {
  const stats = useMemo(() => {
    if (!vectors) return null;
    return computeFieldStats(vectors, nValues);
  }, [vectors, nValues]);

  return (
    <Panel
      title="Derived Values"
      subtitle={`Spatial statistics of ${quantityLabel} (${quantityUnit}).`}
      panelId="derived-values"
      eyebrow="Results"
      actions={
        <StatusBadge
          label={stats ? `Step ${step}` : "—"}
          tone={stats ? "info" : "default"}
        />
      }
    >
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {/* Context row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "0.6rem",
          }}
        >
          <ReadonlyField label="Quantity" value={quantityLabel} />
          <ReadonlyField label="Step" value={step.toLocaleString()} mono />
          <ReadonlyField label="Time" value={fmtTime(time)} mono />
        </div>

        {!stats ? (
          <div style={{ padding: "0.5rem", color: "var(--text-3)", fontSize: "0.85rem" }}>
            No field data available yet.
          </div>
        ) : (
          <>
            {/* Statistics table */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "64px repeat(4, minmax(0, 1fr))",
                gap: "0.3rem 0.5rem",
                background: "rgba(6, 10, 18, 0.5)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                padding: "0.6rem 0.75rem",
              }}
            >
              {/* Header */}
              <div style={HEADER_STYLE} />
              <div style={HEADER_STYLE}>Mean</div>
              <div style={HEADER_STYLE}>Min</div>
              <div style={HEADER_STYLE}>Max</div>
              <div style={HEADER_STYLE}>RMS</div>

              {/* X row */}
              <div style={LABEL_STYLE}>v.x</div>
              <div style={CELL_STYLE}>{fmt(stats.meanX)}</div>
              <div style={CELL_STYLE}>{fmt(stats.minX)}</div>
              <div style={CELL_STYLE}>{fmt(stats.maxX)}</div>
              <div style={CELL_STYLE}>{fmt(stats.rmsX)}</div>

              {/* Y row */}
              <div style={LABEL_STYLE}>v.y</div>
              <div style={CELL_STYLE}>{fmt(stats.meanY)}</div>
              <div style={CELL_STYLE}>{fmt(stats.minY)}</div>
              <div style={CELL_STYLE}>{fmt(stats.maxY)}</div>
              <div style={CELL_STYLE}>{fmt(stats.rmsY)}</div>

              {/* Z row */}
              <div style={LABEL_STYLE}>v.z</div>
              <div style={CELL_STYLE}>{fmt(stats.meanZ)}</div>
              <div style={CELL_STYLE}>{fmt(stats.minZ)}</div>
              <div style={CELL_STYLE}>{fmt(stats.maxZ)}</div>
              <div style={CELL_STYLE}>{fmt(stats.rmsZ)}</div>

              {/* Magnitude row */}
              <div style={{ ...LABEL_STYLE, color: "hsl(210 70% 65%)" }}>|v|</div>
              <div style={CELL_STYLE}>{fmt(stats.meanMag)}</div>
              <div style={CELL_STYLE}>{fmt(stats.minMag)}</div>
              <div style={CELL_STYLE}>{fmt(stats.maxMag)}</div>
              <div style={CELL_STYLE}>{fmt(stats.rmsMag)}</div>
            </div>

            {/* Spatial average vector */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "0.6rem",
              }}
            >
              <ReadonlyField
                label="⟨v⟩.x"
                value={fmt(stats.meanX)}
                mono
              />
              <ReadonlyField
                label="⟨v⟩.y"
                value={fmt(stats.meanY)}
                mono
              />
              <ReadonlyField
                label="⟨v⟩.z"
                value={fmt(stats.meanZ)}
                mono
              />
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
