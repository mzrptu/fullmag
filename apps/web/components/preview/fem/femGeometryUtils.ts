/**
 * Pure geometry utility functions extracted from FemMeshView3D.tsx.
 * No React hooks — only plain functions and constants.
 */
import type {
  FemLiveMeshObjectSegment,
  FemMeshPart,
} from "../../../lib/session/types";
import type { FemArrowColorMode } from "../FemMeshView3D";

export function uniqueSortedMarkers(markers: readonly number[]): number[] {
  return Array.from(new Set(markers.filter((value) => Number.isFinite(value) && value >= 0))).sort(
    (left, right) => left - right,
  );
}

export function countActiveNodes(mask: ArrayLike<number | boolean> | null | undefined): number {
  if (!mask || mask.length === 0) {
    return 0;
  }
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      count += 1;
    }
  }
  return count;
}

export function markersForPart(
  part: FemMeshPart,
  elementMarkers: readonly number[] | null | undefined,
): number[] {
  if (!elementMarkers || elementMarkers.length === 0 || part.element_count <= 0) {
    return [];
  }
  const start = Math.max(0, Math.trunc(part.element_start));
  const end = Math.min(elementMarkers.length, start + Math.max(0, Math.trunc(part.element_count)));
  if (start >= end) {
    return [];
  }
  return uniqueSortedMarkers(elementMarkers.slice(start, end));
}

export function collectSegmentBoundaryFaceIndices(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  maxFaceCount: number,
  selectedObjectId?: string | null,
): number[] | null {
  const relevantSegments =
    selectedObjectId
      ? objectSegments.filter((segment) => segment.object_id === selectedObjectId)
      : objectSegments;
  if (relevantSegments.length === 0) {
    return null;
  }
  const faceIndices: number[] = [];
  for (const segment of relevantSegments) {
    const start = Math.max(0, Math.trunc(segment.boundary_face_start));
    const count = Math.max(0, Math.trunc(segment.boundary_face_count));
    const end = Math.min(start + count, maxFaceCount);
    for (let faceIndex = start; faceIndex < end; faceIndex += 1) {
      faceIndices.push(faceIndex);
    }
  }
  if (faceIndices.length === 0 || faceIndices.length >= maxFaceCount) {
    return null;
  }
  return faceIndices;
}

export function collectSegmentElementIndices(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  maxElementCount: number,
  selectedObjectId?: string | null,
): number[] | null {
  const relevantSegments =
    selectedObjectId
      ? objectSegments.filter((segment) => segment.object_id === selectedObjectId)
      : objectSegments;
  if (relevantSegments.length === 0) {
    return null;
  }
  const elementIndices: number[] = [];
  for (const segment of relevantSegments) {
    const start = Math.max(0, Math.trunc(segment.element_start));
    const count = Math.max(0, Math.trunc(segment.element_count));
    const end = Math.min(start + count, maxElementCount);
    for (let elementIndex = start; elementIndex < end; elementIndex += 1) {
      elementIndices.push(elementIndex);
    }
  }
  if (elementIndices.length === 0 || elementIndices.length >= maxElementCount) {
    return null;
  }
  return elementIndices;
}

export function collectSegmentBoundaryFaceIndicesByIds(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  maxFaceCount: number,
  segmentIds: ReadonlySet<string>,
): number[] | null {
  if (segmentIds.size === 0) {
    return [];
  }
  const relevantSegments = objectSegments.filter((segment) => segmentIds.has(segment.object_id));
  if (relevantSegments.length === 0) {
    return [];
  }
  const faceIndices: number[] = [];
  for (const segment of relevantSegments) {
    const start = Math.max(0, Math.trunc(segment.boundary_face_start));
    const count = Math.max(0, Math.trunc(segment.boundary_face_count));
    const end = Math.min(start + count, maxFaceCount);
    for (let faceIndex = start; faceIndex < end; faceIndex += 1) {
      faceIndices.push(faceIndex);
    }
  }
  if (faceIndices.length === 0) {
    return [];
  }
  if (faceIndices.length >= maxFaceCount) {
    return null;
  }
  return faceIndices;
}

