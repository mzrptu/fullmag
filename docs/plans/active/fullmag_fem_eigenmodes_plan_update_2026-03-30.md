# Fullmag — zaktualizowany plan dla modułu eigenproblem FEM / Eigenmodes
**Data aktualizacji:** 2026-03-30  
**Repo:** `MateuszZelent/fullmag`  
**Cel tej aktualizacji:** skorygować poprzedni plan pod rzeczywisty stan repo i precyzyjnie wypisać, co **jeszcze** zostało do zrobienia.

---

## 1. Najważniejsza zmiana względem poprzedniego planu

Poprzedni plan zakładał, że duża część fundamentów FEM dopiero powstanie.  
To jest już nieaktualne.

Na dziś w repo są już realnie zaimplementowane:

- rozbudowany `ProblemIR` / `FemPlanIR`,
- CPU-owy solver FEM dla LLG,
- FEM exchange,
- FEM demag w co najmniej dwóch realizacjach:
  - Robin/potential solve,
  - transfer-grid demag,
- FEM external field,
- integratory FEM:
  - Heun,
  - RK4,
  - RK23,
  - RK45,
  - ABM3,
- natywny ABI/FFI dla FEM time-stepping,
- wrapper Rust dla natywnego FEM backendu,
- podgląd pól FEM w runtime / preview path,
- testy fizyczne i testy zgodności dla części ścieżek FEM.

To oznacza, że **problem nie brzmi już „jak zbudować FEM w Fullmag”**, tylko:

> **jak domknąć osobny moduł analizy modalnej / eigenmodes na już istniejącym fundamencie FEM oraz jak poprawnie włączyć go do IR, runtime, artefaktów i UI Analyze.**

---

## 2. Zweryfikowany aktualny stan repo — krótka ocena

### 2.1 Co uznaję już za zrobione lub mocno zaawansowane

#### A. Fundament architektoniczny
- Python DSL → `ProblemIR` → Rust validation/planning → backendy.
- Publiczny launcher `fullmag`.
- Model aplikacji z control room i runtime shell.

#### B. Warstwa IR / planowania FEM
- `IR_VERSION = 0.2.0`.
- `FemPlanIR` jest bogaty i obejmuje:
  - mesh,
  - order/hmax,
  - material,
  - precision,
  - integrator,
  - adaptive timestep,
  - demag realization,
  - air box config,
  - anisotropie,
  - DMI,
  - spatially varying fields.

#### C. Solver FEM w silniku
- `MeshTopology`.
- `FemLlgState`.
- `FemLlgProblem`.
- Exchange field i exchange energy.
- Demag:
  - Robin / dense potential solve,
  - transfer-grid demag.
- Zeeman / external field.
- Integratory adaptacyjne i stałokrokowe.
- Testy energii, relaksacji, porównań demag FEM↔FDM.

#### D. Native FEM runtime
- C ABI istnieje.
- Rust wrapper istnieje.
- Obsługa stepowania, kopiowania pól, uploadu magnetyzacji, device info.
- Native MFEM step działa przynajmniej dla części ścieżek.

#### E. Preview / quantities dla runtime FEM
- Runtime może kopiować pola:
  - `M`,
  - `H_ex`,
  - `H_demag`,
  - `H_ext`,
  - `H_eff`,
  - `H_ani`,
  - `H_dmi`.

---

## 3. Kluczowa luka: czego nadal **nie ma**

Najważniejsze: repo nadal **nie ma kompletnego modułu eigenmodes / eigenproblem FEM**.

Brakuje przede wszystkim:

1. **osobnego study typu Eigenmodes w `StudyIR`,**
2. **planera, który obniża taki study do planu wykonania,**
3. **ABI/FFI dla solve’a własnego,**
4. **operatora zlinearyzowanego LLG / operatora modalnego,**
5. **artefaktów wynikowych dla częstotliwości i modów,**
6. **Analyze UI dla spectrum / modes / dispersion,**
7. **testów poprawności własnych wartości i własnych wektorów.**

W praktyce: Fullmag ma już znaczną część „infrastruktury nośnej”, ale **sam moduł modalny jeszcze nie został domknięty jako produkt**.

---

## 4. Dokładna tabelka: co jeszcze pozostało do zrobienia

## 4.1 Tabela główna — backlog kończący moduł Eigenmodes FEM

