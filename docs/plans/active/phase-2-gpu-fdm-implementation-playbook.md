# Phase 2 GPU FDM Implementation Playbook

- Status: active
- Priority: P0
- Last updated: 2026-03-23
- Purpose: detailed handoff plan for implementing the CUDA/FDM production path
- Parent application architecture: `docs/specs/fullmag-application-architecture-v1.md`
- Parent solver architecture: `docs/specs/exchange-only-full-solver-architecture-v1.md`
- Parent rollout plan: `docs/plans/active/phase-2-gpu-fdm-calibrated-rollout.md`
- Related physics notes:
  - `docs/physics/0200-llg-exchange-reference-engine.md`
  - `docs/physics/0300-gpu-fdm-precision-and-calibration.md`

## 1. Why this document exists

The high-level Phase 2 plan is correct, but it is still too coarse to hand to another model and
expect a clean implementation without interpretation drift.

This document is the **implementation playbook** for the next major solver step:

> replace the current public CPU FDM execution path with a calibrated CUDA/FDM production path,
> while preserving the same Python API, `ProblemIR`, output names, artifact semantics, and
> scientific meaning.

This playbook is intentionally explicit about:

- what to implement,
- what not to implement,
- which files to create or modify,
- how to split the work into safe slices,
- how to verify each slice,
- how to keep the repository honest at every stage.

If another model implements Phase 2, it should follow this document rather than improvising.

## 2. Scope of this playbook

## 2.1 In scope

This playbook covers the full execution path for:

- `Box`
- one ferromagnet
- `Exchange`
- `LLG(heun)`
- `fdm/strict`
- precision:
  - `double` first
  - `single` second

It covers:

- native CUDA backend skeleton,
- stable FDM C ABI,
- Rust FFI integration,
- runner dispatch,
- GPU `double` exchange field,
- GPU `double` Heun stepping,
- GPU `single` mode after calibration,
- provenance and metadata updates,
- compare/parity harness.

## 2.2 Explicitly out of scope

Do **not** mix these into the same effort:

- FEM execution,
- hybrid execution,
- demag,
- DMI,
- anisotropy,
- Zeeman,
- new integrators,
- adaptive timestep control,
- browser control room,
- multi-GPU,
- MPI,
- frontend rendering changes,
- generalized backend plugin architecture.

If any of these become necessary, stop and update the parent architecture first.

## 3. Verified starting point

The implementation must start from the actual current repository state, not from an older mental
model.

What is already real:

- Python-authored problems
- canonical `ProblemIR`
- Rust planning
- public `Simulation.run()` for the narrow CPU/FDM reference path
- package entrypoint:
  - `fullmag script.py --until ...`
- artifacts:
  - `metadata.json`
  - `scalars.csv`
  - `m_initial.json`
  - `m_final.json`
  - `fields/m/*.json`
  - `fields/H_ex/*.json`
- execution precision contract in Python API and Rust IR

What is not real yet:

- `native` CUDA implementation
- Rust-to-native CUDA dispatch
- GPU parity tests
- GPU-backed `Simulation.run()`

## 4. Frozen implementation decisions

These decisions should be treated as fixed for this implementation cycle.

## 4.1 Keep the public API unchanged

Do not redesign:

- `Problem`
- `Simulation`
- `ProblemIR`
- the Python authoring model

The public selector remains:

```python
fm.Simulation(problem, backend="fdm", mode="strict", precision="double")
fm.Simulation(problem, backend="fdm", mode="strict", precision="single")
```

Any implementation that requires changing public semantics is the wrong implementation.

## 4.2 Keep the CPU reference engine

The CPU reference path in `crates/fullmag-engine` is not a temporary throwaway.

It must remain:

- buildable,
- testable,
- usable as a fallback,
- usable as a calibration baseline.

Do not delete or bypass it.

## 4.3 Rust runner keeps ownership of schedules and artifacts

