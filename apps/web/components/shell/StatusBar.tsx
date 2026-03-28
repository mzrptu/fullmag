"use client";

import {
  Activity, Clock, Cpu, HardDrive, Wifi, WifiOff,
  Loader2, CheckCircle2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusBarProps {
  connection: "connecting" | "connected" | "disconnected";
  step: number;
  stepDisplay?: string;
  simTime: string;
  wallTime: string;
  throughput: string;
  backend: string;
  runtimeEngine?: string;
  precision: string;
  status: string;
  activityLabel?: string;
  activityDetail?: string;
  progressMode?: "idle" | "indeterminate" | "determinate";
  progressValue?: number;
  nodeCount?: string;
}

export default function StatusBar({
  connection,
  step,
  stepDisplay,
  simTime,
  wallTime,
  throughput,
  backend,
  runtimeEngine,
  precision,
  status,
  activityLabel,
  activityDetail,
  progressMode: _progressMode = "idle",
  progressValue: _progressValue,
  nodeCount,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between border-t-2 border-border/60 bg-background/80 backdrop-blur-md px-3 py-1.5 text-[0.68rem] tracking-wide text-muted-foreground z-40 min-h-[28px] shadow-[0_-4px_24px_rgba(0,0,0,0.2)]">
      <div className="flex items-center gap-2 overflow-hidden flex-1 mr-4">
        {(activityLabel || activityDetail) ? (
          <>
            <span className="font-bold uppercase tracking-widest text-[0.6rem] bg-primary text-primary-foreground px-1.5 py-[1px] rounded shadow-sm border border-primary/20 shrink-0">
              {activityLabel ?? "Workspace"}
            </span>
            {activityDetail && (
              <span className="truncate max-w-full text-foreground/80 font-medium" title={activityDetail}>
                {activityDetail}
              </span>
            )}
          </>
        ) : (
          <span className="font-bold uppercase tracking-widest text-[0.6rem] bg-muted text-muted-foreground px-1.5 py-[1px] rounded shadow-sm shrink-0">
            Idle
          </span>
        )}
      </div>
      <div className="flex items-center shrink-0 ml-auto gap-4">
      {/* Left section: status + connection */}
      <div className="flex items-center gap-2">
        <span className={cn("flex items-center gap-1.5 font-semibold text-muted-foreground", status === "running" && "text-primary", status === "completed" && "text-emerald-500", status === "failed" && "text-destructive")} data-status={status}>
          {status === "running" ? <Activity size={12} className="animate-spin" /> :
           status === "completed" ? <CheckCircle2 size={12} /> :
           status === "failed" ? <XCircle size={12} /> :
           <Loader2 size={12} />}
          {status}
        </span>
        <span className="h-3 w-px bg-border/50" />
        <span className="flex items-center gap-1.5" data-connection={connection}>
          {connection === "connected" ? <Wifi size={11} /> : 
           connection === "connecting" ? <Loader2 size={11} className="animate-spin" /> : 
           <WifiOff size={11} />}
          {connection}
        </span>
      </div>

      {/* Center: simulation metrics */}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5">
          <Clock size={11} />
          {simTime}
        </span>
        <span className="h-3 w-px bg-border/50" />
        <span className="flex items-center gap-1.5">
          Step {stepDisplay ?? step.toLocaleString()}
        </span>
        <span className="h-3 w-px bg-border/50" />
        <span className="flex items-center gap-1.5">
          <Activity size={11} />
          {throughput}
        </span>
        {wallTime !== "—" && (
          <>
            <span className="h-3 w-px bg-border/50" />
            <span className="flex items-center gap-1.5">Elapsed: {wallTime}</span>
          </>
        )}
      </div>

      {/* Right: backend info */}
      <div className="flex items-center gap-2">
        {nodeCount && (
          <>
            <span className="flex items-center gap-1.5">
              <HardDrive size={11} />
              {nodeCount}
            </span>
            <span className="h-3 w-px bg-border/50" />
          </>
        )}
        <span className="flex items-center gap-1.5">
          <Cpu size={11} />
          {runtimeEngine ? `${runtimeEngine} · ${precision}` : `${backend.toUpperCase()} · ${precision}`}
        </span>
      </div>
      </div>
    </div>
  );
}
