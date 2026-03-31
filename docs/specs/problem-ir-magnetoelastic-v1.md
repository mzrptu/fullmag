# ProblemIR Magnetoelastic Extension v1

- Status: draft
- Last updated: 2026-03-31
- Parent spec: `docs/specs/problem-ir-v0.md`
- Related physics: `docs/physics/0700-shared-magnetoelastic-semantics.md`

---

## 1. Purpose

This spec defines the magnetoelastic extensions to `ProblemIR`. All new types are additive —
existing IRs without magnetoelastic fields remain valid via `#[serde(default)]`.

## 2. New top-level sections

### 2.1 `ElasticMaterialIR`

```rust
pub struct ElasticMaterialIR {
    pub name: String,
    pub c11: f64,                           // Pa
    pub c12: f64,                           // Pa
    pub c44: f64,                           // Pa
    pub density: f64,                       // kg/m³
    pub mechanical_damping: Option<f64>,    // dimensionless (for elastodynamics)
}
```

Validation:
- `name` non-empty and unique,
- `c11`, `c12`, `c44` finite and positive,
- `density` positive,
- `mechanical_damping` non-negative when present.

### 2.2 `ElasticBodyIR`

```rust
pub struct ElasticBodyIR {
    pub name: String,
    pub geometry: String,           // references GeometryIR entry
    pub elastic_material: String,   // references ElasticMaterialIR
}
```

Validation:
- `name` non-empty and unique,
- `geometry` references an existing geometry entry,
- `elastic_material` references an existing `ElasticMaterialIR`.

### 2.3 `MagnetostrictionLawIR`

```rust
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MagnetostrictionLawIR {
    Cubic { name: String, b1: f64, b2: f64 },
    Isotropic { name: String, lambda_s: f64 },
}
```

Validation:
- `name` non-empty and unique,
- `b1`, `b2`, `lambda_s` finite (may be negative — sign encodes coupling direction).

### 2.4 `MechanicalBoundaryConditionIR`

See `docs/specs/mechanical-bc-policy-v0.md` for full spec.

### 2.5 `MechanicalLoadIR`

```rust
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MechanicalLoadIR {
    BodyForce { f: [f64; 3] },              // N/m³
    PrescribedStrain { strain: [f64; 6] },  // Voigt notation
    PrescribedStress { stress: [f64; 6] },  // Voigt notation, Pa
}
```

### 2.6 `EnergyTermIR::Magnetoelastic`

New variant in the existing `EnergyTermIR` enum:

```rust
Magnetoelastic {
    magnet: String,   // references MagnetIR name
    body: String,     // references ElasticBodyIR name
    law: String,      // references MagnetostrictionLawIR name
}
```

Validation:
- `magnet` references an existing `MagnetIR`,
- `body` references an existing `ElasticBodyIR`,
- `law` references an existing `MagnetostrictionLawIR`,
- the `MagnetIR` geometry and `ElasticBodyIR` geometry must be compatible (same or overlapping domain).

### 2.7 `MechanicsIR` — dynamics block

Extension to `DynamicsIR::Llg`:

```rust
pub enum DynamicsIR {
    Llg {
        gyromagnetic_ratio: f64,
        integrator: String,
        fixed_timestep: Option<f64>,
        adaptive_timestep: Option<AdaptiveTimeStepIR>,
        mechanics: Option<MechanicsIR>,   // NEW
    },
}

#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MechanicsIR {
    PrescribedStrain,
    QuasistaticElasticity {
        max_picard_iterations: u32,
        picard_tolerance: f64,
    },
    Elastodynamics {
        mechanical_dt: Option<f64>,
    },
}
```

## 3. Extended `ProblemIR`

```rust
pub struct ProblemIR {
    // ... all existing fields unchanged ...

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub elastic_bodies: Vec<ElasticBodyIR>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub elastic_materials: Vec<ElasticMaterialIR>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub magnetostriction_laws: Vec<MagnetostrictionLawIR>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mechanical_bcs: Vec<MechanicalBoundaryConditionIR>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mechanical_loads: Vec<MechanicalLoadIR>,
}
```

All new fields use `#[serde(default)]` so existing IR payloads deserialize without changes.

## 4. Backward compatibility

- Existing `ProblemIR` payloads with no magnetoelastic fields deserialize identically.
- Empty vectors (`elastic_bodies: []`) are skipped during serialization.
- `DynamicsIR::Llg.mechanics` defaults to `None`.
- No changes to any existing field names or semantics.

## 5. Validation rules

### 5.1 Semantic validation (Rust-side)

When `Magnetoelastic` energy term is present:
- at least one `ElasticBodyIR` must exist,
- at least one `ElasticMaterialIR` must exist,
- at least one `MagnetostrictionLawIR` must exist,
- referenced names must resolve.

When `mechanics` is `Some(...)` in `DynamicsIR`:
- at least one `Magnetoelastic` energy term must exist,
- `picard_tolerance` and `max_picard_iterations` must be positive (for quasistatic),
- `mechanical_dt` must be positive when provided (for elastodynamics).

### 5.2 Capability check

The planner must verify that the requested backend supports the mechanics mode:
- `PrescribedStrain`: requires at least `internal-reference` for `Magnetoelastic`,
- `QuasistaticElasticity`: requires `public-executable` for `Magnetoelastic`,
- `Elastodynamics`: not yet supported (rejected by planner).
