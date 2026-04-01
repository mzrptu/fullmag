# Analiza Monolitów w Fullmag (Kod Źródłowy)

Zgodnie z zasadami określonymi w `AGENTS.md` (*"No single source file should exceed ~1000 lines"*), poniżej znajduje się zestawienie największych plików źródłowych w projekcie, które należy poddaować refaktoryzacji w podzieleniu na mniejsze, spójne moduły.

## 🥇 Krytyczny Priorytet Rozbicia (Największe God-Files)

Te pliki wielokrotnie przekraczają dozwolony limit i powodują najwięcej problemów przy utrzymaniu kodu, przeglądzie PR-ów i nawigacji.

1. **`crates/fullmag-plan/src/lib.rs` (4 688 linii)** - Główny plik odpowiadający za planowanie symulacji. Taki rozmiar sugeruje, że brakuje wyraźnego oddzielenia poszczególnych strategii budowania planu (np. osobne strategie dla FDM i FEM, walidacja, budowanie assetów).
2. **`crates/fullmag-runner/src/interactive_runtime.rs` (3 605 linii)** - Środowisko uruchomieniowe sesji interaktywnych; za dużo odpowiedzialności w jednym pliku.
3. **`crates/fullmag-engine/src/lib.rs` (3 458 linii)** - Główny moduł silnika obliczeniowego CPU reference; powinien eksportować pomniejsze moduły zajmujące się właściwymi fazami (zderzenia, pętle).
4. **`crates/fullmag-cli/src/orchestrator.rs` (3 156 linii)** - Orchestrator CLI. Najprawdopodobniej miesza logikę procesów podrzędnych, zarządzanie wyjściem CLI, oraz pętlę zdarzeń.
5. **`apps/web/components/runs/control-room/ControlRoomContext.tsx` (2 184 linii)** - Pzykład anty-wzorca "Massive Context" we frontendzie. Taki rozmiar gwarantuje ogromną liczbę przerenderowań aplikacji i piekło zarządzania stanem.

---

## 💻 Backend API & CLI (Rust, Python)

Lista plików (oprócz wyżej wskazanych) pow. 1000 linii:

### Pilne do podziału (1500 - 3000 linii):
- `crates/fullmag-ir/src/lib.rs` **(2 712 linii)**
- `crates/fullmag-runner/src/multilayer_cuda.rs` **(2 558 linii)**
- `packages/fullmag-py/tests/test_api.py` **(2 503 linii)** *(testów też dotyczy zasada modułowości!)*
- `crates/fullmag-api/src/main.rs` **(2 264 linii)**
- `packages/fullmag-py/src/fullmag/runtime/script_builder.py` **(2 106 linii)**
- `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py` **(2 095 linii)**
- `crates/fullmag-engine/src/fem.rs` **(1 933 linii)**
- `crates/fullmag-runner/src/native_fdm.rs` **(1 903 linii)**
- `packages/fullmag-py/src/fullmag/world.py` **(1 833 linii)**

### Umiarkowany priorytet (1000 - 1500 linii):
- `crates/fullmag-runner/src/lib.rs` (1 347 linii)
- `crates/fullmag-runner/src/cpu_reference.rs` (1 339 linii)
- `crates/fullmag-runner/src/dispatch.rs` (1 285 linii)
- `crates/fullmag-runner/src/native_fem.rs` (1 231 linii)
- `crates/fullmag-runner/tests/physics_validation.rs` (1 066 linii)
- `crates/fullmag-plan/src/fdm.rs` (1 026 linii)
- `crates/fullmag-runner/src/fem_reference.rs` (1 000 linii)

---

## 🖥 Frontend Web (TypeScript / React)

Frontend jest o wiele czyściejszy - ma tylko jeden ogromny monolit. Kilka innych komponentów dobija powoli do limitu 1000 linii i powinno być obserwowanych pod kątem ekstrakcji małych sub-komponentów (np. osobne kontrolki, hooki i pod-panele).

**Do ekstrakcji logiki (hooki / reducres) lub wydzielenia wizualnego:**
1. `apps/web/components/runs/control-room/ControlRoomContext.tsx` **(2 184 linii)**
2. `apps/web/components/panels/ModelTree.tsx` (986 linii)
3. `apps/web/lib/session/normalize.ts` (984 linii)
4. `apps/web/components/preview/FemMeshView3D.tsx` (947 linii)
5. `apps/web/components/preview/MagnetizationView3D.tsx` (915 linii)
6. `apps/web/components/panels/MeshSettingsPanel.tsx` (817 linii)
7. `apps/web/components/panels/settings/ObjectMeshPanel.tsx` (798 linii)

---

## 🎯 Proponowany Plan Działania (Roadmapa Refaktoryzacji):

1. **Faza 1 (Frontend):** 
   Przepisanie `ControlRoomContext.tsx` (np. podział na oddzielne Context API dla konkretnych fragmentów jak stan symulacji, stan interfejsu, logika połączenia) celem poprawy ogólnej separacji i wydajności w widoku symulacji.
2. **Faza 2 (Rust Core Backend):**
   Rozbicie paczki i root-modułów: `fullmag-plan/src/lib.rs` oraz `fullmag-engine/src/lib.rs` rozbijając je na moduły podrzędne. Najlepiej zrobić to bez zmiany logiki biznesowej, aby mieć pewność że nie powstają błędy po drodze.
3. **Faza 3 (Runtime & Orchestrator Rust):**
   Rozbicie `interactive_runtime.rs` i `orchestrator.rs` — prawdopodobnie przez wdrożenie wzorca Strategy lub State Machine do osobnych podmodułów.
4. **Faza 4 (Python Backend):**
   Podział `script_builder.py` i dekompozycja `gmsh_bridge.py`.
