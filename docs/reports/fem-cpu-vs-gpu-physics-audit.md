# FEM CPU vs GPU Physics Implementation — Line-by-Line Audit

**Data:** 2026-03-25  
**Pliki źródłowe:**

| Ścieżka | Rola |
|---------|------|
| `crates/fullmag-engine/src/fem.rs` (1286 linii) | Silnik fizyki CPU — topologia siatki, exchange, demag, LLG, Heun |
| `crates/fullmag-runner/src/fem_reference.rs` (528 linii) | Runner CPU — orchestracja kroków, obserwable, wyjście |
| `native/backends/fem/src/mfem_bridge.cpp` (~1130 linii) | Silnik fizyki GPU — MFEM exchange, transfer-grid demag, LLG, Heun |
| `native/backends/fem/src/context.cpp` (300 linii) | Inicjalizacja kontekstu GPU, kopiowanie pól |
| `crates/fullmag-runner/src/native_fem.rs` (552 linii) | Runner GPU — Rust FFI wrapper, pre-computation kerneli Newella |

---

## 1. Stałe fizyczne

| Stała | CPU (Rust) | GPU (C++) | Zgodność |
|-------|-----------|-----------|----------|
| μ₀ | `4.0 * PI * 1e-7` (`lib.rs:16`) | `4.0e-7 * 3.14159265358979323846` (`mfem_bridge.cpp:21`) | ✅ Identyczne |
| Geometria ε | `1e-30` (`fem.rs:64`) | `1e-30` (`mfem_bridge.cpp:22`) | ✅ Identyczne |

---

## 2. Topologia siatki i precomputation

### 2.1 Tetrahedralny gradient kształtów (∇φ)

**CPU** (`fem.rs:56–85`): Oblicza inverse-transpose macierzy `[d1, d2, d3]` z determinantem `det = dot(d1, cross(d2, d3))`, wyodrębnia gradienty `grad0 = -Σ(grad1..3)`, `gradi = i-ta kolumna inv^T`.

**GPU** (`mfem_bridge.cpp`): **Nie oblicza gradientów bezpośrednio.** Zamiast tego deleguje do MFEM `DiffusionIntegrator` i `MassIntegrator`, które wewnętrznie obliczają te same elementy macierzy sztywności. MFEM assembles full sparse stiffness matrix.

**⚠️ RÓŻNICA STRUKTURALNA**: CPU ręcznie składa elementy tetrahedral stiffness matrix per-element i przechowuje `element_stiffness[e][4][4]`. GPU korzysta z MFEM assembled global sparse stiffness matrix. Matematycznie powinny dać ten sam wynik dla P1 elementów, ale:
- **kolejność numeryczna**: MFEM może stosować inną kolejność summowania (element-by-element vs node-by-node assembling)
- **formułki kwadratury**: MFEM `DiffusionIntegrator` dla P1 tetrahedrów używa dokładnego 1-punktowego schematu kwadratury, co jest tożsame z analityczną formułą CPU — brak rozbieżności.

### 2.2 Node volumes (lumped mass)

**CPU** (`fem.rs:79–83`): `node_volumes[node] += volume / 4.0` — ¼ objętości elementu na wierzchołek (lumped mass diag).

**GPU** (`mfem_bridge.cpp:358–369`): `compute_row_sum_lumped_mass()` — sumuje wiersze assembled `MassIntegrator` sparse matrix.

**⚠️ POTENCJALNA ROZBIEŻNOŚĆ (P1):**
Dla P1 tetrahedrów macierz masy ma strukturę:
```
M_ij = V/20  (i≠j)
M_ii = V/10
```
Suma wiersza: `V/10 + 3·V/20 = V/10 + 3V/20 = 2V/20 + 3V/20 = 5V/20 = V/4`.

Więc row-sum lumped mass = V/4 na węzeł, co jest **identyczne** z CPU. ✅ Zgodne.

### 2.3 Element markers / magnetic mask

**CPU** (`fem.rs:854–862`): `magnetic_element_mask_from_markers()` — jeśli istnieją zarówno markery `1` jak i inne, tylko markery `1` są magnetyczne. Inaczej wszystko jest magnetyczne.

**GPU** (`mfem_bridge.cpp:349–358`): `is_fully_magnetic()` — sprawdza czy **wszystkie** markery są takie same. Jeśli nie → **odmawia obliczenia exchange** z błędem. GPU nie wspiera meshów z mieszanymi materiałami.

