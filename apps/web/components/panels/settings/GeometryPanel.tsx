"use client";

import { startTransition, useCallback, useMemo } from "react";

import { useModel } from "../../runs/control-room/ControlRoomContext";
import { extractGeometryBoundsFromParams, fmtSI } from "../../runs/control-room/shared";
import { TextField } from "../../ui/TextField";
import SelectField from "../../ui/SelectField";
import { Button } from "../../ui/button";
import type { ScriptBuilderGeometryEntry } from "../../../lib/session/types";
import { findGeometryByNodeId } from "./objectSelection";
import { SidebarSection, SubSectionHeader } from "./primitives";

function defaultGeometryParams(kind: string, name: string): Record<string, unknown> {
  switch (kind) {
    case "Cylinder":
      return { radius: 10e-9, height: 20e-9, name };
    case "Ellipsoid":
      return { rx: 10e-9, ry: 10e-9, rz: 20e-9, name };
    case "Ellipse":
      return { rx: 10e-9, ry: 10e-9, height: 5e-9, name };
    case "ImportedGeometry":
      return { source: "", scale: 1.0, volume: "full", name };
    case "Difference":
      return {
        base: {
          geometry_kind: "Box",
          geometry_params: { size: [20e-9, 20e-9, 10e-9], name: `${name}_base` },
        },
        tool: {
          geometry_kind: "Cylinder",
          geometry_params: { radius: 5e-9, height: 10e-9, name: `${name}_tool` },
        },
      };
    case "Union":
    case "Intersection":
      return {
        a: {
          geometry_kind: "Box",
          geometry_params: { size: [20e-9, 20e-9, 10e-9], name: `${name}_a` },
        },
        b: {
          geometry_kind: "Cylinder",
          geometry_params: { radius: 5e-9, height: 10e-9, name: `${name}_b` },
        },
      };
    case "Box":
    default:
      return { size: [20e-9, 20e-9, 10e-9], name };
  }
}

function cloneGeometryEntry(source: ScriptBuilderGeometryEntry, nextName: string): ScriptBuilderGeometryEntry {
  const nextRegionName =
    !source.region_name || source.region_name === source.name ? null : `${source.region_name}_${nextName}`;
  return {
    ...source,
    name: nextName,
    region_name: nextRegionName,
    geometry_params: {
      ...source.geometry_params,
      name: nextName,
    },
  };
}

function makeUniqueName(baseName: string, geometries: ScriptBuilderGeometryEntry[], skipIndex = -1): string {
  const normalized = baseName.trim() || "body";
  const existing = new Set(
    geometries
      .map((geometry, index) => (index === skipIndex ? null : geometry.name))
      .filter((value): value is string => Boolean(value)),
  );
  if (!existing.has(normalized)) {
    return normalized;
  }
  let counter = 2;
  while (existing.has(`${normalized}_${counter}`)) {
    counter += 1;
  }
  return `${normalized}_${counter}`;
}

function readTranslation(params: Record<string, unknown>): [number, number, number] {
  const raw = Array.isArray(params.translation)
    ? params.translation
    : Array.isArray(params.translate)
      ? params.translate
      : [0, 0, 0];
  return [
    Number(raw[0]) || 0,
    Number(raw[1]) || 0,
    Number(raw[2]) || 0,
  ];
}

function shiftBounds(
  bounds: [number, number, number] | null | undefined,
  delta: [number, number, number],
): [number, number, number] | null | undefined {
  if (!bounds || bounds.length !== 3) {
    return bounds;
  }
  const shifted = bounds.map((component, index) => component + delta[index]) as [number, number, number];
  return shifted.every((component) => Number.isFinite(component)) ? shifted : bounds;
}

function formatBounds(
  min: [number, number, number] | null | undefined,
  max: [number, number, number] | null | undefined,
): string {
  if (!min || !max) return "—";
  return `x ${fmtSI(min[0], "m")} → ${fmtSI(max[0], "m")} | y ${fmtSI(min[1], "m")} → ${fmtSI(max[1], "m")} | z ${fmtSI(min[2], "m")} → ${fmtSI(max[2], "m")}`;
}

