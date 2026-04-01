
# Fullmag — raport długu implementacyjnego i docelowej architektury
## Tworzenie geometrii, ustawianie magnetyzacji i edytor GUI na wzór MuMax/Boris + manipulacja „jak w 3ds Max”

**Data opracowania:** 2026-04-01  
**Repozytorium:** `MateuszZelent/fullmag`  
**Zakres raportu:** architektura backendu, frontendu i biblioteki Python dla:
- tworzenia geometrii,
- nakładania i edycji magnetyzacji,
- pracy z „teksturą magnetyczną” na żywo,
- GUI z gizmo typu **translate / rotate / scale**,
- round-trip **GUI ↔ Python script ↔ IR ↔ solver**,
- planu wdrożenia etapami.

---

## 1. Executive summary

Największy dług implementacyjny w tym obszarze **nie polega na braku pojedynczych widgetów GUI**.  
Największy dług polega na tym, że repozytorium ma już kilka mocnych elementów:

- Python DSL i płaski interfejs w stylu MuMax,
- sensowną warstwę geometrii i meshingu,
- live control-room w przeglądarce,
- import/export stanu magnetyzacji,
- zalążki sceny edycyjnej i translacyjnego gizmo w 3D,

ale **nie ma jeszcze jednego kanonicznego modelu authoringu** dla trzech rzeczy jednocześnie:

1. **geometrii obiektu**,  
2. **transformacji obiektu w scenie**,  
3. **magnetyzacji/tekstury magnetycznej jako osobnego bytu z własną transformacją**.

To powoduje, że obecny system jest już wystarczająco rozbudowany, by pokazać podgląd, import, eksport i częściową interakcję, ale nadal jest zbyt niespójny, żeby stać się pełnym edytorem geometrii i magnetyzacji „jak produkt”, a nie tylko „jak viewer z formularzami”.

### Najważniejsze wnioski

1. **Repo ma fundament pod ten kierunek.**  
   Nie startujesz od zera. Masz:
   - strukturę `apps/web`,
   - warstwę `crates/fullmag-api`,
   - pakiet `packages/fullmag-py`,
   - builder state / model graph,
   - live preview,
   - import assetów,
   - import/export magnetyzacji,
   - sync skryptu przez helper Python.

2. **Obecna scena jest pół-edytowalna, ale nie jest jeszcze kanoniczną sceną authoringową.**  
   Frontend operuje dziś głównie na:
   - model tree,
   - overlayach obiektów,
   - boundsach,
   - builder state,
   - preview config.

   To jest dobry fundament do UI, ale to nie jest jeszcze prawdziwy **scene graph** z transformami, pivotem, hierarchią, blokadami, historią, undo/redo i niezależną transformacją tekstury magnetycznej.

3. **Geometria i magnetyzacja muszą zostać rozdzielone na poziomie authoringu.**  
   Docelowo obiekt powinien mieć:
   - geometrię,
   - transform obiektu,
   - materiał,
   - źródło magnetyzacji,
   - transform/mapping tekstury magnetyzacji,
   - strategię bake’owania na preview i na solver.

4. **Obecne `ProblemIR` i `ScriptBuilderState` nie powinny pozostać jedynym źródłem prawdy dla edytora.**  
   Solver i edytor mają inne potrzeby.
   Solver chce:
   - znormalizowane dane fizyczne,
   - gotowy sampled field,
   - siatkę / grid / plan wykonania.

   Edytor chce:
   - historię zmian,
   - selection state,
   - gizmo,
   - transform stack,
   - metadane GUI,
   - proceduralne tekstury,
   - niezależne manipulowanie obiektem i polem magnetyzacji.

   **Wniosek:** trzeba wprowadzić **nową warstwę authoringową** (np. `AuthoringSceneDocument` / `SceneIR`), a dopiero z niej generować:
   - `ScriptBuilderState`,
   - Python script,
   - `ProblemIR`,
   - preview payload,
   - solver-ready sampled magnetization.

5. **Największa luka funkcjonalna to brak „magnetization texture system”.**  
   Dziś masz głównie:
   - uniform,
   - random,
   - file/state import,
   - sampled field jako target IR.

   Brakuje natomiast pojęcia:
   - tekstury / pola proceduralnego,
   - mappingu world/object/texture space,
   - osobnej transformacji tekstury,
   - compositingu warstw,
   - brush/stamp workflow,
   - live bake preview.

---

## 2. Co już istnieje w repo — realny fundament

Poniższa lista jest ważna, bo pokazuje, że nie trzeba wszystkiego przepisywać.  
Trzeba raczej **skonsolidować istniejące warstwy**.

### 2.1 Python / authoring / runtime helper

W `packages/fullmag-py/src/fullmag` masz już rozdział na:
- `model`
- `meshing`
- `init`
- `runtime`
- `world.py`

To jest dobra baza do zrobienia **dwóch API równolegle**:
- ergonomicznego API skryptowego,
- bardziej jawnego API obiektowego/scene-graphowego.

### 2.2 Geometria w Pythonie jest już bogatsza niż starsze specy

W praktyce kod ma już więcej niż „bootstrap geometry”.  
Są obecne:
- `ImportedGeometry`
- `Box`
- `Cylinder`
- `Ellipsoid`
- `Ellipse`
- `Difference`
- `Union`
- `Intersection`
- `Translate`
- helper typu `Sphere(...)`

To znaczy, że:
- warstwa modelu geometrii jest już sensownie rozwinięta,
- ale planner/public executable path nie wszędzie nadąża za tym modelem,
- dokumentacja/specy są w części spóźnione względem kodu.

### 2.3 Magnetyzacja ma już ważne cegiełki

Aktualny stan funkcjonalny po stronie Pythona i helperów jest już sensowny:
- `uniform`
- `random(seed)`
- obsługa plikowych stanów magnetyzacji
- import/export `json`, `zarr`, `h5`
- IR-ready `SampledField`

To jest bardzo ważne, bo oznacza, że **bake do solvera** nie musi być projektowany od zera.

### 2.4 Meshing i asset pipeline są już ponad „toy stage”

Warstwa meshingu zawiera:
- integrację z Gmsh,
- preview surface payload,
- import STL/STEP,
- eksport STL,
- metadata bounds,
- jakościowe raporty siatki,
- size fields / operations,
- częściowe adaptive remeshing.

To jest ogromny atut, bo edytor geometrii bez porządnej warstwy meshingu i preview i tak byłby ślepym frontendem.

### 2.5 Frontend ma już control-room i podwaliny pod edytor

W `apps/web` istnieją już:
- komponenty `preview/*`,
- panele ustawień/meshu/model tree,
- control-room,
- session stream,
- live API client,
- typy builder state / model graph.

To znaczy, że:
- istnieje już „shell produktu”,
- istnieje już transport live state,
- istnieją już 2D/3D widoki,
- istnieje już miejsce, gdzie da się dobudować authoring, zamiast budować osobną aplikację od zera.

### 2.6 Są już zalążki manipulacji 3D

W viewerze 3D istnieją już ślady prawdziwej interakcji:
- `PivotControls`,
- `selectedObjectId`,
- `onGeometryTranslate(...)`,
- `onAntennaTranslate(...)`,
- overlaye obiektów w przestrzeni sceny.