| ID | Obszar | Stan | Co już jest | Co jeszcze trzeba zrobić | Priorytet | Kryterium ukończenia |
|---|---|---|---|---|---|---|
| EIG-001 | Fizyka / spec | **Brak finalizacji** | Istnieje physics-first workflow i dokumentacyjny gate | Napisać/uzupełnić osobną notę fizyczną dla FEM eigenmodes: linearyzacja LLG, definicja operatora, konwencja częstotliwości, normalizacja modów, warunki brzegowe, relacja do dampingu | Krytyczny | Jest pełna nota w `docs/physics/` będąca source of truth dla implementacji |
| EIG-002 | IR / Study | **Brak** | `StudyIR` ma `TimeEvolution` i `Relaxation` | Dodać `StudyIR::Eigenmodes { ... }` | Krytyczny | JSON/serde/validation wspierają `eigenmodes` bez hacków |
| EIG-003 | IR / parametry solve’a | **Brak** | `FemPlanIR` jest bogaty dla time-domain | Zdefiniować parametry eigen solve: `num_modes`, `sigma`/`target_frequency`, `which`, `include_damping`, `linearization_source`, `normalization`, `k_vector` (pod dyspersję), filtry regionów | Krytyczny | Parametry są jawne, stabilne i walidowane |
| EIG-004 | Python DSL | **Brak** | Jest `Model + Study + Runtime` public API | Dodać API typu `fm.Eigenmodes(...)` lub `Study.eigenmodes(...)` | Krytyczny | Użytkownik może z poziomu Python DSL zbudować poprawny eigen study |
| EIG-005 | Validation | **Brak** | Walidacja istnieje dla time evolution / relaxation | Dodać walidację parametrów solve’a własnego | Wysoki | Błędne konfiguracje są odrzucane przed plannerem |
| EIG-006 | Planner | **Brak** | Jest planning dla FDM/FEM time-domain | Dodać lowering `ProblemIR -> EigenPlanIR/FemEigenPlanIR` | Krytyczny | Planner generuje deterministyczny plan eigen solve |
| EIG-007 | Plan IR | **Brak** | `ExecutionPlanIR` ma backend plan dla FDM/FEM time-domain | Dodać plan backendowy dla eigen solve | Krytyczny | Runtime nie rekonstruuje study z powrotem, tylko działa na gotowym planie |
| EIG-008 | Linearization source | **Brak** | Istnieje stan magnetyzacji i relaxation/time solve | Zdecydować i wdrożyć źródło linearyzacji: z dostarczonego stanu, z relaksacji poprzedzającej, z artefaktu checkpoint | Krytyczny | Użytkownik może jasno wskazać punkt linearyzacji |
| EIG-009 | Operator modalny | **Brak** | Istnieją operatory exchange/demag/Zeeman w formie time-domain | Zbudować operator zlinearyzowany wokół stanu równowagi w przestrzeni stycznej | Krytyczny | Dla znanych przypadków operator daje sensowne częstotliwości i mody |
| EIG-010 | Tangent-space basis | **Brak jako eigen infra** | Są pewne elementy tangent-space w komentarzach/algorytmach relaksacyjnych | Wprowadzić lokalną bazę styczną 2N lub równoważny constrained formulation | Krytyczny | Własne wektory nie zawierają sztucznej składowej radialnej |
| EIG-011 | Nullspace handling | **Brak** | N/D | Obsługa zerowych / trywialnych modów i ewentualnych symetrii/gauge | Wysoki | Solver nie zwraca śmieci jako pierwszy mod |
| EIG-012 | Damping model | **Brak** | Time-domain ma damping | Zdecydować czy eigen solve startuje od przypadku bez tłumienia, czy wspiera zespolone wartości własne od razu | Wysoki | Konwencja jest jawna i spójna w wynikach/UI |
| EIG-013 | Solver numeryczny | **Brak** | Jest MFEM/libCEED/hypre stack dla runtime FEM | Wybrać ścieżkę solve’a: ARPACK/SLEPc/LOBPCG/shift-invert/inna; opisać zależności i ABI | Krytyczny | Solver znajduje zadane mody w realistycznym czasie |
| EIG-014 | Preconditioning / shift-invert | **Brak** | Są linear solver configi dla time-domain demag | Dodać strategię dla solve’ów własnych blisko zadanej częstotliwości | Wysoki | Da się stabilnie znajdować mody lokalne/sąsiednie |
| EIG-015 | Native C ABI | **Brak** | Obecny ABI ma tylko create/step/copy/upload/get_device_info | Dodać osobny ABI dla eigen solve | Krytyczny | C ABI wspiera create/solve/read_mode/read_spectrum/destroy |
| EIG-016 | Rust wrapper | **Brak** | `native_fem.rs` wspiera step-based runtime | Dodać `NativeFemEigenBackend` / analogiczny wrapper | Krytyczny | Rust runner umie uruchomić solve modalny bez omijania ABI |
| EIG-017 | Backend CPU reference | **Brak** | Jest CPU FEM LLG | Dodać CPU reference / small-scale verification path dla eigenproblemu | Wysoki | Jest ścieżka referencyjna do testów i CI |
| EIG-018 | Wyniki: spectrum | **Brak** | Są artefakty time series i preview pól | Zdefiniować artefakt listy modów: `mode_index`, `f`, `omega`, `growth/decay`, `residual`, `participation`, `symmetry tags` | Krytyczny | Widmo jest zapisywane w ustrukturyzowanej postaci |
| EIG-019 | Wyniki: eigenvectors | **Brak** | Jest copy pól runtime time-domain | Zdefiniować format przechowywania modów przestrzennych | Krytyczny | Każdy mod można odczytać i zwizualizować bez rekonstrukcji z logów |
| EIG-020 | Wyniki: dispersion | **Brak** | Brak `k-vector` study | Dodać serię solve’ów po `k` + agregację do artefaktu dyspersji | Wysoki | Można wygenerować krzywą `f(k)` |
| EIG-021 | Provenance | **Częściowo** | Repo ma provenance i plan metadata | Dodać provenance dla eigen solve: stan linearyzacji, solver settings, tolerances, commit/backend revision | Wysoki | Wynik można audytować i odtworzyć |
| EIG-022 | Quantity registry dla Analyze | **Brak** | Runtime ma preview fields dla time-domain | Dodać quantity types dla `mode_amplitude`, `mode_phase`, `real`, `imag`, `abs`, `component`, `participation map` | Wysoki | UI wie, jakie quantities może legalnie pokazać |
| EIG-023 | Ribbon / Analyze IA | **Brak** | Istnieje control room i preview infrastruktura | Zaprojektować nowy ribbon oraz sekcję **Analyze** w Model Builder | Krytyczny | Analyze staje się pierwszoklasowym obszarem produktu |
| EIG-024 | Analyze / Spectrum tab | **Brak** | N/D | Widok listy modów / wykres częstotliwości / sort/filter | Krytyczny | Użytkownik widzi uporządkowane widmo i może wybrać mod |
| EIG-025 | Analyze / Modes tab | **Brak** | N/D | Wizualizacja wybranego modu: amplituda/faza/składowe, 2D/3D | Krytyczny | Można intuicyjnie obejrzeć przestrzenny kształt modu |
| EIG-026 | Analyze / Dispersion tab | **Brak** | N/D | Widok relacji `f(k)` oraz seria po punktach/kierunkach w przestrzeni falowej | Wysoki | Dyspersja jest przeglądalna i eksportowalna |
| EIG-027 | Analyze / Compare tab | **Brak** | N/D | Porównanie kilku modów / kilku solve’ów / kilku geometrii | Średni | Użytkownik może zestawić wyniki bez eksportu do zewnętrznych narzędzi |
| EIG-028 | Analyze / Diagnostics tab | **Brak** | N/D | Residuua, zbieżność, normy, orthogonality checks, solver metadata | Wysoki | Debug i walidacja są możliwe z UI |
| EIG-029 | UX wyboru stanu linearyzacji | **Brak** | N/D | UI do wskazania „linearize around” + zależność od wyników relax/time-domain | Wysoki | Przepływ użytkownika jest jednoznaczny |
| EIG-030 | Eksport danych | **Brak** | Time-domain ma artefakty własne | CSV/JSON/NPY/VTK dla spectrum i modów | Średni | Wyniki można łatwo przenieść do publikacji/skryptów |
| EIG-031 | Test analityczny 1 | **Brak** | Jest kultura testów fizycznych | Dodać prosty benchmark analityczny / półanalityczny dla pojedynczego przypadku | Krytyczny | Co najmniej 1 test częstotliwości ma znany expected range |
| EIG-032 | Test zbieżności siatki | **Brak** | N/D | Sprawdzić zbieżność częstotliwości wraz z rafinacją mesh | Krytyczny | Trend zbieżności jest stabilny i udokumentowany |
| EIG-033 | Test ortogonalności modów | **Brak** | N/D | Sprawdzić wzajemną ortogonalność / biortogonalność zgodnie z wybraną konwencją | Wysoki | Tryby nie są numerycznie zdegenerowane w sposób ukryty |
| EIG-034 | Test FEM↔FDM | **Brak** | Są porównania demag FEM↔FDM dla time-domain | Dodać test porównawczy dla wybranych modów w prostych geometriach | Wysoki | Częstotliwości i profile modów są jakościowo zgodne |
| EIG-035 | CI / smoke | **Brak** | Jest CI i physics gate | Dodać smoke test eigen solve na minimalnym przypadku | Wysoki | Każdy PR sprawdza, że ścieżka eigenmodes się nie rozsypała |
| EIG-036 | Feature gating | **Brak** | Repo ma capability mindset | Oznaczyć, co jest `semantic-only`, `dev-only`, `public-executable` | Wysoki | Produkt nie obiecuje więcej niż naprawdę działa |
| EIG-037 | Aktualizacja planów repo | **Wymaga korekty** | Istnieje `implementation-status-and-next-plans-2026-03-23.md` | Zaktualizować plan aktywny, bo dziś repo ma więcej FEM niż ten dokument twierdzi | Średni | Dokumentacja planistyczna nie rozmija się z kodem |
| EIG-038 | Dokumentacja użytkownika | **Brak** | README i docs są dla ogólnej architektury | Dodać user-facing guide: jak uruchomić eigenmodes, jak czytać spectrum, jak oglądać mody | Średni | Użytkownik nie musi czytać kodu, by użyć modułu |

