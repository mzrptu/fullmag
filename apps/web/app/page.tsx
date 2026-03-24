const workspaceTabs = [
  { id: 'overview', label: 'Overview', caption: 'Mission control' },
  { id: 'workflow', label: 'Workflow', caption: 'Python → IR → planner' },
  { id: 'execution', label: 'Execution', caption: 'Jobs & backends' },
  { id: 'artifacts', label: 'Artifacts', caption: 'Observables & provenance' },
  { id: 'governance', label: 'Governance', caption: 'Physics docs & capability' },
];

const capabilityRows = [
  {
    feature: 'Analytic geometry primitives',
    fdm: 'Planner-ready',
    fem: 'Planner-ready',
    hybrid: 'Planner-ready',
    note: 'Shared `Box` and `Cylinder` semantics remain backend-neutral.',
  },
  {
    feature: 'Imported geometry references',
    fdm: 'Planner-ready',
    fem: 'Planner-ready',
    hybrid: 'Planner-ready',
    note: 'CAD/mesh imports stay available for semantic-only workflows.',
  },
  {
    feature: 'LLG + exchange-only bootstrap',
    fdm: 'Reference path',
    fem: 'Planning path',
    hybrid: 'Planning path',
    note: 'Execution depth differs, but the physical problem contract stays shared.',
  },
  {
    feature: 'Canonical observables',
    fdm: 'Shared names',
    fem: 'Shared names',
    hybrid: 'Shared names',
    note: '`m`, `H_ex`, `E_ex`, `time`, `step`, and `solver_dt` remain stable.',
  },
];

const plannerStages = [
  {
    name: 'Author in embedded Python',
    detail:
      'Scientists describe geometry, materials, energies, dynamics, and outputs in a scripting surface that stays close to the physical problem.',
  },
  {
    name: 'Serialize canonical ProblemIR',
    detail:
      'Python object graphs normalize into a backend-neutral IR shape for reproducible validation and planning.',
  },
  {
    name: 'Validate & plan in Rust',
    detail:
      'The control plane resolves legality, execution mode, provenance, and backend planning without exposing storage layout.',
  },
  {
    name: 'Lower to backend execution',
    detail:
      'FDM, FEM, and hybrid runners receive planner-owned lowering artifacts while preserving shared semantics.',
  },
];

const jobs = [
  {
    title: 'exchange_relax / strict / fdm',
    state: 'Ready for smoke validation',
    meta: 'Heun · 1e-13 s fixed timestep · Box geometry',
  },
  {
    title: 'exchange_relax / strict / fem',
    state: 'Planner contract defined',
    meta: 'Order-1 FEM hints · matched observables · physical tolerance checks',
  },
  {
    title: 'dw_track / hybrid / semantic-only',
    state: 'Shared semantics frozen',
    meta: 'Imported geometry · DMI/Demag/Zeeman preserved as architecture-facing example',
  },
];

const artifacts = [
  {
    name: 'm',
    type: 'Vector field',
    unit: '1',
    summary: 'Reduced magnetization published consistently across backends.',
  },
  {
    name: 'H_ex',
    type: 'Vector field',
    unit: 'A/m',
    summary: 'Exchange effective field for cross-backend analysis.',
  },
  {
    name: 'E_ex',
    type: 'Scalar',
    unit: 'J',
    summary: 'Exchange energy suitable for tolerance-based comparisons.',
  },
  {
    name: 'solver_dt',
    type: 'Scalar',
    unit: 's',
    summary: 'Runner-selected or fixed timestep retained for provenance.',
  },
];

const governanceCards = [
  {
    title: 'Physics-first gate',
    text:
      'Every physics-facing capability ships with a publication-style note before backend implementation proceeds.',
  },
  {
    title: 'ProblemIR discipline',
    text:
      'Canonical IR keeps mesh/grid internals out of the public surface while remaining planner-ready.',
  },
  {
    title: 'Capability transparency',
    text:
      'Strict, extended, and hybrid semantics remain explicit so users can reason about legality and maturity.',
  },
];

