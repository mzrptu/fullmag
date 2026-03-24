export default function VisualizationsPage() {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Visualizations</h1>
        <p className="page-subtitle">Compare FDM and FEM results side-by-side</p>
      </div>

      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: 'var(--sp-12)' }}>
          <p style={{ color: 'var(--text-muted)' }}>
            Visualization comparison tools will be available after FEM execution support.
          </p>
        </div>
      </div>
    </>
  );
}
