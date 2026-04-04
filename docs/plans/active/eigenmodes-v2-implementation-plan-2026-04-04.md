# Eigenmodes v2 — Plan wdrożenia: od CPU reference do produkcyjnego UX

**Data:** 2026-04-04  
**Repo:** `MateuszZelent/fullmag`, branch `master`  
**Autor:** raport automatyczny na podstawie audytu kodu  
**Cel:** zamknąć lukę między działającym CPU eigensolver a pełnym produktem (flat DSL + COMSOL-like Study Tree + GPU)

---

## 1. Streszczenie wykonawcze

Fullmag ma działający **CPU reference pipeline FEM eigenmodes** oraz **zaawansowany Analyze viewport**, ale nie ma jeszcze pełnej integracji produktowej w flat DSL, Study Tree ani warstwie authoring/stage-schema.  
Pipeline build API: `fm.Eigenmodes()` → `StudyIR::Eigenmodes` → `plan_fem_eigen()` → `FemEigenPlanIR` → `run_reference_fem_eigen()` → artefakty JSON.  
Frontend posiada moduł Analyze (`ModeSpectrumPlot`, `EigenModeInspector`, `DispersionBranchPlot`), ale bez trwałego modelu wyników w Study Tree.

**Co działa (stan 2026-04-04):**
- Python build API (`fm.Problem(..., study=fm.Eigenmodes(...))`)
- IR, planner, runner CPU — repo zawiera testy fizyczne pokrywające CPU reference
- API endpoints (`/eigen/spectrum`, `/eigen/mode`, `/eigen/dispersion`)
- Frontend Analyze viewport z wizualizacją 2D/3D

**Co NIE działa:**
- Flat DSL (`study.eigenmodes()`) — metoda nie istnieje w `world.py`
- Script builder blokuje eigenmodes (`raise ValueError`)
- GPU native eigensolver — zero kodu
- Study Tree nie pokazuje wyników eigen jako drzewo (COMSOL-like Results node)
- Brak powiązania relax → eigenmodes w jednym skrypcie flat DSL
- Brak trwałej warstwy authoring/stage-schema/result-manifest dla eigen study

---

## 2. Korekta poprzedniego planu (2026-03-30)

Poprzedni plan (`fullmag_fem_eigenmodes_plan_update_2026-03-30.md`) zawiera **38 pozycji (EIG-001 – EIG-038)**, z których większość została oznaczona jako „Brak". Po audycie kodu aktualizujemy status:

### 2.1 Pozycje ZAMKNIĘTE (zrealizowane od 2026-03-30)

