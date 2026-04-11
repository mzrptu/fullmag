/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BootstrapCache,
  computeBackoffDelay,
  DEFAULT_RECONNECT_POLICY,
} from "../SessionConnectionOrchestrator";

describe("computeBackoffDelay", () => {
  it("grows exponentially and clamps to max delay", () => {
    expect(computeBackoffDelay(0)).toBe(DEFAULT_RECONNECT_POLICY.baseDelayMs);
    expect(computeBackoffDelay(1)).toBe(DEFAULT_RECONNECT_POLICY.baseDelayMs * 2);
    expect(computeBackoffDelay(20)).toBe(DEFAULT_RECONNECT_POLICY.maxDelayMs);
  });
});

describe("BootstrapCache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns cached value only while entry is valid", () => {
    const cache = new BootstrapCache();
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(10_000);
    cache.set({ ok: true }, "run-1", "project-1");

    nowSpy.mockReturnValue(12_000);
    expect(cache.get("run-1", "project-1")).toEqual({ ok: true });

    nowSpy.mockReturnValue(16_000);
    expect(cache.get("run-1", "project-1")).toBeNull();
  });

  it("invalidates cache and inflight promise", () => {
    const cache = new BootstrapCache();
    cache.set({ ok: true }, "run-1", "project-1");
    cache.setInflight(Promise.resolve({ pending: true }));
    cache.invalidate();
    expect(cache.get("run-1", "project-1")).toBeNull();
    expect(cache.getInflight()).toBeNull();
  });
});
