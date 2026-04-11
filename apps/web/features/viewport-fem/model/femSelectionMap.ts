/**
 * Layer D – FEM Viewport Engine: Selection Map
 *
 * Pure functions for computing magnetic-arrow node masks and
 * vector-domain filtering.  Extracted from FemMeshView3D useMemo chains.
 */

import type { FemLiveMeshObjectSegment } from "../../../lib/session/types";
import { collectSegmentNodeMask } from "./femTopologyCache";
import type { RenderLayer } from "./femRenderModel";

/**
 * Build a Uint8Array node mask that gates which nodes show vector arrows.
 * Combines visible-layer node masks with the base activeMask.
 */
export function buildMagneticArrowNodeMask(
  visibleLayers: readonly RenderLayer[],
  magneticSegments: readonly FemLiveMeshObjectSegment[],
  visibleMagneticIds: ReadonlySet<string>,
  nNodes: number,
  activeMask: boolean[] | null | undefined,
  hasMeshParts: boolean,
): Uint8Array | null {
  if (hasMeshParts) {
    const magneticLayers = visibleLayers.filter((l) => l.isMagnetic);
    if (magneticLayers.length === 0) {
      return activeMaskAsUint8(activeMask, nNodes);
    }
    const combined = new Uint8Array(nNodes);
    for (const layer of magneticLayers) {
      if (!layer.nodeMask) continue;
      for (let i = 0; i < layer.nodeMask.length; i++) {
        if (layer.nodeMask[i]) combined[i] = 1;
      }
    }
    return intersectWithActiveMask(combined, activeMask, nNodes);
  }

  const nodeMask = collectSegmentNodeMask(magneticSegments, nNodes, visibleMagneticIds);
  if (!nodeMask) return activeMaskAsUint8(activeMask, nNodes);
  return intersectWithActiveMask(nodeMask, activeMask, nNodes);
}

/* ── helpers ── */

function activeMaskAsUint8(
  mask: boolean[] | null | undefined,
  nNodes: number,
): Uint8Array | null {
  if (!mask || mask.length !== nNodes) return null;
  const out = new Uint8Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    out[i] = mask[i] ? 1 : 0;
  }
  return out;
}

function intersectWithActiveMask(
  base: Uint8Array,
  activeMask: boolean[] | null | undefined,
  nNodes: number,
): Uint8Array {
  if (!activeMask || activeMask.length !== nNodes) return base;
  const result = new Uint8Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    result[i] = base[i] && activeMask[i] ? 1 : 0;
  }
  return result;
}
