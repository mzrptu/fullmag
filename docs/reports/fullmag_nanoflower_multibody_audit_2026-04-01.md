# Audyt end-to-end: obsługa dwóch nanoflowerów w Fullmag  
**Data:** 2026-04-01  
**Repozytorium:** `MateuszZelent/fullmag`  
**Zakres:** od skryptu Pythona, przez loader/runtime, builder draft, canonical rewrite, planowanie/solver FEM, aż po `Universe`, artefakty, drzewko modelu i wizualizację 3D.

---

## 0. Status dowodów i ograniczenia audytu

To jest ważne, bo Twój opis lokalnego przypadku i obecny publiczny `master` **nie są tym samym stanem kodu**.

### Co potwierdziłem bezpośrednio
Potwierdziłem na aktualnym publicznym `master` repozytorium oraz w pobranych plikach źródłowych:

- `examples/nanoflower_fem.py` na publicznym `master` ma **jeden** obiekt `nanoflower`, a nie dwa.
- `examples/nanoflower_fdm.py` ma mylącą nazwę, ale faktycznie ustawia `study.engine("fem")`, jawny `study.universe(size=(800e-9, 800e-9, 800e-9))`, jeden obiekt `nanoflower` i stan początkowy `fm.uniform(0.1, 0.0001, 0.99)`.
- aktualny frontend **umie** renderować więcej niż jedną geometrię w drzewku,
- ale nadal ma kilka bardzo konkretnych założeń typu „pierwszy obiekt”, „mesh bbox = world extent”, „Universe tylko jako metadata UI”, „mesh rewrite tylko dla pierwszego magnesu”.

### Czego nie mogłem potwierdzić bezpośrednio
Nie mam w tym środowisku dostępu do Twojej lokalnej ścieżki:

`/home/kkingstoun/git/fullmag/fullmag/examples/nanoflower_fem.py`

więc **nie mogłem bezpośrednio otworzyć Twojego lokalnego pliku**.  
Jeżeli Twój lokalny `nanoflower_fem.py` faktycznie tworzy dwa nanoflowery, to jest to **inna wersja/gałąź** niż obecny publiczny `master`, albo plik lokalnie został zmodyfikowany.

### Jak czytać ten raport
W raporcie wyraźnie rozdzielam:

1. **to, co potwierdza obecny publiczny kod**,  
2. **to, co wynika z Twojego opisu i załączonego szkicu**,  
3. **to, co logicznie stanie się end-to-end, jeśli lokalny skrypt faktycznie ma dwa obiekty**.

To rozróżnienie jest kluczowe, bo w przeciwnym razie łatwo naprawiać niewłaściwy bug.

---

## 1. Executive summary

Najważniejsze wnioski są następujące.

### Wniosek A — publiczny `nanoflower_fem.py` dziś nie odtwarza Twojego przypadku
W publicznym `master` plik `examples/nanoflower_fem.py` definiuje tylko **jedno** `ImportedGeometry("nanoflower.stl")` nazwane `nanoflower`.  
Jeśli więc u Ciebie „`nanoflower_fem.py` tworzy dwa nanoflowery”, to analizujemy **lokalną, nieopublikowaną wersję**.

### Wniosek B — interfejs nie jest „całkowicie ślepy” na multi-body
To nie jest tak, że Fullmag od podstaw nie umie mieć wielu geometrii.

Obecny kod już ma:
- loader, który potrafi zebrać wiele magnesów,
- builder draft z listą `geometries`,
- frontendowe drzewko, które umie renderować `N bodies`,
- planner FEM, który umie scalić wiele meshy do jednego planu wykonawczego.

To oznacza, że obserwacja „w UI widzę jeden obiekt” **nie wynika wyłącznie z tego, że parser Pythona gubi drugi obiekt**.

### Wniosek C — najbardziej prawdopodobna bezpośrednia przyczyna „widzę tylko jeden”
Najbardziej prawdopodobne są dziś **dwie** bezpośrednie klasy przyczyn:

1. **zła/stara sesja lub zły plik w aktywnym workspace**,  
2. **stale zsynchronizowany builder/UI**, który nie odświeżył modelu po zmianie zawartości skryptu.

Dodatkowo jest trzecia, bardziej ukryta przyczyna:
3. **canonical rewrite / override path** ma realne bugi, które potrafią zgubić translację, `scale`, `volume`, a mesh workflow renderuje tylko dla pierwszego obiektu.

### Wniosek D — nawet jeśli załadujesz poprawny dwuobiektowy skrypt, ścieżka nadal nie jest poprawna end-to-end
I to jest najważniejsza część audytu.

Dla realnego dwuobiektowego FEM z `ImportedGeometry` obecny kod ma co najmniej następujące luki:

- builder dla sekwencji etapów nie bazuje na stabilnym „modelu źródłowym”, tylko na pierwszym stage,
- loader odrzuca `workspace_problem`, gdy są stage’e,
- rewrite geometrii z override potrafi zgubić translacje,
- rewrite mesh workflow dla flat FEM renderuje mesh tylko dla **pierwszego** magnesu,
- flat IR nadal nie ma pełnej semantyki „różny mesh per obiekt”,
- planner FEM robi merge wielu brył, ale zachowuje tylko **jedną** globalną `material` i nie niesie jawnej informacji „które elementy należą do którego body”,
- `study.universe(...)` w obecnym kodzie jest w praktyce głównie **metadata UI**, a nie wykonawczą semantyką solvera FEM,
- `worldExtent` w UI to bbox gotowego mesha, a nie semantyczny `Universe`,
- osie w `FemMeshView3D` są skalowane do `geomSize`, a nie do `Universe`,
- sekcja `Regions / Selections` w drzewku nadal jest de facto jedno-domenowa (`Domain 1`, `Boundary`), mimo że geometrie mogą być wieloobiektowe.

### Wniosek E — „Universe” jest dziś semantycznie niespójny
To nie jest mały detal UI. To jest błąd modelu pojęciowego.

W obecnym kodzie:
- skrypt może deklarować `study.universe(...)`,
- builder to pamięta,
- panel `Universe` to pokazuje,
- ale planner FEM **nie propaguje** tego do `FemPlanIR.air_box_config`,
- `artifact_layout.world_extent` dla FEM jest liczone z bboxa mesha,
- `UniversePanel` i `FemMeshView3D` opierają się na tym bboxie.

W praktyce oznacza to, że Fullmag miesza trzy różne rzeczy:
1. zadeklarowany `Universe`,
2. solver domain / outer air box,
3. bbox aktualnego mesha.

Te pojęcia nie są dziś rozdzielone poprawnie.

---

## 2. Co naprawdę jest dziś w publicznym repo

### 2.1. `examples/nanoflower_fem.py` na publicznym `master`
Obecny publiczny plik ma postać jednoobiektową:

- `fm.name("nanoflower_fem")`
- `fm.engine("fem")`
- `flower = fm.geometry(fm.ImportedGeometry(source="nanoflower.stl", units="nm", name="nanoflower"), name="nanoflower")`
- `flower.m = fm.random(seed=1)`
- `flower.mesh(hmax=2.5e-9, order=1).build()`

Plik: `examples/nanoflower_fem.py`, linie 10–27.

To jest krytyczne, bo publiczny `master` **nie reprodukuje** lokalnego scenariusza „dwa nanoflowery”.

### 2.2. `examples/nanoflower_fdm.py` jest myląco nazwany
Plik `examples/nanoflower_fdm.py`:
- nazywa się „fdm”,
- ale ustawia `study.engine("fem")`,
- ma jawny `study.universe(mode="manual", size=(800e-9, 800e-9, 800e-9), center=(0,0,0))`,
- definiuje jeden obiekt `nanoflower`,
- ma `flower.m = fm.uniform(0.1, 0.0001, 0.99)`.

Plik: `examples/nanoflower_fdm.py`, linie 9–40.

To jest bardzo ważne, bo dokładnie taki zestaw sygnałów:
- jeden obiekt,
- `Universe = 800 nm`,
- uniform state,
- FEM,

jest zgodny raczej z `nanoflower_fdm.py`, a nie z publicznym `nanoflower_fem.py`.

### 2.3. Już sama nazwa przykładu pogarsza diagnostykę
Jeśli przykład nazywa się `nanoflower_fdm.py`, a faktycznie używa FEM i study-root API, to:
- support/debugging zaczyna się od fałszywej intuicji,
- screenshoty i logi łatwo przypisać do złego pliku,
- łatwo wyciągnąć błędny wniosek „UI ignoruje drugi obiekt”, podczas gdy tak naprawdę UI może pokazywać wynik zupełnie innego przykładu.

