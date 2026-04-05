# Fullmag — Frontend Analyze Core Pack (wersja odtworzona)

**Data:** 2026-04-04  
**Cel:** odtworzenie bazowego pakietu pod **shared Analyze state + artifact hook + tree routing**.  
**Zakres:** tylko warstwa frontend/core, bez solver-aware diagnostics v2.

---

## 1. Po co jest ten pakiet

To jest **bazowy pakiet wdrożeniowy** dla frontendowego Analyze.  
Jego zadaniem jest uporządkować trzy rzeczy, które dziś są rozproszone:

1. **Stan Analyze**
   - który tab jest aktywny,
   - który mod jest wybrany,
   - kiedy wymusić refresh.

2. **Ładowanie artefaktów eigen**
   - bootstrap,
   - spectrum,
   - dispersion,
   - lazy fetch pojedynczego modu.

3. **Routing z drzewa Study / Outputs do AnalyzeViewport**
   - klik w `Spectrum`,
   - klik w `Mode N`,
   - klik w `Dispersion`.

---

## 2. Główny problem, który ten pakiet rozwiązuje

Dzisiaj `AnalyzeViewport` trzyma sporą część stanu lokalnie:
- `activeTab`
- `selectedMode`
- `modeCache`
- `loadState`
- własne fetchowanie bootstrapu i eigen artifacts

To działa jako samodzielny viewer, ale utrudnia trzy rzeczy:

- sterowanie Analyze z `RunSidebar` / `ModelTree`,
- deep-linking na poziomie `Mode N`,
- spójny refresh po zakończeniu solve.

Dlatego rekomendowany kierunek to:

> **AnalyzeViewport ma być cienkim widokiem, a nie głównym właścicielem stanu i fetch logiki.**

---

## 3. Docelowa architektura core

## 3.1 Shared Analyze state

Najwyżej położony stan Analyze powinien siedzieć w `ControlRoomContext.tsx`
albo w osobnym pliku context/hooks, ale współdzielonym z control room.

Minimalny stan:

```ts
type AnalyzeTab = "spectrum" | "modes" | "dispersion";

interface AnalyzeSelectionState {
  enabled: boolean;
  tab: AnalyzeTab;
  selectedModeIndex: number | null;
  refreshNonce: number;
}
```

Powinny istnieć helpery:

- `openAnalyze()`
- `selectAnalyzeTab(tab)`
- `selectAnalyzeMode(index)`
- `refreshAnalyze()`

---

## 3.2 Shared artifact hook

Logika danych Analyze powinna być wyjęta do hooka, np.:

- `useAnalyzeArtifacts()`

Ten hook powinien odpowiadać za:

- bootstrap fetch,
- detekcję czy istnieją artefakty eigen,
- fetch spectrum,
- fetch dispersion,
- lazy fetch `mode_{index}`,
- cache modów,
- status ładowania,
- błędy.

Dzięki temu:
- `AnalyzeViewport` jest prostszy,
- sidebar/tree może sterować widokiem bez duplikowania danych,
- łatwiej później dodać diagnostics v2.

---

## 3.3 Tree routing

Node ids w drzewie powinny być jawne i stabilne, np.:

- `analyze-root`
- `analyze-spectrum`
- `analyze-modes`
- `analyze-mode-0`
- `analyze-mode-1`
- `analyze-dispersion`

Do tego prosty parser:

```ts
parseAnalyzeTreeNode(nodeId: string)
```

który zwraca:
- docelowy tab,
- opcjonalny mode index.

---

## 4. Kolejność wdrożenia

## Krok 1
Dodać shared Analyze state do `ControlRoomContext.tsx`.

## Krok 2
Dodać `useAnalyzeArtifacts.ts`.

## Krok 3
Przepisać `AnalyzeViewport.tsx`, aby:
- czytał state z contextu,
- czytał dane z hooka,
- nie był głównym właścicielem fetch logiki.

## Krok 4
Dodać Analyze subtree w `ModelTree.tsx`.

## Krok 5
Dopiąć `RunSidebar.tsx`, żeby kliknięcie node:
- przełączało `viewMode = "Analyze"`,
- ustawiało tab,
- wybierało mode index.

---

## 5. Najważniejsze pliki w repo

## 5.1 `apps/web/components/runs/control-room/ControlRoomContext.tsx`
Tu trzeba dodać:
- `analyzeSelection`
- akcje `openAnalyze`, `selectAnalyzeTab`, `selectAnalyzeMode`, `refreshAnalyze`

To jest najważniejszy plik całego core refaktoru.

## 5.2 `apps/web/components/runs/control-room/AnalyzeViewport.tsx`
Tu trzeba:
- usunąć nadmiar lokalnego ownership stanu,
- czytać stan z contextu,
- czytać dane z hooka.

## 5.3 `apps/web/components/runs/control-room/RunSidebar.tsx`
Tu trzeba:
- zmapować kliknięcia w analyze nodes na `openAnalyze(...)`.

## 5.4 `apps/web/components/panels/ModelTree.tsx`
Tu trzeba:
- wygenerować subtree Analyze,
- nadać stabilne ids dla spectrum / modes / dispersion.

## 5.5 `apps/web/components/analyze/eigenTypes.ts`
Tu warto dopisać typy pomocnicze dla tree/result metadata, jeśli będą potrzebne.

---

## 6. Co jest w ZIP-ie

Paczka zawiera:

- raport `.md`
- szkic typu/stanu Analyze
- szkic hooka `useAnalyzeArtifacts`
- szkic patcha do `ControlRoomContext`
- szkic patcha do `RunSidebar`
- szkic helpera do `ModelTree`
- shell `AnalyzeViewport` po refaktorze
- README

To **nie są gotowe pliki do `git apply` 1:1**.  
To są celowane szkielety implementacyjne, które mają przyspieszyć wdrożenie.

---

## 7. Minimalne DoD dla core

Core uznaję za gotowy, gdy:

- [ ] `AnalyzeViewport` nie trzyma już głównego stanu wyboru modu lokalnie
- [ ] istnieje shared `AnalyzeSelectionState`
- [ ] istnieje współdzielony hook ładowania artefaktów
- [ ] kliknięcie `Spectrum` / `Mode N` / `Dispersion` z drzewa steruje Analyze
- [ ] refresh Analyze da się wywołać z contextu
- [ ] nie ma duplikacji fetch logiki między tree/sidebar i viewportem

---

## 8. Co robić po tym pakiecie

Dopiero po wdrożeniu tego core warto iść w pakiet v2:
- runtime diagnostics,
- badge bar,
- mesh semantics panel,
- diagnostics panel.

Czyli:

> **najpierw sterowanie i dane, potem ozdobniki i diagnostyka.**

---

## 9. Rekomendacja praktyczna

Najlepsza implementacja etapami:

1. `ControlRoomContext.tsx`
2. `useAnalyzeArtifacts.ts`
3. `AnalyzeViewport.tsx`
4. `RunSidebar.tsx`
5. `ModelTree.tsx`

Nie odwracałbym tej kolejności.
