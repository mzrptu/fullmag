
# Fullmag CPU / HPC Audit — raport diagnostyczny
**Repozytorium:** `MateuszZelent/fullmag`  
**Zakres:** FDM CPU, FEM CPU, gotowość do HPC / multi-socket / multi-node  
**Data opracowania:** 2026-04-09  
**Stan analizowanego kodu:** publiczny `master` w momencie audytu

---

## 0. Cel raportu

Celem tego raportu jest odpowiedź na pytanie:

> dlaczego aktualny Fullmag nie wykorzystuje nawet pojedynczego CPU w pełni i co blokuje przejście do prawdziwego HPC, włącznie z klastrami rzędu setek–tysiąca węzłów?

Raport jest **diagnostyczny**, nie wdrożeniowy. Ma:
1. opisać **rzeczywisty** obecny stan implementacji,
2. wskazać **wszystkie główne bottlenecki** w FDM i FEM,
3. rozdzielić problemy na:
   - problemy **mikro-optymalizacji**,
   - problemy **architektoniczne**,
   - problemy **fizyczne / semantyczne**,
4. pokazać, które braki są tylko wydajnościowe, a które grożą rozjazdem fizyki między FDM i FEM,
5. przygotować grunt pod osobny plan wdrożeniowy.

To nie jest benchmark runtime wykonany na Twoim klastrze. To jest **audyt kodu i architektury**. Jednak w obecnym stanie repo da się z dużą pewnością wskazać, które miejsca są dominującymi źródłami marnowania CPU, pamięci, przepustowości i skalowalności.

---

## 1. Najważniejszy werdykt

### 1.1. Wniosek globalny

Aktualny Fullmag **nie jest jeszcze solverem rozproszonym HPC dla jednej dużej symulacji**.  
Obecna architektura jest znacznie bliższa modelowi:

- **jedna symulacja = jeden proces / jeden node / jeden backend**,
- a HPC oznacza głównie **external dispatch** i uruchamianie wielu zadań na wielu węzłach,

niż modelowi:

- **jedna symulacja = wiele ranków MPI / wiele nodów / wspólny rozproszony operator**.

To jest absolutnie kluczowe. Oznacza to, że mając 1000 węzłów CPU, już dziś możesz dobrze skalować:
- skany parametrów,
- zbiory przypadków,
- optymalizacje wielouruchomieniowe,
- kampanie porównawcze,

ale **nie** skalujesz jeszcze jednej dużej symulacji FDM/FEM na 1000 nodów tak jak dojrzały kod HPC.

### 1.2. Wniosek FDM

Publiczny “CPU FDM” w Fullmag to **nie osobny natywny backend CPU w C/C++**, tylko głównie **Rustowy silnik referencyjny** (`fullmag-engine`) uruchamiany przez `fullmag-runner`.  
Największy bottleneck FDM CPU jest dziś następujący:

1. **dominujący demag FFT jest praktycznie serialny w krytycznych fragmentach**,  
2. w hot loop nadal występują **duże alokacje tymczasowe** mimo istnienia częściowego systemu buffer reuse,  
3. główny stan pola jest trzymany jako **AoS (`Vec<[f64;3]>`)**, mimo że w kodzie istnieje już `VectorFieldSoA`,  
4. nie istnieje jeszcze **rozproszona dekompozycja domeny i distributed FFT**,  
5. nie istnieje jeszcze **native CPU FDM path** zoptymalizowany pod NUMA / MPI / threaded FFT.

W efekcie FDM CPU nie jest dziś „niedostrojony o 20%”.  
On jest po prostu **na etapie referencyjnego engine’u**, który nadaje się na walidację fizyki i na małe/średnie przypadki, ale nie na produkcyjne wykorzystanie klastra CPU.

### 1.3. Wniosek FEM

FEM ma dziś **dwa światy naraz**:

1. **Rustowy CPU reference FEM** (`fullmag-engine/src/fem.rs` + `fullmag-runner/src/fem_reference.rs`),  
2. **native FEM przez MFEM** (`native/backends/fem/src/mfem_bridge.cpp`), który jest architektonicznie bliżej docelowego kierunku, ale nadal nie jest jeszcze skończoną ścieżką CPU-HPC.

Największy bottleneck FEM CPU jest dziś następujący:

1. CPU reference ma **alokacyjny hot loop** i bardzo prostą algebrę rzadką,
2. operatorowo opiera się na:
   - serialnym CSR SpMV,
   - prostym Jacobi-CG,
   - kosztownym `HashMap`/COO assembly,
3. demag FEM jest nadal rozszczepione między:
   - uproszczony solve Poisson/Robin,
   - i kosztowną, przybliżoną ścieżkę `transfer_grid`,
4. transfer-grid rasterization jest samo w sobie bardzo drogie,
5. periodic BC i część interakcji nadal mają rozjazd względem docelowej semantyki,
6. native MFEM path nadal używa w krytycznych miejscach:
   - `AssemblyLevel::LEGACY`,
   - hostowych odczytów/zapisów,
   - oraz lokalnych solve’ów, zamiast prawdziwie rozproszonej ścieżki MPI/ParMesh/ParCSR.

### 1.4. Wniosek o fizyce

Najważniejszy błąd, którego trzeba uniknąć podczas optymalizacji:

> nie wolno „naprawić wydajności” przez przypadkową zmianę semantyki operatora.

W Fullmagu już dziś istnieją **realne rozjazdy fizyczne** między FDM i FEM:
- różne realizacje demag,
- różne pokrycie interakcji,
- brak egzekwowania periodic BC w FEM CPU reference,
- różna dojrzałość integratorów i precyzji,
- rozszczepienie między reference path i native path.

Dlatego każda poważna optymalizacja musi być prowadzona równolegle z:
- testami referencyjnymi,
- monitoringiem energii,
- walidacją pól efektywnych,
- tolerancjami parity FDM↔FEM,
- oraz twardym rozdzieleniem: **co jest optymalizacją**, a **co zmianą modelu**.

---

## 2. Co zostało realnie sprawdzone w kodzie

Przeanalizowano w szczególności:

### 2.1. FDM / CPU reference
- `crates/fullmag-runner/src/cpu_reference.rs`
- `crates/fullmag-engine/src/lib.rs`
- `crates/fullmag-fdm-demag/src/*`
- `native/backends/fdm/CMakeLists.txt`

### 2.2. FEM / CPU reference + native
- `crates/fullmag-runner/src/fem_reference.rs`
- `crates/fullmag-engine/src/fem.rs`
- `crates/fullmag-engine/src/fem_sparse.rs`
- `crates/fullmag-runner/src/native_fem.rs`
- `native/backends/fem/src/mfem_bridge.cpp`
- `native/backends/fem/src/context.cpp`
- `native/backends/fem/CMakeLists.txt`

