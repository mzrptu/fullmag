"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import DispersionBranchPlot from "@/components/analyze/DispersionBranchPlot";
import EigenModeInspector from "@/components/analyze/EigenModeInspector";
import ModeSpectrumPlot from "@/components/analyze/ModeSpectrumPlot";
import type {
  DispersionRow,
  EigenModeArtifact,
  EigenSpectrumArtifact,
  FemMeshPayload,
} from "@/components/analyze/eigenTypes";
import EmptyState from "@/components/ui/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveApiBase } from "@/lib/apiBase";

type LoadState = "idle" | "loading" | "loaded" | "error";

interface EigenDispersionResponse {
  csv_path: string;
  path_metadata?: unknown;
  rows: DispersionRow[];
}

function formatFrequencyGHz(valueHz: number): string {
  return `${(valueHz / 1e9).toFixed(4)} GHz`;
}

function formatKVector(value: [number, number, number] | null): string {
  if (!value) return "Γ";
  return value.map((v) => v.toExponential(2)).join(", ");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface BootstrapLite {
  artifacts: { path: string; kind: string }[];
  fem_mesh: FemMeshPayload | null;
  live_state?: { latest_step?: { fem_mesh?: FemMeshPayload | null } | null } | null;
}

/**
 * Self-contained Analyze viewport — embeds eigenmode spectrum + mode inspector
 * in the control-room canvas area. Fetches its own data from the live API.
 */
export default function AnalyzeViewport() {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [modeLoadState, setModeLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [mesh, setMesh] = useState<FemMeshPayload | null>(null);
  const [spectrum, setSpectrum] = useState<EigenSpectrumArtifact | null>(null);
  const [dispersionRows, setDispersionRows] = useState<DispersionRow[]>([]);
  const [selectedMode, setSelectedMode] = useState<number | null>(null);
  const [modeCache, setModeCache] = useState<Record<number, EigenModeArtifact>>({});

  // ── Bootstrap + spectrum load ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadState("loading");
      setError(null);

      try {
        const base = resolveApiBase();
        const bootstrap = await fetchJson<BootstrapLite>(`${base}/v1/live/current/bootstrap`);
        if (cancelled) return;

        const artifacts = Array.isArray(bootstrap.artifacts) ? bootstrap.artifacts : [];
        const nextMesh =
          bootstrap.fem_mesh ?? bootstrap.live_state?.latest_step?.fem_mesh ?? null;

        const hasSpectrum = artifacts.some(
          (a) =>
            a.path === "eigen/spectrum.json" ||
            a.path === "eigen/metadata/eigen_summary.json",
        );
        const hasDispersion = artifacts.some(
          (a) => a.path === "eigen/dispersion/branch_table.csv",
        );

        const [nextSpectrum, nextDispersion] = await Promise.all([
          hasSpectrum
            ? fetchJson<EigenSpectrumArtifact>(`${base}/v1/live/current/eigen/spectrum`)
            : Promise.resolve(null),
          hasDispersion
            ? fetchJson<EigenDispersionResponse>(`${base}/v1/live/current/eigen/dispersion`)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;

        setMesh(nextMesh);
        setSpectrum(nextSpectrum);
        setDispersionRows(nextDispersion?.rows ?? []);
        setModeCache({});
        setLoadState("loaded");
        if (nextSpectrum && nextSpectrum.modes.length > 0 && selectedMode === null) {
          setSelectedMode(nextSpectrum.modes[0].index);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoadState("error");
        }
      }
    }

    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  // ── Selected mode artifact load ────────────────────────────────────────────
  useEffect(() => {
    if (selectedMode === null) return;
    if (modeCache[selectedMode]) return;

    let cancelled = false;
    setModeLoadState("loading");
    setModeError(null);

    const base = resolveApiBase();
    fetchJson<EigenModeArtifact>(`${base}/v1/live/current/eigen/mode?index=${selectedMode}`)
      .then((artifact) => {
        if (cancelled) return;
        setModeCache((prev) => ({ ...prev, [selectedMode]: artifact }));
        setModeLoadState("loaded");
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setModeError(err instanceof Error ? err.message : String(err));
          setModeLoadState("error");
        }
      });

    return () => { cancelled = true; };
  }, [selectedMode, modeCache]);

  const selectedModeArtifact = selectedMode !== null ? (modeCache[selectedMode] ?? null) : null;
  const selectedModeSummary = useMemo(
    () => spectrum?.modes.find((m) => m.index === selectedMode) ?? null,
    [spectrum, selectedMode],
  );

  const modeArtifactMap = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const key of Object.keys(modeCache)) {
      map.set(Number(key), true);
    }
    return map;
  }, [modeCache]);

  const hasEigenArtifacts = spectrum !== null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border/30 bg-card/30 backdrop-blur shrink-0">
        <span className="text-[0.68rem] font-bold uppercase tracking-widest text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-sm border border-border/40">
          Analyze
        </span>
        {loadState === "loading" && (
          <span className="text-[0.7rem] text-muted-foreground">Loading…</span>
        )}
        {loadState === "error" && (
          <span className="text-[0.7rem] text-rose-400">{error}</span>
        )}
        {hasEigenArtifacts && selectedModeSummary && (
          <>
            <span className="text-[0.7rem] font-mono text-muted-foreground">
              Mode#{selectedModeSummary.index}
            </span>
            <span className="text-[0.7rem] font-mono text-foreground/80">
              {formatFrequencyGHz(selectedModeSummary.frequency_hz)}
            </span>
            <span className="text-[0.7rem] font-mono text-muted-foreground">
              k=({formatKVector(selectedModeSummary.k_vector)})
            </span>
          </>
        )}
        <div className="flex-1" />
        <button
          type="button"
          title="Refresh analyze data"
          onClick={() => setRefreshNonce((n) => n + 1)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.7rem] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-transparent hover:border-border/40"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loadState === "loading" && (
          <div className="flex h-full items-center justify-center">
            <EmptyState title="Loading eigen data" description="Fetching spectrum and mesh from the active session." tone="info" compact />
          </div>
        )}

        {loadState === "error" && (
          <div className="flex h-full items-center justify-center">
            <EmptyState title="Analyze unavailable" description={error ?? "No active session."} tone="warning" compact />
          </div>
        )}

        {loadState === "loaded" && !hasEigenArtifacts && (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title="No eigen artifacts"
              description="Run a FEM Eigenmodes study with SaveSpectrum and SaveMode outputs to unlock the Analyze view."
              tone="info"
              compact
            />
          </div>
        )}

        {loadState === "loaded" && hasEigenArtifacts && spectrum && (
          <Tabs defaultValue="spectrum" className="h-full flex flex-col p-3 gap-2">
            <TabsList className="shrink-0">
              <TabsTrigger value="spectrum">Spectrum</TabsTrigger>
              <TabsTrigger value="modes">Modes</TabsTrigger>
              {dispersionRows.length > 0 && (
                <TabsTrigger value="dispersion">Dispersion</TabsTrigger>
              )}
            </TabsList>

            {/* ── Spectrum tab ── */}
            <TabsContent value="spectrum" className="flex-1 min-h-0 overflow-auto">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.8fr)] h-full">
                <section className="rounded-xl border border-border/40 bg-card/50 p-3 flex flex-col min-h-0">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-foreground">Spectrum</h2>
                    <span className="text-[0.65rem] text-muted-foreground">{spectrum.operator.kind}</span>
                  </div>
                  <div className="flex-1 min-h-0 h-[320px]">
                    <ModeSpectrumPlot
                      modes={spectrum.modes}
                      selectedMode={selectedMode}
                      onSelectMode={setSelectedMode}
                    />
                  </div>
                </section>

                <section className="rounded-xl border border-border/40 bg-card/50 p-3 flex flex-col min-h-0">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-foreground">Modes</h2>
                    <span className="text-[0.65rem] text-muted-foreground">{spectrum.modes.length} total</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border/30">
                    <table className="w-full border-collapse text-[0.7rem]">
                      <thead className="sticky top-0 bg-card/90 text-left text-[0.65rem] uppercase tracking-wider text-muted-foreground backdrop-blur">
                        <tr>
                          <th className="px-2 py-1.5">#</th>
                          <th className="px-2 py-1.5">f</th>
                          <th className="px-2 py-1.5">Amp</th>
                          <th className="px-2 py-1.5">Field</th>
                        </tr>
                      </thead>
                      <tbody>
                        {spectrum.modes.map((mode) => {
                          const isSelected = mode.index === selectedMode;
                          const saved = modeArtifactMap.has(mode.index);
                          return (
                            <tr
                              key={mode.index}
                              className={`cursor-pointer border-t border-border/20 transition-colors ${
                                isSelected
                                  ? "bg-primary/10 text-primary"
                                  : "hover:bg-muted/40"
                              }`}
                              onClick={() => setSelectedMode(mode.index)}
                            >
                              <td className="px-2 py-1 font-mono">{mode.index}</td>
                              <td className="px-2 py-1 font-mono">{formatFrequencyGHz(mode.frequency_hz)}</td>
                              <td className="px-2 py-1 font-mono text-muted-foreground">{mode.max_amplitude.toExponential(2)}</td>
                              <td className="px-2 py-1">
                                <span className={`text-[0.6rem] px-1 py-0.5 rounded font-medium ${saved ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                                  {saved ? "saved" : "sum"}
                                </span>
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

            {/* ── Modes tab ── */}
            <TabsContent value="modes" className="flex-1 min-h-0">
              {selectedMode === null ? (
                <div className="flex h-full items-center justify-center">
                  <EmptyState title="No mode selected" description="Click a mode in the Spectrum tab to inspect its field." tone="info" compact />
                </div>
              ) : modeLoadState === "error" ? (
                <div className="flex flex-col h-full items-center justify-center gap-2">
                  <EmptyState title="Mode field unavailable" description={modeError ?? "This mode has no saved field artifact."} tone="warning" compact />
                </div>
              ) : (
                <EigenModeInspector
                  mesh={mesh}
                  mode={selectedModeArtifact}
                  loading={modeLoadState === "loading"}
                />
              )}
            </TabsContent>

            {/* ── Dispersion tab ── */}
            {dispersionRows.length > 0 && (
              <TabsContent value="dispersion" className="flex-1 min-h-0">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(240px,0.75fr)] h-full">
                  <section className="rounded-xl border border-border/40 bg-card/50 p-3 flex flex-col">
                    <h2 className="mb-2 text-sm font-semibold text-foreground">Dispersion</h2>
                    <div className="flex-1 min-h-0 h-[320px]">
                      <DispersionBranchPlot
                        rows={dispersionRows}
                        selectedMode={selectedMode}
                        onSelectMode={setSelectedMode}
                      />
                    </div>
                  </section>

                  <section className="rounded-xl border border-border/40 bg-card/50 p-3 flex flex-col">
                    <h2 className="mb-2 text-sm font-semibold text-foreground">Branch Samples</h2>
                    <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border/30">
                      <table className="w-full border-collapse text-[0.7rem]">
                        <thead className="sticky top-0 bg-card/90 text-left text-[0.65rem] uppercase tracking-wider text-muted-foreground backdrop-blur">
                          <tr>
                            <th className="px-2 py-1.5">Mode</th>
                            <th className="px-2 py-1.5">kx</th>
                            <th className="px-2 py-1.5">ky</th>
                            <th className="px-2 py-1.5">f</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dispersionRows.map((row, i) => (
                            <tr
                              key={`${row.modeIndex}:${i}`}
                              className={`cursor-pointer border-t border-border/20 transition-colors ${
                                row.modeIndex === selectedMode
                                  ? "bg-primary/10 text-primary"
                                  : "hover:bg-muted/40"
                              }`}
                              onClick={() => setSelectedMode(row.modeIndex)}
                            >
                              <td className="px-2 py-1 font-mono">{row.modeIndex}</td>
                              <td className="px-2 py-1 font-mono text-muted-foreground">{row.kx.toExponential(2)}</td>
                              <td className="px-2 py-1 font-mono text-muted-foreground">{row.ky.toExponential(2)}</td>
                              <td className="px-2 py-1 font-mono">{formatFrequencyGHz(row.frequencyHz)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>
    </div>
  );
}
