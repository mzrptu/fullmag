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
    <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
      <span className="flex items-center gap-2 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
        <span className="flex-1">{label}</span>
        {tooltip && <HelpTip>{tooltip}</HelpTip>}
      </span>
      <span className={cn("font-mono text-xs text-foreground", valueTone === "success" ? "text-emerald-400" : undefined)}>
        {value}
      </span>
      {sparkData && sparkColor && (
        <div className="h-6 w-full mt-1 opacity-80" style={{position: "relative"}}>
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
  badge?: string | null;
  defaultOpen?: boolean;
  autoOpenKey?: string | null;
  children: ReactNode;
}

export function SidebarSection({
  title,
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
    <section className="flex flex-col border-b border-border/20 last:border-0">
      <button
        type="button"
        className="flex items-center w-full px-3 py-2 text-left transition-colors hover:bg-muted/30 group"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className={cn("text-muted-foreground transition-transform duration-150 mr-2 flex items-center justify-center w-4 h-4 text-[10px]", open && "rotate-90")}>▸</span>
        <span className="text-[0.65rem] font-medium uppercase tracking-wider text-foreground">{title}</span>
        {badge ? <span className="ml-auto text-[0.6rem] font-mono tracking-tight text-muted-foreground/70 bg-muted/40 px-1.5 py-0.5 rounded-sm">{badge}</span> : null}
      </button>
      {open ? <div className="px-3 pb-3 pt-1 flex flex-col gap-4">{children}</div> : null}
    </section>
  );
}
