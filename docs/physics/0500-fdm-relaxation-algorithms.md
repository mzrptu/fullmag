
# Relaxation algorithms for FDM micromagnetics

- Status: draft
- Owners: Fullmag core
- Last updated: 2026-03-24
- Related ADRs:
  - `docs/adr/0001-physics-first-python-api.md`
- Related specs:
  - `docs/specs/problem-ir-v0.md`
  - `docs/specs/capability-matrix-v0.md`
- Related physics notes:
  - `docs/physics/0000-physics-documentation-standard.md`
  - `docs/physics/0400-fdm-exchange-demag-zeeman.md`
  - `docs/physics/0420-fdm-dipolar-demag-foundations.md`
  - `docs/physics/0480-fdm-higher-order-and-adaptive-time-integrators.md`

## 1. Problem statement

This note defines a roadmap for **better relaxation / energy-minimization algorithms**
in the FDM backend beyond the current “run damped LLG with fixed-step Heun” baseline.

Current repo status after the first executable alignment:

- `fm.Relaxation(...)` exists in the public Python API,
- `StudyIR::Relaxation` exists in canonical `ProblemIR`,
- planner and runner execute `algorithm="llg_overdamped"` end-to-end,
- stop criteria currently support:
  - torque tolerance,
  - optional energy tolerance,
  - max-steps hard cap,
- higher-order direct minimizers remain defined but not yet public-executable.

The goal of relaxation is not to reproduce true precessional dynamics.
The goal is to compute a low-energy or metastable state satisfying

\[
m \times H_{\mathrm{eff}} \approx 0
\]

under the unit-length constraint `|m|=1`.

Recommended algorithm families for FDM:

1. overdamped LLG with adaptive timestepping,
2. projected steepest descent with Barzilai–Borwein step selection,
3. nonlinear conjugate gradient on the product of spheres,
4. later: limited-memory quasi-Newton on the manifold.

## 2. Physical model

### 2.1 Constrained minimization problem

Given total energy

\[
E[m] = E_{\mathrm{ex}} + E_{\mathrm{demag}} + E_{\mathrm{DMI}} + E_{\mathrm{ext}} + \cdots,
\]

seek

\[
\min_{|m_i|=1 \ \forall i} E[m].
\]

The tangent-space gradient is

\[
g_i = -P_{m_i} H_{\mathrm{eff},i},
\qquad
P_{m_i} = I - m_i m_i^\top.
\]

Equivalent torque residual:

\[
\tau_i = m_i \times H_{\mathrm{eff},i},
\qquad
\|g_i\| = \|\tau_i\|.
\]

Stopping criteria should be based on torque, not only on energy stagnation.

### 2.2 Symbols and SI units

| Symbol | Meaning | Unit |
|---|---|---|
| `E` | total micromagnetic energy | J |
| `g_i` | tangent-space energy gradient at cell `i` | A/m |
| `\tau_i` | torque residual | A/m |
| `\lambda` | relaxation step length / pseudo-time step | s or dimensionless depending on algorithm |
| `m_i` | reduced magnetization at cell `i` | 1 |

### 2.3 Assumptions and approximations

This note covers deterministic relaxation only.
Deferred:

- thermal annealing,
- nudged elastic band / saddle search,
- topological transition algorithms.

## 3. Numerical interpretation

### 3.1 FDM

#### 3.1.1 Algorithm A — overdamped LLG (best bootstrap)

Use large damping and explicit adaptive integrator:

\[
\partial_t m
=
-\frac{\gamma}{1+\alpha^2}
\left[
m\times H_{\mathrm{eff}} + \alpha m\times(m\times H_{\mathrm{eff}})
\right],
\qquad
\alpha \gg 1.
\]

Practical recommendation:

- set `alpha` high (e.g. `0.5` to `1.0` or higher depending on convention),
- disable precession only later if a dedicated pure-gradient mode is added,
- integrate with adaptive DOPRI54 once available.

This is the easiest public first relaxation path because it reuses the same field pipeline as dynamics.

#### 3.1.2 Algorithm B — projected steepest descent + Barzilai–Borwein

Define tangent gradient

\[
g_i = -P_{m_i} H_{\mathrm{eff},i}.
\]

Take a trial step

\[
\tilde m_i = m_i - \lambda g_i,
\qquad
m_i^{new} = \frac{\tilde m_i}{|\tilde m_i|}.
\]

Use Barzilai–Borwein step estimates:

\[
s_n = m_n - m_{n-1},
\qquad
y_n = g_n - g_{n-1},
\]

\[
\lambda_{BB1} = \frac{\langle s_n,s_n\rangle}{\langle s_n,y_n\rangle},
\qquad
\lambda_{BB2} = \frac{\langle s_n,y_n\rangle}{\langle y_n,y_n\rangle}.
\]

Use clamped BB steps together with a backtracking line search requiring sufficient energy decrease.

