# Fullmag — szczegółowy audyt wizualizacji 3D, 2D field/slice i interakcji viewportu
**Data:** 2026-04-01  
**Zakres:** pełna analiza bieżącego kodu wizualizacji:
- FEM mesh 3D,
- FDM magnetization / field 3D,
- slice 2D,
- scalar preview 2D,
- overlaye obiektów i anten,
- kamera, ViewCube, osie, clipping,
- selection / isolate / focus,
- jakość fizyczna prezentacji pola i magnetyzacji,
- propozycja profesjonalnego systemu narzędzi transformacji w stylu 3ds Max / DCC.

---

## 1. Executive summary

Bieżący system wizualizacji Fullmag **ma już solidne fundamenty**, ale jest też bardzo wyraźnie zlepkiem kilku warstw rozwijanych etapami. To właśnie z tego bierze się Twój objaw:

- przy części ustawień kamery elementy wyglądają jakby się przenikały,
- isolate bywa mylące,
- fokus nie zawsze jest stabilny,
- osie i domena nie zawsze są semantycznie oczywiste,
- narzędzia transformacji są dziś tylko częściowym szkicem pełnego systemu,
- wizualizacja pola i magnetyzacji jest funkcjonalna, ale jeszcze nie „profesjonalna / publikacyjna / DCC-grade”.

### Najważniejszy wniosek architektoniczny

Dziś Fullmag nie ma jeszcze jednego spójnego, centralnego subsystemu:
1. **scene graph / object transform stack**,
2. **camera controller**,
3. **selection manager**,
4. **render pipeline z passami**,
5. **field visualization suite**.

Zamiast tego są:
- dobre komponenty lokalne,
- sensowne overlaye,
- kilka udanych poprawek w Control Room,
- ale nadal sporo logiki „rozsianej” po `FemMeshView3D`, `MagnetizationView3D`, `FdmInstances`, `FemGeometry`, `SceneAxes3D`, `ViewCube`, `ControlRoomContext`.

To jest dokładnie ten typ systemu, który „działa dobrze przez 80% czasu”, ale przy bardziej złożonym układzie sceny zaczyna dawać wizualne i interakcyjne anomalie.

---

## 2. Najważniejsze problemy potwierdzone w bieżącym kodzie

Poniżej streszczam najważniejsze problemy zanim przejdę do plików.

### P1. Transform tools istnieją tylko częściowo
Masz już zalążek systemu gizmo:
- `PivotControls` w FEM,
- `PivotControls` w FDM,
- translację obiektów,
- translację anten.

Ale to jest **tylko MOVE**, i to jeszcze:
- na overlay boxach,
- bez rotate,
- bez scale,
- bez pivot modes,
- bez local/world,
- bez snap,
- bez wartości numerycznych,
- bez undo/redo,
- bez wspólnej architektury transformacji.

Czyli: to nie jest jeszcze „3ds Max-like transform system”. To jest tylko pierwszy krok.

### P2. Transparent rendering + `depthWrite={false}` powodują część „przenikania”
W wielu miejscach stosowane są transparentne materiały z wyłączonym `depthWrite`. To samo w sobie nie jest bugiem — ale przy złożonych scenach:
- daje bleed-through,
- rozmywa relacje przód/tył,
- pogarsza perception,
- wygląda jak „obiekty przenikają przez siebie”.

### P3. Transparentne instancing w FDM nie da się poprawnie sortować per-instance
W `FdmInstances.tsx` voxel mode używa `InstancedMesh` i transparentnych materiałów. Three.js nie daje tu pełnego, poprawnego sortowania dla każdej instancji. To jest klasyczna przyczyna „pływania” transparentnych warstw przy obrocie kamery.

### P4. FEM camera / ViewCube mają niespójny model targetu
W FEM:
- `focusObject(...)` pracuje względem aktualnego targetu,
- ale `handleViewCubeRotate(...)` przelicza dystans względem origin i resetuje `controls.target` do `[0,0,0]`.

To oznacza, że po focusie na obiekt i potem kliknięciu ViewCube kamera może wrócić do geometrii liczonej wokół origin, a nie wokół aktualnie fokusowanego obiektu. To jest realny, konkretny bug.

### P5. Clipping w FEM ma złą semantykę geometryczną
Obecny volumetric clip w `FemGeometry.tsx`:
- operuje na centroidach tetraedrów,
- pozycję clip plane przelicza przez `maxDim`, a nie rzeczywisty rozmiar danej osi.

To znaczy:
- clip nie jest fizycznie wiernym przecięciem objętości,
- pozycja clip plane jest niespójna między osiami przy niesześciennych domenach.

### P6. Opaque, transparent, overlay, selection i gizmo są mieszane w jednym passie sceny
Brakuje jawnego render pipeline z warstwami/passami:
- opaque main geometry,
- transparent context geometry,
- selection highlight,
- gizmos,
- labels,
- helpers/axes.

Dziś te elementy rywalizują w jednym buforze depth z ręcznie ustawianym `renderOrder`, co działa tylko do pewnego stopnia.

### P7. Wizualizacja pola magnetycznego i magnetyzacji jest funkcjonalna, ale jeszcze nie „publikacyjna”
Brakuje:
- prawdziwych isolinii/contours,
- streamlines,
- integral curves,
- LIC / flow map,
- sensownych wektorów 3D skalowanych amplitudą,
- wnętrzowego próbkowania FEM pola,
- pełnej kontroli jednostek i legend.

### P8. Slice 2D FEM jest zaskakująco dobry, ale 3D field viz jest słabszy niż 2D
To ważny paradoks obecnego systemu:
- `FemMeshSlice2D.tsx` robi rzeczywiste przecięcia geometryczne,
- a `FemArrows.tsx` w 3D pokazuje tylko sampled boundary nodes i nie skaluje długości strzałek amplitudą.

Czyli 2D jest momentami bardziej „fizycznie sensowne” niż 3D.

---

## 3. Aktualna architektura viewportów

