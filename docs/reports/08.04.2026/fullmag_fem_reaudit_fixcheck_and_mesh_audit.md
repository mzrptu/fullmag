
# Fullmag FEM + mesh re-audit po poprawkach

Autor: ChatGPT  
Data przeglądu: 2026-04-08  
Zakres: ponowna weryfikacja punktów z poprzedniego raportu FEM oraz osobny audyt aktualnego kodu meshowego.

> Ten raport odpowiada na pytanie: **które punkty z poprzedniego audytu zostały naprawione naprawdę, które tylko częściowo, a które nadal trzeba domknąć, żeby solver nadawał się do twardej walidacji mikromagnetycznej bez ukrytych uproszczeń**.

---

## 0. Werdykt

Nie, **nie wszystkie punkty są zamknięte**.

Moja obecna klasyfikacja:

- **Zamknięte bez istotnego "ale"**: FND-003, FND-004, FND-005, FND-006, FND-010
- **Naprawione tylko częściowo**: FND-001, FND-002, FND-007, FND-008, FND-009, FND-011, FND-012, FND-013
- **Nadal otwarte / nadal ograniczone architektonicznie**: FND-015
- **Nie zamykam bez osobnego re-audytu call-graphu i builda**: FND-014

Dodatkowo dla mesha:

- **kod mesha jako całość nie jest jeszcze w pełni poprawiony**
- znalazłem **co najmniej jeden realny bug runtime** w ścieżce air-box
- nadal istnieją **twarde ograniczenia kontraktu i planera**, które przeczą tezie „mesh jest już domknięty”

---

## 1. Zakres sprawdzonych plików

### Natywny FEM / FFI / CPU reference

- `native/backends/fem/src/context.cpp`
- `native/backends/fem/src/mfem_bridge.cpp`
- `native/backends/fem/src/api.cpp`
- `native/include/fullmag_fem.h`
- `crates/fullmag-fem-sys/src/lib.rs`
- `crates/fullmag-engine/src/fem.rs`

### Planner / IR / walidacja / mesh

- `crates/fullmag-plan/src/mesh.rs`
- `crates/fullmag-plan/src/fem.rs`
- `crates/fullmag-plan/src/validate.rs`
- `crates/fullmag-ir/src/lib.rs`
- `packages/fullmag-py/src/fullmag/world.py`
- `packages/fullmag-py/src/fullmag/model/discretization.py`
- `packages/fullmag-py/src/fullmag/model/geometry.py`
- `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`
- `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py`
- `packages/fullmag-py/src/fullmag/meshing/quality.py`
- `packages/fullmag-py/src/fullmag/meshing/remesh_cli.py`
- `packages/fullmag-py/src/fullmag/meshing/surface_assets.py`
- `packages/fullmag-py/src/fullmag/meshing/voxelization.py`

### Dodatkowe uwagi wykonawcze

- Pythonowe moduły meshowe z pobranej kopii przechodzą `py_compile`, więc **nie widzę błędów składni**, ale to oczywiście nie dowodzi poprawności semantycznej.
- Weryfikacja była **kodowa i architektoniczna**, nie obejmowała uruchomienia pełnej produkcyjnej ścieżki MFEM/libCEED/hypre na GPU.

---

## 2. Tabela statusów poprzednich punktów

| ID | Status | Krótki werdykt |
|---|---|---|
| FND-001 | częściowo | usunięto `last-write-wins`, ale nadal nie ma konserwatywnej projekcji objętościowej tet→cell |
| FND-002 | częściowo | Rust CPU ref ma już niezależność od kolejności elementów, ale nadal nie ma poprawnej projekcji objętościowej |
| FND-003 | zamknięte | precomputed spectra demag są już przekazywane do ścieżki transfer-grid |
| FND-004 | zamknięte | po uploadzie magnetyzacji `H_eff` jest odświeżane pełniej |
| FND-005 | zamknięte | snapshot/step nie wymagają już sztucznie exchange/demag |
| FND-006 | zamknięte | brak boundary DOF w Poisson Dirichlet kończy się błędem, a nie pinem DOF 0 |
| FND-007 | częściowo | nazewnictwo backendu jest uczciwsze, ale transfer-grid nadal nie jest czystym FEM demag |
| FND-008 | częściowo | sigma termiczne używa lokalnego `alpha` i `Ms`, ale nadal globalnej średniej objętości węzła |
| FND-009 | częściowo | natywny backend iDMI obsługuje ogólną normalną, ale planner/CPU ref nie domykają pełnej parytetu |
| FND-010 | zamknięte | enum observables i pola planu w FFI wyglądają na zsynchronizowane |
| FND-011 | częściowo | CPU reference nadal nie implementuje gradientowych pól iDMI/bulk DMI |
| FND-012 | częściowo | heurystyki są bardziej konfigurowalne, ale dalej istnieją i nie są referencyjnie „czyste” |
| FND-013 | częściowo | pojawił się `use_consistent_mass`, ale to nadal nie jest finalna ścieżka bez uproszczeń |
| FND-014 | nierozstrzygnięte | w tej rundzie nie zamykam bez pełnego call-graph audytu `kernels.cu` |
| FND-015 | otwarte | walidator nadal ogranicza publicznie wykonywalne algorytmy relaksacji |

---

## 3. Szczegółowa rewalidacja punkt po punkcie

### FND-001 — Transfer-grid w C++ nie nadpisuje już komórek, ale nadal nie jest fizycznie poprawną projekcją

**Aktualny stan**

W `native/backends/fem/src/mfem_bridge.cpp`, funkcja:

- `rasterize_magnetization_to_transfer_grid(...)`  
- lokalizacja: ok. **364-452**

nie robi już `last-write-wins`. Zamiast tego:

- akumuluje wkłady do komórki,
- trzyma `cell_hit_count`,
- na końcu dzieli przez liczbę trafień.

To jest dobra poprawka względem poprzedniego błędu. Usuwa zależność od kolejności elementów.

**Dlaczego nadal nie zamykam punktu**

Komentarz w samym kodzie mówi wprost, że to nadal jest tylko „simple, order-independent improvement”, bo dla właściwej projekcji trzeba liczyć **objętości przecięcia tetraedr–komórka**.

Czyli obecnie masz:

- lepszy bootstrap,
- ale **nie konserwatywną projekcję momentu magnetycznego**,
- nie poprawną reprezentację częściowo wypełnionych komórek,
- nie gwarantujesz zgodności całkowitego momentu między siatką FEM a transfer-grid.

#### Co dokładnie poprawić

**Plik:** `native/backends/fem/src/mfem_bridge.cpp`  
**Funkcja:** `rasterize_magnetization_to_transfer_grid(...)`