| ID | Opis | Dowód |
|----|------|-------|
| EIG-001 | Nota fizyczna eigenmodes | `docs/physics/0600-fem-eigenmodes.md`, `0600-fem-eigenmodes-linearized-llg.md` |
| EIG-002 | `StudyIR::Eigenmodes` | `crates/fullmag-ir/src/lib.rs` L478–545 |
| EIG-003 | Parametry eigen solve w IR | `EigenOperatorIR`, `EigenTargetIR`, `KSamplingIR`, `EigenNormalizationIR`, `EigenDampingPolicyIR` |
| EIG-004 | Python DSL `fm.Eigenmodes(...)` | `packages/fullmag-py/src/fullmag/model/study.py` L131–189 |
| EIG-005 | Walidacja parametrów | `crates/fullmag-plan/src/validate.rs` L249 — `validate_eigen_outputs()` |
| EIG-006 | Planner `plan_fem_eigen()` | `crates/fullmag-plan/src/fem.rs` L833–1250 (~400 linii) |
| EIG-007 | `BackendPlanIR::FemEigen(FemEigenPlanIR)` | `crates/fullmag-ir/src/lib.rs` L1339, L1667–1700 |
| EIG-008 | Equilibrium source (provided/relax/artifact) | `EquilibriumSourceIR` enum + materialization w `fem_eigen.rs` L31–70 |
| EIG-009 | Operator modalny (linearized LLG) | `fem_eigen.rs` L63–80 — $Kv = \lambda Mv$ assembly |
| EIG-010 | Tangent-space basis | Projekcja w fem_eigen.rs (scalar projected problem) |
| EIG-013 | Solver numeryczny (CPU) | nalgebra `SymmetricEigen` + Cholesky w `fem_eigen.rs` L81–104 |
| EIG-017 | Backend CPU reference | `fem_eigen.rs` — kompletny |
| EIG-018 | Artefakt spectrum | `eigen/spectrum.json` — pełna struktura |
| EIG-019 | Artefakt eigenvectors | `eigen/modes/mode_XXXX.json` — real/imag/amplitude/phase |
| EIG-020 | Artefakt dispersion | `eigen/dispersion/branch_table.csv` |
| EIG-021 | Provenance | `eigen/metadata/` — normalization, equilibrium_source, summary |
| EIG-022 | Quantity registry Analyze | `eigenTypes.ts` — `EigenModeSummary`, `EigenSpectrumArtifact`, `EigenModeArtifact` |
| EIG-023 | Ribbon / Analyze IA | RibbonBar sekcja "Analyze", przycisk "Spectrum" |
| EIG-024 | Analyze / Spectrum tab | `ModeSpectrumPlot.tsx` — stem plot z kolorami polaryzacji |
| EIG-025 | Analyze / Modes tab | `EigenModeInspector.tsx` — 3D vector field + 2D slice viewer |
| EIG-026 | Analyze / Dispersion tab | `DispersionBranchPlot.tsx` — Plotly ω(k) |
| EIG-031 | Test analityczny | Coverage obecna: Kittel frequency match test (physics_validation.rs L759) — nie uruchamiany w tej sesji |
| EIG-032 | Test zbieżności siatki | Coverage obecna: `fem_eigen_frequency_is_stable_across_resolutions` (L918) — nie uruchamiany w tej sesji |
| EIG-035 | CI smoke | Coverage obecna: `fem_eigen_smoke_completes_without_errors` (L676) — nie uruchamiany w tej sesji |

### 2.2 Pozycje CZĘŚCIOWO zrobione

| ID | Opis | Stan | Brakuje |
|----|------|------|---------|
| EIG-011 | Nullspace handling | Sortowanie i filtracja trywialnych modów istnieją, ale brak rygorystycznego nullspace handling (deflacja, gauge fix) | Pełna deflacja nullspace z walidacją |
| EIG-012 | Damping policy | `EigenDampingPolicyIR::Ignore \| Include` istnieje w IR/modelu, ale `Include` nie ma fizycznej implementacji (complex eigenvalues) | Implementacja ścieżki `include` z zespolonymi wartościami własnymi |
| EIG-014 | Shift-invert | Nearest target zaimplementowany, ale brak prawdziwego shift-invert (sortowanie post-hoc) | Skalowalny shift-invert solver |
| EIG-029 | UX wyboru linearization source | build API wspiera `equilibrium_source`, ale UI nie eksponuje | Panel w Model Builder |
| EIG-033 | Test ortogonalności modów | `fem_eigen_modes_are_non_trivial` sprawdza amplitudę, ale nie ortogonalność | Dedykowany test ortogonalności |
| EIG-036 | Feature gating | `StudyPanel.tsx` obsługuje case `eigenmodes` | Brak capability flag w runtime |

### 2.3 Pozycje OTWARTE

| ID | Opis | Priorytet | Komentarz |
|----|------|-----------|-----------|
| EIG-015 | Native C ABI eigen | P2 | Zero kodu w `native/` |
| EIG-016 | Rust wrapper native eigen | P2 | Zależy od EIG-015 |
| EIG-027 | Analyze / Compare tab | P3 | Nowy feature |
| EIG-028 | Analyze / Diagnostics tab | P2 | Residuals, orthogonality panels |
| EIG-030 | Eksport VTK/CSV z UI | P3 | Quality-of-life |
| EIG-034 | Test FEM↔FDM | P2 | Porównanie cross-backend |
| EIG-037 | Aktualizacja planów repo | P3 | Housekeeping |
| EIG-038 | Dokumentacja użytkownika | P2 | User-facing guide |

---

## 3. NOWE pozycje — backlog v2

Poniższe pozycje nie istniały w poprzednim planie, a wynikają z audytu z 2026-04-04:

### 3.1 Tabela nowych tasks

