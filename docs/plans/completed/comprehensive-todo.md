# Fullmag — Comprehensive TODO

> Last updated: 2026-03-25
> Covers: runtime architecture, relaxation, validation, CUDA, FEM, documentation

---

## 1. Runtime Architecture

### 1.1 Split `main.rs` (2319 lines → ~6 modules)

`crates/fullmag-cli/src/main.rs` violates the 1000-line limit. Split into:

| New module | Lines | Responsibility |
|-----------|-------|----------------|
| `cli_args.rs` | ~100 | `Cli`, `ScriptCli`, `BackendArg`, `ModeArg`, arg parsing |
| `session.rs` | ~200 | `SessionManifest`, `RunManifest`, `LiveStateManifest`, manifest I/O |
| `stage_executor.rs` | ~300 | Multi-stage execution loop, live callbacks, step offset logic |
| `artifacts.rs` | ~150 | Artifact dir layout, CSV/JSON writing, field snapshots |
| `interactive.rs` | ~200 | Interactive session polling, command queue, continuation |
| `control_room.rs` | ~100 | `spawn_control_room()`, port selection |

### 1.2 Generic step loop in `dispatch.rs`

Extract a single `fn run_with_backend<B: SolverBackend>(...)` to eliminate 6× duplicated step loops (FDM CPU/CUDA, FDM multilayer CPU/CUDA, FEM CPU/GPU).

Draft trait:

```rust
pub(crate) trait SolverBackend {
    fn step(&mut self, dt: f64) -> Result<StepStats, RunError>;
    fn copy_m(&self, count: usize) -> Result<Vec<[f64; 3]>, RunError>;
    fn copy_field(&self, name: &str, count: usize) -> Result<Vec<[f64; 3]>, RunError>;
    fn device_info(&self) -> Result<DeviceInfo, RunError>;
    fn element_count(&self) -> usize;
}
```

### 1.3 Unified `ResolvedExecution` struct

Replace scattered dispatch decisions with a single resolution:

```rust
struct ResolvedExecution {
    method: Method,          // fdm | fem
    device: Device,          // cpu | cuda
    precision: Precision,    // single | double
    algorithm: Algorithm,    // llg | bb | ncg
    parallelism: Parallelism, // single_thread | parallel(n) | multi_gpu(n)
}
```

### 1.4 `execution_mode` enforcement

`strict` / `extended` / `hybrid` modes are parsed but never enforced at runtime. Either implement validation gates or remove the option until ready.

---

## 2. CUDA Backend

### 2.1 Port BB/NCG relaxation to CUDA

Currently BB and NCG algorithms exist only in `cpu_reference.rs`. The CUDA path silently falls back to LLG-with-high-damping relaxation. Now emits an error (fix 4), but the actual port is needed:

- Port `projected_gradient_bb()` kernel
- Port `nonlinear_cg()` kernel  
- Share convergence check logic with CPU path
- Add CPU↔CUDA parity tests for BB/NCG

### 2.2 GPU `double` parity verification

Per AGENTS.md: "GPU double parity is required before GPU single becomes public-executable." Need systematic GPU↔CPU parity tests across all energy terms at `double` precision before promoting `single`.

### 2.3 Multi-GPU support

`gpu_count` is accepted in `RuntimeSelection` but no multi-GPU dispatch exists. Defer until single-GPU path is fully calibrated.

---

## 3. Physics Validation Tests

### 3.1 Current test status

| # | Test | Status |
|---|------|--------|
| 1 | `uniform_field_alignment` | ✅ pass |
| 2 | `exchange_only_random_to_uniform` | ✅ pass |  
| 3 | `thin_film_shape_anisotropy` | ⏳ unverified (long-running) |
| 4 | `sp4_equilibrium` | ⏳ unverified (long-running) |
| 5 | `sp4_cross_algorithm_equilibrium` | ⏳ unverified (long-running) |
| 6 | `sp4_reversal_dynamics` | ⏳ unverified (long-running) |

### 3.2 Remaining validation work

