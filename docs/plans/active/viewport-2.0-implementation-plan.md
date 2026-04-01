# Viewport 2.0 — Plan wdrożenia wizualizacji 3D/2D

**Data:** 2026-04-01
**Źródło:** [fullmag_3d_visualization_audit_2026-04-01.md](../../reports/fullmag_3d_visualization_audit_2026-04-01.md)
**Epic:** Viewport 2.0 — unified interaction, rendering and field visualization
**Status wdrożenia:** Fazy A—F zaimplementowane (2026-04-01)

---

## Podsumowanie

Plan realizuje 4 workstreamy wynikające z audytu, podzielone na **6 faz** od krytycznych bugfixów po premium field viz. Każda faza jest zamknięta — daje mierzalną poprawę i może być wdrożona niezależnie.

### Workstreamy

| # | Workstream | Fazy |
|---|-----------|------|
| W1 | Camera & Navigation | A, B |
| W2 | Rendering & Transparency | A, C |
| W3 | Transform & Selection | B, D |
| W4 | Field Visualization & Analysis | E, F |

### Mapa faz

| Faza | Nazwa | Priorytet | Charakter |
|------|-------|-----------|-----------|
| **A** | Critical bugfixes & stabilizacja | P0 | Hotfix — naprawia realne bugi UX |
| **B** | Unified Camera & Navigation | P1 | Refaktor — wspólna warstwa kamery |
| **C** | Render pipeline & transparency | P1 | Refaktor — eliminacja przenikania |
| **D** | Transform system | P2 | Feature — DCC-grade narzędzia |
| **E** | Field visualization v1 | P2 | Feature — fizykalna wizualizacja |
| **F** | Premium & publication-grade | P3 | Polish — jakość publikacyjna |

---

## Faza A — Critical bugfixes & stabilizacja

> **Cel:** Naprawić konkretne, odczuwalne bugi bez zmiany architektury.
> **Zależności:** brak
> **Pliki do modyfikacji:** istniejące komponenty, zero nowych plików

### A.1 — FEM ViewCube: target-aware rotation

**Problem:** `handleViewCubeRotate()` w `FemMeshView3D.tsx` resetuje `controls.target` do `[0,0,0]` po każdej rotacji ViewCube, co powoduje przeskakiwanie kamery po operacji Focus → ViewCube rotate.

**Plik:** `apps/web/components/preview/FemMeshView3D.tsx`

**Zmiana:**
```ts
// PRZED (linie ~771-780)
const dist = cam.position.length();
cam.position.copy(new THREE.Vector3(0, 0, 1).applyQuaternion(quat).multiplyScalar(dist));
cam.lookAt(0, 0, 0);
ctl.target.set(0, 0, 0);

// PO
const target = ctl.target.clone();
const dist = cam.position.clone().sub(target).length();
const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(quat).normalize();
cam.position.copy(target).add(dir.multiplyScalar(dist));
cam.lookAt(target);
ctl.target.copy(target);
ctl.update();
```

**Test akceptacyjny:**
1. Focus na obiekt A.
2. Kliknij "Front" na ViewCube.
3. Kamera rotuje wokół obiektu A, nie przeskakuje do origin.

---

### A.2 — FEM camera presety: target-aware

**Problem:** `setCameraPreset()` (`front/top/right/reset`) w `FemMeshView3D.tsx` (linie ~710-724) resetuje target do origin.

**Plik:** `apps/web/components/preview/FemMeshView3D.tsx`

**Zmiana:** Presety powinny obracać kamerę wokół `currentTarget` (lub `worldCenter` przy braku fokusu), a nie `[0,0,0]`.

**Test akceptacyjny:**
1. Focus na obiekt A.
2. Kliknij "Top".
3. Widok z góry na obiekt A, nie na origin.

---

### A.3 — FEM clipping: per-axis extent

**Problem:** Clip plane w `FemGeometry.tsx` (linie ~160-179) liczy pozycję przez `maxDim` zamiast rozmiaru osi, co daje niespójną pozycję clip plane dla domen nieześciennych.

**Plik:** `apps/web/components/preview/r3f/FemGeometry.tsx`

