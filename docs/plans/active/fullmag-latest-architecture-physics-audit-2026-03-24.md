# Fullmag — szczegółowy audyt architektury, fizyki, luk implementacyjnych i współbieżności

- Data audytu: 2026-03-24
- Zakres: najnowszy publiczny stan repozytorium `master` + aktywne dokumenty projektowe i fizyczne
- Cel: odpowiedzieć, czy obecny układ jest już naprawdę optymalny, gdzie są rozjazdy między kodem i fizyką, gdzie architektura jest jeszcze za cienka oraz gdzie warto wdrożyć wielowątkowość / współbieżność
- Werdykt skrócony: **nie, układ nie jest jeszcze w pełni optymalny**. Jest już sensownie rozwarstwiony i dużo dojrzalszy niż wcześniejsze wersje, ale nadal ma kilka krytycznych seamów: demag w implementacji nie odpowiada jeszcze docelowemu kontraktowi fizycznemu, CPU reference jest całkowicie jednowątkowy, live runtime ma kilka błędów koncepcyjnych, a część docs/statusów nie nadąża za kodem.

---

## 1. Executive summary

### 1.1 Co działa dobrze

Fullmag ma już sensowny kręgosłup systemowy:

1. **Publiczny Python authoring surface** istnieje i serializuje do typed IR.
2. **Rust jest już realnym control plane**, a nie tylko walidatorem.
3. **Planner i runner są oddzielone**, co jest poprawne architektonicznie.
4. **Rust-hosted CLI** istnieje i potrafi wykonać `fullmag script.py`, biorąc horyzont wykonania ze skryptu.
5. **File-based session shell** istnieje.
6. **FDM CPU reference** działa end-to-end.
7. **Native CUDA FDM** istnieje jako prawdziwa ścieżka wykonawcza, nie tylko placeholder.
8. **Aplikacja ma już zalążek control roomu i API sesyjnego**.
9. **IR ma `StudyIR`**, więc architektura nie jest już zabetonowana wyłącznie pod time evolution.

To nie jest już bootstrap repo bez solvera. To jest działający, choć nadal wąski, produktowy szkielet.

### 1.2 Co jest najpoważniejszym problemem

Największy problem nie leży dziś w Python API ani w samym podziale crate’ów, tylko w **rozjeździe między deklarowaną fizyką docelową a rzeczywistą implementacją operatorów**, przede wszystkim dla demagnetyzacji:

- dokumenty fizyczne i docelowy kontrakt FDM mówią już językiem **cell-averaged demag tensor / Newell-like convolution / dipolar self-interaction**,
- natomiast aktualna implementacja CPU i CUDA realizuje **zero-padded spectral projection** przez rozwiązanie magnetostatyki w przestrzeni Fouriera na polu `M`.

To jest spójne **wewnętrznie** między CPU a CUDA, ale nie jest jeszcze spójne z docelową notacją i z mocniejszym kontraktem fizycznym, który sami już zamroziliście w dokumentacji.

### 1.3 Czy mamy dziś „w pełni optymalny układ”?

Nie.

Mamy układ:

- **dobry jako faza przejściowa**,
- **wystarczająco dobry jako executable baseline**,
- **niewystarczająco dobry jako docelowy foundation layer**.

Najważniejsze powody:

1. CPU reference jest nadal **całkowicie single-threaded**.
2. Demag nie jest jeszcze wdrożony tak, jak opisują nowsze dokumenty fizyczne.
3. `region_mask` i wielomateriałowość istnieją w IR, ale praktycznie nie są jeszcze zrealizowane.
4. FEM shell w IR jest nadal bardzo cienki względem deklarowanego targetu.
5. Live API ma globalny kanał broadcast i nie jest jeszcze naprawdę per-run.
6. CUDA path ma kilka rozwiązań correctness-first, ale nie performance-correctness-balanced.
7. Runner nie klipuje ostatniego kroku do `until`, więc końcowy czas może być przekroczony.
8. Planowanie Box→grid używa `round()`, co może cicho zmieniać zrealizowaną geometrię.
9. Publiczna semantyka `Zeeman(B=...)` nadal miesza się z solverowym `H_ext` w `A/m`.

---

## 2. Metodyka audytu

Audyt został wykonany na podstawie:

- aktualnego publicznego repozytorium GitHub,
- aktualnego README,
- aktualnych plików Rust/Python/CUDA,
- aktywnych dokumentów architektonicznych,
- aktywnych dokumentów fizycznych,
- najnowszych notatek o demag, DMI, lepszych integratorach i relaksacji.

Wnioski są podzielone na cztery klasy:

- **A — poprawne i warte utrzymania**,
- **B — tymczasowo akceptowalne**,
- **C — wymagają korekty przed dalszą rozbudową**,
- **D — krytyczne rozjazdy lub długi, które grożą architektonicznym zatorom**.

---

## 3. Ogólny obraz aktualnej architektury

## 3.1 Co w repo dziś naprawdę istnieje

Po stronie workspace’u mamy realne warstwy:

- `fullmag-cli` — lokalny launcher i shell sesyjny,
- `fullmag-api` — bootstrap session/run API,
- `fullmag-ir` — typed public contract,
- `fullmag-plan` — planner,
- `fullmag-runner` — orchestration + artifacts,
- `fullmag-engine` — CPU reference numerics,
- `fullmag-fdm-sys` — FFI do native CUDA FDM,
- `fullmag-py-core` — PyO3 bridge,
- Python package `fullmag` — authoring surface.

To jest poprawny i zdrowy kierunek. Kręgosłup jest już sensownie rozdzielony.

