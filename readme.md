# Fullmag

Fullmag is a micromagnetics platform built around one contract:

> the shared interface describes a physical problem, not a numerical mesh layout

The public authoring surface is an embedded, declarative Python DSL in `packages/fullmag-py`.
Users write ordinary Python scripts and notebooks, but those objects serialize into a canonical `ProblemIR` that Rust validates, normalizes, and lowers into backend-specific plans.

## Architecture

- `packages/fullmag-py` — embedded Python DSL and runtime scaffolding
- `crates/fullmag-ir` — typed `ProblemIR`, validation, and planning summaries
- `crates/fullmag-cli` — local validation and planning CLI
- `crates/fullmag-api` — control-plane HTTP API
- `crates/fullmag-py-core` — private PyO3 bridge for Python/Rust integration
- `apps/web` — Next.js control room
- `native/` — native FDM/FEM/hybrid backend seams behind C ABI
- `docs/` — specs, ADRs, and publication-style physics notes

## Execution chain

```text
Python script / notebook
        |
        v
embedded Python DSL (fullmag)
        |
        v
Python-built ProblemIR
        |
        v
Rust validation + normalization + planning
        |
        +--> FDM backend
        +--> FEM backend
        +--> Hybrid backend
```

## Golden rule

Before implementing any new physics or numerics feature, create or update a publication-style note in `docs/physics/`.
The note must cover equations, symbols, SI units, assumptions, backend interpretation, `ProblemIR` impact, validation strategy, completeness, and deferred work.

## Current bootstrap state

The repository now includes:

- a real Python package scaffold in `packages/fullmag-py`,
- typed `ProblemIR` sections in Rust,
- CLI commands for JSON validation and planning summaries,
- a canonical Python example in `examples/dw_track.py`,
- mirrored agent instructions between `.agents` and `.github`,
- repo consistency checks and a hard `docs/physics` gate in CI.

This is still a foundation milestone. It is intentionally planning-first, not solver-depth-first.

## Quick start

### 1. Bring up the dev container

```bash
make up
make shell
```

### 2. Verify the bootstrap in the container

```bash
cargo check --workspace
cargo test --workspace
python3 -m pip install -e packages/fullmag-py
python3 -m unittest discover -s packages/fullmag-py/tests -v
python3 scripts/check_repo_consistency.py
python3 scripts/run_python_ir_smoke.py --cli target/debug/fullmag-cli
```

### 3. Inspect the canonical example

```bash
python3 -m pip install -e packages/fullmag-py
python3 - <<'PY'
from fullmag import load_problem_from_script
loaded = load_problem_from_script("examples/dw_track.py")
print(loaded.problem.to_ir())
PY
```

## Key documents

- `docs/1_project_scope.md`
- `docs/2_repo_blueprint.md`
- `docs/adr/0001-physics-first-python-api.md`
- `docs/specs/problem-ir-v0.md`
- `docs/specs/capability-matrix-v0.md`
- `docs/physics/README.md`
- `docs/physics/0000-physics-documentation-standard.md`

## Near-term priorities

1. Expand the Python DSL and keep it backend-neutral.
2. Keep `ProblemIR` typed and planner-ready.
3. Grow capability checks before backend feature sprawl.
4. Add planning-depth smoke coverage before solver-depth implementation.
5. Maintain the physics-first publication workflow as a hard gate.