**Zmiana:**
```ts
// PRZED
const ms = Math.max(size.x, size.y, size.z);
const posReal = ((clipPos ?? 50) / 100 - 0.5) * ms;

// PO
const axisSize = axisIdx === 0 ? size.x : axisIdx === 1 ? size.y : size.z;
const axisMin  = axisIdx === 0 ? minX   : axisIdx === 1 ? minY   : minZ;
const posReal  = axisMin + ((clipPos ?? 50) / 100) * axisSize;
```

**Dodatkowa zmiana:** Uprościć redundantny warunek clip (linie ~186-188):
```ts
// PRZED
if (clipAxis === "x" ? cx > posReal : cx > posReal) { ... }

// PO
if (centroid[axisIdx] > posReal) continue;
```

**Test akceptacyjny:**
- Domena 100×100×1000 nm.
- Clip X 50% → płaszczyzna na 50 nm osi X.
- Clip Z 50% → płaszczyzna na 500 nm osi Z.

---

### A.4 — FDM isolate: hard mask zamiast opacity dim

**Problem:** Isolate w `MagnetizationView3D.tsx` (linie ~618-621) to tylko `opacity * 0.22`, co daje transparent bleed-through i przenikanie.

**Plik:** `apps/web/components/preview/MagnetizationView3D.tsx`

**Zmiana:** Przy `objectViewMode === "isolate"` nie renderować instancji obiektów B (visible=false), zamiast robić je półprzezroczystymi.

**Opcjonalnie:** Dodać trzeci tryb `ghost` dla półprzezroczystego kontekstu za osobnym przyciskiem.

**Test akceptacyjny:**
1. Scena z obiektami A i B.
2. Select A → Isolate.
3. B znika całkowicie (lub jest wireframe ghost).
4. Brak bleed-through voxeli.

---

### A.5 — FDM voxels: domyślnie opaque

**Problem:** Transparentne `InstancedMesh` w `FdmInstances.tsx` (linie ~171-200) to główne źródło „przenikania" — Three.js nie sortuje per-instance.

**Plik:** `apps/web/components/preview/r3f/FdmInstances.tsx`

**Zmiana:** Domyślny voxel mode = opaque (`depthWrite=true`, `opacity=1`). Dodać osobny tryb "X-Ray" dla transparency.

**Test akceptacyjny:**
- Domyślny widok voxeli: brak przenikania przy obrocie kamery.
- Włącz "X-Ray": jawnie transparentny, z ostrzeżeniem o artefaktach sortowania.

---

### A.6 — Screenshot przez ref

**Problem:** `document.querySelector(".fem-canvas-container canvas")` (linie ~782-789) może złapać zły canvas.

**Plik:** `apps/web/components/preview/FemMeshView3D.tsx`

**Zmiana:** Użyć `canvasRef` przekazanego przez R3F zamiast globalnego selektora.

---

### Podsumowanie Fazy A

| ID | Zmiana | Pliki | Szacowana złożoność |
|----|--------|-------|---------------------|
| A.1 | ViewCube target-aware | FemMeshView3D.tsx | Mała |
| A.2 | Camera presety target-aware | FemMeshView3D.tsx | Mała |
| A.3 | Clip per-axis + uproszczenie warunku | FemGeometry.tsx | Mała |
| A.4 | Isolate hard mask | MagnetizationView3D.tsx, FdmInstances.tsx | Średnia |
| A.5 | Opaque voxels domyślnie | FdmInstances.tsx | Mała |
| A.6 | Screenshot przez ref | FemMeshView3D.tsx | Mała |

---

## Faza B — Unified Camera & Navigation

> **Cel:** Jedna wspólna warstwa kamery dla FEM i FDM, eliminacja duplikacji logiki.
> **Zależności:** Faza A (bugi kamery naprawione)
> **Nowe pliki:** 3

### B.1 — Shared camera helpers

**Nowy plik:** `apps/web/components/preview/camera/cameraHelpers.ts`

Wydzielić wspólne funkcje:
```ts
fitCameraToBounds(camera, controls, bounds, options?)
rotateCameraAroundTarget(camera, controls, quaternion)
setCameraPresetAroundTarget(camera, controls, preset, target?)
focusCameraOnBounds(camera, controls, bounds, preserveDirection?)
```

