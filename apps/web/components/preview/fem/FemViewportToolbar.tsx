"use client";

import {
  Box,
  Grid3X3,
  Grid2X2,
  Grip,
  Palette,
  Scissors,
  Eye,
  ArrowUpRight,
  Video,
  Camera,
  Layers,
} from "lucide-react";
import { ViewportToolbar3D } from "../ViewportToolbar3D";
import { ViewportToolGroup, ViewportToolSeparator } from "../ViewportToolGroup";
import { ViewportIconAction } from "../ViewportIconAction";
import { ViewportPopoverPanel, ViewportPopoverRow } from "../ViewportPopoverPanel";
import { ViewportStatusChip } from "../ViewportStatusChips";
import type { FemColorField, RenderMode, ClipAxis } from "../FemMeshView3D";
import type { FemViewportNavigation, FemViewportProjection } from "./FemViewportTypes";
import type { ViewportQualityProfileId } from "../shared/viewportQualityProfiles";

export interface FemViewportToolbarProps {
  renderMode: RenderMode;
  surfaceColorField: FemColorField;
  arrowColorField: FemColorField;
  projection: FemViewportProjection;
  navigation: FemViewportNavigation;
  qualityProfile: ViewportQualityProfileId;
  clipEnabled: boolean;
  clipAxis: ClipAxis;
  clipPos: number;
  arrowsVisible: boolean;
  arrowDensity: number;
  opacity: number;
  shrinkFactor: number;
  showShrink: boolean;
  labeledMode: boolean;
  legendOpen: boolean;
  partExplorerOpen: boolean;
  visiblePartsCount?: number;
  totalPartsCount?: number;
  hasField?: boolean;
  fieldLabel?: string;
  openPopover: string | null;
  onOpenPopoverChange: (id: string | null) => void;
  onRenderModeChange: (value: RenderMode) => void;
  onSurfaceColorFieldChange: (value: FemColorField) => void;
  onArrowColorFieldChange: (value: FemColorField) => void;
  onProjectionChange: (value: FemViewportProjection) => void;
  onNavigationChange: (value: FemViewportNavigation) => void;
  onQualityProfileChange: (value: ViewportQualityProfileId) => void;
  onClipEnabledChange: (value: boolean) => void;
  onClipAxisChange: (value: ClipAxis) => void;
  onClipPosChange: (value: number) => void;
  onArrowsVisibleChange: (value: boolean) => void;
  onArrowDensityChange: (value: number) => void;
  onOpacityChange: (value: number) => void;
  onShrinkFactorChange: (value: number) => void;
  onLabeledModeChange: (value: boolean) => void;
  onToggleLegend: () => void;
  onTogglePartExplorer: () => void;
  onCameraPreset: (view: "reset" | "front" | "top" | "right") => void;
  onCapture: () => void;
  // quantity selector (optional)
  quantityId?: string;
  quantityOptions?: Array<{ id: string; shortLabel: string; available: boolean }>;
  onQuantityChange?: (id: string) => void;
}

const RENDER_OPTIONS: { value: RenderMode; icon: React.ReactNode; label: string; title: string }[] = [
  { value: "surface", icon: <Box size={14} />, label: "Surface", title: "Surface" },
  { value: "surface+edges", icon: <Grid3X3 size={14} />, label: "S+E", title: "Surface + Edges" },
  { value: "wireframe", icon: <Grid2X2 size={14} />, label: "Wire", title: "Wireframe" },
  { value: "points", icon: <Grip size={14} />, label: "Pts", title: "Points" },
];

const COLOR_OPTIONS: { value: FemColorField; label: string; fullLabel: string }[] = [
  { value: "orientation", label: "Ori", fullLabel: "Orientation" },
  { value: "z", label: "m_z", fullLabel: "Field Z" },
  { value: "x", label: "m_x", fullLabel: "Field X" },
  { value: "y", label: "m_y", fullLabel: "Field Y" },
  { value: "magnitude", label: "|m|", fullLabel: "|Field|" },
  { value: "quality", label: "Qual", fullLabel: "Quality AR" },
  { value: "sicn", label: "SICN", fullLabel: "SICN" },
  { value: "none", label: "—", fullLabel: "None" },
];

const QUALITY_PROFILES: { value: ViewportQualityProfileId; label: string }[] = [
  { value: "interactive", label: "Interactive" },
  { value: "balanced", label: "Balanced" },
  { value: "figure", label: "Figure" },
  { value: "capture", label: "Capture" },
];

