# Mechanical Boundary Condition Policy v0

- Status: draft
- Last updated: 2026-03-31
- Parent spec: `docs/specs/problem-ir-magnetoelastic-v1.md`
- Related physics note: `docs/physics/0700-shared-magnetoelastic-semantics.md`
- Follows pattern of: `docs/specs/exchange-bc-policy-v0.md`

---

## 1. Purpose

This document defines the boundary condition semantics for the mechanical (elasticity) subsystem
introduced by magnetoelastic coupling. Mechanical BCs are part of the **shared IR** — they describe
the physical problem, not a backend implementation detail.

## 2. Physical semantics

### 2.1 Default: traction-free (Neumann)

$$
\boldsymbol{\sigma} \cdot \mathbf{n}\big|_{\partial\Omega} = \mathbf{0}
$$

where $\partial\Omega$ is the sample boundary and $\mathbf{n}$ is the outward surface normal.

This is the natural free-surface BC for an unconstrained magnetostrictive body.

### 2.2 Clamped (Dirichlet)

$$
\mathbf{u}\big|_{\partial\Omega_D} = \mathbf{0}
$$

Models a rigidly fixed surface (e.g., substrate interface for thin films).

### 2.3 Prescribed displacement

$$
\mathbf{u}\big|_{\partial\Omega_D} = \mathbf{u}_0
$$

General Dirichlet BC with non-zero prescribed displacement.

### 2.4 Prescribed traction

$$
\boldsymbol{\sigma} \cdot \mathbf{n}\big|_{\partial\Omega_N} = \mathbf{t}
$$

External traction vector applied on a surface.

### 2.5 Periodic (deferred)

Periodic mechanical BC for infinite films or superlattice unit cells.
Deferred — same status as periodic exchange BC.

## 3. FDM realization

### 3.1 Traction-free (default)

For axis-aligned box geometry, traction-free BC is enforced via ghost cells.

At an $x$-boundary ($i = 0$ or $i = N_x - 1$):

For the simple case of no shear coupling on axis-aligned faces, the ghost displacement mirrors
the interior value:

```
u_ghost = u_boundary
```

which ensures $\partial u / \partial n = 0$ in the central-difference stencil.

For general cubic stiffness with off-diagonal coupling, the ghost values must satisfy the full
traction-free condition $\sigma_{xj} = 0$, which creates a system coupling $u_x, u_y, u_z$ at
the boundary. This is solved by a closure relation derived from the constitutive law.

### 3.2 Clamped

Boundary cells are set to $\mathbf{u} = \mathbf{0}$ and excluded from the CG solve.

### 3.3 Prescribed displacement / traction

- Prescribed displacement: directly set on boundary cells.
- Prescribed traction: ghost cell values calculated to produce the desired traction.

## 4. FEM realization

### 4.1 Traction-free (default)

Natural BC — no surface integral term in the weak form. Analogous to exchange Neumann BC
being the natural condition in the Galerkin formulation.

### 4.2 Clamped / prescribed displacement

Essential BC — enforced on boundary DOFs via `MFEM::Array<int>` boundary attribute markers.

### 4.3 Prescribed traction

Neumann BC — adds surface integral $\int_{\partial\Omega_N} \mathbf{t} \cdot \mathbf{v} \, dS$
to the RHS linear form.

## 5. ProblemIR representation

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MechanicalBoundaryConditionIR {
    TractionFree { surface: String },
    Clamped { surface: String },
    PrescribedDisplacement { surface: String, u: [f64; 3] },
    PrescribedTraction { surface: String, t: [f64; 3] },
}
```

Surface names reference geometry boundary tags (face labels for Box, named surfaces for
imported geometry).

### 5.1 Default behavior

When no `MechanicalBoundaryConditionIR` entries are provided, **all** free surfaces default
to traction-free. This is analogous to the exchange Neumann default.

## 6. Validation

- Traction-free: uniform magnetization should produce only eigenstrain (no elastic energy if
  body is unconstrained and free to deform).
- Clamped: verify non-zero elastic energy and stress under magnetostrictive eigenstrain.
- Prescribed traction: verify stress integral equals applied traction times area.

## 7. Future evolution

When new BC types are needed (periodic, mixed, Robin-type for substrates), they will be added
as new variants to `MechanicalBoundaryConditionIR`.
