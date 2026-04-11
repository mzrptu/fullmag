# Shared magnetoelastic semantics

- Status: draft
- Owners: fullmag-core
- Last updated: 2026-03-31
- Related specs: `docs/specs/problem-ir-magnetoelastic-v1.md`, `docs/specs/mechanical-bc-policy-v0.md`, `docs/specs/output-naming-policy-magnetoelastic-v1.md`
- Related physics notes: `docs/physics/0710-fdm-magnetoelastic-small-strain.md`, `docs/physics/0720-fem-magnetoelastic-small-strain-mfem-gpu.md`

## 1. Problem statement

Magnetoelastic coupling models the bidirectional interaction between magnetization dynamics and
mechanical deformation in ferromagnetic solids. It is essential for:

- magnetostrictive actuators and sensors,
- spin-wave strain coupling,
- stress-induced anisotropy in thin films and multilayers,
- domain-wall dynamics under mechanical loads.

FullMag must treat magnetoelasticity as **one energy term** with **three execution modes**,
not as three independent features. The shared semantics define the physics; the backend and
planner decide the numerical realization.

### 1.1 Scope

This note covers:

- small-strain magnetoelastic interactions,
- linear elasticity with isotropic and cubic crystal symmetry,
- magnetostriction coupling via the B1/B2 (cubic) and λ_s (isotropic) formalism,
- full bidirectional coupling through energy-consistent field derivation.

### 1.2 Intentionally out of scope

- Finite strain / large deformation,
- nonlinear constitutive laws,
- thermodynamic Helmholtz free-energy models,
- magnetomechanical hysteresis,
- thermal coupling.

## 2. Physical model

### 2.1 Governing equations

The total energy functional is:

$$
E_{\text{tot}} = E_{\text{mag}}[\mathbf{m}] + E_{\text{el}}[\mathbf{u}] + E_{\text{mel}}[\mathbf{m}, \mathbf{u}]
$$

where:

- $E_{\text{mag}}[\mathbf{m}]$ contains the standard micromagnetic contributions (exchange, demag, Zeeman, anisotropy),
- $E_{\text{el}}[\mathbf{u}]$ is the elastic strain energy,
- $E_{\text{mel}}[\mathbf{m}, \mathbf{u}]$ is the magnetoelastic coupling energy.

#### Elastic energy

$$
E_{\text{el}} = \frac{1}{2} \int_\Omega \boldsymbol{\sigma} : \boldsymbol{\varepsilon}^{\text{el}} \, dV
= \frac{1}{2} \int_\Omega (\boldsymbol{\varepsilon} - \boldsymbol{\varepsilon}^{\text{mag}}) : \mathbf{C} : (\boldsymbol{\varepsilon} - \boldsymbol{\varepsilon}^{\text{mag}}) \, dV
$$

where the elastic strain is $\boldsymbol{\varepsilon}^{\text{el}} = \boldsymbol{\varepsilon}(\mathbf{u}) - \boldsymbol{\varepsilon}^{\text{mag}}(\mathbf{m})$.

#### Strain-displacement relation (small strain)

$$
\varepsilon_{ij} = \frac{1}{2}\left(\frac{\partial u_i}{\partial x_j} + \frac{\partial u_j}{\partial x_i}\right)
$$

#### Constitutive law

$$
\sigma_{ij} = C_{ijkl} \left(\varepsilon_{kl} - \varepsilon_{kl}^{\text{mag}}\right)
$$

For cubic symmetry, the stiffness tensor in Voigt notation has three independent constants: $C_{11}$, $C_{12}$, $C_{44}$.

For isotropic symmetry: $C_{11} = \lambda + 2\mu$, $C_{12} = \lambda$, $C_{44} = \mu$, with Lamé constants $\lambda$, $\mu$.

#### Magnetostrictive eigenstrain — cubic symmetry