Zastąp logikę „sumuj barycentryczne próbki i dziel przez liczbę trafień” logiką:

1. Dla każdej komórki transfer-grid i każdego tetra przecinającego komórkę wyznacz:
   - objętość przecięcia `V_int = |tet ∩ cell|`.
2. W tej objętości policz pole:
   - najlepiej jako całkę  
     `M_cell = (1 / (V_cell * Ms_ref)) ∫_{Ω_mag∩cell} Ms(x) m(x) dV`
3. Akumuluj bezpośrednio **moment objętościowy względem pełnej objętości komórki**, a nie średnią po liczbie hitów.
4. Zachowaj `active_mask[cell] = 1`, jeśli `V_int > 0`.
5. Jeśli chcesz zachować kompatybilność z obecną konwencją transfer-grid, jawnie zapisz kontrakt:
   - czy `cell_magnetization_xyz` oznacza:
     - średnią po pełnej objętości komórki,
     - czy średnią po objętości magnetycznej części komórki.
   Dla splotu tensorowego najbezpieczniej trzymać **gęstość momentu względem pełnej objętości komórki**.

#### Minimalny test akceptacyjny

Dodaj testy, które sprawdzają jednocześnie:

- niezależność od kolejności elementów,
- zachowanie całkowitego momentu:
  - `sum(M_cell * V_cell)` ≈ `∫ Ms m dV`,
- zbieżność przy rafinacji transfer-grid,
- przypadek cienkiej warstwy przecinającej komórki częściowo.

#### Priorytet

**Krytyczny** dla wiarygodnej walidacji demag transfer-grid.

---

### FND-002 — Rust CPU reference ma ten sam problem w łagodniejszej formie

**Aktualny stan**

W `crates/fullmag-engine/src/fem.rs` ścieżka rasteryzacji transfer-grid została poprawiona w tym sensie, że:

- nie zależy już od kolejności elementów,
- ma test `rasterization_is_order_independent()`.

To jest realny progres.

**Dlaczego nadal nie zamykam punktu**

Problem fizyczny jest ten sam co w C++:

- poprawiłeś deterministykę,
- ale nie zrobiłeś **konserwatywnej projekcji objętościowej** FEM→grid.

#### Co dokładnie poprawić

**Plik:** `crates/fullmag-engine/src/fem.rs`  
**Funkcja:** `rasterize_magnetization_to_transfer_grid(...)`

Zrób dokładnie tę samą zmianę kontraktu co w C++:

- nie hit-count average,
- tylko integralna projekcja po `tet ∩ cell`.

Najważniejsze: **C++ i Rust CPU reference muszą używać identycznej konwencji danych transfer-grid**.  
Nie wolno zostawić dwóch „prawie takich samych” implementacji, bo rozjadą się przy walidacji.

#### Jak to zorganizować

Najczyściej:

- opisać kontrakt w komentarzu/specyfikacji,
- dodać wspólne testy porównawcze z tym samym golden dataset,
- jeżeli nie da się dzielić kodem, to dzielić **test vectors + acceptance criteria**.

#### Priorytet

**Krytyczny**.

---

### FND-003 — przekazywanie gotowych spektrów demag: zamknięte

**Aktualny stan**

To wygląda dobrze.

Masz teraz dwie zgodne zmiany:

1. `context.cpp` kopiuje spektra Newella z planu do `ctx.transfer_grid.kernel_*_spectrum`.
2. `mfem_bridge.cpp` przekazuje je dalej do FDM backendu, jeśli są dostępne.

#### Wniosek

Ten punkt uznaję za **zamknięty**.

#### Co jeszcze warto zrobić

Nie jako krytyczna poprawka, tylko jako domknięcie jakości:

- dodać test porównujący:
  - ścieżkę z gotowymi spektrami,
  - ścieżkę z wewnętrzną regeneracją tensorów,
- i sprawdzać bitowo lub z bardzo małą tolerancją, że wynik jest zgodny.

---

### FND-004 — pełniejsze odświeżanie `H_eff` po uploadzie: zamknięte

**Aktualny stan**

W `context_upload_magnetization_f64(...)` jest teraz jawne wywołanie:

- `compute_effective_fields_for_magnetization(...)`

czyli po uploadzie nie zostajesz już z połowicznie aktualnym `H_eff`.

#### Wniosek

To wygląda na **zamknięte**.

#### Co jeszcze dodać

- test integracyjny:
  1. utwórz kontekst z exchange + demag + anisotropy + DMI + Oersted + magnetoelastic,
  2. wykonaj `upload_magnetization`,
  3. odczytaj `H_eff`,
  4. porównaj ze snapshotem liczącym pole od zera.

---

### FND-005 — guard effective-field: zamknięte

**Aktualny stan**

Masz helper:

- `has_any_effective_field_term(const Context&)`

i jest używany zarówno w snapshot, jak i w stepperach.

#### Wniosek

Ten punkt uznaję za **zamknięty**.

#### Dodatkowy test

Dobrze dodać przypadki:

- tylko anisotropy,
- tylko external field,
- tylko DMI,
- tylko thermal.

Każdy powinien przechodzić snapshot/step bez fałszywego błędu.

---

### FND-006 — Poisson Dirichlet: brak boundary DOF to teraz błąd, nie cichy fallback

**Aktualny stan**

W ścieżce inicjalizacji Poissona nie ma już cichego przypinania DOF 0.  
Gdy boundary marker nie prowadzi do essential DOF, jest twardy error.

#### Wniosek

Ten punkt uznaję za **zamknięty**.

#### Co jeszcze dodać

Dwa testy regresyjne:

1. błędny marker → oczekiwany błąd,
2. poprawny marker → solver startuje i daje niezerową listę essential DOF.

---

### FND-007 — uczciwsze nazwanie backendu, ale nadal nie czysty FEM demag

**Aktualny stan**

W `context_populate_device_info(...)` backend jest już nazywany uczciwiej:

- `mfem_cuda_bootstrap_transfer_grid_demag`
- `mfem_cuda_native_poisson_dirichlet_demag`
- `mfem_cuda_native_poisson_robin_demag`

To jest dobra poprawka semantyczna.

**Dlaczego punkt nadal jest tylko częściowo zamknięty**

Dla walidacji solvera mikromagnetycznego to nie wystarcza.  
Jeżeli używasz `transfer_grid`, to nadal nie masz natywnego FEM demag. Masz hybrydę:

- FEM / unstructured mesh po stronie reprezentacji magnetyzacji,
- plus transfer na grid,
- plus uniform FFT tensor demag.

