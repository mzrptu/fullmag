# Raport koncepcyjny workspace Fullmag
## Korekta po doprecyzowaniu wizji produktu
## Data: 2026-04-05

---

## 1. Cel dokumentu

Ten raport porzadkuje docelowa koncepcje aplikacji Fullmag jako:

- narzedzia CAE / scientific workstation,
- dzialajacego w webie,
- ale od poczatku projektowanego tak, aby pozniej dobrze przejsc do Electron,
- uruchamianego albo z istniejacego skryptu / pliku symulacji,
- albo bez pliku wejsciowego, z ekranu startowego podobnego do COMSOL.

Raport jest korekta wczesniejszej wersji. Najwazniejsza zmiana po nowych uwagach:

> glownymi poziomami pracy nie powinny byc `Build / Mesh / Study / Results`, tylko `Model Builder / Study / Analyze`, a ekran startowy powinien byc osobnym etapem wejscia do aplikacji, nie czescia workspace'u symulacji.

---

## 2. Zalozenia produktowe po korekcie

### 2.1. Start bez pliku wejsciowego

Jezeli Fullmag uruchamia sie bez wskazanego skryptu lub projektu, aplikacja powinna pokazac **Start Hub** podobny do COMSOL:

- recent simulations,
- przegladanie istniejacych plikow,
- otwarcie katalogu / projektu / skryptu,
- sekcje przykladow i szablonow,
- przycisk `Create New Simulation`.

### 2.2. Start z pliku

Jezeli uzytkownik uruchamia Fullmag bezposrednio ze skryptu startowego albo z konkretnego pliku symulacji:

- pomijamy Start Hub,
- od razu otwieramy workspace danej symulacji,
- zachowujemy informacje o zrodle projektu,
- pozwalamy pozniej wejsc do `Open Source`, `Reload`, `Sync UI to Script`.

### 2.3. Glowne poziomy pracy

Wlasciwy workspace symulacji powinien miec trzy glowne poziomy:

1. `Model Builder`
   - budowa geometrii,
   - konfiguracja materialow i oddzialywan,
   - konfiguracja mesha, airboxa i domeny,
   - budowa calego skryptu symulacji.

2. `Study`
   - zywy podglad symulacji,
   - sterowanie runem,
   - podglad magnetyzacji, demag, innych wielkosci,
   - parametry runtime,
   - telemetria solvera,
   - wykresy energii i logi.

3. `Analyze`
   - analiza spektrum,
   - eigen solve / eigenmodes,
   - bardziej zaawansowany postprocessing,
   - modul rozwojowy, ktory bedzie dalej rozszerzany.

### 2.4. Wzorce referencyjne

Docelowy wzorzec nie powinien opierac sie na jednym programie, tylko na polaczeniu trzech:

- **COMSOL**: launcher, model tree, studies, results, porzadek CAE,
- **3ds Max**: authoring geometrii, scena, selekcja, transformy, isolate / hide / freeze,
- **MuMax / MuMax-like workflow**: szybki zywy podglad runtime, wykresy, telemetria, sterowanie obliczeniem.

### 2.5. Screeny z COMSOL jako bezposredni benchmark

Dolaczone screeny z COMSOL-a trzeba traktowac nie tylko jako luźna inspiracje, ale jako konkretny benchmark dla kilku warstw interfejsu:

- organizacji workspace'u,
- relacji miedzy tree, settings i graphics,
- logiki ribbonu,
- oraz tego, jak oddzielic strukture modelu od akcji i od wlasciwosci.

To jest bardzo wartosciowy punkt odniesienia, bo COMSOL pokazuje dojrzały wzorzec CAE, ktory jest czytelny nawet przy duzej liczbie opcji.

---

## 3. Diagnoza obecnego frontendu

### 3.1. Dwa rownolegle systemy nawigacji

Obecny shell miesza dwa top-level systemy:

- `TopHeader` pokazuje `Build / Study / Analyze / Runs`,
- `RibbonBar` pokazuje `Home / Mesh / Study / Results / Builder`.

To oznacza, ze interfejs nie odpowiada jednoznacznie na pytanie:

> "na jakim poziomie pracy teraz jestem?"

### 3.2. Czesciowo pozorne tryby

W aktualnym kodzie:

- `apps/web/app/(workspace)/analyze/page.tsx` jest canonical workspace page,
- `apps/web/app/(workspace)/study/page.tsx` robi redirect do `/analyze`,
- `apps/web/app/(workspace)/runs/page.tsx` robi redirect do `/analyze`.

Czyli UI obiecuje osobne przestrzenie pracy, ktore realnie jeszcze nie istnieja.

### 3.3. Zly root modelu