## 3.1. Router viewportów: `apps/web/components/runs/control-room/ViewportPanels.tsx`

To jest centralny rozdzielacz.

### Obecny podział
- FEM Mesh 3D → `FemMeshView3D`
- FEM quantity 3D → `FemMeshView3D`
- FEM 2D → `FemMeshSlice2D`
- FDM 3D → `MagnetizationView3D`
- FDM 2D → `MagnetizationSlice2D`
- scalar preview 2D → `PreviewScalarField2D`
- analiza modów/eigen → `AnalyzeViewport`

### Co jest dobre
- architektura jest czytelna,
- komponenty są rozdzielone według backendu i rodzaju danych,
- FDM 3D canvas jest trzymany stale zamontowany (linie 567–571), co ogranicza resetowanie GL context i kamery.

### Co jest jeszcze problemem
- nie ma jednej wspólnej warstwy abstrakcji dla kamery, selection i transform tools,
- FEM i FDM rozwijają podobne funkcje niezależnie,
- to rodzi dryf semantyczny.

### Rekomendacja
Wprowadzić wspólną warstwę:
- `ViewportCameraController`,
- `ViewportSelectionStore`,
- `TransformSessionState`,
- `RenderLayerPolicy`.

---

## 4. Audyt szczegółowy — FEM 3D

# 4.1. `apps/web/components/preview/FemMeshView3D.tsx`

To jest główny komponent FEM 3D. Zawiera:
- canvas,
- controls,
- ViewCube,
- camera auto-fit,
- clipping plane,
- render geometrii,
- arrows,
- highlight,
- overlaye obiektów i anten,
- toolbar,
- screenshot,
- selection,
- focus.

### 4.1.1. Mocne strony
1. Komponent jest już wyraźnie modularny.
2. Obsługuje:
   - renderMode,
   - opacity,
   - arrows,
   - clip,
   - selection,
   - object overlays,
   - antenna overlays.
3. Osie sceny potrafią używać `worldExtent` / `worldCenter` (linie 671–692, 868).
4. Focus na obiekt liczy target z bounds overlayu i dobiera dystans z FOV (linie 726–762).

To są dobre fundamenty.

### 4.1.2. Problem: ViewCube resetuje target do origin
**Linie 771–780.**

```ts
const dist = cam.position.length();
cam.position.copy(new THREE.Vector3(0, 0, 1).applyQuaternion(quat).multiplyScalar(dist));
cam.lookAt(0, 0, 0);
ctl.target.set(0, 0, 0);
```

To jest błąd projektowy.

#### Dlaczego to jest problem
Jeżeli użytkownik:
1. zrobi `Focus` na konkretnym obiekcie,
2. obróci kamerę ViewCube,
to oczekuje rotacji wokół **aktualnego targetu**, a nie powrotu do world origin.

#### Objawy
- kamera „przeskakuje”,
- obiekt nagle nie jest już w centrum,
- użytkownik ma wrażenie, że viewport „wariuje”.

#### Jak naprawić
Zastąpić ten kod wersją target-aware:

```ts
const target = ctl.target.clone();
const dist = cam.position.clone().sub(target).length();
const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(quat).normalize();
cam.position.copy(target).add(dir.multiplyScalar(dist));
cam.lookAt(target);
ctl.target.copy(target);
ctl.update();
```

#### Gdzie
- `apps/web/components/preview/FemMeshView3D.tsx`

#### Priorytet
**P0.** To jest realny bug UX/camera correctness.

---

### 4.1.3. Problem: `CameraAutoFit` patrzy zawsze na origin
**Linie 119–130.**

```ts
camera.position.set(d * 0.75, d * 0.6, d * 0.75);
camera.lookAt(0, 0, 0);
```

#### Dlaczego to słabe
To działa tylko wtedy, gdy:
- scena jest sensownie scentrowana wokół origin,
- albo `geomCenter` został już odjęty z geometrii tak, że origin rzeczywiście jest właściwym centrum.

Ale gdy pracujemy z:
- world center,
- object focus,
- nontrivial domain center,
- przyszłym systemem transformacji,

autofit powinien być oparty na **jawnie wybranym target center**, nie na zakładanym origin.

#### Naprawa
Wprowadzić wspólne API:
- `fitCameraToBounds(bounds, targetCenter, preserveDirection = true)`.

Potem:
- `CameraAutoFit`,
- `setCameraPreset`,
- `focusObject`,
- `ViewCube rotate`

powinny używać jednej wspólnej logiki.

---

### 4.1.4. Problem: camera presety też resetują target do origin
**Linie 710–724.**

`front/top/right/reset` ustawiają kamerę i target na `[0,0,0]`.

To jest ten sam problem co przy ViewCube, tylko mniej spektakularny.

#### Rekomendacja
Camera preset powinien działać względem:
- `currentTarget`,
- albo `worldCenter`,
- albo `selected object center`.

Najlepiej:
- domyślnie względem `currentTarget`,
- z osobnym przyciskiem `Reset to domain center`.

---

### 4.1.5. Problem: screenshot wybiera canvas przez globalny selector
**Linie 782–789.**

```ts
const canvas = document.querySelector(".fem-canvas-container canvas")
```

#### Ryzyko
Jeżeli na stronie pojawią się:
- dwa FEM canvasy,
- embedded preview,
- przyszłe split view,

to można złapać nie ten canvas.

#### Naprawa
Używać ref do konkretnego canvas/R3F root.

---

### 4.1.6. Problem: gizmo transformacji = tylko translacja
**Linie 218–234 oraz 358–374.**

Widzimy `PivotControls` dla:
- anten,
- obiektów.

Ale `onDragEnd` tylko czyta `groupRef.current.position` i wywołuje:
- `onAntennaTranslate(...)`,
- `onGeometryTranslate(...)`.

#### Czego brakuje
- rotate,
- scale,
- local/world orientation,
- plane drag,
- axis locking policy,
- snapping,
- numeric input,
- pivot mode,
- transform history,
- temporary preview vs committed transform.