To może być sensowny bootstrap albo hybrid reference, ale **nie jest „bez kompromisów” natywnym FEM demag**.

#### Co dokładnie poprawić

Masz tu dwa możliwe kierunki, i trzeba je wreszcie rozdzielić jawnie.

##### Wariant A — zachowujesz transfer-grid jako ścieżkę hybrydową

Wtedy:

- nazwij ją wszędzie jawnie jako **hybrid / bootstrap / transfer-grid demag**,
- nie używaj jej jako „pełnej walidacji FEM demag”,
- odseparuj testy:
  - `hybrid_transfer_grid_validation`
  - `native_airbox_poisson_validation`

##### Wariant B — solver ma być walidowany jako natywny FEM demag

Wtedy walidacja solvera musi iść przez:

- `AIRBOX_DIRICHLET` albo
- `AIRBOX_ROBIN`

i dopiero ta ścieżka może być podstawą raportów fizycznych.

#### Dodatkowa uwaga dokumentacyjna

Masz obecnie rozjazd „kod vs README / public maturity”.  
Jeżeli Poisson ścieżki są już realnie utrzymywane, dokumentacja bootstrap state musi to uczciwie opisać.  
Jeżeli nie są jeszcze public-qualified, trzeba je jawnie oznaczyć jako eksperymentalne.

#### Priorytet

**Krytyczny semantycznie**.

---

### FND-008 — termika poprawiona, ale nadal nie do końca fizycznie poprawna

**Aktualny stan**

W `context.cpp`:

- `alpha_i` jest lokalne,
- `Ms_i` jest lokalne,
- ale `V_node` nadal pochodzi z:
  - `average_magnetic_node_volume(ctx)`.

To znaczy, że poprawiłeś połowę problemu, ale nie całość.

**Dlaczego nadal nie zamykam punktu**

W FEM dla nierównomiernej siatki i/lub materiałów nie możesz dla termiki używać jednej średniej objętości węzłowej dla wszystkich DOF.  
To psuje lokalną amplitudę szumu termicznego.

#### Co dokładnie poprawić

**Pliki:**

- `native/backends/fem/src/context.hpp`
- `native/backends/fem/src/context.cpp`
- `native/backends/fem/src/mfem_bridge.cpp`

##### Krok 1 — w `Context` dodaj per-node control volume

W `context.hpp` dodaj np.:

- `std::vector<double> nodal_control_volume;`

##### Krok 2 — licz te objętości podczas inicjalizacji MFEM

W `mfem_bridge.cpp` po inicjalizacji przestrzeni FE policz per-node objętość kontrolną.  
Masz dwie sensowne opcje:

- diagonalizacja / lumping masy skalarnej na domenie magnetycznej,
- albo row-sum macierzy masy.

Dla P1 i do szumu termicznego to jest sensowna kontrolna objętość DOF.

##### Krok 3 — użyj `V_i`, nie jednej średniej

W `refresh_thermal_field_for_current_state(...)` zamień:

- `const double V_node = average_magnetic_node_volume(ctx);`

na per-node:
- `V_i = ctx.nodal_control_volume[i]`

i licz sigma osobno dla każdego węzła.

##### Krok 4 — usuń mylący globalny diagnostyczny skrót

Jeżeli chcesz zostawić `ctx.thermal_sigma`, to niech to będzie jasno opisane jako:
- `max_sigma_over_nodes`
albo
- `rms_sigma_over_nodes`

a nie „sigma” sugerujące jedną używaną wartość.

#### Test akceptacyjny

Przy siatce z silnie nierówną objętością elementów sprawdź, że:

- histogram amplitud termiki koreluje z `1/sqrt(V_i)`,
- a nie jest prawie płaski.

#### Priorytet

**Bardzo wysoki**.

---

### FND-009 — iDMI natywnie poprawione, ale nie end-to-end

**Aktualny stan**

Tu trzeba oddzielić trzy warstwy.

#### 1) Natywny backend C++ / MFEM

To wygląda dobrze:

- plan desc ma `dmi_interface_normal[3]`,
- `context.cpp` normalizuje wektor i trzyma `ctx.dmi_n_hat`,
- `compute_interfacial_dmi_field(...)` w `mfem_bridge.cpp` liczy ogólną postać zależną od arbitralnej normalnej interfejsu.

To jest realna naprawa.

#### 2) Planner

W `crates/fullmag-plan/src/fem.rs` nadal widzę:

- `dmi_interface_normal: None`

czyli planner nie domyka tej informacji do końca.

#### 3) CPU reference

W `crates/fullmag-engine/src/fem.rs` nadal jest placeholder / TODO dla iDMI i bulk DMI.  
Czyli referencyjna ścieżka CPU nie ma parytetu z backendem natywnym.

#### Wniosek

Punkt jest **częściowo naprawiony**, ale nie zamknięty end-to-end.

#### Co dokładnie poprawić

##### A. Planner ma przestać milcząco wpuszczać `None`

**Plik:** `crates/fullmag-plan/src/fem.rs`  
**Miejsca:** okolice **675** i **1349**

Masz dziś:

- `dmi_interface_normal: None`

To trzeba zastąpić:

- przekazaniem rzeczywistej normalnej z IR, jeśli użytkownik ją podał,
- albo planner ma **odmówić** uruchomienia iDMI, jeśli normalna nie jest jawnie określona i nie ma fizycznie uzasadnionej, jednoznacznej reguły inferencji.

Dla solvera weryfikacyjnego **milczący default `ẑ` jest zły**.

##### B. CPU reference ma dostać prawdziwe iDMI / bulk DMI

**Plik:** `crates/fullmag-engine/src/fem.rs`  
**Miejsca:** okolice **1237-1246**

Nie zostawiaj zera i TODO.  
Trzeba zaimplementować ten sam kontrakt fizyczny co w C++.

Najbezpieczniej:

1. precompute gradienty funkcji bazowych P1 w elementach,
2. wyznaczać `∇m`,
3. liczyć pole DMI zgodnie z tą samą konwencją co backend natywny,
4. rzutować pole na DOF przez tę samą projekcję masową, jaką stosujesz dla innych pól.

Jeśli nie chcesz dwóch niezależnych wersji tej fizyki, przynajmniej:
- użyj identycznych testów golden,
- i waliduj CPU ref vs C++ backend na tych samych przypadkach.

##### C. Testy obowiązkowe

- iDMI z normalną `+z`
- iDMI z normalną `+x`
- iDMI z normalną ukośną, znormalizowaną
- sprawdzenie niezmienniczości po rotacji układu, jeśli rotujesz geometrię i normalną konsekwentnie

#### Priorytet

