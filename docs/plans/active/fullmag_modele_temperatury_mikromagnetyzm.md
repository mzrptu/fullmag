
---
title: "Modele temperatury w symulacjach mikromagnetycznych dla FullMag"
subtitle: "Rekomendowana architektura, równania, API, ProblemIR, backendy i walidacja"
lang: pl-PL
toc: true
toc-title: "Spis treści"
numbersections: true
geometry: margin=2.2cm
---

# Cel dokumentu

Ten dokument odpowiada na pytanie: **jak najlepiej zaimplementować temperaturę w FullMag**, biorąc pod uwagę aktualną architekturę projektu, jego zasadę *physics-first* i realny stan publicznie wykonywalnego stosu.

Nie chodzi tylko o listę „jakie modele temperatury istnieją”, lecz o odpowiedź praktyczną:

1. **co warto wdrożyć jako pierwsze**,
2. **jak to opisać w semantyce i `ProblemIR`**,
3. **jak to poprawnie policzyć numerycznie**,
4. **jak nie zepsuć spójności między FDM, FEM i trybem hybrydowym**,
5. **jak to zwalidować tak, żeby funkcja była naukowo wiarygodna**.

Najważniejsza teza dokumentu jest następująca:

> Dla aktualnego FullMag **najlepszą pierwszą produkcyjną implementacją temperatury** jest
> **stochastyczne pole termiczne Brownowskie w równaniu LLG** (*stochastic LLG*, *sLLG*),
> połączone z:
> - jawną semantyką pola temperatury `T(x,t)`,
> - prawami materiałowymi zależnymi od temperatury (`Ms(T)`, `A(T)`, `Ku(T)`, `alpha(T)`),
> - poprawną obsługą RNG, kroków czasowych i walidacji statystycznej.
>
> **LLB** (*Landau–Lifshitz–Bloch*) powinno być **drugim poziomem rozwoju**, uruchamianym dla
> temperatur bliskich i powyżej `Tc`, dla szybkich impulsów cieplnych, ultrafast demagnetization,
> HAMR i wszystkich przypadków, w których długość magnetyzacji nie może być już traktowana jako stała.
>
> **Dwutemperaturowe / trójtemperaturowe modele cieplne** (`2TM`, `3TM`) należy traktować jako
> **osobną warstwę napędzającą pole temperatury**, a nie jako substytut `sLLG` lub `LLB`.

# Odpowiedź w jednym akapicie

Jeżeli celem jest **najlepszy praktyczny model temperatury dla FullMag dzisiaj**, to odpowiedź brzmi:
najpierw wdrożyć **`LLG + Brown thermal field`** w obecnym publicznym stosie `FDM + Heun`, od razu
z semantycznie jawnym `TemperatureField` i prawami `Ms(T)`, `A(T)`, `Ku(T)`, `alpha(T)`, a dopiero
następnie dodać **`LLB` jako osobny rodzaj dynamiki**. To nie jest kompromis „byle szybciej”, tylko
rozsądna strategia architektoniczna: pierwszy krok pokrywa najczęstsze zastosowania mikromagnetyczne
(aktywizacja termiczna, termiczny rozrzut trajektorii, switching, domeny, skyrmiony, szum termiczny),
a drugi krok przejmuje obszar blisko `Tc`, gdzie klasyczne `LLG` z ustaloną długością `|m|=1` zaczyna
być fizycznie niewystarczające.

# Krótka mapa modeli temperatury

Poniższa mapa jest ważniejsza niż pojedyncza odpowiedź „ten model jest najlepszy”, bo porządkuje **do czego** służy każdy poziom:

1. **Poziom 1 — `LLG + Brown thermal field`**  
   **Opisuje:** fluktuacje termiczne i aktywację.  
   **Najlepszy gdy:** temperatura jest niska lub umiarkowana, a `|m|≈1`.  
   **Priorytet dla FullMag:** **najpierw**.

2. **Poziom 2 — `LLG + Brown + parametry zależne od T`**  
   **Opisuje:** szum oraz wpływ `T` na współczynniki materiałowe.  
   **Najlepszy gdy:** występują gradienty temperatury, wolniejsze nagrzewanie, transport domen i skyrmionów.  
   **Priorytet dla FullMag:** **od razu lub zaraz po kroku 1**.

3. **Poziom 3 — `LLB`**  
   **Opisuje:** fluktuacje i relaksację podłużną.  
   **Najlepszy gdy:** interesują nas okolice `Tc`, stany powyżej `Tc`, HAMR albo impulsy cieplne.  
   **Priorytet dla FullMag:** **drugi duży etap**.

4. **Poziom 4 — `2TM/3TM + LLB`**  
   **Opisuje:** sprzężenie elektronów, fononów i spinu.  
   **Najlepszy gdy:** modelujemy ultrafast, lasery lub gwałtowne grzanie.  
   **Priorytet dla FullMag:** **etap zaawansowany**.

5. **Poziom 5 — atomistyka / multiscale handoff**  
   **Opisuje:** poprawną termodynamikę poza zakresem coarse-grained micromagnetics.  
   **Najlepszy gdy:** potrzebna jest kalibracja, weryfikacja i badania referencyjne.  
   **Priorytet dla FullMag:** **ścieżka badawcza / referencyjna**.


# Stan FullMag dzisiaj i dlaczego to ma znaczenie

FullMag nie jest „tylko kolejnym solverem”, lecz platformą z mocnym rozdziałem:

**semantyka fizyczna → kanoniczne `ProblemIR` → planner / capability matrix → backend**.

To jest bardzo dobra wiadomość, bo temperatura jest problemem, który łatwo zaimplementować źle:
jako backendowy hack, jako niejawny parametr albo jako pseudofizyka sklejana z kilku rozłącznych opcji.

Z punktu widzenia temperatury FullMag ma już dziś kilka ważnych cech:

- warstwa Python opisuje **problem fizyczny**, a nie konkretną siatkę backendu,
- `ProblemIR` jest backend-neutralny,
- projekt wymusza notesy fizyczne w `docs/physics/` przed wdrażaniem nowych modeli,
- istnieje capability matrix rozróżniająca semantykę od publicznie wykonywalnych ścieżek,
- publicznie uczciwy, kwalifikowany wycinek to nadal głównie **FDM + `LLG(heun)`**.

Z tego wynikają trzy twarde wnioski:

1. **temperatury nie wolno dopisać wyłącznie w jądrze CUDA**, bo to łamie filozofię projektu;
2. **temperatury nie wolno utożsamić z nowym `EnergyTerm`**, bo część jej semantyki siedzi w dynamice, RNG i `dt`;
3. **dokumentacja fizyczna musi wyprzedzać kod**, bo inaczej powstaną sprzeczne interpretacje między CPU, CUDA, FEM i plannerem.

# Co dokładnie oznacza „temperatura” w mikromagnetyzmie?

W praktyce to słowo ma kilka różnych znaczeń. Architektura FullMag powinna rozdzielać je jawnie.

## Temperatura jako źródło fluktuacji termicznych

To jest klasyczny model Brownowski: do pola efektywnego dodawane jest losowe pole `H_therm`,
które spełnia związek fluktuacja–dysypacja. Ten model odpowiada za:

- aktywację termiczną nad barierą,
- rozrzut czasów przełączenia,
- termiczny rozmyty switching,
- fluktuacje małokątowe,
- wpływ temperatury na trajektorie pojedynczych realizacji i na obserwable ensemble.

## Temperatura jako pole przestrzenno-czasowe `T(x,t)`

To nie jest jeszcze model szumu, tylko źródło temperatury:

- stała jednorodna temperatura,
- gradient temperatury,
- lokalne nagrzanie,
- impuls czasowy,
- pole z zewnętrznego solvera ciepła,
- rozwiązanie równania przewodnictwa ciepła lub `2TM`.

To pole powinno być semantycznie jawne i niezależne od tego, czy zasila `sLLG`, `LLB` albo tylko prawa materiałowe.

## Temperatura jako argument praw materiałowych

Wiele współczynników jest zależnych od temperatury:

- `Ms(T)`,
- `A(T)`,
- `Ku(T)`,
- czasem `alpha(T)`,
- w `LLB` również `m_e(T)`, `chi_parallel(T)`, `chi_perp(T)`.

To nie jest jeszcze osobny solver cieplny; to tylko fakt, że materiał nie ma stałych parametrów w całym zakresie `T`.

## Temperatura jako wejście do modelu z relaksacją podłużną

To jest obszar `LLB`. Gdy temperatura rośnie w okolice `Tc`, albo gdy ogrzewanie jest na tyle silne i szybkie,
że długość magnetyzacji nie jest zachowana, zwykłe `LLG` z `|m|=1` staje się niewystarczające.

## Temperatura jako problem wieloskalowy

Przy grubszej dyskretyzacji i wyższych temperaturach standardowa mikromagnetyka może wymagać:

- renormalizacji związanej z coarse-grainingiem,
- kalibracji współczynników na podstawie atomistyki,
- bardzo ostrożnych deklaracji co do zakresu ważności.

# Zasada projektowa numer 1: temperatura to nie jest zwykły składnik energii

To jest najważniejsza decyzja architektoniczna.

**Nie należy modelować temperatury w FullMag jako kolejnego `EnergyTerm`, obok `Exchange`, `Demag`, `Zeeman`.**

Dlaczego?

1. Pole termiczne nie jest zwykłym polem deterministycznym wyprowadzonym z funkcjonału energii.
2. Szum termiczny zależy od:
   - temperatury,
   - tłumienia,
   - objętości nośnika dyskretyzacji,
   - kroku czasowego,
   - generatora liczb losowych.
3. Część semantyki temperatury siedzi więc w **dynamice** i **polityce kroku czasu**.
4. Dla `LLB` temperatura zmienia samo znaczenie stanu i normy magnetyzacji.
5. W modelach `2TM/3TM` temperatura jest stanem dodatkowego problemu PDE/ODE, a nie składnikiem energii magnetycznej.

**Rekomendacja dla FullMag:**

- `energy[]` zostawić dla deterministycznych oddziaływań typu `Exchange`, `Demag`, `DMI`, `Zeeman`, `Anisotropy`, ...
- temperaturę wprowadzić przez:
  - `thermal_model` / `thermostat` w `DynamicsIR`,
  - jawne `TemperatureField`,
  - `MaterialTemperatureLaws`.

# Zasada projektowa numer 2: rozdzielić trzy byty

## 1. Pole temperatury

Mówi **jakie jest `T`** w przestrzeni i czasie.

Przykłady:

- `UniformTemperature(300 K)`,
- `AnalyticTemperature(T(x,t))`,
- `SampledTemperature(values=[...])`,
- `ImportedTemperatureField(file=...)`,
- `TwoTemperatureModel(...)`.

## 2. Model termiczny dynamiki

Mówi **co solver magnetyzacji robi z temperaturą**.

Przykłady:

- `NoThermalNoise`,
- `BrownThermalField`,
- `LLB`,
- `StochasticLLB`,
- `AnnealingSchedule`.

## 3. Prawa materiałowe zależne od temperatury

Mówią **jak parametry materiałowe zależą od `T`**.

Przykłady:

- `Ms(T)` z tabeli,
- `A(T)` jako potęga `m_e(T)`,
- `Ku(T)` zgodnie z Callen–Callen,
- `alpha(T)` z tabeli eksperymentalnej,
- `chi_parallel(T)` i `chi_perp(T)` dla `LLB`.

Ten podział daje FullMag bardzo czystą semantykę: to samo `T(x,t)` może jednocześnie zasilać amplitudę szumu,
aktualizować `Ms(T)` i `A(T)`, sterować `LLB` i pochodzić albo z prostego stałego źródła, albo z `2TM`.

# Rekomendowana architektura docelowa dla FullMag

Najlepsza architektura to **warstwowy system temperatury**:

1. **Warstwa semantyczna**
   - jawny `TemperatureField`,
   - jawny `ThermalModel`,
   - jawne prawa materiałowe `Parameter(T)`.

2. **Warstwa IR / planner**
   - walidacja zgodności modelu z backendem i trybem,
   - capability matrix,
   - ostrzeżenia o zakresie ważności fizycznej,
   - decyzje o obniżeniu zakresu wsparcia z `public-executable` do `internal-reference`.

3. **Warstwa backendowa**
   - FDM: public-executable najpierw,
   - FEM: najpierw semantic/internal-reference,
   - hybrid: po ustaleniu mapowania temperatury między reprezentacjami.

4. **Warstwa walidacji**
   - testy deterministyczne,
   - testy statystyczne,
   - testy ensemble,
   - testy CPU vs CUDA,
   - testy zakresu ważności fizycznej.

## Proponowane etapy

### Etap A — pierwszy release temperatury

**Cel:** dodać temperaturę do obecnego publicznego FDM `LLG(heun)` bez psucia semantyki projektu.

Zakres:

- `BrownThermalField`,
- `UniformTemperature`,
- opcjonalnie `SampledTemperatureField` dla FDM,
- `Ms(T), A(T), Ku(T), alpha(T)` jako proste tabele / prawa potęgowe,
- seed, provenance, RNG policy,
- testy statystyczne.

To jest **najlepszy pierwszy krok**.

### Etap B — podniesienie jakości i zakresu

- wsparcie adaptive stepping przy `T > 0`,
- polityka odrzucania kroków i skalowania tego samego przyrostu Wienera,
- rozbudowane outputy i diagnostyka,
- statyczne i dynamiczne pole temperatury,
- pierwszy solver ciepła jako źródło `T(x,t)`.

### Etap C — `LLB`

- osobny `DynamicsIR::Llb`,
- nowe prawa materiałowe i nowe wyjścia,
- aktualizacja semantyki `m`,
- walidacja z atomistyką i literaturą dla temperatur bliskich `Tc`.

### Etap D — `2TM/3TM` i tryb ultrafast

- zasilanie `LLB` temperaturą elektronową i/lub sieciową,
- impuls laserowy / Joule heating,
- sprzężenia wielofizyczne.

# Model 1: Brownowskie pole termiczne w LLG (sLLG)

To jest rekomendowany **pierwszy model produkcyjny** dla FullMag.

## Co ten model robi dobrze?

- dodaje fluktuacje termiczne do istniejącej infrastruktury `LLG`,
- zachowuje aktualną semantykę stanu `|m| = 1`,
- dobrze pasuje do obecnego FDM + Heun,
- jest standardem praktycznym w kodach mikromagnetycznych,
- daje poprawny pierwszy krok do switchingu termicznego, aktywacji i rozkładów trajektorii,
- nie wymusza od razu zmiany całej polityki `ProblemIR`.

## Kiedy to jest dobry model?

- daleko od `Tc`,
- gdy zakładamy, że długość zredukowanej magnetyzacji pozostaje ~stała,
- dla procesów, gdzie najważniejsze są fluktuacje orientacji, a nie zanik amplitudy `M`.

Praktyczna heurystyka:

- bardzo sensowny dla **niskich i umiarkowanych temperatur**,
- wymaga ostrożności przy temperaturach zbliżających się do `Tc`,
- nie powinien być reklamowany jako pełny model termodynamiki w okolicy przejścia fazowego.

## Równanie

