
# Fullmag — bardzo szczegółowy raport o najlepszych modelach symulacji vorteksów w STNO pobudzanych prądem oraz o rozszerzeniu modułu prądowego

**Data audytu:** 2026-03-30  
**Repozytorium:** `MateuszZelent/fullmag`  
**Format:** raport projektowo-fizyczny + plan architektoniczny + roadmapa implementacyjna  
**Cel:** zaprojektować realistyczne rozszerzenie Fullmaga tak, aby możliwie dobrze liczył prądowo wzbudzane oscylatory vortex STNO, a docelowo zbliżył się funkcjonalnie do klasy narzędzi potrafiących modelować także **dynamiczny polaryzator**.

---

## 1. Streszczenie wykonawcze

Najważniejszy wniosek jest prosty:

> **najlepszym “modelem” dla vortex STNO nie jest jeden model, tylko hierarchia modeli** — od szybkiego modelu zredukowanego (nieliniowe równanie Thiele’a), przez pełny mikromagnetyzm jednej warstwy swobodnej z Oerstedem/STT/termiką, aż po **pełny mikromagnetyzm wielowarstwowy z dynamicznym polaryzatorem i sprzężeniem elektrycznym**.

Dla Fullmaga oznacza to, że najlepsza droga nie polega na wrzuceniu jednego kolejnego termu do LLG, tylko na zbudowaniu **całej rodziny modułów “current-driven magnetodynamics”**:

1. **Current source / waveform / current path**
2. **Oersted field**
3. **Spin-transfer torque (Zhang–Li + Slonczewski + field-like)**
4. **Spin–orbit torque**
5. **Thermal noise / electro-thermal effects**
6. **Dynamic polarizer**
7. **Electrical readout / magnetoresistance / circuit feedback**
8. **STNO observables i analityka sygnałowa**
9. **Synchronizacja i sprzężenie wielu oscylatorów**

Najbardziej opłacalny plan dla Fullmaga jest następujący:

- **etap 1:** usankcjonować i publicznie wystawić to, co w repo już częściowo istnieje jako “latent scaffolding” — tj. Oersted, część STT, temperaturę, lepsze integratory;
- **etap 2:** zrobić **public-executable FDM vortex STNO** dla jednej warstwy swobodnej z:
  - `Demag + Exchange + Zeeman + Oersted + Slonczewski STT + thermal noise`,
  - plus wyjścia typu `core_position`, `frequency`, `orbit_radius`, `PSD`, `linewidth`;
- **etap 3:** dodać **dynamic polarizer** najpierw jako model uproszczony (`fixed p` → `macrospin p(t)` → `texture p(r,t)`), a potem jako **drugi dynamiczny magnes w tym samym solverze**;
- **etap 4:** dodać **sprzężenie elektryczne**, bo STNO to nie tylko pole i magnetyzacja, ale także sygnał wyjściowy, modulacja prądu, TMR/GMR, phase locking, injection locking, linewidth i chaos.

Jeżeli celem jest **fizyka zbliżona do FASTMAG-like high-end workflow**, to kluczowym brakującym elementem nie jest “jeszcze jeden term”, tylko właśnie:

- **dynamiczny polaryzator**,
- **lokalna polaryzacja zależna od czasu i położenia**,
- **prąd/pole Oersteda zgodne z geometrią stosu**,
- **termika + modulacja sygnału + sprzężenie z obwodem**.

---

## 2. Co Fullmag ma dzisiaj, a co warto uznać za realny punkt startowy

### 2.1. Co repo deklaruje publicznie

Po audycie aktualnego publicznego repo widać, że Fullmag jest budowany jako platforma oparta o wspólny opis **problemu fizycznego**, a nie o “mesh-first API”. Repo zawiera już główne komponenty architektury: Python DSL, `ProblemIR`, planner, CLI, API, web UI oraz natywne backendy FDM/FEM za C ABI. W README repo jest też jasno napisane, że obowiązuje reguła: przed wdrożeniem nowej fizyki trzeba dopisać publication-style note w `docs/physics/`. Jednocześnie README nadal bardzo uczciwie opisuje publiczny “honest executable slice” jako: `Box + Exchange + Demag + Zeeman + TimeEvolution(LLG-Heun) + FDM`, z CPU reference w `double`, CUDA FDM w `double`, a `single` na CUDA istnieje, lecz nie jest jeszcze publicznie zakwalifikowane. citeturn384923view0turn908326view0

### 2.2. Co repo ma w dokumentacji fizycznej

Katalog `docs/physics/` jest już bardzo bogaty: są tam noty dla FDM/FEM, demag, multilayer convolution demag, interfacial i bulk DMI, wyższych integratorów adaptacyjnych, relaksacji, sub-cell boundary correction i FEM eigenmodes. README w tym katalogu mówi też wprost, że każda nowa fizyka ma być opisana przez równania, jednostki SI, założenia, wpływ na Python API i `ProblemIR`, planner/capability matrix, strategię walidacji i deferred work. To bardzo dobry fundament pod moduł STNO, bo pozwala utrzymać spójność architektury. citeturn908326view1turn300856view0

### 2.3. Co widać po strukturze Python DSL

Część Pythonowa repo ma już wyraźny podział na `discretization.py`, `dynamics.py`, `energy.py`, `geometry.py`, `outputs.py`, `problem.py`, `structure.py`, `study.py`. Czyli Fullmag ma już miejsce architektoniczne, gdzie da się wpiąć nowy moduł prądowy bez psucia całego DSL. citeturn384923view2

### 2.4. Co widać po audycie kodu, a nie tylko po README

Po wejściu w kod widać ważną rzecz: **repo jest dalej merytorycznie dalej niż to, co deklaruje README**.

W szczególności:

- w Python `energy.py` istnieje już `OerstedCylinder` wraz z envelope’ami czasowymi (`Constant`, `Sinusoidal`, `Pulse`);
- w `dynamics.py` istnieją już integratory `Heun`, `RK4`, `RK23`, `RK45`, `ABM3`, a nie tylko Heun;
- w `ProblemIR` i planach FDM/FEM istnieją już pola na:
  - `current_density`,
  - `stt_degree`,
  - `stt_beta`,
  - `stt_spin_polarization`,
  - `stt_lambda`,
  - `stt_epsilon_prime`,
  - `temperature`,
  - parametry `OerstedCylinder`;
- nagłówek C ABI dla natywnego FDM backendu przewiduje już:
  - temperaturę,
  - Zhang–Li STT,
  - Slonczewski STT,
  - Oersted cylinder,
  - anisotropię i DMI.

Natomiast po stronie CPU reference runnera widać, że realnie konsumowane są na pewno:
- exchange,
- demag,
- external field,
- temperatura,

a **STT i Oersted nie są tam jeszcze pełnoprawnie używane**. Z kolei wrapper CUDA przekazuje te parametry do natywnego plan descriptor, więc droga wykonawcza jest już częściowo przygotowana, ale nie jest jeszcze publicznie opisana jako w pełni domknięta i zwalidowana.

### 2.5. Najważniejszy wniosek z audytu Fullmaga

Dla tego projektu najrozsądniejsza strategia nie brzmi:

> “napiszmy od zera moduł prądowy”

tylko:

> **“zorganizujmy i doprowadźmy do pełnej fizycznej spójności to, co już częściowo istnieje, a następnie dobudujmy dynamiczny polaryzator i sprzężenie elektro-magnetyczne.”**

To jest znacznie lepsze inżyniersko, bo:
- pasuje do obecnego `ProblemIR`,
- pasuje do obecnego stylu `docs/physics`,
- skraca czas do pierwszego “real vortex STNO executable path”,
- nie robi z Fullmaga drugiego, rozrastającego się “god object”.

---

## 3. Jakie są najlepsze modele fizyczne do symulacji vortex STNO?

To pytanie trzeba rozbić na **“najlepszy dla czego?”**.

Bo inny model jest najlepszy do:
- szybkich sweepów parametrów,
- szacowania progu autooscylacji,
- reprodukcji częstotliwości i promienia orbity,
- linewidth / PSD / chaos,
- core reversal,
- synchronizacji,
- i wreszcie do dynamicznego polaryzatora.

### 3.1. Poziom 0 — model makrospinowy

**Opis:** jedna magnetyzacja dla całej warstwy.  
**Zalety:** bardzo szybki.  
**Wady:** dla vortex STNO z reguły **za słaby fizycznie**.

Dlaczego?
- vortex jest teksturą przestrzenną,
- ma rdzeń, chiralność, polaryzację rdzenia,
- ma mod gyrotropowy i inne mody wewnętrzne,
- ma silną rolę magnetostatyki i geometrii.

**Wniosek:** makrospin nie powinien być modelem docelowym dla vortex STNO; co najwyżej pomocniczym baseline’em lub modelem polaryzatora uproszczonego.

### 3.2. Poziom 1 — liniowe równanie Thiele’a / rigid-vortex model

To pierwszy sensowny model redukowany. Sprowadza dynamikę vorteksu do ruchu jego rdzenia:

\[
\mathbf{G}\times \dot{\mathbf{X}} + \mathbf{D}\dot{\mathbf{X}} + \nabla_{\mathbf{X}} U(\mathbf{X}) = \mathbf{F}_{\mathrm{drive}}
\]