**Krytyczny**, jeśli chcesz weryfikować DMI serio, a nie „na oko”.

---

### FND-010 — FFI parity: wygląda na zamknięte

**Aktualny stan**

Nagłówek C i `fullmag-fem-sys` wyglądają obecnie spójnie:

- observables 1..12 są zsynchronizowane,
- `dmi_interface_normal` istnieje po obu stronach,
- `use_consistent_mass` istnieje po obu stronach.

Masz też testy kontrolne po stronie Rust.

#### Wniosek

Ten punkt uznaję za **zamknięty**.

#### Co jeszcze warto dodać

Nie krytyczne, ale dobre:

- `const_assert` / layout testy:
  - `size_of`
  - `align_of`
  - offsety pól
- test round-trip na zerowym planie z obu stron FFI.

---

### FND-011 — CPU reference nadal nie ma pełnej parytetu

**Aktualny stan**

CPU reference umie już więcej niż wcześniej:

- uniaxial anisotropy,
- cubic anisotropy,
- są testy np. dla cubic anisotropy.

Ale nadal nie ma:

- gradientowego iDMI,
- bulk DMI,
- pełnej parytetu z natywnym backendem.

#### Wniosek

Ten punkt jest tylko **częściowo naprawiony**.

#### Co dokładnie poprawić

**Plik:** `crates/fullmag-engine/src/fem.rs`

1. Dokończ iDMI.
2. Dokończ bulk DMI.
3. Dla każdego termu dodaj:
   - snapshot field parity vs native,
   - energy parity vs native,
   - convergence parity przy rafinacji siatki.

#### Dodatkowa rekomendacja architektoniczna

Wprowadź dwa tryby CPU reference:

- `reference_strict = true`
  - bez heurystyk,
  - bez cichych defaultów,
  - z błędem, gdy brakuje danych potrzebnych do referencyjnego wyniku;
- `reference_bootstrap = true`
  - może korzystać z heurystyk, ale jest jawnie oznaczony jako przybliżony.

---

### FND-012 — heurystyki są nadal obecne

**Aktualny stan**

Poprawiłeś jedną ważną rzecz:

- niektóre parametry solvera są override’owalne,
- cell-size hint jest konfigurowalny.

Ale nadal istnieją:

- `CELL_SIZE_EXTENT_FRACTION`,
- domyślne heurystyki transfer-grid,
- domyślne solver tolerances dla reference path.

#### Dlaczego nadal nie zamykam punktu

Dla weryfikacji solvera „bez hardcoded values / bez kompromisów” heurystyka nadal jest heurystyką, nawet jeśli można ją nadpisać.

#### Co dokładnie poprawić

**Plik:** `crates/fullmag-engine/src/fem.rs`

##### A. Transfer-grid geometry nie może być wymyślana przez reference path

Jeżeli reference CPU ma być używany do walidacji:

- grid shape / cell size / bbox / kernel spectra muszą pochodzić z jawnie zdefiniowanego planu,
- a nie z `CELL_SIZE_EXTENT_FRACTION`.

Jeżeli plan nie niesie pełnej definicji transfer-grid:
- reference-strict ma zwrócić błąd.

##### B. Solver params niech będą częścią jawnej konfiguracji

Zamiast lokalnych defaultów:
- niech planner wypisuje:
  - tolerancję,
  - max iter,
  - preconditioner policy,
  - kryterium stopu.

##### C. Testy

Dodaj test, że:
- strict-reference odmawia działania bez jawnego opisu transfer-grid,
- bootstrap-reference działa, ale raportuje że użył heurystyki.

#### Priorytet

**Wysoki**.

---

### FND-013 — `use_consistent_mass` to dobry ruch, ale nie koniec sprawy

**Aktualny stan**

To jest realny postęp:

- pole `use_consistent_mass` istnieje w C ABI i Rust FFI,
- `context.cpp` je czyta,
- `mfem_bridge.cpp` ma ścieżkę consistent-mass:
  - rozwiązuje `M h = K m` przez CG.

To jest dużo lepsze niż wcześniejszy czysto lumped-only obraz.

**Dlaczego nadal nie zamykam punktu**

Bo dla walidacji solvera nadal masz kilka problemów:

- ścieżka uproszczona nadal istnieje,
- `CGSolver` ma twardo wpisane:
  - `RelTol = 1e-10`
  - `MaxIter = 200`
- nie widzę jawnie sterowanej polityki projekcji / preconditionera,
- nie jest to jeszcze finalna ścieżka matrix-free.

#### Co dokładnie poprawić

**Pliki:**

- `native/include/fullmag_fem.h`
- `crates/fullmag-fem-sys/src/lib.rs`
- `native/backends/fem/src/context.cpp`
- `native/backends/fem/src/mfem_bridge.cpp`
- planner, który tworzy `fullmag_fem_plan_desc`

##### A. Rozszerz konfigurację projekcji exchange

Dodaj osobną konfigurację dla projekcji pola exchange, np.:

- solver type,
- tol,
- max_iter,
- preconditioner,
- projection mode = `lumped` / `consistent`.

##### B. Dla weryfikacji solvera ustaw politykę ostrą

W trybie validation/reference:

- `projection_mode = consistent`
- brak zgody na cichy fallback do lumped.

##### C. Testy

- porównanie lumped vs consistent na siatce nierównej,
- wykazanie zbieżności consistent przy rafinacji,
- test regresji na energy i polu dla znanego przypadku 1D/2D.

#### Priorytet

**Bardzo wysoki**.

---

### FND-014 — `kernels.cu`: nie zamykam bez pełnego re-audytu call-graphu

**Aktualny stan**

W tej rundzie nie przeprowadziłem pełnego audytu tego punktu z grafem wywołań build/runtime.  
Nie chcę udawać pewności tam, gdzie jej nie mam.

#### Co zrobić, żeby ten punkt zamknąć naprawdę

1. Przejrzeć:
   - wszystkie `#include "kernels.h"`
   - wszystkie odwołania do:
     - `fullmag_cuda_llg_rhs_fused`
     - `fullmag_cuda_normalize_vectors`
     - `fullmag_cuda_accumulate_heff`
     - `fullmag_cuda_device_max`
2. Potwierdzić:
   - że są linkowane do finalnego targetu,
   - że są rzeczywiście wołane w aktywnej ścieżce runtime,
   - że nie są martwym kodem.
3. Dodać:
   - test / benchmark / telemetry marker pokazujący, że ścieżka fused kernel była aktywna.

#### Status

**Do osobnego domknięcia**.

---

### FND-015 — publiczna ścieżka relaksacji nadal jest ograniczona

**Aktualny stan**

