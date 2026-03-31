"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FemMeshData } from "./FemMeshView3D";
import { DIVERGING_PALETTE, POSITIVE_PALETTE } from "../../lib/colorPalettes";
import type { AntennaOverlay } from "../runs/control-room/shared";

type SlicePlane = "xy" | "xz" | "yz";
type VectorComponent = "x" | "y" | "z" | "magnitude";

interface Props {
  meshData: FemMeshData;
  quantityLabel: string;
  quantityId?: string;
  component: VectorComponent;
  plane: SlicePlane;
  sliceIndex: number;
  sliceCount?: number;
  antennaOverlays?: AntennaOverlay[];
  selectedAntennaId?: string | null;
}

type Point3 = [number, number, number];
type Point2 = [number, number];

interface Segment2D {
  a: Point2;
  b: Point2;
  va: number;
  vb: number;
}

interface Polygon2D {
  points: Point2[];
  value: number;
}

interface AntennaRect2D {
  id: string;
  role: AntennaOverlay["conductors"][number]["role"];
  bounds: { uMin: number; uMax: number; vMin: number; vMax: number };
  selected: boolean;
}

const BG = "#1e1e2e";
const BORDER = "#313244"; /* Catppuccin Surface0 */
const TEXT = "#a6adc8"; /* Catppuccin Subtext0 */
const TEXT_STRONG = "#cdd6f4"; /* Catppuccin Text */
const GRID = "rgba(108, 112, 134, 0.08)"; /* Catppuccin Overlay0 */
const EMPTY = "rgba(205, 214, 244, 0.08)"; /* Catppuccin Text */
const DIVERGING = DIVERGING_PALETTE as unknown as string[];
const POSITIVE = POSITIVE_PALETTE as unknown as string[];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPoint(a: Point3, b: Point3, t: number): Point3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function toPoints(nodes: number[]): Point3[] {
  const points: Point3[] = [];
  for (let index = 0; index < nodes.length; index += 3) {
    points.push([nodes[index], nodes[index + 1], nodes[index + 2]]);
  }
  return points;
}

function nodeScalar(meshData: FemMeshData, nodeIndex: number, component: VectorComponent): number {
  const fld = meshData.fieldData;
  if (!fld) {
    return 0;
  }
  const fx = fld.x[nodeIndex] ?? 0;
  const fy = fld.y[nodeIndex] ?? 0;
  const fz = fld.z[nodeIndex] ?? 0;
  switch (component) {
    case "x":
      return fx;
    case "y":
      return fy;
    case "z":
      return fz;
    case "magnitude":
      return Math.sqrt(fx * fx + fy * fy + fz * fz);
  }
}

function axisIndices(plane: SlicePlane): { normal: 0 | 1 | 2; u: 0 | 1 | 2; v: 0 | 1 | 2 } {
  switch (plane) {
    case "xy":
      return { normal: 2, u: 0, v: 1 };
    case "xz":
      return { normal: 1, u: 0, v: 2 };
    case "yz":
      return { normal: 0, u: 1, v: 2 };
  }
}

function project(point: Point3, plane: SlicePlane): Point2 {
  const { u, v } = axisIndices(plane);
  return [point[u], point[v]];
}

function axisLabel(index: 0 | 1 | 2): string {
  return index === 0 ? "x" : index === 1 ? "y" : "z";
}

function paletteColor(t: number, palette: string[]): string {
  const n = palette.length - 1;
  const scaled = clamp(t, 0, 1) * n;
  const index = Math.min(Math.floor(scaled), n - 1);
  const frac = scaled - index;
  const a = palette[index];
  const b = palette[index + 1];
  if (frac <= 1e-6) {
    return a;
  }
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const mix = (x: number, y: number) => Math.round(lerp(x, y, frac));
  return `rgb(${mix(ar, br)}, ${mix(ag, bg)}, ${mix(ab, bb)})`;
}