## 3.2 Co jest dziś publicznie wykonywalne

Z perspektywy kodu i README publiczny executable slice to już nie tylko exchange-only, ale:

- `Box`
- `Exchange`
- `Demag`
- `Zeeman`
- `TimeEvolution(LLG-Heun)`
- `FDM`
- CPU reference `double`
- native CUDA FDM (zależnie od buildu i policy)

To jest ważne, bo część starszych docs nadal opisuje projekt tak, jakby publiczne wykonanie kończyło się na exchange-only.

## 3.3 Co jest wciąż tylko semantyczne albo bardzo cienkie

- `InterfacialDMI` jest nadal semantic-only.
- `BulkDMI` nie istnieje jeszcze w publicznym IR.
- FEM nie ma jeszcze realnego backendu wykonawczego.
- `StudyIR` istnieje, ale ma tylko `TimeEvolution`.
- `FemPlanIR` istnieje, ale jest zbyt cienki jak na docelowy stack MFEM/libCEED/hypre.

---

## 4. Główne plusy architektoniczne

## 4.1 Python → IR → Planner → Runner → Backend to dobry podział

To jest dziś najmocniejszy element projektu.

Nie widzę tu potrzeby przewrotu. Wprost przeciwnie: trzeba to utrzymać i tylko doprecyzować granice odpowiedzialności.

### Dlaczego to jest dobre

- Python opisuje **co** liczyć.
- Rust decyduje **czy wolno** i **jak obniżyć**.
- Runner wykonuje **jeden plan**.
- Backend realizuje **jedną numeryczną politykę**.

To chroni projekt przed typowym chaosem „solver logic leakage”, gdzie publiczny model zaczyna zależeć od siatki, buforów albo kerneli.

## 4.2 Session shell jest dobrym zawiasem aplikacyjnym

CLI tworzy sesję, zapisuje manifesty i live state. To bardzo dobra decyzja.

To oznacza, że frontend i lokalny CLI mogą współdzielić ten sam model runtime zamiast żyć w dwóch światach.

## 4.3 Native CUDA backend jako osobny seam jest poprawny

To, że CUDA nie jest „wklejona” do Rust engine’u, tylko idzie przez osobną warstwę FFI, jest architektonicznie zdrowe.

Daje to:

- wymienialność backendu,
- niezależne debugowanie,
- możliwość przyszłego FEM native stacku bez psucia IR/runnera,
- możliwość kalibracji CPU↔CUDA.

---

## 5. Najpoważniejsze problemy architektoniczne

## 5.1 Krytyczny drift: docs fizyczne vs implementacja demag

### Stan dokumentacyjny

Nowsze notatki fizyczne i foundation docs dla FDM demag/Dipolar interaction opisują docelowy model jako:

- continuum dipolar self-interaction,
- cell-averaged demag tensor,
- Newell-like kernel / tensor convolution,
- FFT jako akcelerator konwolucji, nie jako zastępstwo za jądro fizyczne.

### Stan implementacji

Aktualny CPU engine i native CUDA robią coś innego:

- zero-padding do `2Nx × 2Ny × 2Nz`,
- FFT pola `M`,
- projekcja `H_k = -k (k·M_k) / |k|²`,
- inverse FFT,
- crop back to physical grid.

### Co to oznacza

To nie jest „błąd implementacyjny” w sensie crash/NaN.
To jest **błąd kontraktu**:

- kod i CUDA są zgodne ze sobą,
- ale nie są zgodne z już przyjętym targetem fizycznym docs.

### Dlaczego to jest groźne

Jeśli teraz dołożycie:

- walidację publikacyjną,
- porównania z innymi solverami FDM,
- bardziej subtelne przypadki cienkich warstw,
- heterogeniczne materiały,
- refinements pod demag,

zaczniecie budować dalsze warstwy na operatorze, którego status fizyczny nie jest już semantycznie czysty względem własnej dokumentacji.

### Werdykt

**Kategoria D — trzeba zdecydować teraz**:

1. albo formalnie uznać aktualny spectral projection demag za bootstrap/reference algorithm i przepisać docs tak, żeby to mówiły wprost,
2. albo potraktować obecną implementację jako przejściową i zaplanować twardy upgrade do tensor-convolution demag.

Nie wolno dłużej zostawiać obu wersji naraz jako „domyślnie to samo”.

---

## 5.2 Globalny broadcast channel w API jest zły architektonicznie

`fullmag-api` ma jeden globalny `broadcast::channel<StepUpdate>`.

### Co jest nie tak

To oznacza, że:

- wiele runów współdzieli jeden live stream,
- klient nie subskrybuje konkretnego runu, tylko „wszystko”,
- łatwo o crosstalk między runami,
- jedna wolna grupa klientów może zwiększać pressure na wszystkich,
- to nie skaluje się do wielu sesji.

### Co powinno być zamiast tego

Per-run / per-session live channel registry:

- `HashMap<RunId, broadcast::Sender<StepUpdate>>`
- `/ws/live/:run_id`
- `/v1/sessions/:session_id/events`
- TTL + cleanup po zakończeniu runu

### Werdykt

**Kategoria D**. To nie jest detal. To jest podstawowy runtime seam.

---

## 5.3 CUDA live path nie jest naprawdę live

W ścieżce callbackowej CUDA runner wykonuje run do końca, a potem iteruje po zebranych `steps` i dla wybranych kroków dokleja `final_magnetization`.

### Dlaczego to jest błędne

To oznacza, że:

- live updates nie są live,
- pole `magnetization` dla kroku `n` nie odpowiada stanowi z kroku `n`,
- frontend może pokazywać poprawną krzywą energii i kompletnie błędną magnetyzację,
- session replay i live UI zaczynają mieć inny model rzeczywistości.

