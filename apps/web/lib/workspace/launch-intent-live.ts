"use client";

import type { LaunchEntryKind, LaunchIntent, WorkspaceStage } from "./launch-intent";
import { resolveApiBase } from "@/lib/apiBase";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function inferEntryKind(path: string | null): LaunchEntryKind {
  if (!path) return "project";
  return path.toLowerCase().endsWith(".py") ? "script" : "project";
}

function inferStage(status: string | null): WorkspaceStage {
  if (status === "running" || status === "awaiting_command" || status === "materializing_script" || status === "bootstrapping") {
    return "study";
  }
  return "build";
}

export interface DetectedLiveSession {
  intent: LaunchIntent;
  name: string;
  backend: string | null;
  scriptPath: string | null;
  status: string | null;
}

export async function detectLiveSessionIntent(): Promise<DetectedLiveSession | null> {
  const baseUrl = resolveApiBase();
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/v1/live/current/bootstrap`, { cache: "no-store" });
  } catch {
    return null;
  }

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const session = asRecord(root.session);
  if (!session) {
    return null;
  }

  const runId = asString(session.run_id) ?? asString(session.session_id);
  const scriptPath = asString(session.script_path);
  const problemName = asString(session.problem_name) ?? "Live Simulation";
  const backend = asString(session.requested_backend);
  const status = asString(session.status);
  const entryKind = inferEntryKind(scriptPath);
  const targetStage = inferStage(status);

  return {
    intent: {
      source: "electron_cli",
      entryPath: scriptPath,
      entryKind,
      targetStage,
      resumeProjectId: runId,
      displayName: problemName,
      launchAssetId: null,
      metadata: {
        detectedBy: "live_bootstrap",
        backend,
        problemName,
        status,
      },
    },
    name: problemName,
    backend,
    scriptPath,
    status,
  };
}
