"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DispersionRow,
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
  dispersionRows: DispersionRow[];
  modeCache: Record<number, EigenModeArtifact>;
  hasEigenArtifacts: boolean;
  refresh: () => void;
  ensureMode: (index: number) => Promise<void>;
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
  const [dispersionRows, setDispersionRows] = useState<DispersionRow[]>([]);
  const [modeCache, setModeCache] = useState<Record<number, EigenModeArtifact>>({});
  const [internalRefreshNonce, setInternalRefreshNonce] = useState(0);

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

        setMesh(bootstrap.fem_mesh ?? bootstrap.live_state?.latest_step?.fem_mesh ?? null);
        setSpectrum(nextSpectrum);
        setDispersionRows(nextDispersion?.rows ?? []);
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

  const ensureMode = useCallback(async (index: number) => {
    if (modeCache[index]) return;

    setModeLoadState("loading");
    setModeError(null);

    try {
      const base = resolveApiBase();
      const artifact = await fetchJson<EigenModeArtifact>(
        `${base}/v1/live/current/eigen/mode?index=${index}`,
      );
      setModeCache((prev) => ({ ...prev, [index]: artifact }));
      setModeLoadState("loaded");
    } catch (err) {
      setModeError(err instanceof Error ? err.message : String(err));
      setModeLoadState("error");
    }
  }, [modeCache]);

  const hasEigenArtifacts = useMemo(() => Boolean(spectrum), [spectrum]);

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
    dispersionRows,
    modeCache,
    hasEigenArtifacts,
    refresh,
    ensureMode,
  };
}
