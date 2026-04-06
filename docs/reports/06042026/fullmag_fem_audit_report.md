# Audyt solvera FEM CPU/GPU w Fullmag

Data: 2026-04-06

Zakres: statyczny audyt krytycznego łańcucha FEM od modelu/Python DSL przez IR i planner, aż do runnerów, CPU reference engine oraz natywnego backendu MFEM/CUDA.

Cel: znaleźć błędy semantyczne, silent fallbacki, hardkodowanie, miejsca niedopracowane i wąskie gardła wydajnościowe – ze szczególnym naciskiem na air-box/demag, LLG, Oersted, termikę, magnetoelastykę, DMI oraz eigen.


## 1. Jak czytać ten raport


- To jest **audyt techniczny ścieżki FEM**, a nie wynik benchmarków runtime na konkretnym komputerze.
- Przegląd objął cały krytyczny przepływ danych: **Python model → IR → planner → runner → engine/native backend**.
- Największe ryzyka skupiają się w kilku centralnych plikach, a nie w setkach małych modułów; dlatego raport jest zorganizowany wokół tych punktów skupienia.
- Gdzie coś jest świadomą decyzją stagingową, zaznaczam to wprost – nie wszystko co ograniczone jest „błędem”, ale część takich ograniczeń wymaga uszczelnienia kontraktu, żeby nie było mylących wyników.
- Priorytety oznaczam jako: `Critical`, `High`, `Medium`, `Low`, oraz czasem `Positive/Guardrail` gdy kod robi coś dobrze i warto ten wzorzec skopiować.


## 2. Główna mapa wykonania FEM w repo


1. `packages/fullmag-py/src/fullmag/model/*`
   - użytkownik buduje model, dynamikę, wzbudzenia i siatkę/asset references,
   - tutaj pojawiają się pierwsze hardkody na poziomie API (`solver='mqs_2p5d_az'`, `current_distribution='uniform'`, adaptive config bogatszy niż wykonanie).

2. `crates/fullmag-ir/src/lib.rs`
   - kontrakt semantyczny problemu,
   - już teraz modeluje więcej niż wykonanie: precision, adaptive fields, periodic BC, tangent-plane implicit, Oersted waveforms.

3. `crates/fullmag-plan/src/fem.rs` i `crates/fullmag-plan/src/mesh.rs`
   - rozwiązywanie problemu do planu wykonania,
   - wybór realizacji demagu, budowa air-box config, ograniczenia multi-body/shared-domain mesh, mapowanie wzbudzeń i magnetoelastyki.

4. `crates/fullmag-runner/src/fem_reference.rs`
   - CPU baseline / reference FEM run,
   - w praktyce narrow executable slice: Exchange + optional Demag + optional Zeeman, double precision.

5. `crates/fullmag-engine/src/fem.rs`
   - główny CPU reference solver FEM,
   - tutaj siedzą najcięższe koszty pamięciowe i architektoniczne.

6. `crates/fullmag-runner/src/native_fem.rs`
   - bezpieczna osłona Rust dla natywnego backendu,
   - ważne: tu siedzą też decyzje kontraktowe (integrator, precision, solver config, demag realization, air-box boundary marker).

7. `native/backends/fem/include/*.h` i `native/backends/fem/src/*.cpp/*.cu`
   - stan natywnego backendu MFEM/CUDA,
   - context, API, device probing, Oersted, thermal field, kernels, bridge do MFEM.


## 3. Executive summary

### 3.1. Największy problem CPU reference FEM
architektura `crates/fullmag-engine/src/fem.rs` jest fundamentalnie gęsta: globalna macierz sztywności, macierz masy brzegowej i układ demagnetyzacyjny są trzymane jako pełne `Vec<f64>` rozmiaru `n_nodes * n_nodes`, a demag Poisson/Robin jest rozwiązywany gęstym solverem liniowym. To ogranicza skalowalność znacznie wcześniej niż sama fizyka problemu.

### 3.2. Największy problem natywnego FEM GPU
ścieżka native/MFEM jest funkcjonalnie obiecująca, ale wciąż ma kilka ukrytych fallbacków i twardych założeń: część konfiguracji siedzi w env (`FULLMAG_FEM_GPU_INDEX`, `FULLMAG_FEM_MFEM_DEVICE`), nieobsługiwane integratory są sprowadzane do Heuna, a Oersted `PiecewiseLinear` jest cicho redukowany do trybu stałego.

### 3.3. Największy problem kontraktu danych
IR i Python DSL eksponują bogatszy model niż wykonanie. `AdaptiveTimeStepIR` i Python `AdaptiveTimestep` mają `rtol`, `growth_limit`, `shrink_limit`, `max_spin_rotation`, `norm_tolerance`, ale CPU runner wykorzystuje tylko `atol`, `dt_min`, `dt_max`, `safety`, a natywne FFI nie niesie `max_spin_rotation` ani `norm_tolerance`.

### 3.4. Największy problem powtarzalności i diagnostyki
losowe pole termiczne w natywnej ścieżce używa `static thread_local std::mt19937_64 rng(42)`, a `context_copy_field_f64` zwraca zera, gdy pole nie zostało policzone lub ma zły rozmiar. To utrudnia wykrywanie błędów i może dawać złudne wrażenie poprawności.

### 3.5. Największy problem wokół air-boxa/demagu
planer i natywna ścieżka mają mocno zaszyte heurystyki: `grading=1.4`, `boundary_marker=99`, `robin_beta_mode='dipole'`, `robin_beta_factor=2.0`, a CPU reference Poisson/Robin dodatkowo stosuje uproszczony `robin_beta = 1 / equivalent_radius(total_volume)` zamiast bardziej jawnego, geometrycznie kontrolowanego modelu brzegowego.


## 4. Mocne strony obecnego kierunku

- Planer potrafi odmówić nieuczciwego wykonania – np. izotropowa magnetostrykcja jest odrzucana bez stratnego mapowania na `B1/B2`.

- Natywna ścieżka waliduje długości pól per-node i pilnuje podstawowych warunków poprawności materiału i geometrii już podczas budowy kontekstu.

- Repo jest uczciwe co do etapu dojrzałości: CPU reference jest traktowane jako baseline, a natywne MFEM/libCEED/hypre jest jeszcze dopracowywane.

- W CPU reference jest już częściowe cache’owanie workspace transfer-grid demagu, więc jest dobry punkt wyjścia do dalszej optymalizacji.

- W natywnym backendzie jest osobny kanał availability/device-info, więc można z tego zrobić jawny, capability-driven solver/runtime picker bez dalszego hardkodowania w UI.


## 5. Lista ustaleń szczegółowych


### FEM-001 — CPU reference FEM trzyma globalną macierz sztywności jako pełną macierz `n_nodes × n_nodes`