W konwencji zgodnej z obecnymi notami FullMag można pisać:

```text
dm/dt = -(gamma / (1 + alpha^2)) *
        [ m × H_eff + alpha * m × (m × H_eff) ]

H_eff = H_det + H_therm
```

gdzie:

- `m` – zredukowana magnetyzacja,
- `gamma` – zredukowany współczynnik giromagnetyczny używany już w FullMag,
- `alpha` – tłumienie,
- `H_det` – deterministyczna część pola efektywnego,
- `H_therm` – losowe pole termiczne.

Dla białego szumu Brownowskiego najważniejszy jest nie tyle sam wzór na pojedynczą realizację,
ile **zamrożenie dokładnej konwencji korelacji i jednostek** w notatce fizycznej. W zależności od tego,
czy w danej formulacji używa się pola `H` w `A/m`, pola `B` w `T`, czy `gamma`/`gamma_0`,
w literaturze pojawiają się równoważne warianty z różnym położeniem czynników `mu0` lub `(1+alpha^2)`.

Praktyczna zasada dla FullMag powinna być taka:

> Nie kopiować „wzoru z internetu” na amplitudę szumu bez zamrożenia konwencji.
> W notatce `docs/physics/0600-...` trzeba zdefiniować:
> - jaką postać LLG przyjmuje FullMag,
> - w jakich jednostkach przechowywane są pola solverowe,
> - jaka dokładnie jest korelacja `H_therm`,
> - jaki wzór dyskretny w czasie realizuje ten związek.

## Co trzeba zamrozić jako kontrakt fizyczny?

### Jednostki

- `T` w kelwinach,
- `H_therm` wewnętrznie w `A/m`,
- `dt` w sekundach,
- `Ms` w `A/m`,
- objętość nośnika dyskretyzacji:
  - FDM: objętość komórki aktywnej,
  - FEM: odpowiednia objętość / waga związana z nośnikiem funkcji bazowych.

### Statystyka szumu

Wymagania minimalne:

- średnia zero,
- brak korelacji między komponentami,
- brak korelacji między różnymi nośnikami dyskretyzacji,
- amplituda zgodna z FDT,
- ten sam losowy przyrost używany w całym akceptowanym kroku,
- poprawna obsługa odrzuceń kroku przy adaptacji.

### Interpretacja stochastyczna

Dla praktyki mikromagnetycznej i zgodności z typowymi implementacjami należy przyjąć
**Stratonovich-compatible discretization** i od razu ograniczyć pierwszą publiczną wersję do
schematów, które mają jasny sens w tym reżimie:

- `heun` fixed-step jako MVP,
- potem `rk45` w wariancie zgodnym z podejściem Leliaerta.

### Normowanie `|m| = 1`

W modelu Brownowskiego `LLG` stan nadal leży na sferze:

- po predyktorze,
- po korektorze,
- ewentualnie po każdym etapie zdefiniowanym przez solver.

To jest zgodne z aktualnym profilem FullMag i nie wymaga zmiany semantyki `m`.

## Dlaczego to pasuje do FullMag szczególnie dobrze?

Aktualny FullMag ma:

- `LLG` w Pythonie i `ProblemIR`,
- `heun` jako publiczną bazę,
- plan dla wyższych i adaptacyjnych integratorów,
- FDM jako jedyną publiczną ścieżkę solverową,
- architekturę outputów opartą o kanoniczne nazwy pól i skalarów.

Brownowski `sLLG` można do tego dobudować bez przeprojektowywania całego stosu.



# Jak zaimplementować `sLLG` najlepiej w FullMag

## MVP powinien być prosty i rygorystyczny

Najlepszy MVP:

- backend: **FDM public-executable**,
- całkowanie: **`heun` + fixed `dt`**,
- temperatura: **`UniformTemperature`**,
- RNG: **counter-based RNG** z deterministycznym seedem,
- wyjścia: `H_therm`, `H_eff_det`, `H_eff`, `T`,
- walidacja: makrospin + ensemble + porównanie CPU/CUDA.

To nie jest „najmniejszy możliwy feature”, ale **najmniejszy feature, który jest naukowo uczciwy**.

## Czego nie robić w MVP

Nie należy:

- włączać od razu wszystkich integratorów z `SUPPORTED_INTEGRATORS`,
- udawać, że thermal `abm3` jest oczywisty,
- wypychać thermal do FEM bez definicji słabego wymuszenia zgodnego z FDT,
- traktować `E_therm` jak zwykłego wkładu do energii całkowitej,
- budować temperatury jako listy tysięcy regionów, żeby zasymulować gradient,
- twierdzić, że `LLG+noise` jest poprawne w pobliżu `Tc` bez zastrzeżeń.

## Dokładne kroki implementacyjne

### Krok 1 — wprowadzić jawne pole temperatury

Najpierw FullMag powinien mieć byt reprezentujący temperaturę, niezależnie od modelu dynamiki.

Przykładowe warianty:

- `UniformTemperature(value=300.0)`,
- `AnalyticTemperature(expr="300 + 50*x/Lx")`,
- `SampledTemperatureField(values=...)`,
- `ImportedTemperatureField(path=..., field_name="T")`,
- `HeatEquation(...)`,
- `TwoTemperatureModel(...)`.

### Krok 2 — wprowadzić model termiczny do `DynamicsIR`

Temperatura powinna siedzieć przy dynamice, np.:

```text
DynamicsIR::Llg {
    gamma,
    alpha_source,
    integrator,
    time_step_policy,
    thermal_model: None | BrownThermalField { ... }
}
```

Nie jako `EnergyTermIR::Thermal`.

### Krok 3 — zamrozić politykę RNG

Najlepsze rozwiązanie dla FullMag to **counter-based RNG**:

- CPU i CUDA mogą używać tej samej rodziny generatora,
- wynik jest niezależny od liczby wątków i kolejności uruchamiania,
- losowość da się związać z `(seed, step, cell, component, attempt)`.

Rekomendowane klucze:

```text
rng_key = (
    global_seed,
    thermal_epoch,
    cell_id,
    component_id,
    attempt_id
)
```

gdzie:

- `thermal_epoch` zwiększa się po **zaakceptowanym** kroku,
- `attempt_id` rozróżnia odrzucenia kroku w solverze adaptacyjnym.

### Krok 4 — ustalić politykę kroku czasu

W fixed-step sprawa jest prosta:

- dla każdej komórki i komponentu generujemy `N(0,1)`,
- skalujemy przez amplitudę zależną od `T`, `alpha`, `Ms`, `V`, `dt`,
- trzymamy to pole stałe w całym kroku Heuna.

W adaptive-step trzeba pilnować jednej rzeczy:

> Przy odrzuconym kroku nie wolno po prostu losować nowego szumu i udawać, że nic się nie stało.

Trzeba zachować tę samą realizację przyrostu Wienera w sensie zgodnym z polityką solwera.
W praktyce oznacza to albo:

- ponowne użycie tego samego wektora losowego przy odpowiednim przeskalowaniu przez `sqrt(dt_old/dt_new)`,
- albo bardziej formalną konstrukcję Brownian bridge, jeśli solver będzie dalej rozwijany.

### Krok 5 — wyraźnie oddzielić pola deterministyczne i stochastyczne w outputach

Bardzo polecam następujący zestaw:

- `H_eff_det` – suma deterministycznych pól aktywnych oddziaływań,
- `H_therm` – chwilowa próbka pola termicznego,
- `H_eff` – pole rzeczywiście użyte przez solver, czyli `H_eff_det + H_therm`,
- `T` – użyta temperatura lokalna lub pole temperatury,
- `rng_seed` / `rng_algorithm` / `thermal_epoch` – provenance i debug.

To rozwiązuje dwa klasyczne problemy:

1. użytkownik może analizować „czystą fizykę” bez szumu i „solver reality” osobno,
2. nie ma niejednoznaczności, czy `H_eff` zawiera szum.

## Jak liczyć amplitudę szumu w praktyce

Dokument fizyczny FullMag powinien zamrozić jedną kanoniczną konwencję. W praktyce implementacyjnej
wygodnie jest rozdzielić wzór na część geometryczno-materiałową i część temperaturowo-czasową.

W FDM można organizować to tak:

```text
sigma_i(dt) = base_i * sqrt(T_i / dt)

base_i = sqrt(C * alpha_i / (Ms_i * V_i))
```

gdzie `C` reprezentuje cały zamarznięty pakiet stałych fizycznych w przyjętej konwencji `LLG/H/B/gamma`.

To rozwiązanie ma dużą zaletę inżynierską:

- jeśli `Ms_i`, `alpha_i`, `V_i` są stałe, `base_i` można prekomputować,
- jeśli zmienia się tylko `T`, aktualizacja jest tania,
- jeśli zmienia się `dt`, przeskalowanie jest bardzo proste.

## Jak liczyć objętość nośnika szumu

### FDM

W FDM jest najłatwiej:

```text
V_i = dx * dy * dz * fill_fraction_i
```

gdzie `fill_fraction_i` może być w przyszłości uogólnieniem na komórki częściowo aktywne.

### FEM

W FEM nie wystarczy „losować szum na węzeł” bezmyślnie. Trzeba zdefiniować, co jest nośnikiem
stochastycznego wymuszenia w słabej postaci i jak jego kowariancja ma się do macierzy masy / lumpingu.
To jest osobny problem fizyczno-numeryczny.

**Rekomendacja:** thermal FEM powinien wejść dopiero po osobnej notatce fizycznej i walidacji.

## Jak wyznaczać `Ms(T)`, `A(T)`, `Ku(T)`, `alpha(T)`

Najlepsza polityka FullMag to:

1. **najpierw tablice / krzywe użytkownika**,
2. dopiero potem specjalne uproszczone prawa „wygodne”.

To znaczy:

- bazowym nośnikiem powinno być `Tabulated1D(T -> value)`,
- na tym można budować wygodne aliasy:
  - `CriticalLaw`,
  - `PowerLawFromReducedMagnetization`,
  - `CallenCallen`.

Nie odwrotnie.

Powód jest prosty: wartości rzeczywiste są materiałowo zależne. Nie istnieje jeden „globalny” wzór
na `A(T)` albo `alpha(T)`, który byłby bezpieczny do zakodowania jako domyślna prawda.

## Jak zachować zgodność z obecną filozofią regionów i pól

FullMag już teraz rozdziela:

- topologię,
- bazowe materiały,
- przypisania materiałowe,
- gładkie i próbkowane pola parametrów.

To idealnie pasuje do temperatury. W szczególności:

- **nie wolno** modelować gradientu temperatury przez tysiące regionów,
- **nie wolno** wciskać zależności `Ms(T)` do osobnej sztucznej siatki regionów,
- **należy** potraktować temperaturę jako kolejny typ pola współczynników.




# Model 2: prawa materiałowe zależne od temperatury

Drugi element dobrej architektury temperatury to nie szum, tylko **aktualizacja parametrów materiałowych**.

Jeżeli FullMag ma być przydatny do realnych badań, to wsparcie dla `Ms(T)`, `A(T)` i `Ku(T)` jest niemal tak samo ważne,
jak samo `H_therm`.

## Dlaczego to jest ważne

Bez tego użytkownik może dostać model, który:

- ma „jakąś” temperaturę w szumie,
- ale nadal używa zerotemperaturowych parametrów materiału,
- co bywa fizycznie gorsze niż brak temperatury.

Przykłady:

- `Ms` maleje z temperaturą,
- `A` jest temperaturzo-zależne i wpływa na szerokość ścian domenowych, długości charakterystyczne, energię wymiany,
- `Ku` może silnie maleć z temperaturą, często zgodnie z prawami typu Callen–Callen lub inną zależnością materiałową,
- `alpha(T)` bywa istotne przy silnym grzaniu i zjawiskach blisko `Tc`.

## Jak to reprezentować semantycznie

Najlepszy model w Python DSL to osobny obiekt praw temperatury, np.:

```python
temperature_laws = fm.TemperatureLaws(
    Ms=fm.Tabulated1D(
        points=[
            (0.0,   1.10e6),
            (300.0, 1.02e6),
            (600.0, 0.74e6),
            (800.0, 0.15e6),
        ],
        interpolation="pchip",
        extrapolation="clamp",
    ),
    A=fm.PowerLawFromReducedMagnetization(
        value0=15e-12,
        reduced_magnetisation="Ms/Ms0",
        exponent=1.8,
    ),
    Ku=fm.CallenCallen(
        value0=0.6e6,
        order=2,
        reduced_magnetisation="Ms/Ms0",
    ),
    alpha=fm.Tabulated1D(
        points=[
            (0.0,   0.010),
            (300.0, 0.015),
            (600.0, 0.030),
            (800.0, 0.080),
        ]
    ),
)
```

Takie API ma kilka zalet:

- jest czytelne dla użytkownika,
- daje się bezproblemowo zserializować do `ProblemIR`,
- nie wymaga przekazywania raw-Python-callables do backendu,
- łatwo walidować zakres temperatur i ekstrapolację.

## Jak to serializować do `ProblemIR`

W `ProblemIR` powinno to być kanoniczne i jawne. Na przykład:

```json
{
  "temperature_laws": {
    "saturation_magnetisation": {
      "kind": "tabulated_1d",
      "interpolation": "pchip",
      "extrapolation": "clamp",
      "points": [
        [0.0,   1100000.0],
        [300.0, 1020000.0],
        [600.0, 740000.0],
        [800.0, 150000.0]
      ]
    },
    "exchange_stiffness": {
      "kind": "power_law_from_reduced_magnetisation",
      "reference": "saturation_magnetisation",
      "value0": 1.5e-11,
      "exponent": 1.8
    },
    "uniaxial_anisotropy": {
      "kind": "callen_callen",
      "value0": 600000.0,
      "order": 2,
      "reference": "saturation_magnetisation"
    },
    "damping": {
      "kind": "tabulated_1d",
      "interpolation": "linear",
      "extrapolation": "clamp",
      "points": [
        [0.0, 0.01],
        [300.0, 0.015],
        [600.0, 0.03],
        [800.0, 0.08]
      ]
    }
  }
}
```

## Zasada: żadnych surowych callbacków w kanonicznym IR

Python może być wygodny, ale `ProblemIR` musi pozostać reprodukowalny i serializowalny.
Dlatego:

- w Pythonie można ewentualnie pozwolić na callable jako warstwę convenience,
- ale przed serializacją należy zamienić go na tablicę, krzywą lub inną kanoniczną reprezentację.

W przeciwnym razie tracimy:

- reprodukowalność,
- backend-neutralność,
- możliwość walidacji plannerem,
- stabilny zapis manifestu / provenance.

## Jak łączyć temperaturę z polami przestrzennymi

FullMag już ma np. `Ms_field`, `A_field`, `alpha_field`. W temperaturze pojawia się naturalne pytanie:

> Czy finalny współczynnik to `field(x) * law(T)` czy `law(x, T)`?

Najlepsza odpowiedź architektoniczna brzmi:

1. semantycznie wspierać oba przypadki,
2. ale na poziomie IR mieć jasny model składania.

Przykładowa polityka:

```text
effective_parameter(x,t) = base_region_value(x) * spatial_modifier(x) * temperature_modifier(T(x,t))
```

