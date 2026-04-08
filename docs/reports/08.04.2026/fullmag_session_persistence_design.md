
# Fullmag — profesjonalny mechanizm zapisu i odtwarzania sesji symulacji (`.fms`)

## 0. Executive summary

Ten dokument projektuje **pełny system zapisu, odtwarzania, autosave i exact-resume sesji symulacji** dla Fullmaga, wzorowany funkcjonalnie na tym, co użytkownik oczekuje od COMSOL-a, ale dopasowany do **aktualnej architektury Fullmaga**: jednego lokalnego control roomu, singletonowego workspace `.fullmag/local-live/`, istniejących endpointów `state/export` / `state/import` / `script/sync` / `scene`, oraz bogatego strumienia `SessionState` po WebSocket i bootstrapie.

Najważniejsza decyzja projektowa:

> **Nie zapisujemy surowego zrzutu RAM procesu.**
> Zapisujemy **logiczną migawkę stanu sesji**: model, UI, stan solvera, pola, checkpointy, artefakty i metadane kompatybilności, a zasoby pochodne i nieprzenośne (wskaźniki, uchwyty, gniazda, konteksty CUDA, plany FFT, preconditionery, bufory tymczasowe) są **odtwarzane** podczas ładowania.

To jest jedyna profesjonalna droga, jeśli system ma być:
- przenośny między maszynami,
- stabilny między wersjami Fullmaga,
- możliwy do walidacji,
- bezpieczny,
- odporny na crashe,
- i sensowny dla FDM, FEM, przyszłych sweepów, eigensolve, dyspersji i magnetoelastyki.

## 1. Dlaczego nie „całkowity zrzut pamięci procesu”

Użytkownikowo chcesz efektu „jak w COMSOL-u”: klikam **Save**, zamykam aplikację, wracam później i wszystko mam z powrotem — skrypt, UI, pola, aktualny czas symulacji, wykresy, ustawienia podglądu, stan solvera.

To jest cel poprawny.

Natomiast **dosłowny dump pamięci procesu** jest błędnym mechanizmem implementacyjnym. Nie wolno go przyjąć jako format sesji z czterech powodów:

1. **Nieprzenośność binarna**  
   Surowy heap zależy od:
   - architektury CPU,
   - kompilatora,
   - alignmentu struktur,
   - wersji bibliotek,
   - sterownika CUDA,
   - wersji MFEM/hypre/libCEED,
   - układu wirtualnej pamięci,
   - oraz konkretnej sesji systemowej.

2. **Nieodtwarzalność zasobów runtime**  
   W pamięci procesu siedzą rzeczy, których nie da się poprawnie „wczytać” po restarcie:
   - wskaźniki,
   - deskryptory plików,
   - gniazda sieciowe,
   - handle GPU,
   - konteksty CUDA,
   - plany FFT,
   - preconditionery,
   - kolejki async,
   - uchwyty wątków,
   - timery i callbacki.

3. **Brak kompatybilności wersyjnej**  
   Po zmianie struktury C++/Rust/TS dump staje się bezużyteczny. Profesjonalny format sesji musi mieć:
   - wersjonowanie,
   - zgodność wsteczną,
   - degradację z `resume_exact` do `open_project_only`,
   - jawne sprawdzanie kompatybilności.

4. **Ryzyko bezpieczeństwa i integralności**  
   Dump pamięci może zawierać:
   - przypadkowe sekrety,
   - śmieci i nieużywane obszary,
   - wewnętrzne tokeny,
   - niejawne dane diagnostyczne,
   - a do tego jest bardzo trudny do walunkowej walidacji.

Dlatego implementujemy **session image**, a nie **heap dump**.

## 2. Aktualny stan repo, do którego projekt musi pasować

Projekt nie może być oderwany od realnego Fullmaga.

### 2.1 Co już istnieje w publicznym repo

Fullmag jest dziś budowany jako:
- **jedna aplikacja użytkowa**,
- z **jednym lokalnym control roomem w przeglądarce**,
- z workspace pod `.fullmag/local-live/`,
- z bootstrapem current-live,
- oraz z istniejącym API control-plane.  
Z README wynika też wprost, że domyślny lokalny workflow aktualizuje singletonowy workspace i kieruje przeglądarkę na `/`. Dalej README podaje, że live control data idzie przez `/ws/live/current`.  

To oznacza, że sesja nie powinna być osobnym obcym subsystemem; powinna być **sformalizowaniem aktualnego live workspace**.

### 2.2 Co już istnieje po stronie API

W `apps/web/lib/liveApiClient.ts` są już wystawione URL-e:
- `bootstrap`,
- `ws`,
- `commands`,
- `preview`,
- `previewSelection`,
- `importAsset`,
- `exportState`,
- `importState`,
- `scriptSync`,
- `scene`,
- `gpuTelemetry`.

To jest bardzo ważne: **warstwa transportowa pod zapis/odczyt sesji już semantycznie istnieje**.

### 2.3 Co już istnieje po stronie stanu UI / sesji

Aktualny `SessionState` w `apps/web/lib/session/types.ts` jest już szeroki i zawiera m.in.:
- `session` (`SessionManifest`),
- `run` (`RunManifest`),
- `live_state`,
- `runtime_status`,
- `capabilities`,
- `metadata`,
- `mesh_workspace`,
- `scene_document`,
- `script_builder`,
- `model_builder_graph`,
- `scalar_rows`,
- `engine_log`,
- `quantities`,
- `fem_mesh`,
- `latest_fields`,
- `artifacts`,
- `display_selection`,
- `preview_config`,
- `preview`,
- `command_status`.

Dodatkowo:
- `SessionManifest` już niesie `session_id`, `run_id`, `script_path`, `problem_name`, requested/resolved backend/device/precision/mode, `artifact_dir`, znaczniki czasu, i `plan_summary`.
- `RunManifest` niesie stan końcowy energii, czas i `artifact_dir`.
- `LiveState` niesie `step`, `time`, `dt`, energie, `grid`, `preview_grid`, `fem_mesh`, `magnetization`, `finished`.
- `LatestFields` już ma mapę `fields: Record<string, Float64Array | null>`.
- `QuantityDescriptor` ma `preview_quantities` / `snapshot_quantities` po stronie capabilities, więc repo już myśli o snapshotach pól.
- `SceneDocument` ma prawie cały aktualny stan authoringu i sceny.
- `MeshWorkspaceState` ma historię i status budowy siatki.
- `ScalarRow` i `EngineLogEntry` już modelują logi i ścieżkę scalar outputs.

Wniosek: **sesja w Fullmagu jest dziś „prawie” ustrukturyzowana — brakuje tylko formalnego, wersjonowanego persistence layer i exact-resume backendów**.

## 3. Cel systemu

System ma dawać użytkownikowi dokładnie te możliwości:

1. **Save Session**  
   Zapisuje całą bieżącą pracę w jeden plik.

2. **Open Session**  
   Otwiera plik sesji i przywraca workspace.

3. **Save As…**  
   Zapisuje kopię sesji pod nową nazwą.

4. **Autosave / Recovery**  
   Po crashu Fullmag oferuje odzyskanie pracy.

5. **Continue / Resume**  
   Jeśli zapis zawiera checkpoint i jest kompatybilny, można kontynuować solver od miejsca przerwania.

6. **Open as Project Only**  
   Jeśli exact resume nie jest możliwe, sesja nadal otwiera:
   - UI,
   - skrypt,
   - scenę,
   - parametry,
   - i opcjonalnie ostatni stan pola jako initial condition.