**Severity:** Critical


**Pliki / moduły:**

- `crates/fullmag-engine/src/fem.rs`


**Co widać w kodzie:**

- `MeshTopology` zawiera `stiffness_system: Vec<f64>`.

- W `MeshTopology::from_ir` tworzony jest `let mut global_stiffness = vec![0.0; n_nodes * n_nodes];`.


**Dlaczego to jest problem:**

- Pamięć rośnie jak O(N²), co zabija większe siatki jeszcze przed startem iteracji czasowej.

- Budowa topologii staje się drogim krokiem jednorazowym, ale koszt pamięci zostaje z procesem na cały run.

- Ta decyzja wymusza później gęstą ścieżkę w demagu Poisson/Robin i utrudnia rozsądną prealokację na CPU.


**Co poprawić:**

- Przenieść operator wymiany/demagu CPU na format rzadki (CSR/CSC lub własny blokowy format tet-based).

- Rozdzielić lokalne macierze elementowe od globalnego operatora – dla explicit exchange można obejść się bez budowy pełnego operatora globalnego.

- Jeżeli docelowo ma zostać CPU reference, to traktować go jako correctness baseline i jawnie ograniczyć rozmiar problemu; nie udawać ścieżki produkcyjnej.


### FEM-002 — CPU reference buduje również gęstą macierz masy brzegowej i gęsty układ demag

**Severity:** Critical


**Pliki / moduły:**

- `crates/fullmag-engine/src/fem.rs`


**Co widać w kodzie:**

- Tworzony jest `let mut boundary_mass = vec![0.0; n_nodes * n_nodes];`.

- `let mut demag_system = global_stiffness.clone();` i potem dodawane jest `robin_beta * boundary_mass`.


**Dlaczego to jest problem:**

- Koszt pamięci i przepustowości jest duplikowany: trzy duże gęste bufory zamiast jednego operatora w formacie rzadkim.

- To z definicji blokuje duże air-boxy, czyli dokładnie te przypadki, gdzie FEM Poisson ma największy sens.


**Co poprawić:**

- Połączyć ścieżkę Poisson/Robin z rzadkim assemble + iteracyjnym solverem.

- Oddzielić masę brzegową od układu objętościowego i składać operator końcowy dopiero w solverze/preconditionerze.


### FEM-003 — CPU reference Poisson/Robin demag jest liczony przez gęsty solver liniowy

**Severity:** Critical


**Pliki / moduły:**

- `crates/fullmag-engine/src/fem.rs`


**Co widać w kodzie:**

- `robin_demag_observables_from_vectors` wywołuje `solve_dense_linear_system(&self.demag_linear_system, &rhs)`.

- To jest naturalna konsekwencja gęstej reprezentacji operatora.


**Dlaczego to jest problem:**

- Koszt pamięci i czasu jest zbyt duży dla sensownych siatek 3D.

- Ta ścieżka ma znaczenie głównie jako test poprawności i małą walidację, nie jako solver użytkowy.


**Co poprawić:**

- Wprowadzić osobny rzadki solver Poissona na CPU z preconditionerem (CG/MINRES + ILU/AMG/SSOR).

- Jeżeli tego nie robisz od razu, dodaj twardy limit rozmiaru problemu i bardzo czytelną diagnozę, że to baseline-only.


### FEM-004 — Robin beta w CPU reference jest heurystyką `1 / equivalent_radius(total_volume)`

**Severity:** High


**Pliki / moduły:**

- `crates/fullmag-engine/src/fem.rs`


**Co widać w kodzie:**

- `equivalent_radius(total_volume.max(1e-30))`.

- `robin_beta = 1.0 / equivalent_radius.max(1e-30)` gdy istnieją boundary nodes.


**Dlaczego to jest problem:**

- Warunek brzegowy zależy od objętości i sferycznego odpowiednika, a nie od jawnej geometrii air-boxa.

- Wynik może być sensowny dla małych testów, ale jest słabo sterowalny i ma słabą przejrzystość fizyczną.


**Co poprawić:**

- Jawnie rozdzielić: `legacy_robin_beta`, `dipole_robin_beta`, `user_robin_beta`.

- Dla CPU reference albo przyjąć ten model jako baseline test-only, albo pobierać `robin_beta_factor`/geometrię z `air_box_config` zamiast zgadywać z samej objętości.


### FEM-005 — Równoległa składnia pola wymiany na CPU używa bufora `n_nodes` na wątek

**Severity:** High


**Pliki / moduły:**

- `crates/fullmag-engine/src/fem.rs`


**Co widać w kodzie:**

- Ścieżka `rayon` robi `fold(|| vec![[0.0,0.0,0.0]; n_nodes], ...)` i `reduce(|| vec![[0.0,0.0,0.0]; n_nodes], ...)`.


**Dlaczego to jest problem:**

- Pamięć rośnie jak O(T·N), gdzie T to liczba workerów.

- Przy większych siatkach zysk z równoległości może zostać zjedzony przez cache misses i koszt redukcji pełnych wektorów.


**Co poprawić:**

- Przejść na składanie element-po-elemencie do rzadkiego operatora, a samo `H_ex` liczyć przez SpMV.

- Jeżeli chcesz zostać przy explicit assembly field, użyj blokowania po regionach/node-chunks albo grafowego kolorowania zamiast pełnego `vec[n_nodes]` per thread.


### FEM-006 — CPU transfer-grid demag cache’uje workspace FFT, ale nadal rasteryzuje i odtwarza sampling przy każdym wywołaniu

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-engine/src/fem.rs`


**Co widać w kodzie:**

- Kod ma `thread_local` cache na `(grid, cell_size, fdm_problem, ws)`.

- Jednocześnie każdy call przechodzi przez rasteryzację magnetyzacji do siatki transferowej i sampling z powrotem na węzły FEM.

- Kod sam wypisuje jednorazowy komunikat, że workspace FFT będzie cache’owany.


**Dlaczego to jest problem:**

- To nie jest katastrofa, ale koszt projekcji FEM↔grid może dominować przy małych krokach i gęstym odczycie pól.

- Brakuje prekomputowanych map nodalnych / barycentrycznych dla transferu.


**Co poprawić:**

- Precompute node->cell weights / interpolation stencils.

- Oddziel aktualizację aktywnych komórek od pełnej rekonstrukcji siatki transferowej.

- Dodać benchmarki osobno dla rasteryzacji, FFT i samplingu zwrotnego.


### FEM-007 — CPU runner ucina większą część kontraktu adaptive time stepping

**Severity:** Critical


**Pliki / moduły:**

- `packages/fullmag-py/src/fullmag/model/dynamics.py`

- `crates/fullmag-ir/src/lib.rs`

- `crates/fullmag-runner/src/fem_reference.rs`


**Co widać w kodzie:**

- Python `AdaptiveTimestep` i `AdaptiveTimeStepIR` mają `atol`, `rtol`, `dt_initial`, `dt_min`, `dt_max`, `safety`, `growth_limit`, `shrink_limit`, `max_spin_rotation`, `norm_tolerance`.

- CPU runner mapuje tylko `atol -> max_error`, `dt_min`, `dt_max`, `safety -> headroom`.


**Dlaczego to jest problem:**

- Użytkownik może legalnie zadać parametry, które potem są ignorowane bez czytelnej diagnozy.

- To psuje zaufanie do solvera i utrudnia strojenie stabilności/czasu wykonania.


**Co poprawić:**

- Albo w pełni zaimplementować te pola w engine adaptive controller, albo jawnie odrzucać nieobsługiwane opcje na plan/runner boundary.

- `max_spin_rotation` i `norm_tolerance` nie mogą być cichym no-op.


### FEM-008 — CPU runner ma ukryty domyślny krok `1e-13` s

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-runner/src/fem_reference.rs`