The native CUDA backend is a **numerical stepper**, not an artifact writer.

This means:

- Rust still decides which outputs are due,
- Rust still writes `metadata.json`, `scalars.csv`, and field snapshots,
- Rust still owns output naming semantics,
- Rust still owns provenance serialization.

The native backend only provides:

- stepping,
- field access,
- per-step diagnostics,
- device metadata.

This is a critical boundary and must not be violated.

## 4.4 Match CPU reference semantics exactly for GPU `double`

Before optimization, the CUDA backend must match the current CPU reference engine semantically:

- same grid indexing,
- same clamped-neighbor boundary handling,
- same exchange prefactor,
- same exchange energy definition,
- same Heun predictor/corrector logic,
- same normalization strategy,
- same `gamma` and `alpha` interpretation.

The implementation model should treat `crates/fullmag-engine/src/lib.rs` as the semantic reference.

## 4.5 Use the current `native/backends/fdm/` tree

The repository already has this structure:

```text
native/
  backends/
    fdm/
    fem/
```

For actual implementation, keep this tree and realize the CUDA/FDM backend inside:

```text
native/backends/fdm/
```

Do **not** create a second parallel root such as `native/fdm-cuda/`.

If older docs mention `native/fdm-cuda/`, update those docs while implementing.

## 4.6 Add a dedicated FDM ABI header

The current generic header:

- `native/include/fullmag_backend.h`

is too abstract and too weak for the real CUDA/FDM implementation.

Implementation decision:

- keep `fullmag_backend.h` for future generic ideas if desired,
- add a concrete FDM execution ABI:
  - `native/include/fullmag_fdm.h`

The GPU implementation must use the concrete FDM ABI, not force itself through an underspecified
generic interface.

## 4.7 Use an explicit runtime engine selector

The public API still says `backend="fdm"`.
Internally, the runner needs a controlled way to choose:

- CPU reference
- CUDA FDM

Freeze this runtime selector:

```text
FULLMAG_FDM_EXECUTION=auto|cpu|cuda
```

Semantics:

- `auto`
  - use CUDA if compiled and available,
  - otherwise fall back to CPU reference
- `cpu`
  - force CPU reference
- `cuda`
  - fail if CUDA backend is unavailable

This env var is internal/runtime control, not part of the physics API.

## 4.8 Export host-visible results as `f64`

Even if GPU internal state is `fp32`, the ABI boundary exposed to Rust should return:

- field snapshots in host `f64`,
- scalar diagnostics in host `f64`.

Reason:

- it keeps artifact writing stable,
- it keeps Rust-side compare logic simple,
- it decouples artifact schema from device storage precision.

This does **not** change the internal GPU state precision.
It only defines the ABI export format.

## 5. Target directory and module layout

## 5.1 Native CUDA backend

Target layout:

```text
native/
  include/
    fullmag_backend.h
    fullmag_fdm.h
  backends/
    fdm/
      CMakeLists.txt
      include/
        context.hpp
        kernels.hpp
      src/
        api.cpp
        context.cpp
        context.cu
        exchange_fp64.cu
        exchange_fp32.cu
        llg_fp64.cu
        llg_fp32.cu
        reductions_fp64.cu
        reductions_fp32.cu
        device_info.cpp
        error.cpp
      tests/
        smoke_context.cpp
        exchange_fp64_parity.cu
        heun_fp64_parity.cu
        single_precision_smoke.cu
```

## 5.2 Rust FFI integration

Create a dedicated raw FFI crate:

```text
crates/
  fullmag-fdm-sys/
    Cargo.toml
    build.rs
    src/
      lib.rs
```

This crate owns:

- C ABI declarations,
- native build invocation,
- link configuration,
- feature/env gating.

Do not bury raw FFI declarations inside `fullmag-runner`.

## 5.3 Runner module split

Split `crates/fullmag-runner/src/lib.rs` into focused modules:

```text
crates/fullmag-runner/src/
  lib.rs
  types.rs
  schedules.rs
  artifacts.rs
  cpu_reference.rs
  native_fdm.rs
  dispatch.rs
```

This split is mandatory.
Do not keep growing one monolithic runner file.

## 6. Target ABI

## 6.1 Core native handle

Opaque handle:

```c
typedef struct fullmag_fdm_backend fullmag_fdm_backend;
```

## 6.2 Enums

The concrete header should define at least:

```c
typedef enum {
  FULLMAG_FDM_PRECISION_SINGLE = 1,
  FULLMAG_FDM_PRECISION_DOUBLE = 2,
} fullmag_fdm_precision;

typedef enum {
  FULLMAG_FDM_INTEGRATOR_HEUN = 1,
} fullmag_fdm_integrator;

typedef enum {
  FULLMAG_FDM_OBSERVABLE_M = 1,
  FULLMAG_FDM_OBSERVABLE_H_EX = 2,
} fullmag_fdm_observable;
```

## 6.3 Plan descriptor

The ABI must accept a complete executable plan descriptor.

Minimum fields:

```c
typedef struct {
  uint32_t nx;
  uint32_t ny;
  uint32_t nz;
  double dx;
  double dy;
  double dz;
} fullmag_fdm_grid_desc;

typedef struct {
  double saturation_magnetisation;
  double exchange_stiffness;
  double damping;
  double gyromagnetic_ratio;
} fullmag_fdm_material_desc;

typedef struct {
  fullmag_fdm_grid_desc grid;
  fullmag_fdm_material_desc material;
  fullmag_fdm_precision precision;
  fullmag_fdm_integrator integrator;
  const double *initial_magnetization_xyz;
  uint64_t initial_magnetization_len;
} fullmag_fdm_plan_desc;
```

Notes:

- `initial_magnetization_len` is `3 * cell_count`.
- `region_mask` can be deferred in the first native version because the current executable subset
  has exactly one material and one magnet. Do not invent fake multi-material support yet.
- If the implementation chooses to already accept `region_mask`, it is fine, but it must not
  become a blocker for the first GPU path.

## 6.4 Step stats

The native step call must return:

```c
typedef struct {
  uint64_t step;
  double time_seconds;
  double dt_seconds;
  double exchange_energy_joules;
  double max_effective_field_amplitude;
  double max_rhs_amplitude;
  uint64_t wall_time_ns;
} fullmag_fdm_step_stats;
```

These map directly to current Rust `StepStats`.

## 6.5 Device info

The backend must expose device/runtime metadata:

```c
typedef struct {
  char name[128];
  int compute_capability_major;
  int compute_capability_minor;
  int driver_version;
  int runtime_version;
} fullmag_fdm_device_info;
```

## 6.6 Functions

Minimum function set:

```c
int fullmag_fdm_is_available(void);

fullmag_fdm_backend *fullmag_fdm_backend_create(
    const fullmag_fdm_plan_desc *plan);

int fullmag_fdm_backend_step(
    fullmag_fdm_backend *handle,
    double dt_seconds,
    fullmag_fdm_step_stats *out_stats);

int fullmag_fdm_backend_copy_field_f64(
    fullmag_fdm_backend *handle,
    fullmag_fdm_observable observable,
    double *out_xyz,
    uint64_t out_len);

int fullmag_fdm_backend_get_device_info(
    fullmag_fdm_backend *handle,
    fullmag_fdm_device_info *out_info);

const char *fullmag_fdm_backend_last_error(
    fullmag_fdm_backend *handle);

void fullmag_fdm_backend_destroy(
    fullmag_fdm_backend *handle);
```

Why this shape:

- Rust runner owns the outer loop and schedules.
- Native backend owns one time step.
- Native backend exposes current `m` and `H_ex`.
- Rust writes artifacts using the existing pipeline.

Do not create a native API that writes JSON or CSV files directly.

## 7. Exact semantic references in current code

