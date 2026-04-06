# Fullmag Unified Binary + Tauri Packaging Plan
## Launcher + runtime packs + desktop shell — skorygowany plan wykonawczy
## Data: 2026-04-06 (rev 3)

---

## 1. Cel dokumentu

Ten dokument jest **planem wykonawczym** dla przeksztalcenia Fullmaga z aplikacji
browser-only w produkt desktopowy z instalatorem, zachowujac jednoczesnie
pelna kompatybilnosc z trybem przegladarkowym.

Kluczowe zmiany architektoniczne:

- odchodzimy od `Electron` — przechodzimy na `Tauri` jako desktop shell,
- formalizujemy manifest-driven runtime discovery,
- rozdzielamy **HostCapabilityMatrix** (statyczna, z manifestow) od **BackendCapabilities** (dynamiczna, per engine),
- definiujemy jawna polityke fallbackow z trailem w metadata sesji,
- wdrazamy installer per platforma (Linux `.run` + Windows `.msi`).

Model produktu:

- `bin/fullmag` jako jedyny publiczny launcher,
- `fullmag-api` jako local control-plane,
- `web/` jako frontend bundle (wspolny dla browser i desktop),
- `runtimes/*` jako sidecar runtime packs,
- `fullmag ui` jako desktop entrypoint (top-level command, nie flaga).

> Fullmag desktop powinien byc budowany jako `Rust launcher + Rust API + Tauri shell + runtime packs`, a nie jako `Electron + Chromium + Node bundle`.

### 1.1. Korekty rev 3 wzgledem rev 2

Po zestawieniu planu z aktualnym stanem codebase:

1. **`fullmag ui` zamiast `fullmag --ui`** — `ScriptCli.script` jest mandatory `PathBuf`,
   wiec `--ui` bez pliku nie wpasuje sie w obecny parser. `ui` staje sie osobnym
   top-level `Command` variantem, analogicznie do istniejacego `doctor`.

2. **No-session bootstrap** — `GET /v1/live/current/bootstrap` zwraca 404
   gdy nie ma aktywnej sesji. Start Hub wymaga nowego kontraktu bootstrapu
   bez sesji albo osobnej trasy.

3. **Reuse `RuntimeResolutionSummary`** — w `crates/fullmag-cli/src/types.rs` juz
   istnieje typ z polami `requested_backend`, `resolved_backend`, `requested_device`,
   `requested_precision`, `preferred_runtime_family`, `local_engine_id`. Nie startujemy
   od zera — podnosimy go do roli kanonicznego trail.

4. **Rozszerzenie istniejacego `doctor`** — `fullmag doctor` juz istnieje jako
   `Command::Doctor`. Diagnostyke runtime packow dodajemy DO niego, zamiast
   tworzenia osobnego `fullmag runtime doctor`.

5. **Fallback: manual vs auto** — reczny wybor tuple w UI = brak automatycznego
   fallbacku (blad). Tryb `auto` i sciezki CLI moga fallbackowac, ale z pelnym
   `resolved_*` trail. To zachowuje ucziwosc UX bez psucia automatyzacji.

6. **Refactor `control_room.rs`** — wydzielenie wspolnego bootstrap UI (spawn API,
   wait ready, publish snapshot, resolve URL) i dwoch openerow (browser / Tauri),
   zamiast dodawania `ui_mode: bool`.

7. **Trzy poziomy capability** — istniejacy `capability-matrix-v0.md` opisuje 
   legalnosc semantyczna (planner/runtime), `HostCapabilityMatrix` opisuje
   dostepnosc hostowa, `BackendCapabilities` opisuje mozliwosci jednego engine'u.

8. **`SceneDocument scene.v1`** — solver config w authoringu powinien zyc w
   `SceneDocument.study`, ktory jest canonical authoring document.

9. **Zmiana kolejnosci etapow** — registry + API → metadata trail → refactor
   launch path → `ui` command + Start Hub → Tauri shell → solver selector
   → dispatch refactor → packaging.

---

## 2. Decyzja architektoniczna

### 2.1. Czego nie robimy

- jednego gigantycznego monolitycznego `ELF/EXE`,
- osobnego desktop-only frontendu,
- drugiego niezaleznego hosta w innym jezyku,
- przepisywania UI na natywne widgety,
- desktopowego flow opartego o `Electron`.

### 2.2. Co robimy

Jeden produkt logiczny:

```text
fullmag/
  bin/
    fullmag              ← publiczny wrapper/launcher
    fullmag-bin          ← launcher binary
    fullmag-api          ← local API server
    fullmag-ui           ← Tauri desktop shell (internal)
  lib/
    libfullmag_fdm.so.0
    libcudart.so.12
    libcufft.so.11
  python/
    bin/python3.12
    lib/python3.12/site-packages/
  web/
    index.html
    _next/
  packages/
    fullmag-py/src/fullmag/
  runtimes/
    cpu-reference/
      manifest.json
    fdm-cuda/
      bin/fullmag-fdm-cuda-bin
      manifest.json
    fem-gpu/
      bin/fullmag-fem-gpu-bin
      lib/libmfem.so.4.7.0
      lib/libcudart.so.*
      lib/libcusparse.so.*
      manifest.json
  examples/
  share/
    version.json
    licenses/
    fullmag.desktop      ← Linux desktop entry
  uninstall.sh
```

### 2.3. Dlaczego Tauri zamiast Electron

1. Fullmag jest projektem Rust-first — launcher, API, runner sa w Rust.
2. Tauri naturalnie pasuje do istniejacego launchera i API.
3. Jeden host technologiczny zamiast dokladania Node/Chromium.
4. Lzejszy produkt (~15 MB Tauri vs ~150 MB Electron).
5. Reuse frontendu webowego bez rozszczepiania aplikacji.

> Electron moze byc fallbackiem prototypowym; docelowy produkt opiera sie o Tauri.

---

## 3. Publiczny interfejs produktu

### 3.0. Dlaczego `fullmag ui` a nie `fullmag --ui`

Obecny `ScriptCli` w `args.rs` wymaga mandatory positional `script: PathBuf`:

```rust
pub(crate) struct ScriptCli {
    pub script: PathBuf,   // <— nie Option, wiec wymagany
    pub interactive: bool,
    pub backend: Option<BackendArg>,
    // ...
}
```

`is_script_mode()` w `main.rs` rozpoznaje tryb skryptowy przez reczna liste flag.
Dodanie `--ui` bez pliku **nie wpasuje sie w ten parser** — clap parsowaloby
`--ui` jako wartosc `script: PathBuf`.

Rozwiazanie: `ui` jest **osobnym top-level `Command`** (jak istniejacy `doctor`),
z wlasnym struct `UiCli` ktory ma `script: Option<PathBuf>`:

```rust
pub(crate) enum Command {
    Doctor,
    Ui(UiCli),    // ← NOWE
    // ... istniejace ...
}

#[derive(Parser, Debug)]
pub(crate) struct UiCli {
    /// Optional script to open in desktop workspace
    pub script: Option<PathBuf>,
    #[arg(long)]
    pub backend: Option<BackendArg>,
    #[arg(long)]
    pub precision: Option<PrecisionArg>,
    #[arg(long)]
    pub mode: Option<ModeArg>,
    #[arg(long, default_value_t = false)]
    pub dev: bool,
    #[arg(long)]
    pub web_port: Option<u16>,
}
```

`is_script_mode()` musi dodac `"ui"` do listy znanych subcommands.

### 3.1. Docelowy interfejs CLI

```bash
fullmag ui                                         # Start Hub w Tauri
fullmag ui my_problem.py                           # direct workspace open
fullmag ui --backend fem --precision double x.py   # z jawnym solver selection
fullmag ui --dev                                   # dev mode + Tauri
fullmag my_problem.py                              # browser mode (obecny flow)
fullmag --headless my_problem.py                   # bez UI
fullmag doctor                                     # diagnostyka (istniejacy + rozszerzony)
```

### 3.2. `fullmag ui` (bez skryptu)

- uruchamia local control plane (`fullmag-api`),
- NIE materializuje sesji — frontend otwiera **Start Hub**,
- shell desktopowy = Tauri window ladujacy lokalny URL,
- wymaga no-session bootstrap (→ §3.6).

### 3.3. `fullmag ui script.py`

- uruchamia API + materializuje sesje,
- Tauri przechodzi od razu do workspace tej symulacji.

### 3.4. `fullmag script.py`

- zachowuje obecny browser/static-web flow,
- NIE uruchamia Tauri.

### 3.5. `fullmag --headless script.py`

- bez desktop shell-a, tylko backend execution.

### 3.6. `fullmag doctor` (rozszerzony)

Istniejacy `Command::Doctor` w `main.rs` dzis drukuje statyczna liste:

```rust
Command::Doctor => {
    println!("fullmag status");
    println!("- public authoring surface: embedded Python API");
    // ... statyczne linie ...
}
```

Rozszerzamy o sekcje runtime discovery:

```
fullmag doctor
  fullmag status
  - public authoring surface: embedded Python API
  - ...

  runtime packs:
  ✓ fdm + cpu + double [cpu-reference]  available
  ✓ fdm + gpu + double [fdm-cuda]       available
  ✓ fem + cpu + double [cpu-reference]  available
  ✗ fem + gpu + double [fem-gpu]        missing_driver (CUDA driver not found)
```

NIE tworzymy osobnego `fullmag runtime doctor` — rozszerzamy istniejacy `doctor`.

### 3.7. No-session bootstrap — nowy kontrakt

Dzis `GET /v1/live/current/bootstrap` zwraca 404 z `no active local live workspace`
gdy nie ma aktywnej sesji (w `session.rs::current_live_session_id()`).

`fullmag ui` bez skryptu wymaga nowego kontraktu:

**Opcja A: Nowy endpoint `GET /v1/hub/bootstrap`**

```json
{
  "mode": "hub",
  "capabilities": { /* HostCapabilityMatrix */ },
  "recent_sessions": [
    { "session_id": "...", "problem_name": "...", "status": "finished", "started_at": ... }
  ],
  "examples": [
    { "name": "exchange_relax.py", "path": "examples/exchange_relax.py" }
  ]
}
```