**Źródła:** Logika z FDM `focusObject` (linie ~543-580 w `MagnetizationView3D.tsx`) jako punkt odniesienia — jest bardziej dojrzała niż FEM.

---

### B.2 — ViewportCameraController

**Nowy plik:** `apps/web/components/preview/camera/ViewportCameraController.tsx`

Wspólny R3F komponent:
- trzyma `currentTarget` w ref,
- eksponuje API: `focus(bounds)`, `preset(name)`, `rotateToQuat(q)`, `fitAll()`,
- jest używany zarówno przez FEM jak i FDM viewport.

---

### B.3 — CameraAutoFit bounds-based

**Nowy plik:** `apps/web/components/preview/camera/CameraAutoFit.tsx`

Zastąpić obecny `CameraAutoFit` w `FemMeshView3D.tsx` (linie ~119-130) wersją bounds-aware:
- oblicza target center z bounds (nie z origin),
- oblicza dystans z FOV + padding,
- wspiera `preserveDirection` flag.

---

### B.4 — ViewCube unification

**Modyfikacja:** `apps/web/components/preview/ViewCube.tsx`

ViewCube deleguje do jednego API: `onRotateToDirection(direction, up)`. Nie zna szczegółów FEM/FDM. Camera controller decyduje o target.

---

### B.5 — Integracja w viewportach

**Modyfikacja:** `FemMeshView3D.tsx`, `MagnetizationView3D.tsx`

Usunąć lokalną logikę kamery (ViewCube handler, presety, autofit, focus). Zastąpić użyciem `ViewportCameraController` + shared helpers.

---

### Podsumowanie Fazy B

| ID | Zmiana | Pliki | Złożoność |
|----|--------|-------|-----------|
| B.1 | Camera helpers | Nowy: camera/cameraHelpers.ts | Średnia |
| B.2 | Camera controller | Nowy: camera/ViewportCameraController.tsx | Średnia |
| B.3 | CameraAutoFit v2 | Nowy: camera/CameraAutoFit.tsx | Mała |
| B.4 | ViewCube unification | ViewCube.tsx | Mała |
| B.5 | Integracja FEM+FDM | FemMeshView3D.tsx, MagnetizationView3D.tsx | Średnia |

---

## Faza C — Render pipeline & transparency

> **Cel:** Wyeliminować artefakty przenikania przez jawne warstwy renderowania.
> **Zależności:** Faza A (opaque default, hard mask isolate)
> **Nowe pliki:** 3

### C.1 — Render layer definitions

**Nowy plik:** `apps/web/components/preview/render/layers.ts`

Zdefiniować warstwy Three.js `Layers`:
```ts
export const RENDER_LAYERS = {
  OPAQUE_GEOMETRY: 0,      // główna geometria, depthWrite=true
  TRANSPARENT_CONTEXT: 1,  // ghost/context obiekty
  SELECTION_HIGHLIGHT: 2,  // highlight zaznaczenia
  FIELD_GLYPHS: 3,         // strzałki, glyphy
  GIZMOS: 4,               // transform gizmo
  AXES_LABELS: 5,          // osie, etykiety
} as const;
```

---

### C.2 — Render policy hook

**Nowy plik:** `apps/web/components/preview/render/useRenderPolicy.ts`

Hook zwracający konfigurację materiału na podstawie warstwy:
```ts
useRenderPolicy(layer) → { side, depthWrite, transparent, renderOrder, polygonOffset }
```

Eliminuje ad-hoc decyzje w komponentach.

---

### C.3 — ScenePasses component

**Nowy plik:** `apps/web/components/preview/render/ScenePasses.tsx`

Opcjonalny multi-pass renderer:
- Pass 1: Opaque geometry (depth pre-pass).
- Pass 2: Transparent context (sorted, depth read, depth write = false).
- Pass 3: Selection + gizmos (na wierzchu, bez depth test).

**Fallback:** Jeśli multi-pass jest zbyt kosztowny → przynajmniej FrontSide + depthWrite=true dla opaque jako default, a transparent traktowany osobno.