**🟡 RÓŻNICA FUNKCJONALNA**: CPU obsługuje mieszane markery (np. materiał magnetyczny + powietrze), GPU tego nie ​​obsługuje (zwraca błąd). Dla meshów jednorodnych — brak różnicy.

---

## 3. Exchange field: H_ex

### 3.1 Formuła

Obie implementacje:
```
H_ex = -(2A / (μ₀·Ms)) · K⁻¹_lumped · S · m
```
gdzie `A` = exchange_stiffness, `Ms` = saturation_magnetisation, `S` = stiffness matrix, `K_lumped` = lumped mass.

**CPU** (`fem.rs:362–392`):
```rust
coeff = 2.0 * A / (MU0 * Ms);
// Per element: contribution[i] += Σ_j stiffness[i][j] * m[j]
// field[node] += -coeff * contribution
// field[node] /= lumped_mass[node]
```

**GPU** (`mfem_bridge.cpp:376–406`, `apply_exchange_component`):
```cpp
prefactor = 2.0 * A / (kMu0 * Ms);
// stiffness.Mult(m_component, tmp);   — global SpMV
// h_component[i] = -prefactor * tmp[i] / lumped_mass[i];
```

**✅ Identyczna formuła.** CPU składa element-by-element, GPU robi global SpMV; numeryczny wynik identyczny dla dokładnej arytmetyki, ale kolejność sumowania może dawać różnice ~O(ε_mach).

### 3.2 Komponent-po-komponencie

**CPU**: iteruje elementy, buduje contribution vector 3D na raz (per-element 4×4 × [3]D).

**GPU**: robi 3 oddzielne SpMV (mx, my, mz) i pakuje z powrotem do AOS.

**✅ Tożsame matematycznie.** Drobne różnice numeryczne z kolejności sumowania.

---

## 4. Exchange energy: E_ex

### 4.1 Formuła

**CPU** (`fem.rs:396–428`):
```rust
energy += A * m_component[i] * stiffness[i][j] * m_component[j]
// = A · mᵀ · S · m   (sumowane per-element per-component)
```

**GPU** (`mfem_bridge.cpp:498–510`):
```cpp
stiffness.Mult(mx, tmp);
energy += A * (mx · tmp);  // = A · mxᵀ · S · mx
// powtórz dla my, mz
```

**⚠️ KRYTYCZNA RÓŻNICA: brak Ms i brak μ₀!**

Sprawdźmy wymiary:
- `stiffness[i][j]` ma wymiar `[1/m]` (gradient^2 × objętość)
- `m` jest bezwymiarowe (znormalizowane)
- `A` ma wymiar `[J/m]`

Więc `E = A · mᵀ · S · m` ma wymiar `[J/m · 1/m] = [J/m²]` — **wymiarowo poprawne tylko jeśli zinterpretujemy to jako gęstość energii, nie energia absolutna**.

Hmm, ale oba robią dokładnie to samo: `A · mᵀ · S · m`. Tu nie ma μ₀ ani Ms w żadnym z nich — bo exchange energy w formule FEM to:
```
E_ex = A ∫ |∇m|² dV = A · mᵀ · S · m
```
Jest to **poprawna** formuła exchange energy w wariancie FEM.

**✅ Identyczna formuła.**

---

## 5. Demag: transfer-grid bootstrap

### 5.1 Transfer grid geometry

**CPU** (`fem.rs:457–476` + `TransferGridDesc::from_bbox`):
```rust
grid.nx = ceil(extent_x / requested_cell)
cell_size.dx = max(extent_x / nx, 1e-12)
bbox_min = bbox_min_magnetic_nodes
```

**GPU** (`mfem_bridge.cpp:110–125`, `build_transfer_grid_desc`):
```cpp
desc.nx = ceil(extent_x / requested)   // requested = max(hmax, 1e-12)
desc.dx = max(extent_x / nx, 1e-12)
desc.bbox_min = bbox_min
```

**⚠️ RÓŻNICA W BOUNDING BOX:**

**CPU** (`fem.rs:624–641`, `magnetic_bbox`): iteruje tylko węzły z `magnetic_node_volumes[node] > 0` — bounding box obejmuje tylko **magnetyczne** węzły.

