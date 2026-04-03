# Fullmag — plan implementacyjny per plik i per commit
## FEM shared-domain mesh / Build Selected / COMSOL-like workflow

Data: 2026-04-03

## 1. Najważniejsza decyzja architektoniczna

**Nie budujemy osobnych solverowych meshy dla `geo-*-mesh`.**

Dla FEM z Universe istnieje tylko **jedna kanoniczna siatka solverowa**:

- `fem_domain_mesh_asset`

`Build Selected` ma oznaczać:

- wybór **kontekstu strojenia** (`airbox`, konkretny obiekt, cały study domain),
- zapis tylko tych ustawień, które należą do wybranego kontekstu,
- potem przebudowę **tego samego jednego shared-domain mesh**.

To jest poprawne solverowo i zgodne z Twoim redesignem COMSOL-like.

**Nie robić teraz**:
- osobnego „partial solver mesh” tylko dla jednego obiektu,
- osobnego finalnego meshu dla `geo-nanoflower-mesh`,
- mieszania preview-mesh z solver-mesh.

---

## 2. Bezkompromisowa diagnoza aktualnego stanu

### Co jest już dobre

1. Shared-domain FEM jest już realnym artefaktem.
   - `problem.py` buduje `fem_domain_mesh_asset` przy obecnym `study_universe`.

2. Planner umie rozbić shared-domain mesh na logiczne części.
   - `mesh.rs` buduje `object_segments`, `mesh_parts`, `Outer Boundary` i `Interface`.

3. Frontend ma już sensowny stan wizualny.
   - `selected_entity_id`, `focused_entity_id`, `object_view_mode`,
     `air_mesh_visible`, `mesh_entity_view_state`.

4. Tree/UI są już dużo bliżej docelowego modelu.
   - `ModelTree` ma już osobny `Airbox`, `Outer Boundary` i osobne `Mesh` nody obiektów.
   - `MeshSettingsPanel` ma już COMSOL-like nazwy typu `Maximum element size`, `Minimum element size`.

5. Kanał progress/runtime jest już sensowny.
   - Python runtime potrafi emitować structured JSON progress przez `_progress.py`.

### Co nadal jest głównym problemem

1. **Local sizing dla obiektów nadal nie jest naprawdę region-aware.**
   - `asset_pipeline.py` w `_shared_domain_local_size_fields(...)` nadal buduje głównie `Box` fields.
   - To tłumaczy, czemu airbox vs nanoflower nadal zbyt często daje prawie równy mesh.

2. **Shared-domain meshing nadal traci część semantyki geometrii.**
   - `realize_fem_domain_mesh_asset(...)` konkatenruje komponenty do jednego `shared_domain_surface.stl`.
   - To utrudnia zachowanie stabilnej tożsamości powierzchni/interfejsów per geometria.

3. **Per-object recipes są przygotowane, ale nie są jeszcze porządnie dowiezione end-to-end.**
   - `realize_fem_domain_mesh_asset(...)` potrafi przyjąć `per_object_recipes`,
     ale `build_geometry_assets_for_request(...)` ich nie prowadzi jako first-class kontraktu.

4. **Authoring contract nadal jest za płaski.**
   - `ScriptBuilderPerGeometryMeshState` ma `hmax/hmin/growth_rate/...`,
     ale nie ma first-class:
     - `interface_hmax`
     - `interface_thickness`
     - `transition_distance`
     - `transition_growth`

5. **Komunikacja build intent jest jeszcze za uboga.**
   - `MeshCommandTarget` odróżnia dziś tylko `study_domain` i `adaptive_followup`.
   - Brakuje targetów typu:
     - `selected_object_mesh`
     - `selected_airbox_mesh`
     - `selected_domain_mesh`

6. **Workspace/session nie trzyma jeszcze pełnego kontraktu pod COMSOL-like build modal.**
   - Brakuje:
     - `active_build`
     - `effective_per_object_targets`
     - `last_build_summary`
     - `last_build_error`

---

## 3. Twardy invariant docelowy

Po tej fali zmian backend ma gwarantować:

1. Jeśli istnieje `study_universe`, to solve path FEM używa **wyłącznie** `fem_domain_mesh_asset`.
2. `Universe`, `Airbox`, `Object Mesh`, `Interfaces`, `Outer Boundary` są tylko różnymi widokami i kontekstami edycji tej samej finalnej siatki domenowej.
3. Finalny target element size jest liczony jako:

```text
H(x) = min(
  H_air_bulk(x),
  H_object_bulk_i(x),
  H_interface_i(x),
  H_transition_i(x),
  H_adaptive(x),
  H_manual_hotspots(x)
)
```

4. `airbox_hmax` steruje bulk airboxa.
5. `object bulk` steruje wnętrzem ferromagnetyka.
6. `interface refinement` steruje zagęszczeniem przy powierzchniach i granicach materiałowych.
7. `transition refinement` steruje przejściem od gęstego obiektu do rzadkiego airboxa.
8. `adaptive refinement` dopiero później dokłada dodatkowe zagęszczenia z solve/error field.

---

## 4. Plan wdrożenia per commit

---

## Commit 1 — zatrzymaj utratę semantyki geometrii w shared-domain mesh

### Cel
Usunąć najważniejsze źródło problemu: shared-domain meshing nie może opierać się wyłącznie na jednym „anonimowym” połączonym STL.

### Pliki
- `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py`
- `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`

### Zmiany

#### `asset_pipeline.py`
1. Dodać nową ścieżkę:
   - `realize_fem_domain_mesh_asset_from_components(...)`
   - zamiast tylko eksportować jeden `shared_domain_surface.stl`,
     przekazywać do bridge'a listę komponentów:
     - `geometry_name`
     - surface mesh / trimesh
     - bounds
     - mesh config

2. Zachować `shared_domain_surface.stl` tylko jako fallback/debug artifact,
   nie jako jedyne źródło semantyki.

3. Przenieść `bounds_by_name` z roli „głównego sposobu targetowania” do roli:
   - fallback,
   - diagnostyka,
   - sanity check.

#### `gmsh_bridge.py`
1. Dodać API w stylu:
   - `generate_shared_domain_mesh_from_components(...)`

2. Importować komponenty do Gmsha jako **osobne byty wejściowe**,
   żeby dało się zachować mapowanie:
   - `geometry_name -> volume tags`
   - `geometry_name -> interface surfaces`
   - `geometry_name -> outer surfaces`

3. Po fragmentacji z airboxem zachować tablice/mapy:
   - `component_volume_tags`
   - `component_surface_tags`
   - `interface_surface_tags`
   - `outer_boundary_surface_tags`

### Wynik po tym commicie
Backend po raz pierwszy naprawdę „wie”, które powierzchnie i które wolumeny należą do którego obiektu,
zanim jeszcze powstanie finalny tetra mesh.

### Definition of done
- Dla dwóch rozdzielonych obiektów runtime ma stabilne mapowanie `geometry_name -> volume tags`.
- Nie trzeba już klasyfikować obiektów tylko po bbox/centroid po fakcie, poza fallbackiem.

---

## Commit 2 — wymień `Box`-only local sizing na field stack oparty o geometrię

### Cel
Naprawić główny bug jakości meshu:
**airbox ma być rzadki, obiekt gęsty, interfejs jeszcze gęstszy, a przejście kontrolowane.**

### Pliki
- `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py`
- `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`

### Zmiany

#### `asset_pipeline.py`
1. Usunąć `_shared_domain_local_size_fields(...)` jako główny mechanizm.
2. Zastąpić go przez builder pól:
   - `_build_object_bulk_fields(...)`
   - `_build_interface_fields(...)`
   - `_build_transition_fields(...)`
   - `_build_manual_hotspot_fields(...)`

3. `Box` zostawić tylko jako fallback:
   - dla trudnych importów,
   - dla nieudanej rekonstrukcji surface groups,
   - ale z wyraźnym ostrzeżeniem diagnostycznym.

#### `gmsh_bridge.py`
1. Rozszerzyć `_configure_mesh_size_fields(...)` o nowe kindy:
   - `SurfaceDistanceThreshold`
   - `InterfaceShellThreshold`
   - `TransitionShellThreshold`
   - opcjonalnie `PhysicalSurfaceThreshold`

2. Oprzeć te pola na:
   - `Distance`
   - `Threshold`
   - ewentualnie `MathEval`
   które Gmsh już i tak w tym bridge’u wspiera.