albo – gdy trzeba – jawny tryb:

```text
combination = "multiply" | "replace" | "compose"
```

To pozwala wspierać zarówno prosty przypadek region+T, jak i bardziej wyrafinowane pola próbkowane.

## Kiedy planner powinien ostrzegać

Planner powinien zgłaszać ostrzeżenie lub błąd, gdy:

- `Ms(T)` przechodzi przez zero, a użytkownik wciąż żąda `LLG`,
- zakres `T` używany w problemie wychodzi poza tabelę i ekstrapolacja nie jest jawnie zdefiniowana,
- `A(T)` staje się ujemne,
- `alpha(T)` wychodzi poza fizycznie sensowny zakres,
- użytkownik próbuje robić `Brown + Ms(T≈0)` bez świadomości, że to obszar dla `LLB`.




# Model 3: LLB – kiedy i jak wprowadzić go do FullMag

`LLB` nie jest „dodatkową opcją solvera obok `heun`”, tylko **innym modelem dynamiki magnetyzacji**.

To bardzo ważne rozróżnienie.

## Po co `LLB`

Klasyczne `LLG` z polem Brownowskim dobrze opisuje fluktuacje orientacji przy założeniu, że
długość magnetyzacji jest praktycznie stała. W pobliżu `Tc` założenie to przestaje być wystarczające.

Wtedy potrzebny jest model, który umie opisać:

- relaksację podłużną,
- zmianę długości magnetyzacji,
- temperaturzo-zależne tłumienie poniżej i powyżej `Tc`,
- zachowanie w bardzo gorących i/lub bardzo szybkich procesach.

## Dlaczego `LLB` powinno być osobnym `DynamicsIR::Kind`

Najlepszy wzorzec dla FullMag:

```text
DynamicsIR =
    Llg { ... }
  | Llb { ... }
  | RelaxationOverdamped { ... }
  | ...
```

a nie:

```text
LLG(mode="llb")
```

Powody:

1. `LLB` ma inne równanie,
2. `LLB` ma inne parametry materiałowe,
3. `LLB` ma inne wymagania walidacyjne,
4. `LLB` zmienia semantykę normy stanu,
5. `LLB` będzie mieć inne ograniczenia backendowe i jakościowe.

## Najtrudniejsza decyzja semantyczna: co oznacza `m` w `LLB`?

To jest jeden z najważniejszych punktów całej przyszłej implementacji.

Obecna dokumentacja outputów FullMag opisuje `m` jako zredukowaną magnetyzację `M/Ms`.
To działa świetnie przy klasycznym `LLG`, gdzie `Ms` jest traktowane jako stałe odniesienie
i `|m|=1`.

W `LLB` to przestaje być oczywiste. Trzeba wybrać jedną politykę:

### Opcja A — `m = M / Ms0`

gdzie `Ms0` jest referencyjną magnetyzacją nasycenia przy temperaturze odniesienia (np. 0 K lub 300 K).

**Zalety:**
- `|m|` niesie informację o relaksacji podłużnej,
- łatwiej porównać stany przy różnych temperaturach,
- dobrze pasuje do `m_e(T)`.

**Wady:**
- wymaga doprecyzowania obecnych outputów i dokumentów.

### Opcja B — `m = M / Ms(T)`

**Zalety:**
- zachowuje pozorną zgodność z dawną definicją.

**Wady:**
- zaciera podłużną dynamikę,
- czyni interpretację `|m|` nieintuicyjną,
- komplikuje porównania między temperaturami.

**Rekomendacja:** dla `LLB` przejść na **jawne odniesienie do `Ms_ref` / `Ms0`** i udokumentować to osobno.
Warto nawet rozważyć dwa wyjścia:

- `m_ref = M / Ms_ref`,
- `m_inst = M / Ms(T)` – opcjonalnie jako diagnostyka.

## Jakie prawa materiałowe są potrzebne dla `LLB`

Minimalnie:

- `m_e(T)` – równowagowa zredukowana magnetyzacja,
- `chi_parallel(T)`,
- `chi_perp(T)` albo równoważny zestaw parametrów,
- często również `A(T)` i/lub inne współczynniki zależne od temperatury.

Najbezpieczniejsze źródła danych:

1. eksperyment,
2. atomistic spin dynamics / Monte Carlo,
3. dobrze opisane dopasowania literaturowe.

## Kiedy planner ma sugerować przejście z `LLG` do `LLB`

Bardzo sensowne reguły:

- jeżeli `Tc` jest znane i `max(T) >= 0.75 * Tc`, zgłaszaj ostrzeżenie: `LLG+Brown may be physically insufficient; consider LLB`,
- jeżeli `Ms(T)` zmierza do zera, a dynamika nadal jest `LLG`, zgłaszaj błąd,
- jeżeli problem deklaruje `ultrafast_heat_pulse=true`, planner powinien zasugerować `LLB` lub `LLB+2TM`,
- jeżeli użytkownik próbuje przejść przez `Tc` w klasycznym `LLG`, planner powinien odrzucić konfigurację jako `strict` albo co najmniej mocno ostrzec w `extended`.

## Co nie powinno trafić do pierwszej wersji `LLB`

Nie należy próbować wdrażać od razu wszystkiego:

- ferrimagnetycznych wielu podsieci,
- pełnego `sLLB` dla wszystkich backendów,
- wszystkich wariantów temperatury elektronowej / sieciowej,
- pełnego FEM public-executable.

Najpierw:

- `ferromagnetic single-lattice LLB`,
- dobrze zamrożony zestaw praw materiałowych,
- benchmarki na makrospinie i prostych nanocząstkach,
- jedna uczciwa ścieżka wykonawcza.




# Model 4: `2TM` / `3TM` i równanie ciepła

Dużo rozmów o „modelu temperatury” tak naprawdę dotyczy nie samego `LLG` czy `LLB`,
tylko tego, **skąd bierze się `T(x,t)`**.

To jest osobna warstwa problemu.

## Zasada architektoniczna

`2TM`, `3TM` i równanie przewodnictwa ciepła powinny w FullMag występować jako **źródła pola temperatury**,
a nie jako konkurencyjne modele dynamiki magnetycznej.

Innymi słowy:

- `thermal_source` / `temperature_field` mówi, jakie jest `T`,
- `thermal_model` mówi, jak magnetyzacja reaguje na `T`.

## Minimalny model ciepła

Na początku w zupełności wystarczy obsłużyć:

- `UniformTemperature`,
- `AnalyticTemperature`,
- `SampledTemperatureField`,
- `ImportedTemperatureField`.

To już pokrywa bardzo dużo praktycznych zastosowań.

## Równanie ciepła

Docelowo można dodać prosty solver przewodnictwa ciepła:

```text
C(T) * dT/dt = ∇·(k(T) ∇T) + Q(x,t)
```

gdzie:

- `C(T)` – pojemność cieplna,
- `k(T)` – przewodnictwo cieplne,
- `Q(x,t)` – źródło ciepła (laser, Joule, inne).

## Two-temperature model

Dla ultrafast i laserów potrzebny bywa model:

```text
Ce(Te) * dTe/dt = ∇·(ke ∇Te) - G(Te - Tl) + P(x,t)
Cl(Tl) * dTl/dt = ∇·(kl ∇Tl) + G(Te - Tl)
```

i wtedy trzeba jeszcze zdecydować, do której temperatury sprzęgamy magnetyzację:

- do `Te`,
- do `Tl`,
- do mieszanki / mapowania użytkownika.

**To mapowanie powinno być jawne**. Nie wolno ukrywać go w backendzie.

Przykład:

```python
fm.TwoTemperatureModel(
    electron_heat_capacity=...,
    lattice_heat_capacity=...,
    electron_conductivity=...,
    lattice_conductivity=...,
    electron_lattice_coupling=...,
    source=fm.GaussianLaserPulse(...),
    magnetic_coupling="electron",   # albo "lattice" / "weighted"
)
```

## Dlaczego to nie powinno być pierwszym krokiem

Bo `2TM` bez dobrze zdefiniowanego `sLLG` lub `LLB` nadal nie daje kompletnej odpowiedzi magnetycznej.
To jest raczej warstwa sterująca dla pola temperatury niż pierwszy model magnetyczny.

# Który model jest „najlepszy” w zależności od zastosowania?

## Termicznie aktywowany switching i rozrzut czasu przełączenia

Najlepszy pierwszy wybór:

- `LLG + Brown`,
- fixed-step Heun lub dobrze zwalidowany adaptive solver,
- ewentualnie `Ms(T)` i `Ku(T)` jeśli zakres temperatury nie jest mały.

## Domeny, skyrmiony i gradienty temperatury

Najlepszy wybór:

- `LLG + Brown`,
- `T(x,t)` jawne,
- `A(T)`, `Ms(T)`, `Ku(T)` jawne,
- ostrożna walidacja transportu pod wpływem gradientu `T`.

## HAMR / silne grzanie / okolice `Tc`

Najlepszy wybór:

- `LLB`,
- `Ms(T)` lub `m_e(T)`,
- `chi_parallel(T)`,
- często także `2TM`.

## Ultrafast laser dynamics

Najlepszy wybór:

- `LLB + 2TM`,
- z jawnym wskazaniem, czy magnetyzacja sprzęga się do temperatury elektronów czy sieci.

## Kalibracja i zakresy graniczne

Najlepsza strategia:

- atomistic reference / multiscale calibration,
- walidacja krzywych `Ms(T)`, `A(T)`, `Ku(T)`,
- ostrożna deklaracja zakresu ważności coarse-grained solvera.




# Rekomendowana semantyka Python API

Poniżej proponuję spójny, praktyczny kształt API dla `fullmag-py`.

## Proponowane obiekty

- `TemperatureField`
- `UniformTemperature`
- `AnalyticTemperature`
- `SampledTemperatureField`
- `ImportedTemperatureField`
- `HeatEquation`
- `TwoTemperatureModel`
- `TemperatureLaws`
- `Tabulated1D`
- `CriticalLaw`
- `PowerLawFromReducedMagnetization`
- `CallenCallen`
- `BrownThermalField`
- `LLB`
- `LLBThermalNoise` albo po prostu `stochastic=True` w `LLB`

## Proponowany styl użycia

```python
import fullmag as fm

mat = fm.Material(
    name="CoFeB",
    Ms=1.10e6,
    A=15e-12,
    alpha=0.015,
    temperature_laws=fm.TemperatureLaws(
        Ms=fm.Tabulated1D(
            points=[
                (0.0,   1.10e6),
                (300.0, 1.02e6),
                (600.0, 0.74e6),
                (800.0, 0.15e6),
            ],
            interpolation="pchip",
            extrapolation="clamp",
        ),
        A=fm.PowerLawFromReducedMagnetization(
            value0=15e-12,
            reduced_magnetisation="Ms/Ms0",
            exponent=1.8,
        ),
        Ku=fm.CallenCallen(
            value0=0.6e6,
            order=2,
            reduced_magnetisation="Ms/Ms0",
        ),
        alpha=fm.Tabulated1D(
            points=[
                (0.0,   0.010),
                (300.0, 0.015),
                (600.0, 0.030),
                (800.0, 0.080),
            ]
        ),
        Tc=850.0,
    ),
)

temperature = fm.UniformTemperature(300.0)

dynamics = fm.LLG(
    gamma=2.211e5,
    integrator="heun",
    fixed_timestep=1e-13,
    thermal_model=fm.BrownThermalField(
        temperature=temperature,
        seed=123456,
        stochastic_calculus="stratonovich",
    ),
)

problem = fm.Problem(
    magnets=[
        fm.Ferromagnet(
            geometry=fm.Box((128e-9, 64e-9, 1e-9)),
            material=mat,
            m0=fm.vortex(clockwise=True),
        )
    ],
    energy=[
        fm.Exchange(),
        fm.Demag(),
        fm.Zeeman(H=(0.0, 0.0, 10e-3 / fm.mu0)),
    ],
    study=fm.TimeEvolution(
        dynamics=dynamics,
        t_end=5e-9,
        outputs=[
            fm.FieldOutput("m", every=5e-12),
            fm.FieldOutput("H_eff_det", every=5e-12),
            fm.FieldOutput("H_therm", every=5e-12),
            fm.FieldOutput("H_eff", every=5e-12),
            fm.FieldOutput("T", every=5e-12),
            fm.ScalarOutput("E_total", every=5e-12),
            fm.ScalarOutput("max_h_eff", every=5e-12),
        ],
    ),
    backend_hint=fm.FDM(cell_size=(2e-9, 2e-9, 1e-9)),
)
```

## Dlaczego takie API jest dobre

- jest zgodne z aktualnym stylem FullMag,
- zachowuje problem-centric semantykę,
- pozwala zachować temperaturę jako jawny byt,
- nie miesza temperatury z listą `energy=[]`,
- dobrze skaluje się od prostych przypadków do `2TM` i `LLB`.

## Czego nie dodawać do API na początku

Nie polecam w pierwszej wersji:

- anonimowych Python-callables przenoszonych do backendu,
- backend-specific flags typu `curand_block_size`,
- „magicznych” skrótów typu `Temp=300` na poziomie problemu bez jawnej semantyki.




# Rekomendowana semantyka `ProblemIR`

Poniżej proponuję jedną z najczystszych postaci rozszerzenia `ProblemIR`.

## Wariant 1 — `thermal_model` pod `DynamicsIR`

To jest mój wariant preferowany.

```json
{
  "study": {
    "kind": "time_evolution",
    "dynamics": {
      "kind": "llg",
      "gamma": 221100.0,
      "integrator": "heun",
      "fixed_timestep": 1e-13,
      "thermal_model": {
        "kind": "brown_thermal_field",
        "temperature": {
          "kind": "uniform",
          "value": 300.0,
          "unit": "K"
        },
        "stochastic_calculus": "stratonovich",
        "seed": 123456,
        "reuse_noise_on_rejected_step": true,
        "rescale_noise_with_dt": true
      }
    }
  }
}
```

**Zalety:**

- semantyka temperatury siedzi tam, gdzie faktycznie wpływa na równanie ruchu,
- planner ma łatwy dostęp do zasad zgodności solvera i thermal policy,
- jasne rozróżnienie między `energy[]` i dynamiką.

## Wariant 2 — osobna sekcja `thermal`

Można też rozważyć:

```json
{
  "study": {
    "kind": "time_evolution",
    "thermal": {
      "temperature_field": { ... },
      "material_update_policy": "instantaneous",
      "magnetic_model": {
        "kind": "brown_thermal_field",
        "seed": 123456
      }
    },
    "dynamics": {
      "kind": "llg",
      ...
    }
  }
}
```

To ma sens, jeśli zakładamy w przyszłości bardzo rozbudowane sprzężenie wielofizyczne.
Jednak na obecnym etapie jest to bardziej rozbudowane niż potrzeba.

**Rekomendacja:** zacząć od wariantu 1 i dopiero później ewoluować, jeśli zajdzie realna potrzeba.

## Materiały

`MaterialIR` powinno dostać coś w rodzaju:

```json
{
  "materials": [
    {
      "name": "CoFeB",
      "saturation_magnetisation": 1100000.0,
      "exchange_stiffness": 1.5e-11,
      "damping": 0.015,
      "curie_temperature": 850.0,
      "temperature_laws": {
        "saturation_magnetisation": {
          "kind": "tabulated_1d",
          "interpolation": "pchip",
          "extrapolation": "clamp",
          "points": [
            [0.0, 1100000.0],
            [300.0, 1020000.0],
            [600.0, 740000.0],
            [800.0, 150000.0]
          ]
        },
        "exchange_stiffness": {
          "kind": "power_law_from_reduced_magnetisation",
          "value0": 1.5e-11,
          "reference": "saturation_magnetisation",
          "exponent": 1.8
        },
        "damping": {
          "kind": "tabulated_1d",
          "interpolation": "linear",
          "extrapolation": "clamp",
          "points": [
            [0.0, 0.010],
            [300.0, 0.015],
            [600.0, 0.030],
            [800.0, 0.080]
          ]
        }
      }
    }
  ]
}
```

## `LLB` w `ProblemIR`

`LLB` powinno być osobnym rodzajem dynamiki:

```json
{
  "study": {
    "kind": "time_evolution",
    "dynamics": {
      "kind": "llb",
      "gamma": 221100.0,
      "integrator": "heun",
      "fixed_timestep": 5e-15,
      "temperature_model": {
        "kind": "uniform",
        "value": 650.0,
        "unit": "K"
      },
      "stochastic_model": {
        "kind": "llb_consistent_boltzmann"
      }
    }
  }
}
```

oraz wymagać odpowiednich praw materiałowych:

```json
{
  "temperature_laws": {
    "equilibrium_reduced_magnetisation": { ... },
    "parallel_susceptibility": { ... },
    "perpendicular_susceptibility": { ... }
  }
}
```

## Dlaczego `ProblemIR` powinno znać seed

FullMag już traktuje reproducibility metadata poważnie. Temperatury to tylko wzmacniają.
Seed powinien być jawny:

- globalnie w `ProblemMeta`,
- z opcjonalnym nadpisaniem przez model termiczny.

Planner i provenance powinny zapisywać:

- `rng_algorithm`,
- `rng_version`,
- `seed`,
- `counter_layout`,
- `noise_reuse_policy`.




# Capability matrix i polityka planner-a

Temperatura jest klasycznym przykładem funkcji, która powinna wejść do capability matrix etapami.

## Proponowana macierz wsparcia

Proponowaną macierz wsparcia lepiej czytać jako listę etapów niż jako jedną płaską tabelę:

- **`UniformTemperature`**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **FDM**.

- **`SampledTemperatureField`**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **FDM**.

- **`AnalyticTemperature`**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **FDM**.

- **`BrownThermalField + Heun fixed-step`**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **FDM**.

- **`BrownThermalField + adaptive`**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **później FDM**.

- **`TemperatureLaws` (`Ms(T)`, `A(T)`, `Ku(T)`, `alpha(T)`)**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **FDM**.

- **`LLB`**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **po walidacji**.

- **`Thermal FEM`**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **później**.

- **`HeatEquation`**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **później**.

- **`2TM`**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **później**.

- **`Hybrid thermal coupling`**  
  Semantyka: tak.  
  Internal reference: tak.  
  Public executable: **później**.


## Reguły `strict`

W `strict` planner powinien:

- odrzucać `BrownThermalField` w backendzie bez wsparcia publicznego,
- odrzucać `LLG` z `Ms(T)<=0`,
- odrzucać przypadki, gdzie `T` przechodzi przez `Tc`, a użytkownik nadal wybrał `LLG`,
- odrzucać `Relaxation + Brown` w pierwszej wersji,
- odrzucać thermal w FEM, jeśli nie ma publicznej kwalifikacji.

## Reguły `extended`

W `extended` planner może:

- dopuścić thermal `LLG` w ścieżkach internal-reference,
- emitować wyraźne ostrzeżenia o zakresie ważności,
- zezwalać na eksperymentalny adaptive stepping.

## Reguły `hybrid`

W `hybrid` planner musi dodatkowo sprawdzać:

- jak odwzorowuje się `T` między reprezentacjami siatkowymi i meshowymi,
- czy prawa materiałowe da się próbkująco lub projekcyjnie odtworzyć po obu stronach,
- czy outputy `T`, `H_therm`, `H_eff` mają spójne semantyki.

## Warto dodać semantyczne ostrzeżenia wysokiego poziomu

Przykłady dobrych ostrzeżeń:

- `Requested LLG + Brown at T/Tc = 0.82. Consider LLB for better physical fidelity.`
- `Temperature law for Ms crosses zero in the simulated temperature range. LLG state norm semantics may become invalid.`
- `Thermal model requested for Relaxation study. Use TimeEvolution or a dedicated Annealing study.`
- `Sampled temperature field resolution is much coarser than magnetic cell size; verify interpolation policy.`




# Outputy, nazewnictwo i provenance

Temperatura niemal na pewno wymusi rozszerzenie polityki nazw outputów.

## Co powinno wejść do kanonicznych outputów

### Pola

- `T` – temperatura użyta przez solver magnetyzacji,
- `H_therm` – chwilowe pole termiczne,
- `H_eff_det` – deterministyczna część pola efektywnego,
- `H_eff` – całkowite pole użyte w kroku,
- dla `LLB` ewentualnie:
  - `m_ref`,
  - `m_inst`,
  - `chi_parallel`,
  - `chi_perp`.

### Skalary

- `rng_seed`,
- `thermal_epoch`,
- `rejected_steps`,
- `accepted_steps`,
- `max_h_therm`,
- `max_h_eff_det`,
- `max_h_eff`,
- `mean_temperature`,
- `max_temperature`,
- `min_temperature`.

## Czy dodawać `E_therm`?

To jest bardzo ważna decyzja.

W wielu kodach spotyka się diagnostykę typu `E_therm = -μ0 M·H_therm` albo odpowiednik w konwencji `B`.
Problem w tym, że nie jest to zwykły konserwatywny wkład do energii całkowitej.

**Moja rekomendacja dla FullMag:**

- **nie dodawać `E_therm` do kanonicznego `E_total`**,
- jeśli potrzebna jest diagnostyka zgodna z innymi kodami, wprowadzić np.:
  - `E_therm_inst` – diagnostyka chwilowa,
  - `W_therm_step` – praca / wkład stochastyczny w kroku,
- ale wyraźnie oznaczyć, że nie są to konserwatywne wkłady energii.

To uchroni użytkownika przed błędną interpretacją „całkowitej energii” w obecności szumu.

## Provenance i reprodukowalność

W obecności szumu trzeba zapisywać więcej danych niż przy symulacji deterministycznej.

Minimum:

- `seed`,
- `rng_algorithm`,
- `rng_version`,
- `counter_layout`,
- `thermal_model_kind`,
- `temperature_field_kind`,
- `stochastic_calculus`,
- `noise_reuse_policy`,
- `accepted_steps`,
- `rejected_steps`.

To powinno trafiać zarówno do manifestu wykonania, jak i do metadanych wyników.




# Backendy: CPU, CUDA, FEM, hybrid

## CPU reference

CPU reference powinien być pierwszą ścieżką, która dostaje pełną i najczyściej opisaną implementację.
To jest punkt odniesienia dla:

- walidacji fizycznej,
- walidacji statystycznej,
- różnic względem CUDA.

Polityka:

- podwójna precyzja jako baseline,
- czytelny kod,
- dokładne testy jednostkowe,
- deterministyczny counter-based RNG.

## CUDA FDM

CUDA powinna dostać ten sam model fizyczny, nie tylko „coś podobnego”.

To oznacza:

- ten sam RNG family,
- ten sam układ liczników,
- ten sam kontrakt na reuse / rescale noise,
- tę samą politykę outputów.

Dzięki temu:

- część benchmarków może porównywać nie tylko statystyki, ale nawet tę samą trajektorię przy małych problemach,
- różnice można przypisać arytmetyce i redukcjom, a nie innemu modelowi losowości.

## Single precision na GPU

Przy thermal solverach pojedyncza precyzja może być wystarczająca dla części zastosowań, ale nie powinna być pierwszym punktem odniesienia.
Najlepsza polityka:

1. CPU double jako złoty wzorzec,
2. CUDA double jako pierwszy public-executable thermal backend,
3. CUDA single po walidacji weak-observables i testów stability.

## FEM

Dla FEM thermal noise nie jest tylko „tym samym, ale na węzłach”.

Trzeba ustalić:

- nośnik losowej siły / pola,
- kowariancję zgodną z formą słabą,
- rolę macierzy masy,
- czy stosujemy mass lumping,
- gdzie liczymy temperaturę i objętość efektywną.

Bez tego łatwo dostać implementację pozornie działającą, ale fizycznie niejednoznaczną.

**Rekomendacja:** pierwsze publiczne thermal wsparcie dla FEM odłożyć do osobnej noty fizycznej i benchmarków.

## Hybrid

W trybie hybrydowym najważniejsze pytania brzmią:

- czy `T` żyje na siatce FDM, mesh FEM czy w obu,
- jak interpolujemy `T`,
- jak interpolujemy prawa materiałowe zależne od `T`,
- jak definiujemy spójne outputy.

Na obecnym etapie lepiej ograniczyć się do semantyki i planner-a, niż wypuścić niejednoznaczną implementację.




# Integratory i polityka kroku czasu

To jeden z najbardziej niedocenianych tematów przy temperaturze.

## Fixed-step Heun jako pierwszy wybór

Powody:

- jest już zgodny z aktualnym uczciwym wycinkiem FullMag,
- ma ugruntowane zastosowanie w mikromagnetyce skończonej temperatury,
- łatwo zdefiniować „pole termiczne stałe w kroku”,
- łatwiej debugować i walidować.

## Co z `rk4`, `rk23`, `rk45`, `abm3`, `auto`

Nie należy zakładać, że wszystkie istniejące integratory FullMag mogą zostać bezpiecznie „włączone” dla thermal mode bez dodatkowej pracy.

### `rk4`

Może być użyteczne, ale nie powinno być publicznym thermal baseline bez osobnej walidacji weak/strong convergence.

### `rk23`, `rk45`

To bardzo sensowny drugi krok, szczególnie jeśli FullMag chce wykorzystać istniejącą semantykę adaptive timestep.
Jednak wymaga to jawnego kontraktu dla:

- odrzuceń kroku,
- przeskalowania tego samego szumu,
- powiązania `attempt_id` z RNG,
- raportowania `accepted_steps` / `rejected_steps`.

### `abm3`

To nie jest dobry pierwszy kandydat dla thermal mode. Wielokrokowość i semantyka losowości zwiększają trudność.
Można dodać później, ale nie jako pierwszy publiczny wariant.

## Rekomendowana polityka wspieranych integratorów dla temperatury

### Faza 1

- `heun` – **tak**
- reszta – **niepubliczna** lub zablokowana przez planner

### Faza 2

- `heun` – tak
- `rk45` adaptive – tak po walidacji
- `rk23` – opcjonalnie po walidacji
- `rk4`, `abm3` – później

## Kontrola geometrii kroku

Dobrze, że FullMag ma już pojęcia takie jak:

- `max_spin_rotation`,
- `norm_tolerance`.

W thermal mode warto używać ich jeszcze ostrożniej, bo:

- szum skaluje się z `sqrt(dt)` na poziomie przyrostu stanu,
- zbyt duży `dt` może dać niefizyczne lokalne rotacje i niestabilne statystyki,
- sama kontrola błędu numerycznego nie wystarcza – trzeba kontrolować również geometrię ruchu na sferze.

## Jedna realizacja szumu na zaakceptowany krok

To powinno być zapisane wprost w dokumentacji fizycznej:

> Wszystkie etapy solvera odpowiadające jednemu akceptowanemu krokowi czasu muszą używać tej samej realizacji pola termicznego / tego samego przyrostu Wienera, o ile wybrany schemat nie definiuje inaczej wprost.

Bez tego trudno mówić o spójnym modelu stochastycznym.




# RNG: jak zrobić to dobrze od początku

Najczęstszy błąd przy thermal micromagnetics to potraktowanie RNG jako drobiazgu implementacyjnego.
W rzeczywistości jest to część modelu naukowego.

## Wymagania wobec RNG

- powtarzalność między uruchomieniami,
- niezależność od liczby wątków,
- prosty mapping CPU ↔ CUDA,
- możliwość reprodukcji krok-po-kroku,
- łatwe włączenie `attempt_id` przy adaptive stepping,
- możliwość future-proofingu dla `LLB`.

## Dlaczego counter-based RNG jest najlepsze

Stateful RNG per-thread bywa szybkie, ale trudniej je uczynić backend-neutralnym i powtarzalnym.
Counter-based RNG rozwiązuje większość problemów.

Polecam rodzinę w stylu:

- Philox,
- Threefry,
- inny sprawdzony counter-based generator.

## Proponowany układ licznika

```text
counter = (
    problem_seed_lo,
    problem_seed_hi,
    thermal_epoch,
    cell_id
)

subcounter / key = (
    component_id,
    attempt_id,
    stream_tag,
    backend_version
)
```

W praktyce dokładny rozkład bitów zależy od wybranego generatora, ale ważna jest zasada:

- `thermal_epoch` identyfikuje zaakceptowany krok,
- `attempt_id` odróżnia próby w adaptive solverze,
- `cell_id` zapewnia deterministyczny mapping przestrzenny,
- `component_id` rozróżnia składowe wektora.

## Czy CPU i CUDA muszą dawać identyczną trajektorię?

Nie zawsze. To zależy od:

- precyzji,
- kolejności redukcji,
- drobnych różnic arytmetycznych.

Ale warto dążyć do tego, żeby przy małych benchmarkach w double precision i tym samym RNG
dało się uzyskać **bardzo bliską trajektorię pathwise**, a dla większych problemów przynajmniej
zgodność statystyczną.

## Testy RNG

Warto mieć osobne testy na:

- powtarzalność przy tym samym seed,
- różne wyniki przy innym seed,
- niezależność od liczby wątków,
- zgodność CPU / CUDA dla pierwszych kilku wektorów losowych,
- poprawne przeskalowanie przy zmianie `dt`.




# Co z coarse-grainingiem i renormalizacją?

To temat, którego nie warto zamiatać pod dywan.

Przy niezerowej temperaturze standardowa mikromagnetyka na zbyt grubych komórkach może dawać
artefakty termodynamiczne. Jednym z klasycznych problemów jest anomalia punktu Curie
i ogólnie zależność wyników od skali coarse-grainingu.

## Co z tego wynika dla FullMag

### Wersja uczciwa

FullMag w pierwszym releasie temperatury powinien **otwarcie powiedzieć**, że:

- `LLG + Brown` jest publicznie kwalifikowane dla niskich i umiarkowanych temperatur,
- nie jest to automatycznie poprawny model do wyznaczania `Tc`,
- w pobliżu `Tc` należy rozważyć `LLB` albo kalibrację wieloskalową.

### Wersja zaawansowana

Później można dodać:

- korekty coarse-grainingu,
- efektywną temperaturę `T_eff(Δ)`,
- renormalizację `A(T, Δ)` albo innych współczynników,
- benchmarki porównujące różne skale siatki.