The CUDA implementation must match these CPU reference semantics:

- grid flattening:
  - `GridShape::index()` in `crates/fullmag-engine/src/lib.rs`
- exchange field:
  - `exchange_field_from_vectors()`
- LLG RHS:
  - `llg_rhs_from_vectors()`
  - `llg_rhs_from_field()`
- Heun step:
  - `heun_step()`
- exchange energy:
  - `exchange_energy_from_vectors()`

Implementation rule:

- if the CUDA result disagrees with the CPU reference, assume the CUDA implementation is wrong
  until proven otherwise.

## 8. Work packages

## WP0 — Runner refactor without behavior change

### Goal

Prepare the Rust runner for multiple execution engines before adding CUDA complexity.

### Files to modify/create

- `crates/fullmag-runner/src/lib.rs`
- `crates/fullmag-runner/src/types.rs`
- `crates/fullmag-runner/src/schedules.rs`
- `crates/fullmag-runner/src/artifacts.rs`
- `crates/fullmag-runner/src/cpu_reference.rs`
- `crates/fullmag-runner/src/dispatch.rs`

### Tasks

1. Move public types out of `lib.rs`.
2. Move schedule handling into `schedules.rs`.
3. Move artifact writing into `artifacts.rs`.
4. Move current CPU execution path into `cpu_reference.rs`.
5. Add a small dispatch abstraction that still only uses CPU at first.
6. Keep public Rust API unchanged:
   - `run_problem`
   - `run_reference_fdm`

### Acceptance

- no user-visible behavior change,
- current tests still pass,
- current smoke still passes,
- no runner source file exceeds ~1000 lines.

## WP1 — Freeze concrete FDM ABI

### Goal

Create the stable native contract before writing kernels.

### Files to modify/create

- `native/include/fullmag_fdm.h`
- `native/include/fullmag_backend.h`
- `docs/plans/active/phase-2-gpu-fdm-calibrated-rollout.md`

### Tasks

1. Add `fullmag_fdm.h` with the concrete ABI from §6.
2. Keep `fullmag_backend.h`, but do not use it as the implementation contract.
3. If needed, mark `fullmag_backend.h` as generic/placeholder in comments.
4. Update docs that still mention `native/fdm-cuda/` if implementation is using
   `native/backends/fdm/`.

### Acceptance

- the ABI is explicit and non-templated,
- Rust can declare it manually without bindgen,
- the ABI is sufficient for one-step execution and field retrieval.

## WP2 — Native build skeleton

### Goal

Make the CUDA backend compile as a standalone native library before any Rust integration.

### Files to modify/create

- `native/CMakeLists.txt`
- `native/backends/fdm/CMakeLists.txt`
- `native/backends/fdm/src/api.cpp`
- `native/backends/fdm/src/context.cpp`
- `native/backends/fdm/src/context.cu`
- `native/backends/fdm/src/error.cpp`
- `native/backends/fdm/tests/smoke_context.cpp`

### Tasks

1. Make CUDA optional at configure time:
   - `FULLMAG_ENABLE_CUDA=ON|OFF`
2. When CUDA is enabled:
   - enable CUDA language,
   - find toolkit,
   - build a shared library target for FDM backend.
3. When CUDA is disabled:
   - the native build should still configure cleanly.
4. Implement a smoke backend handle:
   - create
   - destroy
   - availability check
   - device info
5. Add one simple CTest smoke test.

### Acceptance

- native build succeeds with CUDA enabled on a CUDA machine,
- native build does not break non-CUDA development,
- smoke test can create and destroy a backend handle.

## WP3 — Rust FFI crate and build wiring

### Goal

Allow Rust to link to the native backend cleanly and optionally.

### Files to modify/create

- `crates/fullmag-fdm-sys/Cargo.toml`
- `crates/fullmag-fdm-sys/build.rs`
- `crates/fullmag-fdm-sys/src/lib.rs`
- workspace `Cargo.toml`
- `crates/fullmag-runner/Cargo.toml`