#### Wniosek
To jest **zalążek systemu**, nie gotowy system.

---

## 4.2. `apps/web/components/preview/r3f/FemGeometry.tsx`

To jest właściwy renderer geometrii FEM.

### 4.2.1. Problem: clipping używa `maxDim`, nie rozmiaru danej osi
**Linie 160–179.**

```ts
const size = new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ);
const ms = Math.max(size.x, size.y, size.z);
const posReal = ((clipPos ?? 50) / 100 - 0.5) * ms;
```

#### Dlaczego to zły model
Jeśli domena ma rozmiar:
- X = 100 nm,
- Y = 100 nm,
- Z = 1000 nm,

to clip 50% dla osi X nie powinien być liczony przez `1000 nm`.

#### Objaw
Pozycja clip plane dla X/Y/Z nie odpowiada tej samej fizycznej frakcji danej osi.

#### Naprawa
Liczyć osobno:
```ts
const axisSize = axisIdx === 0 ? size.x : axisIdx === 1 ? size.y : size.z;
const posReal = ((clipPos ?? 50) / 100 - 0.5) * axisSize;
```

#### Priorytet
**P0/P1** — to wpływa na fizyczną poprawność wizualizacji.

---

### 4.2.2. Problem: volumetric clip jest centroid-based, nie geometryczny
**Linie 180–192 oraz logika dla tetrahedrów.**

Aktualny kod:
- bierze centroid tetra,
- jeśli centroid „jest po odciętej stronie”, to cały tet znika.

#### Dlaczego to jest problem
To nie jest prawdziwe przecięcie objętości. Tetra przecięty częściowo powinien zostać pocięty na nową geometrię przekroju, a nie usunięty albo pozostawiony w całości.

#### Objawy
- clip wygląda skokowo,
- przekrój bywa optycznie „schodkowy” i niezgodny z rzeczywistą geometrią,
- trudno ufać temu jako narzędziu fizycznej inspekcji.

#### Rekomendacja
Dwie ścieżki:
1. szybka diagnostyczna:
   - zachować obecny centroid clip, ale wyraźnie oznaczyć jako `Approximate clip`,
2. docelowa:
   - zaimplementować prawdziwe clipping przecięcia tetra przez plane.

#### Gdzie
- `apps/web/components/preview/r3f/FemGeometry.tsx`
- prawdopodobnie z wydzieleniem helpera `clipTetraByPlane(...)`.

---

### 4.2.3. Problem: bardzo podejrzany fragment warunków clip
**Linie 186–188.**

```ts
if (clipAxis === "x" ? cx > posReal : cx > posReal) {
  if ((clipAxis === "x" && cx > posReal) || (clipAxis === "y" && cx > posReal) || (clipAxis === "z" && cx > posReal)) continue;
}
```

To wygląda jak kod po refaktorze, który nie został wyczyszczony.

#### Co to oznacza
- logika jest redundantna,
- czytelność jest gorsza,
- łatwiej o bug przy dalszych zmianach.

#### Naprawa
Uprościć do jednej czytelnej funkcji:
```ts
const shouldCullTet = centroid[axisIdx] > posReal;
if (shouldCullTet) continue;
```

---

### 4.2.4. Problem: transparent surface + `DoubleSide`
**Linie 387–395.**

```tsx
<meshPhongMaterial
  vertexColors
  side={THREE.DoubleSide}
  transparent={isTransparent}
  opacity={opacityVal}
  depthWrite={!isTransparent}
/>
```

#### Dlaczego to generuje artefakty
Połączenie:
- `DoubleSide`,
- transparency,
- `depthWrite = false`

dla złożonych powierzchni jest klasycznym źródłem:
- backface bleed-through,
- niestabilnego sortowania,
- wrażenia, że obiekt przenika sam siebie lub sąsiedni obiekt.

#### Kiedy to boli najmocniej
- przy niższej opacity,
- przy wielu obiektach blisko siebie,
- przy obiektach o złożonej krzywiźnie,
- przy isolate/context transparent overlays.

#### Naprawa
Wprowadzić render policy:
1. główny surface — jeśli możliwe, `FrontSide` dla zamkniętej powierzchni,
2. `DoubleSide` tylko gdy naprawdę potrzebne,
3. transparent surfaces przenieść do osobnego transparent pass,
4. rozważyć depth pre-pass dla opaque geometry.

---

### 4.2.5. Problem: brak jawnego rozdziału render mode „diagnostic” vs „presentation”
Dziś `FemGeometry` próbuje być jednocześnie:
- rendererem pięknej sceny,
- rendererem diagnostyki siatki,
- rendererem quality view,
- rendererem clip/shrink.

To prowadzi do zbyt wielu warunków w jednym komponencie.

#### Rekomendacja
Rozdzielić na:
- `FemSurfaceRenderer`,
- `FemWireRenderer`,
- `FemDiagnosticRenderer`,
- `FemClipRenderer`,
- `FemSelectionRenderer`.

---

## 4.3. `apps/web/components/preview/r3f/FemArrows.tsx`

To jest renderer strzałek 3D dla FEM.

### 4.3.1. Problem: próbkowane są tylko boundary nodes
**Linie 71–80, 197.**

```ts
sampleBoundaryNodes(...)
const sampledNodes = sampleBoundaryNodes(meshData.nodes, meshData.boundaryFaces, arrowDensity, fld);
```

#### Znaczenie
To oznacza, że strzałki nie reprezentują pola w objętości, tylko głównie na granicy.

#### Konsekwencja fizyczna
Dla wielu wizualizacji pola:
- to jest za mało,
- a czasem wręcz mylące.

#### Naprawa
Dodać tryby:
- `boundary`,
- `interior random`,
- `interior stratified`,
- `element centroids`,
- `custom seed set`.

Najlepiej w UI:
- `Sampling domain: Boundary / Volume / Selection / Slice plane`.

---

### 4.3.2. Problem: strzałki nie skalują długości amplitudą
**Linie 233–239.**