### Rekomendacja
**Albo** zmienić nazwę pliku na coś w rodzaju:
- `nanoflower_study_fem.py`
- `nanoflower_builder_fem.py`

**albo** rzeczywiście zrobić z niego FDM.  
Obecna nazwa jest po prostu myląca.

---

## 3. Co się dzieje od początku skryptu Pythona do `LoadedProblem`

Ta sekcja odpowiada na pytanie: gdzie może zniknąć drugi obiekt **zanim** dotrzemy do UI.

### 3.1. `load_problem_from_script(...)` nie jest z definicji jednoobiektowy
Plik: `packages/fullmag-py/src/fullmag/runtime/loader.py`, linie 71–125.

Loader robi kolejno:
1. `world.begin_script_capture(source_path.parent)`
2. wykonuje moduł Pythona,
3. pobiera `workspace_problem = world.capture_workspace_problem()`,
4. pobiera `captured_stages = world.finish_script_capture()`.

To oznacza:
- loader potrafi zmaterializować pełny „workspace problem” z wieloma magnesami,
- a potem dodatkowo potrafi zebrać stage’e (`relax`, `run` itd.).

### 3.2. Krytyczny szczegół: jeśli są stage’e, loader odrzuca `workspace_problem`
To jest pierwszy naprawdę ważny bug architektoniczny.

W `loader.py` logika wygląda tak:

- najpierw zbierany jest `workspace_problem`,
- ale jeśli `captured_stages` nie jest puste,
  to zwracany `LoadedProblem` dostaje:
  - `problem = final_stage.problem`
  - `stages = loaded_stages`
- a `workspace_problem` jest po prostu ignorowany.

Czyli w sekwencji typu:

```python
# definiuję geometrię
# definiuję materiał
# definiuję state
fm.relax()
fm.run(...)
```

loader:
- **wie**, jaki był pełny workspace przed stage’ami,
- ale tego nie zachowuje w `LoadedProblem`.

### 3.3. Konsekwencja
Dla sekwencji stage’y Fullmag traci naturalne rozróżnienie pomiędzy:

- **model bazowy / źródłowy**, który użytkownik napisał,
- **problem stage 1** (np. po narzuconym `relax_alpha=1.0`),
- **problem final stage**.

To ma konsekwencje nie tylko dla `alpha`, ale w ogóle dla tego, **co UI uważa za „kanoniczny model”**.

### 3.4. Dlaczego to ma znaczenie dla Twojego przypadku
Jeżeli Twój lokalny skrypt ma dwa nanokwiaty i jeszcze dodatkowo używa stage’y lub builder sync, to obecna architektura:
- nie ma stabilnej reprezentacji „oryginalnego modelu sprzed etapów”,
- przez co UI i canonical rewrite mogą operować na stanie pośrednim, a nie źródłowym.

### Jak to naprawić
#### Zmiana struktury `LoadedProblem`
Plik: `packages/fullmag-py/src/fullmag/runtime/loader.py`

Rozszerzyć:

```python
@dataclass(frozen=True, slots=True)
class LoadedProblem:
    problem: Problem
    source_path: Path
    script_source: str
    entrypoint_kind: str
    default_until_seconds: float | None = None
    stages: tuple[LoadedStage, ...] = ()
    workspace_problem: Problem | None = None
```

#### Zmiana w `load_problem_from_script(...)`
Jeżeli `captured_stages` istnieją, to zwracać:

```python
return LoadedProblem(
    problem=final_stage.problem,
    source_path=source_path,
    script_source=script_source,
    entrypoint_kind="flat_sequence" if len(loaded_stages) > 1 else final_stage.entrypoint_kind,
    default_until_seconds=final_stage.default_until_seconds,
    stages=loaded_stages,
    workspace_problem=workspace_problem,
)
```

#### Korzyść
Builder, UI i canonical rewrite dostają wtedy dostęp do:
- problemu finalnego,
- stage’ów,
- **oraz bazowego workspace problemu**.

To jest niezbędne, jeśli chcesz wiernie reprezentować dwuobiektowy model źródłowy.

---

## 4. Builder draft: co trafia do UI

### 4.1. `export_builder_draft(...)` umie eksportować wiele geometrii
Plik: `packages/fullmag-py/src/fullmag/runtime/script_builder.py`, linie 48–75.

Builder draft robi:

```python
"geometries": [_export_geometry_entry(magnet, base_problem) for magnet in base_problem.magnets]
```

To ważny fakt: lista geometrii nie jest z definicji jednoelementowa.

Jeżeli `base_problem.magnets` ma dwa obiekty, builder draft **potrafi** wyeksportować dwa wpisy.

### 4.2. Ale `base_problem` wybierany jest błędnie
W tej samej funkcji:

```python
base_problem = loaded.stages[0].problem if loaded.stages else loaded.problem
```

To oznacza:
- dla sekwencji stage’y builder draft **nie bierze modelu źródłowego**,
- tylko **pierwszy stage**.

To jest błąd semantyczny.

### 4.3. Skutek uboczny już dziś widać na `alpha`
`world.relax(...)` ma domyślne `relax_alpha = 1.0`, a potem robi tymczasowe podmienienie `material.alpha` dla wszystkich magnesów.

Plik: `packages/fullmag-py/src/fullmag/world.py`, linie 1666–1723.

Czyli jeśli skrypt źródłowy ma np.:
```python
flower.alpha = 0.1
fm.relax()
fm.run(...)
```

to pierwszy stage ma `alpha = 1.0`, mimo że model źródłowy miał `0.1`.

A ponieważ builder draft bierze pierwszy stage, UI pokazuje:
- nie „model użytkownika”,
- tylko „problem relaksacyjny”.

To nie jest kosmetyka. To jest semantycznie zły model w interfejsie.

### 4.4. Konsekwencja dla dwuobiektowego scenariusza
W dwuobiektowym skrypcie to samo może dotyczyć:
- materiałów,
- stanu początkowego,
- solver settings,
- interpretacji meshingu,
- a nawet tego, który etap uważamy za bazowy.

### Jak to naprawić
Po wprowadzeniu `workspace_problem` do `LoadedProblem`:

```python
def export_builder_draft(loaded: LoadedProblem) -> dict[str, object]:
    base_problem = loaded.workspace_problem or loaded.problem
    relax_stage = _first_relax_stage(loaded)
    ...
```

Jeśli `workspace_problem` nie istnieje, dopiero wtedy fallback do `loaded.problem`.

### Wniosek
Builder draft nie powinien być budowany z `stage[0]`, tylko z **kanonicznego modelu bazowego**.

---

## 5. UI drzewka modelu: gdzie multi-body działa, a gdzie nie

### 5.1. Geometrie w drzewku **już dziś** wspierają wiele ciał
Plik: `apps/web/components/ModelTree.tsx`, linie 241–246 oraz 312–321.

Kod robi:

```tsx
const geos = opts.geometries ?? [];
const geometryChildren = geos.length > 0
  ? geos.map((geo) => _buildGeometryNode(geo))
  : ...
```

oraz badge:
```tsx
`${geos.length} body` / `${geos.length} bodies`
```

To znaczy:
- drzewko geometrii nie jest twardo jednoobiektowe,
- jeśli builder dostarczy dwie geometrie, ta warstwa umie je pokazać.

### 5.2. Każdy wpis geometrii ma osobny node
Plik: `apps/web/components/ModelTree.tsx`, linie 506–557.

`_buildGeometryNode(geo)` buduje osobny node na podstawie `geo.name`, `geo.geometry_kind`, `geo.mesh`, `geo.material`, `geo.magnetization`.

To ponownie potwierdza: UI drzewka **umie** mieć dwa osobne body.

### 5.3. Ale `Regions / Selections` nadal jest de facto jedno-domenowe
W tym samym pliku, linie 323–332:

```tsx
children: [
  { id: "reg-domain", label: "Domain 1", icon: "■" },
  { id: "reg-boundary", label: "Boundary", icon: "▢" },
],
```

To jest twardo zaszyty placeholder:
- `Domain 1`
- `Boundary`

Niezależnie od liczby geometrii.

### Konsekwencja
Nawet jeśli geometrie są wieloobiektowe, drzewko nadal wysyła użytkownikowi sygnał:
- „masz jedną domenę”.

To jest bardzo ważny UI-smell: część interfejsu jest multi-body aware, a część nadal udaje pojedyncze domain.

### Jak to naprawić
#### Minimalnie
Plik: `apps/web/components/ModelTree.tsx`

