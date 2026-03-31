# Phase 3 — Magnetoelastic Rollout

- Status: **active**
- Last updated: 2026-03-31
- Related physics: `docs/physics/0700-shared-magnetoelastic-semantics.md`
- Related specs: `docs/specs/problem-ir-magnetoelastic-v1.md`

---

## Scope

Small-strain magnetoelastic interactions in FullMag. One shared energy term, three execution
modes, FDM-first then FEM bootstrap.

## Relationship to other active plans

This plan is **independent** of the active Phase 2 GPU FDM rollout. Magnetoelastic physics
enters the CUDA FDM path only **after** Phase 2 stabilizes the baseline
`Exchange + Demag + Zeeman` GPU slice.

## Phase timeline

| Sub-phase | Description | Target tier | Estimated effort |
|-----------|-------------|-------------|-----------------|
| **A** | Documentation freeze | — | 1 day |
| **B** | Python DSL + Rust IR (semantic-only) | semantic-only | 2–3 days |
| **C** | FDM CPU prescribed-strain | internal-reference | 2 days |
| **D** | FDM CPU quasistatic bidirectional | public-executable (FDM) | 4–5 days |
| **E** | FEM quasistatic bootstrap | internal-reference (FEM) | 3–4 days |
| **F** | Verification & productization | public-executable | 2–3 days |

## Milestone criteria

### Phase A → B gate

- [ ] All `docs/physics/07xx` notes reviewed and accepted
- [ ] All `docs/specs/` documents for magnetoelastic reviewed
- [ ] Rollout plan approved

### Phase B → C gate

- [ ] Python `Magnetoelastic` + `ElasticMaterial` + `ElasticBody` + `MagnetostrictionLaw` serialize to valid JSON IR
- [ ] Rust IR deserializes and validates without errors
- [ ] `cargo test --workspace` passes (backward compatibility)
- [ ] `check_repo_consistency.py` passes
- [ ] Capability matrix updated: `Magnetoelastic = semantic-only`

### Phase C → D gate

- [ ] `H_mel` from prescribed strain matches analytical expression
- [ ] Finite-difference derivative check passes ($< 10^{-6}$ relative error)
- [ ] Zero-coupling test passes ($B_1 = B_2 = 0$)
- [ ] Capability matrix updated: `Magnetoelastic = internal-reference`

### Phase D → E gate

- [ ] Quasistatic bidirectional coupling produces physically correct deformation
- [ ] Uniform strain → known preferred-axis shift
- [ ] All canonical outputs (`u`, `eps`, `sigma`, `H_mel`, `E_el`, `E_mel`) published
- [ ] Energy monotonically decreases during relaxation
- [ ] Capability matrix updated: `Magnetoelastic = public-executable (FDM)`

### Phase E → F gate

- [ ] FEM prescribed-strain `H_mel` matches FDM to within tolerance
- [ ] FEM quasistatic solve runs without divergence
- [ ] FDM vs FEM parity for Box geometry

### Phase F completion

- [ ] All cross-backend tolerances documented
- [ ] Provenance complete for magnetoelastic runs
- [ ] All outputs in SI with canonical names
- [ ] Documentation complete

## Deferred to Phase 3A (post-GPU Phase 2)

- CUDA FDM magnetoelastic kernels
- CPU/FDM vs CUDA/FDM parity tests

## Deferred to Phase 3B

- Full elastodynamics (Mode 3)
- Finite-strain models
- FEM public qualification
