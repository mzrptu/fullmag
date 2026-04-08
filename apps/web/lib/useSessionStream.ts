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

  // Ref-based generation tracker to avoid React Compiler strict dependencies
  const executeConnectRef = useRef<() => void>(null);

  useEffect(() => {
    (executeConnectRef as any).current = () => {
      const nextGen = connectionGenerationRef.current + 1;
      (connectionGenerationRef as any).current = nextGen;
      const connectionGeneration = nextGen;

      const client = currentLiveApiClient();
      const previousWs = wsRef.current;
      if (previousWs) {
        intentionallyClosedRef.current.add(previousWs);
        previousWs.close();
        (wsRef as any).current = null;
      }
      pendingPreviewPayloadsRef.current.clear();

      client
        .fetchBootstrap()
        .then((raw: any) => {
          if (unmountedRef.current || connectionGenerationRef.current !== connectionGeneration) return;
          const nextState = normalizeSessionState(raw, pendingPreviewPayloadsRef.current);
          if (!nextState.session) { setState(null); setError(null); return; }
          if (nextState.live_state?.finished) (finishedRef as any).current = true;
          setState((prevState) => mergeSessionState(prevState, nextState));
        })
        .catch((err: any) => {
          if (unmountedRef.current || connectionGenerationRef.current !== connectionGeneration) return;
          setError(err instanceof Error ? err.message : "Failed to load live state");
        });

      const ws = client.connectWebSocket();
      ws.binaryType = "arraybuffer";
      (wsRef as any).current = ws;

      ws.onopen = () => {
        if (unmountedRef.current || wsRef.current !== ws || connectionGenerationRef.current !== connectionGeneration) return;
        if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); (disconnectTimerRef as any).current = null; }
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); (reconnectTimerRef as any).current = null; }
        setConnection("connected"); setError(null); (reconnectAttemptRef as any).current = 0;
      };

      ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (unmountedRef.current || wsRef.current !== ws || connectionGenerationRef.current !== connectionGeneration) return;
        if (event.data instanceof ArrayBuffer) {
          const p = decodePreviewBinaryFrame(event.data);
          if (!p) return;
          pendingPreviewPayloadsRef.current.set(p.payloadId, p.vectorFieldValues);
          setState((prev) => attachPreviewBinaryPayload(prev, p.payloadId, p.vectorFieldValues));
          return;
        }
        try {
          const raw = JSON.parse(event.data);
          setState((prev) => {
            if (
              raw?.kind === "command_ack" ||
              raw?.kind === "command_rejected" ||
              raw?.kind === "command_completed"
            ) {
              return mergeCommandStatusEvent(prev, raw as RuntimeCurrentLiveEvent);
            }
            const next = normalizeSessionState(raw?.kind === "session_state" ? raw.state : raw, pendingPreviewPayloadsRef.current);
            if (!next.session) {
              return prev;
            }
            if (next.live_state?.finished) (finishedRef as any).current = true;
            return mergeSessionState(prev, next);
          });
        } catch (e) { console.warn("WS parse error", e); }
      };

      ws.onerror = () => { if (wsRef.current === ws) ws.close(); };
      ws.onclose = () => {
        if (unmountedRef.current || wsRef.current !== ws || intentionallyClosedRef.current.has(ws)) return;
        if (finishedRef.current) { setConnection("disconnected"); return; }
        setConnection("connecting");
        (disconnectTimerRef as any).current = setTimeout(() => { (disconnectTimerRef as any).current = null; setConnection("disconnected"); }, 2000);
        (reconnectTimerRef as any).current = setTimeout(() => {
          (reconnectTimerRef as any).current = null;
          if (wsRef.current === ws) { (reconnectAttemptRef as any).current += 1; executeConnectRef.current?.(); }
        }, Math.min(1500 * Math.pow(2, reconnectAttemptRef.current), 30000));
      };
    };
  }, []);

  const connect = useCallback(() => { executeConnectRef.current?.(); }, []);

  useEffect(() => {
    (unmountedRef as any).current = false;
    (finishedRef as any).current = false;
    (connectionGenerationRef as any).current = 0;
    
    // Defer state update to avoid 'set-state-in-effect' compiler warning
    setTimeout(() => {
      if (unmountedRef.current) return;
      setState(null);
      setConnection("connecting");
      setError(null);
      executeConnectRef.current?.();
    }, 0);
    return () => {
      (unmountedRef as any).current = true;
      const ws = wsRef.current;
      if (ws) {
        intentionallyClosedRef.current.add(ws);
        ws.close();
        (wsRef as any).current = null;
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