gdzie:
- \(\mathbf{X}(t)\) — pozycja rdzenia vorteksu,
- \(\mathbf{G}\) — gyrovector,
- \(\mathbf{D}\) — tensor tłumienia,
- \(U(\mathbf{X})\) — potencjał przywracający,
- \(\mathbf{F}_{\mathrm{drive}}\) — wymuszenie od STT/Oersteda/pola.

**Zalety:**
- bardzo szybki,
- dobry do intuicji,
- dobry do sweepów i do wstępnego dopasowania współczynników.

**Wady:**
- klasyczny Thiele bywa ilościowo i jakościowo niewystarczający;
- nie opisuje dobrze deformacji tekstury, core reversal i wyższych modów;
- nie jest samowystarczalny bez kalibracji z mikromagnetyki.

To jest zgodne z literaturą: klasyczne podejście Thiele’a nie zawsze daje poprawny opis nawet dla małych amplitud i trzeba poprawnie traktować funkcję dysypacji oraz nieliniowość potencjału. citeturn365459search2turn365459search5

### 3.3. Poziom 2 — nieliniowe / ulepszone równanie Thiele’a

To jest **najlepszy model szybki**, jeżeli ma być nadal fizycznie sensowny.

Zwykle ma postać:

\[
-\mathbf{G}\times \dot{\mathbf{X}}
- \mathbf{D}(1+\xi s^2)\dot{\mathbf{X}}
- \kappa(1+\zeta s^2)\mathbf{X}
+ \mathbf{F}_{\mathrm{STT}}
+ \mathbf{F}_{\mathrm{Oe}}
+ \mathbf{F}_{\mathrm{ext}}
+ \mathbf{F}_{\mathrm{pin}}
+ \mathbf{F}_{\mathrm{th}} = 0
\]

gdzie:
- \(s = |\mathbf{X}|/R\),
- \(\xi\) opisuje nieliniową dysypację,
- \(\zeta\) opisuje nieliniową sztywność potencjału,
- dochodzą poprawki od pola Oersteda i innych nieliniowości.

To jest dokładnie poziom modelu, który warto mieć w Fullmagu jako **moduł reduced-order STNO**:
- tani obliczeniowo,
- świetny do map parametrów,
- świetny do dopasowania do pełnej mikromagnetyki,
- świetny do synchronizacji wielu oscylatorów, reservoir computing, chaosu, injection locking.

Współczesna literatura pokazuje, że analiza vortex STO bardzo często opiera się właśnie na nieliniowej wersji Thiele’a, oraz że pole Ampère’a–Oersteda wymaga osobnego traktowania i poprawia/rozszczepia dynamikę. citeturn365459search1turn365459search5turn365459search7

### 3.4. Poziom 3 — pełny mikromagnetyzm jednej warstwy swobodnej

To jest pierwszy poziom, który nazwałbym:

> **“publication-grade baseline”**

Równanie bazowe:

\[
\frac{\partial \mathbf{m}}{\partial t}
=
-\gamma \mu_0 \mathbf{m}\times \mathbf{H}_{\mathrm{eff}}
+
\alpha \mathbf{m}\times \frac{\partial \mathbf{m}}{\partial t}
+
\boldsymbol{\tau}_{\mathrm{current}}
+
\boldsymbol{\tau}_{\mathrm{thermal}}
\]

gdzie:

\[
\mathbf{H}_{\mathrm{eff}}
=
\mathbf{H}_{\mathrm{ex}}
+
\mathbf{H}_{\mathrm{demag}}
+
\mathbf{H}_{\mathrm{ani}}
+
\mathbf{H}_{\mathrm{DMI}}
+
\mathbf{H}_{\mathrm{ext}}
+
\mathbf{H}_{\mathrm{Oe}}
+
\mathbf{H}_{\mathrm{pin}}
+\cdots
\]

Ten poziom jest najlepszy, gdy chcesz:
- liczyć prawdziwą geometrię dysku/pillara,
- patrzeć na deformację tekstury,
- badać core reversal,
- mieć wiarygodny promień orbity,
- mieć mode hopping,
- mieć wpływ brzegu i efektów lokalnych,
- liczyć wyższe mody i coupling do nich.

To właśnie porównanie mikromagnetyki z modelami analitycznymi jest standardem w literaturze vortex STNO. citeturn929117search0turn365459search2turn365459search5

### 3.5. Poziom 4 — pełny mikromagnetyzm z dynamicznym polaryzatorem

To jest poziom, który najbardziej przypomina narzędzia “high-end” do STNO.

Zamiast traktować polaryzator jako stały wektor \(\mathbf{p}\), liczysz drugą warstwę magnetyczną, czyli:

- albo makrospin polaryzatora,
- albo teksturę magnetyczną polaryzatora,
- albo nawet drugi vortex / dwie wirujące warstwy.

Wtedy STT nie zależy od stałego \(\mathbf{p}\), lecz od pola/spinu zależnego od czasu i położenia:

\[
\boldsymbol{\tau}_{\mathrm{SL}}(\mathbf{r},t)
=
a_J(\mathbf{r},t)\,\eta\!\left(\mathbf{m}\cdot \mathbf{p}(\mathbf{r},t)\right)\,
\mathbf{m}\times\left(\mathbf{m}\times \mathbf{p}(\mathbf{r},t)\right)
\]

To jest krytyczne, gdy chcesz:
- liczyć realny stos wielowarstwowy,
- mieć wzajemny wpływ warstw,
- mieć frequency pulling / frequency splitting,
- liczyć wzajemne sprzężenie vortex–vortex,
- badać niestacjonarne tryby, chaos, bifurkacje,
- zbliżyć się do przypadków, gdzie “fixed polarizer” już nie wystarcza.

W literaturze widać, że dwa dynamiczne elementy magnetyczne i/lub dwa vorteksy dają nową klasę zjawisk: rozszczepienia częstotliwości, synchronizację, złożone tryby dynamiczne. citeturn194480search0turn194480search6turn701450search4

### 3.6. Poziom 5 — pełny model elektromagnetyczno-transportowy + mikromagnetyka + obwód

To jest docelowy “najprawdziwszy” model:

- rozkład prądu nie jest zadany ręcznie, tylko rozwiązany lub przynajmniej sensownie przybliżony;
- Oersted nie jest tylko analitycznym cylindrem, ale wynika z geometrii przewodzenia;
- momenty STT/SOT zależą od realnej drogi przepływu;
- temperatura i Joule heating wpływają na \(M_s\), \(A\), \(\alpha\), oporność;
- opór urządzenia zależy od stanu magnetycznego;
- prąd/pole może być modulowane przez obwód zewnętrzny i sygnał RF.

To jest model najdroższy, ale dla najbardziej realistycznych STNO to właśnie on jest docelowy.

---

## 4. Który model jest “najlepszy” dla Fullmaga?

Najuczciwiej: **nie jeden**.

### 4.1. Najlepszy model szybki

**Ulepszone nieliniowe równanie Thiele’a** kalibrowane na mikromagnetyce.

To powinno być w Fullmagu jako:
- `backend = reduced_order_stno`
- osobny solver bardzo szybki
- możliwość uczenia / dopasowania parametrów z runów FDM/FEM.

### 4.2. Najlepszy model bazowy do publikacji i walidacji

**Pełny FDM micromagnetics jednej warstwy swobodnej:**
- Exchange
- Demag
- External field
- Oersted
- Slonczewski STT
- opcjonalnie Zhang–Li
- thermal noise
- adaptacyjne integratory
- wyjścia STNO

To jest najlepszy następny publiczny milestone dla Fullmaga.

### 4.3. Najlepszy model high-end / FASTMAG-like target

**Pełny wielowarstwowy micromagnetics z dynamicznym polaryzatorem**, najlepiej z:
- dwoma dynamicznymi magnesami,
- polaryzacją lokalną \(\mathbf{p}(\mathbf{r},t)\),
- rozdziałem prądu pomiędzy warstwami i regionami,
- obwodem i magnetorezystancją.

To powinno być **głównym celem średniookresowym**.

---

## 5. Fizyka vortex STNO, którą Fullmag powinien liczyć

Ta sekcja zbiera rzeczy, które trzeba umieć policzyć, jeśli Fullmag ma być naprawdę dobry dla STNO.

---

## 5.1. Stan vorteksowy

Vortex w nanodisku jest opisany przez:
- **chiralność** \(c=\pm 1\) — kierunek zawijania magnetyzacji in-plane,
- **polaryzację rdzenia** \(p=\pm 1\) — znak \(m_z\) w rdzeniu,
- położenie rdzenia \(\mathbf{X}(t)\),
- promień orbity \(R_{\mathrm{orb}}\),
- fazę \(\phi(t)\),
- częstotliwość gyrotropową \(f\).

W praktyce solver powinien umieć:
- znaleźć vortex state w relaksacji,
- wykryć położenie rdzenia z dokładnością sub-cell,
- wykryć reversal rdzenia,
- liczyć przejścia pomiędzy orbitami i modami.

### 5.2. Pole efektywne

Minimalny zestaw:
- exchange,
- demag,
- zewnętrzne pole statyczne / dynamiczne,
- Oersted,
- ewentualnie anisotropia,
- ewentualnie DMI,
- ewentualnie pinning / disorder.

Dla vortex STNO szczególnie ważne są:
- **demag** — bo daje bazowy potencjał magnetostatyczny,
- **Oersted** — bo silnie zmienia orbitę, nieliniowość i częstość,
- **spin torque** — bo kompensuje tłumienie i napędza autooscylację.

### 5.3. Oersted field

