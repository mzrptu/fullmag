"use client";

import type { ScriptBuilderGeometryEntry } from "../../../lib/session/types";

export function resolveObjectNameFromNodeId(
  nodeId: string | undefined,
  geometries: ScriptBuilderGeometryEntry[],
): string | null {
  if (!nodeId) {
    return null;
  }
  const candidate = nodeId.replace(/^(geo|mat|obj|reg)-/, "");
  const names = geometries
    .map((geometry) => geometry.name)
    .sort((left, right) => right.length - left.length);
  return names.find((name) => candidate === name || candidate.startsWith(`${name}-`)) ?? null;
}

export function findGeometryByNodeId(
  nodeId: string | undefined,
  geometries: ScriptBuilderGeometryEntry[],
): { geometry: ScriptBuilderGeometryEntry | undefined; index: number; name: string | null } {
  const name = resolveObjectNameFromNodeId(nodeId, geometries);
  const index = name ? geometries.findIndex((geometry) => geometry.name === name) : -1;
  return {
    geometry: index >= 0 ? geometries[index] : undefined,
    index,
    name,
  };
}
