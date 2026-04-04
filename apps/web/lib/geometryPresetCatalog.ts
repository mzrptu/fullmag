export type GeometryPresetCategory = "primitive" | "component" | "standard_sample";

export type GeometryPresetKind =
  | "box"
  | "cylinder"
  | "sphere"
  | "ring"
  | "nanowire"
  | "thin_film"
  | "pillar"
  | "disk"
  | "mumax_standard_problem_3"
  | "sp4";

export interface GeometryPresetParameter {
  key: string;
  label: string;
  type: "number" | "integer" | "vector3" | "enum" | "boolean";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string | number; label: string }>;
}

export interface GeometryPresetDescriptor {
  kind: GeometryPresetKind;
  label: string;
  category: GeometryPresetCategory;
  icon: string;
  description?: string;
  defaultParams: Record<string, unknown>;
  parameters: GeometryPresetParameter[];
}

export const GEOMETRY_PRESET_CATALOG: GeometryPresetDescriptor[] = [
  {
    kind: "box",
    label: "Box",
    category: "primitive",
    icon: "Cube",
    description: "Standard rectangular cuboid.",
    defaultParams: { dimensions: [100e-9, 50e-9, 10e-9] },
    parameters: [
      { key: "dimensions", label: "Dimensions (X,Y,Z)", type: "vector3", unit: "m" },
    ],
  },
  {
    kind: "cylinder",
    label: "Cylinder",
    category: "primitive",
    icon: "Cylinder",
    defaultParams: { radius: 50e-9, height: 10e-9, axis: "z" },
    parameters: [
      { key: "radius", label: "Radius", type: "number", unit: "m", min: 0 },
      { key: "height", label: "Height", type: "number", unit: "m", min: 0 },
      { key: "axis", label: "Axis", type: "enum", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }, { value: "z", label: "Z" }] },
    ],
  },
  {
    kind: "sphere",
    label: "Sphere",
    category: "primitive",
    icon: "Circle",
    defaultParams: { radius: 50e-9 },
    parameters: [
      { key: "radius", label: "Radius", type: "number", unit: "m", min: 0 },
    ],
  },
  {
    kind: "ring",
    label: "Ring",
    category: "primitive",
    icon: "CircleDashed",
    defaultParams: { outer_radius: 100e-9, inner_radius: 50e-9, height: 10e-9, axis: "z" },
    parameters: [
      { key: "outer_radius", label: "Outer radius", type: "number", unit: "m", min: 0 },
      { key: "inner_radius", label: "Inner radius", type: "number", unit: "m", min: 0 },
      { key: "height", label: "Height", type: "number", unit: "m", min: 0 },
      { key: "axis", label: "Axis", type: "enum", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }, { value: "z", label: "Z" }] },
    ],
  },
  {
    kind: "nanowire",
    label: "Nanowire",
    category: "component",
    icon: "Minus",
    description: "Long cylindrical or rectangular wire.",
    defaultParams: { length: 1000e-9, width: 20e-9, height: 5e-9, axis: "x" },
    parameters: [
      { key: "length", label: "Length", type: "number", unit: "m", min: 0 },
      { key: "width", label: "Width", type: "number", unit: "m", min: 0 },
      { key: "height", label: "Height / Thickness", type: "number", unit: "m", min: 0 },
      { key: "axis", label: "Long axis", type: "enum", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }, { value: "z", label: "Z" }] },
    ],
  },
  {
    kind: "thin_film",
    label: "Thin Film",
    category: "component",
    icon: "Square",
    description: "Extended thin rectangular film.",
    defaultParams: { length: 1000e-9, width: 1000e-9, thickness: 1e-9 },
    parameters: [
      { key: "length", label: "Length", type: "number", unit: "m", min: 0 },
      { key: "width", label: "Width", type: "number", unit: "m", min: 0 },
      { key: "thickness", label: "Thickness", type: "number", unit: "m", min: 0 },
    ],
  },
  {
    kind: "pillar",
    label: "Pillar",
    category: "component",
    icon: "AlignVerticalSpaceAround",
    defaultParams: { radius: 30e-9, height: 100e-9 },
    parameters: [
      { key: "radius", label: "Radius", type: "number", unit: "m", min: 0 },
      { key: "height", label: "Height", type: "number", unit: "m", min: 0 },
    ],
  },
  {
    kind: "disk",
    label: "Disk",
    category: "component",
    icon: "Disc",
    defaultParams: { radius: 100e-9, thickness: 5e-9 },
    parameters: [
      { key: "radius", label: "Radius", type: "number", unit: "m", min: 0 },
      { key: "thickness", label: "Thickness", type: "number", unit: "m", min: 0 },
    ],
  },
  {
    kind: "mumax_standard_problem_3",
    label: "Standard Problem 3",
    category: "standard_sample",
    icon: "BookOpen",
    description: "Standard micromagnetic problem 3 (cubic).",
    defaultParams: { dimensions: [100e-9, 100e-9, 100e-9] },
    parameters: [
      { key: "dimensions", label: "Dimensions", type: "vector3", unit: "m" },
    ],
  },
  {
    kind: "sp4",
    label: "Standard Problem 4",
    category: "standard_sample",
    icon: "BookOpen",
    description: "Standard micromagnetic problem 4 (thin film).",
    defaultParams: { length: 500e-9, width: 125e-9, thickness: 3e-9 },
    parameters: [
      { key: "length", label: "Length", type: "number", unit: "m", min: 0 },
      { key: "width", label: "Width", type: "number", unit: "m", min: 0 },
      { key: "thickness", label: "Thickness", type: "number", unit: "m", min: 0 },
    ],
  },
];
