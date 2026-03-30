# FEM Eigenmodes and Analyze Plan v1

Status: in progress  
Last updated: 2026-03-30

## What is already done

- Python DSL exposes `Eigenmodes`, `SaveSpectrum`, `SaveMode`, and `SaveDispersion`.
- `StudyIR::Eigenmodes` is implemented and validated.
- planner lowers FEM eigen studies into `BackendPlanIR::FemEigen`.
- CPU reference runner exports spectrum, per-mode fields, dispersion CSV, and metadata artifacts.
- local-live API exposes generic artifact access and dedicated eigen endpoints.
- Analyze route renders:
  - spectrum
  - mode inspector
  - dispersion
  - diagnostics

## What this phase intentionally is

This phase is the semantic and product-contract MVP:

- first-class study type
- executable FEM eigen baseline
- artifact contract
- UI that consumes artifacts directly

It is not yet the final scalable production eigensolver.

## Remaining work after v1

### Solver quality

- export residual and orthogonality diagnostics
- export tangent-space leakage metrics
- add anisotropy and DMI linearizations
- replace dense reference eigensolve with scalable native backend path

### Native backend

- dedicated FEM eigen ABI in `native/include/fullmag_fem.h`
- native FEM eigen execution path in `native/backends/fem/`
- MFEM/libCEED/hypre/SLEPc integration

### Authoring UX

- full script-builder authoring for eigen studies in flat/canonical rewrite flows
- richer Model Builder controls for mode counts, targets, normalization, and equilibrium source

### Analysis UX

- compare mode-to-mode and run-to-run views
- residual / orthogonality / leakage panels
- branch-to-mode deep links with richer k-path labels

## Acceptance criteria for closing v1

- workspace compiles
- web typecheck and production build pass
- eigen study planning is covered by tests
- artifact contract is documented
- Analyze works without hardcoding file parsing knowledge into multiple unrelated places
