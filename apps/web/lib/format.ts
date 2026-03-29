/**
 * Shared number formatting utilities for the Fullmag control room.
 *
 * Single source of truth — all components should import from here.
 */

export function fmtSI(v: number, unit: string): string {
  if (!Number.isFinite(v) || v === 0) return `0 ${unit}`;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toPrecision(3)} T${unit}`;
  if (abs >= 1e9) return `${(v / 1e9).toPrecision(3)} G${unit}`;
  if (abs >= 1e6) return `${(v / 1e6).toPrecision(3)} M${unit}`;
  if (abs >= 1e3) return `${(v / 1e3).toPrecision(3)} k${unit}`;
  if (abs >= 1) return `${v.toPrecision(3)} ${unit}`;
  if (abs >= 1e-3) return `${(v * 1e3).toPrecision(3)} m${unit}`;
  if (abs >= 1e-6) return `${(v * 1e6).toPrecision(3)} µ${unit}`;
  if (abs >= 1e-9) return `${(v * 1e9).toPrecision(3)} n${unit}`;
  if (abs >= 1e-12) return `${(v * 1e12).toPrecision(3)} p${unit}`;
  return `${v.toExponential(2)} ${unit}`;
}

export function fmtExp(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  return v.toExponential(3);
}

export function fmtTime(t: number): string {
  return fmtSI(t, "s");
}

export function fmtStepValue(v: number, enabled: boolean): string {
  return enabled ? v.toLocaleString() : "—";
}

export function fmtSIOrDash(v: number, unit: string, enabled: boolean): string {
  return enabled ? fmtSI(v, unit) : "—";
}

export function fmtExpOrDash(v: number, enabled: boolean): string {
  return enabled ? fmtExp(v) : "—";
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)} min`;
  return `${(ms / 3600000).toFixed(2)} h`;
}

export function fmtPreviewMaxPoints(value: number): string {
  if (value <= 0) return "Full";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  return value.toLocaleString();
}

export function fmtPreviewEveryN(n: number): string {
  return n <= 1 ? "Every step" : `Every ${n} steps`;
}
