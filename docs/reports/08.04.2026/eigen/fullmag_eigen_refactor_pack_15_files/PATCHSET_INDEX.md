# Fullmag eigen / dispersion patchset

Ten pakiet zawiera **15 najważniejszych plików** potrzebnych do wdrożenia refaktoru ścieżki eigenmode dla `k=0` i `k≠0`, z naciskiem na:

- ścieżkę `k_sampling=Path`,
- branch tracking po overlapach,
- diagnostykę residuali / ortogonalności / tangent leakage,
- artefakty `path.json`, `samples.json`, `branches.json`, `branch_table.csv`,
- frontendowy model wyboru `(sample, branch, raw_mode)` zamiast samego `selectedMode`.

Pakiet nie udaje, że magicznie rozwiązuje wszystkie merge conflicts. To byłoby zbyt eleganckie jak na prawdziwe życie. Został przygotowany tak, żeby maksymalnie ograniczyć ręczne dopisywanie logiki w kilku wielkich plikach repo.

## Co jest w paczce

1. `packages/fullmag-py/src/fullmag/model/eigen.py`
2. `packages/fullmag-py/src/fullmag/model/outputs.py`
3. `packages/fullmag-py/src/fullmag/model/study.py`
4. `crates/fullmag-ir/src/eigen_contract.rs`
5. `crates/fullmag-runner/src/eigen/mod.rs`
6. `crates/fullmag-runner/src/eigen/types.rs`
7. `crates/fullmag-runner/src/eigen/path.rs`
8. `crates/fullmag-runner/src/eigen/assembly_scalar.rs`
9. `crates/fullmag-runner/src/eigen/tracking.rs`
10. `crates/fullmag-runner/src/eigen/diagnostics.rs`
11. `crates/fullmag-runner/src/eigen/artifacts.rs`
12. `crates/fullmag-runner/src/eigen/orchestrator.rs`
13. `apps/web/components/analyze/eigenTypes.ts`
14. `apps/web/components/analyze/EigenAnalyzeWorkbench.tsx`
15. `PATCHSET_INDEX.md`

## Zalecana kolejność integracji

### Etap 1. Kontrakt danych i Python DSL

Najpierw:

- `crates/fullmag-ir/src/eigen_contract.rs`
- `packages/fullmag-py/src/fullmag/model/eigen.py`
- `packages/fullmag-py/src/fullmag/model/outputs.py`
- `packages/fullmag-py/src/fullmag/model/study.py`

Celem jest domknięcie semantyki:

- `KSamplingIR::Path`
- `KPointIR`
- `ModeTrackingIR`
- `SampleSelectorIR`
- `EigenDiagnostics`

### Etap 2. Runner i artefakty

Następnie:

- `crates/fullmag-runner/src/eigen/*`

Ten etap porządkuje pipeline bez wymuszania od razu pełnej zmiany fizyki operatora. Nadal można używać obecnego jądra `reference_scalar_tangent`, ale wreszcie da się uruchomić sensowny multi-`k` workflow i wypluć czytelne artefakty.

### Etap 3. Frontend Analyze

Na końcu:

- `apps/web/components/analyze/eigenTypes.ts`
- `apps/web/components/analyze/EigenAnalyzeWorkbench.tsx`

Ten etap przełącza UI z modelu `selectedMode: number | null` na selekcję złożoną:

- `sampleIndex`
- `branchId`
- `rawModeIndex`

## Ręczne zmiany, których paczka nie podmienia automatycznie

Te pliki **nie są** w paczce, żeby nie rozbijać repo niepotrzebnie, ale trzeba je poprawić podczas merge:

### 1. `crates/fullmag-ir/src/lib.rs`

Dodaj:

```rust
pub mod eigen_contract;
pub use eigen_contract::*;
```

Potem usuń lub zastąp stare inline definicje:

- `KSamplingIR`
- fragment `StudyIR::Eigenmodes`
- fragment `OutputIR`
- `FemEigenPlanIR.k_sampling`

i podmień je na typy z `eigen_contract.rs`.

### 2. `crates/fullmag-runner/src/lib.rs`

Dodaj:

```rust
mod eigen;
```

i w obecnym `fem_eigen.rs` wstaw wywołanie nowego orkiestratora z `eigen/orchestrator.rs`.

### 3. `packages/fullmag-py/src/fullmag/model/__init__.py`

Dorexportuj przynajmniej:

- `KPoint`
- `KPath`
- `ModeTracking`
- `SaveEigenDiagnostics`
- opcjonalnie `FrequencyResponse`

### 4. `packages/fullmag-py/src/fullmag/__init__.py`

Zrób re-export tych samych symboli do płaskiego API.

### 5. Loader artefaktów w `apps/web`

`EigenAnalyzeWorkbench.tsx` zakłada, że loader potrafi wczytać:

- `eigen/path.json`
- `eigen/samples.json`
- `eigen/branches.json`
- `eigen/diagnostics/*.json`
- `eigen/modes/sample_XXXX/mode_YYYY.json`

Jeśli obecny loader czyta tylko `spectrum.json` i stary `dispersion.csv`, trzeba dopisać mapowanie po nowych ścieżkach.

## Status techniczny plików w paczce

- pliki Python są blisko gotowych do użycia,
- pliki TypeScript są gotowe jako sensowny punkt startowy i mają wsteczną zgodność dla starych artefaktów,
- pliki Rust runnera są **celowo modułowe** i częściowo szkieletowe,
- najwięcej ręcznej transplantacji nadal wymaga wpięcie obecnego single-`k` solvera do `orchestrator.rs`.

To jest świadome. Lepiej dostać porządną architekturę z wyraźnym miejscem na graft obecnego kernela niż jeszcze jeden tysiącliniowy plik, którego nikt poza autorem nie ruszy bez kaca.

## Minimalne kryterium ukończenia wdrożenia

1. `k_vector` dalej działa jako alias do `k_sampling=Single`
2. `KPath` daje wiele sampli w jednym runie
3. runner zapisuje `path.json`, `samples.json`, `branches.json`, `branch_table.csv`
4. frontend umie wyświetlić ciągłe branch-e i przełączać mod po `(sample, branch, rawMode)`
5. każdy run niesie jawne pole `solver_model = reference_scalar_tangent`

## Pliki w paczce są przygotowane pod założenia raportu

Semantyka odpowiada wcześniejszemu raportowi audytowemu i utrzymuje rozdzielenie:

- kontrakt danych,
- workflow multi-`k`,
- artefakty,
- frontend.

Wersja paczki: `2026-04-08`