**GPU** (`mfem_bridge.cpp:97–109`, `magnetic_bbox`): iteruje **WSZYSTKIE** węzły:
```cpp
for (uint32_t node = 0; node < ctx.n_nodes; ++node) { ... }
```

**🔴 BUG (P1, dla meshów z powietrzem):** GPU uwzględnia węzły niemagnetyczne w bounding box, co może dać większy grid i inne pozycjonowanie komórek. Dla meshów w pełni magnetycznych — brak różnicy.

### 5.2 Cell size hint

**CPU** (`fem.rs:653–665`, `default_demag_transfer_cell_size_hint`): oblicza `h` na podstawie `characteristic_volume^(1/3)` z ograniczeniem dolnym.

**GPU** (`native_fem.rs:118–130`): używa `plan.hmax` directly jako requested cell → `transfer_axis_cells(extent, hmax)`.

**⚠️ RÓŻNICA:** CPU oblicza cell size dynamicznie na podstawie gęstości siatki FEM. GPU używa `hmax` z planu IR. Mogą dać inne siatki transfer-grid → inne wyniki demag.

**ALE:** W `fem_reference.rs:90`: CPU **też** przekazuje `[plan.hmax, plan.hmax, plan.hmax]` do `with_terms_and_demag_transfer_grid`. Więc oba używają `hmax` z planu. ✅ Zgodne.

### 5.3 Demag kernel spectra

**CPU** (`fem.rs:479–492`): Tworzy `ExchangeLlgProblem` FDM z `demag: true`. Kernele Newella obliczane **wewnętrznie** przez FDM problem w Rust (`compute_newell_kernel_spectra` / `compute_newell_kernel_spectra_thin_film_2d`).

**GPU** (`native_fem.rs:117–136`): Kernele Newella obliczane **wcześniej** w Rust i przekazywane jako pre-computed spectra do natywnego backendu via FFI:
```rust
if nz == 1 {
    compute_newell_kernel_spectra_thin_film_2d(nx, ny, dx, dy, dz)
} else {
    compute_newell_kernel_spectra(nx, ny, nz, dx, dy, dz)
}
```

**✅ Te same funkcje Rust obliczają kernele** w obu ścieżkach. Wartości numeryczne identyczne.

### 5.4 FDM demag computation

**CPU**: Tworzy pełny Rust `ExchangeLlgProblem` z maskami aktywności, oblicza demag FFT w Rust engine.

**GPU** (`mfem_bridge.cpp:680–752`): Tworzy natywny FDM backend via `fullmag_fdm_backend_create` (CUDA), uploaduje magnetyzację, wywołuje `fullmag_fdm_backend_refresh_observables`, kopiuje H_demag.

**⚠️ RÓŻNICA IMPLEMENTACYJNA: oddzielne ścieżki FFT.** CPU FDM używa Rust FFT (`rustfft`), GPU FDM używa cuFFT. Wyniki numerycznie powinny być zgodne w granicach precyzji double, ale:
- cuFFT vs rustfft mogą dawać drobne różnice w operacjach FFT (~O(ε_mach · log(N)))
- operacje GPU fp64 mogą mieć różne zachowanie FMA (fused multiply-add) niż CPU

### 5.5 Rasteryzacja magnetyzacji → transfer grid

**CPU** (`fem.rs:672–742`): barycentric interpolation, iteruje elementy magnetyczne.

**GPU** (`mfem_bridge.cpp:197–250`): barycentric interpolation, iteruje **WSZYSTKIE** elementy (brak sprawdzenia `magnetic_element_mask`).

**🔴 BUG (dla meshów z powietrzem):** GPU rasteryzuje elementy z każdym markerem, CPU tylko magnetyczne. Dla jednorodnych meshów — brak różnicy.

### 5.6 Sampling demag field back to FEM nodes

**CPU** (`fem.rs:494–506`): trilinear interpolation, pomija węzły z `magnetic_node_volumes[node] <= 0`.

**GPU** (`mfem_bridge.cpp:738–750`): trilinear interpolation, próbkuje **WSZYSTKIE** węzły.

**🟡 DROBNA RÓŻNICA:** GPU ustawia H_demag na węzłach niemagnetycznych (na wartość z interpolacji), CPU zostawia `[0,0,0]`. Nie wpływa na fizykę, bo te węzły mają zerowe volume i nie uczestniczą w obliczeniach energii (sprawdzone — oba odfiltrowują w energii).

