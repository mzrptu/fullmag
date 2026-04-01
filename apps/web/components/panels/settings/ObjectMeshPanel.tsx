"use client";

import { useCallback, useMemo } from "react";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Eye,
  EyeOff,
  GitCommitHorizontal,
  Layers,
  Loader2,
  MemoryStick,
  Ruler,
  SplitSquareHorizontal,
  Triangle,
} from "lucide-react";

import { cn } from "@/lib/utils";

import MeshSettingsPanel, {
  DEFAULT_MESH_OPTIONS,
  type MeshOptionsState,
  type SizeFieldSpec,
} from "../MeshSettingsPanel";
import { useControlRoom } from "../../runs/control-room/ControlRoomContext";
import { useModel } from "../../runs/control-room/ControlRoomContext";
import { fmtExp, fmtSI, type ViewportMode } from "../../runs/control-room/shared";
import {
  MESH_RENDER_MODE_OPTIONS,
  MESH_WORKSPACE_PRESETS,
  buildMeshPipelinePhases,
  estimateDenseSolverRamGb,
  extractMeshLogHighlights,
} from "../../runs/control-room/meshWorkspace";
import type { RenderMode } from "../../preview/FemMeshView3D";
import { TextField } from "../../ui/TextField";
import SelectField from "../../ui/SelectField";
import { Button } from "../../ui/button";
import type {
  ScriptBuilderPerGeometryMeshEntry,
} from "../../../lib/session/types";
import { findSceneObjectByNodeId } from "./objectSelection";
import { SidebarSection } from "./primitives";
import { HelpTip } from "../../ui/HelpTip";

/* ── Helpers ── */

function createInheritedMeshState(): ScriptBuilderPerGeometryMeshEntry {
  return {
    mode: "inherit",
    hmax: "",
    hmin: "",
    order: null,
    source: null,
    algorithm_2d: null,
    algorithm_3d: null,
    size_factor: null,
    size_from_curvature: null,
    growth_rate: "",
    narrow_regions: null,
    smoothing_steps: null,
    optimize: null,
    optimize_iterations: null,
    compute_quality: null,
    per_element_quality: null,
    size_fields: [],
    operations: [],
    build_requested: false,
  };
}

function mapObjectMeshToOptions(
  mesh: ScriptBuilderPerGeometryMeshEntry | null | undefined,
  globalOptions: MeshOptionsState,
): MeshOptionsState {
  const effective = {
    ...DEFAULT_MESH_OPTIONS,
    ...globalOptions,
  };
  if (!mesh) {
    return effective;
  }
  return {
    ...effective,
    hmax: mesh.hmax.trim().length > 0 ? mesh.hmax : effective.hmax,
    hmin: mesh.hmin.trim().length > 0 ? mesh.hmin : effective.hmin,
    algorithm2d: mesh.algorithm_2d ?? effective.algorithm2d,
    algorithm3d: mesh.algorithm_3d ?? effective.algorithm3d,
    sizeFactor: mesh.size_factor ?? effective.sizeFactor,
    sizeFromCurvature: mesh.size_from_curvature ?? effective.sizeFromCurvature,
    growthRate: mesh.growth_rate.trim().length > 0 ? mesh.growth_rate : effective.growthRate,
    narrowRegions: mesh.narrow_regions ?? effective.narrowRegions,
    smoothingSteps: mesh.smoothing_steps ?? effective.smoothingSteps,
    optimize: mesh.optimize ?? effective.optimize,
    optimizeIters: mesh.optimize_iterations ?? effective.optimizeIters,
    computeQuality: mesh.compute_quality ?? effective.computeQuality,
    perElementQuality: mesh.per_element_quality ?? effective.perElementQuality,
    refinementZones:
      mesh.size_fields.length > 0
        ? mesh.size_fields.map((field) => ({
            kind: field.kind,
            params: field.params as Record<string, string | number | number[]>,
          }))
        : effective.refinementZones,
    adaptiveEnabled: effective.adaptiveEnabled,
    adaptivePolicy: effective.adaptivePolicy,
    adaptiveTheta: effective.adaptiveTheta,
    adaptiveHMin: effective.adaptiveHMin,
    adaptiveHMax: effective.adaptiveHMax,
    adaptiveMaxPasses: effective.adaptiveMaxPasses,
    adaptiveErrorTolerance: effective.adaptiveErrorTolerance,
  };
}

