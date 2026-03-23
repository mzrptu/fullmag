# Workflow: review-physics-completeness

## Purpose

Sprawdzić, czy wdrożona funkcja jest fizycznie i architektonicznie domknięta.

## Review protocol

1. Czy dokument w `docs/physics/` istnieje przed kodem?
2. Czy równania, założenia i jednostki są kompletne?
3. Czy Python API + `ProblemIR` + planner + capability matrix są spójne?
4. Czy backendy mają jasno opisane różnice semantyczne?
5. Czy wyniki walidacji i tolerancje są zapisane?

## Verdict

- `GO` — gotowe do merge
- `BLOCK` — braki dokumentacji fizycznej lub walidacji
