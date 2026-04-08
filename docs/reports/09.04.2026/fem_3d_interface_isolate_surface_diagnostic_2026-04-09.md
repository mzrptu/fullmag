# FEM 3D Interface Audit (Isolate / Surface / Layers / Nodes)

Date: 2026-04-09  
Scope: `apps/web/components/preview/*` (FEM 3D rendering + toolbar state sync)

## Summary

Zidentyfikowano kilka konfliktów stanu UI/renderu, które powodowały wrażenie „losowego” działania po selekcji obiektu/węzła oraz po przełączaniu `context <-> isolate`.
Najbardziej problematyczne były:

1. Toolbar w praktyce zmieniał target (czasem tylko zaznaczone części), więc ten sam klik dawał inny efekt po zmianie selekcji.
2. Dla warstw non-magnetic był ukryty fallback wymuszający colormapę mimo `colorField='none'`.
3. Popover `Arrows color` oferował tryby, których renderer strzałek nie obsługuje (`quality`, `sicn`, `none`) — UI deklarowało tryb, a scena renderowała co innego.

## Root Causes

## 1) Selection-dependent toolbar targeting

W `FemMeshView3D` lista `toolbarStylePartIds` była zależna od selekcji (`isSelected`) przed fallbackiem do wszystkich warstw. To powodowało, że:
- w `context` wybór render mode/color nagle działał tylko na selected part,
- po odznaczeniu wracał do większego zakresu,
- użytkownik widział niespójne „przełączanie się” zakresu działania kontrolek.

## 2) Non-magnetic full-domain fallback override

W `FemViewportScene` istniała reguła:
- jeśli `layer.colorField === 'none'` i quantity-domain = `full_domain` i warstwa non-magnetic,
- to pole było nadpisywane globalnym `field`.

Efekt: warstwa, która miała być neutralna (`none`), dostawała colormapę, co dawało efekt „nakładki” i konflikt z oczekiwaniem strict surface color.

## 3) Unsupported arrow color modes exposed in UI

`FemArrows` renderuje poprawnie tylko:
- `orientation`, `x`, `y`, `z`, `magnitude`.

Toolbar pozwalał jednak ustawić też:
- `quality`, `sicn`, `none`.

To dawało rozjazd: aktywny stan UI != realny sposób kolorowania strzałek.

## Implemented Fixes

### A) Stabilny target toolbar controls (selection no longer retargets controls)

Plik: `apps/web/components/preview/FemMeshView3D.tsx`

- `toolbarStylePartIds` nie przełącza się już na `selected-only`.
- Kontrolki render/color mają stabilny target oparty o widoczne warstwy.
- `toolbarColorPartIds` preferuje warstwy magnetic; fallback na non-air, a nie air.

### B) Deterministic toolbar active values for mixed states

Plik: `apps/web/components/preview/FemMeshView3D.tsx`

- Dla `toolbarRenderMode` i `toolbarColorField`:
  - jeśli wszystkie target layers mają jednolitą wartość -> pokazujemy ją,
  - jeśli stan jest mieszany -> fallback do globalnego stanu toolbar (zamiast losowego „pierwszego elementu”).

### C) Color field state sync improvement

Plik: `apps/web/components/preview/FemMeshView3D.tsx`

- `applyToolbarColorField` aktualizuje lokalny stan `field` zawsze (nie tylko bez mesh parts).
- Eliminuje to chwilowe rozjazdy legendy/hud przy patchowaniu part view state.

### D) Remove non-magnetic colormap override in full-domain

Plik: `apps/web/components/preview/fem/FemViewportScene.tsx`

- Usunięto fallback, który nadpisywał `colorField='none'` na globalne `field` dla non-magnetic parts.
- Warstwa renderuje teraz dokładnie to, co ma w `layer.viewState.colorField`.

### E) Arrow color options limited to supported modes

Plik: `apps/web/components/preview/fem/FemViewportToolbar.tsx`

- Dodano osobny zestaw `ARROW_COLOR_OPTIONS`:
  - `orientation`, `x`, `y`, `z`, `magnitude`.
- Usunięto z UI strzałek `quality/sicn/none`.

### F) Runtime sanitation for legacy arrow field state

Plik: `apps/web/components/preview/FemMeshView3D.tsx`

- Dodano `SUPPORTED_ARROW_COLOR_FIELDS`.
- Jeśli stan historyczny zawiera nieobsługiwany arrow field -> renderer używa `orientation`.

## Validation

- `npm --prefix apps/web run typecheck` -> PASS
- Punktowy lint na zmienionych plikach ujawnia istniejące historyczne problemy lint w `FemMeshView3D.tsx` (niezależne od powyższych zmian funkcjonalnych).

## Remaining Risks / Follow-up

1. `FemMeshView3D.tsx` ma historyczny dług lint/react-hooks (refs/immutability/no-unused-expressions) — warto zrobić osobny refactor cleanup.
2. Brakuje automatycznych testów UI dla scenariuszy `context/isolate + render/color`. Warto dodać e2e (Playwright) dla:
   - stable toolbar target,
   - no override for `none` on non-magnetic,
   - arrow color mode parity.
3. Jeśli potrzebna jest semantyka „kontroluj tylko selected part”, powinna być jawna (np. toggle `Apply to selection`) zamiast ukrytego zachowania zależnego od selekcji.

## Files Changed

- `apps/web/components/preview/FemMeshView3D.tsx`
- `apps/web/components/preview/fem/FemViewportScene.tsx`
- `apps/web/components/preview/fem/FemViewportToolbar.tsx`

