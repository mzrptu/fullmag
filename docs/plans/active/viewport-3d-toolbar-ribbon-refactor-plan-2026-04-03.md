# Viewport 3D Toolbar Refactor Plan — icon-first mini-ribbon, widgets and pro overlays

**Data:** 2026-04-03  
**Zakres:** refaktoryzacja górnego UI viewportu 3D dla FEM/FDM  
**Inspiracje:** COMSOL Desktop, 3ds Max viewport label menus, DCC mini-toolbars  
**Główne pliki wejściowe:**  
- `apps/web/components/preview/FemMeshView3D.tsx`
- `apps/web/components/preview/MagnetizationView3D.tsx`
- `apps/web/components/runs/control-room/ViewportPanels.tsx`
- `apps/web/components/shell/RibbonBar.tsx`

---

## 1. Cel

Obecny toolbar w widoku 3D jest funkcjonalny, ale zbyt tekstowy, zbyt gęsty poznawczo i zbyt mało "viewport-native". Zamiast długiego paska napisów potrzebujemy:

- interfejsu ikonowego z czytelną hierarchią,
- mini-ribbona dopasowanego do pracy w viewportcie, a nie do klasycznego formularza,
- małych rozwijanych menu przy narzędziach,
- widgetów szybkiej kontroli dla najczęstszych operacji,
- układu, który wygląda bardziej jak profesjonalne narzędzie CAD/DCC niż debug toolbar.

Docelowo użytkownik ma móc:

- rozpoznać narzędzia po ikonach i położeniu bez czytania całego paska,
- zmieniać render, kolorowanie, clip i kamerę jednym kliknięciem,
- mieć "secondary detail" schowany w dropdownie/popoverze,
- pracować jak w COMSOL/3ds Max: mało tekstu, jasne grupy, szybki dostęp, dobre stany aktywne.

---

## 2. Problem obecnego rozwiązania

Na dziś `FemMeshView3D.tsx` renderuje lokalny toolbar jako serię tekstowych przycisków i suwaków w jednej linii overlay. To powoduje:

- zbyt małą hierarchię wizualną,
- słabą skanowalność przy pierwszym kontakcie,
- mało eleganckie skróty typu `Opac`, `Persp`, `Labels`,
- brak wyraźnego podziału na primary actions i secondary settings,
- słaby "muscle memory layout", bo wszystko wygląda podobnie,
- wrażenie panelu developerskiego zamiast narzędzia produkcyjnego.

Największe problemy UX:

- tryby renderowania i pola kolorowania są prezentowane jako tekstowe przełączniki zamiast ikonowych tool groups,
- clip, arrows i camera navigation nie mają profesjonalnych, małych paneli opcji,
- legenda, parts i screenshot siedzą obok siebie bez mocnej semantyki,
- toolbar zajmuje dużo szerokości, a mimo to ma niski "information density quality",
- obecny overlay nie buduje marki produktu.

---

## 3. Założenia projektowe

### 3.1. Kierunek wizualny

Interfejs powinien iść w stronę:

- COMSOL: małe, rzeczowe tool groups i property popups,
- 3ds Max: viewport label menus, view presets, navigation cluster,
- nowoczesne DCC/CAD web UI: ikony, segmented controls, floating inspector chips.

Nie kopiujemy 1:1 desktopowego ribbonu. Adaptujemy jego logikę do webowego overlay:

- jedna cienka górna belka narzędzi,
- kilka małych "grup funkcyjnych",
- część ustawień w popoverach,
- stale widoczne tylko najważniejsze rzeczy.

### 3.2. Zasady

- `Icon first, text second`
- `One-click for common tasks`
- `Popover for tuning`
- `Badges for state`
- `Consistent placement across FEM and FDM`
- `No long textual mode strips`
- `Toolbar must survive narrow widths`

### 3.3. Anti-goals

Nie robimy:

- wielkiego desktopowego ribbonu na pół ekranu,
- osobnego, ciężkiego panelu dla każdej drobnej opcji,
- ukrywania wszystkiego pod hamburgerem,
- "AI slop" glassmorphism bez struktury,
- totalnej zmiany całego RunControlRoom w jednym kroku.

---

## 4. Docelowa architektura UI

Toolbar 3D powinien zostać rozbity na 4 warstwy:

### Warstwa A — Top Viewport Bar

Stała, cienka belka overlay nad canvasem.

Zawiera:

- lewy klaster: quantity + shading/render preset,
- środkowy klaster: context badges i focus state,
- prawy klaster: camera/navigation/view actions.

### Warstwa B — Tool Groups

Każda grupa jest ikonowym segmentem z opcjonalnym caret/dropdownem.

Przykłady:

- `Render`
- `Color`
- `Clip`
- `Vectors`
- `Camera`
- `Panels`

### Warstwa C — Floating Widgets

Małe, dyskretne widgety w rogu viewportu:

- orientation gizmo / view cube,
- legenda,
- selection summary,
- view status chip,
- ewentualnie mini performance badge.

### Warstwa D — Side Drawers / Popovers

Zamiast wrzucać wszystko w pasek:

- `Parts`
- `Legend`
- `Display options`
- `Clip setup`
- `Vector setup`

powinny otwierać się jako małe popovery albo lekkie drawers z dobrym groupingiem.

---

## 5. Docelowy układ informacji

### 5.1. Górny pasek

Docelowy układ:

```text
[Quantity chip] [Render group] [Color group] [Display group]
                [Focus / context chips]
                                [Clip] [Vectors] [Camera] [Panels] [Capture]
```

### 5.2. Prawy górny obszar viewportu

Tu powinny zostać:

- `Parts drawer`
- `Context / isolate / focus chips`
- mini selection card

To jest obszar "what am I looking at?".

### 5.3. Lewy dolny obszar viewportu

Tu powinny zostać:

- legenda,
- orientation sphere / color key,
- ewentualny mini status quality.

To jest obszar "how is this visualized?".

---

## 6. Proponowany system komponentów

Nowy toolbar nie powinien być rozwijany jako jedna długa sekcja JSX w `FemMeshView3D.tsx`. Trzeba go podzielić.

### Nowe komponenty

#### `ViewportToolbar3D.tsx`

Kontener overlay dla całego top bara.

Odpowiada za:

- layout,
- responsywność,
- grupowanie sekcji,
- współdzielone tone/styling tokens.

#### `ViewportToolGroup.tsx`

Mała grupa ikonowa z opcjonalnym nagłówkiem i separatorami.

Typy:

- `segmented`
- `toggle`
- `trigger + popover`
- `slider trigger`

#### `ViewportIconAction.tsx`

Pojedynczy ikonowy przycisk z:

- tooltipem,
- stanem active,
- stanem disabled,
- optional badge,
- optional caret.

#### `ViewportPopoverPanel.tsx`

Wspólny panel dla dropdownów typu:

- clip settings,
- vector settings,
- display settings,
- camera settings.

#### `ViewportStatusChips.tsx`

Chipy dla:

- quantity,
- frame,
- visible scope,
- selection,
- focus,
- auto-fit state.

#### `ViewportPanelsMenu.tsx`

Jedno menu dla:

- Legend,
- Parts,
- Labels,
- Quality,
- Screenshot / Export.

To zastępuje luźne tekstowe przyciski na końcu obecnego toolbaru.

### Komponenty istniejące do integracji

- `FieldLegend`
- `ViewCube`
- `FemMeshView3D`
- `MagnetizationView3D`
- `RibbonBar` jako źródło wzorców ikon, dropdownów i group composition

---

## 7. Mapa narzędzi: tekst -> ikony -> zachowanie

### 7.1. Render

Obecnie:

- `Surface`
- `S+E`
- `Wire`
- `Pts`

Docelowo:

- ikony render-mode jako segmented icon group,
- tooltip pokazuje pełną nazwę,
- aktywny tryb ma mocny background + subtle glow.

Proponowane ikony:

- `Surface` -> wypełniony wielokąt
- `Surface + edges` -> wielokąt z siatką
- `Wireframe` -> wire cube
- `Points` -> dotted nodes

### 7.2. Color

Obecnie:

- `ORI`
- `M_Z`
- `M_X`
- `M_Y`
- `|M|`
- `QUAL`
- `SICN`

Docelowo:

- główny przycisk `Color Mode` z ikoną palety,
- szybkie 2-3 najczęstsze presety jako ikonowy segmented group,
- pełna lista w popoverze z mini preview swatch.

Proponowana semantyka:

- orientation -> kolorowe koło / sphere icon
- magnitude -> gradient bar
- components -> X/Y/Z axis icon
- quality -> mesh badge
- SICN -> diagnostics badge

### 7.3. Clip

Obecnie:

- przycisk `Clip`
- osobny dropdown w środku paska

Docelowo:

- jedna ikonka nożyczek / section plane,
- klik: toggle on/off,
- caret: popover z:
  - axis pills,
  - slider position,
  - reset,
  - optional "flip side",
  - optional "cap surface" backlog.

### 7.4. Opacity / Shrink / Arrows

To nie powinny być zawsze widoczne jako surowe suwaki.

Docelowo:

- `Display` grupa otwiera popover:
  - opacity
  - shrink
  - edge emphasis
  - labels
- `Vectors` grupa:
  - toggle arrows,
  - density slider,
  - length scaling mode backlog.

### 7.5. Camera / Navigation

Obecnie:

- `Persp`
- `Trackball`
- `F T R reset`

Docelowo:

- jedna grupa `Camera`
- ikona projection toggle
- ikona navigation mode
- dropdown `Views` z:
  - Front
  - Top
  - Right
  - Isometric
  - Reset
  - Fit all
  - Focus selection

To ma działać jak mini label menu z 3ds Max.

### 7.6. Legend / Parts / Labels / Screenshot

Docelowo:

- nie jako osobne tekstowe przyciski w szeregu,
- tylko jako `Panels` menu + `Capture` action.

Propozycja:

- `Panels` icon opens checklist:
  - Legend
  - Parts
  - Labels
  - Stats
- `Capture` icon:
  - Screenshot PNG
  - Copy current view state
  - Export image backlog

---

## 8. Proponowany szkic UI

### 8.1. Top bar

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [M | quantity] [render icons] [palette icons] [display ▾]   [focus chips]  │
│                                                      [clip] [vectors] [cam] │
│                                                      [panels] [capture]     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 8.2. Popover clip

```text
┌ Clip ─────────────────────┐
│ Axis      [X] [Y] [Z]     │
│ Position  ─────●──────    │
│ Mode      Section         │
│ Reset     Default cut     │
└───────────────────────────┘
```

### 8.3. Popover display

```text
┌ Display ──────────────────┐
│ Opacity     ───●────      │
│ Shrink      ─────●──      │
│ Edges       [on/off]      │
│ Labels      [on/off]      │
│ Selection   [highlight]   │
└───────────────────────────┘
```

### 8.4. Popover camera

```text
┌ Camera / View ────────────┐
│ Projection  Perspective   │
│ Navigation  Trackball     │
│ Views       Front         │
│             Top           │
│             Right         │
│             Iso           │
│ Actions     Fit all       │
│             Focus sel.    │
└───────────────────────────┘
```

---

## 9. Architektura stanu

Refaktor UI nie powinien mnożyć lokalnych `useState` w jednym pliku. Potrzebujemy prostszego modelu.

### 9.1. Rozdzielić stan na 3 klasy

#### A. `Viewport persistent display state`

