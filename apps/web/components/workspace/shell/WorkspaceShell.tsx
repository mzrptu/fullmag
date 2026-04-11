"use client";

import { ControlRoomProvider } from "@/components/runs/control-room/ControlRoomContext";
import { ControlRoomShell } from "@/components/runs/RunControlRoom";
import type { WorkspaceMode } from "@/components/runs/control-room/context-hooks";
import StandaloneThreeDiagnosticViewport from "./StandaloneThreeDiagnosticViewport";
import StandaloneR3fDiagnosticViewport from "./StandaloneR3fDiagnosticViewport";
import StandaloneFemDiagnosticViewport from "./StandaloneFemDiagnosticViewport";
import StandaloneFemSceneDiagnosticViewport from "./StandaloneFemSceneDiagnosticViewport";
import { FRONTEND_DIAGNOSTIC_FLAGS } from "@/lib/debug/frontendDiagnosticFlags";

interface WorkspaceShellProps {
  initialStage: WorkspaceMode;
}

export default function WorkspaceShell({ initialStage }: WorkspaceShellProps) {
  const diagnosticMode = String(
    FRONTEND_DIAGNOSTIC_FLAGS.workspace.standaloneDiagnosticViewportMode,
  );
  if (diagnosticMode === "three") {
    return <StandaloneThreeDiagnosticViewport />;
  }
  if (diagnosticMode === "r3f") {
    return <StandaloneR3fDiagnosticViewport />;
  }
  if (diagnosticMode === "fem") {
    return <StandaloneFemDiagnosticViewport />;
  }
  if (diagnosticMode === "fem-scene") {
    return <StandaloneFemSceneDiagnosticViewport />;
  }
  return (
    <ControlRoomProvider>
      <ControlRoomShell initialWorkspaceMode={initialStage} />
    </ControlRoomProvider>
  );
}