- `crates/fullmag-runner/src/native_fem.rs`


**Co widać w kodzie:**

- Jeśli brak `fixed_timestep` i brak `adaptive.dt_initial`, runner podstawia `1e-13`.

- Analogiczny fallback istnieje także w ścieżce natywnej podczas budowy `plan_desc`.


**Dlaczego to jest problem:**

- To może niepostrzeżenie zmieniać charakter eksperymentu i wydajność.

- Dla części problemów będzie zbyt ostrożne, dla innych za duże – a użytkownik nie dostaje jasnej informacji.


**Co poprawić:**

- Wprowadzić jawny policy layer: `dt_policy = user | recommended | fallback` i logować/serializować wynik.

- Jeżeli fallback jest użyty, dopisz notę do provenance i logu startowego.


### FEM-009 — CPU reference FEM pozostaje double-only mimo istnienia enum `ExecutionPrecision`

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-runner/src/fem_reference.rs`


**Co widać w kodzie:**

- Runner zwraca błąd dla `execution_precision='single'`.

- `execution_provenance` i tak twardo wpisuje `precision: "double"`.


**Dlaczego to jest problem:**

- To akurat jest uczciwe na poziomie błędu, ale kontrakt danych jest bogatszy niż wykonanie.

- Jeżeli UI kiedyś pokaże `single` dla CPU FEM, musi to być jawnie zablokowane capability matrix.


**Co poprawić:**

- Dodać publiczną capability matrix per backend/device/precision i używać jej wszędzie zamiast heurystyk.


### FEM-010 — CPU reference FEM implementuje tylko wąski podzbiór oddziaływań

**Severity:** High


**Pliki / moduły:**

- `crates/fullmag-runner/src/fem_reference.rs`


**Co widać w kodzie:**

- Runner buduje `EffectiveFieldTerms` z `exchange`, `demag`, `external_field`, ale `magnetoelastic`, `uniaxial_anisotropy`, `cubic_anisotropy`, `interfacial_dmi`, `bulk_dmi`, `zhang_li_stt`, `slonczewski_stt`, `sot` ustawia na `None`.

- Komentarz pliku mówi wprost o current executable slice: Exchange + optional Demag + optional Zeeman + LLG(heun) + double.


**Dlaczego to jest problem:**

- CPU reference nie jest pełnym solverem FEM – bardziej baseline’em dla części funkcjonalności.

- Jeżeli użytkownik oczekuje pełnej parytetu z planem/IR, dostanie niespójny rezultat lub plan-time refusal.


**Co poprawić:**

- W capability matrix zaznaczyć CPU reference FEM jako osobną, ograniczoną implementację.

- Dla brakujących terms albo natychmiastowy error, albo jawne semantyczne `not executable in cpu_reference_fem` już na plan stage.


### FEM-011 — Periodic BC w spin-wave/eigen są zapisane w IR, ale wykonanie nadal ich nie wspiera

**Severity:** High


**Pliki / moduły:**

- `crates/fullmag-ir/src/lib.rs`

- `crates/fullmag-runner/src/fem_eigen.rs`

- `crates/fullmag-engine/src/fem.rs`


**Co widać w kodzie:**

- `MeshIR` przechowuje `periodic_boundary_pairs` i `periodic_node_pairs`.

- Komentarz IR mówi, że dla `Periodic` runner zwróci błąd dopóki implementacja nie powstanie.

- `MeshTopology` przechowuje `periodic_node_pairs`, ale brak pełnej egzekucji w solverach czasowych.


**Dlaczego to jest problem:**

- Dane są już modelowane, co może tworzyć wrażenie gotowości funkcji.

- Brak domknięcia implementacji grozi mnożeniem pół-obsługiwanych przypadków.


**Co poprawić:**

- Albo dopiąć pełny merge/constraint elimination dla DOF, albo uszczelnić walidację tak, by każdy periodic use-case kończył się czytelnym błędem przed startem runu.


### FEM-012 — `TangentPlaneImplicit` nadal istnieje tylko semantycznie

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-ir/src/lib.rs`


**Co widać w kodzie:**

- IR opisuje `TangentPlaneImplicit` jako FEM-only relaxation, ale wykonanie jest odłożone do czasu gotowej infrastruktury tangent-space.


**Dlaczego to jest problem:**

- Kontrakt API jest bogatszy niż implementacja.

- Może to zaburzać plan budowy pełnego solvera relaksacyjnego FEM.


**Co poprawić:**

- Dodać capability/availability na poziomie algorytmu relaksacji, tak samo jak dla backend/device/precision.


### FEM-013 — Natywny runner wymaga `shared_domain_mesh_with_air` dla Poisson air-box, a przy braku wyboru demagu domyślnie wpada w transfer-grid

**Severity:** High


**Pliki / moduły:**

- `crates/fullmag-runner/src/native_fem.rs`


**Co widać w kodzie:**

- Dla `MergedMagneticMesh` + Poisson natywny runner zwraca błąd, że air-box wymaga `domain_mesh_mode='shared_domain_mesh_with_air'`.

- `resolved_demag_realization` przy braku wartości jest ustawiane na `TransferGrid`.


**Dlaczego to jest problem:**

- To jest częściowo poprawne, ale bardzo ważne dla uczciwości UI i planera.

- Użytkownik nie może zgadywać, kiedy demag poleci jako Poisson, a kiedy jako transfer-grid.


**Co poprawić:**

- Wynikowy `resolved_demag_realization` musi być serializowany w session/run metadata i widoczny w UI.

- Dodaj twardą, centralną regułę rozwiązywania demagu i testy acceptance dla `Auto` / `TransferGrid` / `Poisson*`.


