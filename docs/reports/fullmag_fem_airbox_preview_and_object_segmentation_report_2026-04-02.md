# Raport: FEM AirBox / Universe Preview i błąd `object_segments`

Data: 2026-04-02

## Streszczenie

Znalazły się dwa powiązane błędy w ścieżce shared-domain FEM:

1. Dla quantity `m` (`Magnetization`) viewport 3D rysuje strzałki także w powietrzu / AirBoxie.
2. Po kliknięciu obiektu z drzewa (`nanoflower_left`) UI pokazuje błąd:
   `Object mesh segmentation unavailable for shared-domain FEM: 'nanoflower_left'`.

To nie są dwa niezależne bugi UI. Oba wynikają z niedomkniętej semantyki shared-domain FEM między plannerem, live payloadem API i frontendem preview.

Najważniejszy wniosek:

- dla shared-domain FEM musimy rozdzielić:
  - `global/domain mesh`,
  - `magnetic region`,
  - `object identity`.

Obecnie te trzy rzeczy są częściowo mieszane.

## Reprodukcja

Skrypt:

- [nanoflower_fem.py](/home/kkingstoun/git/fullmag/fullmag/examples/nanoflower_fem.py)

Reprodukcja lokalna:

1. Uruchomić `fullmag --dev -i examples/nanoflower_fem.py`.
2. W control room zostawić quantity `m`.
3. Wejść w `Objects` lub kliknąć `nanoflower_left`.
4. Obserwacje:
   - w `Domain Scope` widać strzałki w całym AirBoxie,
   - w `Object Scope` pojawia się komunikat o braku segmentacji obiektu.

## Ustalenia

### 1. Magnetyzacja jest traktowana jak pole zdefiniowane na całym shared-domain mesh

W plannerze FEM dla shared-domain mesh inicjalny stan `initial_magnetization` jest budowany dla wszystkich węzłów domeny:

- [fem.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-plan/src/fem.rs)

Aktualna logika:

- tworzy `initial = vec![[1.0, 0.0, 0.0]; domain_asset.mesh.nodes.len()]`,
- następnie nadpisuje tylko zakresy odpowiadające segmentom obiektów magnetycznych.

Konsekwencja:

- węzły powietrza pozostają z niezerową magnetyzacją `[1, 0, 0]`,
- więc już na poziomie danych startowych `m` w AirBoxie jest fizycznie błędne.

To jest błąd semantyczny planera, nie tylko renderera.

### 2. API preview dla FEM nie niesie maski „magnetic-only”

Mesh preview w runnerze:

- [preview.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-runner/src/preview.rs)
- [types.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-runner/src/types.rs)

Istotne fakty:

- `LivePreviewField` ma pole `active_mask`,
- ale `build_mesh_preview_field(...)` zawsze ustawia `active_mask: None`,
- więc dla preview typu `mesh` frontend nie dostaje żadnej informacji, które węzły należą do części magnetycznej, a które do air.

To jest drugi niezależny problem: nawet gdyby wartości w air były wyzerowane, UI dalej nie ma formalnego kontraktu opisującego „gdzie wolno rysować `m`”.

### 3. API fallback dla quantity `m` omija semantykę preview i bierze pełny `live_state.latest_step.magnetization`

Po stronie API:

- [preview.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-api/src/preview.rs)
- [main.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-api/src/main.rs)

`current_vector_field(current, "m")` robi dziś specjalny fallback:

- bierze `live_state.latest_step.magnetization`,
- zamienia to na `Vec<[f64; 3]>`,
- bez maski magnetycznej,
- bez filtrowania air region.

Następnie `build_spatial_preview_state(...)` buduje z tego mesh preview dla całego `fem_mesh`.

Konsekwencja:

- `m` jest traktowane jak „pełne pole na wszystkich węzłach mesha”,
- mimo że semantycznie magnetyzacja powinna być wizualizowana tylko w ferromagnetyku.

### 4. Renderer strzałek próbuje próbkować cały boundary mesh domeny

Po stronie web:

- [FemArrows.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/preview/r3f/FemArrows.tsx)

Aktualna logika:

- `sampleBoundaryNodes(...)` bierze wszystkie `boundaryFaces`,
- nie zna pojęcia `magnetic_only`,
- nie zna maski aktywnej dla FEM,
- nie odróżnia quantity `m` od pól takich jak `H_demag` czy `H_eff`.

