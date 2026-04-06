"use client";

import type { RecentSimulationEntry } from "@/lib/workspace/recent-simulations";

interface RecentSimulationsSectionProps {
  entries: RecentSimulationEntry[];
  onOpenRecent: (entry: RecentSimulationEntry) => void;
}

export default function RecentSimulationsSection({
  entries,
  onOpenRecent,
}: RecentSimulationsSectionProps) {
  return (
    <section className="rounded-xl border border-border/40 bg-card/40 p-4">
      <h2 className="text-sm font-semibold tracking-wide text-foreground">Recent Simulations</h2>
      <div className="mt-3 flex flex-col gap-2">
        {entries.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/40 p-3 text-xs text-muted-foreground">
            No recent simulations yet.
          </div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onOpenRecent(entry)}
              className="flex items-center justify-between rounded-md border border-border/40 bg-background/50 px-3 py-2 text-left hover:bg-background/80"
            >
              <span className="flex flex-col">
                <span className="text-xs font-semibold text-foreground">{entry.name}</span>
                <span className="text-[0.7rem] text-muted-foreground">{entry.path}</span>
              </span>
              <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                {entry.lastStage ?? "build"}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