To jest bardzo ważne, bo pokazuje, że:
- produkt nie jest „statycznym viewerem”,
- ale aktualnie manipulator działa na **overlayach boundsów**, nie na kanonicznym modelu obiektów i tekstur.

---

## 3. Główny dług implementacyjny — diagnoza architektoniczna

Poniżej opisuję to nie jako listę kosmetycznych braków, tylko jako realne błędy/ryzyka architektoniczne.

---

## 3.1 Brak jednej kanonicznej warstwy authoringu sceny

### Obecny problem

W repo współistnieją równolegle:
- Python DSL,
- `ProblemIR`,
- `ScriptBuilderState`,
- `ModelBuilderGraph`,
- live preview state,
- overlaye w frontendzie.

Każda z tych warstw opisuje fragment rzeczywistości, ale **żadna nie jest jeszcze pełnym, stabilnym, edytowalnym dokumentem sceny**.

### Konsekwencje

- trudny round-trip GUI ↔ Python,
- trudne undo/redo,
- trudne wersjonowanie zmian,
- trudna niezależna transformacja obiektu i tekstury magnetyzacji,
- ryzyko, że frontend będzie „edytował snapshot”, a nie model źródłowy,
- narastanie driftu między GUI, DSL i plannerem.

### Rekomendacja

Wprowadzić nową warstwę:
- `AuthoringSceneDocument`
albo
- `SceneIR`
albo
- `EditorSceneState`.

Ta warstwa ma być:
- źródłem prawdy dla GUI,
- serializowalna,
- wersjonowana,
- transformowalna do:
  - `ScriptBuilderState`,
  - Python script,
  - `ProblemIR`,
  - preview payload.

---

## 3.2 Brak prawdziwego scene graphu

### Obecny problem

Frontend ma drzewo modelu i overlaye, ale to nie jest jeszcze pełny scene graph.

Brakuje kanonicznych pojęć:
- `SceneObjectId`
- `Transform`
- `Pivot`
- `Parent/Child`
- `Visibility`
- `Locked`
- `Selectable`
- `ObjectRevision`
- `DerivedBounds`
- `DirtyFlags`

### Konsekwencje

- selection i gizmo są kruche,
- ciężko robić grupy obiektów,
- ciężko robić duplikację i instancje,
- ciężko dodać rotate/scale bez hackowania `geometry_params`,
- brak bezpiecznego miejsca dla edytorowych metadanych.

### Rekomendacja

Wprowadzić model:

```text
SceneDocument
  ├── objects: SceneObject[]
  ├── materials: MaterialDef[]
  ├── magnetization_assets: MagnetizationAsset[]
  ├── current_modules: CurrentModuleDef[]
  ├── mesh_defaults: MeshAuthoringDefaults
  ├── universe: UniverseAuthoringState
  ├── study: StudyAuthoringState
  ├── outputs: OutputAuthoringState
  └── editor: EditorState
```

Każdy `SceneObject` powinien mieć:

```text
SceneObject
  - id
  - name
  - geometry_ref | geometry_inline
  - object_transform
  - material_binding
  - region_binding
  - magnetization_binding
  - mesh_override
  - visibility
  - locked
  - tags
  - metadata
```

---

## 3.3 Transformacja obiektu jest dziś zbyt uboga

### Obecny problem

W praktyce geometrię da się dziś przesuwać, ale nie ma jeszcze kanonicznego i pełnego modelu:
- rotacji,
- skali,
- pivotu,
- trybu local/world,
- macierzy 4x4,
- stacku transformacji.

### Konsekwencje

- nie da się zbudować porządnego gizmo 3D,
- nie da się poprawnie zrobić „rotate texture, but not object”,
- brak spójności między Python DSL a GUI,
- imported geometry i boolean-y mogą być źródłem rozjazdów.

### Rekomendacja

Wprowadzić jawny typ:

```python
@dataclass(frozen=True)
class Transform3D:
    translation: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation_quat: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0)
    pivot: tuple[float, float, float] = (0.0, 0.0, 0.0)
    space: Literal["local", "world"] = "local"
```

Ważne:
- solver nie musi pracować na tym bezpośrednio,
- ale authoring i preview muszą.

Dla GUI to powinno być podstawą:
- translate gizmo,
- rotate gizmo,
- scale gizmo,
- pivot snapping,
- world/local toggle.

---

## 3.4 Brak osobnego modelu „tekstury magnetycznej”

To jest najważniejsza luka.

### Obecny problem

Obecny model magnetyzacji jest blisko „stanu początkowego solvera”, a nie „narzędzia authoringu”.

Masz dziś sensowne byty typu:
- uniform,
- random,
- file,
- sampled field.

Ale brakuje pojęć:
- texture space,
- field space,
- projection mode,
- transform tekstury,
- mask,
- blend,
- procedural pattern,
- live preview bake.

### Konsekwencje

- nie da się zrobić prawdziwego „ustawiania tekstury magnetycznej na żywo”,
- nie da się obracać/powielać/przesuwać tekstury niezależnie od geometrii,
- nie da się rozróżnić:
  - transformacji obiektu,
  - transformacji tekstury magnetyzacji.

### Rekomendacja — nowy model pojęciowy

Wprowadzić nowe pojęcia:

```text
MagnetizationAsset
  - kind: uniform | random | file | sampled | procedural | composite
  - data / params
  - mapping
  - texture_transform
  - sampling_policy
  - normalization_policy
  - preview_settings
```

### Docelowe typy źródeł

1. `UniformMagnetizationSource`
2. `RandomMagnetizationSource`
3. `FileMagnetizationSource`
4. `FunctionMagnetizationSource`
5. `ProceduralPatternSource`
   - vortex
   - radial
   - helix
   - stripe
   - domain_wall
   - skyrmion_seed
6. `CompositeMagnetizationSource`
   - blend
   - add
   - replace
   - mask
   - normalize
7. `VectorTextureSource`
   - 3D grid of vectors
   - sparse/voxel source
   - imported volume

### Mapping tekstury

Magnetyzacja authoringowa powinna mieć osobne pojęcie mapowania:

```text
MagnetizationMapping
  - space: world | object | texture
  - projection: object_local | planar_xy | planar_xz | planar_yz | box | triplanar | cylindrical | spherical
  - clamp_mode: clamp | wrap | mirror
```

### Osobna transformacja tekstury

To jest kluczowe dla workflow „jak w 3ds Max”:

```text
MagnetizationTextureTransform
  - translation
  - rotation
  - scale
  - pivot
```

Dzięki temu użytkownik może:
- przesuwać obiekt,
- obracać obiekt,
- skalować obiekt,
- niezależnie przesuwać/obracać/skalować teksturę magnetyczną wewnątrz obiektu.

To jest dokładnie ta różnica, która zmienia GUI z „viewer + parametry” w prawdziwy authoring tool.

---

## 3.5 `ScriptBuilderState` jest za blisko formularza, a za daleko od authoringu 3D

### Obecny problem