W `crates/fullmag-plan/src/validate.rs` walidator nadal mówi wprost, że public runner obsługuje tylko:

- `llg_overdamped`
- `projected_gradient_bb`
- `nonlinear_cg`

Czyli ta część nie jest jeszcze „pełnym, szerokim, publicznym, natywnym katalogiem relaksatorów”.

#### Dlaczego nadal nie zamykam punktu

Bo dla weryfikacji solvera nie wystarczy, że algorytm „gdzieś istnieje”.  
Musi być:

- jawnie obsługiwany,
- testowany,
- mieć określoną macierz kompatybilności:
  - backend,
  - study kind,
  - adaptive dt / fixed dt,
  - terms,
  - expected monotonicity / convergence.

#### Co dokładnie poprawić

**Pliki:**

- `crates/fullmag-plan/src/validate.rs`
- `crates/fullmag-plan/src/fem.rs`
- testy integracyjne planera i runnera

##### A. Zrób matrycę capability

Dla każdego relaksatora określ:

- FDM/FEM/hybrid,
- public/private,
- CPU/native MFEM,
- wymagane termy,
- obsługiwane study modes.

##### B. Niech planner odrzuca rzeczy precyzyjnie

Zamiast jednego ogólnego komunikatu:
- niech błąd mówi dokładnie:
  - który backend,
  - który algorytm,
  - czego brakuje.

##### C. Testy relaksacji

Co najmniej:

- monotoniczność energii tam, gdzie powinna zachodzić,
- spadek normy momentu / torque,
- zgodność stanu końcowego między metodami na prostych benchmarkach,
- detekcja stagnacji / divergence.

#### Priorytet

**Wysoki**.

---

## 4. Osobny audyt kodu meshowego

## 4.1. Werdykt ogólny

Nie, **kod dotyczący mesha nie jest jeszcze w pełni poprawiony**.

Masz tu mieszankę:

- rzeczy poprawionych i sensownie uporządkowanych,
- nadal istniejących ograniczeń architektonicznych,
- oraz przynajmniej jednego zwykłego błędu runtime.

Poniżej najważniejsze punkty.

---

### MESH-001 — realny bug runtime: `_extract_airbox_mesh_data()` zwraca `_pdq`, którego nie ma w scope

**Plik:** `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`

#### Gdzie

- definicja `_extract_airbox_mesh_data(...)`: okolice **3143**
- return `MeshData(..., per_domain_quality=_pdq)`: okolice **3231**

#### Problem

Funkcja `_extract_airbox_mesh_data(...)` ma sygnaturę:

- `gmsh`
- `mag_volumes`
- `air_volumes`
- `boundary_marker`
- `quality`

ale **nie dostaje `per_domain_quality` / `_pdq`**.

Mimo to w `return MeshData(...)` używa:
- `per_domain_quality=_pdq`

To jest klasyczny bug:
- nie składniowy,
- tylko runtime.

Jeśli ta ścieżka zostanie wykonana, dostaniesz `NameError` albo pokrewny problem zakresu.

#### Co dokładnie poprawić

Masz dwa poprawne warianty:

##### Wariant A — przekazuj `_pdq` jawnie

Zmień sygnaturę na:

```python
def _extract_airbox_mesh_data(
    gmsh: Any,
    mag_volumes: list[int],
    air_volumes: list[int],
    boundary_marker: int,
    quality: MeshQualityReport | None,
    per_domain_quality: dict[int, MeshQualityReport] | None,
) -> MeshData:
```

i w `add_air_box(...)` wołaj:

```python
mesh = _extract_airbox_mesh_data(
    gmsh,
    mag_volumes,
    air_volumes,
    boundary_marker,
    quality,
    _pdq,
)
```

a w `return` używaj:

```python
per_domain_quality=per_domain_quality,
```

##### Wariant B — nie zwracaj tego pola w tej ścieżce

Jeżeli ta ścieżka nie umie jeszcze sensownie wyliczyć per-domain quality:
- ustaw jawnie `per_domain_quality=None`,
- ale nie wolno odwoływać się do nieistniejącego `_pdq`.

#### Priorytet

**Natychmiast**.

---

### MESH-002 — air-box nadal identyfikuje fragment magnetyczny heurystyką bbox/centroid

**Plik:** `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`  
**Funkcja:** `add_air_box(...)`  
**Miejsca:** okolice **3016-3037**

#### Problem

Po `occ.fragment(...)` identyfikujesz, który fragment jest magnetyczny, a który jest air, przez:

- bbox,
- centroid,
- tolerancję `0.1 * diag`.

To jest heurystyka.  
Dla złożonych geometrii może dać złą klasyfikację:

- geometrie asymetryczne,
- cienkie / wydłużone kształty,
- imported geometry,
- geometrie wieloskładnikowe,
- przypadki po nietrywialnym CSG.

#### Co dokładnie poprawić

Nie identyfikuj wolumenów po bbox.  
Zamiast tego utrzymaj **tożsamość semantyczną regionów** przez sam workflow OCC.

Najlepsze warianty:

1. po `fragment` użyj mapowania wynikowego `result_map` i śledź pochodzenie bytów,
2. albo oznaczaj wejściowe bryły trwałymi tagami i odtwarzaj lineage po operacji boolean,
3. albo buduj shared-domain mesh z wyraźnym rozdzieleniem:
   - magnetic region ids,
   - air region ids,
   bez zgadywania po geometrii obwiedni.

#### Testy obowiązkowe

- cylinder przesunięty od środka,
- importowany STL,
- złożona geometria `Union/Difference`,
- cienki shell i wydłużony pręt.

#### Priorytet

**Bardzo wysoki**.

---

### MESH-003 — `add_air_box()` nadal nie obsługuje szerokiej klasy geometrii

**Plik:** `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`  
**Funkcja:** `_create_occ_geometry(...)`  
**Miejsce:** okolice **3124-3140**

#### Problem

Ścieżka air-box obsługuje tylko:

- `Box`
- `Cylinder`
- `Ellipsoid`

a dla reszty rzuca:

- `TypeError("add_air_box does not yet support ... geometry")`

To znaczy, że cały claim „mesh path jest już poprawiony” jest za mocny.  
To nadal nie jest ogólny, domknięty mesher domeny dla pełnego zestawu geometrii.

#### Co dokładnie poprawić

Rozszerz `_create_occ_geometry(...)` o:

- `Translate`
- `Union`
- `Difference`
- `Intersection`
- `ImportedGeometry`

Jeśli dana geometria nie daje się utrzymać jako OCC solid:
- musi istnieć jawny fallback workflow, który:
  - najpierw materializuje powierzchnię,
  - potem odzyskuje closed volume,
  - a następnie buduje air-box bez heurystycznego zgadywania.