7. **Archive / Share**  
   Jeden plik można przenieść na inną maszynę.

## 4. Zakres: co dokładnie ma być zapisywane

System ma umieć zapisać:

### 4.1 Warstwa projektu / authoringu
- aktualny główny skrypt Python,
- niesynchronizowany bufor edytora,
- pomocnicze pliki źródłowe projektu (opcjonalnie),
- `ProblemIR` / znormalizowane `ProblemIR`,
- stan scene buildera,
- `scene_document`,
- `script_builder`,
- `model_builder_graph`,
- zaimportowane assety,
- materiały, obiekty, mapowania magnetyzacji, tekstury, transformacje.

### 4.2 Warstwa UI / UX
- układ paneli,
- aktywne zakładki,
- zaznaczenia,
- konfigurację preview,
- display selection,
- stan wykresów/analyze,
- stan meshowego workspace,
- stan sceny 3D (kamera, widoczności, opacity, isolate/context itp.),
- ustawienia quick access i widoków.

### 4.3 Warstwa runtime / solver
- current session / run manifest,
- status runtime,
- plan wykonania,
- resolved backend / device / precision / mode,
- stan czasu symulacji,
- licznik kroków,
- bieżące `dt`,
- stan integratora,
- stan RNG dla termiki,
- stan pól pierwotnych,
- opcjonalnie stan pól pochodnych,
- ostatnie logi,
- scalar rows,
- quantity registry,
- metadata kompatybilności,
- checkpointy.

### 4.4 Warstwa danych solverowych
Dla FDM:
- `m(x,y,z)` / magnetyzacja,
- opcjonalnie `H_eff`, `H_demag`, `H_ex`, `H_ext`, `H_anis`, `H_dmi`, `torque`, energy densities,
- maski / regiony / grid descriptor,
- stan historii integratora.

Dla FEM:
- solver mesh,
- opis przestrzeni FE,
- wektory DOF pól,
- mapowanie DOF / ordering,
- opcjonalnie pola zrekonstruowane do preview,
- przyszłościowo również `u`, `v`, `a` dla mechaniki.

### 4.5 Warstwa wyników / artefaktów
- artifacts index,
- wybrane pliki wynikowe,
- wyniki analyze,
- snapshoty dyspersji / eigen / modów własnych,
- logi, trace’e, scalar outputs.

## 5. Zakres negatywny — czego nie zapisujemy

Nie zapisujemy jako części sesji:
- wskaźników do pamięci procesu,
- kontekstów CUDA,
- handle’ów do bibliotek,
- planów FFT,
- obiektów solvera zależnych od wersji sterownika,
- deskryptorów plików,
- socketów,
- worker thread state,
- cache’y pochodnych, które można tanio odbudować, chyba że użytkownik explicite chce je zachować.

Zapisujemy **stan logiczny**, a nie mechanikę wykonania procesu.

## 6. Główna architektura rozwiązania

![Architektura systemu sesji](fullmag_session_architecture.png)


Projekt ma dwa poziomy:

### 6.1 Poziom A — wewnętrzny `SessionStore`
To jest **kanoniczna forma persistence w runtime**.  
Jest to katalogowy store pod lokalnym workspace, zoptymalizowany pod:
- autosave,
- crash recovery,
- checkpointing,
- deduplikację obiektów,
- atomowe commity,
- szybki update.

### 6.2 Poziom B — przenośny plik `.fms`
To jest **jednoplikowy format użytkownika**:
- do `Save`,
- `Save As`,
- `Open`,
- archiwizacji,
- przenoszenia między maszynami.

Plik `.fms` jest eksportem `SessionStore`.

### 6.3 Dlaczego dwa poziomy, a nie tylko jeden plik
Gdybyśmy autosave robili przez ciągłe nadpisywanie wielkiego pliku `.fms`, dostalibyśmy:
- duży narzut I/O,
- słabą odporność na crash w połowie zapisu,
- brak incremental updates,
- słabą deduplikację między checkpointami.

Dlatego:
- **wewnętrznie**: directory/CAS store,
- **zewnętrznie**: jeden plik.

To daje UX „jak COMSOL”, ale implementacyjnie jest dużo lepsze.

## 7. Nazewnictwo i typy bytów

### 7.1 Pojęcia
- **Workspace** — lokalny bieżący stan aplikacji (`.fullmag/local-live/`).
- **Session** — zapisany stan pracy użytkownika.
- **Run** — jedno uruchomienie solvera.
- **Checkpoint** — punkt wznowienia konkretnego runu.
- **Recovery snapshot** — lokalny autosave po awarii.
- **Artifact** — plik wynikowy / analiza / eksport.
- **SessionStore** — wewnętrzny store stanu.
- **`.fms`** — przenośny plik sesji Fullmaga.

### 7.2 Rozszerzenia plików
Rekomendacja:
- `.fms` — **Fullmag Session** (format użytkownika),
- `.fms.lock` — lock pliku,
- `.fms.part` — plik tymczasowy podczas zapisu,
- recovery lokalnie nie jako osobne rozszerzenie, tylko jako store w workspace.

Jeżeli chcesz osobny user-visible format recovery, można dodać:
- `.fmr` — Fullmag Recovery,  
ale w v1 nie jest to konieczne.

## 8. Format pliku użytkownika

## 8.1 Decyzja: `ZIP64` jako kontener z deterministycznym layoutem

Rekomenduję:
- **outer container:** `ZIP64`
- **małe dokumenty:** JSON UTF-8
- **duże tensory:** chunkowane binaria z descriptorami
- **duże obiekty:** content-addressed objects
- **ciężkie dane:** kompresowane per-object, nie przez cały zip

### 8.2 Dlaczego ZIP64
Zalety:
- jeden plik,
- central directory,
- szerokie wsparcie narzędziowe,
- łatwe streamowanie do pobrania,
- łatwe dodanie podpisów / manifestów,
- dobre wsparcie w Rust i Pythonie.

### 8.3 Dlaczego nie HDF5 jako format główny
HDF5 jest bardzo dobry dla danych naukowych, ale jako **cały format sesji aplikacji** ma w tym projekcie gorszy fit:
- trudniejsze wersjonowanie małych dokumentów UI,
- cięższy stos zależności,
- gorszy fit do content-addressed export/import,
- słabsza ergonomia dla mieszaniny:
  - skryptów,
  - JSON-ów,
  - assetów,
  - logów,
  - checkpointów,
  - wyników analitycznych,
  - i binarnych pól.

HDF5 można w przyszłości użyć jako **opcjonalnego formatu eksportu samych pól**.  
Nie jako format całej sesji.

## 8.4 Struktura logiczna `.fms`

![Układ archiwum `.fms`](fullmag_session_package_tree.png)


```text
example.fms
├─ manifest/
│  ├─ session.json
│  ├─ workspace.json
│  ├─ export_profile.json
│  ├─ compatibility.json
│  └─ signatures.json              (opcjonalnie)
├─ project/
│  ├─ main.py
│  ├─ editor_buffer.py
│  ├─ source_manifest.json
│  ├─ problem_ir.json
│  ├─ normalized_problem_ir.json
│  ├─ scene_document.json
│  ├─ script_builder.json
│  ├─ model_builder_graph.json
│  ├─ ui_state.json
│  └─ assets/
│     └─ index.json
├─ runs/
│  └─ run-000001/
│     ├─ run_manifest.json
│     ├─ runtime_status.json
│     ├─ plan.json
│     ├─ live_state.json
│     ├─ quantities.json
│     ├─ scalar_rows.csv
│     ├─ engine_log.jsonl
│     ├─ meshes/
│     │  ├─ fdm_grid.json
│     │  ├─ solver_mesh.meta.json
│     │  ├─ solver_mesh.bin
│     │  └─ preview_mesh.json
│     ├─ checkpoints/
│     │  └─ cp-000123/
│     │     ├─ checkpoint.json
│     │     ├─ common_state.json
│     │     ├─ integrator.json
│     │     ├─ rng.json
│     │     ├─ field_index.json
│     │     ├─ backend_state.json
│     │     └─ object_refs.json
│     └─ artifacts/
│        ├─ index.json
│        └─ ...
└─ objects/
   └─ sha256/
      └─ ab/
         └─ cd/
            └─ <hash>.blob
```