function formatExtent(
  min: [number, number, number] | null | undefined,
  max: [number, number, number] | null | undefined,
): string {
  if (!min || !max) return "—";
  return [
    fmtSI(max[0] - min[0], "m"),
    fmtSI(max[1] - min[1], "m"),
    fmtSI(max[2] - min[2], "m"),
  ].join(" · ");
}

function describeGeometryDescriptor(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "unknown";
  const entry = raw as { geometry_kind?: unknown; geometry_params?: unknown };
  const kind = typeof entry.geometry_kind === "string" ? entry.geometry_kind : "unknown";
  const params =
    entry.geometry_params && typeof entry.geometry_params === "object"
      ? (entry.geometry_params as Record<string, unknown>)
      : {};
  if (kind === "Box" && Array.isArray(params.size)) {
    return `Box ${params.size.map((value) => `${(Number(value) * 1e9).toFixed(1)}nm`).join(" × ")}`;
  }
  if (kind === "Cylinder") {
    return `Cylinder r=${((Number(params.radius ?? 0)) * 1e9).toFixed(1)}nm h=${((Number(params.height ?? 0)) * 1e9).toFixed(1)}nm`;
  }
  if (kind === "Ellipsoid") {
    return `Ellipsoid ${["rx", "ry", "rz"].map((key) => `${key}=${((Number(params[key] ?? 0)) * 1e9).toFixed(1)}nm`).join(" ")}`;
  }
  if (kind === "ImportedGeometry") {
    return `Imported ${(String(params.source ?? "") || "mesh").split("/").pop()}`;
  }
  if (kind === "Translate") {
    return `Translate ${describeGeometryDescriptor(params.base)} by ${Array.isArray(params.translation) ? params.translation.map((value) => `${(Number(value) * 1e9).toFixed(1)}nm`).join(", ") : "?"}`;
  }
  if (kind === "Difference") {
    return `Difference(${describeGeometryDescriptor(params.base)} - ${describeGeometryDescriptor(params.tool)})`;
  }
  if (kind === "Union") {
    return `Union(${describeGeometryDescriptor(params.a)} + ${describeGeometryDescriptor(params.b)})`;
  }
  if (kind === "Intersection") {
    return `Intersection(${describeGeometryDescriptor(params.a)} & ${describeGeometryDescriptor(params.b)})`;
  }
  return kind;
}

