/**
 * Three.js render layer assignments for the viewport.
 *
 * Layers control which objects are visible to which camera passes.
 * Layer 0 is the default (always rendered). Higher layers are opt-in.
 */
export const RENDER_LAYERS = {
  /** Main geometry — depthWrite=true, opaque pass */
  OPAQUE_GEOMETRY: 0,
  /** Ghost / context objects — transparent, depth read only */
  TRANSPARENT_CONTEXT: 1,
  /** Selection highlight overlay */
  SELECTION_HIGHLIGHT: 2,
  /** Field arrows / glyphs */
  FIELD_GLYPHS: 3,
  /** Transform gizmos */
  GIZMOS: 4,
  /** Axes and labels */
  AXES_LABELS: 5,
} as const;

export type RenderLayerKey = keyof typeof RENDER_LAYERS;
