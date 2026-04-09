
# Fullmag CPU / HPC Optimization — raport wdrożeniowy
**Repozytorium:** `MateuszZelent/fullmag`  
**Zakres:** pełny plan dojścia do produkcyjnej optymalizacji CPU dla FDM i FEM  
**Data opracowania:** 2026-04-09  
**Dokument powiązany:** `fullmag_cpu_hpc_diagnostic_audit.md`

---

## 0. Cel dokumentu

Ten dokument nie opisuje już „co jest źle”, tylko:

1. **jak dojść** od obecnego stanu do solvera CPU zdolnego wykorzystywać nowoczesne serwery i klastry,
2. **w jakiej kolejności** wykonywać zmiany,
3. **które zmiany są lokalne**, a które wymagają nowej architektury,
4. **jak zabezpieczyć fizykę** przy agresywnej optymalizacji,
5. **jak rozdzielić ścieżkę FDM i FEM**, aby nie mieszać ich problemów,
6. **jak zbudować realną drogę do HPC**, zamiast tylko „szybszego jednego rdzenia”.

Ten plan jest celowo bardzo szczegółowy.  
Zakłada, że chcesz dojść nie do „troszkę szybszego Fullmaga”, tylko do **pełnoprawnego solvera CPU/HPC klasy produkcyjnej**.

---

## 1. Założenia strategiczne

## 1.1. Zasada nr 1 — fizyka ma pierwszeństwo przed tuningiem

Każdy etap musi zachować jasne rozróżnienie między:
- **optymalizacją implementacji**, a
- **zmianą modelu / dyskretyzacji / warunków brzegowych**.

W praktyce:
- AoS → SoA jest optymalizacją,
- threaded FFT jest optymalizacją,
- distributed FFT jest zmianą architektury wykonania,
- zmiana transfer-grid na Poisson w FEM demag to **nie** jest czysty tuning — to zmiana realizacji fizyki operatora.

## 1.2. Zasada nr 2 — jeden autorytatywny tor produkcyjny na metodę

Docelowo projekt powinien mieć:

### Dla FDM
- **jeden autorytatywny tor CPU/HPC**,
- CPU reference może pozostać jako golden/reference slice,
- ale produkcyjny CPU path musi być jasno nazwany i osobno benchmarkowany.

### Dla FEM
- trzeba zdecydować:
  - albo rozwijasz Rust CPU reference do dużo większej dojrzałości,
  - albo formalnie uznajesz, że docelowy CPU/HPC FEM = **MFEM-native**, a Rust path pozostaje referencją.

Bez tej decyzji optymalizacja FEM będzie błądzeniem.

## 1.3. Zasada nr 3 — najpierw single-node excellence, potem multi-node

Nie wolno iść od razu do MPI, jeśli na jednym node:
- dane są źle ułożone,
- RHS alokuje pamięć,
- operator jest seryjny,
- brak NUMA policy.

Kolejność musi być:
1. usuń alokacje,
2. popraw layout,
3. doprowadź single-node scaling,
4. dopiero potem rozproszony solve.

## 1.4. Zasada nr 4 — każdy etap kończy się gate’em akceptacyjnym

Każda faza musi mieć:
- testy wydajności,
- testy fizyczne,
- warunki przejścia dalej,
- oraz warunki rollbacku.

---

## 2. Definicja celu końcowego

## 2.1. Docelowy FDM CPU/HPC

Po zakończeniu programu optymalizacji FDM powinien mieć:

1. **zero alokacji w hot loop RHS**,  
2. główny stan magnetyzacji i pól w **SoA**,  
3. FFT backend:
   - threaded na single node,
   - NUMA-aware na multi-socket,
   - docelowo distributed na MPI,
4. lokalne operatory:
   - exchange,
   - anisotropy,
   - DMI,
   - thermal,
   - fused in-place tam, gdzie warto,
5. deterministyczną politykę RNG dla trybów termicznych,
6. rozdzielony, skalowalny mechanizm:
   - artifacts,
   - preview,
   - diagnostics,
7. możliwość strong scaling dla jednej symulacji,
8. możliwość weak scaling dla dużych siatek.

## 2.2. Docelowy FEM CPU/HPC

Po zakończeniu programu optymalizacji FEM powinien mieć:

1. jeden **autorytatywny CPU backend produkcyjny**,  
2. brak kosztownych alokacji w integratorach,
3. operatorowy rdzeń oparty na:
   - parallel sparse apply,
   - lub partial assembly / matrix-free,
4. demag oparty na jasno wybranej realizacji produkcyjnej,
5. pełne, zgodne BC / periodic / interface semantics,
6. rozproszony mesh/operator solve na MPI,
7. spójne pokrycie fizyki względem backendów publicznych,
8. walidację parity FDM↔FEM w obszarach wspólnych.

---

## 3. Mapa programu prac

Cały program dzielę na pięć pasów prac:

1. **Pas A — wspólna infrastruktura wydajności i walidacji**
2. **Pas B — FDM single-node refactor**
3. **Pas C — FEM single-node refactor**
4. **Pas D — przejście do distributed-memory HPC**
5. **Pas E — stabilizacja produkcyjna, packaging i operacje klastrowe**

Każdy pas zawiera etapy.  
Łącznie: **16 etapów głównych**.

---

# PAS A — wspólna infrastruktura wydajności i walidacji

## Etap A0 — ustalenie oficjalnych metryk i benchmarków
**Cel:** zanim zaczniemy optymalizować, trzeba ustalić, jak mierzyć postęp.

### Zakres
- utworzyć zestaw benchmarków:
  - FDM: `64^3`, `128^3`, `256^3`, `512^3`,
  - FEM: small / medium / large meshes,
- osobno benchmarki:
  - exchange-only,
  - exchange+demag,
  - relax,
  - time integration,
- osobno benchmarki:
  - single-socket,
  - dual-socket,
  - multi-node.