Zastąpić statyczne regiony danymi rzeczywistymi z builder manifest / `problem.regions`.

Przykładowo:
- jeden node per region,
- osobne regiony lub segmenty przypisane do geometrii,
- boundary nodes tylko jeśli są znane z mesha.

#### Lepiej
Wprowadzić w stanie UI osobną listę:
- `scriptBuilderRegions`
- lub `meshBodySegments`

i budować tę sekcję z danych planera/manifestu.

### Wniosek
Jeżeli użytkownik ma dwa body, a sekcja `Regions` nadal pokazuje „Domain 1”, to interfejs już w tym miejscu komunikuje fałszywie uproszczony model.

---

## 6. Stale UI / zła sesja / zły skrypt: ukryta, ale bardzo realna przyczyna

To jest jedna z ważniejszych przyczyn praktycznych i bardzo pasuje do objawu:  
„w edytorze mam dwa obiekty, a UI dalej pokazuje jeden”.

### 6.1. Hydratacja buildera w `ControlRoomContext` opiera się o zbyt słaby klucz
Plik: `apps/web/components/runs/control-room/ControlRoomContext.tsx`, linie 193–196.

```tsx
const workspaceHydrationKey = session
  ? `${session.started_at_unix_ms}:${session.run_id}:${session.script_path}`
  : null;
```

To oznacza, że hydratacja lokalnego builder state zależy od:
- czasu startu sesji,
- `run_id`,
- ścieżki skryptu.

Ale **nie zależy od zawartości pliku**.

### 6.2. Tymczasem `Problem.to_ir()` już wylicza `source_hash`
Plik: `packages/fullmag-py/src/fullmag/model/problem.py`, linie 641 oraz 676–685.

Kod liczy:
```python
source_hash = sha256(script_source.encode("utf-8")).hexdigest()
```

i pakuje to do:
```python
problem_meta.source_hash
```

Czyli infrastruktura już umie rozpoznać, że zawartość skryptu się zmieniła.

### 6.3. UI tego nie wykorzystuje
W pobranej części frontendu nie ma użycia `source_hash` do:
- wymuszenia rehydratacji buildera,
- wyświetlenia warningu o niespójności,
- porównania „to, co mam w edytorze” vs „to, co jest aktualnie załadowane w workspace”.

### 6.4. Konsekwencja praktyczna
Możesz mieć sytuację:

1. workspace uruchomiono ze starego pliku,
2. później plik pod tą samą ścieżką edytowano i dodano drugi nanoflower,
3. `script_path` pozostał ten sam,
4. `workspaceHydrationKey` pozostał ten sam,
5. lokalny UI nadal używa starego `scriptBuilder`,
6. w drzewku nadal widać jeden obiekt.

To bardzo dobrze pasuje do opisu „jakby nie widział tych komend”.

### Jak to naprawić
#### Wariant minimalny
Dodać do klucza hydratacji:
- `problem_meta.source_hash`
- albo hash `scriptBuilder.geometries`

np.:
```tsx
const workspaceHydrationKey = session && problemMeta?.source_hash
  ? `${session.started_at_unix_ms}:${session.run_id}:${session.script_path}:${problemMeta.source_hash}`
  : ...
```

#### Wariant lepszy
Hydratować ponownie, gdy zmieni się `remoteBuilderSignature`, a lokalny draft nie ma niesynchronizowanych zmian.

#### Wariant najlepszy
Pokazywać bannner:
- „Workspace jest oparty na innej wersji skryptu niż aktualny plik na dysku”
- z porównaniem `script_path` + `source_hash`.

### Wniosek
To jest bardzo realna przyczyna „widzę tylko jeden obiekt”, nawet jeśli loader i builder umieją multi-body.

---

## 7. Canonical rewrite i override path: tutaj jest kilka bardzo konkretnych bugów

Ta sekcja jest krytyczna, bo nawet jeśli builder **załaduje** dwa obiekty poprawnie, to późniejsze „Sync to canonical Python” może ten model popsuć.

---

### 7.1. Rewrite dla sekwencji znowu bierze `stages[0]`
Plik: `packages/fullmag-py/src/fullmag/runtime/script_builder.py`, linie 122–145.

`render_loaded_problem_as_script(...)` robi:

```python
base_problem = stages[0].problem if stages else loaded.problem
```

Czyli ten sam błąd semantyczny co w `export_builder_draft`.

#### Konsekwencja
Canonical rewrite:
- nie renderuje modelu źródłowego,
- tylko pierwszy stage.

To oznacza, że nawet jeśli loader miał poprawny workspace model, rewrite może go nie odtworzyć.

---

### 7.2. Override path gubi translację przez zwykłą niezgodność kluczy
To jest bardzo ważny i bardzo konkretny bug.

#### Eksport translacji
Plik: `script_builder.py`, linie 1505–1507.

Dla `Translate` eksport jest taki:
```python
return base_kind, {**base_params, "translate": list(geom.offset)}
```

#### Render z override
Plik: `script_builder.py`, linie 474–476 (w `_render_geometries_from_override(...)`).

Tam kod szuka:
```python
t = params.get("translation")
```

a nie:
```python
params.get("translate")
```

### To oznacza jednoznacznie:
- eksport zapisuje klucz `translate`,
- renderer override szuka klucza `translation`,
- więc translacja jest **gubiona**.

### Dlaczego to jest krytyczne dla dwóch nanoflowerów
Jeśli Twój lokalny dwuobiektowy `nanoflower_fem.py` tworzy lewy/prawy obiekt przez translacje w osi X, to po przejściu przez override/sync:
- oba body mogą stracić swoje offsety,
- więc w canonical rewrite wylądują współlokalizowane,
- a w preview będą wyglądały jak jeden.

To nie tłumaczy wszystkiego, ale jest **bardzo mocnym kandydatem na realny bug niszczący dwuobiektowość**.

### Jak to naprawić
W `_render_geometries_from_override(...)` zmienić:

```python
t = params.get("translation")
```

na coś odpornego:
```python
t = params.get("translate")
if t is None:
    t = params.get("translation")
```

Dodatkowo:
- ustalić jeden kanoniczny klucz (`translate`) i trzymać go konsekwentnie wszędzie.

---

### 7.3. Override path gubi `scale` i `volume` dla `ImportedGeometry`
To jest drugi bardzo ważny bug w tej samej ścieżce.

#### Eksport geometrii
Plik: `script_builder.py`, linie 1490–1496.

Dla `ImportedGeometry` eksportuje się:
- `source`
- `scale`
- `volume`
- `name`

#### Ale render z override tego nie używa
W `_render_geometries_from_override(...)` dla `ImportedGeometry` budowane jest:

```python
fm.ImportedGeometry(source=..., name=...)
```

i tyle.

Nie ma:
- `scale=...`
- `volume=...`

### Konsekwencja
W builder-sync możesz stracić:
- skalę importu,
- tryb objętości (`volume`),
- a więc fizyczny rozmiar lub semantykę imported geometry.

### Dla Twojego przypadku
Jeżeli lokalne nanoflowery są importowane jako STL z `units="nm"` / `scale`, to override path nie odtworzy tego wiernie.

### Jak to naprawić
W `_render_geometries_from_override(...)` dla `ImportedGeometry` budować kwargs jak w `_render_geometry_expr(...)`:

```python
kwargs = [f"source={...}"]
if "scale" in params and params["scale"] not in (None, 1.0):
    kwargs.append(f"scale={_py_literal(params['scale'])}")
if "volume" in params and params["volume"] not in (None, "full"):
    kwargs.append(f"volume={_py_repr(params['volume'])}")
kwargs.append(f"name={_py_repr(name)}")
expr = f"fm.ImportedGeometry({', '.join(kwargs)})"
```

---

### 7.4. Mesh workflow dla flat FEM renderuje tylko pierwszy magnes
To jest jeden z najpoważniejszych twardych bugów.

Plik: `script_builder.py`, linie 812–857.

W ścieżce non-study:
```python
target_var = magnet_vars[problem.magnets[0].name]
...
lines.append(f"{target_var}.mesh(...)")
...
lines.append(f"{target_var}.mesh.build()")
```

Czyli:
- nawet jeśli problem ma dwa magnesy,
- mesh workflow w canonical rewrite trafia tylko do pierwszego.

### Konsekwencja
Wygenerowany skrypt:
- nie odtwarza per-body mesh workflow,
- redukuje konfigurację do pierwszego body.

### Jak to naprawić
#### Minimalnie
Iterować po wszystkich `problem.magnets` i dla każdego emitować mesh workflow.