**Opcja B: Bootstrap zwraca `mode: "hub"` zamiast 404**

Zmienic `GET /v1/live/current/bootstrap` aby zamiast 404 zwracac:

```json
{
  "mode": "hub",
  "session": null,
  "capabilities": { /* HostCapabilityMatrix */ }
}
```

Frontend sprawdza `bootstrap.mode === "hub"` i wyswietla Start Hub,
albo `bootstrap.mode === "workspace"` i wyswietla control room.

**Rekomendacja: Opcja B** — prostsza, jeden endpoint, backward-compatible
(stary frontend ignoruje `mode` i dalej pokazuje brak sesji).

---

## 4. Model desktop shell-a

### 4.1. Zasada glowna

**Tauri nie hostuje solvera.** Tauri jest tylko desktopowym shellem:

```text
fullmag ui [script.py]
  → spawn fullmag-api (port 8080-8089)
  → wait_for_api_ready()
  → [jesli script] publish_current_live_workspace_snapshot()
  → [jesli !script] API w trybie hub (no-session bootstrap)
  → spawn web frontend (port 3000-3010 lub static via API)
  → spawn fullmag-ui (Tauri)
  → Tauri laduje http://localhost:{port}/
```

### 4.2. V1 desktop flow

- `fullmag-api` pozostaje zrodlem prawdy,
- Tauri `WebviewWindow` laduje lokalny URL,
- frontend identyczny jak dla browser mode,
- preload / command bridge jest minimalny.

NIE robimy w V1:

- custom protocol `file://` / `fullmag://`,
- dublowania logiki bootstrap/session w desktop shell-u.

### 4.3. Minimalny desktop bridge

V1 Tauri bridge obsługuje:

- `open_file_dialog` — otwieranie skryptow `.py`,
- `save_file_dialog` — eksport artefaktow,
- `reveal_in_file_manager` — folder sesji,
- `copy_path` — sciezka do artefaktu,
- `window_lifecycle` — close/minimize/maximize,
- `open_recent` — ostatnie sesje.

NIE przenosimy do Tauri:

- runtime orchestration,
- session state source of truth,
- solver selection source of truth,
- live preview transport.

### 4.4. Refactor `control_room.rs` — wspolny bootstrap

Obecny `spawn_control_room()` laczy bootstrap (spawn API, wait ready, publish snapshot,
resolve web URL) z otwieraniem przegladarki przez `which_opener()`.

Refaktor polega na **wydzieleniu wspolnego bootstrap UI** i dwoch openerow:

```rust
/// Common bootstrap: spawn API, wait, publish, resolve URL.
pub(crate) fn bootstrap_control_plane(
    session_id: &str,
    dev_mode: bool,
    requested_port: Option<u16>,
    live_workspace: Option<&LocalLiveWorkspace>,  // None = hub mode
) -> Result<ControlPlaneReady> {
    // 1. spawn fullmag-api
    // 2. wait_for_api_ready()
    // 3. if live_workspace: publish_current_live_workspace_snapshot()
    // 4. resolve web URL (static or dev)
    // 5. return ControlPlaneReady { api_port, web_url, guards }
}

pub(crate) struct ControlPlaneReady {
    pub api_port: u16,
    pub web_url: String,
    pub guard: ControlRoomGuard,
}

/// Browser opener (for `fullmag script.py`)
pub(crate) fn open_in_browser(ready: &ControlPlaneReady) { ... }

/// Tauri opener (for `fullmag ui [script.py]`)
pub(crate) fn open_in_tauri(ready: &ControlPlaneReady) -> Result<()> { ... }
```

To pozwala:
- `fullmag script.py` → `bootstrap_control_plane(with session) + open_in_browser()`
- `fullmag ui script.py` → `bootstrap_control_plane(with session) + open_in_tauri()`
- `fullmag ui` → `bootstrap_control_plane(no session) + open_in_tauri()`

---

## 5. Solver/runtime contract — TRZY POZIOMY CAPABILITY

### 5.1. Trzy istniejace poziomy

W repo Fullmaga istnieja juz trzy rozne koncepty "capability" na roznych warstwach.
Plan musi je jawnie rozroznic, a nie mieszac:

**Poziom 1: Spec-level — `capability-matrix-v0.md`**

Istniejacy dokument `docs/specs/capability-matrix-v0.md` definiuje **semantyczna legalnosc**
funkcji na poziomie planner/runtime: ktory physics feature (Exchange, Demag, Zeeman, LLG,
Relaxation...) jest `semantic-only`, `internal-reference`, czy `public-executable` dla
kazdego backendu (FDM/FEM/Hybrid). Zawiera tez zasady plannerowe (`backend="auto"` → `fdm`
dla strict/extended) i tolerancje cross-backend.

> Ten dokument nie mowi nic o tym, co jest zainstalowane na hoscie.

**Poziom 2: Host-level — `HostCapabilityMatrix` (NOWE)**

Statyczna macierz: co ten host moze uruchomic? Budowana z `runtimes/*/manifest.json`
+ diagnostyki hosta (CUDA driver, worker binary presence).

**Poziom 3: Engine-level — `BackendCapabilities` (ISTNIEJACE)**

Dynamiczna per-sesja: co ten konkretny engine umie robic z tym konkretnym problemem?
Supported terms, preview quantities, scalar outputs.

### 5.2. Problem obecny

Dzis istnieje jeden typ `BackendCapabilities` (w `fullmag-runner/src/capabilities.rs`)
ktory opisuje capabilities **jednego resolved engine'u**: supported terms, preview quantities,
scalar outputs. Jest to model engine-centric (poziom 3).

Brakuje natomiast modelu **host-wide** (poziom 2) — macierzy wszystkich dostepnych tuples
backend × device × precision × mode, z jawnym statusem kazdego.

Portable packaging (`scripts/package_fullmag_portable.sh`) juz generuje manifesty
runtime packow z tuple'ami `backend/device/mode/precision/public` — format jest poprawny.
Np. `fdm-cuda` manifest ma `single` z `public: false` (experimental) i `double` z
`public: true` (production). **Podwaliny istnieja — trzeba je podniesc do roli
kanonicznego host registry.**

Dispatch w `dispatch.rs` opiera sie na env vars (`FULLMAG_FDM_EXECUTION`, `FULLMAG_FEM_EXECUTION`)
i compile-time feature flags (`feature = "cuda"`, `feature = "fem-gpu"`), z licznymi
silent fallbackami GPU → CPU.

### 5.3. Korekta: dwa nowe typy danych (poziom 2 i reuse poziomu 3)

**Typ 1: `HostCapabilityMatrix`** — statyczny, budowany z manifestow runtime packow + diagnostyki hosta.

Odpowiada na pytanie: "co ten host moze uruchomic?"

```rust
pub struct HostCapabilityMatrix {
    pub profile_version: String,
    pub engines: Vec<HostEngineEntry>,
}

pub struct HostEngineEntry {
    pub backend: String,       // "fdm" | "fem"
    pub device: String,        // "cpu" | "gpu"
    pub precision: String,     // "single" | "double"
    pub mode: String,          // "strict" | "extended" | "hybrid"
    pub runtime_family: String,// "cpu-reference" | "fdm-cuda" | "fem-gpu"
    pub worker: String,        // relative path to worker binary
    pub status: EngineAvailabilityStatus,
    pub status_reason: Option<String>,
    pub public: bool,
    pub stability: String,     // "production" | "experimental"
}

pub enum EngineAvailabilityStatus {
    Available,
    MissingRuntime,
    MissingDriver,
    MissingLibrary,
    FeatureGated,
    Experimental,
}
```

**Typ 2: `BackendCapabilities`** — dynamiczny, per resolved engine, per sesja.

Odpowiada na pytanie: "co ten konkretny engine umie robic z tym konkretnym problemem?"

```rust
// ISTNIEJACY TYP — bez zmian
pub struct BackendCapabilities {
    pub engine_id: RuntimeEngineId,
    pub capability_profile_version: String,
    pub supported_terms: Vec<String>,
    pub supported_demag_realizations: Vec<String>,
    pub preview_quantities: Vec<String>,
    pub snapshot_quantities: Vec<String>,
    pub scalar_outputs: Vec<String>,
    pub approximate_operators: Vec<String>,
    pub supports_lossy_fallback_override: bool,
}
```

**Relacja**: `HostCapabilityMatrix` mowi "ktore engine tuples sa dostepne",
`BackendCapabilities` mowi "co wybrany engine umie z danym problemem".
API wystawia oba — pierwszy statycznie, drugi dynamicznie per sesja.

### 5.4. Manifest runtime packa

Manifesty juz istnieja w `scripts/package_fullmag_portable.sh::write_runtime_manifests()`.
Format jest poprawny:

```json
{
  "family": "fdm-cuda",
  "version": "0.1.0-preprod",
  "worker": "bin/fullmag-fdm-cuda-bin",
  "engines": [
    {
      "backend": "fdm",
      "device": "gpu",
      "precision": "double",
      "mode": "strict",
      "public": true,
      "stability": "production"
    },
    {
      "backend": "fdm",
      "device": "gpu",
      "precision": "single",
      "mode": "strict",
      "public": false,
      "stability": "experimental"
    }
  ]
}
```

Trzeba: parser w Rust, discovery, walidacje dostepnosci (worker exists, CUDA driver present).

### 5.5. Polityka fallbackow — KOREKTA (manual vs auto)

Obecny `dispatch.rs` ma trzy kategorie fallbackow:

**Kategoria A: brak runtime** — GPU requested ale binary nie istnieje.
→ **Docelowo: blad**. UI nie powinno pozwalac wybrac niedostepnego tuple.

**Kategoria B: brak drivera** — runtime istnieje ale CUDA driver absent.
→ **Docelowo: blad z jawnym komunikatem** "CUDA driver not found".

**Kategoria C: ograniczenie engine'u** — GPU available ale problem wymaga
`current_modules` (nie wspierane), `fe_order > 1`, lub mesh ma < N nodes.
→ Zalezy od kontekstu:

**Nowa zasada: rozroznienie manual vs auto:**