Dla niezerowego wektora:
```ts
scalesList[i * 3] = 1;
scalesList[i * 3 + 1] = 1;
scalesList[i * 3 + 2] = 1;
```

#### Konsekwencja
Długość strzałki nie niesie informacji o module; moduł idzie tylko w kolor.

#### Dlaczego to słabe
W 3D użytkownik naturalnie oczekuje, że:
- kierunek = orientacja,
- amplituda = długość,
- ewentualnie kolor = komponent / dodatkowe kodowanie.

#### Naprawa
Wprowadzić tryb:
- `Length = constant | magnitude | sqrt(magnitude) | log(magnitude)`,
- plus clamp / normalize.

---

### 4.3.3. Problem: sampling heuristics jest sprytny, ale semantycznie ukryty
Kod celowo faworyzuje komórki z niskim alignment (domain wall). To jest ciekawe dla magnetyzacji, ale:
- nie jest opisane w UI,
- może być nieintuicyjne dla użytkownika,
- nie nadaje się jako jedyne zachowanie.

#### Rekomendacja
Nazwać to jawnie:
- `Adaptive (domain walls)`,
- `Uniform`,
- `Poisson disk`,
- `Boundary only`,
- `Volume`.

---

## 4.4. `apps/web/components/preview/r3f/FemHighlightView.tsx`

To nieduży komponent highlightu zaznaczonych ścian.

### Co jest OK
- osobny komponent,
- czytelna rola,
- selection highlight jest wyraźny.

### Problem
Jest to dalej transparentny overlay z `depthWrite={false}` i `polygonOffsetFactor={-1}`. To jest sensowne jako overlay, ale w połączeniu z innymi transparentnymi warstwami może dawać nadmiar „świecenia” przez geometrię.

### Rekomendacja
Przenieść highlight do dedykowanego overlay passu albo renderować go po depth-prepass głównej geometrii.

---

## 5. Audyt szczegółowy — FDM 3D

# 5.1. `apps/web/components/preview/MagnetizationView3D.tsx`

To jest główny komponent FDM 3D. Jest dość dojrzały UX-owo, ale ma kilka bardzo konkretnych ograniczeń.

### 5.1.1. Mocne strony
1. Sensowny panel sterowania.
2. Zachowanie canvas w DOM.
3. Dobre mapowanie osi sceny:
   - scene-X = sim-X,
   - scene-Y = sim-Z,
   - scene-Z = sim-Y.
4. Focus na obiekt jest lepiej target-aware niż w FEM (linie 543–580).
5. Istnieje zalążek transform gizmo także dla FDM.

### 5.1.2. Problem: isolate to bardziej „dim context” niż prawdziwe isolate
**Linie 618–621.**

```ts
const sceneOpacityMultiplier =
  objectViewMode === "isolate" && selectedObjectId
    ? 0.22
    : 1;
```

#### Co to realnie robi
To nie odcina reszty sceny. To głównie czyni ją bardziej transparentną.

#### Konsekwencja
Przy voxel/glyph scene:
- użytkownik nadal widzi nieizolowane dane,
- przy transparency może to wyglądać jak przenikanie,
- semantyka „isolate” nie jest dosłowna.

#### Naprawa
Wprowadzić dwa tryby:
1. `Context` — dim background,
2. `True isolate` — aktywna maska tylko dla wybranego obiektu,
3. opcjonalnie `Ghost others` — półprzezroczyste otoczenie.

---

### 5.1.3. Problem: transform gizmo w FDM też obsługuje tylko translację
**Linie 336–357 oraz 434–455.**

Tutaj dodatkowo translacja jest mapowana z koordynatów sceny do fizycznych rozmiarów komórek.

To jest poprawne jako pierwszy krok, ale znowu:
- tylko move,
- bez rotate/scale,
- bez lokalnych osi,
- bez snap,
- bez jednej wspólnej abstrakcji z FEM.

---

### 5.1.4. Plus: focus na obiekt jest lepszy niż w FEM
**Linie 543–580.**

Ten kod:
- bierze target z overlay bounds,
- liczy promień i dystans,
- zachowuje aktualny kierunek patrzenia.

To jest dużo bardziej dojrzały model niż część FEM camera logic. Warto go traktować jako punkt odniesienia dla refaktoru.

### Rekomendacja
Przenieść tę logikę do wspólnego helpera używanego przez oba viewporty.

---

## 5.2. `apps/web/components/preview/r3f/FdmInstances.tsx`

To tutaj znajduje się najważniejsze źródło artefaktów FDM.

### 5.2.1. Problem: transparentne instanced voxels
**Linie 171–200, 401–415.**

Dla voxel mode materiały są transparentne. Dodatkowo przy niższej opacity:
- `depthWrite` jest wyłączone,
- wszystko renderuje się jako transparent instanced mesh.

#### Dlaczego to jest fundamentalnie problematyczne
Three.js nie zapewnia pełnego sortowania poszczególnych instancji w `InstancedMesh` dla transparentnych warstw. Sortowany jest obiekt jako całość, nie każda kostka osobno.

#### Objawy
- przy obrocie kamery warstwy voxeli „przepływają przez siebie”,
- tył potrafi nagle wyjść przed przód,
- kilka obiektów w isolate/context potęguje bałagan.

#### To jest najważniejsze wyjaśnienie Twojej obserwacji:
> „czasami elementy przenikają przez siebie, wszystko jest pomieszane dla niektórych ustawień kamery”

To **bardzo prawdopodobnie nie jest błąd fizyki**, tylko klasyczny problem transparent instancing + depth write + ordering.

#### Naprawa — wariant minimalny
1. W trybie voxel:
   - domyślnie rendering opaque,
   - transparency tylko w specjalnym „X-ray” mode.
2. Przy isolate:
   - nie robić półtransparentnego świata domyślnie,
   - tylko twardo maskować instancje nieaktywne.

#### Naprawa — wariant profesjonalny
1. Osobny renderer dla opaque voxels.
2. Dla transparent voxels:
   - weighted blended OIT,
   - albo depth peeled transparency,
   - albo fallback do slice/volume raymarching.