### Tasks

1. Add raw C declarations manually in `src/lib.rs`.
2. Use `build.rs` with the `cmake` crate to build `native/` when CUDA is enabled.
3. Gate the native backend behind a Cargo feature or env condition.
4. Ensure `cargo test --workspace` still passes on non-CUDA machines.
5. Expose only raw FFI in this crate.
6. Keep all safe wrappers in `fullmag-runner`.

### Acceptance

- workspace builds with no CUDA toolkit installed,
- workspace can build native CUDA path when enabled,
- raw FFI stays isolated in one crate.

## WP4 — Safe Rust wrapper and engine dispatch

### Goal

Create a runner-side safe interface to the native backend and hook runtime engine selection.

### Files to modify/create

- `crates/fullmag-runner/src/native_fdm.rs`
- `crates/fullmag-runner/src/dispatch.rs`
- `crates/fullmag-runner/src/lib.rs`

### Tasks

1. Implement a safe Rust wrapper around:
   - backend creation
   - one-step execution
   - field copying
   - device info retrieval
   - error handling
2. Introduce internal engine selection:
   - `auto`
   - `cpu`
   - `cuda`
3. Read selector from:
   - `FULLMAG_FDM_EXECUTION`
4. Preserve fallback behavior:
   - `auto` falls back to CPU if CUDA backend unavailable
5. Preserve hard failure behavior:
   - `cuda` must error if CUDA backend unavailable

### Acceptance

- runner can instantiate the native wrapper,
- runner still works in CPU-only environments,
- dispatch semantics are deterministic and documented.

## WP5 — GPU `double` exchange field and energy

### Goal

Implement the first numerically meaningful CUDA operator.

### Files to modify/create

- `native/backends/fdm/src/exchange_fp64.cu`
- `native/backends/fdm/src/reductions_fp64.cu`
- `native/backends/fdm/tests/exchange_fp64_parity.cu`
- `crates/fullmag-runner/src/native_fdm.rs`

### Tasks

1. Store `m` internally in SoA:
   - `mx`
   - `my`
   - `mz`
2. Store `H_ex` internally in SoA:
   - `hex`
   - `hey`
   - `hez`
3. Implement the 6-point exchange stencil in CUDA for `fp64`.
4. Match boundary semantics exactly:
   - clamped neighbors like the current CPU reference
5. Implement exchange energy reduction for `fp64`.
6. Implement `copy_field_f64` for:
   - `m`
   - `H_ex`
7. Add parity tests on deterministic grids.

### Required parity cases

1. uniform state:
   - `H_ex = 0`
   - `E_ex = 0`
2. 3x1x1 toy stencil:
   - compare exact field values against CPU
3. small random box:
   - compare full field and scalar energy against CPU

### Acceptance

- Tier A parity passes for exchange field and energy,
- field copies are correct and host-visible,
- no time stepping yet required for this work package.

## WP6 — GPU `double` LLG RHS and Heun stepping

### Goal

Complete the first real CUDA execution loop.

### Files to modify/create

- `native/backends/fdm/src/llg_fp64.cu`
- `native/backends/fdm/src/context.cu`
- `native/backends/fdm/tests/heun_fp64_parity.cu`
- `crates/fullmag-runner/src/native_fdm.rs`
- `crates/fullmag-runner/src/dispatch.rs`

### Tasks

1. Add device buffers:
   - `k1x`, `k1y`, `k1z`
   - `tmpx`, `tmpy`, `tmpz`
2. Implement:
   - RHS evaluation
   - predictor normalization
   - corrector normalization
3. Compute step diagnostics:
   - `E_ex`
   - `max_h_eff`
   - `max_dm_dt`
4. Expose one step through the ABI:
   - `fullmag_fdm_backend_step(...)`
5. Make Rust runner loop with the native backend instead of CPU engine when selected.

