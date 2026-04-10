# Fullmag

Fullmag is a micromagnetics platform built around one contract:

> the shared interface describes a physical problem, not a numerical mesh layout

Officially, the user-facing product is still intended to feel like **one application**:

- one public launcher: `fullmag`
- one local control room in the browser
- managed compute runtimes under the hood

For lightweight paths this can mean bundled binaries/libraries.
For heavyweight GPU paths, especially FEM on `MFEM + libCEED + hypre`, the canonical direction is a
managed runtime container rather than one giant monolithic executable.

For HPC, the primary assumption is **external dispatch**:

- systems such as Microlab may place one task on one node,
- and the node-local executable is still simply:
  - `fullmag task1.py`

The public authoring surface is an embedded, declarative Python DSL in `packages/fullmag-py`.
Users write ordinary Python scripts and notebooks, but those objects serialize into a canonical `ProblemIR` that Rust validates, normalizes, and lowers into backend-specific plans.

## Backend Authority Policy

Each solver method has one **authoritative production backend** and one **reference/validation backend**.

### FDM (Finite-Difference Method)
| Role | Backend | Location |
|---|---|---|
| **Production CPU/HPC** | Rust engine (SoA, threaded FFT, NUMA-aware) | `crates/fullmag-engine` |
| **Production GPU** | Native CUDA FDM | `native/backends/fdm` |
| **Reference/validation** | Rust CPU reference (sequential) | `crates/fullmag-engine` |

### FEM (Finite-Element Method)
| Role | Backend | Location |
|---|---|---|
| **Production CPU/GPU** | MFEM-native (hypre, libCEED) | `native/backends/fem` |
| **Reference/validation** | Rust CPU FEM reference | `crates/fullmag-engine/src/fem.rs` |

The Rust FEM reference is **not** the production CPU path. It serves as:
- golden baseline for regression tests,
- validation oracle for FDM↔FEM parity checks,
- lightweight development/debugging tool.

All production FEM workloads dispatch to MFEM-native.

### FEM Demag Policy
| Realization | Role | Notes |
|---|---|---|
| **Poisson (Robin/Dirichlet)** | Production demag | Authoritative open-boundary solve |
| **Transfer-grid** | Bootstrap / preview / parity | Not production for HPC |

### Dispatch Names
Runtime dispatch uses explicit backend identifiers:
- `fdm_cpu_reference` — Rust FDM sequential reference
- `fdm_cpu_hpc` — Rust FDM production (SoA + threaded FFT + NUMA)
- `fem_cpu_reference` — Rust FEM reference
- `fem_cpu_native` — MFEM-native CPU production
- `fem_gpu_native` — MFEM-native GPU production

## Architecture

- `packages/fullmag-py` — embedded Python DSL and runtime scaffolding
- `crates/fullmag-ir` — typed `ProblemIR`, validation, and planning summaries
- `crates/fullmag-cli` — Rust-hosted local launcher, validation, planning, and session bootstrap
- `crates/fullmag-api` — control-plane HTTP API
- `crates/fullmag-py-core` — private PyO3 bridge for Python/Rust integration
- `apps/web` — Next.js control room
- `native/` — native FDM/FEM/hybrid backend seams behind C ABI
- `external_solvers/` — reference solver codebases (gitignored): mumax3, mumax+, BORIS, tetmag, tetrax
- `docs/` — specs, ADRs, and publication-style physics notes

### FEM mesh contract

For FEM, Fullmag is expected to preserve three separate semantic layers:

1. `Universe mesh config` — meshing policy for the study-level air/domain region
2. `Per-object mesh config` — independent meshing policy for each magnetic object
3. `Final shared-domain solver mesh` — one conforming mesh assembled from Universe + objects

This means:

- users must be able to inspect and tune the mesh of `Universe` and of each object separately,
- the final solver mesh must still be one shared-domain FEM mesh,
- UI visibility or isolate mode must never change the physical solver domain,
- air/domain meshing is expected to be coarser than object/interfacial meshing where appropriate.

## Execution chain

```text
fullmag script.py
        |
        +--> Rust host
        |      |
        |      +--> spawn Python helper in the active environment
        |             |
        |             +--> load script + build canonical ProblemIR
        |
        v
Rust validation + normalization + planning + session bootstrap
        |
        +--> FDM backend
        +--> FEM backend
        +--> Hybrid backend
```

In the current bootstrap shell, the normal local workflow is:

```bash
fullmag examples/exchange_relax.py
fullmag examples/exchange_demag_zeeman.py
fullmag -i examples/exchange_relax.py
```

By default this attempts to:

- run the simulation,
- create or update the singleton local live workspace under `.fullmag/local-live/`,
- start the current-live control room,
- open the browser to `/`.

The control room now reuses one local web server URL when possible, instead of allocating a new
port for every run.