`ScriptBuilderState` dobrze nadaje się do:
- prostych ustawień solvera,
- meshu,
- universe,
- listy geometrii,
- początkowego m0,
- modułów current source.

Ale słabo nadaje się do:
- rotate/scale/pivot,
- hierarchical scene,
- command log,
- selection state,
- transform tekstury,
- warstwowego authoringu magnetyzacji,
- brush/stamp workflow.

### Konsekwencje

Jeśli będziesz próbował dopisać wszystko bezpośrednio do `ScriptBuilderState`, to skończysz z:
- bardzo grubym JSON-em,
- coraz bardziej kruchym rewrite-script helperem,
- logiką GUI wyciekającą do warstwy solverowej,
- trudnym utrzymaniem kompatybilności.

### Rekomendacja

`ScriptBuilderState` zostawić jako warstwę pośrednią / kompatybilnościową.  
Docelowo:
- GUI pracuje na `SceneDocument`,
- `SceneDocument` generuje `ScriptBuilderState` tylko jako **projection**,
- Python script rewrite działa z projection, nie z ręcznie lepiącymi się polami GUI.

---

## 3.6 Rozjazd między dokumentacją/specami a kodem

### Obecny problem

Specy starszego typu opisują znacznie węższy zakres geometrii i magnetyzacji niż istnieje w kodzie/IR.

### Konsekwencje

- programista nie wie, co jest naprawdę „kanoniczne”,
- frontend może implementować złą wersję semantyki,
- planner może pozostać w tyle za DSL,
- edytor GUI może zostać oparty na modelu, który dokumentacja uznaje za out-of-scope.

### Rekomendacja

Natychmiast dodać nowy, jeden kanoniczny dokument:

```text
docs/specs/geometry-and-magnetization-authoring-v1.md
```

Powinien opisywać:
- obiekt sceny,
- transform obiektu,
- materiał,
- magnetization asset,
- magnetization mapping,
- bake do preview,
- bake do ProblemIR,
- round-trip GUI ↔ Python.

Bez tego editor będzie wyrastał na ruchomych piaskach.

---

## 3.7 Planner i public executable path nie nadążają za pełnym modelem geometrii

### Obecny problem

Model/IR jest bogatszy niż część ścieżek publicznego planera.

### Konsekwencje

- GUI może pozwolić stworzyć obiekt, którego planner nie wykona,
- user dostanie UX typu: „to się da narysować, ale nie da się uruchomić”,
- pojawi się chaos capability matrix.

### Rekomendacja

Wprowadzić rozróżnienie capability na poziomie authoringu:

```text
authorable
previewable
meshable
solver_executable
```

Czyli GUI może wiedzieć dla każdego obiektu lub źródła magnetyzacji:
- czy da się to tylko narysować,
- czy da się to zmeshować,
- czy da się to bakedować,
- czy da się to puścić przez konkretny backend.

To pozwoli rozwijać edytor szybciej niż solver, ale bez oszukiwania użytkownika.

---

## 4. Docelowa architektura — model referencyjny

To jest moja rekomendowana architektura docelowa.

---

## 4.1 Warstwy systemu

```text
[GUI Editor / Python DSL]
          |
          v
[AuthoringSceneDocument / SceneIR]
          |
          +--> [Preview Bake Pipeline]
          |         |
          |         +--> surface preview / volume preview / mesh preview
          |
          +--> [Python Script Projection]
          |
          +--> [ProblemIR Projection]
                    |
                    v
              [ExecutionPlanIR]
                    |
                    v
             [FDM/FEM Backends]
```

### Zasada
- **AuthoringSceneDocument** = prawda edytora
- **ProblemIR** = prawda solvera
- **ExecutionPlanIR** = prawda wykonania
- **Live preview** = prawda podglądu

Nie wolno tych warstw zlewać.

---

## 4.2 Nowy dokument authoringowy

Przykładowy szkic:

```ts
type SceneDocument = {
  version: "scene.v1";
  revision: number;
  scene: {
    name: string;
    units: "m";
  };
  universe: UniverseAuthoringState;
  objects: SceneObject[];
  materials: MaterialDefinition[];
  magnetizationAssets: MagnetizationAsset[];
  currentModules: CurrentModuleDefinition[];
  study: StudyDefinition;
  outputs: OutputDefinition;
  editor: EditorState;
};
```

### `SceneObject`

```ts
type SceneObject = {
  id: string;
  name: string;
  geometry: GeometryNode;
  transform: Transform3D;
  materialRef: string | null;
  regionName: string | null;
  magnetizationRef: string | null;
  meshOverride: MeshOverride | null;
  visible: boolean;
  locked: boolean;
  tags: string[];
  metadata?: Record<string, unknown>;
};
```

### `MagnetizationAsset`

```ts
type MagnetizationAsset = {
  id: string;
  name: string;
  kind:
    | "uniform"
    | "random"
    | "file"
    | "function"
    | "procedural"
    | "vector_texture"
    | "composite";
  source: MagnetizationSourcePayload;
  mapping: MagnetizationMapping;
  textureTransform: Transform3D;
  normalization: "unit" | "preserve" | "renormalize_on_bake";
  preview: {
    visible: boolean;
    opacity?: number;
  };
};
```

---

## 4.3 Dwa różne transformy: obiektu i tekstury

To musi być jawne.

```text
SceneObject.transform
MagnetizationAsset.textureTransform
```

### Dlaczego?
Bo użytkownik może chcieć:
- obrócić nanoflower,
- ale zostawić wzór magnetyzacji „w świecie”,
albo:
- obrócić samą teksturę magnetyzacji wewnątrz obiektu,
- bez zmiany geometrii.

To jest dokładnie workflow z narzędzi typu DCC/CAD.

---

## 4.4 Docelowy pipeline bake

### Bake typu A — GUI preview bake
Szybki, przybliżony, interaktywny.

Wejście:
- scena,
- transform obiektu,
- texture transform,
- aktualny selection state,
- budżet preview.

Wyjście:
- vector preview payload,
- scalar slices,
- surface colors,
- coarse volume field.

### Bake typu B — solver bake
Dokładny, powtarzalny, wersjonowany.

Wejście:
- scena,
- resolved geometry,
- resolved transformy,
- mesh/grid sampling points.

Wyjście:
- `InitialMagnetizationIR::SampledField`
albo
- plik stanu zgodny z backendem/pipeline.

### Bake typu C — artifact bake
Na potrzeby eksportu i provenance.

Wyjście:
- `json`
- `zarr`
- `h5`
- preview snapshot
- authoring manifest

---

## 5. Architektura backendu — szczegółowy plan

---

## 5.1 Python layer — docelowy model

### Rekomendacja
Nie wyrzucać obecnego DSL-a.  
Trzeba go rozszerzyć i ucywilizować.

### Nowe moduły

Proponuję dodać:

```text
packages/fullmag-py/src/fullmag/model/scene.py
packages/fullmag-py/src/fullmag/model/transform.py
packages/fullmag-py/src/fullmag/model/magnetization_texture.py
packages/fullmag-py/src/fullmag/runtime/authoring_projection.py
packages/fullmag-py/src/fullmag/runtime/authoring_helper.py
```

### Nowe klasy

