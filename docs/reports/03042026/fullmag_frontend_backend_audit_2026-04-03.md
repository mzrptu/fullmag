# Fullmag — audyt frontend + backend (stan repo na 2026-04-03)

## Zakres
Audyt obejmuje:
- backendowy pipeline FEM shared-domain mesh,
- kontrakt runtime/session między Python/Rust/frontend,
- aktualny frontend preview FEM/FDM i stan refaktoryzacji viewportu,
- spójność względem docelowego COMSOL-like workflow.

Źródła:
- najnowszy publiczny stan repozytorium GitHub,
- załączone przez użytkownika pliki frontendowe,
- analiza statyczna kodu (bez uruchamiania całego buildu i bez testu end-to-end runtime).

---

## Executive summary

### Werdykt ogólny
Nie, nie można jeszcze uczciwie powiedzieć, że „wszystko jest już dobrze” jednocześnie w frontendzie i backendzie.

Stan obecny jest jednak wyraźnie lepszy niż wcześniej:
- backend shared-domain FEM jest już architektonicznie sensowny,
- current FEM preview na HEAD repo jest już modularny i dużo dojrzalszy,
- kontrakt danych pod build/progress/mesh diagnostics został rozszerzony.

Najważniejsze: główne solverowo-meshingowe fundamenty są dziś znacznie lepsze niż warstwa authoringu i część workflow UI.

---

## Backend — co jest już dobre

### 1. Shared-domain FEM jest już first-class path
Repo nadal jawnie utrzymuje poprawny 3-warstwowy kontrakt FEM:
1. Universe mesh config,
2. Per-object mesh config,
3. Final shared-domain solver mesh.

To jest dobra semantyka i rdzeń całego systemu.

### 2. Runtime realnie materializuje shared-domain mesh asset
`problem.py` buduje `fem_domain_mesh_asset` przy `study_universe`, zamiast zostawiać ten model wyłącznie na poziomie deklaracji.

### 3. Local sizing jest już component-aware
`asset_pipeline.py` ma dziś realny field stack:
- object bulk,
- interface shell,
- transition shell,
- manual hotspots.

Dodatkowo current component-aware path używa geometrii komponentów jako źródła prawdy, zamiast starego coarse bbox-only mappingu jako głównej ścieżki.

### 4. Gmsh bridge rozumie component-aware field kinds
Po stronie `gmsh_bridge.py` są już rozpoznawane i konfigurowane component-scoped field kinds, w tym bulk / interface / transition.

### 5. Build contract został rozszerzony
`asset_pipeline.py` emituje structured progress events i summary zawierające:
- `mesh_build_started`,
- `mesh_build_phase`,
- `mesh_build_summary`,
- `effective_airbox_target`,
- `effective_per_object_targets`,
- `used_size_field_kinds`,
- `fallbacks_triggered`.

### 6. Frontend types i normalizer są na to gotowe
`apps/web/lib/session/types.ts` i `normalize.ts` mają już pola:
- `active_build`,
- `effective_airbox_target`,
- `effective_per_object_targets`,
- `last_build_summary`,
- `last_build_error`.

To znaczy, że sam kontrakt danych jest wyraźnie dojrzalszy niż dawniej.

---

## Backend — co nadal wymaga poprawy

### 1. Authoring nadal siedzi w modelu `mesh_defaults + mesh_override`
Po stronie `scene.rs` nadal podstawowym modelem jest:
- study-level `mesh_defaults`,
- per-object `mesh_override`.

To nadal jest starsza semantyka niż docelowe, jawne rozdzielenie:
- Universe mesh config,
- per-object mesh config,
- final shared-domain mesh.

To nie rozwala solvera, ale nadal powoduje dług architektoniczny w warstwie authoringu i builder graph.

### 2. Model builder graph nadal serializuje study mesh w stary sposób
`modelBuilderGraph.ts` dalej trzyma `study.mesh_defaults` i serializuje to jako `mesh`, a universe jako osobny node.
To nadal nie jest w pełni „mesh-first graph” zgodny z docelowym COMSOL-like modelem.

