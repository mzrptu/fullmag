# Raport Diagnostyczny: `nanoflower_fem.py` i obsługa dwóch nanoflowerów w UI

Data: 2026-04-01

Zakres:
- przejście od początku skryptu Python do końca ścieżki: loader, builder draft, solver/planner, meshing, `Universe`, drzewko obiektów i wizualizacja 3D,
- wyjaśnienie, dlaczego w interfejsie pojawia się jeden obiekt zamiast dwóch,
- sprawdzenie nie tylko pierwszego błędu, ale też jego konsekwencji w kolejnych warstwach systemu.

## TL;DR

Najważniejszy wniosek jest taki, że są tu nałożone na siebie dwa różne problemy:

1. Screenshot bardzo wyraźnie nie odpowiada aktualnemu plikowi `fullmag/examples/nanoflower_fem.py`. Odpowiada natomiast prawie idealnie innemu przykładowi: `fullmag/examples/nanoflower_fdm.py`, który mimo nazwy używa backendu FEM, ma jeden obiekt `nanoflower`, manualny `Universe` 800 nm i jednorodne namagnesowanie `m ≈ (0.1, 0.0001, 0.99)`.
2. Nawet gdy załadujemy poprawny plik `nanoflower_fem.py`, wieloobiektowa ścieżka jest w Fullmag tylko częściowo domknięta. Parser i FEM planner potrafią utrzymać dwa obiekty, ale builder/UI/preview/round-trip do skryptu mają jeszcze kilka jednoobiektowych lub „mesh-bbox-first” założeń.

W skrócie: rdzeń problemu nie jest taki, że Python „nie widzi” dwóch geometrii. On je widzi. Problem polega na tym, że:

- w Twojej sesji UI najprawdopodobniej był załadowany inny skrypt niż ten aktywny w edytorze,
- a dodatkowo część warstw buildera i wizualizacji nadal nie reprezentuje poprawnie wieloobiektowego FEM `ImportedGeometry`.

## 1. Co naprawdę definiuje `nanoflower_fem.py`

Plik `fullmag/examples/nanoflower_fem.py` definiuje dwa osobne obiekty magnetyczne:

- `nanoflower_left`,
- `nanoflower_right`.

Wynika to wprost z:

- `add_nanoflower(...)` w `fullmag/examples/nanoflower_fem.py:21-35`,
- dwóch wywołań na końcu w `fullmag/examples/nanoflower_fem.py:38-39`.

Każdy obiekt dostaje:

- własną nazwę,
- własne przesunięcie w osi X,
- własny seed losowego stanu początkowego,
- własne wywołanie `mesh(hmax=2.5e-9, order=1).build()`.

W osi X odległość między środkami jest zdefiniowana jako:

- `FLOWER_PITCH_X = FLOWER_SPAN_X + FLOWER_GAP_X`,
- `FLOWER_OFFSET_X = 0.5 * FLOWER_PITCH_X`.

Z samych stałych w skrypcie wynika, że układ dwóch nanokwiatów ma minimalny całkowity rozmiar w X równy:

- `2 * 329.98683166503906 nm + 5 nm = 664.9736633300781 nm`.

To znaczy, że jakikolwiek widok „effective extent = 329.1 nm” opisuje co najwyżej pojedynczy nanokwiat, a nie cały układ z dwóch nanokwiatów.

## 2. Co loader naprawdę z tego skryptu buduje

Lokalna reprodukcja na tym repo pokazała:

```text
load_problem_from_script(nanoflower_fem.py):
- entrypoint_kind = flat_workspace
- magnets = ['nanoflower_left', 'nanoflower_right']
- n_magnets = 2

export_builder_draft(...):
- draft_geometries = 2
- universe = null
```

To jest spójne z kodem:

- `export_builder_draft(...)` serializuje `base_problem.magnets` do listy `geometries` w `fullmag/packages/fullmag-py/src/fullmag/runtime/script_builder.py:49-75`,
- frontendowy graph buduje `objects.items` z całej listy `builder.geometries` w `fullmag/apps/web/lib/session/modelBuilderGraph.ts:60-115`.

