import type { ReactNode } from 'react';
import { WorkspaceShell } from '@/components/workspace/shell/WorkspaceShell';

/**
 * Workspace layout — full-viewport, no AppLayout shell.
 *
 * All workspace pages (Build / Study / Analyze / Runs) share this layout.
 * WorkspaceShell renders the Build|Study|Analyze|Runs tab bar as a top
 * overlay and gives children the remaining viewport height.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
