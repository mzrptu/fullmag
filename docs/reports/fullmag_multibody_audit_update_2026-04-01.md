# Fullmag — aktualizacja audytu multibody po zmianach w kodzie
**Data:** 2026-04-01  
**Zakres:** weryfikacja, czy poprzedni raport o `nanoflower_fem.py` / multi-body FEM wymaga aktualizacji po ostatnich zmianach w repozytorium, oraz które wnioski są nadal prawdziwe, a które są już nieaktualne.

---

## 1. Wniosek końcowy

Tak — **poprzedni raport wymaga aktualizacji**.

Nie dlatego, że był „zły” jako diagnoza historyczna, ale dlatego, że kilka wcześniej trafnych ustaleń zostało już w międzyczasie naprawionych. Po aktualizacji kodu nie można już utrzymywać bez korekty co najmniej następujących tez:

1. że builder draft opiera się na `stages[0]` i przez to zanieczyszcza UI parametrami pierwszego stage,
2. że round-trip builder → skrypt emituje mesh workflow tylko dla pierwszego obiektu,
3. że `Universe` / `worldExtent` dla FEM w Control Room jest już zawsze utożsamiane z bboxem aktualnego mesha,
4. że osie 3D w `FemMeshView3D` są zawsze liczone wyłącznie z `geomSize`,
5. że ścieżka `ImportedGeometry` ma trwałą asymetrię `source_root` przy liczeniu bounds.

Po aktualizacji stan systemu jest znacznie lepszy. Multi-body nadal nie jest idealnie „zamknięte” end-to-end w każdej funkcji wizualizacji i selekcji, ale **rdzeń builder/UI dla wieloobiektowego FEM jest dziś dużo dojrzalszy**.

---

## 2. Co z poprzedniego raportu pozostaje prawdziwe

Poniższe wnioski nadal są poprawne i warto je zachować.

### 2.1. `examples/nanoflower_fem.py` jest rzeczywiście przykładem multi-body

Aktualny plik nadal tworzy dwa osobne obiekty FEM:
- `nanoflower_left`,
- `nanoflower_right`.

W praktyce oznacza to, że przykład źródłowy jest nadal prawidłowym testem dla multi-body FEM. Jeżeli UI pokazuje jeden obiekt, to nie wolno już z góry zakładać, że to „wina przykładu” — trzeba analizować stan sesji, builder draft, overlaye, bounds, focus i warstwę renderingu.

### 2.2. Screenshot z jedną geometrią nadal nie pasował do tego przykładu

To ustalenie z poprzedniego raportu nadal jest sensowne jako diagnoza tamtej obserwacji: jeżeli interfejs pokazywał:
- jeden obiekt,
- manual Universe 800 nm,
- stan zbliżony do `m = (0.1, 0.0001, 0.99)`,

to taki obraz nadal lepiej pasuje do jednoobiektowego przykładu z manualnym Universe niż do właściwego, dwuobiektowego `nanoflower_fem.py`.

### 2.3. FEM planner / backend potrafi iść dalej niż UI

To dalej jest prawda architektoniczna: backend FEM i model danych są bardziej multi-body-ready niż część narzędzi wizualnych, pomocniczych i edycyjnych. Po aktualizacji różnica jest mniejsza niż wcześniej, ale nadal istnieje.

---

## 3. Co w poprzednim raporcie jest już nieaktualne albo wymaga silnego złagodzenia

To jest najważniejsza część tego dokumentu.

## 3.1. Builder nie opiera się już na `stages[0]`

### Poprzednia teza
Poprzedni raport wskazywał, że builder draft bierze `stages[0].problem`, co mogło prowadzić do zafałszowania parametrów bazowych (np. `alpha = 1.0` po `relax()`).

### Stan aktualny
Ta diagnoza jest już nieaktualna. W aktualnym kodzie builder bazuje na helperze `_builder_base_problem(...)`, który zwraca `loaded.problem`, a nie pierwszy stage.

