"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiGet, resolveRuntimeHttpBase, currentLiveUrl, ApiError, NetworkError } from "@/lib/api";

interface ServerConfig {
  backend: string;
  execution_mode: string;
  precision: string;
  problem_name: string;
  script_path: string | null;
  artifact_dir: string | null;
  status: string;
  plan_summary: Record<string, unknown> | null;
}

type ConnectionState = "idle" | "loading" | "connected" | "error";
type SettingTone = "success" | "error" | "info";

const pageStackClass = "flex flex-col gap-[var(--sp-4)]";
const refreshButtonClass = "inline-flex items-center rounded-md border border-[var(--ide-border-subtle)] bg-[var(--surface-2)] px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-[var(--text-soft)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]";

function useServerConfig() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setConnection("loading");
    setError(null);
    apiGet<{ session?: Record<string, unknown>; live_state?: Record<string, unknown> }>(
      currentLiveUrl('/bootstrap'),
    )
      .then((data) => {
        const session = data?.session;
        setConfig({
          backend: (session?.requested_backend as string) ?? "unknown",
          execution_mode: (session?.execution_mode as string) ?? "unknown",
          precision: (session?.precision as string) ?? "unknown",
          problem_name: (session?.problem_name as string) ?? "—",
          script_path: (session?.script_path as string | null) ?? null,
          artifact_dir: (session?.artifact_dir as string | null) ?? null,
          status: (session?.status as string) ?? (data?.live_state?.status as string) ?? "idle",
          plan_summary: (session?.plan_summary as Record<string, unknown> | null) ?? null,
        });
        setConnection("connected");
      })
      .catch((err) => {
        setError(
          err instanceof ApiError || err instanceof NetworkError
            ? err.message
            : "Connection failed",
        );
        setConnection("error");
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { config, connection, error, refresh };
}

function badgeVariantForTone(tone?: SettingTone) {
  if (tone === "success") return "success";
  if (tone === "error") return "destructive";
  if (tone === "info") return "info";
  return "outline";
}

export default function SettingsPage() {
  const { config, connection, error, refresh } = useServerConfig();

  const plan = config?.plan_summary;
  const meshInfo = plan
    ? [
        plan.n_nodes ? `${(plan.n_nodes as number).toLocaleString()} nodes` : null,
        plan.n_elements ? `${(plan.n_elements as number).toLocaleString()} elements` : null,
        plan.grid_cells
          ? `grid ${(plan.grid_cells as number[])[0]}×${(plan.grid_cells as number[])[1]}×${(plan.grid_cells as number[])[2]}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Platform configuration and live workspace state</p>
      </div>

      <div className={pageStackClass}>
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Server Connection</h2>
            <button type="button" onClick={refresh} className={refreshButtonClass}>
              Refresh
            </button>
          </div>
          <div className="card-body">
            <SettingRow
              label="Status"
              value={
                connection === "connected"
                  ? "Connected"
                  : connection === "loading"
                    ? "Loading…"
                    : connection === "error"
                      ? "Disconnected"
                      : "Idle"
              }
              tone={connection === "connected" ? "success" : connection === "error" ? "error" : undefined}
            />
            <SettingRow label="API Endpoint" value={resolveRuntimeHttpBase()} />
            {error && <SettingRow label="Error" value={error} tone="error" />}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Execution Configuration</h2>
          </div>
          <div className="card-body">
            <SettingRow label="Backend" value={config?.backend?.toUpperCase() ?? "—"} muted={!config} />
            <SettingRow label="Execution Mode" value={config?.execution_mode ?? "—"} muted={!config} />
            <SettingRow label="Precision" value={config?.precision ?? "—"} muted={!config} />
            <SettingRow
              label="Workspace Status"
              value={config?.status ?? "—"}
              tone={
                config?.status === "running"
                  ? "success"
                  : config?.status === "awaiting_command"
                    ? "info"
                    : undefined
              }
              muted={!config}
            />
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Active Problem</h2>
          </div>
          <div className="card-body">
            <SettingRow label="Problem Name" value={config?.problem_name ?? "—"} muted={!config} />
            {config?.script_path && (
              <SettingRow label="Script" value={config.script_path.split("/").pop() ?? "—"} />
            )}
            {config?.artifact_dir && (
              <SettingRow label="Output Directory" value={config.artifact_dir} />
            )}
            {meshInfo && <SettingRow label="Mesh" value={meshInfo} />}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">GPU Configuration</h2>
          </div>
          <div className="card-body">
            <SettingRow
              label="CUDA Device"
              value={config?.plan_summary?.cuda_device as string ?? "Auto-detect"}
              muted={!config?.plan_summary?.cuda_device}
            />
            <SettingRow
              label="Backend Mode"
              value={config?.backend?.toUpperCase() ?? "—"}
              tone={config?.backend === "fdm" || config?.backend === "fem" ? "info" : undefined}
              muted={!config}
            />
            <SettingRow
              label="Precision"
              value={config?.precision ?? "—"}
              muted={!config}
            />
          </div>
        </section>

        <SettingsPreferences />
      </div>
    </>
  );
}

/* ── Local preferences with localStorage persistence ── */

const PREFS_KEY = "fullmag_preferences";

interface Preferences {
  defaultView: "3D" | "2D" | "Mesh";
  previewRefreshMs: number;
  showAxisLabels: boolean;
}

const DEFAULT_PREFS: Preferences = {
  defaultView: "3D",
  previewRefreshMs: 250,
  showAxisLabels: true,
};

function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: Preferences) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function SettingsPreferences() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return next;
    });
  }, []);

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Visualization Preferences</h2>
        {saved && (
          <span className="text-[length:var(--text-sm)] text-emerald-500 font-medium animate-in fade-in">
            Saved ✓
          </span>
        )}
      </div>
      <div className="card-body">
        <div className="flex items-center justify-between gap-[var(--sp-4)] border-b border-[var(--ide-border-subtle)] py-[var(--sp-3)]">
          <span className="text-[length:var(--text-base)] text-[var(--text-soft)]">Default View Mode</span>
          <select
            value={prefs.defaultView}
            onChange={(e) => update({ defaultView: e.target.value as Preferences["defaultView"] })}
            className="font-mono text-[length:var(--text-sm)] bg-[var(--surface-2)] border border-[var(--ide-border-subtle)] rounded-md px-2 py-1 text-[var(--text-1)]"
          >
            <option value="3D">3D</option>
            <option value="2D">2D</option>
            <option value="Mesh">Mesh</option>
          </select>
        </div>
        <div className="flex items-center justify-between gap-[var(--sp-4)] border-b border-[var(--ide-border-subtle)] py-[var(--sp-3)]">
          <span className="text-[length:var(--text-base)] text-[var(--text-soft)]">Preview Refresh</span>
          <select
            value={prefs.previewRefreshMs}
            onChange={(e) => update({ previewRefreshMs: Number(e.target.value) })}
            className="font-mono text-[length:var(--text-sm)] bg-[var(--surface-2)] border border-[var(--ide-border-subtle)] rounded-md px-2 py-1 text-[var(--text-1)]"
          >
            <option value={100}>Fast (100ms)</option>
            <option value={250}>Normal (250ms)</option>
            <option value={500}>Slow (500ms)</option>
            <option value={1000}>Very Slow (1s)</option>
          </select>
        </div>
        <div className="flex items-center justify-between gap-[var(--sp-4)] py-[var(--sp-3)]">
          <span className="text-[length:var(--text-base)] text-[var(--text-soft)]">Show Axis Labels</span>
          <button
            onClick={() => update({ showAxisLabels: !prefs.showAxisLabels })}
            className={cn(
              "w-10 h-5 rounded-full transition-colors relative",
              prefs.showAxisLabels ? "bg-primary" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                prefs.showAxisLabels ? "translate-x-5" : "translate-x-0.5"
              )}
            />
          </button>
        </div>
        <p className="mt-[var(--sp-2)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
          These preferences are saved locally and persist across sessions.
        </p>
      </div>
    </section>
  );
}

function SettingRow({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  tone?: SettingTone;
}) {
  return (
    <div className="flex items-center justify-between gap-[var(--sp-4)] border-b border-[var(--ide-border-subtle)] py-[var(--sp-3)] last:border-b-0">
      <span className="text-[length:var(--text-base)] text-[var(--text-soft)]">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "font-mono text-[length:var(--text-sm)]",
            muted ? "text-[var(--text-muted)]" : "text-[var(--text-1)]",
            tone ? "font-semibold" : undefined,
          )}
        >
          {value}
        </span>
        {tone ? <Badge variant={badgeVariantForTone(tone)}>{tone}</Badge> : null}
      </div>
    </div>
  );
}