3. Przy dużych datasetach:
   - volume rendering / ray-marched 3D texture zamiast instanced boxes.

---

### 5.2.2. Problem: glyph mode też nie niesie amplitudy długością
**Linie 365–383.**

Strzałki/glyphy w FDM mają skalę:
```ts
_tempScale.set(1, 1, 1);
```

Czyli znowu długość nie mówi nic o module.

#### Konsekwencja
W 3D użytkownik widzi orientację, ale nie dostaje intuicyjnej informacji o sile.

#### Naprawa
Tak samo jak w FEM:
- length mode,
- clamp,
- normalize,
- logarithmic option.

---

### 5.2.3. Problem: topography mode jest ciekawy, ale nie powinien udawać fizyki
**Linie 340–346.**

Topography displacement jest efektem prezentacyjnym. To jest OK jako tryb exploratory visualization, ale trzeba to jasno nazwać.

#### Rekomendacja
W UI opisać to jako:
- `Stylized displacement`,
- a nie jako neutralny tryb pola.

---

### 5.2.4. Problem: `frustumCulled = false`
**Linia 212.**

Dla dużych datasetów to może być kosztowne.

#### Rekomendacja
Dodać własne coarse culling:
- chunking instancji,
- render tiles/chunks,
- LOD po kamerze.

---

## 6. Audyt szczegółowy — osie, kamera, helpery

# 6.1. `apps/web/components/preview/ViewCube.tsx`

To komponent bardzo użyteczny, ale wymaga dopracowania.

### 6.1.1. Dobre strony
- interakcyjny,
- zsynchronizowany z kamerą,
- działa jako oddzielny gizmo,
- ma reset i drag orbit.

### 6.1.2. Problem: różne ścieżki działania zależnie od tego, czy przekazano `onRotate`
- FDM używa default behavior ViewCube + grid center.
- FEM używa `onRotate`, które deleguje do swojego callbacka.

To rodzi rozjazd funkcjonalny między viewportami.

### Rekomendacja
ViewCube powinien nie znać szczegółów FDM/FEM. Powinien mówić tylko:
- `rotateToDirection(dir, up)`,
- a wspólny camera controller ma zdecydować, co to znaczy dla aktualnego targetu.

---

# 6.2. `apps/web/components/preview/r3f/SceneAxes3D.tsx`

### 6.2.1. Mocne strony
- sensowne jednostki SI,
- ticki,
- billboard labels,
- wsparcie dla zamiany etykiet osi w FDM.

### 6.2.2. Problem: ciężki, bogaty helper renderowany bez osobnej polityki jakości
Przy każdej scenie renderujesz:
- tick lines,
- billboard texts,
- axis labels.

To jest świetne dla debug i screenshotów, ale nie zawsze optymalne dla wydajności.

### Rekomendacja
Dodać profile:
- `Full axes`,
- `Compact axes`,
- `Corner triad only`,
- `Hidden`.

### 6.2.3. Problem semantyczny
Komentarz mówi o `worldExtent` jako fizycznym extencie, ale użytkownik nadal może nie wiedzieć, czy to:
- Universe,
- object union,
- active visible volume.

### Naprawa
Wyświetlać subtelny tag:
- `Domain`,
- `Universe`,
- `Mesh bbox`,
- `Visible clip volume`.

---

## 7. Audyt 2D — slices, heatmapy, pola, izolinie

# 7.1. `apps/web/components/preview/FemMeshSlice2D.tsx`

To jest obecnie jeden z najmocniejszych elementów systemu.

### Co jest bardzo dobre
1. Dla surface mesh i tetra mesh robi rzeczywiste przecięcia z płaszczyzną.
2. Rysuje:
   - polygony dla przecięcia objętości,
   - segmenty dla przecięcia powierzchni.
3. Potrafi kolorować przez pole skalarne.
4. Potrafi pokazywać anteny w przekroju.

### To jest naprawdę dobra baza
Ta część jest bliższa narzędziu inżynierskiemu niż wiele innych elementów UI.

### Co brakuje
- isolinii,
- contour labels,
- streamlines,
- fizycznych osi w metrach na podziałce użytkownika,
- crosshair readout w jednostkach fizycznych,
- export SVG/PDF.

### Rekomendacja
Rozbudować ten komponent do głównego narzędzia:
- `Field Slice Inspector`,
- z prawdziwymi konturami i przekrojami.

---

# 7.2. `apps/web/components/preview/MagnetizationSlice2D.tsx`

To jest heatmap ECharts na siatce FDM.

### Co działa dobrze
- tooltip,
- smart scaling,
- dataZoom,
- saveAsImage,
- komponenty i moduł pola.

### Co jest ograniczeniem
- to wciąż tylko heatmapa,
- osie są w komórkach (`cell`), nie w fizycznych metrach,
- nie ma contour lines,
- nie ma streamlines,
- nie ma wektorowego overlayu.

### Rekomendacja
Dodać tryby:
- heatmap,
- contours,
- contours + heatmap,
- quiver,
- streamlines,
- LIC.

---

# 7.3. `apps/web/components/preview/PreviewScalarField2D.tsx`

To lekki preview. Dobrze spełnia rolę podglądu, ale nie powinien być mylony z pełnoprawnym narzędziem analitycznym.

### Rekomendacja
Traktować jako:
- szybki podgląd,
- a nie główne narzędzie field analysis.

---

# 7.4. `apps/web/components/preview/MagnetizationView2D.tsx`

To wygląda jak starszy / prostszy komponent ECharts, raczej pomocniczy lub legacy.

### Rekomendacja
Sprawdzić, czy jest jeszcze aktywnie używany. Jeśli nie:
- oznaczyć jako legacy,
- albo usunąć, żeby nie dublować logiki z `MagnetizationSlice2D.tsx`.

---

## 8. Control Room i warstwa danych

# 8.1. `apps/web/components/runs/control-room/ControlRoomContext.tsx`