### 2.3. Planowanie / dispatch / semantics
- `crates/fullmag-runner/src/dispatch.rs`
- `readme.md`
- `docs/physics/0400-fdm-exchange-demag-zeeman.md`
- `docs/physics/0410-fem-exchange-demag-zeeman-mfem-gpu.md`
- `docs/physics/0480-fdm-higher-order-and-adaptive-time-integrators.md`
- `docs/physics/0482-fdm-fsal-optimization.md`

---

## 3. Stan architektury uruchomieniowej — jak Fullmag naprawdę wykonuje CPU

## 3.1. FDM CPU — aktualny tor wykonania

To, co użytkownik może intuicyjnie nazywać “CPU FDM solverem”, w publicznym kodzie jest de facto:

1. Python / IR / planner budują `FdmPlanIR`,
2. `fullmag-runner` wybiera `FdmEngine::CpuReference`,
3. `execute_reference_fdm()` w `cpu_reference.rs` buduje:
   - `ExchangeLlgProblem`,
   - `ExchangeLlgState`,
   - jeden `FftWorkspace`,
   - jeden `IntegratorBuffers`,
4. pętla czasu wywołuje `problem.step_with_buffers(...)`,
5. właściwa fizyka i integracja dzieją się w `fullmag-engine/src/lib.rs`.

To jest ważne z dwóch powodów:

- **plus:** runner nie odbudowuje wszystkiego co krok,
- **minus:** prawdziwy hot loop siedzi w `fullmag-engine`, który nadal jest referencyjnym Rustowym engine’em, a nie dojrzałym natywnym backendem CPU.

### 3.1.1. Dowód architektoniczny

`native/backends/fdm/CMakeLists.txt` pokazuje, że publiczny natywny backend FDM zawiera realne źródła solvera tylko przy `FULLMAG_ENABLE_CUDA`; poza tym zostają praktycznie tylko `api.cpp` i `error.cpp`.  
Wniosek: **nie ma dziś publicznego native CPU FDM solvera**.  
To oznacza, że CPU optymalizujesz przede wszystkim w Rustowym `fullmag-engine`, a nie w ukrytym C backendzie.

## 3.2. FEM CPU — aktualny tor wykonania

W FEM sytuacja jest bardziej złożona:

- `FemEngine::CpuReference` prowadzi do `fem_reference.rs`,
- `FemEngine::NativeGpu` prowadzi do native MFEM backendu,
- ale sam native backend ma również elementy sensowne dla CPU (MFEM stack), choć nie jest dziś sformalizowany jako pełny „production CPU FEM backend”.

W praktyce repo ma dziś równolegle:

### 3.2.1. CPU reference FEM
- pełny Rustowy pipeline,
- czytelny, referencyjny, łatwy do walidacji,
- ale mały potencjał HPC.

### 3.2.2. Native FEM / MFEM
- architekturę bliższą docelowemu solverowi,
- lepszy potencjał HPC,
- ale jeszcze nie w pełni domknięty ani niejednoznacznie zdefiniowany jako główny CPU path.

To rozszczepienie samo w sobie jest bottleneckiem projektowym:  
**nie wiadomo jeszcze, który CPU FEM solver ma być „autorytatywny” wydajnościowo i fizycznie.**

---

## 4. FDM CPU — audyt diagnostyczny

# 4.1. Co w FDM działa dobrze już teraz

Zanim przejdziemy do krytyki, warto uczciwie zaznaczyć, co jest zrobione sensownie:

1. `cpu_reference.rs` tworzy `FftWorkspace` raz na symulację, nie raz na krok.
2. `cpu_reference.rs` tworzy `IntegratorBuffers` raz na symulację.
3. `step_with_buffers()` istnieje i faktycznie eliminuje część alokacji etapów integratora.
4. Engine ma już:
   - RK23,
   - RK45,
   - FSAL,
   - ABM3,
   - podstawowe użycie Rayon.
5. Istnieje już `VectorFieldSoA`, czyli w kodzie jest świadomość docelowego układu danych.

To znaczy: kod nie jest chaotyczny.  
On po prostu jest **w połowie drogi** między referencyjnym silnikiem a solverem HPC.

---

# 4.2. FDM CPU — główne bottlenecki

## 4.2.1. Bottleneck FDM-A — brak prawdziwego natywnego CPU backendu

### Objaw
Cały CPU FDM opiera się na `fullmag-engine` w Rust, a nie na osobnym native CPU backendzie z dopiętą polityką:
- OpenMP / TBB / MPI,
- NUMA placement,
- threaded FFT,
- allocatory HPC,
- pinning,
- instrumentation.

### Skutek
Brakuje miejsca, gdzie można profesjonalnie zaimplementować:
- CPU kernel fusion,
- threaded FFT backend,
- slab/pencil decomposition,
- MPI all-to-all,
- ogromne, kontrolowane alokacje przy dużych siatkach.

### Ocena
**Priorytet: P0 / architektoniczny.**

---

## 4.2.2. Bottleneck FDM-B — hot loop nadal alokuje duże wektory

`IntegratorBuffers` istnieje, ale buffer reuse nie jest kompletne.

### Dowód
W `crates/fullmag-engine/src/lib.rs`:

- `llg_rhs_into_ws()` woła `llg_rhs_from_vectors_ws()`,
- `llg_rhs_from_vectors_ws()` buduje nowy `Vec<Vector3>`,
- `effective_field_from_vectors_ws()` składa osobne pełne wektory dla:
  - exchange,
  - demag,
  - external,
  - magnetoelastic,
  - anisotropy,
  - interfacial DMI,
  - bulk DMI,
  - oraz wynikowego `h_eff`.

To oznacza, że nawet przy `step_with_buffers()` w każdej ocenie RHS nadal powstają duże tymczasowe alokacje.

### Dlaczego to jest krytyczne
Dla explicit LLG koszt nie jest tylko w FLOPach. Jest też w:
- alokatorze,
- cache missach,
- presji na L3,
- zerowaniu pamięci,
- fragmentacji,
- utrudnieniu SIMD.

Przy RK45 jedno zaakceptowane przejście wymaga wielu RHS.  
Jeśli każdy RHS alokuje wiele pełnych pól, CPU traci dużo czasu poza samą fizyką.

### Skutek w HPC
- słabsza skalowalność wątkowa,
- niestabilna wydajność,
- niepotrzebny ruch pamięci,
- trudniejsza kontrola NUMA.

### Ocena
**Priorytet: P0.**

---

## 4.2.3. Bottleneck FDM-C — AoS zamiast SoA w głównym stanie solvera

`VectorFieldSoA` istnieje i komentarz w kodzie wprost mówi, że jest „optimal for SIMD, FFT gather/scatter, and GPU upload”.  
Jednak właściwy stan magnetyzacji i większość ścieżek obliczeniowych FDM nadal używają:

```rust
type Vector3 = [f64; 3];
Vec<Vector3>
```

czyli klasycznego **AoS**.

### Dlaczego to boli
Dla CPU HPC:
- exchange stencil,
- field fusion,
- tensor multiply,
- normowanie,
- cross products,

są zwykle szybsze na:
- `mx[]`, `my[]`, `mz[]` oddzielnie,
- lepiej wyrównanych buforach,
- łatwiejszym SIMD.

AoS jest wygodny semantycznie, ale gorszy dla:
- wektoryzacji automatycznej,
- cache line efficiency,
- gather/scatter między polami,
- separacji składowych w operatorach tensorowych.

### Szczególnie boli w demag
Demag i tak rozbija pole na składowe `x/y/z`, więc AoS oznacza dodatkowe konwersje mentalne i często fizyczne ruchy danych.

### Ocena
**Priorytet: P0.**

---

## 4.2.4. Bottleneck FDM-D — 3D FFT ma serialny rdzeń

Największy bottleneck FDM CPU siedzi w `fft3_core()`.

### Obecny algorytm
1. FFT po osi X — ciągłe w pamięci,
2. FFT po osi Y — gather do `line_y`, FFT, scatter,
3. FFT po osi Z — gather do `line_z`, FFT, scatter.

### Problem
Kod przechodzi po Y i Z w pętlach sekwencyjnych i nie wykorzystuje:
- batched FFT backendu z wielowątkowością,
- MPI-distributed FFT,
- planów zoptymalizowanych pod konkretne strides,
- zaawansowanych transpose kernels.

To prawdopodobnie jest główny powód, dla którego obserwujesz śmiesznie niskie zużycie CPU:
- część pętli jest równoległa,
- ale **dominujący demag FFT nie jest równoległy tak, jak powinien być**.

### Dlaczego to jest najważniejsze
W LLG z demag koszt RHS jest zwykle zdominowany przez:
- pack,
- FFT,
- tensor multiply,
- inverse FFT,
- unpack.

Jeżeli sama 3D FFT jest realizowana przez ręcznie złożony, częściowo serialny pipeline na `rustfft`, to nie da się zbliżyć do pełnego wykorzystania nowoczesnego CPU, a tym bardziej multi-socket node’a.

### Ocena
**Priorytet: absolutny P0.**

---

## 4.2.5. Bottleneck FDM-E — ogromny koszt czyszczenia i pakowania padded buffers

`FftWorkspace::clear_bufs()` zeruje sześć dużych buforów zespolonych:
- `buf_mx`, `buf_my`, `buf_mz`,
- `buf_hx`, `buf_hy`, `buf_hz`.

Do tego dochodzi pakowanie `M = Ms * m` do padded gridu 2× w każdym kierunku.

### Co to oznacza
Dla siatki `Nx × Ny × Nz` padded domain ma rozmiar:
- `2Nx × 2Ny × 2Nz`,
- czyli `8N` komórek.

Każdy krok:
- zerujesz 6 takich buforów,
- zapisujesz 3 pola wejściowe,
- czytasz/zapisujesz je wielokrotnie przez FFT.

To jest ogromny ruch pamięci.  
Na CPU bardzo łatwo staje się to problemem **bandwidth-bound**, a nie compute-bound.

### Dodatkowy problem
W środowisku NUMA brak polityki first-touch / binding może powodować:
- zdalne dostępy między socketami,
- niską lokalność,
- niestabilny scaling.

### Ocena
**Priorytet: P0 / memory-bandwidth critical.**

---

## 4.2.6. Bottleneck FDM-F — efektive field assembly jest rozdrobnione i nie-fused

`effective_field_from_vectors_ws()` liczy osobne pola, a potem je sumuje.

To jest czytelne, ale kosztowne.

### Skutek
Masz wielokrotne przejścia po pamięci:
- jedno dla exchange,
- jedno dla demag,
- jedno dla anisotropy,
- jedno dla DMI,
- jedno dla thermal,
- jeszcze jedno do zsumowania wszystkiego.

W solverze HPC chcemy zwykle:
- mieć `h_eff` jako główny bufor wynikowy,
- dodawać kolejne wkłady **in-place**,
- nie tworzyć siedmiu pełnych wektorów, jeśli można mieć 1–2.

### Uwaga fizyczna
To nie znaczy, że trzeba scalać wszystkie interakcje algebraicznie na siłę.  
Trzeba scalać **warstwę pamięci i buforów**, nie zacierać znaczenia fizycznego poszczególnych wkładów.

### Ocena
**Priorytet: P1, ale z bardzo dużym wpływem.**

---

## 4.2.7. Bottleneck FDM-G — exchange jest równoległy, ale ma zły układ danych do CPU SIMD

Exchange używa 6-punktowego stencilu i jest uruchamiany przez `into_par_iter()` po komórkach.  
To jest rozsądny pierwszy krok, ale:

- pracuje na AoS,
- robi wiele drobnych dostępów sąsiedzkich,
- nie wykorzystuje dobrze szerokich rejestrów,
- nie ma blokowania cache,
- nie ma polityki tile / chunk / affinity.

Dla dużych siatek exchange jest lokalny i powinien być bardzo dobrze skalowalny na CPU.  
Tu scaling będzie ograniczony raczej przez memory subsystem niż przez matematykę.

### Ocena
**Priorytet: P1.**

---

## 4.2.8. Bottleneck FDM-H — thermal noise RNG nie jest przygotowane pod HPC

Thermal field używa `thread_local!` z prostym `xorshift64*` i seedem `42`, plus Box–Muller w hot loop.

### Problemy
1. to jest kosztowne na krok,
2. nie jest to najlepsza architektura do reproducible parallel HPC,
3. deterministyczność względem liczby wątków i dekompozycji MPI będzie kłopotliwa,
4. trudno kontrolować niezależne strumienie dla ranków i chunków.

### Co jest potrzebne docelowo
- counter-based RNG albo per-cell/per-step splittable RNG,
- ścisła polityka seeding,
- możliwość reprodukcji przy zmianie:
  - liczby wątków,
  - ranków MPI,
  - rozkładu domeny.

### Ocena
**Priorytet: P2 wydajnościowo, P1 reprodukowalnościowo.**

---

## 4.2.9. Bottleneck FDM-I — brak rozproszonego FFT / brak MPI decomposition

To jest granica, której nie da się przeskoczyć samym tuningiem jednego noda.

### Co dziś jest możliwe
- wielowątkowość na jednym node,
- ewentualnie multi-socket, ale nadal shared-memory.

### Czego nie ma
- slab decomposition,
- pencil decomposition,
- distributed Newell convolution,
- komunikacji halo dla lokalnych operatorów po partycji,
- rank-local plan caches,
- global transpose / all-to-all dla 3D FFT.

