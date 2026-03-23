# Workflow: physics-first-gate

## Purpose

Niezbywalna bramka jakości przed implementacją fizyki/numeryki.

## Steps

1. Zidentyfikuj temat (np. exchange, DMI, demag, mesh).
2. Uruchom skill `physics-publication`.
3. Sprawdź kompletność dokumentu względem `docs/physics/TEMPLATE.md`.
4. Uruchom skill `problem-ir-design`.
5. Uruchom skill `capability-matrix-check`.
6. Dopiero potem rozpocznij implementację.

## Exit criteria

- dokument fizyczny istnieje i jest kompletny,
- wpływ na IR i capability matrix jest jawny,
- jest plan walidacji.