W `apps/web/components/panels/ModelTree.tsx` root drzewa jest dzisiaj oznaczony jako `Study`.

To jest mylace, bo:

- study nie jest calym projektem,
- study nie jest cala symulacja,
- study to tylko jeden z obszarow pracy i jeden z obiektow domenowych.

### 3.4. Pomieszanie selekcji z diagnostyka globalna

W `apps/web/components/panels/SettingsPanel.tsx` po panelu zaleznym od wybranego noda sa jeszcze doklejane globalne sekcje:

- `Solver Telemetry`,
- `Energy`.

To zaburza logike panelu wlasciwosci:

- wybranie `Airbox` nie daje czystego `Airbox Inspector`,
- wybranie obiektu nie daje czystego `Object Inspector`,
- authoring miesza sie z runtime diagnostics.

### 3.5. Frontend jest za backendem

To jest bardzo trafna uwaga i trzeba ja wpisac jako problem pierwszego rzedu:

> frontend nie nadaza za realnym solverem i backendem.

Przyklady:

- nie wszystkie zaimplementowane parametry sa dostepne w GUI,
- semantyka airboxa, demag i widokow jest pomieszana,
- czesc opcji runtime i czesc opcji authoringu nie ma jeszcze porzadnego rozdzialu,
- panel UI nie pokazuje pelnej mocy tego, co backend juz umie.

To oznacza, ze problem nie jest tylko estetyczny. To jest tez problem pokrycia funkcjonalnego.

### 3.6. Stage sequence istnieje, ale `Study Builder` jeszcze nie istnieje jako prawdziwy edytor

To jest bardzo wazny brak, ktory dobrze wybrzmial w Twojej uwadze.

Dzisiaj frontend ma juz zalazek modelu stage'ow:

- istnieje `study.stages`,
- w UI widac `Stage Sequence`,
- da sie inline-edytowac czesc stage'ow typu `relax`, `run`, `eigenmodes`.

Ale to jeszcze nie jest prawdziwy `Study Builder`.

Brakuje:

- jawnego dodawania stage'ow z ribbonu,
- reordering,
- grupowania i skladania zlozonych sekwencji,
- stage templates,
- stage macros typu `Field Sweep + Relax`,
- dynamicznego materializowania zlozonych sekwencji do backendowych stage'ow,
- oraz czytelnego powiazania miedzy stage authoringiem a live wykonaniem pipeline'u.

W praktyce:

> mamy juz liste stage'ow, ale nie mamy jeszcze inteligentnego edytora pipeline'u obliczen.

---

## 4. Skorygowana teza produktowa

Fullmag nie powinien byc projektowany jak zbior stron z zakladkami.

Fullmag powinien byc projektowany jako:

- jedna aplikacyjna powloka,
- z launcherem na wejsciu,
- z jednym workspace'em symulacji,
- z duzym viewportem w centrum,
- z dockami,
- z outlinerem / tree explorer po lewej,
- z panelem wlasciwosci po prawej,
- z dolnym obszarem jobs / messages / charts / logs,
- z wyraznym rozdzialem authoring -> live study -> analyze.

Najwazniejsze pytanie projektowe nie brzmi:

> "ile zakladek jeszcze dodac?"

Tylko:

> "czy uzytkownik rozumie, czy teraz buduje model, obserwuje zywa symulacje, czy analizuje wyniki?"

I jeszcze jedno pytanie pomocnicze, ktore bardzo dobrze widac na screenach z COMSOL-a:

> "czy uzytkownik rozumie, co jest struktura modelu, co jest akcja, co jest ustawieniem, a co jest widokiem?"

Wlasnie to rozroznienie COMSOL robi bardzo dobrze.

---

## 5. Start Hub

### 5.1. Pozycja w architekturze

Start Hub nie jest czwartym stage symulacji.

To jest ekran wejsciowy aplikacji, widoczny tylko wtedy, gdy:

- nie podano pliku startowego,
- nie ma aktywnej symulacji do wznowienia,
- uzytkownik swiadomie wraca do launchera.

### 5.2. Zawartosc Start Hub

Rekomendowany uklad:

#### A. Recent Simulations

- ostatnio otwierane projekty,
- ostatnie skrypty `.py`,
- mini metadata: backend, data modyfikacji, lokalizacja.

#### B. Open

- `Open Simulation`,
- `Open Script`,
- `Browse Files`,
- `Open Example`.

#### C. Create New Simulation

Minimalny wizard:

- nazwa symulacji,
- lokalizacja zapisu,
- typ startu: empty / from template,
- opcjonalnie backend bazowy,
- opcjonalnie solver family / physics profile.

#### D. Examples / Templates

To jest bardzo wazne rozwojowo:

- przyklady typu nanoflower,
- przyklady relax / dynamics / eigenmodes,
- przyszle templates do szybkiego startu.