function colorForValue(value: number, min: number, max: number, quantityId: string | undefined): string {
  const isMagnetization = !quantityId || quantityId === "m";
  if (isMagnetization && min === 0 && max === 1) {
    return paletteColor(value, POSITIVE);
  }
  const palette = min < 0 && max > 0 ? DIVERGING : POSITIVE;
  const t = max > min ? (value - min) / (max - min) : 0.5;
  return paletteColor(t, palette);
}

function uniquePoints(points: { point: Point3; value: number }[], epsilon: number) {
  const out: { point: Point3; value: number }[] = [];
  for (const candidate of points) {
    const exists = out.some(
      (entry) =>
        Math.abs(entry.point[0] - candidate.point[0]) <= epsilon &&
        Math.abs(entry.point[1] - candidate.point[1]) <= epsilon &&
        Math.abs(entry.point[2] - candidate.point[2]) <= epsilon,
    );
    if (!exists) {
      out.push(candidate);
    }
  }
  return out;
}

function collectBoundarySegments(
  meshData: FemMeshData,
  plane: SlicePlane,
  component: VectorComponent,
  sliceIndex: number,
  sliceCount: number,
) {
  const flatNodes = meshData.nodes;
  const flatFaces = meshData.boundaryFaces;
  const numNodes = flatNodes.length / 3;
  const numFaces = flatFaces.length / 3;

  const { normal, u, v } = axisIndices(plane);

  let minN = Number.POSITIVE_INFINITY;
  let maxN = Number.NEGATIVE_INFINITY;
  let uMin = Number.POSITIVE_INFINITY;
  let uMax = Number.NEGATIVE_INFINITY;
  let vMin = Number.POSITIVE_INFINITY;
  let vMax = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < numNodes; i++) {
    const pn = flatNodes[i * 3 + normal];
    const pu = flatNodes[i * 3 + u];
    const pv = flatNodes[i * 3 + v];
    if (pn < minN) minN = pn;
    if (pn > maxN) maxN = pn;
    if (pu < uMin) uMin = pu;
    if (pu > uMax) uMax = pu;
    if (pv < vMin) vMin = pv;
    if (pv > vMax) vMax = pv;
  }

  const planeCoord =
    sliceCount <= 1 || Math.abs(maxN - minN) <= 1e-18
      ? minN
      : lerp(minN, maxN, clamp(sliceIndex, 0, sliceCount - 1) / (sliceCount - 1));
  const epsilon = Math.max(((maxN - minN) / Math.max(sliceCount - 1, 1)) * 0.25, 1e-15);

  const segments: Segment2D[] = [];
  let valueMin = Number.POSITIVE_INFINITY;
  let valueMax = Number.NEGATIVE_INFINITY;

  const addSegment = (pa: Point3, pb: Point3, va: number, vb: number) => {
    valueMin = Math.min(valueMin, va, vb);
    valueMax = Math.max(valueMax, va, vb);
    segments.push({
      a: project(pa, plane),
      b: project(pb, plane),
      va,
      vb,
    });
  };

  const edges = [
    [0, 1],
    [1, 2],
    [2, 0],
  ] as const;

  for (let f = 0; f < numFaces; f++) {
    const ia = flatFaces[f * 3];
    const ib = flatFaces[f * 3 + 1];
    const ic = flatFaces[f * 3 + 2];

    const p: [Point3, Point3, Point3] = [
      [flatNodes[ia * 3], flatNodes[ia * 3 + 1], flatNodes[ia * 3 + 2]],
      [flatNodes[ib * 3], flatNodes[ib * 3 + 1], flatNodes[ib * 3 + 2]],
      [flatNodes[ic * 3], flatNodes[ic * 3 + 1], flatNodes[ic * 3 + 2]],
    ];

    const values = [
      nodeScalar(meshData, ia, component),
      nodeScalar(meshData, ib, component),
      nodeScalar(meshData, ic, component),
    ] as const;

    const signed = [
      p[0][normal] - planeCoord,
      p[1][normal] - planeCoord,
      p[2][normal] - planeCoord,
    ] as const;

    const near = [
      Math.abs(signed[0]) <= epsilon,
      Math.abs(signed[1]) <= epsilon,
      Math.abs(signed[2]) <= epsilon,
    ] as const;

    if (near[0] && near[1] && near[2]) {
      addSegment(p[0], p[1], values[0], values[1]);
      addSegment(p[1], p[2], values[1], values[2]);
      addSegment(p[2], p[0], values[2], values[0]);
      continue;
    }

    const intersections: { point: Point3; value: number }[] = [];

    for (const [a, b] of edges) {
      const da = signed[a];
      const db = signed[b];
      const va = values[a];
      const vb = values[b];

      if (Math.abs(da) <= epsilon && Math.abs(db) <= epsilon) {
        continue;
      }
      if (Math.abs(da) <= epsilon) {
        intersections.push({ point: p[a], value: va });
        continue;
      }
      if (Math.abs(db) <= epsilon) {
        intersections.push({ point: p[b], value: vb });
        continue;
      }
      if (da * db < 0) {
        const t = da / (da - db);
        intersections.push({
          point: lerpPoint(p[a], p[b], t),
          value: lerp(va, vb, t),
        });
      }
    }

    const unique = uniquePoints(intersections, epsilon);
    if (unique.length === 2) {
      addSegment(unique[0].point, unique[1].point, unique[0].value, unique[1].value);
    } else if (unique.length === 3) {
      unique.sort((lhs, rhs) => lhs.point[u] - rhs.point[u] || lhs.point[v] - rhs.point[v]);
      addSegment(unique[0].point, unique[1].point, unique[0].value, unique[1].value);
      addSegment(unique[1].point, unique[2].point, unique[1].value, unique[2].value);
    }
  }

  if (!Number.isFinite(valueMin)) {
    valueMin = 0;
    valueMax = 0;
  }

  const hasFieldData = !!meshData.fieldData;
  const effectiveRange =
    component === "magnitude"
      ? { min: 0, max: Math.max(1, valueMax) }
      : valueMin < 0 && valueMax > 0
        ? {
            min: -Math.max(Math.abs(valueMin), Math.abs(valueMax)),
            max: Math.max(Math.abs(valueMin), Math.abs(valueMax)),
          }
        : { min: valueMin, max: valueMax };

  return {
    planeCoord,
    normalLabel: axisLabel(normal),
    uLabel: axisLabel(u),
    vLabel: axisLabel(v),
    bounds: { uMin, uMax, vMin, vMax },
    segments,
    polygons: [] as Polygon2D[],
    valueRange: hasFieldData ? effectiveRange : effectiveRange,
  };
}

