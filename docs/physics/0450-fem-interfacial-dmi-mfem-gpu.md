
# Interfacial DMI in FEM on MFEM/libCEED/hypre with GPU

- Status: draft
- Owners: Fullmag core
- Last updated: 2026-03-24
- Related ADRs:
  - `docs/adr/0001-physics-first-python-api.md`
- Related specs:
  - `docs/specs/problem-ir-v0.md`
  - `docs/specs/capability-matrix-v0.md`
  - `docs/specs/output-naming-policy-v0.md`
- Related physics notes:
  - `docs/physics/0000-physics-documentation-standard.md`
  - `docs/physics/0050-shared-problem-semantics-and-embedded-python-api.md`
  - `docs/physics/0410-fem-exchange-demag-zeeman-mfem-gpu.md`
  - `docs/physics/0440-fdm-interfacial-dmi.md`
  - `docs/physics/0430-fem-dipolar-demag-mfem-gpu-foundations.md`

## 1. Problem statement

This note defines how **interfacial Dzyaloshinskii–Moriya interaction (DMI)** should be
implemented in the **finite-element** backend of Fullmag, using the target architecture:

- MFEM for meshes, spaces, forms, and operator composition,
- libCEED for accelerator-oriented element and quadrature kernels,
- hypre for global linear algebra where needed,
- GPU-resident operator application whenever practical.

Scope:

- one reduced magnetization field `m(x,t)` with `|m|=1`,
- one scalar interfacial DMI constant `D` in `J/m^2`,
- one global interface axis fixed to `+z` in the first implementation,
- low-order vector `H^1` finite elements as the bootstrap FE representation,
- coexistence with exchange, demag, and Zeeman in the same FEM stack.

This note does **not** cover bulk DMI, curved-manifold shell DMI, or
arbitrary-axis chiral interactions. Those are deferred.

## 2. Physical model

### 2.1 Governing equations

Let

\[
m : \Omega \to \mathbb{R}^3, \qquad |m|=1
\]

be the reduced magnetization and `M = M_s m` the physical magnetization.

For interfacial DMI with axis `\hat z`, the energy is

\[
E_{\mathrm{iDMI}}[m]
=
D \int_\Omega
\left[
m_z \nabla\cdot m - (m\cdot\nabla)m_z
\right] dV.
\]

Equivalently,

\[
E_{\mathrm{iDMI}}[m]
=
D\int_\Omega
\left(
m_z \partial_x m_x - m_x \partial_x m_z
+
m_z \partial_y m_y - m_y \partial_y m_z
\right)dV.
\]

Taking a variation `m \mapsto m + \varepsilon v` gives

\[
\delta E_{\mathrm{iDMI}}(m;v)
=
D\int_\Omega
\left[
v_z(\partial_x m_x + \partial_y m_y)
+
m_z(\partial_x v_x + \partial_y v_y)
-
v_x\partial_x m_z
-
m_x\partial_x v_z
-
v_y\partial_y m_z
-
m_y\partial_y v_z
\right] dV.
\]

If integrated by parts, the strong-form effective field is

\[
H_{\mathrm{iDMI}}
=
\frac{2D}{\mu_0 M_s}
\begin{bmatrix}
\partial_x m_z \\
\partial_y m_z \\
-(\partial_x m_x + \partial_y m_y)
\end{bmatrix},
\]

and the free-boundary term is

\[
D \int_{\partial\Omega}
\big[(\hat z \times \nu)\times m\big]\cdot v \, dS.
\]

With exchange present, the natural boundary law is

\[
2A\partial_\nu m + D[(\hat z \times \nu)\times m] = 0.
\]

### 2.2 Why the weak residual is the primary FEM object

For FEM, the most robust primary object is **not** the strong-form field but the
first-variation residual

\[
R_{\mathrm{iDMI}}(m;v) = \delta E_{\mathrm{iDMI}}(m;v).
\]

This has three major advantages:

1. it is the object that finite elements discretize naturally;
2. natural boundary conditions arise automatically when the energy variation is used directly;
3. it maps cleanly onto MFEM `NonlinearForm` / libCEED QFunction patterns.

The DMI field is then recovered by a mass-matrix projection:

\[
\mu_0 \int_\Omega M_s H_{\mathrm{iDMI},h}\cdot v_h \, dV
=
- R_{\mathrm{iDMI}}(m_h;v_h)
\qquad
\forall v_h \in V_h^3.
\]

