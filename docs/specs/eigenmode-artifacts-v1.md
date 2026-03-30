# Eigenmode Artifacts v1

Status: active bootstrap contract  
Consumers: Analyze UI, local-live API, offline tooling

## Purpose

This spec defines the artifact family written by the current `FemEigen` execution path.
The key rule is simple:

Eigenmode data must be represented as explicit eigen artifacts, not as time-series scalars or generic snapshots.

## Directory layout

```
artifacts/
  eigen/
    spectrum.json
    modes/
      mode_0000.json
      mode_0001.json
      ...
    dispersion/
      branch_table.csv
      path.json
    metadata/
      eigen_summary.json
      normalization.json
      equilibrium_source.json
```

## `eigen/spectrum.json`

Primary spectrum payload.

Required fields:

- `study_kind`
- `mesh_name`
- `mode_count`
- `normalization`
- `damping_policy`
- `equilibrium_source`
- `operator`
- `k_sampling`
- `relaxation_steps`
- `modes`

Each `modes[]` entry contains:

- `index`
- `frequency_hz`
- `angular_frequency_rad_per_s`
- `eigenvalue_field_au_per_m`
- `norm`
- `max_amplitude`
- `dominant_polarization`
- `k_vector`

`eigen/metadata/eigen_summary.json` mirrors this payload so downstream tools have a stable metadata path even when `SaveSpectrum` was not explicitly requested.

## `eigen/modes/mode_XXXX.json`

Per-mode field artifact.

Required fields:

- `index`
- `frequency_hz`
- `angular_frequency_rad_per_s`
- `normalization`
- `damping_policy`
- `dominant_polarization`
- `k_vector`
- `real`
- `imag`
- `amplitude`
- `phase`

Semantics:

- `real` and `imag` are nodal vector fields
- `amplitude` and `phase` are nodal scalar fields
- indexing is zero-based and encoded in the file name with four digits

## `eigen/dispersion/branch_table.csv`

CSV schema:

`mode_index,kx,ky,kz,frequency_hz,angular_frequency_rad_per_s`

The CSV is the canonical transport format for branch data.
The API may additionally expose a parsed JSON view, but the raw CSV remains the source artifact.

## `eigen/dispersion/path.json`

Optional structured metadata for the dispersion sampling path.

Current baseline fields:

- `sampling`
- `k_vector`

## `eigen/metadata/normalization.json`

Required fields:

- `normalization`
- `mode_count`

## `eigen/metadata/equilibrium_source.json`

Required fields:

- `kind`

Optional fields:

- `path`

## API surface

The local-live API exposes convenience endpoints that read this artifact family:

- `GET /v1/live/current/eigen/spectrum`
- `GET /v1/live/current/eigen/mode?index=<u32>`
- `GET /v1/live/current/eigen/dispersion`

These endpoints are adapters over the artifact layout, not separate storage systems.

## Compatibility notes

- Missing mode files are valid when only summary data was requested.
- Analyze must distinguish between:
  - spectrum metadata being available
  - a specific mode field artifact being available
- Future native FEM eigen backends must preserve this artifact contract unless a new versioned spec is introduced.