### FEM-014 — Planer ma zaszyte heurystyki air-boxa: grading, marker, shape, robin mode/factor

**Severity:** High


**Pliki / moduły:**

- `crates/fullmag-plan/src/mesh.rs`


**Co widać w kodzie:**

- `build_air_box_config` ustawia `grading: 1.4`, `shape: "bbox"`, `robin_beta_mode: "dipole"`, `robin_beta_factor: 2.0`.

- Boundary marker jest wybierany heurystycznie z preferencją dla `99`, w przeciwnym razie `max(marker)` lub fallback `99`.


**Dlaczego to jest problem:**

- Uproszczenie jest zrozumiałe, ale dziś jest ukryte i rozproszone.

- Dla użytkownika i testów regresyjnych te heurystyki powinny być jawne i stabilne.


**Co poprawić:**

- Wynieść `AirBoxPolicy` do jednego miejsca: wspólna struktura/enum z serializacją do planu i provenance.

- Oddzielić wartości domyślne od wartości wyliczonych oraz dodać noty diagnostyczne do run metadata.


### FEM-015 — Konfiguracja natywnego solvera demagu jest twardo zaszyta na `CG + AMG, 1e-8, 500 iteracji`

**Severity:** High


**Pliki / moduły:**

- `crates/fullmag-runner/src/native_fem.rs`


**Co widać w kodzie:**

- `demag_solver` w `plan_desc` jest budowany z `solver=CG`, `preconditioner=AMG`, `relative_tolerance=1e-8`, `max_iterations=500`.


**Dlaczego to jest problem:**

- Nie da się stroić solvera dla trudnych siatek, heterogenicznych materiałów lub słabej geometrii air-boxa.

- Jedna konfiguracja może być za agresywna lub za słaba zależnie od przypadku.


**Co poprawić:**

- Wprowadzić jawny `FemLinearSolverPolicy` w IR/planie.

- Na minimum: `solver`, `preconditioner`, `rtol`, `max_iterations`, `print_level`, opcjonalnie `abs_tol` i wybór backendu preconditionera.


### FEM-016 — Natywny runner cicho degraduje nieobsługiwane integratory do Heuna

**Severity:** Critical


**Pliki / moduły:**

- `crates/fullmag-runner/src/native_fem.rs`


**Co widać w kodzie:**

- Match na `plan.integrator` dla nieobsłużonego wariantu robi `eprintln!(...)` i zwraca `FULLMAG_FEM_INTEGRATOR_HEUN`.


**Dlaczego to jest problem:**

- To jest klasyczny silent fallback psujący wierność eksperymentu numerycznego.

- Wynik może wyglądać sensownie, ale pochodzić z innego integratora niż zadany.


**Co poprawić:**

- Usunąć fallback. Zamiast tego: twardy błąd plan-time lub runner-time z listą wspieranych integratorów.

- Jeśli Heun ma być kompatybilnym ratunkiem tylko w trybie developerskim, zrób to przez jawne `allow_integrator_downgrade=false/true` i log do provenance.


### FEM-017 — Natywne CUDA kernels są napisane tylko dla `double` mimo istnienia ścieżki `Single`

**Severity:** High


**Pliki / moduły:**

- `native/backends/fem/include/kernels.h`

- `native/backends/fem/src/kernels.cu`

- `crates/fullmag-runner/src/native_fem.rs`


**Co widać w kodzie:**

- `kernels.h` i `kernels.cu` mają interfejsy wyłącznie na `const double*` / `double*`.

- Runner potrafi mapować `ExecutionPrecision::Single` na enum FFI.


**Dlaczego to jest problem:**

- Precision contract nie jest domknięty: część backendu mówi `single`, ale część GPU kernels nie ma floatowego toru.

- Może to oznaczać konwersje po drodze, brak pełnego wsparcia lub pół-obsługiwany tryb.


**Co poprawić:**

- Albo zrób natywne templated kernels `<float,double>`, albo jawnie zablokuj `single` dopóki cały pipeline nie będzie naprawdę jednoprecyzyjny.

- Do capability matrix wpisz dokładnie, które tuple precision/device są public-ready, a które eksperymentalne.


### FEM-018 — Komentarz w `kernels.cu` mówi o AOS-3, ale interfejs jest SoA (`mx`, `my`, `mz`)

**Severity:** Low


**Pliki / moduły:**

- `native/backends/fem/src/kernels.cu`

- `native/backends/fem/include/kernels.h`


**Co widać w kodzie:**

- Komentarz: `All kernels operate on AOS-3 layout: contiguous [x,y,z] per node`.

- Rzeczywiste sygnatury przekazują osobne bufory `mx`, `my`, `mz`, `hx`, `hy`, `hz`, czyli klasyczne SoA.


**Dlaczego to jest problem:**

- To niekoniecznie psuje wynik, ale utrudnia utrzymanie i wprowadza w błąd przy optymalizacji pamięci.


**Co poprawić:**

- Naprawić komentarz albo układ danych. Dokumentacja ma odzwierciedlać rzeczywistą pamięć.


### FEM-019 — CUDA kernels obejmują tylko wąski zestaw operacji LLG/akumulacji pola

**Severity:** Medium


**Pliki / moduły:**

- `native/backends/fem/src/kernels.cu`


**Co widać w kodzie:**

- Plik zawiera fused LLG RHS, normalizację wektorów, akumulację `h_eff`, oraz device max przez CUB.


**Dlaczego to jest problem:**

- Część pracy i tak siedzi w MFEM-side / host orchestration, więc pełna optymalizacja GPU nie jest jeszcze domknięta.

- To tłumaczy, dlaczego precision/features w native path są nadal w ruchu.


**Co poprawić:**

- Najpierw domknąć correctness i kontrakt, potem dopiero poszerzać native fused path.

- W benchmarkach rozdzielić: koszt assembly/operator application, koszt LLG RHS, koszt transferów i snapshotów.


### FEM-020 — CUDA block size jest na sztywno ustawiony na 256

**Severity:** Low


**Pliki / moduły:**

- `native/backends/fem/src/kernels.cu`


**Co widać w kodzie:**

- `static constexpr int kBlockSize = 256;`.


**Dlaczego to jest problem:**

- To nie musi być zły wybór, ale jest hardkodowany i nieprzetestowany per architektura/problem.


**Co poprawić:**

- Dodać mikrobenchmarki oraz ewentualnie autotuning/compile-time constants dla kilku targetów.


### FEM-021 — Pole termiczne używa stałego ziarna RNG `42`

**Severity:** Critical


**Pliki / moduły:**

- `native/backends/fem/src/context.cpp`


**Co widać w kodzie:**