### 2.3 Symbols and SI units

| Symbol | Meaning | Unit |
|---|---|---|
| `m` | reduced magnetization | 1 |
| `M=M_s m` | physical magnetization | A/m |
| `M_s` | saturation magnetization | A/m |
| `A` | exchange stiffness | J/m |
| `D` | interfacial DMI constant | J/m² |
| `\mu_0` | vacuum permeability | N/A² |
| `H_iDMI` | interfacial DMI field | A/m |
| `E_iDMI` | interfacial DMI energy | J |
| `V_h` | vector FE space for `m` | — |
| `W_h` | vector FE space or projected output space for `H_iDMI` | — |

### 2.4 Assumptions and approximations

The first Fullmag FEM interfacial DMI implementation assumes:

- `V_h \subset [H^1(\Omega)]^3`,
- low-order nodal vector elements first,
- one scalar `D`,
- one fixed global axis `\hat z`,
- natural boundary treatment from the weak residual,
- GPU execution through partial assembly / libCEED rather than assembled sparse operators where possible.

Deferred:

- arbitrary axis `\hat n`,
- region-dependent `D`,
- shell and manifold DMI,
- mixed spaces specialized for constrained vector fields,
- linearized eigen-operator forms.

## 3. Numerical interpretation

### 3.1 FDM

For the Cartesian grid realization, see:

- `0440-fdm-interfacial-dmi.md`

The common invariant is the continuum energy, not the discrete storage layout.

### 3.2 FEM

#### 3.2.1 Discrete space and state

Use

\[
V_h \subset [H^1(\Omega)]^3
\]

for the reduced magnetization, with

\[
m_h(\mathbf{x}) = \sum_a m_a \phi_a(\mathbf{x}),
\qquad
m_a \in \mathbb{R}^3.
\]

At the bootstrap stage, nodal renormalization after accepted steps is acceptable.
Later tangent-plane formulations can tighten geometric fidelity.

#### 3.2.2 Weak-form residual

Let `G = \nabla m` be the `3\times 3` gradient matrix with entries `G_{\alpha\beta} = \partial_\beta m_\alpha`.
For the chosen sign convention,

\[
w_{\mathrm{iDMI}}(m,G)
=
D\left[
m_z(G_{xx}+G_{yy}) - m_x G_{zx} - m_y G_{zy}
\right].
\]

The first variation can be written in standard FE form

\[
R_{\mathrm{iDMI}}(m_h;v_h)
=
\int_\Omega
\frac{\partial w}{\partial m}(m_h,\nabla m_h)\cdot v_h
+
\frac{\partial w}{\partial \nabla m}(m_h,\nabla m_h):\nabla v_h
\, dV.
\]

For this energy density,

\[
\frac{\partial w}{\partial m}
=
D
\begin{bmatrix}
- G_{zx} \\
- G_{zy} \\
G_{xx}+G_{yy}
\end{bmatrix},
\]

and the only nonzero entries of `\partial w/\partial \nabla m` are

\[
\frac{\partial w}{\partial G_{xx}} = D m_z,
\qquad
\frac{\partial w}{\partial G_{yy}} = D m_z,
\qquad
\frac{\partial w}{\partial G_{zx}} = -D m_x,
\qquad
\frac{\partial w}{\partial G_{zy}} = -D m_y.
\]

This representation is ideal for a libCEED QFunction:
the QFunction receives `m` and `\nabla m` at quadrature points and returns

- value contributions proportional to `\partial w/\partial m`,
- gradient contributions proportional to `\partial w/\partial \nabla m`.

#### 3.2.3 Why no explicit boundary integrator is needed in v1

If the DMI term is implemented directly from the energy first variation above,
the free-surface boundary physics is already encoded in the weak formulation.

Therefore the first FEM implementation should **not** add a separate boundary integrator
for DMI in the free-surface case.
Doing so would double-count the same physics.

A separate boundary contribution is only needed later if the user requests
explicit non-natural boundary conditions.

#### 3.2.4 Field projection

For outputs or for an LLG implementation that explicitly uses field vectors,
recover `H_iDMI,h` from

\[
M_{\mu_0 M_s} H_{\mathrm{iDMI},h} = -g_{\mathrm{iDMI}}(m_h),
\]

