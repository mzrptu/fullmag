# [Topic Name]

> Status: draft | review | accepted
> Date: YYYY-MM-DD
> Author:

## Summary

One-paragraph description of the physical phenomenon or numerical method.

## Equations

$$
\text{Main governing equation(s)}
$$

Define all symbols and their SI units in a table:

| Symbol | Meaning | Unit |
|--------|---------|------|
|        |         |      |

## Assumptions & Limitations

- Assumption 1
- Assumption 2

## FDM Interpretation

How this term is discretized on a regular grid. Stencil, operator splitting, etc.

## FEM Interpretation

Weak form, test/trial spaces, operator fragments (libCEED QFunction if applicable).

## Hybrid Interpretation

How this term behaves in hybrid FDM↔FEM mode. Projection requirements, auxiliary grids, etc.

## Impact on Python API

Which `fullmag` classes are affected or need to be created (e.g. `fm.NewTerm(...)`).

## Impact on ProblemIR

New or modified IR sections, types, validation rules.

## Validation Strategy

- Analytical benchmark(s)
- Cross-backend comparison (FDM vs FEM tolerance)
- Reference solver comparison (mumax3, OOMMF, BORIS)

## Completeness Criteria

- [ ] Equations documented with full symbol table
- [ ] FDM kernel implemented and tested
- [ ] FEM operator implemented and tested
- [ ] Python API class created
- [ ] ProblemIR types updated
- [ ] Capability matrix updated
- [ ] Validation tests passing

## Deferred / Out of Scope

Items explicitly postponed for later versions.
