/**
 * Layer B: Session Connection Orchestrator
 *
 * Single orchestrator for:
 * - bootstrap connect
 * - reuse cache in short window
 * - start/stop WS
 * - reconnect backoff
 * - dispatch events to store
 *
 * One session = one orchestrator instance.
 * Reconnect policy is centralized here.
 */

import type { ConnectionStatus } from "../model/sessionRuntime.types";

export interface ReconnectPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  maxRetries: 10,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

export function computeBackoffDelay(
  attempt: number,
  policy: ReconnectPolicy = DEFAULT_RECONNECT_POLICY,
): number {
  const delay = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt);
  return Math.min(delay, policy.maxDelayMs);
}

export interface SessionOrchestratorCallbacks {
  onConnectionChange: (status: ConnectionStatus, error?: string | null) => void;
  onBootstrapData: (data: Record<string, unknown>) => void;
  onLiveEvent: (event: Record<string, unknown>) => void;
}

/**
 * Bootstrap cache policy:
 * - fresh bootstrap: always fetch
 * - stale-but-acceptable: reuse within TTL window on reconnect
 * - in-flight dedupe: don't double-bootstrap
 * - invalidation: on runId/projectId change
 */
export interface BootstrapCacheEntry {
  data: Record<string, unknown>;
  timestamp: number;
  runId: string | null;
  projectId: string | null;
}

const BOOTSTRAP_CACHE_TTL_MS = 5_000;

export class BootstrapCache {
  private entry: BootstrapCacheEntry | null = null;
  private inflightPromise: Promise<Record<string, unknown>> | null = null;

  isValid(runId: string | null, projectId: string | null): boolean {
    if (!this.entry) return false;
    if (this.entry.runId !== runId || this.entry.projectId !== projectId) return false;
    return Date.now() - this.entry.timestamp < BOOTSTRAP_CACHE_TTL_MS;
  }

  get(runId: string | null, projectId: string | null): Record<string, unknown> | null {
    return this.isValid(runId, projectId) ? this.entry!.data : null;
  }

  set(data: Record<string, unknown>, runId: string | null, projectId: string | null): void {
    this.entry = { data, timestamp: Date.now(), runId, projectId };
  }

  getInflight(): Promise<Record<string, unknown>> | null {
    return this.inflightPromise;
  }

  setInflight(promise: Promise<Record<string, unknown>>): void {
    this.inflightPromise = promise;
  }

  clearInflight(): void {
    this.inflightPromise = null;
  }

  invalidate(): void {
    this.entry = null;
    this.inflightPromise = null;
  }
}