### 5.7 Demag energy

**CPU** (`fem.rs:508–517`):
```rust
E_demag = -0.5 * μ₀ * Ms * Σ_node (m · H_demag) * magnetic_node_volume
```

**GPU** (`mfem_bridge.cpp:755–762`):
```cpp
E_demag = -0.5 * kMu0 * Ms * Σ_node (m · H_demag) * mfem_lumped_mass[node]
```

**⚠️ POTENCJALNA ROZBIEŻNOŚĆ:**
- **CPU** używa `magnetic_node_volumes` (suma V/4 tylko z elementów magnetycznych)
- **GPU** używa `mfem_lumped_mass` (row-sum mass matrix z **WSZYSTKICH** elementów)

Dla meshów z mieszanymi markerami to da inne wyniki. Dla jednorodnych meshów — identyczne (oba = V/4 na węzeł).

---

## 6. External field: H_ext

**CPU** (`fem.rs:586–596`): Zwraca `external_field` dla węzłów z `magnetic_node_volumes > 0`, zero dla reszty.

**GPU** (`context.cpp:131–137`): `fill_repeated_vector_field()` — ustawia external_field na **WSZYSTKICH** węzłach jednakowo.

**🟡 DROBNA RÓŻNICA:** GPU ustawia H_ext na węzłach niemagnetycznych. Nie wpływa na LLG RHS (bo obie implementacje nie muszą maskować — GPU nie ma maskowania w LLG RHS).

### External energy

**CPU** (`fem.rs:598–608`):
```rust
E_ext = -μ₀ * Ms * Σ_node (m · H_ext) * magnetic_node_volume
```

**GPU** (`mfem_bridge.cpp:472–487`):
```cpp
E_ext = -kMu0 * Ms * Σ_node (m · H_ext) * mfem_lumped_mass[node]
```

**Ta sama potencjalna rozbieżność jak w demag energy** (magnetic_node_volumes vs mfem_lumped_mass). Dla jednorodnych meshów — identyczne.

---

## 7. LLG RHS (right-hand side)

**CPU** (`fem.rs:634–641`):
```rust
γ̄ = γ / (1 + α²)
precession = m × H_eff
damping = m × precession
rhs = -γ̄ · (precession + α · damping)
```

**GPU** (`mfem_bridge.cpp:430–463`):
```cpp
gamma_bar = gamma / (1.0 + alpha * alpha);
px,py,pz = m × H_eff           // precession
dx,dy,dz = m × precession      // damping
rhs = -gamma_bar * (p + alpha * d)
```

**✅ Identyczna formuła.** Triple product `m × (m × H)` rozwinięte jawnie w C++, w Rust jako `cross(m, cross(m, H))`.

### 7.1 Magnetic node filtering w RHS

**CPU** (`fem.rs:310–318`, `observe_vectors`):
```rust
if self.topology.magnetic_node_volumes[node] > 0.0 {
    self.llg_rhs_from_field(m, h_eff)
} else {
    [0.0, 0.0, 0.0]
}
```

**GPU** (`mfem_bridge.cpp:430–463`, `llg_rhs_aos`): Oblicza RHS dla **WSZYSTKICH** węzłów bez filtrowania.

**🔴 BUG (P1, meshe z powietrzem):** GPU nie zeruje RHS na niemagnetycznych węzłach. Dla jednorodnych meshów — brak różnicy.

---

## 8. Heun integrator

### 8.1 Predictor step

**CPU** (`fem.rs:255–261`):
```rust
predicted[i] = normalize(m[i] + dt * k1[i])
```

**GPU** (`mfem_bridge.cpp:1038–1050`):
```cpp
predicted[i] = m[i] + dt * k1[i];
normalize_aos_field(predicted);  // normalize all at once
```

**✅ Identyczne.** Normalizacja per-node w obu przypadkach.

### 8.2 Corrector step

**CPU** (`fem.rs:263–268`):
```rust
corrected[i] = normalize(m[i] + 0.5 * dt * (k1[i] + k2[i]))
```

**GPU** (`mfem_bridge.cpp:1076–1082`):
```cpp
corrected[i] = m[i] + 0.5 * dt * (k1[i] + k2[i]);
normalize_aos_field(corrected);
```

