"use client";

import { useCallback, useEffect, useState } from "react";

import DispersionBranchPlot from "@/components/analyze/DispersionBranchPlot";
import EigenModeInspector from "@/components/analyze/EigenModeInspector";
import ModeSpectrumPlot from "@/components/analyze/ModeSpectrumPlot";
import type { FemMeshPayload } from "@/components/analyze/eigenTypes";
import { useCurrentAnalyzeArtifacts } from "@/components/runs/control-room/useCurrentAnalyzeArtifacts";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/EmptyState";
import SelectField from "@/components/ui/SelectField";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveApiBase } from "@/lib/apiBase";

interface SessionSummary {
  session_id: string;
  problem_name: string;
  requested_backend: string;
  precision: string;
  status: string;
  started_at_unix_ms: number;
  finished_at_unix_ms: number;
  script_path: string | null;
  artifact_dir: string | null;
  plan_summary: Record<string, unknown> | null;
}

interface StepSnapshot {
  e_ex: number;
  e_demag: number;
  e_ext: number;
  e_total: number;
  step: number;
  time: number;
  max_dm_dt: number;
}

interface SessionBootstrapResponse {
  session: SessionSummary | null;
  live_state: {
    latest_step?: (StepSnapshot & { fem_mesh?: FemMeshPayload | null }) | null;
  } | null;
  scalar_rows: StepSnapshot[];
}

const pageStackClass = "flex flex-col gap-[var(--sp-4)]";
const autoFillMetricsClass =
  "grid gap-[var(--sp-3)] [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]";
const refreshButtonClass =
  "inline-flex items-center rounded-full border border-[rgba(145,170,255,0.28)] bg-[rgba(8,15,32,0.55)] px-4 py-2 text-[length:var(--text-sm)] font-medium text-[var(--text-1)] transition-colors hover:bg-[rgba(18,30,58,0.82)]";

function fmtSI(v: number, unit: string): string {
  if (!Number.isFinite(v) || v === 0) return `0 ${unit}`;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toPrecision(3)} G${unit}`;
  if (abs >= 1e6) return `${(v / 1e6).toPrecision(3)} M${unit}`;
  if (abs >= 1e3) return `${(v / 1e3).toPrecision(3)} k${unit}`;
  if (abs >= 1) return `${v.toPrecision(3)} ${unit}`;
  if (abs >= 1e-3) return `${(v * 1e3).toPrecision(3)} m${unit}`;
  if (abs >= 1e-6) return `${(v * 1e6).toPrecision(3)} u${unit}`;
  if (abs >= 1e-9) return `${(v * 1e9).toPrecision(3)} n${unit}`;
  return `${v.toExponential(2)} ${unit}`;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "Live";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60000).toFixed(1)} min`;
}

function fmtTimestamp(unixMs: number): string {
  if (!unixMs) return "Pending";
  return new Date(unixMs).toLocaleString();
}

function formatFrequencyGHz(valueHz: number): string {
  return `${(valueHz / 1e9).toFixed(4)} GHz`;
}