where

- `M_{\mu_0 M_s}` is the weighted vector mass operator,
- `g_{\mathrm{iDMI}}(m_h)` is the Riesz-represented residual.

Recommended bootstrap choice:

- use a diagonal or lumped mass operator for explicit integrators,
- retain the option of consistent-mass projection for higher-fidelity diagnostics.

#### 3.2.5 MFEM + libCEED + hypre implementation split

Recommended software split:

- **MFEM**
  - owns mesh, FE spaces, `NonlinearForm`, restrictions, and finite-element metadata;
- **libCEED**
  - owns quadrature-point operator evaluation for DMI residual and optional energy density;
- **hypre**
  - is only needed when a nontrivial global solve is required, e.g. demag or consistent-mass projection.

For DMI itself, the preferred path is fully matrix-free / partial-assembly first.

#### 3.2.6 GPU realization

At each quadrature point the GPU kernel should evaluate:

1. `m_q`,
2. `\nabla m_q`,
3. `w_iDMI(m_q,\nabla m_q)`,
4. `\partial w/\partial m`,
5. `\partial w/\partial \nabla m`.

The operator then accumulates into element residuals and applies them without assembling
a global sparse DMI matrix.

This is exactly the type of operator libCEED is good at:

- first-derivative local physics,
- low arithmetic intensity but strong structure,
- repeated application inside time integrators or minimizers.

### 3.3 Hybrid

Deferred.
Any future hybrid grid/mesh coupling must preserve the same weak DMI energy.

## 4. API, IR, and planner impact

### 4.1 Python API surface

The current term

```python
fm.InterfacialDMI(D=...)
```

is enough for the first implementation if the axis is frozen by spec.
Future extension path:

```python
fm.InterfacialDMI(D=..., axis=(0,0,1))
```

### 4.2 ProblemIR representation

The current IR term

```json
{ "kind": "interfacial_dmi", "D": ... }
```

is sufficient for v1 with axis frozen to `+z`.
Planner provenance should additionally record:

- `dmi_kind = "interfacial"`,
- `dmi_axis = [0,0,1]`,
- `dmi_sign_convention = "mz_divm_minus_m_dot_grad_mz"`.

### 4.3 Planner and capability-matrix impact

Strict-mode planner rules:

- require positive `D`,
- require at least one ferromagnetic body,
- for first FEM public implementation, require `Exchange` if free boundaries are used,
- record whether the field is realized through lumped or consistent mass projection,
- record whether the operator is partial assembly / libCEED or fallback assembled CPU.

Capability matrix should split semantic support from executable backend support.

## 5. Validation strategy

### 5.1 Analytical checks

1. **Uniform state**
   \[
   m = \text{const}
   \Rightarrow
   H_iDMI = 0,\quad E_iDMI = 0.
   \]

2. **1D Néel spiral**
   \[
   m(x) = (\sin qx,0,\cos qx),
   \]
   yielding constant energy density `Dq` and field parallel to `m`.

3. **Sign reversal**
   `D \to -D` must flip chirality and DMI observables.

### 5.2 Cross-backend checks

For the same `Box` and same sampled `m0`:

- compare `E_iDMI`,
- compare projected `H_iDMI`,
- compare relaxed wall chirality and edge canting,
- compare solver traces once both methods are executable.

### 5.3 Regression tests

- discrete residual vs numerical directional derivative of `E_iDMI`,
- CPU assembled/fallback vs libCEED partial assembly parity,
- projected field parity under lumped vs consistent mass in smooth cases,
- strip-edge canting benchmark.

## 6. Completeness checklist

- [ ] Python API
- [ ] ProblemIR
- [ ] Planner
- [ ] Capability matrix
- [ ] FDM backend
- [ ] FEM backend
- [ ] Hybrid backend
- [ ] Outputs / observables
- [ ] Tests / benchmarks
- [ ] Documentation

## 7. Known limits and deferred work

- no bulk DMI here,
- no arbitrary axis,
- no region-dependent `D`,
- no explicit shell DMI,
- no eigenmode linearization yet,
- no hybrid realization yet.

## 8. References

Internal references:

- `docs/physics/0410-fem-exchange-demag-zeeman-mfem-gpu.md`
- `docs/physics/0440-fdm-interfacial-dmi.md`