---

### C.4 — FemGeometry: FrontSide dla zamkniętych powierzchni

**Modyfikacja:** `apps/web/components/preview/r3f/FemGeometry.tsx`

Zamknięte (manifold) surface meshes → `FrontSide`. `DoubleSide` tylko dla otwartych meshes / shell elements.

---

### C.5 — FdmInstances: opaque vs transparent policy

**Modyfikacja:** `apps/web/components/preview/r3f/FdmInstances.tsx`

Integracja z `useRenderPolicy`. Opaque voxels w głównym passie, transparent X-Ray w osobnym passie z jawnym ostrzeżeniem UX.

---

### C.6 — FemHighlightView: overlay pass

**Modyfikacja:** `apps/web/components/preview/r3f/FemHighlightView.tsx`

Highlight przeniesiony do `SELECTION_HIGHLIGHT` layer, renderowany po depth-prepass.

---

### Podsumowanie Fazy C

| ID | Zmiana | Pliki | Złożoność |
|----|--------|-------|-----------|
| C.1 | Render layers | Nowy: render/layers.ts | Mała |
| C.2 | Render policy hook | Nowy: render/useRenderPolicy.ts | Średnia |
| C.3 | ScenePasses | Nowy: render/ScenePasses.tsx | Duża |
| C.4 | FemGeometry FrontSide | FemGeometry.tsx | Mała |
| C.5 | FdmInstances policy | FdmInstances.tsx | Średnia |
| C.6 | Highlight overlay pass | FemHighlightView.tsx | Mała |

---

## Faza D — Transform system

> **Cel:** DCC-grade Move/Rotate/Scale z pełnym toolbarem.
> **Zależności:** Faza B (camera controller), Faza C (render layers dla gizmo)
> **Nowe pliki:** 7

### D.1 — Transform types & state

**Nowy plik:** `apps/web/components/preview/transform/types.ts`

```ts
type TransformTool = "select" | "move" | "rotate" | "scale";
type TransformSpace = "world" | "local";
type TransformPivotMode = "object-center" | "bounds-center" | "custom";

interface ObjectTransform {
  translation: [number, number, number];
  rotation: [number, number, number, number]; // quaternion
  scale: [number, number, number];
  pivot: [number, number, number] | null;
}

interface TransformSession {
  tool: TransformTool;
  space: TransformSpace;
  pivotMode: TransformPivotMode;
  snapEnabled: boolean;
  snapIncrement: { move: number; rotateDeg: number; scale: number };
  isDragging: boolean;
  preview: ObjectTransform | null;  // preview delta during drag
}
```

---

### D.2 — Transform mode store

**Nowy plik:** `apps/web/components/preview/transform/TransformModeStore.ts`

Zustand store:
- `tool`, `space`, `pivotMode`, `snap*`
- actions: `setTool()`, `toggleSpace()`, `toggleSnap()`
- keyboard shortcuts: W=move, E=rotate, R=scale, Q=select

---

### D.3 — Transform math utilities

**Nowy plik:** `apps/web/components/preview/transform/transformMath.ts`

- `applyTransform(base, delta, space, pivot)` → nowy transform
- `snappedDelta(delta, increment)` → snap do siatki
- `composeTransforms(parent, child)` → hierarchia

---

### D.4 — Transform session hook

**Nowy plik:** `apps/web/components/preview/transform/useTransformSession.ts`

Hook zarządzający sesją drag:
- `onDragStart(objectId)` → zapisz baseline,
- `onDrag(delta)` → oblicz preview transform → aktualizuj visual,
- `onDragEnd()` → commit delta do ControlRoomContext,
- `onCancel()` → wycofaj preview.

---

### D.5 — Transform gizmo layer

**Nowy plik:** `apps/web/components/preview/transform/TransformGizmoLayer.tsx`

R3F komponent renderujący gizmo na warstwie `GIZMOS`:
- Wyświetla odpowiedni gizmo (move/rotate/scale) na wybranym obiekcie.
- Deleguje eventy drag do `useTransformSession`.
- Wspiera `world`/`local` orientation.
- Używa jawnie `GIZMOS` render layer.

---