$$
\varepsilon^{\text{mag}}_{ij} = \frac{3}{2} \lambda_{100} \left(m_i m_j - \frac{1}{3}\delta_{ij}\right) \quad (i = j)
$$
$$
\varepsilon^{\text{mag}}_{ij} = \frac{3}{2} \lambda_{111} m_i m_j \quad (i \neq j)
$$

In the B1/B2 formulation (using tensor strain $\varepsilon_{ij}$, with $B_2 = -3\lambda_{111}C_{44}$):

$$
e_{\text{mel}} = B_1 \left(\varepsilon_{11}(m_1^2 - \tfrac{1}{3}) + \varepsilon_{22}(m_2^2 - \tfrac{1}{3}) + \varepsilon_{33}(m_3^2 - \tfrac{1}{3})\right) + 2 B_2 (\varepsilon_{12} m_1 m_2 + \varepsilon_{13} m_1 m_3 + \varepsilon_{23} m_2 m_3)
$$

> **Note:** The factor 2 in front of $B_2$ arises because $\varepsilon_{ij}$ are *tensor* (symmetric)
> strain components.  In engineering-shear convention ($\gamma_{ij} = 2\varepsilon_{ij}$) the
> equivalent formula reads $B_2 (\gamma_{12} m_1 m_2 + \ldots)$ without the explicit 2.

The coupling constants relate to magnetostriction constants as:

$$
B_1 = -\frac{3}{2} \lambda_{100} (C_{11} - C_{12}), \qquad B_2 = -3 \lambda_{111} C_{44}
$$

#### Magnetostrictive eigenstrain — isotropic symmetry

For isotropic magnetostriction ($\lambda_{100} = \lambda_{111} = \lambda_s$):

$$
\varepsilon^{\text{mag}}_{ij} = \frac{3}{2} \lambda_s \left(m_i m_j - \frac{1}{3}\delta_{ij}\right)
$$

#### Magnetoelastic effective field

The variational derivative of $E_{\text{mel}}$ with respect to $\mathbf{m}$ produces the
magnetoelastic effective field contribution:

$$
\mathbf{H}_{\text{mel}} = -\frac{1}{\mu_0 M_s} \frac{\delta E_{\text{mel}}}{\delta \mathbf{m}}
$$

For cubic B1/B2 coupling:

$$
H_{\text{mel},1} = -\frac{1}{\mu_0 M_s} \left(2 B_1 \varepsilon_{11} m_1 + 2 B_2 (\varepsilon_{12} m_2 + \varepsilon_{13} m_3)\right)
$$

(and cyclic permutations for components 2, 3).

#### Equilibrium of elasticity (quasistatic mode)

$$
\nabla \cdot \boldsymbol{\sigma} = \mathbf{0}
$$

with mechanical boundary conditions on $\partial \Omega$.

#### Elastodynamics (full dynamic mode)

$$
\rho \ddot{\mathbf{u}} = \nabla \cdot \boldsymbol{\sigma} + \mathbf{f}
$$

coupled with LLG for $\mathbf{m}$ and $\dot{\mathbf{u}} = \mathbf{v}$.

### 2.2 Symbols and SI units

| Symbol | Name | Unit |
|--------|------|------|
| $\mathbf{m}$ | reduced magnetization $\mathbf{M}/M_s$ | 1 |
| $\mathbf{u}$ | displacement | m |
| $\mathbf{v} = \dot{\mathbf{u}}$ | velocity | m/s |
| $\boldsymbol{\varepsilon}$ | strain tensor | 1 |
| $\boldsymbol{\varepsilon}^{\text{mag}}$ | magnetostrictive eigenstrain | 1 |
| $\boldsymbol{\sigma}$ | stress tensor | Pa |
| $\mathbf{C}$ | elastic stiffness tensor | Pa |
| $C_{11}, C_{12}, C_{44}$ | cubic elastic constants | Pa |
| $\rho$ | mass density | kg/m³ |
| $\eta_{\text{mech}}$ | mechanical damping coefficient | 1 |
| $B_1, B_2$ | magnetoelastic coupling constants | Pa |
| $\lambda_{100}, \lambda_{111}$ | magnetostriction constants | 1 |
| $\lambda_s$ | isotropic saturation magnetostriction | 1 |
| $\mathbf{H}_{\text{mel}}$ | magnetoelastic effective field | A/m |
| $E_{\text{mel}}$ | magnetoelastic coupling energy | J |
| $E_{\text{el}}$ | elastic strain energy | J |
| $E_{\text{kin,el}}$ | mechanical kinetic energy | J |

