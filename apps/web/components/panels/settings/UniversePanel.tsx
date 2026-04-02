"use client";

import { useCallback, useMemo } from "react";

import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import type { ScriptBuilderUniverseState } from "../../../lib/session/types";
import { fmtSI } from "../../runs/control-room/shared";
import SelectField from "../../ui/SelectField";
import { TextField } from "../../ui/TextField";
import { Button } from "../../ui/button";
import { MetricField, SidebarSection, StatusBadge, ToggleRow, CompactInputGrid } from "./primitives";
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
  const selectedNodeId = ctx.selectedSidebarNodeId ?? "universe";
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
      airbox_hmax: manifestUniverse.airbox_hmax ?? null,
    };
  }, [ctx.scriptBuilderUniverse, manifestUniverse]);
  const editable = Boolean(
    builderContract?.editableScopes.includes("universe") && builderUniverse,
  );

  const declaredSize = builderUniverse?.size ?? null;
  const worldExtent = ctx.worldExtent ?? declaredSize;
  const meshExtent = ctx.meshExtent ?? null;
  const center = builderUniverse?.center ?? ctx.worldCenter ?? null;
  const padding = builderUniverse?.padding ?? null;
  const mode = builderUniverse?.mode ?? (worldExtent ? "derived" : null);
  const role = ctx.isFemBackend
    ? "Declared universe / workspace framing"
    : "FDM world box / grid domain";
  const sourceSummary = builderUniverse
    ? (ctx.isFemBackend
        ? "Explicit `study.universe(...)` captured by the builder manifest. In the current FEM pipeline this is treated as declared workspace framing, not a guaranteed outer air box."
        : "Explicit `study.universe(...)` captured by the builder manifest.")
    : ctx.isFemBackend && ctx.worldExtentSource === "declared_universe_manual"
      ? "The current FEM world box comes from previously captured universe metadata. It is shown as declared framing, not as a guaranteed solver air box."
    : ctx.isFemBackend && ctx.worldExtentSource === "object_union_bounds"
      ? `No explicit universe in the script yet; the control room is framing the FEM world from ${ctx.objectOverlays.length} object bounds.`
    : ctx.isFemBackend && ctx.worldExtentSource === "declared_universe_auto_padding"
        ? "No manual universe size in the script yet; the control room is deriving the world box from object bounds plus declared padding."
    : ctx.isFemBackend && ctx.worldExtentSource === "mesh_bounds"
      ? "Object bounds are not available, so the control room is falling back to the realized FEM mesh bounds for workspace framing."
    : ctx.isFemBackend && ctx.objectOverlays.length > 0
      ? `No explicit universe in the script yet; deriving the FEM world frame from ${ctx.objectOverlays.length} object bounds.`
    : worldExtent
      ? "No explicit universe in the script yet; using the current declared world/grid extent for control-room framing."
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
  const formatPercent = (value: number | null | undefined): string =>
    value == null || !Number.isFinite(value) ? "" : Math.round(value).toString();
  const updateEntityViewState = useCallback(
    (entityId: string, patch: Partial<(typeof ctx.meshEntityViewState)[string]>) => {
      ctx.setMeshEntityViewState((prev) => {
        const current = prev[entityId];
        if (!current) return prev;
        return { ...prev, [entityId]: { ...current, ...patch } };
      });
    },
    [ctx],
  );
  const airViewState = ctx.airPart ? ctx.meshEntityViewState[ctx.airPart.id] : null;
  const showAirboxPanel = selectedNodeId === "universe-airbox";
  const showBoundaryPanel = selectedNodeId === "universe-boundary";
  const showGlobalMeshPanel =
    selectedNodeId === "universe-mesh" ||
    selectedNodeId === "universe-mesh-view" ||
    selectedNodeId === "universe-mesh-size" ||
    selectedNodeId === "universe-mesh-quality" ||
    selectedNodeId === "universe-mesh-pipeline";
  const showUniverseOverview = [
    "universe",
    "universe-domain-frame",
    "universe-effective-size",
    "universe-size",
    "universe-center",
    "universe-padding",
    "universe-role",
  ].includes(selectedNodeId);
  const canRebuildAirbox =
    !ctx.meshGenerating &&
    !ctx.scriptSyncBusy &&
    (ctx.awaitingCommand || ctx.isWaitingForCompute);
  const handleAirboxRebuild = useCallback(async () => {
    if (editable && builderUniverse) {
      await ctx.syncScriptBuilder();
    }
    await ctx.handleMeshGenerate();
  }, [builderUniverse, ctx, editable]);

  return (
    <>
      {showUniverseOverview ? (
      <SidebarSection title="General Properties" icon="⚙" defaultOpen={true}>
        <div className="flex flex-col gap-2">
          {editable && builderUniverse ? (
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
          ) : (
            <div className="rounded-lg border border-border/30 bg-card/30 p-3 text-[0.72rem] leading-relaxed text-muted-foreground">
              {sourceSummary}
            </div>
          )}
          <div className="flex items-center gap-3 pt-1">
            <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground/80 min-w-[4.5rem]">
              Backend
            </span>
            <StatusBadge label={ctx.isFemBackend ? "FEM" : "FDM"} tone="accent" />
          </div>
        </div>
      </SidebarSection>
      ) : null}

      {showUniverseOverview ? (
      <SidebarSection title="Domain Extent" icon="📐" defaultOpen={true}>
        {editable && builderUniverse ? (
          <div className="flex flex-col gap-3">
            <CompactInputGrid
              label="Size (nm)"
              fields={[
                { label: "X", value: formatNm(builderUniverse.size?.[0]), onChange: (v) => updateVecComponent("size", 0, v), disabled: builderUniverse.mode !== "manual" },
                { label: "Y", value: formatNm(builderUniverse.size?.[1]), onChange: (v) => updateVecComponent("size", 1, v), disabled: builderUniverse.mode !== "manual" },
                { label: "Z", value: formatNm(builderUniverse.size?.[2]), onChange: (v) => updateVecComponent("size", 2, v), disabled: builderUniverse.mode !== "manual" },
              ]}
            />
            <CompactInputGrid
              label="Center (nm)"
              fields={[
                { label: "X", value: formatNm(builderUniverse.center?.[0]), onChange: (v) => updateVecComponent("center", 0, v) },
                { label: "Y", value: formatNm(builderUniverse.center?.[1]), onChange: (v) => updateVecComponent("center", 1, v) },
                { label: "Z", value: formatNm(builderUniverse.center?.[2]), onChange: (v) => updateVecComponent("center", 2, v) },
              ]}
            />
            <CompactInputGrid
              label="Padding (nm)"
              fields={[
                { label: "X", value: formatNm(builderUniverse.padding?.[0]), onChange: (v) => updateVecComponent("padding", 0, v) },
                { label: "Y", value: formatNm(builderUniverse.padding?.[1]), onChange: (v) => updateVecComponent("padding", 1, v) },
                { label: "Z", value: formatNm(builderUniverse.padding?.[2]), onChange: (v) => updateVecComponent("padding", 2, v) },
              ]}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-border/30 bg-card/30 p-3 text-[0.72rem] leading-relaxed text-muted-foreground">
            Universe extent is read-only in this context.
          </div>
        )}
      </SidebarSection>
      ) : null}

      {ctx.isFemBackend && (showUniverseOverview || showAirboxPanel) ? (
        <SidebarSection title="Airbox Mesh" icon="🌐" defaultOpen={true}>
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2.5 text-[0.68rem] leading-relaxed text-cyan-100/90">
              Shared-domain FEM still builds one conformal solver mesh for airbox + ferromagnetyki.
              `Airbox Hmax` steruje tylko docelową gęstością regionu powietrza; przy interfejsach generator nadal zagęszcza siatkę wokół ciał magnetycznych.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                key={`airbox-hmax-${builderUniverse?.airbox_hmax ?? "auto"}`}
                label="Airbox Hmax (nm)"
                defaultValue={formatNm(builderUniverse?.airbox_hmax)}
                onBlur={(event) => {
                  if (!editable || !builderUniverse) return;
                  const value = event.target.value;
                  const trimmed = value.trim();
                  if (trimmed.length === 0) {
                    updateUniverse((current) => ({ ...current, airbox_hmax: null }));
                    return;
                  }
                  const parsed = Number(trimmed);
                  if (!Number.isFinite(parsed) || parsed <= 0) return;
                  updateUniverse((current) => ({
                    ...current,
                    airbox_hmax: parsed * 1e-9,
                  }));
                }}
                disabled={!editable}
                tooltip="Declared maximum tetrahedron size for the airbox domain. Leave blank to keep automatic grading."
              />
              <MetricField
                label="Airbox Nodes"
                value={ctx.airPart ? ctx.airPart.node_count.toLocaleString() : "—"}
                tooltip="Current node count in the airbox partition of the realized shared-domain mesh."
              />
              <MetricField
                label="Airbox Elements"
                value={ctx.airPart ? ctx.airPart.element_count.toLocaleString() : "—"}
                tooltip="Current tetrahedron count in the airbox partition of the realized shared-domain mesh."
              />
              <TextField
                key={`airbox-opacity-${ctx.airMeshOpacity}`}
                label="Airbox Opacity (%)"
                defaultValue={formatPercent(ctx.airMeshOpacity)}
                onBlur={(event) => {
                  const parsed = Number(event.target.value);
                  if (!Number.isFinite(parsed)) return;
                  ctx.setAirMeshOpacity(Math.max(5, Math.min(100, Math.round(parsed))));
                }}
                tooltip="Viewport-only opacity for the Universe / airbox mesh in FEM domain view."
              />
            </div>
            <ToggleRow
              label="Show Airbox Mesh"
              checked={ctx.airMeshVisible}
              onChange={ctx.setAirMeshVisible}
            />
            {airViewState ? (
              <SelectField
                label="Airbox Style"
                value={airViewState.renderMode}
                onchange={(value) =>
                  updateEntityViewState(ctx.airPart!.id, {
                    renderMode: value as typeof airViewState.renderMode,
                  })}
                options={[
                  { value: "wireframe", label: "Wireframe" },
                  { value: "surface", label: "Surface" },
                  { value: "surface+edges", label: "Surface + Edges" },
                  { value: "points", label: "Points" },
                ]}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="solid"
                disabled={!canRebuildAirbox}
                onClick={() => void handleAirboxRebuild()}
              >
                {ctx.meshGenerating || ctx.scriptSyncBusy ? "Working..." : "Sync + Rebuild Airbox Mesh"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={ctx.scriptSyncBusy}
                onClick={() => void ctx.syncScriptBuilder()}
              >
                Sync Script
              </Button>
            </div>
            <div className="text-[0.68rem] text-muted-foreground">
              {ctx.scriptSyncMessage
                ?? (canRebuildAirbox
                  ? "You can change `airbox_hmax` here and rebuild the shared-domain mesh."
                  : "Mesh rebuild is available when the workspace is awaiting a command or waiting for compute.")}
            </div>
          </div>
        </SidebarSection>
      ) : null}

      {ctx.isFemBackend && showBoundaryPanel ? (
        <SidebarSection title="Outer Boundary" icon="🔲" defaultOpen={true}>
          <div className="flex flex-col gap-3">
            <SelectField
              label="BC Kind"
              value="robin"
              onchange={() => {}}
              disabled={true}
              options={[
                { value: "dirichlet", label: "Dirichlet" },
                { value: "robin", label: "Robin" },
                { value: "shell", label: "Shell Transform" },
              ]}
            />
            <MetricField label="Status" value="Solver-controlled" />
          </div>
        </SidebarSection>
      ) : null}

      {showGlobalMeshPanel ? (
        <SidebarSection title="Domain Mesh" icon="◫" defaultOpen={true}>
          <div className="rounded-lg border border-border/30 bg-card/30 p-3 text-[0.72rem] leading-relaxed text-muted-foreground">
            In the shared-domain FEM flow this node is now only diagnostic.
            Use `Universe → Airbox` to tune the airbox mesh and use each object's `Mesh` panel for local magnetic-body overrides.
          </div>
        </SidebarSection>
      ) : null}

      {showUniverseOverview ? (
      <SidebarSection title="Universe Summary" icon="📊" defaultOpen={true}>
        <div className="grid grid-cols-2 gap-3">
          <MetricField label="Mode" value={mode ? humanizeToken(mode) : "—"} tooltip="Current universe derivation mode." />
          <MetricField label="Role" value={role} tooltip="How this box should be interpreted in the active backend." />
          <MetricField label="Declared Size" value={formatVector(declaredSize, "m")} tooltip="Size explicitly declared in the builder." />
          <MetricField label="World Extent" value={formatVector(worldExtent, "m")} tooltip="Declared or derived workspace/world framing used by the control room." />
          <MetricField label="Mesh Extent" value={formatVector(meshExtent, "m")} tooltip="Bounding-box extent of the currently realized mesh." />
          <MetricField label="Center" value={formatVector(center, "m")} tooltip="Absolute origin of the universe bounding box." />
          <MetricField
            label="Padding"
            value={hasNonZeroVector(padding) ? formatVector(padding, "m") : "—"}
            tooltip="Calculated padding added around physical objects."
          />
        </div>
      </SidebarSection>
      ) : null}
    </>
  );
}