| Kontekst | Tuple source | Fallback kategorii C |
|----------|-------------|---------------------|
| UI explicit selection | User wybral konkretny tuple | **BLAD** — user poprosil o GPU, user dostaje blad z wyjasniem |
| `--backend fem --device gpu` CLI | User explicit | **BLAD** — jw. |
| `backend="auto"` (w ProblemIR) | Planner auto-resolution | **Dozwolony** z pelnym trail |
| `fullmag script.py` (bez flag) | Implicit auto | **Dozwolony** z pelnym trail |
| `fullmag --headless script.py` | Implicit auto | **Dozwolony** z pelnym trail |

Zasada: **reczny wybor tuple = brak automatycznego fallbacku**.
Tryb `auto` i sciezki nieinteraktywne moga fallbackowac, ale z pelnym `resolved_*` trail.
To zachowuje ucziwosc UX bez psucia automatyzacji CLI.

Spec `runtime-distribution-and-managed-backends-v1.md` §9 potwierdza:
"fall back only if scientifically honest → record actual resolved runtime in provenance".

Dla dozwolonego fallbacku (auto) definiujemy pole `resolved_fallback`:

```rust
pub struct ResolvedFallback {
    pub occurred: bool,
    pub original_engine: String,
    pub fallback_engine: String,
    pub reason: FallbackReason,
    pub message: String,
}

pub enum FallbackReason {
    CurrentModulesNotSupported,
    FeOrderUnsupported { requested: u32, max_supported: u32 },
    MeshTooSmallForGpu { node_count: usize, min_nodes: usize },
    UnsupportedTerms { terms: Vec<String> },
}
```

Zasada: fallback kategorii C jest **dozwolony wylacznie w trybie auto**, ale musi byc:
- jawnie zapisany w `SessionManifest.resolved_fallback`,
- widoczny w UI jako ostrzezenie,
- logowany w engine console.

Dla recznego (explicit) wyboru tuple: fallback jest **bledem**, nie ostrzezeniem.

### 5.6. Zasada produktu

> Solver picker ma byc capability-driven, nie oparty o frontendowe stale.
> UI nie moze udawac dostepnosci. Jesli tuple nie jest dostepne — widac je, ale nie mozna wybrac.

---

## 6. Metadata sesji i API

### 6.1. SessionManifest — rozszerzenie

**Istniejacy `RuntimeResolutionSummary`** (w `crates/fullmag-cli/src/types.rs`):

```rust
pub(crate) struct RuntimeResolutionSummary {
    pub script_mode: bool,
    pub requested_backend: String,
    pub resolved_backend: String,
    pub requested_device: String,
    pub requested_precision: String,
    pub preferred_runtime_family: String,
    pub local_engine_id: Option<String>,
    pub local_engine_label: Option<String>,
    pub requires_managed_runtime: bool,
    pub entrypoint_kind: String,
}
```

Ten typ juz ma czesc pol requested/resolved. NIE startujemy od zera —
podnosimy te pola do poziomu `SessionManifest` i API.

Obecny `SessionManifest` w `fullmag-api/src/types.rs`:

```rust
pub struct SessionManifest {
    pub session_id: String,
    pub run_id: String,
    pub status: String,
    pub interactive_session_requested: bool,
    pub script_path: String,
    pub problem_name: String,
    pub requested_backend: String,      // ← istnieje
    pub execution_mode: String,         // ← istnieje
    pub precision: String,              // ← istnieje
    pub artifact_dir: String,
    pub started_at_unix_ms: u128,
    pub finished_at_unix_ms: u128,
    pub plan_summary: serde_json::Value,
}
```

Rozszerzamy o:

```rust
pub struct SessionManifest {
    // --- istniejace pola (bez zmian) ---
    pub session_id: String,
    pub run_id: String,
    pub status: String,
    pub interactive_session_requested: bool,
    pub script_path: String,
    pub problem_name: String,
    pub artifact_dir: String,
    pub started_at_unix_ms: u128,
    pub finished_at_unix_ms: u128,
    pub plan_summary: serde_json::Value,

    // --- requested (user intent) ---
    pub requested_backend: String,      // "auto" | "fdm" | "fem" | "hybrid"
    pub requested_device: String,       // "auto" | "cpu" | "gpu"    ← NOWE
    pub requested_precision: String,    // "single" | "double"       (rename z `precision`)
    pub requested_mode: String,         // "strict" | "extended"     (rename z `execution_mode`)

    // --- resolved (actual execution) ---
    pub resolved_backend: Option<String>,         // "fdm" | "fem"   ← NOWE
    pub resolved_device: Option<String>,          // "cpu" | "gpu"   ← NOWE
    pub resolved_precision: Option<String>,       // "single" | "double" ← NOWE
    pub resolved_mode: Option<String>,            // "strict" | ...  ← NOWE
    pub resolved_runtime_family: Option<String>,  // "cpu-reference" | "fdm-cuda" | "fem-gpu" ← NOWE
    pub resolved_engine_id: Option<String>,       // "fdm_cpu_reference" | "fdm_cuda" | ... ← NOWE
    pub resolved_worker: Option<String>,          // worker binary path ← NOWE

    // --- fallback trail ---
    pub resolved_fallback: Option<ResolvedFallback>, // ← NOWE
}
```

Frontend TypeScript mirror (`apps/web/lib/session/types.ts`):

```typescript
export interface SessionManifest {
  session_id: string;
  run_id: string;
  status: string;
  interactive_session_requested: boolean;
  script_path: string;
  problem_name: string;
  artifact_dir: string;
  started_at_unix_ms: number;
  finished_at_unix_ms: number;
  plan_summary?: Record<string, unknown>;

  // requested
  requested_backend: string;
  requested_device: string;
  requested_precision: string;
  requested_mode: string;

  // resolved
  resolved_backend?: string;
  resolved_device?: string;
  resolved_precision?: string;
  resolved_mode?: string;
  resolved_runtime_family?: string;
  resolved_engine_id?: string;
  resolved_worker?: string;

  // fallback
  resolved_fallback?: {
    occurred: boolean;
    original_engine: string;
    fallback_engine: string;
    reason: string;
    message: string;
  };
}
```

### 6.2. Dwa endpointy API

**Endpoint 1: Host capability matrix (statyczny)**

```
GET /v1/runtime/capabilities
```

Odpowiedz:

```json
{
  "profile_version": "2026-04-06",
  "engines": [
    {
      "backend": "fdm",
      "device": "cpu",
      "precision": "double",
      "mode": "strict",
      "runtime_family": "cpu-reference",
      "status": "available",
      "status_reason": null,
      "public": true,
      "stability": "production"
    },
    {
      "backend": "fem",
      "device": "gpu",
      "precision": "double",
      "mode": "strict",
      "runtime_family": "fem-gpu",
      "status": "missing_driver",
      "status_reason": "CUDA driver not found (libcuda.so not loadable)",
      "public": true,
      "stability": "production"
    }
  ]
}
```

To jest **statyczne** — nie zalezy od problemu, tylko od zainstalowanych runtime packow i hosta.

**Endpoint 2: Resolved engine capabilities (dynamiczny, per sesja)**

```
GET /v1/live/current/state
```

W istniejacym `SessionStateResponse.capabilities: Option<BackendCapabilities>` —
zwraca capabilities resolved engine'u (supported terms, quantities itd.) dla aktualnej sesji.

**To juz istnieje** — nie wymaga zmian. Trzeba tylko upewnic sie ze `capabilities` jest
zawsze wypelnione po resolve.

### 6.3. Zrodlo prawdy

Zrodlem prawdy jest:
- `runtimes/*/manifest.json` — co jest zainstalowane,
- diagnostyka hosta (CUDA driver, GPU availability) — co jest dostepne,
- resolver w runtime registry — mapowanie tuple → worker.

Frontend **nie** jest zrodlem prawdy. Frontend tylko renderuje to co dostanie z API.

---

## 7. UI solver selector

### 7.1. Komponent `<SolverSelector>`

Nowy komponent w drzewie sidebara, pod sekcja "Study / Solver":

```
┌─────────────────────────────────────┐
│ Solver Configuration                │
├─────────────────────────────────────┤
│ Backend    [Auto ▾] [FDM] [FEM]    │
│ Device     [Auto ▾] [CPU] [GPU]    │
│ Precision  [Single] [Double ▾]     │
│ Mode       [Strict ▾]              │
├─────────────────────────────────────┤
│ ✓ Resolved: fem_native_gpu         │
│   double · GPU · strict            │
│                                     │
│ ⚠ Fallback: fe_order=2 → CPU ref   │
│   GPU supports fe_order=1 only      │
└─────────────────────────────────────┘
```

### 7.2. Availability badges

Dla kazdego wariantu UI pokazuje:

| Status | Badge | Kolor |
|--------|-------|-------|
| `available` | ✓ Available | green |
| `missing_runtime` | ✗ Not installed | gray |
| `missing_driver` | ✗ Driver missing | red |
| `missing_library` | ✗ Library missing | red |
| `feature_gated` | ⊘ Gated | yellow |
| `experimental` | ⚗ Experimental | orange |

### 7.3. Zasada UX

- Niedostepne tuple widoczne, ale disabled z tooltip komunikatem.
- Dostepne tuple klikalne — natychmiastowe preview resolved engine.
- Po wybraniu tuple — resolved metadata aktualizowane w sesji.
- Fallback trail wyswietlany jako warning w UI (nie ukrywany).

### 7.4. Relacja z authoringiem i live runem

- Solver selector czescia konfiguracji sesji (nie tylko statusbar).
- Mozna ustawic przy authoringu → requested_* w SessionManifest.
- Mozna inspectowac przy live runie → resolved_* + fallback trail.
- StatusBar nadal wyswietla resolved engine syntetycznie.

### 7.5. Relacja z `SceneDocument scene.v1`

`SceneDocument` (w `crates/fullmag-authoring/src/scene.rs`) jest canonical authoring
document. Ma juz `study: SceneStudyState` — to naturalne miejsce na solver config:

```rust
pub struct SceneDocument {
    pub version: String,           // "scene.v1"
    pub scene: SceneMetadata,
    pub universe: Option<ScriptBuilderUniverseState>,
    pub objects: Vec<SceneObject>,
    pub materials: Vec<SceneMaterialAsset>,
    pub study: SceneStudyState,    // ← solver config tu
    pub outputs: SceneOutputsState,
    pub editor: SceneEditorState,
    // ...
}
```

Docelowo `SceneStudyState` powinien zawierac `requested_backend`, `requested_device`,
`requested_precision`, `requested_mode` — aby solver selection byl czescia authoring
document, a nie tylko sesji runtime. To pozwala:
- zapisanie solver config w pliku `.fullmag-scene.json`,
- odtworzenie solver selection przy re-open workspace,
- sync miedzy frontendem a backendem przez `SceneDocument`.

> `capability-matrix-v0.md` jawnie stwierdza: "SceneDocument scene.v1 is the canonical
> control-room authoring document, but execution legality remains governed by ProblemIR
> and backend capability rules."

---

## 8. Desktop shell Tauri

### 8.1. `apps/desktop/` layout

```
apps/desktop/
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs
      commands.rs
    icons/
  README.md
```

### 8.2. `fullmag-ui` jako internal executable

- NIE jest publicznym entrypointem,
- uruchamia go launcher `fullmag ui`,
- launcher przekazuje env vars: `FULLMAG_UI_URL`, `FULLMAG_API_BASE`, `FULLMAG_LAUNCH_INTENT`.

### 8.3. Mechanika startu

```
fullmag ui script.py
  │
  ├─ 1. bootstrap_control_plane(session)
  │     ├─ spawn fullmag-api na porcie 8080-8089
  │     ├─ wait_for_api_ready()
  │     ├─ publish_current_live_workspace_snapshot()
  │     └─ resolve web URL
  ├─ 2. open_in_tauri(ready)
  │     ├─ spawn fullmag-ui z env:
  │     │     FULLMAG_UI_URL=http://localhost:8083/
  │     │     FULLMAG_API_BASE=http://localhost:8083/
  │     │     FULLMAG_LAUNCH_INTENT=workspace
  │     └─ Tauri otwiera okno, laduje URL
  └─ 3. await guard (SIGTERM on exit)

fullmag ui  (bez skryptu)
  │
  ├─ 1. bootstrap_control_plane(no session)
  │     ├─ spawn fullmag-api (tryb hub)
  │     ├─ wait_for_api_ready()
  │     └─ resolve web URL
  ├─ 2. open_in_tauri(ready) z LAUNCH_INTENT=hub
  └─ 3. await guard
```

### 8.4. Dev mode

- `fullmag ui --dev script.py` — API + Next.js dev server + Tauri (dev URL)
- `fullmag ui script.py` — API + static web + Tauri (static URL)
- `fullmag ui --dev` — hub mode z dev frontend
- Niesupported combinations → jawny blad, nie fallback.

---

## 9. Packaging + Installer

### 9.1. Linux portable bundle

Rozszerzenie istniejacego `scripts/package_fullmag_portable.sh`:

```bash
# dodanie fullmag-ui do bundle
if [[ -x "${REPO_ROOT}/target/release/fullmag-ui" ]]; then
  cp -a "${REPO_ROOT}/target/release/fullmag-ui" "${BUNDLE_ROOT}/bin/"
  "$PATCHELF_BIN" --set-rpath '$ORIGIN/../lib' "${BUNDLE_ROOT}/bin/fullmag-ui"
fi
```

### 9.2. Linux installer — makeself `.run`

```bash
# budowanie self-extracting installer
makeself --zstd \
  "${BUNDLE_ROOT}" \
  "fullmag-${VERSION}-linux-x86_64.run" \
  "Fullmag ${VERSION} Installer" \
  ./install.sh
```

`install.sh` wewnatrz bundle:

```bash
#!/usr/bin/env bash
set -euo pipefail
DEFAULT_PREFIX="$HOME/.local/fullmag"
read -p "Installation directory [$DEFAULT_PREFIX]: " PREFIX
PREFIX="${PREFIX:-$DEFAULT_PREFIX}"
mkdir -p "$PREFIX"
cp -a bin lib python web packages runtimes examples share "$PREFIX/"
# ...PATH registration, desktop entry...
echo "Fullmag installed to $PREFIX"
echo "Add to PATH: export PATH=\"$PREFIX/bin:\$PATH\""
```

### 9.3. Windows — WiX `.msi`

```xml
<!-- fullmag.wxs — komponent selection -->
<Feature Id="Core" Title="Core" Level="1" Absent="disallow">
  <ComponentGroupRef Id="Binaries" />
  <ComponentGroupRef Id="WebAssets" />
</Feature>
<Feature Id="PythonRuntime" Title="Python Runtime" Level="1">
  <ComponentGroupRef Id="PythonFiles" />
</Feature>
<Feature Id="CpuReference" Title="CPU Reference Runtime" Level="1">
  <ComponentGroupRef Id="RuntimeCpuReference" />
</Feature>
<Feature Id="FdmCuda" Title="FDM CUDA Runtime" Level="1000">
  <ComponentGroupRef Id="RuntimeFdmCuda" />
</Feature>
<Feature Id="FemGpu" Title="FEM GPU Runtime" Level="1000">
  <ComponentGroupRef Id="RuntimeFemGpu" />
</Feature>
<Feature Id="Examples" Title="Examples" Level="1000">
  <ComponentGroupRef Id="ExampleFiles" />
</Feature>
```

Windows V1: CPU-only + FDM CUDA. FEM GPU na Windows = "coming soon".

### 9.4. Co nie robimy jeszcze

- macOS target,
- cross-platform installer,
- auto-updater,
- desktop-only asset pipeline.

---

---

## 10. Etapy wdrozenia — SZCZEGOLOWY PLAN WYKONAWCZY

### Kolejnosc etapow (skorygowana rev 3)

Zmiana kolejnosci wzgledem rev 2 — uzasadnienie:
- Registry + API najpierw, bo reszta od nich zalezy.
- Metadata trail przed UI, bo solver selector potrzebuje resolved_* danych.
- Refactor launch path PRZED dodaniem `fullmag ui`, bo ui wymaga wspolnego bootstrap.
- Start Hub wymaga no-session bootstrap, wiec po refactor launch path.
- Tauri shell po `fullmag ui` (jest tylko openerem).
- Solver selector po metadata trail + API (potrzebuje obu).

```
Etap 1: Runtime registry + rozszerzony doctor + /v1/runtime/capabilities
Etap 2: Requested/resolved metadata trail w SessionManifest
Etap 3: Refactor control_room.rs — wspolny bootstrap, dwa openery
Etap 4: `fullmag ui` command + no-session bootstrap (Start Hub)
Etap 5: apps/desktop — Tauri shell
Etap 6: UI solver selector
Etap 7: Dispatch refactor — manifest-driven resolution
Etap 8: Linux release bundle + installer
Etap 9: Windows parity
```

---

### ═══════════════════════════════════════════════════════════
### ETAP 1: Runtime registry + rozszerzony doctor + API endpoint
### ═══════════════════════════════════════════════════════════

**Cel**: Manifest-driven runtime discovery. Rozszerzenie istniejacego `doctor`.
Nowy endpoint `/v1/runtime/capabilities`.

> **STATUS IMPLEMENTACJI (audyt 2026-04-06):**
>
> | Element | Status | Uwagi |
> |---------|--------|-------|
> | `runtime_registry.rs` modul | ✅ DONE | Publiczny w lib.rs, re-exported |
> | `RuntimeRegistry::discover()` | ✅ DONE | Skanuje `runtimes/*/manifest.json` |
> | `HostCapabilityMatrix` / `HostEngineEntry` | ✅ DONE | W runtime_registry.rs |
> | GPU detection | ✅ DONE (inaczej) | Uzywa `native_fdm::is_cuda_available()` / `native_fem::is_gpu_available()`, NIE libc::dlopen |
> | Unit testy discover()+matrix | ✅ DONE | `#[cfg(test)] mod tests` w runtime_registry.rs |
> | Rozszerzenie `Command::Doctor` | ❌ NIE DONE | `Doctor` nadal statyczna lista; runtime jest w osobnym `Command::Runtime(RuntimeCommand::Doctor)` |
> | `/v1/runtime/capabilities` endpoint | ❌ NIE DONE | Brak w routerze; hub bootstrap zwraca capabilities, ale brak dedykowanego endpointu |
> | `useRuntimeCapabilities.ts` hook | ❌ NIE DONE | Katalog `lib/hooks/` nie istnieje |

**Pliki do zmiany (POZOSTALE):**

| Crate / app | Plik | Zmiana |
|-------------|------|--------|
| `fullmag-cli` | `src/main.rs` | **DECYZJA**: albo (A) przenieść logike `RuntimeCommand::Doctor` do `Command::Doctor`, albo (B) zostawic osobny subcommand. Plan mowi A, kod ma B. |
| `fullmag-api` | `src/main.rs` | dodac route `/v1/runtime/capabilities` (handler moze reusowac logike z hub bootstrap) |
| `apps/web` | `lib/hooks/useRuntimeCapabilities.ts` | **NOWY** — fetch hook |

---

#### 1.1. `runtime_registry.rs` — JUZ ZAIMPLEMENTOWANY

> **Modul istnieje** w `crates/fullmag-runner/src/runtime_registry.rs`.
> Publiczny w `lib.rs`, re-exporty: `RuntimeRegistry`, `HostCapabilityMatrix`,
> `HostEngineEntry`, `EngineAvailabilityStatus`, `RuntimeManifest`.
>
> **UWAGA**: GPU detection NIE uzywa `libc::dlopen` — zamiast tego deleguje do
> `native_fdm::is_cuda_available()` i `native_fem::is_gpu_available()` przez
> helper `gpu_available_for_backend()`. Dep `libc` NIE jest potrzebny.
> Plan §1.1 mial bledu kod z `libc::dlopen` — nieaktualny.
>
> Testy jednostkowe istnieja w `#[cfg(test)] mod tests`.

#### 1.2. `Command::Doctor` vs `Command::Runtime(RuntimeCommand::Doctor)` — DECYZJA