## 9. Kanoniczny wewnętrzny `SessionStore`

### 9.1 Lokalizacja
Proponowana lokalizacja:

```text
.fullmag/local-live/
├─ session-store/
│  ├─ CURRENT
│  ├─ manifests/
│  ├─ runs/
│  ├─ objects/
│  ├─ temp/
│  └─ recovery/
├─ workspace/
├─ cache/
└─ imports/
```

### 9.2 Zasada działania
- `objects/` to content-addressed store (`sha256`),
- każdy checkpoint i manifest trzyma tylko referencje do obiektów,
- nowe obiekty są zapisywane do `temp/`,
- po weryfikacji hasha są promowane do `objects/`,
- manifest checkpointu jest zapisywany atomowo,
- plik `CURRENT` jest przestawiany atomowo na najnowszą sesję/checkpoint.

### 9.3 Po co content-addressed store
Bo wtedy:
- nie duplikujesz tego samego assetu 50 razy,
- nie duplikujesz solver mesh, jeśli checkpointów jest wiele,
- możesz deduplikować identyczne preview albo artefakty,
- możesz robić później garbage collection po referencjach.

## 10. Profile zapisu — bez tego projekt będzie albo za ciężki, albo za ubogi

To jest kluczowy element.  
COMSOL rozróżnia w praktyce pełne pliki z rozwiązaniem, pliki compact i recovery. Fullmag też musi to mieć.

### 10.1 Profil `compact`
Zawiera:
- skrypt,
- editor buffer,
- ProblemIR,
- scene,
- UI,
- ustawienia,
- assety projektu,
- bez solver mesh,
- bez pól,
- bez wyników.

Use case:
- udostępnianie projektu,
- lekki zapis,
- commit do repo,
- otwarcie i ponowne uruchomienie.

### 10.2 Profil `solved`
Zawiera:
- wszystko z `compact`,
- solver mesh,
- ostatni stan głównych pól,
- scalar rows,
- engine log,
- wybrane artifacts,
- bez exact integrator state.

Use case:
- „otwórz projekt z wynikami”,
- jak pełny model z zapisanym rozwiązaniem.

### 10.3 Profil `resume`
Zawiera:
- wszystko z `solved`,
- exact checkpoint state,
- RNG state,
- integrator state,
- backend restart payload,
- kompatybilność wznowienia.

Use case:
- przerwanie i dokończenie obliczeń,
- przeniesienie na kompatybilny runtime,
- restart po zamknięciu aplikacji.

### 10.4 Profil `archive`
Zawiera:
- wszystko z `resume`,
- wiele checkpointów,
- pełne artifacts,
- analyze outputs,
- dodatkowe preview cache,
- opcjonalne zależności źródłowe projektu.

Use case:
- pełna archiwizacja,
- długoterminowa reprodukcja,
- publikacje / audyty.

### 10.5 Profil `recovery`
To profil wewnętrzny, niekoniecznie user-visible:
- szybki zapis,
- zoptymalizowany pod częste nadpisywanie,
- zwykle tylko najnowszy checkpoint + minimum UI.

Use case:
- crash recovery.

## 10.6 Tabela profilów

| Profil | Model/Script | UI | Mesh | Primary fields | Derived fields | Integrator/RNG | Artifacts | Exact resume |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| compact | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| solved | ✅ | ✅ | ✅ | ✅ | opcjonalnie | ❌ | wybrane | ❌ |
| resume | ✅ | ✅ | ✅ | ✅ | opcjonalnie | ✅ | wybrane | ✅ |
| archive | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| recovery | ✅ minimum | ✅ minimum | zależnie | ✅ minimum | opcjonalnie | ✅ | ❌ / minimum | ✅ |

## 11. Klasy odtwarzania

To musi być jawne. Nie każdy zapis da się wznowić dokładnie tak samo.

### 11.1 `exact_resume`
Warunki:
- zgodny `restart_abi`,
- zgodny backend family,
- zgodna dyskretyzacja,
- zgodny integrator,
- zgodna precyzja,
- zgodny `plan_hash`,
- zgodny `mesh/grid signature`.

Efekt:
- solver wznawia krok po kroku od checkpointu.

### 11.2 `logical_resume`
Warunki:
- stan fizyczny i dyskretyzacja są kompatybilne,
- ale runtime/engine może się różnić.

Efekt:
- sesja wznawia od zapisanego stanu pól,
- ale bitwise identyczność nie jest gwarantowana.

### 11.3 `initial_condition_import`
Warunki:
- exact resume niemożliwe,
- ale pole `m` / `u` / inne primary state można zaimportować / przemapować.

Efekt:
- sesja otwiera się jako nowy run z zapisanym stanem początkowym.

### 11.4 `config_only`
Warunki:
- nie da się wiarygodnie użyć zapisanych stanów solvera.

Efekt:
- otwieramy projekt, UI, scene, skrypt, ustawienia,
- użytkownik może uruchomić od nowa.

## 11.5 Macierz degradacji

![Klasy odtwarzania](fullmag_session_restore_classes.png)


```text
exact_resume
   ↓
logical_resume
   ↓
initial_condition_import
   ↓
config_only
```

Nigdy nie robimy „fail hard”, jeśli można otworzyć projekt.

## 12. Model kompatybilności

## 12.1 Hashy i sygnatury
Każdy checkpoint musi nieść:

- `problem_hash`
- `normalized_problem_hash`
- `plan_hash`
- `state_schema_version`
- `restart_abi`
- `engine_id`
- `runtime_family`
- `precision`
- `study_kind`
- `discretization_signature`
- `mesh_signature` albo `grid_signature`
- `field_layout_signature`

### 12.2 `restart_abi`
To nie jest wersja całego Fullmaga, tylko wersja **semantyki wznowienia**.

Przykład:
```json
{
  "restart_abi": "fullmag.fdm.cuda.llg.v1",
  "engine_id": "native.fdm.cuda.fp64",
  "precision": "f64",
  "integrator": "rk45",
  "study_kind": "time_evolution"
}
```

Zmiana tego pola oznacza:
- stary checkpoint może nadal się **otworzyć**,
- ale exact resume nie jest już gwarantowany.

## 13. Źródła prawdy i reguły rozstrzygania konfliktów

W sesji masz wiele reprezentacji tego samego bytu:
- skrypt Python,
- znormalizowane `ProblemIR`,
- `scene_document`,
- `script_builder`,
- `model_builder_graph`,
- resolved `plan`,
- checkpoint stanu solvera.

To trzeba uporządkować.

### 13.1 Kolejność autorytetu

1. **Checkpoint + resolved plan**  
   Autorytet dla `resume`.

2. **Normalized ProblemIR**  
   Autorytet dla reprodukcji modelu.

3. **Main script + source bundle**  
   Autorytet dla authoringu użytkownika.

4. **scene_document / script_builder / model_builder_graph**  
   Autorytet dla odtworzenia UI.