Stan wpływający na render:

- render mode
- color field
- opacity
- shrink
- clip enabled
- clip axis
- clip pos
- arrows enabled
- arrow density
- camera projection
- navigation mode

#### B. `Viewport transient UI state`

Stan overlay:

- który popover jest otwarty,
- hover states,
- compact mode,
- badge visibility,
- temporary menu focus.

#### C. `Viewport contextual state`

Stan zależny od sceny:

- selected entity
- focused entity
- visible parts count
- missing magnetic mask
- missing exact segment
- quantity metadata

### 9.2. Docelowy hook

Warto dodać:

- `useViewportToolbarState()`

który spina:

- controlled props z `FemMeshView3D`,
- lokalne overlay state,
- handlers dla tool groups.

To ograniczy rozrost `FemMeshView3D.tsx`.

---

## 10. Styl i komponenty wizualne

### 10.1. Wygląd

Toolbar powinien być:

- ciemny, półprzezroczysty,
- z bardziej precyzyjną siatką spacingu,
- mniej "rounded app cards", bardziej "instrument bar",
- z czytelnymi separatorami grup.

### 10.2. Tokens

Zdefiniować wspólne klasy/tokens dla viewport toolbar:

- `viewport-toolbar-shell`
- `viewport-tool-group`
- `viewport-tool-button`
- `viewport-tool-button-active`
- `viewport-chip`
- `viewport-popover`

Najlepiej jako wspólne utility lub mała warstwa komponentów, a nie kopiowanie Tailwinda w 8 miejscach.

### 10.3. Ikony

Preferowane źródło:

- `lucide-react`, bo jest już używany w `RibbonBar.tsx`

Korzyść:

- spójność z resztą shell UI,
- brak nowej zależności,
- szybka implementacja.

---

## 11. Responsywność

Toolbar musi mieć 3 tryby:

### Tryb L

Pełny mini-ribbon:

- wszystkie główne grupy widoczne,
- część grup z podpisem,
- chipy kontekstowe w środku.

### Tryb M

Ikony bez etykiet, nadal grupowane.

- quantity jako chip,
- część drugorzędnych akcji zwinięta do `Panels`.

### Tryb S

Viewport compact mode:

- tylko podstawowe grupy,
- wszystko pozostałe w `More` dropdown,
- zero długich tekstów.

To jest ważne, bo obecny toolbar bardzo szybko robi się za szeroki.

---

## 12. Integracja z istniejącym systemem

### 12.1. FEM

Pierwszy target wdrożenia:

- `FemMeshView3D.tsx`

Tu jest największy ból i największa wartość.

### 12.2. FDM

Drugi etap:

- `MagnetizationView3D.tsx`

Nie kopiujemy nowego toolbara drugi raz. Przenosimy wspólną warstwę i wstrzykujemy capabilities.

### 12.3. Capability-driven toolbar

Toolbar powinien być budowany z capability mapy:

- mesh view has clip / shrink / quality / parts
- field view has color mode / vectors / legend
- FDM has voxel display / topology / thresholds

Docelowo:

```ts
type ViewportToolbarCapabilities = {
  renderModes: boolean;
  colorModes: boolean;
  clip: boolean;
  vectors: boolean;
  shrink: boolean;
  quality: boolean;
  parts: boolean;
  screenshot: boolean;
};
```

To da jeden system UI dla wielu viewportów.

---

## 13. Plan wdrożenia

### Etap 1 — UX skeleton

Cel:

- wyprowadzić toolbar z `FemMeshView3D.tsx` do osobnych komponentów,
- zachować starą funkcjonalność 1:1,
- zmienić tylko strukturę i styl.

Zakres:

- `ViewportToolbar3D.tsx`
- `ViewportToolGroup.tsx`
- `ViewportIconAction.tsx`
- przepięcie handlers z obecnego `FemMeshView3D`

Bez zmian semantycznych w renderze.