Plan mowi: "rozszerzamy istniejacy `Command::Doctor`".

Stan faktyczny w kodzie:
- `Command::Doctor` — nadal statyczna lista 7 linii `println!`
- `Command::Runtime(RuntimeCommand::Doctor)` — oddzielny subcommand z pelna
  logika `RuntimeRegistry::discover()` + capability matrix

**Opcje:**
- **A)** Przenieść logikę z `RuntimeCommand::Doctor` do `Command::Doctor`
  i usunac `Runtime` subcommand. (Plan tak mowi.)
- **B)** Zostawic jak jest — dwa komendy (`doctor` + `runtime doctor`).

> **REKOMENDACJA: Opcja B (zostawic)** — `fullmag runtime doctor` jest bardziej
> discovery-specific, `fullmag doctor` jest ogolnym status checklistem.
> Ewentualnie dodac jednolinijkowy link w `doctor`: `"run `fullmag runtime doctor` for runtime details"`.
> To jest decyzja stylistyczna, nie blokujaca.

#### 1.3. POZOSTALE: Nowy endpoint `/v1/runtime/capabilities`

W `fullmag-api/src/main.rs` dodac route:

```rust
.route("/v1/runtime/capabilities", get(get_runtime_capabilities))
```

Handler moze reusowac logike z istniejacego hub bootstrap w `session.rs`:

```rust
async fn get_runtime_capabilities(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let runtimes_dir = state.repo_root.join("runtimes");  // repo_root, NIE install_root
    let registry = RuntimeRegistry::discover(&runtimes_dir);
    let matrix = registry.capability_matrix();
    Json(matrix)
}
```

> **UWAGA**: `AppState` juz ma `repo_root: PathBuf` — NIE trzeba dodawac
> `install_root`. Plan mial blad: "(opcjonalnie) AppState.install_root" jest
> niepotrzebne.

#### 1.4. POZOSTALE: Frontend hook `useRuntimeCapabilities.ts`

Katalog `apps/web/lib/hooks/` nie istnieje — trzeba go stworzyc.
Alternatywnie plik moze byc w `apps/web/lib/api/` lub `apps/web/lib/session/`.

```typescript
import { useEffect, useState } from "react";
import { currentLiveApiClient } from "@/lib/liveApiClient";

export interface HostEngineEntry {
  backend: string;
  device: string;
  precision: string;
  mode: string;
  runtime_family: string;
  worker: string;
  status: "available" | "missing_runtime" | "missing_driver" |
          "missing_library" | "feature_gated" | "experimental";
  status_reason?: string;
  public: boolean;
  stability: string;
}

export interface HostCapabilityMatrix {
  profile_version: string;
  engines: HostEngineEntry[];
}

export function useRuntimeCapabilities(): HostCapabilityMatrix | null {
  const [matrix, setMatrix] = useState<HostCapabilityMatrix | null>(null);
  useEffect(() => {
    const client = currentLiveApiClient();
    const url = client.urls.bootstrap.replace(
      "/v1/live/current/bootstrap",
      "/v1/runtime/capabilities"
    );
    fetch(url, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setMatrix(data as HostCapabilityMatrix))
      .catch((err) => console.warn("Failed to fetch runtime capabilities:", err));
  }, []);
  return matrix;
}
```