- W `refresh_thermal_field_for_current_state` jest `static thread_local std::mt19937_64 rng(42);`.


**Dlaczego to jest problem:**

- Przy uruchomieniach bez jawnego seeda użytkownik może otrzymywać deterministyczny „szum” termiczny, nie wiedząc o tym.

- To miesza powtarzalność techniczną z fizyczną semantyką modelu sLLG.


**Co poprawić:**

- Dodać jawne pole `seed_policy` / `thermal_seed` do planu lub runtime metadata.

- Tryby: `deterministic(seed)`, `nondeterministic(os_rng)`, `replay_from_artifact(seed)`.


### FEM-022 — Thermal sigma liczone jest z uśrednionego `alpha`, `Ms` i średniej objętości węzła

**Severity:** High


**Pliki / moduły:**

- `native/backends/fem/src/context.cpp`


**Co widać w kodzie:**

- Sigma używa `average_magnetic_scalar_field` dla `alpha` i `Ms`, oraz `average_magnetic_node_volume(ctx)`.


**Dlaczego to jest problem:**

- W heterogenicznych materiałach i nieregularnych siatkach może to zbyt mocno uśredniać lokalną fizykę.

- Zależy od tego, czy chcesz model per-node czy baseline globalny; obecny kod robi globalny miks.


**Co poprawić:**

- Przejść na per-node sigma tam, gdzie `alpha_field`, `Ms_field` i lokalna objętość są dostępne.

- Jeżeli zostawiasz globalną wersję, opisać ją jawnie jako approximation mode w metadata runu.


### FEM-023 — Oersted cylinder w natywnej ścieżce wspiera tylko oś +Z

**Severity:** High


**Pliki / moduły:**

- `native/backends/fem/src/context.cpp`


**Co widać w kodzie:**

- Kod normalizuje `oersted_axis`, a potem odrzuca wszystko poza `[0,0,1]` w tolerancji `1e-6`.


**Dlaczego to jest problem:**

- To mocno ogranicza geometrię wzbudzeń i łatwo zaskoczy użytkownika modelującego antenę/prąd w innym ułożeniu.


**Co poprawić:**

- Zaimplementować ogólną orientację przez lokalny układ ortonormalny i transformację punktów do przestrzeni cylindra.

- Dodać testy dla osi X/Y i dla osi ukośnej po rotacji.


### FEM-024 — Model przestrzenny Oersteda zakłada nieskończony cylinder według prawa Ampère’a

**Severity:** Medium


**Pliki / moduły:**

- `native/backends/fem/src/context.cpp`

- `crates/fullmag-ir/src/lib.rs`


**Co widać w kodzie:**

- Komentarz i kod używają wzoru `inside: r / (2πR²)`, `outside: 1 / (2πr)` na polu azymutalnym.

- IR opisuje to jako precomputowany profil `H_oe(x,y,z)` skalowany prądem i envelope w czasie.


**Dlaczego to jest problem:**

- Dla STNO/MTJ może to być sensowne przybliżenie, ale nie jest to ogólny solver prądowy 3D.


**Co poprawić:**

- Nazwać ten model jawnie `oersted_cylinder_infinite` albo wprowadzić enum realizacji Oersteda.

- Nie mieszać go z przyszłym solverem prądowym/antenowym 3D bez rozróżnienia w metadata i UI.


### FEM-025 — `TimeDependenceIR::PiecewiseLinear` dla Oersteda jest cicho redukowany do stałego prądu

**Severity:** Critical


**Pliki / moduły:**

- `crates/fullmag-plan/src/fem.rs`

- `native/backends/fem/src/context.cpp`


**Co widać w kodzie:**

- Planer przy `PiecewiseLinear` ustawia `fem_plan.oersted_time_dep_kind = 0`.

- Kontekst przy `kind=0` po prostu nic nie robi w switchu i zostawia skalowanie stałe.


**Dlaczego to jest problem:**

- To jest realny błąd semantyczny: użytkownik zadaje przebieg czasowy, a dostaje DC.

- Wynik symulacji może wyglądać poprawnie numerycznie, ale odpowiada innemu eksperymentowi.


**Co poprawić:**

- Bezzwłocznie usunąć tę degradację. Albo zaimplementować piecewise linear, albo zwracać błąd plan-time.

- To powinno być priorytet P0/P1.


### FEM-026 — `context_copy_field_f64` zwraca zera, gdy pole nie istnieje lub ma zły rozmiar

**Severity:** High


**Pliki / moduły:**

- `native/backends/fem/src/context.cpp`


**Co widać w kodzie:**

- Przy `source == nullptr || source->size() != out_len` funkcja zeruje `out_xyz` i zwraca `FULLMAG_FEM_OK`.


**Dlaczego to jest problem:**

- Błąd wygląda jak poprawne pole zerowe.

- To bardzo utrudnia debugging snapshotów i integrację z UI/live preview.


**Co poprawić:**

- Rozróżnić: `NOT_COMPUTED`, `UNSUPPORTED_OBSERVABLE`, `SIZE_MISMATCH`.

- Dla preview można mieć osobny tryb `allow_zero_fill_for_preview=false/true`, ale domyślnie nie zwracać `OK` na błąd stanu.


### FEM-027 — Bulk DMI nie ma trwałego bufora readback; w kodzie jest jawne TODO

**Severity:** High


**Pliki / moduły:**

- `native/backends/fem/src/context.cpp`


**Co widać w kodzie:**

- Komentarz: `TODO: store h_bulk_dmi_xyz persistently in context for proper readback`.

- Dla `FULLMAG_FEM_OBSERVABLE_H_DMI_BULK` funkcja zwraca de facto `h_dmi_xyz` albo zera.


**Dlaczego to jest problem:**

- Snapshoty i diagnostyka pola DMI bulk mogą być błędne lub niejednoznaczne.


**Co poprawić:**

- Dodać osobny bufor `h_bulk_dmi_xyz` i spójny kontrakt readbacku.

- Rozdzielić `H_DMI_INTERFACIAL` i `H_DMI_BULK` także w runnerze i UI quantities.


### FEM-028 — Kod błędu `UNAVAILABLE` jest nadużywany dla różnych klas problemów

**Severity:** Medium


**Pliki / moduły:**

- `native/backends/fem/src/api.cpp`


**Co widać w kodzie:**

- `fullmag_fem_backend_step` zwraca `FULLMAG_FEM_ERR_UNAVAILABLE` zarówno dla braku backendu, jak i dla awarii kroku/snapshotu.


**Dlaczego to jest problem:**

- Warstwa wyżej nie może łatwo odróżnić: brak feature vs błąd solvera vs błąd danych wejściowych.


**Co poprawić:**