#### `Transform3D`
- translation
- rotation_quat
- scale
- pivot

#### `SceneObject`
- geometry
- transform
- material
- region
- magnetization asset ref
- mesh override

#### `SceneDocument`
- lista obiektów
- lista assetów magnetyzacji
- universe
- study
- outputs
- current modules

#### `MagnetizationAsset`
- uniform/random/file/function/procedural/composite/vector texture

---

## 5.2 Python DSL — kierunek „MuMax/Boris-like, ale bardziej nowoczesny”

### Cel
Użytkownik powinien mieć dwa sposoby authoringu:

#### A. API obiektowe
```python
import fullmag as fm

scene = fm.Scene("nanoflower_scene")

flower = fm.Object(
    name="flower",
    geometry=fm.Ellipsoid(rx=80e-9, ry=60e-9, rz=25e-9),
    transform=fm.Transform3D(
        translation=(0, 0, 0),
        rotation_euler=(0, 0, 0),
        scale=(1, 1, 1),
    ),
)

flower.material = fm.Material(name="Py", Ms=800e3, A=13e-12, alpha=0.02)

flower.magnetization = fm.mtex.procedural(
    kind="vortex",
    axis=(0, 0, 1),
    chirality="cw",
    core_polarity=+1,
    mapping=fm.mtex.Mapping(space="object", projection="box"),
    texture_transform=fm.Transform3D(rotation_euler=(0, 0, 30)),
)

scene.add(flower)
problem = scene.to_problem()
```

#### B. API skrótowe / flat DSL
```python
import fullmag as fm

obj = fm.geometry(fm.Box(size=(200e-9, 50e-9, 10e-9)), name="strip")
obj.translate(20e-9, 0, 0)
obj.rotate(z=30)
obj.scale(1.0, 1.0, 1.0)

obj.m.uniform((1, 0, 0))
obj.m.texture_rotate(z=45)
obj.m.texture_translate(10e-9, 0, 0)
```

### Co jest ważne
Obecne `MagnetHandle` warto **ewoluować**, a nie usuwać.

Zamiast:
- `MagnetHandle` jako lekki wrapper z `m = MagnetizationHandle`

proponuję:
- `SceneObjectHandle`
- `GeometryAuthoringHandle`
- `MagnetizationAuthoringHandle`
- `GeometryMeshHandle`

---

## 5.3 Python helper / runtime helper

### Obecny stan
Masz już helper wywoływany z Rust:
- export builder draft,
- rewrite script,
- read/convert magnetization state.

### Co trzeba dodać

#### Nowe komendy helpera
```text
python -m fullmag.runtime.helper export-scene-document
python -m fullmag.runtime.helper import-scene-document
python -m fullmag.runtime.helper bake-preview-field
python -m fullmag.runtime.helper bake-initial-magnetization
python -m fullmag.runtime.helper rewrite-script-from-scene
```

### Dlaczego
Obecny helper jest już dobrym miejscem integracji GUI z Pythonem.  
Nie trzeba robić osobnego procesu authoringowego od zera.

---

## 5.4 Rust API layer — nowe kontrakty

Obecna warstwa `fullmag-api` jest wystarczająco dobra, żeby ją rozszerzyć, a nie przepisywać.

### Dodać nowe endpointy

#### Dokument sceny
```text
GET    /v1/live/current/editor/scene
POST   /v1/live/current/editor/scene
```

#### Komendy authoringu
```text
POST   /v1/live/current/editor/commands
POST   /v1/live/current/editor/undo
POST   /v1/live/current/editor/redo
```

#### Bake preview
```text
POST   /v1/live/current/editor/bake/preview
POST   /v1/live/current/editor/bake/magnetization
POST   /v1/live/current/editor/bake/problem
```

#### Selection / gizmo / focus
```text
POST   /v1/live/current/editor/selection
POST   /v1/live/current/editor/transform
POST   /v1/live/current/editor/texture-transform
```

### Zasada
Frontend nie powinien wysyłać „gołych mutacji JSON-a”, jeśli chce być stabilnym edytorem.  
Powinien wysyłać **komendy domenowe**.

Na przykład:
- `CreateObject`
- `DeleteObject`
- `DuplicateObject`
- `SetObjectTransform`
- `SetTextureTransform`
- `SetMagnetizationAsset`
- `AssignMaterial`
- `BakePreview`
- `BakeProblem`

To daje:
- undo/redo,
- łatwiejszy audit log,
- stabilniejszy protocol,
- mniej kruchy frontend.

---

## 5.5 Nowa kolejka komend domenowych

### Obecny stan
Masz kolejkę commandów runtime:
- run
- relax
- stop
- remesh
- load_state

### Brak
Brakuje osobnej warstwy commandów authoringowych.

### Rekomendacja
Wprowadzić:

```rust
enum EditorCommand {
    CreateObject { ... },
    DeleteObject { ... },
    DuplicateObject { ... },
    RenameObject { ... },
    SetObjectTransform { ... },
    SetTextureTransform { ... },
    SetObjectGeometry { ... },
    SetMeshOverride { ... },
    SetMaterialFields { ... },
    SetMagnetizationSource { ... },
    ImportMagnetizationAsset { ... },
    BakePreview { ... },
    BakeProblem { ... },
}
```

### Dlaczego
To jest konieczne dla:
- historii zmian,
- replay,
- kolizji zmian,
- debugowania GUI,
- przyszłego collaborative mode.

---

## 5.6 `ProblemIR` vs `AuthoringSceneIR`

### Rekomendacja krytyczna
Nie wciskać wszystkiego do `ProblemIR`.

### `AuthoringSceneIR`
Powinno trzymać:
- transform stack,
- texture transform,
- projection mode,
- selection-neutral metadata,
- editor-only settings,
- hidden/locked flags,
- command history refs,
- versioning authoringowe.

### `ProblemIR`
Powinno trzymać:
- geometrię już po normalizacji,
- materiał,
- regiony,
- initial magnetization już zdefiniowaną w solverowej semantyce,
- study,
- outputs.

### Reguła
`AuthoringSceneIR -> ProblemIR`
nigdy odwrotnie jako pełna rekonstrukcja 1:1.

Można mieć częściowy back-projection, ale nie wolno udawać, że `ProblemIR` jest pełnym formatem authoringu.

---

## 5.7 Bake magnetyzacji — kontrakt solverowy

### Dla FDM
Próbkujemy pole magnetyzacji w:
- centrach komórek.

### Dla FEM
Próbkujemy w:
- węzłach,
lub
- przestrzeni odpowiedniej do inicjalizacji pola (np. H1-projection/vertex-based init).

### Docelowy interfejs

```python
asset.sample(points, *, space="world") -> np.ndarray[(N, 3)]
```

### Główna zasada
W authoringu trzymasz:
- pole proceduralne / teksturę / file source / compositing.

W solverze trzymasz:
- sampled vectors.

To jest poprawny podział odpowiedzialności.

---

## 5.8 Caching i invalidation

To jest bardzo ważne i łatwo to zepsuć.

### Każdy z tych bytów musi mieć revision/hash:
- geometry revision,
- object transform revision,
- material revision,
- magnetization asset revision,
- texture transform revision,
- mesh revision,
- preview config revision.