### 2.3 Assumptions and approximations

1. **Small strain**: $\|\boldsymbol{\varepsilon}\| \ll 1$. No geometric nonlinearity; reference and deformed configurations coincide.
2. **Linear elasticity**: stress–strain relation is linear (Hookean).
3. **Saturated magnetization**: $|\mathbf{m}| = 1$ everywhere (standard micromagnetic assumption).
4. **Crystal orientation**: defaults to lab frame; optional rotation matrix for oriented grains.
5. **No thermal effects**: temperature is not a state variable.
6. **Eigenstrain decomposition**: total strain = elastic + magnetostrictive. This is physically correct for small deformations but loses accuracy for finite strains.

### 2.4 Three execution modes

The three modes are controlled by the dynamics/study specification, not by the energy term.
The energy term `Magnetoelastic` is always the same; the planner selects the mode:

| Mode | State variables | Mechanical solve | Use case |
|------|----------------|-----------------|----------|
| **Prescribed strain/stress** | $\mathbf{m}$ | none | stress-induced anisotropy |
| **Quasistatic elasticity** | $\mathbf{m}, \mathbf{u}$ | $\nabla \cdot \boldsymbol{\sigma} = 0$ | magnetostrictive actuation |
| **Elastodynamics** | $\mathbf{m}, \mathbf{u}, \mathbf{v}$ | $\rho \ddot{\mathbf{u}} = \nabla \cdot \boldsymbol{\sigma}$ | spin-wave / acoustic coupling |

## 3. Numerical interpretation

### 3.1 FDM

See `docs/physics/0710-fdm-magnetoelastic-small-strain.md` for full FDM treatment.

Summary:
- V1: collocated grid (same as magnetization grid),
- Strain via central differences,
- Ghost-cell / traction closure for free-surface Neumann BC,
- CG iterative solver for quasistatic elasticity,
- Explicit Verlet/Newmark for elastodynamics (deferred).

### 3.2 FEM

See `docs/physics/0720-fem-magnetoelastic-small-strain-mfem-gpu.md` for full FEM treatment.

Summary:
- $U_h \subset [H^1(\Omega_s)]^d$ for displacement,
- Standard Galerkin weak form for elasticity,
- MFEM + libCEED + hypre linear solve,
- Transfer operators between magnetic and mechanical meshes.

### 3.3 Hybrid

Deferred. The architecture is designed to allow FEM elasticity coupled with FDM micromagnetics
through transfer operators in the planner, consistent with the existing hybrid demag approach.

## 4. API, IR, and planner impact

### 4.1 Python API surface

```python
import fullmag as fm

# Material / body / coupling
mat_el = fm.ElasticMaterial(
    name="CoFe_elastic",
    C11=2.41e11, C12=1.46e11, C44=1.12e11,     # Pa
    rho=8900.0,                                   # kg/m³
)
body = fm.ElasticBody(name="solid1", geometry=geom, elastic_material=mat_el)
law = fm.MagnetostrictionLaw(name="CoFe_ms", kind="cubic", B1=-6.95e6, B2=-5.62e6)

# Energy term
mel = fm.Magnetoelastic(magnet="mag1", body="solid1", law="CoFe_ms")

# Dynamics — mode selection
study = fm.TimeEvolution(
    dynamics=fm.LLG(...),
    mechanics=fm.QuasistaticElasticity(max_picard_iterations=3),
    ...
)
```