Czyli:

- Python loader widzi dwa obiekty,
- builder draft umie je wypisać jako dwa wpisy,
- model danych w frontendzie także umie mieć więcej niż jeden obiekt.

To od razu obala hipotezę „już parser Pythona gubi drugi obiekt”.

## 3. Screenshot nie pasuje do `nanoflower_fem.py`

To jest najważniejszy fakt diagnostyczny.

Screenshot pokazuje:

- jeden obiekt o nazwie `nanoflower`,
- manualny `Universe` z declared size `800.0 nm`,
- stan początkowy bliski `m = (0.10, 0.00, 0.99)`,
- badge `FEM`.

To bardzo dobrze zgadza się z innym przykładem:

- `fullmag/examples/nanoflower_fdm.py:15-19` ustawia `study.universe(... size=(800e-9, 800e-9, 800e-9) ...)`,
- `fullmag/examples/nanoflower_fdm.py:22-30` definiuje jeden obiekt o nazwie `nanoflower`,
- `fullmag/examples/nanoflower_fdm.py:35` ustawia `flower.m = fm.uniform(0.1,0.0001,0.99)`,
- `fullmag/examples/nanoflower_fdm.py:12` mimo nazwy pliku ustawia `study.engine("fem")`.

Lokalne sprawdzenie builder draft dla `nanoflower_fdm.py` potwierdziło:

```text
SCRIPT nanoflower_fdm.py
- entrypoint = flat_sequence
- universe = manual 800 nm
- geometries = ['nanoflower']
- magnetization = uniform [0.1, 0.0001, 0.99]
```

To oznacza, że najbardziej bezpośrednią przyczyną obserwacji „UI pokazuje tylko jeden nanokwiat” jest to, że UI najpewniej nie miało załadowanego pliku `nanoflower_fem.py`, tylko inną sesję albo inny plik, bardzo prawdopodobnie `nanoflower_fdm.py`.

## 4. Dodatkowy błąd: builder dla sekwencji `relax()+run()` pokazuje stan pierwszego stage, nie stan „kanoniczny”

To tłumaczy jeszcze jeden szczegół ze screena: `alpha = 1`.

`nanoflower_fdm.py` w kodzie ustawia materiałowe `flower.alpha = 0.1` w `fullmag/examples/nanoflower_fdm.py:34`.

Ale:

- `export_builder_draft(...)` bierze `base_problem = loaded.stages[0].problem if loaded.stages else loaded.problem` w `fullmag/packages/fullmag-py/src/fullmag/runtime/script_builder.py:49-50`,
- `relax(...)` domyślnie nadpisuje damping na `relax_alpha = 1.0` i robi to przez podmianę materiału tylko dla problemu relaksacyjnego w `fullmag/packages/fullmag-py/src/fullmag/world.py:1765-1812`.

W praktyce daje to taki efekt:

- dla plików typu `relax(); run();` builder draft bierze pierwszy stage,
- pierwszy stage ma już sztucznie podbite `alpha=1.0`,
- więc UI pokazuje `alpha=1` jako „Material & State”, mimo że bazowy materiał skryptu miał `alpha=0.1`.

To nie jest główna przyczyna problemu z dwoma nanokwiatami, ale jest bardzo ważnym skutkiem ubocznym: UI potrafi pokazywać stan pierwszego etapu relaksacji zamiast wiernej reprezentacji źródłowego modelu.

## 5. Gdzie wieloobiektowy przypadek jest obsługiwany poprawnie

Warto to odnotować precyzyjnie: obsługa nie jest „zerowa”. Jest po prostu nieciągła.

### 5.1. Python / builder data model

Tu wieloobiektowość działa:

- wiele wywołań `fm.geometry(...)` rejestruje wiele magnesów,
- `export_builder_draft(...)` eksportuje wszystkie obiekty,
- `createModelBuilderGraphV2(...)` tworzy `objects.items` dla wszystkich geometrii.

### 5.2. FEM planner