export default function HomePage() {
  return (
    <main className="app-shell">
      <section className="hero-surface">
        <header className="topbar">
          <div>
            <p className="eyebrow">Fullmag / scientific control room</p>
            <h1>Elegant orchestration for one physical problem across three execution modes.</h1>
          </div>
          <div className="hero-badge-cluster" aria-label="status highlights">
            <div className="hero-badge">
              <span className="hero-badge-label">Current focus</span>
              <strong>Exchange-only bootstrap</strong>
            </div>
            <div className="hero-badge">
              <span className="hero-badge-label">Shared contract</span>
              <strong>Python → ProblemIR → planner</strong>
            </div>
          </div>
        </header>

        <div className="hero-grid">
          <div className="hero-copy panel-glass">
            <p className="lead">
              Fullmag is evolving into a modern micromagnetics platform where scripting,
              validation, planning, and provenance feel coherent from the first draft of a
              physical model to the final observable set.
            </p>
            <div className="hero-metrics" aria-label="platform metrics">
              <article>
                <span>Execution modes</span>
                <strong>3</strong>
                <p>Strict, extended, and hybrid stay first-class from day one.</p>
              </article>
              <article>
                <span>Authoring surface</span>
                <strong>1</strong>
                <p>Embedded Python DSL remains the only public modeling API.</p>
              </article>
              <article>
                <span>Control plane</span>
                <strong>Rust</strong>
                <p>Validation, planning, provenance, and runner coordination stay centralized.</p>
              </article>
            </div>
          </div>

          <aside className="hero-aside panel-glass">
            <div className="section-heading compact">
              <span className="section-kicker">North star</span>
              <h2>Physics before implementation.</h2>
            </div>
            <ul className="signal-list">
              <li>Keep the public API physical, not numerical-storage oriented.</li>
              <li>Freeze shared semantics before backend-specific execution depth.</li>
              <li>Publish canonical observables and provenance for every runner path.</li>
              <li>Prefer fewer, stronger abstractions over many leaky backend details.</li>
            </ul>
          </aside>
        </div>
      </section>

      <nav className="tab-rail" aria-label="Control room sections">
        {workspaceTabs.map((tab) => (
          <a key={tab.id} className="tab-chip" href={`#${tab.id}`}>
            <span>{tab.label}</span>
            <small>{tab.caption}</small>
          </a>
        ))}
      </nav>

      <section id="overview" className="dashboard-section">
        <div className="section-heading">
          <span className="section-kicker">Overview</span>
          <h2>Read the platform state in seconds.</h2>
          <p>
            The landing experience now behaves like a scientific operations dashboard: immediate
            system status, stable terminology, and clear pathways into modeling, execution, and
            review.
          </p>
        </div>
        <div className="card-grid three-up">
          <article className="panel-glass feature-card accent-cyan">
            <h3>Unified problem framing</h3>
            <p>
              Geometry, material models, energies, dynamics, and outputs are framed as one
              canonical physical problem rather than a backend-specific data layout.
            </p>
          </article>
          <article className="panel-glass feature-card accent-violet">
            <h3>Modern decision surfaces</h3>
            <p>
              Dense information is separated into readable cards, metrics, and section rails so the
              UI feels deliberate rather than improvised.
            </p>
          </article>
          <article className="panel-glass feature-card accent-amber">
            <h3>Research-grade clarity</h3>
            <p>
              Capability, observables, and provenance are surfaced in the same language users see in
              docs/specs and physics notes.
            </p>
          </article>
        </div>
      </section>

      <section id="workflow" className="dashboard-section">
        <div className="section-heading">
          <span className="section-kicker">Workflow tab</span>
          <h2>Make the Python → IR → planner pipeline legible.</h2>
          <p>
            Each stage is presented as an intentional scientific workflow, reducing ambiguity for
            contributors moving between the DSL, ProblemIR, and backend planning.
          </p>
        </div>
        <div className="split-grid">
          <article className="panel-glass timeline-panel">
            <h3>Pipeline stages</h3>
            <div className="timeline">
              {plannerStages.map((stage, index) => (
                <article key={stage.name} className="timeline-item">
                  <div className="timeline-marker">0{index + 1}</div>
                  <div>
                    <h4>{stage.name}</h4>
                    <p>{stage.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="panel-glass code-panel">
            <div className="code-header">
              <div>
                <span className="section-kicker">Reference pattern</span>
                <h3>Exchange-only authoring flow</h3>
              </div>
              <span className="status-pill">IR v0.2.0</span>
            </div>
            <pre>
              <code>{`geom = fm.Box(size=(200e-9, 20e-9, 5e-9), name="strip")
mat = fm.Material(name="Py", Ms=800e3, A=13e-12, alpha=0.02)
body = fm.Ferromagnet(name="strip", geometry=geom, material=mat)
problem = fm.Problem(...)
json_ir = problem.to_ir()`}</code>
            </pre>
          </article>
        </div>
      </section>

      <section id="execution" className="dashboard-section">
        <div className="section-heading">
          <span className="section-kicker">Execution tab</span>
          <h2>Track readiness across FDM, FEM, and hybrid paths.</h2>
          <p>
            Jobs are expressed as scientific study entries, with execution mode, backend maturity,
            and planner status visible at a glance.
          </p>
        </div>
        <div className="card-grid three-up">
          {jobs.map((job) => (
            <article key={job.title} className="panel-glass job-card">
              <div className="job-header">
                <h3>{job.title}</h3>
                <span className="status-pill subtle">{job.state}</span>
              </div>
              <p>{job.meta}</p>
            </article>
          ))}
        </div>
        <article className="panel-glass capability-table-panel">
          <div className="section-heading compact">
            <span className="section-kicker">Capability lens</span>
            <h3>Cross-backend visibility without ambiguity.</h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>FDM</th>
                  <th>FEM</th>
                  <th>Hybrid</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {capabilityRows.map((row) => (
                  <tr key={row.feature}>
                    <td>{row.feature}</td>
                    <td>{row.fdm}</td>
                    <td>{row.fem}</td>
                    <td>{row.hybrid}</td>
                    <td>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section id="artifacts" className="dashboard-section">
        <div className="section-heading">
          <span className="section-kicker">Artifacts tab</span>
          <h2>Give observables and provenance first-class presentation.</h2>
          <p>
            The UI now treats outputs as research artifacts rather than afterthoughts, with units,
            purpose, and downstream comparison value surfaced explicitly.
          </p>
        </div>
        <div className="card-grid four-up">
          {artifacts.map((artifact) => (
            <article key={artifact.name} className="panel-glass artifact-card">
              <div className="artifact-topline">
                <strong>{artifact.name}</strong>
                <span>{artifact.unit}</span>
              </div>
              <h3>{artifact.type}</h3>
              <p>{artifact.summary}</p>
            </article>
          ))}
        </div>
        <article className="panel-glass provenance-panel">
          <div className="section-heading compact">
            <span className="section-kicker">Provenance snapshot</span>
            <h3>Scientific confidence comes from explainable runs.</h3>
          </div>
          <div className="provenance-grid">
            <div>
              <span>Entrypoint</span>
              <strong>Python build() / problem</strong>
            </div>
            <div>
              <span>Normalization target</span>
              <strong>Canonical ProblemIR</strong>
            </div>
            <div>
              <span>Planner outputs</span>
              <strong>ExecutionPlanIR + notes</strong>
            </div>
            <div>
              <span>Comparison policy</span>
              <strong>Physical tolerances, not bitwise equality</strong>
            </div>
          </div>
        </article>
      </section>

      <section id="governance" className="dashboard-section">
        <div className="section-heading">
          <span className="section-kicker">Governance tab</span>
          <h2>Surface the rules that keep the platform rigorous.</h2>
          <p>
            A professional scientific interface should make repository guardrails visible, so users
            and contributors understand why the platform stays coherent as capabilities expand.
          </p>
        </div>
        <div className="card-grid three-up">
          {governanceCards.map((card) => (
            <article key={card.title} className="panel-glass governance-card">
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
