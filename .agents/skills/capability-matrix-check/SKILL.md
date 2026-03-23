---
name: capability-matrix-check
description: "Use when adding backend features to ensure strict/extended/hybrid legality and capability matrix completeness."
---

# Capability matrix check skill

## Preconditions

- Dokumentacja fizyczna w `docs/physics/` jest kompletna.
- Typy `ProblemIR` są zaprojektowane lub zaktualizowane.

## When to trigger

- After adding/modifying any energy term, BC, solver, or output type
- After changing strict/extended/hybrid semantics
- Before merging any feature that touches backend capabilities

## Checklist

1. Czy funkcja ma dokument fizyczny w `docs/physics/`?
2. Czy jest legalna w `strict`? → Musi działać identycznie na FDM i FEM.
3. Co jest tylko `extended` i dlaczego? → Udokumentuj powód.
4. Jak działa w `hybrid`? → Opisz interakcję FDM↔FEM.
5. Czy Python API (`fullmag` pakiet) poprawnie eksponuje tę funkcję?
6. Jakie testy cross-backend są wymagane?

## Output

- Aktualizacja `docs/specs/capability-matrix-v0.md` — tabela z kolumnami:

| Feature | FDM | FEM | Hybrid | Mode | Notes |
|---------|-----|-----|--------|------|-------|
| ...     | ✅  | ✅  | ⚠️     | strict | ... |

- Jawna decyzja go/no-go dla każdego backendu
- Jeśli plik `capability-matrix-v0.md` nie istnieje — utwórz go z nagłówkiem i pierwszym wpisem

## Key files

- Capability matrix: `docs/specs/capability-matrix-v0.md`
- IR types: `crates/fullmag-ir/src/`
- Python API: `packages/fullmag-py/fullmag/`
