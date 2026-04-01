# Study Builder Object Panels Gap Report

## Cel raportu

Ten raport opisuje, dlaczego nowe drzewo obiektowe:

- `Study`
- `Universe`
- `Objects`
- `nanoflower`
- `Geometry`
- `Material & State`
- `Mesh`

nie daje dziś pełnego, wygodnego i spójnego `details panel` dla konkretnego obiektu, mimo że wizualnie wygląda już jak nowy Study Builder.

Najważniejsza obserwacja:

- drzewo jest już obiektowe,
- selekcja obiektu i meshu działa,
- ale kontrakt danych oraz routing inspectora są nadal zbyt płaskie,
- więc `Mesh` i `Geometry` pod obiektem nie mają takiego samego poziomu narzędzi i szczegółów jak globalne panele.

To nie jest jeden bug. To jest luka architektoniczna między:

- nową nawigacją obiektową,
- a starym lub częściowo zubożonym kontraktem danych buildera.

## Executive Summary

Obecny stan:

- nowe drzewo `Objects / <object> / Geometry / Material & State / Mesh` jest poprawne jako struktura nawigacji,
- ale obiekt nie ma jeszcze pełnego własnego modelu paneli,
- per-object mesh jest obecnie tylko małym override nad globalnym meshem,
- geometria obiektu jest eksportowana jako płaski `geometry_kind + geometry_params`, a nie jako prawdziwy stack operacji,
- globalny mesh ma bogaty workspace i bogate panele, ale per-object mesh nie ma jeszcze odpowiednika tych danych po stronie backendu ani po stronie weba.

W praktyce oznacza to:

- klik w `Mesh` obiektu pokazuje tylko uproszczony panel,
- klik w `Geometry` obiektu nie daje pełnego object-control,
- backend nie dostarcza jeszcze pełnego per-object `details contract`,
- frontend nie ma jeszcze inspectora budowanego z prawdziwego modelu obiektu, tylko z szeregu wyjątków i projekcji.

Wniosek:

- nowe drzewo jest poprawnym kierunkiem,
- ale jeszcze nie jest semantycznie domknięte,
- bo `Object` nie jest jeszcze bytem pierwszej klasy w danych inspectora tak samo, jak jest nim w drzewie.

## Objawy widoczne w UI

### 1. `Mesh` pod obiektem jest uproszczony

Użytkownik oczekuje, że:

- po wejściu w `Objects -> nanoflower -> Mesh`
- zobaczy ten sam poziom szczegółowości co w globalnym `Mesh Defaults`,
- ale scoped tylko do tego obiektu.

Obecnie tak nie jest, bo panel per-object mesh pokazuje tylko:

- `mode = inherit | custom`
- `hmax`
- `order`
- `source`
- `build_requested`

Brakuje tam większości globalnych narzędzi:

- `algorithm_2d`
- `algorithm_3d`
- `optimize`
- `optimize_iterations`
- `hmin`
- `size_factor`
- `size_from_curvature`
- `size_fields`
- `operations`
- jakości meshu
- pipeline status
- capabilities
- adaptivity state
- historii generacji

### 2. `Geometry` pod obiektem nie daje pełnego object-control

Użytkownik oczekuje:

- panelu przesunięcia,
- obrotu,
- skali,
- stacku operacji,
- CSG,
- importu źródła,
- zarządzania nazwą, regionem, stanem, materiałem,
- pełnych narzędzi per obiekt.

Obecnie `Geometry` obiektu jest sprowadzone do:

- prostych wymiarów prymitywu,
- importu pliku,
- tłumaczenia,
- oraz bardzo ograniczonego edytora.

Brakuje:

- prawdziwego transform stacku,
- rotacji round-tripowanej przez backend,
- skali round-tripowanej przez backend,
- operacji `Union / Difference / Intersection` jako edytowalnych node'ów,
- semantycznych operacji z identyfikatorami i kolejnością,
- narzędzi zarządzania obiektem jako bytem fizycznym.

### 3. Druga kolumna nie jest jeszcze prawdziwym inspectorem obiektu

Nowe drzewo sugeruje, że:

- każdy node ma własny rich inspector,
- a w praktyce wiele node'ów jest tylko routowanych do starych, częściowo dopasowanych paneli.

