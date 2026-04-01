# Shared Geometry and Magnetization Authoring Semantics for `SceneDocument` v1

- Status: draft
- Owners: Fullmag core
- Last updated: 2026-04-01
- Related ADRs: none yet
- Related specs: `docs/specs/scene-document-authoring-v1.md`, `docs/specs/geometry-policy-v0.md`, `docs/specs/magnetization-init-policy-v0.md`

## 1. Problem statement

The control room needs a canonical authoring document that can express the same physical object set,
material assignment, and magnetization initialization that the embedded Python DSL already lowers
into `ProblemIR`.

This note defines the shared physical semantics for `SceneDocument` v1:

1. geometry remains a physical region definition,
2. transform expresses authoring-space placement of the whole object,
3. material assignment stays object-scoped,
4. magnetization assets represent only currently executable initialization modes,
5. editor metadata must not leak into solver semantics.

## 2. Physical model

### 2.1 Governing equations

`SceneDocument` does not introduce new field equations. It is an authoring layer for the same
micromagnetic problem that is later solved through the LLG-based workflows already documented in
existing notes.

For each ferromagnetic object `Omega_i`:

- geometry defines the spatial support `Omega_i`,
- material parameters define constitutive coefficients on `Omega_i`,
- magnetization initialization defines `m_0(x)` on `Omega_i` or a sampled surrogate used to seed
  the solve,
- transforms define the rigid placement used to construct `Omega_i` in world coordinates.

### 2.2 Symbols and SI units

- `x` : position, metres
- `Omega_i` : spatial support of object `i`
- `m(x)` : reduced magnetization, dimensionless
- `m_0(x)` : initial reduced magnetization, dimensionless
- `Ms` : saturation magnetization, A/m
- `Aex` : exchange stiffness, J/m
- `Dind` : interfacial DMI constant, J/m^2 where applicable
- `t` : time, s
- translations, pivots, sizes, radii, heights, mesh sizes: SI length units carried by the existing
  geometry/material semantics

### 2.3 Assumptions and approximations

- `SceneDocument` v1 is restricted to the geometry and magnetization modes that are already
  executable today.
- Object transforms are rigid authoring transforms; no deformation or non-rigid mapping is
  introduced.
- `rotation_quat`, `scale`, and `pivot` are stored now for forward compatibility, but only
  translation is actively edited in this slice.
- Texture-space parameters are stored but not yet exposed through dedicated editing UX.

## 3. Numerical interpretation

### 3.1 FDM

- Geometry still lowers to the existing FDM-capable shapes and imported assets.
- Uniform and random magnetization assets map directly to existing FDM initialization paths.
- File and sampled assets map to the existing state-loading path used by the Python layer.

### 3.2 FEM

- Geometry still lowers to the same imported or constructive geometry descriptions used to build the
  FEM mesh workflow.
- Per-object mesh overrides remain authoring metadata that eventually configure the same meshing
  policy already supported today.
- Sampled/file magnetization assets remain input-state carriers, not new FEM-only semantics.

### 3.3 Hybrid

No new hybrid semantics are introduced. `SceneDocument` is backend-neutral authoring state.

## 4. API, IR, and planner impact

### 4.1 Python API surface

- No new public DSL classes are introduced in this phase.
- The Python helper may export/import `SceneDocument` as an internal authoring artifact.
- Canonical script rewrite still flows through the existing Python DSL rendering path.

### 4.2 ProblemIR representation

- `ProblemIR` remains the canonical solver-facing semantic representation.
- `SceneDocument` does not add new public `ProblemIR` wire fields in v1.
- Editor-only fields such as selection, lock state, gizmo mode, and transform-space mode must not
  appear in `ProblemIR`.

### 4.3 Planner and capability-matrix impact

- Planner capability coverage does not expand in this slice.
- Capability reporting should document that `SceneDocument` is a new authoring layer, while
  executable geometry and magnetization coverage stays unchanged.
- Requested-vs-resolved execution semantics remain unchanged.

## 5. Validation strategy

### 5.1 Analytical checks

- Object transforms must preserve rigid-body placement semantics when projected back to builder
  state.
- Material and magnetization references must resolve exactly once per object.

### 5.2 Cross-backend checks

- Existing FDM and FEM builder scenarios should materialize identical executable problems before and
  after migration.
- Imported geometry and sampled/file state initialization must still rewrite to canonical Python
  without semantic drift.

### 5.3 Regression tests

- serde round-trip for `SceneDocument`
- validation failures for missing `material_ref` and `magnetization_ref`
- rejection of unsupported magnetization asset kinds
- adapter parity for primitive, CSG, and imported geometry plus uniform/random/file/sampled assets

## 6. Completeness checklist

- [x] Python API
- [x] ProblemIR
- [x] Planner
- [x] Capability matrix
- [x] FDM backend
- [x] FEM backend
- [x] Hybrid backend
- [x] Outputs / observables
- [x] Tests / benchmarks
- [x] Documentation

## 7. Known limits and deferred work

- No texture gizmo or texture-transform editor yet
- No procedural or composite magnetization assets yet
- No hierarchy, parenting, or grouped transforms yet
- No undo/redo semantics yet
- No direct public `ProblemIR -> SceneDocument` round-trip yet
- Full rotate/scale editing UX is deferred even though storage fields already exist

## 8. References

- `docs/specs/scene-document-authoring-v1.md`
- `docs/specs/geometry-policy-v0.md`
- `docs/specs/magnetization-init-policy-v0.md`
