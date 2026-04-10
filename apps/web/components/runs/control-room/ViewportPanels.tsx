"use client";

import { memo, useMemo, useCallback } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { MAGNETIC_PRESET_CATALOG } from "@/lib/magnetizationPresetCatalog";
import { cn } from "@/lib/utils";
import type { TextureTransform3D as PreviewTextureTransform3D } from "@/lib/textureTransform";
import type { TextureGizmoMode } from "../../preview/TextureTransformGizmo";
import MagnetizationSlice2D from "../../preview/MagnetizationSlice2D";
import MagnetizationView3D from "../../preview/MagnetizationView3D";
import FemMeshView3D from "../../preview/FemMeshView3D";
import { ViewportErrorBoundary } from "../../preview/ViewportErrorBoundary";
import FemMeshSlice2D from "../../preview/FemMeshSlice2D";
import PreviewScalarField2D from "../../preview/PreviewScalarField2D";
import BoundsPreview3D from "../../preview/BoundsPreview3D";
import EmptyState from "../../ui/EmptyState";
import AnalyzeViewport from "./AnalyzeViewport";

import { Slider } from "../../ui/slider";
import { Switch } from "../../ui/switch";
import {
  fmtExp,
  fmtPreviewMaxPoints,
  fmtSI,
  resolveAntennaNodeName,
} from "./shared";
import { useControlRoom, useTransport } from "./ControlRoomContext";
import { DEFAULT_CONVERGENCE_THRESHOLD } from "../../panels/SolverSettingsPanel";
import type {
  TextureTransform3D as SceneTextureTransform3D,
  MeshEntityViewStateMap,
} from "../../../lib/session/types";
import { defaultMeshEntityViewState } from "../../../lib/session/types";

function domainFrameSourceLabel(source: string | null): string {
  switch (source) {
    case "declared_universe_manual":
      return "Declared Universe";
    case "declared_universe_auto_padding":
      return "Auto-Padded Domain";
    case "object_union_bounds":
      return "Object Union Bounds";
    case "mesh_bounds":
      return "Mesh Bounds Fallback";
    default:
      return "Workspace Frame";
  }
}

function visibleVolumeLabel(
  isFemBackend: boolean,
  clipEnabled: boolean,
  clipAxis: "x" | "y" | "z",
  clipPos: number,
): string {
  if (!isFemBackend) {
    return "Full Domain";
  }
  if (!clipEnabled) {
    return "Full Effective Domain";
  }
  return `Clipped ${clipAxis.toUpperCase()} @${Math.round(clipPos)}%`;
}

function toPreviewTextureTransform(value: SceneTextureTransform3D): PreviewTextureTransform3D {
  return {
    translation: [...value.translation] as [number, number, number],
    rotationQuat: [...value.rotation_quat] as [number, number, number, number],
    scale: [...value.scale] as [number, number, number],
    pivot: [...value.pivot] as [number, number, number],
  };
}

function toSceneTextureTransform(value: PreviewTextureTransform3D): SceneTextureTransform3D {
  return {
    translation: [...value.translation] as [number, number, number],
    rotation_quat: [...value.rotationQuat] as [number, number, number, number],
    scale: [...value.scale] as [number, number, number],
    pivot: [...value.pivot] as [number, number, number],
  };
}

function ViewportChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "active" | "warning" | "success";
}) {
  const toneClass =
    tone === "active"
      ? "border-info/25 bg-info/10 text-info"
      : tone === "warning"
        ? "border-warning/25 bg-warning/10 text-warning"
        : tone === "success"
          ? "border-success/25 bg-success/10 text-success"
          : "border-border/35 bg-background/45 text-foreground/85";
  return (
    <div className={cn("inline-flex items-center gap-2 rounded-md border px-2.5 py-1", toneClass)}>
      <span className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[0.68rem] leading-none">{value}</span>
    </div>
  );
}

