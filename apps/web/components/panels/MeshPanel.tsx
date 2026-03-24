"use client";

import Panel from "../ui/Panel";
import ReadonlyField from "../ui/ReadonlyField";

interface MeshPanelProps {
  grid: number[];   // [Nx, Ny, Nz]
  cellSize?: number[]; // [dx, dy, dz] in meters — from plan_summary
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

export default function MeshPanel({ grid, cellSize }: MeshPanelProps) {
  const [Nx, Ny, Nz] = grid.length >= 3 ? grid : [0, 0, 0];
  const [dx, dy, dz] = cellSize && cellSize.length >= 3 ? cellSize : [0, 0, 0];

  const groups: [string, Array<{ label: string; value: string; unit: string }>][] = [
    [
      "Grid",
      [
        { label: "Nx", value: `${Nx}`, unit: "" },
        { label: "Ny", value: `${Ny}`, unit: "" },
        { label: "Nz", value: `${Nz}`, unit: "" },
      ],
    ],
  ];

  if (dx || dy || dz) {
    groups.push([
      "Cell size",
      [
        { label: "dx", ...formatSI(dx) },
        { label: "dy", ...formatSI(dy) },
        { label: "dz", ...formatSI(dz) },
      ],
    ]);
    groups.push([
      "Total size",
      [
        { label: "Tx", ...formatSI(Nx * dx) },
        { label: "Ty", ...formatSI(Ny * dy) },
        { label: "Tz", ...formatSI(Nz * dz) },
      ],
    ]);
  }

  return (
    <Panel
      title="Mesh"
      subtitle="Technical mesh facts."
      panelId="mesh"
      eyebrow="Inspector"
    >
      <div style={{ display: "grid", gap: "1rem" }}>
        {groups.map(([group, entries]) => (
          <div key={group} style={{ display: "grid", gap: "0.8rem" }}>
            <header
              style={{
                fontSize: "0.76rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--text-3)",
              }}
            >
              {group}
            </header>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
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
        ))}
      </div>
    </Panel>
  );
}
