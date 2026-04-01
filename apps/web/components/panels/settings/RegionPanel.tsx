"use client";

import { useCallback, useMemo } from "react";

import { useModel } from "../../runs/control-room/ControlRoomContext";
import { TextField } from "../../ui/TextField";
import SelectField from "../../ui/SelectField";
import type { ScriptBuilderGeometryEntry } from "../../../lib/session/types";
import { findGeometryByNodeId } from "./objectSelection";
import { SidebarSection } from "./primitives";

export default function RegionPanel({ nodeId }: { nodeId?: string }) {
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

  const handleMagUniform = (idx: number, valStr: string) => {
    const val = parseFloat(valStr);
    if (isNaN(val)) return;
    updateGeo((g) => {
      const value = Array.isArray(g.magnetization.value) ? [...g.magnetization.value] : [0, 0, 1];
      value[idx] = val;
      return { ...g, magnetization: { ...g.magnetization, value } };
    });
  };

  const handleMagStr = (
    key: keyof ScriptBuilderGeometryEntry["magnetization"],
    value: string,
  ) => {
    const trimmed = value.trim();
    updateGeo((g) => ({
      ...g,
      magnetization: {
        ...g.magnetization,
        [key]: trimmed.length > 0 ? trimmed : null,
      },
    }));
  };

  const handleMagNum = (key: "sample_index" | "seed", value: string) => {
    const parsed = Number.parseInt(value, 10);
    updateGeo((g) => ({
      ...g,
      magnetization: {
        ...g.magnetization,
        [key]: Number.isFinite(parsed) ? parsed : null,
      },
    }));
  };

  if (!geo) {
    return (
      <div className="flex flex-col gap-0 border-t border-border/20">
        <SidebarSection title="Regions" defaultOpen={true}>
          <div className="rounded-lg border border-border/40 bg-card/20 px-3 py-2 text-xs text-muted-foreground">
            Select a region node to edit its name and magnetic texture.
          </div>
        </SidebarSection>
      </div>
    );
  }

  const regionName = geo.region_name?.trim() || geo.name;
  const mag = geo.magnetization;
  const value = Array.isArray(mag.value) ? mag.value : [0, 0, 1];

  return (
    <div className="flex flex-col gap-0 border-t border-border/20">
      <SidebarSection title="Region Identity" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border/40 bg-card/20 px-3 py-2.5">
            <div className="text-[0.62rem] font-bold uppercase tracking-widest text-muted-foreground">
              Active Region
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-foreground">{regionName}</span>
              <span className="rounded-md border border-border/40 bg-background/40 px-2 py-0.5 text-[0.65rem] font-mono text-muted-foreground">
                object: {geo.name}
              </span>
            </div>
          </div>

          <TextField
            key={`${geo.name}-region-name-${geo.region_name ?? ""}`}
            label="Region Name"
            defaultValue={geo.region_name ?? ""}
            placeholder={geo.name}
            onBlur={(event) => {
              const nextName = event.target.value.trim();
              updateGeo((g) => ({
                ...g,
                region_name: nextName.length > 0 ? nextName : null,
              }));
            }}
            mono
            tooltip="Leave empty to keep the default region name equal to the object name."
          />
        </div>
      </SidebarSection>

      <SidebarSection title="Magnetic Texture (m₀)" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            The current Study Builder exposes one editable magnetic region per object. This already
            gives object-level textures; multi-region subdivision inside one object is the next layer.
          </div>

          <SelectField
            label="Texture Kind"
            value={mag.kind}
            onchange={(nextKind) =>
              updateGeo((g) => ({
                ...g,
                magnetization: {
                  ...g.magnetization,
                  kind: nextKind,
                  value: nextKind === "uniform" ? (g.magnetization.value ?? [0, 0, 1]) : null,
                  seed: nextKind === "random" ? (g.magnetization.seed ?? 1) : null,
                  source_path: nextKind === "file" ? g.magnetization.source_path : null,
                  source_format: nextKind === "file" ? g.magnetization.source_format ?? null : null,
                  dataset: nextKind === "file" ? g.magnetization.dataset ?? null : null,
                  sample_index: nextKind === "file" ? g.magnetization.sample_index ?? null : null,
                },
              }))
            }
            options={[
              { label: "Uniform (Vector)", value: "uniform" },
              { label: "Random", value: "random" },
              { label: "File Source", value: "file" },
            ]}
            tooltip="Initial magnetization assigned to this region."
          />

          {mag.kind === "uniform" && (
            <div className="grid grid-cols-3 gap-3">
              <TextField label="m_x" defaultValue={value[0]} onBlur={(e) => handleMagUniform(0, e.target.value)} mono />
              <TextField label="m_y" defaultValue={value[1]} onBlur={(e) => handleMagUniform(1, e.target.value)} mono />
              <TextField label="m_z" defaultValue={value[2]} onBlur={(e) => handleMagUniform(2, e.target.value)} mono />
            </div>
          )}

          {mag.kind === "random" && (
            <TextField
              label="Random Seed"
              defaultValue={mag.seed?.toString() ?? ""}
              placeholder="Required positive integer"
              onBlur={(e) => handleMagNum("seed", e.target.value)}
              mono
              tooltip="Uses the backend-supported random_seeded initializer."
            />
          )}

          {mag.kind === "file" && (
            <div className="flex flex-col gap-3">
              <TextField
                label="Source File Path"
                defaultValue={mag.source_path ?? ""}
                onBlur={(e) => handleMagStr("source_path", e.target.value)}
                mono
                placeholder="m0.ovf"
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Dataset"
                  defaultValue={mag.dataset ?? ""}
                  onBlur={(e) => handleMagStr("dataset", e.target.value)}
                  mono
                  placeholder="values"
                />
                <TextField
                  label="Sample Index"
                  defaultValue={mag.sample_index?.toString() ?? ""}
                  onBlur={(e) => handleMagNum("sample_index", e.target.value)}
                  mono
                  placeholder="0"
                />
              </div>
            </div>
          )}
        </div>
      </SidebarSection>
    </div>
  );
}
