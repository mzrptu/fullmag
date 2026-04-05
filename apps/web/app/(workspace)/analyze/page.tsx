import dynamic from 'next/dynamic';
import EmptyState from '@/components/ui/EmptyState';

const RunControlRoom = dynamic(
  () => import('@/components/runs/RunControlRoom'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <EmptyState title="Loading workspace" description="Initialising control room…" tone="info" compact />
      </div>
    ),
  },
);

/**
 * Analyze — canonical workspace page for simulation results, live preview,
 * eigenmode spectrum, dispersion and engine diagnostics.
 *
 * RunControlRoom is loaded lazily (ssr: false) to keep the static-export shell
 * lean and avoid bundling Three.js / Plotly / ECharts in the initial chunk.
 *
 * TODO (WP-split): Once Build/Study panels are extracted from RunControlRoom,
 * this page will render only the Analyze-specific viewport and panels.
 */
export default function AnalyzePage() {
  return <RunControlRoom />;
}
