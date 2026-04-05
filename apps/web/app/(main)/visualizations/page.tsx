'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /visualizations is superseded by /analyze in the (workspace) route group.
 * This client redirect keeps old bookmarks working.
 */
export default function VisualizationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/analyze');
  }, [router]);
  return null;
}
