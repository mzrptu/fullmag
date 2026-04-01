"use client";

import { useMemo, useCallback } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { cn } from "@/lib/utils";
import MagnetizationSlice2D from "../../preview/MagnetizationSlice2D";
import MagnetizationView3D from "../../preview/MagnetizationView3D";
import FemMeshView3D from "../../preview/FemMeshView3D";
import FemMeshSlice2D from "../../preview/FemMeshSlice2D";
import PreviewScalarField2D from "../../preview/PreviewScalarField2D";
import EmptyState from "../../ui/EmptyState";
import AnalyzeViewport from "./AnalyzeViewport";

import { Slider } from "../../ui/slider";
import { Switch } from "../../ui/switch";
import {
  fmtExp,
  fmtPreviewMaxPoints,
  fmtSI,
  resolveAntennaNodeName,
  resolveSelectedMeshObjectId,
} from "./shared";
import { useControlRoom } from "./ControlRoomContext";
import { DEFAULT_CONVERGENCE_THRESHOLD } from "../../panels/SolverSettingsPanel";

export function ViewportBar() {
  const ctx = useControlRoom();
  const spatialPreview = ctx.preview?.kind === "spatial" ? ctx.preview : null;
  const selectedDisplayIsGlobalScalar =
    ctx.preview?.kind === "global_scalar" || ctx.quantityDescriptor?.kind === "global_scalar";

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-card/20 backdrop-blur-xl border-b border-border/20 z-20 shadow-sm shrink-0">
      {ctx.isMeshWorkspaceView ? (
        <>
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Mesh</span>
          <span className="font-mono text-[0.65rem] text-muted-foreground">{ctx.meshName ?? "boundary surface"}</span>
          <span className="w-[1px] h-4 bg-border/40 shrink-0" />
          <span className="font-mono text-[0.65rem] text-muted-foreground">{ctx.effectiveFemMesh?.nodes.length.toLocaleString() ?? "0"} nodes</span>
          <span className="font-mono text-[0.65rem] text-muted-foreground">{ctx.effectiveFemMesh?.elements.length.toLocaleString() ?? "0"} tets</span>
          <span className="font-mono text-[0.65rem] text-muted-foreground">{ctx.effectiveFemMesh?.boundary_faces.length.toLocaleString() ?? "0"} faces</span>
          <span className="w-[1px] h-4 bg-border/40 shrink-0" />
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Render</span>
          <span className="font-mono text-[0.65rem] text-muted-foreground">
            {ctx.meshRenderMode === "surface+edges" ? "surface+edges" : ctx.meshRenderMode}
          </span>
          <span className="w-[1px] h-4 bg-border/40 shrink-0" />
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Preset</span>
          <span className="font-mono text-[0.65rem] text-muted-foreground">
            {ctx.meshWorkspacePreset.replaceAll("-", " ")}
          </span>
          {ctx.meshClipEnabled && (
            <>
              <span className="w-[1px] h-4 bg-border/40 shrink-0" />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Clip</span>
              <span className="font-mono text-[0.65rem] text-amber-300">
                {ctx.meshClipAxis.toUpperCase()} @{Math.round(ctx.meshClipPos)}%
              </span>
            </>
          )}
          {ctx.meshSelection.primaryFaceIndex != null && (
            <>
              <span className="w-[1px] h-4 bg-border/40 shrink-0" />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Face</span>
              <span className="font-mono text-[0.65rem] text-muted-foreground">#{ctx.meshSelection.primaryFaceIndex}</span>
            </>
          )}
        </>
      ) : ctx.isMeshWorkspaceView && !ctx.isFemBackend ? (
        /* FDM geometry bar */
        <>
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Geometry</span>
          <span className="font-mono text-[0.65rem] text-muted-foreground">
            {ctx.solverGrid[0]}×{ctx.solverGrid[1]}×{ctx.solverGrid[2]}
          </span>
          <span className="w-[1px] h-4 bg-border/40 shrink-0" />
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Cells</span>
          <span className="font-mono text-[0.65rem] text-muted-foreground">
            {ctx.totalCells?.toLocaleString() ?? "—"}
          </span>
          {ctx.activeMaskPresent && (
            <>
              <span className="w-[1px] h-4 bg-border/40 shrink-0" />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Active</span>
              <span className="font-mono text-[0.65rem] text-muted-foreground">
                {ctx.activeCells?.toLocaleString() ?? "—"}
              </span>
            </>
          )}
        </>
      ) : (
        <>
          {ctx.isVectorQuantity && (
            <>
              <span className="w-[1px] h-4 bg-border/40 shrink-0" />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Comp</span>
              {ctx.previewControlsActive ? (
                <Select
                  value={ctx.requestedPreviewComponent}
                  onValueChange={(val) => void ctx.updatePreview("/component", { component: val })}
                  disabled={ctx.previewBusy}
                >
                  <SelectTrigger className="h-6 w-[60px] border-border/40 bg-card/30 text-[0.65rem] justify-between">
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
                  <SelectTrigger className="h-6 w-[60px] border-border/40 bg-card/30 text-[0.65rem] justify-between">
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
              <span className="w-[1px] h-4 bg-border/40 shrink-0" />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Every</span>
              <Select
                value={String(ctx.requestedPreviewEveryN)}
                onValueChange={(val) => void ctx.updatePreview("/everyN", { everyN: Number(val) })}
                disabled={ctx.previewBusy}
              >
                <SelectTrigger className="h-6 w-[60px] border-border/40 bg-card/30 text-[0.65rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ctx.previewEveryNOptions.map((val) => (
                    <SelectItem key={val} value={String(val)}>{val}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Pts</span>
              <Select
                value={String(ctx.requestedPreviewMaxPoints)}
                onValueChange={(val) => void ctx.updatePreview("/maxPoints", { maxPoints: Number(val) })}
                disabled={ctx.previewBusy}
              >
                <SelectTrigger className="h-6 w-[70px] border-border/40 bg-card/30 text-[0.65rem]">
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

          {spatialPreview ? (
            <>
              {spatialPreview.x_possible_sizes.length > 0 &&
                spatialPreview.y_possible_sizes.length > 0 && (
                <>
                  <span className="w-[1px] h-4 bg-border/40 shrink-0" />
                  <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">X</span>
                  <Select
                    value={String(ctx.requestedPreviewXChosenSize)}
                    onValueChange={(val) => void ctx.updatePreview("/XChosenSize", { xChosenSize: Number(val) })}
                    disabled={ctx.previewBusy}
                  >
                    <SelectTrigger className="h-6 w-[60px] border-border/40 bg-card/30 text-[0.65rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {spatialPreview.x_possible_sizes.map((size) => (
                        <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Y</span>
                  <Select
                    value={String(ctx.requestedPreviewYChosenSize)}
                    onValueChange={(val) => void ctx.updatePreview("/YChosenSize", { yChosenSize: Number(val) })}
                    disabled={ctx.previewBusy}
                  >
                    <SelectTrigger className="h-6 w-[60px] border-border/40 bg-card/30 text-[0.65rem]">
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
                  <span className="w-[1px] h-4 bg-border/40 shrink-0" />
                  <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Z-Slice</span>
                  <span className="font-mono text-[0.65rem] tabular-nums text-muted-foreground min-w-[2.5rem] text-center">
                    {ctx.requestedPreviewAllLayers ? "avg" : `${ctx.requestedPreviewLayer}/${ctx.solverGrid[2] - 1}`}
                  </span>
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
                  <span className="w-[1px] h-4 bg-border/40 shrink-0" />
                  <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Plane</span>
                  <Select value={ctx.plane} onValueChange={(val) => ctx.setPlane(val as any)}>
                    <SelectTrigger className="h-6 w-16 bg-card/30 border-border/40 text-[0.65rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="xy">XY</SelectItem>
                      <SelectItem value="xz">XZ</SelectItem>
                      <SelectItem value="yz">YZ</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Slice</span>
                  <Select value={String(ctx.sliceIndex)} onValueChange={(val) => ctx.setSliceIndex(Number(val))}>
                    <SelectTrigger className="h-6 min-w-[3.5rem] bg-card/30 border-border/40 text-[0.65rem]">
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
              <span className="w-[1px] h-4 bg-border/40 shrink-0" />
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Plane</span>
              <Select value={ctx.plane} onValueChange={(val) => ctx.setPlane(val as any)}>
                <SelectTrigger className="h-6 w-16 bg-card/30 border-border/40 text-[0.65rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xy">XY</SelectItem>
                  <SelectItem value="xz">XZ</SelectItem>
                  <SelectItem value="yz">YZ</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded-sm">Slice</span>
              <Select value={String(ctx.sliceIndex)} onValueChange={(val) => ctx.setSliceIndex(Number(val))}>
                <SelectTrigger className="h-6 min-w-[3.5rem] bg-card/30 border-border/40 text-[0.65rem]">
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
}

export function ViewportCanvasArea() {
  const ctx = useControlRoom();
  const spatialPreview = ctx.preview?.kind === "spatial" ? ctx.preview : null;
  const globalScalarPreview = ctx.preview?.kind === "global_scalar" ? ctx.preview : null;
  const hasVectorData = Boolean(ctx.selectedVectors && ctx.selectedVectors.length > 0);

  const handleRequestObjectSelect = useCallback(
    (objectId: string) => {
      ctx.setSelectedObjectId(objectId);
      ctx.setSelectedSidebarNodeId(`obj-${objectId}`);
    },
    [ctx],
  );

  const selectedAntennaName = resolveAntennaNodeName(
    ctx.selectedSidebarNodeId,
    ctx.scriptBuilderCurrentModules.map((module) => module.name),
  );
  const selectedMeshObjectId = resolveSelectedMeshObjectId(
    ctx.selectedSidebarNodeId,
    ctx.modelBuilderGraph,
  );
  const antennaPreviewBadgeVisible =
    ctx.antennaOverlays.length > 0 &&
    (ctx.requestedPreviewQuantity === "H_ant" || selectedAntennaName != null);

  /* ── Determine which viewport is active ── */
  const isFdm3DActive =
    ctx.effectiveViewMode === "3D" &&
    !ctx.isFemBackend &&
    (ctx.isVectorQuantity || hasVectorData) &&
    !globalScalarPreview;
  // Use classic FDM mesh view ONLY if no unstructured mesh data is available
  const isFdmMeshActive = ctx.effectiveViewMode === "Mesh" && !ctx.isFemBackend && !ctx.femMeshData;
  const showFdm3D = isFdm3DActive || isFdmMeshActive;

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
      <FemMeshView3D
        topologyKey={ctx.femTopologyKey ?? undefined}
        meshData={ctx.femMeshData}
        colorField="none"
        toolbarMode="visible" // Mesh workspace should show tools!
        renderMode={ctx.meshRenderMode}
        opacity={ctx.meshOpacity}
        clipEnabled={ctx.meshClipEnabled}
        clipAxis={ctx.meshClipAxis}
        clipPos={ctx.meshClipPos}
        onRenderModeChange={ctx.setMeshRenderMode}
        onOpacityChange={ctx.setMeshOpacity}
        onClipEnabledChange={ctx.setMeshClipEnabled}
        onClipAxisChange={ctx.setMeshClipAxis}
        onClipPosChange={ctx.setMeshClipPos}
        onSelectionChange={ctx.setMeshSelection}
        onRefine={ctx.handleLassoRefine}
        antennaOverlays={ctx.antennaOverlays}
        selectedAntennaId={selectedAntennaName}
        objectOverlays={ctx.objectOverlays}
        focusObjectRequest={ctx.focusObjectRequest}
        objectViewMode={ctx.objectViewMode}
        onAntennaTranslate={ctx.applyAntennaTranslation}
        onGeometryTranslate={ctx.applyGeometryTranslation}
        onRequestObjectSelect={handleRequestObjectSelect}
        worldExtent={ctx.worldExtent}
        worldCenter={ctx.worldCenter}
      />
    );
  } else if (ctx.effectiveViewMode === "3D" && ctx.femMeshData) {
    conditionalContent = (
      <FemMeshView3D
        topologyKey={ctx.femTopologyKey ?? undefined}
        meshData={ctx.femMeshData}
        fieldLabel={ctx.quantityDescriptor?.label ?? ctx.selectedQuantity}
        colorField={ctx.femColorField}
        showOrientationLegend={ctx.femMagnetization3DActive}
        renderMode={ctx.meshRenderMode}
        opacity={ctx.meshOpacity}
        clipEnabled={ctx.meshClipEnabled}
        clipAxis={ctx.meshClipAxis}
        clipPos={ctx.meshClipPos}
        showArrows={ctx.femShouldShowArrows}
        onRenderModeChange={ctx.setMeshRenderMode}
        onOpacityChange={ctx.setMeshOpacity}
        onClipEnabledChange={ctx.setMeshClipEnabled}
        onClipAxisChange={ctx.setMeshClipAxis}
        onClipPosChange={ctx.setMeshClipPos}
        onShowArrowsChange={ctx.setMeshShowArrows}
        onSelectionChange={ctx.setMeshSelection}
        antennaOverlays={ctx.antennaOverlays}
        selectedAntennaId={selectedAntennaName}
        objectOverlays={ctx.objectOverlays}
        selectedObjectId={ctx.selectedObjectId}
        focusObjectRequest={ctx.focusObjectRequest}
        objectViewMode={ctx.objectViewMode}
        onAntennaTranslate={ctx.applyAntennaTranslation}
        onGeometryTranslate={ctx.applyGeometryTranslation}
        onRequestObjectSelect={handleRequestObjectSelect}
        worldExtent={ctx.worldExtent}
        worldCenter={ctx.worldCenter}
      />
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
      <div className="viewportOverlay absolute top-3 left-1/2 -translate-x-1/2 flex items-center justify-center gap-4 z-10 pointer-events-none text-center font-mono text-[0.7rem] font-bold tracking-wide text-foreground/80 bg-background/60 backdrop-blur-md px-5 py-1.5 rounded-full border border-border/30 shadow-md">
        <span>Step {ctx.effectiveStep.toLocaleString()}</span>
        <span>{fmtSI(ctx.effectiveTime, "s")}</span>
        {ctx.effectiveDmDt > 0 && (
          <span className={cn(ctx.effectiveDmDt < (Number(ctx.solverSettings.torqueTolerance) || DEFAULT_CONVERGENCE_THRESHOLD) ? "text-emerald-400" : "text-amber-400")}>
            dm/dt {fmtExp(ctx.effectiveDmDt)}
          </span>
        )}
      </div>
      {antennaPreviewBadgeVisible ? (
        <div className="viewportOverlay absolute right-3 top-3 z-10 rounded-full border border-cyan-400/25 bg-background/70 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-cyan-200 shadow-md backdrop-blur-md">
          physics 2.5D · preview extruded
        </div>
      ) : null}
      {ctx.selectedObjectId ? (
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
        </div>
      ) : null}

      {/* ── Always-mounted FDM 3D Canvas ──
       * The R3F <Canvas> holds a WebGL context and camera state that is extremely
       * expensive to recreate. We keep MagnetizationView3D always in the DOM and
       * toggle visibility via CSS, preventing GL context destruction on data swaps. */}
      <div className={cn("absolute inset-0", showFdm3D ? "block" : "hidden")}>
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
          onAntennaTranslate={ctx.applyAntennaTranslation}
          onGeometryTranslate={ctx.applyGeometryTranslation}
          onRequestObjectSelect={handleRequestObjectSelect}
        />
      </div>

      {/* ── Conditionally-rendered non-GL viewports ── */}
      {conditionalContent}
    </div>
  );
}
