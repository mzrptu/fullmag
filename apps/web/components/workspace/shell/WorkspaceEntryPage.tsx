'use client';

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import WorkspaceShell from "./WorkspaceShell";
import type { WorkspaceMode } from "@/components/runs/control-room/context-hooks";
import { resolveLaunchIntentFromSearchParams } from "@/lib/workspace/launch-intent";
import { useWorkspaceStore } from "@/lib/workspace/workspace-store";
import { readStagedLaunchAsset } from "@/lib/workspace/file-access";

interface WorkspaceEntryPageProps {
  stage: WorkspaceMode;
}

export default function WorkspaceEntryPage({ stage }: WorkspaceEntryPageProps) {
  const searchParams = useSearchParams();
  const setLaunchIntent = useWorkspaceStore((state) => state.setLaunchIntent);
  const setActiveProjectId = useWorkspaceStore((state) => state.setActiveProjectId);
  const setCurrentStage = useWorkspaceStore((state) => state.setCurrentStage);
  const setLauncherVisible = useWorkspaceStore((state) => state.setLauncherVisible);

  useEffect(() => {
    const intent = resolveLaunchIntentFromSearchParams(searchParams);
    const stagedAsset = readStagedLaunchAsset(intent.launchAssetId);
    const enrichedIntent = stagedAsset
      ? {
          ...intent,
          metadata: {
            ...(intent.metadata ?? {}),
            stagedAssetName: stagedAsset.name,
            stagedAssetSize: stagedAsset.text.length,
          },
        }
      : intent;
    setLaunchIntent(enrichedIntent);
    setActiveProjectId(enrichedIntent.resumeProjectId ?? enrichedIntent.entryPath ?? null);
    setCurrentStage(stage);
    setLauncherVisible(false);
  }, [searchParams, setActiveProjectId, setCurrentStage, setLaunchIntent, setLauncherVisible, stage]);

  return <WorkspaceShell initialStage={stage} />;
}