### Konsekwencja
To oznacza, że wcześniejsza uwaga o „alpha leakage” z relaksacji do buildera:
- była trafna dla starszego stanu kodu,
- ale nie powinna już być traktowana jako obecny błąd bez ponownej reprodukcji.

### Co należy zmienić w poprzednim raporcie
Sekcje mówiące o:
- „UI pokazuje stan pierwszego stage zamiast bazowego problemu”,
- „`alpha=1` wynika z `stages[0]`”,

należy oznaczyć jako **naprawione w nowszej rewizji**.

---

## 3.2. Round-trip mesh workflow nie jest już ograniczony do pierwszego obiektu

### Poprzednia teza
Wcześniej round-trip builder → flat script emitował `.mesh(...)` i `.mesh.build()` tylko dla `problem.magnets[0]`.

### Stan aktualny
To również jest już nieaktualne. Aktualna ścieżka:
- zbiera konfiguracje mesh dla wielu geometrii,
- renderuje mesh workflow per-geometry,
- nie ogranicza się już do pierwszego magnesu.

### Konsekwencja
W poprzednim audycie ten punkt był jednym z najmocniejszych dowodów na „niedomknięty multi-body round-trip”. Po aktualizacji nie wolno go już utrzymywać jako bieżącej usterki.

### Co należy zmienić
Zastąpić wcześniejszy wniosek nowym:
- „round-trip mesh workflow dla wielu obiektów został naprawiony; dalsza walidacja powinna dotyczyć nie samej emisji `.mesh(...)`, lecz zgodności parametrów i stabilności edycji po wielokrotnym rewrite”.

---

## 3.3. `worldExtent` / `worldCenter` dla FEM w Control Room są dziś znacznie poprawniejsze

### Poprzednia teza
Wcześniej raport słusznie krytykował, że `worldExtent` dla FEM było w praktyce bboxem aktualnego mesha, a nie semantycznym `Universe`.

### Stan aktualny
Aktualny kod Control Room robi już coś dojrzalszego:

dla FEM:
1. jeśli istnieje manual Universe w builderze → bierze jego `size`,
2. w przeciwnym razie próbuje wyliczyć rozmiar z union bounds wszystkich obiektów + padding,
3. dopiero później schodzi do fallbacków.

Analogicznie dla `worldCenter`:
1. preferowany jest jawny `universe.center`,
2. potem środek union bounds obiektów,
3. dopiero dalej mesh bounds.

### Konsekwencja
To znaczy, że poprzedni zarzut:
- „Control Room myli Universe z bboxem mesha”,

jest dziś **co najwyżej częściowo aktualny** i tylko w określonych fallbackach. Nie jest już trafnym opisem zachowania domyślnego.

### Co należy zmienić w poprzednim raporcie
W miejsce dawnej sekcji należy wpisać:
- semantyka `Universe` została istotnie poprawiona,
- ale trzeba jeszcze pilnować spójności między:
  - builder universe,
  - object union bounds,
  - mesh bounds,
  - osiami sceny,
  - kamerą i focus.

---

## 3.4. `FemMeshView3D` nie używa już osi wyłącznie z `geomSize`

### Poprzednia teza
Poprzedni raport wskazywał, że osie 3D są oparte tylko o `geomSize`, czyli rozmiar bieżącej geometrii/mesha.

### Stan aktualny
Po aktualizacji:
- `axesWorldExtent` preferuje przekazany `worldExtent`,
- `axesCenter` preferuje przekazany `worldCenter`,
- `geomSize` jest dopiero fallbackiem.

### Konsekwencja
Twoja intuicja o tym, że osie powinny obejmować cały `Universe`, a nie tylko pojedynczy obiekt, została częściowo wdrożona. Nie jest to już wyłącznie teoretyczna sugestia z audytu — obecny kod faktycznie idzie w tym kierunku.

### Co pozostaje do zrobienia
Nadal warto dopracować:
- spójność osi z aktualnym trybem kamery,
- jawne rozróżnienie:
  - physical domain,
  - visualization domain,
  - mesh bbox,
  - object bbox,