## Gdzie to umieścić w architekturze

Nie jako obligatoryjną część pierwszego MVP. Lepiej:

- jako osobny rozdział w notatce fizycznej,
- jako planner warning przy zadanym `Tc` i zbyt wysokim `T`,
- ewentualnie jako przyszły `CoarseGrainingCorrectionPolicy`.




# Walidacja: bez tego temperatura będzie tylko funkcją „wygląda sensownie”

Walidacja thermal micromagnetics musi być mocniejsza niż walidacja przypadku zerotemperaturowego.

## Zasada ogólna

Dla kodu stochastycznego **nie wystarczy porównać jednej trajektorii**.

Trzeba testować:

- rozkłady,
- średnie ensemble,
- wariancje,
- czasy przejścia,
- zgodność weak-observables,
- czasem także strong/pathwise convergence.

## Benchmark 1 — makrospin w stałym polu

Cel:

- sprawdzić, czy rozkład stacjonarny odpowiada oczekiwanemu rozkładowi Boltzmanna.

Mierzyć:

- histogram kąta,
- średnią projekcję na pole,
- wariancję małokątową,
- zależność od `dt`.

To jest benchmark absolutnie obowiązkowy.

## Benchmark 2 — termicznie aktywowany switching

Cel:

- sprawdzić, czy średni czas przełączenia i rozkład czasów reagują sensownie na temperaturę i barierę.

Mierzyć:

- `P_switch(t)`,
- średni czas przełączenia,
- dopasowanie Arrheniusa w odpowiednim zakresie.

## Benchmark 3 — weak convergence względem `dt`

Cel:

- sprawdzić, czy średnie obserwable zbiegają przy zmniejszaniu kroku czasu.

Mierzyć:

- średnie `m_z(t)`,
- wariancje,
- dystrybuanty wybranych obserwabli,
- błąd słaby względem referencji z bardzo małym `dt`.

## Benchmark 4 — CPU vs CUDA

Cel:

- udowodnić, że backendy implementują ten sam model.

Mierzyć:

- zgodność pierwszych realizacji RNG,
- zgodność małych benchmarków pathwise (tam gdzie możliwe),
- zgodność średnich ensemble,
- zgodność wariancji i histogramów.

## Benchmark 5 — gradient temperatury

Cel:

- sprawdzić zachowanie przy `T(x)` w strukturach z domenami / ścianami domenowymi / skyrmionami.

Mierzyć:

- kierunek i trend ruchu,
- stabilność symulacji,
- wpływ interpolacji pola temperatury.

## Benchmark 6 — `LLB` near-`Tc`

Cel:

- sprawdzić zanik i powrót magnetyzacji przy skoku temperatury / impulsie.

Mierzyć:

- `|m|(t)`,
- relaksację podłużną,
- porównanie z literaturą i/lub referencją atomistyczną.

## Benchmark 7 — `2TM`

Cel:

- najpierw zwalidować sam solver ciepła,
- dopiero potem sprzężenie z magnetyzacją.

Mierzyć:

- odpowiedź `Te(t)`, `Tl(t)` na impuls,
- energię i bilans źródeł,
- zgodność z rozwiązaniami referencyjnymi / manufactured solutions.

## Jak pisać testy regresyjne

Dla stochastic code lepiej używać:

- akceptowalnych przedziałów ufności,
- testów KS / Wasserstein na histogramach,
- średnich po wielu realizacjach,
- zapisanych seeds i liczby powtórzeń.

Nie opierać wszystkiego na jednym pliku referencyjnym z jednej trajektorii.




# Najważniejsze pułapki i jak ich uniknąć

## Pułapka 1 — temperatura jako `EnergyTerm`

Rozwiązanie: temperatura siedzi w dynamice i polu temperatury, nie w liście energii.

## Pułapka 2 — brak jawnej semantyki `T(x,t)`

Rozwiązanie: `TemperatureField` musi być obiektem pierwszej klasy.

## Pułapka 3 — wszystko od razu

Rozwiązanie: etapować capability matrix i publiczne wsparcie.

## Pułapka 4 — surowe callbacki w `ProblemIR`

Rozwiązanie: serializować tylko kanoniczne, walidowalne reprezentacje.

## Pułapka 5 — brak rozdzielenia `H_eff_det` / `H_therm` / `H_eff`

Rozwiązanie: rozszerzyć output policy i nazwy pól.

## Pułapka 6 — adaptive stepping bez polityki reuse/rescale noise

Rozwiązanie: od razu zapisać to jako wymóg fizyczno-numeryczny.

## Pułapka 7 — `LLG` w okolicy `Tc` bez ostrzeżeń

Rozwiązanie: planner warning / error oraz ścieżka `LLB`.

## Pułapka 8 — thermal FEM zrobione „na czuja”

Rozwiązanie: opóźnić publiczne wdrożenie do czasu osobnej noty fizycznej.

## Pułapka 9 — `E_total` liczone razem z `E_therm`

Rozwiązanie: `E_therm_inst` tylko jako diagnostyka, poza `E_total`.

## Pułapka 10 — brak provenance

Rozwiązanie: seed, RNG, policy kroku i thermal epoch muszą trafiać do wyników.




# Co bym zrobił dokładnie w repo FullMag

Poniżej bardzo konkretna kolejność prac.

## 1. Dokumenty fizyczne

Dodałbym co najmniej:

- `docs/physics/0600-temperature-models-and-thermal-dynamics.md`
- `docs/physics/0610-stochastic-llg-brown-thermal-field.md`
- `docs/physics/0620-temperature-dependent-material-laws.md`
- `docs/physics/0630-landau-lifshitz-bloch.md`
- `docs/physics/0640-thermal-sources-heat-equation-and-2tm.md`

Każdy zgodny z aktualnym standardem FullMag:

- problem statement,
- physical model,
- numerical interpretation FDM / FEM / hybrid,
- API & `ProblemIR`,
- validation strategy,
- known limits,
- completeness checklist.

## 2. Python DSL

Dodałbym moduł np.:

```text
packages/fullmag-py/src/fullmag/model/thermal.py
```

oraz eksporty w `__init__.py`:

- `TemperatureField`,
- `UniformTemperature`,
- `AnalyticTemperature`,
- `SampledTemperatureField`,
- `ImportedTemperatureField`,
- `HeatEquation`,
- `TwoTemperatureModel`,
- `TemperatureLaws`,
- `Tabulated1D`,
- `CriticalLaw`,
- `PowerLawFromReducedMagnetization`,
- `CallenCallen`,
- `BrownThermalField`,
- `LLB`.

## 3. IR / Rust

Dodałbym odpowiednie typy w crate odpowiedzialnym za `ProblemIR`:

```text
crates/fullmag-ir/src/thermal.rs
```

oraz modyfikacje:

- `dynamics.rs`,
- `material.rs`,
- capability matrix,
- walidatorów.

## 4. Backend CPU reference

Dodałbym:

```text
native/fdm/cpu_reference/thermal_brown.cpp
native/fdm/cpu_reference/thermal_rng.cpp
native/fdm/cpu_reference/temperature_fields.cpp
native/fdm/cpu_reference/temperature_laws.cpp
```

## 5. Backend CUDA

Dodałbym:

```text
native/fdm/cuda/thermal_brown.cu
native/fdm/cuda/thermal_rng.cu
native/fdm/cuda/temperature_laws.cu
```

## 6. Planner i capability matrix

Nowe wpisy w capability matrix dla:

- `UniformTemperature`,
- `SampledTemperatureField`,
- `BrownThermalField`,
- `TemperatureLaws`,
- `LLB`,
- `HeatEquation`,
- `TwoTemperatureModel`.

## 7. Testy

Nowe zestawy:

- `tests/physics/test_macrospin_boltzmann.py`
- `tests/physics/test_neel_brown_switching.py`
- `tests/physics/test_cpu_cuda_thermal_statistics.py`
- `tests/physics/test_temperature_laws.py`
- `tests/physics/test_llb_step_response.py`

## 8. Przykłady

Przykłady użytkowe:

- `examples/thermal_macrospin.py`
- `examples/thermal_switching.py`
- `examples/temperature_gradient_dw.py`
- `examples/llb_heat_pulse.py`
- `examples/two_temperature_llb.py`




# Roadmap wdrożenia — wersja realna, nie życzeniowa

## Faza 0 — spec i dokumentacja

- dopisać note fizyczne,
- ustalić kontrakt jednostek i korelacji szumu,
- ustalić output policy,
- ustalić seed/provenance policy.

Bez tego nie pisałbym ani linii kernela.

## Faza 1 — `Brown + Heun + UniformTemperature` na FDM

- Python API,
- `ProblemIR`,
- CPU reference,
- CUDA double,
- outputy `H_therm`, `H_eff_det`, `H_eff`, `T`,
- benchmark makrospinowy,
- benchmark CPU/CUDA.

To jest pierwszy release, który już ma sens naukowy.

## Faza 2 — `TemperatureLaws` i pole `T(x,t)`

- `Tabulated1D`,
- `SampledTemperatureField`,
- `AnalyticTemperature`,
- aktualizacja `Ms(T), A(T), Ku(T), alpha(T)`,
- walidacja na gradientach i strukturach domenowych.

## Faza 3 — adaptive thermal stepping

- jawny kontrakt reuse/rescale noise,
- `accepted_steps`, `rejected_steps`,
- benchmarki weak convergence,
- planner support.

## Faza 4 — `LLB`

- osobny model dynamiki,
- nowe semantyki outputów,
- walidacja near-`Tc`,
- początkowo tylko jedna uczciwa ścieżka wykonawcza.

## Faza 5 — `HeatEquation` i `2TM`

- osobny thermal source,
- sprzężenie z `LLG` lub `LLB`,
- walidacja solvera ciepła,
- dopiero potem walidacja magnetyczna.

## Faza 6 — thermal FEM i hybrid

- dopiero po definicji słabego wymuszenia i spójnego mapowania pól.




# Załącznik A — szkic nowego pliku `docs/physics/0600-temperature-models-and-thermal-dynamics.md`

```markdown
# 0600 Temperature Models and Thermal Dynamics

## Problem statement
This note defines how FullMag represents finite-temperature magnetization dynamics,
temperature-dependent material laws, and thermal source models in a backend-neutral,
physics-first way.

## Scope
This note covers:
- Brown thermal field for stochastic LLG,
- temperature-dependent material parameters,
- TemperatureField semantics,
- planner and capability implications,
- output naming and provenance.

This note does not yet fully qualify:
- FEM stochastic forcing,
- multiscale coarse-graining corrections,
- all LLB variants.

## Physical model
### LLG
dm/dt = -(gamma/(1+alpha^2)) [ m × H_eff + alpha m × (m × H_eff) ]

### Thermal extension
H_eff = H_det + H_therm

### Thermal field statistics
- zero mean
- independent components
- fluctuation-dissipation-consistent amplitude
- canonical unit convention frozen here

## Numerical interpretation
### FDM
- one thermal field sample per active cell and component
- held constant over an accepted Heun step
- amplitude depends on T, alpha, Ms, cell volume, dt

### FEM
- semantic support only in this note
- public qualification deferred
- requires mass-matrix-consistent stochastic forcing note

## API surface
- TemperatureField
- UniformTemperature
- SampledTemperatureField
- BrownThermalField
- TemperatureLaws

## ProblemIR
- thermal_model nested under DynamicsIR::Llg
- temperature_laws nested under MaterialIR
- seed and RNG provenance first-class

## Output policy
- H_therm
- H_eff_det
- H_eff
- T
- E_total excludes stochastic thermal diagnostics

## Validation
- macrospin Boltzmann benchmark
- switching-rate ensemble benchmark
- weak-convergence benchmark
- CPU/CUDA RNG parity benchmark

## Known limits
- low-to-moderate temperature qualification only
- not intended to infer Tc from coarse-grid LLG
- LLB required near Tc or when |m| is not approximately constant
```



# Załącznik B — szkic API w `fullmag-py`

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Literal, Sequence

InterpolationKind = Literal["linear", "pchip", "nearest"]
ExtrapolationKind = Literal["clamp", "error", "linear"]
StochasticCalculusKind = Literal["stratonovich", "ito"]
TemperatureCouplingKind = Literal["electron", "lattice", "weighted"]
CombinationPolicyKind = Literal["multiply", "replace", "compose"]


@dataclass(frozen=True)
class Tabulated1D:
    points: Sequence[tuple[float, float]]
    interpolation: InterpolationKind = "linear"
    extrapolation: ExtrapolationKind = "clamp"

    def to_ir(self) -> dict:
        return {
            "kind": "tabulated_1d",
            "points": [[float(x), float(y)] for x, y in self.points],
            "interpolation": self.interpolation,
            "extrapolation": self.extrapolation,
        }


@dataclass(frozen=True)
class CriticalLaw:
    value0: float
    Tc: float
    beta: float
    reference_temperature: float = 0.0

    def to_ir(self) -> dict:
        return {
            "kind": "critical_law",
            "value0": float(self.value0),
            "Tc": float(self.Tc),
            "beta": float(self.beta),
            "reference_temperature": float(self.reference_temperature),
        }


@dataclass(frozen=True)
class PowerLawFromReducedMagnetization:
    value0: float
    reduced_magnetisation: str
    exponent: float

    def to_ir(self) -> dict:
        return {
            "kind": "power_law_from_reduced_magnetisation",
            "value0": float(self.value0),
            "reference": self.reduced_magnetisation,
            "exponent": float(self.exponent),
        }


@dataclass(frozen=True)
class CallenCallen:
    value0: float
    order: int
    reduced_magnetisation: str

    def to_ir(self) -> dict:
        return {
            "kind": "callen_callen",
            "value0": float(self.value0),
            "order": int(self.order),
            "reference": self.reduced_magnetisation,
        }


@dataclass(frozen=True)
class TemperatureLaws:
    Ms: object | None = None
    A: object | None = None
    Ku: object | None = None
    alpha: object | None = None
    m_eq: object | None = None
    chi_parallel: object | None = None
    chi_perp: object | None = None
    Tc: float | None = None
    combination_policy: CombinationPolicyKind = "multiply"

    def to_ir(self) -> dict:
        out: dict = {"combination_policy": self.combination_policy}
        if self.Tc is not None:
            out["curie_temperature"] = float(self.Tc)
        mapping = {
            "Ms": "saturation_magnetisation",
            "A": "exchange_stiffness",
            "Ku": "uniaxial_anisotropy",
            "alpha": "damping",
            "m_eq": "equilibrium_reduced_magnetisation",
            "chi_parallel": "parallel_susceptibility",
            "chi_perp": "perpendicular_susceptibility",
        }
        for attr, key in mapping.items():
            value = getattr(self, attr)
            if value is not None:
                out[key] = value.to_ir()
        return out


class TemperatureField:
    def to_ir(self) -> dict:
        raise NotImplementedError


@dataclass(frozen=True)
class UniformTemperature(TemperatureField):
    value: float

    def to_ir(self) -> dict:
        return {"kind": "uniform", "value": float(self.value), "unit": "K"}