#### Lepiej
Rozdzielić semantycznie:
- globalne mesh defaults,
- per-geometry mesh overrides.

Przykładowy kierunek:

```python
lines = ["# Mesh"]
for magnet in problem.magnets:
    target_var = magnet_vars[magnet.name]
    mesh_cfg = _mesh_workflow_per_geometry_entry(problem, magnet.name)
    merged = merge_global_and_local_mesh_config(...)
    kwargs = _render_mesh_kwargs(merged, source_root=source_root)
    if kwargs:
        lines.append(f"{target_var}.mesh({', '.join(kwargs)})")
    lines.extend(_render_mesh_size_fields(target_var, merged))
    lines.extend(_render_mesh_operations(target_var, merged))
    if bool(merged.get("build_requested", True)):
        lines.append(f"{target_var}.mesh.build()")
```

### Wniosek
Dopóki ten bug istnieje, canonical rewrite nie jest bezpieczny dla multi-body flat FEM.

---

### 7.5. `initial_state` export jest nadal jednoobiektowy
Plik: `script_builder.py`, linie 1305–1319.

`_export_initial_state(problem)` robi od razu:

```python
if len(problem.magnets) != 1:
    return None
```

To znaczy, że specjalna ścieżka „file-based initial state” w builder state:
- z definicji nie działa dla multi-body.

To nie jest główna przyczyna Twojego problemu, ale jest kolejnym dowodem, że builder state nadal ma pozostałości jednoobiektowych założeń.

---

## 8. Meshing w `world.py`: multi-body istnieje, ale architektura jest połowiczna

### 8.1. Python API dopuszcza mesh per geometry
`GeometryMeshHandle` pozwala wywołać:
- `body.mesh(...)`
- `body.mesh.build()`
- operations / size fields

czyli API użytkownika wygląda na per-body.

### 8.2. Ale flat IR nadal tego nie wspiera w pełni
Plik: `packages/fullmag-py/src/fullmag/world.py`, linie 1026–1092.

`_resolve_flat_fem_hint()`:

- zbiera specyfikacje z wielu magnesów,
- ale jeśli wykryje różne `hmax`, `order` lub `source`,
  to rzuca:

```python
"Per-geometry FEM mesh settings are not yet supported in the flat-script IR. Use one shared mesh configuration for all geometries in this script."
```

### Konsekwencja
Architektura jest dziś niespójna:
- API użytkownika wygląda na per-body,
- metadata mają `per_geometry`,
- ale flat IR i rewrite nie mają pełnej semantyki per-body mesh.

### 8.3. Dodatkowo `mesh_options` biorą „primary_spec”
Plik: `world.py`, linie 1139–1222.

W `_collect_mesh_workflow_metadata()`:
- `primary_spec` dla flat surface bierze się z pierwszego skonfigurowanego obiektu,
- a globalne `mesh_options` są kopiowane z `primary_spec`.

Czyli:
- część danych jest per-geometry,
- a część wciąż „pierwszy obiekt wygrywa”.

### Wniosek
To nie jest jeszcze pełna implementacja multi-body mesh semantics.  
To jest stan przejściowy.

### Jak to naprawić
Masz tu dwie możliwe strategie architektoniczne.

#### Strategia 1 — szczerze ograniczyć flat API
Jeśli flat API ma być wspólnym-shared-mesh-only, to:
- walidacja musi to mówić wcześnie i jasno,
- UI musi to komunikować,
- rewrite musi zachowywać wspólne ustawienia bez utraty informacji,
- per-geometry mesh controls nie powinny udawać niezależności.

#### Strategia 2 — naprawdę wesprzeć per-geometry mesh w flat API
Wtedy trzeba:
- rozszerzyć IR,
- przenieść `per_geometry` do pełnego modelu wykonawczego,
- naprawić rewrite,
- dodać testy round-trip.

Dla Twojego przypadku i dla przyszłego multi-body FEM zdecydowanie polecam **Strategię 2**.

---

## 9. Planner FEM: to działa dalej niż UI, ale nadal nie jest pełne multi-body

To jest ważna sekcja, bo odpowiada na pytanie:  
czy solver w ogóle umie policzyć dwa obiekty?

### 9.1. Planner entry nie odrzuca multi-body FEM
Plik: `crates/fullmag-plan/src/lib.rs`, linie 455–472.

Jeżeli `resolved_backend == BackendTarget::Fem`, planner idzie do:
- `plan_fem(...)`
- albo `plan_fem_eigen(...)`

i **nie** wpada w FDM-only ścieżkę single-body.

### 9.2. `plan_fem(...)` iteruje po wszystkich magnesach
Plik: `crates/fullmag-plan/src/lib.rs`, linie 1559–1815.

Dla każdego magnesu planner:
- znajduje region i geometrię,
- znajduje materiał,
- znajduje `FemMeshAssetIR` po `geometry_name`,
- ładuje mesh,
- generuje initial magnetization dla danego body,
- dopisuje mesh do `mesh_parts`,
- na końcu scala całość przez `merge_fem_meshes(...)`.

To znaczy, że planner FEM już realnie potrafi:
- przyjąć wiele body,
- zbudować jeden wykonawczy plan.

### 9.3. Jest nawet test „multi-body FEM should plan successfully”
Plik: `crates/fullmag-plan/src/lib.rs`, linie 2931–2981.

Test:
- tworzy dwa osobne `FemMeshAssetIR`,
- uruchamia `plan(&ir)`,
- sprawdza, że plan FEM ma 8 nodes, 2 elements itd.

To bardzo ważny dowód, że backend FEM nie jest dziś zero-jedynkowo jednoobiektowy.

### 9.4. Ale jest twarde ograniczenie: materiały muszą mieć identyczne prawo materiałowe
Plik: `crates/fullmag-plan/src/lib.rs`, linie 1623–1629 oraz 2584–2590.

Planner wymaga zgodności:
- `Ms`
- `A`
- `alpha`
- `uniaxial_anisotropy`
- `anisotropy_axis`

W przeciwnym razie dostajesz błąd:
> current multi-body FEM baseline requires identical material law across magnets

### Konsekwencja
Multi-body FEM w obecnym baseline to nadal:
- nie pełna ogólna obsługa wielu ciał,
- tylko wariant „wiele brył, ale w praktyce jedna wspólna material law”.

### 9.5. Jeszcze ważniejsze: po merge ginie jawna tożsamość body
Plik: `crates/fullmag-ir/src/lib.rs`, linie 1143–1178.

`FemPlanIR` ma:
- jedno `mesh: MeshIR`
- jedno `material: MaterialIR`
- jedną listę `initial_magnetization`

Nie ma:
- `body_segments`
- `element_body_ids`
- mapowania elementów do `magnet_name`
- listy materiałów per body

### Konsekwencja
Po stronie wykonawczej/IR:
- dwa body są scalamy do jednego mesha,
- ale plan nie niesie pełnej informacji „który element należy do którego obiektu”.

To bardzo utrudnia:
- poprawny UI round-trip,
- selekcję per-body,
- debugowanie,
- przyszłe zróżnicowane materiały,
- postprocessing per-object.

### 9.6. `merge_fem_meshes(...)` scala geometrię, ale nie buduje trwałego modelu ownership
Plik: `crates/fullmag-plan/src/lib.rs`, linie 2614–2672.

Merge:
- konkatenacja nodes,
- konkatenacja elements,
- konkatenacja boundary faces,
- remap markerów.

To działa jako baseline wykonawczy, ale nadal nie rozwiązuje modelu własności elementów per body na poziomie IR.

### Jak to naprawić
#### Krótkoterminowo
Dodać do `FemPlanIR` jawne segmenty typu:

```rust
pub struct FemBodySegmentIR {
    pub magnet_name: String,
    pub material_name: String,
    pub element_offset: usize,
    pub element_count: usize,
    pub node_offset: usize,
    pub node_count: usize,
}
```

lub prostszy wariant:
```rust
pub element_body_ids: Vec<u32>
pub body_table: Vec<BodyMetaIR>
```

#### Długoterminowo
Przebudować `FemPlanIR` tak, by:
- wspierał per-body material tables,
- zachowywał region/body ownership,
- pozwalał frontendowi i solverowi mówić tym samym językiem.

### Wniosek
Backend FEM jest **dalej** niż UI, ale to nadal baseline, a nie pełna implementacja multi-body.

---

## 10. Największa luka semantyczna: `study.universe(...)` nie jest dziś solverowym Universe