### Required parity cases

1. one-step parity on a deterministic initial condition
2. multi-step parity on a small random grid
3. `exchange_relax.py` parity on a reduced stop time

### Acceptance

- GPU `double` can execute full runs through the Rust runner,
- `Simulation.run()` and `fullmag script.py` work with CUDA selected,
- Tier A parity passes on full-run outputs.

## WP7 — Metadata, provenance, and artifact parity

### Goal

Preserve application semantics when switching execution engine.

### Files to modify/create

- `crates/fullmag-runner/src/artifacts.rs`
- `docs/specs/capability-matrix-v0.md`
- `docs/plans/active/implementation-status-and-next-plans-2026-03-23.md`

### Tasks

1. Add runner metadata fields:
   - `execution_engine`
   - `execution_precision`
   - `device_name`
   - `compute_capability`
   - `driver_version`
   - `runtime_version`
2. Keep field/artifact names unchanged:
   - `m`
   - `H_ex`
   - `E_ex`
3. Ensure CPU and GPU write the same artifact families.
4. Ensure the same Python script produces comparable metadata and output structure.

### Acceptance

- artifact consumers do not need separate CPU vs GPU code paths,
- metadata explicitly shows which execution engine ran,
- provenance is sufficient for compare tooling.

## WP8 — Compare harness and calibration automation

### Goal

Make parity repeatable, not anecdotal.

### Files to modify/create

- `scripts/compare_fdm_cpu_gpu.py`
- `scripts/run_python_ir_smoke.py`
- GPU-specific test scripts or test targets

### Tasks

1. Add a script that:
   - runs the same Python example twice,
   - once with `FULLMAG_FDM_EXECUTION=cpu`,
   - once with `FULLMAG_FDM_EXECUTION=cuda`,
   - compares:
     - `E_ex(t)`
     - final `m`
     - selected metadata fields
2. Extend smoke coverage to include GPU lanes when available.
3. Record parity tolerances in the script or a small config file.

### Acceptance

- one command can evaluate CPU vs GPU parity,
- the harness can be reused for future terms,
- parity checks are not trapped inside ad hoc notebook work.

## WP9 — GPU `single`

### Goal

Add the performance-oriented precision mode only after `double` is trustworthy.

### Files to modify/create

- `native/backends/fdm/src/exchange_fp32.cu`
- `native/backends/fdm/src/llg_fp32.cu`
- `native/backends/fdm/src/reductions_fp32.cu`
- `native/backends/fdm/tests/single_precision_smoke.cu`
- `crates/fullmag-runner/src/native_fdm.rs`
- docs:
  - `docs/specs/capability-matrix-v0.md`
  - `docs/plans/active/phase-2-gpu-fdm-calibrated-rollout.md`
  - `docs/plans/active/implementation-status-and-next-plans-2026-03-23.md`

### Tasks

1. Add `fp32` device state and kernels.
2. Keep ABI-visible outputs as `f64`.
3. Compare `GPU single` against `GPU double`, not directly against CPU.
4. Promote `single` to public-executable only when Tier B passes.

### Acceptance

- `precision="single"` works on the CUDA backend,
- Tier B tolerances pass,
- provenance clearly marks `single`.

## 9. Exact implementation order

The implementing model should follow this order and should not skip ahead:

1. WP0 — runner refactor
2. WP1 — freeze ABI
3. WP2 — native build skeleton
4. WP3 — Rust FFI crate
5. WP4 — safe wrapper and dispatch
6. WP5 — GPU `double` exchange
7. WP6 — GPU `double` Heun
8. WP7 — metadata/artifact parity
9. WP8 — compare harness
10. WP9 — GPU `single`

Do not start WP9 until WP6 and WP8 are passing.

## 10. Required commands

## 10.1 Non-CUDA lane

These must keep passing throughout the work:

```bash
cargo test --workspace
python3 scripts/check_repo_consistency.py
python3 scripts/check_physics_docs_gate.py --base HEAD --head WORKTREE
docker compose run --rm --no-deps dev bash -lc 'pnpm --dir apps/web typecheck'
docker compose run --rm --no-deps dev bash -lc 'python3 -m venv /tmp/fullmag-venv && . /tmp/fullmag-venv/bin/activate && pip install -e packages/fullmag-py && python -m unittest discover -s packages/fullmag-py/tests -v'
```

## 10.2 CPU application smoke

```bash
docker compose run --rm --no-deps dev bash -lc 'export PATH=/usr/local/cargo/bin:$PATH && python3 -m venv /tmp/fullmag-venv && . /tmp/fullmag-venv/bin/activate && pip install -e packages/fullmag-py maturin && maturin develop --manifest-path crates/fullmag-py-core/Cargo.toml && FULLMAG_FDM_EXECUTION=cpu fullmag examples/exchange_relax.py --until 2e-9 --output-dir /tmp/fullmag-run-cpu'
```

## 10.3 CUDA native smoke

Example target commands:

```bash
cmake -S native -B build/native -DFULLMAG_ENABLE_CUDA=ON
cmake --build build/native -j
ctest --test-dir build/native --output-on-failure
```

## 10.4 CUDA application smoke

```bash
docker compose run --rm --no-deps dev bash -lc 'export PATH=/usr/local/cargo/bin:$PATH && python3 -m venv /tmp/fullmag-venv && . /tmp/fullmag-venv/bin/activate && pip install -e packages/fullmag-py maturin && maturin develop --manifest-path crates/fullmag-py-core/Cargo.toml && FULLMAG_FDM_EXECUTION=cuda fullmag examples/exchange_relax.py --until 2e-9 --output-dir /tmp/fullmag-run-gpu'
```

## 11. Acceptance gates

## Gate A — skeleton ready

- native build works,
- Rust can link optionally,
- CPU-only workflows still pass.

## Gate B — exchange parity

- GPU `double` exchange field and energy match CPU reference under Tier A tolerances.

## Gate C — full-run parity

- `exchange_relax.py` runs through CUDA,
- final energy and magnetization match CPU reference under Tier A tolerances,
- artifact semantics are unchanged.

## Gate D — single precision qualification

- `precision="single"` runs through CUDA,
- GPU `single` vs GPU `double` passes Tier B tolerances,
- provenance marks precision clearly.

Phase 2 is not complete until Gate D passes.

## 12. Common mistakes the implementing model must avoid

1. Do not rewrite the public Python API.
2. Do not move artifact writing into CUDA code.
3. Do not skip CPU fallback.
4. Do not validate `single` before `double`.
5. Do not silently change boundary handling.
6. Do not silently change exchange energy definition.
7. Do not expose CUDA details in shared Python objects or `ProblemIR`.
8. Do not create a second native directory layout when `native/backends/fdm/` already exists.
9. Do not let one giant Rust runner file keep growing.
10. Do not mark Phase 2 complete after only the policy/plumbing work.

## 13. Definition of done for the next implementing model

The implementing model can claim success for the main Phase 2 target only when all of the
following are true:

1. `fullmag examples/exchange_relax.py --until 2e-9` works on CPU and CUDA through the same
   public entrypoint.
2. CPU `double` remains available as a fallback and reference path.
3. GPU `double` is the default CUDA calibration baseline.
4. GPU `single` is not promoted until validated.
5. Artifacts remain stable and provenance becomes richer.
6. Compare/parity tooling exists and is reusable.
7. The relevant docs are updated honestly:
   - Phase 2 rollout plan
   - implementation status
   - capability matrix
   - physics note(s)

## 14. What to do immediately after this playbook lands

The next implementation task should be:

> WP0 + WP1 together:
> refactor the runner for multi-engine execution and freeze the concrete FDM C ABI.

That is the safest first slice because it creates the right seams before CUDA kernel work begins.
