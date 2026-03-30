"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/EmptyState";
import SegmentedControl from "@/components/ui/SegmentedControl";
import SelectField from "@/components/ui/SelectField";
import FemMeshSlice2D from "@/components/preview/FemMeshSlice2D";
import FemMeshView3D from "@/components/preview/FemMeshView3D";

import type { EigenModeArtifact, FemMeshPayload } from "./eigenTypes";

type ModeFieldView = "real" | "imag" | "amplitude" | "phase";
type VectorComponent = "x" | "y" | "z" | "magnitude";
type SlicePlane = "xy" | "xz" | "yz";

interface EigenModeInspectorProps {
  mesh: FemMeshPayload | null;
  mode: EigenModeArtifact | null;
  loading?: boolean;
}

function modeFieldLabel(view: ModeFieldView, component: VectorComponent): string {
  if (view === "amplitude") {
    return "Mode amplitude";
  }
  if (view === "phase") {
    return "Mode phase";
  }
  const prefix = view === "real" ? "Re" : "Im";
  if (component === "magnitude") {
    return `${prefix}(|m|)`;
  }
  return `${prefix}(m_${component})`;
}

function flattenNodes(mesh: FemMeshPayload): number[] {
  return mesh.nodes.flatMap((node) => node);
}

function flattenBoundaryFaces(mesh: FemMeshPayload): number[] {
  return mesh.boundary_faces.flatMap((face) => face);
}

function zeroArray(length: number): number[] {
  return Array.from({ length }, () => 0);
}

function formatGHz(valueHz: number): string {
  return `${(valueHz / 1e9).toFixed(4)} GHz`;
}

function formatVec3(value: [number, number, number] | null): string {
  if (!value) {
    return "Gamma";
  }
  return value.map((entry) => entry.toExponential(2)).join(", ");
}