To jest według mnie **najważniejszy systemowy problem** po usunięciu kwestii „zły plik / zła sesja”.

### 10.1. `study.universe(...)` jest dziś rejestrowane głównie jako metadata
Plik: `packages/fullmag-py/src/fullmag/world.py`, linie 451–482 oraz 731–740.

`StudyUniverseConfig`:
- waliduje `mode`, `size`, `center`, `padding`,
- ma `to_ir()`,
- trafia do `_state._study_universe`.

Potem w `world.py`, linie 1608–1609:
```python
runtime_metadata["study_universe"] = s._study_universe.to_ir()
```

### 10.2. `Problem.to_ir()` wkłada to do builder manifest / runtime metadata
Plik: `packages/fullmag-py/src/fullmag/model/problem.py`, linie 492–545 oraz 643–665.

`study_universe` trafia do:
- builder manifest,
- runtime metadata.

### 10.3. Ale planner FEM tego nie używa do budowy air box/domain
W `plan_fem(...)`:

```rust
air_box_config: None,
```

Plik: `crates/fullmag-plan/src/lib.rs`, linia 1841.

To jest bardzo mocny sygnał:
- `FemPlanIR` ma pole `air_box_config`,
- ale planner go **nie wypełnia**.

### 10.4. Nie znalazłem też ścieżki, w której `study_universe` wpływa na geometry assets
W przeanalizowanym kodzie:
- `build_geometry_assets_for_request(...)` nie przyjmuje `study_universe`,
- `plan_fem(...)` go nie wykorzystuje,
- `air_box_config` zostaje `None`.

### 10.5. Konsekwencja praktyczna
Dziś `study.universe(...)` jest bliżej:
- deklaracji buildera,
- metadanych UI,

niż:
- realnego solver domain / air box.

To jest bardzo ważne, bo użytkownik naturalnie oczekuje, że `Universe`:
- obejmie obie geometrie,
- wpłynie na solver domain,
- ewentualnie utworzy outer air box.

Obecny kod tego nie robi.

### 10.6. Dodatkowa konsekwencja: auto demag realization nie „magicznie” nie naprawi tego problemu
W `plan_fem(...)`, linie 1796–1811, auto-demag realization robi:
- `poisson_airbox` jeśli mesh już ma air elements (`marker 0`),
- w przeciwnym razie `transfer_grid`.

Ale ponieważ `study.universe(...)` nie tworzy air boxa w planie, to:
- manual universe samo z siebie nie tworzy air elements,
- więc solver nie dostaje air boxa tylko dlatego, że UI go deklaruje.

### Wniosek
`Universe` jest dziś pojęciem semantycznie przeszacowanym przez UI.  
W solverze FEM to pojęcie nie jest jeszcze domknięte.

### Jak to naprawić
Masz tu dwie sensowne ścieżki.

#### Ścieżka 1 — pełna, docelowa
`study.universe(...)` staje się prawdziwą solverową semantyką:

- wchodzi do planner IR,
- generuje lub konfiguruje outer air box,
- ustawia `FemPlanIR.air_box_config`,
- wpływa na meshing/domain,
- wpływa na UI,
- wpływa na `worldExtent`.

To jest rozwiązanie, którego oczekuje użytkownik.

#### Ścieżka 2 — uczciwe ograniczenie
Jeśli dziś nie chcesz jeszcze wspierać solverowego `Universe`, to:
- nie nazywaj tego „Universe” w sposób sugerujący solver domain,
- nazwij to np. `Preview Domain` / `Builder Domain`,
- nie pokazuj „FEM outer domain / air box source”, jeśli plan tego nie wykonuje.

Moim zdaniem dla Fullmag właściwa jest **Ścieżka 1**.

---

## 11. `worldExtent` w UI nie oznacza Universe, tylko bbox mesha

To jest bezpośrednio związane z Twoją uwagą o osiach 3D.

### 11.1. `artifact_layout.world_extent` dla FEM jest liczone z bboxa mesha
Plik: `crates/fullmag-cli/src/formatting.rs`, linie 263–285.

Dla FEM:
- `bounds_min`, `bounds_max`, `world_extent`
- są liczone z `fem_mesh_bbox(&fem.mesh)`

czyli z:
- minimum i maksimum współrzędnych gotowego mesha.

To **nie jest** semantyczny `Universe`.

### 11.2. `ControlRoomContext` traktuje to jako `meshExtent`
Plik: `apps/web/components/runs/control-room/ControlRoomContext.tsx`, linie 511–513.

```tsx
const meshBoundsMin = ...
const meshBoundsMax = ...
const meshExtent = asVec3(femArtifactLayout?.world_extent) ?? ...
```

Czyli już tutaj:
- `world_extent` z artefaktu jest traktowane jako `meshExtent`.

### 11.3. Ale chwilę później to samo trafia jako `worldExtent`
W tym samym pliku, linie 521–535:

```tsx
const worldExtent = useMemo(() => {
  if (meshExtent) return meshExtent;
  ...
}, [meshExtent, artifactLayout]);
```

A potem w `modelValue`, linie 1619–1625:
- `meshExtent: meshSummary?.world_extent ?? meshExtent`
- `worldExtent: meshSummary?.world_extent ?? worldExtent`

Czyli:
- ten sam typ danych jest używany jako `meshExtent`
- i jako `worldExtent`.

### Wniosek
W UI pojęcia:
- „mesh extent”
- „world extent”
- „universe extent”

są dziś dla FEM praktycznie zlane w jedno.

To jest fundamentalnie błędne.

---

## 12. `UniversePanel` wzmacnia tę błędną semantykę

### 12.1. `effectiveExtent = ctx.worldExtent ?? declaredSize`
Plik: `apps/web/components/panels/settings/UniversePanel.tsx`, linie 44–49.

```tsx
const declaredSize = builderUniverse?.size ?? null;
const effectiveExtent = ctx.worldExtent ?? declaredSize;
```

To oznacza, że:
- jeśli istnieje `ctx.worldExtent`,
- panel używa go jako „effective extent”.

### 12.2. Problem
Ale `ctx.worldExtent` dla FEM to w praktyce bbox mesha, nie solverowy `Universe`.

Czyli panel `Universe` wyświetla:
- zadeklarowany `Universe`,
- ale jako „effective extent” pokazuje tak naprawdę rozmiar aktualnego mesha.

### 12.3. Dokładna konsekwencja
Jeżeli masz:
- jawny `study.universe(size=(800,800,800) nm)`
- oraz mały obiekt o rzeczywistym bboxie np. ~330 nm

to panel może jednocześnie mówić:
- `Declared Size = 800 nm`
- `Effective Extent = 329 nm`

Użytkownik odbiera to tak, jakby solver „zignorował universe”, albo jakby universe oznaczał coś innego niż obiecane.

I to odbiór w pełni uzasadniony, bo obecna semantyka jest niespójna.

### Jak to naprawić
#### Obowiązkowo rozdzielić trzy pola:
1. `declaredUniverseSize`
2. `resolvedUniverseSize`
3. `currentMeshExtent`

Panel powinien pokazywać je osobno.

#### Proponowany UX
- **Declared Universe** — to, co przyszło ze skryptu/buildera
- **Resolved Solver Domain** — to, co naprawdę poszło do solvera/air boxa
- **Current Mesh Extent** — bbox aktualnego mesha

Dopiero to daje uczciwy obraz.

---

## 13. Osie 3D w `FemMeshView3D` są dziś skalowane do geometrii, nie do Universe

To jest dokładnie ta rzecz, o którą prosiłeś, żeby sprawdzić.

### 13.1. `geomSize` jest liczone z aktualnej geometrii
Plik: `apps/web/components/preview/FemMeshView3D.tsx`, linie 242–244 oraz 307–317.

`handleGeometryCenter(...)` zapisuje:
- `geomCenter`
- `maxDim`
- `geomSize = [s.x, s.y, s.z]`

czyli rozmiar bboxa aktualnej geometrii/mesha.

### 13.2. `SceneAxes3D` dostaje `worldExtent={geomSize}`
Plik: `FemMeshView3D.tsx`, linia 399.

```tsx
<SceneAxes3D worldExtent={geomSize} center={[0, 0, 0]} sceneScale={[1, 1, 1]} />
```

### Wniosek
Osie:
- nie używają `study.universe.size`,
- nie używają solverowego outer domain,
- nie używają nawet `ctx.worldExtent`,
- tylko rozmiar aktualnej geometrii.

### Konsekwencja
Jeśli użytkownik myśli w kategoriach:
- „to jest mój world / universe / domain”,

