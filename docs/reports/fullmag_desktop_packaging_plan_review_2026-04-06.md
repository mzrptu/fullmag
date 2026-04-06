# Fullmag Desktop + Installer Plan — Review & Gap Analysis
## Data: 2026-04-06

---

## 1. Podsumowanie planu

Plan z `fullmag_unified_binary_tauri_packaging_plan_2026-04-06.md` zakłada:

| Cel | Opis |
|-----|------|
| Desktop shell | Tauri zamiast Electron |
| Launcher UI | `fullmag --ui` otwiera natywne okno z frontem webowym |
| Runtime packs | Osobne binarki per konfiguracja (FDM/FEM × CPU/GPU × single/double) |
| Solver selector | UI capability-driven — użytkownik wybiera z tego co jest zainstalowane |
| Packaging | Jedna instalacja → jeden folder z bin/, lib/, runtimes/, web/, python/ |
| Installer | Linux portable + Windows installer |

**Kluczowa decyzja architektoniczna jest dobra**: launcher + runtime packs + Tauri shell, nie monolit.

---

## 2. Stan obecny vs wymagania planu

### 2.1. Co już istnieje ✅

| Komponent | Stan | Pliki |
|-----------|------|-------|
| Launcher CLI (clap) | Działa, `--headless`, `--dev`, `--web-port` | `crates/fullmag-cli/src/args.rs` |
| Control room spawn | API + static web z auto-port | `crates/fullmag-cli/src/control_room.rs` |
| Runtime packs layout | `runtimes/cpu-reference/`, `runtimes/fdm-cuda/`, `runtimes/fem-gpu/` | `scripts/package_fullmag_portable.sh` |
| Runtime manifests `engines[]` | **Już napisane** w packaging script | `package_fullmag_portable.sh:write_runtime_manifests()` |
| Portable packaging (tar.zst) | Działa end-to-end z patchelf, CUDA libs, Python vendoring | `scripts/package_fullmag_portable.sh` |
| Host package staging | `bin/fullmag`, `bin/fullmag-bin`, `lib/`, `runtimes/` | `scripts/package_fullmag_host.sh` |
| FEM GPU runtime | Zbudowany, ale manually resolved | `.fullmag/runtimes/fem-gpu-host/` |
| StatusBar solver info | Wyświetla engine + precision + GPU label | `apps/web/components/shell/StatusBar.tsx` |
| BackendCapabilities type | Definiuje supported terms/quantities per engine | `crates/fullmag-runner/src/types.rs` |
| Engine dispatch | `resolve_fdm_engine()`, `resolve_fem_engine()` via env vars | `crates/fullmag-runner/src/dispatch.rs` |
| Web frontend | Next.js 15.5 + React 19 + R3F, wspólny dla browser i przyszłego desktop | `apps/web/` |

### 2.2. Czego brakuje ❌

| Komponent | Brak | Priorytet |
|-----------|------|-----------|
| `--ui` flag w CLI | Nie istnieje | **P1** |
| Tauri `apps/desktop/` | Nie istnieje | **P2** |
| `/v1/runtime/capabilities` endpoint | Nie istnieje (dane rozproszone w bootstrap) | **P1** |
| Manifest-driven runtime discovery | Manifesty istnieją ale launcher ich nie czyta | **P1** |
| UI solver selector widget | Brak (StatusBar read-only) | **P2** |
| Windows build pipeline | Brak | **P3** |
| Installer script (NSIS/WiX/shell) | Brak | **P3** |
| `fullmag runtime doctor` subcommand | Brak | **P2** |

---

## 3. Analiza architektoniczna

### 3.1. Model "osobne binarki per konfiguracja" — POPRAWNY

Plan słusznie zakłada:

```
runtimes/
  cpu-reference/         ← FDM+FEM CPU, double (worker: ../../bin/fullmag-bin)
    manifest.json
  fdm-cuda/              ← FDM GPU single+double (worker: bin/fullmag-fdm-cuda-bin)
    bin/fullmag-fdm-cuda-bin
    manifest.json
  fem-gpu/               ← FEM GPU double (worker: bin/fullmag-fem-gpu-bin)
    bin/fullmag-fem-gpu-bin
    lib/libmfem.so.4.7.0
    lib/libfullmag_fem.so
    lib/libcudart.so.*
    manifest.json
```

Obecne manifesty z `package_fullmag_portable.sh` już to realizują. Problem: **launcher
nie czyta jeszcze tych manifestów** — runtime dispatch dalej opiera się na env vars
(`FULLMAG_FDM_EXECUTION`, `FULLMAG_FEM_EXECUTION`) i compile-time feature flags
(`feature = "cuda"`, `feature = "fem-gpu"`).

