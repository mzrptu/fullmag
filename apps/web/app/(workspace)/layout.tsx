import type { ReactNode } from 'react';

/**
 * Workspace layout — full-viewport, no AppLayout shell.
 * Used for immersive pages like the simulation control room.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