### Mierniki obowiązkowe
- wall time / step,
- wall time / RHS,
- alloc count / step,
- bytes moved / step (szacunek),
- FFT fraction,
- SpMV fraction,
- solver iterations,
- CPU utilization,
- memory RSS,
- NUMA remote traffic,
- energy drift / parity metrics.

### Zmiany w repo
- dodać benchmark harness:
  - `crates/fullmag-bench` lub `benches/`,
- dodać perf output JSON,
- dodać profile tags w runnerach.

### Akceptacja
Etap zamknięty dopiero wtedy, gdy każdy kolejny patch można porównać automatycznie do baseline’u.

---

## Etap A1 — wspólna telemetria solverów
**Cel:** mieć identyczną widoczność hotspotów dla FDM i FEM.

### Co wprowadzić
Wspólne znaczniki czasu i liczniki dla:
- `field.exchange`,
- `field.demag`,
- `field.anisotropy`,
- `field.dmi`,
- `rhs.total`,
- `fft.pack`,
- `fft.forward`,
- `fft.multiply`,
- `fft.inverse`,
- `fft.unpack`,
- `fem.assembly`,
- `fem.spmv`,
- `fem.cg`,
- `fem.transfer_grid.rasterize`,
- `artifact.export`,
- `preview.render`.

### Wymóg
Telemetria musi umieć działać:
- bez kosztu lub minimalnym kosztem w buildzie produkcyjnym,
- szczegółowo w trybie benchmark.

### Zmiany
- `fullmag-engine`: lightweight timers,
- `fullmag-runner`: provenance + perf snapshot,
- opcjonalnie `tracing`/`profiling` feature flag.

### Akceptacja
Każdy solver zwraca rozbicie czasu na co najmniej:
- operator local,
- operator nonlocal,
- integrator,
- outputs.

---

## Etap A2 — wspólny „physics guardrail suite”
**Cel:** każda optymalizacja ma być natychmiast walidowana fizycznie.

### Zestaw testów
#### FDM
- uniform magnetization → `H_ex = 0`,
- uniform sphere/ellipsoid demag average,
- RK45 / Heun parity w granicach tolerancji,
- relax monotonicity.

#### FEM
- unit tet / coarse box exchange,
- Poisson demag sanity,
- transfer-grid vs Poisson sanity,
- periodic BC tests po ich wdrożeniu.

#### Cross-method
- proste pudełko: FDM vs FEM na tym samym materiale,
- thin film strip: relaksacja,
- disk/ellipse: demag tensor averages.

### Akceptacja
Bez automatycznego physics suite nie wolno przechodzić do dużych refaktorów danych.

---

# PAS B — FDM single-node refactor

## Etap B1 — pełne usunięcie alokacji z RHS FDM
**Cel:** `step_with_buffers()` ma stać się **rzeczywiście bezalokacyjne** w hot loop.

### Problem obecny
Dziś:
- `llg_rhs_into_ws()` nadal alokuje pośrednio,
- `effective_field_from_vectors_ws()` buduje wiele pełnych `Vec<Vector3>`.

### Docelowy model
Wprowadzić jawny workspace FDM:

```rust
pub struct CpuFdmWorkspace {
    pub m: VectorFieldSoA,
    pub h_eff: VectorFieldSoA,
    pub h_ex: VectorFieldSoA,
    pub h_demag: VectorFieldSoA,
    pub h_tmp: VectorFieldSoA,
    pub rhs: VectorFieldSoA,
    pub stage: VectorFieldSoA,
    pub delta: VectorFieldSoA,
    pub scalar_tmp_0: Vec<f64>,
    pub scalar_tmp_1: Vec<f64>,
}
```

### Nowe API
```rust
fn effective_field_into(
    &self,
    m: &VectorFieldSoA,
    fft: &mut FftWorkspace,
    ws: &mut CpuFdmWorkspace,
    out: &mut VectorFieldSoA,
);

fn llg_rhs_into(
    &self,
    m: &VectorFieldSoA,
    fft: &mut FftWorkspace,
    ws: &mut CpuFdmWorkspace,
    out: &mut VectorFieldSoA,
);
```

### Kroki implementacyjne
1. rozdzielić API `*_from_vectors_*` od `*_into_*`,
2. przenieść buforowanie pól cząstkowych do workspace,
3. usunąć wszystkie `Vec::collect()` z RHS i field assembly,
4. dodać liczniki alokacji w benchmarkach.

### Pliki
- `crates/fullmag-engine/src/lib.rs`
- ewentualnie nowy `crates/fullmag-engine/src/fdm_workspace.rs`

### Ryzyko fizyczne
Niskie, jeśli:
- zachowasz kolejność obliczeń,
- nie zmienisz operatorów.

### Kryterium akceptacji
- `allocs / accepted step == 0` w hot loop dla Heun/RK4/RK23/RK45/ABM3 (poza ew. logami i artefaktami),
- wyniki fizyczne w tolerancji.

---

## Etap B2 — przejście FDM na SoA jako główny layout
**Cel:** usunąć AoS z krytycznej ścieżki solvera.

### Obecny stan
`VectorFieldSoA` już istnieje, ale nie jest layoutem dominującym.

### Docelowy model
- stan solvera FDM wewnętrznie trzymany jako SoA,
- AoS tylko:
  - na wejściu/wyjściu publicznym,
  - w warstwie artefaktów,
  - przy kompatybilności z UI/API.

### Strategia
1. dodać wewnętrzny typ stanu:
```rust
pub struct ExchangeLlgStateSoA {
    mx: Vec<f64>,
    my: Vec<f64>,
    mz: Vec<f64>,
    time_seconds: f64,
    ...
}
```
2. zapewnić tani adapter AoS↔SoA,
3. przenieść integratory i operatory na SoA,
4. zachować stare AoS API przejściowo jako wrapper.