export function collectSegmentElementIndicesByIds(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  maxElementCount: number,
  segmentIds: ReadonlySet<string>,
): number[] | null {
  if (segmentIds.size === 0) {
    return [];
  }
  const relevantSegments = objectSegments.filter((segment) => segmentIds.has(segment.object_id));
  if (relevantSegments.length === 0) {
    return [];
  }
  const elementIndices: number[] = [];
  for (const segment of relevantSegments) {
    const start = Math.max(0, Math.trunc(segment.element_start));
    const count = Math.max(0, Math.trunc(segment.element_count));
    const end = Math.min(start + count, maxElementCount);
    for (let elementIndex = start; elementIndex < end; elementIndex += 1) {
      elementIndices.push(elementIndex);
    }
  }
  if (elementIndices.length === 0) {
    return [];
  }
  if (elementIndices.length >= maxElementCount) {
    return null;
  }
  return elementIndices;
}

export function collectSegmentNodeMask(
  objectSegments: readonly FemLiveMeshObjectSegment[],
  nNodes: number,
  segmentIds: ReadonlySet<string>,
): Uint8Array | null {
  if (segmentIds.size === 0) {
    return null;
  }
  const nodeMask = new Uint8Array(nNodes);
  let sawNode = false;
  for (const segment of objectSegments) {
    if (!segmentIds.has(segment.object_id)) {
      continue;
    }
    const start = Math.max(0, Math.trunc(segment.node_start));
    const count = Math.max(0, Math.trunc(segment.node_count));
    const end = Math.min(start + count, nNodes);
    for (let nodeIndex = start; nodeIndex < end; nodeIndex += 1) {
      nodeMask[nodeIndex] = 1;
      sawNode = true;
    }
  }
  return sawNode ? nodeMask : null;
}

export function collectPartBoundaryFaceIndices(
  part: FemMeshPart,
  maxFaceCount: number,
): number[] | null {
  if (part.boundary_face_indices.length > 0) {
    return part.boundary_face_indices.filter(
      (faceIndex) => Number.isInteger(faceIndex) && faceIndex >= 0 && faceIndex < maxFaceCount,
    );
  }
  const start = Math.max(0, Math.trunc(part.boundary_face_start));
  const count = Math.max(0, Math.trunc(part.boundary_face_count));
  const end = Math.min(start + count, maxFaceCount);
  const faceIndices: number[] = [];
  for (let faceIndex = start; faceIndex < end; faceIndex += 1) {
    faceIndices.push(faceIndex);
  }
  if (faceIndices.length === 0) {
    return [];
  }
  if (faceIndices.length >= maxFaceCount) {
    return null;
  }
  return faceIndices;
}

export function collectPartElementIndices(
  part: FemMeshPart,
  maxElementCount: number,
): number[] | null {
  const start = Math.max(0, Math.trunc(part.element_start));
  const count = Math.max(0, Math.trunc(part.element_count));
  const end = Math.min(start + count, maxElementCount);
  const elementIndices: number[] = [];
  for (let elementIndex = start; elementIndex < end; elementIndex += 1) {
    elementIndices.push(elementIndex);
  }
  if (elementIndices.length === 0) {
    return [];
  }
  if (elementIndices.length >= maxElementCount) {
    return null;
  }
  return elementIndices;
}

export function collectPartNodeMask(
  part: FemMeshPart,
  nNodes: number,
): Uint8Array | null {
  if (part.node_indices.length > 0) {
    const nodeMask = new Uint8Array(nNodes);
    let sawNode = false;
    for (const nodeIndex of part.node_indices) {
      if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nNodes) {
        continue;
      }
      nodeMask[nodeIndex] = 1;
      sawNode = true;
    }
    return sawNode ? nodeMask : null;
  }
  const start = Math.max(0, Math.trunc(part.node_start));
  const count = Math.max(0, Math.trunc(part.node_count));
  const end = Math.min(start + count, nNodes);
  if (start >= end) {
    return null;
  }
  const nodeMask = new Uint8Array(nNodes);
  for (let nodeIndex = start; nodeIndex < end; nodeIndex += 1) {
    nodeMask[nodeIndex] = 1;
  }
  return nodeMask;
}

export const SUPPORTED_ARROW_COLOR_FIELDS: ReadonlySet<FemArrowColorMode> = new Set([
  "orientation",
  "x",
  "y",
  "z",
  "magnitude",
]);