### Wniosek
Dopóki tego nie ma, Fullmag **nie będzie używał 1000 węzłów do jednej symulacji FDM**.

### Ocena
**Priorytet: architektoniczny P0, ale etap późniejszy.**

---

## 4.2.10. Bottleneck FDM-J — runner / artifact / live preview mogą psuć scaling małych kroków

Na małych `dt` i w trybach interaktywnych:
- `observe_state()`,
- scalar schedules,
- field schedules,
- preview build,
- flattening,
- eksport artefaktów,

mogą stanowić zauważalny narzut.

To nie jest główny bottleneck dla dużych siatek z demag, ale dla:
- małych problemów,
- krótkich kroków,
- live mode,

może fałszować profil wydajności.

### Ocena
**Priorytet: P2, ale konieczny do uczciwego benchmarkingu.**

---

# 4.3. FDM CPU — bottlenecki mniej oczywiste, ale bardzo ważne

## 4.3.1. FSAL pomaga, ale nie rozwiązuje złej architektury pamięci

Repo ma słusznie zaimplementowaną optymalizację FSAL dla DP45.  
To naprawdę obniża liczbę RHS na zaakceptowany krok.

Jednak jeśli:
- pojedynczy RHS nadal dużo alokuje,
- FFT nadal jest słabo zrównoleglone,
- pola są AoS,
- demag robi ciężki ruch pamięci,

to FSAL jest tylko lokalnym zyskiem na wierzchu znacznie głębszych problemów.

### Wniosek
FSAL należy zachować, ale nie wolno traktować go jako remedium na CPU HPC.

---

## 4.3.2. Brak polityki allocatora, huge pages i wyrównania buforów

W publicznym kodzie nie ma jeszcze kompletnej polityki:
- wyrównania 64/128 B,
- huge pages,
- allocatorów pod duże, długożyjące bufory,
- explicit numa interleave / bind.

Przy rozmiarach padded FFT to ma znaczenie praktyczne.

### Wniosek
To jest późniejszy etap, ale dla multi-socket CPU jest istotny.

---

## 4.3.3. Brak rozdzielenia “physics buffer graph” od “presentation / artifact graph”

Dziś część ścieżek obserwacji i zapisu danych jest dość blisko solvera.  
Profesjonalny HPC solver powinien mieć:

- minimalny graf buforów potrzebny do kroku,
- osobny graf diagnostyki / artefaktów,
- osobny plan snapshotów,
- możliwość całkowitego wyłączenia kosztownych observables.

To jeszcze nie jest wszędzie konsekwentnie domknięte.

---

# 4.4. FDM CPU — ryzyka fizyczne przy optymalizacji

To jest jedna z najważniejszych sekcji raportu.

## 4.4.1. Nie wolno zmieniać semantyki exchange przez optymalizację pamięci
Zmiana AoS→SoA jest bezpieczna, jeśli:
- operator jest ten sam,
- kolejność sąsiadów jest ta sama,
- BC i active mask są te same,
- energia liczy tę samą dyskretyzację.

## 4.4.2. Demag FFT wolno przyspieszyć, ale nie wolno zmienić operatora
Można:
- zmienić bibliotekę FFT,
- rozproszyć FFT,
- zmienić layout buforów,
- scalić pack/unpack.

Nie wolno bez jawnej decyzji fizycznej:
- zmienić tensorów Newella,
- zmienić padding semantics,
- zmienić interpretacji aktywnych / nieaktywnych komórek.

## 4.4.3. Reproducibility musi być jawnie zdefiniowane
Po przejściu do:
- wielowątkowości,
- MPI,
- innego FFT backendu,

bitwise parity może zniknąć.  
To jest akceptowalne, ale trzeba zdefiniować:
- tolerancje,
- normy porównawcze,
- stabilność energii,
- stabilność dynamiki.

## 4.4.4. Boundary correction / sub-cell to osobny temat
CPU FDM nie może „w ramach optymalizacji” nagle zmienić fizyki krawędzi.  
Jeżeli pojawia się sub-cell / cut-cell / boundary correction, to jest to osobny feature physics/discretization, nie optymalizacja HPC.

---

# 4.5. FDM CPU — co najpewniej tłumaczy niskie użycie CPU

Jeżeli dziś widzisz ok. 50% jednego CPU albo niski ogólny usage, to najbardziej prawdopodobna kombinacja przyczyn jest taka:

1. Dominujący kawałek obliczeń siedzi w `fft3_core()`, który nie skaluje jak prawdziwy threaded FFT.
2. Reszta pracy jest mieszanką:
   - pamięciożernych alokacji,
   - zero-fill,
   - pack/unpack,
   - lekkich lokalnych pętli.
3. Część pętli jest równoległa przez Rayon, ale **nie ta część, która najbardziej dominuje runtime**.
4. Jeżeli problem jest mały, koszty runnera, observables i artefaktów mogą dodatkowo rozmywać profil.

To bardzo dobrze zgadza się z obserwacją „solver nie obciąża CPU jak należy”.

---

## 5. FEM CPU — audyt diagnostyczny

# 5.1. Co w FEM już jest wartościowe

FEM ma dziś kilka bardzo dobrych elementów architektury:

1. jawna `MeshTopology`,
2. rozdzielenie operatorów:
   - exchange,
   - demag,
   - boundary mass,
3. wsparcie dla różnych integratorów w CPU reference,
4. istnienie native MFEM bridge jako docelowego kierunku,
5. sensowna świadomość, że docelowy stos to:
   - MFEM,
   - libCEED,
   - hypre.

Czyli problem FEM nie polega na braku wizji.  
Polega na tym, że obecny publiczny executable path nadal jest **bootstrap / reference**, a nie solver HPC.

---

# 5.2. FEM CPU — główne bottlenecki

## 5.2.1. Bottleneck FEM-A — CPU reference jest alokacyjny na każdym kroku

`FemLlgProblem::step()` wywołuje:
- `heun_step`,
- `rk4_step`,
- `rk23_step`,
- `rk45_step`,
- `abm3_step`,

ale te ścieżki nie mają odpowiednika `step_with_buffers()` znanego z FDM.

### Co to oznacza
Każdy krok tworzy wiele:
- `Vec<Vector3>` dla stanów pośrednich,
- `Vec<Vector3>` dla RHS,
- `Vec<Vector3>` dla delta,
- `Vec<f64>` dla składowych skalarowych,
- oraz dodatkowych buforów solverów.

To bardzo zły wzorzec dla CPU HPC.

### Ocena
**Priorytet: P0.**

---

## 5.2.2. Bottleneck FEM-B — assembly CSR przez `HashMap` / COO nie jest klasą HPC

`CsrMatrix::from_tet_assembly()` akumuluje przez `HashMap<(usize,usize), f64>`.

To jest:
- czytelne,
- poprawne,
- dobre na reference path,

ale słabe dla dużych siatek.

