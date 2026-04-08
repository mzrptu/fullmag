# Audyt repozytorium `MateuszZelent/fullmag` — raport diagnostyczny i wdrożeniowy

Data audytu: 2026-04-08  
Gałąź: `master`  
Zakres: porównanie aktualnego stanu repozytorium z wcześniejszymi raportami diagnostycznymi oraz weryfikacja, czy wskazane wcześniej problemy zostały faktycznie naprawione.

## 1. Metoda weryfikacji

Audyt wykonałem w trzech warstwach:

1. **Porównanie z wcześniejszymi raportami**  
   Punktem odniesienia były wcześniejsze raporty opisujące problemy w pipeline FEM, w szczególności:
   - brak dowożenia `per-object hmax` do ścieżki preview / asset,
   - awaria `component-aware` shared meshing i degradacja do anonimowego concatenated STL,
   - utrata lokalnych refinementów po fallbacku,
   - brak `region_materials` dla wielu markerów przy jednorodnym materiale.

2. **Przegląd bieżącego kodu na `master`**  
   Przeanalizowane pliki:
   - `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py`
   - `packages/fullmag-py/src/fullmag/meshing/_mesh_targets.py`
   - `packages/fullmag-py/src/fullmag/meshing/_size_field_plan.py`
   - `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`
   - `packages/fullmag-py/src/fullmag/meshing/_gmsh_generators.py`
   - `packages/fullmag-py/src/fullmag/meshing/_gmsh_fields.py`
   - `packages/fullmag-py/src/fullmag/model/discretization.py`
   - `crates/fullmag-plan/src/fem.rs`
   - `crates/fullmag-plan/src/mesh.rs`
   - `crates/fullmag-ir/src/lib.rs`
   - `packages/fullmag-py/tests/test_meshing.py`
   - `crates/fullmag-plan/src/tests.rs`

3. **Izolowane sanity-checki uruchomione na pobranych plikach źródłowych**  
   Bez uruchamiania całego repo, ale z wykonaniem małych, lokalnych testów logicznych na modułach `_mesh_targets.py` i `_size_field_plan.py`, z użyciem stubów typów.  
   Dzięki temu zweryfikowałem nie tylko obecność kodu, ale także jego realne zachowanie dla kluczowych przypadków precedence.

### Ograniczenia audytu

Nie uruchamiałem pełnego:
- `cargo test --workspace`
- `python -m unittest discover -s packages/fullmag-py/tests -v`
- rzeczywistego meshowania Gmsh na pełnym scenariuszu 4 translacjonowanych STL-i

Wniosek: raport daje **mocną weryfikację kodową i architektoniczną**, ale nie jest równoważny pełnemu green run całego CI.

---

## 2. Werdykt końcowy

## Nie mogę potwierdzić, że „wszystko jest naprawione”.

Aktualny stan repo należy ocenić jako:

- **naprawione**: najważniejsze błędy z preview path, fallbackiem size fields, splitowaniem `gmsh_bridge.py` oraz `region_materials` dla multi-body FEM,
- **częściowo naprawione**: build reporting po stronie Pythona,
- **nadal otwarte / blokujące pełne zamknięcie tematu**:
  1. błędny precedence `recipe > workflow` w shared-domain target resolution,
  2. błędne wyliczanie `effective_hmax` w `ResolvedSharedDomainTargets`,
  3. rzeczywisty konflikt runtime field stack vs recipe field stack, gdy recipe chce być **grubsze** niż workflow,
  4. gubienie `per_domain_quality` podczas reorder / merge w `mesh.rs`,
  5. brak propagacji build report do IR / Rust planera,
  6. luki w testach regresyjnych.

### Status ogólny

| Obszar | Status |
|---|---|
| Preview/object mesh target resolution | **naprawione** |
| Fallback z component-aware do concatenated STL | **naprawione** |
| Bounds-based local sizing po fallbacku | **naprawione** |
| Split `gmsh_bridge.py` na submoduły | **naprawione** |
| `region_materials` dla wielu magnetyków | **naprawione** |
| Jednoznaczna shared-domain precedence `recipe > workflow` | **nienaprawione** |
| `effective_hmax` zgodne z resolved per-object targets | **nienaprawione** |
| Zachowanie `per_domain_quality` po reorder / merge | **nienaprawione** |
| Build report w IR / runnerze | **częściowo naprawione** |
| Testy dla nowych invariants | **częściowo naprawione** |