### 3.2. Luka: manifest → launcher → worker spawn

Brakuje pętli:

```
1. Launcher skanuje runtimes/*/manifest.json
2. Buduje capability registry (backend × device × precision × mode)
3. API wystawia /v1/runtime/capabilities z tej registry
4. UI solver selector odpytuje ten endpoint
5. Użytkownik wybiera tuple (np. fem + gpu + double)
6. API/launcher spawnu odpowiedni worker z manifest.worker
```

Obecnie krok 1-3 nie istnieje. Dispatch jest compile-time:

```rust
// dispatch.rs — obecny model
pub(crate) enum FdmEngine { CpuReference, CudaFdm }
pub(crate) enum FemEngine { CpuReference, NativeGpu }
```

### 3.3. Instalator — brakuje opisu w planie

Plan mówi o "portable zip albo installer directory" (§9.2) ale **nie definiuje
instalatora z GUI** (setup wizard). Użytkownik chce:

> skrypt instalacyjny jak typowe oprogramowanie na Windows/Linux —
> użytkownik wskazuje folder, wszystkie binarki + biblioteki się instalują

#### Rekomendacja: Installer per platforma

| Platforma | Narzędzie | Format | Uwagi |
|-----------|-----------|--------|-------|
| **Windows** | **WiX Toolset** lub **NSIS** | `.msi` lub `.exe` | WiX = nowoczesny, MSI-based, lepszy dla enterprise. NSIS = prostszy, `.exe` self-extractor |
| **Linux** | **shell self-extractor** (`makeself`) | `.run` | Jak NVIDIA driver — `./fullmag-0.1.0-linux-x86_64.run --prefix=/opt/fullmag` |
| **Linux alt** | **AppImage** lub **.deb/.rpm** | natywne pakiety | `.deb` dla Ubuntu, `.rpm` dla Fedora — ale to utrudnia CUDA bundling |

**Preferowana rekomendacja:**

- **Windows**: WiX `.msi` — standardowy na Windows, obsługuje folder selection, PATH registration, uninstall
- **Linux**: `makeself` `.run` — self-extracting archive z argumentem `--prefix=`, nie wymaga roota, user-installable

#### Installer flow (Windows):

```
1. Uruchamia fullmag-setup.msi
2. Wybór folderu instalacji (default: C:\Program Files\Fullmag\)
3. Wybór komponentów (checkboxy):
   □ Core (launcher + API + web)           [wymagany]
   □ CPU Reference Runtime                 [domyślny]
   □ FDM CUDA Runtime                      [opcjonalny]
   □ FEM GPU Runtime                       [opcjonalny]
   □ Python Runtime                        [domyślny]
   □ Przykłady                             [opcjonalny]
4. Instaluje wybrane komponenty do folderu
5. Dodaje bin/ do PATH
6. Tworzy skrót "Fullmag" → fullmag --ui
```

#### Installer flow (Linux):

```bash
# Wariant 1: makeself self-extractor
./fullmag-0.1.0-linux-x86_64.run --prefix=$HOME/.local/fullmag

# Wariant 2: interaktywny
./fullmag-0.1.0-linux-x86_64.run
  → "Installation directory [/opt/fullmag]: "
  → "Add to PATH? [Y/n]: "
  → "Install FDM CUDA runtime? [y/N]: "
  → "Install FEM GPU runtime? [y/N]: "
```

---

## 4. Uwagi do poszczególnych etapów planu

### Etap 1 (Runtime contract) — 80% gotowy

**Co jest**: manifesty w `write_runtime_manifests()` z `engines[]` tuples.

**Czego brakuje**:
1. Parser manifestów w Rust (crate `fullmag-runner` lub nowy `fullmag-runtime-registry`)
2. Host-side discovery: skanowanie `runtimes/*/manifest.json`
3. Walidacja dostępności (czy worker binary istnieje, czy CUDA driver jest)
4. `fullmag runtime doctor` CLI subcommand

**Szacunek pracy**: Mały — manifesty już mają poprawny format JSON, trzeba dodać:
- `RuntimeManifest` struct (serde)
- `RuntimeRegistry::discover(runtimes_dir)` → `Vec<RuntimeManifest>`
- `RuntimeRegistry::resolve(backend, device, precision)` → `Option<ResolvedEngine>`

### Etap 2 (API + session metadata) — 40% gotowy

**Co jest**: `BackendCapabilities`, session bootstrap, `ExecutionProvenance`.

**Czego brakuje**:
1. `/v1/runtime/capabilities` endpoint w `fullmag-api`
2. Requested vs resolved metadata w `SessionManifest`
3. Frontend fetch + store