to osie pokazują mu de facto:
- „bbox obiektu/mesha”.

Dla dwuobiektowego układu lub jawnego universe to jest niepoprawne.

### Jak to naprawić
#### Minimalna poprawka
W `FemMeshView3D` wprowadzić `previewWorldExtent`, np.:

```tsx
const previewWorldExtent =
  ctx.scriptBuilderUniverse?.size
  ?? ctx.worldExtent
  ?? geomSize;
```

i dopiero to przekazać do:
```tsx
<SceneAxes3D worldExtent={previewWorldExtent} ... />
```

#### Lepsza poprawka
Rozdzielić dwa osobne koncepty:
- **camera fit extent** — do dopasowania kamery do geometrii,
- **scene/world axes extent** — do rysowania domeny.

Kamera może fitować do geometrii, ale osie powinny odpowiadać world/domain.

---

## 14. To, czego nie potwierdziłem z załączonego szkicu

Twój szkic raportu zawierał też wątek:
- `bounds_min/bounds_max` dla `ImportedGeometry`,
- `load_surface_asset(...)`,
- `trimesh`,
- brak bounds powodujący problemy overlay/focus.

To jest sensowny trop, ale w **obecnym publicznym `master`** nie potwierdziłem dokładnie tej samej ścieżki.

### Dlaczego
W aktualnym `script_builder.py`:
- nie ma już builder exportu `bounds_min/bounds_max` dla geometrii,
- `ScriptBuilderGeometryEntry` nie ma takich pól,
- więc ten fragment szkicu najwyraźniej odnosi się do innej rewizji kodu.

### Co nadal jest prawdą
W `surface_assets.py` nadal widać asymetrię:

- `load_surface_asset(source)` robi `Path(source)` bez rozwiązywania względem katalogu skryptu,
- dla STL wymaga opcjonalnego `trimesh`.

Czyli jeśli gdzieś w innym kodzie preview/helper liczy bounds bez wcześniejszego `resolve_geometry_sources(...)`, to nadal można mieć bug.

### Ale ważne:
W publicznym kodzie, który dziś przejrzałem, **główne potwierdzone problemy** są gdzie indziej:
- loader/base model,
- stale UI,
- rewrite translacji,
- rewrite mesh first magnet,
- `Universe` tylko jako metadata,
- world extent = mesh bbox,
- axes = geom bbox.

To właśnie te problemy powinny iść dziś na pierwszą listę napraw.

---

## 15. Co dokładnie stanie się w Twoim lokalnym scenariuszu dwóch nanoflowerów

Tu przechodzę przez **hipotetyczny, ale bardzo prawdopodobny** przebieg dla lokalnego skryptu, który rzeczywiście tworzy dwa obiekty.

Założenie:
- lokalny `nanoflower_fem.py` tworzy dwa `ImportedGeometry("nanoflower.stl")`,
- pozycjonuje je translacją w osi X,
- oba mają FEM mesh,
- oba są częścią jednego skryptu.

### 15.1. Jeśli uruchamiasz czysty flat workspace bez stage’y
Wtedy architektura publicznego `master` sugeruje taki przebieg:

1. `fm.geometry(...)` wołane dwa razy → `_state._magnets` ma 2 wpisy  
2. `capture_workspace_problem()` zbuduje `Problem` z 2 magnesami  
3. `load_problem_from_script(...)` zwróci `entrypoint_kind="flat_workspace"`  
4. `export_builder_draft(...)` wyeksportuje 2 geometrie  
5. `ModelTree` umie je pokazać jako `2 bodies`

### Wniosek
Jeżeli w tym scenariuszu UI pokazuje **1 body**, to najbardziej podejrzane są:
- nie ten skrypt w aktywnym workspace,
- stara sesja,
- brak rehydratacji po zmianie pliku.

### 15.2. Jeśli przechodzisz przez builder sync / canonical rewrite
Wtedy włącza się ścieżka, która ma realne bugi:

- translacja może zostać zgubiona (`translate` vs `translation`),
- `scale` i `volume` mogą zostać zgubione,
- mesh workflow może zostać wyrenderowane tylko dla pierwszego body.

### Wniosek
Po sync możesz dostać skrypt, który **już nie jest wiernym odtworzeniem** Twojego lokalnego dwuobiektowego modelu.

### 15.3. Jeśli uruchamiasz solve na FEM
Planner FEM:
- prawdopodobnie przyjmie oba body,
- załaduje oba meshe,
- zmerguje je do jednego planu.

Ale:
- materiały muszą być zgodne,
- plan utraci jawną per-body tożsamość na poziomie `FemPlanIR`.

### 15.4. Jeśli liczysz na `Universe`, że obejmie oba body i pokaże pełną domenę
Tu obecny kod zawodzi najmocniej:

- `study.universe(...)` nie staje się `air_box_config`,
- solver domain nie wynika z tego jawnie,
- `worldExtent` w UI to bbox mesha,
- panel `Universe` i osie 3D działają na złej semantyce.

### Wniosek
Nawet jeśli solver policzy oba body, UI nadal może wyglądać tak, jakby „świat” kończył się na bboxie samej geometrii.

---

## 16. Konkretne poprawki — co zmienić w jakich plikach

Poniżej daję listę napraw w kolejności od najbardziej krytycznych do architektonicznych.

---

### FIX-01 — zachować `workspace_problem` w `LoadedProblem`
**Plik:** `packages/fullmag-py/src/fullmag/runtime/loader.py`

#### Problem
Loader odrzuca `workspace_problem`, gdy istnieją stage’e.

#### Naprawa
Dodać pole `workspace_problem` do `LoadedProblem` i zwracać je z loadera.

#### Dlaczego to jest ważne
Bez tego builder, rewrite i UI nie mają dostępu do prawdziwego modelu bazowego.

#### Priorytet
**P0**

---

### FIX-02 — builder draft i rewrite muszą bazować na modelu bazowym, nie `stage[0]`
**Pliki:**
- `packages/fullmag-py/src/fullmag/runtime/script_builder.py`

#### Miejsca do zmiany
1. `export_builder_draft(...)`
2. `render_loaded_problem_as_script(...)`

#### Problem
Oba miejsca używają:
- `loaded.stages[0].problem`
zamiast stabilnego problemu bazowego.

#### Naprawa
Po FIX-01:
- preferować `loaded.workspace_problem`,
- fallback do `loaded.problem`.

#### Priorytet
**P0**

---

### FIX-03 — naprawić utratę translacji w `_render_geometries_from_override(...)`
**Plik:** `packages/fullmag-py/src/fullmag/runtime/script_builder.py`

#### Problem
Eksport używa `translate`, renderer override szuka `translation`.

#### Naprawa
Obsłużyć oba klucze, ale kanonicznie trzymać `translate`.

#### Dodatkowo
Dodać test round-trip:
- `ImportedGeometry(...).translate((dx,0,0))`
- builder draft
- sync/canonical rewrite
- translacja musi przetrwać.

#### Priorytet
**P0**

---

### FIX-04 — override renderer musi zachować `scale` i `volume` dla `ImportedGeometry`
**Plik:** `packages/fullmag-py/src/fullmag/runtime/script_builder.py`

#### Problem
Override renderer odtwarza tylko:
- `source`
- `name`

gubiąc:
- `scale`
- `volume`

#### Naprawa
Odtwarzać te pola tak samo jak w `_render_geometry_expr(...)`.

#### Priorytet
**P0**

---

### FIX-05 — mesh workflow dla flat FEM musi objąć wszystkie body
**Plik:** `packages/fullmag-py/src/fullmag/runtime/script_builder.py`

#### Problem
`_render_mesh_workflow(...)` wybiera tylko:
```python
problem.magnets[0]
```

#### Naprawa
Iterować po wszystkich body.

#### Uwaga architektoniczna
To wymaga też decyzji, czy:
- flat IR ma wspierać tylko shared mesh,
- czy pełne per-geometry mesh.

#### Priorytet
**P0**

---

### FIX-06 — UI musi wykrywać zmianę zawartości skryptu, nie tylko ścieżki
**Plik:** `apps/web/components/runs/control-room/ControlRoomContext.tsx`

#### Problem
Hydration key ignoruje `source_hash`.

#### Naprawa
Włączyć do klucza:
- `problem_meta.source_hash`
- albo hash `scriptBuilder`

oraz dodać warning o mismatch.

#### Priorytet
**P0**

---

