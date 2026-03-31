# FullMag — raport wdrożeniowy: optymalizacja i adaptacja meshu FEM „na wzór COMSOL”

**Data analizy:** 2026-03-31  
**Analizowane repozytorium:** `MateuszZelent/fullmag` (gałąź `master`, stan przeglądany 2026-03-31)  
**Cel dokumentu:** opisać **aktualny stan FullMag**, wskazać **co już istnieje**, wyjaśnić **jakie dokładnie obliczenia precompute solver powinien wykonywać**, oraz zaproponować **konkretne zmiany kodu** prowadzące do prawdziwej adaptacji/optimizacji siatki FEM.

---

## Spis treści

1. [Najważniejsza diagnoza](#1-najważniejsza-diagnoza)  
2. [Co dziś już istnieje w FullMag](#2-co-dziś-już-istnieje-w-fullmag)  
3. [Czego dziś brakuje](#3-czego-dziś-brakuje)  
4. [Co znaczy „optymalizacja meshu” w praktyce](#4-co-znaczy-optymalizacja-meshu-w-praktyce)  
5. [Docelowa architektura AFEM dla FullMag](#5-docelowa-architektura-afem-dla-fullmag)  
6. [Co solver ma liczyć dokładnie: lista precompute](#6-co-solver-ma-liczyć-dokładnie-lista-precompute)  
7. [Algorytmy adaptacji — wersja MVP, wersja produkcyjna, wersja docelowa](#7-algorytmy-adaptacji--wersja-mvp-wersja-produkcyjna-wersja-docelowa)  
8. [Dokładne wzory i estymatory błędu](#8-dokładne-wzory-i-estymatory-błędu)  
9. [Dokładny plan zmian per plik](#9-dokładny-plan-zmian-per-plik)  
10. [Proponowane API dla Pythona](#10-proponowane-api-dla-pythona)  
11. [Proponowane API/stan dla frontendu](#11-proponowane-apistan-dla-frontendu)  
12. [Przepływ runtime: solver → estymator → remesh → transfer → restart](#12-przepływ-runtime-solver--estymator--remesh--transfer--restart)  
13. [Natychmiastowe poprawki krytyczne](#13-natychmiastowe-poprawki-krytyczne)  
14. [Testy akceptacyjne, benchmarki, regresje](#14-testy-akceptacyjne-benchmarki-regresje)  
15. [Roadmapa wdrożenia](#15-roadmapa-wdrożenia)  
16. [Załącznik A — szkielety kodu](#16-załącznik-a--szkielety-kodu)  
17. [Załącznik B — źródła i odnośniki](#17-załącznik-b--źródła-i-odnośniki)

---

## 1. Najważniejsza diagnoza

### 1.1 Wniosek główny

**FullMag nie ma jeszcze pełnej, solverowo sterowanej adaptacji siatki FEM**, ale ma już sporą część potrzebnych klocków:

- ma **warstwę IR / planowania**,
- ma **meshing po stronie Pythona + Gmsh**,
- ma **cache assetów siatki**,
- ma **jakość siatki i per-element quality extraction**,
- ma **CPU FEM precompute** (objętości, gradienty baz, stiffness, masy skupione, maski magnetyczne),
- ma **native FEM backend** z bogatszym ABI niż sugerują starsze notatki,
- ma **UI do ustawień meshu** i podgląd geometrii/siatki.

**Brakuje głównie „szwu adaptacyjnego”**:

1. policzyć estymatory błędu / wskaźniki fizyczne na aktualnej siatce,  
2. złożyć z nich **target size field** `h_target(x)`,  
3. przepchnąć ten size field do remeshera,  
4. zrobić nową siatkę,  
5. przenieść stan (`m`, pola materiałowe, metadata) ze starej siatki na nową,  
6. odbudować precompute solvera,  
7. wznowić / zrestartować czasówkę lub relaksację.

To właśnie trzeba doprojektować i doimplementować.

---

### 1.2 Najważniejsza decyzja architektoniczna

Na start **nie wolno próbować robić wszystkiego wewnątrz MFEM/C++**.

Najkrótsza, najbezpieczniejsza i najbardziej realna ścieżka dla FullMag to:

- **solver** (CPU lub native FEM) zostaje krokiem wykonawczym,
- **orchestracja adaptacji** dzieje się na poziomie **Rust runnera**,
- **remeshing** robi istniejący już **Python + Gmsh**,
- **transfer stanu** i **budowa nowego planu** są w Rust,
- backend C++ dostaje po prostu nowy mesh/plan po każdej adaptacji.

To daje bardzo dużo korzyści:

- wykorzystujesz istniejące `remesh_with_size_field(...)`,
- nie dublujesz logiki geometrycznej w C++,
- nie blokujesz się na pełnym AMR w MFEM od razu,
- możesz uruchomić pierwszą adaptację nawet dla CPU reference,
- frontend i Python API mogą powstać od razu, zanim natywny backend będzie w 100% „mesh-aware”.

---

### 1.3 Co należy zrobić najpierw

Jeżeli miałbym wskazać kolejność bez dyskusji, to:

1. **naprawić krytyczne bugi mixed-marker w GPU FEM**,  
2. **dodać IR/API dla adaptivity**,  
3. **dodać estymatory + target size field po stronie Rust/engine**,  
4. **rozszerzyć `remesh_cli.py` o size field**,  
5. **zrobić transfer stanu old→new mesh**,  
6. **dodać pętlę adaptacyjną w runnerze**,  
7. **dodać UI/preview dla `mesh_error` i `target_h`**,  
8. dopiero potem wchodzić w **anizotropię / TMOP / zaawansowane AMR**.

---

## 2. Co dziś już istnieje w FullMag

Poniżej opisuję **stan aktualny**, nie życzeniowy.

### 2.1 Warstwa architektoniczna i repo

Repo ma rozdział na:

- **IR / plan / runner** po stronie Rust,
- **Python package** z modelowaniem problemu i meshingiem,
- **native backends** (w tym FEM/MFEM),
- **web frontend**,
- **notatki/specyfikacje fizyczne**.

To jest bardzo dobra baza, bo adaptacja meshu dotyka praktycznie wszystkich warstw i tu ten podział już istnieje.

---

### 2.2 `ProblemIR`, assety geometrii i siatek

Już dziś FullMag ma koncepcję, w której interfejs problemu opisuje **fizykę i geometrię**, a nie tylko layout numeryczny. To jest dokładnie to, czego potrzeba do adaptacji: solver może generować nową siatkę bez przepisywania całego problemu od zera.

W praktyce ważne są tu trzy fakty:

- geometry layer jest backend-neutral,
- `GeometryAssetsIR` może przenosić **precomputed FEM mesh assets**,
- pipeline potrafi wstawić gotowy `MeshIR` do requestu.

To oznacza, że adaptacja nie musi łamać modelu danych — trzeba tylko dodać nowy krok runtime.

---

### 2.3 Python: obecny pipeline FEM meshing

W `packages/fullmag-py` istnieje już dojrzały szkielet:

- realizacja assetów FEM,
- cache siatek na dysku (`FULLMAG_FEM_MESH_CACHE_DIR`),
- walidacja `MeshIR`,
- Gmsh bridge z wieloma opcjami meshowania,
- quality extraction,
- osobny subprocess do remeshu.

To nie jest prototyp „od zera”. To jest już baza pod AFEM.

#### Już istniejące elementy szczególnie ważne

##### a) `problem.py`
- buduje assety FEM,
- potrafi cache’ować wygenerowane siatki,
- potrafi osadzić gotowy `mesh_ir` w geometrii.

##### b) `gmsh_bridge.py`
- ma `MeshOptions`,
- ma `MeshQualityReport`,
- ma `SizeFieldData`,
- ma **`remesh_with_size_field(...)`**.

To ostatnie jest kluczowe: **hak pod adaptację już istnieje**.

##### c) `remesh_cli.py`
Aktualny subprocess remeshu potrafi:
- przyjąć `geometry`, `hmax`, `order`, `mesh_options`,
- wygenerować nową siatkę,
- zwrócić jakość.

Ale ma też ważną lukę:
- dziś dalej woła zwykłe `generate_mesh(...)`,
- **nie ma jeszcze trybu `adaptive_size_field`**,
- nie przyjmuje danych typu `node_coords + h_values`.

To jest idealny kandydat na pierwszy mały, ale bardzo produktywny patch.

---

### 2.4 CPU FEM w `crates/fullmag-engine/src/fem.rs`

To jest najważniejsza część z punktu widzenia „co już solver precompute liczy”.

Aktualny `MeshTopology::from_ir(...)` liczy już:

- `element_volumes`,
- `node_volumes`,
- `magnetic_node_volumes`,
- `grad_phi` (gradienty funkcji bazowych dla tetra P1),
- `element_stiffness`,
- globalny układ Robin-a dla demag bootstrap (`demag_system`),
- `boundary_nodes`,
- `magnetic_element_mask`,
- `magnetic_total_volume`,
- `robin_beta`.

To znaczy, że **precompute geometryczno-FE już istnieje**. Nie trzeba wymyślać fundamentów od zera — trzeba go rozszerzyć.

#### Obecne plusy tego rozwiązania

- maski magnetyczne są jawne,
- objętości węzłowe magnetyczne są osobne od całkowitych,
- exchange field używa już lokalnych macierzy i mas skupionych,
- transfer-grid demag CPU liczy bounding box po **magnetycznych** węzłach,
- elementy niemagnetyczne są pomijane tam, gdzie trzeba.

To ważne, bo natywny backend nie wszędzie jest jeszcze z tym spójny.

---

### 2.5 CPU runner: `fem_reference.rs`

Runner CPU jest już bogatszy niż zwykły proof-of-concept:

- obsługuje Heun / RK4 / RK23 / RK45 / ABM3,
- obsługuje adaptive timestep,
- ma relaksację,
- buduje preview,
- potrafi robić snapshoty i statystyki.

To jest bardzo dobra wiadomość dla AFEM, bo adaptacja siatki powinna być najpierw uruchomiona właśnie tutaj jako **runner orchestration**, a dopiero potem „przeniesiona” na backend natywny.

---

### 2.6 Native FEM backend: ABI i runtime

Obecny native backend FEM ma już więcej niż „goły scaffold”:

- integratory Heun/RK4/RK23/RK45,
- adaptive timestep config,
- demag realization enum (`transfer_grid` vs `poisson_airbox`),
- uniaxial anisotropy,
- cubic anisotropy,
- interfacial DMI,
- bulk DMI,
- Oersted,
- thermal noise,
- observables `H_ANI`, `H_DMI`,
- stats błędu kroku/adaptive stats.

To jest ważne, bo pokazuje, że natywny backend nie jest już bardzo prymitywny. **Ale nadal nie ma w nim pełnej pętli mesh adaptivity** — i to jest OK. Nie trzeba jej tam wpychać jako pierwszej.

---

### 2.7 UI: `MeshSettingsPanel`, `FemMeshView3D`, live session types

Frontend już dziś ma sporo funkcjonalności „na wejście” pod adaptację:

- ustawianie `algorithm_2d`, `algorithm_3d`, `hmax`, `hmin`,
- `sizeFactor`,
- `sizeFromCurvature`,
- `smoothingSteps`,
- `optimize`, `optimizeIterations`,
- `computeQuality`,
- `perElementQuality`,
- wyświetlanie histogramów SICN / gamma,
- per-face quality overlay w 3D view,
- podgląd siatki i pól na siatce.

Innymi słowy: UI już umie pokazać „mesh quality”, ale jeszcze nie umie pokazać:
- `mesh_error`,
- `target_h`,
- `refine/coarsen mask`,
- statystyk adaptacji.

To trzeba tylko rozszerzyć, nie budować od zera.

---

## 3. Czego dziś brakuje

### 3.1 Brakuje pełnego AFEM loop

Dziś brakuje następującej pętli:

```text
solve N steps
→ estimate local error / physics indicators
→ synthesize target size field
→ remesh geometry with new size field
→ transfer m + materials + metadata
→ rebuild FEM precompute
→ continue / restart simulation
```

Właśnie ten loop trzeba dopisać.

---

### 3.2 Brakuje jawnych estymatorów błędu meshu

Nie ma jeszcze w solverze pełnego zestawu wskaźników typu:

- lokalny normowany torque residual,
- ZZ / L2-ZZ gradient recovery mismatch,
- face-jump estimator,
- demag interpolation residual,
- boundary/interface proximity score,
- quality penalty / sliver penalty.

Bez tego nie ma sensownego „co refine, co coarsen”.

---

### 3.3 Brakuje pola docelowego rozmiaru elementu

Jest `SizeFieldData` w Pythonie, ale nie ma jeszcze po stronie solvera czegoś w stylu:

- `element_target_h[e]`,
- `node_target_h[n]`,
- smoothing/gradation limiter,
- eksportu do `remesh_cli.py`.

---

### 3.4 Brakuje transferu stanu old mesh → new mesh

To jest najbardziej newralgiczny element każdego solvera adaptacyjnego.

Musisz mieć:

- lokalizator tetraedru / spatial hash / BVH,
- interpolację barycentryczną dla `m`,
- renormalizację `m`,
- mapowanie pól materiałowych,
- sensowny fallback poza domeną / przy powierzchni / przy cienkich szczelinach.

Bez tego każda adaptacja „zniszczy” stan.

---

### 3.5 Brakuje poprawnego spięcia mixed-marker w native backendzie

To nie jest detal. To jest krytyczne.

W aktualnym audycie są zidentyfikowane konkretne problemy w natywnym FEM GPU dla mixed-marker:

- bounding box bywa liczony po wszystkich nodach,
- rasteryzacja demag obejmuje zbyt szeroko elementy,
- energia demag może być ważona nie po samych magnetycznych objętościach węzłowych,
- exchange/mixed-material support nie jest pełny.

Te rzeczy trzeba naprawić **przed** uruchamianiem produkcyjnej adaptacji meshu, bo inaczej refinement w okolicach air/magnet interface będzie dawał niestabilne lub błędne wyniki.

---

## 4. Co znaczy „optymalizacja meshu” w praktyce

To pojęcie warto rozbić na trzy różne warstwy, bo inaczej zespół będzie mieszał zupełnie różne rzeczy.

### 4.1 Optymalizacja jakości siatki
To jest:
- usuwanie sliverów,
- poprawa SICN/gamma,
- smoothing,
- relocation węzłów,
- ewentualnie TMOP / mesh movement.

Cel:
- lepsza kondycja numeryczna,
- stabilniejsze pola,
- mniej błędów od geometrii elementu.

### 4.2 Adaptacja dyskretyzacji
To jest:
- refine tam, gdzie rozwiązanie ma duży błąd,
- coarsen tam, gdzie rozwiązanie jest gładkie,
- dynamiczna zmiana lokalnego `h`.

Cel:
- mniejszy błąd przy podobnym koszcie,
- lub ten sam błąd przy mniejszej liczbie DOF.

### 4.3 Optymalizacja solverowa / precompute / data layout
To jest:
- precompute macierzy lokalnych,
- adjacency,
- reordering,
- cache transfer-grid,
- SoA layout,
- kompaktowe listy aktywnych elementów magnetycznych.

Cel:
- szybszy runtime,
- lepsza lokalność pamięci,
- tańszy remesh/rebuild.

**FullMag potrzebuje wszystkich trzech**, ale w innej kolejności:
1. correctness,
2. adaptivity MVP,
3. performance/data layout,
4. high-end quality optimization.

---

## 5. Docelowa architektura AFEM dla FullMag

### 5.1 Docelowy pipeline

```text
Problem definition
→ initial geometry assets
→ initial FEM mesh
→ mesh precompute
→ solve chunk
→ compute indicators
→ build target size field
→ remesh with size field
→ transfer state
→ rebuild plan/backend
→ continue
```

---

### 5.2 Dwa tryby pracy, jak w narzędziach klasy COMSOL

FullMag powinien wspierać dwa osobne style pracy:

#### Tryb A — „physics-controlled initial mesh”
Bez jeszcze pełnej iteracyjnej adaptacji:
- startowa siatka jest budowana z heurystyk fizycznych,
- czyli już na wejściu respektujesz `l_ex`, `l_k`, `l_D`, curvature, interfejsy.

To daje bardzo dużo nawet bez runtime remeshu.

#### Tryb B — „solution-adaptive remesh”
Prawdziwa adaptacja:
- rozwiązujesz kawałek symulacji,
- mierzysz błąd/cechy,
- remeshujesz,
- restartujesz/ciągniesz dalej.

To jest odpowiednik tego, czego użytkownik oczekuje „na wzór COMSOL”.

---

### 5.3 Architektura warstwowa — rekomendacja

#### Warstwa 1: engine / backend
Oblicza:
- pola,
- energie,
- statystyki kroku,
- wskaźniki elementowe (albo dane potrzebne do ich obliczenia).

#### Warstwa 2: runner/orchestrator
Decyduje:
- czy robić remesh,
- kiedy,
- jaką metodą,
- jak ograniczyć liczbę adapt passes,
- jak złożyć nowy plan.

#### Warstwa 3: Python mesher
Wykonuje:
- remesh geometryczny z size field,
- jakościową poprawę siatki.

#### Warstwa 4: frontend / script API
Pozwala:
- sterować adaptacją,
- podejrzeć estymatory,
- zaakceptować / wymusić remesh,
- eksportować statystyki.

To jest układ realistyczny, modularny i zgodny z tym, co już jest w repo.

---

## 6. Co solver ma liczyć dokładnie: lista precompute

To jest najważniejsza część dokumentu.

Poniżej masz **konkretną listę rzeczy, które solver powinien liczyć**, z podziałem na:
- raz na siatkę,
- przy każdym checkpoint/adapt pass,
- przy transferze stanu.

---

### 6.1 Raz na każdą nową siatkę — obowiązkowe precompute geometryczne

#### 6.1.1 Topy/logika domeny
Policz i trzymaj jawnie:

- `n_nodes`,
- `n_elements`,
- `n_boundary_faces`,
- `coords[n][3]`,
- `elements[e][4]`,
- `element_markers[e]`,
- `boundary_faces[f][3]`,
- `boundary_markers[f]`,
- `magnetic_element_mask[e]`,
- `magnetic_node_mask[n]`,
- `boundary_node_mask[n]`,
- `interface_face_mask[f]` — twarz na styku magnet/air albo material/material,
- `element_neighbors` — lista sąsiadów elementu przez ścianę,
- `node_to_elements` — CSR lub `Vec<Vec<u32>>`,
- `node_to_nodes` — graf sąsiedztwa do smoothingu size field.

#### Dlaczego?
Bez tego:
- nie zrobisz recovery patchy,
- nie zrobisz smoothingu gradacji,
- nie wykryjesz interfejsów i cienkich warstw,
- transfer i wskaźniki będą zbyt drogie.

---

### 6.2 Raz na siatkę — precompute geometryki elementów

Dla każdego tetraedru `e` licz:

- `J_e` — macierz Jacobiego,
- `detJ_e`,
- `invJ_e`,
- `invJT_e`,
- `volume_e = |detJ_e| / 6`,
- `centroid_e`,
- `face_area[e][4]`,
- `face_normal[e][4]`,
- `edge_lengths[e][6]`,
- `h_min[e]`,
- `h_max[e]`,
- `h_rms[e]`,
- `circumradius[e]` (opcjonalnie),
- `inradius[e]` (opcjonalnie),
- `aspect_ratio[e]`,
- `sliver_penalty[e]`.

#### Minimum praktyczne
Jeśli chcesz MVP iść szybko:
- `volume_e`,
- `grad_phi[e][4][3]`,
- `h_rms[e]`,
- `h_min[e]`,
- `h_max[e]`,
- `face_area[e][4]`,
- `element_neighbors`.

To w zupełności wystarczy do pierwszego AFEM.

---

### 6.3 Raz na siatkę — precompute FE operatorów lokalnych

Dla P1 tetra licz jawnie:

- `grad_phi[e][4][3]`,
- `K_e[4][4] = volume_e * (grad_phi_i · grad_phi_j)`,
- `M_e[4][4] = volume_e / 20 * [[2,1,1,1], ...]`,
- `M_lumped_node[n]`,
- `M_lumped_magnetic_node[n]`,
- opcjonalnie `B_face[e][face]` dla jump estimatorów,
- opcjonalnie `C_grad[e]` do szybkiego liczenia `∇m`.

#### W praktyce
Już dziś masz:
- `grad_phi`,
- `element_stiffness`,
- `node_volumes`,
- `magnetic_node_volumes`.

Trzeba to rozszerzyć o:
- `M_e`,
- sąsiedztwa face-to-face,
- wartości pomocnicze do estymatorów.

---

### 6.4 Raz na siatkę — precompute quality metrics

Dla każdego elementu trzymaj:

- `sicn[e]`,
- `gamma[e]`,
- `quality_bucket[e]`,
- `jacobian_sign_ok[e]`,
- `volume_relative[e] = volume_e / mean_volume_local_region` (opcjonalnie),
- `bad_quality_mask[e]`.

#### Uwaga praktyczna
Nie trzeba wszystkiego liczyć samodzielnie po stronie Rust od pierwszego dnia:
- startowo możesz pobrać per-element quality z Gmsh przy generacji/remeshu,
- potem dodać szybkie lokalne surrogaty po stronie solvera.

**Ale** solver powinien mieć przynajmniej prosty lokalny quality surrogate, żeby:
- zablokować nadmierne coarsening na złych elementach,
- wymuszać cleanup jeśli refine stworzył lokalny sliver cluster.

---

### 6.5 Raz na siatkę — precompute długości fizycznych

To jest warstwa, której zwykle brakuje w prostych solverach, a właśnie ona daje „mesh jak w COMSOL”.

Dla każdego elementu albo węzła policz:

#### 6.5.1 Exchange length
\[
l_{ex} = \sqrt{\frac{2A}{\mu_0 M_s^2}}
\]

Jeżeli materiał jest jednorodny:
- wystarczy jedno `l_ex_global`.

Jeżeli pola materiałowe są przestrzennie zmienne:
- licz `l_ex[e]` lub `l_ex[n]`.

#### 6.5.2 Anisotropy length
Dla efektywnej anizotropii:
\[
l_k = \sqrt{\frac{A}{K_{\text{eff}}}}
\]

Jeżeli `K_eff <= 0`, nie używaj tej długości jako ograniczenia.

#### 6.5.3 DMI length
Praktyczny wskaźnik rozdzielczości dla DMI:
\[
l_D \sim \frac{2A}{|D|}
\]

W praktyce nie chodzi o fizyczną „jedną świętą” definicję, tylko o stabilny wskaźnik, który powie:  
**„przy dużym D muszę zmniejszyć lokalny h”**.

#### 6.5.4 Curvature / geometry feature size
Dla elementów przy granicy:
- lokalny promień krzywizny,
- albo prostszy odpowiednik: odległość do najbliższego ostrego feature,
- albo jeszcze prostszy: lokalny minimalny edge/face scale wynikający z geometrii.

#### 6.5.5 Interface thickness hint
Na interfejsie materiałów / magnet-air:
- licz odległość do interfejsu,
- lub flagę „jestem w strefie interfejsowej”.

#### Po co to wszystko?
Żeby size field nie był oparty tylko na „błędzie po rozwiązaniu”, ale też na samej fizyce problemu.

---

### 6.6 Raz na siatkę — precompute dla demag

Tu rozdzielmy dwa tryby.

#### 6.6.1 Transfer-grid demag
Potrzebujesz:

- **magnetic-only bbox**,
- `grid_desc` (`nx, ny, nz, dx, dy, dz`),
- active cell mask,
- cache spektrów kernela FFT,
- mapy/interpolatory:
  - mesh → transfer grid,
  - transfer grid → mesh.

W docelowej wersji warto też mieć:
- mapping wag element→cell,
- cache listy komórek przecinanych przez dany tetra,
- wskaźnik lokalnego błędu rasteryzacji.

#### 6.6.2 Poisson airbox
Potrzebujesz:

- markerów domeny magnetycznej i powietrza,
- boundary markers dla warunku Robin/Dirichlet/otoczenia,
- ewentualnych coarse-level operatorów / preconditioner state.

Dla MVP AFEM wystarczy, żeby po remeshu po prostu odbudować plan i backend.

---

### 6.7 Raz na siatkę — precompute do transferu stanu

Musisz mieć jedną z tych struktur:

- spatial hash po bounding boxes tetraedrów,
- uniform grid locator,
- BVH/AABB tree,
- albo k-d tree po centroidach + weryfikacja barycentryczna.

Polecam na start:

#### MVP:
- uniform spatial hash po bbox tetraedrów,
- lista kandydatów tetra na bucket.

To wystarczy i jest łatwe do napisania w Rust.

Precompute dla transferu:
- `tet_bbox[e]`,
- `bucket -> Vec<element_id>`,
- `tet_inverse_map[e]` do szybkich współrzędnych barycentrycznych.

---



### 6.7.1 Raz na siatkę — precompute solverowej lokalności i layoutu pamięci

To nie jest „fizyka”, ale daje realny zysk wydajności i powinno być częścią projektu.

#### Polecane rzeczy do liczenia / budowania

##### a) Kompaktowe listy aktywnych elementów
Zamiast iterować po całej siatce przy każdej operacji:
- `magnetic_elements: Vec<u32>`
- `boundary_elements: Vec<u32>`
- `interface_elements: Vec<u32>`

To szczególnie ważne w domenach z air-boxem lub niemagnetycznymi regionami.

##### b) Kompaktowe listy aktywnych nodów
- `magnetic_nodes: Vec<u32>`
- `boundary_nodes: Vec<u32>`
- `interface_nodes: Vec<u32>`

Dzięki temu:
- termiczny noise,
- normowanie,
- redukcje energii,
- preview aktywnej domeny

mogą pracować tylko po aktywnych nodach.

##### c) Permutacja nodów i elementów
Po każdym remeshu warto rozważyć reordering:
- Morton/Z-order po centroidach lub po współrzędnych,
- Reverse Cuthill–McKee dla pasma macierzy,
- ewentualnie METIS w przyszłości.

#### Po co?
- lepsza lokalność pamięci,
- lepszy cache hit rate,
- mniejszy koszt mnożenia operatorów rzadkich,
- szybsze przechodzenie po sąsiedztwach.

##### d) SoA zamiast AoS tam, gdzie to opłacalne
Dla pól często aktualizowanych:
- `mx[]`, `my[]`, `mz[]`
zamiast tylko `[x,y,z,x,y,z,...]`.

Pełny rewrite nie jest potrzebny od razu, ale warto przynajmniej przygotować API/funkcje pomocnicze pod oba layouty.

##### e) Cache kluczy dla transfer-grid FFT
Klucz cache:
```text
(nx, ny, nz, dx, dy, dz, precision, backend)
```

Jeśli po remeshu ten klucz się nie zmienił, nie trzeba liczyć kerneli od nowa.

##### f) Cache elementowych bboxów i spatial bucketów
To przydaje się zarówno do:
- transferu stanu,
- jak i przyspieszania niektórych lokalnych estimatorów.

---

### 6.7.2 Macierz „co przeliczać kiedy”

To jest ważne, bo bez tego łatwo przepalać runtime.

| Zmiana | Co przeliczyć | Czego nie trzeba liczyć od nowa |
|---|---|---|
| Zmienił się tylko `dt` | nic mesh-dependent | geometria, adjacency, quality, transfer locator |
| Zmienił się tylko stan `m` | wskaźniki dynamiczne, pola, energie | geometria, quality, l_ex/l_k/l_D jeśli materiał stały |
| Zmieniły się pola materiałowe na tej samej siatce | długości fizyczne, część estimatorów, ewentualnie współczynniki operatorów | adjacency, bbox tetra, locator |
| Zmienił się tylko display/preview | tylko preview payload | wszystko solverowe |
| Zmienił się mesh | **wszystko mesh-dependent** | nic poza globalnymi parametrami problemu |
| Zmienił się tylko transfer-grid desc | kerneli FFT/cache transfer-grid | lokalne `K_e`, adjacency, quality |

#### Zasada wdrożeniowa
W MVP trzymaj prostą politykę:
- mesh changed → rebuild all mesh-dependent caches,
- state changed only → recompute only dynamic indicators,
- UI changed only → recompute only preview.

Dopiero później rób bardziej agresywne cache invalidation.


### 6.8 Przy każdym checkpoint adaptacyjnym — precompute dynamiczne

To liczymy **nie przy każdym RHS evaluation**, tylko co pewien chunk:

- `element_grad_m[e]`,
- `element_avg_m[e]`,
- `element_avg_H_eff[e]`,
- `element_avg_H_demag[e]`,
- `element_avg_torque[e]`,
- `element_energy_density_exchange[e]`,
- `element_energy_density_demag[e]`,
- `element_energy_density_total[e]`,
- `face_jump_m[f]`,
- `face_jump_dn_m[f]` lub jego uproszczenie,
- wskaźniki błędu `eta_*[e]`,
- `target_h_elem[e]`,
- `target_h_node[n]`.

---

### 6.9 Po każdej adaptacji — pełna odbudowa cache

Po remeshu **musisz** odtworzyć wszystko, co zależy od topologii:

- geometry precompute,
- FE precompute,
- demag cache,
- transfer-grid setup,
- preview mesh,
- live state metadata,
- bucket locator do kolejnego transferu,
- quality stats,
- physical scales.

Nie próbuj robić pół-cache invalidation na pierwszej wersji.  
Pierwsza wersja ma mieć prostą regułę:

> **jeśli zmienił się mesh, rebuild everything mesh-dependent**

To będzie bardziej niezawodne.

---

## 7. Algorytmy adaptacji — wersja MVP, wersja produkcyjna, wersja docelowa

### 7.1 Wersja MVP — isotropic h-adaptation z physics guardrails

To jest wersja, którą naprawdę polecam wdrożyć jako pierwszą.

#### Idea
- refine/coarsen tylko przez pole skalarne `h_target(x)`,
- bez anizotropii metrycznej,
- bez AMR wewnątrz backendu,
- bez jawnego hanging-node machinery.

#### Krok po kroku

1. Wygeneruj siatkę startową z heurystyk fizycznych.  
2. Rozwiąż `N_chunk` zaakceptowanych kroków lub relaksację do checkpointu.  
3. Policz wskaźniki błędu per element.  
4. Złóż jeden skalar `eta[e]`.  
5. Zbuduj `h_error[e]`.  
6. Zbuduj `h_physics[e]`.  
7. Ustal:
   \[
   h_{target}[e] = \operatorname{clamp}(\min(h_{error}[e], h_{physics}[e]), h_{min}, h_{max})
   \]
8. Wygładź `h_target` po grafie sąsiedztwa z gradation limit.  
9. Zrzuć do węzłów.  
10. Wywołaj `remesh_with_size_field(...)`.  
11. Przenieś stan.  
12. Odbuduj precompute i kontynuuj.

#### Zalety
- działa z istniejącym Gmsh bridge,
- działa dla importowanej geometrii i CSG,
- jest stosunkowo prosty,
- daje ogromny zysk jakościowy.

---

### 7.2 Wersja produkcyjna — isotropic AFEM + quality cleanup + hysteresis

Po MVP trzeba dołożyć trzy rzeczy:

#### a) Hysteresis decyzyjny
Żeby solver nie remeshował „co chwilę”.

Przykład:
- refine, gdy `eta_max > eta_refine`,
- coarsen, gdy `eta_max < eta_coarsen`,
- gdzie `eta_coarsen < eta_refine`.

#### b) Graduality / growth limit
Żeby size field nie robił bardzo ostrych skoków.

Przykład:
- dla sąsiadów `i, j` wymuszaj:
  \[
  h_j \le g \cdot h_i
  \]
  z `g` np. 1.3–1.5.

#### c) Quality cleanup pass
Po remeshu:
- sprawdź `sicn_p5`, `gamma_min`, slivery,
- jeśli jakość spadła poniżej progu:
  - odpal dodatkowe optimize/smoothing,
  - ewentualnie fallback na bardziej konserwatywny `h_target`.

---

### 7.3 Wersja docelowa — anisotropic metric adaptation

Docelowo FullMag powinien wspierać nie tylko skalarne `h`, ale też **metrykę anizotropową**.

To ma sens zwłaszcza dla:
- domen walls,
- cienkich warstw,
- skyrmionów,
- struktur z DMI,
- geometrii z ostrą anizotropią kierunkową.

Wtedy zamiast pojedynczego `h(x)` mamy tensor / macierz metryki `M(x)`.

#### Co daje metryka anizotropowa?
- element może być długi wzdłuż ściany domenowej,
- i bardzo cienki w kierunku, w którym pole zmienia się gwałtownie,
- co jest dużo bardziej wydajne niż isotropic refine.

#### Ale
Nie polecam robić tego w pierwszej iteracji projektu.  
Najpierw MVP isotropic + solidny transfer stanu.

---

### 7.4 Wersja „mesh movement / TMOP”
To jest jeszcze inna klasa optymalizacji:
- bez zmiany topologii,
- przesuwasz węzły dla lepszej jakości / dopasowania do metryki.

Przyda się później np. do:
- wygładzania po remeshu,
- poprawy quality w cienkich regionach,
- redukcji sliverów.

To jest świetny etap 3/4, ale nie etap 1.

---

## 8. Dokładne wzory i estymatory błędu

Poniżej podaję zestaw, który jest praktyczny i kompatybilny z obecną architekturą.

---

### 8.1 Rozmiar elementu

Polecam trzymać kilka definicji:

#### 8.1.1 Rozmiar objętościowy
\[
h_V(e) = (6V_e)^{1/3}
\]

#### 8.1.2 Rozmiar krawędziowy
\[
h_{\text{rms}}(e) = \sqrt{\frac{1}{6}\sum_{k=1}^{6} l_k^2}
\]

#### 8.1.3 Rozmiar minimalny i maksymalny
\[
h_{\min}(e) = \min_k l_k,\quad h_{\max}(e)=\max_k l_k
\]

W praktyce do adaptacji najlepiej używać:
- `h_current[e] = h_rms[e]`
- albo `h_V[e]`.

---

### 8.2 Exchange length constraint

Dla elementu / węzła:

\[
l_{ex} = \sqrt{\frac{2A}{\mu_0 M_s^2}}
\]

Rekomendacja praktyczna:
- w obszarach aktywnych magnetycznie wymuszaj:
  \[
  h \le c_{ex} \, l_{ex}
  \]
- z `c_ex` w okolicach `0.25 ... 0.5`.

Dla bezpiecznego startu:
- `c_ex = 0.35`.

---

### 8.3 Anisotropy length constraint

\[
l_k = \sqrt{\frac{A}{K_{\text{eff}}}}
\]

Jeśli `K_eff > 0`, dodaj:
\[
h \le c_k \, l_k
\]

Dla startu:
- `c_k = 0.25 ... 0.5`.

---

### 8.4 DMI length constraint

Użyteczny wskaźnik:
\[
l_D = \frac{2A}{|D|}
\]

W praktyce:
\[
h \le c_D \, l_D
\]

Dla startu:
- `c_D = 0.2 ... 0.35`.

---

### 8.5 Torque-based indicator

Dla elementu `e`:

\[
\eta_{\tau}(e) = \sqrt{
\frac{1}{V_e}
\int_{e}
\| \mathbf{m} \times \mathbf{H}_{eff} \|^2 \, dV
}
\]

W P1 tetra możesz użyć przybliżenia po centroidzie albo średniej z węzłów:

\[
\eta_{\tau}(e) \approx
\left\|
\bar{\mathbf{m}}_e \times \bar{\mathbf{H}}_{eff,e}
\right\|
\]

To jest bardzo dobry wskaźnik dla relaksacji:
- duży torque → trzeba lokalnie doprecyzować.

---

### 8.6 Gradient recovery / ZZ-style indicator dla magnetyzacji

Dla każdej składowej `m_x, m_y, m_z` policz elementowy gradient:
\[
G_e =
\begin{bmatrix}
\nabla m_x & \nabla m_y & \nabla m_z
\end{bmatrix}
\in \mathbb{R}^{3\times 3}
\]

Następnie z recovery na patchu sąsiednich elementów zbuduj „wygładzony” gradient:
\[
\widehat{G}_e
\]

I policz mismatch:
\[
\eta_{ZZ}(e) = \| G_e - \widehat{G}_e \|_F
\]

#### Interpretacja
- jeśli lokalny gradient silnie odstaje od odzyskanego gradientu patchowego,
- to element jest za gruby lub lokalnie zbyt zniekształcony.

To jest bardzo rozsądny główny estymator dla FullMag MVP.

---

### 8.7 Jump estimator po ścianach

Dla ściany `f` między elementami `e^-` i `e^+`:

\[
J_f = \left[
\frac{\partial \mathbf{m}}{\partial n}
\right]_f
\]

Wskaźnik elementowy:
\[
\eta_{jump}(e)^2
=
\sum_{f \subset \partial e \cap \Omega}
h_f \, \|J_f\|^2 \, A_f
\]

To jest bardzo dobry dodatek do `ZZ`, szczególnie przy P1 tetra, gdzie jumpy po ścianach są tanie.

---

### 8.8 Demag interpolation/resolution indicator

Jeśli używasz transfer-grid demag, warto mieć wskaźnik pokazujący, że siatka FEM nie rozdziela dobrze pola demag lub transfer jest zbyt zgrubny.

Dwie praktyczne opcje:

#### Opcja A — gradient demag
\[
\eta_{demag}(e) = \|\nabla \mathbf{H}_{demag}\|_F
\]

#### Opcja B — residual transferu
Policz:
- `H_demag` z siatki transfer-grid próbkowane do nodów,
- lokalne wygładzone / patchowe przybliżenie,
- różnicę pomiędzy nimi.

Dla MVP polecam opcję A, bo jest prostsza.

---

### 8.9 Quality penalty

Jeśli element ma złą jakość, powinien być „karany” nawet wtedy, gdy błąd fizyczny nie wygląda na ogromny.

Przykład:

\[
\eta_{qual}(e) =
w_q \cdot \max(0, q_{\text{target}} - q_e)
\]

gdzie:
- `q_e` może być znormalizowanym SICN/gamma,
- `q_target` np. 0.3–0.5.

W praktyce:

```text
if sicn[e] < sicn_min_ok:
    force_refine_or_optimize[e] = true
```

---

### 8.10 Composite indicator

Finalnie zbuduj jeden wskaźnik:

\[
\eta_e =
w_{\tau}\,\widetilde{\eta_\tau}
+
w_{ZZ}\,\widetilde{\eta_{ZZ}}
+
w_{jump}\,\widetilde{\eta_{jump}}
+
w_{demag}\,\widetilde{\eta_{demag}}
+
w_{qual}\,\widetilde{\eta_{qual}}
\]

Gdzie `~` oznacza normalizację do porównywalnej skali.

#### Praktyczna normalizacja
Dla każdej rodziny wskaźników:
\[
\widetilde{\eta}(e) = \frac{\eta(e)}{\operatorname{percentile}_{95}(\eta)+\varepsilon}
\]

To jest stabilniejsze niż dzielenie przez maksimum.

---

### 8.11 Error-driven target size

Najprostszy i dobry wzór:

\[
h_{err}(e)
=
h_{current}(e)\,
\left(
\frac{\eta_{ref}}{\eta_e + \varepsilon}
\right)^\beta
\]

Gdzie:
- `eta_ref` = docelowy poziom błędu,
- `β` zwykle `0.25 ... 0.5` dla 3D.

Dla startu:
- `beta = 0.35`.

Potem:
\[
h_{target}(e) = \operatorname{clamp}(h_{err}(e), h_{min}, h_{max})
\]

---

### 8.12 Physics-constrained target size

Error estimator nie może sam „decydować o wszystkim”.  
Musisz dodać fizyczny sufit:

\[
h_{phys}(e) =
\min(
c_{ex}l_{ex}(e),
c_k l_k(e),
c_D l_D(e),
c_{geom} r_{curv}(e),
h_{max}
)
\]

I dopiero finalnie:

\[
h_{target}(e) =
\operatorname{clamp}
\Big(
\min(h_{err}(e), h_{phys}(e)),
h_{min},
h_{max}
\Big)
\]

To jest moim zdaniem najważniejszy wzór całego projektu.

---

### 8.13 Gradation smoothing

Po złożeniu `h_target[e]` musisz ograniczyć ostre skoki.

#### Wersja elementowa
Iteracyjnie po sąsiadach:
\[
h_j \leftarrow \min(h_j, g\,h_i)
\]
\[
h_i \leftarrow \min(h_i, g\,h_j)
\]

Gdzie `g` = `1.3 ... 1.5`.

#### Wersja węzłowa
Najpierw zrzucasz elementowe `h` na nody, potem wygładzasz po grafie `node_to_nodes`.

---

### 8.14 Coarsening criterion

Nie rób tylko refine.  
W przeciwnym razie siatka będzie rosnąć bez końca.

Przykład:
- jeśli `eta_e < 0.25 * eta_ref`
- i `quality_ok`
- i `distance_to_interface > d_safe`
- i `h_current < hmax`
to wolno zwiększyć lokalny rozmiar np. o faktor `1.1 ... 1.2` na pass.

---

## 9. Dokładny plan zmian per plik

Poniżej przechodzę przez pliki/moduły, które realnie trzeba ruszyć.

---

### 9.1 `packages/fullmag-py/src/fullmag/model/discretization.py`

### Co jest teraz
Masz dziś:
```python
@dataclass(frozen=True, slots=True)
class FEM:
    order: int
    hmax: float
    mesh: str | None = None
```

To za mało do AFEM.

### Co dodać
Dodaj nowe dataclasses:

```python
@dataclass(frozen=True, slots=True)
class MeshIndicatorWeights:
    torque: float = 1.0
    zz_gradient: float = 1.0
    jump: float = 0.5
    demag: float = 0.5
    quality: float = 0.25
    exchange_length_factor: float = 0.35
    anisotropy_length_factor: float = 0.30
    dmi_length_factor: float = 0.25
    curvature_factor: float = 0.50
    interface_factor: float = 0.50

@dataclass(frozen=True, slots=True)
class MeshTransfer:
    mode: str = "barycentric_renormalize"
    outside_policy: str = "nearest_magnetic"
    renormalize_m: bool = True

@dataclass(frozen=True, slots=True)
class MeshAdaptivity:
    enabled: bool = False
    mode: str = "physics_plus_error"  # off | physics_only | error_only | physics_plus_error
    remesh_every_steps: int | None = None
    remesh_every_seconds: float | None = None
    max_passes: int = 8
    warmup_steps: int = 0
    target_error: float = 0.05
    refine_threshold: float = 1.00
    coarsen_threshold: float = 0.25
    hmin: float | None = None
    hmax: float | None = None
    growth_limit: float = 1.35
    max_new_nodes_factor: float = 2.0
    min_improvement_ratio: float = 0.05
    use_quality_guard: bool = True
    transfer: MeshTransfer = MeshTransfer()
    indicators: MeshIndicatorWeights = MeshIndicatorWeights()
```

I rozszerz `FEM`:

```python
@dataclass(frozen=True, slots=True)
class FEM:
    order: int
    hmax: float
    mesh: str | None = None
    adaptivity: MeshAdaptivity | None = None
```

### Dlaczego tak
- Python API staje się głównym miejscem deklaracji adaptacji,
- script builder i frontend mogą 1:1 mapować te pola,
- da się to bezpiecznie zserializować do IR.

---

### 9.2 `crates/fullmag-ir` — nowy model danych dla adaptacji

Tu trzeba wprowadzić jawny obiekt IR, np.:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshIndicatorWeightsIR {
    pub torque: f64,
    pub zz_gradient: f64,
    pub jump: f64,
    pub demag: f64,
    pub quality: f64,
    pub exchange_length_factor: f64,
    pub anisotropy_length_factor: f64,
    pub dmi_length_factor: f64,
    pub curvature_factor: f64,
    pub interface_factor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshTransferIR {
    pub mode: String,
    pub outside_policy: String,
    pub renormalize_m: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshAdaptivityIR {
    pub enabled: bool,
    pub mode: String,
    pub remesh_every_steps: Option<u64>,
    pub remesh_every_seconds: Option<f64>,
    pub max_passes: u32,
    pub warmup_steps: u64,
    pub target_error: f64,
    pub refine_threshold: f64,
    pub coarsen_threshold: f64,
    pub hmin: Option<f64>,
    pub hmax: Option<f64>,
    pub growth_limit: f64,
    pub max_new_nodes_factor: f64,
    pub min_improvement_ratio: f64,
    pub use_quality_guard: bool,
    pub transfer: MeshTransferIR,
    pub indicators: MeshIndicatorWeightsIR,
}
```

I w `FemPlanIR` / discretization hints dodać:
```rust
pub mesh_adaptivity: Option<MeshAdaptivityIR>,
```

### Ważne
Nie mieszaj tego z adaptive timestep.  
To są dwa różne systemy:
- adaptive timestep kontroluje `dt`,
- adaptive mesh kontroluje `h(x)`.

---

### 9.3 `crates/fullmag-plan` / lowering planu

Planer powinien:

1. przenieść `mesh_adaptivity` z API do `FemPlanIR`,
2. walidować:
   - `hmin <= hmax`,
   - `coarsen_threshold < refine_threshold`,
   - `growth_limit >= 1.0`,
   - sensowne domyślne parametry, jeśli użytkownik podał częściowe dane,
3. wyłączyć/adaptować pewne kombinacje:
   - np. zakaz adaptacji dla backendów, które jeszcze nie wspierają transferu stanu.

W pierwszej wersji:
- możesz ograniczyć AFEM do `backend=fem`,
- `execution_precision=double`,
- `fe_order=1`.

To jest sensowne MVP.

---

### 9.4 `crates/fullmag-engine/src/fem.rs` — rozszerzenie precompute

To jest centralny punkt.

### Co dodać do `MeshTopology`
Proponuję dodać:

```rust
pub struct MeshTopology {
    // istniejące pola...
    pub face_neighbors: Vec<[Option<u32>; 4]>,
    pub element_centroids: Vec<[f64; 3]>,
    pub element_h_rms: Vec<f64>,
    pub element_h_min: Vec<f64>,
    pub element_h_max: Vec<f64>,
    pub element_face_areas: Vec<[f64; 4]>,
    pub element_quality_sicn: Vec<f64>,
    pub element_quality_gamma: Vec<f64>,
    pub interface_face_mask: Vec<bool>,
    pub node_to_elements: Vec<Vec<u32>>,
    pub node_to_nodes: Vec<Vec<u32>>,
    pub tet_bbox_min: Vec<[f64; 3]>,
    pub tet_bbox_max: Vec<[f64; 3]>,
    pub element_l_ex: Vec<f64>,
    pub element_l_k: Vec<f64>,
    pub element_l_d: Vec<f64>,
}
```

### Co dodać jako nowe funkcje

```rust
impl MeshTopology {
    pub fn build_adjacency(&mut self) { ... }
    pub fn build_quality_surrogates(&mut self) { ... }
    pub fn build_transfer_locator(&self) -> TetLocator { ... }
    pub fn build_physics_length_scales(&mut self, material: &MaterialParameters) { ... }
}
```

### Co dodać do problemu/stanu pomocniczego
Nowe struktury:

```rust
pub struct ElementIndicators {
    pub torque: Vec<f64>,
    pub zz_gradient: Vec<f64>,
    pub jump: Vec<f64>,
    pub demag: Vec<f64>,
    pub quality: Vec<f64>,
    pub composite: Vec<f64>,
}

pub struct MeshAdaptSuggestion {
    pub element_target_h: Vec<f64>,
    pub node_target_h: Vec<f64>,
    pub should_remesh: bool,
    pub refine_fraction: f64,
    pub coarsen_fraction: f64,
    pub estimated_node_growth: f64,
}
```

---

### 9.5 `crates/fullmag-engine/src/fem.rs` — nowe obliczenia runtime

Dodaj funkcje:

```rust
impl FemLlgProblem {
    pub fn compute_element_gradients(&self, magnetization: &[Vector3]) -> Vec<[[f64; 3]; 3]>;
    pub fn compute_element_average_field(&self, nodal_field: &[Vector3]) -> Vec<Vector3>;
    pub fn compute_indicator_torque(&self, state: &FemLlgState) -> Result<Vec<f64>>;
    pub fn compute_indicator_zz(&self, state: &FemLlgState) -> Result<Vec<f64>>;
    pub fn compute_indicator_jump(&self, state: &FemLlgState) -> Result<Vec<f64>>;
    pub fn compute_indicator_demag(&self, state: &FemLlgState) -> Result<Vec<f64>>;
    pub fn compute_indicator_quality(&self) -> Vec<f64>;
    pub fn compute_mesh_adapt_suggestion(
        &self,
        state: &FemLlgState,
        cfg: &MeshAdaptivityIR,
    ) -> Result<MeshAdaptSuggestion>;
}
```

### Dokładnie co ma liczyć `compute_mesh_adapt_suggestion(...)`

1. policzyć obserwable (`H_eff`, `H_demag`, energie),  
2. policzyć `eta_torque`,  
3. policzyć `eta_zz`,  
4. policzyć `eta_jump`,  
5. policzyć `eta_demag`,  
6. policzyć `eta_quality`,  
7. znormalizować i złożyć `eta_composite`,  
8. policzyć `h_error`,  
9. policzyć `h_physics`,  
10. zbudować `h_target_elem`,  
11. wygładzić,  
12. zrzucić na węzły,  
13. zdecydować `should_remesh`.

---

### 9.6 `crates/fullmag-runner/src/fem_reference.rs` — pętla AFEM

Tu proponuję dodać **osobną ścieżkę wykonania**, a nie od razu komplikować istniejącą.

#### Nowa funkcja
```rust
pub(crate) fn execute_reference_fem_adaptive_mesh(...)
```

#### Pseudokod

```rust
loop until final_time or relax_converged {
    solve_chunk();
    snapshot_if_needed();

    if mesh_adaptivity_enabled && adapt_checkpoint_due() {
        let suggestion = problem.compute_mesh_adapt_suggestion(&state, cfg)?;

        publish_mesh_error_preview(&suggestion);

        if suggestion.should_remesh {
            let new_mesh = remesh_via_python_cli(
                geometry_ir,
                suggestion.node_target_h,
                mesh_options,
            )?;

            let transferred_m = transfer_magnetization(
                old_mesh,
                new_mesh,
                state.magnetization(),
                cfg.transfer,
            )?;

            rebuild_problem_state_with_new_mesh(
                new_mesh,
                transferred_m,
                // preserve time, maybe reset adaptive dt history
            )?;
        }
    }
}
```

### Bardzo ważna uwaga
Po remeshu:
- dla transientu najlepiej **zresetować historię integratora wielokrokowego**,
- dla RK23/RK45 wyzerować FSAL/history,
- dla adaptive timestep ustawić nowe `dt_initial` sensownie,
- dla relaksacji zwykle można kontynuować od tego samego czasu / stanu.

---

### 9.7 `crates/fullmag-runner/src/native_fem.rs` — adaptacja na poziomie runnera

W pierwszej wersji **nie implementuj remeshu w C++ backendzie**.  
Zrób to tak samo jak w CPU runnerze:

1. backend natywny robi chunk kroków,  
2. Rust pobiera snapshot pól / statystyk,  
3. Rust wylicza `MeshAdaptSuggestion`,  
4. Rust woła `remesh_cli.py`,  
5. Rust przenosi stan,  
6. Rust niszczy backend i tworzy nowy z nowym planem.

To jest dużo prostsze i bezpieczniejsze.

### Co dodać
- funkcje pomocnicze do eksportu aktualnego `m`,
- ew. eksport wskaźników do preview,
- spójne resetowanie backendu po remeshu.

---

### 9.8 `native/backends/fem/include/fullmag_fem.h`

W pierwszej iteracji nie musisz dodawać pełnego „mesh adapt in C ABI”.  
Wystarczy, żeby Rust orchestrator odbudował backend.

Ale warto dodać dwie rzeczy:

#### a) obserwable/telemetria dla estimatorów
Przyszłościowo:
```c
FULLMAG_FEM_OBSERVABLE_MESH_ERROR = ...
FULLMAG_FEM_OBSERVABLE_TARGET_H   = ...
```

#### b) stats adaptacyjne
W `fullmag_fem_step_stats` lub osobnym struct:
- `estimated_error_max`,
- `estimated_error_p95`,
- `magnetic_node_count`,
- `magnetic_element_count`.

Nie jest to konieczne do MVP, ale warto zaplanować.

---

### 9.9 `native/backends/fem/src/context.cpp`

Tu potrzebne są dwie klasy zmian.

#### Zmiana A — correctness / consistency
Zapewnij pełną spójność:
- `magnetic_element_mask`,
- `magnetic_node_mask`,
- średnie objętości tylko po elementach magnetycznych,
- pola termiczne tylko na nodach magnetycznych,
- wszystko to już częściowo jest, ale trzeba utrzymać pełną zgodność z CPU.

#### Zmiana B — cache dla przyszłych estimatorów
Można dodać:
- `element_centroids`,
- `element_h_rms`,
- `quality_surrogate`,
- `node_to_elements`,
- `face_neighbors`.

Ale **to nie jest blocker dla MVP**, jeśli estymatory policzysz w Rust na `MeshIR` + snapshotach pól.

---

### 9.10 `native/backends/fem/src/mfem_bridge.cpp`

To jest miejsce krytycznych poprawek correctness.

#### Musisz naprawić:
- mixed-marker bbox,
- mixed-marker rasterization,
- exchange z mixed markers,
- energię demag ważoną tylko po `magnetic_node_volumes`,
- sampling / zeroing na non-magnetic nodes.

#### Dodatkowo
Jeżeli w przyszłości zechcesz liczyć wskaźniki błędu natywnie, to tu naturalnie można dodać:
- gradient recovery,
- jump estimator,
- quality surrogates,
- lokalne długości.

Ale do MVP nie jest to wymagane.

---

### 9.11 `packages/fullmag-py/src/fullmag/meshing/remesh_cli.py`

To jest absolutnie obowiązkowy patch.

### Obecnie
Input:
```json
{
  "geometry": ...,
  "hmax": ...,
  "order": ...,
  "mesh_options": ...
}
```

### Powinno być
Input:
```json
{
  "mode": "adaptive_size_field",
  "geometry": ...,
  "hmax": ...,
  "order": 1,
  "mesh_name": "pass_003",
  "mesh_options": { ... },
  "size_field": {
    "node_coords": [[x,y,z], ...],
    "h_values": [h0, h1, ...]
  }
}
```

### Implementacja
Jeśli `mode == "adaptive_size_field"`:
- zbuduj `SizeFieldData`,
- wywołaj `remesh_with_size_field(...)`.

Jeśli nie:
- fallback do `generate_mesh(...)`.

To jest mały patch, a odblokowuje połowę całej architektury.

---

### 9.12 `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`

Tu nie trzeba rewolucji, ale trzeba dodać 3 rzeczy:

#### a) publiczne helpery do smoothingu/clipowania size field
Przydadzą się:
- `clip_size_field(hmin, hmax)`,
- `smooth_size_field_graph(...)`,
- `merge_size_fields_min(...)`.

#### b) jawny AFEM mode
Dobrze mieć helper:

```python
def generate_adaptive_mesh(
    geometry: Geometry,
    node_coords: NDArray[np.float64],
    h_values: NDArray[np.float64],
    ...
) -> MeshData:
    ...
```

czyli cienki wrapper nad `remesh_with_size_field(...)`.

#### c) profile Gmsh dla AFEM
Dla adaptacyjnego size field ustawiaj jawnie:
- `Mesh.MeshSizeExtendFromBoundary = 0`,
- `Mesh.MeshSizeFromPoints = 0`,
- `Mesh.MeshSizeFromCurvature = 0`,
- `Mesh.Algorithm3D = 1` (Delaunay) jako bezpieczny default dla dużych gradientów size field.

W UI można zostawić możliwość nadpisania.

---

### 9.13 `apps/web/lib/session/types.ts`

Dodaj nowy stan adaptacji.

#### Proponowany model

```ts
export interface ScriptBuilderMeshAdaptivityState {
  enabled: boolean;
  mode: "off" | "physics_only" | "error_only" | "physics_plus_error";
  remesh_every_steps: string;
  remesh_every_seconds: string;
  max_passes: number;
  warmup_steps: string;
  target_error: string;
  refine_threshold: string;
  coarsen_threshold: string;
  hmin: string;
  hmax: string;
  growth_limit: string;
  max_new_nodes_factor: string;
  min_improvement_ratio: string;
  use_quality_guard: boolean;
  transfer_mode: string;
  outside_policy: string;
  renormalize_m: boolean;
  w_torque: string;
  w_zz: string;
  w_jump: string;
  w_demag: string;
  w_quality: string;
  c_ex: string;
  c_k: string;
  c_d: string;
  c_curv: string;
  c_interface: string;
}
```

I rozszerz:

```ts
export interface ScriptBuilderMeshState {
  ...
  adaptivity: ScriptBuilderMeshAdaptivityState;
}
```

Dodatkowo do live preview/state dodaj:

```ts
export interface MeshAdaptivityPreviewState {
  pass_index: number;
  should_remesh: boolean;
  estimated_error_max: number;
  estimated_error_p95: number;
  refine_fraction: number;
  coarsen_fraction: number;
  suggested_node_growth: number;
}
```

---

### 9.14 `apps/web/components/panels/MeshSettingsPanel.tsx`

To jest naturalne miejsce dla nowego panelu.

### Dodaj sekcje:
1. **Adaptive Mesh**
   - enable switch,
   - mode,
   - remesh every N steps / every T seconds,
   - max passes.

2. **Error control**
   - target error,
   - refine threshold,
   - coarsen threshold,
   - min improvement ratio.

3. **Size limits**
   - hmin,
   - hmax,
   - growth limit,
   - max new nodes factor.

4. **Indicator weights**
   - torque,
   - ZZ,
   - jump,
   - demag,
   - quality.

5. **Physics guards**
   - exchange length factor,
   - anisotropy length factor,
   - DMI length factor,
   - curvature factor,
   - interface factor.

6. **Transfer**
   - barycentric / nearest / l2_project (future),
   - renormalize magnetization,
   - outside policy.

### Dodatkowo
Przyda się przycisk:
- `Suggest Mesh` — policz estymator i pokaż mapę `target_h`, ale jeszcze nie rób remeshu.
- `Apply Remesh` — wykonaj jeden pass ręcznie.

To bardzo pomaga debugować AFEM.

---

### 9.15 `apps/web/components/preview/FemMeshView3D.tsx`

Rozszerz:

```ts
export type FemColorField =
  | "orientation"
  | "x"
  | "y"
  | "z"
  | "magnitude"
  | "quality"
  | "sicn"
  | "mesh_error"
  | "target_h"
  | "refine_mask"
  | "coarsen_mask"
  | "none";
```

### Po co
Bo użytkownik musi widzieć:
- gdzie solver uważa, że siatka jest za gruba,
- gdzie chce refine,
- gdzie może coarsen.

Bez tego adaptacja będzie „czarną skrzynką”, a to się źle debuguje.

---

### 9.16 `apps/web/lib/liveApiClient.ts`

Tu nie trzeba rewolucji.  
Już masz `queueCommand(...)`, `updatePreview(...)`, `updateScriptBuilder(...)`.

Dodaj nowe komendy/payloady warstwy aplikacyjnej, np.:

```ts
queueCommand({
  kind: "mesh_adapt_suggest"
})

queueCommand({
  kind: "mesh_adapt_apply",
  max_passes: 1
})

queueCommand({
  kind: "mesh_adapt_reset"
})
```

I preview endpointy:

```ts
updatePreview("/mesh/error", { quantity: "mesh_error" })
updatePreview("/mesh/target_h", { quantity: "target_h" })
```

Jeżeli backend preview już jest ogólny, to można tylko dodać nowe quantity IDs.

---

## 10. Proponowane API dla Pythona

Tu daję gotowe przykłady „jak użytkownik ma to pisać”.

---

### 10.1 Podstawowy przykład

```python
import fullmag as fm

problem = fm.Problem(
    name="dw_afem",
    geometry=fm.Box(200e-9, 40e-9, 2e-9),
    material=fm.Material(
        saturation_magnetisation=800e3,
        exchange_stiffness=13e-12,
        damping=0.5,
    ),
    discretization=fm.DiscretizationHints(
        fem=fm.FEM(
            order=1,
            hmax=5e-9,
            adaptivity=fm.MeshAdaptivity(
                enabled=True,
                mode="physics_plus_error",
                remesh_every_steps=50,
                max_passes=8,
                target_error=0.05,
                refine_threshold=1.0,
                coarsen_threshold=0.25,
                hmin=1.0e-9,
                hmax=8.0e-9,
                growth_limit=1.35,
                transfer=fm.MeshTransfer(
                    mode="barycentric_renormalize",
                    outside_policy="nearest_magnetic",
                    renormalize_m=True,
                ),
                indicators=fm.MeshIndicatorWeights(
                    torque=1.0,
                    zz_gradient=1.0,
                    jump=0.5,
                    demag=0.5,
                    quality=0.25,
                    exchange_length_factor=0.35,
                    anisotropy_length_factor=0.30,
                    dmi_length_factor=0.25,
                    curvature_factor=0.50,
                    interface_factor=0.50,
                ),
            ),
        )
    ),
)
```

---

### 10.2 Tryb tylko fizycznego startowego meshu

```python
fem=fm.FEM(
    order=1,
    hmax=6e-9,
    adaptivity=fm.MeshAdaptivity(
        enabled=True,
        mode="physics_only",
        max_passes=0,
        hmin=1.2e-9,
        hmax=6.0e-9,
    ),
)
```

Interpretacja:
- bez runtime remeshu,
- tylko startowa siatka ma respektować fizyczne length scales.

---

### 10.3 Tryb ręcznego podglądu i pojedynczego remeshu

```python
session.mesh_adapt_suggest()
session.mesh_adapt_apply(max_passes=1)
```

To przyda się do notebooków i debugowania.

---

### 10.4 Proponowane metody pomocnicze sesji

```python
session.mesh_adapt_suggest()
session.mesh_adapt_apply(max_passes=1)
session.mesh_adapt_run_until_converged()
session.export_mesh_error("mesh_error.vtk")
session.export_target_h("target_h.vtk")
```

Nie musisz ich wszystkich wdrażać od razu, ale warto taki interfejs planować.

---

## 11. Proponowane API/stan dla frontendu

### 11.1 Script builder payload

Przykład payloadu do `updateScriptBuilder(...)`:

```json
{
  "mesh": {
    "algorithm_2d": 6,
    "algorithm_3d": 1,
    "hmax": "5e-9",
    "hmin": "1e-9",
    "size_factor": 1.0,
    "size_from_curvature": 0,
    "smoothing_steps": 1,
    "optimize": "Netgen",
    "optimize_iterations": 2,
    "compute_quality": true,
    "per_element_quality": true,
    "adaptivity": {
      "enabled": true,
      "mode": "physics_plus_error",
      "remesh_every_steps": "50",
      "remesh_every_seconds": "",
      "max_passes": 8,
      "warmup_steps": "0",
      "target_error": "0.05",
      "refine_threshold": "1.0",
      "coarsen_threshold": "0.25",
      "hmin": "1e-9",
      "hmax": "8e-9",
      "growth_limit": "1.35",
      "max_new_nodes_factor": "2.0",
      "min_improvement_ratio": "0.05",
      "use_quality_guard": true,
      "transfer_mode": "barycentric_renormalize",
      "outside_policy": "nearest_magnetic",
      "renormalize_m": true,
      "w_torque": "1.0",
      "w_zz": "1.0",
      "w_jump": "0.5",
      "w_demag": "0.5",
      "w_quality": "0.25",
      "c_ex": "0.35",
      "c_k": "0.30",
      "c_d": "0.25",
      "c_curv": "0.50",
      "c_interface": "0.50"
    }
  }
}
```

---

### 11.2 Komendy live runtime

#### Sugestia
```json
{ "kind": "mesh_adapt_suggest" }
```

#### Jedno zastosowanie remeshu
```json
{ "kind": "mesh_adapt_apply", "max_passes": 1 }
```

#### Wielopass do zadanego limitu
```json
{ "kind": "mesh_adapt_apply", "max_passes": 5 }
```

#### Reset
```json
{ "kind": "mesh_adapt_reset" }
```

#### Eksport pól debugowych
```json
{ "kind": "mesh_adapt_export", "what": "target_h" }
```

---

### 11.3 Quantity IDs dla preview

Dodaj do registry quantity co najmniej:

- `mesh_error`,
- `mesh_error_torque`,
- `mesh_error_zz`,
- `mesh_error_jump`,
- `mesh_error_demag`,
- `mesh_target_h`,
- `mesh_refine_mask`,
- `mesh_coarsen_mask`,
- `mesh_quality_sicn`,
- `mesh_quality_gamma`.

To od razu da świetną diagnostykę.

---

## 12. Przepływ runtime: solver → estymator → remesh → transfer → restart

To jest sekcja wdrożeniowa „co dokładnie ma się dziać”.

---

### 12.1 Pseudokod całej pętli

```rust
let mut pass = 0u32;
let mut problem = build_problem(plan)?;
let mut state = build_state(plan)?;

while !finished {
    let chunk_report = solve_chunk(&mut problem, &mut state, until_next_checkpoint)?;

    publish_live_state(&problem, &state, &chunk_report)?;

    if !mesh_adaptivity_enabled {
        continue;
    }

    if !adapt_checkpoint_due(&state, &chunk_report, &cfg) {
        continue;
    }

    let suggestion = problem.compute_mesh_adapt_suggestion(&state, &cfg)?;
    publish_mesh_adapt_preview(&suggestion)?;

    if !suggestion.should_remesh {
        continue;
    }

    if pass >= cfg.max_passes {
        break;
    }

    let new_mesh = remesh_with_python_cli(
        geometry_ir,
        mesh_options,
        suggestion.node_target_h.clone(),
        format!("mesh_pass_{pass:03}"),
    )?;

    let transferred_state = transfer_state(
        &problem.topology,
        &new_mesh,
        &state,
        &cfg.transfer,
    )?;

    plan.mesh = new_mesh;
    plan.initial_magnetization = transferred_state.magnetization;

    problem = build_problem(plan)?;
    state = build_state_from_transferred(plan, transferred_state)?;

    reset_time_integrator_histories(&mut state);

    pass += 1;
}
```

---

### 12.2 Kiedy checkpoint adaptacyjny ma być „due”

Polecam 4 tryby triggera:

#### Trigger A — po liczbie kroków
- `remesh_every_steps = 50`

#### Trigger B — po czasie fizycznym
- `remesh_every_seconds = 1e-11`

#### Trigger C — po relaksacji plateau
- np. `max torque` nie maleje już istotnie przez kilka checkpointów

#### Trigger D — po problemie jakościowym
- np. `quality guard` wykrył złą lokalną siatkę po poprzednim remeshu

W pierwszej wersji wystarczą A + C.

---

### 12.3 Co dokładnie zrobić po remeshu z czasem integracji

#### Dla relaksacji
- możesz kontynuować od tego samego stanu fizycznego,
- ale zresetuj historię integratora.

#### Dla transientu
Są dwie sensowne opcje:

##### Opcja bezpieczna
- kończysz chunk czasu,
- remesh,
- wznawiasz z tego samego `t`,
- resetujesz wewnętrzną historię integratora i adapt dt controller.

##### Opcja bardziej agresywna
- robisz remesh w połowie chunku i próbujesz zachować dt history.

Nie polecam tego na start.

---

### 12.4 Co przenosić przez transfer stanu

Obowiązkowo:
- `m(x)`.

W zależności od backendu/trybu także:
- `Ms_field`,
- `A_field`,
- `alpha_field`,
- `Ku`, `Ku2`, `Kc1/2/3`,
- `Dind`, `Dbulk`,
- ewentualne pomocnicze pola użytkownika.

Nie przenoś:
- operatorów,
- cache FFT,
- starych macierzy,
- starych locatorów.

To wszystko trzeba odbudować.

---

## 13. Natychmiastowe poprawki krytyczne

To są rzeczy, które zrobiłbym niezależnie od AFEM.

---

### 13.1 Mixed-marker demag bbox w native FEM

Jeżeli bbox liczysz po wszystkich węzłach, a magnetyczny materiał zajmuje tylko część domeny, to:

- transfer-grid będzie za duży,
- FFT będzie droższe,
- rozdzielczość lokalna spadnie,
- aktywna domena się „rozleje”.

**Naprawa:** bbox musi być liczony wyłącznie po węzłach magnetycznych.

---

### 13.2 Mixed-marker rasterization

Rasteryzacja do transfer-grid musi przechodzić tylko po elementach magnetycznych.

Inaczej:
- dostajesz błędną magnetyzację w siatce transferowej,
- demag robi się fizycznie niespójny.

---

### 13.3 Energia demag ważona nie po tych objętościach co trzeba

Jeżeli energia / integracja / normowanie w nodach używa objętości wszystkich elementów zamiast tylko magnetycznych, to wynik nie będzie spójny z CPU i z fizyką.

**Naprawa:** używać `magnetic_node_volumes`.

---

### 13.4 Exchange i materiały mieszane

Jeżeli GPU path nie wspiera dobrze mixed markers / mixed material domains, to adaptacja w pobliżu interfejsów może produkować nonsensy.

Minimalny wymóg:
- elementy niemagnetyczne nie uczestniczą w exchange magnetyzacji,
- nodom niemagnetycznym nie wolno przypisywać pseudo-dynamiki magnetycznej.

---

### 13.5 Test regresji obowiązkowy

Dodaj obowiązkowy test:
- jedna domena magnetyczna + air region,
- mixed markers,
- porównanie CPU FEM vs native FEM:
  - `H_demag`,
  - `E_demag`,
  - `H_ex`,
  - zeroing na nonmag nodes.

Dopiero po tym odpalaj AFEM.

---

## 14. Testy akceptacyjne, benchmarki, regresje

### 14.1 Testy jednostkowe precompute

Obowiązkowo:

1. `MeshTopology::from_ir` dla prostego tetra  
2. `element_h_rms`, `h_min`, `h_max`  
3. `node_to_elements`, `face_neighbors`  
4. `magnetic_bbox` tylko po nodach magnetycznych  
5. `l_ex`, `l_k`, `l_D` dla jednorodnego materiału  
6. `jump estimator` dla prostego sztucznego pola  
7. `ZZ recovery` dla pola liniowego (powinno dawać ~0).

---

### 14.2 Testy transferu stanu

Dla transferu `old → new`:

1. pole stałe `m = const`  
   - po transferze ma pozostać identyczne

2. pole liniowe w przestrzeni  
   - dla P1 barycentric transfer powinien być bardzo dokładny

3. pole normowane o zmiennym kierunku  
   - po transferze i renormalizacji `|m| = 1`

4. nowy node poza starą domeną (np. na granicy po remeshu importowanej geometrii)  
   - fallback policy działa przewidywalnie

---

### 14.3 Testy integracyjne AFEM

#### Scenariusz 1 — prosty box
- relaksacja z losowego `m0`,
- adaptacja co 20 kroków,
- oczekiwanie:
  - energia maleje,
  - torque maleje,
  - node count stabilizuje się,
  - wyniki są lepsze niż dla stałego meshu przy podobnym koszcie.

#### Scenariusz 2 — domain wall
- cienka ściana domenowa,
- oczekiwanie:
  - refinement koncentruje się w ścianie,
  - poza nią następuje coarsening.

#### Scenariusz 3 — DMI / skyrmion
- refinement wokół rdzenia,
- bez rozlania refine na całą domenę.

#### Scenariusz 4 — mixed marker magnet+air
- brak zanieczyszczeń demag i bbox problemów.

#### Scenariusz 5 — importowana geometria STL/STEP
- remesh działa poprawnie po size field.

---

### 14.4 Metryki sukcesu

Mierz:

- finalny błąd / różnicę energii względem referencji,
- `max torque`,
- liczba nodów,
- wall time,
- liczba remesh passes,
- refine fraction / coarsen fraction,
- `sicn_p5`, `gamma_min`,
- zgodność CPU/native po remeshu.

---

### 14.5 Kryteria akceptacyjne MVP

Uznaję MVP za udane, jeśli:

1. działa dla `fe_order=1`, `double`, `fem` backend,  
2. potrafi zrobić co najmniej 1–5 passów remeshu w trakcie relaksacji,  
3. po remeshu stan `m` pozostaje sensowny i znormalizowany,  
4. refine lokuje się tam, gdzie rośnie `eta_torque` / `eta_zz`,  
5. mixed-marker nie psuje demag,  
6. frontend potrafi pokazać `mesh_error` i `target_h`,  
7. `remesh_cli.py` przyjmuje size field.

---

## 15. Roadmapa wdrożenia

### Etap 0 — correctness
**Cel:** naprawić bugi, nic jeszcze nie adaptować.

- mixed-marker bbox
- mixed-marker rasterization
- magnetic node volumes consistency
- testy CPU/native

**Rezultat:** backend jest spójny fizycznie.

---

### Etap 1 — API i protokół
**Cel:** odblokować ścieżkę danych.

- `MeshAdaptivity` w Python API
- `MeshAdaptivityIR`
- `ScriptBuilderMeshAdaptivityState`
- `remesh_cli.py` z `mode="adaptive_size_field"`

**Rezultat:** da się opisać adaptację i przekazać size field.

---

### Etap 2 — solverowe estymatory MVP
**Cel:** umieć policzyć „gdzie refine”.

- `element_h_*`
- adjacency
- `eta_torque`
- `eta_zz`
- `eta_quality`
- composite `eta`
- `target_h`

**Rezultat:** solver umie zasugerować remesh.

---

### Etap 3 — transfer stanu
**Cel:** po remeshu nic nie „umiera”.

- tet locator
- barycentric interpolation
- renormalization `m`
- fallback outside policy

**Rezultat:** można rzeczywiście zmieniać siatkę w czasie biegu.

---

### Etap 4 — pętla AFEM w runnerze
**Cel:** pełny working MVP.

- solve chunk
- suggest
- remesh
- transfer
- rebuild
- continue

**Rezultat:** prawdziwa adaptacja podczas relaksacji.

---

### Etap 5 — frontend i debug UX
**Cel:** to ma być używalne.

- panel adaptivity
- preview `mesh_error`
- preview `target_h`
- histogram / stats adaptacji
- ręczne `Suggest Mesh` / `Apply Remesh`

**Rezultat:** użytkownik widzi, co system robi.

---

### Etap 6 — transient AFEM
**Cel:** adaptacja również dla symulacji czasowych.

- checkpoint po czasie
- restart integratora po remeshu
- logika multiple datasets / passes

**Rezultat:** COMSOL-like time adaptive remesh.

---

### Etap 7 — advanced
**Cel:** zwiększyć jakość i wydajność.

- anisotropic metrics
- mesh movement / TMOP
- node/element renumbering
- multi-level operators / AMR integration
- lepszy demag residual estimator

---

## 16. Załącznik A — szkielety kodu

Poniżej daję gotowe szkielety, które można praktycznie wkleić jako punkt startowy.

---

### 16.1 Python — nowe dataclasses

```python
from __future__ import annotations
from dataclasses import dataclass

@dataclass(frozen=True, slots=True)
class MeshIndicatorWeights:
    torque: float = 1.0
    zz_gradient: float = 1.0
    jump: float = 0.5
    demag: float = 0.5
    quality: float = 0.25
    exchange_length_factor: float = 0.35
    anisotropy_length_factor: float = 0.30
    dmi_length_factor: float = 0.25
    curvature_factor: float = 0.50
    interface_factor: float = 0.50

    def to_ir(self) -> dict[str, object]:
        return {
            "torque": self.torque,
            "zz_gradient": self.zz_gradient,
            "jump": self.jump,
            "demag": self.demag,
            "quality": self.quality,
            "exchange_length_factor": self.exchange_length_factor,
            "anisotropy_length_factor": self.anisotropy_length_factor,
            "dmi_length_factor": self.dmi_length_factor,
            "curvature_factor": self.curvature_factor,
            "interface_factor": self.interface_factor,
        }

@dataclass(frozen=True, slots=True)
class MeshTransfer:
    mode: str = "barycentric_renormalize"
    outside_policy: str = "nearest_magnetic"
    renormalize_m: bool = True

    def to_ir(self) -> dict[str, object]:
        return {
            "mode": self.mode,
            "outside_policy": self.outside_policy,
            "renormalize_m": self.renormalize_m,
        }

@dataclass(frozen=True, slots=True)
class MeshAdaptivity:
    enabled: bool = False
    mode: str = "physics_plus_error"
    remesh_every_steps: int | None = None
    remesh_every_seconds: float | None = None
    max_passes: int = 8
    warmup_steps: int = 0
    target_error: float = 0.05
    refine_threshold: float = 1.0
    coarsen_threshold: float = 0.25
    hmin: float | None = None
    hmax: float | None = None
    growth_limit: float = 1.35
    max_new_nodes_factor: float = 2.0
    min_improvement_ratio: float = 0.05
    use_quality_guard: bool = True
    transfer: MeshTransfer = MeshTransfer()
    indicators: MeshIndicatorWeights = MeshIndicatorWeights()

    def to_ir(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "remesh_every_steps": self.remesh_every_steps,
            "remesh_every_seconds": self.remesh_every_seconds,
            "max_passes": self.max_passes,
            "warmup_steps": self.warmup_steps,
            "target_error": self.target_error,
            "refine_threshold": self.refine_threshold,
            "coarsen_threshold": self.coarsen_threshold,
            "hmin": self.hmin,
            "hmax": self.hmax,
            "growth_limit": self.growth_limit,
            "max_new_nodes_factor": self.max_new_nodes_factor,
            "min_improvement_ratio": self.min_improvement_ratio,
            "use_quality_guard": self.use_quality_guard,
            "transfer": self.transfer.to_ir(),
            "indicators": self.indicators.to_ir(),
        }
```

---

### 16.2 Python — rozszerzenie `FEM`

```python
@dataclass(frozen=True, slots=True)
class FEM:
    order: int
    hmax: float
    mesh: str | None = None
    adaptivity: MeshAdaptivity | None = None

    def to_ir(self) -> dict[str, object]:
        return {
            "order": self.order,
            "hmax": self.hmax,
            "mesh": self.mesh,
            "adaptivity": self.adaptivity.to_ir() if self.adaptivity else None,
        }
```

---

### 16.3 Python — `remesh_cli.py`

```python
def main() -> None:
    raw = sys.stdin.read()
    config = json.loads(raw)

    geometry = _geometry_from_ir(config["geometry"])
    mesh_opts_dict = config.get("mesh_options", {})
    hmax = mesh_opts_dict.get("hmax") or config["hmax"]
    order = config.get("order", 1)
    mesh_opts = _mesh_options_from_dict(mesh_opts_dict)

    mode = config.get("mode", "generate")

    if mode == "adaptive_size_field":
        sf = config["size_field"]
        size_field = SizeFieldData(
            node_coords=np.asarray(sf["node_coords"], dtype=np.float64),
            h_values=np.asarray(sf["h_values"], dtype=np.float64),
        )
        mesh_data = remesh_with_size_field(
            geometry=geometry,
            size_field=size_field,
            hmax=hmax,
            order=order,
            options=mesh_opts,
        )
    else:
        mesh_data = generate_mesh(
            geometry=geometry,
            hmax=hmax,
            order=order,
            options=mesh_opts,
        )

    ...
```

---

### 16.4 Rust — wskaźniki elementowe

```rust
#[derive(Debug, Clone)]
pub struct ElementIndicators {
    pub torque: Vec<f64>,
    pub zz_gradient: Vec<f64>,
    pub jump: Vec<f64>,
    pub demag: Vec<f64>,
    pub quality: Vec<f64>,
    pub composite: Vec<f64>,
}
```

---

### 16.5 Rust — target h suggestion

```rust
#[derive(Debug, Clone)]
pub struct MeshAdaptSuggestion {
    pub element_target_h: Vec<f64>,
    pub node_target_h: Vec<f64>,
    pub should_remesh: bool,
    pub estimated_error_max: f64,
    pub estimated_error_p95: f64,
    pub refine_fraction: f64,
    pub coarsen_fraction: f64,
    pub estimated_node_growth: f64,
}
```

---

### 16.6 Rust — barycentric transfer

```rust
pub fn transfer_magnetization_barycentric(
    old_topology: &MeshTopology,
    new_mesh: &MeshIR,
    old_m: &[[f64; 3]],
    locator: &TetLocator,
    policy: &MeshTransferIR,
) -> Result<Vec<[f64; 3]>, EngineError> {
    let mut out = vec![[0.0; 3]; new_mesh.nodes.len()];

    for (i, p) in new_mesh.nodes.iter().enumerate() {
        if let Some((eid, bary)) = locator.find_containing_tet(*p) {
            let tet = old_topology.elements[eid as usize];
            let mut m = [0.0; 3];
            for local in 0..4 {
                let node = tet[local] as usize;
                for axis in 0..3 {
                    m[axis] += bary[local] * old_m[node][axis];
                }
            }
            if policy.renormalize_m {
                let n = (m[0]*m[0] + m[1]*m[1] + m[2]*m[2]).sqrt();
                if n > 0.0 {
                    m[0] /= n;
                    m[1] /= n;
                    m[2] /= n;
                }
            }
            out[i] = m;
        } else {
            out[i] = fallback_outside_value(*p, old_topology, old_m, policy)?;
        }
    }

    Ok(out)
}
```

---

### 16.7 Rust — composite indicator

```rust
fn build_composite_indicator(
    torque: &[f64],
    zz: &[f64],
    jump: &[f64],
    demag: &[f64],
    quality: &[f64],
    w: &MeshIndicatorWeightsIR,
) -> Vec<f64> {
    fn normalize(v: &[f64]) -> Vec<f64> {
        let mut sorted = v.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p95 = sorted[((0.95 * (sorted.len().saturating_sub(1) as f64)) as usize).min(sorted.len().saturating_sub(1))].max(1e-30);
        v.iter().map(|x| x / p95).collect()
    }

    let nt = normalize(torque);
    let nz = normalize(zz);
    let nj = normalize(jump);
    let nd = normalize(demag);
    let nq = normalize(quality);

    (0..torque.len())
        .map(|i| {
            w.torque * nt[i]
                + w.zz_gradient * nz[i]
                + w.jump * nj[i]
                + w.demag * nd[i]
                + w.quality * nq[i]
        })
        .collect()
}
```

---

### 16.8 Rust — `h_target`

```rust
fn build_target_h_elem(
    topology: &MeshTopology,
    eta: &[f64],
    cfg: &MeshAdaptivityIR,
    h_current: &[f64],
) -> Vec<f64> {
    let eps = 1e-30;
    let beta = 0.35_f64;

    eta.iter()
        .enumerate()
        .map(|(e, &eta_e)| {
            let h_err = h_current[e] * (cfg.target_error / (eta_e + eps)).powf(beta);

            let h_phys = [
                cfg.indicators.exchange_length_factor * topology.element_l_ex[e],
                cfg.indicators.anisotropy_length_factor * topology.element_l_k[e],
                cfg.indicators.dmi_length_factor * topology.element_l_d[e],
                cfg.hmax.unwrap_or(h_current[e]),
            ]
            .into_iter()
            .filter(|x| x.is_finite() && *x > 0.0)
            .fold(f64::INFINITY, |a, b| a.min(b));

            let h = h_err.min(h_phys);
            h.clamp(
                cfg.hmin.unwrap_or(1e-12),
                cfg.hmax.unwrap_or(f64::INFINITY),
            )
        })
        .collect()
}
```

---

### 16.9 TypeScript — stan buildera

```ts
export interface ScriptBuilderMeshAdaptivityState {
  enabled: boolean;
  mode: "off" | "physics_only" | "error_only" | "physics_plus_error";
  remesh_every_steps: string;
  remesh_every_seconds: string;
  max_passes: number;
  warmup_steps: string;
  target_error: string;
  refine_threshold: string;
  coarsen_threshold: string;
  hmin: string;
  hmax: string;
  growth_limit: string;
  max_new_nodes_factor: string;
  min_improvement_ratio: string;
  use_quality_guard: boolean;
  transfer_mode: string;
  outside_policy: string;
  renormalize_m: boolean;
  w_torque: string;
  w_zz: string;
  w_jump: string;
  w_demag: string;
  w_quality: string;
  c_ex: string;
  c_k: string;
  c_d: string;
  c_curv: string;
  c_interface: string;
}
```

---

### 16.10 TypeScript — komendy live

```ts
await currentLiveApiClient().queueCommand({
  kind: "mesh_adapt_suggest",
});

await currentLiveApiClient().queueCommand({
  kind: "mesh_adapt_apply",
  max_passes: 1,
});

await currentLiveApiClient().updatePreview("/mesh/error", {
  quantity: "mesh_error",
});

await currentLiveApiClient().updatePreview("/mesh/target_h", {
  quantity: "mesh_target_h",
});
```

---

## 17. Załącznik B — źródła i odnośniki

Poniżej źródła, które warto traktować jako referencje projektowe do dalszej implementacji.

### 17.1 FullMag — repo i pliki analizowane

- Repo główne:  
  `https://github.com/MateuszZelent/fullmag`

- README / architektura:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/README.md`

- CPU FEM engine:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/crates/fullmag-engine/src/fem.rs`

- CPU FEM runner:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/crates/fullmag-runner/src/fem_reference.rs`

- Native FEM runner wrapper:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/crates/fullmag-runner/src/native_fem.rs`

- FEM C ABI header:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/native/backends/fem/include/fullmag_fem.h`

- FEM native context:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/native/backends/fem/src/context.cpp`

- FEM MFEM bridge:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/native/backends/fem/src/mfem_bridge.cpp`

- Python problem / mesh asset pipeline:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/packages/fullmag-py/src/fullmag/model/problem.py`

- Python discretization model:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/packages/fullmag-py/src/fullmag/model/discretization.py`

- Python Gmsh bridge:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`

- Python remesh CLI:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/packages/fullmag-py/src/fullmag/meshing/remesh_cli.py`

- Frontend mesh settings panel:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/apps/web/components/panels/MeshSettingsPanel.tsx`

- Frontend FEM mesh 3D preview:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/apps/web/components/preview/FemMeshView3D.tsx`

- Frontend session types:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/apps/web/lib/session/types.ts`

- Frontend live API client:  
  `https://raw.githubusercontent.com/MateuszZelent/fullmag/master/apps/web/lib/liveApiClient.ts`

---

### 17.2 MFEM / error estimators / adaptivity

- MFEM performance & partial assembly:  
  `https://mfem.org/performance/`

- MFEM Zienkiewicz-Zhu estimator docs:  
  `https://docs.mfem.org/4.8/classmfem_1_1ZienkiewiczZhuEstimator.html`

- MFEM L2 ZZ estimator docs:  
  `https://docs.mfem.org/4.8/classmfem_1_1L2ZienkiewiczZhuEstimator.html`

- MFEM estimators header docs:  
  `https://docs.mfem.org/4.8/estimators_8hpp_source.html`

- MFEM TMOP / mesh optimization docs:  
  `https://docs.mfem.org/4.8/classmfem_1_1TMOP__Integrator.html`

- MFEM target constructors / adaptivity-related objects:  
  `https://docs.mfem.org/4.8/namespacemfem.html`

---

### 17.3 Gmsh / size fields / remeshing

- Gmsh reference manual:  
  `https://gmsh.info/doc/texinfo/gmsh.html`

- Gmsh sizing fields and background mesh guidance:  
  `https://gmsh.info/doc/texinfo/gmsh.html#Gmsh-mesh-size-fields`

- Gmsh optimization/quality options:  
  `https://gmsh.info/doc/texinfo/gmsh.html#Mesh-options`

---

### 17.4 COMSOL / adaptive meshing

- COMSOL — mesh refinement overview:  
  `https://www.comsol.com/multiphysics/mesh-refinement`

- COMSOL — adaptation concepts / adaptive mesh refinement:  
  `https://www.comsol.com/blogs/how-to-automate-meshing-in-adaptive-mesh-refinement`

- COMSOL 6.3 time-dependent solver docs:  
  `https://doc.comsol.com/6.3/doc/com.comsol.help.comsol/comsol_ref_solver.36.016.html`

---

# Ostateczna rekomendacja

Jeżeli mam podać jednozdaniową rekomendację techniczną:

> **Rozwijaj FullMag w stronę runner-level AFEM opartego o skalarne `target_h(x)` generowane z połączenia estymatora błędu i długości fizycznych (`l_ex`, `l_k`, `l_D`), z remeshingiem realizowanym przez istniejące `remesh_with_size_field(...)`, a nie przez od razu pełny AMR w backendzie MFEM.**

To da najszybszą drogę do „działa jak COMSOL”, przy najmniejszym ryzyku architektonicznym i z maksymalnym reuse obecnego kodu.