### 13.2 Gdy skrypt i ProblemIR się nie zgadzają
Jeśli w sesji:
- skrypt ma hash A,
- `normalized_problem_ir.json` ma hash B,
- a w manifestach zapisano, że zostały wygenerowane w różnym czasie,

to:
- dla `resume` używamy checkpoint + plan,
- dla `open_project` otwieramy skrypt jako tekst i pokazujemy ostrzeżenie,
- użytkownik może wybrać:
  - „Zaufaj ProblemIR / otwórz stan solvera”,
  - „Przebuduj model ze skryptu”,
  - „Otwórz tylko źródła”.

## 14. Schemat manifestów

## 14.1 `manifest/session.json`
Minimalny shape:

```json
{
  "format": "fullmag.session.v1",
  "package_uuid": "uuid",
  "profile": "resume",
  "created_at_unix_ms": 1760000000000,
  "created_by": {
    "fullmag_version": "0.1.0-dev",
    "git_commit": "abcdef",
    "runtime_family": "local-live"
  },
  "default_open_action": "resume_if_possible",
  "active_run_id": "run-000001",
  "workspace_manifest_ref": "manifest/workspace.json",
  "compatibility_ref": "manifest/compatibility.json",
  "export_options_ref": "manifest/export_profile.json"
}
```

## 14.2 `manifest/workspace.json`
```json
{
  "workspace_id": "current-live",
  "session_id": "session-123",
  "ui_state_ref": "project/ui_state.json",
  "scene_document_ref": "project/scene_document.json",
  "script_builder_ref": "project/script_builder.json",
  "model_builder_graph_ref": "project/model_builder_graph.json",
  "main_script_ref": "project/main.py",
  "editor_buffer_ref": "project/editor_buffer.py",
  "problem_ir_ref": "project/problem_ir.json",
  "normalized_problem_ir_ref": "project/normalized_problem_ir.json",
  "asset_index_ref": "project/assets/index.json"
}
```

## 14.3 `runs/<run_id>/run_manifest.json`
```json
{
  "run_id": "run-000001",
  "study_kind": "time_evolution",
  "status": "paused",
  "requested_backend": "fdm",
  "resolved_backend": "fdm_cuda",
  "resolved_engine_id": "native.fdm.cuda.fp64",
  "precision": "f64",
  "plan_hash": "sha256:...",
  "plan_ref": "runs/run-000001/plan.json",
  "latest_checkpoint_id": "cp-000123",
  "latest_checkpoint_ref": "runs/run-000001/checkpoints/cp-000123/checkpoint.json"
}
```

## 14.4 `runs/<run_id>/checkpoints/<cp_id>/checkpoint.json`
```json
{
  "checkpoint_id": "cp-000123",
  "run_id": "run-000001",
  "created_at_unix_ms": 1760000001234,
  "reason": "manual_save",
  "safe_point": "accepted_step",
  "restore_class": "exact_resume",
  "restart_abi": "fullmag.fdm.cuda.llg.v1",
  "engine_id": "native.fdm.cuda.fp64",
  "integrator": "rk45",
  "precision": "f64",
  "study_kind": "time_evolution",
  "time_s": 2.4e-9,
  "step": 24000,
  "dt_s": 1e-13,
  "common_state_ref": "runs/run-000001/checkpoints/cp-000123/common_state.json",
  "integrator_ref": "runs/run-000001/checkpoints/cp-000123/integrator.json",
  "rng_ref": "runs/run-000001/checkpoints/cp-000123/rng.json",
  "field_index_ref": "runs/run-000001/checkpoints/cp-000123/field_index.json",
  "backend_state_ref": "runs/run-000001/checkpoints/cp-000123/backend_state.json"
}
```

## 15. Przechowywanie dużych pól i tensorów

## 15.1 Nie zapisujemy wielkich tensorów inline w JSON
Wszystkie duże pola trafiają do object store.

### 15.2 Deskrpytor tensora
Dla każdego pola przechowujemy descriptor:

```json
{
  "format": "fullmag.tensor.v1",
  "name": "m",
  "dtype": "f64",
  "endianness": "little",
  "logical_axes": ["z", "y", "x", "c"],
  "shape": [1, 256, 256, 3],
  "chunk_shape": [1, 64, 64, 3],
  "component_labels": ["x", "y", "z"],
  "layout": "component_last",
  "chunks": [
    {
      "index": [0, 0, 0, 0],
      "object_id": "sha256:...",
      "codec": "zstd",
      "uncompressed_bytes": 1572864
    }
  ]
}
```

## 15.3 Zasady tensor storage
- endian: zawsze `little`,
- dtype: `u8`, `i32`, `u32`, `f32`, `f64`,
- chunk target: 4–16 MiB niekompresowane,
- chunks są niezależnymi obiektami CAS,
- manifest pola opisuje porządek osi.

## 15.4 Polityka dla FDM
Dla FDM kanoniczny layout serializacji:
- `logical_axes = ["z", "y", "x", "c"]`,
- linearizacja:
  `(((z * ny) + y) * nx + x) * nc + c`,
- `c = 3` dla pól wektorowych,
- skalary bez osi `c`.

To eliminuje dwuznaczność.

## 15.5 Polityka dla FEM
Dla exact resume FEM zapisujemy:
- **raw solver vector** jako tensor `["dof"]`,
- osobno `fespace_descriptor.json`,
- osobno `solver_mesh` w formacie backend-native.

Dla UI opcjonalnie zapisujemy dodatkowo:
- nodal preview `[node, c]`,
- surface preview mesh.

## 16. Jakie pola zapisujemy naprawdę

## 16.1 Podział na klasy pól
Każde pole ma jedną z ról:

- `primary` — konieczne do wznowienia,
- `resume_aux` — konieczne dla exact resume,
- `derived_cached` — zachowywane tylko dla wygody / szybkiego otwarcia,
- `rebuildable` — można je przeliczyć po wczytaniu,
- `preview_only` — mały cache do UI.

## 16.2 Domyślny zestaw dla profilu `resume`
### FDM / LLG
Mandatory:
- `m`
- `time, step, dt`
- integrator state
- RNG state (jeśli jest termika)
- grid / masks / regions / plan signature

Optional:
- `H_eff`
- `H_demag`
- `H_ex`
- `H_ext`
- energy density maps
- torque maps

### FEM / LLG
Mandatory:
- solver mesh
- FE space descriptor
- main DOF vector(y)
- `time, step, dt`
- integrator state
- RNG state
- plan signature

Optional:
- projected magnetization preview
- selected field reconstructions

## 16.3 Zapis „wszystkich pól”
Ponieważ użytkownik explicite chce:
> „stan magnetyzacji wraz ze wszystkimi polami itp.”

system ma mieć `field_capture_policy`:

- `none`
- `primary_only`
- `required_for_resume`
- `current_cached`
- `all_registered_quantities`
- `explicit_list`

Domyślnie:
- `solved` → `primary_only + current_cached`
- `resume` → `required_for_resume + current_cached`
- `archive` → `all_registered_quantities`

## 17. Stan integratorów — precyzyjnie

## 17.1 Zasada ogólna
Checkpoint robimy **tylko na bezpiecznych granicach**, nie w połowie kroku.

To upraszcza wznowienie i unika zapisu efemerycznego stanu stage buffers.

### Dozwolone safe points:
- po zaakceptowanym kroku czasowym,
- po zakończonym sample sweepa,
- po zakończonym sample `k` w dyspersji,
- po zakończonej iteracji outer solve,
- gdy runtime jest `paused` / `idle` / `completed`.

