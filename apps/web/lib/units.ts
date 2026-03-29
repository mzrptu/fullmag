/**
 * Shared SI unit scaling utilities.
 *
 * Used by DimensionOverlay, SceneAxes3D, and any component that needs
 * to convert raw meters into human-readable unit prefixes.
 */

export interface UnitScale {
  scale: number;
  unit: string;
}

/**
 * Pick the best SI prefix for a given value in meters.
 * Returns the multiplier and unit string.
 */
export function pickUnitScale(meters: number): UnitScale {
  const abs = Math.abs(meters);
  if (abs >= 1)    return { scale: 1,    unit: "m" };
  if (abs >= 1e-2) return { scale: 1e2,  unit: "cm" };
  if (abs >= 1e-3) return { scale: 1e3,  unit: "mm" };
  if (abs >= 1e-5) return { scale: 1e6,  unit: "µm" };
  if (abs >= 1e-8) return { scale: 1e9,  unit: "nm" };
  return            { scale: 1e12, unit: "pm" };
}
