export interface TextureTransform3D {
  translation: [number, number, number];
  rotationQuat: [number, number, number, number];
  scale: [number, number, number];
  pivot: [number, number, number];
}

export const IDENTITY_TEXTURE_TRANSFORM: TextureTransform3D = {
  translation: [0, 0, 0],
  rotationQuat: [0, 0, 0, 1],
  scale: [1, 1, 1],
  pivot: [0, 0, 0],
};

export function cloneTextureTransform(value: TextureTransform3D): TextureTransform3D {
  return {
    translation: [...value.translation] as [number, number, number],
    rotationQuat: [...value.rotationQuat] as [number, number, number, number],
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
    rotationQuat: [0, 0, 0, 1],
    scale: [sx, sy, sz],
    pivot: [0, 0, 0],
  };
}
