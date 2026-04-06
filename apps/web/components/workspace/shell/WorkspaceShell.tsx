"use client";

import { ControlRoomProvider } from "@/components/runs/control-room/ControlRoomContext";
import { ControlRoomShell } from "@/components/runs/RunControlRoom";
import type { WorkspaceMode } from "@/components/runs/control-room/context-hooks";

interface WorkspaceShellProps {
  initialStage: WorkspaceMode;
}

export default function WorkspaceShell({ initialStage }: WorkspaceShellProps) {
  return (
    <ControlRoomProvider>
      <ControlRoomShell initialWorkspaceMode={initialStage} />
    </ControlRoomProvider>
  );
}