3. Dla każdego obiektu liczyć:
   - `bulk_hmax`
   - `interface_hmax`
   - `interface_thickness`
   - `transition_distance`
   - `transition_growth`

### Ważna decyzja
W tej fazie **object overrides traktujemy jako refinement względem baseline**, nie jako dowolne lokalne „coarsening”.
To jest zgodne z obecnym mechanizmem `Min` background field i pasuje do Twojego głównego use-case:
- airbox rzadki,
- ferromagnetyk gęsty.

### Definition of done
- Zmiana `hmax` obiektu 2× daje mierzalną zmianę element count głównie wewnątrz obiektu i na jego interfejsie.
- Zmiana `airbox_hmax` 2× daje mierzalną zmianę głównie w powietrzu.
- Nie ma już prawie-równego meshu w całej domenie przy sensownych override’ach.

---

## Commit 3 — wprowadź first-class mesh semantics do authoringu

### Cel
Przestać ukrywać wszystko pod `hmax/hmin + generic size_fields`.
Model authoringu musi wyrażać to, czego naprawdę potrzebuje solver.

### Pliki
- `crates/fullmag-authoring/src/builder.rs`
- `crates/fullmag-authoring/src/scene.rs`
- `apps/web/lib/session/types.ts`
- `apps/web/lib/session/normalize.ts`
- `apps/web/lib/session/modelBuilderGraph.ts`

### Zmiany

#### `builder.rs`
Rozszerzyć `ScriptBuilderPerGeometryMeshState` o pola:

- `bulk_hmax: Option<String>`
- `bulk_hmin: Option<String>`
- `interface_hmax: Option<String>`
- `interface_thickness: Option<String>`
- `transition_distance: Option<String>`
- `transition_growth: Option<f64>`

Rozszerzyć `ScriptBuilderUniverseState` o:

- opcjonalnie `airbox_hmin`
- opcjonalnie `airbox_growth_rate`

#### `scene.rs`
1. Zachować istniejący view-state.
2. Nie mieszać go z build intent.
3. Dodać osobny stan dla aktywnego kontekstu meshu, np.:
   - `active_mesh_node_id`
   - albo trzymać to wyżej w session/UI, ale nie jako `selected_object_id`.

#### `types.ts`
1. Rozszerzyć typy TS dokładnie o te pola.
2. Dodać `MeshBuildIntent`:
   ```ts
   type MeshBuildIntent =
     | { mode: "all"; target: { kind: "study_domain" } }
     | { mode: "selected"; target: { kind: "study_domain" } }
     | { mode: "selected"; target: { kind: "airbox" } }
     | { mode: "selected"; target: { kind: "object_mesh"; object_id: string } };
   ```

#### `normalize.ts`
1. Znormalizować nowe pola authoringu.
2. Nie upychać nowych semantyk do starych `Record<string, unknown>`.

#### `modelBuilderGraph.ts`
1. Dodać helper:
   - `resolveMeshBuildIntentFromNodeId(nodeId, graph)`
2. Przestać traktować `study.mesh_defaults` jako jedyne źródło semantyki shared-domain mesh.
3. Serializacja ma nadal zachować kompatybilność, ale nie może gubić nowych mesh semantics.

### Definition of done
- Z poziomu scene/script builder można jawnie ustawić osobno:
  - airbox bulk,
  - object bulk,
  - interface shell,
  - transition shell.

---

## Commit 4 — domknij runtime/build contract między Pythonem, plannerem i session state

### Cel
Masz już dobrą komunikację runtime ↔ backend. Teraz trzeba ją usztywnić i uczynić wystarczającą dla build modala i diagnostyki.

### Pliki
- `packages/fullmag-py/src/fullmag/model/problem.py`
- `packages/fullmag-py/src/fullmag/_progress.py`
- `crates/fullmag-plan/src/mesh.rs`
- `apps/web/lib/session/types.ts`
- `apps/web/lib/session/normalize.ts`

### Zmiany

#### `problem.py`
1. `build_geometry_assets_for_request(...)` ma przekazywać do
   `realize_fem_domain_mesh_asset(...)` pełne per-object recipes, a nie tylko `mesh_workflow`.
