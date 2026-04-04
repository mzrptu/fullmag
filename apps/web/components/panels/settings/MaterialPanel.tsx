"use client";

import { useCallback, useMemo } from "react";

import { useModel } from "../../runs/control-room/ControlRoomContext";
import { fmtSI } from "../../runs/control-room/shared";
import { TextField } from "../../ui/TextField";
import SelectField from "../../ui/SelectField";
import type {
  MagnetizationAsset,
  SceneMaterialAsset,
} from "../../../lib/session/types";
import { findSceneObjectByNodeId } from "./objectSelection";
import { SidebarSection } from "./primitives";

function fallbackMaterial(name: string): SceneMaterialAsset {
  return {
    id: `mat:${name}`,
    name: `${name} material`,
    properties: {
      Ms: null,
      Aex: null,
      alpha: 0.01,
      Dind: null,
    },
  };
}

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
    preset_kind: null,
    preset_params: null,
    preset_version: null,
    ui_label: null,
  };
}

export default function MaterialPanel({ nodeId }: { nodeId?: string }) {
  const model = useModel();

  const { object: sceneObject, material, magnetization } = useMemo(
    () => findSceneObjectByNodeId(nodeId, model.sceneDocument),
    [model.sceneDocument, nodeId],
  );

  const materialAsset = material ?? (sceneObject ? fallbackMaterial(sceneObject.name) : null);
  const magnetizationAsset =
    magnetization ?? (sceneObject ? fallbackMagnetization(sceneObject.name) : null);

  const updateMaterial = useCallback(
    (updater: (asset: SceneMaterialAsset) => SceneMaterialAsset) => {
      if (!sceneObject) return;
      model.setSceneDocument((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          materials: prev.materials.map((entry) =>
            entry.id === sceneObject.material_ref ? updater(entry) : entry,
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

  const handleMatNum = (
    key: keyof SceneMaterialAsset["properties"],
    valStr: string,
  ) => {
    const val = parseFloat(valStr);
    const parsed = Number.isNaN(val) ? null : val;
    updateMaterial((asset) => ({
      ...asset,
      properties: {
        ...asset.properties,
        [key]: parsed as never,
      },
    }));
  };

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
    valStr: string,
  ) => {
    const val = valStr.trim() === "" ? null : valStr.trim();
    updateMagnetization((asset) => ({
      ...asset,
      [key]: val,
    }));
  };

  const handleMagNum = (key: "sample_index" | "seed", valStr: string) => {
    const val = Number.parseInt(valStr, 10);
    const parsed = Number.isNaN(val) ? null : val;
    updateMagnetization((asset) => ({
      ...asset,
      [key]: parsed,
    }));
  };

  if (!sceneObject || !materialAsset || !magnetizationAsset) {
    if (!model.material) {
      return <div className="font-mono text-xs text-foreground">Material metadata not available yet.</div>;
    }
    return (
      <>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-card/30 p-2.5">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">M_sat</span>
            <span className="font-mono text-xs text-foreground">{model.material.msat != null ? fmtSI(model.material.msat, "A/m") : "—"}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-card/30 p-2.5">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">A_ex</span>
            <span className="font-mono text-xs text-foreground">{model.material.aex != null ? fmtSI(model.material.aex, "J/m") : "—"}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border/30 bg-card/30 p-2.5">
            <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">α</span>
            <span className="font-mono text-xs text-foreground">{model.material.alpha?.toPrecision(3) ?? "—"}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {model.material.exchangeEnabled && <span className="inline-flex w-fit rounded-md border border-border/30 bg-card/20 px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-wider text-muted-foreground">Exchange</span>}
          {model.material.demagEnabled && <span className="inline-flex w-fit rounded-md border border-border/30 bg-card/20 px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-wider text-muted-foreground">Demag</span>}
          {model.material.zeemanField?.some((v) => v !== 0) && <span className="inline-flex w-fit rounded-md border border-border/30 bg-card/20 px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-wider text-muted-foreground">Zeeman</span>}
        </div>
      </>
    );
  }

  const mat = materialAsset.properties;
  const mag = magnetizationAsset;
  const value = Array.isArray(mag.value) ? mag.value : [0, 0, 1];

  return (
    <div className="flex flex-col px-2 pt-4">
      <SidebarSection title="Material Constants" defaultOpen={true}>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Ms (Saturation)" defaultValue={mat.Ms ?? ""} onBlur={(e) => handleMatNum("Ms", e.target.value)} unit="A/m" mono tooltip="Saturation magnetization of the material." />
          <TextField label="Aex (Exchange)" defaultValue={mat.Aex ?? ""} onBlur={(e) => handleMatNum("Aex", e.target.value)} unit="J/m" mono tooltip="Exchange stiffness constant coupling adjacent spins." />
          <TextField label="α (Damping)" defaultValue={mat.alpha ?? ""} onBlur={(e) => handleMatNum("alpha", e.target.value)} mono tooltip="Gilbert damping parameter governing spin relaxation rate." />
          <TextField label="Dind (DMI)" defaultValue={mat.Dind ?? ""} onBlur={(e) => handleMatNum("Dind", e.target.value)} unit="J/m²" mono tooltip="Interfacial Dzyaloshinskii-Moriya interaction strength." />
        </div>
      </SidebarSection>

      <SidebarSection title="Initial Magnetization (m0)" defaultOpen={true}>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border/40 bg-card/20 px-3 py-2 text-xs text-muted-foreground">
            This editor updates the same magnetization asset referenced by the selected object and its region node.
          </div>
          <SelectField
            label="Texture Kind"
            value={mag.kind}
            onchange={(val) =>
              updateMagnetization((asset) => ({
                ...asset,
                kind: val,
                value: val === "uniform" ? (asset.value ?? [0, 0, 1]) : null,
                seed: val === "random" ? (asset.seed ?? 1) : null,
                source_path: val === "file" || val === "sampled" ? asset.source_path : null,
                source_format: val === "file" || val === "sampled" ? asset.source_format ?? null : null,
                dataset: val === "sampled" ? asset.dataset ?? null : null,
                sample_index: val === "sampled" ? asset.sample_index ?? null : null,
              }))
            }
            options={[
              { label: "Uniform (Vector)", value: "uniform" },
              { label: "Random", value: "random" },
              { label: "File Source", value: "file" },
              { label: "Sampled Dataset", value: "sampled" },
            ]}
            tooltip="Spatial distribution of the starting magnetization vectors."
          />

          {mag.kind === "uniform" && (
            <div className="grid grid-cols-3 gap-3">
              <TextField label="m_x" defaultValue={value[0]} onBlur={(e) => handleMagUniform(0, e.target.value)} mono tooltip="Normalized X component." />
              <TextField label="m_y" defaultValue={value[1]} onBlur={(e) => handleMagUniform(1, e.target.value)} mono tooltip="Normalized Y component." />
              <TextField label="m_z" defaultValue={value[2]} onBlur={(e) => handleMagUniform(2, e.target.value)} mono tooltip="Normalized Z component." />
            </div>
          )}

          {(mag.kind === "file" || mag.kind === "sampled") && (
            <div className="flex flex-col gap-3">
              <TextField label="Source File Path" placeholder="e.g., m0.ovf or ground_state.vtk" defaultValue={mag.source_path ?? ""} onBlur={(e) => handleMagStr("source_path", e.target.value)} mono tooltip="Path to an .ovf, .omf, or .vtk file containing the continuous vector field." />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Source Format" placeholder="(optional)" defaultValue={mag.source_format ?? ""} onBlur={(e) => handleMagStr("source_format", e.target.value)} mono tooltip="Optional explicit parser hint." />
                <TextField label="Dataset Key" placeholder="(optional)" defaultValue={mag.dataset ?? ""} onBlur={(e) => handleMagStr("dataset", e.target.value)} mono tooltip="Specify the internal dataset name if the file contains multiple." />
              </div>
              {mag.kind === "sampled" && (
                <TextField label="Sample Index" placeholder="(optional)" defaultValue={mag.sample_index?.toString() ?? ""} onBlur={(e) => handleMagNum("sample_index", e.target.value)} mono tooltip="Index within the dataset if storing a time series." />
              )}
            </div>
          )}

          {mag.kind === "random" && (
            <TextField label="Random Seed" placeholder="Random (Auto)" defaultValue={mag.seed?.toString() ?? ""} onBlur={(e) => handleMagNum("seed", e.target.value)} mono tooltip="Fixed integer seed to reproduce the exact same thermalized noise pattern." />
          )}
        </div>
      </SidebarSection>
    </div>
  );
}