### Zysk
- lepsza auto-wektoryzacja,
- łatwiejszy pack FFT,
- łatwiejszy thermal noise,
- lepsza lokalność i alignment.

### Ryzyko
Średnie implementacyjnie, niskie fizycznie.

### Kryterium akceptacji
- brak regresji fizyki,
- odczuwalny wzrost wydajności exchange i field combine,
- uproszczenie demag pack/unpack.

---

## Etap B3 — rozdzielenie „physics accumulation” od „observables accumulation”
**Cel:** nie liczyć i nie przechowywać wszystkiego zawsze.

### Problem
Dziś część kosztów pola i observables jest sprzężona.

### Zmiana
Wprowadzić politykę ewaluacji:
```rust
pub struct EvaluationRequest {
    pub need_exchange_field: bool,
    pub need_demag_field: bool,
    pub need_total_energy: bool,
    pub need_max_rhs: bool,
    pub need_preview_field: bool,
}
```

### Zasada
Integratory potrzebują innego zestawu danych niż:
- UI preview,
- field snapshot,
- scalar artifacts.

### Efekt
- mniej ruchu pamięci,
- mniejszy narzut dla benchmarków produkcyjnych,
- łatwiejsze skalowanie.

---

## Etap B4 — wymiana FDM FFT backendu na architekturę produkcyjną
**Cel:** usunąć ręcznie sklejony serialny rdzeń FFT jako główny bottleneck.

### Nie wystarczy
- zostawić `rustfft` i tylko „dodać więcej Rayon”.

### Docelowe rozwiązanie
Stworzyć abstrakcję backendu FFT:

```rust
pub trait FdmFftBackend {
    fn convolve_demag(
        &mut self,
        m: &VectorFieldSoA,
        kernel: &DemagKernelSpectra,
        out_h: &mut VectorFieldSoA,
    );
}
```

### Etapy backendów
1. `RustFftBackend` — utrzymanie kompatybilności / testów,
2. `ThreadedNodeBackend` — FFTW / MKL / pocketfft-batched / inny mocny CPU backend,
3. `DistributedMpiBackend` — przyszły heFFTe / FFTW-MPI / podobny.

### Ważna decyzja
Nie kodować silnika HPC na stałe do jednego FFT backendu.  
Zrobić warstwę abstrakcji i dopiero pod nią:
- plan cache,
- layout,
- rank-local buffers.

### Ryzyko fizyczne
Niskie przy zachowaniu tego samego operatora.

### Kryterium akceptacji
- pojedynczy node: wyraźny skok wydajności w demag,
- profile pokazują spadek udziału czasu w `fft3_core` do zera, bo przestaje istnieć jako rdzeń wykonania.

---

## Etap B5 — NUMA, pinning, allocator, alignment dla FDM
**Cel:** ustabilizować wydajność na serwerach multi-socket.

### Co wprowadzić
- jawny wybór liczby wątków,
- pinning do rdzeni,
- polityka first-touch,
- opcjonalny interleave/bind,
- wyrównane alokacje,
- opcjonalne huge pages dla gigantycznych buforów.

### Gdzie
- runtime config,
- solver session,
- backend FFT,
- bench harness.

### Wymóg
To nie może być „ręczna magia administratora klastra”.  
Fullmag powinien umieć przynajmniej:
- nie psuć locality,
- raportować, jak został uruchomiony.

### Kryterium akceptacji
Na dual-socket node:
- mały rozrzut wyników wydajności,
- brak drastycznego pogorszenia przy wzroście liczby wątków.

---

## Etap B6 — FDM local terms fusion + SIMD cleanup
**Cel:** po SoA i no-allocation uprościć operatory lokalne.

### Kandydaci
- external field add,
- anisotropy,
- DMI,
- thermal,
- normalization,
- rhs combine.

### Zasada
Fuse tylko te rzeczy, które:
- i tak przechodzą po tych samych danych,
- nie utrudniają diagnostyki,
- nie zacierają semantyki fizycznej.

### Nie łączyć na siłę
Demag i exchange mają własne naturalne granice.  
Chodzi o:
- warstwę buforów,
- kolejność przejść po pamięci,
- lepszą wektoryzację.

### Kryterium akceptacji
Mniejsza liczba pełnych przejść po wektorach `mx/my/mz`.

---

## Etap B7 — RNG i reproducibility policy dla thermal FDM
**Cel:** przygotować solver na wątki i MPI bez utraty kontroli nad powtarzalnością.

### Wprowadzić
- counter-based RNG albo deterministyczny splittable RNG,
- seed policy:
  - `global_seed`,
  - `rank_id`,
  - `thread_chunk_id`,
  - `step_index`,
  - `cell_index`.

### Docelowa własność
Wynik powinien być:
- reprodukowalny dla zadanej konfiguracji decomposition,
- a opcjonalnie także stabilny przy zmianie liczby wątków (jeśli wybierzesz counter-based mapping po komórce i kroku).

### Kryterium akceptacji
- testy statistical sanity,
- zgodność z teorią Brown field variance,
- brak regresji wydajności większej niż uzasadniona fizyką.

---

## Etap B8 — FDM multi-socket scaling na jednym node
**Cel:** zanim wejdziesz w MPI, osiągnąć sensowny scaling na pojedynczym dużym serwerze.

### Zakres
- profilowanie 1→2→4→8→16→32→64 wątków,
- analiza:
  - speedup,
  - efficiency,
  - memory bandwidth,
  - NUMA traffic.

### Kryterium
Nie przechodzić do multi-node, dopóki:
- local operators nie skalują sensownie,
- demag node-local nie jest maksymalnie dopracowany.

---

## Etap B9 — distributed FDM: dekompozycja domeny i halo exchange
**Cel:** wejść w prawdziwe HPC dla jednej symulacji FDM.