To nie jest “drobny dodatek”. Dla vortex STNO pole Oersteda jest często elementem pierwszoplanowym.

Dla nieskończonego cylindra z prądem \(I\):

- wewnątrz przewodnika:
\[
H_\phi(r)=\frac{I\,r}{2\pi R^2}
\]

- na zewnątrz:
\[
H_\phi(r)=\frac{I}{2\pi r}
\]

To jest bardzo dobry baseline, ale dla “prawdziwszej fizyki” trzeba pójść dalej:

#### 5.3.1. Co dodać ponad obecny cylinder analityczny

1. **Skończona długość i skończona grubość stosu**  
   Obecny cylinder nieskończony jest dobrym startem, ale nie łapie końcówek, asymetrii stosu i warstw.

2. **Arbitralny przekrój przewodnika**  
   Nie każdy pillar jest idealnym cylindrem. Przydają się:
   - ellipse,
   - rounded rectangle,
   - mesh-derived conductor.

3. **Current crowding i nierównomierne \(J(\mathbf{r})\)**  
   W realnym MTJ/STNO prąd często nie jest jednorodny.

4. **Rozdział prądu na warstwy**  
   Inny prąd przez free layer, inny przez reference layer, inne przewodnictwa.

5. **Prąd zależny od czasu**  
   DC, AC, pulse train, arbitrary waveform, chirp, RF injection.

6. **Obliczanie Oersteda z rozkładu \(J(\mathbf{r})\)**  
   Długoterminowo:
   \[
   \nabla\times \mathbf{H} = \mathbf{J}
   \]
   z geometrią układu, a nie tylko z formuły dla cylindra.

#### 5.3.2. Rekomendacja implementacyjna

W Fullmagu Oersted powinien stać się osobnym podmodułem, nie tylko jednym energy termem:

- `AnalyticOerstedCylinder`
- `AnalyticOerstedEllipse`
- `BiotSavartCurrentMap`
- `ElectrostaticCurrentSolver -> OerstedFromJ`

---

## 5.4. Spin-transfer torque — Zhang–Li (CIP)

Gdy prąd płynie **w płaszczyźnie** tekstury, naturalny jest model Zhang–Li:

\[
\boldsymbol{\tau}_{\mathrm{ZL}}
=
-(\mathbf{u}\cdot\nabla)\mathbf{m}
+
\beta\,\mathbf{m}\times \left[(\mathbf{u}\cdot\nabla)\mathbf{m}\right]
\]

gdzie \(\mathbf{u}\) jest skuteczną prędkością dryfu spinowego proporcjonalną do gęstości prądu.

To jest ważne dla:
- nanostripek,
- domain walli,
- części geometrii lateralnych,
- ewentualnie vortex displacement w konfiguracjach CIP.

Dla klasycznych pillar-like vortex STNO zwykle ważniejszy jest **Slonczewski/CPP**, ale Zhang–Li warto mieć, bo:
- repo już ma na to pola,
- przydaje się dla innych prądowo napędzanych tekstur,
- daje spójny “current physics stack”.

### 5.4.1. Co trzeba dodać, by Zhang–Li był naprawdę dobry

- przestrzennie zmienne \(J(\mathbf{r})\),
- przestrzennie zmienne \(P(\mathbf{r})\) i \(\beta(\mathbf{r})\),
- prawidłowa dyskretyzacja pochodnej \((\mathbf{u}\cdot \nabla)\mathbf{m}\),
- solidny handling brzegu,
- spójność na maskach aktywnych i sub-cell boundary correction.

---

## 5.5. Spin-transfer torque — Slonczewski (CPP)

Dla prądu przez stos warstw (CPP) standardem jest torque Slonczewskiego:

\[
\boldsymbol{\tau}_{\mathrm{SL}}
=
\gamma a_J \,\eta(\mathbf{m}\cdot\mathbf{p})\,
\mathbf{m}\times(\mathbf{m}\times\mathbf{p})
\]

oraz często człon field-like:

\[
\boldsymbol{\tau}_{\mathrm{FL}}
=
\gamma b_J \,\eta'(\mathbf{m}\cdot\mathbf{p})\,
\mathbf{m}\times\mathbf{p}
\]

To jest **must-have** dla klasycznych STNO.

### 5.5.1. Minimalna wersja, którą Fullmag powinien mieć publicznie