| ID | Obszar | Opis | Priorytet | Zależności | Kryterium ukończenia |
|----|--------|------|-----------|------------|----------------------|
| **EIG-040** | Flat DSL | Dodać `StudyBuilder.eigenmodes()` do flat DSL facade w `world.py` | **P0 — krytyczny** | — | Użytkownik może w flat-script po `study.relax()` wywołać `study.eigenmodes(count=10, ...)` |
| **EIG-041** | Flat DSL | Dodać `study.save("spectrum")` i `study.save("mode", indices=[...])` dla eigen | **P0** | EIG-040 | Eigen outputs działają w flat DSL |
| **EIG-042** | Script Builder | Usunąć blokadę `raise ValueError` w `script_builder.py` L1022, L1057 | **P0** | EIG-040, EIG-041 | Script builder emituje poprawny flat-script z eigenmodes |
| **EIG-043** | IR lowering | Flat DSL eigenmodes → `StudyIR::Eigenmodes` lowering | **P0** | EIG-040 | Flat-script eigenmodes trafia do plannera |
| **EIG-044** | Runtime chain | Obsługa sekwencji `relax → eigenmodes` w jednym run | **P0** | EIG-040 | `study.relax()` + `study.eigenmodes()` działa jako pipeline |
| **EIG-045** | Frontend Tree | Dodać node `Outputs > Eigenmodes` w `ModelTree.tsx` | **P1** | — | Po eigen run, w drzewie pojawia się gałąź z modami pod istniejącym `Outputs` |
| **EIG-046** | Frontend Tree | Child nodes: Spectrum, Mode 0, Mode 1... klikalne | **P1** | EIG-045 | Kliknięcie modu otwiera inspector |
| **EIG-047** | Frontend Tree | Auto-detect ukończonego eigen study | **P1** | EIG-045 | Zakończenie solve → drzewo się aktualizuje |
| **EIG-048** | Frontend | Deep-link: kliknięcie modu w drzewie → AnalyzeViewport z wybranym modem | **P1** | EIG-046 | Nawigacja jest płynna |
| **EIG-049** | API | Endpoint `/v1/live/current/eigen/status` (running/done/failed) | **P2** | — | Frontend wie, kiedy odświeżyć drzewo. Nice-to-have — da się osiągnąć przez polling bootstrap/artifacts |
| **EIG-050** | GPU native | Stub ABI `fullmag_fem_eigen_solve()` w `native/include/fullmag_fem_eigen.h` (dedykowany header — nie rozlewać API FEM ogólnego) | **P2** | — | ABI jest zdefiniowane, zwraca `NOT_IMPLEMENTED` |
| **EIG-051** | GPU native | SLEPc/LOBPCG integration w `native/backends/fem/` | **P2** | EIG-050 | GPU solver daje wyniki zgodne z CPU reference |
| **EIG-052** | GPU native | Rust wrapper `NativeFemEigenBackend` | **P2** | EIG-051 | Runner dispatch obsługuje `FemEngine::NativeGpu` dla eigen |
| **EIG-053** | Anisotropy+DMI | Linearyzacja anisotropii i DMI w operatorze modalnym | **P2** | — | Mody uwzględniają anisotropię/DMI |
| **EIG-054** | Complex eigenvalues | Obsługa tłumionego systemu (zespolone wartości własne) | **P2** | — | `damping_policy=include` daje decay rates + frequencies |
| **EIG-055** | Duże problemy | Iteracyjny solver (ARPACK/SLEPc) zamiast dense nalgebra | **P2** | — | Problemy >10k DOF rozwiązywane w rozsądnym czasie |
| **EIG-056** | Authoring | Authoring schema for eigen stage — trwała reprezentacja eigen study w builder state / scene schema | **P1** | EIG-040 | Eigen stage jest persisted w modelu buildera, round-trip zachowuje parametry |
| **EIG-057** | Frontend | Analyze selection state w frontend model — jawny stan „który mod / który widok” w global store | **P1** | EIG-045 | Selekcja modu/widoku przechodzi reload/nawigację |
| **EIG-058** | Artifacts | Result manifest / artifact index for eigen outputs — ustrukturyzowany indeks wyników eigen powiązany ze stage | **P1** | EIG-044 | Drzewo wyników budowane z manifestu, nie z filesystem scanning |

