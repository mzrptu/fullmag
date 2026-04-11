/**
 * ControlRoom Decomposition: New Provider Composition
 *
 * This module provides a thin ControlRoomProvider replacement that
 * delegates state ownership to the new Zustand stores:
 *   - useSessionRuntimeStore (Layer B)
 *   - useAuthoringStore (Layer C)
 *   - useViewportStore (Layer D)
 *
 * Migration strategy:
 *   1. The legacy provider remains unchanged (no risk of breakage).
 *   2. Components that already import from the new stores get fresh data
 *      directly from Zustand — skipping the React Context hot path.
 *   3. A bridge hook `useLegacyBridge()` synchronizes the old Context
 *      values INTO the new stores so legacy consumers and new consumers
 *      stay in sync during the transition.
 *   4. Once all consumers have been migrated, the legacy provider and
 *      bridge can be deleted.
 *
 * Usage:
 *   Wrap the legacy <ControlRoomProvider> children with <StoreBridge />
 *   (it renders no DOM, just syncs state).
 */

"use client";

import { useEffect, useRef } from "react";
import { useTransport, useCommand, useModel, useViewport } from "./context-hooks";
import { useSessionRuntimeStore } from "../../../features/session-runtime";
import { useAuthoringStore } from "../../../features/study-authoring";
import { useViewportStore } from "../../../features/viewport-core";

/**
 * One-way bridge: reads from legacy React Contexts → writes into
 * new Zustand stores.  Must be rendered as a child of
 * <ControlRoomProvider>.
 *
 * The bridge runs in a useEffect so it's always one tick behind the
 * context update — this is intentional to avoid infinite loops.
 * New Zustand consumers will therefore be at most one React commit
 * behind the legacy contexts.
 */
export function StoreBridge(): null {
  const transport = useTransport();
  const command = useCommand();
  const model = useModel();
  const viewport = useViewport();

  // --- Session Runtime Store bridge ---
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const store = useSessionRuntimeStore.getState();

    // Connection status
    store.setConnection(command.connection);

    // Live state
    if (transport.liveState) {
      store.applyNormalizedState({
        workspaceStatus: command.workspaceStatus,
        isFemBackend: command.isFemBackend,
        liveState: transport.liveState,
        femMesh: model.femMesh ?? null,
        runtimeStatus: command.runtimeStatus ?? null,
        commandStatus: command.commandStatus ?? null,
        session: command.session ?? null,
        run: command.run ?? null,
        metadata: command.metadata ?? null,
        scalarRows: transport.scalarRows,
        engineLog: command.engineLog,
        quantities: command.quantities,
        artifacts: command.artifacts,
        preview: transport.preview,
        scriptBuilder: null,
        meshWorkspace: null,
      });
    }
  }, [transport.liveState, command.connection, command.workspaceStatus, command.isFemBackend, command.runtimeStatus, command.commandStatus, command.session, command.run, model.femMesh]);

  // --- Authoring Store bridge ---
  useEffect(() => {
    if (!model.sceneDocument) return;
    const authoringState = useAuthoringStore.getState();
    // Only hydrate once per session (when store is empty)
    if (!authoringState.sceneDraft) {
      authoringState.hydrateFromRemote(model.sceneDocument, null, "");
    }
  }, [model.sceneDocument]);

  // --- Viewport Store bridge ---
  useEffect(() => {
    const vs = useViewportStore.getState();
    if (viewport.viewMode !== vs.viewMode) vs.setViewMode(viewport.viewMode);
    if (viewport.component !== vs.component) vs.setComponent(viewport.component);
    if (viewport.plane !== vs.plane) vs.setPlane(viewport.plane);
    if (viewport.sliceIndex !== vs.sliceIndex) vs.setSliceIndex(viewport.sliceIndex);
    if (viewport.consoleCollapsed !== vs.consoleCollapsed) vs.setConsoleCollapsed(viewport.consoleCollapsed);
    if (viewport.sidebarCollapsed !== vs.sidebarCollapsed) vs.setSidebarCollapsed(viewport.sidebarCollapsed);
  }, [viewport.viewMode, viewport.component, viewport.plane, viewport.sliceIndex, viewport.consoleCollapsed, viewport.sidebarCollapsed]);

  useEffect(() => {
    const vs = useViewportStore.getState();
    if (model.meshRenderMode !== vs.meshRenderMode) vs.setMeshRenderMode(model.meshRenderMode);
    if (model.meshOpacity !== vs.meshOpacity) vs.setMeshOpacity(model.meshOpacity);
    if (model.meshClipEnabled !== vs.meshClipEnabled) vs.setMeshClipEnabled(model.meshClipEnabled);
    if (model.meshClipAxis !== vs.meshClipAxis) vs.setMeshClipAxis(model.meshClipAxis);
    if (model.meshClipPos !== vs.meshClipPos) vs.setMeshClipPos(model.meshClipPos);
    if (model.meshShowArrows !== vs.meshShowArrows) vs.setMeshShowArrows(model.meshShowArrows);
    if (model.femArrowColorMode !== vs.femArrowColorMode) vs.setFemArrowColorMode(model.femArrowColorMode);
    if (model.femColorField !== vs.femColorField) vs.setFemColorField(model.femColorField);
    if (model.femDockTab !== vs.femDockTab) vs.setFemDockTab(model.femDockTab);
    if (model.viewportScope !== vs.viewportScope) vs.setViewportScope(model.viewportScope);
    if (model.objectViewMode !== vs.objectViewMode) vs.setObjectViewMode(model.objectViewMode);
    if (model.selectedObjectId !== vs.selectedObjectId) vs.setSelectedObjectId(model.selectedObjectId);
    if (model.selectedEntityId !== vs.selectedEntityId) vs.setSelectedEntityId(model.selectedEntityId);
    if (model.focusedEntityId !== vs.focusedEntityId) vs.setFocusedEntityId(model.focusedEntityId);
    if (model.airMeshVisible !== vs.airMeshVisible) vs.setAirMeshVisible(model.airMeshVisible);
    if (model.airMeshOpacity !== vs.airMeshOpacity) vs.setAirMeshOpacity(model.airMeshOpacity);
  }, [
    model.meshRenderMode, model.meshOpacity, model.meshClipEnabled, model.meshClipAxis,
    model.meshClipPos, model.meshShowArrows, model.femArrowColorMode, model.femColorField,
    model.femDockTab, model.viewportScope, model.objectViewMode, model.selectedObjectId,
    model.selectedEntityId, model.focusedEntityId, model.airMeshVisible, model.airMeshOpacity,
  ]);

  return null;
}
