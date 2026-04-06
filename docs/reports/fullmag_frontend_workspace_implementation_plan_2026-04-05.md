# Szczegolowy plan wdrozenia workspace Fullmag
## Implementacja Start Hub + Model Builder + Study + Analyze
## Data: 2026-04-05
## Ostatnia aktualizacja: 2026-04-10

Powiazany dokument koncepcyjny:

- `docs/reports/fullmag_frontend_workspace_concept_2026-04-05.md`

---

## 0. Znane problemy i rozbieznosci z planem

> Sekcja dodana przy audycie 2026-04-10. Opisuje znane problemy wymagajace uwagi przy nastepnym PR.

### 0.1. TopHeader label "Build" zamiast "Model Builder"

`apps/web/components/shell/TopHeader.tsx` — `WORKSPACE_MODES` nadal uzywa label `"Build"` zamiast `"Model Builder"` (wymagany przez koncepcje i Section 5.2.2). Do naprawy w PR3.

### 0.2. RibbonBar — podwojny system nawigacji

`apps/web/components/shell/RibbonBar.tsx` — wciaz ma stare taby `["Home", "Mesh", "Study", "Results", "Builder"]`. To jest ortogonalny system nawigacji OBOK stage switchera w TopHeader. Powoduje zdezorientowanie uzytkownika. Do naprawy w PR3 — ribbon powinien miec stage-specific categories (Section 5.2.3), a nie globalny switcher.

### 0.3. WorkspaceShell to thin wrapper

`WorkspaceShell.tsx` deleguje do `RunControlRoom` — prawdziwa ekstrakcja ApplicationBar / StageBar / ContextRibbon jeszcze nie nastapila. PR3 jest nastepnym krokiem.

### 0.4. Suspense boundary — NAPRAWIONE

`(main)/page.tsx` uzywal `useSearchParams()` bez `<Suspense>`, co lamal static export. Naprawione — wydzielony `RootPageInner` owinieto w `<Suspense fallback={null}>`.

### 0.5. WorkspaceModeInspectors — "runs" usuniety