### Dlaczego
- słaba lokalność pamięci,
- narzut hashowania,
- alokacje,
- słaby scaling,
- trudne wektoryzowanie,
- brak deterministycznego, taniego pattern build.

Docelowo w FEM HPC potrzebujesz:
- precomputed sparsity pattern,
- assembly do istniejących slotów CSR,
- ewentualnie matrix-free / partial assembly.

### Ocena
**Priorytet: P0 dla dużych meshy.**

---

## 5.2.3. Bottleneck FEM-C — `spmv()` jest serialne

W `crates/fullmag-engine/src/fem.rs` `CsrMatrix::spmv()` jest zwykłą sekwencyjną pętlą po wierszach.

Dla CPU HPC to jest fundamentalnie niewystarczające.

### Dlaczego
W FEM większość kosztu w operatorach liniowych sprowadza się do:
- SpMV,
- preconditioner apply,
- Krylov updates,
- vector ops.

Jeśli sam SpMV nie jest:
- threaded,
- cache-aware,
- ewentualnie NUMA-aware,
- albo zastąpiony matrix-free/PA,

to solver nie może się dobrze skalować.

### Ocena
**Priorytet: P0.**

---

## 5.2.4. Bottleneck FEM-D — `solve_sparse_cg()` jest prostym, serialnym Jacobi-CG

Demag Poisson/Robin w CPU reference korzysta z prostego CG z diagonalnym preconditionerem.

### Problemy
- serialny,
- słaby preconditioner,
- świeże alokacje,
- brak reuse,
- brak operator-level tuning,
- brak rozproszenia MPI.

### Co to oznacza
Na dużych problemach demag FEM nie będzie ani szybkie, ani dobrze skalowalne.

### Ocena
**Priorytet: P0.**

---

## 5.2.5. Bottleneck FEM-E — exchange field wykonuje 3 osobne SpMV po składowych

Exchange w FEM:
1. rozbija magnetyzację na `mx`, `my`, `mz`,
2. wykonuje 3× `csr.spmv(...)`,
3. dzieli przez lumped mass.

### Problem
To jest poprawne semantycznie, ale kosztowne:
- alokujesz `mx`, `my`, `mz`,
- uruchamiasz trzy osobne SpMV,
- robisz dodatkowe przejścia po pamięci.

W solverze HPC powinno się dążyć do:
- lepszego layoutu stanu,
- blokowego operatora,
- lub przynajmniej reużywalnych buforów skalarowych.

### Ocena
**Priorytet: P1.**

---

## 5.2.6. Bottleneck FEM-F — transfer-grid demag jest kosztowny i fizycznie pośredni

To jedno z najbardziej newralgicznych miejsc całego repo.

### Co się dzieje
CPU FEM może liczyć demag dwiema drogami:
1. `robin_demag_observables_from_vectors()` — solve Poisson/Robin,
2. `transfer_grid_demag_observables_from_vectors()` — rasteryzacja FEM → FDM grid → FFT demag → sampling z powrotem.

### Problem wydajnościowy
Transfer-grid wymaga:
- wygenerowania transfer gridu,
- rasteryzacji tetrahedrów,
- utworzenia aktywnej maski i pól na gridzie,
- uruchomienia FDM demag,
- próbkowania z powrotem na węzły.

To jest ciężkie obliczeniowo nawet zanim policzysz właściwy demag.

### Problem fizyczny
To nie jest ta sama semantyka co „czysty FEM demag”.  
To jest aproksymacja pośrednia, dobra jako bootstrap / parity tool / wygodny fallback, ale nie powinna być docelowym produkcyjnym solve’em dla HPC FEM.

### Ocena
**Priorytet: P0 fizycznie i wydajnościowo.**

---

## 5.2.7. Bottleneck FEM-G — rasteryzacja tetra → transfer grid jest bardzo droga

`rasterize_magnetization_to_transfer_grid()`:
- bierze bounding box tetra,
- iteruje po wszystkich potencjalnie pokrywanych komórkach gridu,
- dla każdego środka komórki liczy barycentric coordinates,
- akumuluje średnią.

To jest klasyczny koszt typu:
- dużo branchy,
- dużo geometrii,
- dużo słabej lokalności,
- potencjalnie bardzo zły scaling przy cienkich / skomplikowanych meshach.

### Dodatkowa uwaga fizyczna
Obecna rasteryzacja jest kompromisem implementacyjnym.  
Nie jest to pełnoprawny, najlepiej uwarunkowany operator projekcji FEM→grid.

### Ocena
**Priorytet: P0, jeśli transfer-grid zostaje w obiegu.**

---

## 5.2.8. Bottleneck FEM-H — CPU reference ignoruje periodic node pairs

To nie jest tylko problem fizyki. To także problem architektury.

`fem_reference.rs` jawnie zaznacza, że `periodic_node_pairs` i `periodic_boundary_pairs` są ignorowane, a CPU reference używa naturalnych BC.

### Skutek
- brak parity z planem, jeśli użytkownik oczekuje PBC,
- brak parity z docelowym solverem,
- ryzyko błędnej walidacji,
- trudność w używaniu CPU reference jako złotego standardu dla HPC refaktoryzacji.

### Ocena
**Priorytet: P0 fizycznie.**

---

## 5.2.9. Bottleneck FEM-I — CPU reference nie obsługuje wielu interakcji

CPU reference FEM odrzuca m.in.:
- uniaxial anisotropy,
- cubic anisotropy,
- `dind_field`,
- `dbulk_field`,
- Zhang-Li STT,
- Slonczewski STT,
- magnetoelastic.

### Co to oznacza dla HPC
Nie da się budować poważnej strategii CPU HPC, jeśli główny CPU path:
- nie pokrywa docelowej fizyki,
- nie może być podstawą testów parity,
- a część features żyje wyłącznie w innej ścieżce.

### Wniosek
Najpierw trzeba ustalić, czy:
- CPU reference ma zostać doprowadzony do sensownego coverage,
- czy ma pozostać tylko gold/reference slice,
- a produkcyjny CPU FEM ma być natywnym MFEM backendem.

Bez tej decyzji optymalizacja będzie chaotyczna.

### Ocena
**Priorytet: P0 projektowy.**

---

## 5.2.10. Bottleneck FEM-J — native MFEM backend używa `AssemblyLevel::LEGACY`

To jest bardzo ważne.

W `mfem_bridge.cpp` exchange i mass form są budowane przez:
- `DiffusionIntegrator`,
- `MassIntegrator`,
- przy `AssemblyLevel::LEGACY`.

### Dlaczego to boli
Docelowy FEM HPC kierunek, także według własnej dokumentacji Fullmaga, to:
- MFEM,
- libCEED,
- partial assembly / matrix-free,
- hypre tam, gdzie potrzebny globalny solve.

