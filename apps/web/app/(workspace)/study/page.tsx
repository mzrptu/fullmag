'use client';

/**
 * Study — define the numerical experiment: backend, precision, solver,
 * stages, antennas and output plan.
 *
 * This section owns:
 *   • StudyPanel (stage sequence, solver policy)
 *   • PhysicsPanel
 *   • AntennaPanel
 *   • SolverSettingsPanel
 *   • PrecisionBackendPanel
 *   • OutputPlanPanel
 *
 * Note: runtime throughput / telemetry belongs in Analyze, not here.
 *
 * Current status: placeholder — Study panels are being extracted from
 * RunControlRoom.  Open Analyze to access all features in the meantime.
 */
export default function StudyPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-8">
      <div className="text-[40px] leading-none">🔬</div>
      <h1 className="text-2xl font-semibold text-[var(--text-1)]">Study</h1>
      <p className="max-w-sm text-[var(--text-soft)] text-sm leading-relaxed">
        Configure solver, stages, physics and output plan here.
        <br />
        <span className="text-[var(--text-muted)]">
          Study panels are being extracted from the Analyze workspace —
          open <strong>Analyze</strong> to access all features in the meantime.
        </span>
      </p>
    </div>
  );
}
