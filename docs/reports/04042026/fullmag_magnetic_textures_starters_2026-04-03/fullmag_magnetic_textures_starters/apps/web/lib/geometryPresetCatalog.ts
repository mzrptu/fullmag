export type GeometryPresetKind =
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "ellipsoid"
  | "torus"
  | "imported";

export interface GeometryPresetDescriptor {
  kind: GeometryPresetKind;
  label: string;
  icon: string;
  defaultParams: Record<string, unknown>;
}

export const GEOMETRY_PRESET_CATALOG: GeometryPresetDescriptor[] = [
  { kind: "box", label: "Box", icon: "▭", defaultParams: { sx: 100e-9, sy: 100e-9, sz: 10e-9 } },
  { kind: "sphere", label: "Sphere", icon: "●", defaultParams: { radius: 50e-9 } },
  { kind: "cylinder", label: "Cylinder", icon: "◫", defaultParams: { diameter: 100e-9, height: 20e-9 } },
  { kind: "cone", label: "Cone", icon: "△", defaultParams: { diameter: 100e-9, height: 50e-9 } },
  { kind: "ellipsoid", label: "Ellipsoid", icon: "⬭", defaultParams: { sx: 120e-9, sy: 80e-9, sz: 40e-9 } },
  { kind: "torus", label: "Torus", icon: "◎", defaultParams: { majorRadius: 80e-9, minorRadius: 20e-9 } },
  { kind: "imported", label: "Imported", icon: "📦", defaultParams: {} },
];
