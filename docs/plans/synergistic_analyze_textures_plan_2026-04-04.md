# Fullmag — synergiczny plan wdrożenia: Analyze v2 (solver-aware) + Magnetic Textures

**Data:** 2026-04-04
**Autor:** Plan wygenerowany na bazie dwóch raportów + audytu codebase
**Zakres:** frontend Analyze diagnostics, magnetic texture presets, geometry presets, solver integration

---

## 0. Executive summary

Dwa raporty proponują dwa oddzielne tory:

| Tor | Raport źródłowy | Rozmiar |
|-----|-----------------|---------|
| **A — Analyze v2 solver-aware** | `fullmag_frontend_analyze_report_v2_solveraware_pl.md` | ~5 nowych plików TS, refaktor 2 istniejących |
| **B — Magnetic textures + geometry presets** | `fullmag_magnetic_textures_*` | ~12 nowych plików (Python + TS + Rust), modyfikacja 6 istniejących |

Po audycie codebase (2026-04-04) okazuje się, że:

1. **Tor A jest w ~80% już zaimplementowany.** Istniejący `AnalyzeViewport.tsx` już:
   - konsumuje `useAnalyzeRuntimeDiagnostics` z badge bar + diagnostics,
   - renderuje `AnalyzeDiagnosticsPanel` w aside rail (360px),
   - ma `AnalyzeRuntimeBadges` w headerze,
   - ma `AnalyzeMeshSemanticsPanel`,
   - ma `useCurrentAnalyzeArtifacts` z cache modów + spectrum + dispersion.

   Brakuje kilku drobnych ulepszeń (keyboard nav, export, compare).

2. **Tor B jest w 0% zintegrowany** — startery istnieją w `docs/reports/04042026/` ale nie są w main codebase.

3. **Rust authoring już ma struktury**, które textures potrzebują: `MagnetizationAsset` z `mapping`, `texture_transform`, `TextureTransform3D` — to jest kluczowe, bo nie trzeba budować tego od zera.

Wniosek: **plan synergetyczny łączy oba tory w jedną sekwencję sprintów**, gdzie Analyze v2 dopieszcza się równolegle z rdzeniem texture, a UI texture korzysta z tych samych widgetów Analyze (badge bar, diagnostics rail).

---

## 1. Co jest gotowe (NIE ruszamy)

### 1.1 Analyze — już działa
| Plik | Status |
|------|--------|
| `AnalyzeViewport.tsx` | ✅ Pełny shell z Tabs (Spectrum/Modes/Dispersion), badge bar, diagnostics aside |
| `useAnalyzeRuntimeDiagnostics.ts` | ✅ Hook: engine badge, roles badge, thermal/oersted/cpu-guard badges z metadata |
| `AnalyzeRuntimeBadges.tsx` | ✅ Komponent badge z tone coloring |
| `AnalyzeDiagnosticsPanel.tsx` | ✅ Agregacja: badges + mesh semantics + error + warnings + log excerpt |
| `AnalyzeMeshSemanticsPanel.tsx` | ✅ Grid: magnetic parts / air / interfaces + contract label |
| `useCurrentAnalyzeArtifacts.ts` | ✅ Fetch: spectrum, modes (cache per index), dispersion, mesh |
| `ModeSpectrumPlot.tsx` | ✅ Wykres spectrum z selekcją modu |
| `EigenModeInspector.tsx` | ✅ 3D wizualizacja modu |
| `DispersionBranchPlot.tsx` | ✅ Wykres dyspersji |
| `analyzeSelection.ts` | ✅ State: tab, selectedModeIndex, refreshNonce |

**Decyzja:** NIE tworzymy `AnalyzeViewportShell.v2.tsx`. Istniejący `AnalyzeViewport.tsx` to już praktycznie ten shell. Raportowa wersja v2 jest mniej kompletna (brak loading/error states, brak refresh button).

### 1.2 Rust authoring — kompatybilne fundamenty
| Struct | Pola kluczowe | Status |
|--------|---------------|--------|
| `MagnetizationAsset` | `kind`, `value`, `seed`, `mapping`, `texture_transform` | ✅ Istnieje, wymaga rozszerzenia `kind` |
| `MagnetizationMapping` | `space`, `projection`, `clamp_mode` | ✅ Gotowe |
| `TextureTransform3D` | `translation`, `rotation_quat`, `scale`, `pivot` | ✅ Gotowe |
| `SceneObject` | `magnetization_ref` | ✅ Gotowe |

