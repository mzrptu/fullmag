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
    return nodeId.replace(/^geo-/, "").split("-")[0];
  }, [nodeId]);

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
                  mesh: null
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