`LEGACY` oznacza, że krytyczne operatory są nadal traktowane bardziej „klasycznie”, z kosztami pamięci i apply dalekimi od maksimum możliwości MFEM.

### Uwaga
Komentarz w kodzie mówi, że to świadomy kompromis stabilnościowy wobec obecnych problemów ścieżki PA na tetrahedral H1.  
To jest rozsądne jako etap przejściowy.  
Nie może być jednak końcem drogi, jeśli celem jest CPU/GPU/HPC production solver.

### Ocena
**Priorytet: P1/P0 architektonicznie.**

---

## 5.2.11. Bottleneck FEM-K — consistent-mass projection robi osobny CG per component

`apply_exchange_component(...)` w native MFEM bridge:

- jeśli `use_consistent_mass == true`,
- uruchamia `CGSolver` na mass form dla każdej składowej osobno.

### Skutek
Na każdą ocenę exchange field można mieć:
- dodatkowe solve’y CG,
- host access do `Ms`,
- i osobne ścieżki projekcji.

To może być ekstremalnie drogie.

### Ocena
**Priorytet: P1, a przy pewnych ustawieniach P0.**

---

## 5.2.12. Bottleneck FEM-L — host/device read/write w native bridge

W `mfem_bridge.cpp` widać wiele:
- `HostRead()`,
- `HostWrite()`,
- `HostReadWrite()`.

Na GPU to oczywiście grozi synchronizacją.  
Na CPU też jest to sygnał, że przepływ danych jest zbudowany bardziej wokół wygody i bezpieczeństwa niż wokół maksymalnej przepustowości.

### Dla CPU HPC
To oznacza, że nawet native MFEM path nie jest jeszcze rygorystycznie zaprojektowany pod:
- minimalizację kopiowań,
- znikanie buforów pośrednich,
- pipeline operator application bez wyjść na host loops.

### Ocena
**Priorytet: P1.**

---

## 5.2.13. Bottleneck FEM-M — Hypre path jest nadal de facto single-process

W `mfem_bridge.cpp` ścieżka Hypre dla Poissona:
- inicjalizuje MPI, jeśli trzeba,
- ale buduje `row_starts = {0, glob_size}`,
- czyli działa de facto jako pojedynczy partycjonowany blok.

To nie jest prawdziwa rozproszona dekompozycja wielu ranków na jedną symulację.

### Wniosek
Hypre jest obecne jako technologia, ale nie jako w pełni wykorzystany distributed-memory solve dla Fullmaga.

### Ocena
**Priorytet: P0 na poziomie HPC roadmapy.**

---

## 5.2.14. Bottleneck FEM-N — rozszczepienie Rust reference vs MFEM native utrudnia tuning

Dziś przy problemie FEM CPU istnieje pokusa:
- trochę poprawić `fem.rs`,
- trochę poprawić `mfem_bridge.cpp`,
- trochę poprawić `native_fem.rs`,
- trochę poprawić dispatch.

To może dać dużo pracy i mało efektu, jeśli nie ustali się jednego autorytatywnego toru produkcyjnego.

### Diagnoza
To jest bottleneck organizacyjno-architektoniczny, nie tylko kodowy.

---

# 5.3. FEM CPU — gdzie dokładnie ucieka czas

## 5.3.1. Assembly
- `HashMap` / COO accumulation,
- budowa CSR,
- boundary mass,
- magnetic subset operators.

## 5.3.2. Exchange field
- ekstrakcja komponentów,
- 3× SpMV,
- podział przez masę.

## 5.3.3. Demag
- solve Poisson CG, albo
- rasteryzacja + FDM demag + sampling.

## 5.3.4. Integrator
- wielokrotne RHS,
- klony stanów pośrednich,
- brak workspace reuse.

## 5.3.5. Observables
- osobne pola, energie, normy.

W praktyce najbardziej podejrzane hotspoty to:
1. transfer-grid rasterization,
2. sparse linear solves,
3. SpMV,
4. alokacje kroków integratora.

---

# 5.4. FEM CPU — ryzyka fizyczne przy optymalizacji

## 5.4.1. Nie wolno mieszać optymalizacji operatora z jego zmianą
Jeśli przechodzisz:
- z assembled do partial assembly,
- z lumped mass do consistent mass,
- z transfer-grid do Poisson,
- z Rust reference do MFEM native,

to nie jest to tylko „tuning”.  
To może zmieniać numerykę, a nawet obserwowalną fizykę.

## 5.4.2. Periodic BC trzeba dopiąć przed nazywaniem CPU reference solverem wzorcowym
Dopóki FEM CPU reference ignoruje periodic pairs, nie może być pełnoprawnym punktem odniesienia dla parity.

## 5.4.3. Demag realization musi być jawnie rozstrzygnięty
Nie może być tak, że:
- jedna ścieżka walidacyjna używa transfer-grid,
- druga Poisson/Robin,
- a porównania są traktowane jak „ten sam solver”.

To są różne realizacje i trzeba je uczciwie oznaczać.

---

## 6. Rozjazd fizyki FDM vs FEM — tabela diagnostyczna

| Obszar | FDM CPU reference | FEM CPU reference | Native FEM / MFEM | Ryzyko |
|---|---|---|---|---|
| Exchange | aktywny, 6-point Cartesian stencil | aktywny, FE stiffness + lumped mass | aktywny, MFEM forms | średnie |
| Demag | FFT/Newell na gridzie | transfer-grid lub prosty Poisson/Robin | transfer-grid / Poisson bridge | wysokie |
| Zeeman | aktywny | aktywny | aktywny | niskie |
| Uniaxial anisotropy | obecna w CPU FDM | odrzucana | częściowo/natywnie zależnie od ścieżki | wysokie |
| Cubic anisotropy | obecna w CPU FDM | odrzucana | wspierana bardziej po stronie native | wysokie |
| Interfacial DMI | obecne w CPU FDM | aktywne w CPU FEM | zależne od backendu | średnie |
| Bulk DMI | obecne w CPU FDM | aktywne w CPU FEM | zależne od backendu | średnie |
| Thermal noise | obecne w CPU FDM | brak / odrzucane | ograniczone | wysokie |
| STT / SOT | FDM CPU ma sporo terminów | FEM CPU reference odrzuca | native FEM nie domyka STT | wysokie |
| Magnetoelastic | FDM CPU ma prescribed-strain term | FEM CPU reference odrzuca | native FEM ma więcej scaffoldu | wysokie |
| Periodic BC | FDM ma własną semantykę gridową | FEM CPU reference ignoruje periodic pairs | native zależne od implementacji | bardzo wysokie |
| Single precision | FDM CUDA istnieje, CPU reference nie | CPU FEM reference nie | native FEM double-only | średnie |
| ABM3 | FDM CPU ma | FEM CPU ma w Rust reference | native FEM nie | średnie |
| Boundary correction / sub-cell | niepubliczne / drafty | n/a | n/a | średnie |

