# Fullmag FEM GPU enablement — raport architektoniczny i pakiet zmian

Data: 2026-04-03

## 1. Cel raportu

Celem tego raportu jest wskazanie, **dlaczego Fullmag FEM praktycznie nie dochodzi dziś do realnego wykonania na GPU**, oraz dostarczenie **gotowego pakietu zmian w kodzie**, który usuwa najważniejsze blokery uruchomieniowe i runtime’owe.

Raport obejmuje:

- ścieżkę build/runtime dla FEM GPU,
- powody automatycznego fallbacku do CPU,
- luki w diagnostyce dostępności backendu,
- niespójności między deklarowaną architekturą a realnym obrazem `fem-gpu`,
- gotowy patch bundle,
- zakres tego, co po wdrożeniu **będzie działać**, i czego ten pakiet **jeszcze nie domyka**.

## 2. Executive summary

Najważniejszy wniosek jest prosty:

> **Fullmag nie ma dziś jednego problemu FEM GPU — ma cały łańcuch małych blokad, które razem sprawiają wrażenie, że „GPU nie działa”.**

Po audycie repo potwierdziłem pięć głównych przyczyn:

1. **Obraz `docker/fem-gpu` buduje MFEM bez libCEED.**
   Obecny Dockerfile ma `-DMFEM_USE_CEED=NO`, mimo że repo samo wskazuje `MFEM + libCEED + hypre` jako docelową ciężką ścieżkę FEM GPU.

2. **Build natywnego FEM bardzo łatwo kończy się stubem albo backendem bootstrapowym.**
   `FULLMAG_USE_MFEM_STACK` jest domyślnie wyłączone, a `fullmag-fem-sys/build.rs` włącza CUDA wyłącznie wtedy, gdy ten przełącznik jest ustawiony.

3. **Runner ma zbyt ubogą diagnostykę dostępności GPU.**
   Dzisiaj `fullmag_fem_is_available()` zwraca tylko `0/1`, a wrapper w Ruście też zna tylko `bool`. To nie wystarcza, żeby odróżnić: brak MFEM stack, brak CUDA runtime, brak widocznego GPU, zły index GPU, brak CEED, zły device string itd.

4. **Dispatch ma kilka miejsc, w których CPU fallback jest zbyt agresywny albo zbyt mało jawny.**
   Dotyczy to zwłaszcza `current_modules`, `fe_order != 1` oraz polityki małych siatek (`FULLMAG_FEM_GPU_MIN_NODES=10000`).

5. **Natywny bridge MFEM nadal nie jest jeszcze pełnym GPU-first solverem.**
   Nadal widać ścieżkę bootstrapową: assembled matrices (`SpMat()`), brak `SetAssemblyLevel(PARTIAL)`, brak realnego libCEED operator path i kilka host-side pętli/transferów.

W efekcie przygotowany przeze mnie pakiet zmian robi dwie rzeczy naraz:

- **naprawdę umożliwia wybór i uruchomienie FEM na GPU** w kontrolowany, diagnosable sposób,
- **ustawia środowisko pod właściwy następny etap**: refactor exchange/demag do partial assembly / libCEED.

Jednocześnie trzeba uczciwie powiedzieć: **to nie jest jeszcze końcowy refactor wydajnościowy FEM GPU**. To jest **solidny etap enablement + stabilizacja runtime’u**.

## 3. Co potwierdziłem w repo

### 3.1. Repo samo deklaruje docelowy kierunek: MFEM + libCEED + hypre

W README projekt opisuje managed runtimes jako docelową drogę dla ciężkich backendów, a dla FEM GPU wprost wskazuje **MFEM + libCEED + hypre**.

Źródła:

- repo README: `readme.md`
- runtime distribution spec: `docs/specs/runtime-distribution-and-managed-backends-v1.md`
- physics note: `docs/physics/0410-fem-exchange-demag-zeeman-mfem-gpu.md`
- bootstrap FEM note: `docs/physics/0520-fem-robin-airbox-demag-bootstrap-reference.md`