### 1.3 Python magnetization — backward-compatible base
| Klasa | Status |
|-------|--------|
| `UniformMagnetization` | ✅ |
| `RandomMagnetization` | ✅ |
| `SampledMagnetization` | ✅ |
| `uniform()`, `random()` | ✅ |

---

## 2. Co odrzucamy lub odraczamy

### 2.1 ODRZUCONE

| Element z raportu | Powód odrzucenia |
|-------------------|------------------|
| `AnalyzeViewportShell.v2.tsx` (nowy plik) | Istniejący `AnalyzeViewport.tsx` już ma tę samą architekturę — tworzenie nowego shella to duplikacja |
| `GeometryPresetLibraryPanel.tsx` w Phase 1 | Geometry presets to wtórny system — textures mają wyższy priorytet naukowy. Geometry DSL (`fm.Cylinder`, `fm.Box`) już działa w skrypcie |
| `GeometryTransformGizmo.tsx` jako osobny komponent | Istniejący `BoundsPreview3D` + `PivotControls` są wystarczające. Refaktor gizmo to Phase 3 |
| `FemMeshView3D.tsx` texture overlay | Zbyt głębokie sprzężenie z FEM mesh renderer — Phase 3 |
| Compare mode (Analyze) | Użyteczne, ale wymaga pary wyników — Phase 3 |
| Phase 2 presety: `hopfion_like`, `meron`, `hedgehog_3d`, `from_ovf`, `from_formula` | Po stabilizacji Phase 1 |

### 2.2 ODROCZONE (Phase 2–3)

| Element | Faza |
|---------|------|
| Keyboard prev/next mode w Analyze | Phase 2 |
| Export VTK/CSV z Analyze | Phase 2 |
| Geometry preset catalog UI | Phase 2 |
| Texture slice preview (2D) | Phase 2 |
| `from_ovf` / `from_formula` presety | Phase 2 |
| Texture gizmo proxy bounds w 3D | Phase 3 |
| Instance vs copy semantics w UI | Phase 3 |
| Cache hash-based invalidation runtime | Phase 3 |

---

## 3. Architektura docelowa (Phase 1)

```
                    ┌─────────────────────────────────────┐
                    │         Python DSL (user script)      │
                    │  body.m = fm.texture.neel_skyrmion()  │
                    │            .translate(...)             │
                    └───────────────┬──────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────┐
                    │   fullmag.init.textures (PresetTexture)│
                    │   fullmag.init.preset_eval (evaluator) │
                    └───────────────┬──────────────────────┘
                                    │ to_ir()
                    ┌───────────────▼──────────────────────┐
                    │   ProblemIR: PresetTexture             │
                    │   (analytic — NOT sampled)             │
                    └───────────────┬──────────────────────┘
                                    │ runtime sampling
                    ┌───────────────▼──────────────────────┐
                    │   initial_state.py                     │
                    │   FDM: cell centers → evaluate         │
                    │   FEM: node coords (magnetic only)     │
                    └───────────────────────────────────────┘

    ═══════════════════════════════════════════════════════════

                    ┌─────────────────────────────────────┐
                    │   Rust Authoring (SceneDocument)      │
                    │   MagnetizationAsset.kind =           │
                    │     "preset_texture"                   │
                    │   + preset_kind, params, version       │
                    └───────────────┬──────────────────────┘
                                    │ JSON API
                    ┌───────────────▼──────────────────────┐
                    │   Frontend                             │
                    │   MagneticTextureLibraryPanel          │
                    │   TextureTransformGizmo                │
                    │   magnetizationPresetCatalog.ts        │
                    └───────────────────────────────────────┘
```

---

## 4. Sprinty implementacyjne

### Sprint 1 — Python texture DSL + evaluator (backend core)

**Cel:** `body.m = fm.texture.neel_skyrmion(...)` działa end-to-end w skrypcie.

| # | Plik | Akcja | Źródło |
|---|------|-------|--------|
| 1.1 | `packages/fullmag-py/src/fullmag/init/textures.py` | **NOWY** — skopiować ze startera, dostosować do istniejącego API | starter `textures.py` |
| 1.2 | `packages/fullmag-py/src/fullmag/init/preset_eval.py` | **NOWY** — skopiować ze startera | starter `preset_eval.py` |
| 1.3 | `packages/fullmag-py/src/fullmag/init/__init__.py` | **EDYCJA** — dodać eksport `textures`, `preset_eval` | — |
| 1.4 | `packages/fullmag-py/src/fullmag/__init__.py` | **EDYCJA** — dodać `texture` namespace (`from .init import textures as texture`) | — |
| 1.5 | `packages/fullmag-py/src/fullmag/init/magnetization.py` | **EDYCJA** — dodać `PresetTexture` do `InitialMagnetization` union | — |
| 1.6 | `packages/fullmag-py/src/fullmag/world.py` | **EDYCJA** — `MagnetHandle.m` setter akceptuje `PresetTexture`, canonical script gen | — |