export default function EigenModeInspector({
  mesh,
  mode,
  loading = false,
}: EigenModeInspectorProps) {
  const [fieldView, setFieldView] = useState<ModeFieldView>("amplitude");
  const [vectorComponent, setVectorComponent] = useState<VectorComponent>("magnitude");
  const [slicePlane, setSlicePlane] = useState<SlicePlane>("xy");
  const [sliceIndex, setSliceIndex] = useState(12);

  useEffect(() => {
    setFieldView("amplitude");
    setVectorComponent("magnitude");
  }, [mode?.index]);

  const meshData = useMemo(() => {
    if (!mesh || !mode) {
      return null;
    }

    const nodeCount = mesh.nodes.length;
    const zero = zeroArray(nodeCount);
    if (fieldView === "amplitude") {
      return {
        nodes: flattenNodes(mesh),
        boundaryFaces: flattenBoundaryFaces(mesh),
        nNodes: nodeCount,
        nElements: mesh.elements.length,
        fieldData: {
          x: mode.amplitude,
          y: zero,
          z: zero,
        },
      };
    }
    if (fieldView === "phase") {
      return {
        nodes: flattenNodes(mesh),
        boundaryFaces: flattenBoundaryFaces(mesh),
        nNodes: nodeCount,
        nElements: mesh.elements.length,
        fieldData: {
          x: mode.phase,
          y: zero,
          z: zero,
        },
      };
    }

    const source = fieldView === "real" ? mode.real : mode.imag;
    return {
      nodes: flattenNodes(mesh),
      boundaryFaces: flattenBoundaryFaces(mesh),
      nNodes: nodeCount,
      nElements: mesh.elements.length,
      fieldData: {
        x: source.map((entry) => entry[0]),
        y: source.map((entry) => entry[1]),
        z: source.map((entry) => entry[2]),
      },
    };
  }, [fieldView, mesh, mode]);

  const maxAmplitude = useMemo(() => {
    if (!mode) {
      return 0;
    }
    return mode.amplitude.reduce((current, value) => Math.max(current, Math.abs(value)), 0);
  }, [mode]);

  const sliceComponent = fieldView === "amplitude" || fieldView === "phase" ? "x" : vectorComponent;
  const colorField = fieldView === "amplitude" || fieldView === "phase" ? "x" : vectorComponent;

  if (loading) {
    return (
      <EmptyState
        title="Loading mode field"
        description="Reading the selected eigenmode artifact and mapping it back onto the FEM mesh."
      />
    );
  }

  if (!meshData || !mode) {
    return (
      <EmptyState
        title="Mode artifact unavailable"
        description="This run exposes the spectrum, but the selected mode was not exported as a field artifact."
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[20px] border border-[var(--ide-border-subtle)] bg-[linear-gradient(135deg,rgba(38,65,140,0.22),rgba(11,18,35,0.78))] p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Mode {mode.index}</Badge>
              <Badge variant="outline">{mode.normalization}</Badge>
              <Badge variant="outline">{mode.damping_policy}</Badge>
              <Badge variant="outline">{mode.dominant_polarization}</Badge>
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-[var(--ide-text-1)]">
              {formatGHz(mode.frequency_hz)}
            </h3>
            <p className="max-w-2xl text-sm text-[var(--ide-text-3)]">
              Field view stays locked to explicit modal data, so the 2D slice and 3D mesh always show the same
              representation and normalization.
            </p>
          </div>
          <div className="grid gap-2 text-right text-xs text-[var(--ide-text-3)] sm:grid-cols-2">
            <StatChip label="omega" value={mode.angular_frequency_rad_per_s.toExponential(3)} />
            <StatChip label="max amp" value={maxAmplitude.toExponential(3)} />
            <StatChip label="k-vector" value={formatVec3(mode.k_vector)} />
            <StatChip label="nodes" value={meshData.nNodes.toLocaleString()} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <div className="rounded-[20px] border border-[var(--ide-border-subtle)] bg-[var(--ide-surface-raised)] p-4">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <SegmentedControl
                label="Field"
                value={fieldView}
                onchange={(value) => setFieldView(value as ModeFieldView)}
                options={[
                  { value: "real", label: "Real" },
                  { value: "imag", label: "Imag" },
                  { value: "amplitude", label: "Amp" },
                  { value: "phase", label: "Phase" },
                ]}
              />
            </div>
            <div className="min-w-[12rem]">
              <SelectField
                label="Vector Component"
                value={vectorComponent}
                onchange={(value) => setVectorComponent(value as VectorComponent)}
                options={[
                  { value: "magnitude", label: "Magnitude" },
                  { value: "x", label: "Cartesian X" },
                  { value: "y", label: "Cartesian Y" },
                  { value: "z", label: "Cartesian Z" },
                ]}
              />
            </div>
          </div>

          <div className="h-[34rem] overflow-hidden rounded-[18px] border border-[var(--ide-border-subtle)] bg-[rgba(3,9,20,0.72)]">
            <FemMeshView3D
              meshData={meshData}
              colorField={colorField}
              fieldLabel={modeFieldLabel(fieldView, vectorComponent)}
              toolbarMode="hidden"
              topologyKey={`mode-mesh:${meshData.nNodes}:${meshData.boundaryFaces.length / 3}`}
              showOrientationLegend={false}
            />
          </div>
        </div>

        <div className="rounded-[20px] border border-[var(--ide-border-subtle)] bg-[var(--ide-surface-raised)] p-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Slice Plane"
              value={slicePlane}
              onchange={(value) => setSlicePlane(value as SlicePlane)}
              options={[
                { value: "xy", label: "XY" },
                { value: "xz", label: "XZ" },
                { value: "yz", label: "YZ" },
              ]}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Slice Index
              </span>
              <input
                type="range"
                min={0}
                max={24}
                step={1}
                value={sliceIndex}
                onChange={(event) => setSliceIndex(Number(event.target.value))}
                className="accent-[var(--ide-accent)]"
              />
              <span className="text-xs text-[var(--ide-text-3)]">{sliceIndex + 1} / 25</span>
            </div>
          </div>

          <div className="h-[34rem] overflow-hidden rounded-[18px] border border-[var(--ide-border-subtle)] bg-[rgba(3,9,20,0.72)] p-2">
            <FemMeshSlice2D
              meshData={meshData}
              quantityLabel={modeFieldLabel(fieldView, vectorComponent)}
              quantityId={fieldView === "phase" ? "phase" : "mode"}
              component={sliceComponent}
              plane={slicePlane}
              sliceIndex={sliceIndex}
              sliceCount={25}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[rgba(150,170,220,0.18)] bg-[rgba(10,16,28,0.45)] px-3 py-2">
      <div className="text-[0.68rem] uppercase tracking-[0.08em] text-[var(--ide-text-3)]">{label}</div>
      <div className="mt-1 font-mono text-[0.82rem] text-[var(--ide-text-1)]">{value}</div>
    </div>
  );
}
