export default function RunsPage() {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Simulation Runs</h1>
        <p className="page-subtitle">Browse and inspect completed and active runs</p>
      </div>

      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: 'var(--sp-12)' }}>
          <p style={{ color: 'var(--text-muted)' }}>
            Run a simulation to see results here.
          </p>
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              background: 'var(--bg-raised)',
              padding: 'var(--sp-2) var(--sp-4)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--accent)',
              display: 'inline-block',
              marginTop: 'var(--sp-4)',
            }}
          >
            fullmag examples/exchange_relax.py --until 2e-9
          </code>
        </div>
      </div>
    </>
  );
}