- Wprowadzić dokładniejszą taksonomię błędów: `UNAVAILABLE`, `INVALID`, `SOLVER_FAILURE`, `NOT_COMPUTED`, `INTERRUPTED`, `INTERNAL`.

- Dodać mapowanie do `RunError.kind` po stronie Rust.


### FEM-029 — Wybór GPU urządzenia jest schowany w zmiennych środowiskowych

**Severity:** Medium


**Pliki / moduły:**

- `native/backends/fem/src/api.cpp`

- `native/backends/fem/src/mfem_bridge.cpp`


**Co widać w kodzie:**

- Obsługiwane są `FULLMAG_FEM_GPU_INDEX` i `FULLMAG_CUDA_DEVICE_INDEX`.


**Dlaczego to jest problem:**

- To utrudnia reprodukcję, debug i docelowy UX solver pickera.


**Co poprawić:**

- Dodać jawny parametr runtime/CLI/API dla indeksu GPU i traktować env tylko jako fallback developerski.


### FEM-030 — MFEM device string i wymaganie CEED są również ukryte w env

**Severity:** Medium


**Pliki / moduły:**

- `native/backends/fem/src/api.cpp`

- `native/backends/fem/src/mfem_bridge.cpp`


**Co widać w kodzie:**

- `FULLMAG_FEM_MFEM_DEVICE` oraz `FULLMAG_FEM_REQUIRE_CEED=1` sterują availability i doborem backendu urządzenia.

- Domyślny device string to `ceed-cuda:/gpu/cuda/shared` gdy MFEM ma CEED, inaczej `cuda`.


**Dlaczego to jest problem:**

- Prawdziwy runtime tuple jest niejawny, a zachowanie może się różnić między hostami.


**Co poprawić:**

- Przenieść te parametry do jawnego runtime contract/manifestu i wypisać je w provenance.


### FEM-031 — GPU eigensolver jest gęsty i kopiuje pełne macierze `K` i `M` na GPU

**Severity:** High


**Pliki / moduły:**

- `crates/fullmag-runner/src/fem_eigen.rs`

- `native/backends/fem/src/api.cpp`


**Co widać w kodzie:**

- Komentarze mówią wprost o dense generalized eigenproblem `K·x = λ·M·x` i `cuSolverDN Dsygvd`.

- API kopiuje pełne `n*n` bufory host->device nawet jeśli solver korzysta z lower triangle.


**Dlaczego to jest problem:**

- Skalowanie pamięci O(N²) i czasu O(N³) jest nieuniknione dla większych układów.

- GPU pomaga, ale nie zmienia klasy złożoności.


**Co poprawić:**

- Traktować tę ścieżkę jako etap przejściowy.

- Docelowo przejść na sparse eigensolver / shift-invert / operator-free Krylov dla wybranych modów zamiast pełnego dense solve.


### FEM-032 — GPU eigensolver przełącza się przezroczysto na CPU LAPACK przy niedostępności lub błędzie

**Severity:** Critical


**Pliki / moduły:**

- `crates/fullmag-runner/src/fem_eigen.rs`


**Co widać w kodzie:**

- Komentarz mówi o transparent fallback do CPU LAPACK.

- Kod przy `Err(reason)` wypisuje info/warning i wykonuje `solve_real_symmetric_eigenpairs(...)` na CPU.


**Dlaczego to jest problem:**

- To może ukrywać brak GPU, problemy z CUDA lub błędną konfigurację bez zmiany statusu runu.


**Co poprawić:**

- Dla jawnego wyboru `device=gpu` fallback musi być wyłączony.

- Dopuszczalny jest tylko w trybie `auto` i z pełnym `resolved_device=cpu` w metadata + wyraźnym statusem downgraded.


### FEM-033 — Eigensolver FEM wspiera tylko `transfer_grid` dla demagu i tylko double

**Severity:** High


**Pliki / moduły:**

- `crates/fullmag-runner/src/fem_eigen.rs`


**Co widać w kodzie:**

- Runner zwraca błąd, jeśli `demag_realization` nie jest `transfer_grid`.

- Runner zwraca też błąd dla precision innej niż `double`.


**Dlaczego to jest problem:**

- Zakres funkcjonalny eigen ścieżki jest dużo węższy niż sugeruje ogólny model FEM.


**Co poprawić:**

- W capability matrix mieć osobny profil dla `fem_eigen`.

- Nie mieszać jego możliwości z time-domain FEM w jednym ogólnym badge’u `backend=fem`.


### FEM-034 — Python API dla antenna field source ma twardy solver `mqs_2p5d_az` i `air_box_factor=12.0`

**Severity:** Medium


**Pliki / moduły:**

- `packages/fullmag-py/src/fullmag/model/antenna.py`


**Co widać w kodzie:**

- `AntennaFieldSource.solver: str = "mqs_2p5d_az"` i walidacja dopuszcza tylko tę wartość.

- `air_box_factor: float = 12.0`.


**Dlaczego to jest problem:**

- To jest wyraźny hardkod interfejsu użytkownika, który będzie blokował rozwój innych realizacji wzbudzeń/prądów.


**Co poprawić:**

- Zamienić `solver: str` na enum/typed strategy i dodać capability negotiation.

- Domyślny `air_box_factor` w Pythonie nie powinien maskować polityki planera/back-endu.


### FEM-035 — Anteny wspierają dziś wyłącznie `current_distribution='uniform'`

**Severity:** Low


**Pliki / moduły:**

- `packages/fullmag-py/src/fullmag/model/antenna.py`


**Co widać w kodzie:**

- `MicrostripAntenna` i `CPWAntenna` walidują wyłącznie `uniform`.


**Dlaczego to jest problem:**

- To ogranicza modelowanie realistycznych rozkładów prądu i pasm wyższych modów.


**Co poprawić:**

- Jeżeli to świadome ograniczenie v1 – zaznaczyć je w capability matrix i docs.

- W przeciwnym razie dodać przynajmniej `edge_peaked` / `skin_depth_approx` jako rozszerzalny enum.


### FEM-036 — Planer odrzuca izotropową magnetostrykcję bez fizycznie uzasadnionego mapowania na `B1/B2`

**Severity:** Positive/Guardrail


**Pliki / moduły:**

- `crates/fullmag-plan/src/fem.rs`


**Co widać w kodzie:**

- Dla `MagnetostrictionLawIR::Isotropic` planer zwraca błąd `refusing lossy fallback`.


**Dlaczego to jest problem:**

- To jest dobra decyzja – pokazuje, że repo już ma pewien standard uczciwości naukowej.


**Co poprawić:**

- Tę samą zasadę stosować do integratorów, Oersted waveform i precision/device fallbacks.


### FEM-037 — Repo samo sygnalizuje, że pełna głębia natywnego FEM GPU nadal jest w toku