- podpisy i legendę, tak aby użytkownik wiedział, czy patrzy na:
  - Universe,
  - domain with padding,
  - union of object bounds,
  - active clipped volume.

---

## 3.5. Ścieżka `ImportedGeometry` i liczenie bounds wygląda lepiej niż wcześniej

### Poprzednia teza
Wcześniej builderowe liczenie bounds dla imported STL miało asymetrię względem `source_root`, przez co solver mógł znajdować plik, a builder/preview nie.

### Stan aktualny
W aktualnym stanie kodu warstwa surface assets została wyraźnie uporządkowana:
- dodano helper do rozwiązywania ścieżek assetów,
- `load_surface_asset(...)` przyjmuje `source_root`,
- architektura jest spójniejsza niż wcześniej.

### Konsekwencja
Ten punkt również nie powinien już figurować jako pewna, obecna wada — raczej jako:
- historyczna przyczyna poprzednich problemów,
- obszar, który nadal trzeba testować na rzeczywistych ścieżkach względnych i importach z UI.

---

## 4. Co po aktualizacji nadal należy testować w multi-body

To, że kilka wcześniejszych usterek zostało naprawionych, nie znaczy, że temat można zamknąć. Poniższe obszary nadal wymagają testów regresyjnych.

### 4.1. Overlaye i focus dla obiektów importowanych oraz złożonych

Warstwa `buildObjectOverlays(...)` jest dziś znacznie lepsza, ale nadal opiera się na bounds:
- albo wyliczalnych z parametrów prymitywu,
- albo zadeklarowanych w `bounds_min` / `bounds_max`.

To oznacza, że jakość:
- focusu,
- isolacji,
- zaznaczania,
- wizualnych ramek obiektu,

nadal zależy od jakości bounds. Dla geometrii:
- silnie niesymetrycznych,
- wklęsłych,
- po booleanach,
- importowanych z siatki powierzchniowej,

AABB nie daje „prawdziwego” kształtu obiektu — tylko jego pudełko.

**Wniosek:** multi-body jest obecnie poprawniej reprezentowane, ale wciąż głównie na poziomie **AABB overlays**, a nie pełnego, geometrycznie wiernego selection/focus modelu.

### 4.2. Segmentacja obiektów we FEM mesh overlay

W `FemMeshView3D` jest już osobna ścieżka dla `objectSegments`, co jest bardzo dobrą zmianą. Nadal jednak trzeba sprawdzić trzy przypadki:
1. segmentacja istnieje i jest poprawna,
2. segmentacja istnieje, ale nie obejmuje wszystkich elementów,
3. segmentacja nie istnieje i włącza się fallback bbox-based.

To właśnie trzeci przypadek bywa zdradliwy dla multi-body:
- obiekt może być wybrany „wizualnie poprawnie” przez overlay AABB,
- ale highlight rzeczywistej siatki może być już tylko przybliżeniem.

### 4.3. Spójność UI po edycji translacji wielu obiektów

Po zmianach w kodzie translacja działa już przez aktualizację `geometry_params.translation`. Trzeba jednak przetestować:
- dwa importowane obiekty,
- dwa prymitywy,
- mieszany przypadek prymityw + imported mesh,
- translację jednego obiektu po wygenerowaniu nowego mesha,
- translację obu obiektów na przemian,
- zapis/rewrite/reload.

To jest ważne, bo multi-body bywa poprawne „w statycznym renderze”, a psuje się dopiero po sekwencji:
1. zaznacz,
2. przesuń,
3. wygeneruj mesh,
4. zmień view mode,
5. wróć do buildera,
6. zapisz skrypt,
7. przeładuj sesję.

---

## 5. Zaktualizowana diagnoza end-to-end dla `nanoflower_fem.py`

Poniżej podaję nową, poprawioną narrację diagnostyczną, którą można traktować jako zastępstwo dla centralnego wniosku z poprzedniego raportu.

