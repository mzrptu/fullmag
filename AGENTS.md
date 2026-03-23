# Fullmag agents guide

## North star

Fullmag describes a physical micromagnetic problem, not a numerical storage layout.
Every change must preserve that contract across Python API, `ProblemIR`, planning, and backend execution.

## Canonical instruction sources

- `.agents/` is the canonical source for Fullmag agent workflows and skills.
- `.github/` mirrors the same rules for GitHub and Copilot surfaces.
- `docs/physics/TEMPLATE.md` is the only canonical template for publication-style physics notes.

## Golden rule: physics before implementation

This rule is non-negotiable.

Before implementing any physics or numerical feature, create or update a publication-style note in `docs/physics/` covering:

1. problem statement and physical motivation,
2. governing equations, symbols, SI units, and assumptions,
3. FDM, FEM, and hybrid interpretation,
4. Python API and `ProblemIR` impact,
5. planner and capability-matrix impact,
6. validation strategy and observables,
7. completeness checklist across the stack,
8. known limits and deferred work.

If the note does not exist or is incomplete, the task is not ready for implementation.

## Architectural guardrails

1. The only public scripting surface is the embedded Python DSL in `packages/fullmag-py`.
2. Python scripts build object graphs and canonical `ProblemIR`; Rust validates, normalizes, and plans that IR.
3. The shared API must never expose grid indices, GPU array internals, or FEM-only implementation details.
4. `strict`, `extended`, and `hybrid` are first-class execution semantics from day one.
5. Rust remains the control plane: validation, normalization, planning, runner, API, provenance.
6. Native compute stays behind stable C ABI boundaries.
7. Containerized workflows are the default verification path.

## Repo map

- `packages/fullmag-py` — public embedded Python DSL and runtime scaffolding.
- `crates/fullmag-ir` — typed canonical `ProblemIR`, validation, and planning summaries.
- `crates/fullmag-cli` — bootstrap CLI for IR validation and planning.
- `crates/fullmag-api` — control-plane HTTP API.
- `crates/fullmag-py-core` — private PyO3 bridge for Python/Rust integration.
- `apps/web` — Next.js control room for scripts, jobs, and artifacts.
- `native/` — native backends and C ABI.
- `docs/specs` — canonical architecture and IR specs.
- `docs/physics` — publication-style physics documentation and validation notes.
- `.agents/skills` — canonical agent skills.
- `.agents/workflows` — canonical agent workflows.

## Definition of done for foundation changes

- The change strengthens the embedded Python DSL or typed IR boundary.
- Physics-facing changes include a corresponding `docs/physics/` update.
- README, AGENTS, skills, prompts, and web/CLI copy stay aligned.
- Containerized checks cover Rust, Python, repo consistency, and smoke flow.