To powoduje rozjazd między:

- strukturą drzewa,
- a realną głębokością edycji.

## Główna przyczyna

Główna przyczyna nie leży tylko w jednym komponencie Reacta.

Problem jest warstwowy:

1. backend eksportuje zbyt ubogi kontrakt per obiekt,
2. frontendowe typy dalej są płaskie,
3. graph `model_builder.v2` po stronie web jest nadal w dużej mierze projekcją legacy buildera,
4. inspector nie jest jeszcze registry-based po pełnych node kinds obiektu,
5. globalny mesh i globalny mesh workspace nie mają jeszcze odpowiedników per obiekt.

## Diagnoza techniczna

### A. Obiekt w graphie jest jeszcze zbyt płaski

W [apps/web/lib/session/types.ts](../../apps/web/lib/session/types.ts) `ModelBuilderGraphObjectNode` przechowuje dziś głównie:

- `id`
- `kind`
- `name`
- `label`
- `geometry: ScriptBuilderGeometryEntry`
- `tree`

To oznacza, że cały obiekt jest w praktyce wsadzony do jednego legacy payloadu `ScriptBuilderGeometryEntry`.

To jest za mało, żeby mieć:

- osobny semantyczny node geometrii,
- osobny node materiału,
- osobny node stanu początkowego,
- osobny node meshu z pełnym contractem,
- osobny node transformów / stacku operacji.

Wniosek:

- obiekt jest dziś obiektem głównie w drzewie,
- ale nie jest jeszcze obiektem w pełnym modelu inspectora.

### B. Per-object mesh jest zubożony w samym typie danych

W [apps/web/lib/session/types.ts](../../apps/web/lib/session/types.ts) `ScriptBuilderPerGeometryMeshEntry` zawiera tylko:

- `mode`
- `hmax`
- `order`
- `source`
- `build_requested`

To jest kluczowy powód, dla którego panel obiektu nie może być równy globalnemu mesh panelowi.

Globalny mesh (`ScriptBuilderMeshState`) ma dużo więcej:

- `algorithm_2d`
- `algorithm_3d`
- `hmax`
- `hmin`
- `size_factor`
- `size_from_curvature`
- `smoothing_steps`
- `optimize`
- `optimize_iterations`
- `compute_quality`
- `per_element_quality`
- adaptive mesh config

Per-object mesh tego po prostu nie ma.

Wniosek:

- frontend nie może pokazać pełnych zakładek per-object mesh,
- bo backendowy i typowy kontrakt tych pól nie niesie.

### C. Backend już częściowo ma bogatsze dane, ale ich nie eksportuje do builder draftu

W [packages/fullmag-py/src/fullmag/world.py](../../packages/fullmag-py/src/fullmag/world.py):

- `_mesh_spec_to_metadata(...)` potrafi zapisać bogate per-object dane,
- w tym:
  - `algorithm_2d`
  - `algorithm_3d`
  - `optimize`
  - `optimize_iterations`
  - `smoothing_steps`
  - `size_factor`
  - `size_from_curvature`
  - `compute_quality`
  - `per_element_quality`
  - `size_fields`
  - `operations`

oraz wkłada je do `mesh_workflow.per_geometry`.

To znaczy:

- runtime metadata już umie wyrazić znacznie więcej niż pokazuje dzisiejszy builder draft.

Ale w [packages/fullmag-py/src/fullmag/runtime/script_builder.py](../../packages/fullmag-py/src/fullmag/runtime/script_builder.py) `_export_geometry_mesh_entry(...)` eksportuje tylko:

- `mode`
- `hmax`
- `order`
- `source`
- `build_requested`

Wszystkie pozostałe pola są tracone.

To jest jedna z najważniejszych luk całego systemu.

Wniosek:

- backend już przechowuje bogatszą semantykę per-object mesh,
- ale nie przenosi jej do `script_builder` / `model_builder_graph`,
- więc frontend nigdy jej nie dostaje.

### D. Geometria obiektu nie jest jeszcze prawdziwym operation stackiem

W [packages/fullmag-py/src/fullmag/runtime/script_builder.py](../../packages/fullmag-py/src/fullmag/runtime/script_builder.py) `_export_geometry_kind_params(...)` redukuje geometrię do:

- `geometry_kind`
- `geometry_params`

To jest strata semantyki.

Przykłady:

- `Translate` jest składane do bazowego typu + pola `translate`,
- `Difference / Union / Intersection` są redukowane do symbolicznych opisów typów operandów,
- brak stabilnych `op_id`,
- brak pełnej listy operacji do edycji w UI,
- brak możliwości reorder / enable / disable operacji.

To powoduje, że panel geometrii nie może działać jak prawdziwy builder obiektowy.

### E. W geometrii jest nawet niespójność nazewnictwa round-tripu

W backendzie eksport geometrii używa pola:

- `translate`

W [packages/fullmag-py/src/fullmag/runtime/script_builder.py](../../packages/fullmag-py/src/fullmag/runtime/script_builder.py) `_export_geometry_kind_params(...)`.

Ale frontend w [apps/web/components/panels/settings/GeometryPanel.tsx](../../apps/web/components/panels/settings/GeometryPanel.tsx) czyta i zapisuje:

- `translation`

To oznacza realną niespójność round-tripu.

Dodatkowo:

- panel pokazuje także `rotation`,
- ale backendowy exporter/rewrite nie ma pełnego kontraktu obrotu dla obiektu.

Wniosek:

- część pól w geometry panel wygląda jak edytowalna,
- ale nie ma jeszcze pełnego, pewnego round-tripu przez backend.

### F. Inspector nadal routuje wiele node'ów do starych paneli

W [apps/web/components/panels/SettingsPanel.tsx](../../apps/web/components/panels/SettingsPanel.tsx):

- `obj-*` jest routowane do `GeometryPanel`,
- `geo-...-mesh` do `GeometryPanel panelMode="mesh"`,
- globalny mesh do osobnych paneli `MeshSettingsPanel` i `MeshPanel`.

To oznacza, że:

- `Mesh` obiektu nie ma własnego pełnego inspectora,
- tylko uproszczoną gałąź w `GeometryPanel`,
- `Object` nie ma własnego dashboardu z sekcjami typu:
  - `Overview`
  - `Geometry`
  - `Transforms`
  - `Material`
  - `Initial State`
  - `Mesh`
  - `Diagnostics`

Wniosek:

- drzewo jest nowe,
- ale inspector jest jeszcze posklejany z paneli starego buildera.

### G. Globalny mesh panel nie ma jeszcze odpowiednika per object

Globalny mesh korzysta z:

- [apps/web/components/panels/MeshSettingsPanel.tsx](../../apps/web/components/panels/MeshSettingsPanel.tsx)
- [apps/web/components/panels/settings/MeshPanel.tsx](../../apps/web/components/panels/settings/MeshPanel.tsx)

Te panele są zasilane przez:

- `meshOptions`
- `meshWorkspace`
- `meshQualityData`
- `meshCapabilities`
- `meshAdaptivity`
- `mesh_history`

czyli przez dane stricte globalne.

Per-object odpowiedników dziś nie ma:

- brak `object_mesh_workspace`
- brak `object_mesh_quality_summary`
- brak `object_mesh_pipeline_status`
- brak `object_mesh_capabilities`
- brak `object_mesh_history`

Wniosek:

- nawet jeśli frontend chciałby skopiować zakładki globalne 1:1 pod obiekt,
- nie ma jeszcze danych, które miałby tam pokazać.

### H. `model_builder.v2` po stronie web nadal jest projekcją legacy buildera

W [apps/web/lib/session/modelBuilderGraph.ts](../../apps/web/lib/session/modelBuilderGraph.ts):

- graph jest budowany z `ScriptBuilderState`,
- a nie z pełnego natywnego graphu obiektowego.

W [apps/web/lib/session/normalize.ts](../../apps/web/lib/session/normalize.ts):

- `normalizeModelBuilderGraph(...)` projektuje raw graph z powrotem przez `normalizeScriptBuilder(...)`,
- a następnie buduje `createModelBuilderGraphV2(projectedBuilder)`.

To jest bardzo ważne:

- webowy `model_builder.v2` nie zachowuje jeszcze pełnej niezależnej semantyki,
- tylko odtwarza graph z legacy draftu.

