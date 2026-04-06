'use client';
import { Suspense } from 'react';
import WorkspaceEntryPage from '@/components/workspace/shell/WorkspaceEntryPage';

export default function AnalyzePage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceEntryPage stage="analyze" />
    </Suspense>
  );
}