### FIX-07 — `Universe` musi zostać albo uczciwie zdegradowany do metadanych UI, albo naprawdę wejść do solvera
**Pliki:**
- `packages/fullmag-py/src/fullmag/world.py`
- `packages/fullmag-py/src/fullmag/model/problem.py`
- `crates/fullmag-plan/src/lib.rs`
- potencjalnie warstwa generacji mesha / geometry assets

#### Problem
`study.universe(...)` dziś nie kończy jako `FemPlanIR.air_box_config`.

#### Naprawa docelowa
Przepchnąć semantykę Universe do:
- planner IR,
- meshingu,
- solver domain / outer air box.

#### Minimalny krok
Jeśli jeszcze tego nie wspierasz wykonawczo, nie opisuj tego w UI jako:
- `FEM outer domain / air box source`

bo to dziś nie jest prawdą wykonawczą.

#### Priorytet
**P0 / P1**  
(P0 semantycznie; P1 jeśli wdrażasz pełny outer domain)

---

### FIX-08 — rozdzielić `meshExtent` od `worldExtent` / `UniverseExtent`
**Pliki:**
- `crates/fullmag-cli/src/formatting.rs`
- `apps/web/components/runs/control-room/ControlRoomContext.tsx`
- `apps/web/components/panels/settings/UniversePanel.tsx`

#### Problem
`world_extent` dla FEM to dziś bbox mesha.

#### Naprawa
W artefakcie i UI mieć osobno:
- `mesh_bounds_min`
- `mesh_bounds_max`
- `mesh_extent`
- `world_extent` / `universe_extent` (jeśli istnieje jako solver concept)

#### Priorytet
**P0**

---

### FIX-09 — `FemMeshView3D` musi rysować osie względem Universe / domain, nie samej geometrii
**Plik:** `apps/web/components/preview/FemMeshView3D.tsx`

#### Problem
`SceneAxes3D` dostaje `geomSize`.

#### Naprawa
Wprowadzić `previewWorldExtent`:
- `builderUniverse.size` jeśli jawne,
- inaczej solver domain,
- dopiero na końcu `geomSize`.

#### Priorytet
**P1**

---

### FIX-10 — `ModelTree` sekcja `Regions / Selections` musi przestać udawać single-domain
**Plik:** `apps/web/components/ModelTree.tsx`

#### Problem
Sekcja jest twardo:
- `Domain 1`
- `Boundary`

#### Naprawa
Budować regiony z realnych danych:
- builder manifest,
- solver plan,
- lub mesh body segments.

#### Priorytet
**P1**

---

### FIX-11 — rozszerzyć `FemPlanIR` o jawne segmenty per body
**Pliki:**
- `crates/fullmag-ir/src/lib.rs`
- `crates/fullmag-plan/src/lib.rs`

#### Problem
Po merge body nie ma trwałego ownership modelu.

#### Naprawa
Dodać np.:
- `body_segments`
- `element_body_ids`
- `body_table`

#### Priorytet
**P1 / P2**

---

### FIX-12 — uporządkować nazwy przykładów
**Plik:** `examples/nanoflower_fdm.py`

#### Problem
Nazwa przykładu sugeruje FDM, ale plik ustawia FEM.

#### Naprawa
Zmienić nazwę albo backend.

#### Priorytet
**P1**
To nie naprawia solvera, ale ogromnie poprawia diagnostykę i zmniejsza ryzyko błędnego supportu.

---

## 17. Testy regresyjne, które trzeba dopisać

To jest równie ważne jak same patche. Bez testów część bugów wróci bardzo szybko.

---

### TEST-01 — loader zachowuje bazowy workspace obok stage’y
**Warstwa:** Python runtime

#### Scenariusz
Skrypt:
- tworzy 2 geometrie,
- ustawia materiał,
- wywołuje `relax()` i `run()`.

#### Oczekiwanie
`LoadedProblem` ma:
- `workspace_problem` z 2 magnesami,
- `stages` niepuste,
- `problem` będący final stage.

---

### TEST-02 — builder draft dla sekwencji pokazuje model bazowy, nie relax-alpha
**Warstwa:** Python runtime / builder draft

#### Scenariusz
Skrypt:
- `alpha = 0.1`
- `relax()`
- `run()`

#### Oczekiwanie
Builder draft:
- pokazuje `alpha = 0.1` w geometrii/materiale,
- ale stage metadata nadal mówią o relax algorithm itp.

---

### TEST-03 — round-trip translacji dla dwóch body
**Warstwa:** script builder rewrite

#### Scenariusz
Dwa `ImportedGeometry("nanoflower.stl").translate(...)`

#### Oczekiwanie
Po builder draft → sync → canonical rewrite:
- oba body zachowują translacje,
- nie nakładają się.

---

### TEST-04 — round-trip `scale` i `volume` dla `ImportedGeometry`
**Warstwa:** script builder rewrite

#### Oczekiwanie
Po sync:
- nie gubimy `scale`,
- nie gubimy `volume`.

---

### TEST-05 — mesh workflow dla dwóch body
**Warstwa:** script builder rewrite

#### Scenariusz
Dwa magnesy z mesh workflow.

#### Oczekiwanie
W wygenerowanym skrypcie:
- oba mają odpowiednie `.mesh(...)`,
- oba mają `.mesh.build()` jeśli trzeba.

---

### TEST-06 — multi-body FEM planner zachowuje ownership metadata
**Warstwa:** planner / IR

#### Oczekiwanie
Plan FEM po merge:
- ma `body_segments` lub odpowiednik,
- frontend potrafi odróżnić obiekt A od B.

---

### TEST-07 — `UniversePanel` rozdziela declared universe od current mesh extent
**Warstwa:** frontend UI

#### Oczekiwanie
Przy:
- `declaredUniverse = 800 nm`
- `meshExtent = 330 nm`

panel pokazuje te liczby osobno i nie nazywa bboxa mesha „Universe”.

---

### TEST-08 — `FemMeshView3D` osie używają `Universe`
**Warstwa:** frontend 3D

#### Oczekiwanie
Jeśli `builderUniverse.size` istnieje, `SceneAxes3D` dostaje właśnie tę wartość, a nie `geomSize`.

---

### TEST-09 — zmiana zawartości skryptu przy tej samej ścieżce wymusza rehydratację
**Warstwa:** frontend state sync

#### Oczekiwanie
Gdy zmienia się `source_hash`, UI przeładowuje `scriptBuilderGeometries`.

---

### TEST-10 — `ModelTree` sekcja Regions odzwierciedla realną liczbę regionów/body
**Warstwa:** frontend UI

#### Oczekiwanie
Dla 2 body nie widzimy tylko `Domain 1`.

---

## 18. Kolejność wdrożenia — co robić najpierw

Jeśli chcesz to wdrażać sensownie, zrób to w tej kolejności.

### Etap 1 — usunąć najgroźniejsze fałszowanie modelu
1. FIX-01 `workspace_problem`
2. FIX-02 builder/rewrite z modelu bazowego
3. FIX-03 translacja
4. FIX-04 `scale` / `volume`
5. FIX-05 mesh workflow dla wszystkich body

**Cel etapu:**  
nie niszczyć modelu użytkownika przy sync / rewrite.

### Etap 2 — usunąć największe kłamstwa UI
6. FIX-06 source-hash hydration
7. FIX-08 meshExtent vs worldExtent
8. FIX-09 osie 3D
9. FIX-10 regions tree

**Cel etapu:**  
UI przestaje udawać, że bbox mesha = Universe.

### Etap 3 — domknąć solverową semantykę multi-body / universe
10. FIX-07 prawdziwe `Universe` w solverze
11. FIX-11 ownership metadata per body

**Cel etapu:**  
architektura staje się spójna end-to-end.

### Etap 4 — uporządkować DX / przykłady
12. FIX-12 nazwy przykładów

**Cel etapu:**  
zmniejszyć ryzyko błędnej diagnostyki w przyszłości.

---

## 19. Minimalny plan „na już”, jeśli chcesz szybko naprawić najboleśniejsze objawy

Jeśli celem jest szybka poprawa Twojego konkretnego problemu z dwoma nanoflowerami, to najkrótsza lista „must have” wygląda tak:

### Must-have 1
Napraw:
- `workspace_problem` w loaderze,
- `base_problem` w builder/rewrite.

### Must-have 2
Napraw:
- `translate` vs `translation`,
- `ImportedGeometry scale/volume` w override rewrite,
- mesh workflow tylko dla pierwszego magnesu.

### Must-have 3
Dodaj:
- `source_hash` do hydratacji UI,
- warning „workspace uses stale script version”.

### Must-have 4
Oddziel w UI:
- `Declared Universe`
- `Current Mesh Extent`

