import * as THREE from "three";

/**
 * Amumax frontend orientation coloring:
 * - normalize m
 * - hue from atan2(my, mx)
 * - saturation from |m|, capped at 1
 * - lightness from mz, clamped to the same perceptual band used by amumax
 *   so the poles do not wash out to near-white / near-black in the viewport
 *
 * References:
 * - external_solvers/amumax/frontend/src/lib/preview/preview3D.ts
 * - external_solvers/amumax/src/draw/hslscale.go
 */
export function applyMagnetizationHsl(
  mx: number,
  my: number,
  mz: number,
  color: THREE.Color,
): THREE.Color {
  const magnitude = Math.sqrt(mx * mx + my * my + mz * mz);
  if (magnitude <= 1e-30) {
    return color.setRGB(0, 0, 0);
  }
  const nx = mx / magnitude;
  const ny = my / magnitude;
  const nz = mz / magnitude;
  const hue = Math.atan2(ny, nx) / (Math.PI * 2);
  const saturation = Math.min(1, magnitude);
  const lightness = THREE.MathUtils.clamp(nz * 0.5 + 0.5, 0.18, 0.84);
  return color.setHSL((hue + 1) % 1, saturation, lightness);
}

export function magnetizationHslColor(mx: number, my: number, mz: number): THREE.Color {
  return applyMagnetizationHsl(mx, my, mz, new THREE.Color());
}