---

## 4. Plan fazowy wdrożenia

### Faza 1: Flat DSL eigenmodes (EIG-040 – EIG-044) ← **PRIORYTET NATYCHMIASTOWY**

**Cel:** Użytkownik pisze w skrypcie:
```python
study.relax(tol=1e-6, max_steps=100_000, algorithm="llg_overdamped")
study.save("spectrum")
study.save("mode", indices=[0, 1, 2])
study.eigenmodes(
    count=10,
    target="lowest",
    include_demag=True,
    equilibrium_source="relax",
    normalization="unit_l2",
)
```

> **Uwaga:** Calls to `save()` must precede the `eigenmodes()` call that consumes them (same pattern as relax). Mixed pipeline `relax → eigen → time-run` (`study.run()` after eigenmodes) is a **future extension** — Sprint 1 scope covers only the `relax → eigenmodes` sequence.

**Implementacja krok po kroku:**

#### Krok 1.1 — `world.py`: metoda `StudyBuilder.eigenmodes()`

Plik: `packages/fullmag-py/src/fullmag/world.py`

Dodać metodę `eigenmodes()` do klasy `StudyBuilder` (flat DSL facade) na wzór istniejącej `relax()`:

```python
def eigenmodes(
    self,
    count: int = 10,
    target: str = "lowest",
    target_frequency: float | None = None,
    include_demag: bool = True,
    equilibrium_source: str = "relax",
    equilibrium_artifact: str | None = None,
    normalization: str = "unit_l2",
    damping_policy: str = "ignore",
    k_vector: tuple[float, float, float] | None = None,
) -> None:
    """Queue an eigenmode analysis step."""
    ...
```

Metoda powinna:
- Walidować parametry (target ∈ {"lowest", "nearest"}, normalization ∈ {"unit_l2", "unit_max_amplitude"} itd.)
- Ustawić wewnętrzny stan study na tryb eigenmodes
- Zapisać parametry do serializacji IR

#### Krok 1.2 — `world.py`: rozszerzenie `save()` o typy eigen

Dodać obsługę:
```python
study.save("spectrum")            → SaveSpectrum()
study.save("mode", indices=[...]) → SaveMode(indices=(...))
study.save("dispersion")          → SaveDispersion()
```

#### Krok 1.3 — Serializacja do IR

W `script_builder.py`:
- Usunąć `raise ValueError` na liniach 1022 i 1057
- Dodać serializację parametrów `Eigenmodes` do JSON IR
- Dodać emisję `SaveSpectrum`, `SaveMode`, `SaveDispersion` outputs

#### Krok 1.4 — Sekwencja relax → eigenmodes

W runtime: obsłużyć sekwencję dwóch study stages:
1. `Relaxation` → zapisz stan equilibrium
2. `Eigenmodes(equilibrium_source="relax")` → użyj zapisanego stanu

To wymaga aby runner potrafił przekazać wynik relaksacji do eigen solve.  
Na ścieżce CPU: `EquilibriumSourceIR::RelaxedInitialState` już to obsługuje (fem_eigen.rs L31–70).

#### Krok 1.5 — Test integracyjny

Dodać test: flat-script z `study.relax()` + `study.eigenmodes()` → generuje artefakty spectrum + modes.

---

### Faza 2: COMSOL-like Study Tree (EIG-045 – EIG-049)

**Cel:** Po zakończeniu eigen solve, w panelu Model Tree (sidebar) pojawia się:

```
📁 Outputs
  ├── 📦 Fields (m, H_demag, ...)
  └── 📊 Eigenmodes
       ├── 📈 Spectrum (klik → spectrum plot)
       ├── 🔵 Mode 0 — 7.23 GHz (klik → 3D inspector)
       ├── 🔵 Mode 1 — 8.41 GHz
       ├── 🔵 Mode 2 — 12.07 GHz
       └── 📉 Dispersion (klik → ω(k) plot)
```

> **Konwencja nazewnicza:** Używamy istniejącego node `Outputs` (już obecnego w `ModelTree.tsx`), nie wprowadzamy osobnego `Results` root. Ewentualny refaktor do semantyki COMSOL-a (`Results`) — dopiero jako osobny task P3.

