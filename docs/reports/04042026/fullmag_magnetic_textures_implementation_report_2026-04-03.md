# Fullmag – plan wdrożenia predefined magnetic textures i geometry presets

## 1. Cel

Celem tej fali jest dodanie do Fullmaga dwóch spójnych systemów:

1. **Predefined magnetic textures**
   - uniform
   - random / seeded random
   - vortex
   - antivortex
   - Bloch skyrmion
   - Néel skyrmion
   - domain wall
   - two-domain
   - helical / conical
   - sampled / imported texture

2. **Geometry presets**
   - box
   - sphere
   - cylinder
   - cone
   - ellipsoid
   - torus / ring (jeżeli nie ma natywnej bryły, to jako helper boolean)
   - imported STL/STEP wrapper
   - preset-based arrays / pattern instances w późniejszej fazie

System ma działać:
- w **skrypcie Python DSL**
- w **SceneDocument / authoringu**
- w **preview 3D**
- w **solver runtime** dla FDM i FEM
- z **interaktywnym gizmem** translate / rotate / scale, jak w DCC/3DS Max

## 2. Najważniejszy wniosek architektoniczny

Nie trzeba budować tego od zera.

W obecnym modelu sceny masz już bardzo dobry zalążek:
- `SceneObject` ma `magnetization_ref`
- `SceneDocument` ma `magnetization_assets`
- asset magnetyzacji ma już `mapping`
- asset magnetyzacji ma już `texture_transform`

To oznacza, że **właściwy kierunek nie polega na dodaniu kolejnego niezależnego systemu**, tylko na **domknięciu istniejącego modelu assetów magnetyzacji** i nadaniu mu typed preset catalog + runtime evaluator + UI gizmo.

## 3. Docelowy model pojęciowy

### 3.1. Geometry asset vs magnetization texture asset

Obiekt w scenie powinien mieć dwa niezależne poziomy:

- **Geometry**
  - określa fizyczny kształt obiektu
  - ma własny `Transform3D`

- **Magnetization texture**
  - określa stan początkowy `m0`
  - jest przypięta przez `magnetization_ref`
  - ma własny `TextureTransform3D`
  - ma własny `mapping`

To jest odpowiednik relacji:
- geometry transform
- texture gizmo / map gizmo

czyli dokładnie to, czego potrzebujesz do workflow „jak w 3DS Max”.

## 4. Zasady funkcjonalne

### 4.1. Script DSL

Docelowo użytkownik powinien móc pisać:

```python
import fullmag as fm

study = fm.study("skyrmion_demo")
study.engine("fem")

disk = study.geometry(
    fm.Cylinder(160e-9, 2e-9),
    name="disk",
)

disk.Ms = 580e3
disk.Aex = 15e-12
disk.alpha = 0.02

disk.m = (
    fm.texture.neel_skyrmion(
        radius=35e-9,
        wall_width=10e-9,
        chirality=1,
        core_polarity=-1,
    )
    .translate(20e-9, 0, 0)
    .rotate_z_deg(25)
    .scale(1.1, 1.1, 1.0)
)
```

oraz:

```python
v = fm.texture.vortex(circulation=1, core_polarity=1)
body_a.m = v
body_b.m = v.copy().translate(40e-9, 0, 0).rotate_z_deg(180)
```

### 4.2. UI / Builder

Użytkownik powinien móc:

- zaznaczyć obiekt
- otworzyć `Magnetization`
- wybrać preset z biblioteki
- zobaczyć natychmiastowy preview na obiekcie
- przełączyć gizmo na:
  - Move texture
  - Rotate texture
  - Scale texture
- kliknąć `Fit to object`
- kliknąć `Center in object`
- przełączyć mapping:
  - object local
  - world
  - custom local plane
- zapisać preset jako:
  - instance-linked asset
  - unique copy dla obiektu

### 4.3. Geometry presets

Ten sam wzorzec ma działać dla geometrii:

- wybierasz preset geometrii z biblioteki
- wstawiasz do sceny
- transformujesz translate / rotate / scale
- zapisujesz do sceny jako parametric geometry
- dla imported geometry masz ten sam transform gizmo, ale bez zmiany parametrów topologii

## 5. Backend / solver – jak to ma działać naprawdę

## 5.1. Nie wolno bake’ować tekstury „na stałe” do sceny

Texture preset powinien być przechowywany jako:
- typ presetu
- params
- mapping
- texture transform