**Treść `textures.py`** (ze startera, kluczowe elementy):
- `TextureTransform3D` — frozen dataclass z fluent API (`translate`, `rotate_*`, `scale`)
- `TextureMapping` — `space: Literal["object", "world"]`, `projection`, `clamp_mode`
- `PresetTexture` — `preset_kind`, `params`, `mapping`, `transform` + `to_ir()` → analityczny dict (NIE sampled!)
- Factory methods: `uniform`, `random_seeded`, `vortex`, `antivortex`, `bloch_skyrmion`, `neel_skyrmion`, `domain_wall`, `two_domain`, `helical`, `conical`

**Treść `preset_eval.py`** (ze startera):
- `evaluate_preset_texture(preset_kind, params, points) → EvaluatedTexture`
- Pure numpy evaluators dla 10 presetów
- Każdy evaluator pobiera punkty lokalne, zwraca znormalizowane `(mx, my, mz)`

**Krytyczne zasady:**
1. `to_ir()` NIGDY nie zwraca sampled fieldów — tylko analityczny opis
2. Istniejący `uniform()` / `random()` pozostają backward-compatible
3. `PresetTexture` jest frozen (immutable) — `translate()` zwraca nową instancję

**Weryfikacja:**
```bash
cd packages/fullmag-py
python -c "from fullmag import texture; t = texture.neel_skyrmion(radius=35e-9); print(t.to_ir())"
```

---

### Sprint 2 — Runtime sampling + IR lowering

**Cel:** Texture preset przechodzi przez ProblemIR do runtime i jest próbkowany per solver.

| # | Plik | Akcja |
|---|------|-------|
| 2.1 | `packages/fullmag-py/src/fullmag/model/problem.py` | **EDYCJA** — lowering `PresetTexture` do ProblemIR jako `{"kind": "preset_texture", "preset_kind": ..., "params": ..., "mapping": ..., "transform": ...}` |
| 2.2 | `packages/fullmag-py/src/fullmag/runtime/initial_state.py` | **NOWY** — `prepare_initial_magnetization(spec, mesh_or_grid, object_parts)` → sampled vectors |
| 2.3 | `crates/fullmag-ir/src/lib.rs` (lub odpowiedni moduł) | **EDYCJA** — dodać `InitialMagnetization` enum: `Uniform`, `RandomSeeded`, `SampledField`, `PresetTexture` |

**`initial_state.py` — algorytm:**
```python
def prepare_initial_magnetization(spec, sample_points):
    """
    spec: IR dict z kind="preset_texture"
    sample_points: np.ndarray shape (N, 3) — centra komórek FDM lub węzły FEM
    """
    transform = TextureTransform3D.from_ir(spec["transform"])
    mapping = TextureMapping.from_ir(spec["mapping"])

    # 1. World → local (jeśli mapping.space == "object")
    local_pts = apply_inverse_transform(sample_points, transform)

    # 2. Evaluate
    result = evaluate_preset_texture(spec["preset_kind"], spec["params"], local_pts)

    # 3. Normalize
    return normalize_vectors(result.values)
```

**FDM path:** sample na centrach komórek aktywnych + object mask
**FEM path:** sample na węzłach magnetic parts — NIE airbox

**Weryfikacja:**
```bash
python examples/magnetic_textures_example.py
# Powinno wygenerować skyrmion na dysku FEM
```

---

### Sprint 3 — Rust authoring rozszerzenie

**Cel:** `MagnetizationAsset` z `kind = "preset_texture"` przechodzi przez JSON API.

| # | Plik | Akcja |
|---|------|-------|
| 3.1 | `crates/fullmag-authoring/src/scene.rs` | **EDYCJA** — rozszerzyć `MagnetizationAsset` o nowe enum `MagnetizationKind` |
| 3.2 | `crates/fullmag-authoring/src/adapters.rs` | **EDYCJA** — serializacja `preset_texture` do JSON |

**Zmiany w `scene.rs`:**

