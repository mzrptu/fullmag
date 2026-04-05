# Fullmag — frontend Analyze v2 (solver-aware) po poprawkach FEM/runtime

**Data:** 2026-04-04  
**Zakres:** frontend Analyze / Study Tree / diagnostics shell  
**Kontekst:** po ostatnich poprawkach solvera FEM i runtime/preview warto skorygować frontendowy plan Analyze tak, aby UI nie było tylko „ładnym viewerem”, ale też **wiarygodnym panelem diagnostycznym**.

---

## 1. Co zmienia świeży status poprawek solvera

Z Twojej notatki wynika, że backend/runtime ma już kilka ważnych korekt:

- thermal noise jest odświeżane per-step, a nie „zamrożone”,
- CPU reference fallback nie ignoruje już po cichu nieobsługiwanej fizyki,
- Oersted axis jest jawnie walidowane,
- walidacja materiałów i cubic anisotropy axes jest mocniejsza,
- runtime/preview marker semantics są spójniejsze (`magnetic / nonmagnetic`).

### Najważniejszy frontendowy wniosek

To oznacza, że Analyze powinno pokazywać nie tylko:
- spectrum,
- mode shapes,
- dispersion,

ale też **kontrakt solvera**, czyli:
- na jakim backendzie policzono wynik,
- czy wynik był liczony na CPU reference czy native FEM GPU,
- czy były backend warnings / hard rejections,
- jaka jest semantyka części siatki (magnetic / air / interface),
- czy w runie aktywne były zjawiska typu thermal / Oersted i czy UI ma to jasno oznaczone.

---

## 2. Co jest dziś już w frontendzie

## 2.1 Działa Analyze jako osobny view mode
To już jest gotowe — użytkownik może przełączyć się do Analyze z control strip.

## 2.2 AnalyzeViewport jest funkcjonalny, ale zbyt autonomiczny
Aktualny viewport:
- sam ładuje bootstrap,
- sam wykrywa artifacty eigen,
- sam pobiera spectrum, modes, dispersion,
- sam trzyma lokalny stan tabów i mode selection.

To jest wygodne na start, ale teraz ogranicza dalszy UX, bo:
- nie da się nim łatwo sterować z tree,
- nie korzysta z bogatego kontekstu runtime (engine label, logi, warnings, mesh semantics),
- nie eksponuje poprawek solvera w UI.

## 2.3 ControlRoomContext ma już dane potrzebne do diagnostyki
To bardzo ważne:
- `runtimeEngineLabel`
- `metadata`
- `engineLog`
- `latestBackendError`
- `meshParts`
- `magneticParts`
- `airPart`
- `interfaceParts`

czyli dane do solver-aware Analyze panelu są już w dużej części **w istniejącym kontekście**.

---

## 3. Korekta poprzedniego planu frontendowego

W poprzedniej wersji frontendowego planu nacisk był na:
1. shared Analyze state
2. artifact hook
3. tree integration
4. shell polish

To nadal jest poprawna kolejność, ale po solver corrections trzeba dodać **jeszcze jeden tor**:

> **solver-aware diagnostics track**

Czyli nowy frontend powinien składać się z 5 filarów:

1. shared Analyze state  
2. artifact loading/cache  
3. Study/Outputs tree routing  
4. solver-aware diagnostics  
5. shell / beauty pass

---

## 4. Nowy docelowy UX

## 4.1 Analyze ma być piękne i wiarygodne

Docelowy Analyze powinien mieć trzy poziomy:

### A. Summary / badges bar
Widoczne od razu:
- backend (`CPU FEM`, `Native FEM GPU`, itp.)
- normalization
- damping policy
- equilibrium source
- liczba modów
- badge:
  - `thermal active`
  - `oersted restricted`
  - `cpu reference guarded`
  - `magnetic markers normalized`

### B. Main analyze content
- Spectrum
- Mode Inspector
- Dispersion

### C. Diagnostics rail / panel
- runtime warnings
- backend error excerpt
- mesh semantics:
  - ile części magnetic
  - czy jest air
  - ile interface parts
- krótkie wyjaśnienie kontraktu:
  - „UI używa solver-normalized magnetic/nonmagnetic roles”

---

## 5. Priorytety po solver corrections

## P0 — natychmiast
1. shared Analyze state
2. artifact hook
3. tree helper + RunSidebar routing
4. **runtime diagnostics hook**
5. **AnalyzeDiagnosticsPanel**