### 5.3. Zachowanie przy starcie z pliku

Jesli Fullmag startuje z konkretnego skryptu lub projektu:

- Start Hub jest pomijany,
- od razu laduje sie odpowiednia symulacja,
- aplikacja otwiera ostatni aktywny stage albo domyslnie `Model Builder`.

To jest zgodne z Twoja wizja i jednoczesnie bardzo ergonomiczne.

---

## 6. Docelowy model workspace symulacji

### 6.1. Najwazniejsza korekta wobec wczesniejszego raportu

W poprzedniej wersji zasugerowalem `Build / Mesh / Study / Results`.

Po Twoim doprecyzowaniu to wymaga korekty.

Lepszy model to:

- `Model Builder`
- `Study`
- `Analyze`

### 6.2. Dlaczego to jest lepsze

Bo lepiej odpowiada realnej pracy:

- najpierw tworzymy model i konfigurujemy symulacje,
- potem pracujemy na zywo z runem i podgladem,
- potem przechodzimy do bardziej specjalistycznej analizy.

To jest blizsze:

- COMSOL-owemu podzialowi pracy,
- MuMax-owemu rytmowi pracy na runtime,
- i temu, co sam opisales jako naturalny workflow Fullmag.

### 6.3. Co z `Mesh`

`Mesh` nie powinien byc osobnym glownym stage.

Powinien byc **first-class subsystem**, ale osadzonym glownie w `Model Builder`, z mozliwoscia inspect w `Study`.

Powod:

- mesh jest czescia budowy modelu i przygotowania domeny,
- nie jest niezaleznym swiatem rownym `Study` i `Analyze`,
- osobny globalny stage `Mesh` tylko zwieksza chaos top-level navigation.

### 6.4. Co z `Runs`

`Runs` tez nie powinno byc glownym stage.

Powinno trafic do dolnego docka jako:

- `Jobs`,
- `Queue`,
- `Logs`,
- `History`.

Run jest zjawiskiem systemowym i wykonawczym, a nie odrebnym poziomem modelowania.

---

## 7. Docelowy uklad interfejsu

### 7.1. Application Bar

Cienki staly pasek aplikacyjny:

- nazwa aktywnej symulacji,
- File / Edit / View / Simulation / Tools / Help,
- stan polaczenia,
- backend / CPU / GPU,
- globalne `Run / Pause / Stop / Relax`.

To jest warstwa aplikacyjna, nie warstwa modelu.

### 7.2. Stage Bar

Jedyny glowny przełącznik w workspace:

- `Model Builder`
- `Study`
- `Analyze`

Po prawej moga byc akcje typu:

- `Jobs`,
- `Problems`,
- `Docs`,
- `Source`.

Ale to nie sa rownorzedne stage.

### 7.3. Context Ribbon

Tutaj potrzebna jest wazna korekta po obejrzeniu screenow z COMSOL-a.

Sam pomysl "nie miec drugiego konkurencyjnego globalnego stage switchera" nadal jest poprawny.

Ale COMSOL pokazuje cos bardzo cennego:

- mozna miec **jeden primary stage switcher**,
- a jednoczesnie miec **lokalne ribbon tabs** w obrebie aktywnego poziomu pracy.

Czyli:

- nie chcemy dwoch sprzecznych top-level navigation systems,
- ale chcemy miec ribbon z czytelnymi kategoriami akcji.

Dlatego dla Fullmag rekomendacja jest taka:

- `Model Builder / Study / Analyze` to jedyny glowny switcher pracy,
- a wewnatrz aktywnego stage mozna miec COMSOL-like ribbon categories.

Przyklady:

- w `Model Builder`: `Home`, `Geometry`, `Materials`, `Physics`, `Mesh`,
- w `Study`: `Home`, `Live View`, `Runtime`, `Charts`, `Diagnostics`,
- w `Analyze`: `Home`, `Spectrum`, `Modes`, `Dispersion`, `Export`.

Ribbon zmienia grupy akcji zalezne od aktywnego stage i aktywnej ribbon category:

- w `Model Builder`: Create, Modify, Transform, Materials, Physics, Mesh, Airbox, Sources,
- w `Study`: View, Quantities, Live Controls, Charts, Diagnostics, Capture,
- w `Analyze`: Spectrum, Modes, Dispersion, Compare, Export.

Najwazniejsza zasada:

> ribbon nie moze byc drugim globalnym stage switchem, ale moze byc lokalnym systemem kategorii akcji, dokladnie tak jak w COMSOL-u.

### 7.4. Main Dock Layout

Screeny COMSOL-a pokazuja bardzo dobra baze:

- lewa kolumna: `Model Builder`,
- srodkowa kolumna: `Settings`,
- prawa kolumna: `Graphics`,
- dolny utility dock: `Messages / Progress / Log`.

To jest bardzo mocny pattern i warto go przejac, ale nie wszedzie identycznie.

#### Baseline shell dla Fullmag

- lewa kolumna: `Simulation Explorer / Model Tree`,
- srodkowa kolumna: `Settings / Inspector`,
- prawa kolumna: `Graphics / Viewports`,
- dolny dock: `Messages / Progress / Jobs / Charts / Log`.

#### Najwazniejsza adaptacja

W `Model Builder` ten uklad moze byc bardzo bliski COMSOL-owi:

- tree po lewej,
- settings w srodku,
- graphics po prawej.

Ale w `Study` i `Analyze` nie powinnismy kopiowac COMSOL-a 1:1.

Tam lepszy bedzie uklad bardziej viewport-first:

- lewy explorer wezszy,
- graphics centralnie i szerzej,
- settings / diagnostics jako dock boczny lub dolny,
- charts i logi w docku dolnym.

To jest jedna z najwazniejszych korekt wzgledem prostego "skopiujmy COMSOL".

### 7.5. Ergonomia paneli

Nie trzymamy juz dwoch rownorzednych szerokich paneli po lewej stronie.

Lepiej:

- lewo = struktura,
- srodek albo srodek-lewo = wlasciwosci,
- prawo albo centrum = viewport,
- dol = runtime i historia.

Najwazniejsze jest nie sztywne przyklejenie jednej kolumny do jednej roli, tylko utrzymanie czytelnej semantyki:

- tree = struktura,
- settings = wlasciwosci,
- graphics = widok,
- dolny dock = operacje i historia.

To wlasnie jest najmocniejsza lekcja ze screenow COMSOL-a.

---

## 8. Jak powinny dzialac poziomy pracy

### 8.1. `Model Builder`

To jest glowny obszar authoringu.

Powinien obejmowac:

- geometrie,
- transformy,
- hierarchie obiektow,
- regiony i selekcje,
- materialy,
- oddzialywania i przypisania fizyki,
- anteny / sources,
- mesh defaults,
- airbox,
- domain frame,
- konfiguracje tego, z czego finalnie powstaje skrypt symulacji.

To jest odpowiednik:

- COMSOL `Model Builder`,
- plus 3ds Max-like workflow dla geometrii i sceny.

Wlasnie tutaj najwiecej warto skopiowac z COMSOL-a:

- stale lewy `Model Builder`,
- selekcja w tree steruje `Settings`,
- ribbon zmienia dostepne akcje zaleznie od domeny,
- `Graphics` jest stale dostepne obok.

### 8.2. `Study`

To nie jest tylko formularz solvera.

To powinien byc **live simulation workspace**.

Powinien obejmowac:

- uruchamianie i kontrolowanie runu,
- zywy viewport,
- przelaczanie magnetyzacji, demag, H_eff i innych wielkosci,
- 2D / 3D / slice / clip,
- podglad parametrow symulacji na zywo,
- telemetrie solvera,
- wykresy energii,
- charts,
- jobs i logi,
- podstawowe runtime diagnostics.

W tym trybie uzytkownik ma czuc:

> "symulacja zyje i moge ja obserwowac oraz kontrolowac".

Tu z kolei nie powinnismy kopiowac COMSOL-a zbyt doslownie.

COMSOL jest mocny w setupie i klasycznym CAE flow, ale Fullmag potrzebuje mocniej wyeksponowanego zywego runtime:

- wiekszego znaczenia viewportu,
- latwiejszego przelaczania quantities,
- bardziej oczywistych wykresow i telemetry,
- lepszego sprzezenia z solverem na zywo.

### 8.3. `Analyze`

To jest osobny obszar bardziej zaawansowanej analizy.

Powinien obejmowac:

- spectrum,
- eigen solve,
- eigenmodes,
- dispersion,
- przyszle moduly analityczne.

To powinien byc stage rozwojowy, ale juz teraz jawnie odseparowany od `Study`.

Powod:

- analiza spektrum i eigenproblem to nie jest zwykly live preview,
- to ma inny model pracy, inne UI i inne artefakty.

### 8.4. Korekta terminologiczna

Po Twoich uwagach lepiej zachowac nazwe `Analyze`, zamiast na sile zastępowac ja `Results`.

Powod:

- `Analyze` lepiej oddaje charakter modulu,
- obejmuje rzeczy szersze niz zwykly podglad wynikow,
- pasuje do rozbudowy o spectrum i eigen solve.

Jednoczesnie w srodku `Study` dalej mozna miec klasyczne `Results Views` i live quantities.

### 8.5. Wazne rozroznienie: `Study` stage vs `Study Setup` model danych

