# Fullmag Unified Binary + Tauri Packaging Plan
## Launcher + runtime packs + desktop shell
## Data: 2026-04-06

---

## 1. Cel dokumentu

Ten dokument aktualizuje wczesniejszy kierunek desktopowy:

- odchodzimy od `Electron` jako domyslnego shell-a desktopowego,
- przechodzimy na `Tauri`,
- zachowujemy model produktu:
  - `bin/fullmag` jako jedyny publiczny launcher,
  - `fullmag-api` jako local control-plane,
  - `web/` jako frontend bundle,
  - `runtimes/*` jako sidecar runtime packs,
  - `fullmag --ui` jako desktop entrypoint.

Najwazniejsza decyzja:

> Fullmag desktop powinien byc budowany jako `Rust launcher + Rust API + Tauri shell + runtime packs`, a nie jako `Electron + Chromium + Node bundle`.

To lepiej pasuje do obecnego stacku projektu:

- launcher jest juz w Rust,
- API jest juz w Rust,
- runtime orchestration jest juz w Rust,
- frontend webowy juz istnieje i ma pozostac wspolny dla web + desktop.

---

## 2. Decyzja architektoniczna

### 2.1. Czego nie robimy

Nie robimy:

- jednego gigantycznego monolitycznego `ELF/EXE`,
- osobnego desktop-only frontendu,
- drugiego niezaleznego hosta w innym jezyku,
- przepisywania UI na natywne widgety,
- desktopowego flow opartego o `Electron` jako glowny target v1.

### 2.2. Co robimy

Robimy jeden produkt logiczny:

```text
fullmag/
  bin/
    fullmag
    fullmag-bin
    fullmag-api
    fullmag-ui
    fullmag-ui.exe
  lib/
  python/
  web/
  runtimes/
    cpu-reference/
    fdm-cuda/
    fem-gpu/
  share/
    version.json
    licenses/
```

Gdzie:

- `bin/fullmag` jest jedynym publicznym launcherem,
- `bin/fullmag-ui` jest wewnetrzna binarka desktop shell-a Tauri,
- `fullmag-api` dalej serwuje local API i web assets,
- runtime packs zostaja sidecarami produktu,
- frontend pozostaje wspolny dla web i desktop.

### 2.3. Dlaczego Tauri zamiast Electron

Powody techniczne:

1. Fullmag jest juz projektem Rust-first.
2. Tauri naturalnie pasuje do istniejacego launchera i API.
3. Zachowujemy jeden glowny host technologiczny zamiast dokladac Node/Chromium runtime jako glowny shell.
4. Produkt desktopowy bedzie lzejszy i prostszy do dystrybucji niz Electron.
5. Mozemy reuse'owac istniejacy frontend webowy bez zmiany modelu danych i bez rozszczepiania aplikacji.

Wniosek:

> Electron moze byc tylko awaryjnym fallbackiem prototypowym, ale docelowy plan produktu powinien byc oparty o Tauri.

---

## 3. Publiczny interfejs produktu

Docelowy interfejs CLI:

```bash
fullmag --ui
fullmag --ui my_problem.py
fullmag --ui --backend fem --precision double my_problem.py
fullmag my_problem.py
fullmag --headless my_problem.py
```

Semantyka:

### 3.1. `fullmag --ui`

- uruchamia local control plane,
- nie wymaga skryptu,
- jezeli nie podano pliku, frontend otwiera `Start Hub`,
- shell desktopowy uruchamiany jest przez Tauri,
- Tauri laduje lokalny URL hostowany przez `fullmag-api`.

### 3.2. `fullmag --ui script.py`

- uruchamia local control plane,
- materializuje stan sesji dla wskazanego skryptu,
- otwiera Tauri,
- Tauri przechodzi od razu do workspace tej symulacji, bez launchera.

### 3.3. `fullmag script.py`

- zachowuje obecny browser/static-web flow,
- nie uruchamia Tauri,
- pozostaje wspierane jako web/local-browser mode.

### 3.4. `fullmag --headless script.py`

- pozostaje bez desktop shell-a,
- uruchamia tylko backend/headless execution.

---

## 4. Model desktop shell-a

### 4.1. Zasada glowna

Tauri nie hostuje solvera.

Tauri jest tylko desktopowym shell-em dla istniejacej architektury:

```text
fullmag launcher
  -> fullmag-api
  -> local session/bootstrap
  -> local web URL
  -> Tauri window
```

### 4.2. V1 desktop flow

W pierwszej wersji:

- `fullmag-api` pozostaje zrodlem prawdy,
- Tauri `WebviewWindow` laduje lokalny URL,
- frontend pozostaje ten sam co dla static/web control room,
- preload / command bridge jest minimalny.

To oznacza:

- nie przechodzimy jeszcze na `file://`,
- nie wprowadzamy jeszcze custom protocol jako glownego toru,
- nie dublujemy logiki bootstrap/session w desktop shell-u.

### 4.3. Minimalny desktop bridge

V1 Tauri bridge ma obslugiwac tylko:

- open file dialog,
- save file dialog,
- desktop menu actions,
- window lifecycle,
- ewentualnie `reveal in file manager`,
- ewentualnie `copy path`,
- ewentualnie `open recent`.

Nie przenosimy do Tauri:

- runtime orchestration,
- session state source of truth,
- solver selection source of truth,
- live preview transport.

---

## 5. Solver/runtime contract

### 5.1. Problem obecny

Dzisiaj runtime resolver pracuje zbyt mocno na poziomie:

- runtime family,
- lokalnych fallbackow,
- heurystyk backend/device.

To nie wystarczy do uczciwego wyboru solvera w UI.

### 5.2. Docelowy kontrakt

Kazdy runtime pack ma reklamowac jawne tuples:

- `fdm + cpu + single`
- `fdm + cpu + double`
- `fdm + gpu + single`
- `fdm + gpu + double`
- `fem + cpu + single`
- `fem + cpu + double`
- `fem + gpu + single`
- `fem + gpu + double`

Opcjonalnie rozszerzalne o:

- `mode = strict / extended / hybrid`
- `availability = available / installed / missing_driver / missing_runtime / gated`
- `stability = production / experimental`

### 5.3. Manifest runtime packa

Manifest `engines[]` musi przejsc z poziomu:

- "jaka rodzina runtime to jest"

na poziom:

- "jakie konkretne tuples backend/device/precision/mode ten runtime obsluguje".

Przyklad docelowy:

```json
{
  "family": "fdm-cuda",
  "version": "0.1.0-preprod",
  "worker": "bin/fullmag-fdm-cuda-bin",
  "engines": [
    {
      "backend": "fdm",
      "device": "gpu",
      "precision": "single",
      "mode": "strict",
      "public": true,
      "stability": "experimental"
    },
    {
      "backend": "fdm",
      "device": "gpu",
      "precision": "double",
      "mode": "strict",
      "public": true,
      "stability": "production"
    }
  ]
}
```

### 5.4. Zasada produktu

UI ma pokazywac wszystkie tuples, ale:

- wybieralne sa tylko te, ktore host oznaczy jako lokalnie dostepne,
- niedostepne tuple nie moga miec silent fallback,
- jesli runtime nie istnieje albo nie ma drivera, UI ma to pokazac jawnie.

To jest kluczowe:

> solver picker ma byc capability-driven, a nie oparty o frontendowe stale.

---

## 6. Metadata sesji i API

### 6.1. Session metadata do rozszerzenia

Do session/run metadata trzeba dodac:

- `requested_backend`
- `requested_device`
- `requested_precision`
- `requested_mode`
- `resolved_backend`
- `resolved_device`
- `resolved_precision`
- `resolved_mode`
- `resolved_runtime_family`
- `resolved_worker`
- `resolved_engine_tuple`

### 6.2. Host capability matrix endpoint

API ma wystawic jawny endpoint dla UI, np.:

```text
/v1/runtime/capabilities
```

Przykladowa odpowiedz:

```json
{
  "profile_version": "2026-04-06",
  "available_engines": [
    {
      "backend": "fdm",
      "device": "cpu",
      "precision": "double",
      "mode": "strict",
      "runtime_family": "cpu-reference",
      "status": "available",
      "installed": true,
      "public": true
    },
    {
      "backend": "fem",
      "device": "gpu",
      "precision": "double",
      "mode": "strict",
      "runtime_family": "fem-gpu",
      "status": "missing_runtime",
      "installed": false,
      "public": false
    }
  ]
}
```

### 6.3. Zrodlo prawdy

Zrodlem prawdy ma byc:

- launcher/runtime resolver,
- runtime manifests,
- lokalna diagnostyka hosta,
- a nie frontend.

---

## 7. UI solver selector

### 7.1. Zakres UI

W workspace trzeba dodac jawny `Solver / Runtime Selector`.

Minimalny zakres:

- backend: `auto / fdm / fem / hybrid`
- device: `cpu / gpu`
- precision: `single / double`
- mode: `strict / extended / hybrid`

### 7.2. Jak to ma byc pokazywane

Dla kazdego wariantu UI pokazuje:

- installed / missing
- runtime family
- gpu required / driver missing
- production / experimental / gated

### 7.3. Zasada UX

UI nie moze udawac dostepnosci.

Jesli tuple nie jest lokalnie dostepne:

- widac je,
- ale nie mozna go aktywowac bez czytelnego komunikatu.

### 7.4. Relacja z authoringiem

Solver selector ma byc czescia konfiguracji modelu i sesji, a nie tylko statusbarem.

Czyli:

- mozna go ustawic przy authoringu,
- mozna go inspectowac przy live runie,
- ale wykonanie ma byc zgodne z resolved tuple zapisanym w metadata sesji.

---

## 8. Tauri integration plan

### 8.1. Nowy desktop app

Dodajemy nowy app:

```text
apps/desktop
```

Zawartosc v1:

- `src-tauri/`
- `tauri.conf.json`
- prosty Rust desktop host
- minimalne komendy hostowe
- okno ladujace lokalny URL

### 8.2. `fullmag-ui` jako internal executable

Produktowo:

- `fullmag-ui` nie jest publicznym entrypointem dla uzytkownika,
- uruchamia go launcher `fullmag`,
- launcher przekazuje URL/API-port i launch intent.

### 8.3. Mechanika startu

Launcher robi:

1. start `fullmag-api`
2. przygotowanie live/bootstrap state
3. wyliczenie URL, np. `http://localhost:3000/` albo `http://localhost:8083/`
4. uruchomienie `fullmag-ui`
5. przekazanie:
   - `FULLMAG_UI_URL`
   - `FULLMAG_API_BASE`
   - opcjonalnie `FULLMAG_LAUNCH_INTENT`

Tauri robi:

1. czyta zmienne srodowiskowe,
2. otwiera glowne okno,
3. laduje lokalny URL,
4. udostepnia minimalny bridge desktopowy.

### 8.4. Dev mode

Relacja flag:

- `--ui` = desktop shell
- `--dev` = frontend dev server

Dozwolone scenariusze:

- `fullmag --ui --dev script.py`
  - launcher odpala API
  - launcher odpala web dev server
  - Tauri laduje dev URL

- `fullmag --ui script.py`
  - launcher odpala API
  - korzysta z built/static web
  - Tauri laduje static/local URL

Jesli kombinacja nie jest wspierana:

- launcher ma zwracac czytelny blad, nie fallback.

---

## 9. Packaging backendu i desktop shell-a

### 9.1. Linux

Linux jest pierwszym targetem done.

Release bundle ma zawierac:

- launcher `fullmag`
- `fullmag-bin`
- `fullmag-api`
- `fullmag-ui` (Tauri)
- `python/`
- `web/`
- `runtimes/*`
- `share/version.json`
- `share/licenses/`

Packaging script ma budowac:

1. binaries Rust
2. static web
3. Tauri desktop shell
4. runtime pack manifests
5. portable layout

### 9.2. Windows

Windows ma dostac ten sam kontrakt produktu:

- `bin/*.exe`
- `lib/*.dll`
- `python/`
- `web/`
- `runtimes/*`
- `share/*`

Nie zakladamy AppImage-like modelu.

Pierwszy target Windows:

- portable zip albo installer directory
- identyczna semantyka manifestow runtime i launchera

### 9.3. Nie robimy jeszcze

Na tym etapie nie robimy:

- macOS jako target done,
- jednego cross-platform installera dla wszystkich systemow,
- custom updatera,
- desktop-only asset pipeline.

---

## 10. Etapy wdrozenia

### Etap 1. Runtime contract

1. Rozszerzyc manifesty runtime packow o jawne tuples.
2. Dodac host-side parser/runtime registry.
3. Dodac capability matrix resolver.
4. Wyeliminowac silent fallback miedzy CPU/GPU i single/double.

