# Workflow: feature-delivery

## Purpose

Dostarczyć funkcję od fizyki do kodu bez utraty spójności między warstwami.

## Steps

1. `physics-first-gate`
2. Zmiany w Python API / `ProblemIR`
3. Planner + capability matrix
4. Backend implementation (FDM/FEM/hybrid)
5. Walidacja i benchmarki
6. Aktualizacja `docs/physics/` o wyniki i ograniczenia

## Exit criteria

- zgodność semantyczna utrzymana,
- walidacja udokumentowana,
- kompletność odnotowana w dokumentacji fizycznej.