**Severity:** Context


**Pliki / moduły:**

- `README.md`

- `crates/fullmag-runner/src/native_fem.rs`

- `crates/fullmag-plan/src/fem.rs`


**Co widać w kodzie:**

- README uczciwie opisuje obecny executable slice.

- `native_fem.rs` mówi o bootstrap transfer-grid demag i pending mesh-native/libCEED/hypre demag.

- Planner notuje, że native MFEM/libCEED/hypre GPU execution remains in progress.


**Dlaczego to jest problem:**

- Krytyka kodu musi brać pod uwagę, że część ścieżek jest świadomie stagingowa, a nie udawana jako skończona produkcja.


**Co poprawić:**

- Nie chować tej informacji – przenieść ją do capability/runtime matrix i ekranów UI.


### FEM-038 — Lazy FEM planner wczytuje `mesh_source` tylko z `.json`

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-plan/src/mesh.rs`


**Co widać w kodzie:**

- Obsługiwany jest tylko suffix `json`; inne formaty zwracają błąd.


**Dlaczego to jest problem:**

- To ogranicza pipeline wejściowy i może zmuszać użytkownika do dodatkowych konwersji assetów.


**Co poprawić:**

- Jeżeli chcesz zostać przy JSON – opisz to wyraźnie w docs.

- Docelowo dodać importer(y) lub osobny etap konwersji assetów do MeshIR.


### FEM-039 — Transfer-grid demag w CPU/native używa rozdzielczości pochodzącej z `hmax`/bbox, co nie musi być optymalne dla demagu

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-runner/src/fem_reference.rs`

- `native/backends/fem/src/mfem_bridge.cpp`

- `crates/fullmag-engine/src/fem.rs`


**Co widać w kodzie:**

- CPU reference dla `TransferGrid` przekazuje `Some([plan.hmax, plan.hmax, plan.hmax])`.

- Native side buduje transfer-grid dimensions z magnetic subset bbox i `hmax`.


**Dlaczego to jest problem:**

- Rozdzielczość FE siatki i optymalna siatka transfer-grid do demagu to nie zawsze to samo.


**Co poprawić:**

- Rozdzielić `fem_hmax` od `demag_transfer_cell_size` w planie/IR.

- Dodać auto-policy dla demagu niezależną od rozdzielczości elementów skończonych.


### FEM-040 — Wiele stałych progowych i markerów jest hardkodowanych (`1e-30`, `1e-18`, `1e-12`, `99`, `2.0`, `1.4`, `1e-13`)

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-engine/src/fem.rs`

- `crates/fullmag-plan/src/mesh.rs`

- `crates/fullmag-runner/src/native_fem.rs`

- `native/backends/fem/include/context.hpp`

- `native/backends/fem/src/context.cpp`

- `native/backends/fem/src/mfem_bridge.cpp`


**Co widać w kodzie:**

- Degenerate tet threshold `1e-30`.

- Air-box marker `99`, robin factor `2.0`, grading `1.4`.

- Fallback dt `1e-13`, transfer-grid minimums `1e-12`, bbox extent guards `1e-18`.


**Dlaczego to jest problem:**

- Rozproszone „magiczne liczby” utrudniają tuning, testy i spójność między backendami.


**Co poprawić:**

- Wprowadzić centralny moduł polityk/stałych numerycznych z opisem fizycznym i testami regresji.


### FEM-041 — `fullmag_fem_adaptive_config` FFI nie przenosi `max_spin_rotation` ani `norm_tolerance`

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-fem-sys/src/lib.rs`

- `crates/fullmag-runner/src/native_fem.rs`

- `crates/fullmag-ir/src/lib.rs`


**Co widać w kodzie:**

- IR ma te pola.

- FFI config zawiera tylko `atol`, `rtol`, `dt_initial`, `dt_min`, `dt_max`, `safety`, `growth_limit`, `shrink_limit`.

- W natywnym runnerze brak przekazania `max_spin_rotation` i `norm_tolerance`.


**Dlaczego to jest problem:**

- Część adaptive contract znika jeszcze przed wejściem do C++.


**Co poprawić:**

- Rozszerzyć FFI i natywny stepper o te pola albo jawnie zabronić ich w native path.


### FEM-042 — Ścieżka CPU reference i native mają różne poziomy uczciwości fallbacków

**Severity:** High


**Pliki / moduły:**

- `crates/fullmag-runner/src/fem_reference.rs`

- `crates/fullmag-runner/src/native_fem.rs`

- `crates/fullmag-runner/src/fem_eigen.rs`


**Co widać w kodzie:**

- CPU reference uczciwie odrzuca `single`.

- Native time-domain cicho degraduje nieobsługiwane integratory do Heuna.

- Native/runner eigen cicho degraduje GPU do CPU LAPACK.


**Dlaczego to jest problem:**

- Użytkownik nie ma spójnego modelu: kiedy system odmawia, a kiedy sam wybiera coś innego.


**Co poprawić:**

- Ujednolicić policy: w trybie `auto` fallback jawny i serializowany, w trybie ręcznego wyboru – brak fallbacku.


### FEM-043 — Planer automatycznie wybiera `PoissonRobin` gdy mesh ma air elements, w przeciwnym razie `TransferGrid`

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-plan/src/fem.rs`


**Co widać w kodzie:**

- Dla `RequestedFemDemagIR::Auto` kod sprawdza `mesh.element_markers.iter().any(|&m| m == 0)` i na tej podstawie wybiera realizację.


**Dlaczego to jest problem:**

- Reguła jest sensowna, ale powinna być jawnie widoczna w run metadata i UI.


**Co poprawić:**

- Zawsze serializować `requested_demag_realization` i `resolved_demag_realization` w session/run metadata.


### FEM-044 — CPU reference może być myląco używany do heterogenicznych materiałów, choć natywna ścieżka jest dużo bogatsza

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-plan/src/fem.rs`

- `crates/fullmag-runner/src/fem_reference.rs`


**Co widać w kodzie:**

- Planer wymaga natywnej GPU ścieżki dla heterogenicznych multi-body FEM materials, jeśli materiały nie są zgodne kształtem prawa.

- Jednocześnie CPU reference sam w sobie nie ma pełnej parytetu terms/material law.


**Dlaczego to jest problem:**

- Należy jasno rozróżniać baseline correctness CPU od docelowej ścieżki feature-complete native.


**Co poprawić:**

- W UI/CLI nie używać jednego badge’u `FEM`, tylko tuple z dokładną rodziną runtime i profilem możliwości.


### FEM-045 — Dane device/runtime nie są jeszcze pierwszoklasową częścią provenance sesji

**Severity:** Medium


**Pliki / moduły:**

- `crates/fullmag-runner/src/native_fem.rs`

