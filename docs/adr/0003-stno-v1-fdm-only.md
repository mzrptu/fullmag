# ADR 0003: STNO v1 — native FDM only

- Status: accepted
- Date: 2026-04-10

## Context

The STNO/MTJ workflow requires spin-transfer torque (STT), Oersted field, and
thermal noise.  The native FEM backend currently supports Oersted and thermal
noise but has no confirmed end-to-end STT path through the C ABI wrapper and
solver assembly.

Full FEM STT support would require 800–3000+ LOC of new code spanning the FFI
layer, FEM kernel assembly, capability declarations, and numerical validation
against the FDM baseline.  This blocks a timely first production release.

## Decision

**STNO v1 is supported exclusively on native FDM backends (CPU reference and
CUDA).**

FEM remains experimental / partial-support for STNO until STT is implemented
and benchmarked against the FDM baseline.

## Consequences

- The Python DSL accepts STT + Oersted + thermal for any geometry, but the
  planner routes STNO problems to FDM backends only.
- Frontend capability badges should indicate "FDM" for STNO workflows.
- The FEM backend capability list does **not** advertise `"slonczewski_stt"` or
  `"zhang_li_stt"` until validated.
- Future work: implement STT in the FEM solver, extend the FFI layer, add
  parity tests, and promote FEM STNO to production.

## Alternatives considered

- **STNO v1 = FDM + FEM**: rejected due to scope; the FEM STT path is
  unvalidated and would delay the release with no user-facing benefit (FDM
  covers the canonical 400 nm nanodot use case).