FEM planner ma już ścieżkę multi-body:

- łączy wiele meshy przez `merge_fem_meshes(...)` w `fullmag/crates/fullmag-plan/src/lib.rs:1788-1826`,
- przenosi segmentację obiektów przez `object_segments`,
- ma test potwierdzający dwa obiekty w FEM planie w `fullmag/crates/fullmag-plan/src/lib.rs:3000-3022`.

To znaczy, że po stronie planowania FEM rdzeń już rozumie scenariusz „dwa osobne obiekty magnetyczne”.

## 6. Gdzie wieloobiektowy przypadek zaczyna się psuć

### 6.1. Flat FEM mesh round-trip nadal wybiera tylko pierwszy magnes

Najbardziej konkretna luka w round-trip:

- `_render_mesh_workflow(...)` wybiera `target_var = magnet_vars[problem.magnets[0].name]` w `fullmag/packages/fullmag-py/src/fullmag/runtime/script_builder.py:829-850`.

To oznacza, że przy generowaniu kanonicznego skryptu z model buildera:

- blok `# Mesh` jest emitowany tylko dla pierwszego obiektu,
- drugi obiekt nie dostaje własnego `mesh(...)` w wygenerowanym skrypcie,
- mimo że źródłowy `nanoflower_fem.py` wywołuje `.mesh(...).build()` dla obu obiektów.

Lokalne sprawdzenie `rewrite_loaded_problem_script(nanoflower_fem.py)` potwierdziło dokładnie to:

```python
# Mesh
nanoflower_left.mesh(hmax=2.5e-09, order=1)
nanoflower_left.mesh.build()
```

Bez analogicznego bloku dla `nanoflower_right`.

To jest już realna utrata informacji przy round-tripie builder <-> skrypt.

### 6.2. Flat-script IR nie wspiera różnych ustawień mesh per obiekt

Dodatkowo Fullmag jawnie blokuje różne lokalne ustawienia mesh dla wielu obiektów w flat API:

- `fullmag/packages/fullmag-py/src/fullmag/world.py:1144-1164`.

Twój przypadek akurat przechodzi, bo oba nanokwiaty mają taki sam `hmax` i `order`, ale architektura nadal opiera się na zasadzie „jeden wspólny mesh hint dla całego flat skryptu”.

### 6.3. Globalne metadata mesh są nadal wyciągane z pierwszego obiektu

Przy zbieraniu metadata do UI:

- w flat API `primary_spec` jest brany z pierwszego skonfigurowanego obiektu w `fullmag/packages/fullmag-py/src/fullmag/world.py:1268-1320`.

Skutek:

- UI ma listę `per_geometry`,
- ale część globalnych mesh defaults nadal pochodzi tylko z jednego „primary” obiektu.

To nie usuwa drugiego nanokwiatu z listy, ale tworzy asymetrię: model danych jest wieloobiektowy, a część logiki mesh nadal traktuje pierwszy obiekt jako źródło prawdy.

## 7. Imported STL: bounds są opcjonalne i potrafią zniknąć całkowicie

To jest bardzo ważne dla preview, focusu, overlayów i `Universe`.

`_geometry_bounds(...)` dla `ImportedGeometry` robi:

- `load_surface_asset(geom.source)` w `fullmag/packages/fullmag-py/src/fullmag/runtime/script_builder.py:1704-1717`.

Ale:

- `load_surface_asset(...)` dla STL wymaga opcjonalnego pakietu `trimesh` w `fullmag/packages/fullmag-py/src/fullmag/meshing/surface_assets.py:22-29`,
- i ładuje `Path(source)` bez rozwiązywania względem katalogu skryptu w `fullmag/packages/fullmag-py/src/fullmag/meshing/surface_assets.py:42-65`.

To jest istotna asymetria architektoniczna, bo normalna ścieżka wykonawcza `Problem.to_ir()` rozwiązuje źródła geometrii względem `source_root` przed budową assetów w `fullmag/packages/fullmag-py/src/fullmag/model/problem.py:643-683`, ale builderowe liczenie bounds dla `ImportedGeometry` tego nie robi. W praktyce solver może jeszcze znaleźć poprawny plik STL, a builder draft / preview może równocześnie nie umieć policzyć bounds.

