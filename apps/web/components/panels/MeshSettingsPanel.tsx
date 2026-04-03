"use client";

import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Button } from "../ui/button";
import { Loader2, ArrowRightLeft } from "lucide-react";

/* ── Size field spec for lasso refinement zones ────────────────────── */

export interface SizeFieldSpec {
  kind: string;
  params: Record<string, number | number[] | string>;
}

/* ── Types ─────────────────────────────────────────────────────────── */

export interface MeshOptionsState {
  algorithm2d: number;
  algorithm3d: number;
  hmax: string;          // string for controlled input (SI metres) — primary size control
  hmin: string;          // string for controlled input (SI metres)
  sizeFactor: number;
  sizeFromCurvature: number;
  growthRate: string;    // "" = Gmsh default (1.8), otherwise float [1.1–3.0]
  narrowRegions: number; // 0 = off, 1+ = min elements across narrow gap
  smoothingSteps: number;
  optimize: string;      // "" = none, "Netgen", "HighOrder", "Laplace2D", etc.
  optimizeIters: number;
  computeQuality: boolean;
  perElementQuality: boolean;
  refinementZones: SizeFieldSpec[]; // lasso refinement zones

  // Adaptive Mesh (AFEM)
  adaptiveEnabled: boolean;
  adaptivePolicy: string;
  adaptiveTheta: number;
  adaptiveHMin: string;
  adaptiveHMax: string;
  adaptiveMaxPasses: number;
  adaptiveErrorTolerance: string;
}

export interface MeshQualityData {
  nElements: number;
  sicnMin: number;
  sicnMax: number;
  sicnMean: number;
  sicnP5: number;
  sicnHistogram: number[];
  gammaMin: number;
  gammaMean: number;
  gammaHistogram: number[];
  volumeMin: number;
  volumeMax: number;
  volumeMean: number;
  volumeStd: number;
  avgQuality: number;
}

interface MeshSettingsPanelProps {
  options: MeshOptionsState;
  onChange: (next: MeshOptionsState) => void;
  quality?: MeshQualityData | null;
  disabled?: boolean;
  /** Disables only the generate/build button, independently of `disabled`. */
  generateDisabled?: boolean;
  generating?: boolean;
  onGenerate?: () => void;
  generateLabel?: string;
  generatingLabel?: string;
  nodeCount?: number;
  waitMode?: boolean;
  showAdaptiveSection?: boolean;
}

/* ── Algorithm options ─────────────────────────────────────────────── */

const ALGO_2D_OPTIONS = [
  { value: "1", label: "MeshAdapt" },
  { value: "2", label: "Automatic" },
  { value: "5", label: "Delaunay" },
  { value: "6", label: "Frontal-Delaunay" },
  { value: "7", label: "BAMG" },
  { value: "8", label: "Frontal (Quads)" },
];

const ALGO_3D_OPTIONS = [
  { value: "1", label: "Delaunay" },
  { value: "4", label: "Frontal" },
  { value: "7", label: "MMG3D" },
  { value: "10", label: "HXT" },
];

const OPTIMIZE_OPTIONS = [
  { value: "none",            label: "None" },
  { value: "Netgen",      label: "Netgen" },
  { value: "HighOrder",   label: "High Order" },
  { value: "Laplace2D",   label: "Laplace 2D" },
  { value: "Relocate2D",  label: "Relocate 2D" },
  { value: "Relocate3D",  label: "Relocate 3D" },
];

/* ── Defaults ──────────────────────────────────────────────────────── */

export const DEFAULT_MESH_OPTIONS: MeshOptionsState = {
  algorithm2d: 6,
  algorithm3d: 1,
  hmax: "",
  hmin: "",
  sizeFactor: 1.0,
  sizeFromCurvature: 0,
  growthRate: "",
  narrowRegions: 0,
  smoothingSteps: 1,
  optimize: "",
  optimizeIters: 1,
  computeQuality: false,
  perElementQuality: false,
  refinementZones: [],
  adaptiveEnabled: false,
  adaptivePolicy: "auto",
  adaptiveTheta: 0.3,
  adaptiveHMin: "",
  adaptiveHMax: "",
  adaptiveMaxPasses: 2,
  adaptiveErrorTolerance: "1e-3",
};