**Implementacja:**

#### Krok 2.1 — `ModelTree.tsx`: node Eigenmodes Results

Plik: `apps/web/components/panels/ModelTree.tsx`

Dodać logikę:
1. Po załadowaniu bootstrap, sprawdzić czy `artifacts` zawiera `eigen/spectrum.json`
2. Jeśli tak — dodać node "Eigenmodes" z child nodes
3. Fetch spectrum → mapować `modes[]` na child nodes z etykietami `f_i [GHz]`

#### Krok 2.2 — Selection → AnalyzeViewport routing

Kliknięcie node "Mode N" → ustawia:
- `viewMode = "Analyze"`
- `selectedMode = N`

AnalyzeViewport już obsługuje ten stan.

#### Krok 2.3 — Auto-refresh po zakończeniu solve

Nasłuchiwać na zmianę artifacts (polling lub WebSocket) → rebuil tree.

#### Krok 2.4 — API status endpoint

Dodać `/v1/live/current/eigen/status` → `{ "state": "running" | "completed" | "not_started" }`

---

### Faza 3: GPU native eigensolver (EIG-050 – EIG-052)

**Cel:** Duże problemy (>100k DOF) rozwiązywane na GPU.

#### Krok 3.1 — ABI stub

Plik: `native/include/fullmag_fem_eigen.h`

```c
typedef struct fullmag_fem_eigen_result {
    int num_modes;
    double *eigenvalues;    // [num_modes]
    double *eigenvectors;   // [num_modes * 3 * num_nodes]
    int status;
} fullmag_fem_eigen_result_t;

int fullmag_fem_eigen_solve(
    fullmag_fem_context_t *ctx,
    int num_modes,
    double target_frequency,
    const char *target_type,    // "lowest" or "nearest"
    fullmag_fem_eigen_result_t *result
);
```

#### Krok 3.2 — SLEPc/LOBPCG backend

W `native/backends/fem/`:
- Integracja z SLEPc (PETSc eigensolver library)
- Lub LOBPCG z MFEM/hypre
- Shift-invert mode dla `target="nearest"`

#### Krok 3.3 — Rust wrapper

W `crates/fullmag-runner/src/native_fem.rs`:
- Dodać `NativeFemEigenBackend`
- Zmienić dispatch w `dispatch.rs` aby `FemEngine::NativeGpu` dla eigen woływało natywny backend

---

### Faza 4: Rozszerzenia (P2–P3)

| Task | Opis | Faza |
|------|------|------|
| EIG-053 | Anisotropy + DMI w operatorze modalnym | 4a |
| EIG-054 | Complex eigenvalues (damped system) | 4a |
| EIG-055 | Iteracyjny solver large-scale | 4b |
| EIG-027 | Compare tab (mode-to-mode, run-to-run) | 4c |
| EIG-028 | Diagnostics tab (residuals, orthogonality) | 4c |
| EIG-030 | Export VTK/CSV z UI | 4c |
| EIG-033 | Test ortogonalności modów | 4a |
| EIG-034 | Test FEM↔FDM cross-validation | 4b |

---

## 5. Szczegółowe mapowanie plików do modyfikacji

### Faza 1 — pliki do edycji

| Plik | Akcja | Zakres zmian |
|------|-------|-------------|
| `packages/fullmag-py/src/fullmag/world.py` | **DODAĆ** metodę `eigenmodes()` | ~60 linii |
| `packages/fullmag-py/src/fullmag/world.py` | **ROZSZERZYĆ** `save()` o typy eigen | ~20 linii |
| `packages/fullmag-py/src/fullmag/runtime/script_builder.py` L1022 | **USUNĄĆ** `raise ValueError` + dodać serializację eigen outputs | ~30 linii |
| `packages/fullmag-py/src/fullmag/runtime/script_builder.py` L1057 | **USUNĄĆ** `raise ValueError` + dodać serializację eigen study | ~40 linii |
| `packages/fullmag-py/src/fullmag/__init__.py` | **Sprawdzić** czy `eigenmodes` jest eksportowane (prawdopodobnie ok) | ~2 linie |
| `packages/fullmag-py/tests/test_eigenmodes_flat.py` | **NOWY** test integracyjny | ~80 linii |