### Etap 3 (CLI `--ui`) — 10% gotowy

**Co jest**: CLI `args.rs` z clap, `control_room.rs` spawn.

**Czego brakuje**:
1. `--ui` flag w `CliArgs`
2. Branch w `main.rs`: `--ui` → spawn API + Tauri zamiast API + browser
3. Start Hub route w frontend (bez skryptu)
4. Przekazywanie env vars do Tauri (`FULLMAG_UI_URL`, `FULLMAG_API_BASE`)

### Etap 4 (Tauri shell) — 0% gotowy

**Czego brakuje**: Wszystko. Ale scope V1 jest mały:
1. `apps/desktop/src-tauri/` scaffolding (tauri init)
2. `tauri.conf.json` z minimalną konfiguracją
3. Rust `main.rs` — czyta env, otwiera okno, ładuje URL
4. Minimalny bridge: file dialog, window lifecycle

### Etap 5 (UI solver selector) — 20% gotowy

**Co jest**: StatusBar z engine/precision display, solver model concepts.

**Czego brakuje**:
1. `<SolverSelector>` widget (dropdown/matrix z backend × device × precision)
2. fetch `/v1/runtime/capabilities`
3. Status badges: installed / missing / no driver
4. Powiązanie z session metadata (requested tuple → API)

### Etap 6-7 (Linux/Windows release) — 60% gotowy (Linux), 0% (Windows)

**Linux**: packaging script jest zaawansowany (patchelf, CUDA, Python vendoring). 
Brakuje: Tauri binary w bundle, installer script (makeself).

**Windows**: nic nie istnieje. Trzeba:
1. Cross-compile albo CI build na Windows
2. `.dll` handling zamiast `.so` + `patchelf`
3. WiX/NSIS installer definition
4. Testowanie na czystej maszynie Windows

---

## 5. Sugerowana kolejność implementacji

### Faza A: Runtime discovery (bez Tauri)

```
A1. RuntimeManifest struct + parser (fullmag-runner)
A2. RuntimeRegistry::discover() — skanuje runtimes/*/manifest.json
A3. RuntimeRegistry::resolve(tuple) — zwraca worker path
A4. Podmiana dispatch.rs na manifest-driven resolution
A5. `fullmag runtime doctor` subcommand
A6. /v1/runtime/capabilities endpoint w fullmag-api
```

**Rezultat**: solver selection działa end-to-end bez Tauri.

### Faza B: UI solver selector (browser mode)

```
B1. Frontend: fetch /v1/runtime/capabilities
B2. <SolverSelector> komponent z matrix backend×device×precision
B3. Powiązanie z session requested_* metadata
B4. StatusBar aktualizacja — resolved tuple z sesji
```

**Rezultat**: użytkownik wybiera solver w przeglądarce.

### Faza C: Tauri shell

```
C1. apps/desktop/ — tauri init, minimalne okno
C2. --ui flag w fullmag-cli
C3. Launcher: spawn API → spawn Tauri z URL
C4. Desktop bridge: file dialog, menu
C5. Linux packaging z Tauri binary
```

**Rezultat**: `fullmag --ui` otwiera natywne okno.

### Faza D: Installer

```
D1. Linux: makeself self-extractor z --prefix
D2. Windows: cross-compile (cargo + cross / GitHub Actions)
D3. Windows: WiX MSI definition
D4. Smoke test na czystej maszynie
```

**Rezultat**: typowy installer setup.exe / .run.

---

## 6. Krytyczne decyzje do podjęcia

### 6.1. Jak launcher komunikuje się z Tauri?

Plan zakłada env vars (`FULLMAG_UI_URL`, `FULLMAG_API_BASE`). To działa ale wymaga
spawn → exec flow. Alternatywa: Tauri sam spawnu API jako child process.

**Rekomendacja**: Zostać przy planie — launcher to orchestrator, Tauri to display shell.
Tauri nie powinien wiedzieć jak spawnu API.

### 6.2. Czy runtime manifesty mają być w JSON czy TOML?

Obecne manifesty w `package_fullmag_portable.sh` są JSON. Plan zakłada JSON.

**Rekomendacja**: JSON — spójne z resztą API, frontend-friendly, serde_json już w codebase.

### 6.3. Czy single precision FEM ma być wspierany?

Obecne manifesty nie mają `fem + * + single` tuple. FEM GPU ma tylko double.

**Rekomendacja**: Zostawić jak jest — FEM precision jest wymuszony przez MFEM build.
W UI oznaczyć jako "N/A" zamiast "missing".

### 6.4. Windows CUDA — jak budować?

CUDA + Rust + MFEM na Windows to osobny problem. FDM CUDA jest prostsze (cufft + custom kernels).
FEM GPU wymaga MFEM + CUDA — skomplikowane na Windows.

