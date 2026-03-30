"use client";

import { Pause, Play, Square, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import FullmagLogo from "../brand/FullmagLogo";

interface TitleBarProps {
  problemName: string;
  backend: string;
  runtimeEngine?: string;
  status: string;
  connection: "connecting" | "connected" | "disconnected";
  interactiveEnabled?: boolean;
  runEnabled?: boolean;
  relaxEnabled?: boolean;
  pauseEnabled?: boolean;
  stopEnabled?: boolean;
  runAction?: string;
  runLabel?: string;
  commandBusy?: boolean;
  commandMessage?: string | null;
  onSimAction?: (action: string) => void;
}

export default function TitleBar({
  problemName,
  backend,
  runtimeEngine,
  status,
  connection,
  interactiveEnabled = false,
  runEnabled = false,
  relaxEnabled = false,
  pauseEnabled = false,
  stopEnabled = false,
  runAction = "run",
  runLabel = "Run",
  commandBusy = false,
  commandMessage,
  onSimAction,
}: TitleBarProps) {
  const controls = [
    { id: "relax", label: "Relax", icon: <Target size={14} />, tone: "relax", enabled: relaxEnabled },
    { id: runAction, label: runLabel, icon: <Play size={14} fill="currentColor" />, tone: "run", enabled: runEnabled },
    { id: "pause", label: "Pause", icon: <Pause size={14} fill="currentColor" />, tone: "pause", enabled: pauseEnabled },
    { id: "stop", label: "Stop", icon: <Square size={14} fill="currentColor" />, tone: "stop", enabled: stopEnabled },
  ] as const;
  
  const controlsTitle = commandMessage
    ?? (interactiveEnabled ? "Interactive simulation controls" : "Interactive controls are unavailable for this session");

  return (
    <div className="flex h-12 w-full shrink-0 items-center justify-between border-b border-white/5 bg-background/40 px-4 text-sm font-medium backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.4)] z-20 relative">
      <span className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis">
        <FullmagLogo size={28} className="mr-1 opacity-90 drop-shadow-md" />
        <span className="font-semibold tracking-wide text-foreground/90">{problemName}</span>
        {backend && <><span className="mx-1 text-muted-foreground/50">—</span><span className="text-muted-foreground text-[0.65rem] font-bold tracking-widest">{backend.toUpperCase()}</span></>}
        {runtimeEngine && <><span className="mx-1 text-muted-foreground/50">·</span><span className="text-muted-foreground text-[0.65rem] font-bold tracking-widest">{runtimeEngine.toUpperCase()}</span></>}
      </span>

      <span className="flex-1" />

      <div className="flex items-center gap-1" title={controlsTitle} aria-label="Simulation controls">
        {controls.map((control) => (
          <button
            key={control.id}
            type="button"
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
              control.tone === "run" ? "text-emerald-500 hover:bg-emerald-500/15" :
              control.tone === "relax" ? "text-amber-500 hover:bg-amber-500/15" :
              control.tone === "pause" ? "text-blue-500 hover:bg-blue-500/15" :
              "text-rose-500 hover:bg-rose-500/15"
            )}
            disabled={!control.enabled}
            onClick={() => onSimAction?.(control.id)}
            title={control.label}
          >
            {control.icon}
            <span className="hidden sm:inline-block">{control.label}</span>
          </button>
        ))}
      </div>

      {commandMessage && (
        <div
          className={cn(
            "ml-3 max-w-[20rem] truncate rounded-full border px-3 py-1 text-[0.65rem] font-bold uppercase tracking-widest",
            commandBusy
              ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
              : "border-sky-500/30 bg-sky-500/10 text-sky-300",
          )}
          title={commandMessage}
        >
          {commandMessage}
        </div>
      )}

      <div className="ml-4 flex items-center gap-2 border-l border-border/60 pl-4 h-6">
        <span className={cn(
          "flex items-center gap-2 text-[0.65rem] font-bold uppercase tracking-widest",
          connection === "connected" ? "text-emerald-500" :
          connection === "connecting" ? "text-amber-500" : "text-rose-500"
        )}>
          <span className="relative flex h-2 w-2">
            {connection === "connecting" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
          </span>
          {status}
        </span>
      </div>

      <span className="ml-4 border-l border-border/60 pl-4 text-[0.65rem] font-black tracking-widest text-muted-foreground hidden lg:inline-block h-6 flex items-center">
        FULLMAG
      </span>
    </div>
  );
}