To jest bardzo wazna korekta semantyczna.

W aplikacji powinny istniec jednoczesnie dwie rzeczy:

- `Study` jako **poziom pracy uzytkownika**, czyli live workspace symulacji,
- `Study Setup` jako **sekcja modelu symulacji**, gdzie definiujemy relaxation, dynamics, eigenmodes, sweeps i solver settings.

To nie jest sprzecznosc.

To jest potrzebne rozroznienie:

- stage odpowiada pytaniu "co teraz robie?",
- model danych odpowiada pytaniu "z czego sklada sie ta symulacja?".

Bez tego znowu bardzo latwo wymieszac authoring, runtime i analyze.

### 8.6. `Study Builder` jako edytor pipeline'u obliczen

To powinno byc zaprojektowane jako osobny, bardzo wazny subsystem wewnatrz `Model Builder`.

`Study Builder` nie moze byc tylko lista formularzy.

Powinien byc:

- edytorem sekwencji obliczen,
- autorem pipeline'u stage'ow,
- miejscem, gdzie uzytkownik planuje kolejne kroki solvera,
- oraz warstwa posrednia miedzy wygodnym GUI a bardziej surowym backendowym modelem stage'ow.

### 8.7. Docelowy uklad `Study Builder`

Najlepszy uklad jest bardzo zbieżny z logika COMSOL-a:

- lewo: `Study Setup Tree`,
- srodek: `Stage Sequence / Pipeline Canvas`,
- prawo: `Stage Inspector`,
- gora: `Stage Builder Ribbon`.

#### A. Study Setup Tree

W drzewie modelu powinien istniec czytelny obszar:

```text
Study Setup
├── Stage Builder
├── Stage 1: Relax
├── Stage 2: Field Sweep + Relax
├── Stage 3: Run
└── Stage 4: Eigenmodes
```

Drzewo ma byc:

- nawigacja,
- streszczeniem pipeline'u,
- i miejscem szybkiej selekcji stage'a lub grupy stage'ow.

#### B. Pipeline Canvas

To jest glowna powierzchnia `Study Buildera`.

Nie musi byc pelnym node-edytorem.

W pierwszej wersji wystarczy inteligentna lista / timeline kart, ale musi wspierac:

- dodawanie stage'ow,
- insert before / after,
- usuwanie,
- duplikacje,
- grupowanie,
- reorder drag-and-drop,
- collapse / expand dla stage group.

#### C. Stage Inspector

Prawy panel pokazuje:

- parametry zaznaczonego stage'a,
- jego wejscie i wyjscie,
- zaleznosci,
- summary,
- oraz walidacje.

To jest znacznie lepsze niz wciskanie wszystkiego do jednej dlugiej listy.

#### D. Stage Builder Ribbon

To jest dokladnie to, o co prosisz i co ma sens produktowo.

Ribbon powinien miec grupy typu:

- `Add Stage`
- `Sweep`
- `Composite`
- `State`
- `Validate`
- `Templates`

Przyklady akcji z ribbonu:

- `Add Relax`
- `Add Run`
- `Add Eigenmodes`
- `Add Set Field`
- `Add Set Current`
- `Add Save State`
- `Add Load State`
- `Add Export`
- `Field Sweep + Relax`
- `Parameter Sweep`
- `Hysteresis Loop`
- `Relax -> Run`
- `Relax -> Eigenmodes`

### 8.8. Dwa poziomy modelu: primitive stages i macro stages

To powinno byc zaprojektowane inteligentnie, czyli nie tylko jako plaska tablica stage'ow.

#### Primitive stages

To sa etapy niskiego poziomu, ktore backend moze wykonac bezposrednio albo prawie bezposrednio:

- `relax`
- `run`
- `eigenmodes`
- `set_field`
- `set_current`
- `load_state`
- `save_state`
- `export`

#### Macro / composite stages

To sa etapy wygodne dla uzytkownika, ale logicznie skladajace sie z kilku primitive stages:

- `Field Sweep + Relax`
- `Field Sweep + Relax + Snapshot`
- `Hysteresis Loop`
- `Relax -> Run`
- `Relax -> Eigenmodes`
- `Parameter Sweep`

Najwazniejsza zasada:

> GUI powinno pozwalac budowac makra stage'ow, a backend powinien dostawac zmaterializowany pipeline primitive stages.

To jest wlasnie inteligentna warstwa posrednia, ktorej teraz brakuje.

### 8.9. Jak powinien dzialac `Field Sweep + Relax`

To jest bardzo dobry przyklad, bo idealnie pokazuje potrzebe `Study Buildera`.

Uzytkownik nie chce recznie budowac np. dwudziestu stage'ow:

- ustaw pole,
- relax,
- ustaw kolejne pole,
- relax,
- itd.

Uzytkownik chce powiedziec:

> "zrob sweep pola od A do B w N krokach i po kazdym kroku wykonaj relaxacje"

W `Study Builderze` powinno to wygladac jak jeden logiczny stage group:

```text
Stage Group: Field Sweep + Relax
- field component: Hz
- start: -100 mT
- stop: 100 mT
- steps: 21
- spacing: linear
- relax after each step: yes
- save state after each step: optional
- collect observables: optional
```

Aplikacja wewnetrznie materializuje to do backendowego pipeline'u.

W UI mozna to pokazywac:

- zwinięte jako jedna grupa,
- albo rozwiniete do wszystkich krokow podrzednych.

### 8.10. Inteligentne zachowania `Study Buildera`

To jest najwazniejsza czesc projektu.

`Study Builder` powinien byc nie tylko edytorem, ale tez asystentem poprawnej sekwencji.

#### A. Smart suggestions

Przyklady:

- jesli uzytkownik doda `Eigenmodes` bez wczesniejszego stanu rownowagi, GUI sugeruje `Insert Relax Before`.
- jesli uzytkownik doda `Run`, GUI pyta czy ma uzyc stanu z poprzedniego `Relax`.
- jesli uzytkownik dodaje `Field Sweep`, GUI proponuje gotowe makro `Field Sweep + Relax`.

#### B. Stage summaries

Kazdy stage albo stage group powinien miec automatycznie generowane summary, np.:

- `Relax · tol 1e-6 · max 5000 steps`
- `Run · until 5 ns`
- `Field sweep Hz -100 mT -> 100 mT · 21 steps · relax each`
- `Eigenmodes · 12 modes · nearest 8 GHz`

#### C. Validation

Builder powinien wykrywac:

- brak stage'a przygotowujacego stan poczatkowy,
- niespojny porzadek stage'ow,
- brak wymaganych parametrow,
- stage'e nieobslugiwane przez wybrany backend,
- konflikt miedzy solver mode a typem analizy.

#### D. Dynamic execution mapping

Podczas wykonywania pipeline'u UI powinno dynamicznie aktualizowac:

- aktywny stage,
- aktywna podfaze stage group,
- procent postepu,
- stan: pending / running / done / failed / skipped,
- artefakty wyprodukowane przez stage.

#### E. Reuse i templates

Uzytkownik powinien moc zapisac i wstawic gotowe sekwencje:

- `Ground State`
- `Ground State + Dynamic Run`
- `Field Sweep + Relax`
- `Relax + Eigenmodes`
- `Parameter Sweep Base`

### 8.11. Relacja miedzy `Study Builder` a live `Study`

To tez trzeba zaprojektowac jasno.

`Study Builder` zyje glownie w `Model Builder`, bo tam projektujemy pipeline.

`Study` jako live workspace:

- wykonuje ten pipeline,
- pokazuje jego aktualny stan,
- pozwala zatrzymac / wznowic wykonanie,
- ale nie powinien byc glownym miejscem do skladania zlozonych sekwencji.

Czyli:

- `Model Builder` = authoring stage pipeline,
- `Study` = wykonanie i obserwacja stage pipeline'u.

To jest bardzo czysty i rozwojowy podzial.

---

## 9. Struktura danych i root modelu

### 9.1. Root nie moze nazywac sie `Study`

To nadal jest bledne semantycznie.

Root powinien reprezentowac cala symulacje, np.:

- `Simulation`,
- `Project`,
- albo po prostu nazwe aktywnego modelu.

### 9.2. Proponowana struktura tree

```text
Simulation
├── Geometry
│   ├── Universe / Domain Frame
│   ├── Objects
│   ├── Regions
│   └── Transforms / Groups
├── Materials
├── Physics
│   ├── Magnetization
│   ├── Demag
│   ├── Exchange
│   ├── Sources / Antennas
│   └── Boundary Conditions
├── Mesh & Domain
│   ├── Global Mesh
│   ├── Airbox
│   ├── Local Overrides
│   ├── Quality
│   └── Pipeline
├── Study Setup
│   ├── Relaxation
│   ├── Dynamics
│   ├── Eigenmodes
│   └── Sweeps
├── Live Views
│   ├── Magnetization
│   ├── Fields
│   ├── Energy Charts
│   └── Logs / Jobs
└── Analyze
    ├── Spectrum
    ├── Modes
    ├── Dispersion
    └── Export
```

Najwazniejsze:

- `Study` staje sie jedna z sekcji,
- `Mesh` jest jawny, ale nie jest top-level global stage,
- `Analyze` ma wlasny obszar domenowy.

---

## 10. Frontend vs backend: luka funkcjonalna