Konsekwencja:

- jeżeli shared-domain mesh ma boundary airboxa, to próbkowanie naturalnie obejmuje też air,
- a ponieważ backend dostarcza niezerowe `m`, strzałki pojawiają się w przestrzeni poza nanoflowerem.

### 5. `object_segments` istnieją, ale używają innego identyfikatora niż UI

To nie jest przypadek „segmentów nie ma”. W aktywnym payloadzie live API segment istnieje.

Bezpośrednia obserwacja z:

- `GET /v1/live/current/state` na lokalnej sesji `session-1775122657150-565893`

pokazuje:

- `live_state.latest_step.fem_mesh.object_segments[0].object_id == "nanoflower_left_geom"`

Natomiast UI scope po kliknięciu obiektu używa:

- `nanoflower_left`

To tłumaczy błąd `Object mesh segmentation unavailable...`.

### 6. Źródło rozjazdu identyfikatorów: internal geometry asset name vs object name

Po stronie flat Python API:

- [world.py](/home/kkingstoun/git/fullmag/fullmag/packages/fullmag-py/src/fullmag/world.py)

`MagnetHandle._resolved_geometry()` nadaje geometrii nazwę:

- `f"{self._name}_geom"`

czyli dla obiektu `nanoflower_left` powstaje geometry asset:

- `nanoflower_left_geom`

Dalej:

- [problem.py](/home/kkingstoun/git/fullmag/fullmag/packages/fullmag-py/src/fullmag/model/problem.py)
- [fem.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-plan/src/fem.rs)

shared-domain asset pipeline oraz planner operują na `geometry_name`, więc segmenty dostają właśnie `_geom`.

Po stronie web:

- [shared.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/runs/control-room/shared.tsx)
- [ViewportPanels.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/runs/control-room/ViewportPanels.tsx)

object scope i overlaye porównują `segment.object_id` z `geometry.name` / scope id z buildera, które w praktyce odpowiadają nazwie obiektu:

- `nanoflower_left`

Konsekwencja:

- segmentacja jest obecna,
- ale kontrakt identyfikatorów jest niespójny,
- więc exact object isolation nie działa.

## Dlaczego to jest błędne fizycznie

Przy quantity `m`:

- w powietrzu nie ma magnetyzacji materiałowej,
- więc `m` nie powinno być tam wizualizowane.

W AirBoxie mogą być sensowne inne pola:

- `H_demag`
- `H_eff` tylko jeśli jego definicja w danej ścieżce obejmuje domain-wide field representation,
- `H_ext`

Ale `m` musi być ograniczone do regionu ferromagnetycznego.

To oznacza, że sam fakt istnienia shared-domain mesha nie uzasadnia rysowania `m` poza ciałem.

## Konsekwencje obecnego stanu

1. Preview `m` jest semantycznie błędny i może wprowadzać użytkownika w błąd fizyczny.
2. Shared-domain FEM wygląda jakby „ferromagnetyk zajmował całą domenę”, choć solverowo tak nie jest.
3. Exact object isolation w viewport nie działa mimo obecnej segmentacji.
4. UI pokazuje komunikat o braku segmentacji, choć realny problem to rozjazd nazw.
5. Poprzednie problemy z `Universe / object / mesh` wracają pod nową postacią, bo nadal nie ma jednego kontraktu:
   - co jest global domain,
   - co jest magnetic region,
   - jak nazywa się obiekt w runtime.

## Co trzeba naprawić

### A. Naprawa semantyki `m` w shared-domain FEM

#### A1. Nie wolno inicjalizować air nodes niezerową magnetyzacją

W plannerze:

- [fem.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-plan/src/fem.rs)

trzeba zmienić budowę `initial_magnetization` dla shared-domain mesh.

Docelowo:

- węzły należące do części magnetycznej dostają normalne `m0`,
- węzły air dostają jawnie:
  - albo `[0, 0, 0]`,
  - albo osobny stan „undefined outside magnetic region”.

Minimalny fix:

- ustawić air nodes na zero zamiast `[1,0,0]`.

Lepszy fix:

- rozdzielić:
  - `state_magnetization_values`
  - `magnetic_node_mask`

### A2. Mesh preview musi nieść maskę regionu magnetycznego

