export interface TextureTransform3D {
  translation: [number, number, number];
  rotation_quat: [number, number, number, number];
  scale: [number, number, number];
  pivot: [number, number, number];
}

export const IDENTITY_TEXTURE_TRANSFORM: TextureTransform3D = {
  translation: [0, 0, 0],
  rotation_quat: [0, 0, 0, 1],
  scale: [1, 1, 1],
  pivot: [0, 0, 0],
};

export function cloneTextureTransform(value: TextureTransform3D): TextureTransform3D {
  return {
    translation: [...value.translation] as [number, number, number],
    rotation_quat: [...value.rotation_quat] as [number, number, number, number],
    scale: [...value.scale] as [number, number, number],
    pivot: [...value.pivot] as [number, number, number],
  };
}

export function resetTextureTransform(): TextureTransform3D {
  return cloneTextureTransform(IDENTITY_TEXTURE_TRANSFORM);
}

export function fitTextureToBounds(
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
): TextureTransform3D {
  const sx = Math.max(boundsMax[0] - boundsMin[0], 1e-18);
  const sy = Math.max(boundsMax[1] - boundsMin[1], 1e-18);
  const sz = Math.max(boundsMax[2] - boundsMin[2], 1e-18);
  const center: [number, number, number] = [
    0.5 * (boundsMin[0] + boundsMax[0]),
    0.5 * (boundsMin[1] + boundsMax[1]),
    0.5 * (boundsMin[2] + boundsMax[2]),
  ];
  return {
    translation: center,
    rotation_quat: [0, 0, 0, 1],
    scale: [sx, sy, sz],
    pivot: [0, 0, 0],
  };
}

/**
 * For metric analytic presets, fit the preset parameters to geometry bounds
 * instead of abusing texture_transform.scale.
 *
 * Returns a new set of preset_params with physical dimensions adjusted
 * to match the target bounds, plus a metric-safe texture transform
 * (translation + pivot centered on bounds, scale = identity).
 */
export function fitPresetParamsToBounds(
  presetKind: string,
  params: Record<string, unknown>,
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
): { params: Record<string, unknown>; transform: TextureTransform3D } {
  const ex = Math.abs(boundsMax[0] - boundsMin[0]);
  const ey = Math.abs(boundsMax[1] - boundsMin[1]);
  const ez = Math.abs(boundsMax[2] - boundsMin[2]);
  const center: [number, number, number] = [
    0.5 * (boundsMin[0] + boundsMax[0]),
    0.5 * (boundsMin[1] + boundsMax[1]),
    0.5 * (boundsMin[2] + boundsMax[2]),
  ];

  // Metric-safe transform: only center, no scale distortion
  const transform: TextureTransform3D = {
    translation: center,
    rotation_quat: [0, 0, 0, 1],
    scale: [1, 1, 1],
    pivot: [0, 0, 0],
  };

  const plane = (params.plane as string) ?? "xy";
  const inPlaneExtents = _inPlaneExtents(ex, ey, ez, plane);
  const minInPlane = Math.min(inPlaneExtents[0], inPlaneExtents[1]);
  const normalExtent = _normalExtent(ex, ey, ez, plane);

  const next = { ...params };

  switch (presetKind) {
    case "vortex":
    case "antivortex":
      next.core_radius = 0.12 * minInPlane;
      break;

    case "bloch_skyrmion":
    case "neel_skyrmion":
      next.radius = 0.40 * minInPlane;
      next.wall_width = 0.10 * minInPlane;
      break;

    case "domain_wall": {
      const axis = (params.normal_axis as string) ?? "x";
      const extentAlongNormal =
        axis === "x" ? ex : axis === "y" ? ey : ez;
      next.center_offset = 0;
      next.width = 0.12 * extentAlongNormal;
      break;
    }

    default:
      // Non-metric presets (uniform, random, helical, conical, two_domain)
      // fall through — no parameter adjustment needed.
      break;
  }

  return { params: next, transform };
}

function _inPlaneExtents(
  ex: number,
  ey: number,
  ez: number,
  plane: string,
): [number, number] {
  if (plane === "xz") return [ex, ez];
  if (plane === "yz") return [ey, ez];
  return [ex, ey]; // "xy" default
}

function _normalExtent(
  ex: number,
  ey: number,
  ez: number,
  plane: string,
): number {
  if (plane === "xz") return ey;
  if (plane === "yz") return ex;
  return ez; // "xy" default
}