@dataclass(frozen=True)
class AnalyticTemperature(TemperatureField):
    expression: str
    variables: Sequence[str] = ("x", "y", "z", "t")

    def to_ir(self) -> dict:
        return {
            "kind": "analytic",
            "expression": self.expression,
            "variables": list(self.variables),
            "unit": "K",
        }


@dataclass(frozen=True)
class SampledTemperatureField(TemperatureField):
    values: Sequence[float]
    location: Literal["cell", "node", "element"] = "cell"
    ordering: str = "backend_native"

    def to_ir(self) -> dict:
        return {
            "kind": "sampled",
            "location": self.location,
            "ordering": self.ordering,
            "unit": "K",
            "values": [float(v) for v in self.values],
        }


@dataclass(frozen=True)
class ImportedTemperatureField(TemperatureField):
    path: str
    field_name: str = "T"
    location: Literal["cell", "node", "element"] = "cell"
    interpolation: str = "linear"

    def to_ir(self) -> dict:
        return {
            "kind": "imported",
            "path": self.path,
            "field_name": self.field_name,
            "location": self.location,
            "interpolation": self.interpolation,
            "unit": "K",
        }


@dataclass(frozen=True)
class HeatEquation(TemperatureField):
    heat_capacity: object
    conductivity: object
    source: object | None = None
    initial_temperature: TemperatureField = field(default_factory=lambda: UniformTemperature(300.0))
    boundary_condition: str = "adiabatic"

    def to_ir(self) -> dict:
        return {
            "kind": "heat_equation",
            "heat_capacity": self.heat_capacity.to_ir(),
            "conductivity": self.conductivity.to_ir(),
            "source": None if self.source is None else self.source.to_ir(),
            "initial_temperature": self.initial_temperature.to_ir(),
            "boundary_condition": self.boundary_condition,
        }


@dataclass(frozen=True)
class TwoTemperatureModel(TemperatureField):
    electron_heat_capacity: object
    lattice_heat_capacity: object
    electron_conductivity: object
    lattice_conductivity: object | None = None
    electron_lattice_coupling: object | None = None
    source: object | None = None
    initial_electron_temperature: TemperatureField = field(default_factory=lambda: UniformTemperature(300.0))
    initial_lattice_temperature: TemperatureField = field(default_factory=lambda: UniformTemperature(300.0))
    magnetic_coupling: TemperatureCouplingKind = "electron"

    def to_ir(self) -> dict:
        return {
            "kind": "two_temperature_model",
            "electron_heat_capacity": self.electron_heat_capacity.to_ir(),
            "lattice_heat_capacity": self.lattice_heat_capacity.to_ir(),
            "electron_conductivity": self.electron_conductivity.to_ir(),
            "lattice_conductivity": None if self.lattice_conductivity is None else self.lattice_conductivity.to_ir(),
            "electron_lattice_coupling": None if self.electron_lattice_coupling is None else self.electron_lattice_coupling.to_ir(),
            "source": None if self.source is None else self.source.to_ir(),
            "initial_electron_temperature": self.initial_electron_temperature.to_ir(),
            "initial_lattice_temperature": self.initial_lattice_temperature.to_ir(),
            "magnetic_coupling": self.magnetic_coupling,
        }


@dataclass(frozen=True)
class BrownThermalField:
    temperature: TemperatureField
    seed: int | None = None
    stochastic_calculus: StochasticCalculusKind = "stratonovich"
    reuse_noise_on_rejected_step: bool = True
    rescale_noise_with_dt: bool = True
    report_h_therm: bool = True
    report_temperature: bool = True

    def to_ir(self) -> dict:
        return {
            "kind": "brown_thermal_field",
            "temperature": self.temperature.to_ir(),
            "seed": None if self.seed is None else int(self.seed),
            "stochastic_calculus": self.stochastic_calculus,
            "reuse_noise_on_rejected_step": self.reuse_noise_on_rejected_step,
            "rescale_noise_with_dt": self.rescale_noise_with_dt,
            "report_h_therm": self.report_h_therm,
            "report_temperature": self.report_temperature,
        }


@dataclass(frozen=True)
class LLB:
    gamma: float = 2.211e5
    integrator: str = "heun"
    fixed_timestep: float | None = None
    adaptive_timestep: object | None = None
    temperature: TemperatureField | None = None
    stochastic_model: str | None = "llb_consistent_boltzmann"

    def to_ir(self) -> dict:
        data = {
            "kind": "llb",
            "gamma": float(self.gamma),
            "integrator": self.integrator,
            "fixed_timestep": None if self.fixed_timestep is None else float(self.fixed_timestep),
            "adaptive_timestep": None if self.adaptive_timestep is None else self.adaptive_timestep.to_ir(),
            "temperature_model": None if self.temperature is None else self.temperature.to_ir(),
            "stochastic_model": self.stochastic_model,
        }
        return data
```



# Załącznik C — szkic typów Rust / `ProblemIR`

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TemperatureFieldIr {
    Uniform {
        value: f64,
        unit: TemperatureUnit,
    },
    Analytic {
        expression: String,
        variables: Vec<String>,
        unit: TemperatureUnit,
    },
    Sampled {
        location: FieldLocation,
        ordering: String,
        unit: TemperatureUnit,
        values: Vec<f64>,
    },
    Imported {
        path: String,
        field_name: String,
        location: FieldLocation,
        interpolation: InterpolationKind,
        unit: TemperatureUnit,
    },
    HeatEquation {
        heat_capacity: ScalarLawIr,
        conductivity: ScalarLawIr,
        source: Option<HeatSourceIr>,
        initial_temperature: Box<TemperatureFieldIr>,
        boundary_condition: ThermalBoundaryConditionIr,
    },
    TwoTemperatureModel {
        electron_heat_capacity: ScalarLawIr,
        lattice_heat_capacity: ScalarLawIr,
        electron_conductivity: ScalarLawIr,
        lattice_conductivity: Option<ScalarLawIr>,
        electron_lattice_coupling: Option<ScalarLawIr>,
        source: Option<HeatSourceIr>,
        initial_electron_temperature: Box<TemperatureFieldIr>,
        initial_lattice_temperature: Box<TemperatureFieldIr>,
        magnetic_coupling: MagneticTemperatureCouplingIr,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemperatureUnit {
    Kelvin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldLocation {
    Cell,
    Node,
    Element,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterpolationKind {
    Linear,
    Pchip,
    Nearest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ParameterLawIr {
    Tabulated1d {
        interpolation: InterpolationKind,
        extrapolation: ExtrapolationKind,
        points: Vec<[f64; 2]>,
    },
    CriticalLaw {
        value0: f64,
        tc: f64,
        beta: f64,
        reference_temperature: f64,
    },
    PowerLawFromReducedMagnetisation {
        value0: f64,
        reference: ReducedMagnetisationReferenceIr,
        exponent: f64,
    },
    CallenCallen {
        value0: f64,
        order: u32,
        reference: ReducedMagnetisationReferenceIr,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtrapolationKind {
    Clamp,
    Error,
    Linear,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReducedMagnetisationReferenceIr {
    SaturationMagnetisation,
    EquilibriumReducedMagnetisation,
    MaterialLaw(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TemperatureLawsIr {
    pub combination_policy: CombinationPolicyIr,
    pub curie_temperature: Option<f64>,
    pub saturation_magnetisation: Option<ParameterLawIr>,
    pub exchange_stiffness: Option<ParameterLawIr>,
    pub uniaxial_anisotropy: Option<ParameterLawIr>,
    pub damping: Option<ParameterLawIr>,
    pub equilibrium_reduced_magnetisation: Option<ParameterLawIr>,
    pub parallel_susceptibility: Option<ParameterLawIr>,
    pub perpendicular_susceptibility: Option<ParameterLawIr>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CombinationPolicyIr {
    Multiply,
    Replace,
    Compose,
}

impl Default for CombinationPolicyIr {
    fn default() -> Self {
        Self::Multiply
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ThermalModelIr {
    BrownThermalField {
        temperature: TemperatureFieldIr,
        seed: Option<u64>,
        stochastic_calculus: StochasticCalculusIr,
        reuse_noise_on_rejected_step: bool,
        rescale_noise_with_dt: bool,
        report_h_therm: bool,
        report_temperature: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StochasticCalculusIr {
    Stratonovich,
    Ito,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DynamicsIr {
    Llg(LlgDynamicsIr),
    Llb(LlbDynamicsIr),
    RelaxationOverdamped(RelaxationOverdampedIr),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlgDynamicsIr {
    pub gamma: f64,
    pub integrator: IntegratorKindIr,
    pub fixed_timestep: Option<f64>,
    pub adaptive_timestep: Option<AdaptiveTimestepIr>,
    pub thermal_model: Option<ThermalModelIr>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlbDynamicsIr {
    pub gamma: f64,
    pub integrator: IntegratorKindIr,
    pub fixed_timestep: Option<f64>,
    pub adaptive_timestep: Option<AdaptiveTimestepIr>,
    pub temperature_model: TemperatureFieldIr,
    pub stochastic_model: Option<LlbStochasticModelIr>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegratorKindIr {
    Heun,
    Rk4,
    Rk23,
    Rk45,
    Abm3,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlbStochasticModelIr {
    ConsistentBoltzmann,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaptiveTimestepIr {
    pub atol: f64,
    pub rtol: f64,
    pub dt_initial: f64,
    pub dt_min: f64,
    pub dt_max: f64,
    pub safety: f64,
    pub growth_limit: f64,
    pub shrink_limit: f64,
    pub max_spin_rotation: Option<f64>,
    pub norm_tolerance: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaterialIr {
    pub name: String,
    pub saturation_magnetisation: f64,
    pub exchange_stiffness: Option<f64>,
    pub damping: Option<f64>,
    pub temperature_laws: Option<TemperatureLawsIr>,
}
```



# Załącznik D — szkic walidatora planner-a

```rust
pub fn validate_temperature_support(problem: &ProblemIr, caps: &CapabilityMatrix) -> Vec<Diagnostic> {
    let mut diags = Vec::new();

    let Some(study) = &problem.study else {
        return diags;
    };

    match &study.dynamics {
        DynamicsIr::Llg(llg) => {
            if let Some(thermal) = &llg.thermal_model {
                if !caps.supports_thermal_llg_fdm_public() && problem.requires_public_executable() {
                    diags.push(Diagnostic::error(
                        "thermal_llg_not_public",
                        "Brown thermal field is not public-executable for the requested backend/mode.",
                    ));
                }

                if llg.integrator != IntegratorKindIr::Heun && problem.requires_strict_mode() {
                    diags.push(Diagnostic::error(
                        "thermal_llg_integrator_not_qualified",
                        "Only Heun is public-qualified for thermal LLG in strict mode.",
                    ));
                }

                if let Some(temp_range) = infer_temperature_range(problem, thermal) {
                    for material in &problem.materials {
                        if let Some(laws) = &material.temperature_laws {
                            if let Some(tc) = laws.curie_temperature {
                                if temp_range.max >= 0.75 * tc {
                                    diags.push(Diagnostic::warning(
                                        "llg_near_tc",
                                        format!(
                                            "Requested LLG thermal run reaches T/Tc={:.3}. Consider LLB for better fidelity.",
                                            temp_range.max / tc
                                        ),
                                    ));
                                }
                            }

                            if law_crosses_nonpositive_ms(laws, &temp_range) {
                                diags.push(Diagnostic::error(
                                    "llg_nonpositive_ms",
                                    format!(
                                        "Material '{}' has Ms(T)<=0 in the simulated temperature range; LLG state semantics become invalid.",
                                        material.name
                                    ),
                                ));
                            }

                            if law_has_invalid_exchange(laws, &temp_range) {
                                diags.push(Diagnostic::error(
                                    "invalid_exchange_temperature_law",
                                    format!(
                                        "Material '{}' has exchange stiffness <= 0 in the simulated temperature range.",
                                        material.name
                                    ),
                                ));
                            }

                            if law_has_bad_extrapolation(laws, &temp_range) {
                                diags.push(Diagnostic::warning(
                                    "temperature_law_extrapolation",
                                    format!(
                                        "Material '{}' temperature law range does not fully cover the simulated temperatures.",
                                        material.name
                                    ),
                                ));
                            }
                        }
                    }
                }

                if matches!(problem.study.kind, StudyKindIr::Relaxation) {
                    diags.push(Diagnostic::error(
                        "thermal_relaxation_not_supported",
                        "Thermal Brown field is not supported for Relaxation studies in the current qualified slice.",
                    ));
                }
            }
        }
        DynamicsIr::Llb(llb) => {
            if !caps.supports_llb_semantically() {
                diags.push(Diagnostic::error(
                    "llb_not_supported",
                    "LLB is not supported in the current capability matrix.",
                ));
            }

            for material in &problem.materials {
                let Some(laws) = &material.temperature_laws else {
                    diags.push(Diagnostic::error(
                        "llb_missing_temperature_laws",
                        format!("Material '{}' is missing required temperature laws for LLB.", material.name),
                    ));
                    continue;
                };

                if laws.equilibrium_reduced_magnetisation.is_none() {
                    diags.push(Diagnostic::error(
                        "llb_missing_me",
                        format!("Material '{}' is missing equilibrium_reduced_magnetisation.", material.name),
                    ));
                }
                if laws.parallel_susceptibility.is_none() {
                    diags.push(Diagnostic::error(
                        "llb_missing_chi_parallel",
                        format!("Material '{}' is missing parallel_susceptibility.", material.name),
                    ));
                }
                if laws.perpendicular_susceptibility.is_none() {
                    diags.push(Diagnostic::warning(
                        "llb_missing_chi_perp",
                        format!("Material '{}' is missing perpendicular_susceptibility.", material.name),
                    ));
                }
            }
        }
        _ => {}
    }

    diags
}

fn infer_temperature_range(problem: &ProblemIr, thermal: &ThermalModelIr) -> Option<TemperatureRange> {
    match thermal {
        ThermalModelIr::BrownThermalField { temperature, .. } => infer_temperature_range_from_field(problem, temperature),
    }
}

fn infer_temperature_range_from_field(problem: &ProblemIr, field: &TemperatureFieldIr) -> Option<TemperatureRange> {
    match field {
        TemperatureFieldIr::Uniform { value, .. } => Some(TemperatureRange { min: *value, max: *value }),
        TemperatureFieldIr::Sampled { values, .. } => {
            let min = values.iter().copied().fold(f64::INFINITY, f64::min);
            let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            if min.is_finite() && max.is_finite() {
                Some(TemperatureRange { min, max })
            } else {
                None
            }
        }
        TemperatureFieldIr::Analytic { .. } => None,
        TemperatureFieldIr::Imported { .. } => None,
        TemperatureFieldIr::HeatEquation { .. } => None,
        TemperatureFieldIr::TwoTemperatureModel { .. } => None,
    }
}

#[derive(Debug, Clone, Copy)]
struct TemperatureRange {
    min: f64,
    max: f64,
}
```



# Załącznik E — szkic CPU reference dla `BrownThermalField`