W runnerze:

- [types.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-runner/src/types.rs)
- [preview.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-runner/src/preview.rs)

trzeba dodać pełny kontrakt dla mesh preview:

- `active_mask` dla FEM mesh preview, albo
- nowe pole wprost, np. `magnetic_node_mask`.

Dla `m`:

- maska musi oznaczać tylko węzły należące do części magnetycznej.

Dla pól domain-wide:

- maska może być `None` albo pełna.

### A3. API nie może traktować `m` jak zwykłego pełnego vector field bez domeny

W API:

- [preview.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-api/src/preview.rs)
- [main.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-api/src/main.rs)

`current_vector_field(current, "m")` nie powinno zwracać jedynie samych wektorów.

Trzeba dodać semantykę:

- `quantity_domain = magnetic_only | full_domain`

lub przynajmniej:

- dla `m` dołączyć magnetic maskę do stanu preview.

### A4. Frontend musi respektować domenę quantity

W web:

- [FemArrows.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/preview/r3f/FemArrows.tsx)
- [FemMeshView3D.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/preview/FemMeshView3D.tsx)

trzeba rozdzielić rendering quantity:

- `m`:
  - strzałki tylko w magnetic region,
  - sampling tylko z magnetic nodes / magnetic boundary faces,
  - airbox nie może dostawać strzałek.
- `H_demag`, `H_ext`, ewentualnie `H_eff`:
  - mogą być renderowane domain-wide, jeśli backend je tak definiuje.

To powinno być jawne w modelu danych, a nie zakodowane w heurystykach UI.

## B. Naprawa `object_segments` / Object Scope

### B1. Trzeba ustalić jeden kanoniczny identyfikator obiektu w runtime

Obecnie istnieją co najmniej dwa identyfikatory:

- object / builder id: `nanoflower_left`
- geometry asset id: `nanoflower_left_geom`

To trzeba uporządkować kontraktowo.

Rekomendacja:

- `FemMeshObjectSegment` powinien nieść dwa pola:
  - `object_id` — kanoniczny identyfikator używany przez UI scope i selection,
  - `geometry_id` albo `geometry_name` — identyfikator techniczny assetu.

Nie należy przeciążać jednego pola `object_id` znaczeniem „czasem object, czasem geometry asset”.

### B2. Planner i asset pipeline powinny mapować segmenty na object id, nie na internal `_geom`

Po stronie Python + planner:

- [world.py](/home/kkingstoun/git/fullmag/fullmag/packages/fullmag-py/src/fullmag/world.py)
- [problem.py](/home/kkingstoun/git/fullmag/fullmag/packages/fullmag-py/src/fullmag/model/problem.py)
- [fem.rs](/home/kkingstoun/git/fullmag/fullmag/crates/fullmag-plan/src/fem.rs)

segmenty są dziś produkowane w oparciu o `geometry_name`.

Docelowo trzeba przenieść je na study object identity:

- `nanoflower_left`

`geometry_name` może zostać jako metadana pomocnicza, ale nie jako główny klucz dla viewportu.

### B3. Frontend powinien przestać zgadywać po nazwach

Po stronie web:

- [shared.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/runs/control-room/shared.tsx)
- [ViewportPanels.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/runs/control-room/ViewportPanels.tsx)

`object scope` nie powinien zależeć od równości stringów między builderem a runtime.

Powinno być:

- albo bezpośrednie `object_id` z runtime,
- albo jawna mapa `builder_object_id -> runtime_segment_id`.

Obecny stan jest kruchy, bo zależy od ukrytej konwencji nazewniczej `_geom`.

## C. Dodatkowe porządki, które warto zrobić od razu

### C1. Wprowadzić `quantity spatial domain`

Nowy kontrakt dla preview quantity:

- `magnetic_only`
- `full_domain`
- opcjonalnie `surface_only`

Przykładowo:

- `m` -> `magnetic_only`
- `H_demag` -> `full_domain`
- `H_ext` -> `full_domain`

To pozwoli spiąć backend, API i frontend jedną semantyką.

### C2. Dodać `magnetic_node_mask` lub `region_id_per_node`

Sam `object_segments` rozwiązuje object isolation, ale nie rozwiązuje wszystkiego dla quantities.

Do poprawnej wizualizacji przyda się jawny kontrakt:

- `magnetic_node_mask`

albo bogatszy:

- `node_region_id`
- `element_region_id`

Wtedy:

- `m` może być maskowane poprawnie,
- `Object Scope` może działać bez heurystyk,
- przyszłe pola domain-wide też będą jednoznaczne.

### C3. Nie używać bounds fallback do ukrywania błędów kontraktu

Jeśli exact segmentacja jest wymagana, a payload jej nie dostarcza zgodnie z kontraktem:

- UI powinno pokazać błąd kontraktowy,
- ale tylko wtedy, gdy segmentów rzeczywiście nie ma.

W obecnym przypadku problemem nie jest brak segmentacji, tylko błędny identyfikator.

## Proponowana kolejność wdrożenia

### Etap 1 — naprawa fizyki `m`

1. W plannerze FEM ustawić air nodes na zero zamiast domyślnego `[1,0,0]`.
2. Dodać test planera dla shared-domain mesh:
   - magnet nodes dostają `m0`,
   - air nodes dostają zero.

### Etap 2 — naprawa kontraktu preview

1. Rozszerzyć `LivePreviewField` dla mesh preview o magnetic maskę.
2. Uzupełniać tę maskę w `build_mesh_preview_field(...)`.
3. Przenieść maskę przez API do web session state.

### Etap 3 — naprawa renderingu `m`

1. `FemArrows` ma próbkować tylko magnetic nodes dla `m`.
2. W `Domain Scope` quantity `m` nadal może pokazywać cały obiekt magnetyczny, ale nigdy airbox.
3. Dodać regresję UI: przy quantity `m` brak strzałek poza ferromagnetykiem.

### Etap 4 — naprawa identyfikatorów segmentów

1. Dodać jawne `object_id` do segmentów runtime.
2. Zachować `geometry_name` tylko jako pole techniczne.
3. Przerobić mapping w webie na `object_id`, nie na `_geom`.

### Etap 5 — testy kontraktowe live API

Dodać testy, które pilnują:

1. `GET /v1/live/current/state` dla shared-domain FEM zawiera:
   - poprawny `fem_mesh.object_segments`,
   - `object_id` zgodny z builder tree,
   - poprawną maskę magnetyczną dla `m`.
2. Kliknięcie obiektu nie pokazuje już błędu `segmentation unavailable`.

## Testy, które trzeba dodać

### Planner / runner

1. Shared-domain FEM:
   - air nodes mają `m = 0`.
2. `FemMeshPayload`:
   - zawiera `object_segments` dla wszystkich obiektów,
   - segmenty mają publiczne `object_id`, nie tylko internal geometry id.

### API

1. `current_vector_field("m")` dla FEM:
   - zwraca dane z maską magnetic-only.
2. `build_spatial_preview_state(...)` dla `m`:
   - nie promuje air nodes do aktywnej wizualizacji.

### Web

1. `FemArrows` dla `m`:
   - nie renderuje arrow instances poza magnetic mask.
2. `Object Scope`:
   - `nanoflower_left` znajduje dokładny segment,
   - nie pokazuje błędu kontraktowego przy poprawnym payloadzie.

## Najkrótsza odpowiedź na pytanie „co tu jest źle?”

Są tu dwa rdzenie problemu:

1. Shared-domain FEM nadal traktuje `m` tak, jakby było polem zdefiniowanym na całym domain mesh, a nie tylko w ferromagnetyku.
2. Runtime segmenty obiektów używają technicznej nazwy geometrii (`*_geom`), podczas gdy UI operuje nazwą obiektu (`nanoflower_left`).

Dopóki te dwa kontrakty nie zostaną naprawione, AirBox i Object Scope będą dalej zachowywały się niespójnie.

## Rekomendacja końcowa

Nie naprawiać tego kolejnym frontendowym fallbackiem.

To trzeba domknąć kontraktowo w trzech warstwach:

1. planner:
   - poprawny stan `m` w air,
   - poprawne object ids,
2. API / preview:
   - maska magnetyczna dla mesh quantities,
3. UI:
   - rendering respektujący `quantity_domain` i exact object segmentation.

Tylko wtedy shared-domain FEM będzie jednocześnie:

- fizycznie poprawny,
- wizualnie uczciwy,
- i stabilny w `Universe / Global Mesh / Object Scope`.