### 3. Flat API nadal używa dwóch nazw tej samej geometrii
`world.py` nadal buduje `_resolved_geometry()` z nazwą `*_geom`, ale `mesh_workflow.per_geometry` dalej wpisuje `geometry: handle._name`.
To już nie jest blocker, bo `asset_pipeline.py` ma alias lookup i to maskuje. Ale to nadal jest kruchy compatibility shim, a nie czysty kontrakt.

### 4. Planner nadal sygnalizuje miękki wyjątek dla planner-only path
`crates/fullmag-plan/src/mesh.rs` nadal zawiera planner note, że planner-only FEM przy `study_universe` i wielu magnetykach potrzebuje materialized shared-domain mesh asset, żeby air-box realnie trafił do solvera.

Praktycznie runtime path jest już dużo lepszy, ale twardy invariant „Universe => zawsze finalny shared-domain mesh asset” nie jest jeszcze wszędzie domknięty równie bezwzględnie.

### 5. Nie mam pełnego potwierdzenia end-to-end, że każdy structured progress event jest konsumowany do `mesh_workspace`
Typy i normalizer są gotowe, Python emituje eventy, ale bez pełnego przeglądu warstwy live session/control-plane nie podpisuję się jeszcze pod tezą, że cały łańcuch `stderr JSON -> backend state -> session snapshot -> modal/progress UI` jest już w 100% zamknięty.

---

## Frontend — co jest już dobre

### 1. FEM preview na HEAD repo jest już modularny
Aktualny `FemMeshView3D.tsx` na HEAD repo nie jest już starym monolitem.
Jest rozbity na:
- `ScientificViewportShell`,
- `FemViewportToolbar`,
- `FemViewportScene`,
- `FemPartExplorerPanel`,
- `FemContextMenu`,
- `FemSelectionHUD`,
- `ViewportOverlayManager`,
- `ViewportGizmoStack`.

To jest bardzo duży krok naprzód.

### 2. Jakość render pipeline jest lepsza niż wcześniej
Masz już:
- `renderPolicyV2`,
- quality profiles (`interactive`, `balanced`, `figure`, `capture`),
- odseparowane role renderowe dla surface / context / hidden edges / glyphs / selection shell / labels.

To porządkuje rendering dużo lepiej niż wcześniejsze lokalne decyzje w pojedynczych komponentach.

### 3. HSL/orientation logic wygląda sensowniej
Current HEAD liczy `effectiveShowOrientationLegend` i przekazuje to do gizmo stacku, więc logika „auto pokaż HSL sphere gdy kolorujesz orientacją” jest lepsza niż w starszym stanie.

### 4. Czarny bug strzałek jest najpewniej naprawiony w kodzie
Aktualny `FemArrows.tsx` na HEAD repo:
- dodaje biały bazowy atrybut `color` do geometrii template,
- używa `setColorAt(...)`,
- trzyma `instanceColor` i aktualizuje je jawnie.

Statycznie wygląda to jak poprawka dokładnie tego defektu, który wcześniej powodował czarne strzałki.

### 5. Explorer części i overlay HUD są sensownie rozdzielone
`FemPartExplorerPanel`, `FemSelectionHUD` i `FemViewportToolbar` są już osobnymi komponentami. To bardzo poprawia czytelność kodu i daje lepszą bazę pod kolejne iteracje UI.

---

## Frontend — co nadal wymaga poprawy

### 1. Załączone pliki i HEAD repo nie są w pełni zsynchronizowane
Najważniejsze odkrycie tego audytu: załączony `FemMeshView3D.tsx` nadal pokazuje starszy, duży komponent z inline toolbarami i absolutnymi overlayami, podczas gdy HEAD repo ma już wersję rozbitą na shell + toolbar + scene + overlay manager.

To oznacza, że przesłane pliki nie są w 100% tym samym stanem co obecny HEAD. W praktyce jako source of truth trzeba traktować repo HEAD.

### 2. Overlay manager nadal nie jest prawdziwym auto-layout engine
`ViewportOverlayManager` na HEAD:
- mierzy viewport,
- wybiera tylko tryb `full / compact / icon` po szerokości,
- układa sloty po stałych anchorach.

