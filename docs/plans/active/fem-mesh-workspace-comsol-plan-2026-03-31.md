# Plan wdrozenia: FEM Mesh Workspace i narzedzia inspekcji mesh (COMSOL-like)

**Data:** 2026-03-31  
**Status:** Draft  
**Powiazane dokumenty:**
- `docs/plans/active/fem-mesher-ui-capability-matrix.md`
- `docs/plans/active/fem-adaptive-mesh-refinement-plan.md`
- `docs/plans/active/fem-eigenmodes-and-analyze-plan-v1.md`

**Powiazane pliki kodu:**
- `apps/web/components/shell/RibbonBar.tsx`
- `apps/web/components/runs/control-room/ViewportPanels.tsx`
- `apps/web/components/runs/control-room/RunSidebar.tsx`
- `apps/web/components/panels/SettingsPanel.tsx`
- `apps/web/components/panels/settings/MeshPanel.tsx`
- `apps/web/components/panels/MeshSettingsPanel.tsx`
- `apps/web/components/preview/FemMeshView3D.tsx`
- `apps/web/components/preview/FemMeshSlice2D.tsx`
- `apps/web/components/preview/r3f/FemGeometry.tsx`
- `apps/web/lib/session/types.ts`
- `crates/fullmag-api/src/types.rs`
- `crates/fullmag-cli/src/orchestrator.rs`
- `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`
- `packages/fullmag-py/src/fullmag/meshing/remesh_cli.py`

---

## 0. Cel

Zbudowac pelnoprawny **Mesh Workspace** dla FEM, ktory:

- pokazuje rzeczywisty **volume mesh**, a nie tylko skorupke powierzchniowa,
- daje sensowne narzedzia inspekcji 3D i 2D,
- prowadzi uzytkownika przez pipeline `import -> classify -> generate -> optimize -> validate -> solve`,
- daje wiecej informacji zwrotnej z backendu,
- umozliwia automatyczny precompute / auto-optimize / auto-coarsen,
- odchodzi od twardo zakodowanego modelu widokow na rzecz deklaratywnego kontraktu workspace.

Docelowo ma to byc kierunek **COMSOL-like**, ale w wersji stopniowo wdrazanej, a nie jednorazowy redesign.

---

## 1. Diagnoza obecnego stanu

### 1.1 Co juz mamy

- Mamy podstawowy model builder z zakladkami `Mesh`, `Study`, `Results`.
- Mamy reczny `remesh` z podstawowymi opcjami Gmsh:
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
- Mamy podstawowe quality metrics i histogramy.
- Mamy w viewerze fundament pod:
  - `surface`
  - `surface+edges`
  - `wireframe`
  - `points`
- Mamy juz pierwsza wersje przekroju przez tetra mesh i pierwsza wersje wireframe tetraedrow.
- Mamy ukryty runtime safety feature: auto-coarsen po przekroczeniu budzetu RAM.

### 1.2 Co jest realnie niedorobione

| Obszar | Stan teraz | Problem |
|---|---|---|
| Model widokow | Rozsiany po `RibbonBar`, `ViewportPanels`, `MeshPanel`, `RunSidebar` | Zachowanie jest hardcoded i trudne do rozszerzania |
| 3D mesh preview | Kilka trybow renderu, ale bez sensownego workflow | Brakuje cutaway, clip, izolacji domen, presetow diagnostycznych |
| 2D mesh preview | Jest techniczny slice, ale bez dobrego UX | Przekroj nie daje analizy porownywalnej z COMSOL |
| Selekcja | Glownie face-level | Brakuje wyboru elementu, domeny, materialu, regionu, zlych elementow |
| Inspector | Bardzo plytki | Za malo danych topologicznych, geometrycznych i solverowych |
| Backend feedback | Prawie tylko log tekstowy | Brakuje jawnych faz pipeline i progresu |
| Auto-precompute | Tylko ukryty auto-coarsen RAM safety | Brakuje jawnego, konfigurowalnego pipeline optymalizacji |
| Quality workflow | Jednorazowy raport po remesh | Brakuje compare before/after, list problem elements, focus tools |
| Local refinement UX | Praktycznie brak | Nie ma size fields, region constraints, refinement studies |

### 1.3 Najwazniejszy problem architektoniczny

Najwiekszym dlugiem technicznym nie jest sam shader albo slice, tylko to, ze **Mesh Workspace nie ma jednego modelu stanu i jednego kontraktu widokow**.

W praktyce:

- toolbar `View` jest hardcoded,
- boczne zakladki `mesh / quality / mesher` sa polaczone recznie z konkretnymi node id,
- viewport bar sam decyduje, ktore kontrolki pokazac,
- viewer i inspector nie sa opisane jednym wspolnym typem `mesh inspection mode`.

Dopoki tego nie uporzadkujemy, kazdy nowy tryb bedzie kolejnym if-em.

---

## 2. Docelowy model produktu

Mesh Workspace powinien byc osobnym, pierwszoklasowym srodowiskiem pracy, zlozonym z 5 warstw:

1. **Mesh Navigation**
   lewy model tree + pipeline tree + historia kolejnych meshy

2. **Mesh Inspector**
   panel parametrow, diagnostyki i informacji o zaznaczeniu

3. **Mesh Viewport**
   3D / 2D / cutaway / quality / compare

4. **Mesh Pipeline Console**
   fazy backendu, progres, warningi, auto-decisions, artifacty

5. **Mesh Actions**
   generate, optimize, validate, compare, export, auto-precompute

To ma byc oddzielone od zwyklego preview pola magnetyzacji. Mesh nie powinien byc tylko wariantem `viewMode`.

---

## 3. Narzedzia, ktore musimy zbudowac

## 3.1 View System i nawigacja workspace

### Cel

Usunac hardcoded dropdown / ribbon behavior i zastapic go jawna rejestracja trybow widoku.

### Co budujemy

- `MeshViewRegistry`
  - deklaracja dostepnych trybow:
    - `surface`
    - `surface+edges`
    - `wireframe`
    - `points`
    - `clip`
    - `cutaway`
    - `slice-2d`
    - `quality-heatmap`
    - `domain-coloring`
    - `material-coloring`
    - `bad-elements`
    - `compare-before-after`
- `MeshWorkspaceMode`
  - jeden stan opisujacy:
    - glowny layout
    - tryb renderu
    - aktywne overlaye
    - typ selekcji
    - czy pokazujemy dane quality
    - czy pokazujemy pipeline diagnostics
- toolbar oparty o registry, a nie o hardcoded przyciski
- preset system:
  - `Inspect Surface`
  - `Inspect Volume`
  - `Slice`
  - `Quality`
  - `Optimize`
  - `Compare`

### Efekt

Dodanie nowego trybu ma oznaczac wpis do registry, a nie edycje 4 komponentow na raz.

---

## 3.2 Pelny 3D Mesh Inspector

### Cel

Zamienic obecny viewer w prawdziwe narzedzie inspekcji mesha objetosciowego.

### Co budujemy

- tryby renderu:
  - surface
  - surface + edges
  - volume wireframe
  - points
  - transparent solid
  - cutaway box
  - single-plane clip
  - dual-plane clip
- overlaye:
  - node ids
  - element ids
  - boundary markers
  - domain coloring
  - material coloring
  - element quality coloring
  - SICN / gamma heatmap
  - invalid / degenerate / inverted elements
- narzedzia izolacji:
  - isolate selected domain
  - hide boundary
  - show only bad elements
  - show only selected region
  - ghost mode dla reszty mesha
- kamera i manipulacja:
  - orthographic / perspective
  - snap to axis
  - fit to selection
  - save / restore camera preset

### Dlaczego to potrzebne

Sam wireframe nie wystarczy. Uzytkownik musi zobaczyc:

- czy wnetrze jest rzeczywiscie wypelnione,
- jak gestosc elementow zmienia sie w objetosci,
- gdzie sa slabe elementy,
- jak mesh ma sie do domen, materialow i granic.

---

## 3.3 Sensowny 2D Slice Workspace

### Cel

Zrobic z 2D slicera narzedzie analizy, a nie tylko awaryjny podglad.

### Co budujemy

- slicer oparty o ciecie tetraedrow, z prawdziwa geometria przekroju
- ciagly offset plaszczyzny, nie tylko dyskretny `sliceIndex`
- manipulatory:
  - wybor `XY / XZ / YZ`
  - offset slider
  - numeric offset input
  - snap to center / min / max / selected feature
- warstwy rysunku:
  - filled cross-section
  - element outlines
  - selected elements
  - domain boundaries
  - quality heatmap
  - scalar/vector overlay
- narzedzia analityczne:
  - probe punktowy
  - probe liniowy
  - histogram quality dla aktualnego przekroju
  - licznik elementow przecinanych przez plaszczyzne
  - min/max local element size
- widok techniczny:
  - siatka osi
  - skala w nm / um / mm
  - eksport SVG / PNG przekroju

### Efekt

Przekroj ma pomagac odpowiedziec na pytanie:

