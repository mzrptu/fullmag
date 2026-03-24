# Plan Wdrożenia: FDM Multi-Layer Convolution Demag

## Informacje ogólne
Cel: Implementacja jawnego, objaśnialnego trybu FDM demag dla stacków warstw opartych na exact tensor kernels.
Na podstawie raportu: `docs/physics/fullmag_multilayer_convolution_report.md`

## Faza 0 — Przygotowanie kontraktu i dokumentacji
Początkowe ustalenie słownictwa pojęciowego i dokumentacji fizycznej.
- [ ] Stabilizacja nomenklatury: `single_grid`, `multilayer_convolution`, `two_d_stack`, `three_d`, `native grid`, `convolution grid`.
- [ ] Utworzenie `docs/physics/0530-fdm-multilayer-convolution-demag.md` z opisem: exact self demag tensor, shifted kernels, transfer contract, 1-layer reduction.
- [ ] Aktualizacja specyfikacji w `docs/specs/`:
  - `problem-ir-v0.md` (placement/translation, per-magnet FDM hints, multilayer FDM plan).
  - `capability-matrix-v0.md` (multilayer demag tylko w FDM, v1 eligibility matrix).
  - `geometry-policy-v0.md` (Translate jako część wspólnej semantyki geometrii).

## Faza 1 — Planner and IR groundwork (Python + Rust IR)
Umożliwienie generowania poprawnego, zwalidowanego planu bez logiki wykonawczej.
- [ ] **Python API**:
  - Dodać `fm.Translate(geometry, by=(dx, dy, dz), name="...")`.
  - Rozszerzyć typy FDM: `FDMGrid`, `FDMDemag`, dodanie per-magnet discretization hints.
  - Generowanie `Translate` oraz FDM hints w modelu i eksporcie do IR.
- [ ] **fullmag-ir**: 
  - Rozszerzyć `GeometryEntryIR` o enuma `Translate { base, by, name }`.
  - Zastąpić płaskie FDM hints nowymi wariantami (`FdmGridHintsIR`, `FdmDemagHintsIR`).
- [ ] **fullmag-plan**:
  - Wprowadzić nowy enum `FdmPlanIR::UniformGrid | MultilayerConvolution`.
  - Dodać analizę eligibility dla `multilayer_convolution` (sprawdzanie geometrii, extents, dobieranie trybu np. `two_d_stack`).
  - Generować strukturę `FdmMultilayerSummaryIR`.
- [ ] Dodać polecenie `fullmag plan script.py --backend fdm --explain` po stronie CLI, aby móc testować planning bez uruchamiania.

## Faza 2 — Exact single-layer tensor demag on CPU
Gruntowna zmiana obecnego, prostego spectral projection FDM demag w jednym magnetzie na dokładny Newell tensor.
- [ ] Przenieść matematykę do nowego dedykowanego modułu/crate'a (np. `crates/fullmag-fdm-demag` lub `fullmag-demag-kernels`) by współdzielić ją między CPU a CUDA.
- [ ] Zaimplementować generator "exact self Newell tensor" oraz "FFT-domain packing" (jednolity 6-elementowy wektor zespolony).
- [ ] W `fullmag-engine` zmodyfikować referencyjny path FDM demag do przeliczania demag metodą newellowską (forward FFT -> tensor multiply -> inverse FFT).
- [ ] *Testy:* Porównać energię i pola z metodą przestrzenną (`direct evaluate`) dla małych siatek 1 warstwy.

## Faza 3 — Multilayer CPU Reference
Rozszerzenie pathu w Rust CPU na wiele warstw.
- [ ] Dodać `transfer operator` (`push_m` i `pull_h`) obsługujący przeskalowywanie między `native grid` a `convolution grid`.
- [ ] Dodać generowanie `shifted kernels` oraz ewentualnie `irregular kernels` do `fullmag-fdm-demag`.
- [ ] Zaimplementować `DemagOperatorRuntime::MultilayerConvolution` na CPU:
  - Iteracja przez wszystkie destination layers i source layers ($O(L^2)$).
  - Pełny proces: wyciągnij `m_native`, `push_m`, FFT, przemnóż pary kerneli, inverse FFT, `pull_h`, akumuluj do `h_demag`.
- [ ] *Testy:* Porównać 1-warstwowy multilayer z single-layer exact demag, i 2-warstwowy symetryczny przypadek.

## Faza 4 — CUDA ABI v2 + Generic GPU path
Optymalizacja i odblokowanie backendu sprzętowego.
- [ ] Zaprojektować i wdrożyć nowe ABI C (`fullmag_fdm_multilayer_plan_desc_v2`), zastępujące dotychczasową, płaską, jednowarstwową deskrypcję.
- [ ] Po stronie hosta (Rust) wygenerować wszystkie kernele w przestrzeni FFT i wgrać via ffi do native backend.
- [ ] Napisać w `native/backends/fdm` obsługę struktur `native_grid`, `conv_grid`, generic pairwise multiply kernel, wywoływanie cuFFT batch per layer.
- [ ] *Testy:* Gwarancja tych samych precyzyjnych wyników między Host (CPU reference) a GPU CUDA z exact tensor.

## Faza 5 — Session API / GUI / Artifacts (Obserwowalność)
Dostosowanie web based Control Roomu, by prezentował wielowarstwową strukturę problemu.
- [ ] Wprowadzić nowy `Layer registry` do output schema API (JSON).
- [ ] Dostosować Live Streaming by wysyłał małe podsumowania stanu (bez `m` każdej warstwy per krok).
- [ ] Zbudować field fetch (On-Demand) w stylu `GET /v1/runs/{id}/fields/{quantity}?layer={layer_id}&step=latest`.
- [ ] Aktualizacja UI Control Room:
  - Plan / Diagnostics panel (Eligibility, pair kernels, estimated mem).
  - Layer Selector w okienku Vector/Scalar field view.
- [ ] Artifacts Output: Zapisywać `.npz` dla każdej warstwy osobno np. `fields/m/layer-free/step...` obsługiwany zbiorczym `manifest.json`.

## Faza 6 — Optymalizacje (V1.1 / V2)
Późniejsze iteracje, nie blokujące core'u v1:
- [ ] exact-match kernel reuse cache.
- [ ] redukcja użycia pamięci za pomocą z shift symmetry: `inverse_shifted`.
- [ ] R2C/Hermitian packing (optymalizacja złożoności tensorowej storage).
- [ ] Obsługa skomplikowanych brył w `three_d` oraz trybek arbitrarnej geometrii rotowanych i transfer maskings.