Why this is attractive for FDM/GPU:

- local update,
- easy normalization,
- one energy/field evaluation per trial,
- no global linear solves.

#### 3.1.3 Algorithm C — nonlinear conjugate gradient on the sphere product

Improve over steepest descent using a transported search direction.

At iteration `n` define the tangent gradient `g_n`.
Choose a conjugacy coefficient such as Polak–Ribière+:

\[
\beta_n
=
\max\left(
0,
\frac{\langle g_n, g_n - \mathcal{T}_{n-1\to n} g_{n-1} \rangle}
{\langle g_{n-1}, g_{n-1}\rangle}
\right),
\]

where `\mathcal{T}` transports tangent vectors between consecutive points on the sphere product.

Then

\[
p_n = -g_n + \beta_n \mathcal{T}_{n-1\to n} p_{n-1}.
\]

Update along the projected/retracted direction:

\[
m^{new} = \mathcal{R}_m(\lambda p_n),
\]

where the simplest retraction is cellwise normalization.

This is the best next step after BB steepest descent.

#### 3.1.4 Algorithm D — manifold L-BFGS (later)

Once projected gradient and nonlinear CG are stable, add limited-memory BFGS on the manifold.
This will give faster convergence near minima, but it is a later step because:

- line-search logic is more delicate,
- state/history memory is larger,
- implementation complexity is higher.

#### 3.1.5 Recommended rollout order

1. Overdamped LLG + adaptive DOPRI54.
2. Projected steepest descent + BB step.
3. Nonlinear CG.
4. Later: L-BFGS.

This order matches engineering value and implementation cost.

#### 3.1.6 GPU architecture

All FDM relaxation algorithms should reuse the same GPU kernels for:

- local-field assembly,
- demag evaluation,
- energy reduction,
- torque reduction.

Additional kernels/reductions needed:

- tangent-gradient kernel,
- BB scalar reductions for `s·s`, `s·y`, `y·y`,
- line-search energy evaluation,
- NCG direction transport/update.

The expensive part remains demag, so algorithms that reduce the number of failed trial states are preferred.

### 3.2 FEM

See:

- `0510-fem-relaxation-algorithms-mfem-gpu.md`

### 3.3 Hybrid

Deferred.

## 4. API, IR, and planner impact

### 4.1 Python API surface

A dedicated study object is cleaner than overloading time evolution:

```python
fm.Relaxation(
    algorithm="projected_gradient_bb",   # or "llg_overdamped", "nonlinear_cg"
    torque_tolerance=1e-4,
    energy_tolerance=1e-10,
    max_steps=50000,
    max_time=None,
    outputs=[...],
)
```

Suggested runtime knobs:

- `initial_step`,
- `line_search`,
- `nonmonotone_window`,
- `restart_interval` for NCG.

### 4.2 ProblemIR representation

Recommended new study section:

```json
{
  "kind": "relaxation",
  "algorithm": "projected_gradient_bb",
  "torque_tolerance": 1e-4,
  "energy_tolerance": 1e-10,
  "max_steps": 50000
}
```

This now lives in `StudyIR`.

Current executable subset:

- `algorithm = "llg_overdamped"`

### 4.3 Planner and capability-matrix impact

Planner must:

- reject unsupported algorithms on unsupported backends,
- estimate extra field/energy evaluations for line searches,
- record convergence criteria and actual stop reason in provenance.

Capability matrix should separate:

- dynamic time evolution support,
- relaxation-study support.

## 5. Validation strategy

### 5.1 Analytical checks

- energy must not increase for monotone relaxation variants,
- torque must go to zero on uniform-field equilibrium,
- equilibrium should satisfy `m \parallel H_eff`.

### 5.2 Cross-backend checks

Once FEM relaxation exists:

- same initial state,
- compare final energies,
- compare final average magnetization,
- compare domain-wall/skyrmion chirality where relevant.

### 5.3 Regression tests

- exchange-only random-state relaxation,
- demag-driven shape anisotropy relaxation,
- DMI wall relaxation once DMI is implemented,
- BB step acceptance / line-search regression,
- NCG restart behavior.

## 6. Completeness checklist

- [x] Python API
- [x] ProblemIR
- [x] Planner
- [ ] Capability matrix
- [x] FDM backend (`llg_overdamped`)
- [ ] FEM backend
- [ ] Hybrid backend
- [ ] Outputs / observables
- [ ] Tests / benchmarks
- [ ] Documentation

## 7. Known limits and deferred work

- no thermal relaxation,
- no saddle-search methods,
- no manifold L-BFGS yet,
- line-search cost can be dominated by demag.

## 8. References

Internal references:

- `docs/physics/0480-fdm-higher-order-and-adaptive-time-integrators.md`
- `docs/physics/0510-fem-relaxation-algorithms-mfem-gpu.md`
