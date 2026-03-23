# ProblemIR v0 draft

## Goal

`ProblemIR` is the normalized, typed representation of a micromagnetic problem after parsing and semantic validation but before backend-specific lowering.

## Core sections

- `ProblemMeta` — name, description, parser version, provenance envelope.
- `GeometryIR` — imported CAD or primitive geometry references.
- `RegionIR` — named regions and geometry assignment.
- `MaterialIR` — material constants in SI units.
- `EnergyTermsIR` — exchange, anisotropy, demag, DMI, Zeeman, and future extensions.
- `DynamicsIR` — LLG family, time horizon, stepping policy.
- `SamplingIR` — fields, scalars, cadence, checkpoint policy.
- `BackendPolicyIR` — requested backend, execution mode, discretization hints.
- `ValidationProfileIR` — strictness level and target compatibility expectations.

## Design constraints

1. Physics-first: no backend storage layouts.
2. Versioned: serialization must carry an IR version.
3. Planner-ready: capability checks operate on IR, not raw syntax.
4. Reproducible: normalized runs capture parser version, backend revision, runtime metadata, and seeds.

## Open questions

- How much unit information should be explicit in serialized form versus type-level only?
- Which backend-policy fields belong in shared IR versus planner-only metadata?
- How should hybrid coupling operators be surfaced without contaminating strict mode?
