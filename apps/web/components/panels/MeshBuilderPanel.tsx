"use client";

import { useCallback, useState } from "react";
import Panel from "../ui/Panel";
import SelectField from "../ui/SelectField";
import TextField from "../ui/TextField";
import Button from "../ui/Button";
import ReadonlyField from "../ui/ReadonlyField";
import s from "./MeshBuilderPanel.module.css";

/* ── Types ─────────────────────────────────────────────────────────── */

type GeometryKind = "box" | "cylinder" | "stl";
type MeshStatus = "idle" | "generating" | "ready" | "error";

interface BoxDims {
  sx: string;
  sy: string;
  sz: string;
}

interface CylinderDims {
  radius: string;
  height: string;
}

export interface MeshQuality {
  nNodes: number;
  nElements: number;
  nBoundaryFaces: number;
  totalVolume: number;
  minAR: number;
  maxAR: number;
  meanAR: number;
}

export interface GeneratedMesh {
  nodes: number[];       // flattened [x0,y0,z0, x1,y1,z1, ...]
  elements: number[];    // flattened [n0,n1,n2,n3, ...]
  boundaryFaces: number[]; // flattened [n0,n1,n2, ...]
  nNodes: number;
  nElements: number;
  quality: MeshQuality;
}

interface MeshBuilderPanelProps {
  onMeshGenerated?: (mesh: GeneratedMesh) => void;
  apiBase?: string;
}

/* ── Constants ─────────────────────────────────────────────────────── */

const GEOMETRY_OPTIONS = [
  { value: "box", label: "Box" },
  { value: "cylinder", label: "Cylinder" },
  { value: "stl", label: "Import STL" },
];

const ORDER_OPTIONS = [
  { value: "1", label: "P1 (linear)" },
  { value: "2", label: "P2 (quadratic)" },
];

function formatSI(meters: number): string {
  if (meters === 0) return "0 m";
  const abs = Math.abs(meters);
  if (abs >= 1e-3) return `${(meters * 1e3).toFixed(1)} mm`;
  if (abs >= 1e-6) return `${(meters * 1e6).toFixed(1)} µm`;
  if (abs >= 1e-9) return `${(meters * 1e9).toFixed(1)} nm`;
  return `${(meters * 1e12).toFixed(1)} pm`;
}

