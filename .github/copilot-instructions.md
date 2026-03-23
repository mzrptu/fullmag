# Copilot instructions for Fullmag

- Traktuj `docs/1_project_scope.md`, `docs/specs/problem-ir-v0.md`, `docs/physics/` i ADR-y jako źródło prawdy architektonicznej i fizycznej.
- Chroń granicę: Python API `fullmag` i `ProblemIR` opisują fizykę, geometrię, materiały, energię, dynamikę, wyjścia i politykę backendu — nie strukturę siatki.
- **Złota zasada:** zanim wdrożysz nową fizykę, dyskretyzację albo mechanikę solvera, najpierw utwórz lub uzupełnij dokument w `docs/physics/` opisujący model jak notatkę/publikację naukową.
- Każda nowa funkcja backendowa musi mieć miejsce w capability matrix lub świadome ograniczenie.
- Preferuj małe, czytelne moduły i jawne typy zamiast „sprytnej” magii.
- Zakładaj development container-first: dokumentuj i utrzymuj polecenia przez `docker compose` / `Makefile`.
- Przy dotykaniu Rusta aktualizuj testowalne typy i kontrakty. Przy dotykaniu weba utrzymuj go jako control room, nie warstwę fizyczną.
