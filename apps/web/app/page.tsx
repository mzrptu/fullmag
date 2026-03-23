const pillars = [
  'One physics-first DSL above FDM, FEM, and hybrid execution',
  'Rust control plane for parsing, planning, scheduling, and provenance',
  'Native compute behind stable C ABI boundaries',
  'Container-first development for reproducible onboarding',
];

const roadmap = [
  'Freeze v1 physics scope and ProblemIR semantics',
  'Implement parser + validator + planner seam in Rust',
  'Stand up FDM workhorse backend first',
  'Add FEM bridge around MFEM + libCEED + hypre',
  'Validate cross-backend semantics before feature sprawl',
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Fullmag / control room</p>
        <h1>One physical problem. Three execution modes.</h1>
        <p className="lead">
          Fullmag is being scaffolded as a micromagnetics platform where the shared interface describes
          geometry, materials, energies, dynamics, and outputs — never raw mesh internals. Tiny repo,
          large ambition, suspiciously healthy boundaries.
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