Obecny `MagnetizationAsset` ma `kind: String`. Propozycja docelowa:

```rust
pub struct MagnetizationAsset {
    pub id: String,
    pub name: String,
    pub kind: String,                        // "uniform" | "random_seeded" | "sampled_field" | "preset_texture"
    pub value: Option<Vec<f64>>,             // uniform direction
    pub seed: Option<u64>,                   // random seed
    pub source_path: Option<String>,         // sampled field path
    pub source_format: Option<String>,
    pub dataset: Option<String>,
    pub sample_index: Option<i64>,
    pub mapping: MagnetizationMapping,
    pub texture_transform: TextureTransform3D,
    // NOWE POLA:
    pub preset_kind: Option<String>,         // "neel_skyrmion", "vortex", ...
    pub preset_params: Option<serde_json::Value>,  // preset-specific params
    pub preset_version: Option<u32>,         // schema version
    pub ui_label: Option<String>,            // display name
}
```

**Dlaczego `Option<serde_json::Value>` a nie typed enum:**
- Każdy preset ma inne parametry (skyrmion: radius, wall_width, chirality; vortex: circulation, core_polarity)
- Typed enum wymaga aktualizacji Rusta za każdym razem, gdy dodajemy preset po stronie Pythona
- Walidacja odbywa się w Pythonie (`preset_eval.py`)
- Rust authoring to pass-through — nie ewaluuje tekstur

**Weryfikacja:**
```bash
cargo check -p fullmag-authoring
cargo test -p fullmag-authoring
```

---

### Sprint 4 — Frontend: katalog presetów + panel biblioteki

**Cel:** Użytkownik widzi bibliotekę tekstur i może przypisać preset do obiektu.

| # | Plik | Akcja | Źródło |
|---|------|-------|--------|
| 4.1 | `apps/web/lib/magnetizationPresetCatalog.ts` | **NOWY** | starter `magnetizationPresetCatalog.ts` |
| 4.2 | `apps/web/lib/textureTransform.ts` | **NOWY** | starter `textureTransform.ts` |
| 4.3 | `apps/web/components/panels/MagneticTextureLibraryPanel.tsx` | **NOWY** | starter `MagneticTextureLibraryPanel.tsx` |
| 4.4 | `apps/web/lib/session/types.ts` | **EDYCJA** — typy: `MagnetizationPresetState`, `TextureTransformState` | — |

**Treść `magnetizationPresetCatalog.ts`** (ze startera):
- 10 deskryptorów presetów z: `kind`, `label`, `category`, `icon`, `defaultParams`, `parameters[]`
- Kategoryzacja: `basic` (uniform, random), `topological` (vortex, antivortex, bloch_skyrmion, neel_skyrmion), `domains` (domain_wall, two_domain), `periodic` (helical, conical)
- Pole `parameters` opisuje UI kontrolki: TextField (number), SelectField, checkbox

**Treść `MagneticTextureLibraryPanel.tsx`** (ze startera, z modyfikacjami):
- Grid kafelków pogrupowanych per kategoria
- Filtr / search
- Actions: `Assign to selected`, `Assign as copy`
- Po prawej: formularz parametrów presetu

**Kluczowa modyfikacja vs starter:**
- Starter zakłada generyczny `onAssign` callback — trzeba podłączyć do `SceneDocument.magnetization_assets` mutacji przez existing scene update API

**Weryfikacja:**
```bash
npx tsc --noEmit
# Wizualnie: uruchomić web app, otworzyć panel
```

---

### Sprint 5 — Frontend: texture transform gizmo w viewport

**Cel:** Interaktywny gizmo translate/rotate/scale tekstury na obiekcie.

| # | Plik | Akcja | Źródło |
|---|------|-------|--------|
| 5.1 | `apps/web/components/preview/TextureTransformGizmo.tsx` | **NOWY** | starter `TextureTransformGizmo.tsx` |
| 5.2 | `apps/web/components/preview/MagnetizationView3D.tsx` | **EDYCJA** — dodać texture gizmo overlay + surface color preview | — |
| 5.3 | `apps/web/lib/session/types.ts` | **EDYCJA** — `active_transform_scope: "geometry" \| "texture"`, `texture_gizmo_mode` | — |
| 5.4 | `apps/web/components/panels/ModelTree.tsx` | **EDYCJA** — sub-node `Magnetization > Texture` pod obiektem | — |

**Gizmo modes:**
- `translate` — przesuwa texture local frame
- `rotate` — obraca texture wokół pivot
- `scale` — skaluje texture