### Niedozwolone:
- w połowie CUDA kernela,
- w połowie iteracji Newtona bez jawnego backend support,
- w połowie ABM predictor-corrector bez zapisania pełnego history state.

## 17.2 One-step integratory (Heun, RK4, RK23, RK45)
Dla problemu:
\[
\dot{y} = F(t, y)
\]

jeśli checkpoint jest robiony **po zaakceptowanym kroku** \(n\), wystarczy zapisać:
- \(y_n\),
- \(t_n\),
- bieżące `dt`,
- sugerowane następne `dt`,
- stan kontrolera adaptacji,
- liczniki accepted/rejected,
- ostatni error norm (jeśli potrzebny do heurystyki następnego kroku).

Nie trzeba zapisywać stage buffers, jeśli checkpoint nie jest mid-step.

## 17.3 ABM3
Dla ABM3 trzeba zapisać historię.

Predyktor:
\[
y_{n+1}^{pred}
=
y_n + \frac{h}{12}(23f_n - 16f_{n-1} + 5f_{n-2})
\]

Korektor:
\[
y_{n+1}
=
y_n + \frac{h}{12}(5f_{n+1}^{pred} + 8f_n - f_{n-1})
\]

Żeby wznowić **dokładnie** po kroku \(n\), trzeba zapisać:
- \(y_n\),
- \(t_n\),
- \(h_n\) lub historię kroków przy adaptacji,
- \(f_n\),
- \(f_{n-1}\),
- \(f_{n-2}\),
- ewentualnie współczynniki/Nordsieck state, jeśli ABM3 jest adaptacyjny.

Wniosek: ABM3 **musi mieć własny serializer historii**.

## 17.4 Termika / thermal noise
Dla stochastic LLG nie wolno zapisywać „stan rand() hosta”.  
Trzeba przejść na **counter-based RNG** (np. logika typu seed + counter + stream id), bo tylko to daje:
- stabilne wznowienie,
- niezależność od liczby wątków,
- przewidywalność przy GPU.

Minimalny stan RNG:
- `global_seed`,
- `stream_family`,
- `counter_base`,
- `substream_per_cell` lub odpowiednik,
- `last_consumed_nonce`.

## 18. Backend-specific payload

## 18.1 Zasada
Oprócz wspólnego schematu sesji każdy backend dostaje własny, wersjonowany payload.

To jest najczystszy kompromis między:
- jednolitym formatem sesji,
- a realiami różnych backendów.

### 18.2 Kontrakt
Wspólna warstwa serializuje:
- projekt,
- UI,
- manifesty,
- checkpoint common state.

Backend serializuje:
- swój minimalny exact-resume payload,
- w pliku `backend_state.json`,
- i opcjonalnych obiektach binarnych.

## 18.3 FDM payload
Przykład:

```json
{
  "format": "fullmag.backend.fdm.v1",
  "grid": {
    "nx": 256,
    "ny": 256,
    "nz": 1,
    "dx": 2e-9,
    "dy": 2e-9,
    "dz": 2e-9,
    "pbc": [false, false, false]
  },
  "region_mask_ref": "sha256:...",
  "active_mask_ref": "sha256:...",
  "material_table_ref": "sha256:...",
  "primary_field_refs": {
    "m": "sha256:..."
  },
  "history_field_refs": {
    "f_n": "sha256:...",
    "f_n_minus_1": "sha256:..."
  }
}
```

## 18.4 FEM payload
Przykład:

```json
{
  "format": "fullmag.backend.fem.v1",
  "mesh_format": "mfem.native.v1",
  "solver_mesh_ref": "sha256:...",
  "fespace_ref": "sha256:...",
  "state_vector_ref": "sha256:...",
  "projection_preview_ref": "sha256:...",
  "mechanics_state_ref": null
}
```

## 19. Meshe i geometria

## 19.1 Solver mesh musi być częścią sesji `solved/resume/archive`
Dla FEM bez solver mesh exact resume nie istnieje.

### 19.2 Dwie reprezentacje mesha
- **solver mesh** — natywny, potrzebny solverowi,
- **preview mesh** — lekki, potrzebny UI.

Nie należy mieszać jednego z drugim.

### 19.3 FDM
Dla FDM mesh jest logicznie gridem, więc zapisujesz:
- grid descriptor,
- region masks,
- occupancy / active mask,
- przyszłościowo volume fractions / face links jeśli pojawi się cut-cell.

## 20. Artifacts i wyniki

## 20.1 Artifact policy
Każda sesja ma `artifact_policy`:
- `none`
- `index_only`
- `selected`
- `all`

### 20.2 Dlaczego nie wszystko zawsze
Bo sesja może urosnąć do wielu GB lub dziesiątek GB.  
COMSOL też rozróżnia modele compact, solved, recovery i sugeruje ograniczanie przechowywanych danych wynikowych.

### 20.3 Artifact index
`artifacts/index.json` powinien zawierać:
- ścieżkę logiczną,
- typ,
- size,
- object id albo path,
- czy artifact jest obowiązkowy, opcjonalny, preview-only.

## 21. Projekt UI save/open/recovery

## 21.1 Główne komendy w UI
Menu `File`:
- `Open Session…`
- `Save`
- `Save As…`
- `Export Session…`
- `Import Session…`
- `Recover Last Session…`
- `Open Read-Only`

## 21.2 Save dialog
Opcje:
- profil (`compact/solved/resume/archive`)
- include current fields
- include all cached fields
- include artifacts
- include logs
- include meshes
- include local source files
- compression profile (`speed/balanced/smallest`)
- behavior if runtime is running:
  - `pause → snapshot → resume`
  - `pause → snapshot → remain paused`
  - `only save when paused`

## 21.3 Open dialog
Po wczytaniu `.fms` backend wykonuje **inspect** i zwraca:
- podstawowe metadata,
- rozmiar,
- profile,
- czy można exact resume,
- ewentualne ostrzeżenia,
- czy skrypt jest trusted.

Użytkownik widzi:
- `Resume exactly`
- `Open and continue logically`
- `Use saved state as initial condition`
- `Open project only`
- `Open read-only`

## 21.4 Recovery dialog
Na starcie aplikacji:
- jeśli istnieją recovery snapshots,
- control room pokazuje recovery modal,
- z listą:
  - session name,
  - czas autosave,
  - study kind,
  - krok / czas fizyczny,
  - rozmiar,
  - status kompatybilności.

Akcje:
- `Resume`
- `Save As…`
- `Open Read-Only`
- `Delete Recovery`

## 22. File locking

COMSOL blokuje MPH-file tak, żeby jeden użytkownik edytował plik naraz. Fullmag powinien zrobić to samo.

### 22.1 Zasada
Jeśli użytkownik otwiera `foo.fms` w trybie editable:
- tworzony jest `foo.fms.lock`
- lock zawiera:
  - host,
  - pid,
  - username,
  - timestamp,
  - session id.

### 22.2 Zachowanie
- jeśli lock jest aktywny → proponujemy `Open Read-Only`,
- jeśli lock jest stale/stale_pid → proponujemy `Break Stale Lock`.

### 22.3 Lock dla internal SessionStore
W `.fullmag/local-live/session-store/LOCK` trzymamy lokalny lock workspace, by uniknąć dwóch hostów/instancji piszących ten sam store.

## 23. Save/Load transaction model