### Etap 2 — Icon-first top bar

Cel:

- zamienić tekstowe paski na ikonowe grupy,
- dodać tooltipy i aktywne stany,
- ograniczyć tekst do minimum.

Zakres:

- render group
- color group
- camera group
- panels group

### Etap 3 — Popover widgets

Cel:

- wyjąć suwaki i secondary settings z top bara,
- wprowadzić profesjonalne mini-panels.

Zakres:

- clip popover
- display popover
- vector popover
- camera/view popover

### Etap 4 — Context chips and focus strip

Cel:

- ucywilizować środkowy obszar z focus/context/isolate,
- zbudować lepsze status chips.

Zakres:

- quantity chip
- frame chip
- visibility chip
- focused entity chip
- selected part chip

### Etap 5 — Shared viewport toolbar

Cel:

- przygotować reuse dla FDM i analysis views.

Zakres:

- capability-driven API,
- integracja z `MagnetizationView3D`,
- redukcja duplikacji między viewportami.

---

## 14. Kryteria akceptacji

Refaktor uznajemy za udany, gdy:

- użytkownik może obsłużyć podstawowe funkcje 3D bez czytania długich etykiet,
- top bar mieści się estetycznie na typowych szerokościach,
- najczęstsze akcje są dostępne w 1 kliknięciu,
- secondary tuning mieści się w popoverach,
- FEM i FDM idą w stronę wspólnego języka UI,
- toolbar wygląda jak narzędzie profesjonalne, a nie debug strip,
- kod `FemMeshView3D.tsx` staje się wyraźnie krótszy i czytelniejszy.

### Twarde acceptance checks

- render mode da się zmienić jednym kliknięciem ikonowym,
- color mode da się zmienić bez rozwijania długiego tekstowego paska,
- clip panel jest czytelny i nie rozpycha top bara,
- camera presets są dostępne przez spójne menu,
- legend / parts / labels nie wiszą jako luźne tekstowe guziki,
- toolbar działa dobrze na szerokości laptopowej i na węższym layoucie.

---

## 15. Ryzyka i jak nimi zarządzić

### Ryzyko 1 — Przeprojektowanie bez poprawy użyteczności

Mitigacja:

- etap 1 zachowuje funkcję 1:1,
- etap 2 zmienia tylko sposób prezentacji,
- rollout iteracyjny.

### Ryzyko 2 — Za dużo overlayów jednocześnie

Mitigacja:

- top bar tylko dla primary actions,
- popovers dla tuning,
- side drawers dla panels.

### Ryzyko 3 — FEM i FDM znowu się rozejdą

Mitigacja:

- capability-driven shared toolbar API,
- reuse `lucide-react` i wspólnych tool components.

---

## 16. Rekomendowana kolejność implementacji

1. Wyciągnąć toolbar JSX z `FemMeshView3D.tsx` do osobnych komponentów.
2. Wprowadzić ikonowe `Render`, `Color`, `Camera`, `Panels`.
3. Schować `Clip`, `Opacity`, `Shrink`, `Arrows` do popoverów.
4. Zbudować nowy focus/context strip jako chips.
5. Dopiero potem przenieść wzorzec do `MagnetizationView3D.tsx`.

---

## 17. Najważniejsza decyzja projektowa

Nie iść w "więcej tekstu, tylko ładniej".  
Trzeba iść w:

- krótszy top bar,
- lepszą ikonografię,
- lepszą hierarchię,
- lepsze popovery,
- wspólną architekturę narzędzi viewportu.

To jest refaktor semantyki interfejsu, a nie tylko restyle.

---

## 18. Proponowany następny krok

Po akceptacji tego planu warto od razu zrobić:

1. szybki wireframe low-fi bez kodu,
2. etap 1 implementacji w `FemMeshView3D.tsx`,
3. dopiero potem polish wizualny i shared extraction do FDM.
