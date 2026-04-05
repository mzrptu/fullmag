# Fullmag – bardzo szczegółowy plan wdrożenia predefined magnetic textures i geometry presets per plik

## 1. Najważniejsza zasada

Nie buduj nowego równoległego systemu „texture presets”.
Domknij to, co już masz:
- `magnetization_assets`
- `magnetization_ref`
- `mapping`
- `texture_transform`

## 2. Backend / authoring / script

### A. `crates/fullmag-authoring/src/scene.rs`
## Co zostaje
- `SceneObject.magnetization_ref`
- `SceneDocument.magnetization_assets`
- `MagnetizationAsset.mapping`
- `MagnetizationAsset.texture_transform`

## Co poprawić
1. Ustandaryzować `MagnetizationAsset.kind`
   - `uniform`
   - `random_seeded`
   - `sampled_field`
   - `preset_texture`

2. Dla `preset_texture`:
   - `value.preset_kind`
   - `value.params`
   - `value.preview_proxy`
   - `value.version`

3. Dodać opcjonalnie:
   - `ui_label`
   - `instance_source_id`
   - `locked_to_object_transform`

## Dlaczego
Masz już dobry nośnik danych. Brakuje typed convention, nie nowego systemu.

---

### B. `packages/fullmag-py/src/fullmag/init/magnetization.py`
## Co jest dziś
- `UniformMagnetization`
- `RandomMagnetization`
- `SampledMagnetization`
- `uniform()`
- `random()`
- `from_function()` deferred

## Co zrobić
1. Nie psuć obecnego API
2. Dodać import nowych presetów z osobnego pliku
3. Zostawić `uniform/random` jako backward-compatible aliasy

---

### C. `packages/fullmag-py/src/fullmag/init/textures.py` **(nowy plik)**
## Co ma zawierać
1. `TextureTransform3D`
2. `TextureMapping`
3. `PresetTexture`
4. Preset factories:
   - `uniform`
   - `random_seeded`
   - `vortex`
   - `antivortex`
   - `bloch_skyrmion`
   - `neel_skyrmion`
   - `two_domain`
   - `domain_wall`
   - `helical`
   - `conical`

## Metody transformacji
- `translate(x, y, z)`
- `rotate_x(rad)`
- `rotate_y(rad)`
- `rotate_z(rad)`
- `rotate_x_deg(deg)`
- `rotate_y_deg(deg)`
- `rotate_z_deg(deg)`
- `scale(sx, sy, sz)`
- `with_mapping(space="object", projection="object_local", clamp_mode="clamp")`
- `copy()`

## Ważne
`to_ir()` ma zwracać analityczny preset, nie sampled field.

---

### D. `packages/fullmag-py/src/fullmag/init/preset_eval.py` **(nowy plik)**
## Co ma zawierać
Wspólny evaluator presetów:

```python
evaluate_preset_texture(spec, points)
```

## Obsługiwane wzory
1. `uniform`
2. `vortex`
3. `antivortex`
4. `bloch_skyrmion`
5. `neel_skyrmion`
6. `domain_wall`
7. `two_domain`
8. `helical`
9. `conical`

## Dlaczego osobny plik
Nie mieszaj DSL i runtime evaluatorów w jednym module.

---

### E. `packages/fullmag-py/src/fullmag/__init__.py`
## Co dodać
1. export namespace `texture`
2. export klasy presetów

## Cel
Żeby użytkownik pisał:
```python
fm.texture.neel_skyrmion(...)
```

---

### F. `packages/fullmag-py/src/fullmag/world.py`
## Co poprawić
1. `MagnetHandle.m` musi akceptować nowy `PresetTexture`
2. Canonical script generation musi umieć serializować preset + transform
3. `StudyBuilder` powinien mieć helper:
   - `assign_texture(object_or_name, texture, copy=False)`

## Dodatkowo
Jeżeli masz path eksportu canonical script, to on musi generować:
```python
body.m = fm.texture.neel_skyrmion(...).translate(...).rotate_z_deg(...)
```

---

### G. `packages/fullmag-py/src/fullmag/model/problem.py`
## Co poprawić
1. Lowering initial magnetization do ProblemIR:
   - `uniform`
   - `random_seeded`
   - `sampled_field`
   - `preset_texture`

2. Nie próbować od razu sample’ować texture preset podczas zwykłego authoringu
3. Tylko przenieść analityczny opis dalej

---

### H. `crates/fullmag-ir/src/lib.rs` **(lub odpowiadający model IR)**
## Co dodać
Typed IR dla initial magnetization:
- `Uniform`
- `RandomSeeded`
- `SampledField`
- `PresetTexture`

dla `PresetTexture`:
- `preset_kind`
- `params`
- `mapping`
- `texture_transform`

## Cel
To musi być first-class IR, nie losowe `serde_json::Value` bez kontraktu.

---

### I. `packages/fullmag-py/src/fullmag/runtime/initial_state.py` **(nowy plik)**
## Co ma robić
1. Przygotować sample points dla solvera
2. Dla FDM:
   - centra komórek
3. Dla FEM:
   - węzły / magnetic sample points
4. Wywołać `preset_eval.evaluate_preset_texture`
5. Zwrócić znormalizowane wektory m0

## Cache
Klucz cache:
- object_id
- preset hash
- transform hash
- mapping hash
- topology hash / mesh hash

---

## 3. Frontend / UI / preview

### J. `apps/web/lib/magnetizationPresetCatalog.ts` **(nowy plik)**
## Co ma zawierać
Katalog presetów dla UI:
- kind
- label
- icon
- category
- default params
- param schema
- preview proxy kind
- supports 2D/3D
- recommended projection

