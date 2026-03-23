# Fullmag agents guide

## North star

Fullmag opisuje **problem fizyczny**, a nie reprezentację numeryczną. Każda zmiana musi utrzymywać ten kontrakt.

## Golden rule: physics before implementation

To jest zasada **niepomijalna**.

Każdy etap wdrożenia fizyki lub numeryki — np. mesh, exchange, demag, DMI, anisotropy, time integration, coupling, boundary conditions, sampling, walidacja — **musi najpierw dostać dokument fizyczny** w `docs/physics/` napisany w stylu notatki/publikacji naukowej.

Ten dokument musi opisywać co najmniej:

1. problem fizyczny i jego znaczenie,
2. równania, założenia i konwencje,
3. jednostki oraz zakres obowiązywania modelu,
4. relację do `ProblemIR`, plannerów i backendów,
5. kryteria kompletności implementacji w całej aplikacji,
6. plan walidacji numerycznej i/lub analitycznej,
7. ograniczenia, ryzyka i rzeczy odłożone.

**Dopiero po takim opisie wolno wdrażać kod.** Jeśli dokumentacja fizyczna nie istnieje albo jest niekompletna, zadanie nie jest gotowe do implementacji.

## Architectural guardrails

1. Wspólna warstwa DSL i `ProblemIR` nie może eksponować indeksów komórek, layoutu gridu ani szczegółów FEM.
2. Tryby `strict`, `extended`, `hybrid` muszą być jawne w semantyce i dokumentacji.
3. Rust jest control-plane: parser, IR, planner, API, scheduler, runner, provenance.
4. C++/CUDA pozostaje warstwą obliczeniową; interfejs do Rust przechodzi przez stabilne C ABI.
5. Kontenery są domyślną drogą uruchamiania i budowania projektu.
6. ADR-y i specyfikacje są częścią kodu: przy zmianie architektury aktualizuj dokumentację wraz z implementacją.
7. Każda funkcja fizyczna musi mieć ślad w `docs/physics/` zanim trafi do kodu produkcyjnego.

## Repo map

- `crates/fullmag-ir` — canonical problem model i typy domenowe.
- `crates/fullmag-cli` — lokalny runner i narzędzia developerskie.
- `crates/fullmag-api` — control-plane HTTP API.
- `apps/web` — Next.js control room.
- `native/` — backendy natywne i C ABI.
- `proto/` — kontrakty między usługami.
- `docs/adr` — decyzje architektoniczne.
- `docs/specs` — specyfikacje semantyczne i IR.
- `docs/physics` — dokumentacja fizyczna pisana jak publikacje/notatki naukowe dla każdego etapu wdrożenia.
- `.agents/skills` — runtime skille agentowe (`SKILL.md`) dla workflowów implementacyjnych.
- `.agents/workflows` — sekwencje pracy agentów (physics gate, feature delivery, completeness review).

## Definition of done for early changes

- Zmiana ma jasny wpływ na architekturę lub MVP.
- Jest zgodna z zasadą physics-first DSL.
- Ma kompletny dokument fizyczny w `docs/physics/`, jeśli dotyczy modelu, dyskretyzacji lub walidacji fizyki.
- Daje się uruchomić albo zweryfikować w środowisku kontenerowym.
- Dokumentacja nie zostaje z tyłu.
