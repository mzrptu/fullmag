import * as THREE from "three";
import { RENDER_LAYERS, type RenderLayerKey } from "./layers";

/**
 * Material policy: deterministic render settings for each layer.
 * Eliminates ad-hoc decisions scattered across components.
 */
export interface RenderPolicy {
  side: THREE.Side;
  depthWrite: boolean;
  depthTest: boolean;
  transparent: boolean;
  renderOrder: number;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
}

const POLICIES: Record<RenderLayerKey, RenderPolicy> = {
  OPAQUE_GEOMETRY: {
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
    transparent: false,
    renderOrder: 0,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  },
  TRANSPARENT_CONTEXT: {
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    renderOrder: 10,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  },
  SELECTION_HIGHLIGHT: {
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    renderOrder: 20,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  },
  FIELD_GLYPHS: {
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
    transparent: false,
    renderOrder: 5,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  },
  GIZMOS: {
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    renderOrder: 30,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  },
  AXES_LABELS: {
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    renderOrder: 25,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  },
  CLIP_CAPS: {
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    transparent: false,
    renderOrder: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  },
  FEATURE_EDGES: {
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    renderOrder: 15,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  },
  HIDDEN_LINE_HELPERS: {
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    renderOrder: 16,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  },
  GHOST_CONTEXT: {
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    renderOrder: 11,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  },
  PICKING_PROXY: {
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
    transparent: false,
    renderOrder: 0,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  },
  PROBE_MARKERS: {
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    transparent: false,
    renderOrder: 6,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  },
  FIELD_OVERLAY: {
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    renderOrder: 12,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  },
  SCREENSPACE_HELPERS: {
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    renderOrder: 35,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  },
};

/**
 * Returns the deterministic render policy for a given layer.
 * Components use this to configure materials consistently.
 */
export function getRenderPolicy(layer: RenderLayerKey): RenderPolicy {
  return POLICIES[layer];
}

/**
 * Apply policy props to a Three.js material.
 * Useful for imperative updates (e.g. within useFrame or useEffect).
 */
export function applyRenderPolicy(
  material: THREE.Material,
  layer: RenderLayerKey,
) {
  const p = POLICIES[layer];
  material.side = p.side;
  material.depthWrite = p.depthWrite;
  material.depthTest = p.depthTest;
  material.transparent = p.transparent;
  if (material instanceof THREE.MeshPhongMaterial || material instanceof THREE.MeshBasicMaterial) {
    material.polygonOffset = p.polygonOffset;
    material.polygonOffsetFactor = p.polygonOffsetFactor;
    material.polygonOffsetUnits = p.polygonOffsetUnits;
  }
  material.needsUpdate = true;
}

/**
 * Assign an object to a render layer.
 */
export function setObjectLayer(obj: THREE.Object3D, layer: RenderLayerKey) {
  obj.layers.set(RENDER_LAYERS[layer]);
}