Wniosek:

- nawet jeśli backend zacznie wysyłać bogatszy graph,
- obecna normalizacja i typy weba nadal go spłaszczą,
- jeśli nie zostaną przebudowane.

### I. Manifest buildera po stronie Pythona nadal mówi o `model_builder.v1`

W [packages/fullmag-py/src/fullmag/model/problem.py](../../packages/fullmag-py/src/fullmag/model/problem.py):

- `build_problem_builder_manifest(...)` zwraca `schema_version = "model_builder.v1"`.

To nie jest bezpośrednia przyczyna problemu z per-object details,
ale pokazuje, że migracja modelu buildera nadal jest mieszana:

- UI myśli o `v2`,
- backend manifest buildera nadal jest `v1`,
- a część danych przechodzi jeszcze przez legacy draft.

## Co dziś działa poprawnie

Żeby raport był uczciwy: kilka rzeczy już działa dobrze.

- drzewo obiektowe jest czytelniejsze niż stare,
- selekcja obiektu działa,
- `Material & State` jest już zasadniczo per obiekt,
- `Mesh` obiektu ma własny node,
- highlight i focus obiektu działają,
- per-object FEM mesh selection ma już exact segmenty boundary faces.

To jest dobra baza.

Problem nie jest w tym, że nic nie działa.

Problem jest w tym, że:

- model danych obiektu nie został jeszcze domknięty do poziomu, który sugeruje samo drzewo.

## Co trzeba zrobić w backendzie

### 1. Rozszerzyć per-object mesh contract do pełnej postaci

Obecny `ScriptBuilderPerGeometryMeshEntry` musi zostać zastąpiony albo rozszerzony tak, aby niósł ten sam rdzeń konfiguracji co globalny mesh.

Minimalny target:

- `mode`
- `hmax`
- `hmin`
- `order`
- `source`
- `algorithm_2d`
- `algorithm_3d`
- `size_factor`
- `size_from_curvature`
- `smoothing_steps`
- `optimize`
- `optimize_iterations`
- `compute_quality`
- `per_element_quality`
- `size_fields`
- `operations`
- `build_requested`
- ewentualnie `adaptive_*` jeśli adaptivity ma być wspierane per obiekt

W praktyce backend już to częściowo ma w `mesh_workflow.per_geometry`, więc najważniejszy krok to:

- przestać tego niepotrzebnie obcinać w `script_builder.py`.

### 2. Eksportować pełne per-object mesh metadata do builder draftu

W [packages/fullmag-py/src/fullmag/runtime/script_builder.py](../../packages/fullmag-py/src/fullmag/runtime/script_builder.py) `_export_geometry_mesh_entry(...)` trzeba przepisać tak, aby:

- eksportował pełny per-object mesh config,
- a nie tylko mały override.

Bez tego frontend nigdy nie pokaże pełnych details.

### 3. Dodać per-object mesh workspace

Jeśli obiekt ma mieć naprawdę ten sam poziom szczegółowości co globalny mesh, backend musi umieć dostarczyć dane typu:

- `object_mesh_summary`
- `object_mesh_quality_summary`
- `object_mesh_pipeline_status`
- `object_mesh_capabilities`
- `object_mesh_history`

Najprostsza forma:

- `mesh_workspace` globalne zostaje,
- ale pojawia się dodatkowo:
  - `object_mesh_workspaces: Record<object_id, MeshWorkspaceState>`

To nie musi od razu oznaczać osobnego fizycznego meshowania każdego obiektu.
Na początek może to być:

- projekcja z globalnego workflow,
- plus submesh stats wyliczane dla danego obiektu.

### 4. Zamienić geometrię z płaskiego `geometry_kind + geometry_params` na operation stack

To jest warunek pełnego per-object geometry panelu.

Backendowy model powinien przechowywać:

- `geometry_stack: GeometryOp[]`

gdzie każda operacja ma:

- `op_id`
- `op_kind`
- `args`
- `enabled`

oraz rodziny operacji:

- `primitive_box`
- `primitive_cylinder`
- `primitive_ellipsoid`
- `imported_geometry`
- `translate`
- `rotate`
- `scale`
- `union`
- `difference`
- `intersection`