- `crates/fullmag-runner/src/fem_reference.rs`


**Co widać w kodzie:**

- CPU provenance wpisuje `execution_engine` i `precision`, ale nie rozwiązuje pełnego kontraktu runtime.

- Native availability/device info istnieje, ale nie jest jeszcze widoczne jako pełny requested/resolved trail w całym produkcie.


**Dlaczego to jest problem:**

- Trudniej potem porównać wyniki i debugować rozbieżności CPU/GPU/MFEM/libCEED.


**Co poprawić:**

- Dodać pełne `requested_*` / `resolved_*` dla backend/device/precision/mode/runtime_family/worker/device_info do metadata runu i sesji.


## 6. Najważniejsze wnioski per warstwa


### 6.1 Python / user-facing DSL


- Interfejs użytkownika eksponuje bogatsze możliwości niż gwarantuje wykonanie.
- To samo w sobie nie jest jeszcze błędem, ale dopóki nie ma capability matrix i ostrych walidacji, użytkownik może dostać **semantyczny no-op**.
- Najbardziej ewidentne przykłady to:
  - `AdaptiveTimestep.max_spin_rotation` / `norm_tolerance`,
  - twardy solver `mqs_2p5d_az`,
  - twardy `current_distribution='uniform'`,
  - domyślny `air_box_factor=12.0` po stronie API użytkownika.


### 6.2 IR / planner


- IR jest już wystarczająco bogate, by opisać docelowy produkt FEM, ale nie ma jeszcze równie bogatej warstwy *capability*.
- Planer ma kilka bardzo dobrych guardrailów (np. odrzucenie stratnej magnetostrykcji izotropowej), ale obok tego występują też degradacje, które są już niebezpieczne:
  - `PiecewiseLinear` dla Oersteda jest redukowany do trybu stałego,
  - `Auto` w demagu jest rozwiązywane poprawnie heurystycznie, ale wynik tej decyzji nie jest jeszcze wystarczająco mocno eksponowany w run metadata,
  - heurystyki air-boxa są rozproszone i zaszyte.


### 6.3 CPU reference FEM


- Ta ścieżka jest cenna jako correctness baseline i ma uczciwie ograniczony zakres, ale **nie jest architekturą skalowalną**.
- Najważniejsze techniczne długi:
  - pełne macierze globalne O(N²),
  - gęsty solver Poissona/Robin,
  - równoległe assembly z buforami `vec[n_nodes]` per worker,
  - ograniczony adaptive controller,
  - brak pełnej parytetu oddziaływań.
- To wszystko nie oznacza, że CPU reference jest „zły” – oznacza, że trzeba go nazywać po imieniu: **reference/baseline**, a nie solver produkcyjny dla większych siatek.


### 6.4 Native FEM / MFEM / CUDA


- Natywna ścieżka jest naturalnym kandydatem na docelowy solver FEM, ale wymaga usunięcia kilku groźnych niespójności kontraktu:
  - fallback integratora do Heuna,
  - env-only wybór device/runtime,
  - fixed seed dla termiki,
  - zero-fill readbacku przy błędzie stanu,
  - brak pełnego precision contract dla `single`,
  - brak pełnej jawności co do tego, kiedy demag jest bootstrap transfer-grid, a kiedy mesh-native/Poisson.
- Jednocześnie widać dobrą bazę do dalszej pracy:
  - availability probing,
  - device info,
  - osobna warstwa FFI,
  - już istniejące statystyki czasowe.


### 6.5 Eigen FEM


- Obecna ścieżka eigen jest przydatna, ale ma cechy **etapu przejściowego**:
  - dense generalized eigenproblem,
  - pełne macierze `K` i `M`,
  - GPU offload tylko dla dense solve,
  - transparent fallback GPU -> CPU.
- To daje szybki dowód działania, ale nie jest dobrym modelem długoterminowym dla większych zadań.


## 7. Priorytety wdrożeniowe (krótko)


### P0 – naprawy krytyczne natychmiast
- usunąć silent downgrade `PiecewiseLinear` -> constant,
- usunąć fallback integratora do Heuna,
- usunąć transparentny GPU->CPU fallback w eigen dla jawnego wyboru GPU,
- usunąć `rng(42)` jako niejawny globalny seed termiki.

### P1 – uszczelnienie kontraktu
- capability/runtime matrix,
- jawne requested/resolved metadata,
- precyzyjne kody błędów,
- readback bez „OK + zera”.

### P2 – refaktor CPU reference
- sparse/operator-free architecture,
- iteracyjny Poisson/Robin,
- nowa ścieżka exchange field bez `vec[n_nodes]` per worker.

### P3 – domknięcie native FEM
- precision contract,
- Oersted general axis + piecewise waveform,
- solver policy bez hardkodów,
- jawny device selection bez env-only UX.


## 8. Sugerowana macierz testów regresyjnych


### Correctness

- Oersted `PiecewiseLinear` nie może już dawać wyników identycznych jak `Constant` dla tego samego prądu.

- Żaden ręcznie wybrany integrator/device/precision nie może zostać cicho zmieniony.

- Thermal field z różnymi seedami daje różne trajektorie, a z tym samym seedem – powtarzalne.

- Readback bulk DMI i innych pól nie może zwracać `OK + zeroes` na brak danych.


### CPU reference

- Profil pamięci dla `from_ir` przed/po refaktorze.

- Czas assembly exchange field przed/po usunięciu `vec[n_nodes]` per thread.

- Porównanie Poisson/Robin dense vs sparse na małych siatkach jako test zgodności.


### Native/MFEM

- Jawny wybór GPU index bez env, z poprawnym provenance.

- Poprawne odrzucenie nieobsługiwanych integratorów.

- Oersted axis tests dla Z/X/rotated axis.

- Termiczne sigma per-node/global – testy referencyjne dla heterogenicznego Ms/alpha.


### Eigen

- Jawny GPU request bez fallbacku do CPU.

- Tryb `auto` z fallbackiem i poprawnym `resolved_device` w metadata.

- Rozmiary macierzy i pamięć raportowane w artefaktach/diagnostyce.


## 9. Zamknięcie raportu


Jeżeli miałbym wskazać jedną rzecz najważniejszą dla **jakości naukowej** wyników, to byłoby to usunięcie silent fallbacków i utraty semantyki danych wejściowych.  
Jeżeli miałbym wskazać jedną rzecz najważniejszą dla **wydajności**, to byłoby to odejście CPU reference FEM od gęstych macierzy globalnych.  
Jeżeli miałbym wskazać jedną rzecz najważniejszą dla **architektury produktu**, to byłoby to wprowadzenie pełnego capability/runtime contract – takiego samego dla CPU, GPU, eigen, demagu, integratora i precision.