function formatKVector(value: [number, number, number] | null): string {
  if (!value) {
    return "Gamma";
  }
  return value.map((entry) => entry.toExponential(2)).join(", ");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export default function VisualizationsPage() {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [energy, setEnergy] = useState<StepSnapshot | null>(null);
  const [selectedMode, setSelectedMode] = useState<number | null>(null);

  // Use the shared hook for all eigen data (spectrum, mesh, dispersion, modes)
  const {
    loadState,
    modeLoadState,
    error,
    modeError,
    mesh,
    spectrum,
    dispersionRows,
    modeCache,
    hasEigenArtifacts,
    modeArtifactMap,
    savedModeIndices,
    refresh: refreshEigen,
    ensureMode,
  } = useCurrentAnalyzeArtifacts(refreshNonce);

  // Lightweight session+energy fetch (not provided by the shared hook)
  useEffect(() => {
    let cancelled = false;
    const base = resolveApiBase();
    fetchJson<SessionBootstrapResponse>(`${base}/v1/live/current/bootstrap`)
      .then((bootstrap) => {
        if (cancelled) return;
        const rows = Array.isArray(bootstrap.scalar_rows) ? bootstrap.scalar_rows : [];
        setSession(bootstrap.session ?? null);
        setEnergy(bootstrap.live_state?.latest_step ?? rows.at(-1) ?? null);
      })
      .catch(() => { /* session info is optional */ });
    return () => { cancelled = true; };
  }, [refreshNonce]);

  const handleRefresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
    refreshEigen();
  }, [refreshEigen]);

  // Auto-select first available mode when spectrum loads
  useEffect(() => {
    const validIndices = spectrum?.modes.map((mode) => mode.index) ?? savedModeIndices;
    if (validIndices.length === 0) {
      setSelectedMode(null);
      return;
    }
    if (selectedMode === null || !validIndices.includes(selectedMode)) {
      setSelectedMode(savedModeIndices[0] ?? validIndices[0] ?? null);
    }
  }, [savedModeIndices, selectedMode, spectrum]);

  // Ensure mode field is loaded when selection changes
  useEffect(() => {
    if (selectedMode != null && modeArtifactMap.has(selectedMode)) {
      void ensureMode(selectedMode);
    }
  }, [ensureMode, modeArtifactMap, selectedMode]);

  const selectedModePath = selectedMode !== null ? modeArtifactMap.get(selectedMode) ?? null : null;
  const selectedModeArtifact = selectedMode !== null ? modeCache[selectedMode] ?? null : null;
  const availableModeCount = spectrum?.modes.length ?? 0;
  const selectedModeSummary =
    selectedMode !== null ? spectrum?.modes.find((mode) => mode.index === selectedMode) ?? null : null;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Analyze</h1>
        <p className="page-subtitle">Inspect eigen spectra, modal fields, dispersion branches and solver metadata.</p>
      </div>

      <div className={pageStackClass}>
        <section className="relative overflow-hidden rounded-[28px] border border-[rgba(130,160,255,0.2)] bg-[radial-gradient(circle_at_top_left,rgba(58,99,196,0.28),transparent_42%),linear-gradient(135deg,rgba(6,14,28,0.98),rgba(14,24,49,0.96))] p-5 shadow-[0_20px_80px_rgba(4,10,22,0.35)]">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[28rem] bg-[radial-gradient(circle_at_center,rgba(120,160,255,0.18),transparent_60%)]" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent">FEM Analyze</Badge>
                {hasEigenArtifacts ? <Badge variant="success">Eigen artifacts ready</Badge> : <Badge variant="warn">No eigen dataset</Badge>}
                {session && <Badge variant="outline">{session.requested_backend.toUpperCase()}</Badge>}
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold tracking-tight text-[var(--ide-text-1)]">
                  {session?.problem_name ?? "Current Session"}
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-[var(--ide-text-3)]">
                  Spectrum, mode-field and dispersion views stay wired directly to artifact files, so what you inspect
                  here matches the runner output rather than a UI-side reconstruction.
                </p>
              </div>
            </div>
            <button type="button" onClick={handleRefresh} className={refreshButtonClass}>
              Refresh Analyze
            </button>
          </div>

          <div className={`relative mt-5 ${autoFillMetricsClass}`}>
            <MetricCard label="Status" value={session?.status ?? loadState} accent={session?.status === "running"} />
            <MetricCard label="Modes" value={availableModeCount ? availableModeCount.toLocaleString() : "0"} />
            <MetricCard label="Saved mode files" value={savedModeIndices.length.toLocaleString()} />
            <MetricCard label="Normalization" value={spectrum?.normalization ?? "n/a"} />
            <MetricCard label="Equilibrium" value={spectrum?.equilibrium_source.kind ?? "n/a"} />
            <MetricCard label="Mesh nodes" value={(mesh?.nodes.length ?? 0).toLocaleString()} />
            <MetricCard label="Mesh elements" value={(mesh?.elements.length ?? 0).toLocaleString()} />
            <MetricCard label="Started" value={session ? fmtTimestamp(session.started_at_unix_ms) : "Pending"} />
            <MetricCard
              label="Duration"
              value={
                session
                  ? fmtDuration(session.finished_at_unix_ms - session.started_at_unix_ms)
                  : "Pending"
              }
            />
          </div>
        </section>

        <section className="rounded-[24px] border border-[var(--ide-border-subtle)] bg-[var(--ide-surface-raised)] p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_repeat(3,minmax(180px,0.6fr))]">
            <div className="min-w-0 rounded-[18px] border border-[rgba(145,170,255,0.18)] bg-[rgba(12,18,32,0.55)] px-4 py-3">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--ide-text-3)]">
                Dataset
              </div>
              <div className="mt-2 truncate text-sm text-[var(--ide-text-1)]">
                {session?.artifact_dir ?? session?.script_path ?? "Current live workspace"}
              </div>
            </div>

            <div>
              <SelectField
                label="Mode"
                value={selectedMode ?? ""}
                onchange={(value) => setSelectedMode(Number(value))}
                options={(spectrum?.modes ?? []).map((mode) => ({
                  value: String(mode.index),
                  label: `#${mode.index} · ${formatFrequencyGHz(mode.frequency_hz)}${modeArtifactMap.has(mode.index) ? "" : " · summary only"}`,
                }))}
                className="h-full"
              />
            </div>

            <MetricCard label="Selected freq" value={selectedModeSummary ? formatFrequencyGHz(selectedModeSummary.frequency_hz) : "n/a"} />
            <MetricCard label="k-vector" value={selectedModeSummary ? formatKVector(selectedModeSummary.k_vector) : "n/a"} />
          </div>

          {energy && (
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <MetricCard label="E_total" value={fmtSI(energy.e_total, "J")} />
              <MetricCard label="E_ex" value={fmtSI(energy.e_ex, "J")} />
              <MetricCard label="E_demag" value={fmtSI(energy.e_demag, "J")} />
              <MetricCard label="max dm/dt" value={energy.max_dm_dt.toExponential(3)} />
            </div>
          )}
        </section>

        {loadState === "loading" && (
          <EmptyState
            title="Loading analysis workspace"
            description="Fetching the active session, artifact inventory and any available eigen datasets."
          />
        )}

        {loadState === "error" && (
          <EmptyState
            title="Analyze is unavailable"
            description={error ?? "No active session available."}
          />
        )}

        {loadState === "loaded" && !hasEigenArtifacts && (
          <EmptyState
            title="No eigen artifacts in the active workspace"
            description="Run a FEM Eigenmodes study with SaveSpectrum and SaveMode outputs to unlock the spectrum, mode and dispersion views."
          />
        )}

        {loadState === "loaded" && hasEigenArtifacts && spectrum && (
          <Tabs defaultValue="spectrum" className="space-y-4">
            <TabsList>
              <TabsTrigger value="spectrum">Spectrum</TabsTrigger>
              <TabsTrigger value="modes">Modes</TabsTrigger>
              <TabsTrigger value="dispersion">Dispersion</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            </TabsList>

            <TabsContent value="spectrum">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
                <section className="rounded-[24px] border border-[var(--ide-border-subtle)] bg-[var(--ide-surface-raised)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-[var(--ide-text-1)]">Spectrum</h2>
                      <p className="text-sm text-[var(--ide-text-3)]">
                        Click a point to move directly into mode inspection.
                      </p>
                    </div>
                    <Badge variant="outline">{spectrum.operator.kind}</Badge>
                  </div>
                  <div className="h-[30rem]">
                    <ModeSpectrumPlot
                      modes={spectrum.modes}
                      selectedMode={selectedMode}
                      onSelectMode={setSelectedMode}
                    />
                  </div>
                </section>

                <section className="rounded-[24px] border border-[var(--ide-border-subtle)] bg-[var(--ide-surface-raised)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-[var(--ide-text-1)]">Mode Table</h2>
                      <p className="text-sm text-[var(--ide-text-3)]">
                        Saved modes can be opened instantly; summary-only modes stay visible for ranking.
                      </p>
                    </div>
                    <Badge variant="secondary">{spectrum.modes.length} rows</Badge>
                  </div>

                  <div className="max-h-[30rem] overflow-auto rounded-[18px] border border-[var(--ide-border-subtle)]">
                    <table className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 bg-[rgba(9,14,28,0.92)] text-left text-[0.72rem] uppercase tracking-[0.08em] text-[var(--ide-text-3)] backdrop-blur">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">f</th>
                          <th className="px-3 py-2">Norm</th>
                          <th className="px-3 py-2">Max Amp</th>
                          <th className="px-3 py-2">Field</th>
                        </tr>
                      </thead>
                      <tbody>
                        {spectrum.modes.map((mode) => {
                          const isSelected = mode.index === selectedMode;
                          const saved = modeArtifactMap.has(mode.index);
                          return (
                            <tr
                              key={mode.index}
                              className={`cursor-pointer border-t border-[var(--ide-border-subtle)] transition-colors ${
                                isSelected
                                  ? "bg-[rgba(59,102,220,0.18)]"
                                  : "hover:bg-[rgba(28,38,66,0.34)]"
                              }`}
                              onClick={() => setSelectedMode(mode.index)}
                            >
                              <td className="px-3 py-2 font-mono text-[var(--ide-text-1)]">{mode.index}</td>
                              <td className="px-3 py-2 font-mono text-[var(--ide-text-1)]">
                                {formatFrequencyGHz(mode.frequency_hz)}
                              </td>
                              <td className="px-3 py-2 font-mono text-[var(--ide-text-2)]">
                                {mode.norm.toExponential(3)}
                              </td>
                              <td className="px-3 py-2 font-mono text-[var(--ide-text-2)]">
                                {mode.max_amplitude.toExponential(3)}
                              </td>
                              <td className="px-3 py-2">
                                <Badge variant={saved ? "success" : "warn"}>{saved ? "saved" : "summary"}</Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </TabsContent>

            <TabsContent value="modes">
              {selectedModePath == null && (
                <EmptyState
                  title="Selected mode was not exported as a field"
                  description="The spectrum summary is present, but this mode has no `eigen/modes/mode_XXXX.json` artifact yet."
                />
              )}
              {selectedModePath != null && (
                <EigenModeInspector
                  mesh={mesh}
                  mode={selectedModeArtifact}
                  loading={modeLoadState === "loading"}
                />
              )}
              {modeLoadState === "error" && modeError && (
                <div className="rounded-[18px] border border-[rgba(255,136,136,0.24)] bg-[rgba(60,12,20,0.22)] px-4 py-3 text-sm text-[rgb(255,196,196)]">
                  {modeError}
                </div>
              )}
            </TabsContent>

            <TabsContent value="dispersion">
              {dispersionRows.length === 0 ? (
                <EmptyState
                  title="No dispersion branches exported"
                  description="Add SaveDispersion to the Eigenmodes outputs to populate branch plots and k-path metadata."
                />
              ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.8fr)]">
                  <section className="rounded-[24px] border border-[var(--ide-border-subtle)] bg-[var(--ide-surface-raised)] p-4">
                    <div className="mb-3">
                      <h2 className="text-base font-semibold text-[var(--ide-text-1)]">Dispersion</h2>
                      <p className="text-sm text-[var(--ide-text-3)]">
                        Branch data comes directly from `eigen/dispersion/branch_table.csv`.
                      </p>
                    </div>
                    <div className="h-[30rem]">
                      <DispersionBranchPlot
                        rows={dispersionRows}
                        selectedMode={selectedMode}
                        onSelectMode={setSelectedMode}
                      />
                    </div>
                  </section>

                  <section className="rounded-[24px] border border-[var(--ide-border-subtle)] bg-[var(--ide-surface-raised)] p-4">
                    <div className="mb-3">
                      <h2 className="text-base font-semibold text-[var(--ide-text-1)]">Branch Samples</h2>
                      <p className="text-sm text-[var(--ide-text-3)]">
                        Click a row to focus the corresponding mode across tabs.
                      </p>
                    </div>
                    <div className="max-h-[30rem] overflow-auto rounded-[18px] border border-[var(--ide-border-subtle)]">
                      <table className="w-full border-collapse text-sm">
                        <thead className="sticky top-0 bg-[rgba(9,14,28,0.92)] text-left text-[0.72rem] uppercase tracking-[0.08em] text-[var(--ide-text-3)] backdrop-blur">
                          <tr>
                            <th className="px-3 py-2">Mode</th>
                            <th className="px-3 py-2">kx</th>
                            <th className="px-3 py-2">ky</th>
                            <th className="px-3 py-2">kz</th>
                            <th className="px-3 py-2">f</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dispersionRows.map((row, index) => (
                            <tr
                              key={`${row.modeIndex}:${index}`}
                              className={`cursor-pointer border-t border-[var(--ide-border-subtle)] transition-colors ${
                                row.modeIndex === selectedMode
                                  ? "bg-[rgba(59,102,220,0.18)]"
                                  : "hover:bg-[rgba(28,38,66,0.34)]"
                              }`}
                              onClick={() => setSelectedMode(row.modeIndex)}
                            >
                              <td className="px-3 py-2 font-mono text-[var(--ide-text-1)]">{row.modeIndex}</td>
                              <td className="px-3 py-2 font-mono text-[var(--ide-text-2)]">{row.kx.toExponential(2)}</td>
                              <td className="px-3 py-2 font-mono text-[var(--ide-text-2)]">{row.ky.toExponential(2)}</td>
                              <td className="px-3 py-2 font-mono text-[var(--ide-text-2)]">{row.kz.toExponential(2)}</td>
                              <td className="px-3 py-2 font-mono text-[var(--ide-text-1)]">
                                {formatFrequencyGHz(row.frequencyHz)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )}
            </TabsContent>

            <TabsContent value="diagnostics">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
                <section className="rounded-[24px] border border-[var(--ide-border-subtle)] bg-[var(--ide-surface-raised)] p-4">
                  <div className="mb-4">
                    <h2 className="text-base font-semibold text-[var(--ide-text-1)]">Study Diagnostics</h2>
                    <p className="text-sm text-[var(--ide-text-3)]">
                      Residual and orthogonality diagnostics are not exported yet, so this view focuses on operator and
                      artifact provenance.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MetricCard label="Study" value={spectrum.study_kind} />
                    <MetricCard label="Operator" value={spectrum.operator.kind} />
                    <MetricCard label="Include demag" value={spectrum.operator.include_demag ? "yes" : "no"} />
                    <MetricCard label="Damping policy" value={spectrum.damping_policy} />
                    <MetricCard label="Equilibrium source" value={spectrum.equilibrium_source.kind} />
                    <MetricCard label="Relax steps" value={spectrum.relaxation_steps.toLocaleString()} />
                    <MetricCard label="k sampling" value={formatKVector(spectrum.k_sampling)} />
                    <MetricCard label="Artifacts" value={savedModeIndices.length.toLocaleString()} />
                  </div>
                </section>

                <section className="rounded-[24px] border border-[var(--ide-border-subtle)] bg-[var(--ide-surface-raised)] p-4">
                  <div className="mb-4">
                    <h2 className="text-base font-semibold text-[var(--ide-text-1)]">Selection</h2>
                    <p className="text-sm text-[var(--ide-text-3)]">
                      The current focus stays synchronized across spectrum, mode view and branch table.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <InfoRow label="Selected mode" value={selectedMode !== null ? String(selectedMode) : "n/a"} />
                    <InfoRow
                      label="Selected frequency"
                      value={selectedModeSummary ? formatFrequencyGHz(selectedModeSummary.frequency_hz) : "n/a"}
                    />
                    <InfoRow label="Field artifact" value={selectedModePath ?? "not exported"} />
                    <InfoRow label="Normalization" value={selectedModeArtifact?.normalization ?? spectrum.normalization} />
                    <InfoRow label="Polarization" value={selectedModeArtifact?.dominant_polarization ?? "n/a"} />
                  </div>
                </section>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}

function MetricCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-[18px] border border-[rgba(145,170,255,0.18)] bg-[rgba(10,16,28,0.48)] px-4 py-3">
      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--ide-text-3)]">{label}</div>
      <div className={`mt-2 text-sm font-medium ${accent ? "text-[var(--status-running)]" : "text-[var(--ide-text-1)]"}`}>
        {value}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-[var(--ide-border-subtle)] bg-[rgba(9,14,26,0.5)] px-4 py-3">
      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--ide-text-3)]">{label}</div>
      <div className="mt-1 break-all font-mono text-sm text-[var(--ide-text-1)]">{value}</div>
    </div>
  );
}
