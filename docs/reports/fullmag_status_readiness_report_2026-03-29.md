# Raport gotowosci i brakow implementacyjnych — 2026-03-29

## Zakres przegladu

Przeczytane dokumenty:

- `docs/plans/active/MASTERPLAN-refactoring-2026-03-29.md`
- `docs/plans/active/interactive-runtime-design-2026-03-29.md`
- `docs/plans/active/script-model-builder-runtime-resolution-2026-03-29.md`
- `docs/plans/active/fullmag-local-launcher-and-live-ui-plan-2026-03-25.md`
- `docs/plans/active/fullmag-self-contained-production-distribution-plan-2026-03-27.md`
- `docs/reports/fullmag_preview_switch_latency_report.md`
- `docs/reports/fullmag_mumax_like_preview_plan.md`

Dodatkowo zestawiono to z aktualnym kodem:

- `crates/fullmag-cli/src/main.rs`
- `crates/fullmag-api/src/main.rs`
- `crates/fullmag-runner/src/interactive_runtime.rs`
- `apps/web/components/runs/control-room/ControlRoomContext.tsx`
- `apps/web/lib/useSessionStream.ts`
- `apps/web/lib/liveApiClient.ts`
- `packages/fullmag-py/src/fullmag/runtime/helper.py`
- `justfile`
- `.fullmag/local/bin/fullmag`

## Odpowiedz krotka

Mozemy isc dalej z kolejnym duzym etapem, ale nie powinnismy jeszcze zamykac tego obszaru jako “gotowy” ani “production-grade”.

Najuczciwsza ocena na dzis:

- **tak**: mamy juz realny fundament produktu i mozemy przejsc do kolejnego vertical slice,
- **nie**: nie mamy jeszcze domknietego celu “one app, all modes, product-grade FEM GPU, COMSOL-like builder UI”.

## Co jest juz realnie wdrozone

### 1. Interactive runtime przestal byc tylko cachem preview

To juz nie jest tylko plan. W kodzie istnieje:

- sekwencjonowany control stream `seq`,
- `control/wait`,
- persistent runtime preview dla FDM,
- persistent runtime preview dla FEM,
- runtime-backed execute path dla interactive `run/relax`,
- reconnect / fallback cache tylko jako droga przejsciowa.

Dowody w kodzie:

- `crates/fullmag-runner/src/interactive_runtime.rs`
- `crates/fullmag-runner/src/lib.rs`
- `crates/fullmag-cli/src/main.rs`
- `crates/fullmag-api/src/main.rs`

Wniosek:

- kierunek `mumax/amumax-like live backend owned by CLI` jest juz wdrozony jako dzialajacy slice,
- nie jest to juz wyłącznie koncepcja architektoniczna.

### 2. Preview latency zostalo istotnie poprawione

Wzgledem stanu opisanego w starych diagnozach mamy juz:

- brak starego pollingu preview co 200 ms jako glownej drogi,
- osobne eventy `snapshot` / `preview`,
- lzejszy transport,
- odchudzony renderer 3D,
- szybsze przejscia `m <-> H_*`,
- poprawione zachowanie w `awaiting_command`.

Wniosek:

- problem “preview jest dramatycznie wolne przez plumbing” zostal mocno ograniczony,
- pozostaly glownie koszty architektoniczne wyzszego rzedu, a nie oczywiste duplikacje payloadu.

### 3. Launcher zaczal byc script-driven

To tez jest juz prawda w kodzie:

- launcher czyta intent ze skryptu,
- `resolve-runtime-invocation` istnieje,
- wrapper `.fullmag/local/bin/fullmag` korzysta z runtime resolution,
- skrypt steruje wyborem runtime family.

Wniosek:

- kontrakt “skrypt jest zrodlem intencji” jest juz realny,
- ale jeszcze nie caly produkt jest domkniety na poziomie managed runtime i packagingu.

### 4. Session-local builder store juz istnieje

Nie ma juz tylko `sync ui -> rewrite .py` przez jednorazowy override.

Mamy:

- `export-builder-draft`,
- `POST /v1/live/current/script/builder`,
- session-local `script_builder` w snapshotach live,
- hydracje `Mesh` i `Solver` z builder store,
- `Sync UI To Script` jako finalize step nad builder state.

Wniosek:

- kierunek COMSOL-like “UI programuje model, skrypt jest projekcja” zostal zaczety poprawnie,
- ale obejmuje dopiero `mesh` i `solver`.

## Co nadal zostalo do zrobienia

### A. Najwazniejsze braki produktowe

To sa rzeczy, ktore nadal blokuja nazwanie systemu “all-in-one / production-grade”.

