/**
 * useBuilderAutoSync
 *
 * Kept as a lightweight lifecycle helper for hydration/sync metadata.
 * The hidden auto-push effect was intentionally removed:
 * scene draft synchronization is now explicit (manual/script sync actions only).
 */
import { useEffect, useRef, useState } from "react";

export function useBuilderAutoSync() {
  const builderHydratedSessionRef = useRef<string | null>(null);
  const builderPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const builderAutoPushGateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const builderAutoPushGateUntilRef = useRef(0);
  const lastBuilderPushSignatureRef = useRef<string | null>(null);
  const [builderAutoPushGateVersion, setBuilderAutoPushGateVersion] = useState(0);

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => {
      if (builderPushTimerRef.current) {
        clearTimeout(builderPushTimerRef.current);
      }
      if (builderAutoPushGateTimerRef.current) {
        clearTimeout(builderAutoPushGateTimerRef.current);
      }
    };
  }, []);

  return {
    /** Check if a given session key has already been hydrated. */
    isHydrated(key: string) {
      return builderHydratedSessionRef.current === key;
    },
    /** Mark a session as hydrated — auto-push will not fire before this. */
    markHydrated(key: string) {
      builderHydratedSessionRef.current = key;
    },
    /** Gate auto-push for `ms` to avoid pushing during initial hydration. */
    gateAutoSync(ms: number) {
      builderAutoPushGateUntilRef.current = Date.now() + ms;
    },
    /** Full reset — call when workspaceHydrationKey changes. */
    resetAutoSync() {
      builderHydratedSessionRef.current = null;
      lastBuilderPushSignatureRef.current = null;
      if (builderPushTimerRef.current) {
        clearTimeout(builderPushTimerRef.current);
        builderPushTimerRef.current = null;
      }
      if (builderAutoPushGateTimerRef.current) {
        clearTimeout(builderAutoPushGateTimerRef.current);
        builderAutoPushGateTimerRef.current = null;
      }
      builderAutoPushGateUntilRef.current = 0;
    },
    /** Cancel the current in-flight debounce timer (used before explicit sync). */
    cancelPendingPush() {
      if (builderPushTimerRef.current) {
        clearTimeout(builderPushTimerRef.current);
        builderPushTimerRef.current = null;
      }
    },
    /** After a successful explicit push, record the signature to avoid re-push. */
    recordPushSignature(signature: string | null) {
      lastBuilderPushSignatureRef.current = signature;
    },
    /** Bump gate version to unblock a gated push after manual write. */
    bumpGateVersion() {
      setBuilderAutoPushGateVersion((v) => v + 1);
    },
    builderAutoPushGateVersion,
  };
}