#### Priorytet

**Wysoki**.

---

### MESH-004 — `world.py` nadal blokuje per-geometry FEM mesh settings w flat-script IR

**Plik:** `packages/fullmag-py/src/fullmag/world.py`  
**Miejsce:** okolice **1517-1519**

#### Problem

Masz wprost błąd:

- „Per-geometry FEM mesh settings are not yet supported in the flat-script IR”

A README / kontrakt FEM mówi, że powinny istnieć trzy warstwy:

1. universe mesh config,
2. per-object mesh config,
3. final shared-domain solver mesh.

Czyli w warstwie kontraktu repo oczekujesz per-object mesh policy, ale w praktycznej warstwie front-endu nadal ją blokujesz.

#### Co dokładnie poprawić

##### A. IR

Upewnij się, że flat-script IR niesie osobno:

- study/universe mesh config,
- per-geometry mesh config,
- domain mesh assembly policy.

##### B. `world.py`

Usuń globalne założenie „jeden shared hmax/order/source dla wszystkich geometrii”.  
Zamiast tego:

- serializuj osobne specy na geometrię,
- planner niech je scala do finalnej conforming mesh.

##### C. Planner

W `crates/fullmag-plan/src/mesh.rs` dopisz jawne reguły scalania:

- interface refinement precedence,
- outer air coarsening,
- object-local hmax,
- conflict resolution.

#### Priorytet

**Bardzo wysoki**, bo to dotyka podstawowego kontraktu FEM.

---

### MESH-005 — `GeometryMeshHandle.quality()` nadal zwraca `None`

**Plik:** `packages/fullmag-py/src/fullmag/world.py`  
**Miejsce:** okolice **537-545**

#### Problem

Masz API, które sugeruje dostęp do quality report, ale implementacja kończy się:

- `return None  # TODO ...`

To nie jest krytyczne dla fizyki solvera, ale jest dowodem, że mesh workflow nie jest jeszcze domknięty.

#### Co dokładnie poprawić

1. Po `build()` zapisz `MeshQualityReport` i `per_domain_quality` w obiekcie workflow/handle.
2. `GeometryMeshHandle.quality()` niech zwraca realny obiekt.
3. Dodaj test, że:
   - `compute_quality=True`,
   - `build()`,
   - `quality()` zwraca nie-`None`.

#### Priorytet

**Średni**, ale warto zamknąć.

---

### MESH-006 — planner nadal nie akceptuje conformal shared-interface nodes w części ścieżek

**Plik:** `crates/fullmag-plan/src/mesh.rs`  
**Miejsce:** okolice **307-318**

#### Problem

`validate_packing_constraints(...)` nadal potrafi odrzucić shared-domain FEM mesh, jeśli:

- `solver_supports_conformal == false`
- i istnieją `shared_interface_nodes`

a komunikat mówi wprost o wymaganiu „disjoint node ownership”.

To jest sprzeczne z docelowym obrazem final shared-domain conforming mesh.

#### Co dokładnie poprawić

Masz tu dwa warianty:

##### Wariant A — solver już naprawdę obsługuje conformal nodes

Wtedy:
- usuń ten guard,
- dodaj testy shared-interface.

##### Wariant B — solver jeszcze nie obsługuje conformal nodes

Wtedy:
- nie twierdź, że mesh stack jest już domknięty,
- oznacz to jako znane ograniczenie,
- nie dopuszczaj mylących success path.

#### Priorytet

**Wysoki**.

---

### MESH-007 — wybór `airbox boundary marker` nadal jest heurystyczny

**Plik:** `crates/fullmag-plan/src/mesh.rs`  
**Miejsce:** okolice **799-816**

#### Problem

`select_airbox_boundary_marker(...)` wybiera marker przez:

1. jeśli istnieje `99` → użyj `99`
2. inaczej użyj max dodatni marker
3. inaczej fallback do `99`

To jest wygodne, ale nie jest semantycznie twarde.  
Do solver validation boundary conditions powinny być jawne, nie zgadywane.

#### Co dokładnie poprawić

1. W trybie validation/reference:
   - boundary marker musi być jawny.
2. Heurystyka może pozostać wyłącznie w trybie bootstrap/interaktywnym.
3. Planner ma raportować:
   - skąd marker pochodzi,
   - i czy był jawny czy zgadnięty.

#### Priorytet

**Wysoki**.

---

### MESH-008 — `study_universe` nadal zależy od materialized shared-domain mesh asset

**Plik:** `crates/fullmag-plan/src/mesh.rs`  
**Miejsce:** okolice **941-986**  
**Plik:** `crates/fullmag-plan/src/fem.rs`  
**Miejsce:** okolice **265-275**, **901-908**

#### Problem

Planner sam mówi, że:

- `study_universe` wymaga shared-domain mesh asset,
- bez niego solver domain może pozostać tylko magnetyczny,
- air-box nie przenika automatycznie do solvera w planner-only path.

To znaczy, że pipeline universe→domain mesh→solver nie jest jeszcze całkowicie ciągły i domknięty.

#### Co dokładnie poprawić

1. Zrób jeden jawny kontrakt:
   - albo planner zawsze materializuje domain mesh,
   - albo runtime robi to automatycznie przed wykonaniem.
2. Nie zostawiaj stanu pośredniego:
   - `study_universe` w IR,
   - ale bez przeniesienia do solver domain.
3. Dodaj test integracyjny:
   - `study_universe` + multi-body + shared-domain airbox
   - i potwierdź, że solver naprawdę widzi air elements.

#### Priorytet

**Wysoki**.

---

### MESH-009 — quality validation jest nadal bardzo podstawowa

**Plik:** `packages/fullmag-py/src/fullmag/meshing/quality.py`

#### Problem

`validate_mesh(...)` sprawdza głównie:

- signed volume,
- min/max volume,
- count elementów i boundary faces.

To nie wystarcza do porządnej walidacji solver mesh.

Brakuje m.in.:

- duplicate / degenerate faces,
- orphan nodes,
- non-manifold boundary,
- consistency region markers,
- adjacency magnetic↔air,
- face orientation checks,
- sliver / aspect ratio thresholds w krytycznych strefach.

#### Co dokładnie poprawić

Rozszerz walidację o osobne sekcje:

- topology checks,
- region/marker checks,
- boundary-condition checks,
- quality thresholds,
- interface checks.

#### Priorytet

**Średni**, ale ważny dla automatycznej bramki jakości.

---

### MESH-010 — pipeline meshowy nadal zawiera jawne fallbacki