To jest sekcja, ktorej wczesniejszy raport nie wyeksponowal wystarczajaco mocno.

### 10.1. Problem glowny

Frontend jest dzisiaj opozniony wzgledem solvera i backendu.

Przez to:

- czesc zaimplementowanych funkcji nie jest dobrze wystawiona w GUI,
- uzytkownik nie ma dostepu do wszystkich realnych parametrow,
- nazwy i semantyka paneli nie odpowiadaja temu, jak dziala solver,
- niektore widoki i ustawienia sa pomieszane.

### 10.2. Przyklady obszarow krytycznych

- modele demag,
- airbox,
- domain frame,
- mesh authoring vs mesh inspect,
- solver parameters,
- boundary i physics options,
- live diagnostics vs authoring settings.

### 10.3. Co trzeba zrobic architektonicznie

Potrzebny jest **frontend-backend capability contract**.

Minimalny zestaw:

1. Jedna jawna lista wspieranych parametrow backendu.
2. Mapowanie: backend capability -> UI panel -> state model -> script serialization.
3. Audyt brakujacych opcji w GUI.
4. Rozdzielenie:
   - authoring settings,
   - runtime controls,
   - analyze settings.
5. Testy pokrycia:
   - czy kazda kluczowa opcja backendu ma miejsce w UI,
   - czy UI niczego nie udaje lub nie ukrywa pod zla nazwa.
6. Warstwa materializacji:
   - `Study Builder` high-level macros -> backend primitive stages.

To jest kluczowe, bo bez tego nigdy nie zrobimy wygodnego GUI dla bardziej zlozonych sekwencji typu `Field Sweep + Relax`.

### 10.4. Wniosek

Nie wystarczy poprawic wyglad.

Trzeba sprawic, zeby frontend stal sie wierna reprezentacja realnej mocy solvera.

---

## 11. Viewport i widoki

### 11.1. Jedna glowna zasada

Viewport ma byc centrum aplikacji, a nie obszarem zdominowanym przez paski i statusy.

### 11.2. Podzial sterowania

Nad viewportem powinien zostac jeden lekki pasek kontekstowy:

- aktywna wielkosc,
- komponent,
- plane / slice,
- clip,
- visible domain,
- tryb widoku.

Bardziej rozbudowane sterowanie powinno trafic do:

- prawego inspectora,
- lokalnych overlay,
- albo dolnych dockow.

Screeny COMSOL-a dobrze pokazuja tez inna wazna rzecz:

- `Graphics` ma swoj lokalny toolbar,
- ale nie jest zalewane przez kilka konkurencyjnych paskow nawigacji.

To jest dobry wzorzec dla Fullmag:

- jeden app-level bar,
- jeden stage bar,
- jeden ribbon,
- jeden lokalny graphics toolbar,
- bez dalszego mnozenia kolejnych warstw.

### 11.3. Widoki w `Model Builder`

Powinny wspierac:

- perspective,
- top / front / left,
- quad layout w przyszlosci,
- selection,
- isolate,
- snap / grid / pivot.

### 11.4. Widoki w `Study`

Powinny wspierac:

- live 3D fields,
- 2D slices,
- quantity switching,
- podglad runtime,
- charts obok viewportu lub w dolnym docku.

### 11.5. Widoki w `Analyze`

Powinny wspierac:

- spectrum plots,
- mode explorer,
- dispersion views,
- compare views,
- eksport figurek i danych.

---

## 12. Kierunek wizualny

Fullmag powinien wygladac jak:

- precyzyjne narzedzie naukowe,
- desktopowy scientific workspace,
- nie jak SaaS dashboard,
- nie jak zbior kart i badge'y.

Zasady:

- viewport dominuje,
- panele sa dokami, nie ozdobnymi kartami,
- kolor akcentu oznacza aktywny stage albo stan,
- statusy runtime sa czytelne, ale nie zalewaja UI,
- mniej szkla i ozdob, wiecej porzadku i hierarchii.

W skrocie:

- COMSOL-like porzadek,
- 3ds Max-like authoring geometrii,
- MuMax-like czytelnosc live runtime.

### 12.1. Czego nie kopiowac z COMSOL-a 1:1

To tez warto zapisac jawnie.

Nie kopiujemy bezrefleksyjnie:

- starej, bardzo gestej estetyki desktopowej,
- kazdego przycisku ribbonu 1:1,
- wszystkich nazw kart i modulow,
- technologicznego "przeladowania" top bara,
- oraz historycznych elementow UI wynikajacych z wieku COMSOL-a.

Kopiujemy:

- semantyke ukladu,
- rozdzial odpowiedzialnosci paneli,
- logike `tree -> settings -> graphics`,
- ribbon jako warstwe akcji,
- i utility dock na komunikaty / progress / log.

