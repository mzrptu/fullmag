# ADR 0001: Physics-first shared Python API

- Status: accepted
- Date: 2026-03-23
- Updated: 2026-03-23 — zmiana z własnego DSL na Python API (OOP)

## Context

Fullmag aims to execute the same physical problem on FDM, FEM, and hybrid backends. A shared interface tied to a specific mesh representation would immediately leak backend details and make semantic equivalence impossible to preserve.

> [!IMPORTANT]
> **Warstwa skryptowa to pakiet Python `fullmag`** (wzorem mumax+), nie własny DSL.
> Użytkownik pisze obiektowy kod Python, który buduje `ProblemIR` bezpośrednio.

## Decision

The shared **Python API** (package `fullmag`) and canonical `ProblemIR` describe the physical problem: geometry, regions, materials, energy terms, dynamics, excitations, outputs, and backend policy. They do **not** expose low-level grid or mesh mutation APIs such as setting a value by Cartesian cell index.

Skrypty symulacyjne to standardowy Python — nie ma osobnego parsera ani type-checkera DSL. Walidacja odbywa się przez pydantic/type hints po stronie Pythona i przez deserializację IR po stronie Rust.

## Consequences

- FDM performs voxelization as a backend concern.
- FEM performs meshing and field-space mapping as a backend concern.
- Hybrid mode must express projection and coupling through execution planning, not shared scripting primitives.
- Validation and capability checks become first-class parts of the planner.
- Python provides loops, conditions, functions, and ecosystem integration (numpy, scipy, matplotlib, Jupyter) for free — no need to reimplement in a custom DSL.
- Every new physical or numerical capability must be described first in `docs/physics/` with equations, assumptions, units, validation strategy, and implementation completeness criteria.