**Plik:** `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py`

#### Problem

Sama obecność fallbacków nie jest zła.  
Ale dopóki pipeline potrafi przełączyć się na tryby typu:

- `concatenated_stl_fallback`
- `component_aware_import_failed`

to nie można mówić, że cały mesh path jest semantycznie „czysty” bez doprecyzowania, w którym trybie został zbudowany asset.

#### Co dokładnie poprawić

1. Każdy fallback niech będzie jawnie zapisany w metadanych.
2. W trybie solver-verification:
   - fallbacki mają być zakazane lub co najmniej ostrzegane jako degradacja jakości wejścia.
3. Dodaj testy:
   - że verification mode odrzuca asset z fallback lineage.

#### Priorytet

**Średni**.

---

## 5. Dokładny plan refaktoryzacji i poprawek plik po pliku

Poniżej plan w kolejności, w jakiej naprawdę warto to robić.

---

### Etap A — domknąć krytyczne błędy wpływające na fizykę i walidację

#### A1. Konserwatywna projekcja FEM→transfer-grid

**Pliki:**

- `native/backends/fem/src/mfem_bridge.cpp`
- `crates/fullmag-engine/src/fem.rs`

**Co zrobić:**

- usunąć hit-count average,
- dodać objętości przecięcia `tet ∩ cell`,
- zdefiniować jeden jawny kontrakt dla `cell_magnetization_xyz`,
- dodać test zachowania całkowitego momentu.

**Definition of done:**

- moment całkowity zachowany,
- wynik niezależny od kolejności elementów,
- zbieżność przy rafinacji.

---

#### A2. Per-node control volume dla termiki

**Pliki:**

- `native/backends/fem/src/context.hpp`
- `native/backends/fem/src/context.cpp`
- `native/backends/fem/src/mfem_bridge.cpp`

**Co zrobić:**

- dodać `nodal_control_volume`,
- policzyć ją z masy skalarnej na domenie magnetycznej,
- używać `V_i` w termice.

**Definition of done:**

- sigma lokalnie skaluje się jak `1/sqrt(V_i)`.

---

#### A3. End-to-end DMI parity

**Pliki:**

- `crates/fullmag-plan/src/fem.rs`
- `crates/fullmag-engine/src/fem.rs`
- testy natywne + Rust CPU ref

**Co zrobić:**

- planner ma przenosić `dmi_interface_normal`,
- brak jawnej normalnej dla iDMI w trybie strict → błąd,
- CPU reference ma implementować iDMI + bulk DMI.

**Definition of done:**

- parity field/energy native vs CPU ref.

---

#### A4. Jawna polityka projekcji exchange

**Pliki:**

- `native/include/fullmag_fem.h`
- `crates/fullmag-fem-sys/src/lib.rs`
- planner tworzący `fullmag_fem_plan_desc`
- `native/backends/fem/src/mfem_bridge.cpp`

**Co zrobić:**

- dodać solver config dla projekcji pola exchange,
- w validation mode wymusić `consistent`,
- odseparować `bootstrap` od `reference`.

**Definition of done:**

- brak cichych fallbacków do lumped w ścieżce referencyjnej.

---

### Etap B — domknąć mesh workflow

#### B1. Naprawić `_pdq` bug

**Plik:**

- `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`

**Co zrobić:**

- poprawić sygnaturę `_extract_airbox_mesh_data(...)`
- lub nie zwracać `per_domain_quality` w tej ścieżce.

**Definition of done:**

- test air-box mesh z `compute_quality=True` przechodzi.

---

#### B2. Usunąć bbox heurystykę identyfikacji regionów po `fragment`

**Plik:**

- `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`

**Co zrobić:**

- używać lineage z OCC / `result_map`,
- a nie bbox + centroid.

**Definition of done:**

- poprawna klasyfikacja mag/air dla CSG i imported geometry.

---

#### B3. Rozszerzyć `_create_occ_geometry(...)`

**Plik:**

- `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`

**Co zrobić:**

- obsłużyć więcej geometrii,
- zdefiniować jawne fallbacki.

**Definition of done:**

- `add_air_box()` działa dla reprezentatywnego zestawu geometrii.

---

#### B4. Wpuścić per-geometry mesh config do flat-script IR

**Pliki:**

- `packages/fullmag-py/src/fullmag/world.py`
- `crates/fullmag-ir/src/lib.rs`
- `crates/fullmag-plan/src/mesh.rs`

**Co zrobić:**

- nie wymuszać jednej wspólnej konfiguracji dla wszystkich geometrii,
- niech planner scala osobne polityki do finalnej conforming mesh.

**Definition of done:**

- test z dwiema geometriami o różnych `hmax/order` przechodzi do planu.

---

#### B5. Urealnić boundary marker policy

**Pliki:**

- `crates/fullmag-plan/src/mesh.rs`
- front-end / IR, który wprowadza air-box config

**Co zrobić:**

- w trybie validation wymagaj jawnego markera,
- heurystyki tylko dla bootstrap/interaktywnych ścieżek.

**Definition of done:**

- brak zgadywanego markera w strict mode.

---

#### B6. Podłączyć quality report do API użytkownika

**Plik:**

- `packages/fullmag-py/src/fullmag/world.py`

**Co zrobić:**

- po `build()` zachować `MeshQualityReport`,
- zwracać go przez `quality()`.

**Definition of done:**

- `handle.quality()` zwraca realne dane.

---

### Etap C — uczynić walidację i testy solvera automatycznymi i bezlitosnymi

#### C1. Rozdzielić tryby wykonania

Wprowadź trzy jawne tryby:

- `bootstrap`
- `hybrid_validation`
- `reference_strict`

**Bootstrap**
- może używać heurystyk,
- może mieć transfer-grid,
- dobre do development preview.

**Hybrid validation**
- dopuszcza transfer-grid, ale wszystko jest jawnie opisane.

**Reference strict**
- bez heurystyk,
- bez cichych defaultów,
- bez guessed markerów,
- bez `dmi_interface_normal = z` z powietrza,
- bez lumped fallback w exchange projection.

---

## 6. Proponowana macierz testów automatycznych

Poniżej testy, które naprawdę warto mieć, jeśli solver ma być weryfikowany poważnie.

---

### 6.1. Testy transfer-grid demag

#### TG-001 — zachowanie całkowitego momentu

Dla kilku geometrii policz:

- całkowity moment z FEM:
  - `∫ Ms m dV`
- całkowity moment z transfer-grid:
  - `Σ (M_cell * V_cell)`

Warunek:
- błąd względny poniżej ustalonej tolerancji.

#### TG-002 — niezależność od kolejności elementów