---

## 3. Co jest faktycznie naprawione

## 3.1. Preview / object asset path używa już resolved targetów

Wcześniej problem polegał na tym, że ścieżka materializacji mesh assetu obiektu potrafiła jechać po gołym `FEM.hmax`, zamiast po per-obiektowym targetcie.

W aktualnym `asset_pipeline.py`:
- `realize_fem_mesh_asset()` wywołuje `resolve_object_preview_target(...)`,
- a następnie przekazuje `target.hmax` i `target.order` do:
  - `generate_mesh_from_file(...)`,
  - `generate_mesh(...)`.

### Dowód w kodzie
- `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py:104-151`
- `packages/fullmag-py/src/fullmag/meshing/_mesh_targets.py:132-187`

### Sanity-check wykonany lokalnie
Dla przypadku:
- `FEM.hmax = 100 nm`
- `workflow.default_mesh = 80 nm`
- `workflow.per_geometry(left) = 50 nm`
- `recipe(left) = 20 nm`, `order = 2`

wynik był:

```json
{
  "hmax": 2e-08,
  "order": 2,
  "source": "recipe_override"
}
```

To znaczy: **preview path działa poprawnie** i respektuje `recipe` ponad workflow.

---

## 3.2. Fallback po awarii component-aware build rzeczywiście przebudowuje size fields

To była jedna z najważniejszych napraw.

W aktualnym `asset_pipeline.py`, po wyjątku podczas `generate_shared_domain_mesh_from_components(...)`:
- `build_mode` przechodzi na `"concatenated_stl_fallback"`,
- `fallbacks_triggered` dostaje `"component_aware_import_failed"`,
- mesh options są budowane ponownie z `component_aware=False`,
- recipe fields również są przebudowywane z `component_aware=False`,
- następnie pipeline przechodzi przez `generate_mesh_from_file(...)` na połączonym STL.

### Dowód w kodzie
- `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py:1079-1124`

### Znaczenie
To jest realna naprawa. Fallback nie próbuje już używać pól zależnych od recovered component tags w sytuacji, gdy tej tożsamości nie udało się odzyskać.

---

## 3.3. Bounds-based fallback ma wsparcie po stronie field backendu

W `_gmsh_fields.py` istnieją dziś osobne ścieżki dla:
- `ComponentVolumeConstant`,
- `InterfaceShellThreshold`,
- `TransitionShellThreshold`,
- `BoundsSurfaceThreshold`.

Dodatkowo moduł emituje ostrzeżenia dla brakujących recovered surfaces / volumes i ma osobną logikę bounds-based matching.

### Dowód w kodzie
- `packages/fullmag-py/src/fullmag/meshing/_gmsh_fields.py:298-367`
- `packages/fullmag-py/src/fullmag/meshing/_gmsh_fields.py:386-491`

### Znaczenie
To potwierdza, że fallback został naprawiony nie tylko w orkiestracji, ale też ma osobny backend dla fields.

---

## 3.4. `gmsh_bridge.py` został odchudzony i rozbity na submoduły

Wcześniej rekomendacja była jasna: przestać trzymać wszystko w jednym monolicie.

Aktualny `gmsh_bridge.py` jest cienką warstwą re-exportu, która deleguje do:
- `._gmsh_types`
- `._gmsh_infra`
- `._gmsh_extraction`
- `._gmsh_fields`
- `._gmsh_airbox`
- `._gmsh_generators`
- `._gmsh_remesh`

### Dowód w kodzie
- `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py:1-106`

### Znaczenie
To jest rzeczywista poprawa strukturalna. Nie wszystko jest idealne, ale najgorszy monolit został przynajmniej rozkrojony na logiczne warstwy.

---

## 3.5. Planner Rustowy emituje już `region_materials` dla wielu magnetyków

W `crates/fullmag-plan/src/fem.rs` jest teraz jawna logika:

```rust
let needs_region_materials =
    has_heterogeneous_materials || magnet_entries.len() > 1;
```

To jest dokładnie ta poprawka, której brakowało w scenariuszu:
- wiele magnetycznych regionów,
- ten sam materiał,
- kilka niezerowych markerów.

### Dowód w kodzie
- `crates/fullmag-plan/src/fem.rs:595-603`
- `crates/fullmag-plan/src/fem.rs:126-138`

### Znaczenie
Ta część została naprawiona poprawnie.

---

## 4. Co nadal NIE jest domknięte

## 4.1. Shared-domain target resolution ma nadal błąd precedence `recipe > workflow`

To jest obecnie **najważniejszy otwarty problem logiczny**.

W `_mesh_targets.py` deklarowany jest precedence:

1. `PerObjectMeshRecipe.hmax`
2. `mesh_workflow.per_geometry[hmax]`
3. `mesh_workflow.default_mesh[hmax]`
4. `FEM.hmax`

Ale w funkcji `_resolve_requested_partition_hmaxs(...)` implementacja wygląda inaczej:
- workflow override trafia do `override_by_name` przez `setdefault(...)`,
- recipe override też trafia przez `setdefault(...)`.

To znaczy:
- jeśli workflow wpisał już wartość dla geometrii,
- to recipe **nie nadpisze** workflow,
- mimo że kod później oznacza źródło jako `"recipe_override"`.

### Dowód w kodzie
- `packages/fullmag-py/src/fullmag/meshing/_mesh_targets.py:223-247`
- szczególnie:
  - `override_by_name.setdefault(alias, override_hmax)` dla workflow,
  - `override_by_name.setdefault(alias, float(recipe.hmax))` dla recipe.

### Sanity-check wykonany lokalnie

Dla przypadku:
- `workflow(left) = 50 nm`
- `recipe(left) = 20 nm`

wynik `resolve_shared_domain_targets(...)` był:

```json
{
  "reported_source": "recipe_override",
  "resolved_hmax": 5e-08,
  "expected_recipe_hmax": 2e-08
}
```

Czyli:
- **source mówi „recipe_override”**,
- ale faktyczny `resolved_hmax` to **50 nm z workflow**, a nie 20 nm z recipe.

### Wniosek
Ta część **nie jest naprawiona**.  
To jest błąd nie tylko kosmetyczny, ale semantyczny: raport i logika rozstrzygnięcia wzajemnie sobie przeczą.

---

## 4.2. `effective_hmax` w `ResolvedSharedDomainTargets` jest wyliczane błędnie

Komentarz w `_mesh_targets.py` mówi, że `effective_hmax` powinno być maksimum z:
- `FEM.hmax`
- `airbox_hmax`
- per-object hmax / VIn

Natomiast implementacja robi tylko:

```python
all_hmaxs = [float(hints.hmax)]
if requested_airbox_hmax is not None:
    all_hmaxs.append(requested_airbox_hmax)
effective_hmax = max(all_hmaxs)
```

Per-object resolved hmax **nie są dodawane**.

### Dowód w kodzie
- `packages/fullmag-py/src/fullmag/meshing/_mesh_targets.py:336-346`

### Sanity-check wykonany lokalnie

Dla przypadku:
- `FEM.hmax = 100 nm`
- `workflow(left) = 200 nm`

wynik był:

```json
{
  "per_object_hmax": 2e-07,
  "effective_hmax": 1e-07,
  "expected_effective_hmax": 2e-07
}
```

### Wniosek
Jeżeli ktoś użyje `ResolvedSharedDomainTargets.effective_hmax` jako źródła prawdy, dostanie zły wynik.  
Obecnie `asset_pipeline.py` obchodzi to ręcznie, skanując `size_fields`, ale sam moduł `_mesh_targets.py` nadal ma niespójny kontrakt.

---

## 4.3. Realny field-plan nadal nie realizuje poprawnego precedence dla recipe vs workflow

To jest druga warstwa tego samego problemu, ale już po stronie faktycznego budowania pól.

W `asset_pipeline.py`:
- najpierw budowane są pola z runtime metadata,
- potem `recipe_fields` są po prostu **doklejane z przodu** listy `size_fields`.