### D.6 — Transform toolbar

**Nowy plik:** `apps/web/components/preview/transform/TransformToolbar.tsx`

UI toolbar:
- Ikony: Select | Move | Rotate | Scale
- Toggle: World / Local
- Toggle: Snap On/Off + konfiguracja increments
- Przycisk: Frame Selected
- Integracja z `WorkspaceControlStrip.tsx`.

---

### D.7 — Numeric transform inspector

**Nowy plik:** `apps/web/components/preview/transform/TransformInspector.tsx`

Panel w sidebarze:
- Translation X/Y/Z (edytowalne pola numeryczne)
- Rotation X/Y/Z (euler degrees)
- Scale X/Y/Z
- Przycisk: Reset Transform
- Przycisk: Copy / Paste Transform

---

### D.8 — Integracja z ControlRoomContext

**Modyfikacja:** `apps/web/components/runs/control-room/ControlRoomContext.tsx`

Rozszerzyć model danych obiektu:
```ts
// PRZED
geometry_params.translation: [x, y, z]

// PO
geometry_params.transform: {
  translation: [x, y, z],
  rotation: [qx, qy, qz, qw],  // quaternion
  scale: [sx, sy, sz],
}
```

Dodać `applyObjectTransform(objectId, delta)` action. Istniejący `applyGeometryTranslation` staje się wrapperem wstecznej kompatybilności.

---

### D.9 — Usunięcie starych PivotControls

**Modyfikacja:** `FemMeshView3D.tsx`, `MagnetizationView3D.tsx`

Usunąć lokalne `PivotControls` + callbacki translacji. Zastąpić osadzeniem `TransformGizmoLayer`.

---

### D.10 — Undo/Redo

**Modyfikacja:** `ControlRoomContext.tsx` lub nowy plik

Prosty undo stack dla transformacji:
- push przy `onDragEnd`,
- Ctrl+Z → pop i restore,
- Ctrl+Shift+Z → redo.

---

### Podsumowanie Fazy D

| ID | Zmiana | Pliki | Złożoność |
|----|--------|-------|-----------|
| D.1 | Transform types | Nowy: transform/types.ts | Mała |
| D.2 | Mode store | Nowy: transform/TransformModeStore.ts | Mała |
| D.3 | Math utils | Nowy: transform/transformMath.ts | Średnia |
| D.4 | Session hook | Nowy: transform/useTransformSession.ts | Średnia |
| D.5 | Gizmo layer | Nowy: transform/TransformGizmoLayer.tsx | Duża |
| D.6 | Toolbar | Nowy: transform/TransformToolbar.tsx | Średnia |
| D.7 | Numeric inspector | Nowy: transform/TransformInspector.tsx | Średnia |
| D.8 | Context integration | ControlRoomContext.tsx | Średnia |
| D.9 | Remove old PivotControls | FemMeshView3D, MagnetizationView3D | Mała |
| D.10 | Undo/Redo | ControlRoomContext.tsx | Średnia |

---

## Faza E — Field visualization v1

> **Cel:** Fizycznie poprawna wizualizacja pola z amplitudą, konturami, próbkowaniem wnętrza.
> **Zależności:** Faza C (render layers), Faza A (stabilna baza)
> **Nowe pliki:** 5-7

### E.1 — Amplitude-aware arrow scaling (FEM + FDM)

**Modyfikacja:** `apps/web/components/preview/r3f/FemArrows.tsx`, `apps/web/components/preview/r3f/FdmInstances.tsx`

Dodać tryb skalowania długości strzałek:
```ts
type LengthMode = "constant" | "magnitude" | "sqrt" | "log";
```

- Domyślnie: `magnitude` z clamp do `[minLength, maxLength]`.
- UI control w toolbar: dropdown "Arrow Length: Constant / Magnitude / Sqrt / Log".
- Aktualizacja legendy: opisać co kolor i długość oznaczają.

**Test:** Strzałki w regionie z silnym polem są wyraźnie dłuższe niż w regionie z słabym polem.

---

### E.2 — FEM interior sampling

**Modyfikacja:** `apps/web/components/preview/r3f/FemArrows.tsx`