function sortIntersectionLoop(
  points: { point: Point3; value: number }[],
  plane: SlicePlane,
) {
  if (points.length <= 2) {
    return points;
  }
  const projected = points.map((entry) => ({
    ...entry,
    uv: project(entry.point, plane),
  }));
  const centerU = projected.reduce((sum, entry) => sum + entry.uv[0], 0) / projected.length;
  const centerV = projected.reduce((sum, entry) => sum + entry.uv[1], 0) / projected.length;
  projected.sort(
    (left, right) =>
      Math.atan2(left.uv[1] - centerV, left.uv[0] - centerU) -
      Math.atan2(right.uv[1] - centerV, right.uv[0] - centerU),
  );
  return projected.map(({ point, value }) => ({ point, value }));
}

function collectTetraSegments(
  meshData: FemMeshData,
  plane: SlicePlane,
  component: VectorComponent,
  sliceIndex: number,
  sliceCount: number,
) {
  const flatNodes = meshData.nodes;
  const flatElements = meshData.elements;
  const numNodes = flatNodes.length / 3;
  const numElements = flatElements.length / 4;

  const { normal, u, v } = axisIndices(plane);

  let minN = Number.POSITIVE_INFINITY;
  let maxN = Number.NEGATIVE_INFINITY;
  let uMin = Number.POSITIVE_INFINITY;
  let uMax = Number.NEGATIVE_INFINITY;
  let vMin = Number.POSITIVE_INFINITY;
  let vMax = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < numNodes; i++) {
    const pn = flatNodes[i * 3 + normal];
    const pu = flatNodes[i * 3 + u];
    const pv = flatNodes[i * 3 + v];
    if (pn < minN) minN = pn;
    if (pn > maxN) maxN = pn;
    if (pu < uMin) uMin = pu;
    if (pu > uMax) uMax = pu;
    if (pv < vMin) vMin = pv;
    if (pv > vMax) vMax = pv;
  }

  const planeCoord =
    sliceCount <= 1 || Math.abs(maxN - minN) <= 1e-18
      ? minN
      : lerp(minN, maxN, clamp(sliceIndex, 0, sliceCount - 1) / (sliceCount - 1));
  const epsilon = Math.max(((maxN - minN) / Math.max(sliceCount - 1, 1)) * 0.25, 1e-15);

  const polygons: Polygon2D[] = [];
  let valueMin = Number.POSITIVE_INFINITY;
  let valueMax = Number.NEGATIVE_INFINITY;

  const edges = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ] as const;

  for (let elementIndex = 0; elementIndex < numElements; elementIndex++) {
    const ids = [
      flatElements[elementIndex * 4],
      flatElements[elementIndex * 4 + 1],
      flatElements[elementIndex * 4 + 2],
      flatElements[elementIndex * 4 + 3],
    ] as const;

    const points = ids.map(
      (nodeIndex) =>
        [
          flatNodes[nodeIndex * 3],
          flatNodes[nodeIndex * 3 + 1],
          flatNodes[nodeIndex * 3 + 2],
        ] as Point3,
    ) as [Point3, Point3, Point3, Point3];

    const values = ids.map((nodeIndex) => nodeScalar(meshData, nodeIndex, component)) as [
      number,
      number,
      number,
      number,
    ];

    const signed = points.map((point) => point[normal] - planeCoord) as [
      number,
      number,
      number,
      number,
    ];

    const intersections: { point: Point3; value: number }[] = [];

    for (const [a, b] of edges) {
      const da = signed[a];
      const db = signed[b];
      const va = values[a];
      const vb = values[b];

      if (Math.abs(da) <= epsilon && Math.abs(db) <= epsilon) {
        intersections.push({ point: points[a], value: va });
        intersections.push({ point: points[b], value: vb });
        continue;
      }
      if (Math.abs(da) <= epsilon) {
        intersections.push({ point: points[a], value: va });
        continue;
      }
      if (Math.abs(db) <= epsilon) {
        intersections.push({ point: points[b], value: vb });
        continue;
      }
      if (da * db > 0) {
        continue;
      }

      const t = da / (da - db);
      intersections.push({
        point: lerpPoint(points[a], points[b], t),
        value: lerp(va, vb, t),
      });
    }

    const unique = sortIntersectionLoop(uniquePoints(intersections, epsilon), plane);
    if (unique.length < 3) {
      continue;
    }

    let avgValue = 0;
    const pts: Point2[] = [];
    let minVal = unique[0].value, maxVal = unique[0].value;
    for (const v of unique) {
      avgValue += v.value;
      pts.push(project(v.point, plane));
      if (v.value < minVal) minVal = v.value;
      if (v.value > maxVal) maxVal = v.value;
    }
    avgValue /= unique.length;

    valueMin = Math.min(valueMin, minVal);
    valueMax = Math.max(valueMax, maxVal);

    polygons.push({
      points: pts,
      value: avgValue,
    });
  }

  if (!Number.isFinite(valueMin)) {
    valueMin = 0;
    valueMax = 0;
  }

  const hasFieldData = !!meshData.fieldData;
  const effectiveRange =
    component === "magnitude"
      ? { min: 0, max: Math.max(1, valueMax) }
      : valueMin < 0 && valueMax > 0
        ? {
            min: -Math.max(Math.abs(valueMin), Math.abs(valueMax)),
            max: Math.max(Math.abs(valueMin), Math.abs(valueMax)),
          }
        : { min: valueMin, max: valueMax };

  return {
    planeCoord,
    normalLabel: axisLabel(normal),
    uLabel: axisLabel(u),
    vLabel: axisLabel(v),
    bounds: { uMin, uMax, vMin, vMax },
    segments: [] as Segment2D[],
    polygons,
    valueRange: hasFieldData ? effectiveRange : effectiveRange,
  };
}