W `_size_field_plan.py`:
- runtime path generuje np. `Box + interface + transition`,
- recipe path generuje dodatkowe `Box` dla tego samego obiektu.

To działa tylko wtedy, gdy recipe jest **drobniejsze** niż workflow.  
Jeśli recipe chce być **grubsze** niż workflow, to oba pola współistnieją, a Gmsh bierze minimum z background fields, więc wygrywa nadal drobniejsze workflow.

### Dowód w kodzie
- `packages/fullmag-py/src/fullmag/meshing/_size_field_plan.py:411-471`
- `packages/fullmag-py/src/fullmag/meshing/_size_field_plan.py:481-526`
- `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py:826-843`
- `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py:1089-1108`

### Sanity-check wykonany lokalnie

Dla przypadku:
- workflow field: `20 nm`
- recipe field: `50 nm`

wygenerowane pola były:

```json
{
  "runtime_field_vin": 2e-08,
  "recipe_field_vin": 5e-08,
  "runtime_field_kinds": ["Box", "BoundsSurfaceThreshold", "BoundsSurfaceThreshold"],
  "recipe_field_kinds": ["Box"]
}
```

### Wniosek
Czyli w praktyce:
- workflow dokłada drobniejszy field,
- recipe dokłada grubszy field,
- oba istnieją naraz,
- tło meshera bierze minimum,
- więc recipe **nie może skutecznie poluzować meshu**.

To znaczy: nawet po refaktorze precedence nadal nie jest zamknięte „end-to-end”.

---

## 4.4. `per_domain_quality` nadal ginie podczas reorder / merge w Rustowym `mesh.rs`

To był punkt z planu refaktoryzacji, który nadal nie został wdrożony.

W `MeshIR` istnieje pole:
- `per_domain_quality: HashMap<u32, MeshQualityIR>`

Ale w `mesh.rs` podczas:
- reorder shared-domain meshu,
- merge multibody meshy,

tworzone są nowe `MeshIR` z:

```rust
per_domain_quality: Default::default(),
```

### Dowód w kodzie
- `crates/fullmag-plan/src/mesh.rs:560-569`
- `crates/fullmag-plan/src/mesh.rs:1124-1133`
- definicja pola w IR:
  - `crates/fullmag-ir/src/lib.rs:1037-1050`

### Wniosek
Ta jakość jest po prostu tracona.  
Jeżeli downstream miałby na niej polegać diagnostycznie, to dziś dostaje pusty wynik po reorder / merge.

To jest realne niedomknięcie.

---

## 4.5. Build report istnieje po stronie Pythona, ale nie został doprowadzony do IR

`SharedDomainBuildReport` istnieje i jest sensownym typem w:
- `asset_pipeline.py`
- `_mesh_targets.py`

Ale nie widać jego odpowiednika w `fullmag-ir`.

`FemDomainMeshAssetIR` nadal ma tylko:
- `mesh_source`
- `mesh`
- `region_markers`

i nie ma:
- `build_mode`
- `fallbacks_triggered`
- `effective_airbox_target`
- `effective_per_object_targets`
- `used_size_field_kinds`
- `degraded`

### Dowód w kodzie
- Python:
  - `packages/fullmag-py/src/fullmag/meshing/_mesh_targets.py:355-387`
  - `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py:648-692`
  - `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py:1267-1279`
- IR:
  - `crates/fullmag-ir/src/lib.rs:1243-1249`

Dodatkowo wyszukiwanie po polach reportu w `lib.rs` daje 0 trafień dla:
- `build_mode`
- `fallbacks_triggered`
- `effective_airbox_target`
- `effective_per_object_targets`
- `used_size_field_kinds`

### Wniosek
Build report jest obecnie:
- dobry jako telemetry / event po stronie Pythona,
- ale **nie jest jeszcze elementem kontraktu IR**,
- więc planner / runner go nie dziedziczy.

To jest stan **częściowo naprawiony**, nie zamknięty.

---

## 4.6. Brakuje kilku ważnych testów regresyjnych