**Nie** jako od razu gotowa tablica próbek.

Powód:
- siatka FEM może się zmieniać
- grid FDM może się zmieniać
- mesh adaptive może się zmieniać
- ta sama tekstura może być przypięta do kilku obiektów i mieć różne transformy

## 5.2. Runtime evaluator

W runtime powinien istnieć wspólny evaluator:

```text
(texture preset, mapping, transform, sample points) -> sampled magnetization vectors
```

### Dla FDM:
- sample points = centra komórek aktywnych w obiekcie

### Dla FEM:
- sample points = węzły / solver sample points należące do regionu obiektu
- w shared-domain FEM sampling musi używać region markers / object parts, a nie całej domeny

## 5.3. Kolejność transformacji

Domyślna kolejność:

```text
world point
-> object local point (jeśli mapping.space == "object")
-> inverse(texture_transform)
-> local texture coordinates
-> preset evaluator
-> normalize / clamp
```

To daje prawidłowe zachowanie:
- tekstura porusza się względem obiektu
- obrót obiektu nie psuje tekstury
- obrót tekstury jest niezależny od obrotu geometrii

## 6. Minimalny katalog presetów w Phase 1

### 6.1. Presety obowiązkowe
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

### 6.2. Presety opcjonalne w Phase 2
- `target_skyrmion_bag`
- `meron`
- `hedgehog_3d`
- `hopfion_like`
- `radial_bubble`
- `from_ovf`
- `from_formula`

## 7. Kluczowe decyzje UX

## 7.1. Asset model
Texture ma być assetem, nie tylko „wartością na obiekcie”.

Powody:
- reuse
- copy vs instance
- łatwe biblioteki presetów
- łatwe zapisywanie do SceneDocument
- łatwiejszy export do script DSL

## 7.2. Gizmo mode
Viewport musi mieć jawny tryb:

- `geometry-transform`
- `texture-transform`

Nie wolno mieszać tych dwóch rzeczy w jednym gizmo bez czytelnego trybu, bo użytkownik zgubi semantykę.

## 7.3. Preview
Texture preview musi mieć 3 warstwy:

1. **surface preview**
   - kolorowanie obiektu orientacją `m`
2. **slice preview**
   - 2D slice przez texture volume
3. **proxy gizmo**
   - box / cylinder / sphere / plane pokazujący texture local frame

## 8. Wdrożenie etapami

### Etap A – typed preset contract
- wprowadzić typed preset schema
- zachować kompatybilność z obecnym `uniform/random/sampled`

### Etap B – Python DSL
- dodać namespace `fm.texture`
- dodać preset classes
- dodać transform chain

### Etap C – runtime evaluator
- evaluator dla analytic presets
- sampling dla FDM i FEM
- cache po hash(mesh, texture, transform, mapping)

### Etap D – UI library + forms
- biblioteka presetów
- formularze parametrów
- assign / duplicate / instance

### Etap E – gizmo i preview
- texture transform gizmo
- proxy bounds
- live preview

### Etap F – geometry preset library
- to samo UX dla brył geometrycznych
- wspólny transform stack i wspólny gizmo manager

## 9. Największe ryzyka

1. **Pomylenie transformu geometrii z transformem tekstury**
   - trzeba mieć dwa jawne tryby

2. **Zbyt wczesne próbkowanie do mesh/grid**
   - preset musi pozostać analityczny aż do runtime sampling

3. **Brak spójności FDM/FEM**
   - evaluator ma być wspólny
   - różnić się mają tylko sample points

4. **Próba realizacji wszystkiego przez sam frontend**
   - UI tylko edytuje asset
   - source of truth to backend asset + runtime evaluator

## 10. Definition of Done

Uznaj wdrożenie za skończone dopiero wtedy, gdy przechodzą wszystkie te scenariusze:

1. `body.m = fm.texture.neel_skyrmion(...).translate(...).rotate_z_deg(...)` działa w skrypcie.
2. Ten sam preset daje poprawny preview w UI.
3. Przesunięcie/obrót/skalowanie tekstury działa bez zmiany geometrii.
4. Ten sam asset można przypisać do dwóch obiektów jako instance albo jako copy.
5. FDM i FEM dają zgodny stan początkowy na tym samym obiekcie.
6. W FEM shared-domain sampling działa tylko w regionie ferromagnetyka, nie w airboxie.
7. Geometry presets mają ten sam transform UX co textures.