Dodać tryby próbkowania:
- `boundary` (obecny),
- `volume-random` (losowe punkty w tetraedrach),
- `element-centroids` (centroid każdego elementu),
- `slice-plane` (punkty na płaszczyźnie clip).

UI: dropdown "Sample Domain: Boundary / Volume / Centroids / Slice".

---

### E.3 — Named sampling heuristics

**Modyfikacja:** `apps/web/components/preview/r3f/FemArrows.tsx`

Obecna heurystyka faworyzująca domain walls → nazwać jawnie w UI:
- "Adaptive (domain walls)"
- "Uniform"
- "Boundary only"

---

### E.4 — 2D contour lines (FEM)

**Nowy plik:** `apps/web/components/preview/field/FieldContours2D.tsx`

Moduł konturów (isolinii) dla `FemMeshSlice2D`:
- Algorytm: marching squares / contouring na triangulated slice data.
- Wejście: skalarne pole na wierzchołkach slice.
- Wyjście: SVG/Canvas polylines z contour labels.
- Konfiguracja: liczba poziomów / jawne wartości / auto / colormap.

**Integracja:** Osadzony jako warstwa w `FemMeshSlice2D.tsx`.

---

### E.5 — 2D contour lines (FDM)

**Modyfikacja:** `apps/web/components/preview/MagnetizationSlice2D.tsx`

Dodać contour overlay na heatmapie ECharts:
- `markLine` / custom series z contour polylines.
- Physical coordinates zamiast cell indices na osiach.

---

### E.6 — 2D quiver overlay (FDM)

**Nowy plik:** `apps/web/components/preview/field/FieldQuiver2D.tsx`

Nakładka wektorowa na slice 2D:
- Strzałki na regularnej siatce subsample.
- Kolor + długość kodują amplitudę.
- Subsampling density control.

---

### E.7 — Upgraded field legend

**Nowy plik:** `apps/web/components/preview/field/FieldLegend.tsx`

Wspólna legenda:
- Color bar z jednostkami SI.
- Opis: "Color = |M| [A/m], Length = |M| (sqrt scale)".
- Min/max/mean annotation.
- Wspólna dla 2D i 3D viewport.

---

### E.8 — FEM clip: oznaczenie "Approximate"

**Modyfikacja:** `apps/web/components/preview/r3f/FemGeometry.tsx`

Dodać w UI badge/tooltip: "Approximate clip (centroid-based)" dopóki nie ma prawdziwego geometric clipping.

---

### Podsumowanie Fazy E

| ID | Zmiana | Pliki | Złożoność |
|----|--------|-------|-----------|
| E.1 | Arrow amplitude scaling | FemArrows.tsx, FdmInstances.tsx | Średnia |
| E.2 | FEM interior sampling | FemArrows.tsx | Średnia |
| E.3 | Named sampling modes | FemArrows.tsx | Mała |
| E.4 | 2D contours FEM | Nowy: field/FieldContours2D.tsx | Duża |
| E.5 | 2D contours FDM | MagnetizationSlice2D.tsx | Średnia |
| E.6 | 2D quiver overlay | Nowy: field/FieldQuiver2D.tsx | Średnia |
| E.7 | Field legend | Nowy: field/FieldLegend.tsx | Mała |
| E.8 | Approximate clip badge | FemGeometry.tsx | Mała |

---

## Faza F — Premium & publication-grade

> **Cel:** Poziom PubliCation-quality rendering + zaawansowane techniki wizualizacji.
> **Zależności:** Fazy A-E ukończone
> **Nowe pliki:** 5-8

### F.1 — Geometric tetra clipping

**Nowy plik:** `apps/web/components/preview/r3f/clipTetraByPlane.ts`

Helper: prawdziwe przecięcie tetraedru płaszczyzną → nowa geometria dla cap surface.

**Integracja:** `FemGeometry.tsx` — opcja "Precise clip" obok "Approximate clip".

---

### F.2 — Streamlines 2D

**Nowy plik:** `apps/web/components/preview/field/FieldStreamlines2D.tsx`

RK4 streamline integration na danych slice:
- Seed: uniform, random, user click.
- Rendering: Canvas/SVG polyline z arrow-heads.
- Density control.

