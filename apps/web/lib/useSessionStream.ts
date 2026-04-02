"use client";

/* ── useSessionStream ──
 * Re-exports all types from session/ submodules for backward compatibility,
 * and provides the useCurrentLiveStream React hook. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiHttpError, currentLiveApiClient } from "./liveApiClient";

/* ── Re-export all types ── */
export type {
  SessionManifest,
  RunManifest,
  LiveState,
  FemLiveMesh,
  FemMeshPart,
  ScalarRow,
  EngineLogEntry,
  QuantityDescriptor,
  ArtifactEntry,
  LatestFields,
  SpatialPreviewState,
  GlobalScalarPreviewState,
  PreviewState,
  PreviewConfig,
  DisplayKind,
  DisplaySelection,
  CurrentDisplaySelection,
  MeshCommandTarget,
  RuntimeStatusKind,
  RuntimeStatusState,
  CommandStatus,
  SceneDocument,
  ScriptBuilderSolverState,
  ScriptBuilderMeshState,
  ScriptBuilderUniverseState,
  ScriptBuilderStageState,
  ScriptBuilderInitialState,
  ScriptBuilderState,
  MeshSummaryState,
  MeshQualitySummaryState,
  MeshPipelinePhaseState,
  MeshCapabilitiesState,
  MeshAdaptivityState,
  MeshHistoryEntryState,
  MeshWorkspaceState,
  SessionState,
  ConnectionStatus,
  UseSessionStreamResult,
} from "./session/types";

import type {
  SessionState,
  SessionStateCurrentLiveEvent,
  RuntimeCurrentLiveEvent,
  ConnectionStatus,
  UseSessionStreamResult,
} from "./session/types";

/* ── Import submodules ── */
import { normalizeSessionState } from "./session/normalize";
import { mergeSessionState, mergeCommandStatusEvent } from "./session/merge";
import { decodePreviewBinaryFrame, attachPreviewBinaryPayload } from "./session/binary-preview";

/* ── Hook ── */

export function useCurrentLiveStream(): UseSessionStreamResult {
  const [state, setState] = useState<SessionState | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const finishedRef = useRef(false);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const unmountedRef = useRef(false);
  const intentionallyClosedRef = useRef(new WeakSet<WebSocket>());
  const pendingPreviewPayloadsRef = useRef(new Map<number, Float64Array>());
  const connectionGenerationRef = useRef(0);

  const connect = useCallback(() => {
    const connectionGeneration = connectionGenerationRef.current + 1;
    connectionGenerationRef.current = connectionGeneration;
    const client = currentLiveApiClient();
    const previousWs = wsRef.current;
    if (previousWs) {
      intentionallyClosedRef.current.add(previousWs);
      previousWs.close();
      wsRef.current = null;
    }
    pendingPreviewPayloadsRef.current.clear();

    client
      .fetchBootstrap()
      .then((raw) => {
        if (
          unmountedRef.current ||
          connectionGenerationRef.current !== connectionGeneration
        ) {
          return;
        }
        const nextState = normalizeSessionState(raw, pendingPreviewPayloadsRef.current);
        if (nextState.live_state?.finished) {
          finishedRef.current = true;
        }
        setState((prevState) => mergeSessionState(prevState, nextState));
      })
      .catch((bootstrapError) => {
        if (
          unmountedRef.current ||
          connectionGenerationRef.current !== connectionGeneration
        ) {
          return;
        }
        if (bootstrapError instanceof ApiHttpError && bootstrapError.status === 404) {
          setError(null);
          return;
        }
        setError(
          bootstrapError instanceof Error ? bootstrapError.message : "Failed to load live state",
        );
      });

    const ws = client.connectWebSocket();
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (
        unmountedRef.current ||
        wsRef.current !== ws ||
        connectionGenerationRef.current !== connectionGeneration
      ) {
        return;
      }
      if (disconnectTimerRef.current !== null) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setConnection("connected");
      setError(null);
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (
        unmountedRef.current ||
        wsRef.current !== ws ||
        connectionGenerationRef.current !== connectionGeneration
      ) {
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        const payload = decodePreviewBinaryFrame(event.data);
        if (!payload) {
          return;
        }
        pendingPreviewPayloadsRef.current.set(payload.payloadId, payload.vectorFieldValues);
        if (pendingPreviewPayloadsRef.current.size > 16) {
          const oldestKey = pendingPreviewPayloadsRef.current.keys().next().value;
          if (oldestKey != null) {
            pendingPreviewPayloadsRef.current.delete(oldestKey);
          }
        }
        setState((prevState) =>
          attachPreviewBinaryPayload(prevState, payload.payloadId, payload.vectorFieldValues));
        return;
      }
      try {
        const raw = JSON.parse(event.data);
        setState((prevState) => {
          if (raw?.kind === "session_state" && raw.state) {
            const nextState = normalizeSessionState(
              (raw as SessionStateCurrentLiveEvent).state,
              pendingPreviewPayloadsRef.current,
            );
            if (nextState.live_state?.finished) {
              finishedRef.current = true;
            }
            return mergeSessionState(prevState, nextState);
          }

          if (
            typeof raw?.kind === "string" &&
            typeof raw?.session_id === "string" &&
            (
              raw.kind === "command_ack" ||
              raw.kind === "command_rejected" ||
              raw.kind === "command_completed"
            )
          ) {
            return mergeCommandStatusEvent(prevState, raw as RuntimeCurrentLiveEvent);
          }

          const nextState = normalizeSessionState(raw, pendingPreviewPayloadsRef.current);
          if (nextState.live_state?.finished) {
            finishedRef.current = true;
          }
          return mergeSessionState(prevState, nextState);
        });
      } catch (parseError) {
        console.warn("Failed to parse current live ws payload", parseError);
      }
    };

    ws.onerror = () => {
      if (
        unmountedRef.current ||
        wsRef.current !== ws ||
        connectionGenerationRef.current !== connectionGeneration ||
        intentionallyClosedRef.current.has(ws)
      ) {
        return;
      }
      ws.close();
    };

    ws.onclose = () => {
      if (
        unmountedRef.current ||
        wsRef.current !== ws ||
        connectionGenerationRef.current !== connectionGeneration ||
        intentionallyClosedRef.current.has(ws)
      ) {
        return;
      }

      if (finishedRef.current) {
        setConnection("disconnected");
        return;
      }

      setConnection("connecting");
      setError(null);

      disconnectTimerRef.current = setTimeout(() => {
        disconnectTimerRef.current = null;
        setConnection("disconnected");
      }, 2000);

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (wsRef.current === ws) {
          reconnectAttemptRef.current += 1;
          setConnection("connecting");
          connect();
        }
      }, Math.min(1500 * Math.pow(2, reconnectAttemptRef.current), 30000));
    };
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    finishedRef.current = false;
    connectionGenerationRef.current = 0;
    setState(null);
    setConnection("connecting");
    setError(null);
    connect();
    return () => {
      unmountedRef.current = true;
      const ws = wsRef.current;
      if (ws) {
        intentionallyClosedRef.current.add(ws);
        ws.close();
        wsRef.current = null;
      }
      if (disconnectTimerRef.current !== null) {
        clearTimeout(disconnectTimerRef.current);
      }
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  return { state, connection, error };
}