## P1
6. polished Analyze shell z badge bar
7. mesh semantics panel
8. prev/next mode + keyboard

## P2
9. compare
10. diagnostics advanced
11. export / VTK / CSV

---

## 6. Najważniejsze istniejące pliki do ruszenia

- `apps/web/components/runs/control-room/ControlRoomContext.tsx`
- `apps/web/components/runs/control-room/context-hooks.tsx`
- `apps/web/components/runs/control-room/AnalyzeViewport.tsx`
- `apps/web/components/runs/control-room/RunSidebar.tsx`
- `apps/web/components/panels/ModelTree.tsx`

---

## 7. Najważniejsze NOWE pliki

## 7.1 `useAnalyzeRuntimeDiagnostics.ts`
Nowy hook, który złoży:
- runtime badges
- warnings
- mesh semantics summary
- solver contract text

## 7.2 `AnalyzeRuntimeBadges.tsx`
Mały, szybki komponent do badge bar w headerze Analyze.

## 7.3 `AnalyzeMeshSemanticsPanel.tsx`
Panelek pokazujący:
- magnetic parts
- air presence
- interface count
- contract note

## 7.4 `AnalyzeDiagnosticsPanel.tsx`
Agreguje:
- runtime badges
- warnings
- last backend error
- mesh semantics
- log excerpt

## 7.5 `AnalyzeViewportShell.v2.tsx`
Nowy shell, który:
- korzysta z shared state,
- korzysta z artifact hooka,
- korzysta z diagnostics hooka,
- deleguje wizualizację do istniejących widgetów:
  - `ModeSpectrumPlot`
  - `EigenModeInspector`
  - `DispersionBranchPlot`

---

## 8. Dlaczego to jest ważne właśnie teraz

Bo po poprawkach solvera frontend powinien przestać „udawać”, że każda analiza jest taka sama.

Jeżeli wynik:
- był liczony na CPU reference,
- był ograniczony walidacją osi Oersteda,
- ma solver-normalized marker semantics,

to użytkownik powinien to **widzieć** w Analyze, a nie tylko w logach albo w notatkach developerskich.

To jest dokładnie różnica między:
- „viewerem wyników”
a
- „produkcyjnym panelem analizy”.

---

## 9. Najlepszy pierwszy PR po tych zmianach backendu

### PR 1 — Analyze state + artifact hook + diagnostics hook
Zakres:
- analyze state w context
- `useCurrentAnalyzeArtifacts.ts`
- `useAnalyzeRuntimeDiagnostics.ts`
- `AnalyzeRuntimeBadges.tsx`
- `AnalyzeDiagnosticsPanel.tsx`

### Efekt
Już po tym PR:
- Analyze będzie gotowe na tree routing,
- zacznie pokazywać solver contract,
- zacznie korzystać z istniejącego runtime contextu, a nie tylko z local fetch state.

---

## 10. Drugi PR

### PR 2 — Study Tree + Analyze shell v2
Zakres:
- `ModelTree.tsx`
- `RunSidebar.tsx`
- `AnalyzeViewport.tsx` / `AnalyzeViewportShell.v2.tsx`

### Efekt
- klik w `Outputs > Eigenmodes > Mode N`
- otwiera Analyze
- ustawia mode
- pokazuje badge bar + diagnostics

---

## 11. Definition of Done — frontend Analyze v2

Frontend jest gotowy, gdy:

- [ ] Analyze ma wspólny stan selection/tab
- [ ] tree może sterować Analyze
- [ ] Analyze pokazuje runtime badges
- [ ] Analyze pokazuje mesh semantics panel
- [ ] Analyze pokazuje backend warnings/error excerpt
- [ ] UI korzysta z solver-normalized part roles zamiast zgadywać po surowych markerach
- [ ] 기존 spectrum / mode inspector / dispersion dalej działają bez regresji

---

## 12. Końcowy werdykt

Po ostatnich poprawkach solvera frontendowy cel nie powinien już brzmieć tylko:

> „zrobić ładne Analyze”

ale raczej:

> **„zrobić piękne i wiarygodne Analyze, które pokazuje zarówno wynik, jak i kontrakt solvera.”**

To jest najlepsza chwila, żeby dołożyć warstwę diagnostics do Analyze — bo backend właśnie zaczął być dużo bardziej jawny i bezpieczny.
