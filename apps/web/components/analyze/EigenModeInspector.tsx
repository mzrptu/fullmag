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
  /** When true the component fills its flex parent instead of using fixed rem heights. */
  compact?: boolean;
}

function modeFieldLabel(view: ModeFieldView, component: VectorComponent): string {
  if (view === "amplitude") return "Mode amplitude";
  if (view === "phase") return "Mode phase";
  const prefix = view === "real" ? "Re" : "Im";
  if (component === "magnitude") return `${prefix}(|m|)`;
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
  if (!value) return "Γ";
  return `(${value.map((v) => v.toExponential(2)).join(", ")})`;
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border/30 bg-muted/30 px-2.5 py-1.5 min-w-[80px]">
      <span className="text-[0.58rem] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="font-mono text-[0.72rem] text-foreground/85 truncate">{value}</span>
    </div>
  );
}

export default function EigenModeInspector({
  mesh,
  mode,
  loading = false,
  compact = false,
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
    if (!mesh || !mode) return null;
    const nodeCount = mesh.nodes.length;
    const zero = zeroArray(nodeCount);

    if (fieldView === "amplitude") {
      return {
        nodes: flattenNodes(mesh),
        boundaryFaces: flattenBoundaryFaces(mesh),
        nNodes: nodeCount,
        nElements: mesh.elements.length,
        fieldData: { x: mode.amplitude, y: zero, z: zero },
      };
    }
    if (fieldView === "phase") {
      return {
        nodes: flattenNodes(mesh),
        boundaryFaces: flattenBoundaryFaces(mesh),
        nNodes: nodeCount,
        nElements: mesh.elements.length,
        fieldData: { x: mode.phase, y: zero, z: zero },
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
    if (!mode) return 0;
    return mode.amplitude.reduce((cur, v) => Math.max(cur, Math.abs(v)), 0);
  }, [mode]);

  const sliceComponent = fieldView === "amplitude" || fieldView === "phase" ? "x" : vectorComponent;
  const colorField = fieldView === "amplitude" || fieldView === "phase" ? "x" : vectorComponent;

  if (loading) {
    return (
      <EmptyState
        title="Loading mode field"
        description="Reading the eigenmode artifact from the active session."
        compact
      />
    );
  }

  if (!meshData || !mode) {
    return (
      <EmptyState
        title="Mode artifact unavailable"
        description="The spectrum is present but this mode was not exported as a field artifact."
        compact
      />
    );
  }

  const viewerClass = compact
    ? "flex-1 min-h-0 min-w-0 overflow-hidden rounded-[14px] border border-border/30 bg-[rgba(3,9,20,0.72)]"
    : "h-[34rem] overflow-hidden rounded-[18px] border border-[var(--ide-border-subtle)] bg-[rgba(3,9,20,0.72)]";

  if (compact) {
    // ── Compact layout: fills its flex parent ──────────────────────────────
    return (
      <div className="flex flex-col h-full min-h-0 gap-2">
        {/* Compact header */}
        <div className="flex flex-wrap items-center gap-2 px-1 shrink-0">
          <Badge variant="secondary">Mode {mode.index}</Badge>
          <span className="font-mono text-sm text-foreground/90">{formatGHz(mode.frequency_hz)}</span>
          <Badge variant="outline">{mode.dominant_polarization}</Badge>
          <Badge variant="outline">{mode.normalization}</Badge>
          <div className="flex-1" />
          <span className="font-mono text-[0.68rem] text-muted-foreground">
            ω={mode.angular_frequency_rad_per_s.toExponential(2)} rad/s
          </span>
        </div>

        {/* Controls bar */}
        <div className="flex flex-wrap items-end gap-2 shrink-0">
          <div className="min-w-[13rem]">
            <SegmentedControl
              label="Field"
              value={fieldView}
              onchange={(v) => setFieldView(v as ModeFieldView)}
              options={[
                { value: "real", label: "Re" },
                { value: "imag", label: "Im" },
                { value: "amplitude", label: "Amp" },
                { value: "phase", label: "φ" },
              ]}
            />
          </div>
          {(fieldView === "real" || fieldView === "imag") && (
            <div className="min-w-[10rem]">
              <SelectField
                label="Component"
                value={vectorComponent}
                onchange={(v) => setVectorComponent(v as VectorComponent)}
                options={[
                  { value: "magnitude", label: "|m|" },
                  { value: "x", label: "x" },
                  { value: "y", label: "y" },
                  { value: "z", label: "z" },
                ]}
              />
            </div>
          )}
          <div className="min-w-[6rem]">
            <SelectField
              label="Slice"
              value={slicePlane}
              onchange={(v) => setSlicePlane(v as SlicePlane)}
              options={[
                { value: "xy", label: "XY" },
                { value: "xz", label: "XZ" },
                { value: "yz", label: "YZ" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1 min-w-[7rem]">
            <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Idx {sliceIndex + 1}/25
            </span>
            <input
              type="range" min={0} max={24} step={1} value={sliceIndex}
              onChange={(e) => setSliceIndex(Number(e.target.value))}
              className="h-[3px] accent-primary w-full"
            />
          </div>
        </div>

        {/* Two-panel viewer — shares remaining height */}
        <div className="flex gap-2 flex-1 min-h-0">
          <div className={`flex-[1.3] ${viewerClass}`}>
            <FemMeshView3D
              meshData={meshData}
              colorField={colorField}
              fieldLabel={modeFieldLabel(fieldView, vectorComponent)}
              toolbarMode="hidden"
              topologyKey={`mode:${mode.index}:${meshData.nNodes}`}
              showOrientationLegend={false}
            />
          </div>
          <div className={`flex-[1] ${viewerClass} p-1`}>
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
      </div>
    );
  }

  // ── Full-page layout (original design) ────────────────────────────────────
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
            <h3 className="text-base font-semibold tracking-tight text-[var(--ide-text-1)]">
              {formatGHz(mode.frequency_hz)}
            </h3>
            <p className="max-w-2xl text-sm text-[var(--ide-text-3)]">
              Field view stays locked to explicit modal data, so the 2D slice and 3D mesh always show the same
              representation and normalization.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