```cpp
struct ThermalConfig {
    bool enabled = false;
    uint64_t seed = 0;
    bool reuse_noise_on_rejected_step = true;
    bool rescale_noise_with_dt = true;
};

struct ThermalBuffers {
    std::vector<double> hx;
    std::vector<double> hy;
    std::vector<double> hz;
    std::vector<double> sigma_base;
    std::vector<double> last_dt;
    uint64_t thermal_epoch = 0;
    uint32_t attempt_id = 0;
};

struct CellMaterialState {
    double Ms;
    double alpha;
    double volume;
    double temperature;
    bool active;
};

class CounterRng {
public:
    explicit CounterRng(uint64_t seed_lo, uint64_t seed_hi)
        : seed_lo_(seed_lo), seed_hi_(seed_hi) {}

    std::array<double, 4> normal4(
        uint64_t thermal_epoch,
        uint32_t attempt_id,
        uint64_t cell_id,
        uint32_t lane
    ) const {
        auto u = philox4x32(seed_lo_, seed_hi_, thermal_epoch, attempt_id, cell_id, lane);
        return {
            box_muller(u[0], u[1]),
            box_muller(u[2], u[3]),
            box_muller(u[4], u[5]),
            box_muller(u[6], u[7]),
        };
    }

private:
    uint64_t seed_lo_;
    uint64_t seed_hi_;
};

static inline double thermal_prefactor_constant() {
    // Freeze in physics note:
    // includes kB, gamma, mu0 and any convention-dependent factors.
    return FULLMAG_THERMAL_PREFAC;
}

void precompute_sigma_base(
    const std::vector<CellMaterialState>& cells,
    ThermalBuffers& thermal
) {
    const double c = thermal_prefactor_constant();
    thermal.sigma_base.resize(cells.size(), 0.0);

    for (size_t i = 0; i < cells.size(); ++i) {
        const auto& cell = cells[i];
        if (!cell.active || cell.Ms <= 0.0 || cell.alpha <= 0.0 || cell.volume <= 0.0) {
            thermal.sigma_base[i] = 0.0;
            continue;
        }

        thermal.sigma_base[i] = std::sqrt(c * cell.alpha / (cell.Ms * cell.volume));
    }
}

void generate_brown_field(
    const ThermalConfig& cfg,
    const std::vector<CellMaterialState>& cells,
    double dt,
    ThermalBuffers& thermal,
    const CounterRng& rng
) {
    const size_t n = cells.size();
    thermal.hx.assign(n, 0.0);
    thermal.hy.assign(n, 0.0);
    thermal.hz.assign(n, 0.0);

    for (size_t i = 0; i < n; ++i) {
        const auto& cell = cells[i];
        if (!cell.active) {
            continue;
        }

        if (cell.temperature <= 0.0 || thermal.sigma_base[i] == 0.0) {
            continue;
        }

        const double sigma = thermal.sigma_base[i] * std::sqrt(cell.temperature / dt);
        const auto z = rng.normal4(thermal.thermal_epoch, thermal.attempt_id, static_cast<uint64_t>(i), 0u);

        thermal.hx[i] = sigma * z[0];
        thermal.hy[i] = sigma * z[1];
        thermal.hz[i] = sigma * z[2];
    }

    thermal.last_dt.assign(n, dt);
}

void rescale_rejected_brown_field(
    ThermalBuffers& thermal,
    double old_dt,
    double new_dt
) {
    if (old_dt <= 0.0 || new_dt <= 0.0) {
        throw std::runtime_error("invalid dt in rejected-step thermal rescale");
    }

    const double factor = std::sqrt(old_dt / new_dt);

    for (size_t i = 0; i < thermal.hx.size(); ++i) {
        thermal.hx[i] *= factor;
        thermal.hy[i] *= factor;
        thermal.hz[i] *= factor;
    }

    std::fill(thermal.last_dt.begin(), thermal.last_dt.end(), new_dt);
}

void heun_step_with_thermal_llg(
    State& state,
    const DeterministicFieldView& h_det,
    const ThermalConfig& thermal_cfg,
    ThermalBuffers& thermal,
    const CounterRng& rng,
    double dt
) {
    if (thermal_cfg.enabled) {
        generate_brown_field(thermal_cfg, state.cell_material_state, dt, thermal, rng);
    }

    VectorField h_total_0 = h_det.total_field();
    add_in_place(h_total_0, thermal.hx, thermal.hy, thermal.hz);

    State predictor = state;
    integrate_llg_explicit(predictor, h_total_0, dt);
    renormalize_each_spin(predictor);

    DeterministicFieldView h_det_pred = recompute_deterministic_fields(predictor);
    VectorField h_total_1 = h_det_pred.total_field();
    add_in_place(h_total_1, thermal.hx, thermal.hy, thermal.hz);

    integrate_llg_heun_corrector(state, predictor, h_total_0, h_total_1, dt);
    renormalize_each_spin(state);

    thermal.thermal_epoch += 1;
    thermal.attempt_id = 0;
}

bool adaptive_attempt_with_thermal_llg(
    State& state,
    const DeterministicFieldView& h_det,
    const ThermalConfig& thermal_cfg,
    ThermalBuffers& thermal,
    const CounterRng& rng,
    double dt_try,
    double& dt_next
) {
    if (thermal_cfg.enabled) {
        if (thermal.attempt_id == 0) {
            generate_brown_field(thermal_cfg, state.cell_material_state, dt_try, thermal, rng);
        } else if (thermal_cfg.rescale_noise_with_dt) {
            const double old_dt = thermal.last_dt.empty() ? dt_try : thermal.last_dt.front();
            rescale_rejected_brown_field(thermal, old_dt, dt_try);
        } else {
            generate_brown_field(thermal_cfg, state.cell_material_state, dt_try, thermal, rng);
        }
    }

    auto result = try_embedded_step(state, h_det, thermal, dt_try);

    if (result.accepted) {
        state = std::move(result.accepted_state);
        thermal.thermal_epoch += 1;
        thermal.attempt_id = 0;
        dt_next = result.suggested_dt;
        return true;
    }

    thermal.attempt_id += 1;
    dt_next = result.suggested_dt;
    return false;
}
```



# Załącznik F — szkic CUDA kernela i polityki RNG

```cpp
// thermal_rng.cu

struct PhiloxKey {
    uint64_t seed_lo;
    uint64_t seed_hi;
};

struct ThermalCounter {
    uint64_t thermal_epoch;
    uint32_t attempt_id;
    uint32_t component_id;
    uint64_t cell_id;
};

__device__ inline uint4 make_counter(
    uint64_t thermal_epoch,
    uint32_t attempt_id,
    uint64_t cell_id,
    uint32_t lane_tag
) {
    return make_uint4(
        static_cast<uint32_t>(thermal_epoch & 0xffffffffull),
        static_cast<uint32_t>((thermal_epoch >> 32) & 0xffffffffull),
        static_cast<uint32_t>(cell_id & 0xffffffffull),
        static_cast<uint32_t>((cell_id >> 32) & 0xffffffffull) ^ attempt_id ^ (lane_tag << 16)
    );
}

__device__ inline float2 normal2_from_uint4(uint4 bits) {
    float u1 = (bits.x + 1.0f) * 2.3283064e-10f;
    float u2 = (bits.y + 1.0f) * 2.3283064e-10f;
    float r = sqrtf(-2.0f * logf(u1));
    float p = 6.28318530718f * u2;
    return make_float2(r * cosf(p), r * sinf(p));
}

__global__ void brown_field_kernel(
    int n,
    const float* __restrict__ temperature,
    const float* __restrict__ sigma_base,
    float dt,
    uint64_t thermal_epoch,
    uint32_t attempt_id,
    PhiloxKey key,
    float* __restrict__ hx,
    float* __restrict__ hy,
    float* __restrict__ hz
) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) return;

    float Ti = temperature[i];
    if (!(Ti > 0.0f) || !(sigma_base[i] > 0.0f)) {
        hx[i] = 0.0f;
        hy[i] = 0.0f;
        hz[i] = 0.0f;
        return;
    }

    float sigma = sigma_base[i] * sqrtf(Ti / dt);

    uint4 c0 = make_counter(thermal_epoch, attempt_id, static_cast<uint64_t>(i), 0u);
    uint4 c1 = make_counter(thermal_epoch, attempt_id, static_cast<uint64_t>(i), 1u);

    uint4 r0 = philox4x32(c0, key.seed_lo, key.seed_hi);
    uint4 r1 = philox4x32(c1, key.seed_lo, key.seed_hi);

    float2 z0 = normal2_from_uint4(r0);
    float2 z1 = normal2_from_uint4(r1);

    hx[i] = sigma * z0.x;
    hy[i] = sigma * z0.y;
    hz[i] = sigma * z1.x;
}

// thermal_stepper.cu

struct ThermalStepState {
    uint64_t thermal_epoch;
    uint32_t attempt_id;
    float dt_last;
};

void launch_brown_field(
    int n,
    const DeviceArray<float>& temperature,
    const DeviceArray<float>& sigma_base,
    float dt,
    const ThermalStepState& ts,
    const PhiloxKey& key,
    DeviceArray<float>& hx,
    DeviceArray<float>& hy,
    DeviceArray<float>& hz,
    cudaStream_t stream
) {
    constexpr int block_size = 256;
    const int grid_size = (n + block_size - 1) / block_size;

    brown_field_kernel<<<grid_size, block_size, 0, stream>>>(
        n,
        temperature.data(),
        sigma_base.data(),
        dt,
        ts.thermal_epoch,
        ts.attempt_id,
        key,
        hx.data(),
        hy.data(),
        hz.data()
    );
}

void rescale_brown_field_if_needed(
    DeviceArray<float>& hx,
    DeviceArray<float>& hy,
    DeviceArray<float>& hz,
    float old_dt,
    float new_dt,
    cudaStream_t stream
) {
    float factor = sqrtf(old_dt / new_dt);
    scale_vector_in_place(hx, factor, stream);
    scale_vector_in_place(hy, factor, stream);
    scale_vector_in_place(hz, factor, stream);
}

void thermal_heun_step(
    DeviceState& state,
    const DeterministicFieldGpu& h_det,
    ThermalStepState& ts,
    const PhiloxKey& key,
    DeviceArray<float>& temperature,
    DeviceArray<float>& sigma_base,
    DeviceArray<float>& htx,
    DeviceArray<float>& hty,
    DeviceArray<float>& htz,
    float dt,
    cudaStream_t stream
) {
    launch_brown_field(
        state.n,
        temperature,
        sigma_base,
        dt,
        ts,
        key,
        htx,
        hty,
        htz,
        stream
    );

    compose_total_field_and_predict(state, h_det, htx, hty, htz, dt, stream);
    renormalize_spins(state, stream);
    recompute_det_field_and_correct(state, h_det, htx, hty, htz, dt, stream);
    renormalize_spins(state, stream);

    ts.thermal_epoch += 1;
    ts.attempt_id = 0;
    ts.dt_last = dt;
}

bool thermal_adaptive_try_step(
    DeviceState& state,
    const DeterministicFieldGpu& h_det,
    ThermalStepState& ts,
    const PhiloxKey& key,
    DeviceArray<float>& temperature,
    DeviceArray<float>& sigma_base,
    DeviceArray<float>& htx,
    DeviceArray<float>& hty,
    DeviceArray<float>& htz,
    float dt_try,
    float* dt_next,
    cudaStream_t stream
) {
    if (ts.attempt_id == 0) {
        launch_brown_field(state.n, temperature, sigma_base, dt_try, ts, key, htx, hty, htz, stream);
    } else {
        rescale_brown_field_if_needed(htx, hty, htz, ts.dt_last, dt_try, stream);
    }

    EmbeddedStepResult result = run_embedded_trial_step(state, h_det, htx, hty, htz, dt_try, stream);

    if (result.accepted) {
        state.swap(result.accepted_state);
        ts.thermal_epoch += 1;
        ts.attempt_id = 0;
        ts.dt_last = result.suggested_dt;
        *dt_next = result.suggested_dt;
        return true;
    }

    ts.attempt_id += 1;
    ts.dt_last = dt_try;
    *dt_next = result.suggested_dt;
    return false;
}
```



# Załącznik G — szkic solvera `HeatEquation` i `2TM`

```python
from dataclasses import dataclass
from typing import Literal

BoundaryKind = Literal["adiabatic", "dirichlet", "neumann"]


@dataclass(frozen=True)
class ScalarLaw:
    def to_ir(self) -> dict:
        raise NotImplementedError


@dataclass(frozen=True)
class ConstantScalar(ScalarLaw):
    value: float

    def to_ir(self) -> dict:
        return {"kind": "constant", "value": float(self.value)}


@dataclass(frozen=True)
class GaussianLaserPulse:
    peak_power_density: float
    centre_time: float
    sigma_time: float
    absorption_depth: float | None = None
    spot_radius: float | None = None

    def to_ir(self) -> dict:
        return {
            "kind": "gaussian_laser_pulse",
            "peak_power_density": float(self.peak_power_density),
            "centre_time": float(self.centre_time),
            "sigma_time": float(self.sigma_time),
            "absorption_depth": None if self.absorption_depth is None else float(self.absorption_depth),
            "spot_radius": None if self.spot_radius is None else float(self.spot_radius),
        }


@dataclass(frozen=True)
class BoundaryCondition:
    kind: BoundaryKind
    value: float | None = None

    def to_ir(self) -> dict:
        data = {"kind": self.kind}
        if self.value is not None:
            data["value"] = float(self.value)
        return data


@dataclass(frozen=True)
class HeatEquationSolver:
    heat_capacity: ScalarLaw
    conductivity: ScalarLaw
    source: object | None = None
    initial_temperature: object = ConstantScalar(300.0)
    boundary_x_min: BoundaryCondition = BoundaryCondition("adiabatic")
    boundary_x_max: BoundaryCondition = BoundaryCondition("adiabatic")
    boundary_y_min: BoundaryCondition = BoundaryCondition("adiabatic")
    boundary_y_max: BoundaryCondition = BoundaryCondition("adiabatic")
    boundary_z_min: BoundaryCondition = BoundaryCondition("adiabatic")
    boundary_z_max: BoundaryCondition = BoundaryCondition("adiabatic")

    def to_ir(self) -> dict:
        return {
            "kind": "heat_equation",
            "heat_capacity": self.heat_capacity.to_ir(),
            "conductivity": self.conductivity.to_ir(),
            "source": None if self.source is None else self.source.to_ir(),
            "initial_temperature": self.initial_temperature.to_ir(),
            "boundaries": {
                "x_min": self.boundary_x_min.to_ir(),
                "x_max": self.boundary_x_max.to_ir(),
                "y_min": self.boundary_y_min.to_ir(),
                "y_max": self.boundary_y_max.to_ir(),
                "z_min": self.boundary_z_min.to_ir(),
                "z_max": self.boundary_z_max.to_ir(),
            },
        }


@dataclass(frozen=True)
class TwoTemperatureCoupling:
    electron_heat_capacity: ScalarLaw
    lattice_heat_capacity: ScalarLaw
    electron_conductivity: ScalarLaw
    lattice_conductivity: ScalarLaw | None
    electron_lattice_coupling: ScalarLaw
    source: object | None = None
    initial_electron_temperature: object = ConstantScalar(300.0)
    initial_lattice_temperature: object = ConstantScalar(300.0)
    magnetic_coupling: Literal["electron", "lattice", "weighted"] = "electron"
    magnetic_coupling_weight: float | None = None

    def to_ir(self) -> dict:
        out = {
            "kind": "two_temperature_model",
            "electron_heat_capacity": self.electron_heat_capacity.to_ir(),
            "lattice_heat_capacity": self.lattice_heat_capacity.to_ir(),
            "electron_conductivity": self.electron_conductivity.to_ir(),
            "lattice_conductivity": None if self.lattice_conductivity is None else self.lattice_conductivity.to_ir(),
            "electron_lattice_coupling": self.electron_lattice_coupling.to_ir(),
            "source": None if self.source is None else self.source.to_ir(),
            "initial_electron_temperature": self.initial_electron_temperature.to_ir(),
            "initial_lattice_temperature": self.initial_lattice_temperature.to_ir(),
            "magnetic_coupling": self.magnetic_coupling,
        }
        if self.magnetic_coupling_weight is not None:
            out["magnetic_coupling_weight"] = float(self.magnetic_coupling_weight)
        return out
```