Kryterium done:

- host umie wypisac wszystkie lokalnie znane tuples,
- UI/API ma juz zrodlo prawdy dla solver pickera.

### Etap 2. API i session metadata

1. Rozszerzyc `SessionManifest`.
2. Dodac `/v1/runtime/capabilities`.
3. Dodac resolved/requested runtime metadata do bootstrapu i state.

Kryterium done:

- frontend moze odczytac capability matrix i metadata sesji bez heurystyk.

### Etap 3. CLI `--ui`

1. Dodac parser i branch `--ui`.
2. Rozdzielic browser mode i desktop mode.
3. Przy `--ui` bez skryptu uruchamiac Start Hub.
4. Przy `--ui script.py` uruchamiac direct-open workspace.

Kryterium done:

- `fullmag --ui`
- `fullmag --ui script.py`

dzialaja end-to-end.

### Etap 4. Tauri shell

1. Dodac `apps/desktop`.
2. Zbudowac minimalne okno Tauri.
3. Podpiac env-based URL loading.
4. Dodac minimalny desktop bridge.

Kryterium done:

- lokalny UI odpala sie w desktopowym oknie zamiast w przegladarce.

### Etap 5. UI solver selector

1. Dodac fetch capability matrix.
2. Dodac selector backend/device/precision/mode.
3. Dodac statusy availability/install/gating.
4. Powiazac wybor z metadata sesji i compute commands.

Kryterium done:

- uzytkownik wybiera solver swobodnie, ale uczciwie, zgodnie z host capabilities.

### Etap 6. Linux release bundle

1. Rozszerzyc packaging script o Tauri.
2. Dolaczyc `fullmag-ui`.
3. Zweryfikowac runtime pack layout.
4. Zweryfikowac dzialanie bez systemowego Node.

Kryterium done:

- portable Linux bundle przechodzi smoke test bez dev toolingu.

### Etap 7. Windows parity

1. Wprowadzic packaging contract Windows.
2. Zbudowac Tauri Windows shell.
3. Zweryfikowac runtime pack layout.
4. Zweryfikowac launcher + desktop + runtime selection.

Kryterium done:

- Windows bundle dziala na tym samym kontrakcie logicznym.

---

## 11. Test plan

### 11.1. Runtime resolution

- `fullmag runtime doctor` pokazuje wszystkie runtime packi i tuples
- resolver dla kazdego tuple zwraca poprawny runtime family i worker
- brak silent fallback:
  - `single -> double`
  - `gpu -> cpu`
  - `fem -> fdm`

### 11.2. CLI behavior

- `fullmag --ui` -> Start Hub w Tauri
- `fullmag --ui script.py` -> direct workspace open w Tauri
- `fullmag script.py` -> browser mode
- `fullmag --headless script.py` -> bez desktop shell-a

### 11.3. UI solver selection

- UI renderuje capability matrix z API
- dostepny tuple jest wybieralny
- niedostepny tuple daje jawny komunikat
- resolved tuple zapisuje sie w metadata sesji

### 11.4. End-to-end matrix

Acceptance matrix:

- FDM CPU single
- FDM CPU double
- FDM GPU single
- FDM GPU double
- FEM CPU single
- FEM CPU double
- FEM GPU single
- FEM GPU double

Dla kazdego scenariusza trzeba potwierdzic:

- poprawny worker
- poprawny precision
- poprawny runtime family
- poprawny metadata trail
- brak brakujacych bibliotek przy starcie

---

## 12. Najwazniejsze decyzje koncowe

1. Desktop shell zmieniamy z `Electron` na `Tauri`.
2. `fullmag --ui` staje sie publicznym wejscie desktopowym.
3. Browser flow pozostaje wspierany.
4. Produkt pozostaje `launcher + runtime packs`, nie monolityczna binarka.
5. Solver selection w UI ma byc capability-driven.
6. `fullmag-api` pozostaje zrodlem prawdy dla desktop i web.
7. Linux x86_64 jest pierwszym targetem done.
8. Windows x86_64 jest drugim targetem na tym samym kontrakcie.

Najwazniejszy wniosek:

> Fullmag powinien byc rozwijany jako jeden Rust-first produkt z webowym frontendem wspoldzielonym przez browser i Tauri desktop shell, a nie jako osobna aplikacja Electronowa doklejona do istniejacego launchera.