W tej konkretnej lokalnej reprodukcji `trimesh` nie jest zainstalowany, co zostało potwierdzone bezpośrednio:

```text
ImportError: trimesh is required for STL import/export helpers.
```

Skutek jest taki, że dla `ImportedGeometry` builder draft zwraca:

- `bounds_min = null`,
- `bounds_max = null`.

To jest problem kaskadowy, bo frontendowy overlay obiektów działa tylko wtedy, gdy umie dostać bounds:

- `extractGeometryBoundsFromParams(...)` zwraca `null`, gdy nie ma ani wyliczalnych prymitywów, ani `bounds_min/max`, w `fullmag/apps/web/components/runs/control-room/shared.tsx:280-341`,
- `buildObjectOverlays(...)` wtedy pomija taki obiekt całkowicie w `fullmag/apps/web/components/runs/control-room/shared.tsx:344-358`.

Czyli przed solve/remeshem:

- obiekt może być w drzewku,
- ale nie ma overlayu,
- nie działa poprawny focus/isolate/obrys bryły,
- UI nie ma wiarygodnego geometrycznego union box dla dwóch imported STL.

## 8. `Universe` w UI nie reprezentuje Universe, tylko bbox aktualnego mesh/grid

To jest osobny błąd semantyczny i dokładnie tłumaczy uwagę o osiach.

### 8.1. `worldExtent` w Control Room jest bboxem mesh/grid, nie builder universe

W `ControlRoomContext`:

- `meshExtent` pochodzi z `artifact_layout.world_extent`,
- a `worldExtent` dla FEM po prostu zwraca `meshExtent`,
- bez konsultacji z builderowym `universe`,
- w `fullmag/apps/web/components/runs/control-room/ControlRoomContext.tsx:711-738`.

### 8.2. `artifact_layout.world_extent` dla FEM jest liczone z bboxa samego mesha

W CLI formatting:

- `world_extent = [max-min]` pochodzi bezpośrednio z `fem_mesh_bbox(&fem.mesh)`,
- w `fullmag/crates/fullmag-cli/src/formatting.rs:263-285`.

Czyli `worldExtent` w UI jest fizycznie bboxem wygenerowanego mesha, a nie pojęciem `Universe`.

### 8.3. `UniversePanel` preferuje `worldExtent` nad declared universe

`UniversePanel` robi:

- `const effectiveExtent = ctx.worldExtent ?? declaredSize`,
- w `fullmag/apps/web/components/panels/settings/UniversePanel.tsx:44-45`.

Skutek:

- jeśli istnieje bieżący bbox mesha, to UI traktuje go jako „effective extent”,
- nawet gdy skrypt ma jawnie zadany większy `study.universe(...)`.

To dokładnie tłumaczy screenshot:

- `Declared size = 800 nm`,
- `Effective extent = 329.1 nm`.

Ten `329.1 nm` nie opisuje Universe. Opisuje rozmiar obiektu/mesha. To jest błąd interpretacji w UI.

### 8.4. 3D axes w FEM preview także biorą bbox geometrii, nie Universe

W `FemMeshView3D`:

- `handleGeometryCenter(...)` zapisuje `geomSize` z aktualnej geometrii w `fullmag/apps/web/components/preview/FemMeshView3D.tsx:668-676`,
- osie sceny są rysowane jako `SceneAxes3D worldExtent={geomSize}` w `fullmag/apps/web/components/preview/FemMeshView3D.tsx:838`.

Czyli:

- osie w widoku FEM 3D są rozmiarem aktualnego mesha/bboxa,
- nie są rozmiarem `Universe`,
- nie są też outer-domain/air-box, chyba że akurat mesh sam już zawiera air-box.

Twoja uwaga jest więc trafna: obecna implementacja myli „domain of current mesh geometry” z pojęciem „Universe”.

