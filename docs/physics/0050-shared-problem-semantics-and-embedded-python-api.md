# Shared problem semantics and embedded Python API

- Status: draft
- Last updated: 2026-03-23

## 1. Problem statement

Fullmag needs a shared problem description that stays physically meaningful across FDM, FEM, and hybrid execution.
The public authoring surface therefore cannot be a grid API or a FEM-specific mesh API.

## 2. Physical model

The shared layer represents:

- geometry,
- regions,
- materials,
- ferromagnets,
- energy terms,
- dynamics,
- sampling,
- discretization hints.

It does **not** represent:

- Cartesian cell indexing,
- GPU array layout,
- MFEM-specific spaces,
- backend-only solver internals.

## 3. Numerical interpretation

### 3.1 FDM

The shared problem lowers into voxelization, cell-centered fields, and FFT-based or local operators.

### 3.2 FEM

The shared problem lowers into mesh generation or import, field spaces, and operator assembly/evaluation.

### 3.3 Hybrid

The shared problem lowers into explicitly coupled representations where some operators act on FEM spaces and others act on auxiliary Cartesian grids.

## 4. API, IR, and planner impact

- Python is the only public authoring surface.
- Python objects serialize directly into `ProblemIR`.
- Rust validates and plans canonical IR; it does not infer intent from Python source text.
- `strict`, `extended`, and `hybrid` are explicit validation and planning states.

## 5. Validation strategy

- confirm that the same Python-authored problem serializes deterministically,
- confirm Rust can deserialize and validate the canonical IR,
- confirm planning summaries are legal for `fdm`, `fem`, and `hybrid`,
- confirm hybrid mode cannot be requested accidentally.

## 6. Completeness checklist

- [x] Python API
- [x] ProblemIR
- [x] Planner-facing validation
- [x] Capability matrix
- [ ] FDM backend
- [ ] FEM backend
- [ ] Hybrid backend
- [ ] Outputs / observables
- [x] Tests / smoke flow
- [x] Documentation

## 7. Known limits and deferred work

- The current runtime is planning-only.
- Backend execution depth is intentionally deferred until the shared semantics are stable.
