'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Root redirect — the real workspace lives at /analyze.
 * Using a client-side redirect because output: "export" does not support
 * server-side redirects.  AppLayout wraps this page briefly before
 * navigation fires, which is fine.
 */
export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/analyze');
  }, [router]);
  return null;
}