### Werdykt

**Kategoria D**. Trzeba albo:

- jawnie oznaczyć CUDA live jako replay-only,
- albo zrobić prawdziwy per-step callback z native backendu.

---

## 5.4 Planner cicho zmienia geometrię Box przez `round()`

Box lowering robi dziś:

- `cells = round(size / cell)`

### Problem

Jeżeli `size` nie jest całkowitą wielokrotnością `cell`, to zrealizowana geometria fizyczna nie jest już równa wejściowej.

To jest bardzo niebezpieczne, bo użytkownik może uważać, że liczy np. 200 nm, a faktycznie backend liczy 198 nm albo 202 nm.

### Poprawne strategie

Jedna z trzech, ale jawna:

1. **strict reject** — jeśli `size / cell` nie jest całkowite w tolerancji,
2. **pad/clip policy** — z jawną informacją w provenance,
3. **store realized box size** w planie i artefaktach.

### Werdykt

**Kategoria C/D**. To musi być jawne, bo dotyczy samej fizycznej definicji problemu.

---

## 5.5 Ostatni krok czasu może przekroczyć `until`

Runner idzie pętlą:

- `while state.time_seconds < until_seconds { step(dt) }`

bez skrócenia ostatniego kroku.

### Skutek

Końcowy czas może być większy niż żądany.

To jest małe od strony kodu, ale duże od strony kontraktu runtime.

### Naprawa

Na każdej iteracji:

- `dt_step = min(dt_nominal, until - t)`

### Werdykt

**Kategoria C**. To powinno być naprawione od razu.

---

## 5.6 `region_mask` i wielomateriałowość są pozorne

W `FdmPlanIR` istnieje `region_mask`, ale planner w executable path wypełnia go zerami i runner/engine go faktycznie nie używają do spatially varying materials.

### Co to znaczy

Obecny system jest nadal de facto:

- single geometry,
- single magnet,
- single material,
- single region semantics.

### Dlaczego to ważne

To znaczy, że architektura jeszcze nie jest gotowa na:

- phase boundaries,
- piecewise `A`,
- piecewise `Ms`,
- interface tests,
- poprawny exchange przez interfejsy,
- poprawny demag w heterogenicznych układach.

### Werdykt

**Kategoria C**. Obecny shell jest poprawny dla narrow slice, ale nie wolno udawać, że region/material model jest już wykonawczo gotowy.

---

## 5.7 `FemPlanIR` jest za cienki względem targetu FEM+GPU

`FemPlanIR` niesie dziś tylko:

- `mesh_name`,
- `initial_magnetization`,
- `exchange_bc`,
- `integrator`,
- `fixed_timestep`.

### Czego brakuje względem deklarowanego targetu

Jeśli serio celem jest MFEM + libCEED + hypre + GPU, to plan musi później nieść co najmniej:

- mesh source / import recipe,
- region/material tags,
- FE space selection,
- polynomial order,
- quadrature policy,
- operator realization policy,
- demag realization strategy,
- linear solver policy,
- preconditioner policy,
- projection/output policy,
- device policy.

### Werdykt

**Kategoria C**. To nie jest dzisiaj blocker dla FDM, ale jest cienkim miejscem architektury i trzeba je rozbudować, zanim FEM ruszy wykonawczo.

---

## 5.8 Semantyka `Zeeman(B=...)` vs `H_ext`

Publiczny API używa `Zeeman(B=(...))`, a planner przelicza to na `H_ext = B / μ0`. Artefakty i output naming mówią już językiem `H_ext` w `A/m`.

### Problem

System ma dziś dwa poziomy semantyki zewnętrznego pola:

- authoring convenience: `B`
- backend/output semantics: `H`

### Dlaczego to jest ryzykowne

To jest jeszcze do opanowania dla jednorodnego, statycznego pola zewnętrznego. Ale przy przyszłych:

- rampach czasowych,
- skryptowanych polach,
- couplingach elektromagnetycznych,
- FEM formulations,

brak jednej kanonicznej semantyki zacznie psuć kontrakt.

### Zalecenie

Jedna z dwóch dróg:

1. publicznie przyjąć `H_ext` jako canonical physical input, a `B(...)` zostawić jako helper convenience,
2. albo trzymać wszędzie `B_ext`, ale wtedy outputy i solver muszą też mówić `B`, nie `H`.

### Werdykt

**Kategoria C**.

---

## 6. Szczegółowy audyt fizyki vs implementacji

## 6.1 Exchange — co jest poprawne

Aktualny exchange path jest spójny **wewnętrznie**:

- CPU i CUDA robią to samo,
- pole exchange to 6-point Laplacian,
- BC to clamped-neighbor Neumann,
- energia to forward-neighbor pair sum.

To jest dobry bootstrap i dobry reference parity target.

## 6.2 Exchange — gdzie jest ograniczenie

To nadal jest model:

- jednorodnego materiału,
- jednej siatki,
- bez interface-aware `A_f`,
- bez heterogenicznych jump conditions,
- bez bardziej subtelnej energii twarzowej na interfejsach materiałowych.

### Wniosek

Na obecny slice to jest akceptowalne.
Dla phase-boundary physics — jeszcze nie.

## 6.3 Demag — największy drift fizyczny

To już omówione wyżej, ale warto ująć czysto fizycznie:

### Aktualna implementacja

- solving magnetostatics by spectral projection on padded box,
- treating `M` on a regular grid,
- crop after inverse FFT.

### Braki względem mocniejszego FDM demag