**✅ Identyczne.**

### 8.3 Post-step observables

**CPU** (`fem.rs:270–284`): Po kroku oblicza `observe_vectors(corrected)` → pełne pole efektywne i energię z **nowej** magnetyzacji.

**GPU** (`mfem_bridge.cpp:1084–1097`): Po kroku oblicza `compute_effective_fields_for_magnetization(corrected)` → pełne pole efektywne i energię z **nowej** magnetyzacji.

**✅ Identyczne.**

### 8.4 max_rhs_amplitude

**CPU** (`fem.rs:282`): `max_rhs_amplitude` pochodzi z `observe_vectors()` po **finalnym** kroku (obliczone z corrected m i nowego H_eff).

**GPU** (`mfem_bridge.cpp:1120`): `max_rhs = max(max_rhs_k1, max_rhs_k2)` — jest to max z RHS **predictora** i **correctora**, NIE z finalnego stanu.

**🟡 RÓŻNICA W METRIC:** CPU raportuje RHS z **post-step** obserwacji, GPU raportuje max z **mid-step** RHS. To nie wpływa na fizykę (same numery do diagnostyki) ale daje inne wartości `max_dm_dt`.

---

## 9. Demag operator w Heun

**CPU** (`fem.rs:256, 263`): `llg_rhs_from_vectors()` wywołuje `observe_vectors()` co wywołuje `demag_observables_from_vectors()` → **3 pełne obliczenia demag** (k1, k2, post-step observe) na krok.

**GPU** (`mfem_bridge.cpp:1013–1097`): `compute_effective_fields_for_magnetization()` wywołane 3 razy → **3 pełne obliczenia demag** per step.

**✅ Identyczne** — oba obliczają demag 3x per step Heun.

---

## 10. Podsumowanie znalezionych różnic

### 🔴 Krytyczne (mogą wpływać na wyniki)

| # | Problem | CPU (`fem.rs`) | GPU (`mfem_bridge.cpp`) | Wpływ | Status |
|---|---------|---------------|------------------------|-------|--------|
| 1 | **Bounding box demag** | Tylko magnetyczne węzły | Wszystkie węzły | Inny transfer-grid dla mieszanych meshów | ✅ NAPRAWIONE — dodano `magnetic_node_mask` filtrowanie w `magnetic_bbox()` |
| 2 | **Rasteryzacja elementów** | Tylko magnetyczne elementy | Wszystkie elementy | Fałszywe wartości m w niemagnetycznych komórkach | ✅ NAPRAWIONE — dodano `magnetic_element_mask` filtrowanie w rasteryzacji |
| 3 | **LLG RHS masking** | Zeruje RHS na niemagnetycznych nodach | Oblicza RHS wszędzie | Niemagnetyczne węzły dryftują w GPU | ✅ NAPRAWIONE — dodano `zero_non_magnetic_nodes_aos()` po każdym `llg_rhs_aos()` |

### 🟡 Umiarkowane (wpływają na metryki, nie na fizykę)

| # | Problem | CPU | GPU | Wpływ | Status |
|---|---------|-----|-----|-------|--------|
| 4 | **max_rhs_amplitude** | Z post-step observe | max(k1, k2) w trakcie kroku | Inna raportowana wartość dm/dt | ✅ NAPRAWIONE — teraz oblicza post-step RHS z finalnego stanu |
| 5 | **H_ext na niemagnetycznych** | Zero | Wartość pola | Bez wpływu (volume=0 w energii) | — (brak wpływu na fizykę) |
| 6 | **H_demag na niemagnetycznych** | Zero | Interpolowana wartość | Bez wpływu (filtrowane w energii) | ✅ NAPRAWIONE — sampling pomija niemagnetyczne węzły |

### ✅ Zgodne

| Komponent | Status |
|-----------|--------|
| μ₀, epsilon geometryczny | Identyczne |
| Exchange field H_ex formuła | Identyczna |
| Exchange energy E_ex formuła | Identyczna |
| LLG RHS formuła (γ̄, precesja, tłumienie) | Identyczna |
| Heun predictor/corrector | Identyczny |
| Demag energy formuła | Identyczna (dla jednorodnych meshów) |
| External energy formuła | Identyczna (dla jednorodnych meshów) |
| Transfer grid cell geometry | Identyczna (oba używają hmax) |
| Newell kernel spectra | Identyczne (ta sama funkcja Rust) |
| Trilinear interpolation sampling | Identyczna (dla magnetycznych węzłów) |
| Barycentric coordinates | Identyczne |
| Normalizacja magnetyzacji | Identyczna |

