# Audyt zgodnosci implementacji z planem workspace Fullmag
## Data: 2026-04-05
## Audytor: Codex

## 1. Zakres audytu

Audyt obejmuje zgodnosc kodu frontend (`apps/web`) z:

- `docs/reports/fullmag_frontend_workspace_implementation_plan_2026-04-05.md`
- `docs/reports/fullmag_frontend_workspace_concept_2026-04-05.md`

Szczegolnie sprawdzone:

1. wejscie do aplikacji i Start Hub,
2. shell i nawigacja stage (`Model Builder / Study / Analyze`),
3. semantyka tree/inspector/bottom dock,
4. `Study Builder` (model danych + UI + runtime mapping),
5. capability contract backend -> GUI,
6. stan dokumentacji vs stan kodu.

---

## 2. Wynik ogolny

**Wniosek:** implementacja jest **czesciowo zgodna** z planem. Najwazniejsze fundamenty sa wdrozone, ale program nie jest jeszcze domkniety end-to-end.

- Fundamenty (routing, stage switch, start flow, study pipeline v1) sa wdrozone.
- Nadal istnieja luki architektoniczne i funkcjonalne wzgledem docelowego planu.
- Dokumentacja planu jest miejscami niespojna z aktualnym kodem.

Ocena laczna: **~62% zgodnosci**.

---

## 3. Najwazniejsze ustalenia (findings)

### F1 (High): `WorkspaceShell` nadal jest thin wrapper, a nie docelowy shell orchestration

Plan wymaga ekstrakcji warstw (`ApplicationBar`, `ContextRibbon`, `MainDockLayout`, `GraphicsToolbar`), ale `WorkspaceShell` tylko hostuje `ControlRoomShell`.