- brak cell-shape aware demag kernel,
- brak self-term treatment wynikającego z cell-averaged formulation,
- brak jawnego tensorowego operatora `N_ij`,
- brak rozdzielenia „demag physics” od „FFT accelerator”.

### Konsekwencja

Aktualny demag jest dobry jako **bootstrap nonlocal field**.
Nie jest jeszcze dobry jako **docelowy canonical FDM dipolar operator**.

## 6.4 Zeeman — fizycznie prosty, semantycznie nie do końca domknięty

Sama implementacja energetycznie jest spójna:

- `E_ext = - μ0 Ms m · H_ext V`

Natomiast input semantics wymaga ujednolicenia.

## 6.5 DMI — API i docs wyprzedzają wykonanie

`InterfacialDMI` jest już w publicznym API i w IR, ale planner/runners nie realizują go jeszcze.

To jest w porządku **tylko wtedy**, gdy:

- capability matrix to uczciwie pokazuje,
- examples स्पष्टnie oznaczają planning-only,
- docs nie sugerują publicznej wykonawczości.

Problem jest taki, że część status docs i README jeszcze nie jest idealnie zsynchronizowana z tym podziałem.

---

## 7. Audyt CPU reference engine

## 7.1 Co jest dobre

CPU engine jest prosty, czytelny i dobry jako numerical baseline:

- sensowne typy,
- jawne SI constants,
- jawne `EffectiveFieldTerms`,
- jawne `LlgConfig`,
- łatwo porównać z CUDA,
- łatwo testować sign conventions.

## 7.2 Co jest złe wydajnościowo

### 7.2.1 Całkowity brak wielowątkowości

Wszystkie pętle są jednowątkowe:

- exchange field,
- demag pack/unpack,
- energy sums,
- max norms,
- LLG RHS,
- combine fields,
- normalization.

Dla małych testów to jest okej.
Dla realniejszych gridów to zacznie być bardzo drogie i będzie zawyżało różnicę CPU↔CUDA bardziej niż trzeba.

### 7.2.2 Replanowanie FFT przy każdym wywołaniu

`fft3_in_place` tworzy `FftPlanner` i planuje transformacje od nowa przy każdym liczeniu demag.

To jest poważna strata czasu.

### 7.2.3 Brak cache’owania buforów FFT

Demag za każdym wywołaniem alokuje pełne padded complex arrays.

To generuje:

- alokacje,
- cache misses,
- koszt GC allocator / allocator pressure,
- brak stabilności performance.

### 7.2.4 Powielanie obliczeń pól i obserwabli

W trakcie kroku i obserwacji część pól jest liczona wielokrotnie:

- effective field,
- rhs,
- energies,
- max norms.

To poprawne funkcjonalnie, ale mało ekonomiczne.

## 7.3 Co zrobić

### 7.3.1 Wprowadzić `EngineWorkspace`

CPU reference engine powinien dostać obiekt roboczy, który trzyma:

- scratch vectors,
- FFT plans,
- padded complex buffers,
- reusable field buffers,
- possibly SoA mirrors.

### 7.3.2 Dodać `rayon` feature-gated parallelism

Najlepsze pierwsze miejsca:

- exchange stencil over cells,
- energy reductions chunked + reduced,
- max norm reductions,
- normalization after predictor/corrector,
- pack/unpack padded arrays.

### 7.3.3 Nie psuć deterministyczności testów

Jeśli wchodzi równoległość, redukcje powinny być:

- chunked,
- pairwise/stable,
- albo z deterministyczną kolejnością dla test mode.

## 7.4 Werdykt

**Kategoria C** jako reference baseline.
**Kategoria D** jeśli ten engine ma jeszcze dłużej udawać „wystarczająco szybki CPU path”.

---

## 8. Gdzie koniecznie wdrożyć wielowątkowość na CPU

To jest najważniejsza część pod Twoje pytanie o „nieobciążanie jednego wątku”.

## 8.1 Miejsce nr 1 — stencilowe pętle po komórkach

### Dotyczy

- exchange field,
- LLG RHS,
- combine fields,
- renormalizacja `m`,
- per-cell energy kernels po stronie CPU.

### Jak wdrożyć

Najprościej:

- chunkowanie po `z`-slabach albo po liniowym indeksie,
- `rayon::par_chunks_mut` / `par_iter_mut`,
- brak współdzielonych zapisów między komórkami.

### Ryzyko

Niskie. To są bardzo dobre kandydaty do data parallelism.

## 8.2 Miejsce nr 2 — redukcje skalarne

### Dotyczy

- `E_ex`,
- `E_demag`,
- `E_ext`,
- `max_h_eff`,
- `max_dm_dt`.

### Jak wdrożyć

- lokalne partial sums / partial maxima per chunk,
- final reduce w jednej fazie.

### Uwaga

Nie robić naiwnego `AtomicF64` everywhere.

## 8.3 Miejsce nr 3 — demag pack/unpack i transpozycje / line passes

Demag CPU ma dziś bardzo ciężką ścieżkę:

- pack magnetization,
- 3x FFT x/y/z,
- spectral projection,
- inverse FFT,
- unpack.

Pack/unpack i kopiowanie linii można równoleglić.

## 8.4 Miejsce nr 4 — artifact writer i log/event writer

To nie jest bottleneck fizyczny numer 1, ale jeśli zaczną pojawiać się częstsze field snapshots, to:

- serializacja JSON,
- zapis do plików,
- aktualizacja live state,
- NDJSON event append,

powinny iść przez osobny writer task/thread.

Nie po to, by „przyspieszyć solver”, ale by **nie blokować threada wykonawczego** na I/O.

