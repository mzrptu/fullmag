"use client";

import Panel from "../ui/Panel";
import ReadonlyField from "../ui/ReadonlyField";
import StatusBadge from "../ui/StatusBadge";

/* ── Types ─────────────────────────────────────────────────── */

interface MaterialPropertiesPanelProps {
  metadata: Record<string, unknown> | null;
  backend: string;
}

/* ── SI formatting ─────────────────────────────────────────── */

const SI_RANGES: [number, string][] = [
  [1e12,  "T"],
  [1e9,   "G"],
  [1e6,   "M"],
  [1e3,   "k"],
  [1,     ""],
  [1e-3,  "m"],
  [1e-6,  "µ"],
  [1e-9,  "n"],
  [1e-12, "p"],
];

function formatSI(value: number, unit: string, precision = 3): string {
  if (value === 0) return `0 ${unit}`;
  const abs = Math.abs(value);
  for (const [threshold, prefix] of SI_RANGES) {
    if (abs >= threshold) {
      return `${(value / threshold).toPrecision(precision)} ${prefix}${unit}`;
    }
  }
  return `${value.toExponential(precision - 1)} ${unit}`;
}

function formatDimensionless(value: number, precision = 4): string {
  if (value === 0) return "0";
  return value.toPrecision(precision);
}

/* ── Extract helpers ───────────────────────────────────────── */

interface MaterialData {
  msat?: number;
  aex?: number;
  alpha?: number;
  ku1?: number;
  ku2?: number;
  dind?: number;
  dbulk?: number;
  zeeman?: [number, number, number];
  exchangeEnabled?: boolean;
  demagEnabled?: boolean;
  zeemanEnabled?: boolean;
  anisotropyEnabled?: boolean;
  dmiEnabled?: boolean;
}

function extractMaterial(metadata: Record<string, unknown> | null): MaterialData | null {
  if (!metadata) return null;

  const plan = metadata.execution_plan as Record<string, unknown> | undefined;
  if (!plan) return null;

  const bp = plan.backend_plan as Record<string, unknown> | undefined;
  if (!bp) return null;

  // Try FEM plan first, then FDM
  const femPlan = bp.Fem as Record<string, unknown> | undefined;
  const fdmPlan = bp.Fdm as Record<string, unknown> | undefined;
  const source = femPlan ?? fdmPlan;
  if (!source) return null;

  const material = source.material as Record<string, unknown> | undefined;

  return {
    msat: typeof material?.msat === "number" ? material.msat : undefined,
    aex: typeof material?.aex === "number" ? material.aex : undefined,
    alpha: typeof material?.alpha === "number" ? material.alpha : undefined,
    ku1: typeof material?.ku1 === "number" ? material.ku1 : undefined,
    ku2: typeof material?.ku2 === "number" ? material.ku2 : undefined,
    dind: typeof material?.dind === "number" ? material.dind : undefined,
    dbulk: typeof material?.dbulk === "number" ? material.dbulk : undefined,
    zeeman: Array.isArray(source.zeeman_field)
      ? (source.zeeman_field as [number, number, number])
      : undefined,
    exchangeEnabled: typeof source.enable_exchange === "boolean" ? source.enable_exchange : undefined,
    demagEnabled: typeof source.enable_demag === "boolean" ? source.enable_demag : undefined,
    zeemanEnabled:
      Array.isArray(source.zeeman_field) &&
      (source.zeeman_field as number[]).some((v) => v !== 0),
    anisotropyEnabled:
      typeof material?.ku1 === "number" && material.ku1 !== 0,
    dmiEnabled:
      (typeof material?.dind === "number" && material.dind !== 0) ||
      (typeof material?.dbulk === "number" && material.dbulk !== 0),
  };
}

/* ── Component ─────────────────────────────────────────────── */

export default function MaterialPropertiesPanel({
  metadata,
  backend,
}: MaterialPropertiesPanelProps) {
  const mat = extractMaterial(metadata);

  if (!mat) {
    return (
      <Panel
        title="Material"
        subtitle="Material properties from the execution plan."
        panelId="material"
        eyebrow="Physics"
      >
        <div style={{ padding: "0.75rem", color: "var(--text-3)", fontSize: "0.85rem" }}>
          Material data will appear once the session metadata is loaded.
        </div>
      </Panel>
    );
  }

  /* Active energy terms */
  const terms: string[] = [];
  if (mat.exchangeEnabled) terms.push("Exchange");
  if (mat.demagEnabled) terms.push("Demag");
  if (mat.zeemanEnabled) terms.push("Zeeman");
  if (mat.anisotropyEnabled) terms.push("Anisotropy");
  if (mat.dmiEnabled) terms.push("DMI");

  return (
    <Panel
      title="Material"
      subtitle="Magnetic material properties and active energy terms."
      panelId="material"
      eyebrow="Physics"
      actions={
        <StatusBadge
          label={`${terms.length} terms`}
          tone={terms.length > 0 ? "info" : "default"}
        />
      }
    >
      <div style={{ display: "grid", gap: "0.85rem" }}>
        {/* Intrinsic properties */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "0.75rem",
          }}
        >
          <ReadonlyField
            label="M_sat"
            value={mat.msat != null ? formatSI(mat.msat, "A/m") : "—"}
            mono
          />
          <ReadonlyField
            label="A_ex"
            value={mat.aex != null ? formatSI(mat.aex, "J/m") : "—"}
            mono
          />
          <ReadonlyField
            label="α (damping)"
            value={mat.alpha != null ? formatDimensionless(mat.alpha) : "—"}
            mono
          />
        </div>

        {/* Anisotropy / DMI */}
        {(mat.ku1 || mat.dind || mat.dbulk) && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "0.75rem",
            }}
          >
            <ReadonlyField
              label="K_u1"
              value={mat.ku1 != null ? formatSI(mat.ku1, "J/m³") : "—"}
              mono
            />
            <ReadonlyField
              label="D_ind"
              value={mat.dind != null ? formatSI(mat.dind, "J/m²") : "—"}
              mono
            />
            <ReadonlyField
              label="D_bulk"
              value={mat.dbulk != null ? formatSI(mat.dbulk, "J/m²") : "—"}
              mono
            />
          </div>
        )}

        {/* Zeeman */}
        {mat.zeeman && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "0.75rem",
            }}
          >
            <ReadonlyField
              label="B_ext.x"
              value={formatSI(mat.zeeman[0], "T")}
              mono
            />
            <ReadonlyField
              label="B_ext.y"
              value={formatSI(mat.zeeman[1], "T")}
              mono
            />
            <ReadonlyField
              label="B_ext.z"
              value={formatSI(mat.zeeman[2], "T")}
              mono
            />
          </div>
        )}

        {/* Active terms */}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {terms.map((term) => (
            <span
              key={term}
              style={{
                fontSize: "0.72rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                padding: "0.2rem 0.55rem",
                borderRadius: "4px",
                background: "hsl(210 60% 25%)",
                color: "hsl(210 80% 82%)",
                border: "1px solid hsl(210 50% 35%)",
              }}
            >
              {term}
            </span>
          ))}
          {terms.length === 0 && (
            <span style={{ fontSize: "0.82rem", color: "var(--text-3)" }}>
              No energy terms detected
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}