To jest klucz do spójności świata.

### 8.1.1. Co jest dobrze
- `worldExtent` dla FEM preferuje manual Universe, potem object bounds + padding, potem fallbacki (linie 748–778),
- `worldCenter` preferuje universe center i builder object center (linie 779–793),
- istnieją `applyAntennaTranslation` i `applyGeometryTranslation` (linie 1186–1231).

To jest duży postęp.

### 8.1.2. Problem: transform layer to tylko translation fields
Obecnie translacja geometrii zapisuje się do:
- `geometry_params.translation`.

Brakuje analogicznych warstw dla:
- rotation,
- scale,
- pivot,
- transform space,
- transform locks.

#### Rekomendacja
Rozszerzyć model danych buildera o:
```ts
transform: {
  translation: [x, y, z],
  rotation_euler?: [rx, ry, rz],
  rotation_quat?: [qx, qy, qz, qw],
  scale?: [sx, sy, sz],
  pivot?: [px, py, pz],
}
```

Następnie:
- wszystkie overlaye i viewporty powinny czytać z jednej struktury,
- rewrite script powinien umieć to serializować.

---

# 8.2. `apps/web/components/runs/control-room/shared.tsx`

### Mocne strony
- `combineBounds(...)`,
- `boundsCenter(...)`,
- `boundsExtent(...)`,
- `extractGeometryBoundsFromParams(...)`,
- `buildObjectOverlays(...)`.

To jest dobra baza dla scene graphu.

### Problem
Obecne overlaye są AABB-centric. To wystarczy na:
- focus,
- selekcję obiektu w drzewku,
- proste translate gizmo,

ale nie wystarcza na:
- wierne zaznaczanie geometrii,
- rotate/scale wokół właściwego pivotu,
- precyzyjne interakcje w złożonych kształtach.

### Rekomendacja
Wprowadzić dwa poziomy reprezentacji:
1. `ObjectOverlayBounds` — AABB/OBB do szybkiego UX,
2. `ObjectRenderProxy` — rzeczywista reprezentacja geometrii do selection/highlight/focus.

---

## 9. Transform tools w stylu 3ds Max — projekt docelowy

To jest osobny, bardzo ważny temat, bo o to pytałeś wprost.

## 9.1. Obecny stan
Masz już częściową infrastrukturę:
- चयन/selected object,
- overlay box,
- `PivotControls`,
- callback translacji,
- context/isolate.

To znaczy, że nie startujesz od zera.

## 9.2. Czego brakuje do poziomu „DCC-grade”

### Funkcjonalność obowiązkowa
1. **Select**
   - click,
   - ctrl/shift multi-select,
   - box select,
   - lasso select,
   - select by tree.

2. **Move**
   - axis drag X/Y/Z,
   - plane drag XY/YZ/XZ,
   - world/local mode,
   - snap to increment,
   - numeric entry.

3. **Rotate**
   - axis rotation,
   - local/world,
   - angle snap,
   - numeric entry.

4. **Scale**
   - uniform,
   - per-axis,
   - local/world,
   - numeric entry,
   - optional non-uniform lock policy.

5. **Pivot**
   - object center,
   - bounding box center,
   - local pivot,
   - custom pivot,
   - temporary pivot editing.

6. **Toolbar / ribbon**
   - Select,
   - Move,
   - Rotate,
   - Scale,
   - Pivot,
   - Snap,
   - Local/World,
   - Reset XForm,
   - Freeze transforms,
   - Frame selected.

7. **History**
   - undo/redo,
   - transform commit / cancel.

8. **Inspector**
   - translation/rotation/scale numeric panel,
   - exact values,
   - copy/paste transforms.

### Wniosek
`PivotControls` to tylko renderer gizma. To nie zastąpi pełnego subsystemu transformacji.

---

## 9.3. Proponowana architektura transform system

### Nowe pliki
- `apps/web/components/preview/transform/TransformToolbar.tsx`
- `apps/web/components/preview/transform/TransformModeStore.ts`
- `apps/web/components/preview/transform/TransformGizmoLayer.tsx`
- `apps/web/components/preview/transform/useTransformSession.ts`
- `apps/web/components/preview/transform/transformMath.ts`
- `apps/web/components/preview/transform/snap.ts`
- `apps/web/components/preview/transform/pivot.ts`

### Nowe typy
```ts
type TransformTool = "select" | "move" | "rotate" | "scale" | "pivot";
type TransformSpace = "world" | "local";
type TransformPivotMode = "object-center" | "bounds-center" | "custom";
```

### Model stanu
```ts
interface ObjectTransformState {
  translation: [number, number, number];
  rotation: [number, number, number]; // euler or quat, ale spójnie
  scale: [number, number, number];
  pivot: [number, number, number] | null;
}

interface TransformSessionState {
  tool: TransformTool;
  space: TransformSpace;
  pivotMode: TransformPivotMode;
  snapEnabled: boolean;
  snapMove: number;
  snapRotateDeg: number;
  snapScale: number;
  selection: string[];
}
```

### Kluczowa zasada
Renderer nie może już sam ad hoc decydować, jak przesunąć obiekt.  
Ma tylko:
- odczytać stan transformacji,
- wyrenderować gizmo,
- zgłosić delta transform.

Commit do buildera ma iść przez jedną, wspólną warstwę.

---

## 10. Render pipeline — projekt profesjonalny

Dziś trzeba przestać mieszać wszystko w jednym passie.

## 10.1. Docelowe warstwy
1. **Opaque geometry pass**
2. **Transparent context pass**
3. **Selection/highlight pass**
4. **Field glyph pass**
5. **Gizmo pass**
6. **Axes / labels pass**
7. **UI overlay pass**

## 10.2. Jak to wdrożyć praktycznie
### Nowe pliki
- `apps/web/components/preview/render/RenderLayerPolicy.ts`
- `apps/web/components/preview/render/ScenePasses.tsx`
- `apps/web/components/preview/render/useRenderPolicy.ts`