**Rekomendacja**: Windows V1 = CPU-only + FDM CUDA. FEM GPU na Windows zostawić jako "coming soon".

### 6.5. Installer: WiX vs NSIS?

| | WiX | NSIS |
|---|-----|------|
| Format | `.msi` | `.exe` |
| Enterprise | ✅ GPO deployment | ❌ |
| Komponent selection | ✅ natywny | ✅ plugin |
| Build | Rust-friendly (cargo-wix) | Manual script |
| Uninstall | ✅ Windows standard | ✅ ale custom |

**Rekomendacja**: WiX via `cargo-wix` — lepiej integruje się z Rust toolchain.

---

## 7. Layout instalacji docelowej

### Linux (`/opt/fullmag/` lub `~/.local/fullmag/`)

```
fullmag/
├── bin/
│   ├── fullmag              ← wrapper script (sets LD_LIBRARY_PATH, PYTHONHOME)
│   ├── fullmag-bin          ← launcher binary
│   ├── fullmag-api          ← API server
│   └── fullmag-ui           ← Tauri desktop shell
├── lib/
│   ├── libfullmag_fdm.so.0
│   ├── libcudart.so.12      ← vendored CUDA (FDM)
│   └── libcufft.so.11
├── python/
│   ├── bin/python3.12
│   └── lib/python3.12/site-packages/
├── web/
│   ├── index.html
│   └── _next/
├── packages/
│   └── fullmag-py/src/fullmag/
├── runtimes/
│   ├── cpu-reference/
│   │   └── manifest.json
│   ├── fdm-cuda/
│   │   ├── bin/fullmag-fdm-cuda-bin
│   │   └── manifest.json
│   └── fem-gpu/
│       ├── bin/fullmag-fem-gpu-bin
│       ├── lib/libmfem.so.4.7.0
│       ├── lib/libcudart.so.*
│       ├── lib/libcusparse.so.*
│       └── manifest.json
├── examples/
├── share/
│   ├── version.json
│   ├── licenses/
│   └── fullmag.desktop      ← Linux desktop entry
└── uninstall.sh
```

### Windows (`C:\Program Files\Fullmag\`)

```
Fullmag\
├── bin\
│   ├── fullmag.exe
│   ├── fullmag-bin.exe
│   ├── fullmag-api.exe
│   └── fullmag-ui.exe
├── lib\
│   ├── fullmag_fdm.dll
│   ├── cudart64_12.dll
│   └── cufft64_11.dll
├── python\
│   ├── python.exe
│   └── Lib\site-packages\
├── web\
├── packages\
├── runtimes\
│   ├── cpu-reference\
│   │   └── manifest.json
│   ├── fdm-cuda\
│   │   ├── bin\fullmag-fdm-cuda-bin.exe
│   │   └── manifest.json
│   └── fem-gpu\             ← Windows V1: placeholder, "coming soon"
│       └── manifest.json
├── examples\
└── share\
    ├── version.json
    └── licenses\
```

---

## 8. Podsumowanie oceny

| Aspekt | Ocena | Komentarz |
|--------|-------|-----------|
| Architektura (launcher + packs) | ✅ Bardzo dobra | Rust-first, nie monolit, packs jako sidecary |
| Tauri vs Electron | ✅ Słuszna decyzja | Mniejszy footprint, Rust-native |
| Runtime manifest format | ✅ Gotowy | `engines[]` tuples w JSON — wystarczy parser w Rust |
| Capability-driven solver selector | ✅ Kluczowa decyzja | Brak silent fallback → uczciwy UX |
| Plan etapów | ⚠️ Do korekty | Etap 1 jest prawie gotowy, etap 3-4 mogą iść równolegle |
| Installer | ❌ Brak definicji | Plan mówi "portable zip albo installer" — trzeba dodać pełny installer flow |
| Windows | ⚠️ Niedoszacowany | CUDA + MFEM na Windows to osobny challenge |
| Rozdzielenie backend×device×precision | ✅ Poprawne | 8 tuples w matrycy, każdy ma swój worker |
| Brak macOS w V1 | ✅ Pragmatyczne | GPU compute na macOS to Metal — inny świat |

**Verdict**: Plan jest solidny architektonicznie. Główne luki:
1. Brak definicji instalatora (WiX/makeself)
2. Launcher nie czyta jeszcze manifestów (ale manifesty już istnieją)
3. Windows build pipeline nieokreślony
4. Tauri integration = 0% ale scope V1 jest mały

Sugerowana kolejność: **A (manifesty) → B (UI selector) → C (Tauri) → D (instalery)**.
