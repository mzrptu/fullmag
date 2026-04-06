import type { MaterializedStageMapEntry } from "./types";

export type ExecutionStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface ExecutionMapEntryStatus {
  nodeId: string;
  nodeLabel: string;
  status: ExecutionStatus;
  progress: number;
  children: ExecutionMapEntryStatus[];
}

function statusFromIndexes(
  indexes: number[],
  activeIndex: number | null,
  completedCount: number,
): { status: ExecutionStatus; progress: number } {
  if (indexes.length === 0) return { status: "skipped", progress: 100 };
  const done = indexes.filter((index) => index < completedCount).length;
  const hasActive = activeIndex != null && indexes.includes(activeIndex);
  if (done === indexes.length) return { status: "done", progress: 100 };
  if (hasActive) {
    const progress = (done / indexes.length) * 100;
    return { status: "running", progress };
  }
  if (done > 0) return { status: "running", progress: (done / indexes.length) * 100 };
  return { status: "pending", progress: 0 };
}

export function buildExecutionMapStatus(
  map: MaterializedStageMapEntry[],
  activeStageIndex: number | null,
  completedStageCount: number,
): ExecutionMapEntryStatus[] {
  return map.map((entry) => {
    const base = statusFromIndexes(entry.stageIndexes, activeStageIndex, completedStageCount);
    return {
      nodeId: entry.nodeId,
      nodeLabel: entry.nodeLabel,
      status: base.status,
      progress: base.progress,
      children: buildExecutionMapStatus(
        entry.childEntries ?? [],
        activeStageIndex,
        completedStageCount,
      ),
    };
  });
}

