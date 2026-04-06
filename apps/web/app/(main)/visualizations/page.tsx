'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /visualizations is superseded by the Start Hub + workspace stage flow.
 * This client redirect keeps old bookmarks working.
 */
export default function VisualizationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return null;
}