function buildCustomMeshState(
  options: MeshOptionsState,
  current: ScriptBuilderPerGeometryMeshEntry | null | undefined,
  extras: {
    order: number | null;
    source: string | null;
    buildRequested: boolean;
  },
): ScriptBuilderPerGeometryMeshEntry {
  return {
    mode: "custom",
    hmax: options.hmax,
    hmin: options.hmin,
    order: extras.order,
    source: extras.source,
    algorithm_2d: options.algorithm2d,
    algorithm_3d: options.algorithm3d,
    size_factor: options.sizeFactor,
    size_from_curvature: options.sizeFromCurvature,
    growth_rate: options.growthRate,
    narrow_regions: options.narrowRegions,
    smoothing_steps: options.smoothingSteps,
    optimize: options.optimize.trim().length > 0 ? options.optimize : null,
    optimize_iterations: options.optimize.trim().length > 0 ? options.optimizeIters : 1,
    compute_quality: options.computeQuality,
    per_element_quality: options.perElementQuality,
    size_fields: options.refinementZones.map((field: SizeFieldSpec) => ({
      kind: field.kind,
      params: { ...field.params },
    })),
    operations: current?.operations ?? [],
    build_requested: extras.buildRequested,
  };
}

/* ── Component ── */

export default function ObjectMeshPanel({ nodeId }: { nodeId?: string }) {
  const ctx = useControlRoom();
  const model = useModel();

  const { object: sceneObject, index: geoIndex } = useMemo(
    () => findSceneObjectByNodeId(nodeId, model.sceneDocument),
    [model.sceneDocument, nodeId],
  );
  const geo = useMemo(
    () =>
      sceneObject
        ? {
            name: sceneObject.name,
            geometry_kind: sceneObject.geometry.geometry_kind,
            mesh: sceneObject.mesh_override,
            bounds_min: sceneObject.geometry.bounds_min ?? null,
            bounds_max: sceneObject.geometry.bounds_max ?? null,
          }
        : null,
    [sceneObject],
  );

  const updateGeo = useCallback(
    (updater: (mesh: ScriptBuilderPerGeometryMeshEntry | null) => ScriptBuilderPerGeometryMeshEntry | null) => {
      if (geoIndex < 0) {
        return;
      }
      model.setSceneDocument((prev) => {
        if (!prev) {
          return prev;
        }
        const nextObjects = [...prev.objects];
        const target = nextObjects[geoIndex];
        if (target) {
          nextObjects[geoIndex] = {
            ...target,
            mesh_override: updater(target.mesh_override ?? null),
          };
        }
        return {
          ...prev,
          objects: nextObjects,
        };
      });
    },
    [geoIndex, model],
  );

  const mesh = geo?.mesh ?? createInheritedMeshState();
  const effectiveOptions = useMemo(
    () => mapObjectMeshToOptions(geo?.mesh, model.meshOptions),
    [geo?.mesh, model.meshOptions],
  );
  const effectiveOrder = mesh.order ?? model.meshFeOrder ?? null;
  const effectiveSource = mesh.source ?? model.meshSource ?? null;

  /* ── Mesh workspace data from context ── */
  const {
    effectiveFemMesh,
    meshFeOrder,
    meshHmax,
    effectiveViewMode,
    handleViewModeChange,
    meshRenderMode,
    setMeshRenderMode,
    meshClipEnabled,
    setMeshClipEnabled,
    meshClipAxis,
    setMeshClipAxis,
    meshClipPos,
    setMeshClipPos,
    meshOpacity,
    setMeshOpacity,
    meshShowArrows,
    setMeshShowArrows,
    meshQualitySummary,
    meshQualityData,
    meshBoundsMin,
    meshBoundsMax,
    worldExtent,
    meshExtent,
    meshName,
    meshSource,
    mesherBackend,
    mesherSourceKind,
    workspaceStatus,
    engineLog,
    meshWorkspacePreset,
    meshWorkspace,
  } = ctx;

  const meshHighlights = useMemo(() => extractMeshLogHighlights(engineLog), [engineLog]);
  const estimatedRamGb = effectiveFemMesh ? estimateDenseSolverRamGb(effectiveFemMesh.nodes.length) : 0;
  const structuredQualitySummary = meshWorkspace?.mesh_quality_summary ?? null;
  const pipelinePhases = useMemo(
    () =>
      meshWorkspace?.mesh_pipeline_status?.length
        ? meshWorkspace.mesh_pipeline_status
        : buildMeshPipelinePhases({
            engineLog,
            meshSource: meshSource ?? null,
            nodeCount: effectiveFemMesh?.nodes.length ?? 0,
            elementCount: effectiveFemMesh?.elements.length ?? 0,
            meshOptions: ctx.meshOptions,
            meshQualityData,
            workspaceStatus,
          }),
    [ctx.meshOptions, effectiveFemMesh?.elements.length, effectiveFemMesh?.nodes.length, engineLog, meshQualityData, meshSource, meshWorkspace?.mesh_pipeline_status, workspaceStatus],
  );

  const boundsSummary = useMemo(() => {
    // Prefer per-object bounds from geometry entry
    const bMin = geo?.bounds_min ?? meshBoundsMin;
    const bMax = geo?.bounds_max ?? meshBoundsMax;
    if (!bMin || !bMax) return null;
    return {
      x: bMax[0] - bMin[0],
      y: bMax[1] - bMin[1],
      z: bMax[2] - bMin[2],
      bMin,
      bMax,
    };
  }, [geo?.bounds_min, geo?.bounds_max, meshBoundsMin, meshBoundsMax]);

  const viewportModes: ViewportMode[] = ["Mesh", "3D", "2D"];

  function getPhaseStyle(status: "idle" | "active" | "done" | "warning") {
    switch (status) {
      case "done":
        return { css: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: <CheckCircle2 size={13} className="text-emerald-400" /> };
      case "active":
        return { css: "border-primary/40 bg-primary/10 text-primary shadow-[0_0_12px_rgba(59,130,246,0.15)]", icon: <Loader2 size={13} className="animate-spin text-primary" /> };
      case "warning":
        return { css: "border-amber-500/30 bg-amber-500/10 text-amber-300", icon: <AlertTriangle size={13} className="text-amber-400" /> };
      default:
        return { css: "border-border/40 bg-background/40 backdrop-blur-sm text-muted-foreground", icon: <CircleDashed size={13} className="opacity-50" /> };
    }
  }

  /* ── No geometry selected ── */
  if (!geo) {
    return (
      <div className="flex flex-col gap-0 border-t border-border/20">
        <SidebarSection title="Object Mesh" defaultOpen={true}>
          <div className="rounded-lg border border-border/40 bg-card/20 px-3 py-2 text-xs text-muted-foreground">
            Select an object mesh node to edit its local mesh workflow.
          </div>
        </SidebarSection>
      </div>
    );
  }

  /* ── Main render ── */
  return (
    <div className="flex flex-col pt-4 px-2">

      {/* ── Object Header ── */}
      <SidebarSection title="Object Mesh" defaultOpen={true}>
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-border/40 bg-card/20 px-3 py-2.5">
            <div className="text-[0.62rem] font-bold uppercase tracking-widest text-muted-foreground">
              Mesh for Object
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-foreground">{geo.name}</span>
              <span className="rounded-md border border-border/40 bg-background/40 px-2 py-0.5 text-[0.65rem] font-mono text-muted-foreground">
                {geo.geometry_kind}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={mesh.mode === "inherit" ? "default" : "outline"}
              size="sm"
              onClick={() =>
                updateGeo(() => createInheritedMeshState())
              }
            >
              Use Global Mesh
            </Button>
            <Button
              variant={mesh.mode === "custom" ? "default" : "outline"}
              size="sm"
              onClick={() =>
                updateGeo((currentMesh) =>
                  buildCustomMeshState(
                    effectiveOptions,
                    currentMesh,
                    {
                      order: currentMesh?.order ?? model.meshFeOrder ?? null,
                      source: currentMesh?.source ?? model.meshSource ?? null,
                      buildRequested: currentMesh?.build_requested ?? false,
                    },
                  ),
                )
              }
            >
              Customize Mesh
            </Button>
          </div>

          <SelectField
            label="Mesh Mode"
            value={mesh.mode}
            onchange={(value) =>
              updateGeo((currentMesh) =>
                  value === "custom"
                    ? buildCustomMeshState(effectiveOptions, currentMesh, {
                        order: currentMesh?.order ?? model.meshFeOrder ?? null,
                        source: currentMesh?.source ?? model.meshSource ?? null,
                        buildRequested: currentMesh?.build_requested ?? false,
                      })
                    : createInheritedMeshState(),
              )
            }
            options={[
              { label: "Inherit Global", value: "inherit" },
              { label: "Custom Override", value: "custom" },
            ]}
            tooltip="Whether this object inherits the global mesh defaults or uses a custom mesh recipe."
          />

          {mesh.mode === "inherit" && (
            <div className="rounded-lg border border-border/40 bg-card/30 px-3 py-2 text-xs text-muted-foreground">
              This object currently inherits the study-level FEM mesh settings. Switch to
              custom mode to freeze and edit a local mesh recipe for this object only.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <TextField
              key={`${geo.name}-mesh-order-${effectiveOrder ?? ""}`}
              label="FEM Order"
              defaultValue={effectiveOrder != null ? String(effectiveOrder) : ""}
              onchange={(e) => {
                const raw = e.target.value.trim();
                updateGeo((currentMesh) =>
                  buildCustomMeshState(
                    effectiveOptions,
                    currentMesh,
                    {
                      order: raw.length > 0 ? Math.max(1, Math.round(Number(raw) || 1)) : null,
                      source: currentMesh?.source ?? model.meshSource ?? null,
                      buildRequested: currentMesh?.build_requested ?? false,
                    },
                  ),
                );
              }}
              mono
              disabled={mesh.mode !== "custom"}
              placeholder="1"
              tooltip="Finite element polynomial order (P1 = linear, P2 = quadratic)."
            />
            <TextField
              key={`${geo.name}-mesh-source-${effectiveSource ?? ""}`}
              label="Source Mesh"
              defaultValue={effectiveSource ?? ""}
              onchange={(e) => {
                const raw = e.target.value.trim();
                updateGeo((currentMesh) =>
                  buildCustomMeshState(
                    effectiveOptions,
                    currentMesh,
                    {
                      order: currentMesh?.order ?? model.meshFeOrder ?? null,
                      source: raw.length > 0 ? raw : null,
                      buildRequested: currentMesh?.build_requested ?? false,
                    },
                  ),
                );
              }}
              mono
              disabled={mesh.mode !== "custom"}
              placeholder="mesh.msh"
              tooltip="File path to a pre-generated mesh for this object. Leave empty to auto-generate."
            />
          </div>

          <MeshSettingsPanel
            options={effectiveOptions}
            onChange={(nextOptions) =>
              updateGeo((currentMesh) =>
                  mesh.mode === "custom"
                    ? buildCustomMeshState(nextOptions, currentMesh, {
                        order: currentMesh?.order ?? model.meshFeOrder ?? null,
                        source: currentMesh?.source ?? model.meshSource ?? null,
                        buildRequested: currentMesh?.build_requested ?? false,
                      })
                    : currentMesh ?? createInheritedMeshState(),
              )
            }
            quality={meshQualityData}
            generating={ctx.meshGenerating}
            onGenerate={ctx.handleMeshGenerate}
            nodeCount={effectiveFemMesh?.nodes.length}
            disabled={ctx.meshGenerating || !(ctx.awaitingCommand || ctx.isWaitingForCompute)}
            waitMode={ctx.isWaitingForCompute}
            showAdaptiveSection={false}
          />
        </div>
      </SidebarSection>

      {/* ── Inspect & Render ── */}
      <SidebarSection title="Inspect & Render" defaultOpen={true}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            Viewport
            <HelpTip>Switch between Mesh wireframe view, 3D magnetization view, and 2D heatmap view.</HelpTip>
          </span>
          <span className="text-[0.65rem] font-mono text-muted-foreground/70">{meshRenderMode}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {viewportModes.map((mode) => (
            <button
              key={mode}
              type="button"
              className="appearance-none rounded-md border border-border/40 bg-background/50 px-2.5 py-1.5 text-xs font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted/50 data-[active=true]:border-primary/50 data-[active=true]:bg-primary/20 data-[active=true]:text-primary"
              data-active={effectiveViewMode === mode}
              onClick={() => handleViewModeChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {MESH_RENDER_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="appearance-none rounded-md border border-border/40 bg-background/50 px-2.5 py-1.5 text-xs font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted/50 data-[active=true]:border-primary/50 data-[active=true]:bg-primary/20 data-[active=true]:text-primary"
              data-active={meshRenderMode === option.value}
              onClick={() => setMeshRenderMode(option.value as RenderMode)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {/* Clip Plane */}
          <div className="grid gap-2 rounded-lg border border-border/30 bg-background/50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.7rem] font-semibold tracking-wide text-muted-foreground flex items-center gap-1">
                Clip Plane
                <HelpTip>Enable a clipping plane to see inside the volume mesh along a chosen axis.</HelpTip>
              </span>
              <button
                type="button"
                className="rounded-md border border-border/40 bg-background/70 px-2.5 py-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted/50 data-[active=true]:border-primary/50 data-[active=true]:bg-primary/20 data-[active=true]:text-primary"
                data-active={meshClipEnabled}
                onClick={() => setMeshClipEnabled((current) => !current)}
              >
                {meshClipEnabled ? "On" : "Off"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {(["x", "y", "z"] as const).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  className="appearance-none rounded-md border border-border/40 bg-background/70 px-2.5 py-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted/50 data-[active=true]:border-primary/50 data-[active=true]:bg-primary/20 data-[active=true]:text-primary"
                  data-active={meshClipAxis === axis}
                  disabled={!meshClipEnabled}
                  onClick={() => setMeshClipAxis(axis)}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>
            <label className="grid gap-1 text-[0.65rem] text-muted-foreground">
              <span>Position: {Math.round(meshClipPos)}%</span>
              <input
                type="range"
                className="h-[3px] w-full accent-primary"
                min={0}
                max={100}
                value={meshClipPos}
                onChange={(event) => setMeshClipPos(Number(event.target.value))}
                disabled={!meshClipEnabled}
              />
            </label>
          </div>

          {/* Display Controls */}
          <div className="grid gap-2 rounded-lg border border-border/30 bg-background/50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.7rem] font-semibold tracking-wide text-muted-foreground flex items-center gap-1">
                Display
                <HelpTip>Adjust mesh opacity and toggle magnetization arrows on the mesh surface.</HelpTip>
              </span>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md border border-border/40 bg-background/70 px-2.5 py-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted/50 data-[active=true]:border-primary/50 data-[active=true]:bg-primary/20 data-[active=true]:text-primary"
                data-active={meshShowArrows}
                onClick={() => setMeshShowArrows((current) => !current)}
              >
                {meshShowArrows ? <Eye size={12} /> : <EyeOff size={12} />}
                Arrows
              </button>
            </div>
            <label className="grid gap-1 text-[0.65rem] text-muted-foreground">
              <span>Opacity: {meshOpacity}%</span>
              <input
                type="range"
                className="h-[3px] w-full accent-primary"
                min={10}
                max={100}
                value={meshOpacity}
                onChange={(event) => setMeshOpacity(Number(event.target.value))}
              />
            </label>
          </div>
        </div>
      </SidebarSection>

      {/* ── Spatial Summary ── */}
      <SidebarSection title="Topology & Spatial" defaultOpen={true}>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2 transition-colors hover:bg-background/60">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <GitCommitHorizontal size={11} />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider">Nodes</span>
            </div>
            <span className="font-mono text-xs font-semibold text-foreground/90">{effectiveFemMesh?.nodes.length.toLocaleString() ?? "0"}</span>
          </div>
          <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2 transition-colors hover:bg-background/60">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Triangle size={11} />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider">Elements</span>
            </div>
            <span className="font-mono text-xs font-semibold text-foreground/90">{effectiveFemMesh?.elements.length.toLocaleString() ?? "0"}</span>
          </div>
          <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2 transition-colors hover:bg-background/60">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Layers size={11} />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider">Faces</span>
            </div>
            <span className="font-mono text-xs font-semibold text-foreground/90">{effectiveFemMesh?.boundary_faces.length.toLocaleString() ?? "0"}</span>
          </div>
          <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2 transition-colors hover:bg-background/60">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <SplitSquareHorizontal size={11} />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider">FE Order</span>
            </div>
            <span className="font-mono text-xs font-semibold text-foreground/90">{meshFeOrder != null ? `P${meshFeOrder}` : "—"}</span>
          </div>
          <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2 transition-colors hover:bg-background/60">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Ruler size={11} />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider">hmax</span>
            </div>
            <span className="font-mono text-xs font-semibold text-foreground/90">{meshHmax != null ? fmtSI(meshHmax, "m") : "—"}</span>
          </div>
          <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2 transition-colors hover:bg-background/60">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <MemoryStick size={11} />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider">Dense RAM</span>
            </div>
            <span
              className={cn(
                "font-mono text-xs",
                (effectiveFemMesh?.nodes.length ?? 0) > 50_000
                  ? "text-destructive"
                  : (effectiveFemMesh?.nodes.length ?? 0) > 10_000
                    ? "text-amber-400"
                    : "text-emerald-400",
              )}
            >
              {effectiveFemMesh ? `${estimatedRamGb.toFixed(1)} GB` : "—"}
            </span>
          </div>
        </div>
        {boundsSummary && (
          <div className="mt-3 grid gap-1.5 rounded-lg border border-border/30 bg-background/50 p-2.5 text-xs text-foreground">
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <span className="text-[0.65rem] font-bold uppercase text-muted-foreground">Object</span>
              <span className="font-mono text-foreground">{geo.name}</span>
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <span className="text-[0.65rem] font-bold uppercase text-muted-foreground">Extent</span>
              <span className="font-mono">
                {`x=${fmtSI(boundsSummary.x, "m")}  y=${fmtSI(boundsSummary.y, "m")}  z=${fmtSI(boundsSummary.z, "m")}`}
              </span>
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <span className="text-[0.65rem] font-bold uppercase text-muted-foreground">Bounds</span>
              <span className="font-mono truncate" title={`${boundsSummary.bMin.join(", ")} -> ${boundsSummary.bMax.join(", ")}`}>
                {`${boundsSummary.bMin.map((value) => fmtExp(value)).join(", ")} → ${boundsSummary.bMax.map((value) => fmtExp(value)).join(", ")}`}
              </span>
            </div>
          </div>
        )}
      </SidebarSection>

      {/* ── Quality Snapshot ── */}
      <SidebarSection title="Quality Snapshot" defaultOpen={false}>
        <div className="mb-2 flex items-center justify-end">
          <span className="text-[0.65rem] font-mono text-muted-foreground/70">
            {meshQualityData ? "full metrics" : structuredQualitySummary ? "solver metrics" : meshQualitySummary ? "surface estimate" : "pending"}
          </span>
        </div>
        {meshQualityData ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">SICN p5</span>
              <span className="font-mono text-xs font-semibold text-foreground/90">{meshQualityData.sicnP5.toFixed(3)}</span>
            </div>
            <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">SICN Mean</span>
              <span className="font-mono text-xs font-semibold text-foreground/90">{meshQualityData.sicnMean.toFixed(3)}</span>
            </div>
            <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Gamma Min</span>
              <span className="font-mono text-xs font-semibold text-foreground/90">{meshQualityData.gammaMin.toFixed(3)}</span>
            </div>
            <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Elements</span>
              <span className="font-mono text-xs font-semibold text-foreground/90">{meshQualityData.nElements.toLocaleString()}</span>
            </div>
          </div>
        ) : structuredQualitySummary ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">SICN p5</span>
              <span className="font-mono text-xs font-semibold text-foreground/90">{structuredQualitySummary.sicn_p5.toFixed(3)}</span>
            </div>
            <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">SICN Mean</span>
              <span className="font-mono text-xs font-semibold text-foreground/90">{structuredQualitySummary.sicn_mean.toFixed(3)}</span>
            </div>
            <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Gamma Min</span>
              <span className="font-mono text-xs font-semibold text-foreground/90">{structuredQualitySummary.gamma_min.toFixed(3)}</span>
            </div>
            <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Avg Quality</span>
              <span className="font-mono text-xs font-semibold text-foreground/90">{structuredQualitySummary.avg_quality.toFixed(3)}</span>
            </div>
          </div>
        ) : meshQualitySummary ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">AR Min</span>
              <span className="font-mono text-xs font-semibold text-foreground/90">{meshQualitySummary.min.toFixed(2)}</span>
            </div>
            <div className="grid gap-1 rounded-xl border border-border/35 bg-background/40 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">AR Mean</span>
              <span className="font-mono text-xs font-semibold text-foreground/90">{meshQualitySummary.mean.toFixed(2)}</span>
            </div>
            <div className="grid gap-1 rounded-xl border border-border/35 bg-emerald-500/10 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-emerald-500/80">Good Faces</span>
              <span className="font-mono text-xs font-semibold text-emerald-400">{meshQualitySummary.good.toLocaleString()}</span>
            </div>
            <div className="grid gap-1 rounded-xl border border-border/35 bg-amber-500/10 backdrop-blur-sm px-2.5 py-2">
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-amber-500/80">Poor Faces</span>
              <span className="font-mono text-xs font-semibold text-amber-400">{meshQualitySummary.poor.toLocaleString()}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/40 bg-background/30 px-3 py-2 text-[0.75rem] text-muted-foreground">
            Quality metrics not loaded yet. Use the global Optimize preset or enable Extract quality metrics before remeshing.
          </div>
        )}
      </SidebarSection>

      {/* ── Pipeline Feedback ── */}
      <SidebarSection title="Pipeline Feedback" defaultOpen={false}>
        <div className="mb-2 flex items-center justify-end">
          <span className="text-[0.65rem] font-mono text-muted-foreground/70">
            {meshHighlights.length} logs
          </span>
        </div>
        <div className="grid gap-2">
          {pipelinePhases.map((phase) => {
            const render = getPhaseStyle(phase.status);
            return (
              <div
                key={phase.id}
                className={cn("grid gap-1.5 rounded-xl border px-3 py-2.5 transition-colors", render.css)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {render.icon}
                    <span className="text-[0.7rem] font-semibold tracking-wide">{phase.label}</span>
                  </div>
                  <span className="text-[0.62rem] font-mono tracking-widest opacity-70 uppercase">{phase.status}</span>
                </div>
                <div className="text-[0.74rem] leading-snug opacity-90">{phase.detail ?? "—"}</div>
              </div>
            );
          })}
        </div>
        {meshHighlights.length > 0 && (
          <div className="mt-2 grid gap-1 rounded-lg border border-border/30 bg-background/50 p-2.5">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Recent Mesh Log</span>
            <div className="grid gap-1">
              {meshHighlights.slice(0, 6).map((entry) => (
                <div key={`${entry.timestamp_unix_ms}:${entry.message}`} className="grid grid-cols-[56px_1fr] gap-2 text-[0.72rem]">
                  <span className="font-mono uppercase text-muted-foreground">{entry.level}</span>
                  <span className="text-foreground/90">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </SidebarSection>

      {/* ── Workspace Presets ── */}
      <SidebarSection title="Workspace Presets" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          {MESH_WORKSPACE_PRESETS.map((preset) => {
            const active = meshWorkspacePreset === preset.id;
            const disabled = !effectiveFemMesh && preset.id !== "optimize";
            const Icon = preset.icon;
            return (
              <button
                key={preset.id}
                type="button"
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border px-3 py-2.5 text-left transition-all",
                  active
                    ? "border-primary/40 bg-primary/10 shadow-[0_0_0_1px_rgba(59,130,246,0.1)]"
                    : "border-border/40 bg-background/50 hover:bg-muted/50 hover:border-border/80",
                  disabled && "cursor-not-allowed opacity-40 grayscale-[0.8]",
                )}
                disabled={disabled}
                onClick={() => ctx.applyMeshWorkspacePreset(preset.id)}
                title={preset.description}
              >
                <div className="flex items-center gap-1.5">
                  <Icon size={14} className={cn(active ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-[0.7rem] font-semibold tracking-wide", active ? "text-primary" : "text-foreground")}>
                    {preset.shortLabel}
                  </span>
                </div>
                <div className="text-[0.68rem] text-muted-foreground leading-snug line-clamp-2">{preset.description}</div>
              </button>
            );
          })}
        </div>
      </SidebarSection>
    </div>
  );
}