`WorkspaceModeInspectors.tsx` nie pokazuje juz panelu "runs" (zgodnie z decyzja #5), ale tresc poszczegolnych paneli Build/S$$tudy/Analyze jest jeszcze placeholder.

---

## 1. Cel dokumentu

Ten dokument zamienia raport koncepcyjny w plan implementacyjny pod realne wdrozenie na kilka tysiecy linii kodu.

Jego zadaniem jest:

1. ustalic docelowa architekture frontend workspace,
2. rozpisac migracje bez big-bang rewrite,
3. wskazac konkretne pliki do modyfikacji i nowe moduly do utworzenia,
4. zdefiniowac kontrakty danych, zanim kilka modeli GPT zacznie rownolegle pisac kod,
5. zostawic jasne kryteria akceptacji po kazdym etapie.

Ten plan jest pisany pod obecny stan repo, a nie pod abstrakcyjny greenfield.

---

## 2. Faktyczny stan repo na dzis

Punktem startowym nie jest pusty projekt. Mamy juz konkretne miejsca, ktore trzeba traktowac jako istniejace source of truth.

### 2.1. Routing i wejscie do aplikacji

Aktualny stan (po wdrozeniu WS1/WS2 partial):

- `apps/web/app/(main)/page.tsx` — **Start Hub bootstrap**: resolve launch intent z search params, jesli `source === "none"` renderuje `StartHubPage`, w przeciwnym razie redirect do `targetPathForLaunchIntent(intent)`. Owiniete w `<Suspense>` (wymagane przez Next.js static export + `useSearchParams`).
- `apps/web/app/(workspace)/build/page.tsx` — renderuje `<WorkspaceEntryPage stage="build" />`
- `apps/web/app/(workspace)/study/page.tsx` — renderuje `<WorkspaceEntryPage stage="study" />`
- `apps/web/app/(workspace)/analyze/page.tsx` — renderuje `<WorkspaceEntryPage stage="analyze" />`
- `apps/web/app/(workspace)/runs/page.tsx` — redirect do `/study` (runs nie jest juz top-level stage)
- `apps/web/components/workspace/shell/WorkspaceEntryPage.tsx` — feature flag gate: jesli `workspaceV2Enabled` uzywa `WorkspaceShell`, jesli nie — fallback do `LegacyRunControlRoom`
- `apps/web/components/workspace/shell/WorkspaceShell.tsx` — thin wrapper, deleguje do `RunControlRoom` z `initialWorkspaceMode`

Co juz dziala:

- Start Hub renderuje sie przy starcie bez pliku
- `/build`, `/study`, `/analyze` sa realnymi stronami z osobnym `initialStage`
- launch intent resolve z query params
- `/runs` redirectuje do `/study`
- feature flag `NEXT_PUBLIC_WORKSPACE_V2_ENABLED` (domyslnie `true`)

Co jeszcze nie dziala:

- `WorkspaceShell` to wciaz thin wrapper nad `RunControlRoom`, a nie nowy shell
- Start Hub nie ma jeszcze pelnej funkcjonalnosci save/load
- `(main)` layout jest pass-through (sidebar zostal usuniety), ale stare strony `/settings`, `/simulations`, `/visualizations`, `/docs/physics` nadal istnieja jako redirecty

### 2.2. Shell workspace

Aktualny stan (po czesciowej implementacji):

- `apps/web/components/runs/RunControlRoom.tsx` jest wciaz monolitycznym shellem (~710 LOC)
- w srodku laczy `TopHeader`, `RibbonBar`, sidebar, viewport, console, right inspector i overlaye (`SettingsDialog`, `PhysicsDocsDrawer`)
- `RunControlRoom` przyjmuje `initialWorkspaceMode` prop i syncuje do `ControlRoomContext`
- `WorkspaceShell.tsx` istnieje, ale jest thin wrapper delegujacy do `RunControlRoom`
- `WorkspaceEntryPage.tsx` jest feature-flag gate miedzy nowym shellem a legacy fallbackiem
- right inspector z `WorkspaceModeInspectors` (Build/Study/Analyze) jest juz podpiety do PanelGroup

Wniosek:

- trzeba przejsc z monolitu do shell architecture,
- ale nie wolno od razu wyrywac logiki backend/session z `ControlRoomContext`,
- `WorkspaceShell` musi stopniowo przejmowac warstwy z `RunControlRoom`, a nie pozostawac thin wrapperem.

### 2.3. Store widoku

Aktualny stan (po przebudowie):

- `apps/web/lib/workspace/workspace-store.ts` — Zustand store (v5.0.12)
- `WorkspaceMode = "build" | "study" | "analyze"` — **`runs` zostalo juz usuniete z uniona**
- `currentStage` + `stageLayouts: Record<WorkspaceMode, StageLayoutState>` — per-stage layout (ribbonTab, leftDock, centerDock, rightDock, bottomDock)
- `launcherVisible`, `launchIntent: LaunchIntent | null` — juz obecne
- `settingsOpen`, `physicsDocsOpen`, `physicsDocsTopic` — juz obecne
- compatibility aliases `mode` / `setMode` — zachowane dla starych konsumentow
- `useActiveStageLayout()` helper hook — juz istnieje
- `workspaceMode` w `ControlRoomContext` jest zsynchronizowane z Zustand store (czyta z `useWorkspaceStore`)

Co juz zrobione:

- `runs` usuniete z workspace union
- `centerDock` dodany
- `launchIntent` i `launcherVisible` dodane
- per-stage layout state dziala

Co jeszcze trzeba:

- ribbon category powinno byc sterowane z workspace store, nie z wewnetrznego state `RibbonBar`
- shell powinien czytac layout z `useActiveStageLayout()`, a nie z hardcoded PanelGroup sizes

### 2.4. Tree i settings

Aktualny stan:

- `apps/web/components/panels/ModelTree.tsx` jest rendererem tree, ale semantyka wezlow jest jeszcze stara
- `apps/web/components/panels/SettingsPanel.tsx` miesza selection inspector z runtime telemetry i energy
- `apps/web/components/workspace/modes/WorkspaceModeInspectors.tsx` ma podzial build/study/analyze (runs juz usuniety)
- `apps/web/components/workspace/overlays/SettingsDialog.tsx` — nowy modal overlay (Edit → Preferences)
- `apps/web/components/workspace/overlays/PhysicsDocsDrawer.tsx` — nowy drawer overlay (Help → Documentation)
- stare strony `/settings` i `/docs/physics` robia redirect do `/analyze`

Wniosek:

- trzeba rozdzielic `tree`, `inspector`, `jobs/logs/charts`,
- settings nie moze byc skladowiskiem wszystkiego,
- trzeba przebudowac root modelu z `Study` na `Simulation` lub `Project`.

### 2.5. Study stages

Aktualny stan:

- `apps/web/components/panels/settings/StudyPanel.tsx` ma juz `Stage Sequence`
- `apps/web/lib/session/types.ts` ma `ScriptBuilderStageState`
- `apps/web/lib/session/modelBuilderGraph.ts` przechowuje `study.stages`
- `apps/web/lib/session/sceneDocument.ts` juz przenosi `scene.study.stages <-> ScriptBuilderState`

Wniosek:

- backend primitive stages sa juz obecne,
- ale nie ma jeszcze authoring modelu dla makr i zlozonych pipeline'ow,
- `Study Builder` trzeba dodac jako nowa warstwe nad istniejacym `stages`.

---

## 3. Niezmienialne decyzje produktowe

Ponizsze decyzje nalezy uznac za zamrozone na czas wdrozenia.

1. Przy starcie bez pliku aplikacja pokazuje `Start Hub`. **\u2705 ZAIMPLEMENTOWANE**
2. Przy starcie z pliku lub skryptu aplikacja pomija `Start Hub` i otwiera workspace bezposrednio. **\u2705 ZAIMPLEMENTOWANE** (launch intent resolver)
3. Glowny switcher pracy to tylko:
   - `Model Builder`
   - `Study`
   - `Analyze`
   **\u26a0\ufe0f CZESCIOWO** — switcher istnieje w `TopHeader`, ale label to wciaz \"Build\" zamiast \"Model Builder\"
4. `Mesh` jest subsystemem glownie w `Model Builder`, a nie osobnym globalnym stage. **\u26a0\ufe0f CZESCIOWO** — `Mesh` zniknelo ze stage union, ale wciaz jest tabem w starym `RibbonBar`
5. `Runs` nie jest osobnym stage i trafia do dolnego docka jako `Jobs / Queue / History / Log`. **\u2705 ZAIMPLEMENTOWANE** — `runs` usuniete z workspace union, `/runs` redirect do `/study`
6. `Study Builder` zyje glownie w `Model Builder`. **\u23f3 NIE ROZPOCZETE**
7. `Study` jest workspace live runtime, a nie miejscem skladania zlozonych pipeline'ow. **\u23f3 NIE ROZPOCZETE**
8. `Analyze` jest osobnym stage dla spectrum, eigenmodes i dalszej analizy. **\u23f3 NIE ROZPOCZETE**
9. Trzeba zachowac kompatybilnosc z obecnym backendem i obecnym `ScriptBuilderStageState[]`. **\u2705 ZACHOWANE**
10. Nie robimy big-bang rewrite. Migracja ma byc etapowa. **\u2705 ZACHOWANE**

---

## 4. Strategia wdrozenia

### 4.1. Zasada glowna

Najpierw budujemy nowa powloke i kontrakty danych, potem przekladamy do nich istniejace funkcje.

To oznacza:

- nie zaczynamy od przepisywania solver/runtime,
- nie zaczynamy od pelnego przepisywania preview,
- nie zaczynamy od rozrywania `ControlRoomContext` na kawalki bez planu.

### 4.2. Kolejnosc techniczna

Kolejnosc ma byc taka:

1. wejscie do aplikacji i launcher,
2. nowy shell workspace,
3. semantyka tree/settings/docks,
4. kontrakt danych dla `Study Builder`,
5. UI `Study Builder`,
6. runtime mapping i smart execution status,
7. capability audit backend -> GUI,
8. dopiero potem glebsze czyszczenie starych komponentow.

### 4.3. Zasada kompatybilnosci

Do czasu zamkniecia migracji:

- stary flat `study.stages` pozostaje wspierany,
- nowy authoring pipeline kompiluje sie do flat stages,
- `RunControlRoom` moze byc przez pewien czas uzywany jako compatibility host,
- route `/analyze` ma dzialac przez caly okres migracji.

### 4.4. Zasada podzialu odpowiedzialnosci

W czasie migracji rozdzielamy trzy warstwy:

1. `session/backend adapter`
   - dane z live session, solver telemetry, mesh state, artifacts
   - obecnie glownie `ControlRoomContext`

2. `workspace shell state`
   - stage, dock layout, ribbon category, launcher state, panel visibility
   - nowy `workspace-store`

3. `study authoring state`
   - pipeline document, makra, validation, materialization
   - nowy `study-builder` domain layer

---

## 5. Docelowa architektura

## 5.1. Routing

Rekomendowana architektura routingu:

```text
/
|- Start Hub albo direct-open redirect
|- /build      -> Model Builder workspace
|- /study      -> Study workspace
`- /analyze    -> Analyze workspace
```

W pierwszej iteracji zostawiamy obecne URL-e:

- `/build`
- `/study`
- `/analyze`

Powod:

- ograniczamy koszt migracji,
- nie rozwalamy istniejacych deep-linkow,
- zmieniamy nazwe w UI na `Model Builder`, ale nie musimy od razu zmieniac route segmentu.

Opcjonalna iteracja pozniejsza:

- dodac `/builder` jako alias,
- a `/build` zostawic jako compat redirect.

### 5.1.1. Root bootstrap

> **STATUS: ZAIMPLEMENTOWANE** — `(main)/page.tsx` juz renderuje `StartHubPage` przy `source === "none"` i redirectuje przy obecnosci launch intent. Uzywa `<Suspense>` boundary (wymagane przez Next.js static export + `useSearchParams`).

`apps/web/app/(main)/page.tsx` nie moze juz robic slepego redirect do `/analyze`.

Ma przejsc na:

- `StartHubBootstrapPage`
- resolver launch intent
- decyzje:
  - `no_intent -> render Start Hub`
  - `file/script/example/recent -> redirect do ostatniego lub domyslnego stage`

### 5.1.2. Launch intent

> **STATUS: ZAIMPLEMENTOWANE** — `apps/web/lib/workspace/launch-intent.ts` juz istnieje z pelnymi typami `LaunchSource`, `LaunchIntent`, `resolveLaunchIntentFromSearchParams()` i `targetPathForLaunchIntent()`.

Trzeba wprowadzic nowy kontrakt:

```ts
export type LaunchSource =
  | "none"
  | "recent"
  | "example"
  | "file_handle"
  | "script_path"
  | "project_path"
  | "electron_cli"
  | "web_query";

export interface LaunchIntent {
  source: LaunchSource;
  entryPath: string | null;
  entryKind: "script" | "project" | "example" | null;
  targetStage: "build" | "study" | "analyze" | null;
  resumeProjectId: string | null;
  metadata: Record<string, unknown> | null;
}
```

Resolver ma czytac dane w tej kolejnosci:

1. Electron preload bridge, jezeli istnieje.
2. Query params, jezeli web wystartowal z linku.
3. Recent session resume, jezeli jest zapisane.
4. W przeciwnym razie `none`.

### 5.1.3. Ograniczenia web vs Electron

To musi byc jawnie wpisane w kod:

- web nie ma pelnego natywnego file browser bez user interaction,
- Electron pozniej dostarczy native dialog i launch intent przez preload bridge,
- Start Hub musi miec interface storage/file-service abstracted juz teraz.

To oznacza potrzebne moduly:

- `apps/web/lib/workspace/launch-intent.ts` — **JUZ ISTNIEJE**
- `apps/web/lib/workspace/recent-simulations.ts` — **JUZ ISTNIEJE**
- `apps/web/lib/workspace/file-access.ts` — **JUZ ISTNIEJE**

---

## 5.2. Shell workspace

Docelowy shell ma miec nastepujace warstwy:

```text
Application Bar
Stage Bar
Context Ribbon
Main Dock Layout
Bottom Utility Dock
Modal/Overlay Layer
```

### 5.2.1. Application Bar

Zawartosc:

- nazwa symulacji
- File / Edit / View / Simulation / Tools / Help
- backend / runtime / connection
- globalne Run / Pause / Stop / Relax
- opcjonalnie Source / Docs / Problems

To ma zastapic obecny gorny header jako app-level frame.

### 5.2.2. Stage Bar

Jedyny globalny switcher:

- `Model Builder`
- `Study`
- `Analyze`

Nie wolno tu miec `Runs`.

### 5.2.3. Context Ribbon

Ribbon zalezy od stage:

`Model Builder`

- `Home`
- `Geometry`
- `Materials`
- `Physics`
- `Mesh`
- `Study Builder`

`Study`

- `Home`
- `Live View`
- `Runtime`
- `Charts`
- `Diagnostics`

`Analyze`

- `Home`
- `Spectrum`
- `Modes`
- `Compare`
- `Export`

Ribbon nie przechowuje struktury modelu. Ribbon jest tylko warstwa akcji.

### 5.2.4. Main Dock Layout

Wymagana semantyka:

- left dock = `tree / explorer`
- center-left albo center = `settings / inspector`
- center-right albo main = `graphics / viewport`
- bottom dock = `messages / progress / jobs / charts / log`

W `Model Builder` layout moze byc COMSOL-like:

- tree po lewej
- settings w srodku
- graphics po prawej

W `Study` i `Analyze` layout ma byc bardziej viewport-first:

- explorer wezszy
- viewport najszerszy
- inspector jako boczny dock
- charts/jobs/log w dolnym docku

---

## 5.3. Stan aplikacyjny

### 5.3.1. Nowy workspace store

> **STATUS: ZAIMPLEMENTOWANE** — `workspace-store.ts` juz ma `currentStage`, `stageLayouts: Record<WorkspaceMode, StageLayoutState>`, `launchIntent`, `launcherVisible`, compatibility aliases `mode`/`setMode`. Union `WorkspaceMode = "build" | "study" | "analyze"` (bez `runs`).

`apps/web/lib/workspace/workspace-store.ts` trzeba przebudowac do mniej wiecej takiego ksztaltu:

```ts
export type WorkspaceStage = "build" | "study" | "analyze";

export interface StageDockLayoutState {
  leftDock: string | null;
  centerDock: string | null;
  rightDock: string | null;
  bottomDock: string | null;
  ribbonCategory: string;
}

export interface WorkspaceUiState {
  currentStage: WorkspaceStage;
  stageLayouts: Record<WorkspaceStage, StageDockLayoutState>;
  activeProjectId: string | null;
  selectionId: string | null;
  rightInspectorOpen: boolean;
  settingsOpen: boolean;
  physicsDocsOpen: boolean;
  physicsDocsTopic: string | null;
  launchIntent: LaunchIntent | null;
  launcherVisible: boolean;
}
```

Zmiany obowiazkowe:

- `mode` zamienic logicznie na `currentStage`
- usunac `runs` z uniona
- dodac `centerDock`
- dodac `launchIntent`
- dodac `launcherVisible`

### 5.3.2. ControlRoomContext pozostaje adapterem

W pierwszych iteracjach:

- nie przepisywac `ControlRoomContext`
- nie zmieniac od razu calego flow danych runtime
- nowy shell ma czytac z `useControlRoom()` przez cienkie adaptery

Rekomendowane nowe adaptery:

- `apps/web/components/workspace/adapters/useWorkspaceRuntimeViewModel.ts`
- `apps/web/components/workspace/adapters/useWorkspaceModelViewModel.ts`
- `apps/web/components/workspace/adapters/useStudyBuilderViewModel.ts`

To ograniczy rozlewanie `ctx.xxx` przez nowe komponenty.

---

## 5.4. Study Builder domain model

Obecny `ScriptBuilderStageState[]` nie wystarcza jako authoring model.

Potrzebny jest nowy dokument pipeline'u.

### 5.4.1. Proponowany kontrakt

```ts
export interface StudyPipelineDocument {
  version: "study_pipeline.v1";
  nodes: StudyPipelineNode[];
}

export type StudyPipelineNode =
  | PrimitiveStageNode
  | MacroStageNode
  | StageGroupNode;

export interface StudyPipelineNodeBase {
  id: string;
  label: string;
  enabled: boolean;
  notes?: string | null;
}

export interface PrimitiveStageNode extends StudyPipelineNodeBase {
  node_kind: "primitive";
  stage_kind:
    | "relax"
    | "run"
    | "eigenmodes"
    | "set_field"
    | "set_current"
    | "save_state"
    | "load_state"
    | "export";
  payload: Record<string, unknown>;
}

export interface MacroStageNode extends StudyPipelineNodeBase {
  node_kind: "macro";
  macro_kind:
    | "field_sweep_relax"
    | "field_sweep_relax_snapshot"
    | "relax_run"
    | "relax_eigenmodes"
    | "parameter_sweep";
  config: Record<string, unknown>;
}

export interface StageGroupNode extends StudyPipelineNodeBase {
  node_kind: "group";
  children: StudyPipelineNode[];
  collapsed: boolean;
}
```

### 5.4.2. Materializacja

Backend dalej ma dostac flat primitive stages:

```ts
export interface MaterializedStudyPipeline {
  stages: ScriptBuilderStageState[];
  map: MaterializedStageMapEntry[];
  diagnostics: StudyPipelineDiagnostic[];
}

export interface MaterializedStageMapEntry {
  nodeId: string;
  nodeLabel: string;
  stageIndexes: number[];
  childEntries?: MaterializedStageMapEntry[];
}

export interface StudyPipelineDiagnostic {
  id: string;
  severity: "info" | "warning" | "error";
  nodeId: string | null;
  message: string;
  suggestion?: string | null;
}
```

Najwazniejsza zasada:

- `study_pipeline` to authoring source of truth
- `stages` to compiled execution artifact

### 5.4.3. Kompatybilnosc wsteczna

Kazdy workspace bez `study_pipeline` ma zostac zautomatyzowanie zmapowany:

- flat `stages` -> `StudyPipelineDocument` z primitive nodes

To wymaga funkcji:

- `migrateFlatStagesToStudyPipeline(stages)`
- `materializeStudyPipeline(document)`
- `validateStudyPipeline(document, capabilities)`
- `summarizeStudyPipelineNode(node)`

### 5.4.4. Gdzie trzymac pipeline

Do zmiany beda:

- `apps/web/lib/session/types.ts`
- `apps/web/lib/session/modelBuilderGraph.ts`
- `apps/web/lib/session/sceneDocument.ts`
- `apps/web/lib/session/normalize.ts`
- `apps/web/lib/session/validate.ts`

Nowe pole:

- `study_pipeline: StudyPipelineDocument | null`

W:

- `ScriptBuilderState`
- `SceneDocument.study`
- `ModelBuilderGraphV2.study`

---

## 6. Docelowy podzial katalogow

Ponizszy uklad nie musi zostac wdrozony w jednym PR, ale docelowo warto go osiagnac.

```text
apps/web/components/start-hub/
  StartHubPage.tsx
  StartHubShell.tsx
  RecentSimulationsSection.tsx
  CreateSimulationWizard.tsx
  ExamplesSection.tsx
  OpenActionsSection.tsx

apps/web/components/workspace/shell/
  WorkspaceShell.tsx
  ApplicationBar.tsx
  StageBar.tsx
  ContextRibbon.tsx
  MainDockLayout.tsx
  BottomUtilityDock.tsx
  GraphicsToolbar.tsx

apps/web/components/workspace/explorer/
  SimulationExplorer.tsx
  StudySetupTree.tsx

apps/web/components/workspace/inspectors/
  ContextInspector.tsx
  SimulationInspectorRouter.tsx
  BuilderInspector.tsx
  StudyInspector.tsx
  AnalyzeInspector.tsx

apps/web/components/workspace/docks/
  JobsDock.tsx
  ProgressDock.tsx
  LogDock.tsx
  ChartsDock.tsx
  ProblemsDock.tsx

apps/web/components/workspace/study-builder/
  StudyBuilderWorkspace.tsx
  StageBuilderRibbon.tsx
  PipelineCanvas.tsx
  PipelineStageCard.tsx
  StageInspector.tsx
  StageSummaryChip.tsx
  StageTemplateMenu.tsx
  ValidationPanel.tsx

apps/web/lib/workspace/
  workspace-store.ts
  launch-intent.ts
  recent-simulations.ts
  file-access.ts
  feature-flags.ts

apps/web/lib/study-builder/
  types.ts
  materialize.ts
  migrate.ts
  validate.ts
  summaries.ts
  templates.ts
  execution-map.ts
```

---

## 7. Workstreamy i szacunek skali

Ponizsze zakresy sa celowo duze. Ten projekt realnie bedzie mial kilka tysiecy linii zmian.

| Workstream | Zakres | Szacunek LOC |
| --- | --- | --- |
| WS1 | Start Hub i launch flow | 500-900 |
| WS2 | Shell V2 i routing workspace | 900-1500 |
| WS3 | Tree, inspector, bottom docks | 800-1400 |
| WS4 | Study Builder domain model i migracja danych | 800-1400 |
| WS5 | Study Builder UI i ribbon | 1200-2200 |
| WS6 | Runtime execution mapping i live statuses | 400-900 |
| WS7 | Capability contract backend -> GUI | 900-1700 |
| WS8 | Analyze split, cleanup i usuniecie starej duplikacji | 600-1200 |
| Razem | rdzen przebudowy | ok. 6100-11200 |

To jest zdrowy rzad wielkosci. Nie nalezy obiecywac, ze taka zmiana zamknie sie w jednym malym commicie.

---

## 8. Szczegolowy plan wdrozenia

## 8.1. WS1 - Start Hub i launch flow

> **STATUS: ~80% ZAIMPLEMENTOWANE**
>
> Zrealizowane:
> - `StartHubPage.tsx`, `StartHubShell.tsx`, `RecentSimulationsSection.tsx`, `CreateSimulationWizard.tsx`, `ExamplesSection.tsx`, `OpenActionsSection.tsx` — juz istnieja
> - `launch-intent.ts`, `recent-simulations.ts`, `file-access.ts` — juz istnieja
> - `(main)/page.tsx` — renderuje Start Hub przy braku intent, redirectuje z intentem
> - `feature-flags.ts` — `workspaceV2Enabled` juz istnieje
> - `<Suspense>` boundary dla `useSearchParams` — naprawione
>
> Pozostalo do zrobienia:
> - pelna integracja `Create New Simulation` wizard z backendem
> - pelna implementacja `Open Script / Open Simulation` z progressive enhancement (File System Access API)
> - `lastVisitedStage` per project
> - `openIntoWorkspace(intent)` jako jednolity entry point
> - polishing recent simulations (real data zamiast demo)

### Cel

Dodac prawdziwy ekran startowy i rozdzielic:

- start bez pliku
- direct open z pliku/skryptu

### Pliki do modyfikacji

- `apps/web/app/(main)/page.tsx`
- `apps/web/app/(workspace)/layout.tsx`
- `apps/web/lib/workspace/workspace-store.ts`

### Nowe pliki

- `apps/web/components/start-hub/StartHubPage.tsx`
- `apps/web/components/start-hub/StartHubShell.tsx`
- `apps/web/components/start-hub/RecentSimulationsSection.tsx`
- `apps/web/components/start-hub/CreateSimulationWizard.tsx`
- `apps/web/components/start-hub/ExamplesSection.tsx`
- `apps/web/components/start-hub/OpenActionsSection.tsx`
- `apps/web/lib/workspace/launch-intent.ts`
- `apps/web/lib/workspace/recent-simulations.ts`
- `apps/web/lib/workspace/file-access.ts`

### Implementacja

1. Zamienic slepy redirect w `/(main)/page.tsx` na `StartHubBootstrapPage`.
2. Dodac `resolveLaunchIntent()` z fallbackiem dla web.
3. Dodac `recent simulations` zapisane w localStorage lub IndexedDB.
4. Dodac `Create New Simulation` wizard z:
   - name
   - save location hint
   - start mode: empty / template
   - backend profile optional
5. Dodac `Open Script`, `Open Simulation`, `Open Example`.
6. Zrobic jednolity `openIntoWorkspace(intent)` zamiast rozproszonych redirectow.
7. Zapisac `lastVisitedStage` per project.

### Uwagi implementacyjne

- W web build nalezy uzywac progressive enhancement:
  - File System Access API, jezeli dostepne
  - fallback do file input
- W Electron pozniej ten sam kontrakt ma byc karmiony przez preload bridge, nie przez osobny kod UI.

### Kryteria akceptacji

1. Root `/` nie przekierowuje juz slepo do `/analyze`.
2. Bez launch intent widac Start Hub.
3. Z launch intent otwiera sie od razu workspace.
4. Recent simulations pojawiaja sie po otwarciu projektu.
5. App dalej dziala w static export.

### Poza zakresem

- pelna implementacja native dialogs dla Electron
- synchronizacja recent listy z systemowym filesystem watcherem

---

## 8.2. WS2 - Shell V2 i routing workspace

> **STATUS: ~30% ZAIMPLEMENTOWANE**
>
> Zrealizowane:
> - `WorkspaceEntryPage.tsx` — feature flag gate miedzy legacy i V2
> - `WorkspaceShell.tsx` — thin wrapper nad `RunControlRoom` z `initialWorkspaceMode`
> - `/build`, `/study`, `/analyze` — realne strony z `<WorkspaceEntryPage stage="..." />`
> - `/runs` — redirect do `/study`
> - `workspace-store.ts` — V2 z 3-stage model i per-stage layout
> - `runs` — juz usuniete z workspace union
>
> Pozostalo do zrobienia:
> - `WorkspaceShell` przejscie z thin wrapper na prawdziwy shell (ekstrakcja ApplicationBar, StageBar, ContextRibbon)
> - `TopHeader` label "Build" -> "Model Builder" (Section 5.2.2)
> - `RibbonBar` — wciaz ma stare taby `["Home", "Mesh", "Study", "Results", "Builder"]`, trzeba go zastapic stage-specific `ContextRibbon`
> - ekstrakcja `MainDockLayout`, `BottomUtilityDock`, `GraphicsToolbar` z `RunControlRoom`
> - usuniecie duplikacji miedzy `TopHeader` stage switcher a `RibbonBar` tabs

### Cel

Zastapic monolityczny `RunControlRoom` nowym shellem z jednym stage switcherem.

### Pliki do modyfikacji

- `apps/web/app/(workspace)/build/page.tsx`
- `apps/web/app/(workspace)/study/page.tsx`
- `apps/web/app/(workspace)/analyze/page.tsx`
- `apps/web/components/runs/RunControlRoom.tsx`
- `apps/web/components/shell/TopHeader.tsx`
- `apps/web/components/shell/RibbonBar.tsx`
- `apps/web/lib/workspace/workspace-store.ts`

### Nowe pliki

- `apps/web/components/workspace/shell/WorkspaceShell.tsx`
- `apps/web/components/workspace/shell/ApplicationBar.tsx`
- `apps/web/components/workspace/shell/StageBar.tsx`
- `apps/web/components/workspace/shell/ContextRibbon.tsx`
- `apps/web/components/workspace/shell/MainDockLayout.tsx`
- `apps/web/components/workspace/shell/BottomUtilityDock.tsx`
- `apps/web/components/workspace/shell/GraphicsToolbar.tsx`

### Implementacja

1. Wprowadzic `WorkspaceShell` jako nowy orchestration component.
2. Strony `/build`, `/study`, `/analyze` maja renderowac ten sam shell z innym `initialStage`.
3. `RunControlRoom` w pierwszym kroku ma zostac compatibility container:
   - albo renderowany wewnatrz nowego shella
   - albo rozciety tak, aby shell i runtime body byly oddzielone
4. `TopHeader` i `RibbonBar` nie moga juz niezaleznie trzymac top-level navigation.
5. `StageBar` staje sie jedynym globalnym stage switcherem.
6. `runs` znika z workspace mode union.
7. `Mesh` znika jako globalny switch i staje sie ribbon category lub subsystem.

### Rekomendowana taktyka

Nie przepisywac od razu calego `RunControlRoom.tsx`.

Najpierw:

1. wyciagnac z niego `ApplicationBar`,
2. wyciagnac `ContextRibbon`,
3. zostawic stare body jako `LegacyWorkspaceBody`,
4. podmienic shell warstwa po warstwie.

### Kryteria akceptacji

1. Na gorze nie ma juz duplikacji `Build/Study/Analyze/Runs` vs `Home/Mesh/Study/Results/Builder`.
2. Jedyny globalny stage switcher to `Model Builder / Study / Analyze`.
3. `/build`, `/study` i `/analyze` otwieraja ten sam shell z innym aktywnym stage.
4. Runtime controls nadal dzialaja.

### Poza zakresem

- pelne usuniecie wszystkich starych komponentow w tym samym PR

---

## 8.3. WS3 - Tree, inspector i bottom docks

### Cel

Przywrocic semantyke:

- tree = struktura
- inspector = wlasciwosci selekcji
- bottom dock = jobs/logs/charts/progress

### Pliki do modyfikacji

- `apps/web/components/panels/ModelTree.tsx`
- `apps/web/components/panels/SettingsPanel.tsx`
- `apps/web/components/workspace/modes/WorkspaceModeInspectors.tsx`
- `apps/web/components/runs/RunControlRoom.tsx`

### Nowe pliki

- `apps/web/components/workspace/explorer/SimulationExplorer.tsx`
- `apps/web/components/workspace/inspectors/ContextInspector.tsx`
- `apps/web/components/workspace/inspectors/SimulationInspectorRouter.tsx`
- `apps/web/components/workspace/docks/JobsDock.tsx`
- `apps/web/components/workspace/docks/ProgressDock.tsx`
- `apps/web/components/workspace/docks/LogDock.tsx`
- `apps/web/components/workspace/docks/ChartsDock.tsx`
- `apps/web/components/workspace/docks/ProblemsDock.tsx`

### Implementacja

1. Zmienic root tree z `Study` na `Simulation` albo nazwe projektu.
2. Rozszerzyc tree o jawne sekcje:
   - Geometry
   - Materials
   - Physics
   - Mesh & Domain
   - Study Setup
   - Live Views
   - Analyze
3. `SettingsPanel` rozbic na:
   - `SelectionInspector`
   - `GlobalDiagnosticsDock`
4. Usunac dopinanie `SolverTelemetry` i `Energy` do inspektora selekcji.
5. Przeniesc `Jobs`, `Charts`, `Messages`, `Log` do dolnego docka.
6. Przygotowac osobne layout presets:
   - builder preset
   - study preset
   - analyze preset

### Kryteria akceptacji

1. Klikniecie `Airbox` pokazuje tylko semantyczny airbox inspector.
2. Klikniecie obiektu nie miesza selection properties z energy/log.
3. Bottom dock ma przynajmniej: `Messages`, `Progress`, `Jobs`, `Charts`, `Log`.
4. `Runs` nie istnieje juz jako osobny stage.

---

## 8.4. WS4 - Study Builder domain model i migracja danych

### Cel

Dodac authoring pipeline ponad backendowymi primitive stages.

### Pliki do modyfikacji

- `apps/web/lib/session/types.ts`
- `apps/web/lib/session/modelBuilderGraph.ts`
- `apps/web/lib/session/sceneDocument.ts`
- `apps/web/lib/session/normalize.ts`
- `apps/web/lib/session/validate.ts`
- `apps/web/components/runs/control-room/ControlRoomContext.tsx`

### Nowe pliki

- `apps/web/lib/study-builder/types.ts`
- `apps/web/lib/study-builder/migrate.ts`
- `apps/web/lib/study-builder/materialize.ts`
- `apps/web/lib/study-builder/validate.ts`
- `apps/web/lib/study-builder/summaries.ts`
- `apps/web/lib/study-builder/templates.ts`
- `apps/web/lib/study-builder/execution-map.ts`

### Implementacja

1. Dodac `study_pipeline` do modeli sesji.
2. Przy normalizacji danych:
   - jezeli przychodzi `study_pipeline`, uzyc go
   - jezeli przychodzi tylko `stages`, wygenerowac primitive pipeline
3. Dodac compiler:
   - `StudyPipelineDocument -> MaterializedStudyPipeline`
4. Dodac validator:
   - missing equilibrium before eigenmodes
   - run without state preparation
   - unsupported macro on backend
   - invalid sweep ranges
5. Dodac stage summaries.
6. Dodac stage templates.

### Minimalny zestaw makr w pierwszej wersji

1. `field_sweep_relax`
2. `relax_run`
3. `relax_eigenmodes`

### Dlaczego nie wiecej na start

Bo te trzy makra juz zamykaja:

- najczestszy workflow ground-state + run
- najczestszy workflow sweep pola
- najczestszy workflow equilibrium -> eigenproblem

### Kryteria akceptacji

1. Stary flat `stages` dalej dziala.
2. Nowy `study_pipeline` umie materializowac sie do flat `stages`.
3. Kazdy materialized stage wie, z ktorego pipeline node pochodzi.
4. Validation zwraca diagnostyki czytelne dla UI.

---

## 8.5. WS5 - Study Builder UI

### Cel

Wprowadzic prawdziwy `Study Builder` do `Model Builder`.

### Pliki do modyfikacji

- `apps/web/components/panels/settings/StudyPanel.tsx`
- `apps/web/components/panels/SettingsPanel.tsx`
- `apps/web/components/shell/RibbonBar.tsx` lub jego nastepca
- `apps/web/components/panels/ModelTree.tsx`

### Nowe pliki

- `apps/web/components/workspace/study-builder/StudyBuilderWorkspace.tsx`
- `apps/web/components/workspace/study-builder/StageBuilderRibbon.tsx`
- `apps/web/components/workspace/study-builder/PipelineCanvas.tsx`
- `apps/web/components/workspace/study-builder/PipelineStageCard.tsx`
- `apps/web/components/workspace/study-builder/StageInspector.tsx`
- `apps/web/components/workspace/study-builder/StageSummaryChip.tsx`
- `apps/web/components/workspace/study-builder/StageTemplateMenu.tsx`
- `apps/web/components/workspace/study-builder/ValidationPanel.tsx`
- `apps/web/components/workspace/explorer/StudySetupTree.tsx`

### Implementacja

1. `StudyPanel.tsx` rozdzielic na dwa tryby:
   - `StudyBuilderWorkspace` w `Model Builder`
   - `StudyRuntimeOverview` w `Study`
2. Dodac `Study Setup` sekcje w explorer tree.
3. Dodac ribbon category `Study Builder`.
4. Dodac akcje:
   - Add Relax
   - Add Run
   - Add Eigenmodes
   - Add Set Field
   - Add Set Current
   - Add Save State
   - Add Load State
   - Add Export
   - Field Sweep + Relax
   - Relax -> Run
   - Relax -> Eigenmodes
5. Pipeline canvas ma wspierac:
   - insert before
   - insert after
   - delete
   - duplicate
   - enable/disable
   - collapse/expand
   - reorder
6. Stage inspector ma pokazywac:
   - parametry
   - summary
   - warnings
   - compiled expansion preview
7. Validation panel ma stale pokazywac problemy pipeline'u.

### Wazna decyzja UX

W pierwszej wersji nie trzeba budowac pelnego node editor.

Wystarczy:

- vertical pipeline canvas
- cards
- grupa/makro zwijane i rozwijane

To jest wystarczajaco mocne i duzo tansze implementacyjnie.

### Reorder

Rekomendacja dla pierwszej iteracji:

- nie dodawac od razu nowej zaleznosci drag-and-drop
- wystarczy:
  - move up
  - move down
  - insert before
  - insert after

Jesli pozniej UI bedzie stabilne, mozna dolozyc DnD.

### Kryteria akceptacji

1. Uzytkownik moze zbudowac pipeline bez recznej edycji flat stages.
2. Uzytkownik moze dodac `Field Sweep + Relax` jako jeden logiczny element.
3. Uzytkownik widzi summary i validation.
4. Uzytkownik moze materializowac pipeline do backendowego stage sequence.

---

## 8.6. WS6 - Runtime execution mapping i live statuses

### Cel

Polaczyc authoring pipeline z live wykonywaniem.

### Pliki do modyfikacji

- `apps/web/components/runs/control-room/ControlRoomContext.tsx`
- `apps/web/components/runs/RunControlRoom.tsx`
- `apps/web/components/workspace/shell/BottomUtilityDock.tsx`

### Nowe pliki

- `apps/web/lib/study-builder/execution-map.ts`
- `apps/web/components/workspace/study-builder/ExecutionStatusBadge.tsx`
- `apps/web/components/workspace/docks/JobsDock.tsx`

### Implementacja

1. Na bazie `MaterializedStageMapEntry[]` zbudowac execution map.
2. Dopiac runtime statusy:
   - pending
   - running
   - done
   - failed
   - skipped
3. Jezeli runtime raportuje tylko `stage x/y`, zmapowac to do node i child step range.
4. Pokazywac aktywny node:
   - w Study Builderze
   - w bottom dock
   - w status bar
5. W makrach typu `Field Sweep + Relax` pokazywac aktywny substep:
   - step 7/21
   - current field value
   - relax status

### Kryteria akceptacji

1. Live runtime potrafi zaznaczyc aktywny stage group.
2. Makro `Field Sweep + Relax` pokazuje postep substepow.
3. Statusy w builderze i study sa spojne.

---

## 8.7. WS7 - Capability contract backend -> GUI

### Cel

Domknac luke miedzy solverem a frontendem.

### Problem

Dzis frontend nie wystawia wszystkich opcji, ktore backend juz umie, szczegolnie w obszarach:

- demag
- airbox
- domain frame
- mesh authoring
- solver options
- boundary conditions
- live diagnostics

### Pliki do modyfikacji

- `apps/web/lib/session/types.ts`
- `apps/web/lib/session/validate.ts`
- `apps/web/components/panels/settings/*`
- `apps/web/components/panels/SettingsPanel.tsx`

### Nowe pliki

- `apps/web/lib/workspace/capability-contract.ts`
- `apps/web/lib/workspace/capability-audit.ts`
- `apps/web/components/panels/settings/panelRegistry.ts`

### Implementacja

1. Zdefiniowac capability registry:

```ts
export interface UiCapability {
  id: string;
  domain: "geometry" | "mesh" | "physics" | "study" | "runtime" | "analyze";
  backendSupport: string[];
  uiPanel: string;
  serializerPath: string;
  status: "implemented" | "partial" | "missing";
}
```

2. Rozpisac minimalny contract matrix:
   - capability id
   - backend support
   - source model path
   - UI owner
   - serialization path
3. Zrobic audyt i oznaczyc brakujace GUI.
4. Uporzadkowac panel registry:
   - demag panel
   - airbox panel
   - domain frame panel
   - mesh pipeline panel
   - study builder panel
5. Wyrzucic "magiczne" sekcje z `SettingsPanel` i przejsc na jawny router paneli.

### Kryteria akceptacji

1. Mamy jedna jawna liste krytycznych opcji backendu.
2. Dla kazdej opcji wiadomo, czy GUI ja wspiera.
3. Brakujace panele sa widoczne jako TODO/partial, a nie ukryte w chaosie.

---

## 8.8. WS8 - Analyze split, cleanup i usuniecie starej duplikacji

### Cel

Dojsc do punktu, w ktorym nowe workspace stages sa realne, a nie tylko kosmetyczne.

### Pliki do modyfikacji

- `apps/web/app/(workspace)/build/page.tsx`
- `apps/web/app/(workspace)/study/page.tsx`
- `apps/web/app/(workspace)/analyze/page.tsx`
- `apps/web/components/runs/RunControlRoom.tsx`
- `apps/web/components/shell/TopHeader.tsx`
- `apps/web/components/shell/RibbonBar.tsx`
- `apps/web/components/workspace/modes/WorkspaceModeInspectors.tsx`

### Implementacja

1. Usunac redirect-only nature `/build` i `/study`.
2. Usunac `runs` z calego workspace union.
3. Ograniczyc `RunControlRoom` do runtime/session hosta albo usunac go calkowicie po migracji.
4. Przeniesc analyze-specific widgets do analyze stage.
5. Zostawic shell bez drugiego systemu nawigacji.

### Kryteria akceptacji

1. `build`, `study`, `analyze` sa realnymi stage views.
2. Nie ma juz martwych top-level tabs.
3. Nie ma juz podwojnego globalnego navigation system.

---

## 9. Proponowana kolejnosc PR-ow

To jest rekomendowana sekwencja merge'ow.

### PR1 - Start Hub bootstrap ✅ DONE

Zakres:

- `/(main)/page.tsx`
- `launch-intent.ts`
- `recent-simulations.ts`
- podstawowy `StartHubPage`

Cel:

- usunac slepy redirect do `/analyze`

> **Zrealizowane**: Start Hub renderuje sie na `/`, launch intent resolve dziala, recent simulations i file-access abstractions istnieja. Suspense boundary naprawiony.

### PR2 - Workspace store V2 ✅ DONE

Zakres:

- `workspace-store.ts`
- `WorkspaceStage`
- usuniecie `runs` z uniona
- stage-specific layout state

Cel:

- przygotowac shell bez psucia runtime

> **Zrealizowane**: Store juz ma `currentStage`, `stageLayouts`, `launchIntent`, compatibility aliases. `runs` usuniete z union. `WorkspaceEntryPage` z feature flag gate juz istnieje.

### PR3 - Workspace shell extraction ⬅️ NASTEPNY

Zakres:

- `WorkspaceShell` — prawdziwa ekstrakcja (nie thin wrapper)
- `ApplicationBar`
- `StageBar`
- `ContextRibbon`
- `/build`, `/study`, `/analyze` renderuja ten sam shell

Cel:

- usunac duplikacje top-level nav

> **Uwaga**: `WorkspaceShell.tsx` i `WorkspaceEntryPage.tsx` juz istnieja, ale shell jest wciaz thin wrapper nad `RunControlRoom`. Ten PR musi wyciagnac prawdziwe warstwy: ApplicationBar, StageBar, ContextRibbon. Kluczowa zmiana: `TopHeader` label "Build" -> "Model Builder" i zastapienie `RibbonBar` tabs `["Home", "Mesh", "Study", "Results", "Builder"]` stage-specific ribbon categories.

### PR4 - Explorer/Inspector/BottomDock split

Zakres:

- `SimulationExplorer`
- `ContextInspector`
- `JobsDock`, `LogDock`, `ChartsDock`
- czyszczenie `SettingsPanel`

Cel:

- przywrocic semantyke paneli

### PR5 - Study pipeline domain model

Zakres:

- `study-builder/types.ts`
- `study-builder/materialize.ts`
- `study-builder/migrate.ts`
- zmiany w `session/types.ts`, `normalize.ts`, `modelBuilderGraph.ts`

Cel:

- zamrozic authoring data contract

### PR6 - Study Builder UI skeleton

Zakres:

- `StudyBuilderWorkspace`
- `StageBuilderRibbon`
- `PipelineCanvas`
- basic primitive nodes

Cel:

- zastapic read-only `Stage Sequence`

### PR7 - Macro stages i validation

Zakres:

- `field_sweep_relax`
- `relax_run`
- `relax_eigenmodes`
- validation panel
- summaries

Cel:

- dostarczyc inteligentne authoring UX

### PR8 - Runtime execution mapping

Zakres:

- execution map
- live statuses
- bottom dock runtime view

Cel:

- spojnic builder z live study

### PR9 - Capability audit i brakujace GUI

Zakres:

- capability contract
- panel registry
- demag/airbox/domain frame cleanups

Cel:

- frontend ma zaczac doganiac backend

### PR10 - Final cleanup

Zakres:

- usuniecie starych wrapperow
- usuniecie redirect ghosts
- pruning martwego kodu

Cel:

- zostawic repo w stanie bez podwojnych architektur

---

## 10. Proponowane write-sety dla rownoleglych modeli GPT

Jesli kilka modeli ma pracowac rownolegle, trzeba zamrozic kontrakty i rozdzielic ownership.

### Worker A - Start Hub i launch flow

Wlasnosc:

- `apps/web/app/(main)/*`
- `apps/web/components/start-hub/*`
- `apps/web/lib/workspace/launch-intent.ts`
- `apps/web/lib/workspace/recent-simulations.ts`
- `apps/web/lib/workspace/file-access.ts`

Nie dotyka:

- `session/types.ts`
- `study-builder/*`
- `ControlRoomContext.tsx`

### Worker B - Shell V2 i stage navigation

Wlasnosc:

- `apps/web/components/workspace/shell/*`
- `apps/web/lib/workspace/workspace-store.ts`
- `apps/web/app/(workspace)/*`

Nie dotyka:

- `study-builder/*`
- `session/types.ts`

### Worker C - Study Builder domain model

Wlasnosc:

- `apps/web/lib/study-builder/*`
- `apps/web/lib/session/types.ts`
- `apps/web/lib/session/modelBuilderGraph.ts`
- `apps/web/lib/session/normalize.ts`
- `apps/web/lib/session/sceneDocument.ts`

Nie dotyka:

- Start Hub
- workspace shell visuals

### Worker D - Study Builder UI

Wlasnosc:

- `apps/web/components/workspace/study-builder/*`
- `apps/web/components/workspace/explorer/StudySetupTree.tsx`
- `apps/web/components/panels/settings/StudyPanel.tsx`

Zaleznosc:

- zaczyna dopiero po zamrozeniu kontraktow z Worker C

### Worker E - Explorer, inspector i capability panels

Wlasnosc:

- `apps/web/components/panels/*`
- `apps/web/components/workspace/inspectors/*`
- `apps/web/components/workspace/docks/*`
- `apps/web/lib/workspace/capability-contract.ts`

Zaleznosc:

- moze startowac po PR2 i koordynowac sie z Worker B

### Kolejnosc merge

1. Worker C kontrakty danych
2. Worker B shell/store
3. Worker A launcher
4. Worker D study builder UI
5. Worker E panele/capabilities

Powod:

- najpierw trzeba zamrozic dane,
- potem shell,
- dopiero potem duze UI slices.

---

## 11. Kontrakty, ktore trzeba zamrozic przed rownolegla implementacja

Te kontrakty musza zostac uzgodnione zanim kilka modeli zacznie pisac kod.

### 11.1. Workspace stage enum

```ts
type WorkspaceStage = "build" | "study" | "analyze";
```

### 11.2. Launch intent

```ts
interface LaunchIntent { ... }
```

### 11.3. Study pipeline document

```ts
interface StudyPipelineDocument { ... }
```

### 11.4. Materialized execution map

```ts
interface MaterializedStudyPipeline { ... }
```

### 11.5. Capability registry

```ts
interface UiCapability { ... }
```

Jesli te piec kontraktow sie rozjedzie, rownolegla praca modeli zacznie produkowac konflikty architektoniczne.

---

## 12. Ryzyka i jak nimi zarzadzic

## 12.1. Ryzyko: za duzy rewrite `RunControlRoom`

Mitigacja:

- zostawic go jako compatibility host,
- wyciagac shell warstwami,
- nie ruszac backend/session pipeline bez potrzeby.

## 12.2. Ryzyko: study pipeline rozjedzie sie z backendem

Mitigacja:

- flat `stages` pozostaje compiled artifact,
- migration zawsze umie wracac do primitive stages,
- validator i materializer maja byc testowalne jako czysty TS.

## 12.3. Ryzyko: Start Hub zablokuje web mode przez file APIs

Mitigacja:

- progressive enhancement,
- fallback do browser file input,
- brak twardej zaleznosci od Electron.

## 12.4. Ryzyko: za wczesne DnD i zbyt ambitny canvas

Mitigacja:

- pierwsza wersja to sortable list / timeline,
- DnD dopiero po stabilizacji kontraktow.

## 12.5. Ryzyko: capability audit zamieni sie w dokument bez implementacji

Mitigacja:

- capability registry ma byc TS modulem w repo,
- ma sterowac panel registry i validation,
- nie tylko markdown reportem.

---

## 13. Testowanie i weryfikacja

Repo nie ma jeszcze sensownego pakietu testow frontendowych, wiec trzeba jasno rozpisac minimum.

### 13.1. Automaty po kazdym PR

Uruchamiac:

```bash
cd apps/web
npm run lint
npm run typecheck
```

### 13.2. Testy jednostkowe, ktore warto dodac najwczesniej

Najwyzszy priorytet:

1. `launch-intent.ts`
2. `recent-simulations.ts`
3. `study-builder/migrate.ts`
4. `study-builder/materialize.ts`
5. `study-builder/validate.ts`
6. `study-builder/execution-map.ts`

Te moduly sa idealne do testow czystej logiki, bez DOM.

### 13.3. Manual smoke checklist

Po kazdym wiekszym etapie recznie sprawdzic:

1. start bez pliku pokazuje Start Hub
2. direct open omija Start Hub
3. `/build`, `/study`, `/analyze` otwieraja realny workspace
4. stage switcher zmienia workspace bez resetu sesji
5. bottom dock pokazuje jobs/log/charts
6. tree selection otwiera poprawny inspector
7. `Field Sweep + Relax` materializuje sie poprawnie
8. aktywny runtime stage mapuje sie na builder node

---

## 14. Definition of Done dla calego programu przebudowy

Program mozna uznac za domkniety, kiedy jednoczesnie prawdziwe sa wszystkie punkty:

1. Root `/` pokazuje Start Hub albo bezposrednio otwiera workspace na podstawie launch intent.
2. W gornym UI istnieje tylko jeden globalny stage switcher.
3. `Runs` nie istnieje jako top-level stage.
4. `Mesh` nie istnieje jako top-level stage.
5. `Model Builder`, `Study` i `Analyze` sa realnymi przestrzeniami pracy.
6. Tree ma root `Simulation` albo nazwe projektu, a nie `Study`.
7. Inspector pokazuje tylko selection/context properties.
8. `Jobs`, `Progress`, `Charts`, `Log`, `Messages` sa bottom dockami.
9. `Study Builder` pozwala skladac primitive i macro stages.
10. `Study Builder` materializuje pipeline do backendowych flat stages.
11. Live runtime potrafi zmapowac wykonanie na authoring pipeline.
12. GUI ma jawny capability contract i zaczyna pokrywac realne mozliwosci solvera.

---

## 15. Minimalny plan implementacyjny dla pierwszego sprintu

Jesli trzeba ruszyc szybko i bez rozlewania zakresu, pierwszy sprint powinien obejmowac tylko to:

1. `Start Hub` zamiast redirectu z `/` **\u2705 DONE**
2. nowy `workspace-store` bez `runs` **\u2705 DONE**
3. `WorkspaceShell` z jednym stage switcherem **\u26a0\ufe0f CZESCIOWO** — shell istnieje, ale jest thin wrapper
4. `/build`, `/study`, `/analyze` jako realne shell entries **\u2705 DONE** — `WorkspaceEntryPage` z feature flag
5. `SettingsPanel` bez telemetry/energy mixing **\u23f3 NIE ROZPOCZETE**
6. bottom dock z `Jobs`, `Log`, `Charts` **\u23f3 NIE ROZPOCZETE**
7. `Study Builder` domain model w wersji minimalnej: **\u23f3 NIE ROZPOCZETE**
   - primitive nodes
   - materialization
   - migration z flat stages

Nastepny krok to PR3: prawdziwa ekstrakcja shella (ApplicationBar, StageBar, ContextRibbon) i naprawienie duplikacji nawigacji.

---

## 16. Rekomendacja koncowa

Najbardziej pragmatyczny kierunek wdrozenia to:

1. nie przepisywac wszystkiego naraz,
2. najpierw zbudowac launcher i shell,
3. potem zamrozic kontrakt `study_pipeline`,
4. dopiero potem dowiezc bogaty `Study Builder`,
5. a capability audit prowadzic rownolegle jako warstwe porzadkujaca panele.

Jesli kolejne modele GPT beda trzymac sie tego planu, da sie przebudowac frontend Fullmag do znacznie dojrzalszego workspace'u bez utraty kompatybilnosci z obecnym solverem i bez kolejnego chaosu architektonicznego.
