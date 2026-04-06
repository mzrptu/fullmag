# Fullmag Frontend Workspace Commit Split
## Data: 2026-04-06

Ten dokument rozdziela aktualny worktree na logiczne paczki commitowe, tak aby:

- nie mieszac launchera i shella z `Study Builder`,
- nie mieszac refaktoryzacji UI z techniczna stabilizacja builda,
- oraz nie wrzucac do tych commitow osobnych zmian domenowych i dokumentacyjnych.

---

## Zasada ogolna

Najpierw commitujemy trzy paczki kodu frontendowego:

1. `launcher + workspace shell`
2. `study builder + pipeline authoring`
3. `build/runtime stabilization + panel cleanup`

Osobno zostawiamy:

- `examples/nanoflower_fem.py`
- nowe raporty i screeny w `docs/reports/...`

Te rzeczy nie powinny wejsc do commitow refaktoryzacji workspace, chyba ze swiadomie robimy osobny commit dokumentacyjny lub demo-flow.

---

## Paczka 1: Launcher And Workspace Shell

### Cel

Wprowadzic nowy flow wejscia:

- start bez pliku -> `Start Hub`
- start z aktywna/live symulacja -> bezposrednio do workspace
- nowy shell z `Model Builder / Study / Analyze`

### Zakres plikow

```text
apps/web/app/(main)/page.tsx
apps/web/app/(main)/settings/page.tsx
apps/web/app/(main)/simulations/page.tsx
apps/web/app/(main)/visualizations/page.tsx
apps/web/app/(workspace)/analyze/page.tsx
apps/web/app/(workspace)/runs/page.tsx
apps/web/app/(workspace)/study/page.tsx
apps/web/components/start-hub/
apps/web/components/workspace/shell/
apps/web/components/shell/RibbonBar.tsx
apps/web/components/shell/TopHeader.tsx
apps/web/components/runs/RunControlRoom.tsx
apps/web/components/runs/control-room/RunSidebar.tsx
apps/web/components/workspace/modes/WorkspaceModeInspectors.tsx
apps/web/lib/workspace/workspace-store.ts
apps/web/lib/workspace/feature-flags.ts
apps/web/lib/workspace/file-access.ts
apps/web/lib/workspace/launch-intent-live.ts
apps/web/lib/workspace/launch-intent.ts
apps/web/lib/workspace/recent-simulations.ts
```

### Komenda staging

```bash
git add \
  'apps/web/app/(main)/page.tsx' \
  'apps/web/app/(main)/settings/page.tsx' \
  'apps/web/app/(main)/simulations/page.tsx' \
  'apps/web/app/(main)/visualizations/page.tsx' \
  'apps/web/app/(workspace)/analyze/page.tsx' \
  'apps/web/app/(workspace)/runs/page.tsx' \
  'apps/web/app/(workspace)/study/page.tsx' \
  apps/web/components/start-hub \
  apps/web/components/workspace/shell \
  'apps/web/components/shell/RibbonBar.tsx' \
  'apps/web/components/shell/TopHeader.tsx' \
  'apps/web/components/runs/RunControlRoom.tsx' \
  'apps/web/components/runs/control-room/RunSidebar.tsx' \
  'apps/web/components/workspace/modes/WorkspaceModeInspectors.tsx' \
  'apps/web/lib/workspace/workspace-store.ts' \
  'apps/web/lib/workspace/feature-flags.ts' \
  'apps/web/lib/workspace/file-access.ts' \
  'apps/web/lib/workspace/launch-intent-live.ts' \
  'apps/web/lib/workspace/launch-intent.ts' \
  'apps/web/lib/workspace/recent-simulations.ts'
```

### Sugerowany commit message

```text
feat(web): add start hub and unified workspace shell
```

---

## Paczka 2: Study Builder And Pipeline Authoring

### Cel

Wprowadzic COMSOL-like authoring pipeline:

- `Study` w tree,
- `Study Builder Ribbon`,
- `Pipeline Canvas`,
- `Stage Inspector`,
- materializacja i walidacja pipeline.

### Zakres plikow

