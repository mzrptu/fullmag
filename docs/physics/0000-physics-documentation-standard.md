# Physics documentation standard

- Status: active
- Last updated: 2026-03-23

## Mission

Every note in `docs/physics/` should read like an internal publication note or the seed of a future scientific supplement.

## Required sections

Every new topic must contain at least:

1. **Problem statement**
   - What is being modeled?
   - Why is it needed?
   - What physical or numerical scope does it cover?

2. **Physical model**
   - governing equations,
   - symbol definitions,
   - SI units,
   - assumptions and approximations.

3. **Numerical interpretation**
   - FDM interpretation,
   - FEM interpretation,
   - hybrid interpretation,
   - semantic differences between backends.

4. **API and IR impact**
   - Python API objects,
   - `ProblemIR` fields,
   - planner impact,
   - capability-matrix impact.

5. **Validation strategy**
   - analytical checks,
   - cross-backend checks,
   - regression cases,
   - observables and tolerances.

6. **Completeness checklist**
   - Python API,
   - `ProblemIR`,
   - planner,
   - capability matrix,
   - FDM backend,
   - FEM backend,
   - hybrid backend,
   - outputs,
   - tests,
   - documentation.

7. **Known limits and deferred work**

## Quality bar

A note is complete only when it lets a reviewer answer:

- Are we implementing the right physics?
- Are we implementing it consistently across the stack?
- Do we know how to validate it?
- Do we understand what is intentionally out of scope?