On nadal NIE:
- mierzy bboxów overlayów,
- nie wykrywa kolizji,
- nie przerzuca rzeczy do overflow,
- nie przestawia gizm w zależności od zajętości rogów.

Czyli responsywność jest poprawiona, ale jeszcze nie jest samoukładająca się.

### 3. Gizma nadal mają częściowo twarde pozycje
`ViewportGizmoStack` nadal podaje do `ViewCube` i HSL widgetów klasy w stylu:
- `top-3 right-3`,
- `bottom-5 right-5`,
- własne pozycjonowanie dla HSL sphere.

To oznacza, że gizma nadal żyją trochę obok layout managera, a nie w pełni wewnątrz jednego systemu układu.

### 4. Toolbar jest już lepszy, ale nie ma jeszcze prawdziwego overflow managera
Nowy `FemViewportToolbar` ma `compact`, popovery i sensowniejszy podział grup, ale nadal nie widać tam pełnego systemu typu:
- przenoszenie mniej ważnych grup do overflow,
- automatyczne redukowanie w oparciu o realną kolizję,
- rozmowa z layout managerem w oparciu o mierzone rozmiary.

### 5. Current preview nadal nie jest jeszcze „3ds Max / raytracing class”
Masz lepszą architekturę i lepsze role renderowe, ale nadal nie ma tu jeszcze pełnego high-end pipeline’u typu:
- SSR / SSAO / outline compositing,
- BVH-driven picking/hidden-line,
- postprocessing stack klasy premium,
- capture pipeline z oversamplingiem materiałowym i dedykowanym lighting preset.

Czyli kierunek jest dobry, ale „lepsze niż COMSOL i z jakością 3ds Max” to jeszcze następna fala prac.

---

## Ocena spójności frontend ↔ backend

### Co jest już spójne
- backend buduje shared-domain mesh,
- planner rozpoznaje ten asset,
- frontend ma `mesh_parts`, `object_segments`, `mesh_entity_view_state`,
- session/workspace mają pola na build intent i effective targets.

To jest już sensowny, jednolity kręgosłup.

### Co nadal nie jest spójne idealnie
- authoring/model graph nadal myśli częściowo starym modelem `mesh_defaults + mesh_override`,
- live build contract jest lepszy, ale nadal nie mam dowodu, że każdy event kończy w UI dokładnie tam, gdzie powinien,
- preview shell jest bardziej dojrzały niż layout manager overlayów,
- attachments nie są w pełni zgodne z HEAD repo.

---

## Ostateczny werdykt

### Backend
Backend FEM shared-domain jest już **mocny** i wchodzi w fazę stabilizacji, a nie dopiero „ratowania architektury”. Największe solverowe rzeczy są już w dużo lepszym stanie niż dawniej.

### Frontend
Frontend preview FEM jest już **realnie poprawiony** i na HEAD repo ma dużo lepszą architekturę niż dawniej, ale nie jest jeszcze skończony pod kątem:
- automatycznego układu overlayów,
- pełnej responsywności,
- premium-quality renderingu,
- absolutnej spójności z najnowszymi załącznikami.

### Całość
Nie powiedziałbym jeszcze: „wszystko jest dobrze”.
Powiedziałbym raczej:

> backend jest już blisko docelowego shared-domain FEM,
> frontend preview jest już na dobrej architekturze,
> ale authoring, overlay layout i pełne domknięcie build/progress UX nadal wymagają kolejnej fali dopracowania.

---

## Najważniejsze następne kroki

1. Domknąć warstwę authoringu tak, żeby `Universe mesh config` było first-class, a nie tylko pochodną `mesh_defaults`.
2. Zrobić prawdziwy `ViewportOverlayManager v2` z collision detection i overflow.
3. Dokończyć spięcie `mesh build progress` end-to-end aż do pewnego, widocznego UI state.
4. Dodać „premium capture path” dla FEM preview zamiast tylko poprawiać bieżący viewport interaktywny.
5. Ujednolicić source of truth: attachments / repo HEAD / generated frontend artifacts.