---

## 4.2 Krótsza tabela — co z poprzedniego planu można już oznaczyć jako „zrobione” albo „częściowo zrobione”

| Obszar | Poprzednio | Stan teraz | Komentarz |
|---|---|---|---|
| FEM mesh/topology | planowane | **Zrobione** | `MeshTopology` istnieje |
| FEM exchange | planowane | **Zrobione** | Jest pole i energia exchange |
| FEM demag | planowane | **Częściowo / mocno zaawansowane** | Robin solve + transfer-grid są, ale native mesh-native/libCEED/hypre demag nadal nie jest domknięte |
| FEM external field | planowane | **Zrobione** | Jest w solverze FEM |
| FEM integratory | planowane | **Zrobione** | Heun, RK4, RK23, RK45, ABM3 |
| FEM adaptive stepping | planowane | **Zrobione** | Jest w CPU FEM |
| FEM native ABI | planowane | **Zrobione dla time-domain** | Brak ABI dla eigen solve |
| FEM Rust wrapper | planowane | **Zrobione dla time-domain** | Brak wrappera eigen |
| Material model FEM | planowane | **Mocno rozszerzone** | anisotropy, DMI, spatial fields |
| Preview quantities | planowane | **Częściowo zrobione** | runtime fields są; analyze eigen quantities nie ma |
| StudyIR Eigenmodes | planowane | **Brak** | To nadal główny brak |
| Analyze / ribbon | planowane | **Brak** | To nadal główny UI brak |

