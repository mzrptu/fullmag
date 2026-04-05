'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const WORKSPACE_TABS = [
  { href: '/build', label: 'Build' },
  { href: '/study', label: 'Study' },
  { href: '/analyze', label: 'Analyze' },
  { href: '/runs', label: 'Runs' },
];

/** Height of the workspace tab bar in px. Keep in sync with --workspace-tab-h CSS var. */
const TAB_BAR_H = 36;

interface WorkspaceShellProps {
  children: ReactNode;
}

/**
 * WorkspaceShell — wraps all workspace pages (Build / Study / Analyze / Runs).
 *
 * Uses a flex-column layout: the tab bar takes a fixed 36 px row at the top,
 * and children get the remaining viewport height. This means children must use
 * `h-full` (not `position: fixed`) to fill the available space.
 */
export function WorkspaceShell({ children }: WorkspaceShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Tab bar — normal flow, takes TAB_BAR_H px, children start below it */}
      <nav
        className="shrink-0 z-50 flex items-center gap-0.5 border-b border-[var(--ide-border-subtle)] bg-[var(--surface-1)]/95 backdrop-blur-sm px-3"
        style={{ height: TAB_BAR_H }}
        aria-label="Workspace sections"
      >
        {WORKSPACE_TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href as Route}
              className={cn(
                'px-3 py-1 text-[13px] font-medium rounded-md transition-colors leading-none select-none',
                active
                  ? 'bg-[var(--accent-subtle,rgba(99,120,255,0.15))] text-[var(--brand-accent,#6378ff)]'
                  : 'text-[var(--text-soft)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)]',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* Content area — fills remaining height below the tab bar */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {children}
      </div>
    </div>
  );
}
