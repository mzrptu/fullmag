import type { FemColorField, RenderMode, ClipAxis } from "../FemMeshView3D";
import type { ViewportQualityProfileId } from "../shared/viewportQualityProfiles";

export type FemViewportProjection = "perspective" | "orthographic";
export type FemViewportNavigation = "trackball" | "cad";
export type FemViewportVisualPreset =
  | "shaded"
  | "shadedEdges"
  | "hiddenLine"
  | "quality"
  | "partTint"
  | "field";

export interface FemViewportClipState {
  enabled: boolean;
  axis: ClipAxis;
  position: number;
}

export interface FemViewportToolbarState {
  renderMode: RenderMode;
  surfaceColorField: FemColorField;
  arrowColorField: FemColorField;
  projection: FemViewportProjection;
  navigation: FemViewportNavigation;
  clip: FemViewportClipState;
  arrowsVisible: boolean;
  qualityProfile: ViewportQualityProfileId;
  partExplorerOpen: boolean;
  legendOpen: boolean;
  labeledMode: boolean;
}

export interface FemViewportSelectionState {
  selectedFaceIndices: number[];
  hoveredFaceIndex: number | null;
}

export interface FemViewportStoreState {
  toolbar: FemViewportToolbarState;
  selection: FemViewportSelectionState;
}
