/**
 * Migration hooks for transitioning from useControlRoom() to Zustand stores.
 *
 * Components importing from this module get the same data as useControlRoom()
 * but via Zustand selectors — which means they only re-render when their
 * specific slice changes, not when ANY of the 4 contexts update.
 *
 * Migration recipe for a component:
 *   1. Replace `import { useControlRoom } from "..."` with
 *      `import { useFemRenderState, useConnectionState, ... } from "@/features/hooks"`
 *   2. Destructure only what the component needs.
 *   3. Remove the `const ctx = useControlRoom()` call.
 *
 * These hooks are intentionally thin — one selector call each.
 * They exist to make the migration mechanical and reviewable.
 */

import { useSessionRuntimeStore, selectConnection, selectWorkspaceStatus, selectIsFemBackend } from "./session-runtime";
import { useViewportStore, selectFemRenderSettings, selectViewMode, selectViewportScope, selectInteraction } from "./viewport-core";
import { useAuthoringStore } from "./study-authoring";
import type { SceneDocument } from "../lib/session/types";

/* ── Session state ── */

export function useConnectionState() {
  return useSessionRuntimeStore(selectConnection);
}

export function useWorkspaceStatusState() {
  return useSessionRuntimeStore(selectWorkspaceStatus);
}

export function useIsFemBackend() {
  return useSessionRuntimeStore(selectIsFemBackend);
}

/* ── Viewport state ── */

export function useFemRenderState() {
  return useViewportStore(selectFemRenderSettings);
}

export function useCurrentViewMode() {
  return useViewportStore(selectViewMode);
}

export function useViewportScopeState() {
  return useViewportStore(selectViewportScope);
}

export function useInteractionState() {
  return useViewportStore(selectInteraction);
}

/* ── Authoring state ── */

export function useSceneDocument(): SceneDocument | null {
  return useAuthoringStore((s) => s.sceneDraft);
}

export function useDraftSyncStatus() {
  return useAuthoringStore((s) => s.syncStatus);
}