oraz ustaw osie 3D na `Universe`, nie na `geomSize`.

To już powinno dramatycznie poprawić zarówno:
- realną poprawność,
- jak i zgodność tego, co użytkownik widzi, z tym, co naprawdę jest w modelu.

---

## 20. Odpowiedź na Twoje pytanie w jednym akapicie

Jeżeli Twoja lokalna wersja `nanoflower_fem.py` rzeczywiście tworzy dwa nanoflowery, to najbardziej prawdopodobna bezpośrednia przyczyna „w UI widzę tylko jeden” nie leży w samym `fm.geometry(...)`, tylko w jednej z następujących rzeczy:

- aktywny workspace/UI był oparty na innym albo starszym skrypcie,
- frontend nie przehydratował się po zmianie zawartości pliku, bo nie używa `source_hash`,
- albo model przeszedł przez builder sync / canonical rewrite, który dziś ma realne bugi: potrafi zgubić translacje, `scale`, `volume`, a mesh workflow renderuje tylko dla pierwszego body.

A nawet jeśli poprawnie załadujesz oba obiekty do solvera FEM, to obecna semantyka `Universe`, `worldExtent` i osi 3D nadal nie jest poprawna: `Universe` nie przechodzi dziś wprost do solverowego `air_box_config`, a UI myli bbox mesha z rzeczywistą domeną/Universe.

---

## 21. Najważniejsze konkretne miejsca w kodzie do patchowania

### Python / runtime
- `packages/fullmag-py/src/fullmag/runtime/loader.py`
- `packages/fullmag-py/src/fullmag/runtime/script_builder.py`
- `packages/fullmag-py/src/fullmag/world.py`
- `packages/fullmag-py/src/fullmag/model/problem.py`

### Planner / IR
- `crates/fullmag-plan/src/lib.rs`
- `crates/fullmag-ir/src/lib.rs`

### Frontend / UI
- `apps/web/components/runs/control-room/ControlRoomContext.tsx`
- `apps/web/components/panels/settings/UniversePanel.tsx`
- `apps/web/components/preview/FemMeshView3D.tsx`
- `apps/web/components/ModelTree.tsx`

### Examples
- `examples/nanoflower_fem.py`
- `examples/nanoflower_fdm.py`

---

## 22. Rzeczy, których nie radzę robić

Żeby nie zmarnować czasu, nie polecam zaczynać od poniższych działań.

### Nie zaczynaj od kosmetyki paneli
Dopóki:
- loader nie zachowuje modelu bazowego,
- rewrite gubi translacje,
- mesh rewrite dotyczy tylko pierwszego obiektu,

to poprawianie samego wyglądu paneli nie rozwiąże problemu.

### Nie zakładaj, że `Universe` już działa solverowo
Obecny kod tego nie potwierdza.

### Nie zakładaj, że screenshot zawsze odpowiada aktualnemu plikowi
Przy obecnym nazewnictwie przykładów i braku source-hash-based hydratacji to zbyt ryzykowne założenie.

---

## 23. Finalna diagnoza

Moja finalna diagnoza brzmi tak:

1. **Na publicznym `master` nie analizujemy dziś tego samego `nanoflower_fem.py`, o którym piszesz lokalnie.**  
   Publiczny plik jest jednoobiektowy.

2. **Jeżeli lokalny plik rzeczywiście ma dwa nanoflowery, to obecny kod Fullmag nie jest całkowicie ślepy na multi-body.**  
   Loader, builder `geometries` i planner FEM mają już bazową obsługę wielu obiektów.

3. **Objaw „UI widzi tylko jeden” jest najbardziej spójny z problemem sesji/hydratacji/sync, a nie z totalnym brakiem wsparcia w parserze.**  
   Szczególnie podejrzane są:
   - zły/stary aktywny workspace,
   - brak hydratacji po zmianie treści pliku,
   - canonical rewrite po builder sync.

4. **Pod spodem jest jednak kilka bardzo realnych, potwierdzonych błędów, które sprawiają, że obsługa multi-body FEM nie jest dziś domknięta end-to-end.**  
   Najważniejsze z nich:
   - utrata `workspace_problem`,
   - `stage[0]` jako „kanoniczny model”,
   - utrata translacji,
   - utrata `scale` / `volume`,
   - mesh rewrite tylko dla pierwszego body,
   - `Universe` jako metadata zamiast solver semantics,
   - `worldExtent = mesh bbox`,
   - osie 3D = `geomSize`,
   - sekcja `Regions` nadal jedno-domenowa.

5. **Twoja uwaga o osiach 3D i `Universe` jest w pełni trafna.**  
   Obecny kod rzeczywiście nie reprezentuje poprawnie świata/domeny obejmującej cały układ dwóch geometrii; pokazuje raczej bbox mesha/obiektu.

---

## 24. Co zrobiłbym jako maintainer w pierwszym PR-ze

Gdybym miał przygotować pierwszy, najbardziej opłacalny PR, zrobiłbym dokładnie to:

1. zachować `workspace_problem` w loaderze,  
2. używać go w builder draft i canonical rewrite,  
3. naprawić `translate` vs `translation`,  
4. zachować `scale` i `volume` dla `ImportedGeometry`,  
5. renderować mesh workflow dla wszystkich body,  
6. dodać `source_hash` do hydratacji i warning o stale workspace,  
7. rozdzielić `meshExtent` od `UniverseExtent`,  
8. podpiąć osie 3D do `Universe`.

To dałoby najszybszą realną poprawę w Twoim przypadku.

---

## 25. Krótka checklista do lokalnego potwierdzenia na Twojej gałęzi

Jeśli chcesz to bardzo szybko potwierdzić u siebie, zanim zaczniesz patchować szerzej, zrób te 5 kroków.

### Krok 1 — sprawdź, co naprawdę widzi loader
W `loader.py` tymczasowo zaloguj:
- liczbę magnesów w `workspace_problem`,
- ich nazwy.

### Krok 2 — sprawdź, co naprawdę wysyła builder draft
W `export_builder_draft(...)` zaloguj:
- `len(base_problem.magnets)`
- `[m.name for m in base_problem.magnets]`

### Krok 3 — sprawdź, co faktycznie trzyma frontend
W `ControlRoomContext.tsx` po hydratacji zaloguj:
- `scriptBuilder.geometries.map(g => g.name)`

### Krok 4 — sprawdź canonical rewrite
Po `syncScript()` zrób diff pliku:
- czy oba body nadal istnieją,
- czy translacje zostały,
- czy oba mają `.mesh(...)`.

### Krok 5 — sprawdź, co UI nazywa `worldExtent`
W runtime state / devtools zobacz:
- `artifact_layout.world_extent`
- `scriptBuilder.universe.size`

Jeśli liczby się różnią, a panel `Universe` używa `worldExtent`, masz dokładnie potwierdzony problem semantyczny z tego raportu.

---

## 26. Końcowa rekomendacja

Nie traktowałbym tego jako „jeden bug”.  
To jest **łańcuch kilku rozjazdów** między warstwami:

- przykładami w repo,
- stanem lokalnej gałęzi,
- loaderem,
- builder draftem,
- canonical rewrite,
- plannerem FEM,
- semantyką `Universe`,
- oraz prezentacją w UI i 3D.

Największy błąd byłby teraz taki:
- naprawić tylko pierwszy objaw,
- i zostawić resztę niespójną.

Dla Twojego przypadku trzeba naprawić co najmniej:
- źródłowy model bazowy,
- rewrite translacji/mesh,
- hydratację UI,
- oraz semantykę `Universe`.

Dopiero wtedy Fullmag zacznie zachowywać się tak, jak użytkownik naturalnie oczekuje dla dwóch nanoflowerów w jednej przestrzeni.

---

## 27. Najkrótsza wersja diagnozy technicznej

**Bezpośredni problem użytkownika:**  
UI najpewniej nie ogląda tego samego dwuobiektowego skryptu, który Ty edytujesz lokalnie, albo ogląda jego zniekształconą wersję po builder-sync.

**Głębszy problem systemowy:**  
Fullmag ma już częściową obsługę multi-body FEM, ale nadal nie ma spójnego modelu:
- `source script` → `builder` → `rewrite` → `planner` → `Universe` → `3D view`.

**Najbardziej konkretne bugi do naprawy od razu:**  
`workspace_problem`, `stage[0]`, `translate` vs `translation`, `scale/volume`, first-magnet mesh rewrite, `source_hash` hydration, `worldExtent != Universe`, osie 3D.