/* ── SICN color ────────────────────────────────────────────────────── */

function sicnColor(value: number): string {
  // Maps [-1, 1] → red → yellow → green
  const t = Math.max(0, Math.min(1, (value + 1) / 2));
  if (t < 0.5) {
    const f = t * 2;
    const r = Math.round(207 + (253 - 207) * f);
    const g = Math.round(98 + (231 - 98) * f);
    const b = Math.round(86 + (37 - 86) * f);
    return `rgb(${r},${g},${b})`;
  }
  const f = (t - 0.5) * 2;
  const r = Math.round(253 + (53 - 253) * f);
  const g = Math.round(231 + (183 - 231) * f);
  const b = Math.round(37 + (121 - 37) * f);
  return `rgb(${r},${g},${b})`;
}

function gammaColor(value: number): string {
  // Maps [0, 1] → red → yellow → green
  const t = Math.max(0, Math.min(1, value));
  if (t < 0.5) {
    const f = t * 2;
    return `rgb(${Math.round(207 + 46 * f)},${Math.round(98 + 133 * f)},${Math.round(86 - 49 * f)})`;
  }
  const f = (t - 0.5) * 2;
  return `rgb(${Math.round(253 - 200 * f)},${Math.round(231 - 48 * f)},${Math.round(37 + 84 * f)})`;
}

/* ── Histogram renderer ────────────────────────────────────────────── */

function drawHistogram(
  canvas: HTMLCanvasElement,
  bins: number[],
  rangeMin: number,
  rangeMax: number,
  colorFn: (v: number) => string,
  xLabel: string,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const nBins = bins.length;
  const maxBin = Math.max(...bins, 1);

  const pad = { top: 6, right: 8, bottom: 22, left: 32 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const barW = Math.max(2, plotW / nBins - 1);

  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = "hsla(220, 15%, 28%, 0.3)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + plotH * (1 - i / 3);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  // Bars
  const binWidth = (rangeMax - rangeMin) / nBins;
  for (let i = 0; i < nBins; i++) {
    const v = bins[i];
    if (v === 0) continue;
    const barH = (v / maxBin) * plotH;
    const x = pad.left + i * (plotW / nBins) + 0.5;
    const y = pad.top + plotH - barH;
    const value = rangeMin + (i + 0.5) * binWidth;
    ctx.fillStyle = colorFn(value);
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [2, 2, 0, 0]);
    ctx.fill();
  }

  // Y-axis
  ctx.fillStyle = "hsla(220, 20%, 60%, 0.6)";
  ctx.font = "9px var(--font-mono, monospace)";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 3; i++) {
    const val = Math.round((maxBin / 3) * i);
    const y = pad.top + plotH * (1 - i / 3);
    ctx.fillText(String(val), pad.left - 4, y);
  }

  // X-axis
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const step = Math.max(1, Math.floor(nBins / 5));
  for (let i = 0; i < nBins; i += step) {
    const val = (rangeMin + (i + 0.5) * binWidth).toFixed(1);
    const x = pad.left + (i + 0.5) * (plotW / nBins);
    ctx.fillText(val, x, pad.top + plotH + 4);
  }

  // Label
  ctx.fillStyle = "hsla(220, 20%, 55%, 0.5)";
  ctx.font = "8px var(--font-mono, monospace)";
  ctx.textAlign = "center";
  ctx.fillText(xLabel, pad.left + plotW / 2, h - 2);
}

