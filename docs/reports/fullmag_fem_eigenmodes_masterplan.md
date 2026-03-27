
# Fullmag — mikromagnetyczne zagadnienie własne, dyspersja fal spinowych i warunki periodyczne Blocha
## Dokumentacja fizyczna + pełny plan wdrożenia programistycznego dla FEM oraz opcjonalnie FDM

**Wersja dokumentu:** 0.9  
**Data opracowania:** 2026-03-27  
**Repozytorium docelowe:** `MateuszZelent/fullmag`  
**Cel:** przygotować kompletną, techniczną instrukcję wdrożenia w fullmagu obliczeń własnych typu *eigenmode / dispersion* dla mikromagnetyki, ze szczególnym naciskiem na:
- linearyzację równania LLG wokół stanu równowagi,
- obliczanie częstości własnych i modów własnych,
- dyspersję fal spinowych `ω(k)` dla komórki periodycznej,
- warunki periodyczne Blocha,
- docelowe osadzenie w obecnej architekturze fullmaga,
- osobne potraktowanie ścieżki FEM i — jeśli ma to sens — FDM.

> Ten dokument ma dwa poziomy:
> 1. **fakty o obecnym stanie fullmaga**, potwierdzone na aktualnym `master`,
> 2. **projekt docelowy**, czyli rekomendowany plan wdrożenia.

---

# Spis treści

