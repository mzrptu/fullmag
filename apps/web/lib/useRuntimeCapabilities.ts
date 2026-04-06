"use client";

import { useEffect, useState } from "react";
import { currentLiveApiClient, type HostCapabilityMatrix } from "./liveApiClient";

export interface UseRuntimeCapabilitiesResult {
  capabilities: HostCapabilityMatrix | null;
  loading: boolean;
  error: string | null;
}

export function useRuntimeCapabilities(): UseRuntimeCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<HostCapabilityMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = currentLiveApiClient();

    client
      .fetchRuntimeCapabilities()
      .then((next) => {
        if (cancelled) return;
        setCapabilities(next);
        setError(null);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : "Failed to load runtime capabilities");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { capabilities, loading, error };
}