---

### F.3 — Streamtubes 3D

**Nowy plik:** `apps/web/components/preview/field/FieldStreamtubes3D.tsx`

3D streamtubes/streamribbons w R3F:
- Seed poles from UI.
- Tube radius ∝ field magnitude.
- Color mapping along tube.

---

### F.4 — OIT (Order-Independent Transparency)

**Nowy plik:** `apps/web/components/preview/render/OITPass.ts`

Weighted blended OIT dla transparent context geometry:
- Weighted sum pass.
- Final composite.
- Fallback: depth peeling z ograniczoną liczbą warstw.

---

### F.5 — Scene axes quality profiles

**Modyfikacja:** `apps/web/components/preview/r3f/SceneAxes3D.tsx`

Dodać profile:
- `full` — pełne ticki + labels (obecny),
- `compact` — skrócone osie, mniej ticków,
- `triad` — corner triad only,
- `hidden`.

Dodać tag informujący o zakresie: "Domain" / "Universe" / "Mesh bbox".

---

### F.6 — Probe & profile tools

**Nowy plik:** `apps/web/components/preview/field/FieldProbe.tsx`

- Point probe: klik → tooltip z wartością pola + pozycją fizyczną.
- Line probe: dwa kliknięcia → wykres profilu pola wzdłuż linii.
- Eksportowalne dane (CSV).

---

### F.7 — Figure export

**Nowy plik:** `apps/web/components/preview/export/FigureExport.tsx`

- Export PNG (high-res, przez renderer.setPixelRatio).
- Export SVG (dla 2D slices).
- Opcjonalnie: export tikz/pgfplots data.
- Konfiguracja: tło białe/czarne/transparent, DPI, legendy on/off.

---

### F.8 — Presentation viewport presets

**Modyfikacja:** `apps/web/components/runs/control-room/meshWorkspace.ts`

Nowe workspace presety:
- `authoring` — full gizmo + overlays,
- `analysis` — contours + streamlines + probes,
- `presentation` — clean render, legend, export-ready.

---

### F.9 — Volume rendering (opcjonalne)

**Nowy plik:** `apps/web/components/preview/field/FieldVolume3D.tsx`

Ray-marched volume rendering z 3D teksturą:
- Transfer function UI.
- Isosurface extraction.
- Dla dużych FDM datasetów — alternatywa dla instanced voxels.

---

### Podsumowanie Fazy F

| ID | Zmiana | Pliki | Złożoność |
|----|--------|-------|-----------|
| F.1 | Geometric clipping | Nowy: r3f/clipTetraByPlane.ts | Duża |
| F.2 | Streamlines 2D | Nowy: field/FieldStreamlines2D.tsx | Duża |
| F.3 | Streamtubes 3D | Nowy: field/FieldStreamtubes3D.tsx | Duża |
| F.4 | OIT | Nowy: render/OITPass.ts | Duża |
| F.5 | Axes profiles | SceneAxes3D.tsx | Średnia |
| F.6 | Probe tools | Nowy: field/FieldProbe.tsx | Średnia |
| F.7 | Figure export | Nowy: export/FigureExport.tsx | Średnia |
| F.8 | Workspace presets | meshWorkspace.ts | Mała |
| F.9 | Volume rendering | Nowy: field/FieldVolume3D.tsx | Bardzo duża |

---

## Struktura katalogów po wdrożeniu