- losowo permutuj elementy,
- wynik pola i energii demag ma pozostać ten sam.

#### TG-003 — częściowe wypełnienie komórek

- cienka warstwa / ukośna ścianka,
- sprawdź czy projekcja zbiega przy rafinacji.

#### TG-004 — parity C++ vs Rust CPU ref

- te same gridy,
- te same spectra,
- te same wyniki w tolerancji.

---

### 6.2. Testy natywnego FEM demag

#### PD-001 — Dirichlet boundary marker correctness

- zły marker → błąd,
- dobry marker → sukces.

#### PD-002 — pole dociera do air nodes

Masz już zalążek tego rodzaju testu po stronie CPU ref.  
Dołóż natywny odpowiednik.

#### PD-003 — energia demag dodatnia dla stabilnych benchmarków

- cienki box,
- porównanie out-of-plane vs in-plane.

---

### 6.3. Testy exchange projection

#### EX-001 — lumped vs consistent na siatce jednorodnej

Na siatce jednorodnej różnica powinna maleć.

#### EX-002 — consistent na siatce nierównej

Na siatce nierównej sprawdź, że consistent daje stabilniejszą i bardziej zbieżną odpowiedź.

#### EX-003 — brak cichego fallbacku

W strict mode:
- jeśli `use_consistent_mass=true`, a potrzebnych struktur brak → błąd, nie fallback.

---

### 6.4. Testy DMI

#### DMI-001 — iDMI z różnymi normalnymi

- `n = +z`
- `n = +x`
- `n = (1,1,1)/sqrt(3)`

#### DMI-002 — planner propagation

- IR z `dmi_interface_normal`
- plan ma nieść ten sam wektor.

#### DMI-003 — CPU ref vs native parity

- snapshot `H_dmi`
- energia DMI
- przypadek bulk i interfacial osobno.

---

### 6.5. Testy termiki

#### TH-001 — lokalna zależność od objętości węzła

- sztucznie nierówna siatka,
- amplituda szumu musi skorelować z `1/sqrt(V_i)`.

#### TH-002 — reproducibility by seed

- seed != 0 → powtarzalne pole,
- seed = 0 → niepowtarzalne.

---

### 6.6. Testy relaksacji

#### RLX-001 — monotoniczność energii tam, gdzie powinna zachodzić

Dla `llg_overdamped` i gradientowych relaksatorów.

#### RLX-002 — zgodność stanu końcowego między algorytmami

- `llg_overdamped`
- `projected_gradient_bb`
- `nonlinear_cg`

na prostych benchmarkach.

#### RLX-003 — capability matrix

Test planera:
- algorytm nieobsługiwany dla danej ścieżki → precyzyjny błąd.

---

### 6.7. Testy mesha

#### MSH-001 — air-box generation + quality extraction

- `compute_quality=True`
- brak błędu `_pdq`
- `quality()` nie zwraca `None`

#### MSH-002 — region identity po boolean fragment

- przypadki CSG,
- imported geometry,
- przesunięte bryły.

#### MSH-003 — per-geometry mesh policy round-trip

- dwa obiekty,
- różne `hmax`,
- plan zachowuje obie polityki.

#### MSH-004 — explicit boundary marker strict mode

- brak jawnego markera w validation mode → błąd.

---

## 7. Jak to włączyć do automatycznych testów repo

Poniżej proponowany podział na warstwy CI.

### Warstwa 1 — szybkie testy kontraktowe

Uruchamiaj na każdym push:

- `cargo check --workspace`
- `cargo test --workspace`
- pythonowe testy pakietu `fullmag-py`

Do tego dołóż:

- testy planera strict-vs-bootstrap,
- testy FFI layout/parity,
- testy CPU reference `fem.rs`.

### Warstwa 2 — testy mesha

Osobny job:

- build minimalnego środowiska z `gmsh`,
- testy `gmsh_bridge.py`,
- testy air-box,
- testy quality pipeline.

### Warstwa 3 — cięższe testy natywnego FEM

Osobny job/container:

- build z `FULLMAG_USE_MFEM_STACK=ON`
- testy:
  - Poisson Dirichlet/Robin
  - exchange consistent mass
  - DMI parity
  - thermal local volume

### Warstwa 4 — nightly / benchmark

Nightly:

- porównania z golden dataset,
- convergence study,
- benchmarki wydajności,
- testy na większych meshach.

---

## 8. Minimalna kolejność wdrożenia

Jeżeli chcesz zrobić to rozsądnie, a nie na zasadzie „łatamy wszystko naraz i potem już tylko modlitwa”, kolejność powinna być taka:

1. **MESH-001** — `_pdq` bug
2. **FND-001 + FND-002** — konserwatywna projekcja tet→cell
3. **FND-008** — per-node control volume dla termiki
4. **FND-009 + FND-011** — end-to-end DMI parity
5. **FND-013** — jawna polityka consistent vs lumped
6. **MESH-002 + MESH-007** — usunięcie heurystyk region/marker dla strict mode
7. **MESH-004 + MESH-008** — dopięcie kontraktu per-geometry/universe/shared-domain
8. **FND-015** — matryca relaksatorów + testy

---

## 9. Krótka odpowiedź operacyjna

### Co uznaję za naprawdę naprawione

- przekazywanie precomputed spectra demag,
- pełniejsze odświeżanie `H_eff` po uploadzie,
- guard effective-field termów,
- hard error zamiast pin DOF 0,
- synchronizację observables / nowych pól FFI.

### Co nadal blokuje „solver validation bez kompromisów”

- brak konserwatywnej projekcji FEM→transfer-grid,
- nadal globalna średnia objętość węzła w termice,
- brak pełnej parytetu DMI end-to-end,
- heurystyki transfer-grid i boundary-marker,
- mesh workflow nadal nie domyka per-object policy i region identity bez heurystyk,
- realny bug `_pdq` w air-box mesh path,
- publiczna ścieżka relaksacji nadal jest ograniczona.

---

## 10. Finalny werdykt

Po tej rundzie re-audytu powiedziałbym tak:

- **tak, naprawiłeś kilka naprawdę ważnych rzeczy**
- **nie, solver FEM i mesh stack nie są jeszcze w stanie, który nazwałbym pełną walidacją bez uproszczeń**
- **największe pozostałe ryzyka to teraz: projekcja transfer-grid, termika z lokalnym `V_i`, parytet DMI oraz mesh air-box/path semantics**

To już nie jest stan „wszystko się pali”.  
Ale też jeszcze nie jest stan „można bez mrugnięcia okiem podpisywać fizykę jako referencyjnie zweryfikowaną”.