- **Verify tests 3–6** in release mode (need machine with enough CPU time)
- **Add FEM variants** of tests 1–6 (currently FDM-only)
- **Add CUDA variants** when hardware is available
- **Standard Problem 5** (spin-torque vortex) once STT is implemented
- **Benchmark timing** — tests should complete in < 60s each in release; currently too slow

---

## 4. FEM Backend

### 4.1 FEM CPU reference

`fem_reference.rs` has basic LLG but:
- No BB/NCG relaxation support
- FEM-specific mass-weighted inner products needed for BB/NCG (see `docs/physics/0510-fem-relaxation-algorithms-mfem-gpu.md`)
- Tangent-plane implicit scheme not implemented

### 4.2 FEM GPU (MFEM)

- Transfer-grid demag is bootstrap; mesh-native BEM/FMM demag not yet implemented
- Robin airbox demag (documented in `0520-fem-robin-airbox-demag-bootstrap-reference.md`) not implemented
- FEM↔GPU parity tests exist but are conditional on MFEM availability

---

## 5. Energy Terms — Missing Implementations

| Term | FDM CPU | FDM CUDA | FEM CPU | FEM GPU | Physics doc |
|------|---------|----------|---------|---------|-------------|
| Exchange | ✅ | ✅ | ✅ | ✅ | 0400, 0410 |
| Demag | ✅ | ✅ | ✅ (transfer) | ✅ (transfer) | 0420, 0430 |
| Zeeman | ✅ | ✅ | ✅ | ✅ | 0400, 0410 |
| Interfacial DMI | ❌ stub | ❌ | ❌ | ❌ | 0440, 0450 |
| Bulk DMI | ❌ stub | ❌ | ❌ | ❌ | 0460, 0470 |
| Uniaxial anisotropy | ❌ | ❌ | ❌ | ❌ | — |
| Cubic anisotropy | ❌ | ❌ | ❌ | ❌ | — |
| Spin-transfer torque | ❌ | ❌ | ❌ | ❌ | — |
| Thermal noise | ❌ | ❌ | ❌ | ❌ | — |

---

## 6. Time Integrators

| Integrator | FDM CPU | FDM CUDA | FEM CPU | FEM GPU | Physics doc |
|-----------|---------|----------|---------|---------|-------------|
| Heun (RK2) | ✅ | ✅ | ✅ | ✅ | 0200 |
| RK4 | ❌ | ❌ | ❌ | ❌ | 0480, 0490 |
| Dormand-Prince (RK45) | ❌ | ❌ | ❌ | ❌ | 0480, 0490 |
| Adaptive dt | ❌ | ❌ | ❌ | ❌ | 0480, 0490 |

---

## 7. Documentation

### 7.1 Physics docs needing update

- `0440-fdm-interfacial-dmi.md` — has physics, no implementation yet
- `0460-fdm-bulk-dmi.md` — has physics, no implementation yet
- `0480-fdm-higher-order-integrators.md` — has physics, no implementation yet
- Uniaxial/cubic anisotropy — no physics doc exists yet

### 7.2 Frontend docs

- `docs/physics/` notes are auto-rendered into frontend — verify rendering still works after recent changes
- API reference for `RuntimeSelection` needs update (`.gpu()` deprecated)

---

## 8. Code Quality

### 8.1 Pre-existing build issues

- `FdmMultilayer` match arm exhaustiveness in `artifacts.rs` — pre-existing, blocks clean `cargo test` in some configurations

### 8.2 Test performance

- SP4 validation tests take > 60s each in debug, minutes in release — consider smaller grid (64×16) for CI, full grid for nightly

### 8.3 Parallel CPU

- `cpu_threads` parameter is accepted but all CPU paths are single-threaded
- Need rayon-based parallelism for exchange field and demag convolution

---

## 9. Priority Order (recommended)

1. **Verify SP4 tests pass** (tests 3–6 in release mode)
2. **Split `main.rs`** (most impactful code quality win)
3. **Implement uniaxial anisotropy** (most requested physics feature)
4. **Port BB/NCG to CUDA** (completes relaxation cross-backend)
5. **Implement DMI** (interfacial first, then bulk)
6. **Adaptive time integration** (RK45)
7. **Parallel CPU** (rayon)
8. **Multi-GPU**
