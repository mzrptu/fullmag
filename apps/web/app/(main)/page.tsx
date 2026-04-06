'use client';
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StartHubPage from "@/components/start-hub/StartHubPage";
import {
  resolveLaunchIntentFromSearchParams,
  targetPathForLaunchIntent,
} from "@/lib/workspace/launch-intent";
import { detectLiveSessionIntent } from "@/lib/workspace/launch-intent-live";

function RootPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const intent = resolveLaunchIntentFromSearchParams(searchParams);
  const [checkedLiveSession, setCheckedLiveSession] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (intent.source !== "none") {
        const target = targetPathForLaunchIntent(intent);
        const params = new URLSearchParams(searchParams.toString());
        router.replace(`${target}?${params.toString()}` as any);
        return;
      }

      const detected = await detectLiveSessionIntent();
      if (cancelled) return;

      if (detected) {
        const target = targetPathForLaunchIntent(detected.intent);
        const params = new URLSearchParams();
        params.set("source", detected.intent.source);
        if (detected.intent.entryPath) params.set("path", detected.intent.entryPath);
        if (detected.intent.entryKind) params.set("kind", detected.intent.entryKind);
        if (detected.intent.targetStage) params.set("stage", detected.intent.targetStage);
        if (detected.intent.resumeProjectId) params.set("projectId", detected.intent.resumeProjectId);
        router.replace(`${target}?${params.toString()}` as any);
        return;
      }

      setCheckedLiveSession(true);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [intent, router, searchParams]);

  if (intent.source === "none" && checkedLiveSession) {
    return <StartHubPage />;
  }
  return <div className="min-h-screen bg-background" />;
}

export default function RootPage() {
  return (
    <Suspense fallback={null}>
      <RootPageInner />
    </Suspense>
  );
}