# Załącznik H — przykładowe skrypty użytkownika

## H.1 Makrospin z temperaturą

```python
import numpy as np
import fullmag as fm

problem = fm.Problem(
    magnets=[
        fm.Ferromagnet(
            geometry=fm.Box((5e-9, 5e-9, 5e-9)),
            material=fm.Material(
                name="macrospin",
                Ms=8e5,
                A=13e-12,
                alpha=0.02,
            ),
            m0=(0.0, 0.0, 1.0),
        ),
    ],
    energy=[
        fm.Exchange(),
        fm.Zeeman(H=(0.0, 0.0, 50e-3 / fm.mu0)),
    ],
    study=fm.TimeEvolution(
        dynamics=fm.LLG(
            integrator="heun",
            fixed_timestep=1e-14,
            thermal_model=fm.BrownThermalField(
                temperature=fm.UniformTemperature(300.0),
                seed=7,
            ),
        ),
        t_end=5e-9,
        outputs=[
            fm.FieldOutput("m", every=1e-12),
            fm.FieldOutput("H_therm", every=1e-12),
            fm.FieldOutput("H_eff", every=1e-12),
        ],
    ),
    backend_hint=fm.FDM(cell_size=(5e-9, 5e-9, 5e-9)),
)

run = problem.run()
print(run)
```

## H.2 Gradient temperatury

```python
import fullmag as fm

temperature = fm.AnalyticTemperature("300 + 150 * x / Lx")

mat = fm.Material(
    name="NiFe",
    Ms=8e5,
    A=13e-12,
    alpha=0.01,
    temperature_laws=fm.TemperatureLaws(
        Ms=fm.Tabulated1D(
            points=[
                (0.0,   8.6e5),
                (300.0, 8.0e5),
                (500.0, 6.8e5),
                (700.0, 4.1e5),
            ],
            interpolation="pchip",
            extrapolation="clamp",
        ),
        A=fm.PowerLawFromReducedMagnetization(
            value0=13e-12,
            reduced_magnetisation="Ms/Ms0",
            exponent=1.8,
        ),
    ),
)

problem = fm.Problem(
    magnets=[
        fm.Ferromagnet(
            geometry=fm.Box((400e-9, 80e-9, 1e-9)),
            material=mat,
            m0=fm.domain_wall(kind="neel", axis="x"),
        ),
    ],
    energy=[
        fm.Exchange(),
        fm.Demag(),
    ],
    study=fm.TimeEvolution(
        dynamics=fm.LLG(
            integrator="heun",
            fixed_timestep=2e-14,
            thermal_model=fm.BrownThermalField(
                temperature=temperature,
                seed=2026,
            ),
        ),
        t_end=10e-9,
        outputs=[
            fm.FieldOutput("m", every=2e-11),
            fm.FieldOutput("T", every=2e-11),
            fm.FieldOutput("H_therm", every=2e-11),
            fm.ScalarOutput("E_total", every=2e-11),
        ],
    ),
    backend_hint=fm.FDM(cell_size=(2e-9, 2e-9, 1e-9)),
)
```

## H.3 `LLB` z impulsem cieplnym

```python
import fullmag as fm

heat = fm.TwoTemperatureModel(
    electron_heat_capacity=fm.ConstantScalar(7.0e2),
    lattice_heat_capacity=fm.ConstantScalar(2.8e6),
    electron_conductivity=fm.ConstantScalar(80.0),
    electron_lattice_coupling=fm.ConstantScalar(2.2e17),
    source=fm.GaussianLaserPulse(
        peak_power_density=2.0e19,
        centre_time=0.5e-12,
        sigma_time=0.1e-12,
    ),
    magnetic_coupling="electron",
)

mat = fm.Material(
    name="FePt",
    Ms=1.1e6,
    alpha=0.03,
    temperature_laws=fm.TemperatureLaws(
        Tc=750.0,
        m_eq=fm.Tabulated1D(
            points=[
                (0.0,   1.0),
                (300.0, 0.95),
                (500.0, 0.70),
                (700.0, 0.20),
                (750.0, 0.00),
            ]
        ),
        chi_parallel=fm.Tabulated1D(
            points=[
                (0.0,   1e-4),
                (300.0, 5e-4),
                (500.0, 2e-3),
                (700.0, 1e-2),
            ]
        ),
        chi_perp=fm.Tabulated1D(
            points=[
                (0.0,   2e-4),
                (300.0, 8e-4),
                (500.0, 3e-3),
                (700.0, 1.2e-2),
            ]
        ),
    ),
)

problem = fm.Problem(
    magnets=[
        fm.Ferromagnet(
            geometry=fm.Box((40e-9, 40e-9, 8e-9)),
            material=mat,
            m0=(0.0, 0.0, 1.0),
        ),
    ],
    energy=[
        fm.Exchange(),
        fm.Zeeman(H=(0.0, 0.0, 0.0)),
    ],
    study=fm.TimeEvolution(
        dynamics=fm.LLB(
            integrator="heun",
            fixed_timestep=2e-15,
            temperature=heat,
        ),
        t_end=10e-12,
        outputs=[
            fm.FieldOutput("m_ref", every=1e-13),
            fm.FieldOutput("T", every=1e-13),
        ],
    ),
    backend_hint=fm.FDM(cell_size=(2e-9, 2e-9, 2e-9)),
)
```



# Załącznik I — szkic testów regresyjnych

```python
import math
import numpy as np
import pytest


def ensemble_mean(values: np.ndarray) -> float:
    return float(np.mean(values))


def ensemble_std(values: np.ndarray) -> float:
    return float(np.std(values, ddof=1))


def confidence_interval_95(values: np.ndarray) -> tuple[float, float]:
    mean = ensemble_mean(values)
    std = ensemble_std(values)
    half = 1.96 * std / math.sqrt(len(values))
    return mean - half, mean + half


@pytest.mark.physics
def test_brown_seed_reproducibility(tmp_path):
    run_a = run_problem(seed=123)
    run_b = run_problem(seed=123)
    assert np.allclose(run_a["m"][:100], run_b["m"][:100], atol=0.0, rtol=0.0)


@pytest.mark.physics
def test_brown_different_seed_changes_trajectory(tmp_path):
    run_a = run_problem(seed=123)
    run_b = run_problem(seed=124)
    assert not np.allclose(run_a["m"][:100], run_b["m"][:100], atol=0.0, rtol=0.0)


@pytest.mark.physics
def test_macrospin_boltzmann_mean_projection():
    samples = []
    for seed in range(128):
        out = run_macrospin_equilibrium(seed=seed)
        samples.append(out["m_z_mean_last_half"])
    samples = np.asarray(samples)
    lo, hi = confidence_interval_95(samples)
    assert lo <= expected_boltzmann_mz() <= hi


@pytest.mark.physics
def test_switching_probability_monotonic_in_temperature():
    temps = [100.0, 200.0, 300.0, 400.0]
    probs = []
    for T in temps:
        switched = 0
        trials = 64
        for seed in range(trials):
            out = run_switching_case(T=T, seed=seed)
            switched += int(out["switched"])
        probs.append(switched / trials)

    assert probs[0] <= probs[1] <= probs[2] <= probs[3]


@pytest.mark.physics
def test_weak_convergence_with_dt():
    dts = [4e-14, 2e-14, 1e-14]
    means = []
    for dt in dts:
        vals = []
        for seed in range(96):
            out = run_macrospin_equilibrium(seed=seed, dt=dt)
            vals.append(out["m_z_mean_last_half"])
        means.append(np.mean(vals))

    ref = means[-1]
    assert abs(means[1] - ref) < abs(means[0] - ref)


@pytest.mark.physics
def test_temperature_law_clamps_outside_range():
    law = Tabulated1D(
        points=[(0.0, 1.0), (300.0, 0.8), (600.0, 0.2)],
        interpolation="linear",
        extrapolation="clamp",
    )
    assert math.isclose(eval_law(law, -100.0), 1.0)
    assert math.isclose(eval_law(law, 700.0), 0.2)


@pytest.mark.physics
def test_llg_rejected_when_ms_crosses_zero():
    problem = build_problem_with_ms_zero_crossing_and_llg()
    diags = validate_problem(problem)
    assert any(d.code == "llg_nonpositive_ms" for d in diags)


@pytest.mark.physics
def test_planner_warns_near_tc_for_llg():
    problem = build_problem_with_temperature_ratio(0.8)
    diags = validate_problem(problem)
    assert any(d.code == "llg_near_tc" for d in diags)


@pytest.mark.physics
def test_cpu_cuda_statistics_match():
    cpu_samples = []
    cuda_samples = []

    for seed in range(64):
        cpu = run_macrospin_equilibrium(seed=seed, backend="cpu_double")
        gpu = run_macrospin_equilibrium(seed=seed, backend="cuda_double")
        cpu_samples.append(cpu["m_z_mean_last_half"])
        cuda_samples.append(gpu["m_z_mean_last_half"])

    cpu_samples = np.asarray(cpu_samples)
    cuda_samples = np.asarray(cuda_samples)

    assert abs(cpu_samples.mean() - cuda_samples.mean()) < 5e-3
    assert abs(cpu_samples.std(ddof=1) - cuda_samples.std(ddof=1)) < 5e-3


@pytest.mark.physics
def test_adaptive_reuses_noise_on_rejected_step():
    run = run_case_with_forced_rejected_steps(seed=55)
    meta = run["provenance"]
    assert meta["noise_reuse_policy"] == "reuse_and_rescale"
    assert meta["rejected_steps"] > 0
```



# Załącznik J — odpowiedź praktyczna: jak to zrobić najlepiej?

Jeżeli miałbym doradzić **jedną najlepszą ścieżkę wdrożenia** do FullMag, to wyglądałaby tak:

## Najlepszy plan techniczny

### Krok 1
Dodać **`BrownThermalField` jako element `DynamicsIR::Llg`**, nie jako `EnergyTerm`.

### Krok 2
Dodać **jawny `TemperatureField`** od razu, nawet jeśli pierwsza wykonawcza ścieżka wspiera tylko `UniformTemperature`.

### Krok 3
Dodać **`TemperatureLaws`** w materiałach i pozwolić na `Ms(T)`, `A(T)`, `Ku(T)`, `alpha(T)`.

### Krok 4
Ograniczyć pierwszy publiczny solver thermal do:

- FDM,
- `heun`,
- fixed-step,
- counter-based RNG,
- double precision jako wzorzec.

### Krok 5
Rozszerzyć output policy o:

- `H_therm`,
- `H_eff_det`,
- `H_eff`,
- `T`,
- provenance RNG.

### Krok 6
Dopiero po walidacji dodać adaptive thermal stepping.

### Krok 7
Dopiero jako drugi duży etap dodać **`LLB`** z nową semantyką stanu i dodatkowymi prawami materiałowymi.

### Krok 8
Na końcu dodać `HeatEquation` i `2TM` jako źródła `T(x,t)`.

## Najważniejsza decyzja filozoficzna

Najbardziej poprawna odpowiedź na pytanie „jaki jest najlepszy model temperatury?” brzmi:

> **Nie ma jednego najlepszego modelu dla wszystkich przypadków.**
> Najlepsza jest **warstwowa architektura**, w której:
> - `sLLG` jest najlepszym pierwszym i najczęściej używanym modelem,
> - `TemperatureLaws` są koniecznym partnerem dla sensownej fizyki materiałowej,
> - `LLB` przejmuje reżim blisko `Tc`,
> - `2TM/3TM` dostarczają `T(x,t)` dla najszybszych i najgorętszych procesów.

## Gdybym miał wybrać tylko jedną rzecz do zrobienia dziś

Wybrałbym:

**`LLG + Brown thermal field + TemperatureField + TemperatureLaws`**  
w obecnym uczciwym stosie `FDM + Heun`, z bardzo mocnym naciskiem na:

- dokument fizyczny,
- precyzyjny kontrakt RNG,
- rozdzielenie outputów,
- walidację makrospinową i ensemble.

To jest rozwiązanie jednocześnie:

- najbardziej przydatne,
- najlepiej zgodne z obecną architekturą FullMag,
- najmniej ryzykowne naukowo,
- najlepsze jako fundament pod `LLB` i modele cieplne wyższego poziomu.

# Bibliografia robocza i źródła do dalszego wdrożenia

## Repozytorium FullMag

- `README.md`
- `docs/physics/0000-physics-documentation-standard.md`
- `docs/physics/0050-shared-problem-semantics-and-embedded-python-api.md`
- `docs/physics/0200-llg-exchange-reference-engine.md`
- `docs/specs/problem-ir-v0.md`
- `docs/specs/capability-matrix-v0.md`
- `docs/specs/material-assignment-and-spatial-fields-v0.md`
- `docs/specs/output-naming-policy-v0.md`
- `packages/fullmag-py/src/fullmag/__init__.py`
- `packages/fullmag-py/src/fullmag/model/dynamics.py`
- `packages/fullmag-py/src/fullmag/model/structure.py`
- `examples/exchange_relax.py`
- `examples/exchange_demag_zeeman.py`
- `examples/dw_track.py`

## Literatura i implementacje referencyjne

- W. F. Brown Jr., *Thermal Fluctuations of a Single-Domain Particle*, 1963.
- J. M. D. Coey / klasyczna literatura o termicznej aktywacji i superparamagnetyzmie.
- Leliaert et al., *Adaptively time stepping the stochastic Landau-Lifshitz-Gilbert equation*, 2017.
- Atxitia et al., *Fundamentals and applications of the Landau-Lifshitz-Bloch equation*, 2017.
- Evans et al., *Stochastic form of the Landau-Lifshitz-Bloch equation*, 2012.
- Chubykalo-Fesenko et al., *Dynamic approach for micromagnetics close to the Curie temperature*, 2006.
- Hirst et al., wieloskalowe wyznaczanie parametrów `m_e(T)`, `A(T)`, `chi_parallel(T)` dla modeli finite-temperature.
- Grinstein & Koch, *Coarse graining in micromagnetics*.
- Kirschner et al., *Cell size corrections for nonzero-temperature micromagnetics*.
- MuMax3 sources (`engine/temperature.go`) jako przykład praktycznej polityki cache/reuse/rescale szumu.

