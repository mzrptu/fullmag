"use client";

import { useCallback, useMemo } from "react";
import { useModel } from "../../runs/control-room/ControlRoomContext";
import { fmtSI } from "../../runs/control-room/shared";
import { TextField } from "../../ui/TextField";
import SelectField from "../../ui/SelectField";
import { Button } from "../../ui/button";
import type { ScriptBuilderGeometryEntry } from "../../../lib/session/types";

export default function GeometryPanel({ nodeId }: { nodeId?: string }) {
  const model = useModel();

  const activeName = useMemo(() => {
    if (!nodeId || !nodeId.startsWith("geo-")) return null;
    const candidate = nodeId.replace(/^geo-/, "");
    const names = model.scriptBuilderGeometries
      .map((geometry) => geometry.name)
      .sort((left, right) => right.length - left.length);
    return names.find((name) => candidate === name || candidate.startsWith(`${name}-`)) ?? null;
  }, [nodeId, model.scriptBuilderGeometries]);

  const geoIndex = useMemo(() => {
    if (!activeName) return -1;
    return model.scriptBuilderGeometries.findIndex((g) => g.name === activeName);
  }, [activeName, model.scriptBuilderGeometries]);

  const geo = geoIndex >= 0 ? model.scriptBuilderGeometries[geoIndex] : undefined;

  const updateGeo = useCallback((updater: (g: ScriptBuilderGeometryEntry) => ScriptBuilderGeometryEntry) => {
    if (geoIndex < 0) return;
    model.setScriptBuilderGeometries((prev) => {
      const next = [...prev];
      const target = next[geoIndex];
      if (target) next[geoIndex] = updater(target);
      return next;
    });
  }, [geoIndex, model.setScriptBuilderGeometries]);

  const updateMesh = useCallback(
    (
      updater: (
        mesh: NonNullable<ScriptBuilderGeometryEntry["mesh"]>,
      ) => NonNullable<ScriptBuilderGeometryEntry["mesh"]>,
    ) => {
      updateGeo((g) => ({
        ...g,
        mesh: updater(
          g.mesh ?? {
            mode: "inherit",
            hmax: "",
            order: null,
            source: null,
            build_requested: false,
          },
        ),
      }));
    },
    [updateGeo],
  );

  const handleBoxSize = (idx: number, valStr: string) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    updateGeo((g) => {
      const size = Array.isArray(g.geometry_params.size) 
        ? [...g.geometry_params.size] 
        : [1e-9, 1e-9, 1e-9];
      size[idx] = val * 1e-9;
      return { ...g, geometry_params: { ...g.geometry_params, size } };
    });
  };

  const handleParamNum = (key: string, valStr: string) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    updateGeo((g) => ({
      ...g,
      geometry_params: { ...g.geometry_params, [key]: val * 1e-9 }
    }));
  };

  const handleTranslation = (idx: number, valStr: string) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    updateGeo((g) => {
      const translation = Array.isArray(g.geometry_params.translation) 
        ? [...g.geometry_params.translation] 
        : [0, 0, 0];
      translation[idx] = val * 1e-9;
      return { ...g, geometry_params: { ...g.geometry_params, translation } };
    });
  };

  const handleRotation = (idx: number, valStr: string) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    updateGeo((g) => {
      const rotation = Array.isArray(g.geometry_params.rotation) 
        ? [...g.geometry_params.rotation] 
        : [0, 0, 0];
      rotation[idx] = val;
      return { ...g, geometry_params: { ...g.geometry_params, rotation } };
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
        <div className="col-span-2 mt-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full"
            onClick={() => {
              model.setScriptBuilderGeometries(prev => [
                ...prev,
                {
                  name: `body_${prev.length + 1}`,
                  geometry_kind: "Box",
                  geometry_params: { size: [1e-8, 1e-8, 1e-8] },
                  material: { Ms: 800000, Aex: 1.3e-11, alpha: 0.02, Dind: null },
                  magnetization: { kind: "uniform", value: [1, 0, 0], seed: null, source_path: null },
                  mesh: { mode: "inherit", hmax: "", order: null, source: null, build_requested: false }
                }
              ]);
            }}
          >
            + Add Geometry Body
          </Button>
        </div>
      </div>
    );
  }

  const p = geo.geometry_params;
  const t = Array.isArray(p.translation) ? p.translation : [0, 0, 0];
  const r = Array.isArray(p.rotation) ? p.rotation : [0, 0, 0];
  const size = Array.isArray(p.size) ? p.size : [1e-9, 1e-9, 1e-9];
  const mesh = geo.mesh ?? {
    mode: "inherit" as const,
    hmax: "",
    order: null,
    source: null,
    build_requested: false,
  };
  const meshHmaxDisplay = mesh.hmax.trim() === "auto"
    ? "auto"
    : mesh.hmax.trim().length > 0 && Number.isFinite(Number(mesh.hmax))
      ? (Number(mesh.hmax) * 1e9).toFixed(1)
      : "";

  return (
    <div className="flex flex-col gap-5">
      <SelectField
        label="Geometry Kind"
        value={geo.geometry_kind}
        onchange={(val) => updateGeo((g) => ({ ...g, geometry_kind: val }))}
        options={[
          { label: "Box", value: "Box" },
          { label: "Cylinder", value: "Cylinder" },
          { label: "Ellipsoid", value: "Ellipsoid" },
          { label: "Imported Mesh", value: "ImportedGeometry" },
        ]}
      />

      <div className="flex flex-col gap-3">
        <h4 className="text-[0.7rem] font-bold uppercase tracking-widest text-foreground pb-1 border-b border-border/50">
          Dimensions
        </h4>
        {geo.geometry_kind === "Box" && (
          <div className="grid grid-cols-3 gap-3">
            <TextField label="X Length" defaultValue={(size[0] * 1e9).toFixed(1)} onBlur={(e) => handleBoxSize(0, e.target.value)} unit="nm" mono />
            <TextField label="Y Length" defaultValue={(size[1] * 1e9).toFixed(1)} onBlur={(e) => handleBoxSize(1, e.target.value)} unit="nm" mono />
            <TextField label="Z Length" defaultValue={(size[2] * 1e9).toFixed(1)} onBlur={(e) => handleBoxSize(2, e.target.value)} unit="nm" mono />
          </div>
        )}
        {geo.geometry_kind === "Cylinder" && (
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Radius" defaultValue={p.radius ? (Number(p.radius) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("radius", e.target.value)} unit="nm" mono />
            <TextField label="Height" defaultValue={p.height ? (Number(p.height) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("height", e.target.value)} unit="nm" mono />
          </div>
        )}
        {geo.geometry_kind === "Ellipsoid" && (
          <div className="grid grid-cols-3 gap-3">
            <TextField label="Rx" defaultValue={p.rx ? (Number(p.rx) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("rx", e.target.value)} unit="nm" mono />
            <TextField label="Ry" defaultValue={p.ry ? (Number(p.ry) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("ry", e.target.value)} unit="nm" mono />
            <TextField label="Rz" defaultValue={p.rz ? (Number(p.rz) * 1e9).toFixed(1) : ""} onBlur={(e) => handleParamNum("rz", e.target.value)} unit="nm" mono />
          </div>
        )}
        {geo.geometry_kind === "ImportedGeometry" && (
          <TextField 
            label="Source File" 
            defaultValue={typeof p.source === "string" ? p.source : ""} 
            onBlur={(e) => updateGeo(g => ({ ...g, geometry_params: { ...g.geometry_params, source: e.target.value } }))} 
            mono 
            placeholder="mesh.msh"
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="text-[0.7rem] font-bold uppercase tracking-widest text-foreground pb-1 border-b border-border/50">
          Placement Offset
        </h4>
        <div className="grid grid-cols-3 gap-3">
          <TextField label="Translate X" defaultValue={(t[0] * 1e9).toFixed(1)} onBlur={(e) => handleTranslation(0, e.target.value)} unit="nm" mono />
          <TextField label="Translate Y" defaultValue={(t[1] * 1e9).toFixed(1)} onBlur={(e) => handleTranslation(1, e.target.value)} unit="nm" mono />
          <TextField label="Translate Z" defaultValue={(t[2] * 1e9).toFixed(1)} onBlur={(e) => handleTranslation(2, e.target.value)} unit="nm" mono />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="text-[0.7rem] font-bold uppercase tracking-widest text-foreground pb-1 border-b border-border/50">
          FEM Mesh
        </h4>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={mesh.mode === "inherit" ? "default" : "outline"}
            size="sm"
            onClick={() =>
              updateMesh(() => ({
                mode: "inherit",
                hmax: "",
                order: null,
                source: null,
                build_requested: false,
              }))
            }
          >
            Use Global Mesh
          </Button>
          <Button
            variant={mesh.mode === "custom" ? "default" : "outline"}
            size="sm"
            onClick={() =>
              updateMesh((current) => ({
                ...current,
                mode: "custom",
              }))
            }
          >
            Customize Mesh
          </Button>
        </div>

        <SelectField
          label="Mesh Mode"
          value={mesh.mode}
          onchange={(value) =>
            updateMesh((current) => ({
              ...current,
              mode: value === "custom" ? "custom" : "inherit",
              ...(value === "custom"
                ? {}
                : { hmax: "", order: null, source: null, build_requested: false }),
            }))
          }
          options={[
            { label: "Inherit Global", value: "inherit" },
            { label: "Custom Override", value: "custom" },
          ]}
        />

        {mesh.mode === "inherit" ? (
          <div className="rounded-lg border border-border/40 bg-card/30 px-3 py-2 text-xs text-muted-foreground">
            This object follows the study-level FEM mesh defaults.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              key={`${geo.name}-mesh-hmax-${mesh.hmax}`}
              label="hmax (nm or auto)"
              defaultValue={meshHmaxDisplay}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                if (!raw) {
                  updateMesh((current) => ({ ...current, hmax: "" }));
                  return;
                }
                if (raw.toLowerCase() === "auto") {
                  updateMesh((current) => ({ ...current, hmax: "auto" }));
                  return;
                }
                const numeric = Number(raw);
                if (!Number.isFinite(numeric)) return;
                updateMesh((current) => ({ ...current, hmax: String(numeric * 1e-9) }));
              }}
              mono
              placeholder="20 or auto"
            />
            <TextField
              key={`${geo.name}-mesh-order-${mesh.order ?? ""}`}
              label="Order"
              defaultValue={mesh.order != null ? String(mesh.order) : ""}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                if (!raw) {
                  updateMesh((current) => ({ ...current, order: null }));
                  return;
                }
                const numeric = Number(raw);
                if (!Number.isFinite(numeric)) return;
                updateMesh((current) => ({
                  ...current,
                  order: Math.max(1, Math.round(numeric)),
                }));
              }}
              mono
              placeholder="1"
            />
            <TextField
              key={`${geo.name}-mesh-source-${mesh.source ?? ""}`}
              label="Source Mesh"
              defaultValue={mesh.source ?? ""}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                updateMesh((current) => ({ ...current, source: raw.length > 0 ? raw : null }));
              }}
              mono
              placeholder="mesh.msh"
              className="col-span-2"
            />
            <div className="col-span-2">
              <Button
                variant={mesh.build_requested ? "default" : "outline"}
                size="sm"
                className="w-full"
                onClick={() =>
                  updateMesh((current) => ({
                    ...current,
                    build_requested: !current.build_requested,
                  }))
                }
              >
                {mesh.build_requested ? "Build Requested" : "Request Mesh Build"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-border/50">
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => {
            model.setScriptBuilderGeometries(prev => prev.filter((_, i) => i !== geoIndex));
          }}
        >
          Delete Geometry
        </Button>
      </div>
    </div>
  );
}
