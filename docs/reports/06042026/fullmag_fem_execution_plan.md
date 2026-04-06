# Plan wykonawczy napraw solvera FEM CPU/GPU w Fullmag

Data: 2026-04-06

Cel: dokładna lista zmian per plik, w kolejności wdrożenia, z kryteriami done i minimalnymi testami akceptacyjnymi.


## 1. Zasady prowadzenia prac


1. **Najpierw poprawność semantyczna, potem wydajność.**
2. **Żadnych silent fallbacków** dla ręcznie wybranych integratorów/device/precision/waveformów.
3. **Każda degradacja tylko w trybie `auto` i tylko z pełnym `resolved_*` trail.**
4. **Każdy nowy parametr publiczny musi mieć jawny status supportu** w capability matrix.
5. **CPU reference nie może udawać solvera produkcyjnego**, jeśli nadal opiera się na gęstych macierzach O(N²).


## 2. Kolejność faz


### Faza 0 – blokady na silent fallback i utratę semantyki

- [ ] Naprawić `PiecewiseLinear` Oersteda.

- [ ] Usunąć fallback integratorów do Heuna.

- [ ] Usunąć transparentny GPU->CPU fallback w eigen dla ręcznie wybranego GPU.

- [ ] Dodać błędy dla adaptive pól ignorowanych przez CPU/native.


### Faza 1 – poprawność fizyczna i diagnostyka

- [ ] Seed policy dla termiki.

- [ ] Rozdzielenie kodów błędów i readback bez zerowania na błąd.

- [ ] Osobny bufor dla bulk DMI.

- [ ] Lepsze metadata/provenance requested/resolved.


### Faza 2 – kontrakt runtime/solver

- [ ] Capability matrix backend/device/precision/integrator/demag mode.

- [ ] Jawny solver policy dla linearnych solverów FEM.

- [ ] Jawny wybór GPU/device/MFEM device bez env-only UX.


### Faza 3 – CPU reference refaktor wydajnościowy

- [ ] Rzadkie operatory lub operator-free assembly.

- [ ] Sparse Poisson/Robin demag.

- [ ] Nowe benchmarki pamięci/czasu i limity problem size.


### Faza 4 – native GPU/MFEM feature parity

- [ ] Prawdziwe precision single lub blokada capability.

- [ ] Generalny Oersted axis + waveform support.

- [ ] Domknięcie mesh-native/libCEED/hypre demag.


### Faza 5 – eigen solver następnej generacji

- [ ] Oddzielenie dense GPU eigensolvera jako etapu przejściowego.

- [ ] Projekt sparse/Krylov/shift-invert dla dużych układów.


## 3. Plan per plik


### 3.1 `packages/fullmag-py/src/fullmag/model/dynamics.py`

**Zakres zmian:**

- [ ] Uzgodnić kontrakt `AdaptiveTimestep` z realnym wykonaniem. Jeśli backend nie wspiera `max_spin_rotation` i `norm_tolerance`, to albo ostrzegaj już w Pythonie przy serializacji do IR, albo w ogóle nie wystawiaj tych pól jako publicznych bez capability check.

- [ ] Dodać w `to_ir()` opcjonalne pole `seed_policy` / `thermal_seed`, jeśli chcesz spiąć powtarzalność sLLG aż do backendu natywnego.


**Kryterium done:**

- [ ] Uzgodnić kontrakt `AdaptiveTimestep` z realnym wykonaniem.
- [ ] Dodać w `to_ir()` opcjonalne pole `seed_policy` / `thermal_seed`, jeśli chcesz spiąć powtarzalność sLLG aż do backendu natywnego.

**Minimalne testy akceptacyjne:**

- [ ] Każde pole adaptive config ma albo ścieżkę wykonawczą, albo jawny błąd/ostrzeżenie.

- [ ] Brak różnicy między IR a wykonaniem dla domyślnych parametrów regresyjnych.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.2 `packages/fullmag-py/src/fullmag/model/antenna.py`

**Zakres zmian:**

- [ ] Usunąć hardkod `solver='mqs_2p5d_az'` jako jedynego legalnego solvera i zastąpić go typed enum lub strategy id z capability checkiem.

- [ ] `air_box_factor=12.0` nie powinien być ukrytym globalnym założeniem w API użytkownika. Albo przenieść to do jawnej `AntennaSolverPolicy`, albo pozwolić backendowi/planerowi rozwiązać to inaczej.

