---
name: physics-publication
description: "Use when implementing or modifying any physics/numerics feature in Fullmag. Create or update docs/physics notes in scientific-publication style before code changes."
---

# Physics publication skill

## Goal

Wymusić regułę: **najpierw fizyka, potem implementacja**.

## When to trigger

- Adding a new energy term, dynamics model, or numerical method
- Modifying equations, discretization, or boundary conditions
- Changing physical assumptions or units

## Required outputs

1. Dokument `docs/physics/<topic>.md` — użyj szablonu z `templates/physics-note.md`
2. Równania, symbole, jednostki SI i założenia
3. Interpretacja FDM/FEM/hybrid
4. Wpływ na Python API (`fullmag` pakiet) — jakie klasy trzeba dodać/zmienić
5. Wpływ na `ProblemIR`, planner i capability matrix
6. Plan walidacji i kryteria kompletności
7. Lista ograniczeń i rzeczy odłożonych

## Template

Szablon dokumentu fizycznego: [templates/physics-note.md](templates/physics-note.md)

Skopiuj go do `docs/physics/<topic>.md` i wypełnij.

## Blocker policy

Jeśli brak kompletnej dokumentacji fizycznej, implementacja jest blokowana.
Nie pisz kodu (kerneli CUDA, operatorów FEM, klas Python API) dopóki dokument nie przejdzie review.

## Cascade

Po zakończeniu tego skilla, uruchom kolejno:
1. `problem-ir-design` — zaprojektuj typy IR
2. `python-api-class` — dodaj klasy do pakietu `fullmag`
3. `capability-matrix-check` — zaktualizuj macierz