### 3.2. Obraz `fem-gpu` nie realizuje dziś tej deklaracji

Aktualny `docker/fem-gpu/Dockerfile`:

- buduje hypre z CUDA,
- buduje MFEM z `MFEM_USE_CUDA=YES`,
- **ale buduje MFEM z `MFEM_USE_CEED=NO`**,
- i w ogóle nie instaluje libCEED.

To jest najważniejsza niespójność środowiskowa w obecnym repo.

### 3.3. Native FEM build ma niebezpieczne defaulty

`native/backends/fem/CMakeLists.txt` ustawia:

- `FULLMAG_ENABLE_FEM_GPU=ON`,
- ale `FULLMAG_USE_MFEM_STACK=OFF` domyślnie.

`crates/fullmag-fem-sys/build.rs` dalej wzmacnia ten problem, bo przekazuje `-DFULLMAG_ENABLE_CUDA=ON` tylko wtedy, gdy `FULLMAG_USE_MFEM_STACK=ON`.

W praktyce oznacza to, że bez bardzo świadomego środowiska buildowego łatwo skończyć z backendem, który **formalnie istnieje**, ale nie jest tym runtime’em, którego oczekujesz.

### 3.4. Dostępność GPU jest raportowana zbyt ubogo

Dzisiaj `fullmag_fem_is_available()` sprawdza w zasadzie tylko:

- czy build ma MFEM stack,
- czy jest CUDA runtime,
- czy `cudaGetDeviceCount()` zwraca urządzenia,
- czy wybrany index GPU mieści się w zakresie.

Nie ma:

- structured reason,
- flagi „MFEM built with CEED / without CEED”,
- informacji o resolved GPU index,
- diagnostyki „requested CEED backend, ale CEED nie jest zbudowane”,
- jawnego surfacowania tego do Rust wrappera i dispatchu.

### 3.5. Dispatch ma kilka fallbacków, które maskują działające GPU

W `crates/fullmag-runner/src/dispatch.rs` potwierdziłem m.in.:

- fallback do CPU, gdy `current_modules` nie są puste,
- fallback do CPU, gdy `fe_order != 1`,
- dodatkowy fallback w `execute_fem()` dla siatek mniejszych od `FULLMAG_FEM_GPU_MIN_NODES`, które domyślnie wynosi **10000**.

To oznacza, że nawet przy działającym natywnym FEM GPU użytkownik nadal może widzieć CPU, jeśli siatka jest „za mała” według arbitralnej polityki runtime’u.

### 3.6. Bridge MFEM nadal nie jest jeszcze GPU-first

W `native/backends/fem/src/mfem_bridge.cpp` potwierdziłem, że obecna implementacja nadal:

- korzysta z assembled matrices (`SpMat()`),
- nie używa `SetAssemblyLevel(PARTIAL)`,
- nie ma realnej ścieżki libCEED operator action,
- ma nadal host-side element loops i host recovery paths,
- konfiguruje device na stałe jako `"cuda"` zamiast świadomie wybierać `ceed-cuda:/gpu/cuda/shared` lub przynajmniej udostępniać tego wyboru przez env.

To jest powód, dla którego „GPU enablement” i „GPU efficiency” trzeba potraktować jako **dwa odrębne etapy**.

## 4. Co dokładnie robi dostarczony pakiet zmian

Dostarczam dwa poziomy patchy:

### 4.1. Patchset runtime (`fullmag_fem_gpu_patchset_runtime.patch`)

Zmienia:

- `native/include/fullmag_fem.h`
- `native/backends/fem/src/api.cpp`
- `crates/fullmag-fem-sys/src/lib.rs`
- `crates/fullmag-runner/src/native_fem.rs`
- `crates/fullmag-runner/src/dispatch.rs`
- `crates/fullmag-fem-sys/build.rs`
- `native/backends/fem/src/mfem_bridge.cpp`

#### Najważniejsze efekty

**A. Structured availability API**

Dodany został nowy kontrakt C ABI:

- `fullmag_fem_availability_info`
- `fullmag_fem_get_availability_info(...)`

Raportuje on m.in.:

- `available`
- `built_with_mfem_stack`
- `built_with_cuda_runtime`
- `built_with_ceed`
- `visible_cuda_device_count`
- `requested_gpu_index`
- `resolved_gpu_index`
- `reason`

To usuwa obecne „ślepe” `bool` i pozwala w końcu odpowiedzieć **dlaczego** GPU nie zostało użyte.

**B. Rust wrapper zaczyna rozumieć powód niedostępności**

W `native_fem.rs` dodałem `GpuAvailability`, a `is_gpu_available()` stało się prostym wrapperem wokół bogatszej diagnostyki.

**C. Dispatch przestaje chować powody fallbacku**

W `dispatch.rs`:

- wymuszone `FULLMAG_FEM_EXECUTION=gpu` przy `current_modules` już nie zrzuca po cichu do CPU — zwraca jawny błąd,
- fallback „backend not available” zawiera teraz konkretny `reason`,
- polityka małych siatek nie wymusza już domyślnie CPU dla wszystkiego poniżej 10k nodes; fallback staje się opt-in przez env.

**D. Build-time guardrails**

W `build.rs` dodałem `FULLMAG_FEM_REQUIRE_GPU=1`, które wywróci build wcześnie, jeśli ktoś próbuje wymusić GPU bez `FULLMAG_USE_MFEM_STACK=ON`.

**E. MFEM device selection staje się jawne i CEED-aware**

W `mfem_bridge.cpp` dodałem env `FULLMAG_FEM_MFEM_DEVICE` i fallback:

- jeśli env ustawione — użyj dokładnie tego device stringa,
- jeśli MFEM ma CEED — domyślnie `ceed-cuda:/gpu/cuda/shared`,
- w przeciwnym razie `cuda`.

To nie robi jeszcze z solvera pełnego libCEED FEM, ale w końcu **spina runtime selection z realnym device backendem MFEM**.

### 4.2. Patchset container (`fullmag_fem_gpu_patchset_container.patch`)

Zmienia:

- `docker/fem-gpu/Dockerfile`
- `compose.yaml`

#### Najważniejsze efekty

**A. Obraz `fem-gpu` buduje i instaluje libCEED**

Dockerfile teraz:

- pobiera `libCEED`,
- buduje je,
- instaluje do `/opt/fullmag-deps`.

**B. MFEM jest budowane z `MFEM_USE_CEED=YES`**

Dodatkowo ustawiony jest `CEED_DIR=${INSTALL_PREFIX}`.

**C. GPU profile w compose dostaje sensowne domyślne env**

Dodałem:

- `FULLMAG_FEM_REQUIRE_CEED=1`
- `FULLMAG_FEM_GPU_MIN_NODES=0`
- `FULLMAG_FEM_MFEM_DEVICE=ceed-cuda:/gpu/cuda/shared`

To ma dwa skutki:

- profil `fem-gpu` przestaje akceptować „udawane GPU”, które tak naprawdę jest bez CEED,
- małe i średnie meshe nie będą już automatycznie spadały do CPU wyłącznie przez politykę runtime’u.

## 5. Dlaczego te zmiany są właściwe architektonicznie

### 5.1. Są zgodne z deklarowanym kierunkiem repo

Repo i dokumenty architektoniczne mówią jasno: docelowy ciężki FEM GPU ma iść przez **managed runtime + MFEM + libCEED + hypre**.

Dostarczony patchset nie wymyśla nowej architektury. On po prostu **doprowadza realny runtime bliżej tego kontraktu**.

### 5.2. Naprawiają największy błąd operacyjny: brak provenance

Największy praktyczny problem dzisiejszego FEM GPU nie polega tylko na tym, że backend bywa wolny albo bootstrapowy. Polega na tym, że użytkownik często **nie wie, dlaczego akurat dostał CPU**.

Po wdrożeniu tego patchsetu będziesz mógł jasno odróżnić:

- brak MFEM stack,
- brak CUDA runtime,
- brak widocznych urządzeń,
- zły GPU index,
- brak CEED przy runtime, który go wymaga,
- `current_modules` jako blocker,
- `fe_order != 1`,
- politykę małych siatek.

To jest warunek konieczny przed dalszym tuningiem solvera.

### 5.3. Nie udają, że solve-time performance problem już zniknął

Bardzo ważne: patchset **celowo nie udaje**, że samo włączenie CEED w obrazie rozwiązuje już wydajność.

Dopóki `mfem_bridge.cpp` używa assembled matrices i host recovery loops, dopóty:

- GPU będzie uruchamialne,
- ale nie będzie jeszcze końcowo zoptymalizowane.

To jest uczciwe i technicznie poprawne rozdzielenie faz.

## 6. Co ten pakiet jeszcze NIE domyka

Po wdrożeniu nadal zostaną prace drugiej fazy:

### 6.1. Exchange / mass operator powinien przejść na `AssemblyLevel::PARTIAL`

Obecny kod korzysta z `SpMat()` i lumped-mass wyciąganej z assembled matrix. To trzeba przepisać tak, aby operator action odbywał się przez partial assembly / device path.

### 6.2. Demag Poisson nadal ma istotny host-side koszt

Poisson/demag nadal nie jest pełnym GPU-first path. Sam CEED-ready runtime nie wystarczy, jeśli później odzysk pola i część operatorów pozostają po stronie hosta.

### 6.3. Potrzebny jest osobny etap benchmarków i regression gates

Po wdrożeniu patchsetu należy dołożyć:

- benchmarki CPU vs GPU,
- benchmark bootstrap CUDA vs CEED-enabled runtime,
- jawny test „no silent CPU fallback”,
- regression suite dla FE order / current_modules / small mesh policy.

## 7. Ryzyka i niuanse, które trzeba znać przed mergem

### 7.1. `ceed-cuda:/gpu/cuda/shared` może być niedeterministyczne

Oficjalna dokumentacja MFEM zaznacza, że bieżący domyślny libCEED CUDA backend może być **niedeterministyczny**. To nie jest powód, żeby z niego nie korzystać, ale trzeba to uwzględnić w testach regresyjnych.

Jeśli podczas walidacji chcesz najpierw maksymalnie uprościć śledzenie błędów numerycznych, tymczasowo ustaw:

- `FULLMAG_FEM_MFEM_DEVICE=ceed-cuda:/gpu/cuda/ref`

albo nawet:

- `FULLMAG_FEM_MFEM_DEVICE=cuda`

żeby odseparować problem wyboru backendu od problemu deterministyczności CEED.

### 7.2. `FULLMAG_FEM_REQUIRE_CEED=1` jest celowo twarde

W profilu `fem-gpu` ustawiłem wymuszenie CEED, bo inaczej znowu bardzo łatwo wpaść w stan „GPU niby jest, ale to nadal bootstrap MFEM+CUDA bez docelowej ścieżki”.

Jeżeli chcesz awaryjnie uruchomić stary bootstrap runtime, można tymczasowo zdjąć ten env.

### 7.3. Pakiet nie był skompilowany end-to-end w tym środowisku

To ważna uwaga: przygotowałem patchset względem aktualnych plików repo i sprawdziłem spójność logiczną zmian, ale **nie zbudowałem całego repo end-to-end w tym środowisku**. Trzeba potraktować go jako **wysokiej jakości patch review bundle**, a nie już potwierdzony green CI.

Z tego powodu dołączam też:

- komplet gotowych zmienionych plików,
- osobne patchsety,
- skrypt smoke-testów.

## 8. Rekomendowana kolejność wdrożenia

### Etap 1 — runtime truth layer

Najpierw wnieść:

- `fullmag_fem_gpu_patchset_runtime.patch`

To daje:

- diagnostykę dostępności,
- jawne przyczyny fallbacku,
- lepszy dispatch,
- MFEM device selection.

### Etap 2 — środowisko CEED

Następnie wnieść:

- `fullmag_fem_gpu_patchset_container.patch`

To daje:

- CEED-enabled obraz,
- CEED-strict profil `fem-gpu`,
- brak małosiatkowego auto-fallbacku.

### Etap 3 — walidacja

Uruchomić smoke-testy z dołączonego skryptu:

- `verify_fem_gpu_enablement.sh`

### Etap 4 — właściwy refactor wydajnościowy

Dopiero po ustabilizowaniu runtime truth layer wchodzić w:

- partial assembly,
- libCEED operator path,
- demag field recovery na device,
- redukcję host-side staging.

## 9. Artefakty dostarczone razem z raportem

Dostarczam:

- gotowy raport Markdown,
- gotowy bundle ZIP z patchami i zmienionymi plikami,
- rozbite patche per plik,
- pełne pliki po zmianach,
- skrypt smoke-testów.

## 10. Moja końcowa ocena

To jest **właściwy i potrzebny etap**, jeśli chcesz w końcu doprowadzić FEM GPU do stanu używalności.

Największa wartość tego pakietu nie polega tylko na tym, że „włączy GPU”, ale na tym, że:

- usuwa najbardziej mylące fallbacki,
- daje prawdziwe provenance runtime’u,
- naprawia środowisko `fem-gpu`,
- przygotowuje repo pod właściwy drugi etap: **realny GPU-first FEM na partial assembly / libCEED**.

Gdybym miał wskazać jedną rzecz najważniejszą: **bez tego patchsetu dalszy debugging FEM GPU nadal będzie częściowo ślepy**. Z tym patchsetem wreszcie zobaczysz, czy problemem jest build, runtime, dispatch, czy już sama matematyka operatorów.

---

## Źródła użyte w audycie

### Repo Fullmag

- README: https://github.com/MateuszZelent/fullmag/blob/master/readme.md
- Runtime spec: https://github.com/MateuszZelent/fullmag/blob/master/docs/specs/runtime-distribution-and-managed-backends-v1.md
- FEM GPU note: https://github.com/MateuszZelent/fullmag/blob/master/docs/physics/0410-fem-exchange-demag-zeeman-mfem-gpu.md
- FEM bootstrap note: https://github.com/MateuszZelent/fullmag/blob/master/docs/physics/0520-fem-robin-airbox-demag-bootstrap-reference.md
- Compose: https://github.com/MateuszZelent/fullmag/blob/master/compose.yaml
- FEM GPU Dockerfile: https://github.com/MateuszZelent/fullmag/blob/master/docker/fem-gpu/Dockerfile
- FEM native CMake: https://github.com/MateuszZelent/fullmag/blob/master/native/backends/fem/CMakeLists.txt
- FEM API: https://github.com/MateuszZelent/fullmag/blob/master/native/backends/fem/src/api.cpp
- FEM MFEM bridge: https://github.com/MateuszZelent/fullmag/blob/master/native/backends/fem/src/mfem_bridge.cpp
- FEM C header: https://github.com/MateuszZelent/fullmag/blob/master/native/include/fullmag_fem.h
- Rust FFI: https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-fem-sys/src/lib.rs
- Rust build bridge: https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-fem-sys/build.rs
- Runner native FEM wrapper: https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-runner/src/native_fem.rs
- Runner dispatch: https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-runner/src/dispatch.rs
- Cargo features: https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-runner/Cargo.toml
- FEM sys Cargo: https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-fem-sys/Cargo.toml

### Dokumentacja zewnętrzna

- MFEM assembly levels: https://mfem.org/howto/assembly_levels/
- MFEM Device docs: https://docs.mfem.org/4.8/classmfem_1_1Device.html
- MFEM build docs: https://mfem.org/building/
- MFEM build-system docs: https://mfem.org/howto/build-systems/
- MFEM defaults / `CEED_DIR`: https://github.com/mfem/mfem/blob/master/config/defaults.cmake
- libCEED getting started: https://libceed.org/en/latest/gettingstarted/
- libCEED README: https://github.com/CEED/libCEED/blob/main/README.md
