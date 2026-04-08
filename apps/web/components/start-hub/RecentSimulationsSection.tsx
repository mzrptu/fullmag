"use client";

import { FileCode2, FlaskConical, History, Layout, MonitorCheck } from "lucide-react";
import type { RecentSimulationEntry } from "@/lib/workspace/recent-simulations";
import { fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

interface RecentSimulationsSectionProps {
  entries: RecentSimulationEntry[];
  onOpenRecent: (entry: RecentSimulationEntry) => void;
}

export default function RecentSimulationsSection({
  entries,
  onOpenRecent,
}: RecentSimulationsSectionProps) {
  const now = Date.now();

  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/5 bg-white/[0.02] p-8 text-center">
          <History className="mb-3 h-8 w-8 text-muted-foreground/30" />
          <div className="text-[0.72rem] font-medium text-muted-foreground/50 uppercase tracking-widest">
            No session history
          </div>
        </div>
      ) : (
        entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onOpenRecent(entry)}
            className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-left transition-all hover:bg-white/[0.06] hover:ring-1 hover:ring-primary/20"
          >
            {/* Project Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/50 ring-1 ring-white/5 shadow-sm">
                  {entry.kind === "project" ? (
                    <Layout className="h-4.5 w-4.5 text-primary/70" />
                  ) : entry.kind === "script" ? (
                    <FileCode2 className="h-4.5 w-4.5 text-mauve" />
                  ) : (
                    <FlaskConical className="h-4.5 w-4.5 text-peach" />
                  )}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="truncate text-[0.82rem] font-bold tracking-tight text-white/90 group-hover:text-primary transition-colors">
                    {entry.name}
                  </span>
                  <span className="truncate text-[0.68rem] text-muted-foreground/50 font-medium tracking-tight">
                    {entry.path.split("/").pop()}
                  </span>
                </div>
              </div>
              
              <div className="h-2 w-2 rounded-full bg-primary/40 shadow-[0_0_8px_rgba(137,220,235,0.2)]" />
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-3 gap-2 border-t border-white/5 pt-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[0.58rem] font-bold uppercase tracking-[0.14em] text-muted-foreground/40">Backend</span>
                <span className="truncate text-[0.68rem] font-bold text-white/60 uppercase">
                  {entry.backend ?? "Auto"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[0.58rem] font-bold uppercase tracking-[0.14em] text-muted-foreground/40">Modified</span>
                <span className="truncate text-[0.68rem] font-bold text-white/60 uppercase">
                  {fmtDuration(Math.max(0, now - entry.updatedAtUnixMs))} ago
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[0.58rem] font-bold uppercase tracking-[0.14em] text-muted-foreground/40">Stage</span>
                <span className="truncate text-[0.68rem] font-bold text-primary/80 uppercase tracking-widest">
                  {entry.lastStage ?? "Build"}
                </span>
              </div>
            </div>

            {/* Status Footer */}
            <div className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/5">
              <MonitorCheck className="h-3 w-3 text-emerald-500/70" />
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                Deployment Ready
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