function collectSegments(
  meshData: FemMeshData,
  plane: SlicePlane,
  component: VectorComponent,
  sliceIndex: number,
  sliceCount: number,
) {
  if (meshData.elements.length >= 4) {
    return collectTetraSegments(meshData, plane, component, sliceIndex, sliceCount);
  }
  return collectBoundarySegments(meshData, plane, component, sliceIndex, sliceCount);
}

function collectAntennaRects(
  overlays: AntennaOverlay[],
  plane: SlicePlane,
  planeCoord: number,
  selectedAntennaId?: string | null,
): AntennaRect2D[] {
  const { normal, u, v } = axisIndices(plane);
  const epsilon = 1e-15;
  const rects: AntennaRect2D[] = [];

  for (const overlay of overlays) {
    const selected = selectedAntennaId === overlay.id;
    for (const conductor of overlay.conductors) {
      if (
        planeCoord < conductor.boundsMin[normal] - epsilon ||
        planeCoord > conductor.boundsMax[normal] + epsilon
      ) {
        continue;
      }
      rects.push({
        id: conductor.id,
        role: conductor.role,
        selected,
        bounds: {
          uMin: conductor.boundsMin[u],
          uMax: conductor.boundsMax[u],
          vMin: conductor.boundsMin[v],
          vMax: conductor.boundsMax[v],
        },
      });
    }
  }

  return rects;
}

