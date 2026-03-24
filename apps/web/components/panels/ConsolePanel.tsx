"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Panel from "../ui/Panel";
import EmptyState from "../ui/EmptyState";

interface ConsolePanelProps {
  events: Array<Record<string, unknown>>;
  connection: "connecting" | "connected" | "disconnected";
}

export default function ConsolePanel({ events, connection }: ConsolePanelProps) {
  const codeRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const formatted = events
    .map((ev) => {
      const kind = ev.kind as string;
      const step = ev.step ?? "";
      const time = typeof ev.time === "number" ? (ev.time as number).toExponential(3) : "";
      if (kind === "session_started") return `▶ Session started`;
      if (kind === "run_progress") return `  step=${step}  t=${time}`;
      if (kind === "run_finished_step") return `  step=${step}  t=${time}  ✓ finished`;
      if (kind === "run_completed") return `✓ Run completed — ${(ev.total_steps ?? 0)} steps`;
      if (kind === "run_failed") return `✗ Run failed: ${ev.error ?? "unknown"}`;
      return `  ${kind}: ${JSON.stringify(ev)}`;
    })
    .join("\n");

  return (
    <Panel title="Console" subtitle="Simulation event log." panelId="console" eyebrow="Diagnostics">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", minHeight: 0 }}>
        <div
          ref={codeRef}
          style={{
            minHeight: "var(--terminal-height)",
            maxHeight: "var(--terminal-height)",
            overflow: "auto",
            padding: "1rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            background: "linear-gradient(180deg, rgba(8,12,22,0.96), rgba(7,10,18,0.98))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          {!formatted ? (
            <EmptyState
              title={connection === "disconnected" ? "Console offline" : "Console is ready"}
              description={
                connection === "disconnected"
                  ? "Reconnect to see simulation events."
                  : "Events will appear once the simulation starts."
              }
              tone={connection === "disconnected" ? "warn" : "info"}
              compact
            />
          ) : (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono)",
                fontSize: "0.85rem",
                lineHeight: 1.6,
                color: "var(--text-1)",
                margin: 0,
              }}
            >
              {formatted}
            </pre>
          )}
        </div>
      </div>
    </Panel>
  );
}
