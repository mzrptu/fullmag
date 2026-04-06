"use client";

import type { ExecutionMapEntryStatus } from "@/lib/study-builder/execution-map";

interface ExecutionStatusPanelProps {
  entries: ExecutionMapEntryStatus[];
}

function tone(status: ExecutionMapEntryStatus["status"]): string {
  if (status === "done") return "text-emerald-400";
  if (status === "running") return "text-sky-300";
  if (status === "failed") return "text-rose-400";
  if (status === "skipped") return "text-muted-foreground";
  return "text-muted-foreground";
}

export default function ExecutionStatusPanel({ entries }: ExecutionStatusPanelProps) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="text-xs font-semibold">Execution Mapping</div>
      <div className="mt-2 flex flex-col gap-1">
        {entries.length === 0 ? (
          <div className="text-[0.7rem] text-muted-foreground">No execution map yet.</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.nodeId} className="flex items-center justify-between rounded border border-border/30 px-2 py-1">
              <span className="text-[0.7rem] text-foreground">{entry.nodeLabel}</span>
              <span className={`text-[0.65rem] uppercase tracking-wider ${tone(entry.status)}`}>
                {entry.status} {entry.progress > 0 ? `${entry.progress.toFixed(0)}%` : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