- co dzieje sie w srodku,
- gdzie mesh jest za gruby / za drobny,
- gdzie sa problematyczne elementy.

---

## 3.4 Narzedzia selekcji i szczegolowego inspectora

### Cel

Rozszerzyc selekcje z samej powierzchni na rzeczywisty model FEM.

### Co budujemy

- typy selekcji:
  - node
  - edge
  - face
  - element
  - region
  - domain
  - material
  - boundary set
  - quality bucket
- inspector szczegolowy:
  - id
  - typ elementu
  - lista node ids
  - lokalny rozmiar elementu
  - jacobian / orientation
  - aspect ratio
  - SICN
  - gamma
  - objetosc / pole / perimeter
  - marker domeny / materialu / boundary
  - sasiedztwo
- akcje z inspectora:
  - center on selection
  - isolate
  - grow selection
  - select neighbors
  - select same domain
  - highlight low quality around selection

### Efekt

Mesh inspector ma odpowiadac na pytanie "co to jest?" i "dlaczego to jest problemem?" bez schodzenia do logu.

---

## 3.5 Mesh Details / Diagnostics Panel

### Cel

Obecna zakladka `Mesh` ma pokazywac duzo wiecej informacji zwrotnej.

### Co budujemy

- sekcja `Topology`
  - nodes
  - elements
  - boundary faces
  - element types
  - FE order
  - hmax/hmin effective
  - bbox / extent
- sekcja `Distribution`
  - elements per domain
  - nodes per domain
  - boundary faces per marker
  - size histogram
  - volume histogram
- sekcja `Quality`
  - SICN min/mean/p5
  - gamma min/mean
  - inverted count
  - sliver count
  - worst N elements
- sekcja `Solver Compatibility`
  - RAM estimate
  - backend compatibility
  - warning for dense CPU
  - warning for unsupported order / huge mesh
- sekcja `Mesh Provenance`
  - source geometry
  - mesher backend
  - generation timestamp
  - remesh options used
  - optimization steps applied

### Efekt

Uzytkownik powinien widziec nie tylko "ile elementow jest", ale tez "czy ten mesh jest sensowny i jak powstal".

---

## 3.6 Mesh Pipeline Feedback z backendu

### Cel

Przestac opierac UI glownie na surowym logu tekstowym.

### Co budujemy po stronie kontraktu

- jawny `mesh_pipeline_status`
- lista faz:
  - `import`
  - `surface_classification`
  - `surface_repair`
  - `geometry_creation`
  - `volume_generation`
  - `optimization`
  - `quality_extraction`
  - `validation`
  - `solver_compatibility_estimation`
  - `precompute_complete`
- dla kazdej fazy:
  - status
  - start time
  - end time
  - duration
  - warnings
  - metrics
  - generated artifacts

### Co budujemy po stronie UI

- timeline / stepper pipeline
- live progress bar
- warnings box
- "why did we do this?" info przy auto-decisions
- rozwijany szczegol fazy
- link do artifactow:
  - full VTK
  - quality CSV
  - bad-elements list
  - debug snapshot

### Efekt

Uzytkownik widzi nie tylko finalny wynik, ale tez *co backend zrobil po drodze*.

---

## 3.7 Automatyczny precompute / optimize / validate

### Cel

Przeksztalcic "Generate Mesh" z pojedynczego przycisku w sterowalny pipeline.

### Co budujemy

- tryby uruchamiania:
  - `Generate only`
  - `Generate + Optimize`
  - `Generate + Validate`
  - `Generate + Optimize + Validate`
  - `Auto`
- polityki `Auto`:
  - extract quality always
  - run smoothing if SICN p5 < threshold
  - run optimizer if inverted/sliver count > 0
  - auto-coarsen if solver RAM budget exceeded
  - optionally suggest local refinement if quality hotspots are localized
- wynik precompute:
  - summary card:
    - before
    - after
    - co zostalo poprawione
    - co nadal jest ryzykiem

### Wazna uwaga

`auto-coarsen` juz istnieje w runtime, ale tylko jako ukryty safety path. Trzeba go:

- ujawnic w UI,
- opisac jako decyzje pipeline,
- dac mozliwosc wlaczenia / wylaczenia / ograniczenia.

---

## 3.8 Narzedzia lokalnej kontroli siatki

### Cel

Wyjsc poza globalne `hmax`.

### Co budujemy

- local size constraints:
  - per domain
  - per boundary
  - around selected points
  - around selected curves / edges
- size field editor:
  - distance field
  - threshold field
  - curvature field
  - background mesh field
  - imported adaptive field
