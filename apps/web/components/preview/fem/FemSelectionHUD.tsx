"use client";

import { cn } from "@/lib/utils";

export function FemSelectionHUD({
  nNodes,
  nElements,
  nFaces,
  clipEnabled,
  clipAxis,
  clipPos,
  selectedFacesCount,
  compact = false,
}: {
  nNodes: number;
  nElements: number;
  nFaces: number;
  clipEnabled: boolean;
  clipAxis: "x" | "y" | "z";
  clipPos: number;
  selectedFacesCount: number;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "text-[0.65rem] text-slate-300 font-mono pointer-events-none flex items-baseline gap-3 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-md border border-slate-500/30 shadow-md",
        compact && "gap-2 px-2.5",
      )}
    >
      <span>{nNodes.toLocaleString()} nodes</span>
      <span className="h-[3px] w-[3px] rounded-full bg-slate-500/50" />
      <span>{nElements.toLocaleString()} tets</span>
      {!compact ? (
        <>
          <span className="h-[3px] w-[3px] rounded-full bg-slate-500/50" />
          <span>{nFaces.toLocaleString()} faces</span>
        </>
      ) : null}
      {clipEnabled ? (
        <>
          <span className="h-[3px] w-[3px] rounded-full bg-slate-500/50" />
          <span className="text-amber-500">
            clip {clipAxis.toUpperCase()} @ {clipPos}%
          </span>
        </>
      ) : null}
      {selectedFacesCount > 0 ? (
        <>
          <span className="h-[3px] w-[3px] rounded-full bg-slate-500/50" />
          <span className="text-blue-400">{selectedFacesCount} selected</span>
        </>
      ) : null}
    </div>
  );
}

export function FemRefineToolbar({
  selectedFacesCount,
  onRefine,
  onCoarsen,
  onClear,
  className,
}: {
  selectedFacesCount: number;
  onRefine: (factor: number) => void;
  onCoarsen: (factor: number) => void;
  onClear: () => void;
  className?: string;
}) {
  if (selectedFacesCount <= 0) {
    return null;
  }

  return (
    <div className={cn("z-30 flex items-center gap-2 rounded-lg border border-slate-500/30 bg-slate-900/90 p-2 shadow-xl backdrop-blur-md pointer-events-auto", className)}>
      <span className="px-1 font-mono text-[0.65rem] text-slate-400">
        {selectedFacesCount} faces
      </span>
      <div className="h-4 w-px bg-slate-500/30" />
      <button
        className="rounded px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
        onClick={() => onRefine(0.5)}
      >
        Refine ×2
      </button>
      <button
        className="rounded px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
        onClick={() => onRefine(0.25)}
      >
        Refine ×4
      </button>
      <button
        className="rounded px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-amber-400 transition-colors hover:bg-amber-500/10 hover:text-amber-300"
        onClick={() => onCoarsen(2)}
      >
        Coarsen ×2
      </button>
      <div className="h-4 w-px bg-slate-500/30" />
      <button
        className="rounded px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-slate-400 transition-colors hover:bg-slate-500/10 hover:text-slate-200"
        onClick={onClear}
      >
        Clear
      </button>
    </div>
  );
}
