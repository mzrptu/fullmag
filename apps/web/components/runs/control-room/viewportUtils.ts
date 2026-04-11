import type { TextureTransform3D as PreviewTextureTransform3D } from "@/lib/textureTransform";
import type { TextureTransform3D as SceneTextureTransform3D } from "../../../lib/session/types";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // [x, y, z, w]

export function domainFrameSourceLabel(source: string | null): string {
  switch (source) {
    case "declared_universe_manual":
      return "Declared Universe";
    case "declared_universe_auto_padding":
      return "Auto-Padded Domain";
    case "object_union_bounds":
      return "Object Union Bounds";
    case "mesh_bounds":
      return "Mesh Bounds";
    default:
      return "Workspace Frame";
  }
}

export function visibleVolumeLabel(
  isFemBackend: boolean,
  clipEnabled: boolean,
  clipAxis: "x" | "y" | "z",
  clipPos: number,
): string {
  if (!isFemBackend) {
    return "Full Domain";
  }
  if (!clipEnabled) {
    return "Full Effective Domain";
  }
  return `Clipped ${clipAxis.toUpperCase()} @${Math.round(clipPos)}%`;
}

export function toPreviewTextureTransform(value: SceneTextureTransform3D): PreviewTextureTransform3D {
  return {
    translation: [...value.translation] as [number, number, number],
    rotation_quat: [...value.rotation_quat] as [number, number, number, number],
    scale: [...value.scale] as [number, number, number],
    pivot: [...value.pivot] as [number, number, number],
  };
}

export function toSceneTextureTransform(value: PreviewTextureTransform3D): SceneTextureTransform3D {
  return {
    translation: [...value.translation] as [number, number, number],
    rotation_quat: [...value.rotation_quat] as [number, number, number, number],
    scale: [...value.scale] as [number, number, number],
    pivot: [...value.pivot] as [number, number, number],
  };
}

export function offsetTextureTransform(
  value: PreviewTextureTransform3D,
  offset: [number, number, number],
): PreviewTextureTransform3D {
  return {
    translation: [
      value.translation[0] + offset[0],
      value.translation[1] + offset[1],
      value.translation[2] + offset[2],
    ],
    rotation_quat: [...value.rotation_quat] as [number, number, number, number],
    scale: [...value.scale] as [number, number, number],
    pivot: [
      value.pivot[0] + offset[0],
      value.pivot[1] + offset[1],
      value.pivot[2] + offset[2],
    ],
  };
}

export function quatRotateVec3(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

export function quatInverse(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function textureTransformToWorld(
  tex: PreviewTextureTransform3D,
  objTransform: { translation: Vec3; rotation_quat: Quat; scale: Vec3 },
): PreviewTextureTransform3D {
  const { translation: objT, rotation_quat: objR, scale: objS } = objTransform;
  const applyObjToPoint = (p: Vec3): Vec3 => {
    // 1. scale
    const scaled: Vec3 = [p[0] * objS[0], p[1] * objS[1], p[2] * objS[2]];
    // 2. rotate
    const rotated = quatRotateVec3(objR, scaled);
    // 3. translate
    return [rotated[0] + objT[0], rotated[1] + objT[1], rotated[2] + objT[2]];
  };
  // Compose rotation: world_quat = objR * tex.rotation_quat
  const worldQuat = quatMultiply(objR, tex.rotation_quat);
  // Compose scale: world_scale = objS * tex.scale
  const worldScale: Vec3 = [
    objS[0] * tex.scale[0],
    objS[1] * tex.scale[1],
    objS[2] * tex.scale[2],
  ];
  return {
    translation: applyObjToPoint(tex.translation),
    rotation_quat: worldQuat,
    scale: worldScale,
    pivot: applyObjToPoint(tex.pivot),
  };
}

export function textureTransformToLocal(
  tex: PreviewTextureTransform3D,
  objTransform: { translation: Vec3; rotation_quat: Quat; scale: Vec3 },
): PreviewTextureTransform3D {
  const { translation: objT, rotation_quat: objR, scale: objS } = objTransform;
  const invR = quatInverse(objR);
  const invS: Vec3 = [
    objS[0] !== 0 ? 1 / objS[0] : 0,
    objS[1] !== 0 ? 1 / objS[1] : 0,
    objS[2] !== 0 ? 1 / objS[2] : 0,
  ];
  const removeObjFromPoint = (p: Vec3): Vec3 => {
    // 1. un-translate
    const untranslated: Vec3 = [p[0] - objT[0], p[1] - objT[1], p[2] - objT[2]];
    // 2. un-rotate
    const unrotated = quatRotateVec3(invR, untranslated);
    // 3. un-scale
    return [unrotated[0] * invS[0], unrotated[1] * invS[1], unrotated[2] * invS[2]];
  };
  // Decompose rotation: local_quat = invR * tex.rotation_quat
  const localQuat = quatMultiply(invR, tex.rotation_quat);
  // Decompose scale: local_scale = invS * tex.scale
  const localScale: Vec3 = [
    invS[0] * tex.scale[0],
    invS[1] * tex.scale[1],
    invS[2] * tex.scale[2],
  ];
  return {
    translation: removeObjFromPoint(tex.translation),
    rotation_quat: localQuat,
    scale: localScale,
    pivot: removeObjFromPoint(tex.pivot),
  };
}
