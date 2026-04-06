"use client";

import { cn } from "@/lib/utils";
import type { WorkspaceMode } from "@/components/runs/control-room/context-hooks";

const STAGES: Array<{ id: WorkspaceMode; label: string }> = [
  { id: "build", label: "Model Builder" },
  { id: "study", label: "Study" },
  { id: "analyze", label: "Analyze" },
];

interface StageBarProps {
  activeStage: WorkspaceMode;
  onChangeStage: (stage: WorkspaceMode) => void;
}

export default function StageBar({ activeStage, onChangeStage }: StageBarProps) {
  return (
    <div className="flex h-10 items-center gap-1 border-b border-border/30 px-3 bg-background/75">
      {STAGES.map((stage) => (
        <button
          key={stage.id}
          type="button"
          onClick={() => onChangeStage(stage.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors",
            activeStage === stage.id
              ? "bg-primary/15 text-primary border border-primary/30"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground border border-transparent",
          )}
        >
          {stage.label}
        </button>
      ))}
    </div>
  );
}