---

## 13. Gotowosc pod Electron

Jesli aplikacja ma pozniej dobrze dzialac jako desktop:

1. Start Hub musi byc niezalezny od routingu stron.
2. Workspace symulacji musi byc jedna powloka z dockami.
3. Menu i file actions musza miec abstrakcje desktop-friendly.
4. `Open Script`, `Open Simulation` i `New Simulation` musza prowadzic do tego samego modelu workspace.
5. Jobs, viewporty, inspectory i charts nie moga byc przypadkowym zlepkiem page-level hackow.

---

## 14. Rekomendowany plan korekty frontendu

### Etap 1: uporzadkowac wejscie do aplikacji

1. Dodac `Start Hub` dla uruchomienia bez pliku.
2. Dodac sciezke `Open Simulation / Open Script / New Simulation`.
3. Przy starcie z pliku od razu otwierac konkretna symulacje.

### Etap 2: uproscic top-level navigation

1. Usunac dublowanie miedzy `TopHeader` i `RibbonBar`.
2. Zostawic jeden stage switcher:
   - `Model Builder`
   - `Study`
   - `Analyze`
3. Wyjac `Runs` do dolnego docka.
4. Wyjac `Mesh` z top-level stage i wpiac go do `Model Builder` jako subsystem.

### Etap 3: naprawic semantyke projektu

1. Zmienic root drzewa z `Study` na `Simulation` lub nazwe modelu.
2. Przebudowac tree tak, by odpowiadal realnym domenom pracy.
3. Oddzielic authoring, live study i analyze.

### Etap 4: rozdzielic panele

1. Prawy inspector pokazuje tylko to, co dotyczy selekcji lub aktywnego contextu.
2. `Telemetry`, `Energy`, `Jobs`, `Log`, `Charts` ida do osobnych dockow.
3. `Airbox`, `Demag`, `Mesh`, `Boundary`, `Source` dostaja czytelne panele o poprawnej semantyce.

### Etap 5: zbudowac prawdziwy `Study Builder`

1. Dodac `Stage Builder Ribbon`.
2. Dodac `Stage Sequence / Pipeline Canvas`.
3. Dodac dodawanie, usuwanie, reorder i grupowanie stage'ow.
4. Dodac macro stages:
   - `Field Sweep + Relax`
   - `Relax -> Run`
   - `Relax -> Eigenmodes`
   - `Parameter Sweep`
5. Dodac materializacje macro stages do backendowego pipeline'u.
6. Dodac validation i smart suggestions.

### Etap 6: domknac luke frontend-backend

1. Zrobic capability audit backendu.
2. Rozpisac brakujace opcje GUI.
3. Dolozyc brakujace panele i parametry.
4. Upewnic sie, ze UI odzwierciedla realne mozliwosci solvera.

---

## 15. Minimalna definicja sukcesu

Po pierwszej duzej przebudowie uzytkownik powinien widziec:

- Start Hub przy uruchomieniu bez pliku,
- automatyczne wejscie do symulacji przy starcie z pliku,
- jeden jasny stage switcher `Model Builder / Study / Analyze`,
- brak pozornych zakladek prowadzacych do tego samego miejsca,
- root symulacji zamiast rootu `Study`,
- czysty inspector zależny od selekcji,
- jobs / logs / energy / charts jako osobne docki,
- prawdziwy `Study Builder` z dodawaniem i kolejkowaniem stage'ow,
- macro stages typu `Field Sweep + Relax`,
- dynamicznie aktualizowany pipeline wykonania,
- lepsze pokrycie backendowych opcji w GUI.

To bedzie juz nie tylko poprawa estetyki, ale realne uporzadkowanie modelu produktu.

---

## 16. Decyzja koncowa

Najwazniejsza decyzja po korekcie brzmi:

> Fullmag powinien miec ekran startowy podobny do COMSOL tylko wtedy, gdy nie podano pliku wejsciowego, a po otwarciu symulacji powinien przechodzic do jednego spójnego workspace'u z trzema glownymi poziomami pracy: `Model Builder`, `Study` i `Analyze`.

Dodatkowo:

- `Mesh` pozostaje kluczowym subsystemem, ale nie glownym stage,
- `Runs` trafia do jobs / logs,
- `Study Builder` staje sie autorem pipeline'u stage'ow i makr obliczeniowych,
- frontend musi zostac doscigniety do realnych mozliwosci backendu,
- COMSOL, 3ds Max i MuMax powinny sluzyc jako trzy rozne wzorce dla trzech roznych warstw produktu, a nie jako jeden sklejony styl.

To jest obecnie najbardziej rozwojowy i najbardziej logiczny kierunek dla Fullmag.
