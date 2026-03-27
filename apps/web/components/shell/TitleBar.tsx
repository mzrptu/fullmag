"use client";

import { cn } from "@/lib/utils";
import s from "./shell.module.css";

interface TitleBarProps {
  problemName: string;
  backend: string;
  runtimeEngine?: string;
  status: string;
  connection: "connecting" | "connected" | "disconnected";
}

export default function TitleBar({
  problemName,
  backend,
  runtimeEngine,
  status,
  connection,
}: TitleBarProps) {
  return (
    <div className={s.titleBar}>
      <span className={s.titleBarText}>
        {problemName}
        {backend && <> — <span className={s.titleBarMuted}>{backend.toUpperCase()}</span></>}
        {runtimeEngine && <> · <span className={s.titleBarMuted}>{runtimeEngine}</span></>}
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
