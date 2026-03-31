"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
  generating?: boolean;
  onGenerate?: () => void;
  nodeCount?: number;
  waitMode?: boolean;
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

/* ── Component ─────────────────────────────────────────────────────── */

export default function MeshSettingsPanel({
  options,
  onChange,
  quality,
  disabled = false,
  generating = false,
  onGenerate,
  nodeCount,
  waitMode,
}: MeshSettingsPanelProps) {
  const sicnCanvasRef = useRef<HTMLCanvasElement>(null);
  const gammaCanvasRef = useRef<HTMLCanvasElement>(null);

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
    <div className="flex flex-col gap-2 p-3">
      {/* ── Algorithm Selection ── */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/40 bg-card/20 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/20 pb-2 mb-1">
          <span className="text-xs font-bold uppercase tracking-widest text-foreground">Algorithm</span>
          <span className="text-[0.65rem] font-mono text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">Gmsh</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">2D surface</span>
            <div className="flex-1 max-w-[140px]">
              <Select
                value={String(options.algorithm2d)}
                onValueChange={(val) => set({ algorithm2d: Number(val) })}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 w-full border-border/50 bg-card text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALGO_2D_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">3D volume</span>
            <div className="flex-1 max-w-[140px]">
              <Select
                value={String(options.algorithm3d)}
                onValueChange={(val) => set({ algorithm3d: Number(val) })}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 w-full border-border/50 bg-card text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALGO_3D_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* ── Size Control ── */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/40 bg-card/20 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/20 pb-2 mb-1">
          <span className="text-xs font-bold uppercase tracking-widest text-foreground">Element Size</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              hmax
              <span className="text-[0.55rem] text-muted-foreground/40">(primary)</span>
            </span>
            <div className="flex-1 max-w-[140px]">
              <Input
                className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                type="text"
                placeholder="auto"
                value={options.hmax}
                onChange={(e) => set({ hmax: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">hmin</span>
            <div className="flex-1 max-w-[140px]">
              <Input
                className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                type="text"
                placeholder="auto"
                value={options.hmin}
                onChange={(e) => set({ hmin: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">Size factor</span>
            <div className="flex-1 max-w-[140px]">
              <Input
                className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={options.sizeFactor}
                onChange={(e) => set({ sizeFactor: Number(e.target.value) || 1 })}
                disabled={disabled}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">From curvature</span>
            <div className="flex-1 max-w-[140px]">
              <Input
                className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                type="number"
                step="1"
                min="0"
                max="100"
                value={options.sizeFromCurvature}
                onChange={(e) => set({ sizeFromCurvature: Number(e.target.value) || 0 })}
                disabled={disabled}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              Growth rate
              <span className="text-[0.55rem] text-muted-foreground/40">(SmoothRatio)</span>
            </span>
            <div className="flex-1 max-w-[140px]">
              <Input
                className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                type="text"
                placeholder="1.8"
                value={options.growthRate}
                onChange={(e) => set({ growthRate: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              Narrow regions
              <span className="text-[0.55rem] text-muted-foreground/40">(0 = off)</span>
            </span>
            <div className="flex-1 max-w-[140px]">
              <Input
                className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                type="number"
                step="1"
                min="0"
                max="10"
                value={options.narrowRegions}
                onChange={(e) => set({ narrowRegions: Number(e.target.value) || 0 })}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Optimization ── */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/40 bg-card/20 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/20 pb-2 mb-1">
          <span className="text-xs font-bold uppercase tracking-widest text-foreground">Optimization</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">Method</span>
            <div className="flex-1 max-w-[140px]">
              <Select
                value={options.optimize || "none"}
                onValueChange={(val) => set({ optimize: val === "none" ? "" : val })}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 w-full border-border/50 bg-card text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPTIMIZE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {options.optimize !== "" && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">Iterations</span>
              <div className="flex-1 max-w-[140px]">
                <Input
                  className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                  type="number"
                  step="1"
                  min="1"
                  max="20"
                  value={options.optimizeIters}
                  onChange={(e) => set({ optimizeIters: Number(e.target.value) || 1 })}
                  disabled={disabled}
                />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">Smoothing</span>
            <div className="flex-1 max-w-[140px]">
              <Input
                className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                type="number"
                step="1"
                min="0"
                max="100"
                value={options.smoothingSteps}
                onChange={(e) => set({ smoothingSteps: Number(e.target.value) || 0 })}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Quality ── */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/40 bg-card/20 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/20 pb-2 mb-1">
          <span className="text-xs font-bold uppercase tracking-widest text-foreground">Quality Analysis</span>
          {qualityRating && (
            <span className={cn("text-[0.65rem] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded text-white", qualityRating.cls === "good" ? "bg-emerald-600" : qualityRating.cls === "fair" ? "bg-amber-600" : "bg-destructive")}>
              {qualityRating.label}
            </span>
          )}
        </div>
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
              <div className="grid grid-cols-2 gap-2 mt-2 p-2 bg-black/10 rounded-md border border-border/20">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">Elements</span>
                  <span className="font-mono text-xs text-foreground">{quality.nElements.toLocaleString()}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">SICN min</span>
                  <span className="font-mono text-xs text-foreground">{quality.sicnMin.toFixed(3)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">SICN mean</span>
                  <span className="font-mono text-xs text-foreground">{quality.sicnMean.toFixed(3)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">SICN p5</span>
                  <span className="font-mono text-xs text-foreground">{quality.sicnP5.toFixed(3)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">γ min</span>
                  <span className="font-mono text-xs text-foreground">{quality.gammaMin.toFixed(3)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">γ mean</span>
                  <span className="font-mono text-xs text-foreground">{quality.gammaMean.toFixed(3)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">Avg ICN</span>
                  <span className="font-mono text-xs text-foreground">{quality.avgQuality.toFixed(3)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">Vol σ/μ</span>
                  <span className="font-mono text-xs text-foreground">
                    {quality.volumeMean > 0
                      ? (quality.volumeStd / quality.volumeMean).toFixed(2)
                      : "—"
                    }
                  </span>
                </div>
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
      </div>
      {/* ── Solver Compatibility ── */}
      {nodeCount != null && nodeCount > 0 && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/40 bg-card/20 shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border/20 pb-2 mb-1">
            <span className="text-xs font-bold uppercase tracking-widest text-foreground">Solver Compatibility</span>
          </div>
          <div className="grid grid-cols-[92px_1fr] gap-2 items-center">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Nodes</span>
            <span className="font-mono text-xs text-foreground">{nodeCount.toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-[92px_1fr] gap-2 items-center">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Est. RAM</span>
            <span className={cn("font-mono text-xs",
              nodeCount > 50000 ? "text-destructive font-bold" :
              nodeCount > 10000 ? "text-amber-500" : "text-emerald-500")}>
              {((nodeCount * nodeCount * 24) / 1e9).toFixed(1)} GB
              {nodeCount > 50000 && " ⛔ too large"}
              {nodeCount > 10000 && nodeCount <= 50000 && " ⚠️ large"}
            </span>
          </div>
          {nodeCount > 10000 && (
            <div className={cn("mt-1 p-2 rounded-md text-xs",
              nodeCount > 50000
                ? "bg-destructive/10 border border-destructive/30 text-destructive"
                : "bg-amber-500/10 border border-amber-500/30 text-amber-500")}>
              {nodeCount > 50000
                ? "Mesh too large for CPU dense solver. Increase hmax to reduce node count."
                : "Large mesh — may be slow. Target <10,000 nodes for CPU reference solver."}
            </div>
          )}
        </div>
      )}
      {/* ── Adaptive Mesh (AFEM) ── */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/40 bg-card/20 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/20 pb-2 mb-1">
          <span className="text-xs font-bold uppercase tracking-widest text-foreground flex items-center gap-1.5 justify-between w-full">
            <span>Adaptive Mesh (AFEM)</span>
            <Switch
              className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted/80 h-[18px] w-8"
              checked={options.adaptiveEnabled}
              onCheckedChange={(checked) => set({ adaptiveEnabled: checked })}
              disabled={disabled}
            />
          </span>
        </div>
        {options.adaptiveEnabled && (
          <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">Policy</span>
              <div className="flex-1 max-w-[140px]">
                <Select
                  value={options.adaptivePolicy}
                  onValueChange={(val) => set({ adaptivePolicy: val })}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-7 w-full border-border/50 bg-card text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual (remesh now)</SelectItem>
                    <SelectItem value="auto">Auto (solve loop)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground ml-1">Theta (θ)</span>
                <Input
                  className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
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
                <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground ml-1">Min. Edge (m)</span>
                <Input
                  className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                  placeholder="e.g. 5e-9"
                  value={options.adaptiveHMin}
                  onChange={(e) => set({ adaptiveHMin: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground ml-1">Max. Edge (m)</span>
                <Input
                  className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                  placeholder="e.g. 30e-9"
                  value={options.adaptiveHMax}
                  onChange={(e) => set({ adaptiveHMax: e.target.value })}
                  disabled={disabled}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1 mt-1">
              <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground ml-1">Error Tolerance</span>
              <Input
                className="h-7 w-full border-border/50 bg-card px-2 py-1 text-xs font-mono text-right placeholder:text-muted-foreground/30 disabled:opacity-50 focus-visible:ring-1"
                placeholder="e.g. 1e-3"
                value={options.adaptiveErrorTolerance}
                onChange={(e) => set({ adaptiveErrorTolerance: e.target.value })}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Refinement Zones (lasso) ── */}
      {options.refinementZones.length > 0 && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/40 bg-card/20 shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border/20 pb-2 mb-1">
            <span className="text-xs font-bold uppercase tracking-widest text-foreground">
              Refinement Zones
              <span className="ml-1.5 text-[0.6rem] font-mono text-muted-foreground">({options.refinementZones.length})</span>
            </span>
            <button
              className="text-[0.65rem] font-semibold uppercase tracking-widest text-destructive/80 hover:text-destructive px-1.5 py-0.5 rounded hover:bg-destructive/10 transition-colors"
              onClick={() => set({ refinementZones: [] })}
              disabled={disabled}
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {options.refinementZones.map((zone, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/20 border border-border/20">
                <span className="text-[0.65rem] font-mono text-muted-foreground">
                  {zone.kind} #{i + 1} — VIn={typeof zone.params.VIn === "number" ? zone.params.VIn.toExponential(1) : "?"}
                </span>
                <button
                  className="text-[0.6rem] text-destructive/60 hover:text-destructive"
                  onClick={() => set({ refinementZones: options.refinementZones.filter((_, j) => j !== i) })}
                  disabled={disabled}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Generate button ── */}
      {onGenerate && (
        <div className="flex flex-col gap-3 p-3 rounded-lg border border-border/40 bg-card/20 shadow-sm transition-all duration-300">
          <Button
            className="w-full h-8 text-sm font-semibold transition-all duration-300 relative overflow-hidden"
            variant="default"
            onClick={onGenerate}
            disabled={disabled || generating}
          >
            {generating ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary-foreground/70" />
                Generating Mesh...
              </span>
            ) : (
              "⚡ Generate Mesh"
            )}
          </Button>

          {generating && (
            <div className="flex flex-col gap-2 pt-1 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-between px-1">
                <span className="text-[0.65rem] font-bold uppercase tracking-widest text-emerald-500 flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                  TX: REMESH
                </span>
                <span className="text-[0.65rem] font-bold uppercase tracking-widest text-amber-500 flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping delay-150 absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                  </span>
                  RX: AWAITING
                </span>
              </div>
              
              <div className="relative h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
                <div className="absolute inset-y-0 w-1/3 bg-primary rounded-full animate-pulse opacity-80" />
                <div className="absolute inset-y-0 w-2/3 right-0 bg-primary/30 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
              </div>
              
              <div className="flex items-center justify-between px-1 mt-0.5 opacity-60">
                <span className="text-[0.6rem] font-mono text-muted-foreground uppercase tracking-wider">Backend computing</span>
                <span className="text-[0.6rem] font-mono text-muted-foreground uppercase tracking-wider tabular-nums flex items-center gap-1">
                  <ArrowRightLeft className="w-2.5 h-2.5" /> active
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
