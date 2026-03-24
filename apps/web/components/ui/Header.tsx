"use client";

import StatusBadge from "./StatusBadge";
import s from "./Header.module.css";

interface HeaderProps {
  status: string;
  scriptPath: string;
  problemName: string;
  connection: "connecting" | "connected" | "disconnected";
}

export default function Header({
  status,
  scriptPath,
  problemName,
  connection,
}: HeaderProps) {
  const solverTone =
    status === "running"
      ? "success"
      : status === "completed"
        ? "info"
        : status === "failed"
          ? "danger"
          : "warn";

  const solverLabel =
    status ? status[0].toUpperCase() + status.slice(1) : "Idle";

  const connTone =
    connection === "connected"
      ? "success"
      : connection === "connecting"
        ? "warn"
        : "danger";

  const connLabel =
    connection === "connected"
      ? "Connected"
      : connection === "connecting"
        ? "Reconnecting"
        : "Disconnected";

  return (
    <header className={s.header}>
      <div className={s.badges}>
        <StatusBadge label={connLabel} tone={connTone} pulse={connection !== "connected"} />
        <StatusBadge label={solverLabel} tone={solverTone} pulse={status === "running"} />
      </div>

      <div className={s.name}>
        <span className={s.eyebrow}>Workspace</span>
        <strong className={s.title}>
          {problemName || scriptPath || "No simulation file loaded"}
        </strong>
      </div>

      <span className={s.version}>fullmag</span>
    </header>
  );
}
