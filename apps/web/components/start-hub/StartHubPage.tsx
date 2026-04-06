"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import StartHubShell from "./StartHubShell";
import RecentSimulationsSection from "./RecentSimulationsSection";
import OpenActionsSection from "./OpenActionsSection";
import CreateSimulationWizard from "./CreateSimulationWizard";
import ExamplesSection from "./ExamplesSection";
import {
  readRecentSimulations,
  type RecentSimulationEntry,
  upsertRecentSimulation,
} from "@/lib/workspace/recent-simulations";
import {
  targetPathForLaunchIntent,
  type LaunchIntent,
} from "@/lib/workspace/launch-intent";
import { detectLiveSessionIntent, type DetectedLiveSession } from "@/lib/workspace/launch-intent-live";
import { pickTextFile, stageLaunchTextFile } from "@/lib/workspace/file-access";

function toIntentFromRecent(entry: RecentSimulationEntry): LaunchIntent {
  return {
    source: "recent",
    entryPath: entry.path,
    entryKind: entry.kind,
    targetStage: entry.lastStage ?? "build",
    resumeProjectId: entry.id,
    displayName: entry.name,
    launchAssetId: null,
    metadata: { backend: entry.backend },
  };
}

export default function StartHubPage() {
  const router = useRouter();
  const [recents, setRecents] = useState<RecentSimulationEntry[]>([]);
  const [liveSession, setLiveSession] = useState<DetectedLiveSession | null>(null);

  useEffect(() => {
    setRecents(readRecentSimulations());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const detected = await detectLiveSessionIntent();
      if (cancelled) return;
      setLiveSession(detected);
      if (!detected) return;
      const recentEntry: RecentSimulationEntry = {
        id: detected.intent.resumeProjectId ?? detected.scriptPath ?? "live_current",
        name: detected.name,
        path: detected.scriptPath ?? "<live_session>",
        kind: detected.intent.entryKind,
        backend: detected.backend,
        updatedAtUnixMs: Date.now(),
        lastStage: detected.intent.targetStage,
      };
      setRecents(upsertRecentSimulation(recentEntry));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const canResumeCurrentSession = useMemo(() => Boolean(liveSession), [liveSession]);

  const openIntent = (intent: LaunchIntent) => {
    const target = targetPathForLaunchIntent(intent);
    const params = new URLSearchParams();
    if (intent.source) params.set("source", intent.source);
    if (intent.entryPath) params.set("path", intent.entryPath);
    if (intent.entryKind) params.set("kind", intent.entryKind);
    if (intent.targetStage) params.set("stage", intent.targetStage);
    if (intent.resumeProjectId) params.set("projectId", intent.resumeProjectId);
    if (intent.displayName) params.set("name", intent.displayName);
    if (intent.launchAssetId) params.set("asset", intent.launchAssetId);
    router.push(`${target}?${params.toString()}` as any);
  };

  const handleOpenRecent = (entry: RecentSimulationEntry) => {
    openIntent(toIntentFromRecent(entry));
  };

  const handleOpenSimulation = async () => {
    const file = await pickTextFile();
    if (!file) return;
    const launchAssetId = stageLaunchTextFile(file);
    const intent: LaunchIntent = {
      source: "file_handle",
      entryPath: file.name,
      entryKind: "project",
      targetStage: "build",
      resumeProjectId: null,
      displayName: file.name,
      launchAssetId,
      metadata: { fileName: file.name, size: file.text.length },
    };
    setRecents(upsertRecentSimulation({
      id: `file:${file.name}`,
      name: file.name,
      path: file.name,
      kind: intent.entryKind,
      backend: null,
      updatedAtUnixMs: Date.now(),
      lastStage: intent.targetStage,
    }));
    openIntent(intent);
  };

  const handleOpenScript = async () => {
    const file = await pickTextFile();
    if (!file) return;
    const launchAssetId = stageLaunchTextFile(file);
    const intent: LaunchIntent = {
      source: "file_handle",
      entryPath: file.name,
      entryKind: "script",
      targetStage: "build",
      resumeProjectId: null,
      displayName: file.name,
      launchAssetId,
      metadata: { fileName: file.name, size: file.text.length },
    };
    setRecents(upsertRecentSimulation({
      id: `script:${file.name}`,
      name: file.name,
      path: file.name,
      kind: intent.entryKind,
      backend: null,
      updatedAtUnixMs: Date.now(),
      lastStage: intent.targetStage,
    }));
    openIntent(intent);
  };

  const handleOpenExample = (exampleId = "nanoflower_fem") => {
    const intent: LaunchIntent = {
      source: "example",
      entryPath: exampleId,
      entryKind: "example",
      targetStage: "build",
      resumeProjectId: exampleId,
      displayName: exampleId,
      launchAssetId: null,
      metadata: { exampleId },
    };
    setRecents(upsertRecentSimulation({
      id: `example:${exampleId}`,
      name: exampleId,
      path: exampleId,
      kind: intent.entryKind,
      backend: null,
      updatedAtUnixMs: Date.now(),
      lastStage: intent.targetStage,
    }));
    openIntent(intent);
  };

  const handleResumeCurrentSession = () => {
    if (!liveSession) return;
    openIntent(liveSession.intent);
  };

  const handleCreate = (payload: {
    name: string;
    location: string;
    backend: string;
    stage: "build" | "study" | "analyze";
  }) => {
    const entry: RecentSimulationEntry = {
      id: `${payload.name}:${payload.location}`,
      name: payload.name,
      path: `${payload.location}/${payload.name}.py`,
      kind: "project",
      backend: payload.backend,
      updatedAtUnixMs: Date.now(),
      lastStage: payload.stage,
    };
    upsertRecentSimulation(entry);
    openIntent(toIntentFromRecent(entry));
  };

  return (
    <StartHubShell>
      <RecentSimulationsSection entries={recents} onOpenRecent={handleOpenRecent} />
      <OpenActionsSection
        canResumeCurrentSession={canResumeCurrentSession}
        onResumeCurrentSession={handleResumeCurrentSession}
        onOpenSimulation={handleOpenSimulation}
        onOpenScript={handleOpenScript}
        onOpenExample={() => handleOpenExample("nanoflower_fem")}
      />
      <CreateSimulationWizard onCreate={handleCreate} />
      <ExamplesSection onOpenExample={handleOpenExample} />
    </StartHubShell>
  );
}
