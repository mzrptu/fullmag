/**
 * useBuilderAutoSync – extracted from ControlRoomContext.tsx
 *
 * Monitors local scene-draft signature vs remote, debounces 250 ms,
 * and pushes dirty drafts to the backend via liveApi.updateSceneDocument().
 *
 * Extracted as part of the master-plan Faza 4 (authoring).
 */
import { useEffect, useRef, useState } from "react";
import { ApiHttpError } from "../../../../lib/liveApiClient";
import { recordFrontendDebugEvent } from "../../../../lib/workspace/navigation-debug";
import { FRONTEND_DIAGNOSTIC_FLAGS } from "../../../../lib/debug/frontendDiagnosticFlags";

interface BuilderAutoSyncDeps {
  liveApi: { updateSceneDocument: (payload: unknown) => Promise<unknown> };
  localBuilderDraft: unknown;
  localBuilderSignature: string | null;
  remoteBuilderSignature: string | null;
  scriptBuilder: unknown;
  workspaceStatus: string;
  workspaceHydrationKey: string | null;
}

/**
 * Manages the auto-push lifecycle for the local scene draft.
 *
 * Returns:
 *  - `resetAutoSync()` – call when the session changes to clear refs & timers.
 *  - `gateAutoSync(ms)` – delay auto-push for `ms` after hydration.
 *  - `markHydrated(key)` – note the session as hydrated.
 *  - `builderAutoPushGateVersion` – bump value to unblock gated pushes.
 */
export function useBuilderAutoSync({
  liveApi,
  localBuilderDraft,
  localBuilderSignature,
  remoteBuilderSignature,
  scriptBuilder,
  workspaceStatus,
  workspaceHydrationKey,
}: BuilderAutoSyncDeps) {
  const builderHydratedSessionRef = useRef<string | null>(null);
  const builderPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const builderAutoPushGateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const builderAutoPushGateUntilRef = useRef(0);
  const lastBuilderPushSignatureRef = useRef<string | null>(null);
  const nonRetryableBuilderPushSignatureRef = useRef<string | null>(null);
  const [builderAutoPushGateVersion, setBuilderAutoPushGateVersion] = useState(0);

  /* ── Core auto-push effect ── */
  useEffect(() => {
    if (!FRONTEND_DIAGNOSTIC_FLAGS.session.enableSceneDraftAutoPush) {
      recordFrontendDebugEvent("scene-sync", "auto_push_disabled_by_diagnostic_flag", {
        workspaceStatus,
      });
      return;
    }
    if (!workspaceHydrationKey || !scriptBuilder) {
      return;
    }
    if (builderHydratedSessionRef.current !== workspaceHydrationKey) {
      return;
    }
    if (remoteBuilderSignature === localBuilderSignature) {
      lastBuilderPushSignatureRef.current = localBuilderSignature;
      return;
    }
    if (lastBuilderPushSignatureRef.current === localBuilderSignature) {
      return;
    }
    if (nonRetryableBuilderPushSignatureRef.current === localBuilderSignature) {
      return;
    }
    const startupGateActive =
      Date.now() < builderAutoPushGateUntilRef.current ||
      workspaceStatus === "bootstrapping" ||
      workspaceStatus === "materializing_script";
    if (startupGateActive) {
      recordFrontendDebugEvent("scene-sync", "auto_push_deferred_during_startup", {
        workspaceStatus,
        gateUntil: builderAutoPushGateUntilRef.current,
      });
      return;
    }
    if (builderPushTimerRef.current) {
      clearTimeout(builderPushTimerRef.current);
    }
    builderPushTimerRef.current = setTimeout(() => {
      recordFrontendDebugEvent("scene-sync", "auto_push_start", {
        workspaceStatus,
      });
      void liveApi
        .updateSceneDocument(localBuilderDraft)
        .then(() => {
          recordFrontendDebugEvent("scene-sync", "auto_push_success", {
            workspaceStatus,
          });
          lastBuilderPushSignatureRef.current = localBuilderSignature;
        })
        .catch((builderError) => {
          console.warn("Failed to persist scene document draft", builderError);
          const nonRetryable =
            builderError instanceof ApiHttpError &&
            builderError.status >= 400 &&
            builderError.status < 500;
          recordFrontendDebugEvent("scene-sync", "auto_push_failed", {
            workspaceStatus,
            message: builderError instanceof Error ? builderError.message : String(builderError),
            nonRetryable,
          });
          if (nonRetryable) {
            nonRetryableBuilderPushSignatureRef.current = localBuilderSignature;
            lastBuilderPushSignatureRef.current = localBuilderSignature;
            return;
          }
          lastBuilderPushSignatureRef.current = null;
        });
    }, 250);
    return () => {
      if (builderPushTimerRef.current) {
        clearTimeout(builderPushTimerRef.current);
        builderPushTimerRef.current = null;
      }
    };
  }, [
    liveApi,
    localBuilderDraft,
    localBuilderSignature,
    remoteBuilderSignature,
    scriptBuilder,
    workspaceStatus,
    workspaceHydrationKey,
    builderAutoPushGateVersion,
  ]);

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
      nonRetryableBuilderPushSignatureRef.current = null;
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