### Minimalny model
- podział domeny na slab/pencil,
- lokalny exchange z halo,
- lokalne field terms bez globalnej komunikacji,
- globalna komunikacja tylko tam, gdzie trzeba.

### Potrzebne komponenty
1. `DistributedGridShape`
2. `RankLocalSubdomain`
3. `HaloBuffers`
4. `GlobalReductionService`
5. `DistributedCheckpointMetadata`

### Uwaga
Exchange jest tu łatwiejszy niż demag.  
Można wdrażać etapami:
1. local-only operators na MPI,
2. później distributed FFT dla demag.

### Kryterium akceptacji
Działający exchange-only FDM na wielu rankach.

---

## Etap B10 — distributed FDM demag (MPI FFT)
**Cel:** umożliwić jedną dużą symulację FDM na wielu node’ach.

### Zalecana architektura
- wydzielić demag do osobnego backendu distributed FFT,
- nie próbować ręcznie rozwijać złożonego all-to-all transpose od zera, jeśli można oprzeć się o dojrzałą bibliotekę.

### Opcje technologiczne
Rozważyć backendy pokroju:
- heFFTe,
- FFTW MPI,
- inne dojrzałe distributed FFT.

### Warunki wyboru
- dojrzałość MPI,
- C/C++ integration,
- wsparcie dla CPU,
- plan caching,
- kontrola layoutu danych,
- możliwość późniejszej wspólnej polityki CPU/GPU.

### Kryterium akceptacji
- weak scaling na wielu node’ach,
- strong scaling dla dużych siatek,
- brak fizycznej regresji względem single-node solve.

---

# PAS C — FEM single-node refactor

## Etap C1 — decyzja o autorytatywnej ścieżce CPU FEM
**Cel:** zatrzymać rozmycie odpowiedzialności.

### Decyzja do podjęcia
Masz dwie sensowne opcje:

#### Opcja 1 — Rust CPU reference pozostaje referencją, produkcja = MFEM/native
To jest moja rekomendacja.

**Dlaczego:**
- MFEM/hypre to naturalny świat dla HPC FEM,
- CPU reference pozostaje świetnym narzędziem walidacyjnym,
- nie mnożysz docelowych backendów.

#### Opcja 2 — inwestujesz mocno w Rust CPU FEM jako produkcyjny solver
Możliwe, ale moim zdaniem mniej sensowne strategicznie, bo i tak docelowo będziesz potrzebował:
- distributed mesh,
- rozproszonej algebry,
- dojrzałych preconditionerów.

### Moja rekomendacja
Formalnie ogłosić:
- **Rust FEM = reference / validation backend**,
- **MFEM-native = production CPU/GPU FEM backend**.

### Kryterium akceptacji
Ta decyzja musi być wpisana:
- do README,
- do capability matrix,
- do dispatch semantics.

---

## Etap C2 — doprowadzenie Rust FEM reference do roli prawdziwej referencji
**Cel:** jeśli Rust FEM ma być referencją, musi być fizycznie wiarygodna.

### Trzeba zrobić
1. domknąć periodic BC semantics albo jawnie je wyłączyć i oznaczyć,
2. dopiąć brakujące interakcje w takim zakresie, w jakim reference ma ich pilnować,
3. usunąć ciche dziury semantyczne.

### Nie chodzi o wydajność
To etap fizyczny i semantyczny.

### Kryterium akceptacji
Rust FEM można bez wstydu używać jako:
- baseline walidacji,
- solver testowy,
- golden backend dla regression tests.

---

## Etap C3 — workspace’owy integrator FEM bez alokacji
**Cel:** usunąć alokacyjny hot loop z `FemLlgProblem::step()`.

### Nowy typ
```rust
pub struct FemIntegratorWorkspace {
    pub m0: Vec<Vector3>,
    pub m_stage: Vec<Vector3>,
    pub k: [Vec<Vector3>; 7],
    pub delta: Vec<Vector3>,
    pub mx: Vec<f64>,
    pub my: Vec<f64>,
    pub mz: Vec<f64>,
    pub tmp0: Vec<f64>,
    pub tmp1: Vec<f64>,
    pub tmp2: Vec<f64>,
}
```

### Nowe API
```rust
fn step_with_workspace(
    &self,
    state: &mut FemLlgState,
    dt: f64,
    ws: &mut FemIntegratorWorkspace,
) -> Result<StepReport>;
```

### Korzyść
- spadek alokacji,
- mniejsza presja GC/allocatorów,
- prostsze profilowanie operatorów.

### Kryterium akceptacji
Hot loop FEM reference bez alokacji tymczasowych.

---

## Etap C4 — przeróbka CPU reference FEM algebra core
**Cel:** reference FEM ma przestać być z definicji wolny z powodu oczywistych konstrukcji.

### Zakres
- zastąpić `HashMap` assembly precomputed patternem,
- przygotować CSR raz,
- wypełniać wartości w istniejący pattern,
- równoleglić assembly po elementach z bezpiecznym accumulation strategy.

### Możliwe strategie
1. element coloring,
2. thread-local COO + merge,
3. fixed sparsity slots.

### Kryterium akceptacji
Znaczny spadek czasu budowy operatorów i pamięci tymczasowej.

---

## Etap C5 — threaded SpMV i lepsze solvery w CPU reference
**Cel:** reference FEM ma być przynajmniej sensownym benchmarkiem operatorowym.

### Minimalny upgrade
- parallel row-wise SpMV,
- fused vector ops,
- CG z reuse buforów,
- lepsze preconditionery niż goły Jacobi tam, gdzie to uzasadnione.

### Uwaga strategiczna
Nie ma sensu budować w Rust reference wielkiego zoo solverów, jeśli produkcja ma iść przez MFEM/hypre.  
Ale warto doprowadzić reference do poziomu:
- „nie absurdalnie wolny”,
- „dobry do walidacji”.