## 8.5 Miejsce nr 5 — API session registry i websocket fan-out

Przy wielu klientach / wielu runach warto oddzielić:

- run execution thread,
- event ingestion,
- websocket broadcast.

Nie wszystko powinno wisieć logicznie na jednej ścieżce callbackowej.

---

## 9. Gdzie NIE przesadzać z wielowątkowością

## 9.1 Nie rozbijać jednego GPU runu na wiele host-threadów bez potrzeby

GPU already gives massive parallelism.

Host orchestration dla jednego runu powinna być raczej:

- jedna kontrolująca ścieżka,
- minimalna liczba synchronizacji,
- dobre device-side reductions,
- strumienie CUDA tam, gdzie to ma sens.

A nie kilka CPU threadów „naokoło” jednego runu.

## 9.2 Nie komplikować za wcześnie CLI shellu

CLI nie potrzebuje fine-grained concurrency wszędzie. Wystarczy oddzielić:

- run thread,
- writer thread,
- ewentualnie web bootstrap.

## 9.3 Nie równoleglić wszystkiego kosztem czytelności reference engine

Reference engine ma nadal być referencyjny.

Dlatego najlepszy model to:

- wersja podstawowa czytelna,
- opcjonalny `parallel` feature,
- testy parity między `serial` i `parallel`.

---

## 10. Audyt native CUDA FDM

## 10.1 Co jest bardzo dobre

### 10.1.1 SoA layout

To jest poprawna decyzja.

### 10.1.2 Persistent context

Stałe bufory, handle FFT i device-side state to również dobra decyzja.

### 10.1.3 CPU↔CUDA parity target

To, że CUDA explicite naśladuje semantykę CPU reference, jest poprawne dla fazy kalibracyjnej.

## 10.2 Co jest jeszcze correctness-first, a nie production-optimal

### 10.2.1 Host-side reduction dla exchange energy

Kernel zapisuje partial energies, potem dane idą na hosta i są sumowane na CPU.

To jest wyraźny performance debt.

### 10.2.2 `cudaDeviceSynchronize()` na końcu kroku

To ułatwia poprawność i zbieranie stats, ale zabija overlap i obniża throughput.

### 10.2.3 Wielokrotne recompute fields wewnątrz jednego kroku

Dla Heuna liczycie pola dla:

- stanu startowego,
- predyktora,
- final diagnostics,
- jeszcze raz RHS dla `max_dm_dt`.

To bywa nieuniknione, ale da się ograniczać zbędne rekalkulacje i kopie.

### 10.2.4 C2C FFT zamiast bardziej ekonomicznej polityki R2C/C2R

Na razie to akceptowalne.
Na dłużej — raczej do optymalizacji.

## 10.3 Co poprawić

1. device-side reductions,
2. per-step stats bez pełnego host sync wszędzie,
3. prawdziwy live callback seam,
4. lepsza polityka demag,
5. mniej temporary copies / lepszy scratch reuse.

## 10.4 Werdykt

**Kategoria B/C** — dobra ścieżka kalibracyjna, jeszcze nie production-optimal.

---

## 11. Audyt runnera

## 11.1 Co jest dobre

Runner jest oddzielony od planner i engine.
To jest bardzo zdrowe.

## 11.2 Co wymaga poprawy

### 11.2.1 Zbyt dużo wiedzy o szczegółach field names

Runner ma sporo twardych mapowań typu:

- `H_ex`, `H_demag`, `H_ext`, `H_eff`
- `E_ex`, `E_demag`, `E_ext`, `E_total`

Na obecnym etapie jest to akceptowalne, ale z czasem potrzebny będzie bardziej formalny quantity registry.

### 11.2.2 Artifacts jako JSON są dobre bootstrapowo, ale nie skalują

Dla małych baseline’ów okej.
Dla większych runów nie.

### 11.2.3 Pole final time i snapshot scheduling powinny być bardziej formalne

Szczególnie przy adaptive stepping i późniejszych integratorach.

---

## 12. Audyt API i frontend runtime shell

## 12.1 Plusy

- sesje istnieją,
- run manifests istnieją,
- live state istnieje,
- jest `/v1/sessions`, `/v1/runs`, `/v1/docs/physics`, `/ws/live`.

To już jest aplikacja, nie tylko solver binary.

## 12.2 Minus główny

Live runtime nie jest jeszcze naprawdę run-scoped.

## 12.3 Drugi minus

`POST /v1/run` tylko odpala run i zwraca bardzo cienki status. Brakuje mocniejszego kontraktu:

- run id,
- session id,
- status URL,
- websocket URL dla tego runu,
- deterministic artifact root,
- failure payload.

## 12.4 Trzeci minus

Brakuje wyraźnego session managera jako własnej warstwy. Na razie logika jest rozsmarowana między CLI/API/runner.

### Wniosek

To jeszcze nie jest zła architektura, ale nie jest też domknięta.

---

## 13. Audyt dokumentacji vs kod

## 13.1 README wyprzedził część status docs

README opisuje publiczny executable slice szerzej niż starsze status docs.

To jest lepszy problem niż odwrotny, ale nadal problem.

## 13.2 `implementation-status-and-next-plans-2026-03-23.md` jest już częściowo nieaktualny

Wskazuje publiczny subset jako exchange-only CPU/FDM, podczas gdy kod/README mają już executable combinations z `Demag` i `Zeeman`.

## 13.3 `0200-llg-exchange-reference-engine.md` nie jest już pełnym obrazem engine’u

To nadal ważny historical physics note, ale nie opisuje pełnego aktualnego executable path.