2. Po buildzie publikować structured payload:
   - `effective_airbox_target`
   - `effective_per_object_targets`
   - `used_size_field_kinds`
   - `fallbacks_triggered`
   - `shared_domain_build_mode`

#### `_progress.py`
Nie zmieniać transportu.
Wykorzystać istniejący structured channel do eventów typu:
- `mesh_build_started`
- `mesh_build_phase`
- `mesh_build_summary`
- `mesh_build_failed`

#### `mesh.rs`
1. Zaostrzyć invariant:
   - jeśli `study_universe` istnieje, a solve path FEM nie ma `fem_domain_mesh_asset`,
     planner ma failować dla solve path zamiast tylko emitować miękką notę.
2. Zostawić current segmentation/packing, bo jest sensowne.
3. Nie rozbijać `Build Selected` na osobne solver meshe.

#### `types.ts`
Rozszerzyć `MeshWorkspaceState` o:
- `active_build`
- `effective_per_object_targets`
- `last_build_summary`
- `last_build_error`

Rozszerzyć `MeshPipelinePhaseState.status` o:
- `queued`
- `failed`

Rozszerzyć `MeshCommandTarget` o:
- `airbox`
- `object_mesh`

#### `normalize.ts`
Zmapować nowe payloady i nowe stany pipeline.

### Definition of done
- Backend po buildzie zawsze zwraca nie tylko summary globalne, ale też effective targety per part.
- Frontend może bez heurystyk wyświetlić:
  - co było budowane,
  - jakie targety weszły,
  - jaki fallback został użyty.

---

## Commit 5 — wprowadź prawidłową semantykę `Build Selected`

### Cel
Zrobić `Build Selected` poprawnie solverowo i czytelnie dla użytkownika.

### Pliki
- `apps/web/lib/session/modelBuilderGraph.ts`
- `apps/web/components/panels/ModelTree.tsx`
- plik od dispatchu komend mesh build w runtime/websocket layer
- ewentualnie `scene.rs` jeśli build intent ma być częściowo utrwalany

### Zmiany

1. `Build Selected` ma działać tak:

#### gdy zaznaczony jest:
- `geo-*-mesh`
  - target = `object_mesh`
  - zapisujemy override dla tego obiektu
  - przebudowujemy finalny `study_domain`

- `universe-airbox` / `universe-airbox-mesh`
  - target = `airbox`
  - zapisujemy parametry airboxa
  - przebudowujemy finalny `study_domain`

- `universe-mesh*` / `mesh*`
  - target = `study_domain`
  - przebudowujemy finalny `study_domain`

2. `Build All`
   - zawsze ignoruje lokalny fokus,
   - zawsze buduje pełny finalny shared-domain mesh.

3. `build_requested` na obiekcie:
   - może zostać jako tymczasowy trigger,
   - ale docelowo lepiej oprzeć build o jawny `MeshBuildIntent`,
     bo `build_requested: bool` jest za ubogie.

### Czego nie robić
- nie tworzyć oddzielnego solverowego cache dla każdego `geo-*-mesh`,
- nie wprowadzać osobnego partial final mesh artefact,
- nie używać `selected_object_id` jako substytutu mesh intent.

### Definition of done
- Klikam `geo-nanoflower-mesh` → `Build Selected` buduje study domain w kontekście nanoflowera.
- Klikam `universe-airbox-mesh` → `Build Selected` buduje study domain w kontekście airboxa.
- Solver nadal dostaje tylko jeden finalny shared-domain mesh.

---

## Commit 6 — dopiero teraz dopnij COMSOL-like UI

### Cel
Dopiero po naprawie solver semantics dopiąć ribbon/modal/panele.

### Pliki
- `apps/web/components/panels/MeshSettingsPanel.tsx`
- `apps/web/components/panels/ModelTree.tsx`
- nowy `MeshBuildModal.tsx`
- plik z ribbonem `Mesh`
- plik odpowiedzialny za dock log/progress

### Zmiany

#### `MeshSettingsPanel.tsx`
1. Usunąć panelowy build jako primary CTA.
2. Zostawić panel do:
   - edycji parametrów,
   - diagnostyki,
   - read-only `Last built`,
   - read-only `Effective mesh target`.

3. Zachować:
   - `Maximum element size`
   - `Minimum element size`
   - `Maximum growth rate`
   - `Curvature factor`
   - `Narrow region resolution`

