# Fullmag

Fullmag to nowy silnik micromagnetics budowany wokół jednej zasady:

> **wspólny interfejs opisuje problem fizyczny, nie siatkę numeryczną**

Repo zostało zainicjowane jako **container-first monorepo** dla architektury:

- **Python (`fullmag`)** — obiektowy interfejs do definiowania problemów,
- **Rust** — control-plane, `ProblemIR`, planner, API, scheduler, runner, provenance,
- **Next.js** — control room dla użytkownika,
- **C++/CUDA** — backendy obliczeniowe i wydajne kernelle,
- **MFEM + libCEED + hypre** — planowana ścieżka FEM,
- **FDM / FEM / hybrid** — trzy tryby wykonania nad jedną semantyką problemu.

## Dlaczego ten projekt istnieje

Fullmag ma umożliwić opisanie **jednego problemu fizycznego**, a następnie uruchomienie go przez backend:

- `fdm`,
- `fem`,
- `hybrid`.

Wspólny Python API `fullmag` i `ProblemIR` opisują:

- geometrię,
- regiony,
- materiały,
- termy energii,
- dynamikę,
- pobudzenia,
- outputy,
- politykę backendu i walidacji.

Nie opisują natomiast indeksów komórek, layoutu pamięci ani szczegółów FEM/FDM. Te rzeczy są odpowiedzialnością planera i backendów.

## Aktualny stan bootstrapu

Na starcie repo zawiera:

- scaffold monorepo dla Rust + web + native,
- zalążek obowiązkowej dokumentacji fizycznej w `docs/physics/`,
- draft `ProblemIR`,
- minimalne `CLI` i `API` w Ruście,
- pierwszy layout aplikacji Next.js,
- kontrakt C ABI dla backendów natywnych,
- dokumenty architektoniczne i ADR-y,
- instrukcje dla Copilota, agentów, promptów i skills,
- kontenerowy workflow deweloperski.

To jest celowo **solidny szkielet**, a nie jeszcze pełny solver. Najpierw granice, potem głębokość. Architektura lubi być rozpieszczona od początku.

## Struktura repo

```text
apps/web                 Next.js control room
packages/fullmag-py      Python API do budowania problemów
crates/fullmag-ir        canonical ProblemIR i typy domenowe
crates/fullmag-cli       lokalne narzędzia developerskie
crates/fullmag-api       HTTP API control-plane
native/                  backendy natywne i C ABI
proto/                   kontrakty usług / workerów
docs/                    scope, ADR-y, specyfikacje, physics notes
.github/                 instrukcje, agenci, skills, prompty, CI
docker/                  obrazy developerskie
examples/                przykładowe problemy / wejścia robocze
```

## Złota zasada projektu

Przed implementacją każdej nowej fizyki lub numeryki tworzymy dokument w `docs/physics/`.

To nie jest sugestia. To jest warunek wejścia do implementacji.

Dokument ma opisywać model fizyczny jak notatkę lub publikację naukową: równania, założenia, jednostki, interpretację FDM/FEM/hybrid, wpływ na Python API i `ProblemIR`, strategię walidacji oraz kryteria kompletności w całej aplikacji.

## Szybki start

### 1. Uzupełnij zmienne środowiskowe

Repo zawiera już `.env` z placeholderami, bo `compose.yaml` ich wymaga:

- `POSTGRES_PASSWORD`
- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- `RUST_LOG`

### 2. Uruchom środowisko developerskie

Opcjonalne komendy:

```text
make up
make shell
```

Po wejściu do kontenera możesz uruchamiać Rust i web bez brudzenia hosta.

### 3. Sprawdź bootstrap

Opcjonalne komendy:

```text
cargo check --workspace
cargo run -p fullmag-cli -- doctor
cargo run -p fullmag-cli -- example-ir
```

## Dokumenty, które warto przeczytać najpierw

- `docs/1_project_scope.md` — główna wizja projektu,
- `docs/2_repo_blueprint.md` — mapa repo i przepływ MVP,
- `docs/physics/README.md` — zasady dokumentacji fizycznej,
- `docs/physics/0000-physics-documentation-standard.md` — standard pisania physics notes,
- `docs/specs/problem-ir-v0.md` — draft canonical `ProblemIR`,
- `docs/specs/capability-matrix-v0.md` — założenia capability matrix,
- `docs/adr/0001-physics-first-dsl.md` — wspólny Python API opisuje fizykę,
- `docs/adr/0002-container-first-monorepo.md` — monorepo i kontenery.

## Najbliższe kroki

1. Rozwinąć Python API `fullmag` i `ProblemIR` do wersji implementacyjnej.
2. Dodać semantic validator i planner seam.
3. Zaimplementować pierwszy `ExecutionPlan` i capability checks.
4. Uruchomić produkcyjny szkielet backendu FDM.
5. Rozbudować web do edycji problemu i przeglądu jobów.

## Zasady projektowe

- **physics-first Python API**,
- **physics notes before code**,
- **typed IR before planner magic**,
- **backend capability matrix from day one**,
- **container-first dev flow**,
- **C ABI at Rust/native boundary**,
- **docs and code evolve together**.

## Status

Bootstrapped on 2026-03-23.
