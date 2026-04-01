"use client";

import { useCallback, useMemo } from "react";
import { useModel } from "../../runs/control-room/ControlRoomContext";
import { fmtSI } from "../../runs/control-room/shared";
import { TextField } from "../../ui/TextField";
import SelectField from "../../ui/SelectField";
import type { ScriptBuilderGeometryEntry } from "../../../lib/session/types";
import { findGeometryByNodeId } from "./objectSelection";
import { SidebarSection } from "./primitives";

export default function MaterialPanel({ nodeId }: { nodeId?: string }) {
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

  const handleMatNum = (k: keyof ScriptBuilderGeometryEntry["material"], valStr: string) => {
    const val = parseFloat(valStr);
    const parsed = isNaN(val) ? null : val;
    updateGeo((g) => ({ ...g, material: { ...g.material, [k]: parsed as never } }));
  };

  const handleMagUniform = (idx: number, valStr: string) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    updateGeo((g) => {
      const v = Array.isArray(g.magnetization.value) ? [...g.magnetization.value] : [0, 0, 1];
      v[idx] = val;
      return { ...g, magnetization: { ...g.magnetization, value: v } };
    });
  };

  const handleMagStr = (k: keyof ScriptBuilderGeometryEntry["magnetization"], valStr: string) => {
    const val = valStr.trim() === "" ? null : valStr.trim();
    updateGeo((g) => ({ ...g, magnetization: { ...g.magnetization, [k]: val as never } }));
  };

  const handleMagNum = (k: "sample_index" | "seed", valStr: string) => {
    const val = parseInt(valStr, 10);
    const parsed = isNaN(val) ? null : val;
    updateGeo((g) => ({ ...g, magnetization: { ...g.magnetization, [k]: parsed } }));
  };

  if (!geo) {
    if (!model.material) return <div className="font-mono text-xs text-foreground">Material metadata not available yet.</div>;
    return (
      <>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">M_sat</span>
            <span className="font-mono text-xs text-foreground">{model.material.msat != null ? fmtSI(model.material.msat, "A/m") : "—"}</span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">A_ex</span>
            <span className="font-mono text-xs text-foreground">{model.material.aex != null ? fmtSI(model.material.aex, "J/m") : "—"}</span>
          </div>
          <div className="flex flex-col gap-1 p-2.5 bg-card/30 border border-border/30 rounded-lg">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">α</span>
            <span className="font-mono text-xs text-foreground">{model.material.alpha?.toPrecision(3) ?? "—"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {model.material.exchangeEnabled && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Exchange</span>}
          {model.material.demagEnabled && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Demag</span>}
          {model.material.zeemanField?.some((v) => v !== 0) && <span className="text-[0.55rem] font-medium uppercase tracking-wider border border-border/30 bg-card/20 text-muted-foreground px-1.5 py-0.5 rounded-md inline-flex w-fit">Zeeman</span>}
        </div>
      </>
    );
  }

  const mat = geo.material;
  const mag = geo.magnetization;
  const v = Array.isArray(mag.value) ? mag.value : [0, 0, 1];

  return (
    <div className="flex flex-col gap-0 border-t border-border/20">
      <SidebarSection title="Material Constants" defaultOpen={true}>
        <div className="grid grid-cols-2 gap-3">
          <TextField 
            label="Ms (Saturation)" 
            defaultValue={mat.Ms ?? ""} 
            onBlur={(e) => handleMatNum("Ms", e.target.value)} 
            unit="A/m" 
            mono 
            tooltip="Saturation magnetization of the material."
          />
          <TextField 
            label="Aex (Exchange)" 
            defaultValue={mat.Aex ?? ""} 
            onBlur={(e) => handleMatNum("Aex", e.target.value)} 
            unit="J/m" 
            mono 
            tooltip="Exchange stiffness constant coupling adjacent spins."
          />
          <TextField 
            label="α (Damping)" 
            defaultValue={mat.alpha ?? ""} 
            onBlur={(e) => handleMatNum("alpha", e.target.value)} 
            mono 
            tooltip="Gilbert damping parameter governing spin relaxation rate."
          />
          <TextField 
            label="Dind (DMI)" 
            defaultValue={mat.Dind ?? ""} 
            onBlur={(e) => handleMatNum("Dind", e.target.value)} 
            unit="J/m²" 
            mono 
            tooltip="Interfacial Dzyaloshinskii-Moriya interaction strength."
          />
        </div>
      </SidebarSection>

      <SidebarSection title="Initial Magnetization (m₀)" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border/40 bg-card/20 px-3 py-2 text-xs text-muted-foreground">
            This editor updates the same default magnetic texture that is also available from the
            object&apos;s <span className="font-semibold text-foreground">Regions</span> node.
          </div>
          <SelectField
            label="Texture Kind"
            value={mag.kind}
            onchange={(val) =>
              updateGeo((g) => ({
                ...g,
                magnetization: {
                  ...g.magnetization,
                  kind: val,
                  value: val === "uniform" ? (g.magnetization.value ?? [0, 0, 1]) : null,
                  seed: val === "random" ? (g.magnetization.seed ?? 1) : null,
                  source_path: val === "file" ? g.magnetization.source_path : null,
                  source_format: val === "file" ? g.magnetization.source_format ?? null : null,
                  dataset: val === "file" ? g.magnetization.dataset ?? null : null,
                  sample_index: val === "file" ? g.magnetization.sample_index ?? null : null,
                },
              }))
            }
            options={[
              { label: "Uniform (Vector)", value: "uniform" },
              { label: "Random", value: "random" },
              { label: "File Source", value: "file" },
            ]}
            tooltip="Spatial distribution of the starting magnetization vectors."
          />

          {mag.kind === "uniform" && (
            <div className="grid grid-cols-3 gap-3">
              <TextField label="m_x" defaultValue={v[0]} onBlur={(e) => handleMagUniform(0, e.target.value)} mono tooltip="Normalized X component." />
              <TextField label="m_y" defaultValue={v[1]} onBlur={(e) => handleMagUniform(1, e.target.value)} mono tooltip="Normalized Y component." />
              <TextField label="m_z" defaultValue={v[2]} onBlur={(e) => handleMagUniform(2, e.target.value)} mono tooltip="Normalized Z component." />
            </div>
          )}

          {mag.kind === "file" && (
            <div className="flex flex-col gap-3">
              <TextField 
                label="Source File Path" 
                placeholder="e.g., m0.ovf or ground_state.vtk" 
                defaultValue={mag.source_path ?? ""} 
                onBlur={(e) => handleMagStr("source_path", e.target.value)} 
                mono 
                tooltip="Path to an .ovf, .omf, or .vtk file containing the continuous vector field."
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField 
                  label="Dataset Key" 
                  placeholder="(optional)" 
                  defaultValue={mag.dataset ?? ""} 
                  onBlur={(e) => handleMagStr("dataset", e.target.value)} 
                  mono 
                  tooltip="Specify the internal dataset name if the file contains multiple."
                />
                <TextField 
                  label="Sample Index" 
                  placeholder="(optional)" 
                  defaultValue={mag.sample_index?.toString() ?? ""} 
                  onBlur={(e) => handleMagNum("sample_index", e.target.value)} 
                  mono 
                  tooltip="Index within the dataset if storing a time series."
                />
              </div>
            </div>
          )}

          {mag.kind === "random" && (
            <TextField 
              label="Random Seed" 
              placeholder="Random (Auto)" 
              defaultValue={mag.seed?.toString() ?? ""} 
              onBlur={(e) => handleMagNum("seed", e.target.value)} 
              mono 
              tooltip="Fixed integer seed to reproduce the exact same thermalized noise pattern."
            />
          )}
        </div>
      </SidebarSection>
    </div>
  );
}