## 13.4 Nowsze docs fizyczne dla demag są silniejsze niż aktualna implementacja

To największy drift dokumentacyjno-fizyczny.

### Werdykt

**Trzeba zsynchronizować docs z kodem albo kod z docs.**
Nie można dalej żyć w stanie pośrednim.

---

## 14. Czy obecny układ jest optymalny pod przyszły FEM?

Nie do końca.

## 14.1 Co jest dobre pod FEM

- typed IR,
- `StudyIR`,
- planner/runner split,
- backend seam,
- session shell,
- docs już mówią językiem MFEM/libCEED/hypre.

## 14.2 Co jest złe pod FEM

- `FemPlanIR` jest zbyt ubogi,
- quantity/operator semantics są jeszcze zbyt FDM-colored,
- demag jako operator nie jest jeszcze wystarczająco formalnie wydzielony,
- integrator ABI jest zbyt wąski (`Heun` only),
- output layer nie ma jeszcze dość silnej abstrakcji dla field-on-mesh vs field-on-grid.

### Wniosek

Nie trzeba przebudowywać całości, ale trzeba **wzmocnić operatorową warstwę planu**, zanim dojdzie realny FEM execution.

---

## 15. Szczegółowa matryca ryzyk

| ID | Problem | Klasa | Skutek | Priorytet |
|----|---------|-------|--------|-----------|
| R1 | Demag implementation != docs physical contract | Physics/architecture | walidacja i publikacyjność będą nieczyste | P0 |
| R2 | Global live broadcast channel | Runtime architecture | crosstalk i brak izolacji runów | P0 |
| R3 | CUDA live replay uses final magnetization | Runtime correctness | frontend pokazuje zły stan pola | P0 |
| R4 | Box→grid uses `round()` | Physics/planning | cicha zmiana geometrii | P0 |
| R5 | last step overshoots `until` | Runtime correctness | nieprecyzyjny kontrakt czasu | P1 |
| R6 | CPU engine single-threaded | Performance | słaby baseline i niepotrzebne obciążenie jednego wątku | P1 |
| R7 | FFT plans recreated every call | Performance | duży narzut demag CPU | P1 |
| R8 | region/material semantics not realized | Physics/architecture | brak gotowości na heterogeniczność | P1 |
| R9 | FemPlanIR too thin | Architecture | trudne wejście FEM GPU | P1 |
| R10 | `B` vs `H_ext` semantic drift | Physics/API | nieczysty kontrakt jednostek | P1 |
| R11 | host-side CUDA reductions | Performance | wolniejsza ścieżka GPU | P2 |
| R12 | JSON field artifacts only | Product/perf | słaba skalowalność | P2 |

---

## 16. Rekomendowany docelowy układ po korektach

## 16.1 Warstwa semantyczna

- Python API
- `Problem` / `Study`
- typed `ProblemIR`
- canonical quantity dictionary

## 16.2 Warstwa operatorowa

Trzeba ją wzmocnić.

To ma być poziom, który mówi:

- jaki operator fizyczny jest aktywny,
- jakie ma units i assumptions,
- jaki ma discretization family,
- jaki ma boundary semantics,
- jaki ma execution realization.

Szczególnie ważne dla:

- demag,
- DMI,
- FEM weak forms,
- relaxation studies,
- adaptive integrators.

## 16.3 Warstwa wykonawcza

- planner → execution plan,
- runner → scheduling / artifacts / callbacks,
- backend CPU/CUDA/FEM.

## 16.4 Warstwa runtime

- session manager,
- run registry,
- per-run live streams,
- artifact registry.

---

## 17. Konkretny plan korekt — priorytety

## 17.1 P0 — naprawić przed dalszą rozbudową fizyki

1. **Rozstrzygnąć demag contract**
   - albo downgrade docs do bootstrap spectral demag,
   - albo roadmap upgrade’u implementacji.

2. **Naprawić live runtime isolation**
   - per-run channels,
   - `/ws/live/:run_id`.

3. **Naprawić CUDA live callback**
   - prawdziwe live updates,
   - albo jawne replay-only.

4. **Jawna policy dla Box→grid realization**
   - reject / pad / realized size in provenance.

## 17.2 P1 — ważne przed wejściem w DMI / lepsze integratory / relaksację

5. **Clip ostatni krok czasu**.
6. **CPU engine workspace + FFT plan cache**.
7. **Rayon parallel path dla CPU reference**.
8. **Zrealizować realne region/material semantics w FDM planie**.
9. **Ujednolicić `B` vs `H_ext`**.
10. **Rozbudować `FemPlanIR`**.

## 17.3 P2 — optymalizacje i produktowe hardening

11. device-side CUDA reductions,
12. lepsze artifact storage,
13. quantity registry,
14. lepsze per-step diagnostics,
15. adaptacyjne integratory.

---

## 18. Czy trzeba teraz implementować wielowątkowość?

### Krótka odpowiedź

**Tak — ale selektywnie.**

### Gdzie najpierw

1. CPU reference cell loops
2. CPU reductions
3. CPU demag buffers / pack-unpack
4. writer thread dla artifact/event IO
5. per-run live runtime isolation

### Gdzie nie zaczynać od razu

1. nie rozbijać jednego GPU runu na wiele host threadów,
2. nie komplikować za wcześnie CLI,
3. nie psuć serial reference path.

### Najlepszy model wdrożenia

- `serial` path zostaje canonical,
- `parallel` path wchodzi feature-gated,
- test parity serial vs parallel,
- benchmarki dla `nx*ny*nz` progów opłacalności.

---

## 19. Ocena końcowa

## 19.1 Czy architektura jest dobra?

