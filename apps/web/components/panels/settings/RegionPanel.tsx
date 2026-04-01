"use client";

import { useCallback, useMemo } from "react";

import { useModel } from "../../runs/control-room/ControlRoomContext";
import { TextField } from "../../ui/TextField";
import SelectField from "../../ui/SelectField";
import type { MagnetizationAsset } from "../../../lib/session/types";
import { findSceneObjectByNodeId } from "./objectSelection";
import { SidebarSection } from "./primitives";

function fallbackMagnetization(name: string): MagnetizationAsset {
  return {
    id: `mag:${name}`,
    name: `${name} magnetization`,
    kind: "uniform",
    value: [0, 0, 1],
    seed: null,
    source_path: null,
    source_format: null,
    dataset: null,
    sample_index: null,
    mapping: {
      space: "object",
      projection: "object_local",
      clamp_mode: "clamp",
    },
    texture_transform: {
      translation: [0, 0, 0],
      rotation_quat: [0, 0, 0, 1],
      scale: [1, 1, 1],
      pivot: [0, 0, 0],
    },
  };
}

export default function RegionPanel({ nodeId }: { nodeId?: string }) {
  const model = useModel();

  const { object: sceneObject, magnetization } = useMemo(
    () => findSceneObjectByNodeId(nodeId, model.sceneDocument),
    [model.sceneDocument, nodeId],
  );

  const magnetizationAsset =
    magnetization ?? (sceneObject ? fallbackMagnetization(sceneObject.name) : null);

  const updateObject = useCallback(
    (updater: (regionName: string | null) => string | null) => {
      if (!sceneObject) return;
      model.setSceneDocument((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          objects: prev.objects.map((object) =>
            object.id === sceneObject.id
              ? {
                  ...object,
                  region_name: updater(object.region_name ?? null),
                }
              : object,
          ),
        };
      });
    },
    [model, sceneObject],
  );

  const updateMagnetization = useCallback(
    (updater: (asset: MagnetizationAsset) => MagnetizationAsset) => {
      if (!sceneObject) return;
      model.setSceneDocument((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          magnetization_assets: prev.magnetization_assets.map((entry) =>
            entry.id === sceneObject.magnetization_ref ? updater(entry) : entry,
          ),
        };
      });
    },
    [model, sceneObject],
  );

  const handleMagUniform = (idx: number, valStr: string) => {
    const val = parseFloat(valStr);
    if (Number.isNaN(val)) return;
    updateMagnetization((asset) => {
      const value = Array.isArray(asset.value) ? [...asset.value] : [0, 0, 1];
      value[idx] = val;
      return { ...asset, value };
    });
  };

  const handleMagStr = (
    key: keyof Pick<
      MagnetizationAsset,
      "source_path" | "source_format" | "dataset"
    >,
    value: string,
  ) => {
    const trimmed = value.trim();
    updateMagnetization((asset) => ({
      ...asset,
      [key]: trimmed.length > 0 ? trimmed : null,
    }));
  };

  const handleMagNum = (key: "sample_index" | "seed", value: string) => {
    const parsed = Number.parseInt(value, 10);
    updateMagnetization((asset) => ({
      ...asset,
      [key]: Number.isFinite(parsed) ? parsed : null,
    }));
  };

  if (!sceneObject || !magnetizationAsset) {
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

  const regionName = sceneObject.region_name?.trim() || sceneObject.name;
  const mag = magnetizationAsset;
  const value = Array.isArray(mag.value) ? mag.value : [0, 0, 1];

  return (
    <div className="flex flex-col px-2 pt-4">
      <SidebarSection title="Region Identity" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border/40 bg-card/20 px-3 py-2.5">
            <div className="text-[0.62rem] font-bold uppercase tracking-widest text-muted-foreground">
              Active Region
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-foreground">{regionName}</span>
              <span className="rounded-md border border-border/40 bg-background/40 px-2 py-0.5 text-[0.65rem] font-mono text-muted-foreground">
                object: {sceneObject.name}
              </span>
            </div>
          </div>

          <TextField
            key={`${sceneObject.name}-region-name-${sceneObject.region_name ?? ""}`}
            label="Region Name"
            defaultValue={sceneObject.region_name ?? ""}
            placeholder={sceneObject.name}
            onBlur={(event) => {
              const nextName = event.target.value.trim();
              updateObject(() => (nextName.length > 0 ? nextName : null));
            }}
            mono
            tooltip="Leave empty to keep the default region name equal to the object name."
          />
        </div>
      </SidebarSection>

      <SidebarSection title="Magnetic Texture (m0)" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            The current authoring layer exposes one editable magnetic region per object. This already
            gives object-level textures; multi-region subdivision inside one object is the next layer.
          </div>

          <SelectField
            label="Texture Kind"
            value={mag.kind}
            onchange={(nextKind) =>
              updateMagnetization((asset) => ({
                ...asset,
                kind: nextKind,
                value: nextKind === "uniform" ? (asset.value ?? [0, 0, 1]) : null,
                seed: nextKind === "random" ? (asset.seed ?? 1) : null,
                source_path: nextKind === "file" || nextKind === "sampled" ? asset.source_path : null,
                source_format: nextKind === "file" || nextKind === "sampled" ? asset.source_format ?? null : null,
                dataset: nextKind === "sampled" ? asset.dataset ?? null : null,
                sample_index: nextKind === "sampled" ? asset.sample_index ?? null : null,
              }))
            }
            options={[
              { label: "Uniform (Vector)", value: "uniform" },
              { label: "Random", value: "random" },
              { label: "File Source", value: "file" },
              { label: "Sampled Dataset", value: "sampled" },
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

          {(mag.kind === "file" || mag.kind === "sampled") && (
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
                  label="Source Format"
                  defaultValue={mag.source_format ?? ""}
                  onBlur={(e) => handleMagStr("source_format", e.target.value)}
                  mono
                  placeholder="ovf"
                />
                <TextField
                  label="Dataset"
                  defaultValue={mag.dataset ?? ""}
                  onBlur={(e) => handleMagStr("dataset", e.target.value)}
                  mono
                  placeholder="values"
                />
              </div>
              {mag.kind === "sampled" && (
                <TextField
                  label="Sample Index"
                  defaultValue={mag.sample_index?.toString() ?? ""}
                  onBlur={(e) => handleMagNum("sample_index", e.target.value)}
                  mono
                  placeholder="0"
                />
              )}
            </div>
          )}
        </div>
      </SidebarSection>
    </div>
  );
}