export const ViewportBar = memo(function ViewportBar() {
  const ctx = useControlRoom();
  const spatialPreview = ctx.preview?.kind === "spatial" ? ctx.preview : null;
  const selectedDisplayIsGlobalScalar =
    ctx.preview?.kind === "global_scalar" || ctx.quantityDescriptor?.kind === "global_scalar";
  const frameLabel = domainFrameSourceLabel(ctx.worldExtentSource);
  const visibleLabel = visibleVolumeLabel(
    ctx.isFemBackend,
    ctx.meshClipEnabled,
    ctx.meshClipAxis,
    ctx.meshClipPos,
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/20 bg-card/10 px-3 py-2 shrink-0">
      {ctx.isMeshWorkspaceView ? (
        <>
          <ViewportChip label="Mesh" value={ctx.meshName ?? "boundary surface"} />
          <ViewportChip
            label="State"
            value={
              ctx.meshGenerating
                ? "Building"
                : ctx.meshConfigDirty
                  ? "Last Built"
                  : "Up to Date"
            }
            tone={
              ctx.meshGenerating
                ? "active"
                : ctx.meshConfigDirty
                  ? "warning"
                  : "success"
            }
          />
          <ViewportChip
            label="Topology"
            value={`${ctx.effectiveFemMesh?.nodes.length.toLocaleString() ?? "0"} n · ${ctx.effectiveFemMesh?.elements.length.toLocaleString() ?? "0"} tets`}
          />
          <ViewportChip
            label="Render"
            value={ctx.meshRenderMode === "surface+edges" ? "Surface + Edges" : ctx.meshRenderMode}
          />
          <ViewportChip label="Workspace" value={ctx.meshWorkspacePreset.replaceAll("-", " ")} />
          {ctx.isFemBackend && <ViewportChip label="Frame" value={frameLabel} />}
          <ViewportChip
            label="Visible"
            value={visibleLabel}
            tone={ctx.meshClipEnabled ? "warning" : "default"}
          />
          {ctx.meshSelection.primaryFaceIndex != null && (
            <ViewportChip label="Face" value={`#${ctx.meshSelection.primaryFaceIndex}`} />
          )}
          {ctx.meshConfigDirty && !ctx.meshGenerating && (
            <div className="text-[0.72rem] text-warning/90">
              Viewport shows the last built mesh until you rebuild.
            </div>
          )}
        </>
      ) : !ctx.isFemBackend && ctx.isMeshWorkspaceView ? (
        /* FDM geometry bar */
        <>
          <ViewportChip label="Geometry" value={`${ctx.solverGrid[0]}×${ctx.solverGrid[1]}×${ctx.solverGrid[2]}`} />
          <ViewportChip label="Cells" value={ctx.totalCells?.toLocaleString() ?? "—"} />
          {ctx.activeMaskPresent && (
            <ViewportChip label="Active" value={ctx.activeCells?.toLocaleString() ?? "—"} />
          )}
        </>
      ) : (
        <>
          {ctx.isVectorQuantity && (
            <>
              <ViewportChip
                label="Quantity"
                value={ctx.quantityDescriptor?.label ?? ctx.selectedQuantity}
              />
              {ctx.previewControlsActive ? (
                <Select
                  value={ctx.requestedPreviewComponent}
                  onValueChange={(val) => void ctx.updatePreview("/component", { component: val })}
                  disabled={ctx.previewBusy}
                >
                  <SelectTrigger className="h-8 min-w-[88px] border-border/35 bg-background/45 text-[0.72rem] justify-between">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3D">3D</SelectItem>
                    <SelectItem value="x">x</SelectItem>
                    <SelectItem value="y">y</SelectItem>
                    <SelectItem value="z">z</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={ctx.component}
                  onValueChange={(val) => ctx.setComponent(val as any)}
                >
                  <SelectTrigger className="h-8 min-w-[88px] border-border/35 bg-background/45 text-[0.72rem] justify-between">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="magnitude">|v|</SelectItem>
                    <SelectItem value="x">x</SelectItem>
                    <SelectItem value="y">y</SelectItem>
                    <SelectItem value="z">z</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </>
          )}

          {ctx.previewControlsActive && !selectedDisplayIsGlobalScalar && (
            <>
              <span className="text-[0.68rem] text-muted-foreground">Every</span>
              <Select
                value={String(ctx.requestedPreviewEveryN)}
                onValueChange={(val) => void ctx.updatePreview("/everyN", { everyN: Number(val) })}
                disabled={ctx.previewBusy}
              >
                <SelectTrigger className="h-8 min-w-[84px] border-border/35 bg-background/45 text-[0.72rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ctx.previewEveryNOptions.map((val) => (
                    <SelectItem key={val} value={String(val)}>{val}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[0.68rem] text-muted-foreground">Points</span>
              <Select
                value={String(ctx.requestedPreviewMaxPoints)}
                onValueChange={(val) => void ctx.updatePreview("/maxPoints", { maxPoints: Number(val) })}
                disabled={ctx.previewBusy}
              >
                <SelectTrigger className="h-8 min-w-[94px] border-border/35 bg-background/45 text-[0.72rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ctx.previewMaxPointOptions.map((val) => (
                    <SelectItem key={val} value={String(val)}>{fmtPreviewMaxPoints(val)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}

          {ctx.isFemBackend && (
            <>
              <ViewportChip label="Frame" value={frameLabel} />
              <ViewportChip
                label="Visible"
                value={visibleLabel}
                tone={ctx.meshClipEnabled ? "warning" : "default"}
              />
            </>
          )}

          {spatialPreview ? (
            <>
              {spatialPreview.x_possible_sizes.length > 0 &&
                spatialPreview.y_possible_sizes.length > 0 && (
                <>
                  <span className="text-[0.68rem] text-muted-foreground">X</span>
                  <Select
                    value={String(ctx.requestedPreviewXChosenSize)}
                    onValueChange={(val) => void ctx.updatePreview("/XChosenSize", { xChosenSize: Number(val) })}
                    disabled={ctx.previewBusy}
                  >
                    <SelectTrigger className="h-8 min-w-[72px] border-border/35 bg-background/45 text-[0.72rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {spatialPreview.x_possible_sizes.map((size) => (
                        <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[0.68rem] text-muted-foreground">Y</span>
                  <Select
                    value={String(ctx.requestedPreviewYChosenSize)}
                    onValueChange={(val) => void ctx.updatePreview("/YChosenSize", { yChosenSize: Number(val) })}
                    disabled={ctx.previewBusy}
                  >
                    <SelectTrigger className="h-8 min-w-[72px] border-border/35 bg-background/45 text-[0.72rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {spatialPreview.y_possible_sizes.map((size) => (
                        <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              <label className="inline-flex items-center gap-1.5 text-[0.65rem] text-muted-foreground [accent-color:hsl(var(--primary))]">
                <input
                  type="checkbox"
                  checked={ctx.requestedPreviewAutoScale}
                  onChange={(e) =>
                    void ctx.updatePreview("/autoScaleEnabled", {
                      autoScaleEnabled: e.target.checked,
                    })
                  }
                  disabled={ctx.previewBusy}
                />
                <span>Auto-fit</span>
              </label>
              {spatialPreview.spatial_kind === "grid" && ctx.solverGrid[2] > 1 && (
                <>
                  <ViewportChip
                    label="Z Slice"
                    value={ctx.requestedPreviewAllLayers ? "Average" : `${ctx.requestedPreviewLayer}/${ctx.solverGrid[2] - 1}`}
                  />
                  <Slider
                    className="w-24 shrink-0"
                    min={0}
                    max={Math.max(ctx.solverGrid[2] - 1, 0)}
                    step={1}
                    value={[ctx.requestedPreviewLayer]}
                    onValueChange={(v) => void ctx.updatePreview("/layer", { layer: v[0] })}
                    disabled={ctx.previewBusy || ctx.requestedPreviewAllLayers}
                  />
                  <label className="inline-flex items-center gap-1.5 text-[0.65rem] text-muted-foreground cursor-pointer select-none">
                    <Switch
                      checked={ctx.requestedPreviewAllLayers}
                      onCheckedChange={(checked) =>
                        void ctx.updatePreview("/allLayers", { allLayers: checked })
                      }
                      disabled={ctx.previewBusy}
                      className="h-4 w-7 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted"
                    />
                    <span>Average</span>
                  </label>
                </>
              )}
              {spatialPreview.spatial_kind === "mesh" && ctx.effectiveViewMode === "2D" && (
                <>
                  <span className="text-[0.68rem] text-muted-foreground">Plane</span>
                  <Select value={ctx.plane} onValueChange={(val) => ctx.setPlane(val as any)}>
                    <SelectTrigger className="h-8 min-w-[78px] bg-background/45 border-border/35 text-[0.72rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="xy">XY</SelectItem>
                      <SelectItem value="xz">XZ</SelectItem>
                      <SelectItem value="yz">YZ</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-[0.68rem] text-muted-foreground">Slice</span>
                  <Select value={String(ctx.sliceIndex)} onValueChange={(val) => ctx.setSliceIndex(Number(val))}>
                    <SelectTrigger className="h-8 min-w-[72px] bg-background/45 border-border/35 text-[0.72rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: ctx.maxSliceCount }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>{i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </>
          ) : ctx.effectiveViewMode === "2D" && (
            <>
              <span className="text-[0.68rem] text-muted-foreground">Plane</span>
              <Select value={ctx.plane} onValueChange={(val) => ctx.setPlane(val as any)}>
                <SelectTrigger className="h-8 min-w-[78px] bg-background/45 border-border/35 text-[0.72rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xy">XY</SelectItem>
                  <SelectItem value="xz">XZ</SelectItem>
                  <SelectItem value="yz">YZ</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-[0.68rem] text-muted-foreground">Slice</span>
              <Select value={String(ctx.sliceIndex)} onValueChange={(val) => ctx.setSliceIndex(Number(val))}>
                <SelectTrigger className="h-8 min-w-[72px] bg-background/45 border-border/35 text-[0.72rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: ctx.maxSliceCount }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>{i + 1}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </>
      )}
    </div>
  );
});

/* ── Telemetry HUD: subscribes only to transport context ── */
const TelemetryHUD = memo(function TelemetryHUD({ solverSettings }: { solverSettings: { torqueTolerance?: string | number } }) {
  const transport = useTransport();
  return (
    <div className="viewportOverlay absolute top-3 left-1/2 -translate-x-1/2 flex items-center justify-center gap-4 z-10 pointer-events-none text-center font-mono text-[0.7rem] font-bold tracking-wide text-foreground/80 bg-background/60 backdrop-blur-md px-5 py-1.5 rounded-full border border-border/30 shadow-md">
      <span>Step {transport.effectiveStep.toLocaleString()}</span>
      <span>{fmtSI(transport.effectiveTime, "s")}</span>
      {transport.effectiveDmDt > 0 && (
        <span className={cn(transport.effectiveDmDt < (Number(solverSettings.torqueTolerance) || DEFAULT_CONVERGENCE_THRESHOLD) ? "text-emerald-400" : "text-amber-400")}>
          dm/dt {fmtExp(transport.effectiveDmDt)}
        </span>
      )}
    </div>
  );
});

export const ViewportCanvasArea = memo(function ViewportCanvasArea() {
  const ctx = useControlRoom();
  const setSelectedObjectId = ctx.setSelectedObjectId;
  const setSelectedSidebarNodeId = ctx.setSelectedSidebarNodeId;
  const meshParts = ctx.meshParts;
  const setMeshEntityViewState = ctx.setMeshEntityViewState;
  const spatialPreview = ctx.preview?.kind === "spatial" ? ctx.preview : null;
  const globalScalarPreview = ctx.preview?.kind === "global_scalar" ? ctx.preview : null;
  const hasVectorData = Boolean(ctx.selectedVectors && ctx.selectedVectors.length > 0);
  const selectedMagnetizationAsset = useMemo(() => {
    if (!ctx.sceneDocument || !ctx.selectedObjectId) {
      return null;
    }
    const selectedObject = ctx.sceneDocument.objects.find(
      (object) =>
        object.id === ctx.selectedObjectId || object.name === ctx.selectedObjectId,
    );
    if (!selectedObject) {
      return null;
    }
    return (
      ctx.sceneDocument.magnetization_assets.find(
        (asset) => asset.id === selectedObject.magnetization_ref,
      ) ?? null
    );
  }, [ctx.sceneDocument, ctx.selectedObjectId]);
  const activeTextureTransform =
    selectedMagnetizationAsset?.kind === "preset_texture" && ctx.activeTransformScope === "texture"
      ? toPreviewTextureTransform(selectedMagnetizationAsset.texture_transform)
      : null;
  const activeTexturePreviewProxy =
    selectedMagnetizationAsset?.preset_kind
      ? (
          MAGNETIC_PRESET_CATALOG.find(
            (descriptor) => descriptor.kind === selectedMagnetizationAsset.preset_kind,
          )?.previewProxy ?? "box"
        )
      : "box";
  const activeTextureGizmoMode: TextureGizmoMode =
    ctx.sceneDocument?.editor.gizmo_mode === "rotate"
      ? "rotate"
      : ctx.sceneDocument?.editor.gizmo_mode === "scale"
        ? "scale"
        : "translate";
  const applyTextureTransform = (next: PreviewTextureTransform3D) => {
    if (!ctx.selectedObjectId) {
      return;
    }
    ctx.setSceneDocument((previousScene) => {
      if (!previousScene) {
        return previousScene;
      }
      const selectedObject = previousScene.objects.find(
        (object) =>
          object.id === ctx.selectedObjectId || object.name === ctx.selectedObjectId,
      );
      if (!selectedObject) {
        return previousScene;
      }
      return {
        ...previousScene,
        magnetization_assets: previousScene.magnetization_assets.map((asset) =>
          asset.id === selectedObject.magnetization_ref
            ? {
                ...asset,
                texture_transform: toSceneTextureTransform(next),
              }
            : asset,
        ),
        editor: {
          ...previousScene.editor,
          active_transform_scope: "texture",
        },
      };
    });
  };

  const handleRequestObjectSelect = useCallback(
    (objectId: string) => {
      setSelectedObjectId(objectId);
      setSelectedSidebarNodeId(`obj-${objectId}`);
    },
    [setSelectedObjectId, setSelectedSidebarNodeId],
  );

  const selectedAntennaName = resolveAntennaNodeName(
    ctx.selectedSidebarNodeId,
    ctx.scriptBuilderCurrentModules.map((module) => module.name),
  );
  const visibleObjectIds = useMemo(
    () =>
      (ctx.sceneDocument?.objects ?? [])
        .filter((object) => object.visible !== false)
        .map((object) => object.name || object.id)
        .filter((id) => id.length > 0),
    [ctx.sceneDocument?.objects],
  );
  const antennaPreviewBadgeVisible =
    ctx.antennaOverlays.length > 0 &&
    (ctx.requestedPreviewQuantity === "H_ant" || selectedAntennaName != null);
  const selectedFemObjectId = ctx.selectedObjectId;
  const selectedObjectOverlay = useMemo(
    () =>
      selectedFemObjectId
        ? ctx.objectOverlays.find((overlay) => overlay.id === selectedFemObjectId) ?? null
        : null,
    [ctx.objectOverlays, selectedFemObjectId],
  );
  const displayObjectOverlays = useMemo(
    () => {
      if (ctx.isFemBackend && ctx.meshParts.length > 0) {
        return ctx.objectOverlays.filter((overlay) =>
          ctx.visibleMagneticObjectIds.includes(overlay.id),
        );
      }
      return ctx.objectOverlays.filter((overlay) => visibleObjectIds.includes(overlay.id));
    },
    [ctx.isFemBackend, ctx.meshParts.length, ctx.objectOverlays, ctx.visibleMagneticObjectIds, visibleObjectIds],
  );
  const patchMeshPartViewState = useCallback(
    (partIds: string[], patch: Partial<MeshEntityViewStateMap[string]>) => {
      if (partIds.length === 0) {
        return;
      }
      setMeshEntityViewState((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const partId of partIds) {
          const part = meshParts.find((candidate) => candidate.id === partId);
          const current = next[partId] ?? (part ? defaultMeshEntityViewState(part) : null);
          if (!current) continue;
          const updated = { ...current, ...patch };
          if (
            !next[partId] ||
            updated.visible !== current.visible ||
            updated.renderMode !== current.renderMode ||
            updated.opacity !== current.opacity ||
            updated.colorField !== current.colorField
          ) {
            next[partId] = updated;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [meshParts, setMeshEntityViewState],
  );
  const femQuantityOptions = useMemo(
    () =>
      ctx.previewQuantityOptions.map((option) => ({
        id: option.value,
        shortLabel: option.label,
        label: option.label,
        available: !option.disabled,
      })),
    [ctx.previewQuantityOptions],
  );
  const handlePreviewMaxPointsChange = useCallback(
    (nextMaxPoints: number) => void ctx.updatePreview("/maxPoints", { maxPoints: nextMaxPoints }),
    [ctx.updatePreview],
  );
  const hasExactScopeSegment = useMemo(
    () => {
      if (!selectedFemObjectId) {
        return false;
      }
      const meshParts = ctx.effectiveFemMesh?.mesh_parts ?? [];
      if (meshParts.length > 0) {
        return meshParts.some(
          (part) => part.role === "magnetic_object" && part.object_id === selectedFemObjectId,
        );
      }
      return (ctx.effectiveFemMesh?.object_segments ?? []).some(
        (segment) => segment.object_id === selectedFemObjectId,
      );
    },
    [ctx.effectiveFemMesh?.mesh_parts, ctx.effectiveFemMesh?.object_segments, selectedFemObjectId],
  );
  const missingExactScopeSegment = Boolean(
    ctx.isFemBackend &&
      ctx.femMeshData &&
      ctx.femMeshData.nElements > 0 &&
      selectedFemObjectId &&
      !hasExactScopeSegment,
  );

  /* ── Determine which viewport is active ── */
  const isFdm3DActive =
    ctx.effectiveViewMode === "3D" &&
    !ctx.isFemBackend &&
    (ctx.isVectorQuantity || hasVectorData) &&
    !globalScalarPreview;
  // Use classic FDM mesh view ONLY if no unstructured mesh data is available
  const isFdmMeshActive = ctx.effectiveViewMode === "Mesh" && !ctx.isFemBackend && !ctx.femMeshData;
  const showFdm3D = isFdm3DActive || isFdmMeshActive;
  const showFemBoundsPreview =
    ctx.isFemBackend &&
    !ctx.femMeshData &&
    (ctx.effectiveViewMode === "3D" || ctx.effectiveViewMode === "Mesh") &&
    displayObjectOverlays.length > 0;

  /* ── Determine what goes into the conditional slot ── */
  let conditionalContent: React.ReactNode = null;

  if (globalScalarPreview) {
    conditionalContent = (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="flex min-w-[280px] max-w-[520px] flex-col gap-4 rounded-2xl border border-border/50 bg-card/70 p-8 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="space-y-1">
            <p className="text-[0.68rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Global Scalar
            </p>
            <h3 className="text-base font-semibold text-foreground">
              {ctx.quantityDescriptor?.label ?? globalScalarPreview.quantity}
            </h3>
          </div>
          <div className="font-mono text-lg font-medium tracking-tight text-foreground">
            {fmtExp(globalScalarPreview.value)}
          </div>
          <div className="flex flex-wrap gap-3 text-[0.72rem] text-muted-foreground">
            <span>{globalScalarPreview.unit}</span>
            <span>step {globalScalarPreview.source_step.toLocaleString()}</span>
            <span>{fmtSI(globalScalarPreview.source_time, "s")}</span>
          </div>
        </div>
      </div>
    );
  } else if (!ctx.isVectorQuantity && !hasVectorData && !ctx.femMeshData) {
    conditionalContent = (
      <div className="flex flex-col items-center justify-center h-full w-full opacity-60">
        <EmptyState
          title={ctx.quantityDescriptor?.label ?? "Scalar quantity"}
          description={
            ctx.selectedScalarValue !== null
              ? `Latest: ${ctx.selectedScalarValue.toExponential(4)} ${ctx.quantityDescriptor?.unit ?? ""}`
              : "Scalar — see Scalars in sidebar."
          }
          tone="info"
          compact
        />
      </div>
    );
  } else if (
    spatialPreview &&
    spatialPreview.spatial_kind === "grid" &&
    spatialPreview.type === "2D" &&
    spatialPreview.scalar_field.length > 0
  ) {
    conditionalContent = (
      <PreviewScalarField2D
        data={spatialPreview.scalar_field}
        grid={spatialPreview.preview_grid}
        quantityLabel={ctx.quantityDescriptor?.label ?? spatialPreview.quantity}
        quantityUnit={spatialPreview.unit}
        component={spatialPreview.component}
        min={spatialPreview.min}
        max={spatialPreview.max}
      />
    );
  } else if (ctx.effectiveViewMode === "Mesh" && ctx.femMeshData) {
    conditionalContent = (
      <ViewportErrorBoundary label="FEM Mesh Viewport">
      <FemMeshView3D
        topologyKey={ctx.femTopologyKey ?? undefined}
        meshData={ctx.femMeshData}
        quantityId={ctx.requestedPreviewQuantity}
        quantityOptions={femQuantityOptions}
        colorField="none"
        toolbarMode="visible" // Mesh workspace should show tools!
        renderMode={ctx.meshRenderMode}
        opacity={ctx.meshOpacity}
        clipEnabled={ctx.meshClipEnabled}
        clipAxis={ctx.meshClipAxis}
        clipPos={ctx.meshClipPos}
        previewMaxPoints={ctx.requestedPreviewMaxPoints}
        onRenderModeChange={ctx.setMeshRenderMode}
        onOpacityChange={ctx.setMeshOpacity}
        onClipEnabledChange={ctx.setMeshClipEnabled}
        onClipAxisChange={ctx.setMeshClipAxis}
        onClipPosChange={ctx.setMeshClipPos}
        onPreviewMaxPointsChange={handlePreviewMaxPointsChange}
        onSelectionChange={ctx.setMeshSelection}
        onRefine={ctx.handleLassoRefine}
        antennaOverlays={ctx.antennaOverlays}
        selectedAntennaId={selectedAntennaName}
        objectOverlays={displayObjectOverlays}
        selectedObjectId={selectedFemObjectId}
        selectedEntityId={ctx.selectedEntityId}
        focusedEntityId={ctx.focusedEntityId}
        objectViewMode={ctx.objectViewMode}
        objectSegments={ctx.effectiveFemMesh?.object_segments ?? []}
        meshParts={ctx.meshParts}
        elementMarkers={ctx.effectiveFemMesh?.element_markers ?? null}
        perDomainQuality={ctx.effectiveFemMesh?.per_domain_quality ?? null}
        meshEntityViewState={ctx.meshEntityViewState}
        onMeshPartViewStatePatch={patchMeshPartViewState}
        visibleObjectIds={visibleObjectIds}
        airSegmentVisible={ctx.airMeshVisible}
        airSegmentOpacity={ctx.airMeshOpacity}
        focusObjectRequest={ctx.focusObjectRequest}
        onAntennaTranslate={ctx.applyAntennaTranslation}
        worldExtent={ctx.worldExtent}
        worldCenter={ctx.worldCenter}
        onEntitySelect={ctx.setSelectedEntityId}
        onEntityFocus={ctx.setFocusedEntityId}
        onQuantityChange={ctx.requestPreviewQuantity}
        activeTextureTransform={activeTextureTransform}
        textureGizmoMode={activeTextureGizmoMode}
        activeTexturePreviewProxy={activeTexturePreviewProxy}
        activeTransformScope={ctx.activeTransformScope}
        onTextureTransformChange={applyTextureTransform}
        onTextureTransformCommit={applyTextureTransform}
      />
      </ViewportErrorBoundary>
    );
  } else if (ctx.effectiveViewMode === "3D" && ctx.femMeshData) {
    conditionalContent = (
      <ViewportErrorBoundary label="FEM 3D Viewport">
      <FemMeshView3D
        topologyKey={ctx.femTopologyKey ?? undefined}
        meshData={ctx.femMeshData}
        fieldLabel={ctx.quantityDescriptor?.label ?? ctx.selectedQuantity}
        quantityId={ctx.requestedPreviewQuantity}
        quantityOptions={femQuantityOptions}
        colorField={ctx.femColorField}
        showOrientationLegend={ctx.femMagnetization3DActive}
        renderMode={ctx.meshRenderMode}
        opacity={ctx.meshOpacity}
        clipEnabled={ctx.meshClipEnabled}
        clipAxis={ctx.meshClipAxis}
        clipPos={ctx.meshClipPos}
        showArrows={ctx.femShouldShowArrows}
        arrowColorMode={ctx.femArrowColorMode}
        arrowMonoColor={ctx.femArrowMonoColor}
        arrowAlpha={ctx.femArrowAlpha}
        arrowLengthScale={ctx.femArrowLengthScale}
        arrowThickness={ctx.femArrowThickness}
        vectorDomainFilter={ctx.femVectorDomainFilter}
        ferromagnetVisibilityMode={ctx.femFerromagnetVisibilityMode}
        previewMaxPoints={ctx.requestedPreviewMaxPoints}
        onRenderModeChange={ctx.setMeshRenderMode}
        onOpacityChange={ctx.setMeshOpacity}
        onClipEnabledChange={ctx.setMeshClipEnabled}
        onClipAxisChange={ctx.setMeshClipAxis}
        onClipPosChange={ctx.setMeshClipPos}
        onShowArrowsChange={ctx.setMeshShowArrows}
        onArrowColorModeChange={ctx.setFemArrowColorMode}
        onArrowMonoColorChange={ctx.setFemArrowMonoColor}
        onArrowAlphaChange={ctx.setFemArrowAlpha}
        onArrowLengthScaleChange={ctx.setFemArrowLengthScale}
        onArrowThicknessChange={ctx.setFemArrowThickness}
        onVectorDomainFilterChange={ctx.setFemVectorDomainFilter}
        onFerromagnetVisibilityModeChange={ctx.setFemFerromagnetVisibilityMode}
        onPreviewMaxPointsChange={handlePreviewMaxPointsChange}
        onSelectionChange={ctx.setMeshSelection}
        antennaOverlays={ctx.antennaOverlays}
        selectedAntennaId={selectedAntennaName}
        objectOverlays={displayObjectOverlays}
        selectedObjectId={selectedFemObjectId}
        selectedEntityId={ctx.selectedEntityId}
        focusedEntityId={ctx.focusedEntityId}
        objectViewMode={ctx.objectViewMode}
        objectSegments={ctx.effectiveFemMesh?.object_segments ?? []}
        meshParts={ctx.meshParts}
        elementMarkers={ctx.effectiveFemMesh?.element_markers ?? null}
        perDomainQuality={ctx.effectiveFemMesh?.per_domain_quality ?? null}
        meshEntityViewState={ctx.meshEntityViewState}
        onMeshPartViewStatePatch={patchMeshPartViewState}
        visibleObjectIds={visibleObjectIds}
        airSegmentVisible={ctx.airMeshVisible}
        airSegmentOpacity={ctx.airMeshOpacity}
        focusObjectRequest={ctx.focusObjectRequest}
        onAntennaTranslate={ctx.applyAntennaTranslation}
        worldExtent={ctx.worldExtent}
        worldCenter={ctx.worldCenter}
        onQuantityChange={ctx.requestPreviewQuantity}
        activeTextureTransform={activeTextureTransform}
        textureGizmoMode={activeTextureGizmoMode}
        activeTexturePreviewProxy={activeTexturePreviewProxy}
        activeTransformScope={ctx.activeTransformScope}
        onTextureTransformChange={applyTextureTransform}
        onTextureTransformCommit={applyTextureTransform}
      />
      </ViewportErrorBoundary>
    );
  } else if (ctx.effectiveViewMode === "2D" && ctx.femMeshData) {
    conditionalContent = (
      <FemMeshSlice2D
        meshData={ctx.femMeshData}
        quantityLabel={ctx.quantityDescriptor?.label ?? ctx.selectedQuantity}
        quantityId={ctx.selectedQuantity}
        component={ctx.effectiveVectorComponent}
        plane={ctx.plane}
        sliceIndex={ctx.sliceIndex}
        sliceCount={ctx.maxSliceCount}
        antennaOverlays={ctx.antennaOverlays}
        selectedAntennaId={selectedAntennaName}
      />
    );
  } else if (ctx.effectiveViewMode === "2D" && !showFdm3D) {
    conditionalContent = (
      <MagnetizationSlice2D
        grid={ctx.previewGrid}
        vectors={ctx.selectedVectors}
        quantityLabel={ctx.quantityDescriptor?.label ?? spatialPreview?.quantity ?? ctx.selectedQuantity}
        quantityId={spatialPreview?.quantity ?? ctx.selectedQuantity}
        component={ctx.component}
        plane={ctx.plane}
        sliceIndex={ctx.sliceIndex}
      />
    );
  } else if (ctx.effectiveViewMode === "Analyze") {
    conditionalContent = <AnalyzeViewport />;
  } else if (showFemBoundsPreview) {
    conditionalContent = (
      <BoundsPreview3D
        objectOverlays={displayObjectOverlays}
        selectedObjectId={selectedFemObjectId}
        focusObjectRequest={ctx.focusObjectRequest}
        worldExtent={ctx.worldExtent}
        worldCenter={ctx.worldCenter}
        onRequestObjectSelect={handleRequestObjectSelect}
        onGeometryTranslate={ctx.applyGeometryTranslation}
      />
    );
  } else if (!showFdm3D) {
    conditionalContent = (
      <div className="flex flex-col items-center justify-center h-full w-full opacity-60">
        <EmptyState
          title={ctx.emptyStateMessage.title}
          description={ctx.emptyStateMessage.description}
          tone="info"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 min-w-0 relative overflow-hidden [&>*]:min-w-0 [&>*]:min-h-0 [&>*:not(.viewportOverlay)]:flex-1 [&>*:not(.viewportOverlay)]:w-full">
      <TelemetryHUD solverSettings={ctx.solverSettings} />
      {antennaPreviewBadgeVisible ? (
        <div className="viewportOverlay absolute right-3 top-3 z-10 rounded-full border border-cyan-400/25 bg-background/70 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-cyan-200 shadow-md backdrop-blur-md">
          physics 2.5D · preview extruded
        </div>
      ) : null}
      {ctx.isFemBackend ? (
        <div className="viewportOverlay absolute right-3 top-14 z-10 flex items-center gap-2">
          <div className="pointer-events-auto rounded-full border border-border/40 bg-background/75 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground shadow-md backdrop-blur-md">
            {ctx.visibleMeshPartIds.length}/{ctx.meshParts.length || 0} parts visible
          </div>
          {ctx.selectedMeshPart || selectedFemObjectId ? (
            <div className="pointer-events-auto flex overflow-hidden rounded-full border border-border/40 bg-background/75 shadow-md backdrop-blur-md">
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] transition-colors",
                  ctx.objectViewMode === "context"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
                onClick={() => ctx.setObjectViewMode("context")}
              >
                Context
              </button>
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] transition-colors",
                  ctx.objectViewMode === "isolate"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
                onClick={() => ctx.setObjectViewMode("isolate")}
              >
                Isolate
              </button>
            </div>
          ) : null}
          {selectedFemObjectId ? (
            <button
              type="button"
              className="pointer-events-auto rounded-full border border-amber-300/25 bg-background/75 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-amber-100 shadow-md backdrop-blur-md transition-colors hover:bg-amber-400/15"
              onClick={() => {
                ctx.setViewMode("3D");
                ctx.requestFocusObject(selectedFemObjectId);
              }}
            >
              Focus {selectedFemObjectId}
            </button>
          ) : null}
          {ctx.selectedMeshPart ? (
            <div className="pointer-events-auto rounded-full border border-amber-300/25 bg-background/75 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-amber-100 shadow-md backdrop-blur-md">
              {ctx.selectedMeshPart.role === "air"
                ? "Airbox Selected"
                : ctx.selectedMeshPart.label || ctx.selectedMeshPart.id}
            </div>
          ) : null}
          {ctx.focusedMeshPart ? (
            <div className="pointer-events-auto rounded-full border border-cyan-300/25 bg-background/75 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-cyan-100 shadow-md backdrop-blur-md">
              Part: {ctx.focusedMeshPart.label || ctx.focusedMeshPart.id}
            </div>
          ) : null}
          {missingExactScopeSegment ? (
            <div className="pointer-events-auto rounded-full border border-rose-300/25 bg-background/80 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-rose-200 shadow-md backdrop-blur-md">
              Missing exact object segmentation
            </div>
          ) : null}
        </div>
      ) : ctx.selectedObjectId ? (
        <div className="viewportOverlay absolute right-3 top-14 z-10 flex items-center gap-2">
          <button
            type="button"
            className="pointer-events-auto rounded-full border border-amber-300/25 bg-background/75 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-amber-100 shadow-md backdrop-blur-md transition-colors hover:bg-amber-400/15"
            onClick={() => {
              ctx.setViewMode("3D");
              ctx.requestFocusObject(ctx.selectedObjectId!);
            }}
          >
            Focus {ctx.selectedObjectId}
          </button>
          <div className="pointer-events-auto flex overflow-hidden rounded-full border border-border/40 bg-background/75 shadow-md backdrop-blur-md">
            <button
              type="button"
              className={cn(
                "px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] transition-colors",
                ctx.objectViewMode === "context"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
              onClick={() => ctx.setObjectViewMode("context")}
            >
              Context
            </button>
            <button
              type="button"
              className={cn(
                "px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] transition-colors",
                ctx.objectViewMode === "isolate"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
              onClick={() => ctx.setObjectViewMode("isolate")}
            >
              Isolate
            </button>
          </div>
          <div className="pointer-events-auto rounded-full border border-border/40 bg-background/75 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground shadow-md backdrop-blur-md">
            {selectedObjectOverlay?.source === "mesh_parts"
              ? "Mesh Part"
              : selectedObjectOverlay?.source === "object_segments"
                ? "Legacy Segment"
                : "Bounds Fallback"}
          </div>
        </div>
      ) : null}

      {showFdm3D ? (
        <div className="absolute inset-0">
          <ViewportErrorBoundary label="FDM 3D Viewport">
          <MagnetizationView3D
            grid={ctx.previewGrid}
            vectors={isFdm3DActive ? ctx.selectedVectors : null}
            fieldLabel={
              isFdmMeshActive
                ? "Geometry"
                : ctx.quantityDescriptor?.label ?? spatialPreview?.quantity ?? ctx.selectedQuantity
            }
            geometryMode={isFdmMeshActive}
            activeMask={ctx.activeMask}
            worldExtent={ctx.worldExtent}
            objectOverlays={ctx.objectOverlays}
            selectedObjectId={ctx.selectedObjectId}
            universeCenter={ctx.worldCenter}
            focusObjectRequest={ctx.focusObjectRequest}
            objectViewMode={ctx.objectViewMode}
            settings={ctx.fdmVisualizationSettings}
            onSettingsChange={ctx.setFdmVisualizationSettings}
            onAntennaTranslate={ctx.applyAntennaTranslation}
            onGeometryTranslate={ctx.applyGeometryTranslation}
            onRequestObjectSelect={handleRequestObjectSelect}
            activeTextureTransform={activeTextureTransform}
            textureGizmoMode={activeTextureGizmoMode}
            activeTexturePreviewProxy={activeTexturePreviewProxy}
            onTextureTransformChange={applyTextureTransform}
            onTextureTransformCommit={applyTextureTransform}
            activeTransformScope={ctx.activeTransformScope}
            onTransformScopeChange={(scope) => ctx.setActiveTransformScope(scope)}
            viewportVisible={showFdm3D}
          />
          </ViewportErrorBoundary>
        </div>
      ) : null}

      {/* ── Conditionally-rendered non-GL viewports ── */}
      {conditionalContent}
    </div>
  );
});