- stały wektor polaryzacji \(\mathbf{p}\),
- amplituda zależna od \(J\),
- parametry \(\Lambda\), \(\epsilon'\),
- opcjonalny field-like term,
- kompatybilność z Oersted + temperaturą.

### 5.5.2. Lepsza wersja

- \(\mathbf{p}(\mathbf{r})\) lokalne, a nie globalne,
- `polarization_mask` / `polarization_field`,
- kątowa sprawność \(\eta(\cos\theta)\) wybieralna z kilku modeli,
- zależność od napięcia,
- zależność od warstwy i regionu.

### 5.5.3. Najlepsza wersja

- **dynamiczny polaryzator**,
- wzajemny transfer momentu między warstwami,
- dwukierunkowe sprzężenie spinowe,
- opcjonalnie warstwa pośrednia / filtr spinowy / interlayer coupling.

---

## 5.6. Dynamiczny polaryzator

To jest centralny punkt raportu.

Jeżeli Fullmag ma zrobić skok jakościowy dla STNO, to właśnie tu.

### 5.6.1. Dlaczego fixed-\(p\) nie wystarcza

Fixed polarizer \(\mathbf{p}=\mathrm{const}\) zakłada, że warstwa referencyjna:
- nie drga,
- nie odkształca się,
- nie ma swoich modów,
- nie zmienia lokalnie polaryzacji elektronów.

To jest dobre jako baseline. Ale dla bardziej realistycznych układów jest za słabe.

### 5.6.2. Co daje dynamiczny polaryzator

- przesunięcie progu autooscylacji,
- zmiana amplitude–frequency nonlinearity,
- fine frequency splitting,
- nowe mody własne stosu,
- coupling do modów drugiej warstwy,
- część obserwowanych niestabilności i chaosu,
- możliwość modelowania stacked vortices / two-free-layer / hybrid textures.

### 5.6.3. Jak to zrobić w Fullmagu — warstwowo

#### Poziom A — Fixed vector polarizer
Najprostsze:
```text
p = const
```
Dobre jako pierwszy publiczny executable milestone.

#### Poziom B — Macrospin polarizer
Polaryzator opisany jednym wektorem \(\mathbf{p}(t)\), który ma własne LLG.
To już daje:
- wspólne oscylacje,
- rezonanse,
- wzajemne sprzężenie.

#### Poziom C — Reduced-order polarizer
Np. drugi vortex opisany własnym Thiele’em.
To jest bardzo atrakcyjne:
- dużo taniej niż pełna mikromagnetyka dwóch warstw,
- a łapie większość ciekawej dynamiki wielowarstwowej.

#### Poziom D — Pełny micromagnetic dynamic polarizer
Drugi magnes jest pełnoprawną teksturą:
- własny mesh / grid,
- własne \(M_s, A, \alpha\),
- własny demag/exchange,
- wzajemne sprzężenie magnetostatyczne,
- torque wynikający z lokalnej polaryzacji.

To jest docelowy wariant FASTMAG-like.

### 5.6.4. Jak formalnie wpisać dynamiczny polaryzator do solvera

W najprostszej wersji:

\[
\mathbf{p}(\mathbf{r},t) = \mathcal{P}\left[\mathbf{m}_{\mathrm{ref}}(\mathbf{r},t)\right]
\]

gdzie \(\mathcal{P}\) jest operatorem projekcji/spin filtering:
- lokalny voxel-to-voxel,
- średnia po kolumnie przepływu,
- convolution kernel,
- efektywny weighted average po current path.

Torque na free layer:

\[
\boldsymbol{\tau}_{\mathrm{SL,free}}(\mathbf{r},t)
=
a_J(\mathbf{r},t)\eta(\mathbf{m}_{f}\cdot \mathbf{p})
\mathbf{m}_{f}\times(\mathbf{m}_{f}\times\mathbf{p})
\]

Torque na reference layer można też dopuścić w wersji symetrycznej lub asymetrycznej, jeżeli model ma liczyć wzajemne oddziaływanie.

### 5.6.5. Co dodać poza samym \(\mathbf{p}(t)\)

- spatial filtering przez spacer,
- layer-selective current attenuation,
- zależność amplitudy STT od lokalnego kąta i lokalnego oporu,
- opcjonalny interlayer exchange / RKKY,
- wzajemny demag między warstwami.

---

## 5.7. Spin–orbit torque (SOT)

To nie jest konieczne do klasycznego CPP vortex STNO, ale jest bardzo cenne jako przyszłe rozszerzenie.

\[
\boldsymbol{\tau}_{\mathrm{DL}}
=
\gamma H_{\mathrm{DL}}\,
\mathbf{m}\times(\mathbf{m}\times\boldsymbol{\sigma})
\]

\[
\boldsymbol{\tau}_{\mathrm{FL}}
=
\gamma H_{\mathrm{FL}}\,
\mathbf{m}\times\boldsymbol{\sigma}
\]

To otwiera:
- single-layer oscillators,
- heavy-metal underlayers,
- spin Hall oscillators,
- łatwiejsze przejście z klasycznych STNO do SHNO/SOTNO.

Literatura z ostatnich lat potwierdza, że spin-orbit-driven nano-oscylatory są już pełnoprawną klasą urządzeń, więc Fullmag zyskałby bardzo dużo, gdyby moduł prądowy od razu był projektowany tak, by nie zamykać drogi do SOT. citeturn939998search9

---

## 5.8. Thermal noise

Dla STNO temperatura nie jest kosmetyką. Ona wpływa na:
- linewidth,
- phase noise,
- switching probability,
- coherence time,
- injection locking,
- chaos/noise floor.

Stochastyczne pole termiczne musi spełniać relację fluktuacja–dysypacja:

\[
\langle H_{\mathrm{th},i}(\mathbf{r},t)H_{\mathrm{th},j}(\mathbf{r}',t')\rangle
=
\frac{2\alpha k_B T}{\gamma \mu_0 M_s V \Delta t}
\delta_{ij}\delta_{\mathbf{r}\mathbf{r}'}\delta(t-t')
\]

W praktyce solver musi:
- poprawnie generować niezależny noise per cell,
- mieć zgodność z wybranym schematem całkowania stochastycznego,
- umieć liczyć długie przebiegi do PSD i linewidth.

W literaturze STNO nieliniowość częstotliwości i temperatura są kluczowe dla linewidth i kształtu widma. citeturn939998search0turn939998search2turn939998search8

### 5.8.1. Co dodać ponad “gołe T”

- spatial temperature map,
- Joule heating,
- drift parametrów materiałowych z temperaturą:
  - \(M_s(T)\),
  - \(A(T)\),
  - \(\alpha(T)\),
  - \(P(T)\),
- thermal gradients,
- seed control i ensemble statistics.

---

## 5.9. Disorder / pinning / granularity / edge roughness

Jeżeli Fullmag ma liczyć “prawdziwszą fizykę”, to sama idealna geometria nie wystarczy.

Warto dodać:
- polikrystaliczność,
- grain map,
- spatial \(M_s\), \(A\), \(\alpha\), \(K_u\),
- edge damage / dead layer,
- losowe pinning centers,
- roughness krawędzi.

Dlaczego to ważne?
- vortex orbit jest bardzo czuła na potencjał brzegowy,
- linewidth i flicker-like noise bywają mocno związane z nieregularnościami,
- neuromorficzne zastosowania vortex STO często wręcz korzystają z granularności i złożonej nieliniowości. citeturn194480search3turn939998search8

---

## 5.10. Magnetoresistance i sygnał elektryczny

STNO to urządzenie sygnałowe, więc nie wystarczy liczyć samo \(m(\mathbf{r},t)\).

Fullmag powinien umieć policzyć:
- \(R(t)\) z GMR/TMR/AMR/SMR,
- \(V(t)=I(t)R(t)\),
- PSD,
- harmoniczne,
- linewidth,
- phase slips,
- injection locking metrics.

Przy minimalnym modelu:
\[
R(t)=R_P + \Delta R \, f(\langle \mathbf{m}_{free}\cdot \mathbf{p}_{ref}\rangle)
\]

W lepszym:
- warstwa referencyjna dynamiczna,
- lokalna rezystywność,
- integracja po kolumnach prądu,
- sprzężenie z obwodem.

To jest niezbędne, jeżeli celem są:
- realistyczne porównania z eksperymentem,
- linewidth,
- synchronizacja,
- reservoir computing,
- chaos i sygnały wejściowe/wyjściowe.

---

## 6. Co dokładnie należy dołożyć do Fullmaga jako moduły / dodatki

W tej sekcji przechodzę z fizyki do konkretu projektowego.

---

## 6.1. Moduł A — `current_sources`

### Cel
Opisać **skąd, jak i którędy płynie prąd**.

### Zakres minimalny
- `DC`
- `Sinusoidal`
- `Pulse`
- `PiecewiseLinear`
- `ArbitraryWaveform(samples, dt)`

### Zakres średni
- rozdział prądu na regiony i warstwy,
- `current_density_field`,
- `current_path = pillar / line / mesh conductor`.

### Zakres docelowy
- solver rozkładu prądu z przewodnictwem regionów,
- current crowding,
- powiązanie z Joule heating.

### Proponowane klasy DSL
```python
CurrentDrive(...)
CurrentWaveform(...)
CurrentPath(...)
CurrentDensityField(...)
```

---

## 6.2. Moduł B — `oersted`

### Cel
Liczyć pole Ampère’a–Oersteda od zadanych lub wyliczonych prądów.

### Zakres minimalny
- analytic cylinder,
- constant / sinusoidal / pulse.

### Zakres średni
- ellipse,
- rounded rectangle,
- mesh-defined cross section,
- finite thickness correction.

### Zakres docelowy
- Oersted from solved \(J(\mathbf{r})\),
- wielowarstwowe przewodzenie,
- sprzężenie z warstwą referencyjną i spacerem.

### Co warto zrobić od razu
Obecny `OerstedCylinder` przenieść z “pojedynczego energy termu” do czegoś większego:

```python
OerstedSource(
    geometry=AnalyticCylinder(...),
    current=CurrentDrive(...),
    coupling="add_to_H_eff"
)
```

---

## 6.3. Moduł C — `spin_torque`

### Cel
Objąć wszystkie momenty prądowe w jednym spójnym API.

### Warianty
- `ZhangLiTorque`
- `SlonczewskiTorque`
- `FieldLikeTorque`
- `SpinOrbitTorque`

### Minimalny wariant
```python
SlonczewskiTorque(
    polarization=(0, 0, 1),
    lambda_=2.0,
    epsilon_prime=0.0,
    current=current_drive,
)
```

### Lepszy wariant
```python
SlonczewskiTorque(
    polarizer=FixedPolarizer(p=(0, 0, 1)),
    angular_efficiency="slonczewski",
    amplitude_model="cpp_uniform",
    include_field_like=True,
)
```

### Docelowy wariant
```python
SlonczewskiTorque(
    polarizer=DynamicPolarizer(magnet="reference_layer", projection="column_average"),
    current=current_drive,
    amplitude_model="from_current_density_field",
    include_reciprocal_torque=True,
)
```

---

## 6.4. Moduł D — `dynamic_polarizer`

### Cel
Wprowadzić warstwę referencyjną jako realny element dynamiki.

### Etapy
1. `FixedPolarizer`
2. `MacrospinPolarizer`
3. `ReducedOrderVortexPolarizer`
4. `MicromagneticPolarizer`

### Najważniejsze decyzje projektowe
- czy polaryzator jest osobnym magnesem w `Problem`,
- jak mapować \(\mathbf{m}_{ref}\) na \(\mathbf{p}(\mathbf{r},t)\),
- jak liczyć wzajemny torque,
- czy dopuścić różne siły sprzężenia w obie strony.

### Rekomendacja
Najlepiej zrobić to jako **warstwę sprzęgającą pomiędzy magnetami**, a nie jako cechę jednego magnesu. Dzięki temu architektura będzie działała także dla:
- dwóch free layers,
- stacked vortices,
- hybryd PMA/IMA,
- innych STO niż vortex.

---

## 6.5. Moduł E — `thermal_and_electrothermal`

### Cel
Urealnić linewidth, stability map i switchingi.

### Funkcje
- white thermal field,
- temperature maps,
- Joule heating,
- parametric drift \(M_s(T), A(T), \alpha(T), P(T)\),
- optional \(1/f\) phenomenology for long-time noise studies.

### Uwaga
Pełne mikroskopowe \(1/f\) noise to osobny, trudny temat; na start wystarczy:
- termika fizycznie poprawna,
- opcjonalny phenomenological colored noise.

---

## 6.6. Moduł F — `electrical_readout`

### Cel
Z magnetyzacji zrobić sygnał STNO.

### Wyjścia
- \(R(t)\),
- \(V(t)\),
- `psd`,
- `fundamental_frequency`,
- `harmonics`,
- `linewidth`,
- `phase_noise_proxy`,
- `locking_ratio`.

### Minimalny model
- statyczna warstwa referencyjna,
- uśrednione \(\langle \mathbf{m}\cdot \mathbf{p}\rangle\).

### Docelowy model
- lokalna rezystancja,
- dynamiczna warstwa referencyjna,
- sprzężenie z obwodem,
- bias tee / source impedance / RF injection.

---

## 6.7. Moduł G — `stno_observables`

### Cel
Dodać wielkości, które są naturalne dla vortex STNO, a nie tylko dla ogólnej mikromagnetyki.

### Co Fullmag powinien liczyć natywnie
- `core_x(t), core_y(t)`
- `core_radius(t)`
- `core_phase(t)`
- `instantaneous_frequency(t)`
- `orbit_ellipse_axes`
- `core_polarity`
- `core_reversal_events`
- `gyro_mode_amplitude`
- `psd`
- `linewidth`
- `Q_factor`
- `locking_phase`
- `phase_slip_count`
- `chaos_indicators` (opcjonalnie)

### Jak wykrywać rdzeń
Najpraktyczniejszy baseline:
1. znajdź ekstremum \(m_z\),
2. dopasuj lokalnie paraboloidę lub kwadratowy patch,
3. wyznacz pozycję sub-cell.

Docelowo można dodać metody bardziej topologiczne.

---

## 6.8. Moduł H — `multioscillator_coupling`

### Cel
Liczyć sieci STNO.

### Sprzężenia
- magnetostatyczne,
- prądowe,
- przez wspólny obwód,
- przez wspólną warstwę,
- przez spin waves.

To jest bardzo ważne dla:
- synchronizacji,
- phased arrays,
- neuromorficznych zastosowań,
- reservoir computing.

Literatura pokazuje, że vortex nanooscylatory mogą się synchronizować przez sprzężenie magnetostatyczne, a nieliniowa teoria autooscylatorów jest do tego bardzo użyteczna. citeturn929117search10turn939998search3turn939998search7

---

## 7. Jak rozszerzyć fizykę w samym `ProblemIR`

Obecny Fullmag ma już top-level pola typu:
- `current_density`
- `stt_*`
- `temperature`

To jest dobry bootstrap, ale długoterminowo za mało czytelne.

### 7.1. Rekomendacja

Zostawić kompatybilność wsteczną, ale przejść na **zagnieżdżone, typowane sekcje**.

### 7.2. Proponowany nowy kształt IR

```json
{
  "current_modules": [
    {
      "kind": "current_drive",
      "name": "pillar_dc",
      "waveform": {
        "kind": "dc",
        "amplitude_a": 0.008
      },
      "path": {
        "kind": "cylinder",
        "radius_m": 75e-9,
        "axis": [0, 0, 1],
        "center_m": [0, 0, 0]
      }
    },
    {
      "kind": "oersted_source",
      "drive": "pillar_dc",
      "model": {
        "kind": "analytic_cylinder"
      }
    },
    {
      "kind": "spin_torque",
      "name": "cpp_torque",
      "model": "slonczewski",
      "drive": "pillar_dc",
      "polarizer": {
        "kind": "fixed_vector",
        "p": [0, 0, 1]
      },
      "lambda": 2.0,
      "epsilon_prime": 0.0,
      "include_field_like": true
    },
    {
      "kind": "thermal_bath",
      "temperature_k": 300.0
    }
  ]
}
```

### 7.3. Wariant dynamicznego polaryzatora

```json
{
  "kind": "spin_torque",
  "model": "slonczewski",
  "drive": "pillar_dc",
  "polarizer": {
    "kind": "dynamic_magnet",
    "magnet": "reference_layer",
    "projection": "column_average",
    "normalization": "unit_vector"
  },
  "reciprocal_torque": {
    "enabled": true,
    "strength_ratio": 0.35
  }
}
```

### 7.4. Wariant reduced-order STNO

```json
{
  "stno_reduced_order": {
    "kind": "nonlinear_thiele",
    "free_layer": "free_vortex",
    "polarizer": "reference_layer",
    "coefficients": {
      "G": "...",
      "D0": "...",
      "xi": "...",
      "kappa0": "...",
      "zeta": "..."
    }
  }
}
```

---

## 8. Jak to powinno wyglądać w Python DSL

### 8.1. Wersja minimalna

```python
problem = Problem(
    name="vortex_stno_baseline",
    magnets=[free_layer],
    energy=[
        Exchange(),
        Demag(),
        Zeeman(B=(0, 0, 0.2)),
    ],
    current_modules=[
        CurrentDrive(
            name="dc_bias",
            waveform=DC(current=8e-3),
            path=CylindricalPillar(radius=75e-9, axis=(0, 0, 1)),
        ),
        OerstedSource(name="oe", drive="dc_bias", model="analytic_cylinder"),
        SlonczewskiTorque(
            name="stt",
            drive="dc_bias",
            polarizer=FixedPolarizer(p=(0, 0, 1)),
            lambda_=2.0,
            epsilon_prime=0.0,
            field_like=0.05,
        ),
        ThermalBath(temperature_k=300),
    ],
    study=TimeEvolution(
        dynamics=LLG(integrator="rk45"),
        outputs=[
            SaveField("m", every=1e-10),
            SaveScalar("E_total", every=1e-10),
            SaveScalar("core_x", every=1e-11),
            SaveScalar("core_y", every=1e-11),
            SaveSpectrum("voltage", window="hann"),
        ],
    ),
)
```

### 8.2. Wersja z dynamicznym polaryzatorem

```python
problem = Problem(
    name="vortex_stno_dynamic_polarizer",
    magnets=[free_layer, reference_layer],
    energy=[
        Exchange(),
        Demag(),
        Zeeman(B=(0, 0, 0.25)),
    ],
    current_modules=[
        CurrentDrive(
            name="dc_bias",
            waveform=DC(current=10e-3),
            path=CylindricalPillar(radius=80e-9, axis=(0, 0, 1)),
        ),
        OerstedSource(drive="dc_bias", model="analytic_cylinder"),
        SlonczewskiTorque(
            drive="dc_bias",
            polarizer=DynamicPolarizer(
                magnet="reference_layer",
                projection="column_average",
                reciprocal_torque=True,
            ),
            lambda_=2.2,
            epsilon_prime=0.03,
            field_like=0.08,
        ),
        ThermalBath(temperature_k=300),
        ElectricalReadout(
            model=TMR(delta_r=120.0, reference="reference_layer"),
            circuit=LoadResistance(50.0),
        ),
    ],
    study=TimeEvolution(
        dynamics=LLG(integrator="rk45"),
        outputs=[
            SaveScalar("core_x", every=2e-11),
            SaveScalar("core_y", every=2e-11),
            SaveScalar("frequency_inst", every=2e-11),
            SaveScalar("voltage", every=2e-11),
            SaveSpectrum("voltage"),
            SaveScalar("linewidth"),
        ],
    ),
)
```

---

## 9. Co trzeba zrobić w plannerze i capability matrix

Fullmag ma już dobry zwyczaj rozróżniania:
- `semantic-only`
- `internal-reference`
- `public-executable`

Dla STNO to jest idealne.

### 9.1. Proponowane tierowanie

#### Tier 1 — semantic-only
Na początku można dodać semantykę bez pełnej egzekucji dla:
- dynamic polarizer,
- arbitrary current map,
- circuit feedback,
- colored noise.

#### Tier 2 — internal-reference
Uruchamialne wewnętrznie:
- nonlinear Thiele,
- single-layer STNO z Oersted + Slonczewski + thermal,
- podstawowy readout.

#### Tier 3 — public-executable
Dopiero po walidacji:
- vortex disk / pillar,
- Oersted analytic,
- fixed-p Slonczewski,
- thermal noise,
- core observables,
- spectrum/linewidth.

#### Tier 4 — advanced public-executable
- macrospin/dynamic polarizer,
- multilayer micromagnetics,
- electrical readout,
- synchronization.

---

## 10. Co trzeba zrobić numerycznie i solverowo

### 10.1. Integratory

Dla STNO potrzebne są:
- stabilność,
- dobra faza,
- długie przebiegi,
- niski błąd dryfu fazy,
- sensowna obsługa szumu.

Dlatego warto utrzymać:
- `RK23` / `RK45` dla adaptacji,
- `ABM3` dla długich, gładkich przebiegów deterministycznych,
- `Heun` lub odpowiednik stochastyczny dla noisy LLG,
- opcjonalnie tryb “phase-accurate”.

### 10.2. Stochastic LLG

Jeżeli temperatura ma być czymś więcej niż parametrem:
- trzeba pilnować zgodności interpretacji szumu,
- trzeba mieć kontrolę nad `dt` dla noise,
- trzeba mieć reproducibility seeds,
- trzeba umieć robić ensemble runs.

### 10.3. Rozdzielczość siatki

Dla vorteksu:
- komórka musi być mniejsza niż skala rdzenia i exchange length,
- trzeba pilnować poprawnego kształtu brzegu,
- sub-cell boundary correction jest tu bardzo cenna.

### 10.4. Długie przebiegi

STNO wymaga często bardzo długich runów, bo:
- linewidth i PSD nie wychodzą z 3 ns,
- locking i phase slips wymagają długiej obserwacji,
- chaos/noise potrzebują długich szeregów czasowych.

To oznacza:
- oszczędne outputy,
- streaming scalars,
- możliwość zapisu tylko potrzebnych observables,
- FFT / PSD in-situ albo pół-in-situ.

### 10.5. Coupled solvers

Dla dynamicznego polaryzatora i obwodu:
- solver magnetyzacji i solver readout/circuit mogą być sprzężone jawnie lub półjawnie,
- nie wszystko musi być rozwiązane monolitycznie od pierwszej wersji.

---

## 11. Walidacja fizyczna — co Fullmag musi umieć udowodnić

Bez walidacji moduł STNO będzie tylko “feature pile”.

### 11.1. Walidacja Oersteda
- porównanie z analityką cylindra,
- porównanie z Biot–Savart dla kilku geometrii,
- testy znaku chiralności i kierunku orbity.

### 11.2. Walidacja Slonczewskiego
- próg prądu autooscylacji,
- amplitude vs current,
- frequency vs current,
- influence of \(\Lambda\) i field-like torque.

### 11.3. Walidacja Thiele vs micromagnetics
- małe amplitudy,
- średnie amplitudy,
- nieliniowy shift częstotliwości,
- effect of Oersted,
- effect of perpendicular field.

To jest bardzo ważne, bo klasyczny Thiele może być mylący, a ulepszony model trzeba kalibrować na pełnej mikromagnetyce. citeturn365459search1turn365459search2turn365459search5

### 11.4. Walidacja temperatury
- linewidth vs \(T\),
- coherence time,
- PSD shape.

### 11.5. Walidacja dynamicznego polaryzatora
- fixed-\(p\) vs macrospin-\(p(t)\) vs full dynamic layer,
- frequency splitting,
- coupled modes,
- energy transfer between layers.

### 11.6. Walidacja synchronizacji
- dwóch vortex STO,
- locking bandwidth,
- phase slips,
- mutual synchronization.

---

## 12. Roadmapa implementacyjna dla Fullmaga

Ta roadmapa jest specjalnie ustawiona tak, aby:
- maksymalnie wykorzystać istniejący kod,
- szybko dojść do publicznego vortex STNO,
- nie zniszczyć architektury.

---

## 12.1. Faza 0 — dokumentacja i porządki semantyczne

### Zadania
1. Dopisać nowe noty w `docs/physics/`, np.:
   - `0560-fdm-current-driven-stno-foundations.md`
   - `0565-fdm-oersted-current-sources.md`
   - `0570-fdm-spin-transfer-torque.md`
   - `0575-fdm-vortex-stno-observables.md`
   - `0580-fdm-dynamic-polarizer.md`
   - `0585-reduced-order-vortex-stno-thiele.md`

2. Uaktualnić:
   - capability matrix,
   - README “current bootstrap state”,
   - ProblemIR spec.

3. Spójnie opisać, które rzeczy są:
   - w IR,
   - w plannerze,
   - w runnerze,
   - w CPU reference,
   - w CUDA native.

### Efekt
Repo przestaje mieć rozdźwięk między dokumentacją a latent code scaffolding.

---

## 12.2. Faza 1 — publiczny moduł `current_sources + oersted`

### Zadania
1. Publicznie wyeksponować `OerstedCylinder`.
2. Dodać `PiecewiseLinear` i `ArbitraryWaveform`.
3. Uczynić Oersted pełnoprawnym elementem capability matrix.
4. Dodać testy:
   - analytic parity,
   - sign convention,
   - waveform parity.

### Efekt
Fullmag liczy realistyczniejsze pole dla STNO jeszcze zanim dojdzie torque.

---

## 12.3. Faza 2 — fixed-p Slonczewski STT dla FDM

### Zadania
1. Wystawić clean DSL dla Slonczewskiego.
2. Domknąć planner → backend → output path.
3. Zrobić benchmark vortex disk:
   - threshold current,
   - steady orbit,
   - frequency-vs-current.

### Efekt
Pierwszy prawdziwy **public-executable vortex STNO**.

---

## 12.4. Faza 3 — thermal noise + STNO observables

### Zadania
1. Dopisać poprawny stochastic path.
2. Dodać:
   - core tracking,
   - orbit radius,
   - PSD,
   - linewidth,
   - phase tracking.

### Efekt
Fullmag staje się użyteczny do realnej analizy sygnału STNO.

---

## 12.5. Faza 4 — reduced-order nonlinear Thiele backend

### Zadania
1. Osobny solver reduced-order.
2. Parametry fitowane z mikromagnetyki.
3. Support dla:
   - injection locking,
   - chaos,
   - synchronization,
   - fast sweeps.

### Efekt
Setki lub tysiące punktów parametrów policzysz szybko, a potem wybrane przypadki sprawdzisz pełnym FDM.

---

## 12.6. Faza 5 — dynamiczny polaryzator poziom 1

### Zadania
1. `MacrospinPolarizer`
2. opcjonalny reciprocal torque
3. wspólne outputy warstwy free i reference

### Efekt
Pierwszy krok beyond fixed-\(p\).

---

## 12.7. Faza 6 — dynamiczny polaryzator poziom 2

### Zadania
1. `ReducedOrderVortexPolarizer`
2. coupling vortex–vortex
3. stacked-vortex modes

### Efekt
Silny wzrost realizmu przy umiarkowanym koszcie obliczeń.

---

## 12.8. Faza 7 — dynamiczny polaryzator poziom 3

### Zadania
1. pełny drugi magnes w solverze,
2. lokalna projekcja \(\mathbf{m}_{ref}(\mathbf{r},t)\to \mathbf{p}(\mathbf{r},t)\),
3. wielowarstwowy current path,
4. readout z dynamiczną warstwą referencyjną.

### Efekt
To już jest bardzo blisko klasy high-end STNO tools.

---

## 12.9. Faza 8 — current solver + circuit feedback

### Zadania
1. current crowding,
2. Joule heating,
3. bias/load/feedback loop,
4. RF injection i modulation.

### Efekt
Pełny electro-magneto-dynamic STNO workflow.

---

## 13. Co jest najważniejsze do dodania najpierw

Poniżej moja priorytetyzacja nie wg “co jest najciekawsze”, ale wg **stosunku wartości do kosztu**.

### Priorytet 1 — wystawić i uporządkować Oersted/STT/thermal
To już w znacznej części “prawie tam jest”.

### Priorytet 2 — fixed-p vortex STNO jako pierwszy publiczny benchmark
To da natychmiastową wartość naukową i projektową.

### Priorytet 3 — STNO observables
Bez tego nawet dobry solver nie daje dobrego workflow.

### Priorytet 4 — reduced-order nonlinear Thiele
Da szybkość i świetny workflow do eksploracji.

### Priorytet 5 — dynamiczny polaryzator
To jest największy “value jump” względem prostych open-source pipelines.

### Priorytet 6 — readout i circuit
Potrzebne do realnych porównań z eksperymentem.

---

## 14. Co jeszcze można dołożyć, aby liczyć “więcej i prawdziwszą fizykę”

Poniżej zbieram rozszerzenia, które nie są absolutnym minimum dla pierwszego vortex STNO, ale robią ogromną różnicę jakościową.

### 14.1. Spatial material maps
- \(M_s(\mathbf{r})\)
- \(A(\mathbf{r})\)
- \(\alpha(\mathbf{r})\)
- \(P(\mathbf{r})\)
- \(\beta(\mathbf{r})\)
- \(K_u(\mathbf{r})\)

### 14.2. Grains i roughness
- granular free layer,
- random anisotropy axes,
- edge roughness,
- dead edge.

### 14.3. Voltage-controlled effects
- napięciozależny STT,
- VCMA,
- bias dependence TMR.

### 14.4. Interlayer exchange / RKKY
Wielowarstwowe STO z couplingiem między warstwami.

### 14.5. DMI i hybrydowe tekstury
Jeżeli kiedyś chcesz przejść od vortex STNO do skyrmion-based oscillators lub hybryd vortex–skyrmion.

### 14.6. FEM path dla current solvera
FDM dla magnetyzacji + FEM dla rozkładu prądu / pola w bardziej złożonej geometrii.

### 14.7. Inverse design / differentiable reduced-order fitting
Długoterminowo można inspirować się nowymi kodami micromagnetic, które idą w stronę differentiable workflows i inverse design, ale to już jest następny rozdział rozwoju platformy, nie pierwszy milestone STNO. citeturn701450search2

---

## 15. Minimalny zestaw benchmarków, które radzę przygotować od razu

### Benchmark A — vortex disk, fixed polarizer, DC current
Cel:
- threshold current,
- steady autooscillation,
- orbit radius,
- frequency.

### Benchmark B — to samo + Oersted on/off
Cel:
- zobaczyć różnicę w orbit/frequency/nonlinearity.

### Benchmark C — to samo + temperature sweep
Cel:
- linewidth vs \(T\).

### Benchmark D — dynamic polarizer macrospin
Cel:
- porównanie z fixed-\(p\).

### Benchmark E — dwa coupled vortex STO
Cel:
- synchronization / locking.

### Benchmark F — nonlinear Thiele vs full FDM
Cel:
- szybki reduced-order model kalibrowany na pełnej mikromagnetyce.

---

## 16. Konkretne rekomendacje zmian w repo

Ta sekcja jest najbardziej praktyczna.

### 16.1. Python DSL
Dodać pakiet:
```text
packages/fullmag-py/src/fullmag/model/current.py
```

z klasami:
- `CurrentDrive`
- `DC`, `Sinusoidal`, `Pulse`, `PiecewiseLinear`, `ArbitraryWaveform`
- `CurrentPath`
- `OerstedSource`
- `SlonczewskiTorque`
- `ZhangLiTorque`
- `SpinOrbitTorque`
- `ThermalBath`
- `ElectricalReadout`
- `FixedPolarizer`
- `MacrospinPolarizer`
- `DynamicPolarizer`

### 16.2. `problem.py`
- rozszerzyć `EnergyTerm` / `Problem` tak, by current module był formalnie częścią publicznego modelu,
- nie polegać wyłącznie na top-level optional fields.

### 16.3. `fullmag-ir`
- wprowadzić typowane sekcje `current_modules`,
- zachować backward compatibility na starych polach.

### 16.4. `fullmag-plan`
- jawnie sklasyfikować current physics w capability matrix,
- dodać ścieżki lowering dla:
  - fixed-p STT,
  - dynamic polarizer,
  - reduced-order STNO.

### 16.5. `fullmag-runner`
- osobny `stno_observables.rs`,
- osobny `current_modules.rs` lub analogiczny moduł orchestration,
- streaming scalars dla bardzo długich runów.

### 16.6. `native/`
- utrzymać spójność C ABI i rzeczywistych kernel paths,
- rozdzielić:
  - current source,
  - torque,
  - readout,
  - thermal path.

### 16.7. `docs/physics`
To powinno być pierwsze do zrobienia, zgodnie z filozofią repo.

---

## 17. Najważniejsze decyzje projektowe, które trzeba podjąć świadomie

### 17.1. Czy current physics ma być “energy termem”?
Moim zdaniem: **nie w całości**.

Powód:
- torque nie jest energią,
- readout nie jest energią,
- thermal bath nie jest energią,
- circuit feedback nie jest energią.

Dlatego lepiej mieć:
- `energy_terms`
- `current_modules`
- `observables/readout modules`

### 17.2. Czy dynamiczny polaryzator to cecha torque czy osobny byt?
Najlepiej:
- osobny byt / obiekt polaryzatora,
- torque tylko z niego korzysta.

### 17.3. Czy reduced-order STNO powinien mieć własny backend?
Tak.
W przeciwnym razie Fullmag straci bardzo ważną możliwość szybkiego projektowania.

### 17.4. Czy robić to od razu dla FDM i FEM?
Nie.
Najpierw **FDM vortex STNO**.
FEM później, gdy current physics w FDM będzie zwalidowana.

---

## 18. Ostateczna rekomendacja strategiczna

Gdybym miał wybrać **jedną najlepszą ścieżkę rozwoju Fullmaga dla STNO vortex**, wybrałbym dokładnie tę:

### Krok 1
Uczynić **single-layer FDM vortex STNO** w pełni publicznym i zwalidowanym:
- Oersted
- fixed-p Slonczewski
- temperature
- core tracking
- spectrum/linewidth

### Krok 2
Dodać **nonlinear Thiele backend** jako szybki model reduced-order.

### Krok 3
Dodać **dynamic polarizer**:
- najpierw macrospin,
- potem reduced-order vortex,
- na końcu pełną drugą warstwę micromagnetic.

### Krok 4
Dodać **electrical readout + circuit feedback**.

To daje dokładnie właściwą kolejność:
- najpierw realny użytek,
- potem szybkość,
- potem duży skok fizyczny,
- potem pełna realizm eksperymentalny.

---

## 19. Wersja bardzo krótka: co dokładnie dołożyć do Fullmaga

Jeżeli chcesz skróconą listę rzeczy “co dodać”, to moja odpowiedź brzmi:

1. **Publiczny, pełny Oersted dla STNO**
2. **Publiczny Slonczewski STT z field-like term**
3. **Thermal noise i długo-czasowe wyjścia sygnałowe**
4. **STNO observables (core, PSD, linewidth, locking)**
5. **Reduced-order nonlinear Thiele solver**
6. **Dynamic polarizer**
7. **Electrical readout i circuit feedback**
8. **Current crowding / solved current map**
9. **Disorder / grains / roughness**
10. **Synchronizacja wielu oscylatorów**

---

## 20. Konkluzja końcowa

Dla vortex STNO:

- **najlepszy model szybki** = ulepszone, nieliniowe równanie Thiele’a kalibrowane na mikromagnetyce,
- **najlepszy model bazowy** = pełny mikromagnetyzm jednej warstwy z Oerstedem, Slonczewskim i temperaturą,
- **najlepszy model high-end** = wielowarstwowy mikromagnetyzm z dynamicznym polaryzatorem, lokalną polaryzacją spinową i sprzężeniem elektrycznym.

Dla Fullmaga najlepszą drogą nie jest “napisać nowy jednowymiarowy moduł prądowy”, lecz zbudować **spójny ekosystem current-driven magnetodynamics**.

Największy skok jakościowy względem prostych pipeline’ów da:
- **dynamiczny polaryzator**,
- **spójny model Oersted + STT + thermal**,
- **wyjścia STNO i sprzężenie z obwodem**.

To właśnie tam leży prawdziwe przejście:
od “ogólnego solvera LLG”  
do  
**narzędzia realnie projektującego vortex STNO.**

---

# Załącznik A — proponowana lista nowych dokumentów `docs/physics/`

1. `0560-fdm-current-driven-stno-foundations.md`
2. `0565-fdm-oersted-current-sources.md`
3. `0570-fdm-spin-transfer-torque.md`
4. `0572-fdm-thermal-noise-for-stno.md`
5. `0575-fdm-vortex-stno-observables.md`
6. `0580-fdm-dynamic-polarizer.md`
7. `0582-fdm-electrical-readout-and-magnetoresistance.md`
8. `0585-reduced-order-vortex-stno-thiele.md`
9. `0590-stno-synchronization-and-circuit-coupling.md`

---

# Załącznik B — proponowana capability matrix dla nowej fizyki

| Funkcja | Semantic-only | Internal-reference | Public-executable |
|---|---:|---:|---:|
| Oersted analytic cylinder | tak | tak | tak |
| Oersted arbitrary waveform | tak | tak | tak |
| Slonczewski fixed polarizer | tak | tak | tak |
| Field-like torque | tak | tak | tak |
| Zhang–Li | tak | tak | później |
| Thermal white noise | tak | tak | tak |
| STNO core observables | tak | tak | tak |
| PSD / linewidth | tak | tak | tak |
| Nonlinear Thiele backend | tak | tak | później |
| Macrospin dynamic polarizer | tak | tak | później |
| Reduced-order vortex polarizer | tak | tak | później |
| Full micromagnetic dynamic polarizer | tak | tak | później |
| Current crowding / solved current map | tak | tak | później |
| Circuit feedback | tak | tak | później |
| SOT | tak | tak | później |

---

# Załącznik C — proponowane nazwy modułów w kodzie

```text
packages/fullmag-py/src/fullmag/model/current.py
packages/fullmag-py/src/fullmag/model/stno.py

crates/fullmag-ir/src/current.rs
crates/fullmag-plan/src/current.rs
crates/fullmag-runner/src/current_modules.rs
crates/fullmag-runner/src/stno_observables.rs
crates/fullmag-runner/src/reduced_order_stno.rs

native/include/fullmag_stno.h         # opcjonalnie, jeśli chcesz oddzielić ABI
native/backends/fdm/current/...
native/backends/fdm/stno/...
```

---

# Załącznik D — proponowane obserwables STNO

### Scalar
- `core_x`
- `core_y`
- `core_r`
- `core_phase`
- `core_polarity`
- `freq_inst`
- `orbit_major_axis`
- `orbit_minor_axis`
- `voltage`
- `power_rf`
- `linewidth`
- `phase_slip_count`
- `locking_error`

### Field / diagnostic
- `p_local`
- `J_local`
- `H_oe`
- `tau_sl`
- `tau_fl`
- `tau_zl`
- `temperature_map`

---

# Załącznik E — bibliografia robocza

Poniższa lista nie jest pełnym przeglądem literatury, tylko zestawem pozycji najważniejszych dla rozwoju modułu STNO w Fullmagu.

## Fullmag / architektura
1. `MateuszZelent/fullmag` — publiczne repozytorium Fullmaga, audyt stanu na 2026-03-30.
2. `docs/physics/README.md` w repo Fullmaga — zasady dokumentowania nowej fizyki.

## Vortex STNO — klasyczne i bazowe
3. V. S. Pribiag et al., **Magnetic vortex oscillator driven by d.c. spin-polarized current**, *Nature Physics* 3, 498–503 (2007).
4. A. V. Khvalkovskiy et al., **Vortex oscillations induced by spin-polarized current in a magnetic nanopillar: Analytical versus micromagnetic calculations**, *Phys. Rev. B* 80, 140401(R) (2009).
5. A. Dussaux et al., **Field dependence of spin-transfer-induced vortex dynamics in the nonlinear regime**, *Phys. Rev. B* 86, 014402 (2012).
6. F. Sanches et al., **Current-driven gyrotropic mode of a magnetic vortex as a nonisochronous auto-oscillator**, *Phys. Rev. B* 89, 140410(R) (2014).
7. K. Yu. Guslienko et al., **Vortex-state oscillations in soft magnetic cylindrical dots**, *Phys. Rev. B* 71, 144407 (2005).

## Oersted / nieliniowość / współczesne modele
8. Flavio Abreu Araujo et al., **Ampere–Oersted field splitting of the nonlinear spin-torque vortex oscillator dynamics**, *Scientific Reports* 12, 10605 (2022).
9. Simon de Wergifosse et al., **Quantitative and realistic description of the magnetic potential energy of spin-torque vortex oscillators**, *Phys. Rev. B* 108, 174403 (2023).
10. Chloé Chopin et al., **Current-controlled periodic double-polarity reversals in a spin-torque vortex oscillator**, *Scientific Reports* 14, 24177 (2024).

## Dynamiczne układy wielowarstwowe / coupled oscillators
11. V. Sluka et al., **Spin-torque-induced dynamics at fine-split frequencies in nano-oscillators with two stacked vortices**, *Nature Communications* 6, 6409 (2015).
12. T. Taniguchi, **Synchronized, periodic, and chaotic dynamics in spin torque oscillator with two free layers**, *J. Magn. Magn. Mater.* 483, 281–292 (2019).

## Noise / linewidth / nieliniowa teoria autooscylatora
13. J.-V. Kim, V. Tiberkevich, A. Slavin, **Generation Linewidth of an Auto-Oscillator with a Nonlinear Frequency Shift: Spin-Torque Nano-Oscillator**, *Phys. Rev. Lett.* 100, 017207 (2008).
14. V. S. Tiberkevich, A. N. Slavin, J.-V. Kim, **Temperature dependence of nonlinear auto-oscillator linewidths**, *Phys. Rev. B* 78, 092401 (2008).
15. F. Abreu Araujo et al., **Influence of flicker noise and nonlinearity on the frequency spectrum of spin torque nano-oscillators**, *Scientific Reports* 10, 13890 (2020).

## Synchronizacja / nieliniowe oscylatory
16. A. N. Slavin, V. S. Tiberkevich, **Theory of mutual phase locking of spin-torque nanosized oscillators**, *Phys. Rev. B* 74, 104401 (2006).

## SOT / rozszerzenia klasy STO
17. Mohammad Haidar et al., **A single layer spin-orbit torque nano-oscillator**, *Nature Communications* 10, 2362 (2019).

## Nowsze kierunki obliczeniowe
18. C. Abert et al., **NeuralMag: an open-source nodal finite-difference code for inverse micromagnetics**, *npj Computational Materials* 11, 193 (2025).

---


# Załącznik F — szczegółowy audyt obecnego stanu implementacyjnego Fullmaga pod kątem fizyki prądowej

Ta część jest celowo bardzo konkretna. Nie opisuje “jak bym to idealnie zrobił”, tylko **co w repo już dziś istnieje jako fundament**.

## F.1. Python DSL

### `packages/fullmag-py/src/fullmag/model/energy.py`
W kodzie istnieją już:
- `Constant`
- `Sinusoidal`
- `Pulse`
- `OerstedCylinder`

To oznacza, że:
- pojęcie źródła Oersteda już weszło do publicznego stylu API,
- istnieje już semantyka envelope’ów czasowych,
- architektura nie jest “exchange-only” na poziomie pomysłowym.

### Wniosek
Nie trzeba zaczynać od zera. Trzeba:
- dopisać formalną warstwę `current.py`,
- przenieść obecny `OerstedCylinder` do bardziej spójnej rodziny current modules,
- zachować backward compatibility.

---

## F.2. `problem.py`

W `problem.py` typ alias `EnergyTerm` obejmuje dziś głównie:
- `Exchange`
- `Demag`
- `InterfacialDMI`
- `BulkDMI`
- `Zeeman`

Natomiast `OerstedCylinder` istnieje w `energy.py`, ale nie jest jeszcze tak dobrze “uformowany” w publicznej powierzchni `Problem`, jak klasyczne energy terms.

### Wniosek
W warstwie Python DSL widać **pierwszą niespójność publicznego API**:
- Oersted jest już realnie zaimplementowany jako obiekt,
- ale nie jest jeszcze w pełni “kanonicznie osadzony” w głównym modelu problemu.

To jest mały, ale bardzo ważny sygnał:
> Fullmag już wszedł w current physics, tylko jeszcze nie domknął semantyki publicznej.

---

## F.3. `dynamics.py`

W dynamice istnieją już integratory:
- `heun`
- `rk4`
- `rk23`
- `rk45`
- `abm3`
- `auto`

To jest świetna wiadomość dla STNO, bo:
- Heun sam w sobie nie wystarcza jako jedyny wybór,
- STNO potrzebuje często lepszej kontroli błędu fazy i długiego przebiegu,
- adaptacyjne integratory będą ważne przy:
  - starcie oscylacji,
  - przejściach między modami,
  - thermal noise,
  - injection locking.

### Wniosek
Fullmag ma już numeryczny fundament lepszy niż sugeruje skrócony opis README.

---

## F.4. `ProblemIR`

W `ProblemIR` widać już pola pod:
- `current_density`
- `stt_degree`
- `stt_beta`
- `stt_spin_polarization`
- `stt_lambda`
- `stt_epsilon_prime`
- `temperature`

oraz w `EnergyTermIR` jest:
- `OerstedCylinder { current, radius, center, axis, time_dependence }`

### Wniosek
Na poziomie IR Fullmag **już jest koncepcyjnie gotowy** na:
- Zhang–Li,
- Slonczewski,
- Oersted,
- temperaturę.

Brakuje nie tyle semantyki, ile:
- pełnej egzekucji,
- spójnej dokumentacji,
- capability matrix,
- testów i benchmarków.

---

## F.5. Planner (`fullmag-plan`)

Planner:
- potrafi przenieść pola current/STT/temperature do planów FDM/FEM,
- umie wyciągnąć `OerstedCylinder` z energy terms,
- ale jednocześnie dokumentowany i egzekwowalny “public executable subset” jest jeszcze węższy.

### Wniosek
W plannerze widać **typową sytuację przejściową**:
- semantyka już wyrosła,
- wykonanie i oficjalna kwalifikacja jeszcze nie nadążyły.

To jest dobra wiadomość: architektura nie blokuje rozwoju STNO.

---

## F.6. CPU reference runner

CPU reference path realnie buduje problem z:
- exchange,
- demag,
- external field,
- temperaturą.

Natomiast w tym audycie nie widać, żeby CPU reference był już pełnym wykonawczym backendem dla:
- Slonczewski STT,
- Zhang–Li,
- OerstedCylinder.

### Wniosek
CPU reference należy traktować jako:
- baseline walidacyjny dla części fizyki,
- ale nie jeszcze jako pełny referencyjny backend STNO.

Dla STNO publicznie sensowną ścieżką będzie prawdopodobnie:
- najpierw domknąć CUDA/native execution path,
- a CPU reference trzymać jako ograniczony validation baseline.

---

## F.7. CUDA / native FDM wrapper

Wrapper do natywnego backendu przekazuje w plan descriptor:
- `current_density_x/y/z`
- `stt_degree`
- `stt_beta`
- `stt_p_x/y/z`
- `stt_lambda`
- `stt_epsilon_prime`
- `has_oersted_cylinder`
- `oersted_current`
- `oersted_radius`
- `oersted_center`
- `oersted_axis`
- `oersted_time_dep_*`
- `temperature`

Nagłówek C ABI przewiduje dodatkowo także:
- anisotropię,
- cubic anisotropy,
- interfacial i bulk DMI.

### Wniosek
To jest bardzo mocny sygnał, że:
- Fullmag-native był projektowany z myślą o dużo bogatszej fizyce niż obecnie publicznie eksponowana,
- STNO/current physics nie są obce tej architekturze,
- najlepszym ruchem jest **doprowadzić tę ścieżkę do statusu “public-qualified”**, a nie pisać równoległy osobny eksperymentalny tor.

---

## F.8. Najważniejsze niespójności, które trzeba naprawić

1. **README vs kod**  
   Dokumentowany executable slice jest węższy niż realny scaffolding w kodzie.

2. **Python public API vs latent current features**  
   `OerstedCylinder` istnieje, ale nie jest jeszcze częścią w pełni uporządkowanego, typowanego modułu current.

3. **IR/planner vs CPU reference**  
   IR potrafi nieść STT/Oersted, ale CPU reference nie wygląda jeszcze na pełny backend wykonawczy dla tej fizyki.

4. **Current physics jako “top-level pola”**  
   To był dobry bootstrap, ale długoterminowo trzeba to przenieść do bardziej typowanej semantyki.

---

## F.9. Co to oznacza praktycznie dla roadmapy

To oznacza, że Fullmag jest dziś w idealnym miejscu do zrobienia **dużego jakościowego kroku**:

- za mało “gotowy”, żeby już udawać kompletny STNO suite,
- ale wystarczająco dojrzały, żeby **stosunkowo szybko** dojść do pierwszej mocnej wersji vortex STNO.

Innymi słowy:
> architektura jest już gotowa na STNO;
> teraz trzeba domknąć fizykę, egzekucję i walidację.

---

# Załącznik G — jak rozumiem kierunek “FASTMAG-like” w praktyce Fullmaga

Ponieważ wskazałeś FASTMAG jako punkt odniesienia i wspomniałeś o możliwości liczenia **dynamicznego polaryzatora**, traktuję to nie jako prośbę o skopiowanie konkretnego zamkniętego kodu, lecz jako wskazanie **klasy funkcjonalności**, do której Fullmag powinien dojść.

## G.1. Co w praktyce znaczy “FASTMAG-like” dla Fullmaga

Dla tego raportu interpretuję to jako zestaw możliwości:

1. **pełna dynamika warstwy swobodnej**
2. **momenty prądowe zależne od geometrii i orientacji**
3. **pole Oersteda zgodne z geometrią prądu**
4. **dynamiczny polaryzator zamiast stałego \(\mathbf{p}\)**
5. **możliwość liczenia wielowarstwowych stacków STNO**
6. **wyjścia sygnałowe, a nie tylko pola magnetyzacji**
7. **długie stabilne przebiegi do widm, linewidth i synchronizacji**

## G.2. Co jest absolutnie niezbędne, aby Fullmag wszedł do tej klasy

### Minimum techniczne
- `SlonczewskiTorque`
- `OerstedSource`
- `ThermalBath`
- `core tracking`
- `electrical readout`

### Minimum fizyczne
- nieliniowa dynamika vortex orbit,
- poprawne liczenie wpływu Oersteda,
- poprawne liczenie autooscylacji,
- poprawne liczenie reversal / orbit boundaries.

### Minimum architektoniczne
- `current_modules` jako osobna sekcja modelu,
- `dynamic_polarizer` jako osobny byt,
- reduced-order solver dla szybkich sweepów.

## G.3. Najbardziej opłacalna wersja pośrednia

Nie trzeba od razu robić pełnej drugiej warstwy micromagnetic. Najbardziej opłacalny etap pośredni to:

1. pełny FDM dla free layer,
2. macrospin lub reduced-order vortex dla reference layer,
3. lokalna lub półlokalna projekcja polaryzacji,
4. readout elektryczny.

To da:
- ogromny wzrost realizmu,
- umiarkowany koszt implementacji,
- bardzo dobrą platformę do dalszej rozbudowy.

---