#### A1. Managed FEM GPU nadal nie jest domkniete jako domyslny produkt

Z dokumentacji produktowej nadal wynika, ze:

- FEM GPU jest jeszcze “developer-oriented and container-oriented”,
- brakuje pelnego host-owned bridge do managed runtime,
- brakuje production qualification dla FEM GPU.

To jest spojne z praktyka repo:

- `justfile` nadal ma jawne devowe sciezki typu `fem-gpu-headless`,
- sa jeszcze rozne build/export workflow dla FEM GPU,
- to nie jest jeszcze w pelni przezroczyste dla normalnego usera.

#### A2. FEM GPU nie jest jeszcze zamkniete jako runtime produkcyjny

Dokumentacja wprost zostawia otwarte:

- numeryczna zgodnosc z FEM CPU / FDM,
- stabilny przypadek `py_layer_hole_relax_150nm`,
- kwalifikacje do automatycznego wyboru przez launcher.

To oznacza:

- runtime resolution istnieje,
- ale nie powinnismy jeszcze traktowac `fem-gpu` jako “bezpieczny default dla usera”.

#### A3. Packaging i clean-machine acceptance nie sa domkniete

Z planu dystrybucyjnego nadal otwarte sa:

- portable/runtime-pack layout,
- relocatability,
- bundled Python + static web assets jako release,
- acceptance na czystej maszynie CPU/GPU,
- `ldd/readelf` checks dla finalnego artefaktu.

To znaczy:

- repo-local launcher dziala,
- ale produktowa dystrybucja jeszcze nie jest zamknieta.

### B. Najwazniejsze braki architektoniczne

#### B1. Monolity nadal sa bardzo duze

Aktualne rozmiary:

- `crates/fullmag-cli/src/main.rs`: **5392 LOC**
- `apps/web/components/runs/control-room/ControlRoomContext.tsx`: **1420 LOC**
- `crates/fullmag-api/src/main.rs`: **3314 LOC**

To jest mocny sygnal, ze masterplan refaktoryzacji nadal pozostaje aktualny.

Wniosek:

- mozemy budowac nowe funkcje,
- ale koszt utrzymania i ryzyko regresji beda rosly, jesli nie zaczniemy wreszcie rozbijac tych monolitow.

#### B2. Transitional fallbacki nadal zyja w runtime

W kodzie nadal istnieja:

- `interactive_preview_cache.json`,
- `preview/config/wait`,
- API-side fallback reconstruction sciezek preview.

To nie jest blad sam w sobie. To jest sensowna warstwa przejsciowa. Ale:

- ten obszar nie jest jeszcze finalnie uproszczony,
- nie jest jeszcze “clean architecture after migration”.

#### B3. Brakuje pelnego actor ownership runtime hosta

Dokument `interactive-runtime-design` sam wskazuje jako nadal otwarte:

- jedna actorowa petla ownership dla backend lifecycle,
- first-class runtime queries dla global scalar / energy display,
- wydzielenie runtime hosta z ogromnego `fullmag-cli/src/main.rs`.

To jest nadal prawdziwe.

### C. Najwazniejsze braki funkcjonalne w builder/UI

#### C1. Builder store obejmuje tylko `mesh` i `solver`

To jest juz dobry fundament, ale nadal nie mamy first-class session-local slices dla:

- `geometry`,
- `materials`,
- `study`.

W praktyce oznacza to:

- kierunek jest dobry,
- ale COMSOL-like model editing nie jest jeszcze kompletny.

#### C2. Rewrite nadal nie jest pelnym round-trip dla wszystkich konstrukcji

Dokument buildera zostawia otwarte:

- conflict-aware rewrite,
- lepsza obsluge advanced constructs,
- odchodzenie od fail-fast dla trudniejszych przypadkow.

To oznacza:

- dla glownych scenariuszy jest juz dobrze,
- dla bardziej zlozonych skryptow nadal moze zabraknac pelnego round-tripu.

### D. Najwazniejsze braki UX parity z `mumax/amumax`

#### D1. Global scalar display nie jest jeszcze first-class runtime query

Kod UI nadal liczy `selectedScalarValue` lokalnie z ostatniego `scalar_row`.
To jest sensowny fallback, ale nie jest to jeszcze:

- runtime-owned focused scalar query,
- rownorzedny display channel jak dla `m/H_*`.

#### D2. Preview parity jest mocno poprawione, ale nie jeszcze “zamkniete”

Najwazniejsze pozostalosci:

- O(N) rebuild przy realnej zmianie danych 3D,
- transitional cache fallback,
- czesc logiki nadal rozlozona miedzy API/CLI/frontend, a nie skupiona w jednym ownership modelu.