### Kryterium akceptacji
SpMV i CG nie dominują w benchmarkach z powodu oczywistych braków implementacyjnych.

---

## Etap C6 — decyzja o docelowej realizacji FEM demag
**Cel:** skończyć z rozmytym statusem transfer-grid.

### Zalecana polityka
#### Produkcja:
- **Poisson / open-boundary solve** jako autorytatywna realizacja FEM demag.

#### Transfer-grid:
- zachować jako:
  - bootstrap,
  - sanity mode,
  - porównania,
  - ewentualnie szybki preview.

### Dlaczego
Transfer-grid:
- jest ciężki,
- jest pośredni,
- nie powinien być jedyną drogą produkcyjną dla FEM HPC.

### Kryterium akceptacji
Dokumentacja i runtime jednoznacznie rozróżniają:
- production demag,
- bootstrap demag,
- preview demag.

---

## Etap C7 — jeśli transfer-grid zostaje, trzeba go radykalnie poprawić
**Cel:** nie mieć kosztownego wąskiego gardła w narzędziu pomocniczym.

### Co poprawić
1. precomputed tet-to-grid overlap maps,
2. lepszy operator projekcji niż point-in-cell average,
3. buforowanie struktur transferu,
4. równoległość po elementach / blokach,
5. możliwość incremental reuse, jeśli grid nie zmienia się.

### Warunek
Tylko jeśli transfer-grid ma dalej pełnić istotną rolę.  
Jeśli produkcja przechodzi całkowicie na Poisson + MFEM, nie warto przeinwestować.

---

## Etap C8 — native FEM: przejście z `LEGACY` do sensownej ścieżki CPU/HPC
**Cel:** native MFEM backend ma zacząć wyglądać jak docelowy solver, nie tylko bootstrap.

### Strategia
1. ustabilizować assembled path,
2. wprowadzać partial assembly / matrix-free tam, gdzie operator i FE przestrzeń na to pozwalają,
3. nie robić skoku „wszystko od razu”.

### Ważne
Komentarz w kodzie pokazuje, że `LEGACY` jest dziś kompromisem wobec niestabilności pewnej ścieżki PA.  
Trzeba więc:
- odtworzyć minimalny przypadek, gdzie PA się wywraca,
- naprawić go,
- i dopiero potem przełączać klasy operatorów.

### Kryterium akceptacji
Na wspieranych konfiguracjach operator apply nie jest już ograniczony do pełnej assembled legacy path.

---

## Etap C9 — native FEM: ograniczenie host/device and host/native copies
**Cel:** uprościć przepływ danych i przygotować CPU/GPU backend do wspólnego wzorca.

### Co zrobić
- audyt wszystkich `HostRead/Write`,
- rozdzielić:
  - data ownership,
  - view,
  - transfer boundaries,
- scalić powtarzalne pętle składowych,
- unikać kopiowania tam, gdzie MFEM może pracować bezpośrednio na danych.

### Dla CPU
To też ma sens, bo mniej kopiowań = mniej bandwidth pressure.

---

## Etap C10 — native FEM CPU production path
**Cel:** formalnie uruchomić i benchmarkować MFEM-native jako **CPU production backend**, nie tylko „GPU scaffold”.

### Co to oznacza
- osobny benchmark matrix,
- osobna provenance nazwa,
- jawny dispatch policy dla CPU-native FEM,
- możliwość wyboru:
  - `fem_cpu_reference`,
  - `fem_cpu_native`,
  - `fem_gpu_native`.

### Dlaczego to ważne
Bez tego nie zobaczysz realnego postępu.  
Wszystko będzie się dalej zlewać pod etykietą „FEM”.

---

# PAS D — distributed-memory HPC

## Etap D1 — wspólna warstwa uruchomieniowa HPC
**Cel:** Fullmag ma umieć uruchomić jedną symulację jako solver rozproszony.

### Potrzebne pojęcia
- `world_size`,
- `rank`,
- `local_partition`,
- `global reductions`,
- `distributed checkpoint`,
- `distributed artifacts`.

### Nie chodzi tylko o MPI_Init
Chodzi o pełną semantykę:
- ownership danych,
- wznowienie,
- provenance,
- mapping rank↔subdomain.

---

## Etap D2 — FDM distributed path
**Cel:** udostępnić prawdziwy single-simulation MPI FDM.

### Kolejność
1. exchange-only distributed,
2. local fields distributed,
3. global reductions,
4. distributed FFT demag,
5. full LLG on MPI.

### Akceptacja
- weak scaling,
- strong scaling,
- parity względem single-node solve.

---

## Etap D3 — FEM distributed path
**Cel:** udostępnić prawdziwy single-simulation MPI FEM.

### Docelowy stos
- `ParMesh`,
- `ParFiniteElementSpace`,
- `ParBilinearForm`,
- `HypreParMatrix`,
- `HypreBoomerAMG` / odpowiednie preconditionery,
- true distributed demag.

### Ważna decyzja
Na tym etapie produkcyjnym authority backend powinien już być jednoznacznie:
- MFEM-native.

---

## Etap D4 — distributed I/O, checkpointing i restart
**Cel:** klaster musi umieć:
- zapisać stan,
- wznowić,
- nie dławić filesystemu.

### Wymagania
- rank-local shards albo wspólny format równoległy,
- metadane globalne,
- zgodność z projektowanym systemem sesji / `.fms` / recovery.

### Uwaga
Nie robić „dump everything from rank 0”.

---

# PAS E — stabilizacja produkcyjna i operacje klastrowe

## Etap E1 — packaging buildów HPC
**Cel:** mieć powtarzalne, profesjonalne buildy CPU/HPC.

### Potrzebne profile
1. `fullmag-cpu-reference`
2. `fullmag-fdm-cpu-hpc`
3. `fullmag-fem-cpu-native`
4. `fullmag-fem-gpu-native`
5. `fullmag-mpi`