## 23.1 Zapis
1. frontend zbiera UI snapshot,
2. wysyła request export,
3. backend zatrzymuje runtime w safe point,
4. synchronizuje backend (`cudaDeviceSynchronize()` / odpowiednik),
5. capture common state,
6. backend capture payload,
7. zapis obiektów do `temp/`,
8. hash + promote do CAS,
9. zapis manifestów,
10. atomowy update wskaźnika `CURRENT`,
11. opcjonalny export do `.fms.part`,
12. fsync,
13. rename do `.fms`.

## 23.2 Odczyt
1. upload/open `.fms`,
2. inspect manifestów bez pełnej ekstrakcji,
3. walidacja schematu i hashy,
4. decyzja o klasie restore,
5. rozpakowanie do nowego workspace/import staging,
6. odtworzenie UI,
7. odbudowa derived caches,
8. jeśli `resume_*` → init runtime z checkpointu,
9. bootstrap control room z nowym `SessionState`.

## 24. API — wykorzystujemy istniejące endpointy, ale porządkujemy je

## 24.1 Nie dokładamy równoległego API
Skoro w repo są już:
- `state/export`,
- `state/import`,
- `script/sync`,
- `scene`,
- `bootstrap`,
to v1 powinien użyć właśnie tego.

## 24.2 Proponowane requesty

### `POST /v1/live/current/state/export`
```json
{
  "profile": "resume",
  "destination": "download",
  "capture_ui": true,
  "include_logs": true,
  "include_meshes": true,
  "field_capture_policy": "current_cached",
  "artifact_policy": "selected",
  "include_sources": "project_bundle",
  "compression_profile": "balanced",
  "if_running": "pause_snapshot_resume",
  "ui_snapshot": {
    "...": "frontend-supplied transient state"
  }
}
```

### `POST /v1/live/current/state/import`
- przyjmuje upload `.fms`
- może działać dwuetapowo:
  - inspect,
  - commit

### rekomendowane rozbicie:
- `POST /state/import/inspect`
- `POST /state/import/commit`

ale można też zostać przy jednym endpointcie i dodać parametr `mode: inspect|commit`.

## 24.3 Dodatkowe endpointy
Rekomendowane:
- `GET /v1/live/current/checkpoints`
- `POST /v1/live/current/checkpoints/create`
- `POST /v1/live/current/checkpoints/resume`
- `GET /v1/live/current/recovery`
- `POST /v1/live/current/recovery/clear`

## 25. CLI

Nowe komendy:

```bash
fullmag session save model.fms
fullmag session save --profile resume model.fms
fullmag session open model.fms
fullmag session inspect model.fms
fullmag session recover
fullmag session gc
```

### 25.1 `inspect`
Musi wypisywać:
- format version,
- profile,
- created by,
- run kinds,
- latest checkpoint,
- exact resume compatibility,
- size summary,
- artifacts summary,
- warnings.

## 26. Autosave / recovery

## 26.1 Kiedy zapisywać recovery
Domyślnie:
- co N zaakceptowanych iteracji,
- lub co T sekund wall time,
- lub po ukończeniu etapu/sweep sample,
- lub po ręcznym pause,
- lub przed operacją ryzykowną (remesh, switch backend, import state).

### 26.2 Policy
Domyślnie:
- `save every 1800 s` wall time **lub**
- `saving ratio` typu co 0.1 postępu / co N accepted steps,  
w duchu podobnym do recovery w COMSOL.

### 26.3 Double-slot recovery
W recovery nie nadpisujemy jednego snapshotu w miejscu.  
Stosujemy:
- `slot-A`
- `slot-B`

Nowy autosave zapisuje do drugiego slotu i dopiero po sukcesie przestawia wskaźnik aktywny.

To daje crash safety.

## 27. Bezpieczeństwo

## 27.1 Trusted / untrusted sessions
Sesja może zawierać:
- skrypt Python,
- lokalne źródła,
- assety.

Dlatego:
- **otwarcie sesji nie uruchamia automatycznie skryptu**,
- używamy zapisanego `ProblemIR` / planu / checkpointu,
- skrypt trafia do edytora jako tekst,
- jego wykonanie wymaga jawnej akcji użytkownika.

## 27.2 Walidacja archiwum
Import musi:
- odrzucać symlinki,
- odrzucać path traversal,
- sprawdzać hashe obiektów,
- pilnować limitów dekompresji,
- pilnować limitów liczby plików,
- weryfikować `format` i `schema version`,
- pilnować whitelisty media types.

## 27.3 Read-only open
Sesję można otworzyć w trybie read-only:
- bez przejmowania locka,
- bez możliwości nadpisania oryginału,
- z opcją `Save As…`.

## 28. Wydajność i rozmiar plików

## 28.1 Compression profiles
- `speed` → LZ4 / niski poziom kompresji
- `balanced` → Zstd 3
- `smallest` → Zstd 9–12

### domyślne:
- recovery store: `speed`
- user export: `balanced`

## 28.2 Nie wszystko trzeba zapisywać
Tak jak w COMSOL, należy pozwolić użytkownikowi ograniczać zapis:
- tylko probe/scalar data,
- tylko selected fields,
- tylko selected output times / checkpoints,
- bez built/computed/plotted data,
- bez preview cache.

## 28.3 Lazy load po otwarciu
Po `Open Session` UI nie powinno od razu czytać wszystkich wielkich pól.  
Plan:
- najpierw manifesty,
- potem UI state,
- potem preview cache,
- pełne pola tylko na żądanie,
- exact resume payload tylko jeśli użytkownik wybierze resume.

## 29. Specyfika study kinds

## 29.1 Time evolution / relax
Pełne `resume_exact` ma największy sens tutaj.  
Checkpoint jest step-based.

## 29.2 Parametric sweep
Checkpoint na poziomie:
- aktualny parameter sample,
- lista ukończonych sample’i,
- artifact index per sample,
- opcjonalnie checkpoint aktywnego sample’a.

## 29.3 Eigensolve / dispersion
Tu exact resume iteracji liniowego solve nie jest krytyczny w v1.  
Wystarczy:
- checkpoint na poziomie ukończonych `k`-sample’i / frequency sample’i,
- zapis aktualnego kursora orkiestracji,
- zapis dotychczasowych wyników,
- zapis analyze state.

To jest bardziej:
- `study_resume`,
niż `opaque linear algebra restart`.

## 29.4 Przyszła magnetoelastyka
Format już teraz musi mieć extension points na:
- `u`
- `v`
- `a`
- stress/strain fields
- mechanical mesh / domains
- multiple coupled states.

Dlatego sesja nie może być „tylko magnetyzacja i grid”.

## 30. Minimalny kontrakt implementacyjny backendów

Każdy backend implementuje trait/kontrakt:

```rust
trait SessionSerializableBackend {
    fn restart_abi(&self) -> &'static str;

    fn capture_checkpoint(
        &mut self,
        request: &CheckpointCaptureRequest
    ) -> Result<BackendCheckpointCapture>;

    fn restore_checkpoint(
        &mut self,
        payload: &BackendCheckpointCapture
    ) -> Result<RestoreReport>;

    fn can_restore(
        &self,
        payload: &BackendCheckpointCapture
    ) -> CompatibilityReport;
}
```

### 30.1 Co zwraca backend capture
- common compatibility metadata,
- refs do primary fields,
- integrator-specific state,
- RNG state,
- backend-native payload,
- optional derived field refs,
- warnings.

## 31. Adaptacja do obecnej struktury Fullmaga — bardzo konkretnie

## 31.1 Nowy crate
Dodać:
```text
crates/fullmag-session/
```

Odpowiedzialność:
- manifesty,
- serializacja,
- object store,
- tensor descriptors,
- export/import `.fms`,
- compatibility engine,
- GC store.