```
apps/web/components/preview/
├── camera/                          # Faza B
│   ├── cameraHelpers.ts
│   ├── CameraAutoFit.tsx
│   └── ViewportCameraController.tsx
├── render/                          # Faza C
│   ├── layers.ts
│   ├── useRenderPolicy.ts
│   ├── ScenePasses.tsx
│   └── OITPass.ts                   # Faza F
├── transform/                       # Faza D
│   ├── types.ts
│   ├── TransformModeStore.ts
│   ├── transformMath.ts
│   ├── useTransformSession.ts
│   ├── TransformGizmoLayer.tsx
│   ├── TransformToolbar.tsx
│   └── TransformInspector.tsx
├── field/                           # Fazy E, F
│   ├── FieldContours2D.tsx
│   ├── FieldQuiver2D.tsx
│   ├── FieldStreamlines2D.tsx
│   ├── FieldStreamtubes3D.tsx
│   ├── FieldVolume3D.tsx
│   ├── FieldLegend.tsx
│   └── FieldProbe.tsx
├── export/                          # Faza F
│   └── FigureExport.tsx
├── r3f/                             # Istniejący (modyfikacje w A, C, E)
│   ├── FdmInstances.tsx
│   ├── FemArrows.tsx
│   ├── FemGeometry.tsx
│   ├── FemHighlightView.tsx
│   ├── SceneAxes3D.tsx
│   ├── clipTetraByPlane.ts          # Faza F
│   └── colorUtils.ts
├── FemMeshView3D.tsx                # Modyfikacje A, B, D
├── FemMeshSlice2D.tsx               # Modyfikacje E
├── MagnetizationView3D.tsx          # Modyfikacje A, B, D
├── MagnetizationSlice2D.tsx         # Modyfikacje E
├── ViewCube.tsx                     # Modyfikacja B
└── ...
```

---

## Graf zależności faz

```
Faza A (bugfixes)
  ├──→ Faza B (camera)
  │      └──→ Faza D (transform) ←── Faza C
  ├──→ Faza C (render pipeline)
  └──→ Faza E (field viz v1)
              └──→ Faza F (premium)  ←── Faza C, D
```

- **A** jest prereq dla wszystkiego.
- **B** i **C** mogą być robione równolegle po A.
- **D** wymaga B + C.
- **E** wymaga A + C (ale może startować równolegle z B).
- **F** wymaga E + C + D.

---

## Testy akceptacyjne — matryca

| Test | Faza | Opis |
|------|------|------|
| T-CAM-1 | A/B | Focus → ViewCube → kamera nie przeskakuje |
| T-CAM-2 | A/B | Camera preset "Top" działa wokół current target |
| T-CAM-3 | B | AutoFit centruje na bounds, nie na origin |
| T-CLIP-1 | A | Clip 50% per-axis na asymetrycznej domenie |
| T-CLIP-2 | F | Geometric clip: gładki przekrój, nie schodkowy |
| T-ISO-1 | A | Isolate = obiekty B znikają, brak bleed-through |
| T-RND-1 | C | Brak przenikania opaque geometry przy obrocie kamery |
| T-RND-2 | C | Transparent context sortuje się poprawnie |
| T-TRN-1 | D | Move/Rotate/Scale z snap działa na obiekcie |
| T-TRN-2 | D | Undo/Redo transform |
| T-TRN-3 | D | Numeric inspector: wpisanie wartości → obiekt się przesuwa |
| T-FLD-1 | E | FEM strzałki skalowane amplitudą |
| T-FLD-2 | E | FEM strzałki z interior sampling |
| T-FLD-3 | E | 2D contour lines na FEM slice |
| T-FLD-4 | E | FDM slice z physical coordinates |
| T-EXP-1 | F | Screenshot z poprawnego canvas, high-res |
| T-PRB-1 | F | Point probe: klik → wartość pola + pozycja |

---

## Elementy do usunięcia / deprecji

| Element | Kiedy | Powód |
|---------|-------|-------|
| `MagnetizationView2D.tsx` | Faza E | Legacy — zdublowane przez `MagnetizationSlice2D.tsx` |
| Lokalne `PivotControls` (FEM/FDM) | Faza D | Zastąpione przez `TransformGizmoLayer` |
| Lokalna logika kamery w FEM/FDM | Faza B | Zastąpiona przez `ViewportCameraController` |
| `document.querySelector` screenshot | Faza A | Zastąpione przez canvas ref |

---

## Rekomendacja kolejności pracy

1. **Zacznij od Fazy A** — natychmiastowa poprawa UX, zero ryzyka architektonicznego.
2. **Faza B + C równolegle** — fundamenty nowej architektury.
3. **Faza D** — najambitniejsza zmiana, ale z gotowymi fundamentami z B+C.
4. **Faza E** — fizyczna wartość narzędzia, niezależna od D.
5. **Faza F** — polish, gdy reszta jest stabilna.