function formatEngineering(v: number, precision = 3): string {
  if (v === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  if (exp >= -3 && exp <= 3) return v.toPrecision(precision);
  return v.toExponential(precision - 1);
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function MeshBuilderPanel({
  onMeshGenerated,
  apiBase = "",
}: MeshBuilderPanelProps) {
  const [geometry, setGeometry] = useState<GeometryKind>("box");
  const [boxDims, setBoxDims] = useState<BoxDims>({ sx: "100e-9", sy: "100e-9", sz: "20e-9" });
  const [cylDims, setCylDims] = useState<CylinderDims>({ radius: "50e-9", height: "20e-9" });
  const [hmax, setHmax] = useState("5e-9");
  const [feOrder, setFeOrder] = useState("1");
  const [airPadding, setAirPadding] = useState("0");
  const [status, setStatus] = useState<MeshStatus>("idle");
  const [quality, setQuality] = useState<MeshQuality | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setStatus("generating");
    setErrorMsg(null);
    setQuality(null);

    try {
      const body: Record<string, unknown> = {
        hmax: parseFloat(hmax),
        order: parseInt(feOrder, 10),
        air_padding: parseFloat(airPadding),
      };

      if (geometry === "box") {
        body.geometry = {
          kind: "box",
          size: [parseFloat(boxDims.sx), parseFloat(boxDims.sy), parseFloat(boxDims.sz)],
        };
      } else if (geometry === "cylinder") {
        body.geometry = {
          kind: "cylinder",
          radius: parseFloat(cylDims.radius),
          height: parseFloat(cylDims.height),
        };
      }

      const resp = await fetch(`${apiBase}/api/mesh/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const data: GeneratedMesh = await resp.json();
      setQuality(data.quality);
      setStatus("ready");
      onMeshGenerated?.(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStatus("error");
    }
  }, [geometry, boxDims, cylDims, hmax, feOrder, airPadding, apiBase, onMeshGenerated]);

  return (
    <Panel
      title="Mesh Builder"
      subtitle="Configure and generate FEM tetrahedral mesh."
      panelId="mesh-builder"
      eyebrow="FEM"
      actions={
        <span className={s.statusPill} data-status={status}>
          {status}
        </span>
      }
    >
      <div className={s.meshBuilder}>
        {/* ── Geometry ─────────────────────────── */}
        <div className={s.section}>
          <header className={s.sectionTitle}>Geometry</header>
          <SelectField
            label="Shape"
            value={geometry}
            options={GEOMETRY_OPTIONS}
            onchange={(v) => setGeometry(v as GeometryKind)}
          />

          {geometry === "box" && (
            <div className={s.row}>
              <TextField
                label="sx"
                value={boxDims.sx}
                unit="m"
                mono
                onchange={(e) => setBoxDims((p) => ({ ...p, sx: e.target.value }))}
              />
              <TextField
                label="sy"
                value={boxDims.sy}
                unit="m"
                mono
                onchange={(e) => setBoxDims((p) => ({ ...p, sy: e.target.value }))}
              />
              <TextField
                label="sz"
                value={boxDims.sz}
                unit="m"
                mono
                onchange={(e) => setBoxDims((p) => ({ ...p, sz: e.target.value }))}
              />
            </div>
          )}

          {geometry === "cylinder" && (
            <div className={s.rowWide}>
              <TextField
                label="radius"
                value={cylDims.radius}
                unit="m"
                mono
                onchange={(e) => setCylDims((p) => ({ ...p, radius: e.target.value }))}
              />
              <TextField
                label="height"
                value={cylDims.height}
                unit="m"
                mono
                onchange={(e) => setCylDims((p) => ({ ...p, height: e.target.value }))}
              />
            </div>
          )}

          {geometry === "stl" && (
            <TextField label="STL file" placeholder="/path/to/geometry.stl" mono />
          )}
        </div>

        {/* ── Discretization ──────────────────── */}
        <div className={s.section}>
          <header className={s.sectionTitle}>Discretization</header>
          <div className={s.rowWide}>
            <TextField
              label="hmax"
              value={hmax}
              unit="m"
              mono
              onchange={(e) => setHmax(e.target.value)}
            />
            <SelectField
              label="FE Order"
              value={feOrder}
              options={ORDER_OPTIONS}
              onchange={(v) => setFeOrder(v)}
            />
          </div>
          <TextField
            label="Air padding"
            value={airPadding}
            unit="×"
            mono
            onchange={(e) => setAirPadding(e.target.value)}
          />
        </div>

        {/* ── Generate ────────────────────────── */}
        <div className={s.actionRow}>
          <Button
            variant="solid"
            tone="accent"
            onClick={handleGenerate}
            disabled={status === "generating"}
          >
            {status === "generating" ? "Generating…" : "Generate Mesh"}
          </Button>
        </div>

        {/* ── Error ───────────────────────────── */}
        {errorMsg && (
          <div style={{ color: "hsl(0 65% 60%)", fontSize: "0.82rem", fontFamily: "var(--font-mono)" }}>
            {errorMsg}
          </div>
        )}

        {/* ── Quality Report ──────────────────── */}
        {quality && (
          <>
            <div className={s.separator} />
            <div className={s.section}>
              <header className={s.sectionTitle}>Mesh Quality</header>
              <div className={s.row}>
                <ReadonlyField label="Nodes" value={quality.nNodes.toLocaleString()} mono />
                <ReadonlyField label="Elements" value={quality.nElements.toLocaleString()} mono />
                <ReadonlyField label="Boundary" value={quality.nBoundaryFaces.toLocaleString()} mono />
              </div>
              <div className={s.qualityGrid}>
                <span className={s.qualityStat}>
                  Volume <code>{formatEngineering(quality.totalVolume)} m³</code>
                </span>
                <span className={s.qualityStat}>
                  Mean AR <code>{quality.meanAR.toFixed(2)}</code>
                </span>
                <span className={s.qualityStat}>
                  Min AR <code>{quality.minAR.toFixed(2)}</code>
                </span>
                <span className={s.qualityStat}>
                  Max AR <code>{quality.maxAR.toFixed(2)}</code>
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