### moduły:
```text
crates/fullmag-session/src/
├─ lib.rs
├─ manifest.rs
├─ workspace.rs
├─ run.rs
├─ checkpoint.rs
├─ tensor.rs
├─ object_store.rs
├─ archive.rs
├─ compatibility.rs
├─ ui_snapshot.rs
├─ import.rs
├─ export.rs
└─ gc.rs
```

## 31.2 `crates/fullmag-api`
Rozszerzyć istniejące route’y:
- `/state/export`
- `/state/import`

Dodać:
- inspect/commit flow,
- upload/download streaming,
- recovery listing,
- checkpoint ops.

## 31.3 `crates/fullmag-cli`
Dodać subcommand:
- `session`

## 31.4 `crates/fullmag-runner`
Tu jest najważniejsza praca:
- capture stanu runtime,
- safe-point barrier,
- handoff do backend serializerów,
- integracja z `SessionStore`.

Proponowane moduły:
```text
crates/fullmag-runner/src/
├─ session_capture.rs
├─ checkpoint_capture.rs
├─ checkpoint_restore.rs
├─ runtime_pause_barrier.rs
└─ session_export.rs
```

## 31.5 `native/backends/fdm`
Dodać API checkpointowe:
```text
native/backends/fdm/include/checkpoint_api.h
native/backends/fdm/src/checkpoint_fp64.cu
native/backends/fdm/src/checkpoint_common.cpp
```

Odpowiedzialność:
- capture `m`,
- capture integrator history,
- capture RNG,
- restore,
- compatibility report.

## 31.6 `native/backends/fem`
Analogicznie:
```text
native/backends/fem/include/checkpoint_api.h
native/backends/fem/src/checkpoint.cpp
```

Odpowiedzialność:
- solver mesh bytes,
- FE space descriptor,
- state vectors,
- mechanics extension slots,
- restore/rebuild.

## 31.7 `apps/web`
Dodać:
```text
apps/web/lib/sessionPersistence.ts
apps/web/components/file-menu/SaveSessionDialog.tsx
apps/web/components/file-menu/OpenSessionDialog.tsx
apps/web/components/file-menu/RecoveryDialog.tsx
apps/web/components/file-menu/SessionCompatibilityBanner.tsx
```

## 31.8 `apps/web/lib/session/types.ts`
Nie mieszać formatów persistence z runtime streaming types.  
Dodać osobne typy:
```text
apps/web/lib/sessionPersistenceTypes.ts
```
albo przenieść do nowego shared package.

## 32. Co obecny `SessionState` już daje, a czego jeszcze nie daje

## 32.1 Co już daje
Aktualny `SessionState` można niemal 1:1 wpiąć w `workspace snapshot`, bo już niesie:
- session/run/live runtime,
- scene,
- script builder,
- model builder graph,
- logs,
- quantities,
- latest fields,
- artifacts,
- display selection,
- preview state,
- mesh workspace.

## 32.2 Czego jeszcze nie daje
Brakuje osobnego, twardego kontraktu na:
- raw script source bundle,
- exact backend checkpoint payload,
- integrator history,
- RNG state,
- explicit restore class,
- compatibility ABI,
- solver mesh native bytes,
- eksportowane source dependencies.

## 33. Dokładne reguły dla FDM

## 33.1 Minimalny payload wznowienia FDM
Mandatory:
- `grid descriptor`
- `plan hash`
- `region/active masks` albo ich regenerowalna reprezentacja
- `m`
- `time, step, dt`
- integrator state
- RNG state (jeśli używany)
- materials signature

## 33.2 Czego nie zapisujemy
Nie zapisujemy:
- planów FFT,
- scratch bufferów,
- workspace’ów redukcji,
- pomocniczych buforów kerneli,
- temporary stage buffers, jeśli checkpoint nie jest mid-step.

## 33.3 Exact resume FDM
Warunki:
- identyczny `grid_signature`
- zgodny `restart_abi`
- zgodny integrator
- zgodna precyzja
- zgodne `ProblemIR/plan_hash`
- zgodna semantyka termiki/RNG

## 34. Dokładne reguły dla FEM

## 34.1 Minimalny payload wznowienia FEM
Mandatory:
- solver mesh native bytes
- FE space descriptor
- main state vector
- `time, step, dt`
- integrator state
- RNG state
- plan hash / physics hash

## 34.2 Odtwarzanie
Po restore:
1. wczytaj mesh,
2. odbuduj spaces,
3. zainicjalizuj wektory,
4. zainicjalizuj runtime derived structures,
5. opcjonalnie odtwórz preview mesh,
6. dopiero potem uruchom runtime.

## 34.3 Exact resume FEM
Exact resume może być w v1 bardziej restrykcyjny niż w FDM.  
Jeśli cokolwiek nie pasuje:
- przechodzimy do `logical_resume` albo `initial_condition_import`.

## 35. Dokładne reguły dla skryptu i źródeł

## 35.1 Zapis źródeł
Muszą istnieć dwa pliki:
- `main.py` — ostatni zapisany canonical main script,
- `editor_buffer.py` — aktualny stan edytora, nawet jeśli niesynchronizowany.

## 35.2 Źródła pomocnicze
`include_sources`:
- `main_only`
- `local_modules`
- `project_bundle`

W `project_bundle` zapisujemy tylko pliki projektu, nie virtualenv i nie site-packages.

## 35.3 Po co to robić, skoro jest ProblemIR
Bo użytkownik chce wrócić do pracy edycyjnej, a nie tylko do wznowienia solve’a.

## 36. Dokładne reguły dla UI

## 36.1 UI snapshot musi być oddzielony od physics state
Proponowany plik:
```text
project/ui_state.json
```

Zawiera:
- active route/view,
- open tabs,
- split panes,
- selected object / material / quantity,
- preview config,
- analyze selection,
- camera(s),
- plot settings,
- visibility flags,
- table sort/filter state,
- notifications / dismissals opcjonalnie.

## 36.2 Co nie powinno trafiać do UI state
- ephemeryczne pointer capture,
- hover transient,
- in-flight drag,
- websocket connection state.

## 37. Otwieranie starej sesji po zmianie wersji Fullmaga

## 37.1 Twarde wymaganie
Sesja z v1 nigdy nie może stać się całkowicie „martwa”, jeśli tylko manifesty są poprawne.  
Nawet przy braku exact resume musisz umieć zrobić:
- config-only open,
- ewentualnie import saved state as initial condition.

## 37.2 Migratory
Dla manifestów:
- `format = fullmag.session.v1`
- każdy dokument ma `schema_version`
- importer ma migratory:
  - `v1 -> current`
  - doc-level migracje.

## 38. Test plan

## 38.1 Golden tests formatu
- eksport sesji → golden manifest snapshot,
- import tego samego pliku → identyczne metadata,
- roundtrip JSON docs.

## 38.2 Fault injection
- crash w połowie zapisu obiektu,
- crash po zapisie obiektów, przed manifestem,
- crash po manifeście checkpointu, przed `CURRENT`,
- uszkodzony hash chunku,
- brakujący object id,
- lock stale.

## 38.3 Runtime correctness tests
### FDM
- zapisz resume,
- wznow na tej samej maszynie,
- porównaj dalszy przebieg z referencją.

### FEM
- zapisz,
- wznow,
- porównaj podstawowe obserwable i energię.

## 38.4 UI restoration tests
- scene selection wraca,
- preview config wraca,
- analyze tab wraca,
- mesh workspace wraca.

## 38.5 Security tests
- zip slip,
- decompression bomb,
- huge object count,
- invalid schema,
- malicious script payload.

