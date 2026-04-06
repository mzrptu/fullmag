"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useRuntimeCapabilities } from "../../lib/hooks/useRuntimeCapabilities";
import { useControlRoom } from "../runs/control-room/ControlRoomContext";

type RuntimeField = "requested_backend" | "requested_device" | "requested_precision" | "requested_mode";

interface OptionState {
  value: string;
  label: string;
  disabled: boolean;
  reason: string | null;
}

const MODE_OPTIONS = [
  { value: "strict", label: "Strict" },
  { value: "extended", label: "Extended" },
  { value: "hybrid", label: "Hybrid" },
];

function humanize(value: string): string {
  if (!value) return "Unknown";
  if (value === "auto") return "Auto";
  if (value === "cpu") return "CPU";
  if (value === "gpu") return "GPU";
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export default function SolverSelector() {
  const ctx = useControlRoom();
  const { capabilities, loading, error } = useRuntimeCapabilities();
  const requested = ctx.requestedRuntimeSelection;
  const entries = capabilities?.engines ?? [];

  const backendOptions = useMemo<OptionState[]>(() => {
    const values = ["auto", ...new Set(entries.map((entry) => entry.backend))];
    return values.map((value) => ({
      value,
      label: humanize(value),
      disabled: false,
      reason: null,
    }));
  }, [entries]);

  const deviceOptions = useMemo<OptionState[]>(() => {
    const values = ["auto", ...new Set(entries.map((entry) => entry.device))];
    return values.map((value) => {
      if (value === "auto") {
        return { value, label: "Auto", disabled: false, reason: null };
      }
      const matching = entries.filter(
        (entry) =>
          (requested.requested_backend === "auto" || entry.backend === requested.requested_backend) &&
          entry.device === value,
      );
      const available = matching.some((entry) => entry.status === "available");
      return {
        value,
        label: humanize(value),
        disabled: matching.length > 0 && !available,
        reason:
          matching.find((entry) => entry.status_reason)?.status_reason ??
          (matching.length === 0 ? "No runtime advertises this device for the selected backend." : null),
      };
    });
  }, [entries, requested.requested_backend]);

  const precisionOptions = useMemo<OptionState[]>(() => {
    const values = ["double", ...new Set(entries.map((entry) => entry.precision))];
    return values.map((value) => {
      const matching = entries.filter(
        (entry) =>
          (requested.requested_backend === "auto" || entry.backend === requested.requested_backend) &&
          (requested.requested_device === "auto" || entry.device === requested.requested_device) &&
          entry.precision === value,
      );
      const available = matching.some((entry) => entry.status === "available");
      return {
        value,
        label: humanize(value),
        disabled: matching.length > 0 && !available,
        reason:
          matching.find((entry) => entry.status_reason)?.status_reason ??
          (matching.length === 0 ? "No runtime advertises this precision for the selected backend/device." : null),
      };
    });
  }, [entries, requested.requested_backend, requested.requested_device]);

  const resolvedEntry = useMemo(() => {
    const engineId = ctx.session?.resolved_engine_id ?? null;
    const byEngineId =
      engineId != null
        ? entries.find(
            (entry) => `${entry.backend}_${entry.device}` === engineId || `${entry.backend}_${entry.device}_${entry.precision}` === engineId,
          )
        : null;
    if (byEngineId) {
      return byEngineId;
    }
    return entries.find(
      (entry) =>
        entry.backend === (ctx.session?.resolved_backend ?? "") &&
        entry.device === (ctx.session?.resolved_device ?? "") &&
        entry.precision === (ctx.session?.resolved_precision ?? ""),
    ) ?? null;
  }, [ctx.session?.resolved_backend, ctx.session?.resolved_device, ctx.session?.resolved_engine_id, ctx.session?.resolved_precision, entries]);

  const unavailableNotes = useMemo(() => {
    return [...deviceOptions, ...precisionOptions]
      .filter((option) => option.disabled && option.reason)
      .map((option) => `${option.label}: ${option.reason}`);
  }, [deviceOptions, precisionOptions]);

  const updateField = (field: RuntimeField, value: string) => {
    ctx.setRequestedRuntimeSelection((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const selectionSummary = `${humanize(requested.requested_backend)} / ${humanize(requested.requested_device)} / ${humanize(requested.requested_precision)} / ${humanize(requested.requested_mode)}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border/35 bg-background/35 p-3">
        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Requested Solver
        </div>
        <div className="mt-1 text-sm text-foreground">{selectionSummary}</div>
        <div className="mt-1 text-[0.72rem] text-muted-foreground">
          Runtime request is stored in <span className="font-mono text-foreground">SceneDocument.study</span> and syncs into the live session.
        </div>
      </div>

      <OptionGroup
        label="Backend"
        value={requested.requested_backend}
        options={backendOptions}
        onSelect={(value) => updateField("requested_backend", value)}
      />
      <OptionGroup
        label="Device"
        value={requested.requested_device}
        options={deviceOptions}
        onSelect={(value) => updateField("requested_device", value)}
      />
      <OptionGroup
        label="Precision"
        value={requested.requested_precision}
        options={precisionOptions}
        onSelect={(value) => updateField("requested_precision", value)}
      />
      <OptionGroup
        label="Mode"
        value={requested.requested_mode}
        options={MODE_OPTIONS.map((option) => ({
          ...option,
          disabled: false,
          reason: null,
        }))}
        onSelect={(value) => updateField("requested_mode", value)}
      />

      <div className="rounded-lg border border-border/35 bg-background/35 p-3 text-[0.74rem]">
        <div className="font-semibold text-foreground">Resolved runtime</div>
        <div className="mt-1 text-muted-foreground">
          {ctx.session?.resolved_backend
            ? `${humanize(ctx.session.resolved_backend)} / ${humanize(ctx.session.resolved_device ?? "unknown")} / ${humanize(ctx.session.resolved_precision ?? "unknown")}`
            : "Waiting for session runtime resolution."}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[0.68rem] text-muted-foreground">
          <span className="rounded border border-border/40 px-2 py-1">
            engine: {ctx.session?.resolved_engine_id ?? "—"}
          </span>
          <span className="rounded border border-border/40 px-2 py-1">
            family: {ctx.session?.resolved_runtime_family ?? resolvedEntry?.runtime_family ?? "—"}
          </span>
          <span className="rounded border border-border/40 px-2 py-1">
            worker: {ctx.session?.resolved_worker ?? resolvedEntry?.worker ?? "—"}
          </span>
        </div>
        {ctx.session?.resolved_fallback?.occurred ? (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[0.72rem] text-amber-100">
            Fallback: {ctx.session.resolved_fallback.original_engine} → {ctx.session.resolved_fallback.fallback_engine}
            <div className="mt-1 text-amber-200/90">{ctx.session.resolved_fallback.message}</div>
          </div>
        ) : null}
        {loading ? (
          <div className="mt-3 text-muted-foreground">Loading runtime capabilities…</div>
        ) : null}
        {error ? (
          <div className="mt-3 text-rose-300">Runtime capability probe failed: {error}</div>
        ) : null}
      </div>

      {unavailableNotes.length > 0 ? (
        <div className="rounded-lg border border-border/35 bg-background/25 p-3 text-[0.72rem] text-muted-foreground">
          <div className="font-semibold text-foreground">Unavailable options</div>
          <ul className="mt-2 space-y-1">
            {unavailableNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function OptionGroup({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: OptionState[];
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={cn(
                "rounded-md border px-3 py-1.5 text-[0.74rem] transition-colors",
                active
                  ? "border-primary/50 bg-primary/15 text-foreground"
                  : "border-border/40 bg-background/40 text-muted-foreground",
                option.disabled && "cursor-not-allowed opacity-45",
              )}
              disabled={option.disabled}
              onClick={() => onSelect(option.value)}
              title={option.reason ?? undefined}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
