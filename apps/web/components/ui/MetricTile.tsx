"use client";

import { cn } from "@/lib/utils";

type Tone = "default" | "accent" | "info" | "warn" | "danger";

interface MetricTileProps {
  label: string;
  value: string;
  detail?: string;
  progress?: number;
  tone?: Tone;
}

export default function MetricTile({
  label,
  value,
  detail,
  progress,
  tone = "default",
}: MetricTileProps) {
  const normalized =
    progress != null ? Math.max(0, Math.min(progress, 100)) : null;

  return (
    <article className="flex flex-col gap-2.5 p-3.5 rounded-lg border border-border/40 bg-card/20 shadow-sm" data-tone={tone}>
      <header className="flex justify-between gap-3 text-[0.8rem] font-semibold uppercase tracking-widest text-muted-foreground">
        <span>{label}</span>
        {detail && <small className="text-sm normal-case tracking-normal text-muted-foreground/80">{detail}</small>}
      </header>
      <strong className="text-xl tracking-tight text-foreground">{value}</strong>
      {normalized != null && (
        <progress className={cn("h-2 w-full appearance-none border-none rounded-full bg-muted/40 overflow-hidden [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:transition-all [&::-webkit-progress-value]:duration-300 [&::-webkit-progress-value]:rounded-full", tone === "warn" ? "[&::-webkit-progress-value]:bg-amber-500" : tone === "danger" ? "[&::-webkit-progress-value]:bg-destructive" : tone === "accent" ? "[&::-webkit-progress-value]:bg-indigo-500" : tone === "info" ? "[&::-webkit-progress-value]:bg-sky-500" : "[&::-webkit-progress-value]:bg-primary")} value={normalized} max={100} aria-hidden="true" />
      )}
    </article>
  );
}