## 39. Minimalna roadmapa wdrożenia

## Etap 1 — `compact`
Cel:
- zapisać projekt i UI,
- bez exact resume.

Zakres:
- `.fms` archive,
- project bundle,
- scene/ui/script/problem,
- open/import.

## Etap 2 — `solved`
Cel:
- zapisać ostatni stan pól,
- przywracać je do UI,
- używać jako initial condition.

Zakres:
- field descriptors,
- object store,
- mesh serialization.

## Etap 3 — `resume` dla FDM
Cel:
- exact resume dla time evolution FDM.

Zakres:
- integrator/RNG serializer,
- safe-point barrier,
- FDM backend payload.

## Etap 4 — `resume` dla FEM
Cel:
- logical/exact resume dla FEM.

Zakres:
- solver mesh native save,
- FE spaces,
- state vectors,
- restore.

## Etap 5 — recovery / autosave
Cel:
- crash recovery jak w COMSOL.

Zakres:
- SessionStore,
- double-slot recovery,
- recovery dialog,
- background retention policy.

## Etap 6 — archive / sweeps / eigen / dispersion
Cel:
- wielkie, pełne sesje z wynikami.

Zakres:
- artifact selection,
- k-sample checkpointing,
- batch study resume.

## 40. Rekomendacje decyzyjne — bez niedomówień

### 40.1 Decyzja A — czy robić literalny dump procesu?
**Nie.**  
Robić logiczny session image.

### 40.2 Decyzja B — czy mieć jeden plik dla użytkownika?
**Tak.**  
Plik `.fms`.

### 40.3 Decyzja C — czy autosave ma zapisywać ten sam plik `.fms`?
**Nie.**  
Autosave ma używać `SessionStore`, a `.fms` jest formatem eksportowym/użytkowym.

### 40.4 Decyzja D — czy sesja ma zawierać UI?
**Tak, obowiązkowo.**

### 40.5 Decyzja E — czy sesja ma zawierać skrypt?
**Tak, obowiązkowo**, w dwóch wersjach:
- canonical saved script,
- editor buffer.

### 40.6 Decyzja F — czy sesja ma zawierać pola i „wszystko”?
**Tak, ale przez profile i polityki capture.**  
Nie zawsze wszystko ma być defaultowo włączone.

### 40.7 Decyzja G — czy exact resume ma być wymagane do otwarcia sesji?
**Nie.**  
Resume jest jedną z klas restore, nie warunkiem odczytu.

### 40.8 Decyzja H — czy צריך podpisy kryptograficzne?
Opcjonalnie w v1.  
Mandatory:
- hashes obiektów,
- integralność archiwum.

Podpisy można dodać później.

## 41. Ostateczna rekomendacja

Profesjonalny mechanizm Fullmaga powinien wyglądać tak:

1. **W runtime** trzymasz kanoniczny, katalogowy `SessionStore`.
2. **Użytkownikowi** pokazujesz pojedynczy plik `.fms`.
3. Masz **profile**:
   - `compact`
   - `solved`
   - `resume`
   - `archive`
   - `recovery`
4. Masz **klasy restore**:
   - `exact_resume`
   - `logical_resume`
   - `initial_condition_import`
   - `config_only`
5. Zapisujesz:
   - projekt,
   - UI,
   - skrypt,
   - scene,
   - ProblemIR,
   - stan solvera,
   - primary fields,
   - opcjonalne derived fields,
   - logs i artifacts.
6. Nie zapisujesz:
   - wskaźników,
   - uchwytów runtime,
   - cache’y zależnych od procesu.
7. Wykorzystujesz **istniejące** current-live API i `SessionState`.
8. Budujesz nowy crate `fullmag-session`.
9. Exact resume wdrażasz per-backend przez wersjonowane payloady.
10. Recovery robisz lokalnie, atomowo, z double-slot i inspect dialogiem.

To jest architektura:
- zgodna z obecną strukturą repo,
- profesjonalna,
- skalowalna,
- i naprawdę „na zasadzie COMSOL-a”, ale lepiej rozdzielająca projekt, wynik, checkpoint i recovery.

## 42. Checklist wdrożenia

### Spec i core
- [ ] `docs/specs/session-file-format-v1.md`
- [ ] `crates/fullmag-session`
- [ ] manifest schemas
- [ ] object store
- [ ] tensor descriptors
- [ ] compatibility engine

### API/CLI
- [ ] extend `state/export`
- [ ] extend `state/import`
- [ ] add recovery/checkpoint endpoints
- [ ] add `fullmag session ...`

### Runner
- [ ] runtime safe-point barrier
- [ ] session capture orchestration
- [ ] checkpoint restore orchestration

### FDM
- [ ] capture `m`
- [ ] integrator state serializer
- [ ] RNG state serializer
- [ ] restore

### FEM
- [ ] mesh save/restore
- [ ] FE space descriptor save/restore
- [ ] state vector save/restore

### Frontend
- [ ] save/open/recovery dialogs
- [ ] inspect compatibility UI
- [ ] read-only session mode
- [ ] stale lock UX
- [ ] unsaved buffer capture

### Testing
- [ ] golden files
- [ ] fault injection
- [ ] roundtrip restore
- [ ] compatibility degradation tests
- [ ] security tests

## 43. Źródła referencyjne, które ten projekt świadomie naśladuje

### Fullmag (stan aktualnego repo)
- `readme.md`
- `apps/web/lib/liveApiClient.ts`
- `apps/web/lib/session/types.ts`

### COMSOL — wzorzec UX / funkcjonalny
- formaty `MPH` z wariantami compact / solved / preview,
- recovery files,
- możliwość kontynuacji od zapisanej iteracji,
- ograniczanie ilości przechowywanych danych wynikowych,
- file locking i read-only open.

---

## Appendix A — przykładowy `export_profile.json`

```json
{
  "profile": "resume",
  "capture_ui": true,
  "include_logs": true,
  "include_meshes": true,
  "include_sources": "project_bundle",
  "field_capture_policy": "current_cached",
  "artifact_policy": "selected",
  "checkpoint_policy": "latest_only",
  "compression_profile": "balanced",
  "if_running": "pause_snapshot_resume"
}
```

## Appendix B — przykładowy `compatibility.json`

```json
{
  "problem_hash": "sha256:...",
  "normalized_problem_hash": "sha256:...",
  "plan_hash": "sha256:...",
  "state_schema_version": "v1",
  "restart_abi": "fullmag.fdm.cuda.llg.v1",
  "engine_id": "native.fdm.cuda.fp64",
  "runtime_family": "local-live",
  "precision": "f64",
  "study_kind": "time_evolution",
  "grid_signature": "sha256:...",
  "mesh_signature": null,
  "field_layout_signature": "sha256:..."
}
```

## Appendix C — rekomendowany obraz UX

### `Save`
- szybkie `Ctrl+S` zapisuje do ostatnio użytej ścieżki `.fms`
- jeśli nie było ścieżki → `Save As`

### `Autosave`
- działa do `SessionStore`, nie do `.fms`

### `Crash`
- po restarcie aplikacji recovery modal
- `Resume`, `Open Read-Only`, `Save As`, `Delete`

### `Open`
- inspect → compatibility → choose restore class

## Appendix D — definicja „zapisujemy wszystko”

W praktyce „wszystko” oznacza:

- **workspace state**
- **authoring state**
- **runtime state**
- **primary fields**
- **current UI state**
- **logs/scalars**
- **selected or all artifacts**
- **exact-resume payload, jeśli profil na to pozwala**

Nie oznacza:
- literalnego dumpu RAM procesu.