**Tak.**
Ogólny kierunek jest dobry.

## 19.2 Czy implementacja jest już w pełni spójna z fizyką?

**Nie.**
Najbardziej w demag i częściowo w semantyce pola zewnętrznego.

## 19.3 Czy runtime shell jest już domknięty?

**Nie.**
Jest obiecujący, ale live/session isolation trzeba jeszcze poprawić.

## 19.4 Czy CPU/GPU układ jest już optymalny?

**Nie.**
CPU reference jest za bardzo single-threaded, a CUDA jest wciąż correctness-first.

## 19.5 Czy obecny układ nadaje się jako baza do dalszego rozwoju?

**Tak, ale tylko po naprawieniu wskazanych seamów P0/P1.**

Jeśli tego nie zrobicie teraz, to kolejne warstwy — DMI, lepsze integratory, relaksacja, FEM, eigenmodes — zaczną być dokładane na fundament, który jeszcze nie ma rozstrzygniętych kontraktów w najważniejszych miejscach.

---

## 20. Finalny werdykt

### Co bym zostawił bez rewolucji

- Python → IR → planner → runner → backend
- session-first local shell
- native CUDA seam
- docs-as-physics-contract approach
- separation of CPU reference and CUDA implementation

### Co bym poprawił natychmiast

- demag contract
- live runtime isolation
- CUDA live correctness
- Box realization policy
- final-step clipping
- CPU threading + FFT caching
- region/material realism
- Zeeman unit semantics

### Odpowiedź na pytanie „czy mamy w pełni optymalny układ?”

**Jeszcze nie.**
Mamy już **dobry układ bazowy**, ale nie **w pełni optymalny i ostatecznie domknięty układ**.

Największy potencjał poprawy w najbliższym kroku nie leży w pisaniu nowej fizyki, tylko w:

1. domknięciu kontraktu demag,
2. dodaniu selektywnej współbieżności,
3. naprawie runtime/live/session spine,
4. przygotowaniu operatorowej warstwy pod FEM i przyszłe studies.

Dopiero wtedy dalszy rozwój będzie naprawdę skalowalny architektonicznie.

---

## 21. Krótka checklista wykonawcza

### Tydzień 1

- [ ] clip final dt
- [ ] decide demag contract
- [ ] per-run live channels
- [ ] mark CUDA live as replay-only albo naprawić
- [ ] add realized box size / reject non-divisible box

### Tydzień 2

- [ ] CPU FFT plan cache
- [ ] CPU scratch workspace
- [ ] parallel exchange / rhs / reductions via rayon
- [ ] writer thread for events/artifacts

### Tydzień 3

- [ ] unify `B` vs `H_ext`
- [ ] expand `FemPlanIR`
- [ ] region/material execution semantics in FDM plan
- [ ] update status docs to current code

### Tydzień 4+

- [ ] device-side CUDA reductions
- [ ] better artifact format
- [ ] adaptive integrators
- [ ] relaxation studies
- [ ] DMI execution path
- [ ] FEM execution bootstrap


---

## Appendix A — file-by-file review and recommended patch direction

## A.1 `crates/fullmag-engine/src/lib.rs`

### Observed role

Canonical CPU reference numerics for current executable FDM slice.

### Strengths

- clear scalar/vector math,
- explicit SI constants,
- simple stepper logic,
- easy parity target for CUDA.

### Weak points

1. only `Heun`, no integrator abstraction beyond a tiny enum,
2. no adaptive step machinery,
3. no workspace object,
4. no parallel path,
5. FFT plans rebuilt every call,
6. demag not aligned with stronger docs contract,
7. repeated field recomputation,
8. AoS layout only.

### Recommended patch direction

- introduce `EngineWorkspace` or `ExchangeLlgWorkspace`,
- split operator evaluation from integrator orchestration,
- add cached demag plans/buffers,
- add feature-gated rayon path,
- add last-step clip support through runner contract,
- preserve serial path for deterministic tests.

## A.2 `crates/fullmag-plan/src/lib.rs`

### Observed role

Phase-1 executable legality + Box→grid lowering.

### Strengths

- honest rejection of unsupported features,
- clear executable subset,
- explicit output legality checks,
- explicit `B -> H_ext` conversion.

### Weak points

1. `round()` for Box→grid lowering,
2. region mask placeholder only,
3. single-magnet and single-material assumptions hardcoded into executable path,
4. no realized geometry payload,
5. no operator-realization metadata for demag.

### Recommended patch direction

- add box realization policy enum,
- store realized size and origin in `FdmPlanIR`,
- add operator realization metadata (e.g. `demag_realization = spectral_projection_bootstrap`),
- start carrying region/material maps truthfully.

## A.3 `crates/fullmag-ir/src/lib.rs`

### Observed role

Canonical typed IR.

### Strengths

- good overall layering,
- `StudyIR` exists,
- energy and backend policy are separated,
- enough structure to keep Python API backend-neutral.

### Weak points

1. `IntegratorChoice` too narrow,
2. `FemPlanIR` too thin,
3. no `BulkDmi`,
4. no explicit operator realization layer,
5. no field quantity registry,
6. no adaptive-step controller payloads.

### Recommended patch direction

- extend `IntegratorChoice` only when executor exists or a stable semantic contract is frozen,
- add `BulkDmi` once docs/API/IR all align,
- strengthen FEM plan model before backend implementation,
- consider an operator-plan substructure for nonlocal terms.

## A.4 `crates/fullmag-runner/src/cpu_reference.rs`

### Observed role

CPU execution orchestration and output scheduling.

### Strengths

