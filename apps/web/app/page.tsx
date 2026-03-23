const pillars = [
  'One embedded Python DSL above FDM, FEM, and hybrid execution',
  'Rust control plane for validation, planning, scheduling, and provenance',
  'Native compute behind stable C ABI boundaries',
  'Physics-first publication notes before physics implementation',
];

const roadmap = [
  'Stabilize the embedded Python API and script entrypoints',
  'Keep ProblemIR typed and planner-ready in Rust',
  'Enforce docs/physics as a hard repository gate',
  'Stand up planning-only smoke coverage before solver depth',
  'Expand backend capability checks before feature sprawl',
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Fullmag / control room</p>
        <h1>One physical problem. Three execution modes.</h1>
        <p className="lead">
          Fullmag is being scaffolded as a micromagnetics platform where Python scripts describe
          geometry, materials, energies, dynamics, and outputs, then serialize into a canonical
          ProblemIR for Rust-side validation and planning.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Architecture pillars</h2>
          <ul>
            {pillars.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h2>Bootstrap roadmap</h2>
          <ol>
            {roadmap.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </article>
      </section>
    </main>
  );
}
