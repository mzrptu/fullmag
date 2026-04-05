'use client';

/**
 * Runs — session history, completed runs, artifact browser, compare runs.
 *
 * This section owns:
 *   • Session list
 *   • Completed run detail / reopen
 *   • Artifact browser (snapshots, eigenmode exports, etc.)
 *   • Compare runs
 *   • Export snapshot / bundle
 *
 * Current status: placeholder — the Runs browser is not yet implemented.
 * Live session control lives in Analyze.
 */
export default function RunsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-8">
      <div className="text-[40px] leading-none">📋</div>
      <h1 className="text-2xl font-semibold text-[var(--text-1)]">Runs</h1>
      <p className="max-w-sm text-[var(--text-soft)] text-sm leading-relaxed">
        Session history, completed runs and artifact browser will appear here.
        <br />
        <span className="text-[var(--text-muted)]">
          Not yet implemented. Live session control is in <strong>Analyze</strong>.
        </span>
      </p>
    </div>
  );
}