### 5.1. Wejście Python
`nanoflower_fem.py` nadal jest poprawnym, dwuobiektowym przykładem FEM.

### 5.2. Loader / builder
Aktualny loader i builder utrzymują wieloobiektowy model danych lepiej niż wcześniej; dawny problem z bazowaniem na `stages[0]` nie powinien już zniekształcać draftu.

### 5.3. Round-trip
Round-trip mesh workflow nie jest już jednoobiektowy. To istotna poprawa.

### 5.4. Control Room / Universe
Semantyka `worldExtent` i `worldCenter` jest znacznie bliższa temu, czego oczekujesz: Universe/domain nie jest już tak łatwo zredukowany do bbox pojedynczego mesha.

### 5.5. 3D preview
Osie sceny i część logiki kamery potrafią już uwzględniać globalny extent domeny. Nadal jednak pozostają problemy stricte renderujące i interakcyjne — one są opisane szeroko w osobnym audycie 3D.

### 5.6. Solver
Backend FEM nadal jest bardziej dojrzały niż część UI. To pozostaje prawdziwe i trzeba to uwzględniać przy interpretacji zachowania interfejsu.

---

## 6. Macierz: poprzedni punkt → obecny status

| Poprzedni punkt | Status po aktualizacji | Komentarz |
|---|---|---|
| `nanoflower_fem.py` jest multi-body | nadal prawda | bez zmian |
| Screenshot z jednym obiektem nie pasuje do tego pliku | nadal prawda | bez zmian jako diagnoza tamtej sesji |
| Builder bierze `stages[0]` | naprawione / nieaktualne | wymaga usunięcia z raportu głównego |
| `alpha=1` z relaksacji zanieczyszcza builder | naprawione / co najmniej nieudowodnione w obecnym kodzie | wymaga usunięcia albo przeniesienia do „historycznych” |
| Mesh round-trip tylko dla pierwszego obiektu | naprawione / nieaktualne | wymaga usunięcia z raportu głównego |
| `Universe` w Control Room = bbox mesha | mocno złagodzone | dziś istnieje priorytet dla builder universe / object bounds |
| Osie `FemMeshView3D` = tylko `geomSize` | naprawione / nieaktualne jako opis domyślny | dziś preferowany jest `worldExtent` |
| Imported STL bounds bez `source_root` | naprawione / istotnie poprawione | nadal warto testować realne ścieżki |
| Multi-body w UI nadal ma luki | nadal prawda | ale dziś głównie w warstwie interakcji/renderingu, nie w samym modelu buildera |

---

## 7. Jak zaktualizować poprzedni raport praktycznie

Rekomenduję nie „dopisywać erraty na końcu”, tylko zrobić porządną aktualizację strukturalną.

### 7.1. Sekcje do usunięcia albo przeniesienia do „stan historyczny”
Usuń albo wyraźnie oznacz jako historyczne:
- builder bazujący na `stages[0]`,
- `alpha=1` jako dowód bieżącego błędu buildera,
- mesh workflow tylko dla pierwszego obiektu,
- Control Room utożsamiający `Universe` wyłącznie z bboxem mesha,
- osie 3D oparte wyłącznie na `geomSize`,
- asymetrię `source_root` jako aktualny błąd.

### 7.2. Sekcje, które warto zostawić
Zostaw:
- potwierdzenie, że `nanoflower_fem.py` jest rzeczywiście multi-body,
- uwagę o możliwej rozbieżności między aktywną sesją UI a plikiem oglądanym w edytorze,
- tezę, że backend FEM jest bardziej dojrzały niż część narzędzi UI,
- konieczność analizowania konsekwencji w całej ścieżce: builder → preview → focus → mesh overlay → solver.

### 7.3. Nowe sekcje, które trzeba dopisać
Dopisz:
- postęp w semantyce `Universe`,
- poprawę round-tripu multi-body,
- poprawę liczenia bounds/imported assets,
- nowy zestaw ryzyk: selection, overlay AABB, camera, isolate, transparent rendering, transform tools.

