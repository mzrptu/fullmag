---
name: python-api-class
description: "Use when adding or modifying a user-facing class in the fullmag Python package (e.g. new energy term, material, region, output type)."
---

# Python API class skill

## Goal

Zapewnić spójność: `docs/physics/` → Python API (`fullmag`) → `ProblemIR` (Rust) → capability matrix.

## Preconditions

- Dokumentacja fizyczna w `docs/physics/` jest kompletna (skill: `physics-publication`).
- Typy `ProblemIR` są zaprojektowane (skill: `problem-ir-design`).

## When to trigger

- Adding a new class: `fm.Exchange()`, `fm.DMI()`, `fm.SOT()`, etc.
- Modifying constructor parameters or validation rules
- Adding new output types, discretization hints, or dynamics models

## Checklist

1. **Klasa Python** w `packages/fullmag-py/fullmag/`:
   - Pydantic model lub dataclass z type hints
   - Walidacja parametrów (jednostki, zakresy, wymagane pola)
   - Metoda `to_ir()` → serializacja do odpowiedniego typu IR
   - Docstring z opisem i przykładem użycia

2. **Rejestracja w `__init__.py`**:
   - Eksport klasy w `fullmag` namespace (`import fullmag as fm; fm.NewClass(...)`)

3. **Testy**:
   - Unit test: tworzenie obiektu, walidacja, serializacja do IR
   - Round-trip test: Python → IR JSON → Rust deserializacja (jeśli Rust jest gotowy)

4. **Przykład**:
   - Dodaj/zaktualizuj przykład w `examples/` pokazujący użycie nowej klasy

## Naming conventions

- Klasy PascalCase: `Exchange`, `DMI`, `Zeeman`, `LLG`
- Parametry snake_case: `t_end`, `anisU`
- Nazwy zgodne z `ProblemIR` (Rust): `fm.Exchange()` ↔ `ExchangeIR`

## Key files

- Python package: `packages/fullmag-py/fullmag/`
- Examples: `examples/`
- IR types: `crates/fullmag-ir/src/`
- Physics docs: `docs/physics/`

## Cascade

Po zakończeniu → uruchom `capability-matrix-check`.
