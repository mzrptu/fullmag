"use client";

import { useCallback, useMemo } from "react";

import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import type { ScriptBuilderUniverseState } from "../../../lib/session/types";
import { fmtSI } from "../../runs/control-room/shared";
import SelectField from "../../ui/SelectField";
import { TextField } from "../../ui/TextField";
import { MetricField, SidebarSection } from "./primitives";
import {
  humanizeToken,
  readBuilderContract,
  readBuilderUniverse,
} from "./helpers";

function formatVector(value: [number, number, number] | null, unit: string): string {
  if (!value) return "—";
  return value.map((component) => fmtSI(component, unit)).join(" · ");
}

function hasNonZeroVector(value: [number, number, number] | null): boolean {
  return Boolean(value && value.some((component) => Math.abs(component) > 0));
}

export default function UniversePanel() {
  const ctx = useControlRoom();
  const builderContract = useMemo(() => readBuilderContract(ctx.metadata), [ctx.metadata]);
  const manifestUniverse = useMemo(() => readBuilderUniverse(ctx.metadata), [ctx.metadata]);
  const builderUniverse = useMemo<ScriptBuilderUniverseState | null>(() => {
    if (ctx.scriptBuilderUniverse) return ctx.scriptBuilderUniverse;
    if (!manifestUniverse) return null;
    return {
      mode: manifestUniverse.mode ?? "auto",
      size: manifestUniverse.size ?? null,
      center: manifestUniverse.center ?? null,
      padding: manifestUniverse.padding ?? null,
    };
  }, [ctx.scriptBuilderUniverse, manifestUniverse]);
  const editable = Boolean(
    builderContract?.editableScopes.includes("universe") && builderUniverse,
  );

  const declaredSize = builderUniverse?.size ?? null;
  const effectiveExtent = ctx.worldExtent ?? declaredSize;
  const center = builderUniverse?.center ?? ctx.worldCenter ?? null;
  const padding = builderUniverse?.padding ?? null;
  const mode = builderUniverse?.mode ?? (effectiveExtent ? "derived" : null);
  const role = ctx.isFemBackend ? "FEM outer domain / air box source" : "FDM world box / grid domain";
  const sourceSummary = builderUniverse
    ? "Explicit `study.universe(...)` captured by the builder manifest."
    : ctx.isFemBackend && ctx.objectOverlays.length > 0
      ? `No explicit universe in the script yet; deriving the FEM domain from ${ctx.objectOverlays.length} object bounds.`
    : effectiveExtent
      ? "No explicit universe in the script yet; using current mesh/grid extent as the effective domain."
      : "Universe metadata is not available for this workspace yet.";

  const updateUniverse = useCallback(
    (updater: (current: ScriptBuilderUniverseState) => ScriptBuilderUniverseState) => {
      if (!builderUniverse) return;
      ctx.setScriptBuilderUniverse((prev) => updater(prev ?? builderUniverse));
    },
    [builderUniverse, ctx],
  );

  const updateVecComponent = useCallback(
    (
      field: "size" | "center" | "padding",
      index: number,
      valueRaw: string,
    ) => {
      const parsed = Number(valueRaw);
      if (!Number.isFinite(parsed)) return;
      updateUniverse((current) => {
        const next = current[field] ? [...current[field]] : [0, 0, 0];
        next[index] = parsed * 1e-9;
        return { ...current, [field]: next as [number, number, number] };
      });
    },
    [updateUniverse],
  );

  const formatNm = (value: number | null | undefined): string =>
    value == null || !Number.isFinite(value) ? "" : (value * 1e9).toFixed(1);

  return (
    <div className="flex flex-col gap-0">
      <SidebarSection title="Domain Extent" defaultOpen={true}>
        {editable && builderUniverse ? (
          <div className="flex flex-col gap-4">
            <SelectField
              label="Universe Mode"
              value={builderUniverse.mode}
              onchange={(value) => updateUniverse((current) => ({ ...current, mode: value }))}
              options={[
                { value: "auto", label: "Auto-fit" },
                { value: "manual", label: "Manual" },
              ]}
              tooltip="Determines how the simulation bounds are established. Auto-fit tightly envelops all defined geometry objects. Manual requires explicit size definitions."
            />

            <div className="grid grid-cols-3 gap-3">
              <TextField
                key={`size-x-${builderUniverse.size?.[0] ?? "na"}`}
                label="Size X"
                defaultValue={formatNm(builderUniverse.size?.[0])}
                onBlur={(event) => updateVecComponent("size", 0, event.target.value)}
                unit="nm"
                mono
                disabled={builderUniverse.mode !== "manual"}
                tooltip="Explicit bounds of the universe along the X axis."
              />
              <TextField
                key={`size-y-${builderUniverse.size?.[1] ?? "na"}`}
                label="Size Y"
                defaultValue={formatNm(builderUniverse.size?.[1])}
                onBlur={(event) => updateVecComponent("size", 1, event.target.value)}
                unit="nm"
                mono
                disabled={builderUniverse.mode !== "manual"}
                tooltip="Explicit bounds of the universe along the Y axis."
              />
              <TextField
                key={`size-z-${builderUniverse.size?.[2] ?? "na"}`}
                label="Size Z"
                defaultValue={formatNm(builderUniverse.size?.[2])}
                onBlur={(event) => updateVecComponent("size", 2, event.target.value)}
                unit="nm"
                mono
                disabled={builderUniverse.mode !== "manual"}
                tooltip="Explicit bounds of the universe along the Z axis."
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <TextField
                key={`center-x-${builderUniverse.center?.[0] ?? "na"}`}
                label="Center X"
                defaultValue={formatNm(builderUniverse.center?.[0])}
                onBlur={(event) => updateVecComponent("center", 0, event.target.value)}
                unit="nm"
                mono
                tooltip="Optional origin offset for the universe center across the X axis."
              />
              <TextField
                key={`center-y-${builderUniverse.center?.[1] ?? "na"}`}
                label="Center Y"
                defaultValue={formatNm(builderUniverse.center?.[1])}
                onBlur={(event) => updateVecComponent("center", 1, event.target.value)}
                unit="nm"
                mono
                tooltip="Optional origin offset for the universe center across the Y axis."
              />
              <TextField
                key={`center-z-${builderUniverse.center?.[2] ?? "na"}`}
                label="Center Z"
                defaultValue={formatNm(builderUniverse.center?.[2])}
                onBlur={(event) => updateVecComponent("center", 2, event.target.value)}
                unit="nm"
                mono
                tooltip="Optional origin offset for the universe center across the Z axis."
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <TextField
                key={`padding-x-${builderUniverse.padding?.[0] ?? "na"}`}
                label="Padding X"
                defaultValue={formatNm(builderUniverse.padding?.[0])}
                onBlur={(event) => updateVecComponent("padding", 0, event.target.value)}
                unit="nm"
                mono
                tooltip="Extra margin added along the X axis when auto-fitting the universe."
              />
              <TextField
                key={`padding-y-${builderUniverse.padding?.[1] ?? "na"}`}
                label="Padding Y"
                defaultValue={formatNm(builderUniverse.padding?.[1])}
                onBlur={(event) => updateVecComponent("padding", 1, event.target.value)}
                unit="nm"
                mono
                tooltip="Extra margin added along the Y axis when auto-fitting the universe."
              />
              <TextField
                key={`padding-z-${builderUniverse.padding?.[2] ?? "na"}`}
                label="Padding Z"
                defaultValue={formatNm(builderUniverse.padding?.[2])}
                onBlur={(event) => updateVecComponent("padding", 2, event.target.value)}
                unit="nm"
                mono
                tooltip="Extra margin added along the Z axis when auto-fitting the universe."
              />
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border/30 bg-card/30 p-3 text-[0.72rem] leading-relaxed text-muted-foreground">
            {sourceSummary}
          </div>
        )}
      </SidebarSection>

      <SidebarSection title="Live Introspection" defaultOpen={true}>
        <div className="grid grid-cols-2 gap-3">
          <MetricField label="Mode" value={mode ? humanizeToken(mode) : "—"} tooltip="Current universe derivation mode." />
          <MetricField label="Role" value={role} tooltip="The physical significance of the universe box in the active backend." />
          <MetricField label="Declared Size" value={formatVector(declaredSize, "m")} tooltip="Size explicitly declared in the builder." />
          <MetricField label="Effective Extent" value={formatVector(effectiveExtent, "m")} tooltip="Actual size utilized by the simulation engine." />
          <MetricField label="Center" value={formatVector(center, "m")} tooltip="Absolute origin of the universe bounding box." />
          <MetricField
            label="Padding"
            value={hasNonZeroVector(padding) ? formatVector(padding, "m") : "—"}
            tooltip="Calculated padding added around physical objects."
          />
        </div>
      </SidebarSection>

      <SidebarSection title="Metadata" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-3">
          <MetricField label="Builder Surface" value={humanizeToken(builderContract?.scriptApiSurface)} />
          <MetricField label="Editable Scope" value={editable ? "Universe" : "Read-only"} />
        </div>
      </SidebarSection>
    </div>
  );
}