### 4.2 ProblemIR representation

New top-level sections in `ProblemIR`:
- `elastic_bodies: Vec<ElasticBodyIR>`
- `elastic_materials: Vec<ElasticMaterialIR>`
- `magnetostriction_laws: Vec<MagnetostrictionLawIR>`
- `mechanical_bcs: Vec<MechanicalBoundaryConditionIR>`
- `mechanical_loads: Vec<MechanicalLoadIR>`

New `EnergyTermIR` variant: `Magnetoelastic { magnet, body, law }`.

Extended `DynamicsIR::Llg` with optional `mechanics: Option<MechanicsIR>`.

### 4.3 Planner and capability-matrix impact

- `FdmPlanIR` gains optional `mechanical_grid: { cells, cell_size, origin }` and `mechanical_material`.
- `FemPlanIR` gains optional `mechanical_space: { order, mesh_asset }`.
- Capability matrix entry: `Magnetoelastic` starts at `semantic-only`, progresses through `internal-reference` to `public-executable`.

## 5. Validation strategy

### 5.1 Analytical checks

1. **Derivative consistency**: finite-difference check $-\delta E_{\text{mel}}/\delta \mathbf{m} \leftrightarrow \mathbf{H}_{\text{mel}}$ with tolerance $< 10^{-6}$.
2. **Zero coupling**: $B_1 = B_2 = 0 \Rightarrow \mathbf{H}_{\text{mel}} = 0$, $E_{\text{mel}} = 0$.
3. **Stress consistency**: $\boldsymbol{\sigma} = \mathbf{C}:(\boldsymbol{\varepsilon} - \boldsymbol{\varepsilon}^{\text{mag}})$ verified pointwise.
4. **Uniform strain in cubic material**: known preferred-axis shift under uniaxial strain.
5. **Clamped bar**: known displacement profile under uniform magnetization.
6. **Magnetization-driven deformation**: thin strip under uniform $\mathbf{m}$ rotation.

### 5.2 Cross-backend checks

- FDM vs FEM for Box geometry, same material, same initial conditions.
- Compare: $E_{\text{mel}}$, $E_{\text{el}}$, average $\mathbf{u}$, average $\boldsymbol{\sigma}$.
- Convergence rate study with mesh refinement (FDM: grid spacing, FEM: element size).

### 5.3 Regression tests

- CPU FDM vs CUDA FDM parity (after GPU Phase 3A).
- Provenance completeness for magnetoelastic runs.
- All outputs in SI with canonical names per output-naming-policy.

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

1. Finite-strain / geometric nonlinearity.
2. Nonlinear constitutive laws.
3. Thermodynamic Helmholtz free-energy formulation.
4. Magnetomechanical hysteresis.
5. Interface magnetoelastic coupling (inter-body).
6. Full elastodynamics CFL/stability analysis.
7. CUDA GPU acceleration for mechanical solver.
8. Piezoelectric / multiferroic coupling.

## 8. References

1. Shu, Y.C., Lin, M.P., Wu, K.C. "Micromagnetic modeling of magnetostrictive materials under
   intrinsic stress." *Mechanics of Materials*, 36(10), 975–997, 2004.
2. Liang, C.Y., et al. "Finite difference magnetoelastic simulator." *PMC*, 2023.
   DOI: 10.1038/s41524-023-01073-w
3. Pfeiler, C.M., Ruggeri, M., Stiftner, B., et al. "A decoupled, convergent and fully linear
   algorithm for the Landau–Lifshitz–Gilbert equation with magnetoelastic effects." *arXiv:2309.00605*, 2023.
4. Kouhia, R., et al. "Nonlinear magnetomechanical problems." *NSCM-21*, Tampere, 2008.
5. Exl, L., et al. "Micromagnetic energy and variational principles." In: *Computational
   Micromagnetics*, Springer, 2019.
