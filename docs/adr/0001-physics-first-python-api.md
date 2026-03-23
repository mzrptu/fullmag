# ADR 0001: Physics-first embedded Python API

- Status: accepted
- Date: 2026-03-23

## Context

Fullmag needs one shared authoring surface for FDM, FEM, and hybrid execution without leaking backend representation details into user code.
A standalone text DSL would duplicate Python language features and create a second syntax system to maintain.

## Decision

Fullmag uses an embedded, declarative Python DSL as the only public scripting interface.

Users write ordinary Python scripts and notebooks, but those scripts are expected to build `fullmag` objects that serialize into canonical `ProblemIR`.
Rust then validates, normalizes, and plans that IR.

There is no separate text DSL, no AST parsing phase, and no source-code inference.

## Consequences

- Python becomes the user-facing language of experiment description.
- `ProblemIR` becomes the execution contract between Python and Rust.
- Rust remains the control plane for validation, normalization, planning, provenance, and services.
- Native backends remain behind stable C ABI boundaries.
- Shared semantics stay physics-first and backend-neutral.
- Every physics-facing change must be documented first in `docs/physics/`.