## 9. Co z solverem: czy dwa obiekty są wykonywalne?

Odpowiedź zależy od backendu i warstwy.

### 9.1. FDM

Nie:

- planner fazy 1 wprost wymaga jednego magnesu w `fullmag/crates/fullmag-plan/src/lib.rs:588-593`.

### 9.2. FEM

Tak, ale tylko częściowo domknięte end-to-end:

- FEM planner potrafi scalić wiele meshy i zbudować `object_segments`,
- ale builder/UI/preview/round-trip nie są jeszcze w pełni spójne z tym modelem.

W praktyce oznacza to:

- solver/planner FEM jest dalej niż UI,
- dlatego „backend coś potrafi”, ale „interfejs wygląda jakby tego nie wspierał”.

## 10. Główna sekwencja przyczynowo-skutkowa dla Twojego przypadku

Pełna ścieżka wygląda tak:

1. `nanoflower_fem.py` definiuje dwa osobne obiekty i Python loader ich nie gubi.
2. Builder draft także potrafi wyeksportować dwa obiekty.
3. Screenshot nie odpowiada temu plikowi; odpowiada jednoobiektowemu `nanoflower_fdm.py`, więc w sesji UI był najpewniej załadowany nie ten plik, który analizujesz w edytorze.
4. Nawet po załadowaniu poprawnego pliku UI ma luki:
5. dla imported STL często nie ma bounds, więc overlay/focus/derived union box znikają,
6. `Universe` w panelach i osiach jest mylony z bboxem mesha,
7. round-trip builder -> skrypt emituje mesh tylko dla pierwszego obiektu,
8. sekwencje `relax()+run()` potrafią jeszcze dodatkowo zanieczyścić builder draft parametrami z pierwszego stage, np. `alpha=1.0`.

## 11. Odpowiedź na pytanie „dlaczego interface widzi tylko jeden?”

Najbardziej precyzyjna odpowiedź brzmi:

- w pokazanej sesji interfejs najprawdopodobniej nie pracował na skrypcie `nanoflower_fem.py`, tylko na innym, jednoobiektowym skrypcie,
- a architektura builder/UI nadal ma kilka miejsc, w których wieloobiektowy FEM imported-geometry nie jest reprezentowany konsekwentnie.

Czyli:

- bezpośrednia przyczyna obserwacji ze screena: zły/stary skrypt w sesji,
- głębsza przyczyna systemowa: niepełna end-to-end obsługa multi-body w builderze, preview i semantyce `Universe`.

## 12. Najważniejsze konsekwencje praktyczne

Jeśli załadujesz poprawny `nanoflower_fem.py`, to oczekiwany stan docelowy powinien być taki:

- w `Objects` muszą być dwa wpisy: `nanoflower_left` i `nanoflower_right`,
- derived/preview bounds w osi X powinny obejmować co najmniej około `664.974 nm`, a nie `329.1 nm`,
- `Universe` nie może być raportowany przez bbox pojedynczego obiektu, jeśli semantycznie ma oznaczać przestrzeń całego układu,
- osie w 3D powinny odpowiadać domain/Universe, a nie tylko aktualnemu `geomSize`,
- round-trip builder -> skrypt nie może zredukować mesh workflow do pierwszego obiektu.

## Wniosek końcowy

`nanoflower_fem.py` nie jest gubiony na wejściu. Dwa nanokwiaty istnieją w modelu Pythona i mogą wejść do planera FEM. Problem jest wielowarstwowy:

- UI ze screena najpewniej pokazywał inną sesję niż analizowany plik,
- builder draft dla imported STL nie ma stabilnej informacji o bounds,
- `Universe` w control room jest dziś semantycznie utożsamiany z bboxem mesha,
- round-trip skryptowy nadal ma założenie „mesh blok do pierwszego magnesu”.

To nie jest jeden prosty bug. To jest rozjazd między:

- źródłowym skryptem,
- aktywną sesją UI,
- builder draft,
- semantyką `Universe`,
- i round-tripem builder <-> flat script.
