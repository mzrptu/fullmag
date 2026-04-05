# Fullmag FEM GPU enablement bundle

Zawartość:

- `patches/fullmag_fem_gpu_patchset_runtime.patch` — zmiany w ABI/FFI/runnerze i diagnostyce fallbacków.
- `patches/fullmag_fem_gpu_patchset_container.patch` — zmiany w obrazie `docker/fem-gpu` i `compose.yaml`.
- `patches/000*.patch` — te same zmiany rozbite na mniejsze, łatwiejsze do review patche.
- `files/` — komplet gotowych plików po zmianach, w układzie zgodnym z repo.
- `verify_fem_gpu_enablement.sh` — skrypt smoke-testów po wdrożeniu.

## Zalecana kolejność wdrożenia

Z katalogu głównego repo:

```bash
git apply /path/to/fullmag_fem_gpu_enablement_bundle/patches/fullmag_fem_gpu_patchset_runtime.patch
git apply /path/to/fullmag_fem_gpu_enablement_bundle/patches/fullmag_fem_gpu_patchset_container.patch
```

Gdyby `git apply` nie wszedł bez fuzzów, użyj plików z `files/` jako referencji do ręcznego merge.

## Co robi ten pakiet

1. Dodaje pełną diagnostykę dostępności backendu FEM GPU zamiast samego `bool`.
2. Uszczelnia dispatch, żeby wymuszone GPU nie spadało po cichu do CPU bez powodu.
3. Domyślnie wyłącza policyjny fallback `FULLMAG_FEM_GPU_MIN_NODES=10000`, który maskował działające GPU na małych/średnich meshach.
4. Buduje obraz `fem-gpu` z `libCEED` i `MFEM_USE_CEED=YES`.
5. Ustawia domyślny MFEM device string na `ceed-cuda:/gpu/cuda/shared` w środowisku GPU.

## Czego ten pakiet jeszcze NIE kończy

Ten pakiet **nie** przepisuje jeszcze `mfem_bridge.cpp` na pełne `AssemblyLevel::PARTIAL` / libCEED operator action dla exchange/demag. Po wdrożeniu GPU będzie:

- poprawnie budowane i wybierane,
- przestanie chować fallbacki,
- będzie miało CEED-ready runtime,

ale pełny etap "GPU-first FEM" nadal wymaga osobnego refactoru operatorów i ograniczenia host-side loops.

## Weryfikacja po wdrożeniu

Uruchom:

```bash
/path/to/fullmag_fem_gpu_enablement_bundle/verify_fem_gpu_enablement.sh
```

albo ręcznie:

```bash
docker compose build fem-gpu
docker compose run --rm --no-deps fem-gpu bash -lc 'nvidia-smi'
docker compose run --rm --no-deps fem-gpu bash -lc 'ldconfig -p | grep -E "libmfem|libceed|libHYPRE"'
docker compose run --rm --no-deps fem-gpu bash -lc 'cargo test -p fullmag-runner native_fem::tests::native_fem_scaffold_exposes_initial_state_fields --features fem-gpu -- --nocapture'
docker compose run --rm --no-deps fem-gpu bash -lc 'cargo test -p fullmag-runner native_fem::tests::native_fem_exchange_only_matches_cpu_reference_when_mfem_stack_is_available --features fem-gpu -- --nocapture'
```