- refinement workflow:
  - mark region from inspector
  - assign local `hmax`
  - preview expected density
  - generate and compare

### Efekt

Bez tego FEM mesher pozostaje "globalnym suwakiem", a nie realnym narzedziem modelowania.

---

## 3.9 Compare Meshes / Mesh History

### Cel

Kazdy kolejny remesh powinien byc porownywalny z poprzednim.

### Co budujemy

- historia snapshotow mesha
- compare mode:
  - counts before/after
  - quality before/after
  - RAM before/after
  - extents before/after
  - local size difference
- synchronized viewport compare:
  - side-by-side
  - blink compare
  - diff heatmap

### Efekt

Uzytkownik ma widziec, czy nowy mesh jest realnie lepszy, a nie tylko "inny".

---

## 4. Kontrakt backendu, ktory trzeba dodac

## 4.1 Nowe struktury danych

Potrzebny jest jawny payload typu `MeshWorkspaceState` eksportowany przez API / session stream.

Minimalny zakres:

- `mesh_summary`
- `mesh_quality_summary`
- `mesh_quality_extremes`
- `mesh_domain_stats`
- `mesh_boundary_stats`
- `mesh_pipeline_status`
- `mesh_history`
- `mesh_compare_result`
- `mesh_auto_actions`
- `mesh_capabilities`

## 4.2 `mesh_capabilities`

Backend powinien deklarowac, co jest dostepne dla danego workspace:

- czy mesh jest volume czy surface
- czy sa quality arrays
- czy mozna pokazac element ids
- czy mozna slicowac tetra
- czy wspierany jest cutaway
- czy jest dostepny optimizer
- czy jest dostepny auto-coarsen
- czy sa size fields
- czy sa compare snapshots

To pozwoli usunac hardcoded view logic z frontendu.

## 4.3 Structured events zamiast samego logu

Potrzebne eventy:

- `mesh_generation_started`
- `mesh_generation_progress`
- `mesh_generation_completed`
- `mesh_optimization_started`
- `mesh_optimization_completed`
- `mesh_quality_ready`
- `mesh_validation_warning`
- `mesh_auto_action_applied`
- `mesh_compare_ready`

Tekstowy log zostaje, ale jako warstwa pomocnicza.

---

## 5. Proponowana architektura frontendowa

## 5.1 Nowe pojecia

- `MeshWorkspaceState`
- `MeshViewDefinition`
- `MeshInspectorSelection`
- `MeshPipelineViewModel`
- `MeshCompareState`
- `MeshAutoPolicyState`

## 5.2 Podzial komponentow

### Shell / nawigacja

- `RibbonBar.tsx`
  - przestaje hardkodowac view actions
- `RunSidebar.tsx`
  - przestaje mapowac node ids na tryby if-ami
- `ViewportPanels.tsx`
  - przestaje skladac kontrolki ad hoc

### Inspector

- `MeshPanel.tsx`
  - robi sie panelem szczegolowym i diagnostycznym
- `MeshSettingsPanel.tsx`
  - robi sie edytorem meshera / precompute / optimize policy
- nowy `MeshPipelinePanel.tsx`
- nowy `MeshSelectionInspector.tsx`
- nowy `MeshComparePanel.tsx`

### Viewer

- `FemMeshView3D.tsx`
  - render states + overlay registry
- `FemMeshSlice2D.tsx`
  - prawdziwy slice workspace
- `FemGeometry.tsx`
  - render geometry primitives / quality overlays / clipped subsets

## 5.3 Zasada projektowa

Kazdy tryb widoku ma miec:

- identyfikator,
- deklaracje wymaganych danych,
- toolbar controls,
- inspector panels,
- fallback kiedy backend nie wspiera danej funkcji.

To ma byc model deklaratywny, nie seria warunkow po `viewMode`.

---

## 6. Etapy wdrozenia

| Etap | Nazwa | Zakres | Priorytet |
|---|---|---|---|
| E1 | Unhardcode Mesh Workspace | registry widokow, cleanup toolbar/ribbon/sidebar, jawny mesh workspace state | P0 |
| E2 | Prawdziwe 3D/2D inspection tools | wireframe volume, clip, cutaway, sensowny slice, selection overhaul | P0 |
| E3 | Mesh diagnostics and backend feedback | pipeline timeline, summary cards, warnings, structured events | P0 |
| E4 | Auto precompute / optimize / validate | policies, auto actions, before/after summary, visible runtime decisions | P1 |
| E5 | Local refinement authoring | size fields, per-domain constraints, selection-driven controls | P1 |
| E6 | Compare and mesh history | snapshots, compare mode, diff overlays | P1 |
| E7 | Adaptive workflows | AFEM bridge, hotspot-driven refinement suggestions, solver-guided remeshing | P2 |