### Build matrix
- Rust toolchain,
- CMake,
- MFEM,
- hypre,
- libCEED,
- MPI,
- FFT backend,
- opcjonalne BLAS/LAPACK/MKL/FFTW.

### Forma
- container runtime,
- modulefiles,
- lockowane toolchainy.

---

## Etap E2 — scheduler integration
**Cel:** bezproblemowe uruchamianie na klastrze.

### Co potrzebne
- `srun` / `mpirun` templates,
- polityka CPU binding,
- polityka env vars:
  - liczba wątków,
  - rank/thread pinning,
  - affinity,
  - device selection (gdy dotyczy),
- provenance w artefaktach.

### Wymóg
Użytkownik nie może sam zgadywać połowy konfiguracji performance-critical.

---

## Etap E3 — production acceptance matrix
**Cel:** wiedzieć, kiedy projekt uznać za „gotowy produkcyjnie”.

### FDM CPU/HPC
- zero hot-loop allocations,
- SoA internal state,
- threaded FFT backend,
- multi-socket scaling,
- MPI distributed solve,
- benchmark suite green,
- parity suite green.

### FEM CPU/HPC
- autorytatywny backend CPU production,
- distributed mesh/operator path,
- produkcyjny demag,
- periodic BC semantics,
- parity suite green,
- profile wydajności stabilne.

---

## 4. Szczegółowy plan zmian plik-po-pliku

# 4.1. FDM — minimalny rdzeń zmian

## `crates/fullmag-engine/src/lib.rs`
### Zmiany
- wydzielić `fdm_workspace`,
- wprowadzić API `*_into_*`,
- przepisać integratory na SoA lub warstwę adaptacyjną,
- zlikwidować alokacje w:
  - `effective_field_from_vectors_ws`,
  - `llg_rhs_from_vectors_ws`,
  - `llg_rhs_full_ws`.

### Docelowe moduły
- `fdm_state.rs`
- `fdm_workspace.rs`
- `fdm_integrators.rs`
- `fdm_fields.rs`
- `fdm_demag.rs`

## `crates/fullmag-fdm-demag`
### Zmiany
- oddzielić matematykę kernela od backendu FFT,
- dodać backend traits,
- przygotować CPU threaded backend i MPI backend.

## `crates/fullmag-runner/src/cpu_reference.rs`
### Zmiany
- używać nowego `SolverSession`/workspace API,
- wyłączyć kosztowne observables, gdy nie są potrzebne,
- rozszerzyć perf provenance.

---

# 4.2. FEM — minimalny rdzeń zmian

## `crates/fullmag-engine/src/fem.rs`
### Zmiany
- `step_with_workspace`,
- parallel/spare-alloc operator apply,
- wyczyszczenie transfer-grid path,
- przygotowanie lepszych hooks dla demag realizations.

## `crates/fullmag-engine/src/fem_sparse.rs`
### Zmiany
- albo awansować ten moduł do realnego użytku,
- albo usunąć dublowanie i zjednoczyć algebrę rzadką.

## `crates/fullmag-runner/src/fem_reference.rs`
### Zmiany
- jawne role reference backendu,
- brak cichych luk semantycznych,
- rozdzielne benchmarki.

## `crates/fullmag-runner/src/native_fem.rs`
### Zmiany
- wprowadzić `FemEngine::NativeCpu` lub podobny wariant,
- rozszerzyć dispatch o autorytatywny CPU native path,
- dopiąć capability checks.

## `native/backends/fem/src/mfem_bridge.cpp`
### Zmiany
- etapowe odchodzenie od `LEGACY`,
- lepsza ścieżka projection / mass handling,
- przygotowanie rzeczywistego MPI path,
- redukcja host read/write,
- lepsza integracja z hypre/ParMatrix.

---

## 5. Szczegółowe acceptance criteria dla każdego pasa

# 5.1. Pas A — infrastruktura
- benchmark suite istnieje,
- telemetry JSON działa,
- physics suite działa w CI,
- wyniki baseline zapisane.

# 5.2. Pas B — FDM single-node
- zero hot-loop allocations,
- SoA internal state,
- FFT backend wymieniony,
- scaling na node poprawiony.

# 5.3. Pas C — FEM single-node
- wybrany authority backend,
- reference backend nie ma semantycznych dziur krytycznych,
- native backend ma sensowną ścieżkę CPU,
- demag policy jest jasna.

# 5.4. Pas D — distributed
- FDM MPI działa exchange-only, potem full demag,
- FEM MPI działa na ParMesh/ParCSR,
- checkpoint/restart działa rozproszenie.

# 5.5. Pas E — produkcja
- packaging i scheduler integration gotowe,
- acceptance matrix green,
- dokumentacja użytkowa i developerska spójna.

---

## 6. Rekomendowana kolejność realizacji w czasie

## Faza I — natychmiast
1. A0 benchmarki
2. A1 telemetria
3. A2 physics suite
4. B1 usunięcie alokacji z FDM RHS
5. B2 SoA w FDM
6. C1 decyzja o authority backend FEM
7. C3 workspace w FEM integratorach

## Faza II — krótkoterminowo
8. B4 nowy FFT backend node-local
9. B5 NUMA/affinity/alignment
10. C4 lepsze assembly FEM
11. C5 threaded SpMV / lepszy CG
12. C6 decyzja o produkcyjnym demag FEM
13. C10 native FEM CPU production path

## Faza III — średni termin
14. B8 single-node scaling FDM
15. C8 odejście od `LEGACY` gdzie możliwe
16. C9 cleanup host/device & copies
17. D1 wspólna warstwa HPC runtime

## Faza IV — duży rozwój
18. B9 distributed FDM local operators
19. B10 distributed FDM demag
20. D3 distributed FEM
21. D4 distributed checkpointing
22. E1/E2/E3 produkcja klastrowa

---

## 7. Plan minimalizacji ryzyka

