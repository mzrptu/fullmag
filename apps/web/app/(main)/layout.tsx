import type { ReactNode } from 'react';

/**
 * Main layout — all pages in this group redirect to /analyze.
 * No shell wrapper needed; pass children through so the redirect
 * fires immediately without flashing the AppLayout sidebar.
 */
export default function MainLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