function Section({
  title,
  eyebrow,
  meta,
  children,
}: {
  title: string;
  eyebrow?: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/30 bg-background/35 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="mb-3 flex items-start justify-between gap-3 border-b border-border/20 pb-2.5">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[0.62rem] font-semibold tracking-[0.12em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h3 className="text-[0.86rem] font-semibold text-foreground">{title}</h3>
        </div>
        {meta ? <div className="shrink-0">{meta}</div> : null}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_140px] items-center gap-3 rounded-xl border border-border/18 bg-background/25 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[0.73rem] font-medium text-foreground">{label}</div>
        {hint ? <div className="mt-0.5 text-[0.64rem] text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="min-w-0">{control}</div>
    </div>
  );
}

function StatTile({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/18 bg-background/25 px-3 py-2">
      <div className="text-[0.62rem] font-semibold tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-[0.76rem] text-foreground">{value}</div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function MeshSettingsPanel({
  options,
  onChange,
  quality,
  disabled = false,
  generateDisabled,
  generating = false,
  onGenerate,
  generateLabel = "Build Mesh",
  generatingLabel = "Building Mesh...",
  nodeCount,
  waitMode,
  showAdaptiveSection = true,
}: MeshSettingsPanelProps) {
  const sicnCanvasRef = useRef<HTMLCanvasElement>(null);
  const gammaCanvasRef = useRef<HTMLCanvasElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = useCallback(
    (patch: Partial<MeshOptionsState>) => onChange({ ...options, ...patch }),
    [options, onChange],
  );

  // Rating based on SICN p5
  const qualityRating = useMemo(() => {
    if (!quality) return null;
    if (quality.sicnP5 >= 0.5) return { label: "Excellent", cls: "good" };
    if (quality.sicnP5 >= 0.3) return { label: "Good", cls: "good" };
    if (quality.sicnP5 >= 0.1) return { label: "Fair", cls: "fair" };
    return { label: "Poor", cls: "poor" };
  }, [quality]);

  // Draw SICN histogram
  useEffect(() => {
    if (!sicnCanvasRef.current || !quality?.sicnHistogram) return;
    drawHistogram(
      sicnCanvasRef.current,
      quality.sicnHistogram,
      -1, 1,
      sicnColor,
      "SICN (Signed Inverse Condition Number)",
    );
  }, [quality?.sicnHistogram]);

  // Draw gamma histogram
  useEffect(() => {
    if (!gammaCanvasRef.current || !quality?.gammaHistogram) return;
    drawHistogram(
      gammaCanvasRef.current,
      quality.gammaHistogram,
      0, 1,
      gammaColor,
      "γ (inscribed/circumscribed ratio)",
    );
  }, [quality?.gammaHistogram]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* ── Basic / Advanced Toggle ── */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/25 bg-background/25 px-3 py-2.5">
        <div>
          <div className="text-[0.62rem] font-semibold tracking-[0.12em] text-muted-foreground">
            Mesh settings
          </div>
          <div className="text-[0.78rem] font-medium text-foreground">
            Adjust inputs first, then rebuild to update the realized mesh.
          </div>
        </div>
        <button
          type="button"
          className="rounded-lg border border-border/25 px-2.5 py-1.5 text-[0.68rem] font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Basic view" : "Advanced view"}
        </button>
      </div>

      {/* ── Algorithm Selection ── */}
      {showAdvanced && (
        <Section
          title="Mesher"
          eyebrow="Advanced"
          meta={<span className="rounded-md bg-muted/40 px-2 py-1 text-[0.62rem] font-mono text-muted-foreground">Gmsh</span>}
        >
          <FieldRow
            label="Surface algorithm"
            hint="Controls STL/classified surface triangulation."
            control={(
              <Select
                value={String(options.algorithm2d)}
                onValueChange={(val) => set({ algorithm2d: Number(val) })}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 w-full border-border/35 bg-background/70 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALGO_2D_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldRow
            label="Volume algorithm"
            hint="Controls tetrahedral filling of the final shared domain."
            control={(
              <Select
                value={String(options.algorithm3d)}
                onValueChange={(val) => set({ algorithm3d: Number(val) })}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 w-full border-border/35 bg-background/70 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALGO_3D_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Section>
      )}

      {/* ── Size Control ── */}
      <Section
        title="Element size"
        eyebrow="Basic"
        meta={<span className="text-[0.62rem] font-mono text-muted-foreground">SI metres</span>}
      >
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/8 px-3 py-2 text-[0.68rem] leading-5 text-sky-100/90">
          These values shape the next rebuild. The viewport keeps showing the last built mesh until the remesh finishes.
        </div>
        <FieldRow
          label="Maximum element size"
          hint="Upper bound for the local target size."
          control={(
            <Input
              className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
              type="text"
              placeholder="auto"
              value={options.hmax}
              onChange={(e) => set({ hmax: e.target.value })}
              disabled={disabled}
            />
          )}
        />
        <FieldRow
          label="Minimum element size"
          hint="Lower bound used when local refinement gets very fine."
          control={(
            <Input
              className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
              type="text"
              placeholder="auto"
              value={options.hmin}
              onChange={(e) => set({ hmin: e.target.value })}
              disabled={disabled}
            />
          )}
        />
        <FieldRow
          label="Curvature factor"
          hint="Refines curved regions when geometry detail requires it."
          control={(
            <Input
              className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
              type="number"
              step="1"
              min="0"
              max="100"
              value={options.sizeFromCurvature}
              onChange={(e) => set({ sizeFromCurvature: Number(e.target.value) || 0 })}
              disabled={disabled}
            />
          )}
        />
        <FieldRow
          label="Maximum growth rate"
          hint="Limits how quickly elements can grow away from refined zones."
          control={(
            <Input
              className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
              type="text"
              placeholder="1.8"
              value={options.growthRate}
              onChange={(e) => set({ growthRate: e.target.value })}
              disabled={disabled}
            />
          )}
        />
        <FieldRow
          label="Narrow region resolution"
          hint="Minimum target density in tight gaps and channels."
          control={(
            <Input
              className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
              type="number"
              step="1"
              min="0"
              max="10"
              value={options.narrowRegions}
              onChange={(e) => set({ narrowRegions: Number(e.target.value) || 0 })}
              disabled={disabled}
            />
          )}
        />
        {showAdvanced ? (
          <FieldRow
            label="Global size factor"
            hint="Applies a global multiplier on top of local sizing rules."
            control={(
              <Input
                className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={options.sizeFactor}
                onChange={(e) => set({ sizeFactor: Number(e.target.value) || 1 })}
                disabled={disabled}
              />
            )}
          />
        ) : null}
      </Section>

      {/* ── Optimization ── */}
      {showAdvanced && (
        <Section title="Optimization" eyebrow="Advanced">
          <FieldRow
            label="Method"
            hint="Optional quality pass after tetrahedral generation."
            control={(
              <Select
                value={options.optimize || "none"}
                onValueChange={(val) => set({ optimize: val === "none" ? "" : val })}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 w-full border-border/35 bg-background/70 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPTIMIZE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {options.optimize !== "" ? (
            <FieldRow
              label="Iterations"
              hint="Number of passes for the selected optimizer."
              control={(
                <Input
                  className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
                  type="number"
                  step="1"
                  min="1"
                  max="20"
                  value={options.optimizeIters}
                  onChange={(e) => set({ optimizeIters: Number(e.target.value) || 1 })}
                  disabled={disabled}
                />
              )}
            />
          ) : null}
          <FieldRow
            label="Smoothing steps"
            hint="Post-process smoothing for noisy tetrahedra."
            control={(
              <Input
                className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
                type="number"
                step="1"
                min="0"
                max="100"
                value={options.smoothingSteps}
                onChange={(e) => set({ smoothingSteps: Number(e.target.value) || 0 })}
                disabled={disabled}
              />
            )}
          />
        </Section>
      )}

      {/* ── Quality ── */}
      <Section
        title="Quality analysis"
        eyebrow="Diagnostics"
        meta={qualityRating ? (
          <span className={cn("rounded-md px-2 py-1 text-[0.62rem] font-semibold text-white", qualityRating.cls === "good" ? "bg-emerald-600" : qualityRating.cls === "fair" ? "bg-amber-600" : "bg-destructive")}>
            {qualityRating.label}
          </span>
        ) : undefined}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-medium text-foreground">Extract quality metrics</span>
            <Switch
              className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted/80 h-[18px] w-8"
              checked={options.computeQuality}
              onCheckedChange={(checked) => set({ computeQuality: checked })}
              disabled={disabled}
            />
          </div>
          {options.computeQuality && (
            <div className="flex items-center justify-between py-1">
              <span className="text-xs font-medium text-foreground">Per-element data</span>
              <Switch
                className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted/80 h-[18px] w-8"
                checked={options.perElementQuality}
                onCheckedChange={(checked) => set({ perElementQuality: checked })}
                disabled={disabled}
              />
            </div>
          )}

          {quality && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Elements" value={quality.nElements.toLocaleString()} />
                <StatTile label="SICN min" value={quality.sicnMin.toFixed(3)} />
                <StatTile label="SICN mean" value={quality.sicnMean.toFixed(3)} />
                <StatTile label="SICN p5" value={quality.sicnP5.toFixed(3)} />
                <StatTile label="γ min" value={quality.gammaMin.toFixed(3)} />
                <StatTile label="γ mean" value={quality.gammaMean.toFixed(3)} />
                <StatTile label="Average ICN" value={quality.avgQuality.toFixed(3)} />
                <StatTile
                  label="Volume σ/μ"
                  value={quality.volumeMean > 0 ? (quality.volumeStd / quality.volumeMean).toFixed(2) : "—"}
                />
              </div>

              {/* SICN Histogram */}
              <canvas ref={sicnCanvasRef} className="w-full h-16 mt-3 bg-card/30 rounded border border-border/30" />
              <div className="flex items-center justify-center gap-3 mt-1.5 text-[0.6rem] text-muted-foreground">
                <span><span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-destructive" />SICN &lt; 0 (inverted)</span>
                <span><span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-amber-500" />0–0.5 (fair)</span>
                <span><span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-emerald-500" />&gt; 0.5 (good)</span>
              </div>

              {/* Gamma Histogram */}
              <canvas ref={gammaCanvasRef} className="w-full h-16 mt-3 bg-card/30 rounded border border-border/30" />
              <div className="flex items-center justify-center gap-3 mt-1.5 text-[0.6rem] text-muted-foreground">
                <span><span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-destructive" />γ &lt; 0.3 (poor)</span>
                <span><span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-amber-500" />0.3–0.6 (fair)</span>
                <span><span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-emerald-500" />&gt; 0.6 (good)</span>
              </div>
            </>
          )}
        </div>
      </Section>
      {/* ── Solver Compatibility ── */}
      {nodeCount != null && nodeCount > 0 && (
        <Section title="Solver compatibility" eyebrow="Diagnostics">
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Nodes" value={nodeCount.toLocaleString()} />
            <StatTile
              label="Estimated RAM"
              value={(
                <span
                  className={cn(
                    nodeCount > 50000 ? "text-destructive font-semibold" :
                    nodeCount > 10000 ? "text-amber-400" : "text-emerald-400",
                  )}
                >
                  {((nodeCount * nodeCount * 24) / 1e9).toFixed(1)} GB
                </span>
              )}
            />
          </div>
          {nodeCount > 10000 && (
            <div className={cn("rounded-xl p-2 text-xs",
              nodeCount > 50000
                ? "bg-destructive/10 border border-destructive/30 text-destructive"
                : "bg-amber-500/10 border border-amber-500/30 text-amber-500")}>
              {nodeCount > 50000
                ? "Mesh too large for CPU dense solver. Increase hmax to reduce node count."
                : "Large mesh — may be slow. Target <10,000 nodes for CPU reference solver."}
            </div>
          )}
        </Section>
      )}
      {/* ── Adaptive Mesh (AFEM) ── */}
      {showAdvanced && showAdaptiveSection && (
      <Section
        title="Adaptive mesh"
        eyebrow="Advanced"
        meta={(
          <Switch
            className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted/80 h-[18px] w-8"
            checked={options.adaptiveEnabled}
            onCheckedChange={(checked) => set({ adaptiveEnabled: checked })}
            disabled={disabled}
          />
        )}
      >
        {options.adaptiveEnabled && (
          <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <FieldRow
              label="Policy"
              hint="Use manual remeshes or let adaptive refinement run in the solve loop."
              control={(
                <Select
                  value={options.adaptivePolicy}
                  onValueChange={(val) => set({ adaptivePolicy: val })}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-8 w-full border-border/35 bg-background/70 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual (remesh now)</SelectItem>
                    <SelectItem value="auto">Auto (solve loop)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="ml-1 text-[0.65rem] font-medium text-muted-foreground">Theta (θ)</span>
                <Input
                  className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
                  type="number" step="0.05" min="0.01" max="1"
                  value={options.adaptiveTheta}
                  onChange={(e) => set({ adaptiveTheta: Number(e.target.value) || 0.3 })}
                  disabled={disabled}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground ml-1">Max Passes</span>
                <Input
                  className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                  type="number" step="1" min="1" max="20"
                  value={options.adaptiveMaxPasses}
                  onChange={(e) => set({ adaptiveMaxPasses: Number(e.target.value) || 2 })}
                  disabled={disabled}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="ml-1 text-[0.65rem] font-medium text-muted-foreground">Min. edge (m)</span>
                <Input
                  className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
                  placeholder="e.g. 5e-9"
                  value={options.adaptiveHMin}
                  onChange={(e) => set({ adaptiveHMin: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="ml-1 text-[0.65rem] font-medium text-muted-foreground">Max. edge (m)</span>
                <Input
                  className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
                  placeholder="e.g. 30e-9"
                  value={options.adaptiveHMax}
                  onChange={(e) => set({ adaptiveHMax: e.target.value })}
                  disabled={disabled}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1 mt-1">
              <span className="ml-1 text-[0.65rem] font-medium text-muted-foreground">Error tolerance</span>
              <Input
                className="h-8 w-full border-border/35 bg-background/70 px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50"
                placeholder="e.g. 1e-3"
                value={options.adaptiveErrorTolerance}
                onChange={(e) => set({ adaptiveErrorTolerance: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </Section>
      )}

      {/* ── Refinement Zones (lasso) ── */}
      {showAdvanced && options.refinementZones.length > 0 && (
        <Section
          title="Refinement zones"
          eyebrow="Advanced"
          meta={(
            <button
              className="rounded-md px-2 py-1 text-[0.65rem] font-semibold text-destructive/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
              onClick={() => set({ refinementZones: [] })}
              disabled={disabled}
            >
              Clear all
            </button>
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">
              Refinement Zones
              <span className="ml-1.5 text-[0.68rem] font-mono text-muted-foreground">({options.refinementZones.length})</span>
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {options.refinementZones.map((zone, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-border/18 bg-background/25 px-3 py-2">
                <span className="text-[0.68rem] font-mono text-muted-foreground">
                  {zone.kind} #{i + 1} — VIn={typeof zone.params.VIn === "number" ? zone.params.VIn.toExponential(1) : "?"}
                </span>
                <button
                  className="text-[0.65rem] text-destructive/60 hover:text-destructive"
                  onClick={() => set({ refinementZones: options.refinementZones.filter((_, j) => j !== i) })}
                  disabled={disabled}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Generate button ── */}
      {onGenerate && (
        <Section title="Build" eyebrow="Action">
          <Button
            className="h-9 w-full text-sm font-semibold transition-all duration-300"
            variant="default"
            onClick={onGenerate}
            disabled={(generateDisabled ?? disabled) || generating}
          >
            {generating ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary-foreground/70" />
                {generatingLabel}
              </span>
            ) : (
              generateLabel
            )}
          </Button>

          {generating && (
            <div className="flex flex-col gap-2 pt-1 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 text-[0.65rem] font-semibold text-emerald-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                  Remesh request sent
                </span>
                <span className="flex items-center gap-1.5 text-[0.65rem] font-semibold text-amber-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping delay-150 absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                  </span>
                  Waiting for backend
                </span>
              </div>
              
              <div className="relative h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
                <div className="absolute inset-y-0 w-1/3 bg-primary rounded-full animate-pulse opacity-80" />
                <div className="absolute inset-y-0 w-2/3 right-0 bg-primary/30 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
              </div>
              
              <div className="flex items-center justify-between px-1 mt-0.5 opacity-60">
                <span className="text-[0.62rem] font-mono text-muted-foreground">Backend computing</span>
                <span className="flex items-center gap-1 text-[0.62rem] font-mono tabular-nums text-muted-foreground">
                  <ArrowRightLeft className="w-2.5 h-2.5" /> active
                </span>
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
