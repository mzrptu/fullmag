type PerfSample = {
  scope: string;
  phase: string;
  durationMs: number;
  timestampMs: number;
  meta?: Record<string, number | string | boolean | null>;
};

declare global {
  interface Window {
    __FULLMAG_FRONTEND_PERF__?: PerfSample[];
  }
}

const MAX_SAMPLES = 400;

export function recordFrontendPerfSample(sample: PerfSample): void {
  if (typeof window === "undefined") {
    return;
  }
  const store = window.__FULLMAG_FRONTEND_PERF__ ?? [];
  store.push(sample);
  if (store.length > MAX_SAMPLES) {
    store.splice(0, store.length - MAX_SAMPLES);
  }
  window.__FULLMAG_FRONTEND_PERF__ = store;
}

const renderCounters = new Map<string, number>();

export function recordFrontendRender(scope: string, meta?: Record<string, number | string | boolean | null>): void {
  const nextCount = (renderCounters.get(scope) ?? 0) + 1;
  renderCounters.set(scope, nextCount);
  recordFrontendPerfSample({
    scope,
    phase: "render",
    durationMs: 0,
    timestampMs: typeof performance !== "undefined" ? performance.now() : Date.now(),
    meta: {
      renderCount: nextCount,
      ...(meta ?? {}),
    },
  });
}