### Zasady
- opaque geometry zapisuje depth,
- transparent context używa osobnej polityki sortowania,
- gizma nie powinny mieszać się z selection highlight,
- labels powinny być renderowane po geometrii.

### Minimalna korzyść
Już samo rozdzielenie:
- opaque main,
- transparent context,
- gizmo/overlay,

bardzo zmniejszy wrażenie „przenikania”.

---

## 11. Field visualization suite — projekt docelowy

To jest część, która najbardziej zbliży Fullmag do narzędzia „pięknego i zgodnego z fizyką”.

## 11.1. Czego dziś brakuje
- isolinii,
- contour labels,
- streamlines,
- integral curves,
- streamline seeding,
- volume rendering,
- dedicated field legends,
- profile plots / probes,
- physical coordinate readout,
- interior FEM sampling.

## 11.2. Docelowe moduły
### 2D
- `FieldContours2D.tsx`
- `FieldStreamlines2D.tsx`
- `FieldQuiver2D.tsx`
- `FieldProbeOverlay.tsx`

### 3D
- `FieldGlyphs3D.tsx`
- `FieldStreamtubes3D.tsx`
- `FieldSlices3D.tsx`
- `FieldVolume3D.tsx`

## 11.3. Zasady fizyczne
1. Strzałka nie może udawać amplitudy, jeśli jest constant-length — trzeba to komunikować.
2. Kolor i długość muszą być jasno opisane w legendzie.
3. Dla FEM trzeba mieć możliwość próbkowania wnętrza, nie tylko boundary.
4. Streamlines muszą mieć jawny seed policy.
5. Isolinie / contours muszą pracować w jednostkach fizycznych i na poprawnej skali.

---

## 12. Konkretne zalecenia per plik

Poniżej zbieram najważniejsze, praktyczne zalecenia implementacyjne.

# 12.1. `apps/web/components/preview/FemMeshView3D.tsx`
### Naprawić
- `handleViewCubeRotate(...)` — target-aware rotation.
- `setCameraPreset(...)` — nie resetować bezwarunkowo do origin.
- `CameraAutoFit(...)` — przejść na bounds-based target fit.
- screenshot przez ref, nie przez globalny selector.
- wydzielić toolbar z komponentu.
- zintegrować z nowym transform subsystemem.
- usunąć lokalne decyzje o target center i scalić z `ViewportCameraController`.

### Dodać
- `toolMode`,
- `transformSession`,
- `fit selected`,
- `frame domain`,
- `snap indicator`,
- `selection badge`,
- `render policy hooks`.

---

# 12.2. `apps/web/components/preview/r3f/FemGeometry.tsx`
### Naprawić
- clip per-axis extent zamiast `maxDim`,
- usunąć centroid-only approximation albo oznaczyć ją jako approximate,
- uprościć warunki clip,
- rozważyć `FrontSide` zamiast `DoubleSide` tam, gdzie możliwe,
- poprawić politykę transparentności.

### Dodać
- osobny tryb `section`,
- prawdziwe clip intersection,
- diagnosic render modes rozdzielone od presentation modes,
- możliwość renderu OBB/object subset.

---

# 12.3. `apps/web/components/preview/r3f/FemArrows.tsx`
### Naprawić
- sampling wnętrza,
- length scaling,
- jawna semantyka sampling mode.

### Dodać
- probes,
- seeds,
- boundary vs volume mode,
- legenda długości,
- opcja `normalize per field / absolute scale`.

---

# 12.4. `apps/web/components/preview/MagnetizationView3D.tsx`
### Naprawić
- `isolate` jako prawdziwa maska, nie tylko opacity multiplier,
- zintegrować z nowym transform subsystemem,
- scalić camera logic z FEM.

### Dodać
- common camera controller,
- mode badges: `context / isolate / ghost`,
- local/world transform modes,
- transform numeric panel.

---

# 12.5. `apps/web/components/preview/r3f/FdmInstances.tsx`
### Naprawić
- domyślnie unikać transparent instanced voxels,
- przy isolate renderować hard-masked subset,
- dodać chunking / LOD / culling.

### Dodać
- opaque voxel mode,
- x-ray mode jako opcja,
- separate material policy,
- amplitude-aware glyph lengths.

---

# 12.6. `apps/web/components/preview/ViewCube.tsx`
### Naprawić
- ViewCube nie powinien znać logiki origin/grid center poza wspólnym camera API.
- Dodać callback oparty o `rotateToDirection(direction, up, mode)`.

### Dodać
- `frame selection`,
- `frame domain`,
- `frame all visible`.

---

# 12.7. `apps/web/components/preview/r3f/SceneAxes3D.tsx`
### Naprawić
- jawnie pokazywać, jaki extent reprezentują osie.
- dodać quality modes.

### Dodać
- compact mode,
- corner triad mode,
- units policy labels,
- optional HTML overlay instead of all-3D text for performance.

---

# 12.8. `apps/web/components/preview/FemMeshSlice2D.tsx`
### Rozbudować
- contours,
- contour labels,
- streamlines,
- export SVG,
- physical axes and rulers,
- probe readout.

---

# 12.9. `apps/web/components/preview/MagnetizationSlice2D.tsx`
### Rozbudować
- contours,
- quiver overlay,
- physical coordinates,
- ROI selection,
- profile plot extraction.

---

# 12.10. `apps/web/components/runs/control-room/ControlRoomContext.tsx`
### Naprawić / rozszerzyć
- pełne `transform` zamiast samego `translation`,
- selection store,
- camera target persistence,
- state sync dla multi-select,
- viewport-global transform modes.

---

# 12.11. `apps/web/components/runs/control-room/WorkspaceControlStrip.tsx`
### Rozbudować
Dziś pasek sterujący nie jest jeszcze „DCC-like”. To tutaj powinien pojawić się profesjonalny toolbar:
- Select,
- Move,
- Rotate,
- Scale,
- Pivot,
- Snap,
- Local/World,
- Frame Selected,
- Reset XForm.

