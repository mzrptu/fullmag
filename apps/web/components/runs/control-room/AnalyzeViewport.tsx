"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

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

interface BootstrapLite {
  artifacts: { path: string; kind: string }[];
  fem_mesh: FemMeshPayload | null;
  live_state?: { latest_step?: { fem_mesh?: FemMeshPayload | null } | null } | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function fmtGHz(hz: number): string {
  return `${(hz / 1e9).toFixed(4)} GHz`;
}

function fmtK(v: [number, number, number] | null): string {
  if (!v) return "Γ";
  return `(${v.map((x) => x.toExponential(1)).join(", ")})`;
}

const POL_STYLE: Record<string, string> = {
  ip: "bg-sky-500/20 text-sky-300",
  in_plane: "bg-sky-500/20 text-sky-300",
  op: "bg-violet-500/20 text-violet-300",
  out_of_plane: "bg-violet-500/20 text-violet-300",
  z: "bg-emerald-500/20 text-emerald-300",
  uniform: "bg-pink-500/20 text-pink-300",
  mixed: "bg-amber-500/20 text-amber-300",
};
function polStyle(pol: string): string {
  return POL_STYLE[pol.toLowerCase().replace(/[\s-]/g, "_")] ?? "bg-muted/50 text-muted-foreground";
}

export default function AnalyzeViewport() {
  const containerRef = useRef<HTMLDivElement>(null);

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
  const [activeTab, setActiveTab] = useState("spectrum");

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
        if (nextSpectrum && nextSpectrum.modes.length > 0) {
          setSelectedMode((prev) => prev ?? nextSpectrum.modes[0].index);
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

  const modeIndices = useMemo(() => spectrum?.modes.map((m) => m.index) ?? [], [spectrum]);
  const selectedModeArtifact = selectedMode !== null ? (modeCache[selectedMode] ?? null) : null;
  const selectedModeSummary = useMemo(
    () => spectrum?.modes.find((m) => m.index === selectedMode) ?? null,
    [spectrum, selectedMode],
  );
  const modeArtifactMap = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const key of Object.keys(modeCache)) map.set(Number(key), true);
    return map;
  }, [modeCache]);
  const hasEigenArtifacts = spectrum !== null;

  const goToPrev = useCallback(() => {
    if (!modeIndices.length || selectedMode === null) return;
    const pos = modeIndices.indexOf(selectedMode);
    if (pos > 0) setSelectedMode(modeIndices[pos - 1]);
  }, [modeIndices, selectedMode]);

  const goToNext = useCallback(() => {
    if (!modeIndices.length || selectedMode === null) return;
    const pos = modeIndices.indexOf(selectedMode);
    if (pos < modeIndices.length - 1) setSelectedMode(modeIndices[pos + 1]);
  }, [modeIndices, selectedMode]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); goToPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); goToNext(); }
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [goToPrev, goToNext]);

  const handleSelectMode = useCallback((idx: number) => {
    setSelectedMode(idx);
    setActiveTab("modes");
  }, []);

  const modePos = selectedMode !== null ? modeIndices.indexOf(selectedMode) : -1;
  const hasPrev = modePos > 0;
  const hasNext = modePos >= 0 && modePos < modeIndices.length - 1;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden bg-background outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
    >
      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 bg-card/30 backdrop-blur shrink-0">
        <span className="text-[0.62rem] font-bold uppercase tracking-widest text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-sm border border-border/40 shrink-0">
          Analyze
        </span>

        {hasEigenArtifacts && modeIndices.length > 0 && (
          <>
            <button
              type="button"
              title="Previous mode (←)"
              disabled={!hasPrev}
              onClick={goToPrev}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="font-mono text-[0.7rem] text-foreground/70 tabular-nums min-w-[3.5rem] text-center">
              {selectedMode !== null ? `${modePos + 1} / ${modeIndices.length}` : "—"}
            </span>
            <button
              type="button"
              title="Next mode (→)"
              disabled={!hasNext}
              onClick={goToNext}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </>
        )}

        {selectedModeSummary && (
          <div className="flex items-center gap-2 pl-1 border-l border-border/30">
            <span className="font-mono text-[0.7rem] text-foreground/60">#{selectedModeSummary.index}</span>
            <span className="font-mono text-[0.72rem] font-semibold text-foreground/90">
              {fmtGHz(selectedModeSummary.frequency_hz)}
            </span>
            <span className={`text-[0.6rem] px-1.5 py-0.5 rounded-full font-semibold ${polStyle(selectedModeSummary.dominant_polarization)}`}>
              {selectedModeSummary.dominant_polarization}
            </span>
            <span className="font-mono text-[0.62rem] text-muted-foreground hidden lg:inline">
              k={fmtK(selectedModeSummary.k_vector)}
            </span>
          </div>
        )}

        {loadState === "loading" && (
          <span className="text-[0.68rem] text-muted-foreground ml-1">Loading…</span>
        )}
        {loadState === "error" && (
          <span className="text-[0.68rem] text-rose-400 ml-1 truncate max-w-[240px]">{error}</span>
        )}

        <div className="flex-1" />

        {spectrum && (
          <div className="hidden lg:flex items-center gap-1.5 text-[0.62rem] text-muted-foreground">
            <span className="bg-muted/40 border border-border/30 rounded px-1.5 py-0.5">{spectrum.operator.kind}</span>
            <span className="bg-muted/40 border border-border/30 rounded px-1.5 py-0.5">{spectrum.normalization}</span>
            <span className="bg-muted/40 border border-border/30 rounded px-1.5 py-0.5">{spectrum.modes.length} modes</span>
          </div>
        )}

        <button
          type="button"
          title="Refresh analyze data"
          onClick={() => { setRefreshNonce((n) => n + 1); }}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.68rem] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-transparent hover:border-border/40 shrink-0"
        >
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
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
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="shrink-0 px-3 pt-2 pb-0 border-b border-border/20">
              <TabsList className="h-7 gap-0.5 bg-transparent p-0">
                <TabsTrigger value="spectrum" className="h-7 px-3 text-[0.72rem]">Spectrum</TabsTrigger>
                <TabsTrigger value="modes" className="h-7 px-3 text-[0.72rem]">
                  Modes
                  {modeLoadState === "loading" && (
                    <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                  )}
                </TabsTrigger>
                {dispersionRows.length > 0 && (
                  <TabsTrigger value="dispersion" className="h-7 px-3 text-[0.72rem]">Dispersion</TabsTrigger>
                )}
              </TabsList>
            </div>

            {/* ── Spectrum tab ── */}
            <TabsContent value="spectrum" className="flex-1 min-h-0 overflow-hidden p-2.5">
              <div className="grid h-full gap-2.5 xl:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.75fr)]">
                <section className="flex flex-col rounded-xl border border-border/35 bg-card/40 p-2.5 min-h-0 min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-2 shrink-0">
                    <h2 className="text-[0.75rem] font-semibold text-foreground/80">Eigenmode Spectrum</h2>
                    <div className="flex gap-1">
                      <span className="text-[0.6rem] bg-muted/40 border border-border/30 rounded px-1.5 py-0.5 text-muted-foreground">{spectrum.operator.kind}</span>
                      {spectrum.k_sampling && (
                        <span className="text-[0.6rem] bg-indigo-500/10 border border-indigo-500/25 rounded px-1.5 py-0.5 text-indigo-300">k-sweep</span>
                      )}
                    </div>
                  </div>
                  <p className="text-[0.62rem] text-muted-foreground mb-1.5 shrink-0">
                    Click a mode to inspect its field. Use ← → to step through modes.
                  </p>
                  <div className="flex-1 min-h-0">
                    <ModeSpectrumPlot modes={spectrum.modes} selectedMode={selectedMode} onSelectMode={handleSelectMode} />
                  </div>
                </section>

                <section className="flex flex-col rounded-xl border border-border/35 bg-card/40 p-2.5 min-h-0">
                  <div className="mb-1 flex items-center justify-between gap-2 shrink-0">
                    <h2 className="text-[0.75rem] font-semibold text-foreground/80">Modes</h2>
                    <span className="text-[0.6rem] text-muted-foreground">{spectrum.modes.length} total</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-1.5 shrink-0">
                    <span className="text-[0.6rem] bg-muted/40 border border-border/30 rounded px-1.5 py-0.5 text-muted-foreground">norm: {spectrum.normalization}</span>
                    <span className="text-[0.6rem] bg-muted/40 border border-border/30 rounded px-1.5 py-0.5 text-muted-foreground">eq: {spectrum.equilibrium_source.kind}</span>
                    <span className="text-[0.6rem] bg-muted/40 border border-border/30 rounded px-1.5 py-0.5 text-muted-foreground">α: {spectrum.damping_policy}</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border/25">
                    <table className="w-full border-collapse text-[0.68rem]">
                      <thead className="sticky top-0 bg-[rgba(9,14,28,0.95)] text-left text-[0.6rem] uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
                        <tr>
                          <th className="px-2 py-1.5 font-medium">#</th>
                          <th className="px-2 py-1.5 font-medium">f (GHz)</th>
                          <th className="px-2 py-1.5 font-medium">Pol</th>
                          <th className="px-2 py-1.5 font-medium">Amp</th>
                          <th className="px-2 py-1.5 font-medium">Field</th>
                        </tr>
                      </thead>
                      <tbody>
                        {spectrum.modes.map((mode) => {
                          const isSelected = mode.index === selectedMode;
                          const saved = modeArtifactMap.has(mode.index);
                          return (
                            <tr
                              key={mode.index}
                              className={`cursor-pointer border-t border-border/15 transition-colors ${isSelected ? "bg-primary/12 text-primary" : "hover:bg-muted/35 text-foreground/80"}`}
                              onClick={() => { setSelectedMode(mode.index); setActiveTab("modes"); }}
                            >
                              <td className="px-2 py-1 font-mono font-semibold">{mode.index}</td>
                              <td className="px-2 py-1 font-mono">{(mode.frequency_hz / 1e9).toFixed(4)}</td>
                              <td className="px-2 py-1">
                                <span className={`text-[0.58rem] px-1.5 py-0.5 rounded-full font-semibold ${polStyle(mode.dominant_polarization)}`}>
                                  {mode.dominant_polarization}
                                </span>
                              </td>
                              <td className="px-2 py-1 font-mono text-muted-foreground">{mode.max_amplitude.toExponential(2)}</td>
                              <td className="px-2 py-1">
                                <span className={`text-[0.58rem] px-1 py-0.5 rounded font-medium ${saved ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
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
            <TabsContent value="modes" className="flex-1 min-h-0 overflow-hidden flex flex-col p-0">
              {spectrum.modes.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 bg-card/20 shrink-0">
                  <button type="button" disabled={!hasPrev} onClick={goToPrev}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.7rem] text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronLeft size={13} /> Prev
                  </button>
                  <div className="flex-1 overflow-x-auto scrollbar-none">
                    <div className="flex gap-1">
                      {spectrum.modes.map((m) => (
                        <button key={m.index} type="button" onClick={() => setSelectedMode(m.index)}
                          title={`Mode ${m.index}: ${fmtGHz(m.frequency_hz)} · ${m.dominant_polarization}`}
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-mono tabular-nums transition-colors ${m.index === selectedMode ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
                          {m.index}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="button" disabled={!hasNext} onClick={goToNext}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.7rem] text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    Next <ChevronRight size={13} />
                  </button>
                </div>
              )}
              {selectedMode === null ? (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState title="No mode selected" description="Select a mode from the Spectrum tab." tone="info" compact />
                </div>
              ) : modeLoadState === "error" ? (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState title="Mode field unavailable" description={modeError ?? "This mode has no saved field artifact."} tone="warning" compact />
                </div>
              ) : (
                <div className="flex-1 min-h-0">
                  <EigenModeInspector mesh={mesh} mode={selectedModeArtifact} loading={modeLoadState === "loading"} compact />
                </div>
              )}
            </TabsContent>

            {/* ── Dispersion tab ── */}
            {dispersionRows.length > 0 && (
              <TabsContent value="dispersion" className="flex-1 min-h-0 overflow-hidden p-2.5">
                <div className="grid h-full gap-2.5 xl:grid-cols-[minmax(0,1.3fr)_minmax(200px,0.7fr)]">
                  <section className="flex flex-col rounded-xl border border-border/35 bg-card/40 p-2.5 min-h-0">
                    <div className="mb-1 shrink-0">
                      <h2 className="text-[0.75rem] font-semibold text-foreground/80">Dispersion Relation</h2>
                      <p className="text-[0.62rem] text-muted-foreground mt-0.5">
                        f(|k|) from <code className="text-[0.6rem]">eigen/dispersion/branch_table.csv</code>
                      </p>
                    </div>
                    <div className="flex-1 min-h-0">
                      <DispersionBranchPlot rows={dispersionRows} selectedMode={selectedMode}
                        onSelectMode={(idx) => { setSelectedMode(idx); setActiveTab("modes"); }} />
                    </div>
                  </section>
                  <section className="flex flex-col rounded-xl border border-border/35 bg-card/40 p-2.5 min-h-0">
                    <div className="mb-1 flex items-center justify-between gap-2 shrink-0">
                      <h2 className="text-[0.75rem] font-semibold text-foreground/80">Samples</h2>
                      <span className="text-[0.6rem] text-muted-foreground">{dispersionRows.length} rows</span>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border/25">
                      <table className="w-full border-collapse text-[0.68rem]">
                        <thead className="sticky top-0 bg-[rgba(9,14,28,0.95)] text-left text-[0.6rem] uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
                          <tr>
                            <th className="px-2 py-1.5 font-medium">Mode</th>
                            <th className="px-2 py-1.5 font-medium">kx</th>
                            <th className="px-2 py-1.5 font-medium">ky</th>
                            <th className="px-2 py-1.5 font-medium">kz</th>
                            <th className="px-2 py-1.5 font-medium">f</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dispersionRows.map((row, i) => (
                            <tr key={`${row.modeIndex}:${i}`}
                              className={`cursor-pointer border-t border-border/15 transition-colors ${row.modeIndex === selectedMode ? "bg-primary/12 text-primary" : "hover:bg-muted/35 text-foreground/80"}`}
                              onClick={() => { setSelectedMode(row.modeIndex); setActiveTab("modes"); }}>
                              <td className="px-2 py-1 font-mono font-semibold">{row.modeIndex}</td>
                              <td className="px-2 py-1 font-mono text-muted-foreground">{row.kx.toExponential(2)}</td>
                              <td className="px-2 py-1 font-mono text-muted-foreground">{row.ky.toExponential(2)}</td>
                              <td className="px-2 py-1 font-mono text-muted-foreground">{row.kz.toExponential(2)}</td>
                              <td className="px-2 py-1 font-mono">{fmtGHz(row.frequencyHz)}</td>
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
