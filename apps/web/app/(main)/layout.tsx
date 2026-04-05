import type { ReactNode } from 'react';
import { AppLayout } from '../../components/layout';

/**
 * Main layout — wraps pages that use the AppLayout shell (sidebar + topbar).
 * Docs, Settings and similar non-workspace pages live here.
 *
 * Workspace pages (Build / Study / Analyze / Runs) live under (workspace)
 * and use WorkspaceShell instead.
 */
export default function MainLayout({ children }: { children: ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