### Faza 2 — pliki do edycji

| Plik | Akcja | Zakres zmian |
|------|-------|-------------|
| `apps/web/components/panels/ModelTree.tsx` | **ROZSZERZYĆ** — dodać eigen results branch | ~80 linii |
| `apps/web/components/runs/control-room/RunSidebar.tsx` | **ROZSZERZYĆ** — routing `activeNodeId` + `handleTreeClick` dla eigen analyze-root | ~40 linii |
| `apps/web/components/runs/control-room/ControlRoomContext.tsx` | **ROZSZERZYĆ** — shared `AnalyzeSelectionState` (selectedMode, activeTab) wyciągnięty z AnalyzeViewport | ~30 linii |
| `apps/web/components/runs/control-room/ViewportPanels.tsx` | **ROZSZERZYĆ** — konsument shared analyze state (wtórny plik) | ~10 linii |
| `apps/web/components/analyze/eigenTypes.ts` | **Ewentualnie rozszerzyć** o tree-related types | ~10 linii |
| `crates/fullmag-api/src/main.rs` | **DODAĆ** endpoint `/v1/live/current/eigen/status` | ~15 linii |
| `crates/fullmag-api/src/script.rs` | **DODAĆ** handler status | ~20 linii |

### Faza 3 — pliki nowe

| Plik | Akcja |
|------|-------|
| `native/include/fullmag_fem_eigen.h` | **NOWY** — ABI definicja |
| `native/backends/fem/eigen_solve.cpp` | **NOWY** — implementacja GPU |
| `crates/fullmag-runner/src/native_fem_eigen.rs` | **NOWY** — Rust wrapper |

---

## 6. Zależności zewnętrzne

| Biblioteka | Faza | Cel | Obecność w repo |
|------------|------|-----|-----------------|
| nalgebra | 1 (CPU) | Dense SymmetricEigen | ✅ już używane |
| SLEPc | 3 (GPU) | Scalable eigensolver | ❌ do dodania |
| ARPACK | 3 (alt) | Iteracyjny eigensolver | ❌ alternatywa |
| MFEM/hypre | 3 (GPU) | FEM integration | ✅ już w native/ |

---

## 7. Ryzyka i mitygacje

| Ryzyko | Wpływ | Prawdopodobieństwo | Mitygacja |
|--------|-------|---------------------|-----------|
| Flat DSL nie mapuje się 1:1 na multi-stage IR | Wysoki | Średnie | Zbadać jak `relax → run` jest dziś serializowane i zastosować analogiczny pattern |
| Dense CPU solver nie skaluje się >5k DOF | Średni | Pewne | Akceptowalne dla v1; GPU solver w Fazie 3 |
| Equilibrium transfer relax→eigen niedeterministyczny | Niski | Niskie | Już zaimplementowane w CPU reference, przetestowane |
| SLEPc integracja z native MFEM problematyczna | Wysoki | Średnie | Mieć backup plan z LOBPCG z hypre |
| Frontend tree overhead przy dużej liczbie modów (>100) | Niski | Niskie | Lazy loading, pagination |

---

## 8. Definicja ukończenia (DoD) per faza

### Faza 1 — Flat DSL ✓ gdy:
- [ ] `study.eigenmodes()` kompiluje się i jest wywoływalne z Python flat-script
- [ ] `study.save("spectrum")` i `study.save("mode", indices=[0,1,2])` działają
- [ ] Sekwencja `relax() → eigenmodes()` w jednym skrypcie generuje artefakty
- [ ] Skrypt `nanoflower_fem.py` z dodaną linijką eigenmodes uruchamia się bez błędu
- [ ] Test integracyjny przechodzi
- [ ] Brak regresji w istniejących testach
- [ ] Eigen stage round-trips poprawnie przez `SceneDocument` / `ScriptBuilderState` (`ScriptBuilderStageState` trzyma pola eigen)
- [ ] Brak regresji w serializacji `stages` — istniejące relax/run stages nie tracą danych
- [ ] Analyze-related metadata (mode count, spectrum path) nie ginie w adapterach (`adapters.rs`)