```text
apps/web/components/panels/ModelTree.tsx
apps/web/components/panels/settings/StudyPanel.tsx
apps/web/components/workspace/study-builder/
apps/web/lib/study-builder/
apps/web/lib/session/modelBuilderGraph.ts
apps/web/lib/session/normalize.ts
apps/web/lib/session/sceneDocument.ts
apps/web/lib/session/types.ts
```

### Komenda staging

```bash
git add \
  'apps/web/components/panels/ModelTree.tsx' \
  'apps/web/components/panels/settings/StudyPanel.tsx' \
  apps/web/components/workspace/study-builder \
  apps/web/lib/study-builder \
  'apps/web/lib/session/modelBuilderGraph.ts' \
  'apps/web/lib/session/normalize.ts' \
  'apps/web/lib/session/sceneDocument.ts' \
  'apps/web/lib/session/types.ts'
```

### Sugerowany commit message

```text
feat(web): add study builder pipeline authoring UI
```

---

## Paczka 3: Stabilization, Layout And Panel Cleanup

### Cel

Domknac techniczne i ergonomiczne elementy refaktoryzacji:

- stabilny `typecheck/build`
- cleanup paneli
- responsywny layout
- capability/runtime glue

### Zakres plikow

```text
apps/web/app/globals.css
apps/web/components/panels/SettingsPanel.tsx
apps/web/components/panels/settings/GeometryPanel.tsx
apps/web/components/panels/settings/MaterialPanel.tsx
apps/web/components/panels/settings/ResultsPanel.tsx
apps/web/components/runs/control-room/ControlRoomContext.tsx
apps/web/components/runs/control-room/context-hooks.tsx
apps/web/components/runs/control-room/helpers.ts
apps/web/components/runs/control-room/shared.tsx
apps/web/components/theme/ThemeProvider.tsx
apps/web/components/workspace/docks/
apps/web/lib/workspace/capability-audit.ts
apps/web/lib/workspace/capability-contract.ts
apps/web/package.json
package.json
```

### Komenda staging

```bash
git add \
  'apps/web/app/globals.css' \
  'apps/web/components/panels/SettingsPanel.tsx' \
  'apps/web/components/panels/settings/GeometryPanel.tsx' \
  'apps/web/components/panels/settings/MaterialPanel.tsx' \
  'apps/web/components/panels/settings/ResultsPanel.tsx' \
  'apps/web/components/runs/control-room/ControlRoomContext.tsx' \
  'apps/web/components/runs/control-room/context-hooks.tsx' \
  'apps/web/components/runs/control-room/helpers.ts' \
  'apps/web/components/runs/control-room/shared.tsx' \
  'apps/web/components/theme/ThemeProvider.tsx' \
  apps/web/components/workspace/docks \
  'apps/web/lib/workspace/capability-audit.ts' \
  'apps/web/lib/workspace/capability-contract.ts' \
  'apps/web/package.json' \
  'package.json'
```

### Sugerowany commit message

```text
chore(web): stabilize workspace build and panel layout
```

---

## Osobno, nie mieszac z tymi commitami

### Zmiany domenowe / demo

```text
examples/nanoflower_fem.py
```

Sugerowany osobny commit:

```text
chore(example): adjust nanoflower fem startup flow
```

### Dokumentacja i benchmarki

```text
docs/reports/04042026/comsol/
docs/reports/fullmag_frontend_workspace_implementation_plan_2026-04-05.md
docs/reports/fullmag_frontend_workspace_plan_conformance_audit_2026-04-05.md
```

Sugerowany osobny commit:

```text
docs(frontend): add workspace implementation notes and conformance audit
```

---

## Szybka procedura

Po kazdym commicie warto wykonac:

```bash
cd apps/web
npm run typecheck
npm run build
```

Jesli po buildzie znowu pojawi sie szum w `apps/web/out`, przed kolejnym commitem wyczyscic go:

```bash
git restore --source=HEAD --worktree --staged apps/web/out
git clean -fd apps/web/out
```

---

## Kolejnosc rekomendowana

1. `launcher + workspace shell`
2. `study builder + pipeline authoring`
3. `stabilization, layout, cleanup`
4. opcjonalnie `nanoflower example`
5. opcjonalnie `docs`

To jest obecnie najczystszy sposob na odzyskanie kontroli nad duzym worktree po tej refaktoryzacji.