**Kluczowe:** gizmo **MUSI mieć osobny tryb** od geometry transform. Toolbar/header musi jasno informować: "Editing: texture transform" vs "Editing: geometry transform".

**Weryfikacja:**
- Wizualnie: zaznacz obiekt → przełącz na "texture edit" → przesuń gizmo → preview aktualizuje się
- Zmiana tekstury nie porusza geometrii

---

### Sprint 6 — Analyze v2 polish (drobne ulepszenia)

**Cel:** Domknąć drobnostki z raportu Analyze v2, które jeszcze nie istnieją.

| # | Plik | Akcja |
|---|------|-------|
| 6.1 | `useAnalyzeRuntimeDiagnostics.ts` | **EDYCJA** — dodać `metadata.normalization`, `metadata.damping_policy`, `metadata.equilibrium_source` do badges |
| 6.2 | `AnalyzeViewport.tsx` | **EDYCJA** — keyboard shortcuts: `←`/`→` prev/next mode |
| 6.3 | `AnalyzeViewport.tsx` | **EDYCJA** — spinner na mode loading (już prawie jest) |

**NIE tworzymy nowego AnalyzeViewportShell.v2.tsx** — istniejący `AnalyzeViewport.tsx` już ma tę architekturę. Różnice między istniejącym a v2 z raportu:

| Cecha | Istniejący | Raport v2 |
|-------|-----------|-----------|
| Tabs Spectrum/Modes/Dispersion | ✅ | ✅ |
| Badge bar | ✅ | ✅ |
| Diagnostics aside | ✅ | ✅ |
| Loading/error states | ✅ (pełne) | ❌ (brak) |
| Refresh button | ✅ | ❌ |
| Keyboard nav | ❌ | ❌ |
| Dominant polarization | ✅ | ❌ |

Istniejący jest **bardziej kompletny**. Wystarczy dodać keyboard nav.

---

## 5. Treść plików ze starterów — co kopiujemy dosłownie, co modyfikujemy

### 5.1 Kopiujemy dosłownie (z minor cleanup):
| Plik startera | Docelowa ścieżka | Uwagi |
|---------------|-------------------|-------|
| `textures.py` | `packages/fullmag-py/src/fullmag/init/textures.py` | Dobra architektura, fluent API, frozen dataclass. Dodać docstring na module level. |
| `preset_eval.py` | `packages/fullmag-py/src/fullmag/init/preset_eval.py` | Czyste numpy evaluatory. Dodać `random_seeded` z prawdziwym `np.random.default_rng(seed)` zamiast placeholder. |
| `magnetizationPresetCatalog.ts` | `apps/web/lib/magnetizationPresetCatalog.ts` | Kompletny katalog z param schema. |
| `textureTransform.ts` | `apps/web/lib/textureTransform.ts` | Helper types + `fitTextureToBounds`. |

### 5.2 Kopiujemy z istotnymi modyfikacjami:
| Plik startera | Docelowa ścieżka | Modyfikacje |
|---------------|-------------------|-------------|
| `MagneticTextureLibraryPanel.tsx` | `apps/web/components/panels/MagneticTextureLibraryPanel.tsx` | Podłączyć do scene document mutation API zamiast generic `onAssign` callback. Użyć istniejących komponentów UI (`SelectField`, `TextField`) zamiast raw `<select>`. |
| `TextureTransformGizmo.tsx` | `apps/web/components/preview/TextureTransformGizmo.tsx` | Sprawdzić kompatybilność z existing Three.js setup w `BoundsPreview3D`. Może wymagać dostosowania do `@react-three/drei` wersji. |

### 5.3 NIE kopiujemy:
| Plik startera/raportu | Powód |
|----------------------|-------|
| `geometryPresetCatalog.ts` | Geometry presets → Phase 2. DSL geometrii (`fm.Cylinder`, `fm.Box`) już działa bez katalogu UI. |
| `magnetic_textures_example.py` | Przykład do docs — skopiować do `examples/` dopiero po Sprint 2 acceptance. |
| `AnalyzeViewportShell.v2.tsx` z raportu | Istniejący `AnalyzeViewport.tsx` jest lepszy (pełne loading/error states). |

---

## 6. Mapa zależności między sprintami

