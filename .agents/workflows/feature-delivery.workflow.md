# Workflow: feature-delivery

## Purpose

Deliver a Fullmag feature without letting physics, API semantics, IR, and planning drift apart.

## Steps

1. `physics-first-gate`
2. Python API work
3. `ProblemIR` and validation work
4. planner and capability work
5. backend work
6. validation and smoke coverage
7. update `docs/physics/` with results and deferred work
8. prefer `justfile` build/run/package recipes for verification and user-facing workflow examples

## Exit criteria

- semantics remain aligned across the stack,
- validation is documented,
- deferred work is explicit.
