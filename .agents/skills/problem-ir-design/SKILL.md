---
name: problem-ir-design
description: "Use when introducing or changing semantics in Fullmag ProblemIR, especially after physics documentation has been prepared."
---

# ProblemIR design skill

## Preconditions

- Istnieje aktualny dokument w `docs/physics/` dla danej funkcji (skill: `physics-publication`).

## When to trigger

- Adding a new IR section (e.g. new energy term, new BC type)
- Changing field types, validation rules, or serialization format
- Modifying how the planner interprets IR

## Outputs

1. Propozycja zmian typów `ProblemIR` (Rust structs w `crates/fullmag-ir/`)
2. Reguły walidacji (Rust-side, po deserializacji z Pythona)
3. Wpływ na planner i execution plan
4. Wpływ na kompatybilność backendów (strict/extended/hybrid)
5. **Odpowiadające klasy Python API** w `packages/fullmag-py/` — każdy typ IR musi mieć swój odpowiednik w pakiecie `fullmag` (np. `EnergyTermIR` ↔ `fm.Exchange()`)
6. Format serializacji (JSON/protobuf) — jak Python API serializuje do IR
7. Notatka o migracji wersji IR (jeśli breaking change)

## Key files

- IR types: `crates/fullmag-ir/src/`
- Python API: `packages/fullmag-py/fullmag/`
- Capability matrix: `docs/specs/capability-matrix-v0.md`

## Cascade

Po zakończeniu → uruchom `capability-matrix-check`.