> **ALTERNATYWA**: Bootstrap hub mode juz zwraca `capabilities` w JSON.
> Hook moze parsowac capabilities z bootstrap response zamiast osobnego fetch.
> Decyzja: osobny endpoint jest czystszy (cache'owalny, niezalezny od sesji).

#### 1.5. Kryterium ukonczenia Etapu 1 (ZAKTUALIZOWANE)

- ~~`fullmag doctor` wypisuje sekcje runtime~~ → LUB `fullmag runtime doctor` (juz dziala)
- `GET /v1/runtime/capabilities` zwraca JSON z HostCapabilityMatrix ← **JEDYNY brakujacy backend element**
- Frontend hook odczytuje macierz ← **BRAKUJE**
- ~~Unit test: `RuntimeRegistry::discover()`~~ → ✅ JUZ ISTNIEJE
- ~~Unit test: `cuda_driver_available()`~~ → N/A (nie uzywamy libc::dlopen)

---

### ═══════════════════════════════════════════════════════════
### ETAP 2: Requested/resolved metadata trail w SessionManifest
### ═══════════════════════════════════════════════════════════

**Cel**: Kazdy run zapisuje kompletny trail requested → resolved → fallback.
Reuse istniejacego `RuntimeResolutionSummary`.

> **STATUS IMPLEMENTACJI (audyt 2026-04-06):**
>
> | Element | Status | Uwagi |
> |---------|--------|-------|
> | `ResolvedFallback` struct | ✅ DONE | `fullmag-runner/src/types.rs` l.572 |
> | `EngineResolution<E>` generic | ✅ DONE | `dispatch.rs` — generic over FdmEngine/FemEngine |
> | `resolve_fem_engine_with_trail()` | ✅ DONE | Ale bierze tylko `&ProblemIR`, **bez `explicit_selection`** |
> | `resolve_fdm_engine_with_trail()` | ✅ DONE | jw. |
> | `resolve_fem_engine()` backward compat | ✅ DONE | Thin wrapper |
> | `SessionManifest` z `resolved_*` polami | ✅ DONE | W obu: CLI types.rs i API types.rs |
> | `SessionRuntimeSelection` struct | ✅ DONE | Oddzielny struct z requested/resolved parami |
> | Frontend TS `SessionManifest` mirror | ✅ DONE | `apps/web/lib/session/types.ts` z `ResolvedFallback` |
> | `explicit_selection: bool` param | ❌ NIE DONE | Fallbacki nie rozrozniaja manual vs auto |
> | `FallbackReason` enum | ❌ NIE DONE | `reason` jest `String`, nie enum |
> | `RuntimeResolutionSummary` z resolved_* | ❌ NIE DONE | Brak resolved_device/precision/mode/worker/fallback |

**Pliki do zmiany (POZOSTALE):**

| Crate / app | Plik | Zmiana |
|-------------|------|--------|
| `fullmag-runner` | `src/dispatch.rs` | Dodac `explicit_selection: bool` do `resolve_*_with_trail()` — explicit → Err zamiast fallback |
| `fullmag-cli` | `src/types.rs` | Rozszerzyc `RuntimeResolutionSummary` o `resolved_device`, `resolved_precision`, `resolved_mode`, `resolved_runtime_family`, `resolved_worker`, `resolved_fallback` |
| `apps/web` | `lib/session/normalize.ts` | Sprawdzic backward compat |

---

#### 2.1. `ResolvedFallback` — JUZ ZAIMPLEMENTOWANY

W `fullmag-runner/src/types.rs` (l.572):

```rust
pub struct ResolvedFallback {
    pub occurred: bool,
    pub original_engine: String,
    pub fallback_engine: String,
    pub reason: String,      // String, nie enum
    pub message: String,
}
```

> **UWAGA**: Plan proponowal `FallbackReason` enum.
> Kod uzywa `reason: String` z machine-readable kodami (np. `"fe_order_unsupported"`).
> **DECYZJA**: Zostawic String — latwiejsze w serializacji, frontend juz parsuje.
> Enum mozna dodac pozniej przy potrzebie.

#### 2.2. `EngineResolution<E>` + resolve_*_with_trail() — JUZ ZAIMPLEMENTOWANE

`dispatch.rs` ma juz:

```rust
pub(crate) struct EngineResolution<E> {
    pub engine: E,
    pub fallback: Option<ResolvedFallback>,
}

pub(crate) fn resolve_fem_engine_with_trail(
    problem: &ProblemIR,
) -> Result<EngineResolution<FemEngine>, RunError>

pub(crate) fn resolve_fdm_engine_with_trail(
    problem: &ProblemIR,
) -> Result<EngineResolution<FdmEngine>, RunError>

// backward compat
pub(crate) fn resolve_fem_engine(problem: &ProblemIR) -> Result<FemEngine, RunError>
pub(crate) fn resolve_fdm_engine(problem: &ProblemIR) -> Result<FdmEngine, RunError>
```

#### 2.3. POZOSTALE: Dodac `explicit_selection: bool`

Obecne `resolve_*_with_trail()` nie rozrozniaja manual vs auto.
Trzeba dodac parametr:

```rust
pub(crate) fn resolve_fem_engine_with_trail(
    problem: &ProblemIR,
    explicit_selection: bool,  // true = user wybral tuple w UI/CLI
) -> Result<EngineResolution<FemEngine>, RunError> {
    // istniejaca logika z dwoma zmianami:
    // 1. przy fallback GPU→CPU: jesli explicit_selection → return Err
    // 2. jesli !explicit_selection → fallback dozwolony, tworzymy ResolvedFallback
}
```

Kluczowa zmiana: `explicit_selection: bool` kontroluje czy fallback jest bledem czy ostrzezeniem.
Backward compat wrapper bez zmian (przekazuje `false`).

#### 2.4. POZOSTALE: Rozszerzenie `RuntimeResolutionSummary`

W `fullmag-cli/src/types.rs` — obecny struct (l.153):

```rust
pub(crate) struct RuntimeResolutionSummary {
    // --- istniejace ---
    pub script_mode: bool,
    pub requested_backend: String,
    pub resolved_backend: String,
    pub requested_device: String,
    pub requested_precision: String,
    pub preferred_runtime_family: String,
    pub local_engine_id: Option<String>,
    pub local_engine_label: Option<String>,
    pub requires_managed_runtime: bool,
    pub entrypoint_kind: String,

    // --- NOWE ---
    pub resolved_device: Option<String>,
    pub resolved_precision: Option<String>,
    pub resolved_mode: Option<String>,
    pub resolved_runtime_family: Option<String>,
    pub resolved_worker: Option<String>,
    pub resolved_fallback: Option<ResolvedFallback>,
}
```

#### 2.5. `SessionManifest` — JUZ ZAIMPLEMENTOWANY

W `fullmag-api/src/types.rs` i `fullmag-cli/src/types.ts` SessionManifest juz ma
wszystkie pola requested_* + resolved_* + resolved_fallback.
W `fullmag-cli/src/types.rs` istnieje tez `SessionRuntimeSelection` z tym samym zestawem.

#### 2.6. Frontend mirror — JUZ ZAIMPLEMENTOWANY

`apps/web/lib/session/types.ts` juz ma `SessionManifest` z `ResolvedFallback` interface.
Backward-compat w normalize — sprawdzic.

#### 2.7. Kryterium ukonczenia Etapu 2 (ZAKTUALIZOWANE)

- ~~`SessionManifest` serializowany z `resolved_*` i `resolved_fallback`~~ → ✅ JUZ DONE
- ~~Frontend parsuje nowe pola~~ → ✅ JUZ DONE
- Explicit backend selection (`--backend fem --device gpu`) → blad przy fallback ← **BRAKUJE**
- Auto mode → fallback z trailem → ✅ JUZ DONE (ale bez rozroznienia explicit/auto)
- `RuntimeResolutionSummary` z resolved_* polami ← **BRAKUJE**
- Test: explicit selection + fallback → error ← **BRAKUJE**

---

### ═══════════════════════════════════════════════════════════
### ETAP 3: Refactor control_room.rs — wspolny bootstrap
### ═══════════════════════════════════════════════════════════

**Cel**: Wydzielic wspolny bootstrap z `spawn_control_room()`.
Zostawic dwa openery: browser i Tauri (przygotowanie pod Etap 4-5).

> **STATUS IMPLEMENTACJI (audyt 2026-04-06): ✅ 100% ZAIMPLEMENTOWANY**
>
> | Element | Status | Lokalizacja |
> |---------|--------|-------------|
> | `ControlPlaneReady` struct | ✅ DONE | `control_room.rs` l.89 |
> | `bootstrap_control_plane()` | ✅ DONE | `control_room.rs` l.115, sygnatura: `(session_id, dev_mode, requested_port, live_workspace: Option<&LocalLiveWorkspace>)` |
> | `open_in_browser()` | ✅ DONE | `control_room.rs` l.251, osobna funkcja |
> | `open_in_tauri()` | ✅ DONE | `control_room.rs` l.~282, uzywa `find_fullmag_ui_binary()` |
> | `find_fullmag_ui_binary()` | ✅ DONE | `control_room.rs`, szuka `fullmag-ui` binary |
> | `spawn_control_room()` backward compat | ✅ DONE | `control_room.rs` l.311, wrapper na `bootstrap_control_plane()` |
> | `ControlRoomGuard` + `Drop` | ✅ DONE | `control_room.rs`, terminate children on drop |
> | Hub mode (live_workspace=None) | ✅ DONE | `bootstrap_control_plane()` akceptuje `Option<&LocalLiveWorkspace>` |
>
> **ZERO POZOSTALYCH ZADAN w Etapie 3.**
> Kod jest dokładnie taki jak plan opisiwal. Mozna przejsc do nastepnego etapu.

#### 3.1. Referencja istniejacych sygnatur

```rust
// control_room.rs l.89
pub(crate) struct ControlPlaneReady {
    pub api_port: u16,
    pub web_url: String,
    pub web_port: u16,
    pub api_child: std::process::Child,
    pub frontend_child: Option<std::process::Child>,
}

// l.115
pub(crate) fn bootstrap_control_plane(
    session_id: &str,
    dev_mode: bool,
    requested_port: Option<u16>,
    live_workspace: Option<&LocalLiveWorkspace>,
) -> Result<ControlPlaneReady>

// l.251
pub(crate) fn open_in_browser(ready: &ControlPlaneReady)

// l.~282
pub(crate) fn open_in_tauri(ready: &ControlPlaneReady, intent: &str) -> Result<std::process::Child>

// l.311 backward compat
pub(crate) fn spawn_control_room(...) -> Result<(...)>
```

#### 3.2. Kryterium ukonczenia Etapu 3 (ZAKTUALIZOWANE)

- ~~Istniejacy `fullmag script.py` dziala identycznie~~ → ✅ DONE (backward compat via wrapper)
- ~~`bootstrap_control_plane()` wyodrebniony i testowalny~~ → ✅ DONE
- ~~`open_in_browser()` i `open_in_tauri()` sa osobnymi funkcjami~~ → ✅ DONE
- ~~`open_in_tauri()` szuka i uruchamia `fullmag-ui` binary~~ → ✅ DONE

---

### ═══════════════════════════════════════════════════════════
### ETAP 4: `fullmag ui` command + no-session bootstrap
### ═══════════════════════════════════════════════════════════

**Cel**: `fullmag ui` jako top-level command. Start Hub bez aktywnej sesji.

> **STATUS IMPLEMENTACJI (audyt 2026-04-06): ✅ ~95% ZAIMPLEMENTOWANY**
>
> | Element | Status | Lokalizacja |
> |---------|--------|-------------|
> | `Command::Ui(UiCli)` w enum | ✅ DONE | `args.rs` — w `Command` enum |
> | `UiCli` struct z polami | ✅ DONE | `args.rs` — `script, backend, mode, precision, dev, web_port` |
> | `"ui"` w `is_script_mode()` | ✅ DONE | `args.rs` — SUBCOMMANDS lista |
> | Handler `Command::Ui(ui)` w main.rs | ✅ DONE | `main.rs` l.46 — `prepare_live_workspace_for_ui()` → `bootstrap_control_plane()` → `open_in_tauri()` |
> | `prepare_live_workspace_for_ui()` | ✅ DONE | `orchestrator.rs` — zwraca `(String, LocalLiveWorkspace)` |
> | Hub mode bootstrap (live_workspace=None) | ✅ DONE | `session.rs` — zwraca `{ mode: "hub", session: null, capabilities: matrix }` |
> | `StartHubPage.tsx` + 5 sub-componentow | ✅ DONE | `apps/web/components/start-hub/` — 6 plikow |
> | Frontend routing hub/workspace | ✅ DONE | `app/(main)/page.tsx` → `resolveLaunchIntentFromSearchParams` |
> | `useRuntimeCapabilities.ts` hook | ❌ NIE DONE | Brak `apps/web/lib/hooks/` katalogu |
>
> **Jedyne brakujace zadanie**: `useRuntimeCapabilities.ts` hook (ten sam brak co w Etapie 1).

**Pliki do zmiany (POZOSTALE):**

| Crate / app | Plik | Zmiana |
|-------------|------|--------|
| `apps/web` | `lib/hooks/useRuntimeCapabilities.ts` | NOWY — SWR hook na `/v1/runtime/capabilities` (wymaga endpointu z Etapu 1) |

---

#### 4.1. CLI: `UiCli` — JUZ ZAIMPLEMENTOWANY

W `args.rs` juz istnieje:

```rust
#[derive(Subcommand)]
pub(crate) enum Command {
    Doctor,
    Ui(UiCli),
    Runtime(RuntimeCommand),
    ExampleIr,
    // ... reszta ...
}

#[derive(Parser, Debug)]
pub(crate) struct UiCli {
    pub script: Option<PathBuf>,
    #[arg(long)]
    pub backend: Option<BackendArg>,
    #[arg(long)]
    pub precision: Option<PrecisionArg>,
    #[arg(long)]
    pub mode: Option<ModeArg>,
    #[arg(long, default_value_t = false)]
    pub dev: bool,
    #[arg(long)]
    pub web_port: Option<u16>,
}
```

`is_script_mode()` juz zawiera `"ui"` i `"runtime"` w SUBCOMMANDS.

#### 4.2. CLI handler w main.rs — JUZ ZAIMPLEMENTOWANY

```rust
Command::Ui(ui) => {
    let (session_id, live_workspace) = prepare_live_workspace_for_ui(
        ui.script.as_deref(),
        ui.backend.as_ref(),
        ui.mode.as_ref(),
        ui.precision.as_ref(),
    )?;
    let ready = bootstrap_control_plane(
        &session_id,
        ui.dev,
        ui.web_port,
        Some(&live_workspace),  // lub None dla hub mode
    )?;
    let mut ui_child = open_in_tauri(&ready, "workspace")?;
    ui_child.wait()?;
}
```

#### 4.3. No-session bootstrap w API — JUZ ZAIMPLEMENTOWANY

`session.rs` → `get_current_live_bootstrap()`: jesli brak aktywnej sesji,
zwraca `{ mode: "hub", session: null, capabilities: <matrix> }` zamiast 404.

> **UWAGA**: Endpoint uzywa `state.repo_root` (nie `install_root` jak plan sugerowal).
> `AppState` jest opakowany w `Arc<AppState>` (extractory: `State(state): State<Arc<AppState>>`).

#### 4.4. Frontend: Start Hub — JUZ ZAIMPLEMENTOWANY

6 komponentow w `apps/web/components/start-hub/`:
- `StartHubPage.tsx`
- `StartHubShell.tsx`
- `OpenActionsSection.tsx`
- `RecentSimulationsSection.tsx`
- `ExamplesSection.tsx`
- `CreateSimulationWizard.tsx`

Routing: `app/(main)/page.tsx` → `resolveLaunchIntentFromSearchParams()` → StartHubPage.

#### 4.5. POZOSTALE: `useRuntimeCapabilities.ts` hook

Ten sam brak co w Etapie 1 — wymaga:
1. Endpointu `/v1/runtime/capabilities` (Etap 1 §1.3)
2. Nowego pliku `apps/web/lib/hooks/useRuntimeCapabilities.ts` (Etap 1 §1.5)

Kiedy Etap 1 zostanie dokonczony, ten punkt automatycznie sie zamknie.

#### 4.6. Kryterium ukonczenia Etapu 4 (ZAKTUALIZOWANE)

- ~~`fullmag ui` otwiera Tauri z workspace sesji~~ → ✅ JUZ DONE
- ~~`fullmag ui` bez skryptu otwiera Tauri z Start Hub~~ → ✅ JUZ DONE (hub mode)
- ~~Bootstrap endpoint zwraca `mode: "hub"` zamiast 404~~ → ✅ JUZ DONE
- ~~Frontend renderuje Start Hub albo workspace w zaleznosci od `mode`~~ → ✅ JUZ DONE
- `useRuntimeCapabilities.ts` hook ← **BRAKUJE** (zalezy od Etapu 1)

---

### ═══════════════════════════════════════════════════════════
### ETAP 5: apps/desktop — Tauri shell
### ═══════════════════════════════════════════════════════════

**Cel**: Minimalny desktop shell w Tauri.

**Nowe pliki:**

| Sciezka | Opis |
|---------|------|
| `apps/desktop/src-tauri/Cargo.toml` | Tauri crate config |
| `apps/desktop/src-tauri/tauri.conf.json` | Window config, CSP, plugins |
| `apps/desktop/src-tauri/src/main.rs` | Tauri entry: read env, open window |
| `apps/desktop/src-tauri/src/commands.rs` | Bridge: file dialogs, reveal, config |
| `apps/desktop/src-tauri/build.rs` | Tauri build script |
| `Cargo.toml` (workspace) | dodac member `apps/desktop/src-tauri` |

---

#### 5.1. `apps/desktop/src-tauri/Cargo.toml`

```toml
[package]
name = "fullmag-desktop"
version = "0.1.0"
edition = "2021"
publish = false

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["devtools"] }
tauri-plugin-dialog = "2"
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[[bin]]
name = "fullmag-ui"
path = "src/main.rs"
```

#### 5.2. `apps/desktop/src-tauri/tauri.conf.json`

```json
{
  "productName": "Fullmag",
  "version": "0.1.0",
  "identifier": "com.fullmag.desktop",
  "build": {
    "frontendDist": "../../web/out"
  },
  "app": {
    "windows": [
      {
        "title": "Fullmag",
        "width": 1400,
        "height": 900,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://localhost:* ws://localhost:*; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'"
    }
  },
  "plugins": {
    "dialog": {},
    "shell": { "open": true }
  }
}
```

#### 5.3. `apps/desktop/src-tauri/src/main.rs`

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
mod commands;

fn main() {
    let url = std::env::var("FULLMAG_UI_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    let api_base = std::env::var("FULLMAG_API_BASE")
        .unwrap_or_else(|_| "http://localhost:8083".to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(url.parse().unwrap()),
            )
            .title("Fullmag")
            .inner_size(1400.0, 900.0)
            .min_inner_size(800.0, 600.0)
            .center()
            .build()?;

            app.manage(commands::AppConfig { api_base: api_base.clone() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file_dialog,
            commands::reveal_in_file_manager,
            commands::get_app_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running fullmag-ui");
}
```

#### 5.4. `apps/desktop/src-tauri/src/commands.rs`

```rust
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub api_base: String,
}

#[tauri::command]
pub async fn open_file_dialog(app: AppHandle) -> Result<Option<String>, String> {
    let result = app.dialog().file()
        .add_filter("Python scripts", &["py"])
        .blocking_pick_file();
    Ok(result.map(|p| p.path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("explorer").arg(&path).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn get_app_config(app: AppHandle) -> AppConfig {
    app.state::<AppConfig>().inner().clone()
}
```

#### 5.5. Workspace Cargo.toml + Justfile

```toml
# Cargo.toml [workspace] members:
"apps/desktop/src-tauri"
```

```justfile
build-desktop:
    cargo build --release -p fullmag-desktop
    cp target/release/fullmag-ui .fullmag/local/bin/
```

#### 5.6. Kryterium ukonczenia Etapu 5

- `fullmag ui` otwiera Tauri window z control room UI
- `fullmag ui examples/exchange_relax.py` otwiera Tauri + uruchamia symulacje
- `fullmag ui --dev` laduje Next.js dev URL w Tauri
- Close Tauri window → launcher terminuje sesje
- Tauri bridge: open file dialog dziala

---

### ═══════════════════════════════════════════════════════════
### ETAP 6: UI solver selector
### ═══════════════════════════════════════════════════════════

**Cel**: Uzytkownik moze wybrac solver (backend × device × precision) w UI.
Solver selector: czesc `SceneDocument.study`, nie tylko statusbar.

**Pliki do zmiany:**

| App | Plik | Zmiana |
|-----|------|--------|
| `apps/web` | `components/solver/SolverSelector.tsx` | **NOWY** komponent |
| `apps/web` | `lib/hooks/useRuntimeCapabilities.ts` | juz z Etapu 1 |
| `apps/web` | `components/runs/control-room/context-hooks.tsx` | dodac requested_* state |
| `apps/web` | `components/runs/control-room/ControlRoomContext.tsx` | dodac requested_* state |
| `fullmag-authoring` | `src/scene.rs` | rozszerzyc `SceneStudyState` o solver config |

---

#### 6.1. Komponent `SolverSelector.tsx`

(Kod jak w §7.1 planu — implementacja z availability badges, disabled states,
fallback warning, relacja z `useModel().session`.)

#### 6.2. `SceneStudyState` — solver config

W `crates/fullmag-authoring/src/scene.rs`:

```rust
pub struct SceneStudyState {
    // --- istniejace pola ---
    // ...

    // --- NOWE: solver selection ---
    #[serde(default = "default_auto")]
    pub requested_backend: String,
    #[serde(default = "default_auto")]
    pub requested_device: String,
    #[serde(default = "default_double")]
    pub requested_precision: String,
    #[serde(default = "default_strict")]
    pub requested_mode: String,
}
```

To pozwala zapisanie solver config w authoring document (`.fullmag-scene.json`).

#### 6.3. Kryterium ukonczenia Etapu 6

- SolverSelector wyswietla backend × device × precision
- Niedostepne opcje disabled z tooltip
- Resolved engine info + fallback trail widoczne
- Solver config zapisywany w SceneDocument.study
- Zmiana solvera przy authoringu → aktualizacja requested_* w sesji

---

### ═══════════════════════════════════════════════════════════
### ETAP 7: Dispatch refactor — manifest-driven resolution
### ═══════════════════════════════════════════════════════════

**Cel**: `dispatch.rs` uzywa RuntimeRegistry zamiast hardcoded enum + env vars.

**Pliki do zmiany:**

| Crate | Plik | Zmiana |
|-------|------|--------|
| `fullmag-runner` | `src/dispatch.rs` | dodac `resolve_with_registry()` |
| `fullmag-runner` | `src/lib.rs` | public API update |

---

#### 7.1. Nowy flow dispatchu

```
resolve_with_registry(problem, registry, explicit_selection)
  → determine backend from problem (fdm | fem)
  → read requested device/precision from problem or env
  → registry.resolve(backend, device, precision)
  → validate plan constraints (fe_order, current_modules)
  → if explicit && constraint_violated → Err
  → if auto && constraint_violated → fallback + trail
  → return EngineResolution { engine, fallback_trail }
```

#### 7.2. Integracja z istniejacym dispatch

```rust
pub(crate) fn resolve_with_registry(
    problem: &ProblemIR,
    registry: Option<&RuntimeRegistry>,
    explicit_selection: bool,
) -> Result<EngineResolution, RunError> {
    match registry {
        Some(reg) => resolve_engine_from_registry(problem, reg, explicit_selection),
        None => {
            // Legacy path — existing resolve_fdm_engine / resolve_fem_engine
            // ...
        }
    }
}
```

Registry jest Optional → stopniowa migracja. Legacy env vars dalej dzialaja.

#### 7.3. Kryterium ukonczenia Etapu 7

- Registry-based resolve daje te same wyniki co legacy
- `fullmag doctor` i `/v1/runtime/capabilities` uzywaja tego samego registry
- Legacy env vars kompatybilne
- Test: registry-based resolve na testowym `runtimes/` → poprawny worker

---

### ═══════════════════════════════════════════════════════════
### ETAP 8: Linux release bundle + installer
### ═══════════════════════════════════════════════════════════

**Cel**: Portable tarball + makeself installer dla Linux x86_64.

**Pliki do zmiany:**

| Sciezka | Zmiana |
|---------|--------|
| `scripts/package_fullmag_portable.sh` | dodac `fullmag-ui` do bundle |
| `scripts/build_installer_linux.sh` | **NOWY** — makeself wrapper |
| `justfile` | dodac `package-installer-linux` |

---

#### 8.1. Rozszerzenie `package_fullmag_portable.sh`

```bash
# Po istniejacym bundle assembly, dodac Tauri:
if [[ -x "${REPO_ROOT}/target/release/fullmag-ui" ]]; then
  echo "  including fullmag-ui (Tauri desktop shell)"
  cp -a "${REPO_ROOT}/target/release/fullmag-ui" "${BUNDLE_ROOT}/bin/"
  "$PATCHELF_BIN" --set-rpath '$ORIGIN/../lib' "${BUNDLE_ROOT}/bin/fullmag-ui"
else
  echo "  skipping fullmag-ui (not built)"
fi

# Desktop entry
mkdir -p "${BUNDLE_ROOT}/share"
cat > "${BUNDLE_ROOT}/share/fullmag.desktop" <<EOF
[Desktop Entry]
Name=Fullmag
Comment=Micromagnetic simulation environment
Exec=__INSTALL_PREFIX__/bin/fullmag ui
Icon=__INSTALL_PREFIX__/share/icons/fullmag.png
Terminal=false
Type=Application
Categories=Science;Physics;Simulation;
EOF
```

#### 8.2. `scripts/build_installer_linux.sh`

(Jak wczesniej opisane — makeself wrapper z install.sh.)

#### 8.3. Kryterium ukonczenia Etapu 8

- `.run` installer uruchamia sie i pyta o folder
- Po instalacji `fullmag ui` otwiera Tauri
- Po instalacji `fullmag examples/exchange_relax.py` uruchamia symulacje
- `fullmag doctor` pokazuje runtime packi
- `uninstall.sh` czysci folder

---

### ═══════════════════════════════════════════════════════════
### ETAP 9: Windows parity
### ═══════════════════════════════════════════════════════════

**Cel**: Windows x86_64 na tym samym kontrakcie co Linux.

#### 9.1. Cross-compile lub CI build

Opcja A: `cross build --release --target x86_64-pc-windows-msvc -p fullmag-desktop`
Opcja B: GitHub Actions z `windows-latest`.

#### 9.2. Windows layout

```
C:\Program Files\Fullmag\
├── bin\fullmag.exe, fullmag-bin.exe, fullmag-api.exe, fullmag-ui.exe
├── lib\fullmag_fdm.dll, cudart64_12.dll
├── python\
├── web\
├── runtimes\{cpu-reference,fdm-cuda}\manifest.json
├── examples\
└── share\version.json, licenses\
```

#### 9.3. WiX installer via `cargo-wix`

Feature tree: Core (required), PythonRuntime, CpuReference, FdmCuda, FemGpu (coming soon), Examples.

#### 9.4. Ograniczenia V1 Windows

- FEM GPU (MFEM + CUDA + CEED) na Windows: **nie w V1**
- FDM CUDA: wspierany
- CPU reference: pelne wsparcie

#### 9.5. Kryterium ukonczenia Etapu 9

- `fullmag.msi` instaluje sie na czystym Windows 10/11
- `fullmag ui` otwiera Tauri
- `fullmag doctor` poprawnie raportuje CPU + FDM CUDA

---

## 11. Test plan

### 11.1. Runtime resolution

```
# Maszyna z GPU + CUDA:
fullmag doctor
  → ✓ fdm + cpu + double [cpu-reference]
  → ✓ fdm + gpu + double [fdm-cuda]
  → ✓ fem + cpu + double [cpu-reference]
  → ✓ fem + gpu + double [fem-gpu]

# Maszyna bez GPU:
fullmag doctor
  → ✓ fdm + cpu + double [cpu-reference]
  → ✗ fdm + gpu + double [fdm-cuda] (missing_driver)
  → ✓ fem + cpu + double [cpu-reference]
  → ✗ fem + gpu + double [fem-gpu] (missing_driver)
```

### 11.2. Fallback trail

```
# FEM GPU z fe_order=2 → fallback do CPU
fullmag --backend fem script_fe2.py --headless --json
  → session.resolved_engine_id = "fem_cpu_reference"
  → session.resolved_fallback.occurred = true
  → session.resolved_fallback.reason = "fe_order_unsupported"
  → session.resolved_fallback.message = "GPU supports fe_order=1 only; using CPU"
```

### 11.3. CLI behavior

```
fullmag ui                      → Start Hub w Tauri window
fullmag ui script.py            → workspace w Tauri
fullmag ui --dev script.py      → dev mode w Tauri
fullmag script.py               → browser mode (istniejacy flow)
fullmag --headless script.py    → bez UI
fullmag doctor                  → diagnostyka (istniejacy + nowa sekcja runtime)
```

### 11.4. API endpoint

```
GET /v1/runtime/capabilities
  → 200 + HostCapabilityMatrix JSON
  → engines[] poprawnie odzwierciedla zainstalowane packi
  → status poprawnie odzwierciedla dostepnosc hosta
```

### 11.5. UI solver selector

```
- Render capability matrix z API
- Dostepne tuple: klikalne
- Niedostepne tuple: disabled + tooltip
- Zmiana solvera → aktualizacja requested_* w sesji
- Po runie: resolved_* + fallback trail w UI
```

### 11.6. End-to-end acceptance matrix

| Backend | Device | Precision | Worker | Test |
|---------|--------|-----------|--------|------|
| FDM | CPU | single | fullmag-bin | exchange_relax.py |
| FDM | CPU | double | fullmag-bin | exchange_relax.py |
| FDM | GPU | single | fullmag-fdm-cuda-bin | exchange_relax.py |
| FDM | GPU | double | fullmag-fdm-cuda-bin | exchange_relax.py |
| FEM | CPU | single | fullmag-bin | nanoflower_fem.py |
| FEM | CPU | double | fullmag-bin | nanoflower_fem.py |
| FEM | GPU | single | — | N/A (FEM single not yet) |
| FEM | GPU | double | fullmag-fem-gpu-bin | nanoflower_fem.py |

Dla kazdego dostepnego scenariusza:
- poprawny worker wybrany
- poprawny precision uzyty
- poprawna runtime family w metadata
- brak brakujacych bibliotek
- resolved_* trail kompletny

### 11.7. Installer tests

```
# Linux:
./fullmag-0.1.0-linux-x86_64.run
  → instaluje do wybranego katalogu
  → fullmag ui dziala
  → uninstall.sh czysci

# Windows:
fullmag.msi
  → instaluje do C:\Program Files\Fullmag\
  → fullmag ui dziala
  → Uninstall z Programs & Features czysci
```

---

## 12. Najwazniejsze decyzje koncowe

1. Desktop shell: Tauri (nie Electron).
2. `fullmag ui` = publiczny entrypoint desktopowy (top-level Command, nie flaga).
3. Browser flow pozostaje wspierany (`fullmag script.py` — bez zmian).
4. Produkt = `launcher + runtime packs`, nie monolit.
5. **TRZY poziomy capability**: spec-level (capability-matrix-v0.md), host-level (`HostCapabilityMatrix`), engine-level (`BackendCapabilities`).
6. Solver selection w UI = capability-driven, zapis w `SceneDocument.study`.
7. **Fallbacki**: explicit UI/CLI selection → brak fallbacku (error). Auto mode → fallback z trailem w `resolved_fallback`.
8. `fullmag-api` pozostaje zrodlem prawdy.
9. Reuse istniejacych typow: `RuntimeResolutionSummary` (types.rs), `Command::Doctor` (args.rs), `SceneDocument` (scene.rs).
10. Refactor `control_room.rs` → extract `bootstrap_control_plane()` + dwa openery (browser/Tauri).
11. Linux x86_64 = pierwszy target. Windows x86_64 = drugi.
12. Installer: Linux `.run` (makeself), Windows `.msi` (WiX).

> Fullmag powinien byc rozwijany jako jeden Rust-first produkt z webowym frontendem
> wspoldzielonym przez browser i Tauri desktop shell, a nie jako osobna aplikacja
> Electronowa doklejona do istniejacego launchera.

---

## Appendix A: Per-crate / per-file change map

Referencja kryzowa: ktory plik zmienia sie w ktorym etapie.

### `crates/fullmag-cli/`

| Plik | Etap | Zmiana |
|------|------|--------|
| `src/args.rs` | 4 | Dodac `Ui(UiCli)` do `Command` enum, dodac struct `UiCli`, dodac `"ui"` do `is_script_mode()` |
| `src/main.rs` | 1 | Rozszerzyc `Command::Doctor` o sekcje runtime discovery |
| `src/main.rs` | 4 | Dodac handler `Command::Ui(ui)` — bootstrap + open_in_tauri |
| `src/control_room.rs` | 3 | Extract `bootstrap_control_plane()`, `ControlPlaneReady`, `open_in_browser()`, `open_in_tauri()` |
| `src/types.rs` | 2 | Rozszerzyc `RuntimeResolutionSummary` o `resolved_device`, `resolved_precision`, `resolved_fallback` |

### `crates/fullmag-runner/`

| Plik | Etap | Zmiana |
|------|------|--------|
| `src/runtime_registry.rs` | 1 | **NOWY** — manifest parser, `RuntimeRegistry`, `HostCapabilityMatrix` |
| `src/lib.rs` | 1 | `pub mod runtime_registry` + re-exports |
| `Cargo.toml` | 1 | Dodac dep `libc` (dla `cuda_driver_available`) |
| `src/types.rs` | 2 | Dodac `ResolvedFallback` struct |
| `src/dispatch.rs` | 2 | `resolve_fem_engine_with_trail()`, `EngineResolution` |
| `src/dispatch.rs` | 7 | `resolve_with_registry()` — manifest-driven resolution |

### `crates/fullmag-api/`

| Plik | Etap | Zmiana |
|------|------|--------|
| `src/main.rs` | 1 | Route `/v1/runtime/capabilities`, `AppState.install_root` |
| `src/types.rs` | 2 | Rozszerzyc `SessionManifest` o `resolved_*` + `resolved_fallback` |
| `src/session.rs` | 4 | Hub mode bootstrap: `mode: "hub"` zamiast 404 gdy brak sesji |

### `crates/fullmag-authoring/`

| Plik | Etap | Zmiana |
|------|------|--------|
| `src/scene.rs` | 6 | Rozszerzyc `SceneStudyState` o `requested_backend/device/precision/mode` |

### `apps/web/`

| Plik | Etap | Zmiana |
|------|------|--------|
| `lib/hooks/useRuntimeCapabilities.ts` | 1 | **NOWY** — fetch hook dla `/v1/runtime/capabilities` |
| `lib/session/types.ts` | 2 | Rozszerzyc `SessionManifest` TS interface o `resolved_*` |
| `lib/session/normalize.ts` | 2 | Backward-compat normalization dla nowych pol |
| `components/solver/SolverSelector.tsx` | 6 | **NOWY** — solver selector komponent |
| `components/runs/control-room/context-hooks.tsx` | 6 | Dodac `requestedDevice/Precision/Mode` state |
| `components/hub/StartHub.tsx` | 4 | **NOWY** — ekran startowy bez sesji |

### `apps/desktop/` (caly **NOWY**)

| Plik | Etap | Zmiana |
|------|------|--------|
| `src-tauri/Cargo.toml` | 5 | Tauri crate config |
| `src-tauri/tauri.conf.json` | 5 | Window config, CSP, plugins |
| `src-tauri/src/main.rs` | 5 | Tauri entry: read env, open window |
| `src-tauri/src/commands.rs` | 5 | Bridge: file dialogs, reveal, config |
| `src-tauri/build.rs` | 5 | Tauri build script |

### `scripts/`

| Plik | Etap | Zmiana |
|------|------|--------|
| `package_fullmag_portable.sh` | 8 | Dodac `fullmag-ui`, desktop entry z `fullmag ui` |
| `build_installer_linux.sh` | 8 | **NOWY** — makeself wrapper |

### Workspace root

| Plik | Etap | Zmiana |
|------|------|--------|
| `Cargo.toml` | 5 | Dodac member `apps/desktop/src-tauri` |
| `justfile` | 5, 8 | `build-desktop`, `package-installer-linux` |