### Reguły dirty flags

#### Jeśli zmieni się:
- tylko kolor/opacity preview  
  → nie bake’ować magnetyzacji.

#### Jeśli zmieni się:
- texture transform  
  → preview bake tak, solver bake do odświeżenia.

#### Jeśli zmieni się:
- mesh  
  → solver bake obowiązkowo, preview bake zależnie od widoku.

#### Jeśli zmieni się:
- object transform  
  → geometry preview bake i magnetization bake do odświeżenia.

#### Jeśli zmieni się:
- sama procedura magnetyzacji  
  → magnetization bake.

---

## 6. Architektura frontendu — szczegółowy plan

---

## 6.1 Nie budować „drugiej aplikacji”
Największy błąd byłby taki:
- zostawić obecny control-room,
- obok postawić osobny „editor app”.

To byłoby złe.

### Rekomendacja
Rozszerzyć obecny control-room o tryb:
- `Observe`
- `Author`
- `Mesh`
- `Analyze`

Masz już `ViewportMode` i sensowną strukturę modułów — to trzeba wykorzystać.

---

## 6.2 Docelowy układ GUI

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Top bar: mode / save / sync script / run / relax / bake / undo     │
├───────────────┬───────────────────────────────────┬─────────────────┤
│ Scene Tree    │ Main Viewport (3D/2D/Mesh)        │ Inspector       │
│ Objects       │ gizmo + overlays + preview        │ object/material │
│ Assets        │                                    │ texture params  │
│ Materials     │                                    │ mesh override   │
│ M-assets       │                                    │                 │
├───────────────┴───────────────────────────────────┴─────────────────┤
│ Bottom strip: layers, texture stack, timeline/logs/preview metrics  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6.3 Scene tree

### Powinien pokazywać:
- universe
- objects
- materials
- magnetization assets
- mesh overrides
- current modules
- study
- outputs

### Każdy obiekt powinien mieć:
- ikonę typu geometrii,
- badge capability,
- informację o materiale,
- informację o assetcie magnetyzacji,
- status dirty/baked/executable.

---

## 6.4 Gizmo 3D

### Tryby
- Translate
- Rotate
- Scale

### Przestrzenie
- Local
- World

### Pivot
- object center
- custom pivot
- snap to bounds corner
- snap to cursor hit

### Dodatki
- snap to grid
- numeric transform panel
- duplicate with transform
- reset transform
- freeze transform

### Ważne
Najpierw wdrożyć:
- translate
- rotate
- scale
- numeric inspector

Dopiero potem:
- advanced snapping
- hierarchy
- constraints

---

## 6.5 Oddzielny gizmo dla tekstury magnetycznej

To musi być osobny tryb, np. w toolbarze:
- Object
- Magnetization Texture

### W trybie `Object`
gizmo modyfikuje:
- `SceneObject.transform`

### W trybie `Magnetization Texture`
gizmo modyfikuje:
- `MagnetizationAsset.textureTransform`

To jest fundamentalne dla UX.

---

## 6.6 Inspector

### Sekcja `Object`
- name
- geometry type
- region name
- visibility / lock
- material ref
- magnetization ref

### Sekcja `Geometry`
- parametry prymitywu
- import source
- boolean stack
- transform

### Sekcja `Material`
- `Ms`
- `A`
- `alpha`
- DMI / anisotropy / inne pola w miarę dostępności

### Sekcja `Magnetization`
- source kind
- mapping
- texture transform
- normalize policy
- preview mode
- bake status

### Sekcja `Mesh`
- inherit / custom
- hmax/hmin
- order
- size fields
- operations

---

## 6.7 Edytor tekstury magnetycznej

To powinien być osobny panel/podpanel.

### Wersja minimalna (MVP)
Obsłużyć:
- uniform
- random
- file
- procedural vortex
- procedural radial
- procedural stripes
- composite blend
- mapping object/world
- transform tekstury
- preview 3D
- preview slice 2D
- bake to sampled field

### Wersja rozszerzona
Dodać:
- brush painting,
- mask painting,
- stamp library,
- symmetry,
- falloff,
- domain wall generator,
- skyrmion seed generator,
- live local relaxation preview.

---

## 6.8 Preview magnetyzacji

### Widoki
1. Surface overlay
2. Volume glyphs
3. Slices XY/XZ/YZ
4. Local object view
5. Texture-space debug view

### Dlaczego texture-space debug?
Bo bez tego użytkownik nie zrozumie, czy problem leży w:
- samej teksturze,
- mapowaniu,
- transformie tekstury,
- transformie obiektu,
- sample bake.

---

## 6.9 Undo / redo

Nie robić undo na surowym React state.

### Rekomendacja
Undo/redo oparte o:
- command log
albo
- snapshot + command diff.

Na początek wystarczy:
- snapshot every N operations,
- command diffs pomiędzy.

---

## 7. „Tekstura magnetyczna” — proponowany model domenowy

To jest rdzeń nowej funkcji.

---

## 7.1 Definicja

W tym projekcie proponuję używać terminu:

> **tekstura magnetyczna** = autoringowe źródło pola wektorowego magnetyzacji, zdefiniowane proceduralnie, plikowo lub przez kompozycję, mapowane na obiekt przez jawny mapping i transformację tekstury.

To nie musi być bitmapa 2D.  
To może być:
- pole proceduralne,
- 3D atlas wektorowy,
- plikowy stan,
- kombinacja źródeł.

---

## 7.2 Przykładowe klasy źródeł

### Uniform
Stały kierunek.

### Random
Seeded random.

### File
Import stanu z:
- json
- zarr
- h5
- później OVF/VTK jeśli dodasz konwertery.

### Function
Funkcja `(x, y, z) -> (mx, my, mz)`.

### Procedural
- vortex
- radial
- helical
- stripe
- wall
- skyrmion-like seed
- target-state template

### Composite
- add
- blend
- mask
- replace
- normalize

---

## 7.3 Mapping przestrzeni

### `world`
Pole jest zdefiniowane w przestrzeni świata.

### `object`
Pole jest przywiązane do lokalnego układu obiektu.

### `texture`
Pole ma własny układ i własny transform.

### Projection
- object_local
- planar_xy
- planar_xz
- planar_yz
- box
- triplanar
- cylindrical
- spherical

---

## 7.4 Transform tekstury

To musi być dokładnie taki sam koncept jak dla geometrii, ale odrębny:
- translation
- rotation
- scale
- pivot

Dzięki temu możliwe staje się:
- przesunięcie wzoru domen,
- obrócenie vorteksu,
- skalowanie period stripes,
- testowanie różnych orientacji pola bez ruszania obiektu.

---

## 7.5 Proceduralne patterny — najpierw te, które dają największy zwrot

### Faza 1
- uniform
- random
- file
- radial
- vortex
- stripes

### Faza 2
- wall
- helical
- skyrmion seed
- blend/mask/composite

### Faza 3
- brush/stamp painting
- custom operator graph

---

## 8. Docelowa architektura meshingu i geometrii

---

## 8.1 Geometry authoring vs meshing realization

To musi być rozdzielone:

### Authoring geometry
- prymitywy
- import
- boolean stack
- transform
- metadata

### Mesh realization
- Gmsh / imported mesh / generated mesh
- element order
- hmax/hmin
- size fields
- operations
- adaptivity

### Zasada
Nie wolno robić tak, żeby mesh stał się jedynym źródłem prawdy dla edytora.  
Mesh jest realizacją pochodną.

---

## 8.2 Boolean stack

Dla GUI to jest ważne:
- union
- difference
- intersection

### Rekomendacja
W authoringu potraktować CSG jako:
- listę operandów,
- operator,
- transformy per operand.

Na poziomie GUI:
- obiekt bazowy,
- modifiers stack.

Na poziomie solvera/plannera:
- resolved geometry.

To daje UX zbliżony do DCC.

---

## 8.3 Imported geometry

### Trzeba jasno rozdzielić:
- imported surface asset,
- imported volume asset,
- imported mesh asset.

### Dla GUI
Każdy asset powinien mieć:
- source path
- format
- bounds
- watertight
- previewability
- meshability
- solver capability

---

## 8.4 Per-object mesh override

To już częściowo istnieje w stanie buildera, ale trzeba to domknąć.

### Docelowo każdy obiekt powinien mieć:
- `mesh_mode = inherit | custom`
- własne `hmax/hmin`
- własne size fields
- własne mesh operations
- optional external mesh source

### Ważne
Flat DSL nie powinien blokować tej ścieżki na zawsze.  
Jeśli dziś istnieje ograniczenie „jeden shared mesh config”, to należy je potraktować jako dług przejściowy, a nie docelową regułę.

---

## 9. Round-trip GUI ↔ Python ↔ IR

---

## 9.1 Najważniejsza zasada

**GUI nie może być tylko viewerem Pythona, ale też nie może edytować AST skryptu bezpośrednio.**

### Poprawny przepływ:
```text
GUI edits SceneDocument
         |
         +--> generate/update ScriptBuilder projection
         |
         +--> helper rewrites Python script from structured state
         |
         +--> helper builds ProblemIR
```

---

## 9.2 Nie edytować gołego kodu jak tekstu
Rewrite skryptu przez helper jest sensowny, ale musi działać na:
- structured scene state,
- projection rules,
- stable templates.

Nie wolno robić:
- przypadkowych regexów po kodzie usera,
- dopisywania pól bez semantyki.

---

## 9.3 Dwa tryby synchronizacji

### Tryb 1 — `projection-owned`
GUI jest właścicielem dokumentu sceny i generuje skrypt.

### Tryb 2 — `script-owned`
Użytkownik pisze ręcznie w Pythonie, a GUI tylko odczytuje/edytuje część zgodną z projection contract.

To jest bardzo praktyczne rozwiązanie:
- pro user może pisać ręcznie,
- GUI nadal ma sens,
- ale musi być jasne, co jest round-trippowalne.

---

## 10. Testy i walidacja

---

## 10.1 Testy modelu sceny
- serializacja/deserializacja `SceneDocument`
- stable IDs
- transform compose/decompose
- equality/hash/revision

## 10.2 Testy geometrii
- bounds po transformacji
- CSG consistency
- imported asset metadata
- mesh override inheritance

## 10.3 Testy magnetyzacji
- normalization
- procedural generators
- mapping object/world/texture
- texture transform correctness
- sampled field consistency

## 10.4 Testy bake
- preview vs solver bake consistency
- FDM cell-center sampling
- FEM node sampling
- cache invalidation

## 10.5 Testy round-trip
- GUI scene -> script -> scene
- scene -> ProblemIR
- scene -> artifact -> import -> scene

## 10.6 Testy UX
- gizmo translate/rotate/scale
- multi-object selection
- texture gizmo vs object gizmo
- undo/redo
- dirty state badges

---

## 11. Rekomendowany plan wdrożenia etapami

Poniżej podaję realny, sekwencyjny plan, który nie rozbije repo.

---

## Faza 0 — zatrzymanie driftu
### Cel
Ustalić semantykę przed dopisywaniem GUI.

### Zadania
1. Dodać `docs/specs/geometry-and-magnetization-authoring-v1.md`.
2. Opisać:
   - `SceneObject`
   - `Transform3D`
   - `MagnetizationAsset`
   - `MagnetizationMapping`
   - bake contracts
3. Ujednolicić docs z realnym kodem.

### Efekt
Programiści wiedzą, co jest prawdą.

---

## Faza 1 — kanoniczny `SceneDocument`
### Cel
Wprowadzić brakującą warstwę authoringu.

### Zadania
1. Dodać typy `SceneDocument`, `SceneObject`, `Transform3D`, `MagnetizationAsset`.
2. Dodać projection:
   - `SceneDocument -> ScriptBuilderState`
   - `SceneDocument -> ProblemIR`
3. Dodać helper export/import scene.

### Efekt
Jedno źródło prawdy dla GUI.

---

## Faza 2 — pełny transform stack
### Cel
Przestać traktować translację jako jedyny transform.

### Zadania
1. Python:
   - dodać `rotate`, `scale`, `pivot`
2. Frontend:
   - inspector transform
   - model tree badges
3. Backend:
   - serialization transformów
   - bounds recompute
4. Preview:
   - overlaye liczone z pełnego transformu

### Efekt
Prawdziwy fundament pod gizmo 3D.

---

## Faza 3 — gizmo object mode
### Cel
Dowieźć 3dsmax-like manipulację obiektem.

### Zadania
1. Translate
2. Rotate
3. Scale
4. local/world toggle
5. numeric transform inspector
6. focus/selection fixes
7. dirty-state propagation

### Efekt
Obiekty da się sensownie ustawiać w GUI.

---

## Faza 4 — magnetization assets v1
### Cel
Zrobić osobną warstwę magnetyzacji authoringowej.

### Zadania
1. Uniform/random/file/procedural(radial/vortex/stripes)
2. mapping world/object
3. texture transform
4. inspector panel
5. preview 3D/2D
6. bake do `SampledField`

### Efekt
Pojawia się pierwsza prawdziwa „tekstura magnetyczna”.

---

## Faza 5 — texture gizmo mode
### Cel
Pozwolić ruszać teksturą niezależnie od obiektu.

### Zadania
1. toolbar mode switch:
   - object
   - texture
2. `SetTextureTransform`
3. texture-space debug preview
4. rebake preview on drag debounce

### Efekt
Workflow zgodny z oczekiwaniem użytkownika.

---

## Faza 6 — round-trip i skrypt
### Cel
Domknąć GUI ↔ Python.

### Zadania
1. helper rewrite from scene
2. stable template generation
3. mode:
   - projection-owned
   - script-owned
4. conflict diagnostics

### Efekt
GUI nie żyje obok Pythona, tylko razem z nim.

---

## Faza 7 — compositing i brush tools
### Cel
Zrobić system naprawdę mocny.

### Zadania
1. composite source
2. mask
3. paint/stamp
4. symmetry
5. presets library

### Efekt
Editor przestaje być tylko „param panel + preview”.

---

## 12. Proponowane zmiany w konkretnych miejscach repo

Poniżej celowo wskazuję realne moduły.