---

## 5. Rekomendowana kolejność domknięcia modułu

## Faza A — zamknięcie kontraktu danych
Najpierw:
1. `docs/physics` dla eigenmodes,
2. `StudyIR::Eigenmodes`,
3. Python DSL,
4. planner i plan IR,
5. capability / feature gating.

**Powód:** bez tego łatwo zrobić solver, którego nie da się spójnie obsłużyć w produkcie.

## Faza B — minimalny solver własny „publicznie uczciwy”
Następnie:
1. wersja bez tłumienia albo z jasno ustaloną konwencją tłumienia,
2. solve tylko dla ustalonego stanu linearyzacji,
3. mała liczba modów,
4. zapis spectrum + 1 tryb przestrzenny,
5. smoke test i benchmark referencyjny.

**To powinien być pierwszy milestone, który wolno pokazać użytkownikowi.**

## Faza C — produkt Analyze
Potem:
1. Spectrum tab,
2. Modes tab,
3. podstawowy export,
4. diagnostics,
5. dopiero później dispersion.

**Powód:** dyspersja to już seria solve’ów; bez stabilnego pojedynczego eigen solve będzie tylko multiplikowała problemy.

## Faza D — rozszerzenia
Na końcu:
1. dispersion,
2. compare,
3. complex damping modes,
4. lepsze preconditionery/shift-invert,
5. public qualification.