---

## 8. Co nadal rekomenduję wdrożyć dla multi-body

Choć część problemów już zniknęła, nadal widzę sens w poniższych zadaniach.

### 8.1. Jawna walidacja multi-body w testach integracyjnych
Dodaj testy E2E, które sprawdzają:
1. dwa imported STL,
2. dwa prymitywy,
3. prymityw + imported STL,
4. translate jednego obiektu,
5. translate obu obiektów,
6. generate mesh,
7. rewrite script,
8. reload session,
9. focus na obiekt A,
10. focus na obiekt B,
11. isolate obiektu A,
12. powrót do context.

### 8.2. Rozdzielenie pojęć w UI
W tekstach, etykietach i tooltipach trzeba odróżnić:
- `Declared Universe`,
- `Effective Domain`,
- `Object Union Bounds`,
- `Mesh Bounds`,
- `Current Visible Volume` (po clip/slice).

### 8.3. Selection/focus oparty o rzeczywiste segmenty obiektu, nie AABB
To jest dług techniczny, który po naprawie buildera staje się bardziej widoczny. Im lepiej działa multi-body w danych, tym mocniej razi to, że część interakcji nadal żyje na AABB.

---

## 9. Minimalny plan regresji po tej aktualizacji

Poniżej proponuję krótki, ale bardzo konkretny pakiet testów.

### Test M1 — ładowanie multi-body
- Otwórz `examples/nanoflower_fem.py`.
- Oczekuj dwóch wpisów w `Objects`.
- Oczekuj sensownego union bounds w X większego niż pojedynczy nanoflower.

### Test M2 — focus
- Zaznacz `nanoflower_left`, wywołaj Focus.
- Zaznacz `nanoflower_right`, wywołaj Focus.
- Kamera nie może wracać do origin ani gubić targetu.

### Test M3 — isolate
- Włącz isolate dla lewego obiektu.
- Drugi obiekt ma zostać:
  - albo ukryty,
  - albo jednoznacznie wyszarzony,
  - ale bez mylących transparent bleed-through artefaktów.

### Test M4 — translacja
- Przesuń lewy obiekt.
- Wygeneruj ponownie mesh.
- Zapisz skrypt.
- Przeładuj projekt.
- Pozycja musi być zachowana.

### Test M5 — Universe
- Ustaw ręczny Universe większy niż union bounds.
- Osie, panel Universe i kamera muszą odzwierciedlać domenę, nie tylko aktualny mesh bbox.

---

## 10. Finalna odpowiedź na pytanie użytkownika

**Czy raport multibody wymaga aktualizacji?**  
Tak. I to wyraźnie.

Najważniejsze poprawki względem poprzedniego raportu są takie:
- część dawnych „core bugs” jest już naprawiona,
- obecny problem multi-body mniej dotyczy już builder draft / round-trip / semantyki Universe,
- a bardziej dotyczy warstwy interakcyjnej i renderującej: selection, isolate, focus, depth, transparent sorting, kamera, overlaye.

Innymi słowy:

> poprzedni raport dobrze łapał starszy stan systemu,  
> ale po ostatniej aktualizacji trzeba go przepisać tak, aby nie oskarżał już naprawionych miejsc i przesunął środek ciężkości na aktualne problemy 3D / viewport / interaction.

---

## 11. Krótkie podsumowanie dla maintainera

### Już poprawione
- builder base problem,
- multi-body mesh rewrite,
- lepsza semantyka world extent / center,
- lepsze osie 3D,
- lepsza ścieżka bounds dla imported assets.

### Nadal otwarte
- geometrycznie wierny selection/focus/isolate,
- pełna stabilność multi-body w viewportach 3D,
- narzędzia edycyjne dla wielu obiektów,
- render transparency/depth i spójność kamery.

### Rekomendacja
Formalnie zamknąć stare bugi jako „fixed”, a dalszy rozwój prowadzić już pod osobnym epikiem:
**“Viewport & Interaction correctness for multi-body FEM/FDM”**.