Use `--headless` to suppress the UI bootstrap.
Use `-i` / `--interactive` to keep the CLI open after the run completes.

## Golden rule

Before implementing any new physics or numerics feature, create or update a publication-style note in `docs/physics/`.
The note must cover equations, symbols, SI units, assumptions, backend interpretation, `ProblemIR` impact, validation strategy, completeness, and deferred work.

## Current bootstrap state

The repository now includes:

- a real Python package scaffold in `packages/fullmag-py`,
- `Model + Study + Runtime` public API with `TimeEvolution`,
- typed `ProblemIR` and `StudyIR` sections in Rust,
- a Rust-hosted `fullmag script.py` launcher path with a spawned Python helper,
- a singleton local current-live workspace API with `session_state` streaming,
- binary WebSocket preview transport for heavy live vector payloads,
- a canonical Python example in `examples/dw_track.py`,
- mirrored agent instructions between `.agents` and `.github`,
- repo consistency checks and a hard `docs/physics` gate in CI.

This is still a foundation milestone. The shell of the application now exists, but live control-room
behavior and GPU/FEM depth are still in progress.

The currently honest executable physics slice is:

- `Box + Exchange + Demag + Zeeman + TimeEvolution(LLG-Heun) + FDM`
- CPU reference in `double`
- native CUDA FDM in `double`
- native CUDA `single` implementation exists but is not yet public-qualified

### FEM solver maturity (Etap A4 — TRANSITIONAL)

The FEM backend (`native/backends/fem/`) is functional but carries known limitations:

- **Demag**: only `transfer_grid` (uniform FFT tensor) is implemented; direct Poisson and BEM paths are planned.
- **CUDA kernels**: `double` precision only — `float` kernels are not yet available.
- **Eigensolver**: dense O(n³) path via cuSolverDN Dsygvd; practical for ≲ 3 000 DOF. A sparse/Krylov path is planned.
- **GPU selection**: controlled via `gpu_device_index` in `FemPlanIR` or the `FULLMAG_FEM_GPU_INDEX` / `FULLMAG_CUDA_DEVICE_INDEX` environment variables.
- **MFEM device string**: controlled via the `FULLMAG_FEM_MFEM_DEVICE` environment variable (process-global singleton).

These constraints are enforced at plan-validation time; unsupported configurations are rejected with clear error messages rather than silently degraded.

## Quick start

### 1. Set up environment

```bash
cp .env.example .env
# Edit .env and set POSTGRES_PASSWORD, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD
```

### 2. Bring up the dev container

```bash
make up
make shell
```

### 3. Verify the bootstrap in the container

```bash
cargo check --workspace
cargo test --workspace
/usr/local/cargo/bin/cargo build -p fullmag-cli --bin fullmag
python3 -m venv .venv
. .venv/bin/activate
pip install -e 'packages/fullmag-py[meshing]'
PYTHONPATH=packages/fullmag-py/src python -m unittest discover -s packages/fullmag-py/tests -v
python3 scripts/check_repo_consistency.py
python scripts/run_python_ir_smoke.py --cli target/debug/fullmag
/usr/local/cargo/bin/cargo run -p fullmag-cli --bin fullmag -- reference-exchange-demo --steps 10 --dt 1e-13
/usr/local/cargo/bin/cargo run -p fullmag-cli --bin fullmag -- examples/exchange_relax.py --json
/usr/local/cargo/bin/cargo run -p fullmag-cli --bin fullmag --features cuda -- examples/exchange_demag_zeeman.py --json
```

### 3b. Build the production-style FEM GPU runtime container

```bash
make fem-gpu-build
make fem-gpu-check
make fem-gpu-test
```

This uses the dedicated `fem-gpu` container with:

- CUDA toolkit
- MFEM
- libCEED
- hypre
- Rust nightly
- Node 22 + pnpm 10 for the control room stack

and builds the native FEM backend with `FULLMAG_USE_MFEM_STACK=ON`.

### 4. Install the local launcher on your PATH

```bash
make install-cli
export PATH="$PWD/.fullmag/local/bin:$PATH"
fullmag --help
```

Alternative task entrypoint via `just`:

```bash
just build fullmag
export PATH="$PWD/.fullmag/local/bin:$PATH"
just run-py-layer-hole
```

Heavy runtime build in container, exported back to the host:

```bash
just build fem-gpu-runtime-host
just package fullmag
```

This keeps the heavyweight FEM GPU toolchain in the managed build container while producing a
host-side runtime bundle under `.fullmag/runtimes/` and a host package staging directory under
`.fullmag/dist/`.

### 5. Run the current-live control room manually

```bash
./scripts/dev-control-room.sh
# or for a specific completed session:
./scripts/dev-control-room.sh session-1234567890-12345
# stop stale local control-room processes if needed:
make control-room-stop
```