---

## 7. Szczegoly etapow

## 7.1 E1 - Unhardcode Mesh Workspace

### Deliverables

- jeden `mesh workspace` state model
- `MeshViewRegistry`
- ribbon i viewport sterowane registry
- sidebar nodes oparte o capabilities, a nie string literals
- jedna definicja tego, kiedy i jakie kontrolki sa aktywne

### Kryterium ukonczenia

Dodanie nowego widoku mesh nie wymaga zmian w wiecej niz 2 miejscach.

## 7.2 E2 - Prawdziwe tools do inspekcji

### Deliverables

- volume wireframe jako first-class mode
- cutaway / clip tools
- sensowny 2D slice
- selection: face + element + domain
- view presets dla mesh diagnostics

### Kryterium ukonczenia

Uzytkownik potrafi jednoznacznie potwierdzic, ze STL po volume meshingu jest wypelniony wewnatrz.

## 7.3 E3 - Diagnostics i feedback

### Deliverables

- pipeline timeline
- structured warnings
- mesh provenance
- worst elements panel
- histograms i distribution panels

### Kryterium ukonczenia

Uzytkownik nie musi czytac engine logu, by zrozumiec co poszlo nie tak.

## 7.4 E4 - Auto precompute

### Deliverables

- `Auto` policy editor
- optimize / validate chain
- auto-coarsen exposed in UI
- before/after report

### Kryterium ukonczenia

`Generate Mesh` moze dzialac jako "generate and make it solver-ready", a nie tylko "wygeneruj surowy mesh".

## 7.5 E5 - Local refinement authoring

### Deliverables

- per-domain mesh settings
- size field nodes w model tree
- highlight region -> assign local size

### Kryterium ukonczenia

Uzytkownik moze zagescic mesh lokalnie bez recznego hackowania backendu.

## 7.6 E6 - Compare / history

### Deliverables

- snapshot history
- compare cards
- side-by-side view
- quality delta

### Kryterium ukonczenia

Kazda zmiana mesha jest mierzalna i porownywalna.

---

## 8. Priorytety produktowe

### P0 - trzeba zrobic teraz

- E1 Unhardcode Mesh Workspace
- E2 Prawdziwy 3D/2D inspection
- E3 Structured diagnostics i backend feedback

### P1 - bez tego nie bedzie "powaznego" FEM meshera

- E4 Auto precompute / optimize / validate
- E5 Local refinement authoring
- E6 Mesh compare / history

### P2 - etap dojrzalosci

- E7 Adaptive workflows i solver-guided refinement

---

## 9. Ryzyka

- Jesli dalej bedziemy traktowac mesh jako tylko jeden z `viewMode`, UI bedzie coraz bardziej przypadkowe.
- Jesli nie dodamy structured backend events, frontend bedzie musial parsowac logi albo zgadywac stan pipeline.
- Jesli nie oddzielimy preview pola fizycznego od mesh workspace, logika bedzie sie dalej mieszac.
- Jesli nie dodamy compare/history, optymalizacja mesha bedzie wygladac jak "czarna skrzynka".

---

## 10. Acceptance criteria dla calego programu

Program uznajemy za zamkniety, gdy:

- uzytkownik moze wybrac jawny tryb `Inspect Volume` i zobaczyc prawdziwy mesh objetosciowy,
- 2D slice daje sensowny przekroj tetraedrow z overlayami quality,
- inspector umie pokazywac face, element, domain i material details,
- pipeline backendu jest widoczny jako kroki z warningami i czasami,
- `Generate Mesh` ma tryb automatycznego precompute / optimize / validate,
- mozna porownac dwa kolejne meshe before/after,
- lokalne refinement controls sa dostepne z UI,
- toolbar `View` i szczegoly Mesh Workspace nie sa juz hardcoded if-ami.

---

## 11. Rekomendowana kolejnosc implementacji

1. Najpierw E1: uporzadkowac model workspace i registry widokow.
2. Potem E2: dowiezc prawdziwe narzedzia 3D/2D, bo bez nich i tak nie zweryfikujemy mesha.
3. Nastepnie E3: structured diagnostics i pipeline feedback.
4. Potem E4: auto-precompute, optimize, validate.
5. Na koncu E5-E6: refinement authoring i compare/history.

Ta kolejnosc minimalizuje ryzyko, ze zbudujemy kolejne dobre funkcje na zlej architekturze.
