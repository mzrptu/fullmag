// @ts-nocheck
import { describe, expect, it } from "vitest";

import type { FemMeshPart } from "@/lib/session/types";
import { buildVisibleLayers } from "../femRenderModel";

function makePart(partial: Partial<FemMeshPart>): FemMeshPart {
  return {
    id: "part-1",
    label: "Part",
    role: "magnetic_object",
    object_id: "obj-1",
    geometry_id: "geo-1",
    material_id: "mat-1",
    element_start: 0,
    element_count: 1,
    boundary_face_start: 0,
    boundary_face_count: 1,
    boundary_face_indices: [0],
    node_start: 0,
    node_count: 3,
    node_indices: [0, 1, 2],
    surface_faces: [[0, 1, 2]],
    bounds_min: [0, 0, 0],
    bounds_max: [1, 1, 1],
    ...partial,
  };
}

describe("buildVisibleLayers", () => {
  it("returns empty list for empty mesh", () => {
    expect(
      buildVisibleLayers({
        meshParts: [],
        partRenderDataById: new Map(),
        meshEntityViewState: {},
        objectViewMode: "context",
        vectorDomainFilter: "auto",
        ferromagnetVisibilityMode: "hide",
        selectedObjectId: null,
        selectedEntityId: null,
        focusedEntityId: null,
        airSegmentVisible: true,
      }),
    ).toEqual([]);
  });

  it("marks one visible layer as primary for camera", () => {
    const part = makePart({});
    const layers = buildVisibleLayers({
      meshParts: [part],
      partRenderDataById: new Map(),
      meshEntityViewState: {
        [part.id]: {
          visible: true,
          renderMode: "surface",
          opacity: 100,
          colorField: "orientation",
        },
      },
      objectViewMode: "context",
      vectorDomainFilter: "auto",
      ferromagnetVisibilityMode: "hide",
      selectedObjectId: null,
      selectedEntityId: null,
      focusedEntityId: null,
      airSegmentVisible: true,
    });

    expect(layers).toHaveLength(1);
    expect(layers[0].isPrimaryForCamera).toBe(true);
  });
});