- [ ] Rozszerzyć `current_distribution` na enum rozszerzalny, nawet jeśli na dziś działa tylko `uniform` – dzięki temu kontrakt nie będzie trzeba łamać przy przyszłych profilach prądowych.


**Kryterium done:**

- [ ] Usunąć hardkod `solver='mqs_2p5d_az'` jako jedynego legalnego solvera i zastąpić go typed enum lub strategy id z capability checkiem.
- [ ] `air_box_factor=12.
- [ ] Rozszerzyć `current_distribution` na enum rozszerzalny, nawet jeśli na dziś działa tylko `uniform` – dzięki temu kontrakt nie będzie trzeba łamać przy przyszłych profilach prądowych.

**Minimalne testy akceptacyjne:**

- [ ] Serializacja starego przypadku `uniform + mqs_2p5d_az` pozostaje zgodna wstecz.

- [ ] Nowe wartości solver/current_distribution są albo poprawnie serializowane, albo poprawnie odrzucane przez capability check.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.3 `crates/fullmag-ir/src/lib.rs`

**Zakres zmian:**

- [ ] Dodać formalny model capability/runtime metadata: requested/resolved integrator, device, precision, demag realization, runtime family, worker.

- [ ] Rozszerzyć IR/plan o jawny policy object dla linearnych solverów FEM (`solver`, `preconditioner`, `rtol`, `max_iterations`, `print_level`).

- [ ] Dodać jawny model seedów/stochastic policy dla pola termicznego.

- [ ] Dodać enum/contract dla Oersted realization, żeby odróżnić obecny nieskończony cylinder od przyszłych modeli.


**Kryterium done:**

- [ ] Dodać formalny model capability/runtime metadata: requested/resolved integrator, device, precision, demag realization, runtime family, worker.
- [ ] Rozszerzyć IR/plan o jawny policy object dla linearnych solverów FEM (`solver`, `preconditioner`, `rtol`, `max_iterations`, `print_level`).
- [ ] Dodać jawny model seedów/stochastic policy dla pola termicznego.
- [ ] Dodać enum/contract dla Oersted realization, żeby odróżnić obecny nieskończony cylinder od przyszłych modeli.

**Minimalne testy akceptacyjne:**

- [ ] Nowe pola requested/resolved serializują się stabilnie do JSON i roundtrip działa.

- [ ] Stare artefakty IR bez nowych pól nadal się deserializują.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.4 `crates/fullmag-plan/src/fem.rs`

**Zakres zmian:**

- [ ] Usunąć silent downgrade `TimeDependenceIR::PiecewiseLinear` -> `oersted_time_dep_kind = 0`. Albo pełna implementacja, albo `PlanError`.

- [ ] Dopisać twarde błędy dla integratorów/precision/terms, których CPU reference lub native time-domain realnie nie wspiera.

- [ ] Serializować do planu wynik rozstrzygnięcia `requested_demag_realization` -> `resolved_demag_realization` oraz notę o źródle decyzji.

- [ ] Utrzymać obecną uczciwość przy magnetostrykcji izotropowej i użyć tego samego wzorca dla innych stratnych degradacji.


**Kryterium done:**

- [ ] Usunąć silent downgrade `TimeDependenceIR::PiecewiseLinear` -> `oersted_time_dep_kind = 0`.
- [ ] Dopisać twarde błędy dla integratorów/precision/terms, których CPU reference lub native time-domain realnie nie wspiera.
- [ ] Serializować do planu wynik rozstrzygnięcia `requested_demag_realization` -> `resolved_demag_realization` oraz notę o źródle decyzji.
- [ ] Utrzymać obecną uczciwość przy magnetostrykcji izotropowej i użyć tego samego wzorca dla innych stratnych degradacji.

**Minimalne testy akceptacyjne:**

- [ ] Oersted `PiecewiseLinear` nie jest już redukowany do `Constant` bez błędu.

- [ ] Plan-time refusal dla nieobsługiwanych kombinacji działa z czytelną wiadomością.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.5 `crates/fullmag-plan/src/mesh.rs`

**Zakres zmian:**

- [ ] Wynieść heurystyki air-boxa do jednej polityki konfiguracyjnej: `AirBoxPolicy { factor_source, grading, boundary_marker_policy, robin_mode, robin_factor, shape }`.

- [ ] Dodać tryb jawny dla boundary marker selection zamiast specjalnej preferencji `99` rozsianej po kodzie.

- [ ] Rozważyć rozdzielenie `fem_hmax` od `demag_transfer_cell_size`, bo obecnie `hmax` pełni podwójną rolę FE+demag.

- [ ] Utrzymać planner note, ale uzupełnić go o pola strukturalne w metadata runu zamiast samego stringa diagnostycznego.


**Kryterium done:**

- [ ] Wynieść heurystyki air-boxa do jednej polityki konfiguracyjnej: `AirBoxPolicy { factor_source, grading, boundary_marker_policy, robin_mode, robin_factor, shape }`.
- [ ] Dodać tryb jawny dla boundary marker selection zamiast specjalnej preferencji `99` rozsianej po kodzie.
- [ ] Rozważyć rozdzielenie `fem_hmax` od `demag_transfer_cell_size`, bo obecnie `hmax` pełni podwójną rolę FE+demag.
- [ ] Utrzymać planner note, ale uzupełnić go o pola strukturalne w metadata runu zamiast samego stringa diagnostycznego.

**Minimalne testy akceptacyjne:**

- [ ] Dla tych samych danych wejściowych air-box policy daje deterministyczny wynik.

- [ ] Boundary marker selection jest pokryty testami jednostkowymi dla markerów z `99` i bez `99`.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.6 `crates/fullmag-runner/src/fem_reference.rs`

**Zakres zmian:**

- [ ] Uciąć no-op adaptive options: jeśli `rtol/growth_limit/shrink_limit/max_spin_rotation/norm_tolerance` są zadane, a engine ich nie wspiera, zwracać błąd zamiast ignorowania.

- [ ] Zastąpić ukryty fallback `dt=1e-13` jawnie raportowanym policy result.

- [ ] Zanim CPU reference nie dostanie pełnej obsługi terms, plan/rule engine musi blokować nieobsługiwane oddziaływania czytelniej niż przez wewnętrzne `None` w `EffectiveFieldTerms`.

- [ ] Rozszerzyć provenance o pełny trail requested/resolved demag/integrator/precision.


**Kryterium done:**

- [ ] Uciąć no-op adaptive options: jeśli `rtol/growth_limit/shrink_limit/max_spin_rotation/norm_tolerance` są zadane, a engine ich nie wspiera, zwracać błąd zamiast ignorowania.
- [ ] Zastąpić ukryty fallback `dt=1e-13` jawnie raportowanym policy result.
- [ ] Zanim CPU reference nie dostanie pełnej obsługi terms, plan/rule engine musi blokować nieobsługiwane oddziaływania czytelniej niż przez wewnętrzne `None` w `EffectiveFieldTerms`.
- [ ] Rozszerzyć provenance o pełny trail requested/resolved demag/integrator/precision.

**Minimalne testy akceptacyjne:**

- [ ] CPU runner odrzuca nieobsługiwane adaptive fields zamiast je ignorować.

- [ ] Provenance zawiera pełny requested/resolved trail.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.7 `crates/fullmag-engine/src/fem.rs`

**Zakres zmian:**

- [ ] Najważniejszy refaktor całego audytu: odejście od gęstych globalnych macierzy na rzecz formatu rzadkiego lub operator-free element loops z cache-friendly accumulation.

- [ ] Przepisać CPU Poisson/Robin demag na rzadki solver iteracyjny; gęsta ścieżka ma zostać tylko dla małych testów lub zostać usunięta.

- [ ] Przebudować parallel exchange assembly tak, by nie alokować `vec[n_nodes]` na każdy worker. Docelowo `H_ex` przez SpMV lub chunked assembly.

- [ ] Dodać centralny moduł stałych/progów numerycznych i usunąć rozproszone `1e-30`, `1e-12`, itd.

- [ ] Jeżeli transfer-grid ma zostać w CPU reference, dodać precomputed transfer maps, benchmarki i licznik czasu dla: rasteryzacji, FFT, samplingu zwrotnego.

- [ ] Urealnić adaptive stepper: albo pełna obsługa `rtol/growth/shrink/max_spin_rotation/norm_tolerance`, albo jawna odmowa nieobsługiwanych pól.


**Kryterium done:**

- [ ] Najważniejszy refaktor całego audytu: odejście od gęstych globalnych macierzy na rzecz formatu rzadkiego lub operator-free element loops z cache-friendly accumulation.
- [ ] Przepisać CPU Poisson/Robin demag na rzadki solver iteracyjny; gęsta ścieżka ma zostać tylko dla małych testów lub zostać usunięta.
- [ ] Przebudować parallel exchange assembly tak, by nie alokować `vec[n_nodes]` na każdy worker.
- [ ] Dodać centralny moduł stałych/progów numerycznych i usunąć rozproszone `1e-30`, `1e-12`, itd.
- [ ] Jeżeli transfer-grid ma zostać w CPU reference, dodać precomputed transfer maps, benchmarki i licznik czasu dla: rasteryzacji, FFT, samplingu zwrotnego.
- [ ] Urealnić adaptive stepper: albo pełna obsługa `rtol/growth/shrink/max_spin_rotation/norm_tolerance`, albo jawna odmowa nieobsługiwanych pól.

**Minimalne testy akceptacyjne:**

- [ ] Porównanie wyników małego problemu przed/po refaktorze mieści się w tolerancji referencyjnej.

- [ ] Profil pamięci dla większej siatki pokazuje spadek poniżej wersji gęstej.


**Uwagi implementacyjne:**

- Nie próbuj robić wszystkiego jednym commitem. Najpierw wprowadź nową reprezentację operatora obok starej, porównaj wyniki na małych siatkach, dopiero potem wytnij gęstą ścieżkę.

- Oddziel correctness path od fast path; łatwiej wtedy utrzymać zgodność regresyjną.


### 3.8 `crates/fullmag-runner/src/native_fem.rs`

**Zakres zmian:**

- [ ] Usunąć fallback nieobsłużonego integratora do Heuna – zwracać błąd.

- [ ] Wprowadzić jawne przekazywanie/serializację solver policy dla liniowego solvera demagu zamiast twardych `CG+AMG,1e-8,500`.

- [ ] Rozszerzyć FFI struct o brakujące adaptive fields (`max_spin_rotation`, `norm_tolerance`) albo blokować je już przed FFI.

- [ ] Przenieść wybór GPU/device z env do jawnej konfiguracji runtime/CLI/API, a env zostawić tylko jako override developerski.

- [ ] Rozszerzyć provenance o resolved device index, MFEM device string, info o CEED/hypre/MFEM build i realnie użyty precision path.


**Kryterium done:**

- [ ] Usunąć fallback nieobsłużonego integratora do Heuna – zwracać błąd.
- [ ] Wprowadzić jawne przekazywanie/serializację solver policy dla liniowego solvera demagu zamiast twardych `CG+AMG,1e-8,500`.
- [ ] Rozszerzyć FFI struct o brakujące adaptive fields (`max_spin_rotation`, `norm_tolerance`) albo blokować je już przed FFI.
- [ ] Przenieść wybór GPU/device z env do jawnej konfiguracji runtime/CLI/API, a env zostawić tylko jako override developerski.
- [ ] Rozszerzyć provenance o resolved device index, MFEM device string, info o CEED/hypre/MFEM build i realnie użyty precision path.

**Minimalne testy akceptacyjne:**

- [ ] Nieobsługiwany integrator kończy run błędem zamiast Heuna.

- [ ] Solver policy i device selection przechodzą z Rust do FFI bez utraty informacji.


**Uwagi implementacyjne:**

- To jest dobre miejsce na uszczelnienie kontraktu לפני wejściem do C++ – blokuj błędne kombinacje tu, zanim staną się trudniejsze do debugowania w FFI.


### 3.9 `crates/fullmag-runner/src/fem_eigen.rs`

**Zakres zmian:**

- [ ] Usunąć transparentny GPU->CPU fallback, gdy użytkownik wybrał GPU jawnie.

- [ ] Dopisać wyraźny status `downgraded` tylko dla trybu `auto`.

- [ ] Wyraźnie oznaczyć dense GPU eigensolver jako etap przejściowy i odseparować capability matrix `fem_eigen` od time-domain FEM.

- [ ] Rozpocząć projekt sparse/Krylov eigensolvera dla większych układów zamiast rozwijać tylko ścieżkę dense.


**Kryterium done:**

- [ ] Usunąć transparentny GPU->CPU fallback, gdy użytkownik wybrał GPU jawnie.
- [ ] Dopisać wyraźny status `downgraded` tylko dla trybu `auto`.
- [ ] Wyraźnie oznaczyć dense GPU eigensolver jako etap przejściowy i odseparować capability matrix `fem_eigen` od time-domain FEM.
- [ ] Rozpocząć projekt sparse/Krylov eigensolvera dla większych układów zamiast rozwijać tylko ścieżkę dense.

**Minimalne testy akceptacyjne:**

- [ ] Ręcznie wybrane GPU nie fallbackuje do CPU bez błędu/statusu downgrade.

- [ ] Tryb `auto` fallbackuje jawnie i zapisuje `resolved_device` w metadata.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.10 `crates/fullmag-fem-sys/src/lib.rs`

**Zakres zmian:**

- [ ] Rozszerzyć `fullmag_fem_adaptive_config` o `max_spin_rotation` i `norm_tolerance`.

- [ ] Rozszerzyć FFI error model o bardziej precyzyjne kody niż obecne mieszanie `UNAVAILABLE` z runtime failure.

- [ ] Upewnić się, że FFI descriptors dokładnie odzwierciedlają realne możliwości precision/device/integrator – bez „pustych” pól, które backend ignoruje.


**Kryterium done:**

- [ ] Rozszerzyć `fullmag_fem_adaptive_config` o `max_spin_rotation` i `norm_tolerance`.
- [ ] Rozszerzyć FFI error model o bardziej precyzyjne kody niż obecne mieszanie `UNAVAILABLE` z runtime failure.
- [ ] Upewnić się, że FFI descriptors dokładnie odzwierciedlają realne możliwości precision/device/integrator – bez „pustych” pól, które backend ignoruje.

**Minimalne testy akceptacyjne:**

- [ ] FFI ABI dla nowych pól adaptive config ma test zgodności rozmiarów/offsetów.

- [ ] Rust wrapper widzi wszystkie nowe kody błędów.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.11 `native/backends/fem/include/context.hpp`

**Zakres zmian:**

- [ ] Wynieść domyślne wartości steppera/solvera/polityk do centralnego config headera lub jawnej struktury policy.

- [ ] Dodać pola seed/policy dla termiki i jawne flagi `adaptive_supports_spin_rotation`, `adaptive_supports_norm_tolerance` jeśli backend ma częściowe wsparcie.

- [ ] Rozdzielić config runtime od runtime state – dziś część rzeczy konfiguracyjnych i cache’y żyje obok siebie w jednym kontekscie.


**Kryterium done:**

- [ ] Wynieść domyślne wartości steppera/solvera/polityk do centralnego config headera lub jawnej struktury policy.
- [ ] Dodać pola seed/policy dla termiki i jawne flagi `adaptive_supports_spin_rotation`, `adaptive_supports_norm_tolerance` jeśli backend ma częściowe wsparcie.
- [ ] Rozdzielić config runtime od runtime state – dziś część rzeczy konfiguracyjnych i cache’y żyje obok siebie w jednym kontekscie.

**Minimalne testy akceptacyjne:**

- [ ] Domyślne polityki są inicjalizowane deterministycznie i nie zależą od kolejności pól stanu.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.12 `native/backends/fem/include/kernels.h`

**Zakres zmian:**

- [ ] Naprawić komentarz o układzie pamięci AOS/SoA.

- [ ] Wprowadzić szablon/alias typów dla `float`/`double`, jeśli precision single ma być realnie wspierane.

- [ ] Wyprowadzić parametry launchu i ewentualne warianty block size do wspólnego miejsca z benchmarkami.


**Kryterium done:**

- [ ] Naprawić komentarz o układzie pamięci AOS/SoA.
- [ ] Wprowadzić szablon/alias typów dla `float`/`double`, jeśli precision single ma być realnie wspierane.
- [ ] Wyprowadzić parametry launchu i ewentualne warianty block size do wspólnego miejsca z benchmarkami.

**Minimalne testy akceptacyjne:**

- [ ] Ścieżka single precision jest albo poprawnie skompilowana/testowana, albo zablokowana compile-time.

- [ ] Benchmark launch config zapisuje wyniki dla co najmniej dwóch architektur/problem sizes.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.13 `native/backends/fem/src/kernels.cu`

**Zakres zmian:**

- [ ] Dodać float kernels albo jawnie zablokować precision single w całym native runtime.

- [ ] Naprawić opis układu danych (SoA, nie AOS) i ujednolicić naming buforów.

- [ ] Rozważyć osobne ścieżki dla fused kernels zależnie od danych w pamięci, żeby nie mylić warstwy hostowej i urządzenia.

- [ ] Dodać benchmark harness dla block size / occupancy / throughput.


**Kryterium done:**

- [ ] Dodać float kernels albo jawnie zablokować precision single w całym native runtime.
- [ ] Naprawić opis układu danych (SoA, nie AOS) i ujednolicić naming buforów.
- [ ] Rozważyć osobne ścieżki dla fused kernels zależnie od danych w pamięci, żeby nie mylić warstwy hostowej i urządzenia.
- [ ] Dodać benchmark harness dla block size / occupancy / throughput.

**Minimalne testy akceptacyjne:**

- [ ] Ścieżka single precision jest albo poprawnie skompilowana/testowana, albo zablokowana compile-time.

- [ ] Benchmark launch config zapisuje wyniki dla co najmniej dwóch architektur/problem sizes.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.14 `native/backends/fem/src/context.cpp`

**Zakres zmian:**

- [ ] Najpilniejsze: usunąć `rng(42)` i wprowadzić jawny seed policy dla pola termicznego.

- [ ] Zaimplementować `PiecewiseLinear` dla Oersteda lub zwracać błąd na wejściu – żadnych silent fallbacks.

- [ ] Rozszerzyć Oersted cylinder na dowolną oś przez transformację lokalnego układu współrzędnych.

- [ ] Dodać osobny bufor readback `h_bulk_dmi_xyz` i usunąć zwracanie zer dla „brak wyliczonego pola”.

- [ ] Rozważyć per-node sigma dla termiki przy heterogenicznych materiałach.

- [ ] Rozdzielić `context_copy_field_f64` na twardy strict mode i ewentualny preview-tolerant mode.


**Kryterium done:**

- [ ] Najpilniejsze: usunąć `rng(42)` i wprowadzić jawny seed policy dla pola termicznego.
- [ ] Zaimplementować `PiecewiseLinear` dla Oersteda lub zwracać błąd na wejściu – żadnych silent fallbacks.
- [ ] Rozszerzyć Oersted cylinder na dowolną oś przez transformację lokalnego układu współrzędnych.
- [ ] Dodać osobny bufor readback `h_bulk_dmi_xyz` i usunąć zwracanie zer dla „brak wyliczonego pola”.
- [ ] Rozważyć per-node sigma dla termiki przy heterogenicznych materiałach.
- [ ] Rozdzielić `context_copy_field_f64` na twardy strict mode i ewentualny preview-tolerant mode.

**Minimalne testy akceptacyjne:**

- [ ] Thermal RNG z tym samym seedem daje powtarzalność, z innym seedem – inną trajektorię.

- [ ] Oersted `PiecewiseLinear` i obrócona oś przechodzą testy porównawcze.

- [ ] Readback brakującego pola zwraca błąd/status, nie `OK + zeros`.


**Uwagi implementacyjne:**

- Rozdziel logikę config/input validation od runtime state update – plik jest już na tyle duży, że mieszanie obu utrudnia refaktor.

- Seed policy wprowadź tak, żeby dało się ją serializować i odtwarzać z artefaktów.


### 3.15 `native/backends/fem/src/api.cpp`

**Zakres zmian:**

- [ ] Przebudować taksonomię kodów błędów.

- [ ] Zachować availability probing, ale wynieść wybór device/runtime z env do jawnego kontraktu wejścia.

- [ ] W GPU dense eigen API dopisać statusy i provenance tak, żeby fallbacki nie były „niewidzialne”.

- [ ] Wyraźnie rozróżnić `build lacks feature` od `runtime failed during step`.


**Kryterium done:**

- [ ] Przebudować taksonomię kodów błędów.
- [ ] Zachować availability probing, ale wynieść wybór device/runtime z env do jawnego kontraktu wejścia.
- [ ] W GPU dense eigen API dopisać statusy i provenance tak, żeby fallbacki nie były „niewidzialne”.
- [ ] Wyraźnie rozróżnić `build lacks feature` od `runtime failed during step`.

**Minimalne testy akceptacyjne:**

- [ ] Każda klasa błędu (`UNAVAILABLE`, `SOLVER_FAILURE`, `INVALID`, `NOT_COMPUTED`) jest rozróżnialna po FFI.

- [ ] Availability info pozostaje kompatybilne wstecz.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


### 3.16 `native/backends/fem/src/mfem_bridge.cpp`

**Zakres zmian:**

- [ ] Przenieść konfigurację MFEM device / CEED / solverów z env+domyślnych stringów do jawnego runtime policy object.

- [ ] Skupić kolejną falę optymalizacji na assembly/application operatorów, nie tylko na LLG microkernels.

- [ ] Dodać precyzyjny profiling etapów: assembly, demag, rhs, snapshot, dodatkowe energie – część statystyk już istnieje, trzeba je wykorzystać do benchmarków regresyjnych.

- [ ] Domknąć ścieżkę mesh-native/libCEED/hypre demag albo jednoznacznie odseparować ją capability-wise od bootstrap transfer-grid demag.


**Kryterium done:**

- [ ] Przenieść konfigurację MFEM device / CEED / solverów z env+domyślnych stringów do jawnego runtime policy object.
- [ ] Skupić kolejną falę optymalizacji na assembly/application operatorów, nie tylko na LLG microkernels.
- [ ] Dodać precyzyjny profiling etapów: assembly, demag, rhs, snapshot, dodatkowe energie – część statystyk już istnieje, trzeba je wykorzystać do benchmarków regresyjnych.
- [ ] Domknąć ścieżkę mesh-native/libCEED/hypre demag albo jednoznacznie odseparować ją capability-wise od bootstrap transfer-grid demag.

**Minimalne testy akceptacyjne:**

- [ ] Nowe policy objects sterują doborem MFEM device/solvera bez env-only dependencies.

- [ ] Profiling assembly/demag/rhs/snapshot ma regresyjne testy smoke.


**Uwagi implementacyjne:**

- Każda zmiana publicznego kontraktu powinna mieć jednocześnie update testów i provenance metadata.


## 4. Najkrótsza ścieżka do szybkiego zysku


Jeżeli chcesz zrobić **najmniejszy możliwy zestaw zmian**, który da największy wzrost jakości, kolejność powinna być taka:

1. `crates/fullmag-plan/src/fem.rs`
   - zablokować `PiecewiseLinear -> Constant`,
   - zablokować nieobsługiwane degradacje integratora/precision.

2. `crates/fullmag-runner/src/native_fem.rs`
   - usunąć fallback integratora do Heuna,
   - serializować requested/resolved integrator/device/precision.

3. `native/backends/fem/src/context.cpp`
   - usunąć `rng(42)`,
   - poprawić readback pól,
   - dodać seed policy.

4. `crates/fullmag-engine/src/fem.rs`
   - zacząć od usunięcia pełnych buforów `vec[n_nodes]` per worker przy exchange,
   - dopiero potem ruszać gęste macierze globalne.

5. `crates/fullmag-fem-sys/src/lib.rs` + `crates/fullmag-ir/src/lib.rs`
   - domknąć adaptive contract (`max_spin_rotation`, `norm_tolerance`).


## 5. Najtrudniejsze prace (ocena ryzyka)


### Wysokie ryzyko / duży zwrot
- refaktor `crates/fullmag-engine/src/fem.rs` z gęstych macierzy do sparse/operator-free,
- sparse eigensolver zamiast dense GPU/CPU generalized eigen,
- pełna parytetowa implementacja native single precision.

### Średnie ryzyko / bardzo wysoki zwrot
- usunięcie silent fallbacków,
- seed policy termiki,
- readback correctness,
- solver policy dla demagu.

### Niskie ryzyko / szybki zwrot
- poprawa komentarza AOS/SoA,
- centralizacja magic constants,
- jawny capability/runtime metadata trail.


## 6. Definition of Done dla całego pakietu FEM


Całość można uznać za domkniętą dopiero wtedy, gdy spełnione są wszystkie poniższe punkty:

- [ ] Żaden ręcznie wybrany integrator/device/precision nie fallbackuje cicho.
- [ ] `PiecewiseLinear` dla Oersteda jest albo w pełni wykonawcze, albo jawnie odrzucane.
- [ ] Termika ma jawny seed policy i da się odtworzyć run z artefaktów.
- [ ] Readback pól nie zwraca `OK + zeros` dla brakującego stanu.
- [ ] CPU reference nie buduje już pełnych operatorów O(N²) dla ścieżki produkcyjnej.
- [ ] Native solver ma jawny solver policy oraz jawny device selection poza env.
- [ ] Eigensolver ma rozróżniony tryb `auto` i ręczny wybór GPU bez przezroczystego fallbacku.
- [ ] Session/run metadata zawierają pełny requested/resolved trail.
- [ ] UI/CLI może z capability matrix wyświetlić dokładnie, co jest dostępne na danym hoście.