- Dowod: [WorkspaceShell.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/workspace/shell/WorkspaceShell.tsx#L11)
- Dowod: [RunControlRoom.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/runs/RunControlRoom.tsx#L477)

Wplyw: architektura nadal jest monolityczna i trudniejsza do dalszej migracji.

### F2 (High): `Study Builder` UI nie pokrywa pelnego zestawu operacji z planu

Wdrozone sa add/move/delete, ale brakuje istotnych operacji v1: insert before/after, duplicate, enable/disable, collapse/expand, templates menu.

- Dowod: [StudyBuilderWorkspace.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/workspace/study-builder/StudyBuilderWorkspace.tsx#L114)
- Dowod: brak planowanych komponentow (`PipelineStageCard`, `StageTemplateMenu`) w katalogu `study-builder`.

Wplyw: workflow authoringu pipeline jest ograniczony wzgledem zalozen.

### F3 (High): runtime execution mapping jest uproszczony wzgledem planu

Mapowanie statusow opiera sie glownie o `activeStageIndex/completedStageCount`; brak realnych statusow `failed` z runtime i brak szczegolowego raportowania substepow makr (np. `Field Sweep + Relax`).

- Dowod: [execution-map.ts](/home/kkingstoun/git/fullmag/fullmag/apps/web/lib/study-builder/execution-map.ts#L30)
- Dowod: [StudyBuilderWorkspace.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/workspace/study-builder/StudyBuilderWorkspace.tsx#L90)

Wplyw: statusy live nie sa jeszcze pelnym odwzorowaniem wykonania pipeline.

### F4 (Medium): capability contract jest tylko minimalnym szkieletem

Plan zaklada szerszy contract + panel registry, a obecnie mamy 3 capability i brak `panelRegistry.ts`.

- Dowod: [capability-contract.ts](/home/kkingstoun/git/fullmag/fullmag/apps/web/lib/workspace/capability-contract.ts#L18)
- Dowod: brak `apps/web/components/panels/settings/panelRegistry.ts`

Wplyw: luka frontend-backend jest tylko czesciowo opisana i nie w pelni egzekwowana.

### F5 (Medium): dokumentacja planu jest lokalnie niespojna i miejscami nieaktualna

W tym samym dokumencie sa jednoczesnie stare i nowe statusy (np. sekcje mowiace o feature-flag gate, mimo ze entry jest juz hard-cut na V2).

- Dowod: [fullmag_frontend_workspace_implementation_plan_2026-04-05.md](/home/kkingstoun/git/fullmag/fullmag/docs/reports/fullmag_frontend_workspace_implementation_plan_2026-04-05.md#L70)
- Dowod: [WorkspaceEntryPage.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/workspace/shell/WorkspaceEntryPage.tsx#L10)

Wplyw: ryzyko blednych decyzji przy dalszych PR-ach.

---

## 4. Co jest wdrozone poprawnie

1. Start flow:
   - root nie robi slepego redirectu,
   - istnieje launch-intent resolver,
   - przy aktywnej sesji live następuje auto-przejscie do workspace.
   - Dowod: [page.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/app/(main)/page.tsx#L20)
   - Dowod: [launch-intent-live.ts](/home/kkingstoun/git/fullmag/fullmag/apps/web/lib/workspace/launch-intent-live.ts#L38)

2. Stage routing:
   - `/build`, `/study`, `/analyze` sa realnymi wejsciami do workspace,
   - `/runs` redirectuje do `/study`.
   - Dowod: [build/page.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/app/(workspace)/build/page.tsx#L4)
   - Dowod: [runs/page.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/app/(workspace)/runs/page.tsx#L4)

3. Globalny switch stage:
   - `StageBar` ma `Model Builder / Study / Analyze`,
   - przełączenie stage synchronizuje URL.
   - Dowod: [StageBar.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/workspace/shell/StageBar.tsx#L6)
   - Dowod: [RunControlRoom.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/runs/RunControlRoom.tsx#L468)

4. Context ribbon:
   - kategorie sa stage-specific,
   - aktywna zakladka ribbonu jest trzymana per-stage w `workspace-store`.
   - Dowod: [RibbonBar.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/shell/RibbonBar.tsx#L121)
   - Dowod: [workspace-store.ts](/home/kkingstoun/git/fullmag/fullmag/apps/web/lib/workspace/workspace-store.ts#L56)

5. Bottom dock baseline:
   - wydzielony `BottomUtilityDock` z `Jobs/Progress/Charts/Log/Problems`.
   - Dowod: [BottomUtilityDock.tsx](/home/kkingstoun/git/fullmag/fullmag/apps/web/components/workspace/shell/BottomUtilityDock.tsx#L42)

6. Study pipeline v1:
   - istnieje `study_pipeline` w modelach sesji,
   - jest migracja flat stages -> pipeline,
   - jest materializacja pipeline -> flat stages,
   - jest podstawowa walidacja.
   - Dowod: [types.ts](/home/kkingstoun/git/fullmag/fullmag/apps/web/lib/session/types.ts#L473)
   - Dowod: [migrate.ts](/home/kkingstoun/git/fullmag/fullmag/apps/web/lib/study-builder/migrate.ts)
   - Dowod: [materialize.ts](/home/kkingstoun/git/fullmag/fullmag/apps/web/lib/study-builder/materialize.ts#L126)

---

## 5. Macierz zgodnosci (WS1-WS8)

| Workstream | Status | Komentarz |
| --- | --- | --- |
| WS1 Start Hub i launch flow | **Partial+** | Dziala start z intent i auto-live-detect; brak pelnej integracji create/open z backendem i jednego `openIntoWorkspace()` |
| WS2 Shell V2 i routing | **Partial** | Stage routing i StageBar dzialaja, ale `WorkspaceShell` jest nadal wrapperem nad monolitem |
| WS3 Tree/Inspector/BottomDock | **Partial** | Bottom dock i odklejenie telemetry/energy od selekcji sa, ale semantyka tree/inspector nadal przejsciowa |
| WS4 Study Builder domain | **Done (v1)** | Kontrakty + migracja + materializacja + walidacja sa wdrozone |
| WS5 Study Builder UI | **Partial** | Dziala szkielet i glowne operacje, brak pelnego zestawu operacji v1 |
| WS6 Runtime execution mapping | **Partial-** | Jest mapowanie bazowe, ale bez pelnych statusow i substep telemetry |
| WS7 Capability contract | **Partial-** | Jest seed contract, ale coverage i panel registry sa niepelne |
| WS8 Analyze split i cleanup | **Partial** | Usunieto `runs` z top-level, ale cleanup monolitu i pelny split Analyze nie sa domkniete |

---

## 6. Walidacja techniczna

Wynik lokalnej walidacji podczas audytu:

- `npm run build` (apps/web): **PASS**
- `npm run typecheck` (apps/web): **PASS** (po wygenerowaniu `.next` przez build)
- `npm run lint` (apps/web): **FAIL** (repo-level issue: brak `eslint.config.*` dla ESLint v9)

Uwaga: uruchamianie `build` i `typecheck` rownolegle powoduje chwilowe konflikty `.next/types`; checki trzeba odpalac sekwencyjnie.

---

## 7. Rekomendowane nastepne kroki (priorytet)

1. Domknac PR3/WS2:
   - realna ekstrakcja `WorkspaceShell` (ApplicationBar/ContextRibbon/MainDockLayout),
   - ograniczenie `RunControlRoom` do runtime hosta.

2. Domknac WS5:
   - insert before/after, duplicate, enable/disable, collapse/expand, templates.

3. Domknac WS6:
   - status `failed/skipped` z realnego runtime,
   - substep progress dla makr (`field_sweep_relax`).

4. Domknac WS7:
   - rozszerzyc capability matrix,
   - dodac `panelRegistry.ts` i mapowanie capability -> panel -> serializer.

5. Ujednolicic dokumentacje planu:
   - usunac stare wpisy statusowe i pozostawic jedna, spojną wersje stanu.

---

## 8. Finalny wniosek

Nie, nie wszystko jest jeszcze zaimplementowane zgodnie z planem.

Zaimplementowano solidny rdzen migracji (routing/stage/store/start-flow/study-pipeline), ale pozostaja istotne elementy architektury docelowej (pelny shell extraction, pelny Study Builder UI, execution mapping v2 i capability coverage). Program jest w fazie zaawansowanego `partial`, nie `done`.

