"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import Sparkline from "../../ui/Sparkline";
import type { ScalarRow } from "../../../lib/useSessionStream";

const SPARK_HISTORY_LIMIT = 40;

export function buildSparkSeries(
  rows: ScalarRow[],
  select: (row: ScalarRow) => number,
  currentValue?: number | null,
  transform: (value: number) => number = (value) => value,
): number[] {
  const samples = rows
    .slice(-SPARK_HISTORY_LIMIT)
    .map((row) => transform(select(row)))
    .filter((value) => Number.isFinite(value));

  if (currentValue == null || !Number.isFinite(currentValue)) return samples;
  const currentSample = transform(currentValue);
  if (!Number.isFinite(currentSample)) return samples;
  if (samples.length === 0) return [currentSample, currentSample];

  const last = samples[samples.length - 1];
  if (last !== currentSample) {
    return [...samples.slice(-(SPARK_HISTORY_LIMIT - 1)), currentSample];
  }
  return samples;
}

import { HelpTip } from "../../ui/HelpTip";

interface MetricFieldProps {
  label: string;
  value: string;
  sparkData?: number[];
  sparkColor?: string;
  tooltip?: React.ReactNode;
  valueTone?: "success";
}

export function MetricField({ label, value, sparkData, sparkColor, tooltip, valueTone }: MetricFieldProps) {
  return (
    <div className="flex flex-col gap-1.5 p-3 bg-gradient-to-b from-card/40 to-card/15 border border-border/30 rounded-lg backdrop-blur-sm transition-colors hover:border-border/50">
      <span className="flex items-center gap-2 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground/80">
        <span className="flex-1">{label}</span>
        {tooltip && <HelpTip>{tooltip}</HelpTip>}
      </span>
      <span className={cn(
        "font-mono text-xs text-foreground tracking-tight",
        valueTone === "success" ? "text-emerald-400" : undefined
      )}>
        {value}
      </span>
      {sparkData && sparkColor && (
        <div className="h-6 w-full mt-0.5 opacity-80" style={{position: "relative"}}>
          <Sparkline
            data={sparkData}
            height={20}
            color={sparkColor}
            fill={false}
            responsive
          />
        </div>
      )}
    </div>
  );
}

interface SidebarSectionProps {
  title: string;
  icon?: string;
  badge?: string | null;
  defaultOpen?: boolean;
  autoOpenKey?: string | null;
  children: ReactNode;
}

export function SidebarSection({
  title,
  icon,
  badge,
  defaultOpen = true,
  autoOpenKey,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (autoOpenKey) setOpen(true);
  }, [autoOpenKey]);

  return (
    <section className="flex flex-col mb-3 overflow-hidden rounded-xl border border-border/40 bg-gradient-to-b from-card/50 to-card/20 shadow-[0_2px_12px_rgba(0,0,0,0.15)] backdrop-blur-xl">
      <button
        type="button"
        className="flex items-center w-full px-4 py-3 text-left transition-all hover:bg-muted/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring group"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className={cn(
          "text-primary/70 transition-transform duration-200 mr-2.5 flex items-center justify-center w-4 h-4 text-[11px]",
          open && "rotate-90"
        )}>▸</span>
        {icon && (
          <span className="mr-2 text-sm opacity-70">{icon}</span>
        )}
        <span className="text-[0.75rem] font-semibold tracking-wide text-foreground/90 group-hover:text-foreground transition-colors">
          {title}
        </span>
        {badge ? (
          <span className="ml-auto text-[0.6rem] font-mono tracking-tight text-primary/80 bg-primary/8 px-2 py-0.5 rounded-md border border-primary/15">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="px-4 pb-4 pt-2 flex flex-col gap-4 border-t border-border/20">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/* ── Sub-section header for use inside panels ── */

interface SubSectionHeaderProps {
  title: string;
  icon?: string;
}

export function SubSectionHeader({ title, icon }: SubSectionHeaderProps) {
  return (
    <h4 className="flex items-center gap-2 text-[0.65rem] font-bold uppercase tracking-widest text-primary/80 pb-2 mb-1 border-b border-border/30">
      {icon ? (
        <span className="text-xs opacity-70">{icon}</span>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-primary/60 inline-block" />
      )}
      {title}
    </h4>
  );
}

/* ── Info row for key-value pairs in inspector panels ── */

interface InfoRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

export function InfoRow({ label, value, mono = true }: InfoRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5 gap-3">
      <span className="text-[0.62rem] font-semibold uppercase tracking-widest text-muted-foreground/80">
        {label}
      </span>
      <span className={cn(
        "text-xs text-muted-foreground truncate text-right",
        mono && "font-mono tracking-tight"
      )}>
        {value}
      </span>
    </div>
  );
}