### Co jest obecne
W `packages/fullmag-py/tests/test_meshing.py` są testy potwierdzające:
- `shared_domain_local_size_fields` dla `per_geometry hmax`,
- component-aware field stack,
- fallback do bounds-based fields,
- brak `ComponentVolumeConstant` po fallbacku,
- obecność `Box` po fallbacku.

### Dowód w kodzie
- `packages/fullmag-py/tests/test_meshing.py:404-455`
- `packages/fullmag-py/tests/test_meshing.py:1360-1407`

### Czego nadal brakuje
1. **Python**
   - testu dla `resolve_object_preview_target()` z precedence:
     - `recipe > per_geometry > default_mesh > FEM`
   - testu dla `resolve_shared_domain_targets()` z tym samym precedence
   - testu dla przypadku, gdy `recipe` chce być **grubsze** niż workflow
   - testu dla `effective_hmax` w `ResolvedSharedDomainTargets`

2. **Rust**
   - testu dla **homogeneous multi-body** z `region_materials`
   - testu dla zachowania `per_domain_quality` po reorder
   - testu dla zachowania `per_domain_quality` po merge

### Ważna obserwacja
W `crates/fullmag-plan/src/tests.rs` jest test tylko dla przypadku:
- **heterogeneous materials** -> `region_materials` na CUDA

Nie ma testu dla:
- **wielu magnetyków o tym samym materiale**, czyli dokładnie dla scenariusza, który był wcześniej problematyczny.

### Dowód w kodzie
- `crates/fullmag-plan/src/tests.rs:1357-1459`

### Wniosek
Naprawa jest w kodzie, ale coverage nadal nie zamyka najważniejszego wcześniejszego regresu.

---

## 5. Pliki i ocena szczegółowa

## `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py`
**Ocena: poprawione częściowo, ale nadal z istotnym długiem integracyjnym**

### Dobre zmiany
- preview path korzysta z resolved targetów,
- fallback przebudowuje fields do trybu `component_aware=False`,
- build report istnieje,
- jest publiczna funkcja `realize_fem_domain_mesh_asset_from_components_with_report(...)`.

### Problemy
- asset pipeline nadal skleja runtime fields i recipe fields addytywnie,
- przez to nie zamyka precedence end-to-end,
- build report nie jest wynoszony do IR.

---

## `packages/fullmag-py/src/fullmag/meshing/_mesh_targets.py`
**Ocena: dobry kierunek architektoniczny, ale logicznie jeszcze niedomknięty**

### Dobre zmiany
- wyciągnięcie target resolution do osobnego modułu,
- jawne dataclasses dla resolved targetów,
- jawne `SharedDomainBuildReport`.

### Problemy
- recipe override nie nadpisuje workflow override w shared-domain path,
- `effective_hmax` nie bierze per-object hmax.

---

## `packages/fullmag-py/src/fullmag/meshing/_size_field_plan.py`
**Ocena: dobrze wydzielone, ale precedence nie jest jeszcze semantycznie zamknięte**

### Dobre zmiany
- bulk / interface / transition / manual hotspot są odseparowane,
- jest podział na path component-aware i bounds fallback.

### Problemy
- recipe i runtime fields są generowane osobno, bez finalnego pojedynczego resolved override per geometry,
- to powoduje konflikt przy recipe „grubszym” niż workflow.

---

## `packages/fullmag-py/src/fullmag/meshing/gmsh_bridge.py`
**Ocena: naprawione strukturalnie**

To już nie jest dawny monolit.  
Façade jest cienki, odpowiedzialności są porozkładane na submoduły.

---

## `crates/fullmag-plan/src/fem.rs`
**Ocena: naprawiono `region_materials`, ale test coverage jest za słabe**

### Dobre zmiany
- `region_materials` są emitowane dla `magnet_entries.len() > 1`.

### Problemy
- brak regresyjnego testu dla homogeneous multi-body,
- build report z Pythona nie dochodzi do planera.

---

## `crates/fullmag-plan/src/mesh.rs`
**Ocena: nadal otwarty problem jakości diagnostycznej**

### Problem
- `per_domain_quality` jest zerowane do pustego `HashMap`.

To jest niedomknięty punkt z warstwy diagnostycznej i jakościowej.