4. Dodać first-class controls:
   - `Interface maximum element size`
   - `Interface thickness`
   - `Transition distance`
   - `Transition growth`

#### `ModelTree.tsx`
1. Zachować aktualny podział:
   - `Airbox`
   - `Outer Boundary`
   - `Mesh` per object
2. Uporządkować nazewnictwo:
   - `Mesh`
   - `Size`
   - `Quality`
   - `Pipeline`

3. Nie dodawać standalone object mesh artefact.

#### `MeshBuildModal`
Źródło prawdy:
- `command_status`
- `mesh_pipeline_status`
- `mesh_summary`
- `mesh_history`
- `engine_log`
- `active_build`
- `effective_per_object_targets`

### Definition of done
- UI dokładnie pokazuje:
  - co buduję,
  - jaki jest target,
  - jakie są effective target sizes,
  - ile elementów/nodes powstało per part.

---

## Commit 7 — acceptance tests, bez których nie wolno tego merge’ować

### Backend / Python
1. `airbox_hmax` 2×:
   - wyraźnie zmienia element count głównie w air.
2. `object bulk_hmax` 2×:
   - wyraźnie zmienia element count głównie w tym obiekcie.
3. `interface_hmax` 2×:
   - zagęszcza głównie near-interface shell.
4. Dwa obiekty z różnym `bulk_hmax`:
   - mają różne characteristic sizes.
5. Fallback `Box` path:
   - emituje ostrzeżenie diagnostyczne.

### Planner / Rust
1. `study_universe` + brak `fem_domain_mesh_asset`:
   - solve path failuje.
2. `shared_domain_mesh_with_air`:
   - `mesh_parts` zawsze mają:
     - air,
     - magnetic objects,
     - outer boundary,
     - interfaces.

### Frontend
1. `geo-nanoflower-mesh` → poprawny `MeshBuildIntent`.
2. `universe-airbox-mesh` → poprawny `MeshBuildIntent`.
3. `Build Selected` i `Build All` pokazują różne targety.
4. Modal i dock czytają te same dane.
5. Panel nie jest już kanonicznym entrypointem build.

---

## 5. Odpowiedź na pytanie o przebudowę tylko wybranego meshu

## Czy można przebudować tylko wybrany mesh?

### Tak — jako **selected-context rebuild**
To jest docelowe i poprawne.

### Nie — jako **osobny partial solver mesh**
Tego teraz nie wdrażać.

Powód:
- finalny FEM shared-domain mesh musi zostać konformalny,
- interfejsy i współdzielone węzły mogą się zmieniać po każdej zmianie lokalnej gęstości,
- więc solverowy wynik końcowy i tak musi być wspólny.

## Kiedy prawdziwy partial rebuild miałby sens?
Dopiero gdy pojawi się:
- lokalny remesh subdomeny,
- blokada interfejsów,
- rewalidacja globalnej zgodności,
- stitching / reconnection bez naruszenia conformality.

To jest osobna, dużo trudniejsza faza i **nie jest potrzebna**, żeby dojść do bardzo dobrego COMSOL-like workflow.

---

## 6. Priorytety bezkompromisowe

Kolejność musi być taka:

1. **Commit 1 + 2** — semantyka geometrii i local sizing  
2. **Commit 3 + 4** — kontrakt authoring/runtime/session  
3. **Commit 5** — prawidłowy `Build Selected`  
4. **Commit 6** — ribbon/modal/polish UI  
5. **Commit 7** — twarde acceptance

Jeśli zrobisz to w odwrotnej kolejności, skończysz z ładnym UI na nadal zbyt prymitywnym mesherze.

---

## 7. Mój finalny werdykt

Najważniejszy brak nie jest już dziś w tree ani w viewportcie.

Najważniejszy brak jest tutaj:

- shared-domain local sizing nadal jest za bardzo `bbox/Box-based`,
- shared-domain build nadal za wcześnie traci identyfikację komponentów,
- `Build Selected` nie ma jeszcze pełnego kontraktu intent/progress/diagnostics.

To właśnie trzeba teraz domknąć.

Jeśli Commit 1 i Commit 2 wyjdą dobrze, reszta układanki naprawdę zacznie przypominać COMSOL nie tylko wizualnie, ale też solverowo.
