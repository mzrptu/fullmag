/**
 * FEM viewport render model – layer decomposition types.
 *
 * Defines the rendering layer architecture for FEM mesh visualization.
 * Each layer is an independent renderable that Three.js scene graph
 * can toggle/clip/style independently.
 */

export type FemLayerKind =
  | "surface"
  | "edges"
  | "arrows"
  | "clip-plane"
  | "air-ghost"
  | "selection-highlight"
  | "boundary";

export interface FemRenderLayer {
  kind: FemLayerKind;
  visible: boolean;
  opacity: number;
  order: number;
}

export interface FemRenderLayerSet {
  surface: FemRenderLayer;
  edges: FemRenderLayer;
  arrows: FemRenderLayer;
  clipPlane: FemRenderLayer;
  airGhost: FemRenderLayer;
  selectionHighlight: FemRenderLayer;
  boundary: FemRenderLayer;
}

export function createDefaultLayerSet(): FemRenderLayerSet {
  return {
    surface: { kind: "surface", visible: true, opacity: 1, order: 0 },
    edges: { kind: "edges", visible: true, opacity: 0.4, order: 1 },
    arrows: { kind: "arrows", visible: false, opacity: 1, order: 2 },
    clipPlane: { kind: "clip-plane", visible: false, opacity: 1, order: 3 },
    airGhost: { kind: "air-ghost", visible: false, opacity: 0.15, order: 4 },
    selectionHighlight: { kind: "selection-highlight", visible: false, opacity: 1, order: 5 },
    boundary: { kind: "boundary", visible: false, opacity: 0.3, order: 6 },
  };
}

/**
 * Derive the effective layer set from model state flags.
 */
export function deriveLayerVisibility(
  layers: FemRenderLayerSet,
  opts: {
    showArrows: boolean;
    clipEnabled: boolean;
    airVisible: boolean;
    airOpacity: number;
    selectedEntityId: string | null;
  },
): FemRenderLayerSet {
  return {
    ...layers,
    arrows: { ...layers.arrows, visible: opts.showArrows },
    clipPlane: { ...layers.clipPlane, visible: opts.clipEnabled },
    airGhost: { ...layers.airGhost, visible: opts.airVisible, opacity: opts.airOpacity },
    selectionHighlight: { ...layers.selectionHighlight, visible: opts.selectedEntityId !== null },
  };
}