1. [Streszczenie wykonawcze](#1-streszczenie-wykonawcze)  
2. [Stan obecny fullmaga — co repo umie dziś naprawdę](#2-stan-obecny-fullmaga--co-repo-umie-dziś-naprawdę)  
3. [Wniosek architektoniczny](#3-wniosek-architektoniczny)  
4. [Zakres funkcjonalny „modułu mikromagnetycznego” w duchu COMSOL](#4-zakres-funkcjonalny-modułu-mikromagnetycznego-w-duchu-comsol)  
5. [Model fizyczny mikromagnetyki](#5-model-fizyczny-mikromagnetyki)  
6. [Równanie LLG i jego postacie robocze](#6-równanie-llg-i-jego-postacie-robocze)  
7. [Stan równowagi i problem stacjonarny](#7-stan-równowagi-i-problem-stacjonarny)  
8. [Linearyzacja wokół równowagi i zagadnienie własne](#8-linearyzacja-wokół-równowagi-i-zagadnienie-własne)  
9. [Warunki brzegowe](#9-warunki-brzegowe)  
10. [Periodyczność Blocha i dyspersja fal spinowych](#10-periodyczność-blocha-i-dyspersja-fal-spinowych)  
11. [Dyskretyzacja FEM](#11-dyskretyzacja-fem)  
12. [Dyskretyzacja FDM](#12-dyskretyzacja-fdm)  
13. [Najważniejszy wybór projektowy dla fullmaga](#13-najważniejszy-wybór-projektowy-dla-fullmaga)  
14. [Docelowy model publicznego API](#14-docelowy-model-publicznego-api)  
15. [Zmiany w Python DSL](#15-zmiany-w-python-dsl)  
16. [Zmiany w `ProblemIR` / `StudyIR` / planach backendowych](#16-zmiany-w-problemir--studyir--planach-backendowych)  
17. [Planner — pełny plan zmian](#17-planner--pełny-plan-zmian)  
18. [Runner — pełny plan zmian](#18-runner--pełny-plan-zmian)  
19. [Engine FEM — pełny plan zmian](#19-engine-fem--pełny-plan-zmian)  
20. [Native FEM backend i C ABI — pełny plan zmian](#20-native-fem-backend-i-c-abi--pełny-plan-zmian)  
21. [Opcjonalna ścieżka FDM — co ma sens, a co nie](#21-opcjonalna-ścieżka-fdm--co-ma-sens-a-co-nie)  
22. [Solver eigenspektralny — rekomendowany kształt](#22-solver-eigenspektralny--rekomendowany-kształt)  
23. [Artefakty wyjściowe i UX](#23-artefakty-wyjściowe-i-ux)  
24. [Walidacja naukowa i testy](#24-walidacja-naukowa-i-testy)  
25. [Plan wdrożenia krok po kroku](#25-plan-wdrożenia-krok-po-kroku)  
26. [Ryzyka techniczne i decyzje, których nie wolno odkładać](#26-ryzyka-techniczne-i-decyzje-których-nie-wolno-odkładać)  
27. [Proponowany szkielet nowej notki `docs/physics`](#27-proponowany-szkielet-nowej-notki-docsphysics)  
28. [Checklisty implementacyjne](#28-checklisty-implementacyjne)  
29. [Źródła i odniesienia](#29-źródła-i-odniesienia)  

---

# 1. Streszczenie wykonawcze

## 1.1. Co jest najważniejsze

Jeżeli celem jest dodanie do fullmaga:
- **zagadnienia własnego FEM**,
- **modów własnych**,
- **dyspersji fal spinowych**,
- **warunków periodycznych Blocha**,

to nie należy tego „dopisywać” do obecnej ścieżki `TimeEvolution`, tylko zbudować **osobny tor wykonania**:
- osobny publiczny typ studium: `Eigenmodes`,
- osobny wariant `StudyIR`,
- osobny backend plan: `FemEigenPlanIR`,
- osobny runner,
- osobny C ABI,
- osobny kontekst backendowy po stronie natywnej.

To jest najważniejsza decyzja architektoniczna w całym wdrożeniu.

## 1.2. Dlaczego

Obecny fullmag ma już:
- spójny Python DSL,
- wspólne `ProblemIR`,
- planner,
- wykonywalne ścieżki FDM,
- wykonywalne ścieżki FEM referencyjne i natywne,

ale obecna ścieżka FEM jest **wyraźnie time-stepping-centryczna**:
- plan FEM jest projektowany pod `LLG + integrator + dt`,
- runner FEM wykonuje `step`,
- C ABI FEM posiada `dt_seconds`, `integrator`, `backend_step`,
- natywny backend FEM jest dzisiaj zorganizowany wokół kroku Heuna.

To nie jest dobry kontener na zagadnienie własne.

## 1.3. Co wdrażać najpierw

Rekomendowana kolejność:

1. nowa notka `docs/physics` dla eigenmodes + Bloch periodicity,  
2. `Eigenmodes` w Python DSL,  
3. `StudyIR::Eigenmodes`,  
4. `BackendPlanIR::FemEigen(FemEigenPlanIR)`,  
5. CPU reference FEM eigen solver dla:
   - stanu równowagi `m0`,
   - `Exchange + Zeeman`,
   - bez demagu,
   - z `Γ-point`, a potem z `k-path`,
6. realizacja warunków Blocha,
7. eksport `bands.csv/json` + modów własnych,
8. dopiero potem demag,
9. dużo później: anizotropia, DMI, STT, temperatura, multiphysics.

## 1.4. Najkrótsza wersja planu v1

**Najmniejszy sensowny milestone**:
- jedna komórka periodyczna,
- jeden materiał magnetyczny,
- jedna siatka tetra,
- stan równowagi z wcześniejszej relaksacji,
- przestrzeń `H1` niskiego rzędu dla magnetyzacji,
- linearyzacja na płaszczyźnie stycznej,
- `α = 0`,
- `Exchange + Zeeman`,
- `k_path`,
- kilka najniższych modów,
- zapis pasma i modów.

To już daje realną wartość naukową.

---

# 2. Stan obecny fullmaga — co repo umie dziś naprawdę

Ta sekcja opisuje tylko to, co da się uzasadnić z aktualnego stanu repo.

## 2.1. Kontrakt architektoniczny

Fullmag jest budowany wokół zasady:

> **wspólny interfejs opisuje problem fizyczny, a nie numeryczny layout siatki**

To jest bardzo ważne, bo wymusza rozdział między:
- **shared semantics** problemu,
- a **backend-specific realization** na siatce FDM/FEM/hybrid.

W praktyce oznacza to, że:
- publiczna warstwa ma mówić „co liczymy”,
- a nie „jak konkretnie sparowaliśmy węzły na krawędzi periodic slave/master”.

## 2.2. Komponenty repo

Główne elementy repo:
- `packages/fullmag-py` — Python DSL,
- `crates/fullmag-ir` — typed IR,
- `crates/fullmag-plan` — planner,
- `crates/fullmag-runner` — wykonanie planów,
- `crates/fullmag-engine` — silniki referencyjne / wspólna logika,
- `crates/fullmag-fem-sys` i `crates/fullmag-fdm-sys` — C ABI,
- `native/` — backendy natywne,
- `docs/physics` — publication-style notes.

## 2.3. Reguła „docs first”

Repo narzuca bardzo dobrą zasadę:
przed wdrożeniem nowej fizyki lub nowej numeryki trzeba najpierw utworzyć lub zaktualizować notkę w `docs/physics/`.

W praktyce dla tego zadania oznacza to, że **pierwszy commit nie powinien zaczynać się od kodu**, tylko od dokumentu fizyczno-numerycznego.

## 2.4. Obecne studia w Pythonie

W publicznym Python DSL są dziś studia:
- `TimeEvolution`
- `Relaxation`

Nie ma jeszcze `Eigenmodes`.

To ma duże konsekwencje:
- nie ma semantycznego miejsca na `k_path`,
- nie ma miejsca na `n_modes`,
- nie ma miejsca na politykę normalizacji modów,
- nie ma miejsca na periodyczność Blocha.

## 2.5. Obecny `StudyIR`

W `crates/fullmag-ir/src/lib.rs` `StudyIR` ma dziś warianty:
- `TimeEvolution { ... }`
- `Relaxation { ... }`

Nie ma wariantu własnego / spektralnego.

## 2.6. Obecne termy energii

`EnergyTermIR` obejmuje dziś:
- `Exchange`
- `Demag`
- `InterfacialDmi { D }`
- `Zeeman { B }`

To jest ważne:
- część składników potrzebnych do przyszłego „modułu mikromagnetycznego” już semantycznie istnieje,
- ale własne studium oraz infrastruktura linearyzacji jeszcze nie.

## 2.7. Obecny stan FDM

README repo wprost mówi, że **uczciwy wykonywalny physics slice** to dziś:
- `Box + Exchange + Demag + Zeeman + TimeEvolution(LLG-Heun) + FDM`
- CPU reference w `double`
- native CUDA FDM w `double`
- native CUDA `single` istnieje, ale nie jest jeszcze public-qualified.

Ponadto z `crates/fullmag-engine/src/lib.rs` widać, że FDM silnik:
- pracuje na `GridShape` i `CellSize`,
- ma `ExchangeLlgProblem`,
- ma `EffectiveFieldTerms` (`exchange`, `demag`, `external_field`),
- używa FFT workspace dla demagu,
- ma `active_mask`.

To znaczy: FDM jest dziś realnym, działającym, time-domain silnikiem na siatce regularnej.

## 2.8. Obecny stan FEM

Tu aktualny stan jest ciekawszy, niż sugeruje starszy opis bootstrapowy.

### 2.8.1. Planner i plany FEM

W `BackendPlanIR` istnieje dziś:
- `Fdm(FdmPlanIR)`
- `FdmMultilayer(FdmMultilayerPlanIR)`
- `Fem(FemPlanIR)`

`FemPlanIR` zawiera m.in.:
- `mesh_name`,
- `mesh_source`,
- `mesh: MeshIR`,
- `fe_order`,
- `hmax`,
- `initial_magnetization`,
- `material`,
- flagi dla `exchange` i `demag`,
- `external_field`,
- `gyromagnetic_ratio`.

To jest nadal plan pod klasyczne LLG / stepper.

### 2.8.2. Runner FEM

W `crates/fullmag-runner/src/dispatch.rs` są dziś:
- `execute_fem(...)`,
- `execute_fem_with_callback(...)`.

Runner rozróżnia:
- `FemEngine::CpuReference`,
- `FemEngine::NativeGpu`.

To oznacza, że FEM nie jest już tylko „planner-ready”; istnieje faktyczna ścieżka wykonania.

### 2.8.3. CPU reference FEM

W `crates/fullmag-runner/src/fem_reference.rs` wprost zapisano, że obecny wykonywalny slice FEM to:
- precomputed `MeshIR`,
- `Exchange`,
- opcjonalny bootstrap `Demag`,
- opcjonalny `Zeeman`,
- `LLG(heun)`,
- `double`.

### 2.8.4. Engine FEM

Z `crates/fullmag-engine/src/fem.rs` wynika, że obecny FEM engine:
- trzyma topologię siatki tetra,
- liczy lokalne objętości elementów,
- liczy gradienty funkcji kształtu,
- składa element stiffness dla wymiany,
- ma nodalne objętości/lumped masses,
- normalizuje magnetyzację po kroku,
- wspiera dziś przede wszystkim krok Heuna,
- liczy pole efektywne jako suma:
  - exchange,
  - demag,
  - external field.

Dla demagu są obecnie dwie drogi:
1. **Robin / bootstrap magnetostatics** na siatce FEM,
2. **transfer-grid demag** — rasteryzacja do pomocniczej siatki FDM i użycie FDM demag.

To jest ogromnie ważne dla planu eigenproblemu:
- istnieją już części operatorów,
- ale obecny kod jest zorganizowany wokół time stepping,
- a demag nie jest jeszcze „czystym, finalnym operatorem FEM w przestrzeni własnej”.

### 2.8.5. Native FEM C ABI

`crates/fullmag-fem-sys/src/lib.rs` pokazuje, że dzisiejszy C ABI FEM jest wyraźnie zorientowany na stepper:
- opis planu zawiera `integrator`,
- zawiera `dt_seconds`,
- eksportuje `backend_create`,
- eksportuje `backend_step`,
- eksportuje kopiowanie pól rzeczywistych.

To nie nadaje się bezpośrednio jako API dla solvera własnego.

### 2.8.6. Native backend FEM

`native/backends/fem/src/api.cpp` pokazuje, że backend natywny:
- wymaga `FULLMAG_USE_MFEM_STACK=ON`,
- tworzy kontekst z planu,
- wywołuje funkcję kroku zorientowaną na Heun / exchange path,
- nie ma jeszcze osobnego toru operatorowego lub eigensolverowego.

## 2.9. Co z tego wynika

Aktualny fullmag:
- ma już solidną podstawę architektoniczną,
- ma realnie działające FDM,
- ma realnie działające wąskie FEM,
- ma notkę fizyczną `0410` i kolejne notki FEM,
- ale **nie ma jeszcze infrastruktury do problemu własnego**.

---

# 3. Wniosek architektoniczny

## 3.1. Teza

**Eigenmodes nie może być wariantem obecnego `TimeEvolution`.**

Powód:
- dane wejściowe są inne,
- lifecycle obliczeń jest inny,
- artefakty wyjściowe są inne,
- solver jest inny,
- struktury algebraiczne są inne,
- z czasem dojdą zespolone wektory własne i zespolone warunki Blocha.

## 3.2. Teza pomocnicza

**Eigenmodes nie powinno być upchnięte do obecnego `FemPlanIR`.**

Powód:
- `FemPlanIR` jest dziś planem „przebiegu dynamicznego”,
- posiada parametry typu `dt` / `integrator`,
- nie posiada semantyki `k_path`, `n_modes`, `target`, `shift`, `periodicity`,
- nie ma osobnej polityki eksportu modów.

## 3.3. Docelowa decyzja

Rekomenduję wprowadzić:

```text
StudyIR::Eigenmodes { ... }
BackendPlanIR::FemEigen(FemEigenPlanIR)
```

Opcjonalnie później:

```text
BackendPlanIR::FdmEigen(FdmEigenPlanIR)
```

---

# 4. Zakres funkcjonalny „modułu mikromagnetycznego” w duchu COMSOL

COMSOL w swoim materiale o mikromagnetyce podkreśla, że moduł tego typu powinien docelowo obejmować nie tylko klasyczne LLG, ale także:
- exchange,
- uniaxial anisotropy,
- DMI i wynikające z niej warunki brzegowe,
- pinning boundary conditions,
- periodic boundary conditions,
- arbitralne pola i momenty,
- STT,
- finite temperature,
- wiele równań LLG w jednej geometrii,
- multiphysics coupling.

To jest bardzo dobra inspiracja dla **docelowego envelope funkcjonalnego** fullmaga, ale nie wolno mieszać:
- **celu długoterminowego**
z
- **pierwszym wykonalnym milestone’em**.

## 4.1. Zakres v1 dla fullmaga

Wersja pierwsza dla eigenproblemu powinna obejmować:
- jeden ferromagnes,
- jedna siatka tetra,
- equilibrium `m0`,
- `Exchange`,
- `Zeeman`,
- opcjonalnie później `Demag`,
- `α = 0`,
- warunki Blocha,
- eksport modów i pasm.

## 4.2. Zakres v2

Drugi etap:
- demag dla modów własnych,
- `Γ-point` + pełna ścieżka `k`,
- jakościowy benchmark na cienkim filmie.

## 4.3. Zakres v3+

Dopiero później:
- anizotropia uniaxjalna i ogólna,
- DMI,
- pinning,
- damping w problemie własnym,
- STT / SOT,
- finite temperature (nie dla standardowego eigenproblemu),
- wielomateriałowość,
- multiphysics.

---

# 5. Model fizyczny mikromagnetyki

W tej sekcji rozpisuję model fizyczny w sposób przydatny do implementacji.

## 5.1. Zmienne i notacja

Niech:
- `Ω ⊂ R^3` — obszar magnetyka,
- `M(x,t)` — magnetyzacja [A/m],
- `M_s(x)` — magnetyzacja nasycenia [A/m],
- `m(x,t) = M(x,t) / M_s(x)` — znormalizowana magnetyzacja,
- `|m| = 1`,
- `A(x)` — stała wymiany [J/m],
- `K_u(x)` — stała anizotropii [J/m^3],
- `u(x)` — oś anizotropii, `|u| = 1`,
- `H_ext(x,t)` — pole zewnętrzne [A/m],
- `H_d(x,t)` — pole demagnetyzujące [A/m],
- `μ0` — przenikalność magnetyczna próżni [N/A²],
- `γ0` — używana w implementacji dodatnia stała precesji zgodna z polem w A/m,
- `α` — bezwymiarowy damping Gilberta.

Wariant notacji, który najczyściej pasuje do obecnego fullmaga:
- pola efektywne liczymy w **A/m**,
- równanie dynamiki zapisujemy z parametrem `γ0`,
- term `Zeeman(B=...)` na publicznym API możemy nadal wspierać, ale do backendu sprowadzać do `H_ext = B / μ0`.

## 5.2. Energia całkowita

Typowa energia mikromagnetyczna:

```math
E[m] = E_{ex}[m] + E_{an}[m] + E_Z[m] + E_d[m] + E_{DMI}[m] + \cdots
```

### 5.2.1. Wymiana

Dla materiału izotropowego:

```math
E_{ex}[m] = \int_{\Omega} A |\nabla m|^2 \, dV
= \int_{\Omega} A \sum_{i=1}^{3} |\nabla m_i|^2 \, dV.
```

### 5.2.2. Anizotropia uniaxjalna

Jedna z wygodnych konwencji:

```math
E_{an}[m] = \int_{\Omega} K_u \left(1 - (m \cdot u)^2\right) dV.
```

Równoważnie można użyć postaci `-K_u (m·u)^2`; różni się stałą energetyczną i znakiem pola zależnie od konwencji. W implementacji trzeba wybrać jedną konwencję i trzymać się jej wszędzie.

### 5.2.3. Zeeman

```math
E_Z[m] = -\mu_0 \int_{\Omega} M_s\, H_{ext}\cdot m \, dV.
```

Jeśli publiczna warstwa podaje `B`, to dla klasycznych materiałów nieliniowości `H_ext = B/μ0`.

### 5.2.4. Magnetostatyka / demag

```math
E_d[m] = -\frac{\mu_0}{2}\int_{\Omega} M_s\, H_d \cdot m \, dV
= \frac{\mu_0}{2}\int_{\mathbb{R}^3} |H_d|^2 \, dV.
```

Pole `H_d` spełnia magnetostatyczne równania Maxwella:
```math
\nabla \times H_d = 0,
\qquad
\nabla \cdot (H_d + M) = 0.
```

Wprowadzamy potencjał skalarny:
```math
H_d = -\nabla \phi.
```

Wtedy:
- wewnątrz obszaru magnetycznego:
```math
-\Delta \phi = -\nabla\cdot M,
```
- poza magnetykiem:
```math
-\Delta \phi = 0.
```

### 5.2.5. Interfacial DMI

Typowa postać dla cienkich warstw:

```math
E_{DMI}[m] = \int_{\Omega} D \left(
m_z \nabla\cdot m - (m\cdot\nabla)m_z
\right) dV.
```

Ten składnik jest ważny nie tylko przez pole objętościowe, ale też przez **warunki brzegowe**.

## 5.3. Pole efektywne

Efektywne pole definiujemy przez wariację energii:

```math
H_{eff} = -\frac{1}{\mu_0 M_s} \frac{\delta E}{\delta m}.
```

To daje rozkład:

```math
H_{eff} = H_{ex} + H_{an} + H_{ext} + H_d + H_{DMI} + \cdots
```

### 5.3.1. Pole wymiany

Dla stałego `A` i `M_s`:

```math
H_{ex} = \frac{2A}{\mu_0 M_s}\Delta m.
```

### 5.3.2. Pole anizotropii uniaxjalnej

Dla energii `K_u(1-(m·u)^2)`:

```math
H_{an} = \frac{2K_u}{\mu_0 M_s}(m\cdot u)\,u.
```

### 5.3.3. Pole Zeemana

```math
H_Z = H_{ext}.
```

To pole nie zależy liniowo od zaburzenia `δm`, więc w linearyzacji nie wnosi Jacobianu `δH_Z/δm`, ale wpływa na stan równowagi i na składową równoległą `H_\parallel`.

### 5.3.4. Pole demagnetyzujące

```math
H_d = -\nabla \phi,
```

gdzie `\phi` rozwiązuje problem magnetostatyczny.

### 5.3.5. Pole DMI

Zależy od wybranej postaci energii i konwencji. Implementacyjnie lepiej myśleć o DMI jako o:
- operatorze objętościowym zależnym od pochodnych,
- plus składniku do naturalnych warunków brzegowych.

---

# 6. Równanie LLG i jego postacie robocze

## 6.1. Postać podstawowa

Landau–Lifshitz–Gilbert:

```math
\partial_t m = -\gamma_0\, m\times H_{eff} + \alpha\, m\times \partial_t m.
```

Po rozwiązaniu względem `\partial_t m`:

```math
\partial_t m =
-\frac{\gamma_0}{1+\alpha^2}
\left(
m\times H_{eff}
+
\alpha\, m\times(m\times H_{eff})
\right).
```

To jest postać najwygodniejsza implementacyjnie.

## 6.2. Własność ograniczenia normy

Jeżeli `|m|=1` na początku i integrator jest idealny, to:
```math
\frac{d}{dt}|m|^2 = 0.
```

W praktyce numerycznej trzeba:
- albo używać metod zachowujących constraint,
- albo robić renormalizację po kroku,
- albo pracować w przestrzeni stycznej.

Obecny fullmag FEM robi nodalną renormalizację po kroku. To jest rozsądne jako stan przejściowy i da się wykorzystać do budowy problemu własnego opartego o płaszczyznę styczną.

## 6.3. Torque balance

Stan równowagi spełnia:
```math
m_0 \times H_{eff}[m_0] = 0.
```

To oznacza, że dla punktów regularnych:
```math
H_{eff}[m_0](x) = H_\parallel(x)\, m_0(x)
```
dla pewnej skalarnej funkcji `H_\parallel(x)`.

To będzie kluczowe w linearyzacji.

---

# 7. Stan równowagi i problem stacjonarny

## 7.1. Definicja

Zanim policzymy mody własne, musimy mieć stan bazowy `m_0`.
W praktyce są trzy warianty:
1. `m_0` pochodzi z relaksacji wykonanej w fullmagu,
2. `m_0` jest wczytane z pola nodalnego/siatkowego,
3. `m_0` jest zadane analitycznie.

## 7.2. Wymogi na `m_0`

Dobre `m_0` do eigenproblemu powinno:
- spełniać `|m_0| ≈ 1`,
- mieć mały residual torque,
- być zgodne z warunkami brzegowymi,
- w przypadku periodycznym być **cell-periodic**:
```math
m_0(x + R) = m_0(x)
```
dla wektorów sieci `R`.

## 7.3. Rola obecnej ścieżki `Relaxation`

Obecny fullmag już ma `Relaxation` jako publiczne studium. To jest naturalne źródło `m_0` dla przyszłego `Eigenmodes`.

Najlepsza ścieżka wdrożeniowa to nie duplikować solvera równowagi, tylko:
- umożliwić `Eigenmodes(equilibrium=...)`,
- gdzie `equilibrium` może wskazywać:
  - pole z poprzedniego runu,
  - artefakt,
  - w przyszłości także embedded sub-study.

---

# 8. Linearyzacja wokół równowagi i zagadnienie własne

To jest rdzeń całego projektu.

## 8.1. Perturbacja

Niech:
```math
m(x,t) = m_0(x) + \delta m(x,t),
```
gdzie:
```math
m_0 \cdot \delta m = 0
```
w pierwszym rzędzie, bo `|m|=1`.

Zatem `\delta m` leży w płaszczyźnie stycznej do sfery jednostkowej w punkcie `m_0`.

## 8.2. Linearyzacja pola efektywnego

Pisujemy:
```math
H_{eff}[m_0 + \delta m]
=
H_{eff}[m_0] + \mathcal{L}[\delta m] + O(\|\delta m\|^2),
```
gdzie `\mathcal{L}` jest Jacobianem pola efektywnego w punkcie `m_0`.

Ponieważ:
```math
H_{eff}[m_0] = H_\parallel m_0,
```
po linearyzacji członów precesyjnych dostajemy standardowy operator na płaszczyźnie stycznej.

## 8.3. Dokładniejsza linearyzacja LLG

Z postaci solved-form:
```math
\partial_t m =
-\frac{\gamma_0}{1+\alpha^2}
\left(
m\times H_{eff}
+
\alpha\, m\times(m\times H_{eff})
\right).
```

Po podstawieniu `m = m_0 + \delta m` i odrzuceniu wyrazów wyższych rzędów otrzymujemy:

```math
\partial_t \delta m
=
-\frac{\gamma_0}{1+\alpha^2}
\left[
m_0 \times \mathcal{L}[\delta m]
+
\delta m \times H_{eff}[m_0]
+
\alpha\, m_0 \times (m_0 \times \mathcal{L}[\delta m])
+
\alpha\, m_0 \times (\delta m \times H_{eff}[m_0])
\right].
```

Ponieważ `H_{eff}[m_0] = H_\parallel m_0`, mamy:
```math
\delta m \times H_{eff}[m_0]
=
H_\parallel (\delta m \times m_0)
=
- H_\parallel (m_0 \times \delta m),
```

oraz:
```math
m_0 \times (\delta m \times H_{eff}[m_0])
=
H_\parallel\, m_0 \times (\delta m \times m_0)
=
H_\parallel\, \delta m,
```
bo `m_0 \cdot \delta m = 0`.

Stąd:

```math
\partial_t \delta m
=
-\frac{\gamma_0}{1+\alpha^2}
\left[
m_0 \times \left(\mathcal{L}[\delta m] - H_\parallel \delta m\right)
+
\alpha\, m_0 \times \left(
m_0 \times \left(\mathcal{L}[\delta m] - H_\parallel \delta m\right)
\right)
\right].
```

## 8.4. Operator styczny

Wprowadzamy projektor na płaszczyznę styczną:
```math
P = I - m_0 \otimes m_0.
```

Definiujemy operator:
```math
\mathcal{A} = P(\mathcal{L} - H_\parallel I)P.
```

Wtedy linearyzacja ma postać:

```math
\partial_t \delta m
=
-\frac{\gamma_0}{1+\alpha^2}
\left[
J\mathcal{A}\,\delta m
-
\alpha \mathcal{A}\,\delta m
\right],
```

gdzie:
```math
Jv = m_0 \times v
```
jest obrotem o `90°` w płaszczyźnie stycznej i spełnia:
```math
J^2 = -I
```
na przestrzeni stycznej.

## 8.5. Przypadek bez tłumienia

Dla `α = 0`:

```math
\partial_t \delta m = -\gamma_0 J\mathcal{A}\,\delta m.
```

Szukamy rozwiązań harmonicznych:
```math
\delta m(x,t) = \psi(x)e^{-i\omega t}.
```

Dostajemy:
```math
-i\omega \psi = -\gamma_0 J\mathcal{A}\psi.
```

Równoważnie:
```math
i\omega \psi = \gamma_0 J\mathcal{A}\psi.
```

To jest zasadnicza postać liniowego zagadnienia własnego.

## 8.6. Postać uogólniona

W praktyce dyskretnej bardzo często otrzymuje się uogólnione zagadnienie własne jednej z dwóch form:

### forma A
```math
\mathcal{D}\psi = -i\omega \mathcal{M}\psi,
```

### forma B
```math
\mathcal{K}\psi = \omega \mathcal{G}\psi,
```

gdzie:
- `\mathcal{M}` — macierz masy,
- `\mathcal{G}` — macierz gyrotropowa / symplektyczna,
- `\mathcal{K}` — styczna hesjanowa energii albo równoważny operator dynamiczny.

Obie postacie są poprawne, o ile implementacja jest wewnętrznie spójna co do:
- znaku `\omega`,
- definicji `γ0`,
- sposobu normalizacji,
- relacji między `\mathcal{K}` i `\mathcal{A}`.

## 8.7. Co dokładnie wnosi każdy składnik pola do linearyzacji

### Wymiana
```math
\delta H_{ex} = \frac{2A}{\mu_0 M_s}\Delta (\delta m).
```

### Zeeman
```math
\delta H_Z = 0.
```
Zeeman nie wnosi Jacobianu, ale wpływa na `H_\parallel`.

### Anizotropia uniaxjalna
```math
\delta H_{an}
=
\frac{2K_u}{\mu_0 M_s}
(\delta m \cdot u)\,u.
```

### Demag
```math
\delta H_d = -\nabla (\delta \phi),
```
gdzie `\delta \phi` spełnia zlinearyzowany problem magnetostatyczny z źródłem `\delta M = M_s \delta m`.

### DMI
Wnosi:
- operator pierwszego rzędu pochodnych,
- oraz zmienione naturalne BC.

## 8.8. Uwaga praktyczna

Dla pierwszej wersji implementacji zdecydowanie najbezpieczniej zacząć od:
- `α = 0`,
- `Exchange + Zeeman`,
- bez demagu,
- bez DMI,
- bez anizotropii.

Powód:
- powstaje najczystsze, najmniej nieprzyjemne algebraicznie zagadnienie,
- można szybko zweryfikować znaki, częstotliwości i kształty modów,
- łatwiej porównać z ringdownem.

---

# 9. Warunki brzegowe

Ta sekcja jest krytyczna, bo w eigenproblemie złe BC zabiją wynik nawet przy poprawnej algebrze.

## 9.1. Naturalne warunki wymiany

Dla energii wymiany:
```math
E_{ex}[m] = \int_\Omega A |\nabla m|^2 dV
```
wariacja daje po całkowaniu przez części:
- operator objętościowy `Δm`,
- oraz naturalny składnik brzegowy.

Dla swobodnej powierzchni (brak dodatkowego termu powierzchniowego) naturalny BC brzmi:

```math
\partial_n m = 0
\quad \text{na } \partial\Omega.
```

To jest klasyczny „free boundary condition” dla exchange.

## 9.2. Pinned / Dirichlet

Jeżeli chcemy wymusić zadaną magnetyzację na fragmencie brzegu `Γ_D`:
```math
m = m_{pin}
\quad \text{na } \Gamma_D.
```

W linearyzacji:
```math
\delta m = 0
\quad \text{na } \Gamma_D.
```

To usuwa DOFy na tym brzegu z problemu własnego.

## 9.3. Robin / mixed

Można też mieć warunki typu:
```math
2A\,\partial_n m + \Xi(m) = 0,
```
gdzie `\Xi` reprezentuje np. penalizację powierzchniową, powierzchniową anizotropię albo zlinearyzowany pinning.

W linearyzacji:
```math
2A\,\partial_n \delta m + \Xi'_{m_0}[\delta m] = 0.
```

## 9.4. Magnetostatyka — granica materiał/powietrze

Dla potencjału magnetostatycznego `\phi`:
- `\phi` jest ciągły,
- normalna pochodna ma skok związany z `M\cdot n`.

Przy konwencji skoku:
```math
[q] = q_{out} - q_{in},
```
mamy:
```math
[\phi] = 0,
\qquad
[\partial_n \phi] = -M\cdot n.
```

W linearyzacji:
```math
[\delta \phi] = 0,
\qquad
[\partial_n \delta \phi] = -M_s\,\delta m\cdot n.
```

## 9.5. DMI — naturalne BC

Dla interfacial DMI naturalny BC ma postać typu:

```math
2A\,\partial_n m + D\,((\hat z \times n)\times m) = 0,
```

przy odpowiedniej konwencji znaku i orientacji. W linearyzacji:

```math
2A\,\partial_n \delta m + D\,((\hat z \times n)\times \delta m) = 0.
```

To jest bardzo ważne dla chiralnych modów przy krawędziach.

## 9.6. Warunki periodyczne klasyczne

Dla zwykłej periodyczności:
```math
m(x+R)=m(x).
```

W FEM implementacyjnie oznacza to:
- identyfikację DOF slave z DOF master.

## 9.7. Warunki Blocha

Dla dyspersji fal spinowych:
```math
\delta m_k(x+R)=e^{i k\cdot R}\,\delta m_k(x).
```

To nie jest zwykła periodyczność rzeczywista — pojawia się zespolona faza.
W FEM oznacza to:
- powiązanie DOF slave z DOF master przez współczynnik zespolony.

## 9.8. Kluczowy wniosek dla fullmaga

Obecne `MeshIR` ma:
- `boundary_faces`,
- `boundary_markers`,
ale nie ma jeszcze natywnej semantyki:
- par periodic master/slave,
- wektorów translacji,
- tolerancji mapowania,
- topologii sieci periodycznej.

To trzeba dodać albo do shared IR, albo — lepiej — do planu backendowego.

---

# 10. Periodyczność Blocha i dyspersja fal spinowych

## 10.1. Założenie geometryczne

Niech komórka elementarna `Ω_cell` generuje strukturę periodyczną przez translacje:
```math
R = n_1 a_1 + n_2 a_2 + n_3 a_3.
```

Stan bazowy:
```math
m_0(x+R)=m_0(x).
```

Perturbacja falowa:
```math
\delta m_k(x+R)=e^{ik\cdot R}\delta m_k(x).
```

## 10.2. Sens fizyczny

Szukamy modów typu Blocha:
```math
\delta m_k(x,t)=u_k(x)e^{i(k\cdot x-\omega t)},
```
gdzie `u_k(x)` jest periodyczne z okresem komórki.

W praktyce obliczeniowej można:
- pracować bezpośrednio na funkcji quasi-periodycznej,
- albo reprezentować tylko część periodyczną `u_k`.

## 10.3. Realizacja algebraiczna w FEM

Najprostsza implementacja:
- zachowujemy zwykły FE basis na jednej komórce,
- budujemy mapę `slave -> master`,
- dla każdej pary na brzegu narzucamy:
```math
u_{slave} = e^{ik\cdot R} u_{master}.
```

To daje redukcję DOF i operator zależny od `k`.

## 10.4. Macierze zależne od `k`

Po redukcji otrzymujemy:
```math
K(k),\quad M(k),\quad G(k)
```
lub równoważną postać dynamiczną:
```math
D(k).
```

Potem dla każdej wartości `k` rozwiązujemy osobne zagadnienie własne.

## 10.5. Ścieżka `k`

Użytkownik zwykle nie podaje całej strefy Brillouina, tylko ścieżkę:
```text
Γ -> X -> M -> Γ
```

W API warto wspierać oba warianty:
- jawna lista `k_points`,
- `k_path` z segmentami i liczbą próbek.

## 10.6. Co z demagiem przy Blochu

To jest najtrudniejsza część.

Dla dynamicznego pola demagnetyzującego w problemie periodycznym perturbacja `δ\phi_k` też powinna spełniać warunek Blocha:
```math
\delta \phi_k(x+R)=e^{ik\cdot R}\delta \phi_k(x).
```

W praktyce oznacza to konieczność zbudowania:
- albo periodycznego / quasi-periodycznego operatora magnetostatycznego,
- albo bardzo świadomego przybliżenia.

To jest główny powód, dla którego **v1 nie powinno zaczynać od demagu**.

---

# 11. Dyskretyzacja FEM

## 11.1. Obecny stan odniesienia w fullmagu

Aktualny engine FEM pełni już kilka funkcji, które da się bezpośrednio wykorzystać:
- przechowuje siatkę tetra,
- wyznacza gradienty funkcji kształtu,
- wyznacza local stiffness dla wymiany,
- ma nodalne objętości/lumped masses,
- ma topologię brzegu,
- ma wąskie, wykonywalne LLG,
- ma bootstrapowe ścieżki demagu.

To jest bardzo mocny punkt startowy.

## 11.2. Przestrzeń funkcji

Dla v1 rekomenduję:
- ciągłe funkcje `H^1` niskiego rzędu na tetra,
- wektorową magnetyzację nodalną.

Czyli:
```math
m_h(x) = \sum_{a=1}^{N_n} \sum_{\beta=1}^{3}
m_{a\beta}\,\varphi_a(x)\,e_\beta.
```

To jest spójne z obecną implementacją FEM i z wcześniejszą notką fizyczną fullmaga.

## 11.3. Dwa warianty reprezentacji perturbacji

Są dwie sensowne drogi.

### Wariant A — pełne 3 składowe + projekcja styczna

Trzymamy `δm` jako 3 składowe na węzłach, ale:
- projekcyjnie wymuszamy styczność,
- filtrujemy składową równoległą do `m_0`.

Zalety:
- prostsze do reuse z obecnym kodem,
- łatwiejsze pierwsze eksperymenty.

Wady:
- więcej DOF,
- gorsza kondycja,
- łatwiej o sztuczne mody w kierunku normalnym do sfery.

### Wariant B — lokalna baza styczna 2 DOF / węzeł

Budujemy dla każdego węzła bazę:
```math
Q_a = [q_{a1}, q_{a2}],
\qquad
q_{a1}\cdot m_{0,a}=0,\quad q_{a2}\cdot m_{0,a}=0,\quad q_{a1}\cdot q_{a2}=0.
```

Wtedy:
```math
\delta m_h(x) \approx \sum_a \varphi_a(x)\, Q_a\, \eta_a,
\qquad \eta_a\in \mathbb{R}^2.
```

Zalety:
- naturalne uwzględnienie constraintu,
- mniejszy problem,
- lepsza struktura operatora.

Wady:
- trzeba bardzo pilnować gładkości / spójności orientacji baz lokalnych,
- trzeba dobrze zdefiniować transport baz przez pary periodic slave/master.

## 11.4. Rekomendacja

Dla fullmaga rekomenduję:
- **v1 CPU reference**: najpierw pełne 3 składowe + jawna projekcja styczna,
- **v1.5 / v2**: przejście na 2 DOF / węzeł w bazie stycznej jako wariant produkcyjny.

Powód:
- szybciej zweryfikujesz poprawność fizyczną,
- łatwiej wykorzystasz istniejące struktury w `fem.rs`,
- później zoptymalizujesz.

## 11.5. Słaba postać dla wymiany

Dla perturbacji `u`, testu `v`:

```math
a_{ex}(u,v)
=
\int_\Omega \frac{2A}{\mu_0 M_s}\,\nabla u : \nabla v \, dV
```

jeżeli składamy bezpośrednio operator pola.
Alternatywnie można składać hesjan energii:
```math
k_{ex}(u,v)
=
2\int_\Omega A\,\nabla u : \nabla v \, dV,
```
a potem dodać odpowiednie przeskalowanie w operatorze dynamicznym.
Najważniejsze jest, aby cała implementacja trzymała **jedną** konwencję.

## 11.6. Słaba postać dla Zeemana

Zeeman nie wnosi Jacobianu do `\mathcal{L}`:
```math
\delta H_Z = 0.
```

Wnosi natomiast do `H_\parallel`.
Czyli w praktyce:
- nie dokładamy osobnej macierzy „Zeeman stiffness”,
- ale w operatorze stycznym pojawia się lokalny term `-H_\parallel I`.

## 11.7. Słaba postać dla anizotropii

Dla uniaxjalnej:
```math
k_{an}(u,v)
=
\int_\Omega \frac{2K_u}{\mu_0 M_s}
(u\cdot \hat u)(v\cdot \hat u)\, dV.
```

## 11.8. Słaba postać dla demagu

Najwygodniej myśleć o demagu jako operatorze:
```math
u \mapsto h_d[u].
```

Wtedy bilinear form w problemie własnym bierze postać:
```math
k_d(u,v) = \int_\Omega v \cdot h_d[u]\, dV
```
po odpowiednim przeskalowaniu i projekcji.
Ponieważ demag jest nielokalny, w kodzie ważniejszy od jednej „ładnej formuły” jest poprawny kontrakt operatorowy.

## 11.9. Macierz masy

Trzeba mieć:
- consistent mass,
albo
- lumped mass.

Ponieważ obecny FEM fullmaga już używa nodalnych objętości/lumped masses, najbezpieczniejsza ścieżka v1 to:
- zacząć od lumped mass zgodnej z obecną dynamiką,
- później dodać consistent mass jako opcję.

## 11.10. Gyrotropia

Na przestrzeni stycznej operator:
```math
Jv = m_0\times v
```
jest antysymetryczny i daje strukturę symplektyczną.
Dyskretna macierz gyrotropowa musi być budowana tak, aby nie zgubić tej struktury.

Jeżeli korzystasz z lokalnej bazy stycznej, to na poziomie 2×2 lokalnie:
```math
J_2 =
\begin{bmatrix}
0 & -1 \\
1 & 0
\end{bmatrix}.
```

## 11.11. Redukcja DOF przez Blocha

Na poziomie macierzy:
- budujesz macierz redukcji `R(k)`,
- taką, że pełny wektor DOF spełniający BC ma postać:
```math
u = R(k)\,\hat u.
```

Wtedy:
```math
K_r(k) = R(k)^* K R(k),
\quad
M_r(k) = R(k)^* M R(k),
\quad
G_r(k) = R(k)^* G R(k).
```

To jest najczystsza algebraicznie ścieżka.

## 11.12. Ważna uwaga praktyczna

Jeżeli implementujesz zespolone fazy Blocha, to od tego momentu cały pipeline na poziomie eigenproblemu musi umieć:
- macierze zespolone,
- wektory zespolone,
- eksport modów zespolonych,
- sensowną politykę fazy globalnej.

To jest kolejny argument za osobnym `FemEigenPlanIR` i osobnym runnerem.

---

# 12. Dyskretyzacja FDM

## 12.1. Co fullmag ma dziś po stronie FDM

Z aktualnego engine FDM widać:
- regularną siatkę `GridShape`,
- rozmiary komórki `CellSize`,
- `ExchangeLlgProblem`,
- pola `exchange`, `demag`, `external_field`,
- aktywną maskę,
- workspace FFT dla demagu.

To jest bardzo dobra baza do:
- ringdown,
- klasycznych symulacji czasowych,
- potencjalnie także do prostszego eigenproblemu na siatce regularnej.

## 12.2. Co jest łatwe w FDM

Relatywnie łatwe:
- eigenproblem `Γ-point`,
- lokalne składniki (`exchange`, `Zeeman`, anizotropia),
- linearyzacja wokół jednorodnego lub prawie jednorodnego stanu bazowego,
- modalyzacja na małej regularnej siatce.

## 12.3. Co jest trudne w FDM

Trudne:
- pełna periodyczność Blocha z demagiem,
- poprawny, produkcyjny dynamiczny operator magnetostatyczny dla quasi-periodycznych modów,
- zespolone jądra / specjalne Green functions / FFT dla Blocha.

## 12.4. Wniosek praktyczny dla fullmaga

Jeżeli głównym celem jest „COMSOL-like FEM eigenmodes” dla złożonych geometrii i PBC, to:
- **pierwszy target powinien być FEM, nie FDM**.

FDM ma sens jako:
- ścieżka referencyjna dla prostych geometrii,
- walidacja `Γ-point`,
- ringdown benchmark,
- ewentualnie przyszły osobny `FdmEigenPlanIR`,
ale nie jako pierwszy priorytet tego projektu.

## 12.5. Co mimo wszystko można zrobić dla FDM

Minimalny sensowny plan FDM:
- `Eigenmodes` dla regularnej siatki bez Blocha albo z najprostszą periodycznością,
- `Exchange + Zeeman`,
- bez demagu w v1,
- ewentualnie później dedykowane jądro demag dla periodycznego superkomórkowego przybliżenia.

## 12.6. Czego nie obiecywać w pierwszym etapie

Nie obiecywałbym od razu:
- pełnego `ω(k)` z demagiem dla FDM i quasi-periodic FFT,
- bo to łatwo zamienia się w osobny projekt badawczy.

---

# 13. Najważniejszy wybór projektowy dla fullmaga

## 13.1. Shared IR ma pozostać backend-neutral

To znaczy:
- shared warstwa mówi, że użytkownik chce policzyć mody własne,
- może mówić o `k_path`,
- może mówić o periodyczności,
- ale nie powinna przechowywać np. surowych par węzłów slave/master.

## 13.2. Backend plan ma materializować szczegóły siatki

To oznacza:
- pairing periodic faces,
- pairing nodes,
- tolerancje geometrii,
- redukcje DOF,
- zmaterializowane mapy `R(k)`,
- wybór solvera,
- politykę zespolonej arytmetyki.

## 13.3. Rekomendacja końcowa

### Shared:
```text
StudyIR::Eigenmodes
```

### FEM backend plan:
```text
BackendPlanIR::FemEigen(FemEigenPlanIR)
```

### Opcjonalnie później:
```text
BackendPlanIR::FdmEigen(FdmEigenPlanIR)
```

---

# 14. Docelowy model publicznego API

Poniżej proponuję semantyczny kształt, nie finalny syntax.

## 14.1. Minimalne API użytkownika

```python
study = fm.Eigenmodes(
    equilibrium=eq,
    k_path=fm.KPath.gamma_x_m_gamma(points_per_segment=31),
    n_modes=12,
    periodicity=fm.BlochPeriodicity(
        lattice_vectors=[a1, a2],
        face_pairs=[
            fm.FacePair("xmin", "xmax", translation=a1),
            fm.FacePair("ymin", "ymax", translation=a2),
        ],
    ),
    outputs=[
        fm.SaveBands("bands.csv"),
        fm.SaveEigenmodes(format="vtu", count=4),
    ],
)
```

## 14.2. Wymagane pola semantyczne

Nowe publiczne studium powinno umieć wyrazić:
- źródło stanu równowagi,
- listę `k_points` lub `k_path`,
- liczbę modów `n_modes`,
- politykę normalizacji,
- rodzaj periodyczności,
- opcjonalny `target_frequency` / `shift`,
- artefakty wyjściowe.

## 14.3. Czego nie dawać do publicznego API na starcie

Nie wystawiałbym od razu:
- solver-specific PETSc/SLEPc knobs,
- szczegółów preconditionera,
- listy surowych node pairs,
- trybów debug macierzy.

To powinno żyć w planie backendowym albo w advanced runtime knobs.

---

# 15. Zmiany w Python DSL

## 15.1. Główne pliki

Najbardziej oczywiste miejsca zmian:
- `packages/fullmag-py/src/fullmag/model/study.py`
- eksporty w `__init__.py`
- miejsca, gdzie `Problem` serializuje `study` do IR.

## 15.2. Nowa klasa `Eigenmodes`

Proponowany szkic:

```python
@dataclass(frozen=True)
class Eigenmodes:
    equilibrium: EquilibriumSource
    k_points: Sequence[VectorLike] | None = None
    k_path: KPath | None = None
    n_modes: int = 8
    periodicity: BlochPeriodicity | None = None
    damping_policy: str = "ignore"
    target_frequency: float | None = None
    shift: float | None = None
    sampling: SamplingPolicy | None = None

    def to_ir(self) -> dict[str, Any]:
        ...
```

## 15.3. Nowe typy pomocnicze

Do dodania:
- `KPoint`
- `KPath`
- `BlochPeriodicity`
- `FacePair`
- `EquilibriumSource`
- nowe output descriptors:
  - `SaveBands`
  - `SaveEigenmodes`
  - `SaveEigenMetadata`

## 15.4. Walidacja po stronie Pythona

Python powinien wcześnie sprawdzać:
- że `n_modes > 0`,
- że zadano dokładnie jedno z: `k_points`, `k_path`,
- że `equilibrium` istnieje lub da się zserializować,
- że periodicity nie jest użyte bez odpowiedniej geometrii/meshu.

## 15.5. Powiązanie z istniejącą relaksacją

Najlepiej dodać wygodny mechanizm:
```python
eq = fm.UseLastRelaxedState()
```
albo:
```python
eq = fm.LoadField("relax/final_m.vtu")
```

---

# 16. Zmiany w `ProblemIR` / `StudyIR` / planach backendowych

## 16.1. `StudyIR`

Trzeba dodać:

```rust
pub enum StudyIR {
    TimeEvolution { ... },
    Relaxation { ... },
    Eigenmodes {
        equilibrium: EquilibriumSourceIR,
        k_sampling: KSamplingIR,
        n_modes: usize,
        periodicity: Option<PeriodicityIR>,
        damping_policy: EigenDampingPolicyIR,
        target_frequency_hz: Option<f64>,
        shift_hz: Option<f64>,
        outputs: Vec<EigenOutputIR>,
    },
}
```

## 16.2. Czy `PeriodicityIR` ma być shared?

Tak, ale tylko semantycznie.
Na poziomie shared IR można trzymać np.:
- wektory sieci,
- deklaratywne pary grup/facet markers,
- typ periodyczności: classical / Bloch.

Nie należy tu trzymać:
- listy wszystkich sparowanych node ids.

## 16.3. `MeshIR` — czy zmieniać?

Obecny `MeshIR` ma:
- nodes,
- elements,
- element markers,
- boundary_faces,
- boundary_markers.

Do problemu własnego z Blochiem są trzy opcje:

### Opcja A — nie ruszać `MeshIR`
Planner bierze:
- `boundary_faces`,
- `boundary_markers`,
- współrzędne węzłów,
i sam tworzy pairing.

**Zaleta:** mniejszy shared impact.  
**Wada:** pairing może być kruchy.

### Opcja B — rozszerzyć `MeshIR` o metadata periodyczne
Np.:
```rust
pub periodic_face_groups: Option<Vec<PeriodicFaceGroupIR>>
```

**Zaleta:** mniej zgadywania.  
**Wada:** mesh asset staje się bogatszy semantycznie.

### Opcja C — dodać osobny asset
Np. `periodicity.json`.

**Zaleta:** czysty rozdział.  
**Wada:** więcej elementów do zarządzania.

## 16.4. Rekomendacja

Dla fullmaga rekomenduję:
- **v1:** nie zmieniać ostro `MeshIR`, ale dodać do planera możliwość zbudowania pairingów z markerów + geometrii + tolerancji,
- **v2:** dodać opcjonalne periodyczne metadata do assetu mesh.

## 16.5. `BackendPlanIR`

Trzeba dodać nowy wariant:
```rust
pub enum BackendPlanIR {
    Fdm(FdmPlanIR),
    FdmMultilayer(FdmMultilayerPlanIR),
    Fem(FemPlanIR),
    FemEigen(FemEigenPlanIR),
    // opcjonalnie później:
    FdmEigen(FdmEigenPlanIR),
}
```

## 16.6. Proponowany `FemEigenPlanIR`

Minimalna sensowna zawartość:

```rust
pub struct FemEigenPlanIR {
    pub mesh_name: String,
    pub mesh_source: Option<String>,
    pub mesh: MeshIR,

    pub fe_order: u8,
    pub precision: PrecisionIR,

    pub material: MaterialIR,
    pub equilibrium_field: VectorFieldIR,

    pub enable_exchange: bool,
    pub enable_demag: bool,
    pub enable_anisotropy: bool,
    pub enable_dmi: bool,
    pub external_field_am: Option<[f64; 3]>,

    pub k_points_rad_per_m: Vec<[f64; 3]>,
    pub n_modes: usize,

    pub periodicity: Option<FemResolvedPeriodicityIR>,
    pub tangent_representation: FemEigenRepresentationIR,
    pub normalization: EigenNormalizationIR,

    pub damping_alpha: Option<f64>,
    pub target_frequency_hz: Option<f64>,
    pub spectral_shift_hz: Option<f64>,

    pub solver: FemEigenSolverIR,
    pub outputs: Vec<EigenOutputPlanIR>,
}
```

## 16.7. `FemResolvedPeriodicityIR`

To powinien być już plan backendowy, np.:

```rust
pub struct FemResolvedPeriodicityIR {
    pub translations: Vec<[f64; 3]>,
    pub face_pairs: Vec<FemPeriodicFacePairIR>,
    pub node_pairs: Vec<FemPeriodicNodePairIR>,
    pub tolerance: f64,
}
```

i każdy node pair powinien przechowywać:
- `master_node`,
- `slave_node`,
- indeks wektora translacji.

## 16.8. Reprezentacja zespolona

Plan powinien jawnie określać:
- czy backend pracuje zespolenie natywnie,
- czy używa real block formulation.

Np.:
```rust
pub enum ComplexArithmeticIR {
    NativeComplex,
    RealBlock2x2,
}
```

To będzie ważne dla CPU reference vs native GPU.

---

# 17. Planner — pełny plan zmian

## 17.1. Nowe wejście do planera

W `crates/fullmag-plan/src/lib.rs` trzeba dodać rozgałęzienie:
- jeżeli `study` to `Eigenmodes` i resolved backend to `Fem`,
  wywołaj `plan_fem_eigen(...)`.

Opcjonalnie później:
- `plan_fdm_eigen(...)`.

## 17.2. Walidacja shared-level

Planner musi sprawdzić:
- czy istnieje jednoznaczne źródło `m_0`,
- czy `m_0` ma poprawny rozmiar i normę,
- czy `n_modes > 0`,
- czy `k_points` nie są puste,
- czy periodyczność jest spójna z geometrią i meshem,
- czy precision i backend potrafią wykonać taki plan.

## 17.3. Walidacja scope v1

Dla pierwszego milestone’u planner może świadomie odrzucać:
- wiele magnetów,
- wiele materiałów,
- demag przy `k != 0`,
- DMI,
- damping `α != 0`,
- niektóre integratory/algorytmy niedotyczące eigenproblemu.

To jest całkowicie akceptowalne, o ile błąd jest jawny i dobrze opisany.

## 17.4. Źródło stanu równowagi

Planner musi umieć:
- wczytać z assetu pole nodalne,
- albo podpiąć artefakt po relaksacji,
- albo przyjąć pole jawne.

Na v1 nie próbowałbym robić automatycznego „embedded relax then eigen” w jednym runie. Lepiej:
- najpierw wspierać źródło zewnętrzne,
- potem dodać pipeline wewnętrzny.

## 17.5. Budowa periodic pairing

Planner musi:
1. zebrać boundary faces i ich markery,
2. zidentyfikować, które markery tworzą pary periodic,
3. dla każdego węzła slave znaleźć odpowiadający węzeł master po translacji,
4. sprawdzić tolerancję geometryczną,
5. sprawdzić jednoznaczność i zupełność mapowania.

## 17.6. Rola tolerancji

To nie może być „dokładne porównanie floatów”.
Trzeba mieć:
- np. `pairing_tolerance = c * h_min`,
- z sensowną domyślną wartością,
- i z walidacją, że nie ma wielokrotnych trafień.

## 17.7. Budowa `k_points`

Planner powinien umieć:
- rozwinąć `KPath` do jawnej listy `k_points`,
- policzyć długości segmentów,
- przygotować metadata do osi wykresu band structure.

## 17.8. Konwersja `Zeeman(B)` do `H_ext`

Obecny planner już wykonuje przeliczenie `B / μ0 -> H`.
Tę konwencję trzeba zachować również dla `Eigenmodes`, żeby wynik był zgodny z obecną ścieżką time-domain.

## 17.9. Budowa planu solvera

Planner powinien ustalić:
- native complex vs real block,
- typ solvera,
- czy użyć shift-invert,
- target interval / target frequency,
- maksymalną liczbę iteracji,
- tolerancję residualu.

## 17.10. Wyjścia planu

Planner powinien budować jawny output plan:
- ścieżki artefaktów,
- formaty,
- liczby modów do zapisu,
- politykę zapisu fazy / części rzeczywistej i urojonej.

---

# 18. Runner — pełny plan zmian

## 18.1. Zasada

Nie dotykamy semantyki obecnego `execute_fem(...)`.
Dodajemy **nowy tor**.

## 18.2. Nowe entry points

W `crates/fullmag-runner` rekomenduję dodać:
- `src/fem_eigen.rs`
- `src/fem_eigen_reference.rs`
- opcjonalnie później `src/fem_eigen_native.rs`

oraz nowe funkcje:
- `execute_fem_eigen(...)`
- `execute_fem_eigen_with_callback(...)`

## 18.3. Co robi runner eigen

Runner powinien:
1. zbudować backend eigen z planu,
2. dla każdego `k`:
   - zbudować / zaktualizować operator,
   - wywołać solver,
   - pobrać `ω_n(k)` i `ψ_n(k)`,
3. emitować postęp,
4. zapisywać artefakty.

## 18.4. Callback / live updates

Dla UI warto emitować:
- aktualny indeks `k`,
- etykietę punktu (`Γ`, `X`, ...),
- liczbę zbieżnych modów,
- residuale,
- częstotliwości już policzone.

## 18.5. Provenance

Dla `Eigenmodes` runner powinien zapisywać do provenance:
- typ solvera,
- whether native complex or real-block,
- użyty rodzaj periodyczności,
- czy demag był exchange-only / robin / transfer-grid / true periodic,
- źródło stanu równowagi.

## 18.6. CPU reference

CPU reference powinien być pierwszym działającym backendem eigen, bo:
- szybciej iterować,
- łatwiej debugować znaki, fazy, BC,
- łatwiej pisać testy integracyjne.

---

# 19. Engine FEM — pełny plan zmian

## 19.1. Obecny stan

`crates/fullmag-engine/src/fem.rs` ma już:
- topologię,
- stiffness wymiany,
- nodalne volumes,
- bootstrap demag,
- krok Heuna.

To trzeba teraz przestawić z „kodeksu kroku czasowego” na „kodeks operatorów”.

## 19.2. Główna refaktoryzacja

Trzeba wydzielić reusable building blocks:

### Operator builders
- `build_exchange_operator(...)`
- `build_mass_matrix(...)`
- `build_tangent_projector(...)`
- `build_equilibrium_parallel_field(...)`
- `build_demag_linear_operator(...)` (później)
- `build_periodic_reduction(...)`

### Eigen assembly
- `assemble_dynamic_operator(...)`
- `assemble_generalized_eigenproblem(...)`

## 19.3. Stan równowagi jako pierwszy obywatel

Nowa struktura:
```rust
pub struct FemEquilibriumState {
    pub m0: Vec<[f64; 3]>,
    pub torque_norm: Option<f64>,
    pub energy: Option<f64>,
}
```

## 19.4. Baza styczna

Trzeba dodać funkcje:
- `build_tangent_frames(m0) -> Vec<[[f64; 3]; 2]>`
- `project_to_tangent(...)`
- `lift_from_tangent(...)`

Należy zadbać, żeby wybór bazy był:
- stabilny numerycznie,
- deterministyczny,
- spójny przy periodic slave/master.

## 19.5. Reprezentacja pełna 3D vs tangent 2D

Rekomenduję w engine wspierać oba warianty jako enum:

```rust
pub enum FemEigenRepresentation {
    FullProjected3,
    Tangent2,
}
```

CPU reference może zacząć od `FullProjected3`.
Native production może docelowo preferować `Tangent2`.

## 19.6. Exchange-only operator

Pierwszy krok implementacyjny:
- z istniejących `element_stiffness` i nodalnych volumes zbudować zlinearyzowany operator wymiany.

Ponieważ ten operator już faktycznie żyje w obecnym kodzie time-domain, można go wydzielić bez zmiany fizyki.

## 19.7. `H_\parallel`

Trzeba policzyć dla każdego DOF/węzła:
```math
H_\parallel(x_a) = m_0(x_a)\cdot H_{eff}[m_0](x_a).
```

W v1 `H_eff[m_0]` obejmie:
- exchange,
- external field,
- ewentualnie później demag.

Ten term jest absolutnie niezbędny, bo Zeeman wchodzi przez niego do linearyzacji.

## 19.8. Macierz gyrotropowa

Dla tangential representation:
- lokalnie `J_2`,
- globalnie blokowo.

Dla full 3-component representation:
- trzeba złożyć operator `v -> m_0 × v`,
- a następnie połączyć go z projekcją.

## 19.9. Zespolone DOFy

Silnik musi umieć:
- albo macierze zespolone,
- albo realny odpowiednik 2×2 blokowy.

Dla CPU reference można zacząć od:
- `nalgebra` / `sprs` / własny CSR + real block,
- albo małej, gęstej referencji dla testów jednostkowych.

Dla production lepiej przygotować się na solver zespolony.

## 19.10. Dynamiczny operator demag

Tego nie należy udawać.

Stan obecny fullmaga ma:
- Robin bootstrap,
- transfer-grid do FDM demag.

To są użyteczne drogi do time steppingu, ale dla Bloch eigenproblemu:
- Robin może być tylko pomocniczym benchmarkiem,
- transfer-grid dla `k != 0` nie daje od razu poprawnego quasi-periodic operatora.

Dlatego rekomendacja:
- **v1 bez demagu**,
- **v2 dopiero po osobnym mini-projekcie demag eigen**.

## 19.11. API engine dla eigensolvera

Nowe struktury:

```rust
pub struct FemEigenProblem { ... }
pub struct FemEigenWorkspace { ... }
pub struct FemEigenResult { ... }
```

Nowe metody:
- `build_from_plan(...)`
- `assemble_for_k(...)`
- `solve_k(...)`
- `solve_path(...)`

## 19.12. Pseudokod

```text
load mesh
load equilibrium m0
normalize/check m0
build topology
build exchange operator
build external-field contribution to H_parallel
build tangent frames / projector
for k in k_points:
    build periodic reduction R(k)
    reduce operators
    assemble generalized eigenproblem
    solve for n_modes
    normalize modes
    export result
```

---

# 20. Native FEM backend i C ABI — pełny plan zmian

## 20.1. Zasada nadrzędna

**Nie rozszerzać istniejącego stepper ABI w sposób mieszający semantyki.**

Zamiast tego:
- zachować obecne `fullmag_fem_backend_step(...)`,
- dodać równoległe ABI dla eigen.

## 20.2. Nowe C ABI — sugerowany zestaw

### Deskryptor planu

```c
typedef struct fullmag_fem_eigen_plan_desc {
    fullmag_fem_mesh_desc mesh;
    fullmag_fem_material_desc material;
    uint32_t fe_order;
    uint32_t precision;
    uint32_t representation_kind;
    uint32_t complex_arithmetic_kind;
    uint32_t enable_exchange;
    uint32_t enable_demag;
    uint32_t enable_anisotropy;
    uint32_t enable_dmi;

    const double* equilibrium_m_xyz;
    size_t equilibrium_m_len;

    const double* external_field_am; // optional 3 entries
    uint32_t has_external_field;

    const double* k_points_xyz;
    size_t n_k_points;

    size_t n_modes;
    double target_frequency_hz;
    uint32_t has_target_frequency;
    double shift_hz;
    uint32_t has_shift;

    // periodic pairs
    const uint64_t* periodic_master_nodes;
    const uint64_t* periodic_slave_nodes;
    const uint32_t* periodic_translation_index;
    size_t n_periodic_pairs;
    const double* translation_vectors_xyz;
    size_t n_translation_vectors;

    // solver knobs
    uint32_t solver_kind;
    uint32_t preconditioner_kind;
    uint32_t max_iterations;
    double tolerance;
} fullmag_fem_eigen_plan_desc;
```

### Funkcje

```c
fullmag_fem_eigen_backend_create(...)
fullmag_fem_eigen_backend_destroy(...)
fullmag_fem_eigen_backend_solve_k(...)
fullmag_fem_eigen_backend_copy_eigenvalues_f64(...)
fullmag_fem_eigen_backend_copy_mode_real_f64(...)
fullmag_fem_eigen_backend_copy_mode_imag_f64(...)
fullmag_fem_eigen_backend_last_error(...)
```

## 20.3. Dlaczego osobne `copy_mode_real/imag`

Bo mod przy Blochu jest naturalnie zespolony.  
Eksport jednego „real field” nie wystarczy.

## 20.4. `native/backends/fem/src/api.cpp`

Trzeba dodać:
- osobny kontekst eigen,
- osobną ścieżkę availability,
- osobną logikę budowy operatora,
- osobne metody kopiowania wyników.

## 20.5. `context_step_exchange_heun_mfem` to za mało

Obecna nazwa i semantyka jasno pokazują, że backend natywny jest dziś zorganizowany wokół kroku czasowego.
Dla eigen trzeba osobnego zestawu klas, np.:
- `eigen_context.hpp`
- `eigen_context.cpp`
- `bloch_reduction.hpp`
- `bloch_reduction.cpp`
- `operators_exchange.hpp`
- `operators_exchange.cpp`

## 20.6. MFEM / libCEED / hypre

Ponieważ kontener FEM GPU już jest zbudowany wokół:
- CUDA,
- MFEM,
- libCEED,
- hypre,

to naturalny kierunek produkcyjny jest taki, żeby operator FEM eigen żył właśnie w tym ekosystemie.

## 20.7. Solver eigenspektralny

Tu są dwie drogi:

### Droga A — wprowadzić zewnętrzny stack eigensolverowy
np. PETSc/SLEPc.

**Zaleta:** bardzo naturalne do zespolonych problemów własnych.  
**Wada:** kolejna zależność i większy ciężar wdrożeniowy.

### Droga B — real block formulation + solver własny / prostszy
**Zaleta:** mniej nowych zależności na starcie.  
**Wada:** szybciej robi się ciężko dla produkcyjnych rozmiarów.

### Rekomendacja
- CPU reference: można zacząć od prostszego rozwiązania,
- native production: warto przewidzieć docelowo profesjonalny eigensolver.

Nie twierdzę, że dziś repo to już ma — to jest rekomendacja projektowa, nie opis stanu obecnego.

---

# 21. Opcjonalna ścieżka FDM — co ma sens, a co nie

## 21.1. Kiedy FDM ma sens

FDM eigenmodes mają sens dla:
- prostych geometrii,
- regularnych cienkich filmów,
- szybkiej walidacji,
- porównań do ringdownu,
- benchmarków czasowych.

## 21.2. Minimalny `FdmEigenPlanIR`

Jeżeli kiedyś to dodasz, powinien zawierać:
- `grid`,
- `cell_size`,
- `material`,
- `equilibrium_field`,
- `active_mask`,
- `k_points`,
- `n_modes`,
- `enable_exchange`,
- `enable_demag`,
- `external_field`,
- `solver`.

## 21.3. Główna trudność

Dla FDM przy Blochu z demagiem potrzeba:
- albo quasi-periodic convolution kernel,
- albo specyficznego podejścia FFT do operatora zależnego od `k`,
- albo supercell approximation.

To nie jest dobry pierwszy cel.

## 21.4. Rekomendacja praktyczna

### FDM v1 (opcjonalnie, później)
- `Γ-point`,
- `Exchange + Zeeman`,
- bez demagu.

### FDM v2
- lokalne anizotropie,
- może prosta periodyczność bez Blocha.

### FDM v3
- dopiero rozważać demag dla `k ≠ 0`.

---

# 22. Solver eigenspektralny — rekomendowany kształt

## 22.1. Co solver musi umieć

- macierze rzadkie,
- uogólnione zagadnienie własne,
- najlepiej zespolone,
- wyciąganie najniższych modów,
- shift-invert lub target search,
- residual-based stopping,
- stabilność przy słabo dodatnich / indefinitnych operatorach.

## 22.2. Przypadek `α = 0`

Najlepszy na start.
Można wtedy kontrolować:
- symetrie `ω(k)` i `ω(-k)`,
- degeneracje,
- zbieżność siatkową,
- zgodność z ringdownem.

## 22.3. Przypadek `α > 0`

Później.  
Wtedy `ω` jest zespolone, problem staje się mniej przyjemny i dużo łatwiej o błędne interpretacje.

## 22.4. Co eksportować

Dla każdego `k`:
- `ω_n` [rad/s] i/lub `f_n` [Hz],
- residual,
- udział energii (jeśli da się policzyć),
- wektory modów.

## 22.5. Normalizacja modów

Trzeba z góry wybrać konwencję.
Przykładowe warianty:
- `||\psi||_M = 1`,
- `\psi^* G \psi = ±1`,
- maksymalna amplituda = 1.

Na start polecam:
- `M`-normalization dla techniki,
- plus eksport amplitudy max=1 dla wizualizacji.

## 22.6. Faza globalna

Mod własny ma dowolną globalną fazę.  
Do stabilnego eksportu trzeba ustalić konwencję, np.:
- wybierz DOF o największej amplitudzie,
- obróć globalną fazę tak, aby jego część rzeczywista była dodatnia i maksymalna.

---

# 23. Artefakty wyjściowe i UX

## 23.1. Minimalne artefakty

1. `bands.csv`  
2. `bands.json`  
3. `mode_kXXXX_nYYY.vtu` lub `npz`  
4. `eigen_metadata.json`  

## 23.2. Zawartość `bands.csv`

Kolumny:
- `k_index`
- `k_x`
- `k_y`
- `k_z`
- `path_abscissa`
- `label`
- `mode_index`
- `omega_rad_s`
- `frequency_hz`
- `residual`
- `converged`

## 23.3. Zawartość pliku moda

Dla każdego węzła / DOF:
- `m_real_x`, `m_real_y`, `m_real_z`
- `m_imag_x`, `m_imag_y`, `m_imag_z`
- opcjonalnie:
  - amplitude,
  - phase,
  - tangent components.

## 23.4. UI / control room

W dłuższym horyzoncie UI powinno umieć:
- rysować band structure,
- odtwarzać mod jako animację z części rzeczywistej:
```math
\Re(\psi e^{-i\omega t}),
```
- pokazywać `k`-path i etykiety punktów symetrii.

Na v1 wystarczy poprawny eksport plików.

---

# 24. Walidacja naukowa i testy

## 24.1. Poziomy testów

### Poziom A — testy algebraiczne / jednostkowe
- projektor styczny,
- lokalna baza styczna,
- pairing periodic nodes,
- spójność faz `e^{ik·R}`,
- redukcja DOF.

### Poziom B — testy operatorskie
- dodatniość / semidefiniteness odpowiednich bloków,
- antysymetria gyrotropii,
- brak spurious normal modes,
- zgodność `k=0` z nieperiodycznym przypadkiem.

### Poziom C — testy fizyczne
- makrospin FMR,
- exchange-only strip,
- cienki film w polu bias,
- mesh refinement.

### Poziom D — testy cross-method
- porównanie eigenfrequency vs ringdown FFT,
- porównanie FEM vs FDM dla prostej geometrii,
- ewentualnie później porównanie do COMSOL albo referencji literaturowej.

## 24.2. Pierwszy benchmark — makrospin

Jeżeli obiekt jest praktycznie jednorodny i `m_0` stałe, częstotliwość rezonansowa powinna być zgodna z przewidywaniami analitycznymi dla prostego przypadku.

To świetny test na:
- znak `γ0`,
- znak `ω`,
- poprawność termu `H_\parallel`.

## 24.3. Drugi benchmark — `Γ-point` vs ringdown

To jest kluczowy test integracyjny dla fullmaga, bo już dziś ma time-domain.
Procedura:
1. policz `m_0`,
2. policz `ω_1` z eigenproblemu,
3. zaburz układ w domenie czasu,
4. zrób ringdown,
5. FFT odpowiedzi i sprawdź pik.

Jeżeli te wyniki się rozjeżdżają, to najpierw popraw linearyzację, a dopiero potem rozbudowuj solver.

## 24.4. Test okresowości Blocha

Dla par periodic nodes trzeba sprawdzić:
```math
\psi_{slave} \approx e^{ik\cdot R} \psi_{master}
```
na wyeksportowanych modach.

## 24.5. Test symetrii `k -> -k`

Przy odpowiednich założeniach i bez chiralności / bez DMI oczekujemy określonych symetrii widma.
To jest bardzo dobry test znaków w fazach Blocha.

## 24.6. Test zbieżności siatkowej

Trzeba udokumentować:
- częstotliwości vs `h`,
- mod shapes vs `h`,
- wpływ `fe_order` (gdy będzie więcej niż 1).

## 24.7. Testy dla demagu (później)

Dopiero gdy wejdziesz w demag eigen:
- cienki film,
- geometrie Damon–Eshbach / backward volume,
- porównanie do literatury / ringdown.

---

# 25. Plan wdrożenia krok po kroku

To jest właściwa instrukcja wykonawcza.

## Faza 0 — dokument i decyzje

### Krok 0.1
Utwórz nową notkę:
```text
docs/physics/0530-fem-eigenmodes-bloch-periodicity.md
```

### Krok 0.2
W notce rozpisz:
- równania,
- jednostki,
- linearyzację,
- BC,
- zakres v1,
- zakres odłożony.

### Krok 0.3
Podejmij jawne decyzje:
- `α = 0` w v1,
- `Exchange + Zeeman` w v1,
- bez demagu w v1,
- `FullProjected3` albo `Tangent2` jako pierwsza implementacja,
- native complex vs real block.

### Krok 0.4
Dodaj do notki tabelę „co istnieje dziś / co będzie nowe”.

## Faza 1 — publiczne API

### Krok 1.1
Dodaj `Eigenmodes` do `packages/fullmag-py/src/fullmag/model/study.py`.

### Krok 1.2
Dodaj helpery:
- `KPath`
- `BlochPeriodicity`
- `FacePair`
- `SaveBands`
- `SaveEigenmodes`

### Krok 1.3
Dodaj serializację do canonical IR.

### Krok 1.4
Dodaj testy Pythona:
- poprawna serializacja,
- błędy walidacji,
- brak jednoczesnego `k_points` i `k_path`.

## Faza 2 — shared IR

### Krok 2.1
Dodaj `StudyIR::Eigenmodes`.

### Krok 2.2
Dodaj IR dla:
- equilibrium source,
- k sampling,
- periodicity,
- outputs.

### Krok 2.3
Dodaj serde / schema tests.

## Faza 3 — planner

### Krok 3.1
Dodaj `BackendPlanIR::FemEigen(FemEigenPlanIR)`.

### Krok 3.2
Dodaj `plan_fem_eigen(...)`.

### Krok 3.3
Zaimplementuj walidację źródła `m0`.

### Krok 3.4
Zaimplementuj building `k_points`.

### Krok 3.5
Zaimplementuj periodic face pairing:
- marker -> face set,
- face -> nodes,
- nodes -> translated nodes.

### Krok 3.6
Dodaj testy pairingów:
- idealny mesh,
- przesunięcia w tolerancji,
- brakujące pary,
- duplikaty.

### Krok 3.7
Zapisz rozstrzygnięty plan solvera.

## Faza 4 — CPU reference engine (exchange + Zeeman, `Γ-point`)

### Krok 4.1
Wydziel z `fem.rs` reusable operator wymiany.

### Krok 4.2
Dodaj obliczanie `H_eff[m0]`.

### Krok 4.3
Dodaj `H_\parallel`.

### Krok 4.4
Dodaj projekcję styczną.

### Krok 4.5
Złóż operator dynamiczny bez periodyczności.

### Krok 4.6
Dodaj prosty eigensolver dla małych problemów referencyjnych.

### Krok 4.7
Dodaj eksport pierwszych modów.

### Krok 4.8
Przeprowadź benchmark `Γ-point` vs ringdown.

## Faza 5 — CPU reference Bloch periodicity

### Krok 5.1
Dodaj macierz redukcji `R(k)`.

### Krok 5.2
Obsłuż zespoloną fazę `exp(i k·R)`.

### Krok 5.3
Dodaj pętlę po `k_points`.

### Krok 5.4
Dodaj `bands.csv/json`.

### Krok 5.5
Dodaj testy zgodności warunku Blocha na wyeksportowanych modach.

## Faza 6 — runner i artefakty

### Krok 6.1
Dodaj `execute_fem_eigen(...)`.

### Krok 6.2
Dodaj callback progress events.

### Krok 6.3
Dodaj provenance.

### Krok 6.4
Dodaj smoke example do repo.

## Faza 7 — native FEM backend

### Krok 7.1
Dodaj nowe struktury ABI w `fullmag-fem-sys`.

### Krok 7.2
Dodaj nowy eigen backend w `native/backends/fem`.

### Krok 7.3
Przenieś assembly operatorów do MFEM-side.

### Krok 7.4
Dodaj solver produkcyjny.

### Krok 7.5
Porównaj native vs CPU reference.

## Faza 8 — demag eigen (osobny milestone)

### Krok 8.1
Zdecyduj docelową strategię:
- robin reference only,
- periodic FEM scalar potential,
- hybrid transfer-grid quasi-periodic,
- coś innego.

### Krok 8.2
Napisz osobną notkę fizyczną dla demag eigen/Bloch.

### Krok 8.3
Dopiero potem implementuj.

## Faza 9 — FDM (opcjonalnie, później)

### Krok 9.1
Dodaj `FdmEigenPlanIR`.

### Krok 9.2
Wersja `Γ-point`, exchange+Zeeman.

### Krok 9.3
Walidacja vs FEM i ringdown.

---

# 26. Ryzyka techniczne i decyzje, których nie wolno odkładać

## 26.1. Konwencja znaku i jednostek

Musisz jawnie ustalić:
- czy `ω` eksportujesz w rad/s czy Hz,
- czy `γ0` jest zgodne z polem w A/m,
- czy `H_ext` w backendzie zawsze jest w A/m.

Jeżeli tego nie ustalisz na początku, stracisz czas na fałszywe błędy.

## 26.2. Reprezentacja perturbacji

Nie można odkładać decyzji:
- `FullProjected3` vs `Tangent2`.

Można implementować oba, ale v1 musi mieć jeden domyślny tor.

## 26.3. Demag

Nie wolno udawać, że obecny bootstrap demag automatycznie rozwiązuje Bloch eigenproblem.
To wymaga osobnego projektu.

## 26.4. Pairing periodic nodes

To jest potencjalnie najbardziej krucha część planera.
Źle zrobiony pairing da:
- niestabilne widmo,
- sztuczne rozszczepienia degeneracji,
- błędne mody na brzegu.

## 26.5. Zespolone artefakty

Od chwili wejścia Blocha wszystkie formaty wyjściowe i testy muszą wiedzieć, że mod jest zespolony.

## 26.6. Globalna faza

Bez ustalonej polityki fazy porównywanie modów między uruchomieniami będzie niestabilne.

---

# 27. Proponowany szkielet nowej notki `docs/physics`

Poniżej gotowy spis treści dla notki, która powinna wejść do repo przed implementacją.

## 27.1. Nazwa pliku

```text
docs/physics/0530-fem-eigenmodes-bloch-periodicity.md
```

## 27.2. Spis treści notki

1. Problem statement  
2. Scope of public feature  
3. Symbols and SI units  
4. Continuum micromagnetics model  
5. Effective field decomposition  
6. Equilibrium condition  
7. Linearization about `m0`  
8. Tangent-plane formulation  
9. Boundary conditions  
10. Bloch periodicity  
11. FEM discretization  
12. Choice of trial/test spaces  
13. Mass matrix and gyrotropic structure  
14. Generalized eigenproblem form  
15. Output quantities and normalization  
16. Mapping to Python API  
17. Mapping to `ProblemIR` / `StudyIR`  
18. Planner impact  
19. Backend execution impact  
20. Validation plan  
21. Completeness and deferred work  
22. Demag roadmap  
23. FDM applicability notes

## 27.3. Co ta notka musi powiedzieć wprost

Musi być jawnie zapisane:
- że v1 nie obejmuje pełnego periodycznego demagu,
- że v1 zaczyna od exchange+Zeeman,
- że eigenproblem żyje jako osobny study,
- że shared API ma pozostać backend-neutral.

---

# 28. Checklisty implementacyjne

## 28.1. Checklist — API

- [ ] `Eigenmodes` w Python DSL  
- [ ] `KPath`  
- [ ] `BlochPeriodicity`  
- [ ] `SaveBands`  
- [ ] `SaveEigenmodes`  
- [ ] testy serializacji  

## 28.2. Checklist — IR

- [ ] `StudyIR::Eigenmodes`  
- [ ] `EquilibriumSourceIR`  
- [ ] `KSamplingIR`  
- [ ] `PeriodicityIR`  
- [ ] `EigenOutputIR`  
- [ ] `BackendPlanIR::FemEigen`  

## 28.3. Checklist — planner

- [ ] walidacja `m0`  
- [ ] rozwinięcie `k_path`  
- [ ] periodic pairing  
- [ ] resolved periodicity plan  
- [ ] solver config  
- [ ] output plan  

## 28.4. Checklist — CPU reference FEM

- [ ] operator exchange  
- [ ] `H_eff[m0]`  
- [ ] `H_\parallel`  
- [ ] projector / tangent frame  
- [ ] eigen assembly  
- [ ] single `k`  
- [ ] `k_path`  
- [ ] eksport modów  

## 28.5. Checklist — native FEM

- [ ] nowe C ABI  
- [ ] eigen context  
- [ ] complex mode export  
- [ ] production eigensolver  
- [ ] parity tests vs CPU reference  

## 28.6. Checklist — validation

- [ ] macrospin  
- [ ] `Γ-point` vs ringdown  
- [ ] Bloch pairing test  
- [ ] `k -> -k` symmetry test  
- [ ] mesh refinement  

---

# 29. Źródła i odniesienia

Poniżej lista źródeł, na których oparto część „stan obecny repo” i inspirację funkcjonalną.

## 29.1. Repo fullmag — architektura i stan obecny

- `readme.md` repo: architektura, golden rule, obecny executable slice FDM, kontener FEM GPU  
  https://github.com/MateuszZelent/fullmag/blob/master/readme.md

- `docs/physics/README.md`: wymagania dla notek fizycznych  
  https://github.com/MateuszZelent/fullmag/blob/master/docs/physics/README.md

- katalog `docs/physics/`  
  https://github.com/MateuszZelent/fullmag/tree/master/docs/physics

## 29.2. Konkretne pliki repo wykorzystane do oceny stanu

- Python study API  
  https://github.com/MateuszZelent/fullmag/blob/master/packages/fullmag-py/src/fullmag/model/study.py

- Shared IR  
  https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-ir/src/lib.rs

- Planner  
  https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-plan/src/lib.rs

- Runner dispatch  
  https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-runner/src/dispatch.rs

- CPU reference FEM runner  
  https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-runner/src/fem_reference.rs

- FEM C ABI  
  https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-fem-sys/src/lib.rs

- Native FEM API  
  https://github.com/MateuszZelent/fullmag/blob/master/native/backends/fem/src/api.cpp

- Engine FEM  
  https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-engine/src/fem.rs

- Engine FDM / core engine  
  https://github.com/MateuszZelent/fullmag/blob/master/crates/fullmag-engine/src/lib.rs

## 29.3. Notki fizyczne repo szczególnie istotne dla tego projektu

- `0410-fem-exchange-demag-zeeman-mfem-gpu.md`  
  https://github.com/MateuszZelent/fullmag/blob/master/docs/physics/0410-fem-exchange-demag-zeeman-mfem-gpu.md

- `0510-fem-relaxation-algorithms-mfem-gpu.md`  
  https://github.com/MateuszZelent/fullmag/blob/master/docs/physics/0510-fem-relaxation-algorithms-mfem-gpu.md

- `0520-fem-robin-airbox-demag-bootstrap-reference.md`  
  https://github.com/MateuszZelent/fullmag/blob/master/docs/physics/0520-fem-robin-airbox-demag-bootstrap-reference.md

## 29.4. Źródło inspiracji funkcjonalnej „COMSOL-like”

- COMSOL Blog: *Micromagnetic Simulation with COMSOL Multiphysics®*  
  https://www.comsol.com/blogs/micromagnetic-simulation-with-comsol-multiphysics

---

# Dodatek A — rekomendowane minimalne scope decyzji dla pierwszego PR

Żeby nie ugrzęznąć, pierwszy PR implementacyjny po dokumencie powinien mieć zakres:

1. `StudyIR::Eigenmodes`  
2. `BackendPlanIR::FemEigen`  
3. `FemEigenPlanIR`  
4. CPU reference `Γ-point`  
5. `Exchange + Zeeman`  
6. bez demagu  
7. bez damping  
8. eksport `bands.csv` dla jednego `k=0`  
9. jeden benchmark `Γ-point` vs ringdown  

Jeżeli ten PR działa, masz kręgosłup architektury.  
Dopiero potem dodawaj `k_path` i Blocha.

---

# Dodatek B — rekomendowany minimalny scope dla drugiego PR

1. periodic pairing w plannerze  
2. macierz redukcji `R(k)`  
3. zespalanie faz `e^{ik·R}`  
4. pętla po `k_path`  
5. eksport band structure  
6. test zgodności warunku Blocha  

---

# Dodatek C — rekomendowane nazewnictwo artefaktów

```text
run/
  eigen/
    metadata.json
    bands.csv
    bands.json
    k0000/
      mode0000.vtu
      mode0001.vtu
    k0001/
      mode0000.vtu
      mode0001.vtu
```

---

# Dodatek D — konkretne decyzje, które ja bym podjął od razu

1. **v1 = FEM only**  
2. **v1 = exchange + Zeeman only**  
3. **v1 = α = 0**  
4. **v1 = CPU reference first**  
5. **v1 = full 3-component projected representation first**  
6. **v2 = tangent 2-DOF optimization**  
7. **v2 = native GPU backend**  
8. **v3 = demag eigen**  
9. **FDM = osobna, późniejsza ścieżka referencyjna**

---

# Dodatek E — jeden bardzo praktyczny test akceptacyjny

## Scenariusz

- cienki prostokątny pasek,
- jednorodne pole bias,
- periodicity w osi `x`,
- stan równowagi prawie jednorodny,
- `Exchange + Zeeman`,
- `k_path`: `0 -> k_max`.

## Oczekiwanie

- najniższa gałąź pasma rośnie gładko,
- `k=0` zgadza się z ringdownem,
- tryby nie łamią jawnie warunku Blocha na parach periodic nodes.

Jeżeli ten test przejdzie, można mówić, że v1 działa.

---

# Końcowa rekomendacja

Jeżeli miałbym wskazać jedną ścieżkę, która daje największą szansę na szybki i poprawny rezultat, to byłaby ona taka:

1. nowa notka `docs/physics`  
2. `Eigenmodes` jako nowe study  
3. `FemEigenPlanIR` jako nowy plan backendowy  
4. CPU reference FEM eigen dla `Exchange + Zeeman`, `α=0`, `Γ-point`  
5. test `Γ-point` vs ringdown  
6. Bloch periodicity i `k_path`  
7. native FEM eigen backend  
8. dopiero potem demag  
9. dopiero potem FDM eigen

To jest ścieżka najbardziej zgodna zarówno z fizyką problemu, jak i z obecnym stanem architektury fullmaga.


---

# Dodatek F — szczegółowe wyprowadzenie warunku naturalnego dla wymiany

Ta sekcja jest przydatna, bo właśnie z niej wynika `\partial_n m = 0`.

## F.1. Start od energii wymiany

```math
E_{ex}[m] = \int_\Omega A\, \nabla m : \nabla m \, dV.
```

Rozważamy wariację:
```math
m_\varepsilon = m + \varepsilon v.
```

Wtedy:
```math
\frac{d}{d\varepsilon}E_{ex}[m_\varepsilon]\bigg|_{\varepsilon=0}
=
2\int_\Omega A\, \nabla m : \nabla v \, dV.
```

## F.2. Całkowanie przez części

Dla każdej składowej:

```math
\int_\Omega \nabla m_i \cdot \nabla v_i \, dV
=
-\int_\Omega (\Delta m_i) v_i \, dV
+
\int_{\partial\Omega} (\partial_n m_i)\,v_i\, dS.
```

Sumując po `i`:

```math
\delta E_{ex}[m;v]
=
-2\int_\Omega A\, \Delta m \cdot v \, dV
+
2\int_{\partial\Omega} A\, \partial_n m \cdot v \, dS.
```

## F.3. Wniosek

Jeżeli na brzegu nie dodano żadnego termu powierzchniowego i wariacja `v` jest dowolna, to zniknięcie członu brzegowego wymaga:

```math
\partial_n m = 0
\qquad \text{na } \partial\Omega.
```

To jest dokładnie naturalny BC dla exchange.

## F.4. Co się zmienia przy warunku Dirichleta

Jeżeli na części brzegu wymuszasz `m = m_{pin}`, to na tej części:
```math
v = 0,
```
więc term brzegowy znika automatycznie.
Na pozostałej części nadal dostajesz warunek naturalny.

---

# Dodatek G — szczegółowe wyprowadzenie linearyzacji Zeemana

## G.1. Energia Zeemana

```math
E_Z[m] = -\mu_0\int_\Omega M_s H_{ext}\cdot m\, dV.
```

## G.2. Wariacja pierwsza

```math
\delta E_Z[m;v] = -\mu_0\int_\Omega M_s H_{ext}\cdot v\, dV.
```

Stąd:
```math
H_Z = H_{ext}.
```

## G.3. Wariacja druga

Ponieważ `H_{ext}` nie zależy od `m`, druga wariacja energii Zeemana po `m` jest zerowa:

```math
\delta^2 E_Z[m;u,v] = 0.
```

To oznacza, że w problemie własnym:
- Zeeman **nie tworzy własnej macierzy sztywności** zależnej od `δm`,
- ale wpływa na równowagę `m_0`,
- a przez to wpływa na `H_\parallel`.

To jest częsty punkt nieporozumień przy pierwszym wdrożeniu.

---

# Dodatek H — szczegółowe wyprowadzenie lokalnego operatora anizotropii uniaxjalnej

Zakładamy:
```math
E_{an}[m] = \int_\Omega K_u\left(1-(m\cdot u)^2\right)dV.
```

## H.1. Wariacja pierwsza

```math
\delta E_{an}[m;v]
=
-2\int_\Omega K_u (m\cdot u)(v\cdot u)\, dV.
```

Stąd:
```math
H_{an}
=
\frac{2K_u}{\mu_0 M_s}(m\cdot u)\,u.
```

## H.2. Linearyzacja

Dla perturbacji `δm`:

```math
\delta H_{an}
=
\frac{2K_u}{\mu_0 M_s}(\delta m\cdot u)\,u.
```

To jest bardzo wygodny człon z punktu widzenia FEM/FDM, bo jest lokalny i nie wymaga nowych nie-lokalnych solverów.

---

# Dodatek I — dynamiczny demag w linearyzacji

## I.1. Równania

Dla perturbacji:
```math
\delta M = M_s \delta m.
```

Pole demag spełnia:
```math
\nabla\times \delta H_d = 0,
\qquad
\nabla\cdot(\delta H_d + \delta M)=0.
```

Wprowadzamy:
```math
\delta H_d = -\nabla \delta\phi.
```

Otrzymujemy:
- wewnątrz magnetyka:
```math
-\Delta \delta\phi = -\nabla\cdot(M_s\delta m),
```
- poza magnetykiem:
```math
-\Delta \delta\phi = 0.
```

## I.2. Dlaczego to trudne dla Blocha

Jeżeli `δm` ma fazę Blocha:
```math
\delta m(x+R)=e^{ik\cdot R}\delta m(x),
```
to `\delta\phi` też musi mieć tę samą quasi-periodyczność.  
To oznacza, że zwykły „open boundary solve na jednej komórce” nie wystarcza bez dodatkowej konstrukcji.

## I.3. Konsekwencja wdrożeniowa

Nie należy zaczynać od demagu w eigenproblemie, jeżeli głównym celem jest poprawne wdrożenie całej ścieżki architektonicznej.

---

# Dodatek J — algorytm parowania periodycznego w plannerze

Poniżej praktyczny algorytm, który dobrze pasuje do obecnego `MeshIR`.

## J.1. Wejście

- `nodes_xyz`
- `boundary_faces`
- `boundary_markers`
- deklaratywne pary:
  - `(marker_master, marker_slave, translation_vector)`

## J.2. Krok 1 — zbierz zbiory węzłów dla markerów

Dla każdej strony periodycznej:
- przejdź po `boundary_faces`,
- zbierz unikalne węzły na danym markerze.

## J.3. Krok 2 — zbuduj indeks przestrzenny

Dla węzłów master zbuduj:
- `kd-tree`,
- lub hash po współrzędnych zaokrąglonych do tolerancji.

## J.4. Krok 3 — dla każdego slave znajdź master

Dla węzła slave o współrzędnych `x_s`:
- policz punkt docelowy `x_t = x_s - R`,
- znajdź master najbliższy `x_t`,
- zaakceptuj tylko jeśli odległość < tolerancja.

## J.5. Krok 4 — walidacja jednoznaczności

Sprawdź:
- każdy slave ma dokładnie jednego mastera,
- żaden master nie jest przypisany sprzecznie,
- liczba par jest zgodna z oczekiwaniem.

## J.6. Krok 5 — narożniki i krawędzie

Jeżeli periodyczność obejmuje więcej niż jedną oś, narożniki leżą na kilku parach jednocześnie.
Trzeba:
- zdefiniować kolejność redukcji,
- albo wcześniej zbudować klastry równoważności,
- albo użyć jednej macierzy `R(k)` zbudowanej z relacji globalnej.

## J.7. Krok 6 — export resolved pairing

Zapisz do planu:
- `slave_id`,
- `master_id`,
- `translation_index`.

---

# Dodatek K — macierz redukcji Blocha

## K.1. Definicja

Niech pełny wektor DOF to `u_full`, a zredukowany to `u_red`.
Jeżeli `s` jest slave, `m` master i `R` odpowiednim wektorem translacji:

```math
u_s = e^{ik\cdot R} u_m.
```

Budujemy macierz `R(k)` taką, że:
```math
u_{full} = R(k) u_{red}.
```

## K.2. Redukcja macierzy

Dla dowolnej macierzy układu `A`:

```math
A_{red}(k) = R(k)^* A R(k).
```

To samo dla `M`, `G`, `K`.

## K.3. Zalety

- prosta algebra,
- łatwe testowanie,
- jeden wzorzec dla wszystkich operatorów,
- brak potrzeby osobnego kodu assembly dla każdego `k`, jeśli macierze bazowe są już gotowe.

## K.4. Wada

- trzeba umieć operować zespolenie,
- albo robić real-block lift.

---

# Dodatek L — real block formulation

Jeżeli backend nie wspiera natywnie macierzy zespolonych, można użyć reprezentacji blokowej.

## L.1. Rozkład

Dla:
```math
u = u_r + i u_i,
\qquad
A = A_r + i A_i,
```
równanie:
```math
Au = \lambda Bu
```
zamienia się na rzeczywisty układ blokowy:

```math
\begin{bmatrix}
A_r & -A_i \\
A_i &  A_r
\end{bmatrix}
\begin{bmatrix}
u_r \\
u_i
\end{bmatrix}
=
\lambda
\begin{bmatrix}
B_r & -B_i \\
B_i &  B_r
\end{bmatrix}
\begin{bmatrix}
u_r \\
u_i
\end{bmatrix}.
```

## L.2. Konsekwencja

Rozmiar problemu się podwaja.  
Dla CPU reference bywa to akceptowalne.  
Dla dużych problemów produkcyjnych może być bolesne.

---

# Dodatek M — proponowany zestaw plików do zmiany w repo

Ta sekcja jest najbardziej „operacyjna”.

## M.1. Python DSL

- `packages/fullmag-py/src/fullmag/model/study.py`
- `packages/fullmag-py/src/fullmag/model/__init__.py`
- ewentualnie:
  - `packages/fullmag-py/src/fullmag/model/outputs.py`
  - `packages/fullmag-py/src/fullmag/model/periodicity.py`
  - `packages/fullmag-py/tests/...`

## M.2. Shared IR

- `crates/fullmag-ir/src/lib.rs`

## M.3. Planner

- `crates/fullmag-plan/src/lib.rs`
- ewentualnie wydzielenie:
  - `crates/fullmag-plan/src/fem_eigen.rs`

## M.4. Runner

- `crates/fullmag-runner/src/dispatch.rs`
- `crates/fullmag-runner/src/fem_eigen.rs`
- `crates/fullmag-runner/src/fem_eigen_reference.rs`

## M.5. Engine FEM

- `crates/fullmag-engine/src/fem.rs`
- opcjonalnie:
  - `crates/fullmag-engine/src/fem_eigen.rs`

## M.6. Engine FDM (opcjonalnie później)

- `crates/fullmag-engine/src/lib.rs`
- ewentualnie:
  - `crates/fullmag-engine/src/fdm_eigen.rs`

## M.7. FEM sys ABI

- `crates/fullmag-fem-sys/src/lib.rs`

## M.8. Native FEM backend

- `native/backends/fem/src/api.cpp`
- plus nowe pliki kontekstów/operators jeśli je wydzielisz

## M.9. Docs i examples

- `docs/physics/0530-fem-eigenmodes-bloch-periodicity.md`
- `examples/` z nowym przykładem eigen/Bloch
- README / capability docs

---

# Dodatek N — minimalny przykład użycia, do którego warto dojść

```python
import fullmag as fm

mesh = fm.PrecomputedMeshAsset("stripe_periodic.mesh.json")

material = fm.Material(
    name="Py",
    saturation_magnetisation=8e5,
    exchange_stiffness=13e-12,
    damping=0.01,
)

problem = fm.Problem(
    geometry=fm.MeshGeometry(mesh),
    materials=[material],
    magnets=[
        fm.Ferromagnet(
            material="Py",
            initial_magnetization=(1.0, 0.0, 0.0),
        )
    ],
    energy_terms=[
        fm.Exchange(),
        fm.Zeeman(B=(0.1, 0.0, 0.0)),
    ],
    study=fm.Eigenmodes(
        equilibrium=fm.LoadField("relaxed_m.vtu"),
        k_path=fm.KPath(
            points=[(0, 0, 0), (2.0e7, 0, 0)],
            points_per_segment=31,
            labels=["Γ", "X"],
        ),
        periodicity=fm.BlochPeriodicity(
            lattice_vectors=[(100e-9, 0, 0)],
            face_pairs=[fm.FacePair("xmin", "xmax", translation=(100e-9, 0, 0))],
        ),
        n_modes=8,
        outputs=[
            fm.SaveBands("bands.csv"),
            fm.SaveEigenmodes(directory="modes"),
        ],
    ),
)
```

Ten przykład nie opisuje stanu obecnego repo — to jest **cel docelowy**, do którego plan ma doprowadzić.

---

# Dodatek O — kryteria „done”

Funkcję `FEM Eigenmodes v1` uznałbym za ukończoną dopiero wtedy, gdy spełnione są wszystkie warunki:

- [ ] istnieje notka `docs/physics`  
- [ ] istnieje `fm.Eigenmodes(...)` w Pythonie  
- [ ] istnieje `StudyIR::Eigenmodes`  
- [ ] istnieje `BackendPlanIR::FemEigen`  
- [ ] planner buduje resolved periodicity  
- [ ] runner umie policzyć `k_path`  
- [ ] CPU reference zwraca pasma i mody  
- [ ] `Γ-point` zgadza się z ringdownem  
- [ ] test Blocha przechodzi  
- [ ] artefakty są zapisane i udokumentowane  
- [ ] capability docs są zaktualizowane  
- [ ] ograniczenia v1 są jawnie wpisane do dokumentacji

