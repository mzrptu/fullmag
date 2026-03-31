# Output Naming Policy — Magnetoelastic Extension v1

- Status: draft
- Last updated: 2026-03-31
- Parent spec: `docs/specs/output-naming-policy-v0.md`
- Related physics: `docs/physics/0700-shared-magnetoelastic-semantics.md`

---

## 1. Purpose

This document extends the canonical observable dictionary from
`output-naming-policy-v0.md` with magnetoelastic quantities. All backends must use exactly
these names when publishing magnetoelastic outputs.

## 2. New canonical observables

### 2.1 Fields

| Name | Kind | Type | Unit | Description |
|------|------|------|------|-------------|
| `H_mel` | vector field | `[f64; 3]` per cell/node | A/m | magnetoelastic effective field |
| `u` | vector field | `[f64; 3]` per cell/node | m | mechanical displacement |
| `u_dot` | vector field | `[f64; 3]` per cell/node | m/s | velocity (elastodynamics only) |
| `eps` | tensor field | `[f64; 6]` per cell/node | 1 | strain tensor (Voigt: $\varepsilon_{11}, \varepsilon_{22}, \varepsilon_{33}, \varepsilon_{23}, \varepsilon_{13}, \varepsilon_{12}$) |
| `sigma` | tensor field | `[f64; 6]` per cell/node | Pa | stress tensor (Voigt) |

### 2.2 Scalars

| Name | Kind | Type | Unit | Description |
|------|------|------|------|-------------|
| `E_mel` | scalar | `f64` | J | total magnetoelastic coupling energy |
| `E_el` | scalar | `f64` | J | total elastic strain energy |
| `E_kin_el` | scalar | `f64` | J | mechanical kinetic energy (elastodynamics only) |
| `max_u` | scalar | `f64` | m | maximum $\|\mathbf{u}\|$ across domain |
| `max_sigma_vm` | scalar | `f64` | Pa | maximum von Mises stress |
| `elastic_residual_norm` | scalar | `f64` | 1 | residual norm of mechanical solver |

### 2.3 Naming convention

Follows `output-naming-policy-v0.md` §2.3:

- Field names: lowercase with underscores.
- Energy terms: `E_` prefix + interaction abbreviation (`E_mel`, `E_el`).
- Effective field: `H_` prefix + interaction abbreviation (`H_mel`).
- Tensor fields use Voigt ordering: `[11, 22, 33, 23, 13, 12]`.

## 3. Integration with `E_total` and `H_eff`

When magnetoelastic energy is active:

- `E_total` includes `E_mel` and `E_el` in its sum.
- `H_eff` includes `H_mel` in its sum.

## 4. Tensor field layout

Tensor fields (`eps`, `sigma`) use 6-component Voigt representation per cell/node.

Storage layout: contiguous `[f64; 6]` arrays.

The ordering is:
```
index 0: xx (11)
index 1: yy (22)
index 2: zz (33)
index 3: yz (23)
index 4: xz (13)
index 5: xy (12)
```

Engineering shear strains ($\gamma_{ij} = 2\varepsilon_{ij}$ for $i \neq j$) are **not** used.
The stored values are the tensor components $\varepsilon_{ij}$, not $\gamma_{ij}$.

## 5. Validation rules

- Output names must match this dictionary. Unknown names are rejected.
- `u_dot` and `E_kin_el` are legal only when `mechanics = Elastodynamics`.
- `elastic_residual_norm` is legal only when `mechanics = QuasistaticElasticity`.

## 6. Reserved future names

| Name | Kind | Unit | Notes |
|------|------|------|-------|
| `eps_mag` | tensor field | 1 | magnetostrictive eigenstrain |
| `eps_el` | tensor field | 1 | elastic strain ($\varepsilon - \varepsilon^{\text{mag}}$) |
| `u_boundary` | vector field | m | displacement on domain boundary |
