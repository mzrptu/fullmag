---
name: physics-publication
description: "Use when adding or modifying any Fullmag physics or numerics feature. Create or update a publication-style note in docs/physics before writing code."
---

# Physics publication skill

## Goal

Enforce the project rule: physics first, implementation second.

## When to trigger

- adding a new energy term, dynamics model, or numerical method,
- changing equations, assumptions, or units,
- changing backend interpretation or validation scope,
- changing shared problem semantics for physics-facing features.

## Required outputs

1. A `docs/physics/<topic>.md` note based on `docs/physics/TEMPLATE.md`
2. Governing equations, symbols, SI units, assumptions, and approximations
3. Explicit FDM, FEM, and hybrid interpretation
4. Python API and `ProblemIR` impact
5. Planner and capability-matrix impact
6. Validation strategy, observables, and tolerances
7. Completeness checklist and deferred work

## Blocker policy

If the note is missing or incomplete, implementation is blocked.

## Cascade

After this skill completes, run:

1. `problem-ir-design`
2. `python-api-class`
3. `capability-matrix-check`
