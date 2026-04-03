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
  commandMessage?: string | null;
  commandState?: string | null;
  displayLabel?: string | null;
  displayDetail?: string | null;
  previewPending?: boolean;
  runtimeCanAcceptCommands?: boolean;
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
  commandMessage,
  commandState,
  displayLabel,
  displayDetail,
  previewPending = false,
  runtimeCanAcceptCommands = false,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between border-t border-white/5 bg-background/60 px-3 py-1 text-[0.68rem] tracking-wide text-muted-foreground z-40 min-h-[26px]">
      <div className="flex items-center gap-2 overflow-hidden flex-1 mr-4">
        {(activityLabel || activityDetail) ? (
          <>
            <span className="font-medium text-[0.62rem] bg-primary/15 text-primary px-1.5 py-[1px] rounded border border-primary/20 shrink-0">
              {activityLabel ?? "Workspace"}
            </span>
            {activityDetail && (
              <span className="truncate max-w-full text-foreground/80 font-medium" title={activityDetail}>
                {activityDetail}
              </span>
            )}
          </>
        ) : (
          <span className="font-medium text-[0.62rem] bg-muted text-muted-foreground px-1.5 py-[1px] rounded shrink-0">
            Idle
          </span>
        )}
        {commandMessage && (
          <span
            className={cn(
              "max-w-[18rem] truncate rounded-full border px-2 py-0.5 text-[0.6rem] font-medium",
              commandState === "rejected"
                ? "border-rose-500/25 bg-rose-500/10 text-rose-300"
                : previewPending
                  ? "border-violet-500/25 bg-violet-500/10 text-violet-200"
                  : "border-sky-500/25 bg-sky-500/10 text-sky-300",
            )}
            title={commandMessage}
          >
            {commandMessage}
          </span>
        )}
      </div>
      <div className="flex items-center shrink-0 ml-auto gap-4">
      <div className="flex items-center gap-2">
        <span className={cn("flex items-center gap-1.5 font-medium text-muted-foreground", status === "running" && "text-primary", status === "completed" && "text-emerald-500", status === "failed" && "text-destructive")} data-status={status}>
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

      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5"><Clock size={11} />{simTime}</span>
        <span className="h-3 w-px bg-border/50" />
        <span>Step {stepDisplay ?? step.toLocaleString()}</span>
        {wallTime !== "—" && (
          <>
            <span className="h-3 w-px bg-border/50" />
            <span>Elapsed {wallTime}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {nodeCount && (
          <>
            <span className="flex items-center gap-1.5"><HardDrive size={11} />{nodeCount}</span>
            <span className="h-3 w-px bg-border/50" />
          </>
        )}
        <span className={cn("font-medium text-[0.62rem]", runtimeCanAcceptCommands ? "text-emerald-400" : "text-amber-400")}>
          {runtimeCanAcceptCommands ? "Ready" : "Busy"}
        </span>
        <span className="h-3 w-px bg-border/50" />
        <span className="flex items-center gap-1.5"><Cpu size={11} />{runtimeEngine ? `${runtimeEngine} · ${precision}` : `${backend.toUpperCase()} · ${precision}`}</span>
      </div>
      </div>
    </div>
  );
}