export function FemViewportToolbar({
  renderMode,
  surfaceColorField,
  arrowColorField,
  projection,
  navigation,
  qualityProfile,
  clipEnabled,
  clipAxis,
  clipPos,
  arrowsVisible,
  arrowDensity,
  opacity,
  shrinkFactor,
  showShrink,
  labeledMode,
  legendOpen,
  partExplorerOpen,
  visiblePartsCount,
  totalPartsCount,
  hasField,
  fieldLabel,
  openPopover,
  onOpenPopoverChange,
  onRenderModeChange,
  onSurfaceColorFieldChange,
  onArrowColorFieldChange,
  onProjectionChange,
  onNavigationChange,
  onQualityProfileChange,
  onClipEnabledChange,
  onClipAxisChange,
  onClipPosChange,
  onArrowsVisibleChange,
  onArrowDensityChange,
  onOpacityChange,
  onShrinkFactorChange,
  onLabeledModeChange,
  onToggleLegend,
  onTogglePartExplorer,
  onCameraPreset,
  onCapture,
  quantityId,
  quantityOptions = [],
  onQuantityChange,
}: FemViewportToolbarProps) {
  const activeSurfaceColorOpt = COLOR_OPTIONS.find((o) => o.value === surfaceColorField);
  const activeArrowColorOpt = COLOR_OPTIONS.find((o) => o.value === arrowColorField);
  const availableQuantities = quantityOptions.filter((o) => o.available);
  const activeQuantity = quantityOptions.find((o) => o.id === quantityId) ?? null;

  return (
    <ViewportToolbar3D
      sideChildren={
        visiblePartsCount !== undefined && totalPartsCount !== undefined ? (
          <div className="flex flex-col items-end gap-1.5">
            <ViewportStatusChip color="default">
              {visiblePartsCount}/{totalPartsCount} parts
            </ViewportStatusChip>
          </div>
        ) : undefined
      }
    >
      {/* ── Quantity selector (when simulation has multiple quantities) ── */}
      {availableQuantities.length > 0 && (
        <>
          <ViewportToolGroup label="Quantity">
            <div className="relative">
              <ViewportIconAction
                icon={<Layers size={14} />}
                label={activeQuantity?.shortLabel ?? "Qty"}
                showCaret
                active={openPopover === "quantity"}
                onClick={() => onOpenPopoverChange(openPopover === "quantity" ? null : "quantity")}
                title="Preview Quantity"
              />
              {openPopover === "quantity" && (
                <ViewportPopoverPanel title="Quantity">
                  <div className="grid grid-cols-2 gap-1 w-[220px]">
                    {availableQuantities.map((opt) => (
                      <ViewportIconAction
                        key={opt.id}
                        active={quantityId === opt.id}
                        onClick={() => {
                          onQuantityChange?.(opt.id);
                          onOpenPopoverChange(null);
                        }}
                        label={opt.shortLabel}
                        className="justify-start px-2 py-1.5"
                      />
                    ))}
                  </div>
                </ViewportPopoverPanel>
              )}
            </div>
          </ViewportToolGroup>
          <ViewportToolSeparator />
        </>
      )}

      {/* ── Render mode ── */}
      <ViewportToolGroup label="Render">
        {RENDER_OPTIONS.map((opt) => (
          <ViewportIconAction
            key={opt.value}
            icon={opt.icon}
            active={renderMode === opt.value}
            onClick={() => onRenderModeChange(opt.value)}
            title={opt.title}
          />
        ))}
      </ViewportToolGroup>

      <ViewportToolSeparator />

      {/* ── Color field ── */}
      <ViewportToolGroup label="Color">
        <div className="relative">
          <ViewportIconAction
            icon={<Palette size={14} />}
            label={
              labeledMode
                ? `${activeSurfaceColorOpt?.fullLabel ?? "Surface"} / ${activeArrowColorOpt?.fullLabel ?? "Arrows"}`
                : `${activeSurfaceColorOpt?.label ?? "Surf"} / ${activeArrowColorOpt?.label ?? "Arr"}`
            }
            showCaret
            onClick={() => onOpenPopoverChange(openPopover === "color" ? null : "color")}
            title="Surface and Arrow Colors"
          />
          {openPopover === "color" && (
            <ViewportPopoverPanel title="Color Modes">
              <div className="flex w-[260px] flex-col gap-3">
                <ViewportPopoverRow label="Surface">
                  <div className="grid grid-cols-2 gap-1">
                    {COLOR_OPTIONS.map((opt) => (
                      <ViewportIconAction
                        key={`surface-${opt.value}`}
                        active={surfaceColorField === opt.value}
                        onClick={() => {
                          onSurfaceColorFieldChange(opt.value);
                        }}
                        label={opt.fullLabel}
                        className="justify-start px-2 py-1.5"
                      />
                    ))}
                  </div>
                </ViewportPopoverRow>
                <ViewportPopoverRow label="Arrows">
                  <div className="grid grid-cols-2 gap-1">
                    {COLOR_OPTIONS.map((opt) => (
                      <ViewportIconAction
                        key={`arrows-${opt.value}`}
                        active={arrowColorField === opt.value}
                        onClick={() => {
                          onArrowColorFieldChange(opt.value);
                        }}
                        label={opt.fullLabel}
                        className="justify-start px-2 py-1.5"
                      />
                    ))}
                  </div>
                </ViewportPopoverRow>
              </div>
            </ViewportPopoverPanel>
          )}
        </div>
      </ViewportToolGroup>

      <ViewportToolSeparator />

      <ViewportToolGroup>
        <ViewportStatusChip color="default">
          Surf {activeSurfaceColorOpt?.label ?? "—"}
        </ViewportStatusChip>
        <ViewportStatusChip color="default">
          Arr {activeArrowColorOpt?.label ?? "—"}
        </ViewportStatusChip>
      </ViewportToolGroup>

      <ViewportToolSeparator />

      {hasField && (
        <ViewportStatusChip color="cyan">{fieldLabel ?? "M"}</ViewportStatusChip>
      )}

      <ViewportToolSeparator />

      {/* ── Tools group ── */}
      <ViewportToolGroup>
        {/* Clip */}
        <div className="relative">
          <ViewportIconAction
            icon={<Scissors size={14} />}
            active={clipEnabled}
            showCaret
            onClick={() => {
              const next = !clipEnabled;
              onClipEnabledChange(next);
              onOpenPopoverChange(next ? "clip" : null);
            }}
            title="Clip Plane"
          />
          {openPopover === "clip" && (
            <ViewportPopoverPanel title="Clip Plane">
              <ViewportPopoverRow label="Axis">
                <div className="flex gap-1">
                  {(["x", "y", "z"] as ClipAxis[]).map((axis) => (
                    <ViewportIconAction
                      key={axis}
                      active={clipAxis === axis}
                      onClick={() => onClipAxisChange(axis)}
                      label={axis.toUpperCase()}
                      className="px-3"
                    />
                  ))}
                </div>
              </ViewportPopoverRow>
              <ViewportPopoverRow label="Position">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={clipPos}
                  onChange={(event) => onClipPosChange(Number(event.target.value))}
                  className="w-[180px]"
                />
              </ViewportPopoverRow>
            </ViewportPopoverPanel>
          )}
        </div>
        {/* Display options */}
        <div className="relative">
          <ViewportIconAction
            icon={<Eye size={14} />}
            showCaret
            active={openPopover === "display"}
            onClick={() => onOpenPopoverChange(openPopover === "display" ? null : "display")}
            title="Display Options"
          />
          {openPopover === "display" && (
            <ViewportPopoverPanel title="Display">
              <ViewportPopoverRow label="Opacity">
                <input
                  type="range"
                  className="flex-1 h-[3px] accent-primary w-[120px]"
                  min={10}
                  max={100}
                  value={opacity}
                  onChange={(e) => onOpacityChange(Number(e.target.value))}
                />
              </ViewportPopoverRow>
              {showShrink && (
                <ViewportPopoverRow label="Shrink">
                  <input
                    type="range"
                    className="flex-1 h-[3px] accent-primary w-[120px]"
                    min={10}
                    max={100}
                    value={Math.round(shrinkFactor * 100)}
                    onChange={(e) => onShrinkFactorChange(Number(e.target.value) / 100)}
                  />
                </ViewportPopoverRow>
              )}
              <ViewportPopoverRow label="Labels">
                <button
                  className="text-[0.65rem] font-semibold text-muted-foreground hover:text-foreground bg-transparent border border-border/30 rounded px-2 py-0.5"
                  onClick={() => onLabeledModeChange(!labeledMode)}
                >
                  {labeledMode ? "Hide Labels" : "Show Labels"}
                </button>
              </ViewportPopoverRow>
              <ViewportPopoverRow label="Profile">
                <div className="flex flex-wrap gap-1">
                  {QUALITY_PROFILES.map((p) => (
                    <button
                      key={p.value}
                      className="text-[0.65rem] font-semibold uppercase px-2 py-1 rounded transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary text-muted-foreground hover:text-foreground"
                      data-active={qualityProfile === p.value}
                      onClick={() => onQualityProfileChange(p.value)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </ViewportPopoverRow>
            </ViewportPopoverPanel>
          )}
        </div>

        {/* Arrows / Glyphs */}
        <div className="relative">
          <ViewportIconAction
            icon={<ArrowUpRight size={14} />}
            active={arrowsVisible}
            showCaret
            onClick={() => {
              const next = !arrowsVisible;
              onArrowsVisibleChange(next);
              onOpenPopoverChange(next ? "vectors" : null);
            }}
            title="Vectors"
          />
          {openPopover === "vectors" && arrowsVisible && (
            <ViewportPopoverPanel title="Vectors">
              <ViewportPopoverRow label="Density">
                <input
                  type="range"
                  className="flex-1 h-[3px] accent-primary w-[120px]"
                  min={200}
                  max={3000}
                  step={100}
                  value={arrowDensity}
                  onChange={(e) => onArrowDensityChange(Number(e.target.value))}
                />
              </ViewportPopoverRow>
            </ViewportPopoverPanel>
          )}
        </div>

        {/* Camera */}
        <div className="relative">
          <ViewportIconAction
            icon={<Video size={14} />}
            showCaret
            active={openPopover === "camera"}
            onClick={() => onOpenPopoverChange(openPopover === "camera" ? null : "camera")}
            title="Camera"
          />
          {openPopover === "camera" && (
            <ViewportPopoverPanel title="Camera / View">
              <ViewportPopoverRow label="Proj">
                <button
                  className="text-[0.65rem] font-semibold uppercase px-2 py-1 rounded transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary text-muted-foreground"
                  data-active={projection === "perspective"}
                  onClick={() => onProjectionChange("perspective")}
                >
                  Persp
                </button>
                <button
                  className="text-[0.65rem] font-semibold uppercase px-2 py-1 rounded transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary text-muted-foreground"
                  data-active={projection === "orthographic"}
                  onClick={() => onProjectionChange("orthographic")}
                >
                  Ortho
                </button>
              </ViewportPopoverRow>
              <ViewportPopoverRow label="Nav">
                <button
                  className="text-[0.65rem] font-semibold uppercase px-2 py-1 rounded transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary text-muted-foreground"
                  data-active={navigation === "trackball"}
                  onClick={() => onNavigationChange("trackball")}
                >
                  Trackball
                </button>
                <button
                  className="text-[0.65rem] font-semibold uppercase px-2 py-1 rounded transition-colors data-[active=true]:bg-primary/20 data-[active=true]:text-primary text-muted-foreground"
                  data-active={navigation === "cad"}
                  onClick={() => onNavigationChange("cad")}
                >
                  CAD
                </button>
              </ViewportPopoverRow>
              <div className="h-px bg-border/20 my-1" />
              <div className="grid grid-cols-2 gap-1 px-1">
                {(["reset", "front", "top", "right"] as const).map((view) => (
                  <button
                    key={view}
                    className="text-[0.65rem] font-semibold uppercase tracking-widest px-2 py-1.5 hover:bg-muted/50 rounded transition-colors text-muted-foreground hover:text-foreground text-left"
                    onClick={() => {
                      onCameraPreset(view);
                      onOpenPopoverChange(null);
                    }}
                  >
                    {view === "reset" ? "Reset" : view}
                  </button>
                ))}
              </div>
            </ViewportPopoverPanel>
          )}
        </div>

        {/* Panels */}
        <div className="relative">
          <ViewportIconAction
            icon={<Layers size={14} />}
            showCaret
            active={openPopover === "panels"}
            onClick={() => onOpenPopoverChange(openPopover === "panels" ? null : "panels")}
            title="Panels"
          />
          {openPopover === "panels" && (
            <ViewportPopoverPanel title="Panels">
              <ViewportIconAction
                label="Legend"
                active={legendOpen}
                onClick={onToggleLegend}
                className="justify-start w-full py-1.5"
              />
              <ViewportIconAction
                label={partExplorerOpen ? "Hide Parts" : "Show Parts"}
                active={partExplorerOpen}
                onClick={() => {
                  onTogglePartExplorer();
                  onOpenPopoverChange(null);
                }}
                className="justify-start w-full py-1.5"
              />
            </ViewportPopoverPanel>
          )}
        </div>

        <ViewportToolSeparator />

        {/* Screenshot */}
        <ViewportIconAction
          icon={<Camera size={14} />}
          onClick={onCapture}
          title="Screenshot"
        />
      </ViewportToolGroup>
    </ViewportToolbar3D>
  );
}