---

### K. `apps/web/lib/geometryPresetCatalog.ts` **(nowy plik)**
## Co ma zawierać
Katalog presetów geometrii:
- box
- sphere
- cylinder
- cone
- ellipsoid
- torus/ring
- imported geometry wrapper

---

### L. `apps/web/lib/textureTransform.ts` **(nowy plik)**
## Co ma zawierać
1. typ `TextureTransform3D`
2. helpery:
   - clone
   - compose
   - inverse
   - apply to point
   - quaternion helpers
   - fit texture to bounds
   - reset transform

---

### M. `apps/web/components/panels/MagneticTextureLibraryPanel.tsx` **(nowy plik)**
## Widok
- kafelki presetów
- kategorie
- wyszukiwarka
- `Assign`
- `Assign as instance`
- `Assign as unique copy`

## Prawy panel parametrów
- preset params
- mapping
- transform numeric controls
- buttons:
  - Center in object
  - Fit to object
  - Reset transform

---

### N. `apps/web/components/panels/GeometryPresetLibraryPanel.tsx` **(nowy plik)**
## Cel
To samo UX dla geometrii:
- create primitive
- edit primitive params
- insert into scene
- apply transform gizmo

---

### O. `apps/web/components/preview/TextureTransformGizmo.tsx` **(nowy plik)**
## Funkcja
Wspólny gizmo dla texture transform:
- translate
- rotate
- scale

## Ważne
To nie może być to samo co geometry gizmo bez trybu.
Musi mieć props:
- `mode`
- `transform`
- `space`
- `onChange`
- `onCommit`

---

### P. `apps/web/components/preview/GeometryTransformGizmo.tsx` **(nowy plik albo refaktor istniejącego path)**
## Cel
Unifikacja transformu geometrii:
- BoundsPreview3D
- MagnetizationView3D
- future FEM builder preview

---

### Q. `apps/web/components/preview/BoundsPreview3D.tsx`
## Co poprawić
1. Zastąpić lokalne użycie `PivotControls` przez wspólny transform gizmo
2. Dodać:
   - rotate
   - scale
   - local/world mode
3. Utrzymać callback commit do buildera

---

### R. `apps/web/components/preview/MagnetizationView3D.tsx`
## Co poprawić
1. Dodać texture gizmo overlay
2. Dodać surface preview wybranej tekstury
3. Dodać tryb:
   - select object
   - edit geometry
   - edit texture
4. Dodać gizmo proxy dla texture local frame

---

### S. `apps/web/components/preview/FemMeshView3D.tsx`
## Co poprawić
1. Dodać texture preview na wybranym obiekcie FEM
2. Dodać spójny selection state:
   - selected object
   - selected magnetization asset
   - active gizmo scope
3. Dodać opcjonalny slice preview dla texture na mesh part

---

### T. `apps/web/components/preview/HslSphere.tsx`
## Co poprawić
1. Umożliwić powiązanie z texture-edit mode
2. Pokazywać orientację tak samo dla preview texture jak dla live result

---

### U. `apps/web/components/panels/ModelTree.tsx` **(lub odpowiedni tree component)**
## Co dodać
Pod każdym obiektem:
- Geometry
  - Transform
- Magnetization
  - Texture
  - Transform
  - Preview

Opcjonalnie osobny root:
- Texture Assets
- Geometry Presets

---

### V. `apps/web/lib/session/types.ts`
## Co dodać
1. `selected_magnetization_asset_id`
2. `active_transform_scope: "geometry" | "texture"`
3. `texture_preview_state`
4. `texture_gizmo_mode`
5. `texture_transform_space`

---

## 4. Integracja solverowa

### W. FDM path
- sample na centrach komórek
- apply active mask
- object local mapping per object

### X. FEM path
- sample tylko w magnetic parts
- wykorzystać region markers / object parts
- nie sample’ować w airboxie
- przy shared-domain FEM texture ma być logicznie per obiekt, nie per cała domena

---

## 5. Testy

### Python tests
- `test_texture_ir.py`
- `test_texture_transform.py`
- `test_texture_eval.py`
- `test_texture_fdm_sampling.py`
- `test_texture_fem_sampling.py`

### Frontend tests
- assign preset to selected object
- switch instance/copy
- gizmo updates transform
- geometry mode vs texture mode
- HSL sphere shows in texture edit mode

### Acceptance
1. skyrmion preset daje poprawny preview
2. translate texture przesuwa skyrmion w obrębie obiektu
3. rotate texture obraca domain wall / helical pattern
4. geometry transform nie rusza texture transform i odwrotnie
5. FDM i FEM mają zgodny początek dla tego samego obiektu

## 6. Kolejność commitów

### Commit 1
- `textures.py`
- `preset_eval.py`
- `__init__.py`
- `world.py`

### Commit 2
- IR + lowering + runtime evaluator

### Commit 3
- `magnetizationPresetCatalog.ts`
- `textureTransform.ts`
- `MagneticTextureLibraryPanel.tsx`

### Commit 4
- `TextureTransformGizmo.tsx`
- refaktor `BoundsPreview3D.tsx`
- refaktor `MagnetizationView3D.tsx`

### Commit 5
- FEM preview integration
- selection state
- model tree nodes

### Commit 6
- geometry preset library
- shared transform UX geometry + texture

## 7. Najważniejsza zasada końcowa

**Geometry i texture muszą być dwoma oddzielnymi, first-class bytami.**
Jeżeli spróbujesz załatwić texture preset jako zwykły „m value” bez assetu, bez transformu i bez gizmo, to nie dostaniesz workflow ani jak w mumaxie, ani jak w Borisie, ani jak w 3DS Maxie.