function antennaRectColors(
  role: AntennaRect2D["role"],
  selected: boolean,
): { fill: string; stroke: string } {
  if (role === "ground") {
    return selected
      ? { fill: "rgba(103, 232, 249, 0.28)", stroke: "#a5f3fc" }
      : { fill: "rgba(14, 165, 233, 0.16)", stroke: "#67e8f9" };
  }
  return selected
    ? { fill: "rgba(251, 146, 60, 0.32)", stroke: "#fdba74" }
    : { fill: "rgba(249, 115, 22, 0.18)", stroke: "#fb923c" };
}

export default function FemMeshSlice2D({
  meshData,
  quantityLabel,
  quantityId,
  component,
  plane,
  sliceIndex,
  sliceCount = 25,
  antennaOverlays = [],
  selectedAntennaId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<[number, number]>([0, 0]);

  const slice = useMemo(
    () => collectSegments(meshData, plane, component, sliceIndex, sliceCount),
    [meshData, plane, component, sliceIndex, sliceCount],
  );
  const antennaRects = useMemo(
    () => collectAntennaRects(antennaOverlays, plane, slice.planeCoord, selectedAntennaId),
    [antennaOverlays, plane, selectedAntennaId, slice.planeCoord],
  );

  // Track container size so the canvas re-draws on resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize([Math.round(width), Math.round(height)]);
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const width = canvas.clientWidth || 900;
    const height = canvas.clientHeight || 520;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    const margin = { left: 64, right: 22, top: 28, bottom: 54 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const { uMin, uMax, vMin, vMax } = slice.bounds;
    const du = Math.max(uMax - uMin, 1e-18);
    const dv = Math.max(vMax - vMin, 1e-18);
    const scale = Math.min(innerW / du, innerH / dv);
    const ox = margin.left + (innerW - du * scale) * 0.5;
    const oy = margin.top + (innerH - dv * scale) * 0.5;

    const map = ([u, v]: Point2): Point2 => [
      ox + (u - uMin) * scale,
      oy + innerH - (v - vMin) * scale,
    ];

    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(margin.left, margin.top, innerW, innerH);

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (let index = 1; index < 5; index += 1) {
      const x = margin.left + (innerW * index) / 5;
      const y = margin.top + (innerH * index) / 5;
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + innerH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + innerW, y);
      ctx.stroke();
    }

    if (slice.segments.length === 0 && slice.polygons.length === 0) {
      ctx.fillStyle = EMPTY;
      ctx.font = "600 14px IBM Plex Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No mesh intersection for this plane", width / 2, height / 2 - 8);
      ctx.fillStyle = TEXT;
      ctx.font = "12px IBM Plex Sans, sans-serif";
      ctx.fillText(
        `${slice.normalLabel} = ${slice.planeCoord.toExponential(3)} m`,
        width / 2,
        height / 2 + 18,
      );
    } else {
      const { min, max } = slice.valueRange;
      const hasField = !!meshData.fieldData;

      // Draw volume polygons
      for (const poly of slice.polygons) {
        if (poly.points.length < 3) continue;
        ctx.fillStyle = hasField
          ? colorForValue(poly.value, min, max, quantityId)
          : "rgba(108, 112, 134, 0.18)";
        ctx.beginPath();
        const first = map(poly.points[0]);
        ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < poly.points.length; i++) {
          const pt = map(poly.points[i]);
          ctx.lineTo(pt[0], pt[1]);
        }
        ctx.closePath();
        ctx.fill();

        // Element boundaries — prominent when no field, subtle with field data
        ctx.strokeStyle = hasField ? "rgba(0, 0, 0, 0.2)" : "rgba(166, 173, 200, 0.55)";
        ctx.lineWidth = hasField ? 0.5 : 1;
        ctx.stroke();
      }

      // Draw surface segments
      for (const segment of slice.segments) {
        const [x1, y1] = map(segment.a);
        const [x2, y2] = map(segment.b);
        if (hasField) {
          const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
          gradient.addColorStop(0, colorForValue(segment.va, min, max, quantityId));
          gradient.addColorStop(1, colorForValue(segment.vb, min, max, quantityId));
          ctx.strokeStyle = gradient;
        } else {
          ctx.strokeStyle = "rgba(166, 173, 200, 0.7)";
        }
        ctx.lineWidth = 2.35;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      for (const rect of antennaRects) {
        const [ax1, ay1] = map([rect.bounds.uMin, rect.bounds.vMin]);
        const [ax2, ay2] = map([rect.bounds.uMax, rect.bounds.vMax]);
        const x = Math.min(ax1, ax2);
        const y = Math.min(ay1, ay2);
        const width = Math.max(Math.abs(ax2 - ax1), 1);
        const height = Math.max(Math.abs(ay2 - ay1), 1);
        const colors = antennaRectColors(rect.role, rect.selected);
        ctx.fillStyle = colors.fill;
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = rect.selected ? 2.4 : 1.5;
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
      }
    }

    ctx.fillStyle = TEXT;
    ctx.font = "12px IBM Plex Sans, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${slice.uLabel} axis`, margin.left, height - 18);
    ctx.save();
    ctx.translate(18, margin.top + innerH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${slice.vLabel} axis`, 0, 0);
    ctx.restore();

    ctx.fillStyle = TEXT_STRONG;
    ctx.font = "600 12px IBM Plex Mono, monospace";
    ctx.textAlign = "right";
    const elementCount = slice.segments.length + slice.polygons.length;
    const fieldLabel = meshData.fieldData
      ? `${quantityLabel}.${component}`
      : "mesh";
    ctx.fillText(
      `${fieldLabel} | ${slice.normalLabel}=${slice.planeCoord.toExponential(3)} m | ${elementCount} elements`,
      width - 16,
      18,
    );
  }, [
    antennaRects,
    canvasSize,
    component,
    meshData.fieldData,
    plane,
    quantityId,
    quantityLabel,
    slice,
    sliceCount,
  ]);

  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden rounded-[8px] bg-[#1e1e2e]">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
      />
    </div>
  );
}