This starts:

- `fullmag-api` on `http://localhost:8080`
- the Next.js control room on `http://localhost:3000`

The current local browser flow targets the singleton workspace at `/`.
Live control data is streamed through `/ws/live/current`, and heavy preview vectors are delivered as
binary WebSocket frames instead of inline JSON arrays.

### 6. Inspect the canonical example

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e packages/fullmag-py
python - <<'PY'
from fullmag import load_problem_from_script
loaded = load_problem_from_script("examples/dw_track.py")
print(loaded.problem.to_ir())
PY
```

## Key documents

- `docs/1_project_scope.md`
- `docs/2_repo_blueprint.md`
- `docs/adr/0001-physics-first-python-api.md`
- `docs/specs/runtime-distribution-and-managed-backends-v1.md`
- `docs/specs/hpc-cluster-execution-v1.md`
- `docs/specs/problem-ir-v0.md`
- `docs/specs/capability-matrix-v0.md`
- `docs/physics/README.md`
- `docs/physics/0000-physics-documentation-standard.md`

## Near-term priorities

1. Expand the Python DSL and keep it backend-neutral.
2. Keep `ProblemIR` typed and planner-ready.
3. Grow capability checks before backend feature sprawl.
4. Add planning-depth smoke coverage before solver-depth implementation.
5. Maintain the physics-first publication workflow as a hard gate.
6. Auto-render `docs/physics/` notes into frontend documentation pages.

## HPC Build Profiles (E1)

| Profile | Contents |
|---|---|
| `fullmag-cpu-reference` | Rust engine only, sequential, no MPI |
| `fullmag-fdm-cpu-hpc` | Rust FDM + Rayon + threaded FFT + NUMA |
| `fullmag-fem-cpu-native` | MFEM-native CPU (hypre, libCEED) |
| `fullmag-fem-gpu-native` | MFEM-native GPU (CUDA, libCEED-CUDA) |
| `fullmag-mpi` | Distributed: MPI + distributed FFT |

### Build matrix dependencies

- Rust toolchain (see `rust-toolchain.toml`)
- CMake ≥ 3.20
- MFEM + hypre + libCEED (FEM profiles)
- MPI implementation (OpenMPI or MPICH)
- FFT backend: rustfft (default), FFTW, MKL (optional)
- Optional: BLAS/LAPACK for dense kernels

### Reproducible builds

- Container runtimes: Docker / Apptainer (Singularity)
- Module files for cluster environments
- Locked Rust toolchain via `rust-toolchain.toml`

## Scheduler Integration (E2)

### SLURM launch templates

```bash
# Single-node multi-threaded FDM
srun --ntasks=1 --cpus-per-task=$NTHREADS fullmag task.py

# Multi-node MPI FDM
srun --ntasks=$NRANKS --cpus-per-task=$THREADS_PER_RANK fullmag-mpi task.py
```

### Environment variables

| Variable | Purpose |
|---|---|
| `FULLMAG_NUM_THREADS` | Worker thread count (0 = auto) |
| `FULLMAG_NUMA_NODE` | NUMA node affinity hint |
| `FULLMAG_FFT_BACKEND` | FFT backend selection (rustfft, fftw, mkl) |
| `OMP_NUM_THREADS` | OpenMP threads (for MFEM/hypre) |
| `OMP_PLACES` | Thread placement (cores, threads) |
| `OMP_PROC_BIND` | Thread binding (close, spread) |

### CPU binding policy

- Rayon workers: one per physical core, bound to core
- MFEM/hypre threads: inherit from `OMP_PLACES=cores` + `OMP_PROC_BIND=close`
- MPI ranks: one per NUMA domain, `--bind-to socket`

## Production Acceptance Matrix (E3)

### FDM CPU/HPC
- [x] Zero hot-loop allocations (B1)
- [x] SoA internal state type (B2)
- [x] Threaded FFT backend abstraction (B4)
- [x] Multi-socket scaling infrastructure (B8)
- [x] Domain decomposition + halo exchange (B9)
- [x] Distributed FFT backend abstraction (B10)
- [x] Benchmark suite (A0)
- [x] Physics guardrails (A2)

### FEM CPU/HPC
- [x] Authoritative backend decision documented (C1)
- [x] Reference semantics validated (C2)
- [x] No-alloc integrator workspace (C3)
- [x] Assembly improvement (C4)
- [x] CG workspace (C5)
- [x] Demag realization policy (C6)
- [x] Transfer-grid cache (C7)
- [x] Operator mode dispatch (C8)
- [x] Data-flow audit (C9)
- [x] Production backend IDs (C10)

### Distributed HPC
- [x] Common runtime layer (D1)
- [x] FDM distributed path types (D2)
- [x] FEM distributed path types (D3)
- [x] Distributed I/O / checkpointing (D4)