---

## 12.1 Python

### `packages/fullmag-py/src/fullmag/model/geometry.py`
**Zmieniamy:**
- dodać pełny `Transform3D`
- rozszerzyć API o rotate/scale/pivot
- oddzielić geometrię bazową od transformów

### `packages/fullmag-py/src/fullmag/init/magnetization.py`
**Zmieniamy:**
- dodać `FunctionMagnetizationSource`
- dodać procedural sources
- dodać mapping i texture transform
- `from_function` doprowadzić do działającej wersji

### `packages/fullmag-py/src/fullmag/init/state_io.py`
**Zmieniamy:**
- utrzymać jako backend import/export assetów magnetyzacji
- dodać metadane authoringowe tam, gdzie to sensowne

### `packages/fullmag-py/src/fullmag/world.py`
**Zmieniamy:**
- ewolucja `MagnetHandle` w stronę `SceneObjectHandle`
- dodać API object transform
- dodać API texture transform
- odseparować geometry handle od magnetization handle

### `packages/fullmag-py/src/fullmag/model/problem.py`
**Zmieniamy:**
- projection z `SceneDocument` do `Problem`
- bake magnetyzacji proceduralnej do sampled field
- capability checks

### `packages/fullmag-py/src/fullmag/runtime/helper.py`
**Zmieniamy:**
- nowe komendy export/import scene
- rewrite from scene
- bake preview / bake initial magnetization

---

## 12.2 Rust

### `crates/fullmag-api/src/types.rs`
**Zmieniamy:**
- typy `SceneDocument`
- `EditorCommand`
- selection/transform/texture transform request types

### `crates/fullmag-api/src/main.rs`
**Zmieniamy:**
- nowe endpointy `editor/*`
- osobna ścieżka commandów authoringowych
- undo/redo
- preview rebake hooks

### `crates/fullmag-api/src/script.rs`
**Zmieniamy:**
- export/import scene document
- rewrite script from scene
- projection adapters

### `crates/fullmag-api/src/session.rs`
**Zmieniamy:**
- snapshot authoring state
- revision tracking
- dirty flags
- last bake status

### `crates/fullmag-ir/src/lib.rs`
**Zmieniamy:**
- ostrożnie: niekoniecznie wszystko pakować do solverowego IR
- jeśli trzeba, dodać authoring-adjacent typy tylko tam, gdzie faktycznie solver tego potrzebuje

### Proponowany nowy crate
```text
crates/fullmag-authoring
```

**Cel:**
- `SceneDocument`
- transform algebra
- authoring validators
- projection do `ProblemIR`

To byłby bardzo dobry ruch architektoniczny.

---

## 12.3 Frontend

### `apps/web/lib/session/types.ts`
**Zmieniamy:**
- dodać `SceneDocument`
- dodać `Transform3D`
- dodać `MagnetizationAsset`
- dodać `EditorCommand`
- dodać selection modes

### `apps/web/lib/liveApiClient.ts`
**Zmieniamy:**
- dodać klienta do `editor/*`
- osobne metody:
  - `fetchScene()`
  - `updateScene()`
  - `applyEditorCommand()`
  - `undo()`
  - `redo()`
  - `bakePreview()`
  - `bakeProblem()`

### `apps/web/components/panels/ModelTree.tsx`
**Zmieniamy:**
- scene graph zamiast tylko builder tree
- object/material/magnetization assets osobno
- capability badges
- dirty badges
- lock/visibility

### `apps/web/components/preview/MagnetizationView3D.tsx`
**Zmieniamy:**
- pełne gizmo modes:
  - translate
  - rotate
  - scale
- selection overlay
- texture gizmo overlay
- multi-selection
- local/world
- pivot mode

### `apps/web/components/runs/control-room/shared.tsx`
**Zmieniamy:**
- overlaye nie mogą być tylko AABB helperem
- trzeba je oprzeć o kanoniczny `SceneObject`
- dodać derived preview geometry / debug geometry

### Nowe komponenty
```text
apps/web/components/editor/SceneToolbar.tsx
apps/web/components/editor/ObjectInspector.tsx
apps/web/components/editor/TextureInspector.tsx
apps/web/components/editor/MagnetizationLayerStack.tsx
apps/web/components/editor/TransformPanel.tsx
apps/web/components/editor/GizmoModeToolbar.tsx
apps/web/components/editor/AuthoringStatusStrip.tsx
```

---

## 13. Co wdrażać najpierw, a czego nie ruszać zbyt wcześnie

### Najpierw
1. SceneDocument
2. Transform3D
3. object gizmo
4. magnetization assets v1
5. texture transform
6. bake preview
7. round-trip script

### Później
1. brush painting
2. advanced boolean modifier stack UI
3. hierarchy/group parenting
4. collaborative editing
5. advanced DCC ergonomics

### Czego nie robić zbyt wcześnie
- pełnego node-graph editor dla magnetyzacji,
- zbyt ciężkiej przebudowy solvera,
- generowania wszystkiego bez dirty flags i cache,
- pakowania authoring metadata do solverowego IR.

---

## 14. Minimalny docelowy feature set, który już będzie „produktem”

Jeśli chcesz osiągnąć sensowny milestone, to powinien on obejmować:

### Geometria
- Box
- Cylinder
- Ellipsoid
- Imported geometry
- Translate / Rotate / Scale w GUI

### Magnetyzacja
- Uniform
- Random
- File
- Vortex / Radial / Stripes
- Mapping object/world
- Texture transform

### GUI
- Scene tree
- 3D gizmo object mode
- 3D gizmo texture mode
- Inspector
- Preview 2D/3D
- Bake preview
- Bake do solvera
- Undo/redo

### Python
- scene API
- script projection
- round-trip helper

### Backend
- scene document endpoints
- editor commands
- bake pipeline
- capability diagnostics

To już byłby realny, mocny i spójny produkt.

---

## 15. Kluczowe ryzyka wdrożeniowe

### Ryzyko 1
Próba dopisywania wszystkiego do `ScriptBuilderState`.

**Skutek:** niekończący się formularz JSON bez prawdziwego modelu sceny.

### Ryzyko 2
Traktowanie overlayów jako modelu sceny.

**Skutek:** rotate/scale i texture transform rozpadną się na hacki.

### Ryzyko 3
Brak osobnego texture transform.

**Skutek:** nie osiągniesz workflowu, o który prosisz.

### Ryzyko 4
Trzymanie tylko baked sampled field.

**Skutek:** GUI straci edytowalność i stanie się importerem snapshotów.

### Ryzyko 5
Brak capability matrix authorable/previewable/meshable/executable.

**Skutek:** user będzie tworzył rzeczy, których solver nie uruchomi, bez jasnej informacji dlaczego.

---

## 16. Moja rekomendacja strategiczna

Jeśli celem jest **pełnoprawne tworzenie geometrii i ustawianie magnetyzacji z GUI**, to projekt powinien pójść w tę stronę:

### Decyzja A
Dodać **kanoniczny `SceneDocument`**.

### Decyzja B
Rozdzielić:
- transform obiektu
- transform tekstury magnetycznej

### Decyzja C
Wprowadzić **magnetization asset system**, a nie tylko `m0` jako solver input.

