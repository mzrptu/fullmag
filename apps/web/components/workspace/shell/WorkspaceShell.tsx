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
 * The tab bar floats above the content using absolute positioning so that
 * full-viewport children (like the RunControlRoom) can extend to the full
 * viewport height without layout shifts.  The `pt-[36px]` on the inner
 * wrapper pushes content below the bar.
 */
export function WorkspaceShell({ children }: WorkspaceShellProps) {
  const pathname = usePathname();

  return (
    <div className="relative h-screen overflow-hidden">
      {/* Content area — padding-top clears the overlay tab bar */}
      <div
        className="h-full"
        style={{ paddingTop: TAB_BAR_H }}
      >
        {children}
      </div>

      {/* Tab bar — absolute overlay so full-height children don't need layout changes */}
      <nav
        className="absolute inset-x-0 top-0 z-50 flex items-center gap-0.5 border-b border-[var(--ide-border-subtle)] bg-[var(--surface-1)]/95 backdrop-blur-sm px-3"
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
    </div>
  );
}
