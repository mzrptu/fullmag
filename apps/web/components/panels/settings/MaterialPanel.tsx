"use client";

import { useCallback, useMemo } from "react";

import MagneticTextureLibraryPanel from "../MagneticTextureLibraryPanel";
import {
  MAGNETIC_PRESET_CATALOG,
  type MagneticPresetDescriptor,
  type MagneticPresetKind,
} from "../../../lib/magnetizationPresetCatalog";
import { useModel } from "../../runs/control-room/ControlRoomContext";
import { fmtSI } from "../../runs/control-room/shared";
import { TextField } from "../../ui/TextField";
import SelectField from "../../ui/SelectField";
import { Button } from "../../ui/button";
import type {
  MagnetizationAsset,
  SceneMaterialAsset,
  ScriptBuilderMagneticInteractionEntry,
  ScriptBuilderMagneticInteractionKind,
} from "../../../lib/session/types";
import {
  ensureObjectPhysicsStack,
  hasObjectInteraction,
  magneticInteractionLabel,
  removeOptionalInteraction,
  upsertObjectInteraction,
} from "../../../lib/session/magneticPhysics";
import { findSceneObjectByNodeId } from "./objectSelection";
import { SidebarSection, InfoRow, StatusBadge } from "./primitives";

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
  const physicsStack = useMemo<ScriptBuilderMagneticInteractionEntry[]>(
    () => ensureObjectPhysicsStack(sceneObject?.physics_stack, materialAsset?.properties.Dind ?? null),
    [materialAsset?.properties.Dind, sceneObject?.physics_stack],
  );

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

  const updateObjectPhysicsStack = useCallback(
    (updater: (stack: ScriptBuilderMagneticInteractionEntry[]) => ScriptBuilderMagneticInteractionEntry[]) => {
      if (!sceneObject) return;
      model.setSceneDocument((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          objects: prev.objects.map((object) => {
            if (object.id !== sceneObject.id && object.name !== sceneObject.name) {
              return object;
            }
            const current = ensureObjectPhysicsStack(
              object.physics_stack,
              materialAsset?.properties.Dind ?? null,
            );
            return {
              ...object,
              physics_stack: ensureObjectPhysicsStack(
                updater(current),
                materialAsset?.properties.Dind ?? null,
              ),
            };
          }),
        };
      });
    },
    [materialAsset?.properties.Dind, model, sceneObject],
  );

  const assignPresetTexture = useCallback(
    (kind: MagneticPresetKind) => {
      const descriptor = MAGNETIC_PRESET_CATALOG.find((entry) => entry.kind === kind);
      if (!descriptor) return;
      updateMagnetization((asset) => ({
        ...asset,
        kind: "preset_texture",
        value: null,
        seed: null,
        source_path: null,
        source_format: null,
        dataset: null,
        sample_index: null,
        preset_kind: descriptor.kind,
        preset_params: structuredClone(descriptor.defaultParams),
        preset_version: 1,
        ui_label: descriptor.label,
      }));
      model.setSceneDocument((prev) =>
        prev
          ? {
              ...prev,
              editor: {
                ...prev.editor,
                active_transform_scope: "texture",
              },
            }
          : prev,
      );
    },
    [model, updateMagnetization],
  );

  const updatePresetParam = useCallback(
    (key: string, value: unknown) => {
      updateMagnetization((asset) => ({
        ...asset,
        kind: "preset_texture",
        preset_params: {
          ...(asset.preset_params ?? {}),
          [key]: value,
        },
      }));
    },
    [updateMagnetization],
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
    if (key === "Dind") {
      updateObjectPhysicsStack((stack) => {
        if (!hasObjectInteraction(stack, "interfacial_dmi")) {
          return stack;
        }
        return upsertObjectInteraction(stack, "interfacial_dmi", {
          params: {
            ...(stack.find((entry) => entry.kind === "interfacial_dmi")?.params ?? {}),
            dind: parsed ?? 0,
          },
        });
      });
    }
  };

  const addInteraction = (kind: ScriptBuilderMagneticInteractionKind) => {
    updateObjectPhysicsStack((stack) =>
      upsertObjectInteraction(stack, kind, { enabled: true }),
    );
  };

  const toggleInteraction = (
    kind: ScriptBuilderMagneticInteractionKind,
    enabled: boolean,
  ) => {
    if (kind === "exchange" || kind === "demag") {
      return;
    }
    updateObjectPhysicsStack((stack) => upsertObjectInteraction(stack, kind, { enabled }));
  };

  const removeInteraction = (kind: ScriptBuilderMagneticInteractionKind) => {
    updateObjectPhysicsStack((stack) => removeOptionalInteraction(stack, kind));
  };

  const updateUniaxialParam = (key: "ku1" | "axis", value: unknown) => {
    updateObjectPhysicsStack((stack) => {
      const params = {
        ...(stack.find((entry) => entry.kind === "uniaxial_anisotropy")?.params ?? {}),
        [key]: value,
      };
      return upsertObjectInteraction(stack, "uniaxial_anisotropy", { params });
    });
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

  const selectedPresetDescriptor: MagneticPresetDescriptor | null =
    magnetizationAsset?.preset_kind
      ? MAGNETIC_PRESET_CATALOG.find((entry) => entry.kind === magnetizationAsset.preset_kind) ?? null
      : null;

  if (!sceneObject || !materialAsset || !magnetizationAsset) {
    if (!model.material) {
      return <div className="font-mono text-xs text-foreground">Material metadata not available yet.</div>;
    }
    return (
      <SidebarSection title="Material" defaultOpen={true}>
        <div className="flex flex-col gap-0.5">
          <InfoRow label="M_sat" value={model.material.msat != null ? fmtSI(model.material.msat, "A/m") : "—"} />
          <InfoRow label="A_ex" value={model.material.aex != null ? fmtSI(model.material.aex, "J/m") : "—"} />
          <InfoRow label="α" value={model.material.alpha?.toPrecision(3) ?? "—"} />
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {model.material.exchangeEnabled && <StatusBadge label="Exchange" tone="info" />}
          {model.material.demagEnabled && <StatusBadge label="Demag" tone="info" />}
          {model.material.zeemanField?.some((v) => v !== 0) && <StatusBadge label="Zeeman" tone="accent" />}
        </div>
      </SidebarSection>
    );
  }

  const mat = materialAsset.properties;
  const mag = magnetizationAsset;
  const value = Array.isArray(mag.value) ? mag.value : [0, 0, 1];
  const presetParams = mag.preset_params ?? selectedPresetDescriptor?.defaultParams ?? {};
  const hasDmi = hasObjectInteraction(physicsStack, "interfacial_dmi");
  const hasUniaxial = hasObjectInteraction(physicsStack, "uniaxial_anisotropy");
  const uniaxial = physicsStack.find((entry) => entry.kind === "uniaxial_anisotropy");
  const uniaxialAxisRaw = Array.isArray(uniaxial?.params?.axis) ? uniaxial?.params?.axis : [0, 0, 1];
  const uniaxialAxis = [
    Number(uniaxialAxisRaw[0] ?? 0),
    Number(uniaxialAxisRaw[1] ?? 0),
    Number(uniaxialAxisRaw[2] ?? 1),
  ] as [number, number, number];
  const uniaxialKu1 = Number(uniaxial?.params?.ku1 ?? 0);

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

      <SidebarSection title="Magnetic Interactions" defaultOpen={true}>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border/40 bg-card/20 px-3 py-2 text-[0.72rem] text-muted-foreground">
            Exchange i demag są zawsze aktywne dla ferromagnetyka. Interakcje opcjonalne możesz dodawać i konfigurować poniżej.
          </div>
          <div className="grid gap-2">
            {physicsStack.map((interaction) => (
              <div key={interaction.kind} className="rounded-lg border border-border/35 bg-background/35 px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-semibold text-foreground">
                    {magneticInteractionLabel(interaction.kind)}
                  </div>
                  {(interaction.kind === "exchange" || interaction.kind === "demag") ? (
                    <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-[0.1em] text-emerald-300">
                      required
                    </span>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1">
                    <SelectField
                      label=""
                      value={interaction.enabled ? "on" : "off"}
                      onchange={(value) => toggleInteraction(interaction.kind, value === "on")}
                      options={[
                        { value: "on", label: "Enabled" },
                        { value: "off", label: "Disabled" },
                      ]}
                    />
                    {(interaction.kind !== "exchange" && interaction.kind !== "demag") ? (
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => removeInteraction(interaction.kind)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
                {interaction.kind === "interfacial_dmi" ? (
                  <div className="mt-2 text-[0.72rem] text-muted-foreground">
                    Uses <span className="font-mono text-foreground">Dind</span> from Material Constants.
                  </div>
                ) : null}
                {interaction.kind === "uniaxial_anisotropy" ? (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <TextField
                      label="Ku1"
                      defaultValue={uniaxialKu1}
                      onBlur={(event) => {
                        const parsed = Number.parseFloat(event.target.value);
                        if (!Number.isFinite(parsed)) return;
                        updateUniaxialParam("ku1", parsed);
                      }}
                      unit="J/m³"
                      mono
                    />
                    <div className="grid grid-cols-3 gap-2">
                      {[0, 1, 2].map((axis) => (
                        <TextField
                          key={`ku-axis-${axis}`}
                          label={`Axis ${["X", "Y", "Z"][axis]}`}
                          defaultValue={uniaxialAxis[axis]}
                          onBlur={(event) => {
                            const parsed = Number.parseFloat(event.target.value);
                            if (!Number.isFinite(parsed)) return;
                            const nextAxis = [...uniaxialAxis] as [number, number, number];
                            nextAxis[axis] = parsed;
                            updateUniaxialParam("axis", nextAxis);
                          }}
                          mono
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={hasDmi}
              onClick={() => addInteraction("interfacial_dmi")}
            >
              Add DMI
            </Button>
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={hasUniaxial}
              onClick={() => addInteraction("uniaxial_anisotropy")}
            >
              Add Uniaxial Ku
            </Button>
          </div>
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
                preset_kind:
                  val === "preset_texture"
                    ? asset.preset_kind ?? "uniform"
                    : null,
                preset_params:
                  val === "preset_texture"
                    ? asset.preset_params ?? structuredClone(MAGNETIC_PRESET_CATALOG[0]?.defaultParams ?? {})
                    : null,
                preset_version: val === "preset_texture" ? asset.preset_version ?? 1 : null,
                ui_label:
                  val === "preset_texture"
                    ? asset.ui_label ?? selectedPresetDescriptor?.label ?? "Preset texture"
                    : null,
              }))
            }
            options={[
              { label: "Uniform (Vector)", value: "uniform" },
              { label: "Random", value: "random" },
              { label: "File Source", value: "file" },
              { label: "Sampled Dataset", value: "sampled" },
              { label: "Preset Texture", value: "preset_texture" },
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

          {mag.kind === "preset_texture" && (
            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-xl border border-border/30 bg-card/15 p-2">
                <MagneticTextureLibraryPanel
                  selectedKind={(mag.preset_kind as MagneticPresetKind | null | undefined) ?? null}
                  onCreatePreset={assignPresetTexture}
                  onSelectKind={assignPresetTexture}
                />
              </div>

              {selectedPresetDescriptor && (
                <div className="rounded-xl border border-border/30 bg-card/15 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {selectedPresetDescriptor.label}
                      </div>
                      <div className="text-[0.72rem] text-muted-foreground">
                        Proxy: {selectedPresetDescriptor.previewProxy}
                      </div>
                    </div>
                    <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-primary">
                      Live preset editor
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    {selectedPresetDescriptor.parameters.map((parameter) => {
                      const rawValue =
                        presetParams[parameter.key] ?? selectedPresetDescriptor.defaultParams[parameter.key];

                      if (parameter.type === "vector3") {
                        const vector = Array.isArray(rawValue) ? rawValue : [0, 0, 0];
                        return (
                          <div key={parameter.key} className="grid grid-cols-3 gap-2">
                            {[0, 1, 2].map((axis) => (
                              <TextField
                                key={`${parameter.key}-${axis}`}
                                label={`${parameter.label} ${["X", "Y", "Z"][axis]}`}
                                defaultValue={String(Number(vector[axis] ?? 0))}
                                onBlur={(event) => {
                                  const next = [...vector] as [number, number, number];
                                  const parsed = Number.parseFloat(event.target.value);
                                  if (!Number.isFinite(parsed)) return;
                                  next[axis] = parsed;
                                  updatePresetParam(parameter.key, next);
                                }}
                                unit={parameter.unit}
                                mono
                              />
                            ))}
                          </div>
                        );
                      }

                      if (parameter.type === "enum") {
                        return (
                          <SelectField
                            key={parameter.key}
                            label={parameter.label}
                            value={String(rawValue)}
                            onchange={(value) => updatePresetParam(parameter.key, value)}
                            options={(parameter.options ?? []).map((option) => ({
                              label: option.label,
                              value: String(option.value),
                            }))}
                          />
                        );
                      }

                      if (parameter.type === "boolean") {
                        return (
                          <SelectField
                            key={parameter.key}
                            label={parameter.label}
                            value={rawValue ? "true" : "false"}
                            onchange={(value) => updatePresetParam(parameter.key, value === "true")}
                            options={[
                              { label: "True", value: "true" },
                              { label: "False", value: "false" },
                            ]}
                          />
                        );
                      }

                      const isInteger = parameter.type === "integer";
                      return (
                        <TextField
                          key={parameter.key}
                          label={parameter.label}
                          defaultValue={String(rawValue ?? "")}
                          onBlur={(event) => {
                            const parsed = isInteger
                              ? Number.parseInt(event.target.value, 10)
                              : Number.parseFloat(event.target.value);
                            if (!Number.isFinite(parsed)) return;
                            updatePresetParam(parameter.key, parsed);
                          }}
                          unit={parameter.unit}
                          mono
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </SidebarSection>
    </div>
  );
}