### Decyzja D
Traktować `ProblemIR` jako format solverowy, a nie format GUI.

### Decyzja E
Rozwinąć obecny control-room do roli:
- control-room + authoring editor,
zamiast budować osobną aplikację.

---

## 17. Krótka lista „must-have” zmian technicznych

1. `SceneDocument`
2. `Transform3D`
3. `MagnetizationAsset`
4. `MagnetizationMapping`
5. `textureTransform`
6. `EditorCommand` queue
7. `undo/redo`
8. `preview bake`
9. `solver bake`
10. `round-trip rewrite from scene`
11. `capability states`
12. aktualizacja dokumentacji/speców

---

## 18. Ostateczna ocena

### Ocena stanu obecnego
Repo jest **bliżej celu, niż wygląda na pierwszy rzut oka**:
- ma DSL,
- ma geometrię,
- ma meshing,
- ma live browser shell,
- ma preview,
- ma import/export magnetyzacji,
- ma nawet pierwszy translacyjny gizmo.

### Ale
Repo jest też **za daleko od pełnego authoringu 3D**, żeby dało się to dowieźć samym „dopisywaniem paneli”.

### Największy dług
Największym długiem nie jest brak rotate gizmo.  
Największym długiem jest brak **jednego, spójnego, authoringowego modelu sceny i magnetyzacji**.

### Wniosek końcowy
Jeśli teraz wprowadzisz:
- `SceneDocument`,
- `Transform3D`,
- `MagnetizationAsset + textureTransform`,
- authoring commands,
- preview/solver bake pipeline,

to wtedy:
- GUI,
- Python,
- IR,
- preview,
- solver

zaczną mówić jednym językiem.

I dopiero wtedy Fullmag będzie mógł naprawdę wejść w workflow:
> „tworzę geometrię jak w DCC, ustawiam magnetyzację jak asset proceduralny/plikowy, przesuwam i obracam zarówno obiekt, jak i teksturę pola, oglądam wynik na żywo, a potem jednym kliknięciem bake’uję to do solvera”.

---

## 19. Najkrótsza wersja planu wdrożenia

### Sprint 1
- spec authoring v1
- `SceneDocument`
- projection do builder state

### Sprint 2
- `Transform3D`
- full object gizmo
- numeric transform inspector

### Sprint 3
- `MagnetizationAsset`
- uniform/random/file/procedural-vortex/radial
- texture transform

### Sprint 4
- preview bake
- texture gizmo mode
- dirty flags

### Sprint 5
- rewrite script from scene
- solver bake
- capability diagnostics

### Sprint 6
- composite layers
- presets
- UX polishing

---

## 20. Finalna rekomendacja wykonawcza

**Nie rób teraz „więcej tego samego”.**  
Nie rozbudowuj tylko:
- `ScriptBuilderState`,
- formularzy,
- prostych overlayów.

Zamiast tego zrób jeden większy, ale właściwy krok architektoniczny:

> **wprowadź authoringową scenę jako osobną warstwę systemu**  
> i dopiero na niej buduj pełny edytor geometrii i magnetyzacji.

To będzie najtańsza droga długofalowo.  
Każda tańsza „łatka” będzie krótsza tylko dziś, a droższa jutro.

---

## 21. Aneks — proponowane nazwy nowych bytów

### Python
- `Scene`
- `SceneObject`
- `Transform3D`
- `MagnetizationAsset`
- `MagnetizationMapping`
- `TextureTransform`
- `ProceduralMagnetization`
- `CompositeMagnetization`

### Rust / API
- `SceneDocument`
- `EditorCommand`
- `BakePreviewRequest`
- `BakeProblemRequest`
- `SetObjectTransformCommand`
- `SetTextureTransformCommand`

### Frontend
- `SceneToolbar`
- `ObjectInspector`
- `TextureInspector`
- `MagnetizationLayerStack`
- `TransformGizmoController`
- `EditorStatusStrip`

---

## 22. Aneks — minimalny szkic typów TypeScript

```ts
export type Transform3D = {
  translation: [number, number, number];
  rotationQuat: [number, number, number, number];
  scale: [number, number, number];
  pivot: [number, number, number];
};

export type MagnetizationMapping = {
  space: "world" | "object" | "texture";
  projection:
    | "object_local"
    | "planar_xy"
    | "planar_xz"
    | "planar_yz"
    | "box"
    | "triplanar"
    | "cylindrical"
    | "spherical";
  clampMode: "clamp" | "wrap" | "mirror";
};

export type MagnetizationAsset =
  | {
      id: string;
      kind: "uniform";
      value: [number, number, number];
      mapping: MagnetizationMapping;
      textureTransform: Transform3D;
    }
  | {
      id: string;
      kind: "random";
      seed: number;
      mapping: MagnetizationMapping;
      textureTransform: Transform3D;
    }
  | {
      id: string;
      kind: "file";
      sourcePath: string;
      dataset?: string | null;
      sampleIndex?: number | null;
      mapping: MagnetizationMapping;
      textureTransform: Transform3D;
    }
  | {
      id: string;
      kind: "procedural";
      operator: "vortex" | "radial" | "stripes";
      params: Record<string, unknown>;
      mapping: MagnetizationMapping;
      textureTransform: Transform3D;
    };
```

---

## 23. Aneks — minimalny szkic API Python

```python
import fullmag as fm

scene = fm.Scene("flower")

obj = fm.SceneObject(
    name="flower_core",
    geometry=fm.Ellipsoid(rx=80e-9, ry=60e-9, rz=25e-9),
    transform=fm.Transform3D(
        translation=(0.0, 0.0, 0.0),
        rotation_euler=(0.0, 0.0, 0.0),
        scale=(1.0, 1.0, 1.0),
        pivot=(0.0, 0.0, 0.0),
    ),
)

obj.material = fm.Material(name="Py", Ms=800e3, A=13e-12, alpha=0.02)

obj.magnetization = fm.MagnetizationAsset.procedural(
    name="vortex_01",
    operator="vortex",
    params={
        "axis": (0.0, 0.0, 1.0),
        "chirality": "cw",
        "core_polarity": 1,
    },
    mapping=fm.MagnetizationMapping(space="object", projection="box"),
    texture_transform=fm.Transform3D(
        translation=(0.0, 0.0, 0.0),
        rotation_euler=(0.0, 0.0, 45.0),
        scale=(1.0, 1.0, 1.0),
    ),
)

scene.add(obj)
problem = scene.to_problem()
```

---

## 24. Zamknięcie

Ten kierunek jest wykonalny i repo ma pod niego dobre fundamenty.

Ale trzeba wykonać **jeden świadomy ruch architektoniczny**:
- odseparować authoring od solvera,
- odseparować obiekt od tekstury magnetyzacji,
- odseparować scenę od samego builder state.

Dopiero po tym Fullmag będzie mógł mieć:
- prawdziwy edytor geometrii,
- prawdziwy edytor magnetyzacji,
- prawdziwy workflow GUI ↔ Python ↔ solver,
- oraz manipulację obiektem i teksturą „jak w narzędziu 3D”, a nie tylko w formularzu.