- clear translation from `FdmPlanIR` to engine problem/state,
- schedule logic is reasonably separated,
- live callback exists.

### Weak points

1. last step overshoots `until`,
2. per-step observe can be expensive,
3. no writer queue separation,
4. no pacing/backpressure policy for live callbacks.

### Recommended patch direction

- clip final dt,
- optionally cache last observables per step,
- decouple writing from execution thread when field snapshots become heavier,
- introduce event throttling policy separate from field schedule policy.

## A.5 `crates/fullmag-runner/src/dispatch.rs`

### Observed role

CPU/CUDA selection and callback bridging.

### Strengths

- clean engine selection seam,
- environment override is practical.

### Weak points

1. CUDA callback path is semantically wrong for live magnetization,
2. callback API is not first-class in native backend contract.

### Recommended patch direction

- make native FDM callback capability explicit in FFI,
- if absent, represent CUDA mode as post-run replay and never label it live.

## A.6 `crates/fullmag-api/src/main.rs`

### Observed role

Bootstrap API and live endpoints.

### Strengths

- already useful,
- session/run/doc routes exist,
- SSE/websocket entrypoints exist.

### Weak points

1. global broadcast channel,
2. insufficient run-scoped live semantics,
3. weak `POST /v1/run` return payload,
4. hidden session manager logic.

### Recommended patch direction

- introduce `RunRegistry`,
- add per-run event streams,
- return `run_id`, `session_id`, `state_url`, `events_url`, `ws_url`,
- isolate lifecycle cleanup.

## A.7 `crates/fullmag-cli/src/main.rs`

### Observed role

Rust-hosted public launcher and local session shell.

### Strengths

- correct product direction,
- useful command surface,
- script mode is already real.

### Weak points

1. some status text still underclaims or overclaims relative to latest code,
2. session writing and runtime orchestration could eventually be pushed into a dedicated session manager crate or module.

### Recommended patch direction

- keep CLI thin,
- push session orchestration into reusable runtime layer,
- ensure CLI and API share identical run/session semantics.

## A.8 `packages/fullmag-py/src/fullmag/model/*.py`

### Observed role

Public authoring DSL.

### Strengths

- user-facing API is clean,
- compatibility shim from legacy `dynamics+outputs` to `study` exists,
- Box/Cylinder and current energy terms are author-friendly.

### Weak points

1. `Zeeman(B=...)` semantic drift vs `H_ext`,
2. public API exports `InterfacialDMI`, but execution remains semantic-only,
3. no `BulkDMI` yet.

### Recommended patch direction

- decide canonical external-field semantics,
- annotate semantic-only features very explicitly in docs/examples,
- add `BulkDMI` only together with IR/docs consistency.

## A.9 `packages/fullmag-py/src/fullmag/runtime/simulation.py`

### Observed role

Public Python execution wrapper.

### Strengths

- simple and understandable,
- good honest notes on fallback behavior.

### Weak points

1. `plan()` still returns a very thin pseudo-result instead of true plan summary,
2. execution result object does not yet expose richer provenance/session info.

### Recommended patch direction

- return real planning information,
- expose artifact/session metadata in result,
- eventually align Python runtime more directly with session/run model.

## A.10 `native/backends/fdm/src/exchange_fp64.cu`

### Observed role

Double-precision exchange kernels.

### Strengths

- clear parity target with CPU,
- SoA-friendly implementation.

### Weak points

1. host-side reduction for energy,
2. semantics still only single-material/uniform exchange.

### Recommended patch direction

- move reductions device-side,
- future-proof exchange for interface-aware material handling.

## A.11 `native/backends/fdm/src/demag_fp64.cu`

### Observed role

Double-precision demag field/energy kernels.

### Strengths

- straightforward and parity-driven,
- persistent FFT plan in context is good.

### Weak points

1. demag physics contract drift vs docs,
2. still correctness-first spectral approach,
3. no stronger cell-averaged tensor realization.

### Recommended patch direction

- explicitly label current algorithm as bootstrap if retained,
- or plan migration to tensor-convolution demag,
- ensure docs/code/provenance all name the same realization.

## A.12 `native/backends/fdm/src/llg_fp64.cu`

### Observed role

Double-precision LLG/Heun stepper.

### Strengths

- parity with CPU reference,
- reuse of persistent buffers.

### Weak points

1. multiple field recomputations,
2. `cudaDeviceSynchronize()` each step,
3. host-involved diagnostics path,
4. no adaptive stepping.

### Recommended patch direction

- move toward better diagnostics/reduction strategy,
- reduce synchronization points,
- prepare integrator API for higher-order/adaptive methods.

---

## Appendix B — recommended concurrency model by subsystem

| Subsystem | Current state | Recommended model |
|-----------|---------------|-------------------|
| CPU reference cell loops | single-thread | rayon chunk parallelism |
| CPU reductions | single-thread | chunked parallel reduce |
| CPU demag FFT prep | single-thread | parallel pack/unpack + cached plans |
| Artifact writer | inline in execution flow | dedicated writer task/thread |
| API live updates | global broadcast | per-run channels |
| CLI session file updates | mostly inline | small serialized writer layer |
| Single GPU run | one host control path + sync-heavy kernels | keep one host control path, reduce host sync, improve device reductions |
| Multi-run local execution | ad hoc | bounded worker pool / one task per run |

---

## Appendix C — one-sentence final recommendation

**Nie zmieniałbym już ogólnej architektury Fullmaga; zmieniłbym teraz kontrakty operatorowe, runtime live/session spine i selektywnie dodał współbieżność tam, gdzie dziś całkowicie niepotrzebnie obciążacie jeden wątek.**
