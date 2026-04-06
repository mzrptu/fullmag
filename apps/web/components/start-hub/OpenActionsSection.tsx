"use client";

interface OpenActionsSectionProps {
  canResumeCurrentSession?: boolean;
  onResumeCurrentSession?: () => void;
  onOpenSimulation: () => void;
  onOpenScript: () => void;
  onOpenExample: () => void;
}

export default function OpenActionsSection({
  canResumeCurrentSession = false,
  onResumeCurrentSession,
  onOpenSimulation,
  onOpenScript,
  onOpenExample,
}: OpenActionsSectionProps) {
  return (
    <section className="rounded-xl border border-border/40 bg-card/40 p-4">
      <h2 className="text-sm font-semibold tracking-wide text-foreground">Open</h2>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => onResumeCurrentSession?.()}
          disabled={!canResumeCurrentSession}
          className="rounded-md border border-border/40 bg-background/60 px-3 py-2 text-xs font-medium hover:bg-background/90 disabled:cursor-not-allowed disabled:opacity-50"
          title={canResumeCurrentSession ? "Open active live session" : "No active live session detected"}
        >
          Resume Live Session
        </button>
        <button type="button" onClick={onOpenSimulation} className="rounded-md border border-border/40 bg-background/60 px-3 py-2 text-xs font-medium hover:bg-background/90">
          Open Simulation
        </button>
        <button type="button" onClick={onOpenScript} className="rounded-md border border-border/40 bg-background/60 px-3 py-2 text-xs font-medium hover:bg-background/90">
          Open Script
        </button>
        <button type="button" onClick={onOpenExample} className="rounded-md border border-border/40 bg-background/60 px-3 py-2 text-xs font-medium hover:bg-background/90">
          Open Example
        </button>
      </div>
    </section>
  );
}