---

# 12.12. `apps/web/components/runs/control-room/meshWorkspace.ts`
### Rozszerzyć
Presety mesh workspace są sensowne, ale trzeba do nich dodać:
- `authoring`,
- `transform`,
- `field-analysis`,
- `publish`.

Obecny zestaw:
- surface,
- volume,
- slice,
- quality,
- optimize

jest dobry dla siatki, ale nie wystarcza dla profesjonalnej pracy na obiektach.

---

## 13. Priorytety wdrożenia

## P0 — naprawić natychmiast
1. FEM `handleViewCubeRotate` resetujący target do origin.
2. FEM clipping liczony przez `maxDim` zamiast rozmiaru osi.
3. FDM isolate jako transparent dim zamiast real isolate.
4. Ograniczyć transparent voxel mode jako domyślny tryb w sytuacjach multi-object.

## P1 — duża poprawa jakości
1. Wspólny camera controller.
2. Wspólny transform subsystem.
3. Opaque/transparent overlay separation.
4. Amplitude-aware arrow/glyph scaling.
5. Prawdziwe object transform model w `ControlRoomContext`.

## P2 — profesjonalizacja narzędzia
1. Contours / isolines.
2. Streamlines.
3. Probe tools.
4. Local/world transform UI.
5. Numeric transform inspector.
6. Export lepszych screenshotów / figure export.

## P3 — poziom „premium / publikacyjny”
1. Volume rendering.
2. OIT / weighted transparency.
3. GPU picking / BVH acceleration.
4. Publish presets.
5. Stylizacje figure-grade.

---

## 14. Proponowane testy akceptacyjne

## T1 — camera correctness
- Focus on object,
- rotate ViewCube,
- camera nadal obraca się wokół wybranego targetu.

## T2 — FEM clip correctness
- Domena o rozmiarach X != Y != Z,
- clip X 50%, Y 50%, Z 50%,
- każda płaszczyzna trafia w połowę właściwej osi.

## T3 — FDM isolate
- Wybrać obiekt A,
- włączyć isolate,
- obiekt B znika całkowicie albo wchodzi w jawny ghost mode,
- brak bleed-through voxeli.

## T4 — transform UX
- Move, Rotate, Scale,
- world/local,
- snap on/off,
- undo/redo,
- zapis i reload.

## T5 — field visualization correctness
- FEM arrows boundary vs volume,
- amplitude encoded by length,
- contours w 2D zgodne z polem na przekroju.

## T6 — export
- screenshot poprawnego canvas,
- brak losowego wyboru innego viewportu,
- spójne legendy i osie.

---

## 15. Docelowa wizja „pięknej i fizycznie sensownej” wizualizacji

Jeżeli celem jest poziom profesjonalny, to Fullmag powinien docelowo oferować trzy klasy viewportów:

### A. Authoring viewport
Do budowy i edycji sceny:
- select,
- move/rotate/scale,
- pivot,
- snap,
- local/world,
- isolate/context/ghost,
- clean overlays.

### B. Inspection viewport
Do pracy inżynierskiej:
- mesh quality,
- real sectioning,
- probes,
- object segments,
- field slices,
- contours,
- streamlines,
- true focus and frame.

### C. Presentation viewport
Do publikacji i screenshotów:
- controlled lighting,
- predictable transparency,
- legends,
- unit-aware axes,
- stylized but physically honest rendering,
- export figure-quality.

Dziś Fullmag miesza te role w kilku komponentach naraz.  
Najlepszy kolejny krok to **architektoniczne rozdzielenie tych trzech trybów**.

---

## 16. Ostateczna diagnoza

Twoje obserwacje są trafne.

### Dlaczego wizualizacja „świruje”
Główne przyczyny są trzy:
1. **transparent rendering bez stabilnej polityki depth/sort**,  
2. **niespójna logika kamery/targetu, zwłaszcza w FEM**,  
3. **częściowo wdrożony system transformacji i overlayów, ale bez pełnego scene graph / transform stack**.

### Dlaczego nie wszystko jest dobrze zaimplementowane
Bo obecny system jest po części:
- scientific viewerem,
- po części mesh debuggerem,
- po części builder preview,
- po części quasi-DCC edytorem,

ale nie ma jeszcze jednej wspólnej warstwy architektonicznej, która spina te role.

### Co zrobić
Nie doklejać kolejnych małych hacków do pojedynczych komponentów.  
Zamiast tego zrobić cztery kontrolowane refaktory:
1. **camera subsystem**,  
2. **transform subsystem**,  
3. **render pass / transparency policy**,  
4. **field visualization suite**.

---

## 17. Krótki plan wdrożenia na 3 etapy

### Etap 1 — stabilizacja
- naprawić target bug w FEM,
- poprawić clip semantics,
- ograniczyć transparent artifacts,
- uporządkować isolate.

### Etap 2 — authoring tools
- pełny toolbar transformacji,
- move/rotate/scale,
- local/world,
- snap,
- numeric inspector,
- undo/redo.

### Etap 3 — professional field viz
- contours,
- streamlines,
- probes,
- volume rendering / lepsza 3D field viz,
- presentation/export mode.

---

## 18. Finalna rekomendacja dla maintainera

Najbardziej opłacalna strategia nie brzmi:
> „naprawmy jeszcze jeden bug w pojedynczym komponencie”

tylko:
> „wydzielmy wspólny viewport framework dla Fullmag”.

To powinien być osobny epik rozwojowy, np.:

**Epic: Viewport 2.0 — unified interaction, rendering and field visualization**

z czterema workstreamami:
1. Camera & Navigation,
2. Transform & Selection,
3. Rendering & Transparency,
4. Field Visualization & Analysis.

To właśnie da Ci efekt, którego oczekujesz:
- piękna wizualizacja,
- spójna fizycznie,
- przewidywalna przy wielu obiektach,
- profesjonalna jak narzędzia klasy DCC/CAE,
- ale nadal wygodna do pracy naukowej.