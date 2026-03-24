"use client";

import Panel from "../ui/Panel";
import ReadonlyField from "../ui/ReadonlyField";

/* ── FEM mesh info (from mesh builder / artifacts) ────────────────── */

export interface FemMeshInfo {
  nNodes: number;
  nElements: number;
  nBoundaryFaces: number;
  totalVolume: number;
  feOrder: number;
  quality?: {
    minAR: number;
    maxAR: number;
    meanAR: number;
  };
}

interface MeshPanelProps {
  /** FDM grid dimensions [Nx, Ny, Nz] */
  grid?: number[];
  /** FDM cell size [dx, dy, dz] in meters */
  cellSize?: number[];
  /** FEM mesh info — if present, FEM mode is used */
  femInfo?: FemMeshInfo;
}

const SI_PREFIXES = [
  { threshold: 1,    divisor: 1,    unit: "m" },
  { threshold: 1e-3, divisor: 1e-3, unit: "mm" },
  { threshold: 1e-6, divisor: 1e-6, unit: "µm" },
  { threshold: 1e-9, divisor: 1e-9, unit: "nm" },
  { threshold: 0,    divisor: 1e-12, unit: "pm" },
];

function formatSI(meters: number): { value: string; unit: string } {
  if (meters === 0) return { value: "0", unit: "m" };
  const abs = Math.abs(meters);
  for (const { threshold, divisor, unit } of SI_PREFIXES) {
    if (abs >= threshold) {
      const scaled = meters / divisor;
      const decimals = abs >= 1 ? 3 : Math.max(0, 4 - Math.floor(Math.log10(Math.abs(scaled)) + 1));
      return { value: scaled.toFixed(decimals), unit };
    }
  }
  const last = SI_PREFIXES[SI_PREFIXES.length - 1];
  return { value: (meters / last.divisor).toFixed(3), unit: last.unit };
}

function formatEng(v: number, p = 3): string {
  if (v === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  if (exp >= -3 && exp <= 3) return v.toPrecision(p);
  return v.toExponential(p - 1);
}

/* ── Shared section renderer ──────────────────────────────────────── */

function Section({
  title,
  entries,
}: {
  title: string;
  entries: { label: string; value: string; unit: string }[];
}) {
  return (
    <div style={{ display: "grid", gap: "0.8rem" }}>
      <header
        style={{
          fontSize: "0.76rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--text-3)",
        }}
      >
        {title}
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(entries.length, 3)}, minmax(0, 1fr))`,
          gap: "0.8rem",
        }}
      >
        {entries.map((entry) => (
          <ReadonlyField
            key={entry.label}
            label={entry.label}
            value={entry.value}
            unit={entry.unit}
            mono
          />
        ))}
      </div>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────────── */

export default function MeshPanel({ grid, cellSize, femInfo }: MeshPanelProps) {
  const isFem = !!femInfo;

  return (
    <Panel
      title="Mesh"
      subtitle={isFem ? "FEM tetrahedral mesh." : "FDM structured grid."}
      panelId="mesh"
      eyebrow={isFem ? "FEM" : "FDM"}
    >
      <div style={{ display: "grid", gap: "1rem" }}>
        {/* ── FEM mode ──────────────────────────── */}
        {isFem && femInfo && (
          <>
            <Section
              title="Topology"
              entries={[
                { label: "Nodes", value: femInfo.nNodes.toLocaleString(), unit: "" },
                { label: "Elements", value: femInfo.nElements.toLocaleString(), unit: "" },
                { label: "Boundary", value: femInfo.nBoundaryFaces.toLocaleString(), unit: "" },
              ]}
            />
            <Section
              title="Properties"
              entries={[
                { label: "Volume", value: formatEng(femInfo.totalVolume), unit: "m³" },
                { label: "FE Order", value: `P${femInfo.feOrder}`, unit: "" },
              ]}
            />
            {femInfo.quality && (
              <Section
                title="Quality"
                entries={[
                  { label: "Min AR", value: femInfo.quality.minAR.toFixed(2), unit: "" },
                  { label: "Mean AR", value: femInfo.quality.meanAR.toFixed(2), unit: "" },
                  { label: "Max AR", value: femInfo.quality.maxAR.toFixed(2), unit: "" },
                ]}
              />
            )}
          </>
        )}

        {/* ── FDM mode ──────────────────────────── */}
        {!isFem && grid && (
          <>
            {(() => {
              const [Nx, Ny, Nz] = grid.length >= 3 ? grid : [0, 0, 0];
              const [dx, dy, dz] = cellSize && cellSize.length >= 3 ? cellSize : [0, 0, 0];

              return (
                <>
                  <Section
                    title="Grid"
                    entries={[
                      { label: "Nx", value: `${Nx}`, unit: "" },
                      { label: "Ny", value: `${Ny}`, unit: "" },
                      { label: "Nz", value: `${Nz}`, unit: "" },
                    ]}
                  />
                  {(dx || dy || dz) && (
                    <>
                      <Section
                        title="Cell size"
                        entries={[
                          { label: "dx", ...formatSI(dx) },
                          { label: "dy", ...formatSI(dy) },
                          { label: "dz", ...formatSI(dz) },
                        ]}
                      />
                      <Section
                        title="Total size"
                        entries={[
                          { label: "Tx", ...formatSI(Nx * dx) },
                          { label: "Ty", ...formatSI(Ny * dy) },
                          { label: "Tz", ...formatSI(Nz * dz) },
                        ]}
                      />
                    </>
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>
    </Panel>
  );
}