## Ocena dokumentacji: co jest aktualne, a co juz sie zestarzalo

### Dobrze zsynchronizowane z kodem

- `docs/plans/active/script-model-builder-runtime-resolution-2026-03-29.md`
- `docs/plans/active/interactive-runtime-design-2026-03-29.md` sekcja `Status wdrozenia`
- `docs/reports/fullmag_preview_switch_latency_report.md`

Te dokumenty dobrze oddaja dzisiejszy stan i sa dobrym zrodlem prawdy.

### Czesciowo nieaktualne / wymagajace refreshu

#### 1. `fullmag-local-launcher-and-live-ui-plan-2026-03-25.md`

Ten plan trafnie opisuje luki produktowe, ale ma tez juz fragmenty lekko nieaktualne:

- pisze, ze nie ma canonical `justfile` command surface,
- a w repo `justfile` juz istnieje i ma `build`, `run`, `run-interactive`, `control-room`, `package`.

Uczciwszy opis na dzis bylby:

- command surface juz istnieje,
- ale managed runtime UX i production packaging nadal nie sa domkniete.

#### 2. `interactive-runtime-design-2026-03-29.md`

Ten dokument ma dobry status wdrozenia, ale sama sekwencja etapow jest juz historyczna w kilku miejscach:

- formalnie opisuje FEM jako pozniejszy etap,
- podczas gdy w kodzie istnieje juz `InteractiveFemPreviewRuntime`.

Warto go zaktualizowac tak, by fazy odpowiadaly obecnemu stanowi wdrozenia, a nie pierwotnemu rolloutowi.

#### 3. `fullmag_mumax_like_preview_plan.md`

Status na koncu dokumentu jest juz czesciowo historyczny, bo wtedy persistent runtime byl jeszcze opisywany jako brakujacy dlug, a teraz w runnerze i CLI mamy juz realny slice live runtime dla FDM i FEM.

## Decyzja: czy mozemy isc dalej?

### Tak, ale pod jednym warunkiem

Mozemy isc dalej, **jesli “dalej” oznacza kolejny dobrze wybrany etap**, a nie oglaszanie, ze temat jest zamkniety.

### Nie, jesli “dalej” znaczy “uznajmy to za skonczone”

Nie zamykalbym jeszcze tego obszaru jako:

- kompletnego COMSOL-like model buildera,
- kompletnego all-in-one launcher/runtime story,
- produkcyjnie gotowego FEM GPU,
- finalnie zrefaktoryzowanej architektury interactive mode.

## Rekomendowana kolejnosc dalszych prac

### Sciezka 1 — najwyzszy ROI techniczny

1. Rozpoczac wreszcie **Faze 1 masterplanu refaktoryzacji**:
   - rozbicie `fullmag-cli/src/main.rs`,
   - rozbicie `fullmag-api/src/main.rs`,
   - rozbicie `ControlRoomContext.tsx`.
2. W ramach tego wydzielic prawdziwy `InteractiveRuntimeHost` actor.
3. Przy okazji usuwac transitional preview fallbacki.

To najbardziej zmniejszy ryzyko, ze nowe funkcje beda coraz trudniejsze do wdrazania.

### Sciezka 2 — najwyzszy ROI produktowy

1. Domknac **host-owned managed FEM GPU path**.
2. Zrobic **production qualification FEM GPU**.
3. Zrobic **packaged artifact acceptance** na clean machine.

To jest sciezka, jesli celem najblizszych tygodni jest “pokazac Fullmag jako jedno prawdziwe narzedzie”.

### Sciezka 3 — najwyzszy ROI UX/modeling

1. Rozszerzyc builder store o `geometry`, `materials`, `study`.
2. Przepiac tree UI na session-local builder graph.
3. Rozszerzyc canonical rewrite i conflict-aware sync.

To jest sciezka, jesli celem jest COMSOL-like authoring UX.

## Moja rekomendacja

Najrozsadniej teraz:

1. **nie zamykac tematu**,
2. **uznac fundament za wystarczajaco dobry, by isc dalej**,
3. jako nastepny etap wybrac:
   - albo refaktoryzacje ownership/runtime host,
   - albo productization FEM GPU,
   - albo rozszerzenie buildera na geometrie/materialy/study.

Jesli mialbym wskazac jedna najlepsza kolejna rzecz, to wybralbym:

**wydzielenie actorowego `InteractiveRuntimeHost` i rozbicie monolitow CLI/API/frontend**,  
bo to odblokuje i stabilnie podtrzyma wszystkie pozostale kierunki naraz.
