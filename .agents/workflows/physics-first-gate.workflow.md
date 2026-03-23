# Workflow: physics-first-gate

## Purpose

Mandatory gate before implementing any physics-facing or numerics-facing change.

## Steps

1. Identify the feature or semantic change.
2. Run `physics-publication`.
3. Check the note against `docs/physics/TEMPLATE.md`.
4. Run `problem-ir-design`.
5. Run `capability-matrix-check`.
6. Only then begin implementation work.

## Exit criteria

- the physics note exists and is complete,
- Python API and `ProblemIR` impact are explicit,
- capability and validation implications are explicit.
