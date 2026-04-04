// File: fullmag_frontend_useAnalyzeRuntimeDiagnostics.ts
// Placement target:
//   apps/web/components/runs/control-room/useAnalyzeRuntimeDiagnostics.ts
//
// Goal:
//   Turn existing ControlRoom runtime/model state into a compact diagnostics model
//   for Analyze. This is intentionally solver-aware: it should surface
//   backend/runtime contract, warnings and mesh semantics.

"use client";

import { useMemo } from "react";

export type AnalyzeRuntimeBadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface AnalyzeRuntimeBadge {
  id: string;
  label: string;
  tone: AnalyzeRuntimeBadgeTone;
  tooltip?: string;
}

export interface AnalyzeMeshSemanticsSummary {
  magneticPartCount: number;
  hasAir: boolean;
  interfacePartCount: number;
  contractLabel: string;
}

export interface AnalyzeRuntimeDiagnosticsState {
  badges: AnalyzeRuntimeBadge[];
  warnings: string[];
  backendError: string | null;
  meshSemantics: AnalyzeMeshSemanticsSummary;
  logExcerpt: string[];
}

export interface AnalyzeRuntimeDiagnosticsInput {
  runtimeEngineLabel: string | null;
  latestBackendError: { message?: string | null } | null;
  engineLog: { level?: string | null; message?: string | null }[];
  magneticParts: unknown[];
  airPart: unknown | null;
  interfaceParts: unknown[];
  metadata: Record<string, unknown> | null;
}

function toneFromLevel(level: string | null | undefined): AnalyzeRuntimeBadgeTone {
  if (level === "error") return "danger";
  if (level === "warn" || level === "warning") return "warning";
  if (level === "success") return "success";
  if (level === "info" || level === "system") return "info";
  return "neutral";
}

export function useAnalyzeRuntimeDiagnostics(
  input: AnalyzeRuntimeDiagnosticsInput,
): AnalyzeRuntimeDiagnosticsState {
  return useMemo(() => {
    const badges: AnalyzeRuntimeBadge[] = [];
    const warnings: string[] = [];

    if (input.runtimeEngineLabel) {
      badges.push({
        id: "engine",
        label: input.runtimeEngineLabel,
        tone: /gpu/i.test(input.runtimeEngineLabel) ? "success" : "info",
        tooltip: "Execution engine for the active workspace",
      });
    }

    // Solver-contract badges derived from current backend notes.
    // These can later be promoted to strict metadata keys once backend exposes them.
    badges.push({
      id: "markers",
      label: "magnetic markers normalized",
      tone: "info",
      tooltip: "Treat mesh roles from the payload as authoritative: magnetic / air / interface.",
    });

    if (input.metadata?.["thermal_active"] === true) {
      badges.push({
        id: "thermal",
        label: "thermal active",
        tone: "warning",
        tooltip: "Thermal forcing is active in this run.",
      });
    }

    if (input.metadata?.["oersted_axis_restricted"] === true) {
      badges.push({
        id: "oersted-axis",
        label: "Oersted axis restricted",
        tone: "warning",
        tooltip: "Current implementation validates and restricts unsupported Oersted axis cases.",
      });
    }

    if (input.metadata?.["cpu_reference_guarded"] === true) {
      badges.push({
        id: "cpu-guard",
        label: "cpu reference guarded",
        tone: "warning",
        tooltip: "Unsupported physics should fail explicitly instead of being ignored silently.",
      });
    }

    // Heuristic warning extraction from engine log.
    const logWarnings = input.engineLog
      .filter((entry) => {
        const lvl = entry.level?.toLowerCase?.() ?? "";
        return lvl === "warn" || lvl === "warning" || lvl === "error";
      })
      .map((entry) => entry.message ?? "")
      .filter((message) => message.trim().length > 0);

    warnings.push(...logWarnings.slice(-6));

    const backendError =
      input.latestBackendError?.message?.trim?.() || null;

    const meshSemantics: AnalyzeMeshSemanticsSummary = {
      magneticPartCount: input.magneticParts.length,
      hasAir: Boolean(input.airPart),
      interfacePartCount: input.interfaceParts.length,
      contractLabel:
        "Analyze should trust solver-normalized mesh roles instead of inferring semantics from raw markers.",
    };

    const logExcerpt = input.engineLog
      .map((entry) => entry.message ?? "")
      .filter((message) => message.trim().length > 0)
      .slice(-8);

    return {
      badges,
      warnings,
      backendError,
      meshSemantics,
      logExcerpt,
    };
  }, [
    input.airPart,
    input.engineLog,
    input.interfaceParts,
    input.latestBackendError,
    input.magneticParts,
    input.metadata,
    input.runtimeEngineLabel,
  ]);
}