```
Sprint 1 (Python DSL)
    │
    ├──→ Sprint 2 (Runtime sampling + IR)
    │        │
    │        └──→ Sprint 3 (Rust authoring)
    │                 │
    │                 └──→ Sprint 4 (Frontend catalog + panel)
    │                          │
    │                          └──→ Sprint 5 (Gizmo)
    │
    └──→ Sprint 6 (Analyze polish) ← niezależny, można równolegle z 1-2
```

**Sprint 6 jest niezależny** od toru tekstur — można go robić równolegle z dowolnym sprintem.

---

## 7. Ryzyka i mitigation

| Ryzyko | Prawdopodobieństwo | Mitigation |
|--------|-------------------|------------|
| **Pomylenie geometry transform z texture transform w UI** | Wysokie | Jasny toolbar mode indicator: "Editing: Texture" z fioletowym badge. Osobny keybind (T → texture, G → geometry). |
| **Zbyt wczesne próbkowanie textury** | Średnie | Zasada architektoniczna: `to_ir()` NIGDY nie sampluje. Sampling dopiero w `initial_state.py` tuż przed solverem. CI test na to. |
| **FEM shared-domain: sample w airboxie** | Średnie | `initial_state.py` MUSI filtrować sample points po `role == "magnetic_object"`. Unit test z mock mesh. |
| **Starter `TextureTransformGizmo` inkompatybilny z istniejącym Three.js** | Średnie | Sprawdzić wersję `@react-three/drei` i `PivotControls` API przed Sprint 5. |
| **`preset_params: serde_json::Value` utrata type safety w Rust** | Niskie | Akceptowalne — Rust authoring to pass-through. Walidacja w Pythonie. |

---

## 8. Definition of Done per sprint

### Sprint 1 ✓ when:
- `from fullmag import texture` działa
- `texture.neel_skyrmion(radius=35e-9).translate(20e-9, 0, 0).to_ir()` zwraca poprawny dict
- `texture.vortex(circulation=1, core_polarity=1)` ditto
- Istniejące `uniform()` / `random()` nie są zepsute
- `evaluate_preset_texture("neel_skyrmion", {...}, points)` zwraca poprawne wektory

### Sprint 2 ✓ when:
- `body.m = fm.texture.neel_skyrmion(...)` w skrypcie daje poprawny m0 w solverze
- FDM path: veryfikacja na cube z uniform vs skyrmion
- FEM path: sampling działa tylko na magnetic parts

### Sprint 3 ✓ when:
- `cargo check -p fullmag-authoring` OK
- `cargo test -p fullmag-authoring` OK
- JSON round-trip: `MagnetizationAsset` z `kind="preset_texture"` + `preset_params`

### Sprint 4 ✓ when:
- `npx tsc --noEmit` zero errors
- Panel widoczny w UI
- Klik na preset → dane widoczne w formie

### Sprint 5 ✓ when:
- Gizmo widoczny na zaznaczonym obiekcie
- Translate gizmo → `texture_transform.translation` updated
- Geometry nie porusza się podczas edycji tekstury

### Sprint 6 ✓ when:
- Keyboard ←/→ przełącza mode w Analyze
- Badges `normalization`, `damping_policy` widoczne

---

## 9. Szacunkowa wielkość zmian

| Sprint | Nowe pliki | Edytowane pliki | ~LOC nowe | ~LOC edycji |
|--------|-----------|-----------------|-----------|-------------|
| 1 | 2 (textures.py, preset_eval.py) | 3 (__init__.py ×2, magnetization.py) | ~600 | ~40 |
| 2 | 1 (initial_state.py) | 2 (problem.py, lib.rs) | ~200 | ~60 |
| 3 | 0 | 2 (scene.rs, adapters.rs) | 0 | ~50 |
| 4 | 3 (catalog.ts, transform.ts, panel.tsx) | 1 (types.ts) | ~500 | ~20 |
| 5 | 1 (gizmo.tsx) | 3 (MagView3D, types.ts, ModelTree) | ~250 | ~80 |
| 6 | 0 | 2 (diagnostics hook, AnalyzeViewport) | 0 | ~60 |
| **Razem** | **7** | **~10** | **~1550** | **~310** |

---

## 10. Kolejność pracy (rekomendacja)

```
Tydzień 1:  Sprint 1 + Sprint 6 (równolegle)
Tydzień 2:  Sprint 2
Tydzień 3:  Sprint 3 + Sprint 4 (Rust → TS, serial)
Tydzień 4:  Sprint 5 + integration testing
```

Sprint 6 jest mały i niezależny — idealny do zrobienia jako "warm-up" równolegle z rdzeniem Python.