### Wniosek
Nie istnieje jeszcze w repo pełna sytuacja:
- „FDM i FEM mają to samo coverage,
- tę samą semantykę,
- tę samą dojrzałość,
- i różnią się tylko wydajnością”.

To jest fundamentalne dla planu HPC.

---

## 7. Rzeczywista gotowość do HPC z 1000 węzłami CPU

# 7.1. Co dziś jest realne

### Realne już teraz
- 1000 niezależnych zadań na 1000 węzłach,
- duże kampanie parametrów,
- optymalizacje wielouruchomieniowe,
- porównania FDM/FEM,
- automatyczna eksploracja.

### Nierealne dziś jako jedna symulacja
- jedna duża FDM symulacja na 1000 węzłach,
- jedna duża FEM symulacja na 1000 węzłach,
- scaling strong-scaling jednej instancji przez MPI.

---

# 7.2. Czego brakuje FDM, żeby wejść w prawdziwe HPC

1. **distributed-memory decomposition** siatki,
2. **distributed FFT** 3D,
3. poprawnego przepływu ghost/halo dla lokalnych wkładów,
4. rank-local layout / pinned memory / affinity,
5. wspólnego planu komunikacji dla:
   - FFT transpose,
   - redukcji globalnych,
   - checkpointów,
   - observables,
6. rozproszonego restartu / sesji / artefaktów,
7. benchmarków scalingu:
   - weak,
   - strong,
   - per-socket,
   - per-rank.

---

# 7.3. Czego brakuje FEM, żeby wejść w prawdziwe HPC

1. jednego autorytatywnego backendu CPU produkcyjnego,
2. `ParMesh` / `ParFiniteElementSpace`,
3. `ParBilinearForm` / `HypreParMatrix`,
4. rozproszonego solvera demag,
5. rozproszonego exchange/operator apply,
6. dopiętego BC / periodic / interface semantics,
7. matrix-free / partial assembly tam, gdzie to korzystne,
8. sensownego I/O i checkpointingu rozproszonego.

---

## 8. Diagnoza klas problemów

# 8.1. Problemy, które są „łatwymi” optymalizacjami
To są rzeczy, które można poprawić bez wywracania architektury:

- pełne buffer reuse w FDM,
- SoA w FDM,
- redukcja alokacji w FEM stepperach,
- throttling artefaktów,
- profilery i telemetry,
- deterministic RNG,
- thread affinity / allocator policy.

# 8.2. Problemy, które są „średnimi” refaktorami
- threaded SpMV,
- sensowny sparse assembly,
- refaktoryzacja transfer-grid,
- FDM fused field accumulation,
- native CPU path decisions.

# 8.3. Problemy, które są „dużymi” zmianami architektury
- distributed FFT w FDM,
- ParMesh / HypreParMatrix w FEM,
- pełne MPI solve jednej symulacji,
- zjednoczenie autorytatywnej ścieżki CPU FEM,
- production-grade native CPU FDM backend.

---

## 9. Jak należy mierzyć postęp — wymagane benchmarki i profile

Ten punkt jest krytyczny, bo bez tego łatwo optymalizować „na ślepo”.

# 9.1. Benchmarki FDM
1. `64^3`, `128^3`, `256^3`, `512^3`
2. exchange only
3. exchange + demag
4. Heun, RK4, RK45
5. z i bez thermal
6. single-socket vs dual-socket
7. 1, 2, 4, 8, 16, 32, 64 wątków

### Mierzyć
- wall time / step,
- RHS / s,
- GB/s pamięci,
- procent czasu w FFT,
- alokacje / krok,
- LLC misses,
- NUMA remote traffic.

# 9.2. Benchmarki FEM
1. mały mesh referencyjny,
2. średni mesh produkcyjny,
3. duży mesh saturujący pamięć noda,
4. exchange only,
5. exchange + demag,
6. Poisson vs transfer-grid,
7. reference Rust vs native MFEM CPU.

### Mierzyć
- wall time / RHS,
- wall time / step,
- assembly time,
- SpMV throughput,
- iteracje CG/GMRES,
- koszt rasteryzacji,
- koszt field projection,
- memory footprint.

# 9.3. Benchmarki parity fizycznej
- energia całkowita,
- `H_ex`, `H_demag`, `H_eff`,
- trajektorie relaksacji,
- stan końcowy po relaksacji,
- częstotliwości modów,
- zachowanie przy zmianie liczby wątków / ranków.

---

## 10. Lista priorytetów diagnostycznych

### P0 — rzeczy absolutnie krytyczne
1. FDM: serialny / nie-HPC FFT pipeline
2. FDM: brak distributed-memory solve
3. FDM: AoS + niepełny buffer reuse
4. FEM: brak decyzji o autorytatywnym CPU backendzie
5. FEM: serialne SpMV + Jacobi-CG
6. FEM: transfer-grid demag jako kosztowna i pośrednia realizacja
7. FEM: ignorowanie periodic BC w CPU reference
8. FEM: brak MPI-distributed solve jednej symulacji

### P1 — rzeczy bardzo ważne
1. FDM: fused field assembly
2. FDM: NUMA / allocator / affinity
3. FDM: RNG pod reproducibility HPC
4. FEM: consistent vs lumped mass strategy
5. FEM: `LEGACY` assembly vs PA/matrix-free
6. FEM: redukcja host/device copies
7. FEM: usunięcie kosztownych alokacji w stepperach

### P2 — rzeczy ważne, ale późniejsze
1. artifact pipeline overhead
2. live preview overhead
3. dodatkowe output fields
4. polish build/runtime ergonomics

---

## 11. Konkluzja końcowa

### 11.1. FDM
Jeśli celem jest **pełna optymalizacja CPU i użycie pełnej mocy RAM/CPU**, to w FDM nie wystarczy „dokleić więcej Rayon”.  
Trzeba:
- przebudować layout danych,
- usunąć alokacje z RHS,
- wymienić / przeprojektować FFT path,
- a docelowo zbudować distributed FFT i dekompozycję MPI.

### 11.2. FEM
Jeśli celem jest produkcyjny **FEM CPU solver dla HPC**, to nie warto inwestować bez końca w prosty Rust reference jako docelowy engine.  
On jest świetny jako:
- referencja fizyczna,
- narrow executable slice,
- walidator.

Ale produkcyjna ścieżka HPC powinna finalnie żyć wokół:
- MFEM,
- hypre,
- rozproszonej algebry,
- oraz jawnie ustalonego authority path.

### 11.3. Odpowiedź na Twoje pytanie wprost
Tak — w aktualnym kodzie są bardzo poważne bottlenecki i one **w pełni tłumaczą**, dlaczego Fullmag nie używa dziś CPU tak, jak powinien.  
Najważniejsze jest jednak to, że część z nich to **nie mikrobugi**, tylko brakujące elementy architektury HPC.