export default function GeometryPanel({ nodeId }: { nodeId?: string }) {
  const model = useModel();

  const { geometry: geo, index: geoIndex } = useMemo(
    () => findGeometryByNodeId(nodeId, model.scriptBuilderGeometries),
    [nodeId, model.scriptBuilderGeometries],
  );

  const updateGeo = useCallback((updater: (g: ScriptBuilderGeometryEntry) => ScriptBuilderGeometryEntry) => {
    if (geoIndex < 0) return;
    model.setScriptBuilderGeometries((prev) => {
      const next = [...prev];
      const target = next[geoIndex];
      if (target) next[geoIndex] = updater(target);
      return next;
    });
  }, [geoIndex, model.setScriptBuilderGeometries]);

  const handleBoxSize = (idx: number, valStr: string) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    updateGeo((g) => {
      const size = Array.isArray(g.geometry_params.size)
        ? [...g.geometry_params.size]
        : [20e-9, 20e-9, 10e-9];
      size[idx] = val * 1e-9;
      return { ...g, geometry_params: { ...g.geometry_params, size } };
    });
  };

  const handleParamNum = (key: string, valStr: string) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    updateGeo((g) => ({
      ...g,
      geometry_params: { ...g.geometry_params, [key]: val * 1e-9 },
    }));
  };

  const handleTranslation = (idx: number, valStr: string) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    startTransition(() => {
      updateGeo((g) => {
        const currentTranslation = readTranslation(g.geometry_params);
        const translation = [...currentTranslation] as [number, number, number];
        translation[idx] = val * 1e-9;
        const delta = translation.map(
          (component, componentIndex) => component - currentTranslation[componentIndex],
        ) as [number, number, number];
        return {
          ...g,
          geometry_params: { ...g.geometry_params, translation },
          bounds_min: shiftBounds(g.bounds_min, delta),
          bounds_max: shiftBounds(g.bounds_max, delta),
        };
      });
    });
  };

  const handleScaleComponent = (idx: number, valStr: string) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    updateGeo((g) => {
      const currentScale = g.geometry_params.scale;
      const scale = Array.isArray(currentScale)
        ? [...currentScale]
        : [Number(currentScale ?? 1), Number(currentScale ?? 1), Number(currentScale ?? 1)];
      scale[idx] = val;
      return { ...g, geometry_params: { ...g.geometry_params, scale } };
    });
  };

  if (!geo) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Geometry</span>
          <span className="font-mono text-xs text-foreground">{model.meshName ?? model.mesherSourceKind ?? "—"}</span>
        </div>
        <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Source</span>
          <span className="font-mono text-xs text-foreground">{model.meshSource ?? model.mesherSourceKind ?? "—"}</span>
        </div>
        <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Extent</span>
          <span className="font-mono text-xs text-foreground">
            {model.meshExtent
              ? `${fmtSI(model.meshExtent[0], "m")} · ${fmtSI(model.meshExtent[1], "m")} · ${fmtSI(model.meshExtent[2], "m")}`
              : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
          <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Bounds</span>
          <span className="font-mono text-xs text-foreground">
            {model.meshBoundsMin && model.meshBoundsMax
              ? `${fmtSI(model.meshBoundsMin[0], "m")} → ${fmtSI(model.meshBoundsMax[0], "m")}`
              : "—"}
          </span>
        </div>
      </div>
    );
  }

  const p = geo.geometry_params;
  const translation = readTranslation(p);
  const size = Array.isArray(p.size) ? p.size : [20e-9, 20e-9, 10e-9];
  const scale = p.scale;
  const regionName = geo.region_name?.trim() || geo.name;
  const liveBounds = extractGeometryBoundsFromParams(geo);
  const csgSummary =
    geo.geometry_kind === "Difference"
      ? `base: ${describeGeometryDescriptor(p.base)} | tool: ${describeGeometryDescriptor(p.tool)}`
      : geo.geometry_kind === "Union"
        ? `a: ${describeGeometryDescriptor(p.a)} | b: ${describeGeometryDescriptor(p.b)}`
        : geo.geometry_kind === "Intersection"
          ? `a: ${describeGeometryDescriptor(p.a)} | b: ${describeGeometryDescriptor(p.b)}`
          : null;

  return (
    <div className="flex flex-col pt-3 px-1.5">
      <SidebarSection title="Object Identity" icon="⚙" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              key={`${geo.name}-object-name`}
              label="Object Name"
              defaultValue={geo.name}
              onBlur={(event) => {
                const requested = event.target.value.trim();
                if (!requested || requested === geo.name) return;
                let renamedTo: string | null = null;
                model.setScriptBuilderGeometries((prev) => {
                  const nextName = makeUniqueName(requested, prev, geoIndex);
                  renamedTo = nextName;
                  const next = [...prev];
                  const target = next[geoIndex];
                  if (!target) return prev;
                  const shouldFollowObjectName =
                    !target.region_name || target.region_name === target.name;
                  next[geoIndex] = {
                    ...target,
                    name: nextName,
                    region_name: shouldFollowObjectName ? null : target.region_name,
                    geometry_params: {
                      ...target.geometry_params,
                      name: nextName,
                    },
                  };
                  return next;
                });
                if (!renamedTo) return;
                startTransition(() => {
                  model.setSelectedObjectId(renamedTo);
                  model.setSelectedSidebarNodeId(`obj-${renamedTo}`);
                });
              }}
              mono
              tooltip="Stable object identifier used by the tree, overlays and canonical script."
            />
            <TextField
              key={`${geo.name}-region-summary`}
              label="Effective Region"
              defaultValue={regionName}
              disabled
              mono
              tooltip="This object currently exposes one editable region in the builder."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                let duplicateName: string | null = null;
                model.setScriptBuilderGeometries((prev) => {
                  const next = [...prev];
                  const source = next[geoIndex];
                  if (!source) return prev;
                  const nextDuplicateName = makeUniqueName(`${source.name}_copy`, next);
                  duplicateName = nextDuplicateName;
                  next.splice(geoIndex + 1, 0, cloneGeometryEntry(source, nextDuplicateName));
                  return next;
                });
                if (!duplicateName) return;
                startTransition(() => {
                  model.setSelectedObjectId(duplicateName);
                  model.setSelectedSidebarNodeId(`obj-${duplicateName}`);
                  model.setObjectViewMode("context");
                });
              }}
            >
              Duplicate Object
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="opacity-90 hover:opacity-100"
              onClick={() => {
                model.setScriptBuilderGeometries((prev) => prev.filter((_, index) => index !== geoIndex));
              }}
            >
              Delete Object
            </Button>
          </div>
        </div>
      </SidebarSection>

      <SidebarSection title="Geometry" icon="📐" defaultOpen={true}>
        <div className="flex flex-col gap-5">
          <SelectField
            label="Geometry Kind"
            value={geo.geometry_kind}
            onchange={(nextKind) =>
              updateGeo((current) => ({
                ...current,
                geometry_kind: nextKind,
                geometry_params: defaultGeometryParams(nextKind, current.name),
              }))
            }
            options={[
              { label: "Box", value: "Box" },
              { label: "Cylinder", value: "Cylinder" },
              { label: "Ellipsoid", value: "Ellipsoid" },
              { label: "Ellipse", value: "Ellipse" },
              { label: "Imported Mesh", value: "ImportedGeometry" },
              { label: "Difference (CSG)", value: "Difference" },
              { label: "Union (CSG)", value: "Union" },
              { label: "Intersection (CSG)", value: "Intersection" },
            ]}
            tooltip="Choose the underlying geometry recipe for this object."
          />

          <div className="flex flex-col gap-3">
            <SubSectionHeader title="Dimensions" icon="📏" />
            {geo.geometry_kind === "Box" && (
              <div className="grid grid-cols-3 gap-3">
                <TextField key={`${geo.name}-size-x`} label="X Length" defaultValue={(size[0] * 1e9).toFixed(1)} onBlur={(e) => handleBoxSize(0, e.target.value)} unit="nm" mono />
                <TextField key={`${geo.name}-size-y`} label="Y Length" defaultValue={(size[1] * 1e9).toFixed(1)} onBlur={(e) => handleBoxSize(1, e.target.value)} unit="nm" mono />
                <TextField key={`${geo.name}-size-z`} label="Z Length" defaultValue={(size[2] * 1e9).toFixed(1)} onBlur={(e) => handleBoxSize(2, e.target.value)} unit="nm" mono />
              </div>
            )}
            {geo.geometry_kind === "Cylinder" && (
              <div className="grid grid-cols-2 gap-3">
                <TextField key={`${geo.name}-radius`} label="Radius" defaultValue={p.radius ? (Number(p.radius) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("radius", e.target.value)} unit="nm" mono />
                <TextField key={`${geo.name}-height`} label="Height" defaultValue={p.height ? (Number(p.height) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("height", e.target.value)} unit="nm" mono />
              </div>
            )}
            {geo.geometry_kind === "Ellipsoid" && (
              <div className="grid grid-cols-3 gap-3">
                <TextField key={`${geo.name}-rx`} label="Rx" defaultValue={p.rx ? (Number(p.rx) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("rx", e.target.value)} unit="nm" mono />
                <TextField key={`${geo.name}-ry`} label="Ry" defaultValue={p.ry ? (Number(p.ry) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("ry", e.target.value)} unit="nm" mono />
                <TextField key={`${geo.name}-rz`} label="Rz" defaultValue={p.rz ? (Number(p.rz) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("rz", e.target.value)} unit="nm" mono />
              </div>
            )}
            {geo.geometry_kind === "Ellipse" && (
              <div className="grid grid-cols-3 gap-3">
                <TextField key={`${geo.name}-ellipse-rx`} label="Rx" defaultValue={p.rx ? (Number(p.rx) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("rx", e.target.value)} unit="nm" mono />
                <TextField key={`${geo.name}-ellipse-ry`} label="Ry" defaultValue={p.ry ? (Number(p.ry) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("ry", e.target.value)} unit="nm" mono />
                <TextField key={`${geo.name}-ellipse-height`} label="Height" defaultValue={p.height ? (Number(p.height) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("height", e.target.value)} unit="nm" mono />
              </div>
            )}
            {geo.geometry_kind === "ImportedGeometry" && (
              <div className="flex flex-col gap-3">
                <TextField
                  key={`${geo.name}-source`}
                  label="Source File"
                  defaultValue={typeof p.source === "string" ? p.source : ""}
                  onBlur={(e) => updateGeo((g) => ({ ...g, geometry_params: { ...g.geometry_params, source: e.target.value.trim() } }))}
                  mono
                  placeholder="mesh.stl"
                />
                {Array.isArray(scale) ? (
                  <div className="grid grid-cols-3 gap-3">
                    <TextField key={`${geo.name}-scale-x`} label="Scale X" defaultValue={String(scale[0] ?? 1)} onBlur={(e) => handleScaleComponent(0, e.target.value)} mono />
                    <TextField key={`${geo.name}-scale-y`} label="Scale Y" defaultValue={String(scale[1] ?? 1)} onBlur={(e) => handleScaleComponent(1, e.target.value)} mono />
                    <TextField key={`${geo.name}-scale-z`} label="Scale Z" defaultValue={String(scale[2] ?? 1)} onBlur={(e) => handleScaleComponent(2, e.target.value)} mono />
                  </div>
                ) : (
                  <TextField
                    key={`${geo.name}-uniform-scale`}
                    label="Uniform Scale"
                    defaultValue={scale != null ? String(scale) : "1"}
                    onBlur={(e) => {
                      const value = Number.parseFloat(e.target.value);
                      if (!Number.isFinite(value)) return;
                      updateGeo((g) => ({ ...g, geometry_params: { ...g.geometry_params, scale: value } }));
                    }}
                    mono
                  />
                )}
                <SelectField
                  label="Imported Volume"
                  value={typeof p.volume === "string" ? p.volume : "full"}
                  onchange={(value) => updateGeo((g) => ({ ...g, geometry_params: { ...g.geometry_params, volume: value } }))}
                  options={[
                    { label: "Full Volume", value: "full" },
                    { label: "Surface Only", value: "surface" },
                  ]}
                />
              </div>
            )}
            {csgSummary && (
              <div className="rounded-lg border border-border/40 bg-card/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {csgSummary}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <SubSectionHeader title="Placement Offset" icon="↔" />
            <div className="grid grid-cols-3 gap-3">
              <TextField key={`${geo.name}-translate-x`} label="Translate X" defaultValue={(translation[0] * 1e9).toFixed(1)} onchange={(e) => handleTranslation(0, e.target.value)} onBlur={(e) => handleTranslation(0, e.target.value)} unit="nm" mono />
              <TextField key={`${geo.name}-translate-y`} label="Translate Y" defaultValue={(translation[1] * 1e9).toFixed(1)} onchange={(e) => handleTranslation(1, e.target.value)} onBlur={(e) => handleTranslation(1, e.target.value)} unit="nm" mono />
              <TextField key={`${geo.name}-translate-z`} label="Translate Z" defaultValue={(translation[2] * 1e9).toFixed(1)} onchange={(e) => handleTranslation(2, e.target.value)} onBlur={(e) => handleTranslation(2, e.target.value)} unit="nm" mono />
            </div>
          </div>
        </div>
      </SidebarSection>

      <SidebarSection title="Spatial Summary" icon="📐" defaultOpen={true}>
        <div className="grid grid-cols-1 gap-2.5">
          <div className="flex flex-col gap-1.5 rounded-lg border border-border/25 bg-gradient-to-b from-card/35 to-card/10 px-3 py-2.5 backdrop-blur-sm">
            <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground/80">Bounds</span>
            <span className="font-mono text-xs text-foreground tracking-tight">{formatBounds(liveBounds?.boundsMin, liveBounds?.boundsMax)}</span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-border/25 bg-gradient-to-b from-card/35 to-card/10 px-3 py-2.5 backdrop-blur-sm">
            <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground/80">Extent</span>
            <span className="font-mono text-xs text-foreground tracking-tight">{formatExtent(liveBounds?.boundsMin, liveBounds?.boundsMax)}</span>
          </div>
        </div>
      </SidebarSection>
    </div>
  );
}