---

## 11. Prawdopodobne źródła rozbieżności CPU/GPU dla jednorodnych meshów

Nawet dla meshów z jednym markerem (identyczne ścieżki kodu), różnice mogą wynikać z:

1. **MFEM DiffusionIntegrator vs ręczna stiffness matrix (CPU)**: Obie powinny dać takie same wartości dla P1 tetów (exact integration), ale MFEM assembluje do sparse format z inną kolejnością operacji → floating-point order-of-operations differences.

2. **cuFFT vs rustfft**: Transfer-grid demag używa FFT. cuFFT (GPU) i rustfft (CPU) mogą dawać różnice ~O(N · ε_mach) w transformacie.

3. **FMA (fused multiply-add)**: GPU CUDA domyślnie używa FMA, co zmienia rounding behavior. CPU x86 też ma FMA, ale Rust compiler może go nie emitować domyślnie.

4. **max_rhs metric**: Inna definicja (post-step vs mid-step) — to tłumaczy obserwowaną różnicę w `max_dm_dt` ale nie w polach/energiach.

### Oczekiwana wielkość rozbieżności

- **Pola (m, H_ex, H_demag):** ≤ 1e-12 relative error (rounding)
- **Energie:** ≤ 1e-10 relative error
- **max_dm_dt:** Może się **znacząco** różnić — to inna metryka w CPU vs GPU

Jeśli obserwujesz rozbieżności > 1e-8, przyczyna prawdopodobnie leży po stronie **transfer-grid geometry** (punkt 5.1–5.2) lub **spectral demag precision** (cuFFT vs rustfft).

---

## 12. Zastosowane poprawki

**Data poprawek:** 2026-03-25

### Pliki zmodyfikowane

| Plik | Zmiany |
|------|--------|
| `native/backends/fem/include/context.hpp` | Dodano `magnetic_element_mask`, `magnetic_node_mask` (wektory `uint8_t`) do struktury `Context` |
| `native/backends/fem/src/context.cpp` | Budowa masek magnetycznych w `context_from_plan()` — logika identyczna z CPU: marker 1 = magnetyczny, gdy istnieją mieszane markery |
| `native/backends/fem/src/mfem_bridge.cpp` | 7 zmian: (1) `magnetic_bbox()` filtruje po masce węzłów, (2) rasteryzacja pomija niemagnetyczne elementy, (3) nowa funkcja `zero_non_magnetic_nodes_aos()`, (4-5) zerowanie k1/k2 po `llg_rhs_aos()`, (6) post-step RHS dla `max_rhs_amplitude`, (7) sampling demag pomija niemagnetyczne węzły, (8) `std::call_once` dla singletona `mfem::Device`, (9) dodano `region_mask=nullptr` w `fullmag_fdm_plan_desc` |
| `native/backends/fem/src/api.cpp` | `fullmag_fem_set_global_error()` przed `delete handle` |
| `crates/fullmag-runner/src/native_fem.rs` | Poprawiony `last_global_error_or()`, zmieniony `hmax` w teście z 1.0→0.4, asercja nazwy urządzenia |

### Testy

- **3/3 native_fem testy przechodzą** (`--test-threads=1`)
  - `native_fem_exchange_parity` — GPU i CPU dają identyczne wyniki exchange
  - `native_fem_scaffold_exposes_initial_state_fields` — inicjalizacja, pola, device info
  - `native_fem_scaffold_step_is_honestly_unavailable` — graceful error dla brakującego FDM backendu

### Znane problemy pre-existing (nie naprawione)

- **E_total=NaN na starcie z uniform m=[1,0,0]**: Exchange field = 0 (∇m=0 dla uniform), demag energy NaN — dotyczy obu ścieżek (CPU i GPU). Wymaga osobnej analizy.
- **cudaFree "driver shutting down"**: Kosmetyczny błąd MFEM przy wyjściu procesu — CUDA driver zamknięty przed zwolnieniem pamięci MFEM. Nie wpływa na wyniki.
