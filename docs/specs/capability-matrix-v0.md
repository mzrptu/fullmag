# Capability matrix v0

## Purpose

The capability matrix answers two questions before execution:

1. Is a problem legal for a chosen backend?
2. If it is legal, what planner strategy should be used?

## Initial matrix dimensions

- execution mode: `strict`, `extended`, `hybrid`
- backend target: `fdm`, `fem`, `hybrid`
- geometry support level
- energy term support level
- dynamics support level
- boundary condition support level
- output support level

## Early policy

- `strict` only permits features shared semantically between FDM and FEM.
- `extended` permits backend-only features when requested explicitly.
- `hybrid` requires declared projection/coupling support and should fail fast when unavailable.

## Validation note

Borrow the lesson from Ubermag compatibility tables: shared front-end semantics do not imply equal feature depth on every backend, so support levels must be explicit and queryable.
