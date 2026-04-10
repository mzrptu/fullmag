"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DispersionRow,
  EigenBranchesArtifact,
  EigenModeArtifact,
  EigenSpectrumArtifact,
  FemMeshPayload,
} from "@/components/analyze/eigenTypes";
import { resolveApiBase } from "@/lib/apiBase";

type LoadState = "idle" | "loading" | "loaded" | "error";

interface EigenDispersionResponse {
  csv_path: string;
  path_metadata?: unknown;
  rows: DispersionRow[];
}

interface BootstrapLite {
  artifacts: { path: string; kind?: string }[];
  fem_mesh: FemMeshPayload | null;
  live_state?: { latest_step?: { fem_mesh?: FemMeshPayload | null } | null } | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface CurrentAnalyzeArtifactsState {
  loadState: LoadState;
  modeLoadState: LoadState;
  error: string | null;
  modeError: string | null;
  mesh: FemMeshPayload | null;
  spectrum: EigenSpectrumArtifact | null;
  branches: EigenBranchesArtifact | null;
  dispersionRows: DispersionRow[];
  modeCache: Record<number, EigenModeArtifact>;
  hasEigenArtifacts: boolean;
  /** Map from mode index → artifact path (only modes that have a saved field file). */
  modeArtifactMap: Map<number, string>;
  /** Sorted list of mode indices that have saved field files. */
  savedModeIndices: number[];
  refresh: () => void;
  ensureMode: (index: number, sampleIndex?: number | null) => Promise<void>;
}

export function useCurrentAnalyzeArtifacts(
  refreshNonce: number,
): CurrentAnalyzeArtifactsState {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [modeLoadState, setModeLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [mesh, setMesh] = useState<FemMeshPayload | null>(null);
  const [spectrum, setSpectrum] = useState<EigenSpectrumArtifact | null>(null);
  const [branches, setBranches] = useState<EigenBranchesArtifact | null>(null);
  const [dispersionRows, setDispersionRows] = useState<DispersionRow[]>([]);
  const [modeCache, setModeCache] = useState<Record<number, EigenModeArtifact>>({});
  const [modeArtifactMap, setModeArtifactMap] = useState<Map<number, string>>(new Map());
  const [internalRefreshNonce, setInternalRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadState("loading");
      setError(null);

      try {
        const base = resolveApiBase();
        const [bootstrap, liveArtifacts] = await Promise.all([
          fetchJson<BootstrapLite>(`${base}/v1/live/current/bootstrap`),
          fetchJson<Array<{ path: string; kind?: string }>>(
            `${base}/v1/live/current/artifacts`,
          ).catch(() => []),
        ]);
        if (cancelled) return;

        const bootstrapArtifacts = Array.isArray(bootstrap.artifacts)
          ? bootstrap.artifacts
          : [];
        // Prefer live artifact listing (fresh filesystem scan). Bootstrap can be stale.
        const artifacts =
          liveArtifacts.length > 0 ? liveArtifacts : bootstrapArtifacts;
        const artifactPaths = artifacts.map((artifact) => artifact.path);
        const hasSpectrum = artifactPaths.some(
          (path) => path === "eigen/spectrum.json" || path.startsWith("eigen/spectrum"),
        );
        const hasDispersion = artifactPaths.some(
          (path) => path === "eigen/dispersion.json" || path.startsWith("eigen/dispersion"),
        );
        const hasBranches = artifactPaths.some(
          (path) => path === "eigen/branches.json" || path.startsWith("eigen/branches"),
        );

        const nextModeArtifactMap = new Map<number, string>();
        for (const a of artifacts) {
          if (a.path.startsWith("eigen/modes/")) {
            const match = /mode_(\d+)\.json$/i.exec(a.path);
            if (match) nextModeArtifactMap.set(Number.parseInt(match[1], 10), a.path);
          }
        }

        const [nextSpectrum, nextDispersion, nextBranches] = await Promise.all([
          hasSpectrum
            ? fetchJson<EigenSpectrumArtifact>(`${base}/v1/live/current/eigen/spectrum`).catch(
                () => null,
              )
            : Promise.resolve(null),
          hasDispersion
            ? fetchJson<EigenDispersionResponse>(`${base}/v1/live/current/eigen/dispersion`).catch(
                () => null,
              )
            : Promise.resolve(null),
          hasBranches
            ? fetchJson<EigenBranchesArtifact>(`${base}/v1/live/current/eigen/branches`).catch(
                () => null,
              )
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        setMesh(bootstrap.fem_mesh ?? bootstrap.live_state?.latest_step?.fem_mesh ?? null);
        setSpectrum(nextSpectrum);
        setBranches(nextBranches);
        setDispersionRows(nextDispersion?.rows ?? []);
        setModeArtifactMap(nextModeArtifactMap);
        setModeCache({});
        setModeLoadState("idle");
        setModeError(null);
        setLoadState("loaded");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoadState("error");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, internalRefreshNonce]);

  const ensureMode = useCallback(async (index: number, sampleIndex?: number | null) => {
    if (modeCache[index]) return;

    setModeLoadState("loading");
    setModeError(null);

    try {
      const base = resolveApiBase();
      const params = new URLSearchParams({ index: String(index) });
      if (sampleIndex != null) {
        params.set("sample_index", String(sampleIndex));
      }
      const artifact = await fetchJson<EigenModeArtifact>(
        `${base}/v1/live/current/eigen/mode?${params.toString()}`,
      );
      setModeCache((prev) => ({ ...prev, [index]: artifact }));
      setModeLoadState("loaded");
    } catch (err) {
      setModeError(err instanceof Error ? err.message : String(err));
      setModeLoadState("error");
    }
  }, [modeCache]);

  const hasEigenArtifacts = useMemo(
    () => Boolean(spectrum) || Boolean(branches) || dispersionRows.length > 0 || modeArtifactMap.size > 0,
    [branches, dispersionRows.length, modeArtifactMap, spectrum],
  );

  const savedModeIndices = useMemo(
    () => Array.from(modeArtifactMap.keys()).sort((a, b) => a - b),
    [modeArtifactMap],
  );

  const refresh = useCallback(() => {
    setInternalRefreshNonce((n) => n + 1);
  }, []);

  return {
    loadState,
    modeLoadState,
    error,
    modeError,
    mesh,
    spectrum,
    branches,
    dispersionRows,
    modeCache,
    hasEigenArtifacts,
    modeArtifactMap,
    savedModeIndices,
    refresh,
    ensureMode,
  };
}