---

## `crates/fullmag-ir/src/lib.rs`
**Ocena: IR nie zostało jeszcze rozszerzone o build report**

To jest główna luka między nowym Pythonowym reportingiem a Rustowym kontraktem.

---

## 6. Rekomendowany plan wdrożenia poprawek

## Etap A — blokery przed uznaniem tematu za zamknięty

### A1. Naprawić precedence `recipe > workflow` w shared-domain target resolution
**Plik:** `packages/fullmag-py/src/fullmag/meshing/_mesh_targets.py`

### Zmiana
W `_resolve_requested_partition_hmaxs(...)`:
- workflow może nadal używać `setdefault(...)`,
- ale recipe powinno używać **nadpisania**:
  - `override_by_name[alias] = float(recipe.hmax)`

### Efekt
Recipe stanie się rzeczywiście najwyższym priorytetem.

---

### A2. Naprawić `effective_hmax`
**Plik:** `packages/fullmag-py/src/fullmag/meshing/_mesh_targets.py`

### Zmiana
Zamiast:
```python
all_hmaxs = [float(hints.hmax)]
if requested_airbox_hmax is not None:
    all_hmaxs.append(requested_airbox_hmax)
effective_hmax = max(all_hmaxs)
```

powinno być logicznie:
```python
all_hmaxs = [float(hints.hmax)]
if requested_airbox_hmax is not None:
    all_hmaxs.append(float(requested_airbox_hmax))
for value in requested_hmax_by_geometry.values():
    if value is not None:
        all_hmaxs.append(float(value))
effective_hmax = max(all_hmaxs)
```

### Efekt
Resolved target będzie zgodny z własnym komentarzem i faktyczną semantyką.

---

### A3. Zamknąć precedence także w field-planie
**Pliki:**
- `packages/fullmag-py/src/fullmag/meshing/_size_field_plan.py`
- `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py`

### Zmiana
Nie doklejać `recipe_fields + existing`, tylko:
- najpierw wyliczyć **jeden resolved override per geometry**,
- dopiero potem zbudować **jedną finalną trójkę**:
  - bulk
  - interface
  - transition

### Minimalny wariant naprawy
Przed dołożeniem recipe fields:
- usunąć runtime fields dla geometrii, które recipe nadpisuje.

### Lepszy wariant
Dodać helper typu:
- `_resolve_effective_per_geometry_mesh_policy(...)`
- i dopiero z niego budować fields.

### Efekt
Recipe będzie mogło zarówno:
- **zaostrzać** mesh,
- jak i **rozluźniać** mesh,
bez konfliktu z wcześniejszym workflow field stack.

---

### A4. Zachować `per_domain_quality` po reorder / merge
**Plik:** `crates/fullmag-plan/src/mesh.rs`

### Zmiana
Dodać jedną z dwóch ścieżek:
1. remap mapy jakości po markerze,
2. albo recompute / copy, jeśli marker topology pozostaje równoważna.

### Minimalny wariant
Nie wpisywać `Default::default()`, tylko przynajmniej:
- przenieść starą mapę, jeśli znaczenie markerów się nie zmienia,
- albo zbudować nową mapę po reorder.

### Efekt
Diagnostyka jakości meshu nie będzie znikać w dalszych etapach pipeline’u.

---

## Etap B — domknięcie kontraktu diagnostycznego

### B1. Dodać build report do IR
**Pliki:**
- `crates/fullmag-ir/src/lib.rs`
- `packages/fullmag-py/src/fullmag/meshing/_mesh_targets.py`
- `packages/fullmag-py/src/fullmag/meshing/asset_pipeline.py`

### Zmiana
Rozszerzyć `FemDomainMeshAssetIR` o opcjonalne pole:
- `build_report: Option<FemSharedDomainBuildReportIR>`

Nowe pola:
- `build_mode`
- `fallbacks_triggered`
- `effective_airbox_target`
- `effective_per_object_targets`
- `used_size_field_kinds`
- `degraded`

### Efekt
Planner i runner przestaną tracić informację o tym, jak mesh został zbudowany.

---