---

## 6. Jak bym teraz inteligentnie zaprojektował ribbon i sekcję Analyze

## 6.1 Główna zasada
Analyze nie powinno być „innym viewerem”, tylko **produktem nad artefaktami solve’a**.

Czyli przepływ:
1. użytkownik uruchamia relax / time evolution / eigenmodes,
2. runtime zapisuje jawne artefakty,
3. Analyze działa wyłącznie na tych artefaktach,
4. UI nie „zgaduje”, tylko czyta typ wyniku i wspierane quantities.

## 6.2 Proponowana struktura Analyze
Nowa sekcja w Model Builder / Run view:

- **Analyze**
  - **Spectrum**
  - **Modes**
  - **Dispersion**
  - **Compare**
  - **Diagnostics**

## 6.3 Minimalny ribbon Analyze
### Group 1 — Data Source
- Result set
- Study source
- Linearization state
- Mode family
- Refresh / Recompute metadata

### Group 2 — Spectrum
- Sort by frequency
- Filter by frequency range
- Filter by symmetry / region
- Show residuals
- Export table

### Group 3 — Mode View
- Real / Imag / Abs / Phase
- mx / my / mz / tangential amplitude
- Normalize mode
- Color map
- Overlay equilibrium direction

### Group 4 — Dispersion
- k-path selector
- Branch selector
- Show labels / crossings
- Export curve

### Group 5 — Diagnostics
- Residual
- Orthogonality
- Solver iterations
- Shift / target
- Conditioning hints

---

## 7. Co uważam za **najbardziej opłacalny następny krok**

Gdybym miał wskazać jeden najrozsądniejszy następny milestone, byłby to:

### **MVP-1: pojedynczy eigen solve FEM bez dyspersji**
Zakres:
- `StudyIR::Eigenmodes`,
- Python DSL,
- planner,
- minimalny native/CPU solve,
- zapis spectrum,
- zapis 1..N modów,
- Analyze:
  - Spectrum,
  - Modes,
- 2–3 testy referencyjne.

To da:
- realną wartość użytkową,
- stabilny kontrakt danych,
- bazę pod dispersion,
- bazę pod dalszy ribbon.

---

## 8. Moja zaktualizowana ocena stanu projektu

### Co jest już mocne
- FEM nie jest już „papierowy”.
- Repo ma prawdziwy solver FEM time-domain.
- Native backend nie jest już pustym scaffoldem.
- IR i materiałowy model są dużo dojrzalsze niż wcześniej.
- Są realne testy fizyczne, a nie tylko techniczne.

### Co nadal jest osią krytyczną
- brak study typu eigenmodes,
- brak solve’a własnego jako produktu,
- brak Analyze UI,
- brak artefaktów modalnych,
- brak testów eigen correctness.

### Najważniejsza korekta względem starego planu
Stary plan za dużo energii odkładał na „budowę FEM od zera”.
Dziś poprawny plan powinien skupiać się głównie na:
- **eigen-IR,**
- **eigen-solver,**
- **eigen-artifacts,**
- **Analyze UX.**

---

## 9. Proponowany status do wpisania w repo

Jeżeli chcesz to przepisać do aktywnego planu repo, to uczciwy status brzmiałby mniej więcej tak:

> Fullmag ma już realny FEM time-domain stack na poziomie engine + IR + native wrapper, ale nadal nie ma zamkniętego modułu FEM eigenmodes. Największa pozostała praca dotyczy teraz nie podstaw FEM, lecz linearyzacji operatora, solve’a własnego, artefaktów modalnych oraz produktu Analyze (spectrum / modes / dispersion).

---

## 10. Jednozdaniowe podsumowanie

**Największy brak nie polega już na tym, że FEM nie istnieje, tylko na tym, że istniejący FEM nie został jeszcze przekształcony w pełny, produkcyjny moduł eigenmodes z własnym study, solverem, artefaktami i Analyze UI.**