## 7.1. Ryzyko: utrata parity fizycznej
**Mitigacja:**
- physics suite,
- golden references,
- energy checks,
- incremental rollout.

## 7.2. Ryzyko: za duże rozproszenie prac
**Mitigacja:**
- najpierw decyzja C1,
- osobne tracki FDM i FEM,
- wspólne tylko benchmarki i validation.

## 7.3. Ryzyko: przeinwestowanie w Rust FEM reference
**Mitigacja:**
- formalnie ograniczyć rolę reference backendu,
- nie budować w nim pełnej klasy solvera produkcyjnego, jeśli docelowo i tak idziesz w MFEM/hypre.

## 7.4. Ryzyko: zbyt wczesne wejście w MPI
**Mitigacja:**
- najpierw single-node excellence,
- dopiero potem distributed path.

---

## 8. Konkretne decyzje projektowe, które rekomenduję od razu

### Decyzja 1
**FDM production CPU path** należy budować jako osobny, świadomy backend architektury HPC, a nie jako „przy okazji trochę szybszy reference Rust engine”.

### Decyzja 2
**FEM production CPU path** powinien finalnie opierać się na **native MFEM/hypre**, a nie na prostym Rust reference.

### Decyzja 3
Transfer-grid demag w FEM należy traktować jako:
- bootstrap / preview / parity aid,
- nie jako ostateczny produkcyjny demag dla HPC.

### Decyzja 4
Wszelkie działania HPC muszą być podporządkowane jednej tabeli parity fizycznej FDM↔FEM.

### Decyzja 5
HPC dla jednej symulacji wymaga jawnego wejścia w:
- MPI,
- dekompozycję domeny,
- distributed operators,
- distributed checkpoint/restart.

Bez tego Fullmag będzie świetny do kampanii wielu zadań, ale nie do jednej ultra-dużej symulacji.

---

## 9. Wzorce implementacyjne, które warto przyjąć

# 9.1. Wzorzec: „session + immutable problem + mutable workspace”
Dla obu metod.

```rust
pub struct SolverSession<P, S, W> {
    problem: P,
    state: S,
    workspace: W,
}
```

Zalety:
- wszystkie bufory żyją długo,
- łatwy checkpoint,
- łatwy benchmark,
- łatwe pinning/NUMA policy.

# 9.2. Wzorzec: „operator apply in-place”
Unikać API zwracających nowe `Vec` w hot loop.

# 9.3. Wzorzec: „authoritative backend + validation backend”
Szczególnie ważne dla FEM.

# 9.4. Wzorzec: „separate physics graph from output graph”
Solver nie może dźwigać kosztów GUI/preview, jeśli benchmarkujemy HPC.

---

## 10. Co bym zrobił jako pierwszy commit po tym raporcie

Jeśli miałbym wybrać **jedną pierwszą serię commitów**, zrobiłbym:

1. dodać benchmark harness i telemetry,
2. w FDM:
   - napisać `CpuFdmWorkspace`,
   - usunąć alokacje z `llg_rhs_into_ws`,
   - wprowadzić `effective_field_into`,
3. w FEM:
   - napisać `FemIntegratorWorkspace`,
   - dodać `step_with_workspace`,
4. formalnie w dokumentacji i dispatch:
   - nazwać Rust FEM reference backend referencyjnym,
   - przygotować grunt pod `native CPU FEM`.

To da od razu:
- lepszą wydajność,
- lepszy pomiar,
- mniej chaosu architektonicznego.

---

## 11. Czego nie robić

### Nie robić 1
Nie zaczynać od przypadkowych mikrooptymalizacji w losowych pętlach.

### Nie robić 2
Nie mieszać równolegle:
- refaktoru fizyki,
- refaktoru layoutu,
- refaktoru MPI,
- bez testów parity.

### Nie robić 3
Nie inwestować ogromu pracy w transfer-grid FEM jako jedyną przyszłość.

### Nie robić 4
Nie traktować obecnego niskiego CPU utilization jako „pewnie tylko wątki źle ustawione”.
To jest znacznie głębszy problem niż ustawienie `RAYON_NUM_THREADS`.

### Nie robić 5
Nie nazywać obecnego HPC mode „obsługą 1000 węzłów” dla jednej symulacji.  
Dziś to byłoby mylące.

---

## 12. Definicja sukcesu końcowego

Projekt można uznać za zakończony sukcesem, jeśli:

### FDM
- jedna duża symulacja skaluje się na wielu socketach i wielu node’ach,
- demag nie jest już serialnym wąskim gardłem,
- hot loop nie alokuje,
- wyniki fizyczne pozostają stabilne.

### FEM
- istnieje jeden produkcyjny backend CPU/HPC,
- demag jest produkcyjnie zdefiniowany,
- periodic/interfejsy są dopięte,
- distributed solve działa,
- CPU reference pełni czystą rolę referencji, a nie pół-produktu.

### Produktowo
- użytkownik może uruchomić:
  - mały test lokalnie,
  - średni solve na jednym node,
  - duży solve na klastrze,
- bez zmiany semantyki modelu i bez ukrytych fallbacków fizycznych.

---

## 13. Ostateczna rekomendacja

Mój rekomendowany wektor rozwoju jest następujący:

### FDM
1. no-allocation hot loop,
2. SoA,
3. FFT backend,
4. NUMA,
5. MPI/distributed FFT.

### FEM
1. decyzja authority backend,
2. workspace + cleanup reference,
3. native CPU FEM jako produkcja,
4. production demag,
5. ParMesh / hypre / distributed solve.

### Wspólnie
1. benchmarki,
2. physics suite,
3. checkpoint/restart,
4. packaging pod klaster.

To jest droga ambitna, ale realna.  
I co najważniejsze: jest zgodna z obecną strukturą Fullmaga, a nie przeciw niej.

---

## 14. Krótka checklista startowa dla zespołu

