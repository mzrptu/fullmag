---
name: capability-matrix-check
description: "Use when changing backend legality, execution modes, or capability coverage in Fullmag."
---

# Capability matrix check skill

## Preconditions

- The relevant `docs/physics/` note exists.
- `ProblemIR` and Python API implications are already understood.

## Checklist

1. Is the feature legal in `strict`?
2. What is only legal in `extended`, and why?
3. What does hybrid execution require?
4. Does the Python API expose the feature without leaking backend internals?
5. What tests or smoke checks are required?

## Outputs

- Update `docs/specs/capability-matrix-v0.md`
- Record explicit go/no-go status for FDM, FEM, and hybrid