### Faza 2 — Study Tree ✓ gdy:
- [ ] Po eigen solve w drzewie widoczny node "Eigenmodes" z child nodes
- [ ] Kliknięcie "Spectrum" przełącza na AnalyzeViewport → spectrum plot
- [ ] Kliknięcie "Mode N" przełącza na inspector z wybranym modem
- [ ] Drzewo odświeża się automatycznie po zakończeniu solve
- [ ] Web typecheck i production build przechodzą

### Faza 3 — GPU Eigensolver ✓ gdy:
- [ ] ABI zdefiniowane i stub zwraca NOT_IMPLEMENTED
- [ ] Solver GPU daje wyniki zgodne z CPU reference (Kittel test ±5%)
- [ ] Problemy >10k DOF rozwiązywane w <60s na RTX 3090+
- [ ] Smoke test GPU w CI (conditional na obecność GPU)

---

## 9. Proponowana kolejność implementacji — sprint plan

### Sprint 1A — Model i DSL (EIG-040 – EIG-044)
1. `StudyBuilder.eigenmodes()` w `world.py`
2. Rozszerzenie `save()` o eigen outputs
3. Usunięcie blokad w `script_builder.py`
4. Serializacja eigen study → IR (lowering do `StudyIR::Eigenmodes`)
5. Test: nanoflower_fem.py z eigenmodes
6. Aktualizacja `fem_eigenmodes.py` example

### Sprint 1B — Authoring i stan Analyze (EIG-056 – EIG-058)
1. `crates/fullmag-authoring/src/builder.rs` — rozszerzyć `ScriptBuilderStageState` o pola eigen (count, target, normalization, damping_policy, equilibrium_source, ...)
2. `crates/fullmag-authoring/src/scene.rs` — `SceneDocument.study.stages` round-trip dla eigen stage
3. `crates/fullmag-authoring/src/adapters.rs` — adapter scene ↔ builder nie gubi eigen parametrów
4. Shared `AnalyzeSelectionState` — wyciągnąć `selectedMode` / `activeTab` z `AnalyzeViewport.tsx` do wspólnego contextu
5. Result manifest / artifact index dla eigen outputs

### Sprint 2 — Tree integration (EIG-045 – EIG-048)
1. `ModelTree.tsx` — eigen results branch pod `Outputs > Eigenmodes`
2. `RunSidebar.tsx` — routing `activeNodeId` / `handleTreeClick` dla analyze-root
3. `ControlRoomContext.tsx` — shared analyze selection state
4. Auto-refresh po solve (artifact presence + bootstrap refresh)
5. Ewentualny `/eigen/status` (P2, nice-to-have — nie blokuje MVP)

### Sprint 3 — GPU native (EIG-050 – EIG-052)
1. ABI stub w `native/include/fullmag_fem_eigen.h`
2. SLEPc/LOBPCG integration
3. Rust wrapper `NativeFemEigenBackend`
4. Physics validation vs CPU reference

### Sprint 4 — Rozszerzenia (P2–P3)
1. Anisotropy + DMI w operatorze
2. Complex eigenvalues
3. Iteracyjny solver large-scale
4. Compare/Diagnostics tabs
5. Export z UI

---

## 10. Referencje do istniejących plików

| Dokument | Ścieżka | Rola |
|----------|---------|------|
| Poprzedni plan v1 | `docs/plans/active/fem-eigenmodes-and-analyze-plan-v1.md` | Zamknięcie v1 |
| Plan update 2026-03-30 | `docs/plans/active/fullmag_fem_eigenmodes_plan_update_2026-03-30.md` | Teraz przestarzały — zastąpiony tym dokumentem |
| Masterplan | `docs/reports/fullmag_fem_eigenmodes_masterplan.md` | Kontekst architektoniczny |
| Artifact spec | `docs/specs/eigenmode-artifacts-v1.md` | Obowiązujący format artefaktów |
| Nota fizyczna | `docs/physics/0600-fem-eigenmodes.md` | Source of truth dla fizyki |
| Nota LLG linearized | `docs/physics/0600-fem-eigenmodes-linearized-llg.md` | Operator modalny |
| Przykład build API | `examples/fem_eigenmodes.py` | Działający reference script |
| Przykład docelowy flat | `examples/nanoflower_fem.py` | Skrypt do rozszerzenia |