### Tydzień 1–2
- [ ] benchmark harness
- [ ] telemetry
- [ ] physics suite baseline
- [ ] decyzja: authority backend FEM

### Tydzień 3–6
- [ ] FDM workspace no-allocation
- [ ] FDM SoA
- [ ] FEM workspace no-allocation
- [ ] dokumentacja dispatch / backend roles

### Miesiąc 2–3
- [ ] node-local FFT backend
- [ ] FEM assembly/SpMV improvements
- [ ] native FEM CPU path benchmarked
- [ ] demag FEM policy locked

### Miesiąc 4+
- [ ] MPI FDM local operators
- [ ] MPI FDM demag
- [ ] MPI FEM production path
- [ ] distributed checkpointing

---

## 15. Podsumowanie w jednym akapicie

Jeżeli celem jest naprawdę „pełna optymalizacja solvera CPU”, to Fullmag potrzebuje dwóch równoległych, ale jasno rozdzielonych programów:  
**FDM** musi przejść z referencyjnego Rust engine’u do bezalokacyjnego, SoA, threaded, a następnie distributed FFT solvera;  
**FEM** musi przestać być rozszczepione między prosty reference i półdocelowy native path, a dojść do jednego autorytatywnego backendu MFEM/hypre z produkcyjną realizacją demag i rozproszonym meshem/operatorem.  
Dopiero wtedy 1000-węzłowy klaster CPU zacznie mieć sens dla jednej dużej symulacji, a nie tylko dla kampanii wielu zadań.



---

## 16. Appendix — tabela etapów, zależności i ryzyka

| Etap | Zależności | Dominujący efekt | Ryzyko fizyczne | Ryzyko implementacyjne |
|---|---|---|---|---|
| A0 benchmarki | brak | widoczność postępu | niskie | niskie |
| A1 telemetria | A0 | rozdział hotspotów | niskie | niskie |
| A2 physics suite | A0 | bezpieczna refaktoryzacja | niskie | średnie |
| B1 no-allocation FDM | A0–A2 | spadek narzutu pamięci | niskie | średnie |
| B2 SoA FDM | B1 | SIMD / locality / demag prep | niskie | wysokie |
| B4 FFT backend FDM | B1/B2 | największy skok runtime | niskie | wysokie |
| B5 NUMA/pinning | B4 | stabilność multi-socket | zerowe | średnie |
| B9 MPI FDM local | B4/B5 | wejście w distributed | niskie | wysokie |
| B10 MPI FDM demag | B9 | prawdziwy HPC FDM | niskie | bardzo wysokie |
| C1 authority backend FEM | A0–A2 | koniec chaosu arch. | zerowe | średnie organizacyjnie |
| C2 cleanup reference FEM | C1 | reference parity | średnie | średnie |
| C3 no-allocation FEM | C1 | tańszy hot loop | niskie | średnie |
| C4 assembly FEM | C1/C3 | lepsza pre-processing path | niskie | wysokie |
| C5 SpMV/solver FEM | C4 | największy zysk CPU ref | niskie | wysokie |
| C6 demag policy FEM | C1 | fizyczna klarowność | wysokie, ale kontrolowalne | średnie |
| C8 native MFEM path | C1/C6 | realna produkcja FEM | średnie | wysokie |
| D1 wspólna warstwa HPC | B5/C8 | wspólny model MPI | niskie | wysokie |
| D3 distributed FEM | C8/D1 | prawdziwy HPC FEM | średnie | bardzo wysokie |
| E1/E2 packaging | po stabilizacji solverów | operacyjność | zerowe | średnie |

---

## 17. Appendix — rekomendowana polityka branchowania prac

Żeby ten program nie rozsypał się organizacyjnie, polecam osobne gałęzie robocze:

### `perf/fdm-noalloc`
- pełne `*_into_*`,
- FDM workspace,
- brak zmian fizycznych.

### `perf/fdm-soa`
- przeniesienie layoutu,
- parity tests obowiązkowe.

### `perf/fdm-fft-backend`
- abstrakcja FFT,
- nowy node-local backend.

### `arch/fem-authority-backend`
- decyzja dokumentacyjna,
- dispatch,
- capability matrix,
- README.

### `perf/fem-noalloc`
- `FemIntegratorWorkspace`,
- bez zmiany fizyki.

### `perf/fem-native-cpu`
- budowa produkcyjnego CPU native path.

### `hpc/mpi-runtime`
- wspólne MPI/session/checkpoint semantics.

### `hpc/fdm-distributed`
- FDM MPI.

### `hpc/fem-distributed`
- FEM MPI.

Taka separacja ogranicza ryzyko, że:
- zmiany layoutu,
- zmiany demag,
- i zmiany MPI
wpadną do jednego ogromnego diffu trudnego do zweryfikowania.

---

## 18. Appendix — przykładowe definicje gotowości

### „FDM CPU production-ready”
- brak alokacji w hot loop,
- SoA aktywne wewnętrznie,
- threaded FFT backend domyślny,
- benchmark `256^3 demag+exchange` skaluje się sensownie na node,
- parity suite green.

### „FDM HPC-ready”
- exchange-only MPI działa,
- pełny demag MPI działa,
- strong scaling wykazany,
- restart/checkpoint działa,
- provenance rozproszone jest poprawne.

### „FEM CPU production-ready”
- native CPU FEM jest jawnie uruchamialny i benchmarkowany,
- reference FEM pełni rolę walidacyjną bez krytycznych dziur semantycznych,
- demag policy jest jednoznaczna,
- BC / periodic semantics nie są mylące.

### „FEM HPC-ready”
- ParMesh/ParCSR/solver distributed działają,
- demag działa rozproszenie,
- benchmarki scalingowe istnieją,
- reference-vs-native parity jest kontrolowana,
- restart/checkpoint i artifacts są kompatybilne z MPI.

