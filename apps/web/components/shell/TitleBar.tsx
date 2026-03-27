"use client";

import { cn } from "@/lib/utils";
import s from "./shell.module.css";

interface TitleBarProps {
  problemName: string;
  backend: string;
  status: string;
  connection: "connecting" | "connected" | "disconnected";
}

export default function TitleBar({ problemName, backend, status, connection }: TitleBarProps) {
  return (
    <div className={s.titleBar}>
      {/* Traffic lights (cosmetic) */}
      <div className={s.trafficLights}>
        <span className={cn(s.trafficDot, s.dotClose)} />
        <span className={cn(s.trafficDot, s.dotMinimize)} />
        <span className={cn(s.trafficDot, s.dotMaximize)} />
      </div>

      <span className={s.titleBarText}>
        {problemName}
        {backend && <> — <span className={s.titleBarMuted}>{backend.toUpperCase()}</span></>}
      </span>

      <span className={s.titleBarSpacer} />

      <span className={s.titleBarStatus} data-connection={connection}>
        <span className={s.statusDotInline} data-connection={connection} />
        {status}
      </span>

      <span className={s.titleBarBrand}>Fullmag</span>
    </div>
  );
}