Bez tego nie da się zrobić sensownego panelu:

- transformów,
- reorderowania,
- stacku modyfikatorów,
- CSG.

### 5. Naprawić round-trip geometrii

Trzeba ujednolicić nazwy i semantykę:

- `translate` vs `translation`
- wprowadzić pełne `rotation`
- wprowadzić pełne `scale`
- nie gubić CSG do symbolicznych stringów

To jest konieczne, żeby to, co użytkownik ustawi w panelu obiektu:

- dało się zapisać do skryptu,
- odczytać z powrotem,
- i znów pokazać w UI.

### 6. Uczynić backendowy `model_builder.v2` prawdziwym source of truth

Backend nie powinien już projektować wszystkiego przez legacy `script_builder` draft.

Potrzebny jest natywny graph z node'ami:

- `study`
- `universe`
- `objects`
- `object.geometry`
- `object.material`
- `object.initial_state`
- `object.mesh`
- `current_modules`
- `outputs`

oraz rich payloadami node'ów.

## Co trzeba zrobić we frontendzie

### 1. Przestać traktować `obj-*` jako alias do `GeometryPanel`

W [apps/web/components/panels/SettingsPanel.tsx](../../apps/web/components/panels/SettingsPanel.tsx) `obj-*` powinno prowadzić do prawdziwego `ObjectPanel`, a nie do:

- `GeometryPanel`

Target:

- `ObjectPanel`
  - `Overview`
  - `Geometry`
  - `Transforms`
  - `Material & State`
  - `Mesh`
  - `Diagnostics`
  - `Focus / Isolate / Visibility`

### 2. Rozdzielić panele per node kind

Inspector powinien być registry-based:

- `object`
- `object.geometry`
- `object.material`
- `object.state`
- `object.mesh`
- `study.mesh_defaults`
- `study.physics`
- `study.universe`

Nie przez heurystyki typu:

- `if nodeId.startsWith("obj-")`
- `if nodeId.startsWith("geo-") && nodeId.includes("-mesh")`

bo to nie skaluje się wraz ze wzrostem głębokości modelu.

### 3. Dać per-object mesh panelowi te same sekcje co globalnemu meshowi

Nie oznacza to ślepego kopiowania globalnego panelu.
Ale obiektowy mesh powinien mieć co najmniej analogiczne sekcje:

- `Scope / Inheritance`
- `Mesher`
- `Sizing`
- `Size Fields`
- `Mesh Operations`
- `Quality`
- `Pipeline`
- `Preview / View`

Przykład:

- `Inherit from study`
- `Override for this object`
- `Reset to study defaults`

oraz pełny zestaw pól, jeśli obiekt jest w trybie `custom`.

### 4. Dodać per-object mesh workspace view model

Frontend ma dziś tylko:

- `meshWorkspace`

czyli globalny workspace.

Potrzebne jest:

- `selectedObjectMeshWorkspace`
albo
- `objectMeshWorkspaceById`

żeby druga kolumna mogła wyświetlić:

- jakość meshu tego obiektu,
- pipeline tego obiektu,
- preview tego obiektu,
- capabilities tego obiektu.

### 5. Przebudować `GeometryPanel`

Dzisiejszy [GeometryPanel.tsx](../../apps/web/components/panels/settings/GeometryPanel.tsx) łączy:

- trochę geometrii,
- trochę meshu,
- trochę starego stylu edycji.

To trzeba rozdzielić na co najmniej:

- `ObjectGeometryPanel`
- `ObjectMeshPanel`

oraz docelowo:

- `ObjectTransformPanel`
- `ObjectGeometryOpsPanel`

### 6. Przestać opierać obiekt na `scriptBuilderGeometries`

Dziś duża część frontendu nadal pracuje na:

- `scriptBuilderGeometries`

czyli legacy array.

Docelowo panele powinny używać:

- rich `modelBuilderGraph.objects.items[*]`

a nie odtwarzać stan z płaskiej listy geometrii.

### 7. Rozszerzyć normalizację graphu, żeby nie spłaszczała bogatszego backendowego modelu

W [apps/web/lib/session/normalize.ts](../../apps/web/lib/session/normalize.ts):