---

## 12. Krótka mapa: co jest problemem wydajności, a co problemem architektury

| Problem | Typ |
|---|---|
| Serialny `fft3_core()` | wydajność + architektura |
| AoS w FDM | wydajność |
| Alokacje w FDM RHS | wydajność |
| Alokacje w FEM integratorach | wydajność |
| Serialne FEM SpMV / CG | wydajność + architektura |
| Transfer-grid rasterization | wydajność + fizyka |
| Ignorowanie periodic BC w FEM CPU | fizyka |
| Brak native CPU FDM | architektura |
| Rozszczepienie Rust FEM / MFEM FEM | architektura |
| Brak MPI-distributed single solve | architektura HPC |

---

## 13. Zalecenie meta-przed wdrożeniem

Największym błędem byłoby teraz:
- równoległe „łatanie wszystkiego po trochu”,
- bez ustalenia autorytatywnej ścieżki CPU,
- bez benchmarków,
- bez parity suite.

Dlatego następny dokument powinien być już **ściśle etapowym planem wdrożenia** z rozdziałem:
- FDM,
- FEM,
- wspólne testy fizyczne,
- wspólna telemetria i packaging pod klaster.



---

## 14. Appendix — krótkie fragmenty kodu potwierdzające diagnozę

### 14.1. FDM CPU to dziś głównie Rust reference engine

`crates/fullmag-runner/Cargo.toml`:

```toml
[dependencies]
fullmag-engine = { path = "../fullmag-engine", features = ["parallel"] }
```

`native/backends/fdm/CMakeLists.txt`:

```cmake
set(FDM_SOURCES src/api.cpp src/error.cpp)
if(FULLMAG_ENABLE_CUDA)
  list(APPEND FDM_SOURCES
    src/context.cu
    src/exchange_fp64.cu
    src/demag_fp64.cu
    ...
  )
endif()
```

Interpretacja: publiczny native backend FDM zawiera realny solver tylko dla CUDA; CPU ścieżka wykonawcza idzie przez `fullmag-engine`.

### 14.2. Buffer reuse FDM jest jeszcze niepełne

`crates/fullmag-engine/src/lib.rs`:

```rust
fn llg_rhs_into_ws(
    &self,
    magnetization: &[Vector3],
    ws: &mut FftWorkspace,
    out: &mut [Vector3],
) {
    let rhs = self.llg_rhs_from_vectors_ws(magnetization, ws);
    out[..rhs.len()].copy_from_slice(&rhs);
}
```

To nadal alokuje pośredni `rhs`.

### 14.3. Effective field FDM nadal tworzy wiele pełnych wektorów

```rust
let exchange_field = if self.terms.exchange {
    self.exchange_field_from_vectors(magnetization)
} else {
    zero_vectors(self.grid.cell_count())
};
let demag_field = if self.terms.demag {
    self.demag_field_from_vectors_ws(magnetization, ws)
} else {
    zero_vectors(self.grid.cell_count())
};
let external_field = self.external_field_vectors();
let mel_field = self.magnetoelastic_field(magnetization);
let ani_field = self.anisotropy_field(magnetization);
let idmi_field = self.interfacial_dmi_field(magnetization);
let bdmi_field = self.bulk_dmi_field(magnetization);
```

To jest bardzo czytelne, ale pamięciowo drogie.

### 14.4. Rdzeń FFT jest ręcznie złożony i serialny w krytycznych miejscach

```rust
for z in 0..nz {
    for x in 0..nx {
        for y in 0..ny {
            line_y[y] = data[padded_index(nx, ny, x, y, z)];
        }
        fft_y.process(line_y);
        for y in 0..ny {
            data[padded_index(nx, ny, x, y, z)] = line_y[y];
        }
    }
}
```

Analogicznie dla osi Z.

### 14.5. FEM CPU reference ma serialne SpMV

`crates/fullmag-engine/src/fem.rs`:

```rust
pub fn spmv(&self, x: &[f64]) -> Vec<f64> {
    let mut y = vec![0.0; self.n];
    for row in 0..self.n {
        let start = self.row_ptr[row];
        let end = self.row_ptr[row + 1];
        let mut sum = 0.0;
        for idx in start..end {
            sum += self.values[idx] * x[self.col_idx[idx]];
        }
        y[row] = sum;
    }
    y
}
```

### 14.6. FEM CPU reference ma prosty Jacobi-CG

```rust
let diag = matrix.diagonal();
let inv_diag: Vec<f64> = diag.iter().map(|&d| ... ).collect();
let mut x = vec![0.0; n];
let mut r: Vec<f64> = rhs.to_vec();
...
for _iter in 0..max_iter {
    let ap = matrix.spmv(&p);
    ...
}
```

### 14.7. FEM CPU reference jawnie ignoruje periodic node pairs

`crates/fullmag-runner/src/fem_reference.rs`:

```rust
// periodic_node_pairs / periodic_boundary_pairs ... do NOT imply the solver
// should enforce periodic BCs. The CPU reference engine uses Neumann
// (natural) BC only, so we simply ignore the pairs.
```

### 14.8. FEM CPU reference jawnie odrzuca część fizyki

```rust
if plan.material.uniaxial_anisotropy.is_some() { unsupported_terms.push("uniaxial_anisotropy"); }
if plan.material.cubic_anisotropy_kc1.is_some() { unsupported_terms.push("cubic_anisotropy"); }
if plan.magnetoelastic.is_some() { unsupported_terms.push("magnetoelastic"); }
```

### 14.9. Native MFEM bridge nadal używa `LEGACY`

`native/backends/fem/src/mfem_bridge.cpp`:

```cpp
exchange_form->SetAssemblyLevel(mfem::AssemblyLevel::LEGACY);
exchange_form->AddDomainIntegrator(new mfem::DiffusionIntegrator(*a_coeff), magnetic_attr_marker);
...
mass_form->SetAssemblyLevel(mfem::AssemblyLevel::LEGACY);
mass_form->AddDomainIntegrator(new mfem::MassIntegrator(), magnetic_attr_marker);
```

### 14.10. Consistent-mass exchange w native bridge robi CG solve per component

```cpp
if (use_consistent_mass) {
    mfem::CGSolver cg_solver;
    cg_solver.SetOperator(mass_form);
    h_component = 0.0;
    cg_solver.Mult(tmp, h_component);
}
```

### 14.11. Hypre path jest na razie zainicjalizowane w trybie single-process semantics

```cpp
HYPRE_BigInt row_starts[2] = {0, glob_size};
auto *A_par = new mfem::HypreParMatrix(MPI_COMM_WORLD, glob_size, row_starts, A_bc);
```

To nie jest jeszcze właściwy, wielorankowy rozkład jednej symulacji.

