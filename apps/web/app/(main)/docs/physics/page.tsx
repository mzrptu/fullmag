'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PhysicsDocsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/analyze'); }, [router]);
  return null;
}