- `normalizeModelBuilderGraph(...)` nie może projektować wszystkiego przez `normalizeScriptBuilder(...)`,
- bo to zjada bogatszą semantykę obiektu.

To jest warunek konieczny dla nowego inspectora.

## Co powinno być uznane za “done”

Nowy object-oriented Study Builder można uznać za domknięty dopiero wtedy, gdy:

### Mesh per object

- `Objects -> nanoflower -> Mesh` ma pełny panel scoped do tego obiektu
- panel pokazuje wszystkie istotne opcje meshera, nie tylko `hmax/order`
- da się przełączać `inherit/custom`
- da się zobaczyć jakość i pipeline dla tego obiektu
- wskazany mesh jest precyzyjnie podświetlany w 3D

### Geometry per object

- `Objects -> nanoflower -> Geometry` pokazuje pełny geometry panel
- istnieje transform stack
- istnieje operation stack
- translacje, rotacje, skale i CSG round-tripują bez strat

### Material & state

- materiał i stan początkowy są wyraźnie osobnymi aspektami obiektu
- panel nie jest fallbackiem starego buildera, tylko częścią modelu obiektowego

### Graph/source of truth

- backend wysyła natywnego `model_builder.v2`
- frontend nie rekonstruuje go z legacy draftu
- rewrite skryptu używa pełnej semantyki obiektu

## Priorytety wdrożenia

### Priorytet 1

- rozszerzyć backendowy eksport per-object mesh do pełnych pól
- rozszerzyć typy webowe
- zbudować pełny `ObjectMeshPanel`

To da najszybciej odczuwalną poprawę UX.

### Priorytet 2

- wprowadzić prawdziwy `ObjectPanel`
- przestać routować `obj-*` do `GeometryPanel`

### Priorytet 3

- przejść z płaskiego `geometry_kind + geometry_params` na operation stack

To jest największa, ale też najważniejsza zmiana dla geometrii.

### Priorytet 4

- dodać per-object mesh workspace i quality views

## Rekomendacja końcowa

Nie należy “łatać” tego tylko przez dopisywanie kolejnych pól do `GeometryPanel`.

To byłoby kosztowne i dalej mieszałoby:

- geometrię,
- mesh,
- obiekt,
- globalny workspace,
- i legacy draft.

Najlepsza ścieżka to:

1. rozszerzyć backendowy kontrakt obiektu,
2. rozszerzyć `model_builder.v2` tak, by obiekt był pełnoprawnym node'em danych,
3. przepisać inspector na panele per node kind,
4. dopiero wtedy wyrównać szczegółowość `details` między globalnym a per-object.

## Najważniejsze pliki związane z problemem

Frontend:

- `apps/web/components/panels/SettingsPanel.tsx`
- `apps/web/components/panels/ModelTree.tsx`
- `apps/web/components/panels/settings/GeometryPanel.tsx`
- `apps/web/components/panels/settings/MaterialPanel.tsx`
- `apps/web/components/panels/MeshSettingsPanel.tsx`
- `apps/web/components/panels/settings/MeshPanel.tsx`
- `apps/web/lib/session/types.ts`
- `apps/web/lib/session/modelBuilderGraph.ts`
- `apps/web/lib/session/normalize.ts`
- `apps/web/components/runs/control-room/RunSidebar.tsx`

Backend:

- `packages/fullmag-py/src/fullmag/world.py`
- `packages/fullmag-py/src/fullmag/runtime/script_builder.py`
- `packages/fullmag-py/src/fullmag/model/problem.py`

## Konkluzja

Nowe drzewo obiektowe jest dobrym kierunkiem i jest lepsze od starego na poziomie struktury.

Ale dziś jeszcze:

- nie daje pełnego per-object details,
- nie daje pełnego per-object mesh control,
- nie daje pełnego per-object geometry control,
- bo model danych nadal jest częściowo płaski i częściowo legacy.

Żeby Study Builder naprawdę działał “per obiekt”, trzeba:

- podnieść obiekt do rangi pełnego node'a danych,
- rozszerzyć backendowy kontrakt,
- i dopiero wtedy rozbudować inspector tak, aby `Mesh` i `Geometry` obiektu miały tę samą klasę narzędzi co globalne panele, tylko scoped do wybranego obiektu.
