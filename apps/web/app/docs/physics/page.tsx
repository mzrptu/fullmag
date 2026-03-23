export default function PhysicsDocsPage() {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Physics Documentation</h1>
        <p className="page-subtitle">
          Auto-rendered reference from docs/physics notes
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Exchange-Only LLG Reference</h2>
        </div>
        <div className="card-body">
          <p style={{ color: 'var(--text-secondary)', lineHeight: 'var(--leading-relaxed)' }}>
            Physics documentation from{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--accent)' }}>
              docs/physics/
            </code>{' '}
            notes will be auto-rendered here. This ensures every physics feature documented
            through the publication-style notes is visible in the web UI.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', marginTop: 'var(--sp-6)' }}>
        <DocCard
          id="0100"
          title="Exchange Energy"
          status="published"
          description="6-neighbor finite-difference Laplacian on a uniform Cartesian grid with Neumann BC."
        />
        <DocCard
          id="0200"
          title="LLG Exchange Reference Engine"
          status="published"
          description="Landau-Lifshitz-Gilbert equation with Heun integrator for the exchange-only case."
        />
        <DocCard
          id="0300"
          title="GPU FDM Precision and Calibration"
          status="draft"
          description="CUDA FDM kernel precision strategy — single vs double, calibration against CPU reference."
        />
      </div>
    </>
  );
}

function DocCard({
  id,
  title,
  status,
  description,
}: {
  id: string;
  title: string;
  status: 'published' | 'draft';
  description: string;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
            }}
          >
            {id}
          </span>
          <h3 className="card-title">{title}</h3>
        </div>
        <span className={`badge badge-${status === 'published' ? 'success' : 'warning'}`}>
          <span className="badge-dot" />
          {status}
        </span>
      </div>
      <div className="card-body">
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>
          {description}
        </p>
      </div>
    </div>
  );
}