### B2. Dodać `degraded: bool`
**Pliki:**
- Python report typ
- IR
- event summary

### Reguła
`degraded = True`, gdy:
- wszedł fallback,
- albo size fields musiały zostać uproszczone,
- albo component identity nie została zachowana.

### Efekt
UI / runner może odróżnić:
- „mesh gotowy i pełnowartościowy”
od
- „mesh gotowy, ale po degradacji ścieżki”.

---

## Etap C — testy, które muszą wejść przed zamknięciem

## Python (`packages/fullmag-py/tests/test_meshing.py`)
Dodać testy:

1. `test_resolve_object_preview_target_recipe_beats_workflow`
2. `test_resolve_shared_domain_targets_recipe_beats_workflow`
3. `test_resolve_shared_domain_targets_effective_hmax_includes_per_object_coarser_override`
4. `test_recipe_can_coarsen_workflow_field_stack_for_same_geometry`
5. `test_build_report_marks_degraded_when_component_aware_fails`

## Rust (`crates/fullmag-plan/src/tests.rs`)
Dodać testy:

1. `fem_plan_homogeneous_multi_body_populates_region_materials`
2. `reorder_shared_domain_mesh_preserves_per_domain_quality`
3. `merge_multibody_mesh_preserves_per_domain_quality`
4. `fem_domain_mesh_asset_accepts_optional_build_report`

---

## 7. Checklist wdrożeniowy przed oznaczeniem tematu jako zamkniętego

## Krok 1. Patch logiczny
Wdrożyć poprawki A1-A4.

## Krok 2. Patch diagnostyczny
Wdrożyć B1-B2.

## Krok 3. Patch testowy
Wdrożyć komplet testów z etapu C.

## Krok 4. Uruchomienie walidacji repo
Uruchomić zgodnie z README:

```bash
cargo check --workspace
cargo test --workspace
pip install -e 'packages/fullmag-py[meshing]'
PYTHONPATH=packages/fullmag-py/src python -m unittest discover -s packages/fullmag-py/tests -v
python scripts/check_repo_consistency.py
python scripts/run_python_ir_smoke.py --cli target/debug/fullmag
```

## Krok 5. Scenariusz akceptacyjny obowiązkowy
Przeprowadzić end-to-end test na:
- 4 identycznych STL-ach po translacji,
- wspólnym airboxie,
- jednorodnym materiale,
- `recipe` i `workflow` ustawionych sprzecznie dla jednego obiektu.

### Kryteria akceptacji
- preview asset używa resolved recipe target,
- shared-domain target naprawdę respektuje `recipe > workflow`,
- recipe może zarówno zaostrzać, jak i rozluźniać mesh,
- fallback bounds-based działa bez component fields,
- `region_materials` są obecne dla wielu markerów przy jednym materiale,
- `per_domain_quality` nie znika po reorder / merge,
- build report dochodzi do IR i oznacza degradację, jeśli była.

---

## 8. Ostateczna rekomendacja

Na dziś repozytorium **nie powinno być komunikowane jako „w pełni naprawione”** w obszarze FEM mesh pipeline.

Prawidłowa ocena stanu jest taka:

- **duża część kluczowych napraw została wdrożona**,
- architektura jest wyraźnie lepsza niż wcześniej,
- ale są jeszcze **co najmniej dwa błędy logiczne i dwa niedomknięcia diagnostyczne**, które uniemożliwiają uznanie sprawy za zamkniętą.

### Uczciwy status
**Partial remediation completed. Final closure requires one follow-up patch set.**

---

## 9. Krótkie podsumowanie dla decyzji release / merge

### Można uznać za naprawione
- preview path,
- fallback na bounds-based fields,
- split `gmsh_bridge`,
- `region_materials` dla multi-body.

### Nie można jeszcze uznać za naprawione
- shared-domain precedence `recipe > workflow`,
- `effective_hmax` w resolved shared targets,
- zachowanie `per_domain_quality`,
- pełny report diagnostyczny w IR.

### Decyzja
**Nie zamykać tematu jako „done”.**  
Zamknąć dopiero po jednym dodatkowym PR-ze logiczno-diagnostycznym i zielonym przebiegu testów.
