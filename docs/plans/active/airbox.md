
# Fullmag: FEM, oddziaływania dipolowe, airbox i otwarta domena — raport wdrożeniowy

## 1. Najkrótsza odpowiedź

**Czy airbox ma sens?** Tak — ale **tylko** wtedy, gdy liczysz demagnetyzację (stray field / dipolar self-interaction) **natywnie w FEM** jako problem potencjału skalarnego na siatce tetra. Pole demagnetyzujące istnieje w całej przestrzeni, nie tylko wewnątrz magnesu, więc sama siatka „wewnątrz struktury” nie zamyka poprawnie problemu.

**Czy zawsze trzeba go uwzględniać?** Nie. Jeżeli używasz:
1. **transfer-grid exact tensor demag** (projekcja FEM → siatka FDM → exact Newell → próbki z powrotem),  
2. **FEM–BEM / FMM / H-matrices**,  
3. albo **prawdziwych warunków periodycznych** dla problemów periodycznych,  

to **airbox w siatce FEM nie jest potrzebny**.

**Co polecam dla fullmagu jako pierwszy mesh-native FEM demag?**  
Najpierw zaimplementować:

- `airbox + potencjał skalarny + sparse solve`,
- wariant **Dirichlet** jako najprostszy punkt startowy,
- wariant **Robin** jako praktyczny domyślny „lepszy niż Dirichlet”,
- zachować obecny `transfer_grid_exact` jako **baseline walidacyjny**,
- dopiero później dodać **shell transformation**,
- a długofalowo: **FEM–BEM + H/H2/FMM**.

To jest najrozsądniejsza ścieżka między:
- poprawnością fizyczną,
- prostotą implementacji,
- zgodnością z planowaną architekturą `MFEM + libCEED + hypre`,
- oraz realnym kosztem wdrożenia.

---

## 2. Co już wynika z repo fullmag

Z dokumentacji repo wynika kilka ważnych rzeczy ([FM1]–[FM4]):

1. **Publiczna/executable ścieżka FEM w fullmagu nie używa dziś airboxowego solve jako domyślnego demagu**, tylko **transfer-grid exact tensor demag** dla lepszej zgodności FDM↔FEM.  
2. W repo jest już zachowany **historyczny/reference seam** oparty na **skalarnym potencjale z Robinem** na dostarczonym `MeshIR`.
3. Repo już rozróżnia semantycznie:
   - geometrię,
   - `GeometryAssetsIR`,
   - `MeshIR`,
   - regiony / markery domen,
   - oraz przewiduje, że w FEM regiony mają być **jawne**, a nie oparte o bootstrapową konwencję „marker 1 = materiał magnetyczny”.

To jest bardzo dobra baza pod porządną implementację open-boundary demag w FEM.

### Mój wniosek architektoniczny

W fullmagu warto utrzymać trzy poziomy realizacji demagu:

1. **`transfer_grid_exact`** — obecny baseline / oracle do testów i regresji,  
2. **`airbox_dirichlet` / `airbox_robin`** — pierwszy prawdziwy mesh-native FEM demag,  
3. **`shell_transform` / `fem_bem_hmatrix` / `fem_bem_fmm`** — późniejsze strategie wyższej klasy.

Najważniejsze: użytkownik dalej widzi po prostu `Demag()`, a wybór realizacji open-boundary pozostaje detalem backendu / planu FEM.

---

## 3. Dlaczego sama siatka tylko wewnątrz magnesu nie wystarcza

Dla mikromagnetyki bez prądów swobodnych:

$$
\nabla \times \mathbf{H}_d = 0, \qquad
\nabla \cdot (\mathbf{H}_d + \mathbf{M}) = 0.
$$

Wprowadzamy potencjał skalarny:

$$
\mathbf{H}_d = -\nabla u.
$$

Wtedy, przy rozszerzeniu magnetyzacji zerem poza obszar magnetyczny $\Omega_m$:

$$
\Delta u = \nabla \cdot \mathbf{M}
\quad \text{w } \mathbb{R}^3,
\qquad
u(\mathbf{x}) \to 0 \text{ dla } |\mathbf{x}| \to \infty.
$$

To jest **problem w całej przestrzeni**.  
Jeżeli rozwiążesz go tylko w $\Omega_m$ i „zamkniesz” go sztucznym warunkiem na powierzchni magnesu, to:

- nie modelujesz pola zewnętrznego,
- gubisz poprawne warunki transmisji na granicy,
- dostajesz złą energię demagnetyzacji,
- zniekształcasz shape anisotropy,
- a relaksacja może iść do **niewłaściwego minimum**.

### Intuicja fizyczna

Exchange i Zeeman są lokalne.  
Demag / stray field jest **globalny**: źródła są w magnesie, ale pole „zamienia” cały otaczający świat.

Dlatego:
- **mesh tylko w magnesie** wystarczy do exchange,
- **mesh tylko w magnesie** nie wystarczy do mesh-native FEM demag,
- chyba że zastosujesz metodę, która „nieskończoność” obsługuje inaczej niż przez jawną domenę powietrza (BEM, FMM, shell transform, infinite elements, asymptotic BC).

---

## 4. Co dokładnie oznacza „airbox”

W tym raporcie „airbox” oznacza:

> **niemagnetyczną domenę obliczeniową otaczającą obszar magnetyczny**, dodaną po to, aby na skończonej domenie przybliżyć otwartą przestrzeń zewnętrzną.

Formalnie:

$$
D = \Omega_m \cup \Omega_{\text{air}}.
$$

W tej domenie rozwiązujesz potencjał $u$ na **całej** siatce, ale prawa strona istnieje tylko w regionie magnetycznym:

$$
\int_D \nabla u \cdot \nabla v \, dV
+ \int_{\Gamma_{\text{out}}} \beta u v \, dS
=
\int_{\Omega_m} \mathbf{M} \cdot \nabla v \, dV.
$$

Tu:
- $\Omega_m$ — region magnetyczny,
- $\Omega_{\text{air}}$ — airbox / vacuum / nonmagnetic support,
- $\Gamma_{\text{out}} = \partial D$ — zewnętrzna sztuczna granica,
- $\beta$ — parametr Robina (opcjonalnie).

### Ważne

Airbox nie musi oznaczać tylko „powietrza wokół bryły”.  
W praktyce do domeny demag należy też włączyć:

- **wewnętrzne wnęki / dziury / pustki**,
- **niemagnetyczne separatory**,
- **support / substrate**, jeśli magnetycznie są po prostu $\mathbf{M}=0$.

Jeżeli ich nie zamodelujesz, również psujesz warunki transmisji.

---

## 5. Kiedy airbox jest potrzebny, a kiedy nie

| Sytuacja | Czy airbox jest potrzebny? | Co polecam |
|---|---:|---|
| Mesh-native FEM potencjału skalarnego dla izolowanego obiektu | **Tak** (lub metoda równoważna) | `airbox_robin` jako pierwszy krok |
| `transfer_grid_exact` (FEM → FDM-grid → exact tensor demag) | **Nie** | zachować jako baseline |
| FEM–BEM / Fredkin–Koehler | **Nie** | docelowo najlepszy open-boundary bez airboxa |
| Shell transformation / infinite elements | **Nie w sensie „dużego airboxa”** | mała powłoka zamiast wielkiej domeny |
| Problem periodyczny | **Nie** | prawdziwe PBC, nie airbox |

### Praktyczna odpowiedź dla Twojego przypadku

Jeśli dziś liczysz relaksację na siatce wewnątrz struktury i demag jest liczony **natywnie w FEM na tej samej siatce**, to **brakuje Ci open-boundary physics**.  
Jeśli natomiast korzystasz z obecnej ścieżki `transfer_grid_exact`, to **brak airboxa w siatce FEM nie jest błędem**, bo open boundary jest obsłużone gdzie indziej.

---

## 6. Najważniejsze publikacje i co z nich realnie wynika dla fullmagu

### 6.1 Fredkin–Koehler (1990): klasyczny FEM–BEM

To jest fundamentalna praca dla dokładnego open-boundary demag bez siatkowania powietrza [P1].  
Najważniejszy wniosek: **nie trzeba siatkować przestrzeni zewnętrznej**, jeśli przeniesiesz warunek w nieskończoności na granicę magnesu metodą brzegową.

**Co brać do fullmagu:**  
To jest bardzo dobra **długoterminowa** ścieżka „docelowej” implementacji wysokiej jakości.

**Ale:**  
na start jest to bardziej złożone niż airbox:
- gęste macierze brzegowe,
- kompresja H/H2 albo FMM dla skalowalności,
- większy koszt implementacji.

### 6.2 Brunotte–Meunier–Imhoff (1992): shell transformation

To klasyczny sposób na „zamianę nieskończonej przestrzeni” na skończoną powłokę przez transformację współrzędnych [P2].

**Co brać do fullmagu:**  
Świetny kandydat na **Phase 2**, kiedy już będzie działał zwykły airbox.  
Zaleta: nadal masz **rzadki układ FEM**.  
Wada: pojawia się anizotropowy, osobliwy metryczny tensor i gorsze uwarunkowanie.

### 6.3 Abert et al. / magnum.fe (2013): praktyczny kod mikromagnetyczny FEM

`magnum.fe` jest bardzo ważnym precedensem: pokazuje, że w realnym kodzie mikromagnetycznym FEM podejście oparte na transformacji / shellu ma sens i jest praktyczne [P4].

**Co brać do fullmagu:**  
- to jest mocny argument, że **shell transformation** jest „micromagnetically natural”,  
- ale nadal nie zmienia mojego wniosku, że do fullmagu najpierw warto dodać **plain airbox**, bo wdrożeniowo jest prostszy.

### 6.4 Abert (2019): bardzo dobry przegląd metod stray-field

Ta praca jest kluczowa, bo zbiera metody stosowane w mikromagnetyce i ich praktyczne kompromisy [P9].

Najważniejsze rzeczy dla fullmagu:
- truncation / airbox jest najprostszym sposobem podejścia FEM do open boundary,
- sensowne jest wybranie zewnętrznej domeny około **5× większej liniowo** od obszaru magnetycznego jako punktu odniesienia,
- w airboxie można **silnie koarsenować mesh ku zewnętrznej granicy** bez dużej straty dokładności,
- shell transformation daje **skończoną reprezentację nieskończoności**, ale pogarsza conditioning,
- FEM–BEM eliminuje potrzebę siatkowania powietrza.

### 6.5 Bruckner et al. (2012, 2017): FEM–BEM i skalowanie

Prace z TU Wien / Vienna pokazują ([P3], [P7]):
- open boundary można obsłużyć dokładnie przez hybrydę FEM–BEM,
- nie trzeba siatkować domeny zewnętrznej,
- H-matrix compression pozwala to skalować do dużych problemów.

**Wniosek dla fullmagu:**  
Jeżeli kiedyś fullmag ma być poważnym dużym FEM micromagnetics code dla krzywych geometrii, to **FEM–BEM z kompresją** jest bardzo naturalnym celem końcowym.

### 6.6 Palmesi et al. (2017), Hertel et al. (2019): FMM i H2

To są prace ważne dla późniejszej skali ([P8], [P10]):
- FMM na tetraedrach,
- H2-matrices dla demagu w FEM/BEM.

**Wniosek:**  
To już jest „serious production-grade large scale”, ale nie pierwszy sprint implementacyjny.

### 6.7 Meeker (2013): asymptotic / improvised open boundary conditions

Ta praca jest cenna, bo pokazuje, że istnieją **prostsze lokalne BC** lepsze niż brutalne `u=0` [P6].  
Czyli: nawet bez pełnego BEM możesz zrobić lepszą zewnętrzną granicę.

**Wniosek:**  
Dla fullmagu ma sens mieć:
- `airbox_dirichlet`,
- `airbox_robin`,
- ewentualnie później wyższe asymptotic BC.

### 6.8 Schröder et al. (2022): redukcja zewnętrznej domeny / kondensacja

To ciekawa praca z innego niż klasyczna mikromagnetyka punktu widzenia [P12]:
- zewnętrzną domenę można przybliżyć dużym obszarem,
- podzielić na część wewnętrzną i zewnętrzną,
- a zewnętrzne DOF-y **skondensować**.

**Wniosek dla fullmagu:**  
Po wdrożeniu zwykłego airboxa można dodać optymalizację:
- factorize / eliminate interior-air DOFs raz,
- zostawić mniejszy Schur complement na interfejs / część istotną.

### 6.9 Bruckner et al. (2021): prawdziwe PBC

Dla struktur periodycznych airbox nie jest właściwym narzędziem [P11].  
Trzeba używać **true periodic boundary conditions**, bo inaczej sztuczna zewnętrzna granica produkuje fałszywą shape anisotropy.

**Wniosek:**  
Nie rób airboxa jako uniwersalnej odpowiedzi na wszystko.  
W problemach periodycznych wybór powinien być: **PBC, nie airbox**.

---

## 7. Porównanie metod pod kątem wdrożenia w fullmagu

| Metoda | Dokładność open boundary | Złożoność implementacji | Macierze | Skalowanie | Mój werdykt |
|---|---|---:|---|---|---|
| Airbox + Dirichlet | średnia | **niska** | rzadkie SPD | dobre | najlepszy MVP |
| Airbox + Robin | średnia+ | niska/średnia | rzadkie SPD | dobre | najlepszy praktyczny start |
| Shell transformation | dobra | średnia | rzadkie SPD, gorzej uwarunkowane | dobre | faza 2 |
| FEM–BEM | wysoka | wysoka | FEM rzadkie + BEM gęste | po kompresji dobre | długofalowy target |
| FEM–BEM + H/H2 | wysoka | bardzo wysoka | skompresowane | bardzo dobre | production-scale target |
| FMM na tetraedrach | wysoka | bardzo wysoka | bez klasycznej pełnej macierzy | bardzo dobre | zaawansowany target |
| Transfer-grid exact | wysoka dla bieżącego use-case | już jest | operator poza mesh-native FEM | dobre | zachować jako oracle |

### Mój praktyczny wybór

**Dla fullmagu teraz:**
1. `transfer_grid_exact` zostawić jako **domyślne odniesienie**,  
2. wdrożyć `airbox_robin` jako **pierwszy mesh-native FEM demag**,  
3. dodać `airbox_dirichlet` jako prosty fallback / test,  
4. później `shell_transform`,  
5. na końcu `fem_bem_hmatrix` albo `fem_bem_fmm`.

---

## 8. Rekomendowana architektura w fullmagu

## 8.1 Zasada: `Demag()` pozostaje pojęciem fizycznym

Użytkownik ma nadal pisać po prostu:

```python
Demag()
```

Natomiast realizacja open boundary powinna siedzieć w planie backendowym / loweringowym, np.:

```json
{
  "backend_policy": {
    "fem": {
      "demag_realization": "airbox_robin",
      "open_boundary": {
        "outer_shape": "bbox",
        "padding_factor": 3.0,
        "grading_ratio": 1.4,
        "outer_bc": {
          "kind": "robin",
          "beta_mode": "equivalent_sphere",
          "factor": 2.0
        }
      }
    }
  }
}
```

### Minimalny enum realizacji

```text
transfer_grid_exact
airbox_dirichlet
airbox_robin
shell_transform
fem_bem_hmatrix
fem_bem_fmm
periodic_demag
```

To jest zgodne z filozofią repo: fizyka pozostaje wspólna, a realizacja operatora może się różnić między backendami.

---

## 8.2 Regiony muszą być jawne

Bootstrapowa konwencja:
- „jeśli jest marker 1, to to jest region magnetyczny”

nadaje się tylko do szybkiego eksperymentu.  
Dla prawdziwego wdrożenia trzeba mieć jawnie:

- `magnetic`,
- `air`,
- `support_nonmagnetic`,
- `void`,
- opcjonalnie regiony periodyczne / boundary tags.

### Moja rekomendacja

W `MeshIR` albo w obiekcie pochodnym planu FEM trzymaj co najmniej:

- marker elementu,
- marker regionu logicznego,
- marker zewnętrznej granicy `Gamma_out`,
- ewentualnie markery ścian periodycznych,
- informację, które elementy są magnetyczne,
- informację, które są tylko „otoczeniem dla solve’u”.

---

## 8.3 Najpierw obsłuż dwa tryby wejścia

### Tryb A — najprostszy wdrożeniowo

Użytkownik dostarcza **już gotowy mesh** zawierający:
- region magnetyczny,
- region airbox,
- boundary tag na zewnętrznej granicy.

To pozwala wdrożyć solver **bez budowania automatycznego meshera**.

### Tryb B — wygodny docelowo

Fullmag generuje airbox sam:
- na poziomie CAD / STL / surface asset,
- przed tetrahedralizacją,
- z pełnym remeshem całej domeny.

### Bardzo ważna uwaga

Jeśli użytkownik ma **tylko gotowy tetra mesh samego magnesu**, to „doklejenie” airboxa bez remeshu jest trudne i ryzykowne.  
W praktyce poprawne ścieżki są dwie:

1. albo użytkownik podaje od razu mesh z airboxem,  
2. albo fullmag wraca do geometrii powierzchniowej / CAD i robi **jeden wspólny conforming remesh**.

**Nie polecam** zszywania dwóch niezależnych siatek tetra na interfejsie.

---

## 9. Jak to dyskretyzować

## 9.1 Funkcje i przestrzenie

Dla pierwszej implementacji polecam dokładnie to:

- potencjał skalarowy:
  $$
  W_h \subset H^1(D)
  $$
  na **całej domenie** `magnet + air`,

- magnetyzacja:
  $$
  V_h \subset [H^1(\Omega_m)]^3
  $$
  na **regionie magnetycznym**.

### Najprostszy sensowny wybór

- `P1` tetra dla potencjału,
- `P1` nodal dla magnetyzacji.

To ma kilka zalet:
- prosta implementacja,
- łatwe odzyskiwanie gradientu,
- zgodność z tym, co repo już szkicuje,
- dobry punkt startowy do CPU reference i później GPU path.

### Co z polem w airboxie?

Magnetyzacja **nie musi mieć DOF-ów w airboxie**.  
Wystarczy, że przy RHS solve’u traktujesz ją jako „rozszerzoną zerem poza $\Omega_m$”.

---

## 9.2 Słaba forma

### Wersja Dirichlet

Znajdź $u_h \in W_h^0$ takie, że:

$$
\int_D \nabla u_h \cdot \nabla v_h \, dV
=
\int_{\Omega_m} \mathbf{M}_h \cdot \nabla v_h \, dV
\qquad \forall v_h \in W_h^0,
$$

gdzie:
$$
W_h^0 = \{ v_h \in W_h : v_h = 0 \text{ na } \Gamma_{\text{out}} \}.
$$

### Wersja Robin

Znajdź $u_h \in W_h$ takie, że:

$$
\int_D \nabla u_h \cdot \nabla v_h \, dV
+
\int_{\Gamma_{\text{out}}} \beta\, u_h v_h \, dS
=
\int_{\Omega_m} \mathbf{M}_h \cdot \nabla v_h \, dV
\qquad \forall v_h \in W_h.
$$

Wtedy:

$$
\mathbf{H}_{d,h} = -\nabla u_h.
$$

---

## 9.3 Co montować na jakich elementach

### Laplasjan / stiffness

Na **wszystkich** elementach domeny `magnet + air`:

$$
K_{ij} = \int_D \nabla \phi_i \cdot \nabla \phi_j \, dV.
$$

### Robin boundary mass

Na **zewnętrznej sztucznej granicy**:

$$
B_{ij} = \int_{\Gamma_{\text{out}}} \phi_i \phi_j \, dS.
$$

Wtedy:
$$
A = K + \beta B.
$$

### Prawa strona

Tylko na elementach magnetycznych:

$$
b_i = \int_{\Omega_m} \mathbf{M}_h \cdot \nabla \phi_i \, dV.
$$

To jest bardzo ważne.  
**Nie** integrujesz RHS po całej domenie, tylko po $\Omega_m$.

To dokładnie realizuje fakt, że:
- magnetyzacja żyje tylko w magnesie,
- a poza nim $\mathbf{M}=0$.

---

## 9.4 Dokładne lokalne wzory dla P1 tetra — bardzo implementowalne

Dla elementu tetra $e$ z objętością $V_e$ i lokalnymi funkcjami bazowymi $\phi_1,\dots,\phi_4$:

- gradienty $\nabla \phi_i$ są stałe na elemencie,
- jeśli $\mathbf{M}_h$ jest liniowe (P1), to jego średnia po elemencie to po prostu średnia z wartości nodalnych.

Zdefiniuj lokalną macierz gradientów:

$$
C_e =
\begin{bmatrix}
(\nabla \phi_1)^T \\
(\nabla \phi_2)^T \\
(\nabla \phi_3)^T \\
(\nabla \phi_4)^T
\end{bmatrix}
\in \mathbb{R}^{4 \times 3}.
$$

Jeśli średnia magnetyzacja na elemencie to $\overline{\mathbf{M}}_e$, to lokalny wkład RHS można policzyć jako:

$$
b_e = V_e\, C_e\, \overline{\mathbf{M}}_e.
$$

A ponieważ dla P1:
$$
\overline{\mathbf{M}}_e = \frac{1}{4}\sum_{a=1}^4 \mathbf{M}_a,
$$

to masz bardzo tani algorytm per element.

### Odtwarzanie pola demag

Jeśli lokalne DOF-y potencjału na elemencie to:
$$
u_e = [u_1, u_2, u_3, u_4]^T,
$$

to gradient potencjału jest stały na elemencie:

$$
\nabla u_h|_e = C_e^T u_e,
$$

więc:

$$
\mathbf{H}_{d,e} = - C_e^T u_e.
$$

To jest bardzo wygodne:
- zero dodatkowej kwadratury dla P1,
- bardzo prosty kod,
- łatwe cache’owanie geometrii elementu.

---

## 9.5 Czy pole demag trzymać elementowo czy nodalnie?

Dla P1 potencjału:
- $\nabla u_h$ jest **stałe na elemencie**.

Dlatego są dwie sensowne strategie:

### Strategia A — operatorowa (polecam)
Przy obliczaniu `H_eff` używasz `-∇u_h` **bezpośrednio w punktach kwadratury** elementów magnetycznych.

To jest najlepsze dla późniejszego GPU / matrix-free.

### Strategia B — eksportowa / wizualizacyjna
Projektujesz lub uśredniasz pole elementowe do:
- węzłów,
- albo przestrzeni wektorowej `L2`.

To jest dobre dla:
- outputów,
- probe’ów,
- streamingu,
- porównania z FDM.

### Moja rekomendacja
**W solverze używaj Strategii A, a Strategię B traktuj jako postprocessing.**

---

## 9.6 Energia

Dla Dirichlet:

$$
E_d^{(D)} = \frac{\mu_0}{2}\int_D |\nabla u_h|^2\, dV.
$$

Dla Robin:

$$
E_d^{(R)} =
\frac{\mu_0}{2}
\left(
\int_D |\nabla u_h|^2\, dV
+
\int_{\Gamma_{\text{out}}}\beta u_h^2\, dS
\right).
$$

Jako check możesz też liczyć:

$$
E_d \approx -\frac{\mu_0}{2}\int_{\Omega_m}\mathbf{M}_h \cdot \mathbf{H}_{d,h}\, dV,
$$

ale do produkcyjnej spójności operatora bezpieczniej trzymać energię z tej samej formy, którą naprawdę rozwiązujesz.

---

## 10. Jak wybrać warunek na zewnętrznej granicy

## 10.1 Dirichlet

Najprostsza wersja:

$$
u = 0 \quad \text{na } \Gamma_{\text{out}}.
$$

### Zalety
- banalna implementacja,
- bardzo stabilny numerycznie,
- dobry pierwszy krok.

### Wady
- wymaga zwykle większego airboxa,
- bardziej zniekształca rozwiązanie przy małej domenie.

### Mój werdykt
Idealny na:
- pierwszy test,
- CI,
- porównania,
- fallback.

Ale nie jako jedyny wariant produkcyjny.

---

## 10.2 Robin

Praktyczny warunek pierwszego rzędu:

$$
\partial_n u + \beta u = 0
\quad \text{na } \Gamma_{\text{out}}.
$$

### Dlaczego ma sens?

Dla sferycznej granicy zewnętrznej rozwiązanie zewnętrzne Laplace’a ma rozwinięcie harmoniczne:

$$
u(r,\theta,\varphi)
=
\sum_{l=0}^{\infty}\sum_m a_{lm} r^{-(l+1)} Y_{lm}(\theta,\varphi).
$$

Dla pojedynczej składowej $l$:

$$
\partial_r u = -\frac{l+1}{R}u
\quad \text{na } r=R.
$$

Czyli dokładny operator typu DtN na sferze nie jest stałą, tylko zależy od modu harmonicznego.  
Jeżeli jednak dominują dalekie składowe dipolowe ($l=1$), to naturalnie dostajesz heurystykę:

$$
\beta \approx \frac{2}{R}.
$$

### Co z tym zrobić w fullmagu?

Zamiast zakodować na sztywno jeden wzór, zrób:

$$
\beta = \frac{c}{R_*},
$$

gdzie:
- `c` jest parametrem konfigurowalnym,
- `R_*` to np.:
  - promień sferycznego airboxa,
  - promień sfery równoważnej objętościowo,
  - promień sfery opisanej na domenie.

### Moja rekomendacja praktyczna

Wspieraj od razu dwa tryby:

- **legacy**: `c = 1`, zgodne z obecną bootstrapową notatką repo,
- **dipole**: `c = 2`, bardziej fizyczne dla izolowanych obiektów na sferycznej zewnętrznej granicy.

I **nie wybieraj dogmatycznie jednego**.  
Najlepiej dobrać `c` przez walidację względem:
- `transfer_grid_exact`,
- dużego airboxa referencyjnego,
- albo benchmarków analitycznych.

### Uwaga

Na granicy **prostopadłościennego** airboxa Robin ze stałym `\beta` jest tylko heurystyką.  
Działa praktycznie, ale nie jest „dokładnym warunkiem w nieskończoności”.  
Dlatego:
- box + Robin = praktyczne,
- sphere + Robin = bardziej spójne fizycznie.

---

## 10.3 Czego nie polecam jako pierwszy krok

### Czysty Neumann
Ma nullspace, wymaga dodatkowych warunków i nie daje dobrego zamknięcia open boundary na start.

### Od razu wyższe ABC / IABC
Warto później, ale na MVP zwykły Robin jest tańszy i bardziej przewidywalny.

---

## 11. Jak dobrać rozmiar i mesh airboxa

## 11.1 Jak duży powinien być airbox?

Z przeglądu Abert (2019) wynika, że jako punkt odniesienia sensowne jest przyjęcie domeny zewnętrznej około **5× większej liniowo** od obszaru magnetycznego w każdej osi [P9]. To jest dobra referencja, ale często zbyt drogie jako domyślna opcja.

### Moja praktyczna rekomendacja

W fullmagu dałbym trzy poziomy:

- **preview / szybki test**: `padding_factor = 2.0`  
- **produkcja / codzienne liczenie**: `padding_factor = 3.0`  
- **walidacja / reference**: `padding_factor = 5.0`

gdzie np. dla boxa:

$$
L_i^{\text{out}} = s \, L_i^{\text{mag}},
$$

a margines z każdej strony wynosi:

$$
\frac{(s-1)L_i^{\text{mag}}}{2}.
$$

### Ważne
To **nie** jest uniwersalna prawda.  
To jest **punkt startowy**, który trzeba sprawdzić zbieżnością względem:
- energii demag,
- normy pola demag,
- stanu relaksacji.

---

## 11.2 Jak dyskretyzować airbox

Najlepsza praktyka:

1. przy interfejsie magnet–air:
   - element size podobny do tego w magnesie,

2. dalej od magnesu:
   - stopniowe koarsenowanie ku zewnętrznej granicy.

### Heurystyka inżynierska
Na start możesz użyć:
- `h_air_interface ≈ h_mag`,
- wzrost geometryczny `1.3 – 1.6` między warstwami,
- `h_max` na zewnętrznej granicy kilka razy większe od `h_mag`.

To nie jest „twierdzenie z literatury”, tylko sensowna praktyka implementacyjna wynikająca z tego, że potencjał poza magnesem jest gładki i maleje.

### Czego pilnować
- dobra jakość tetrahedrów,
- conforming interface na granicy magnet–air,
- brak ekstremalnie cienkich sliverów,
- sensowne boundary tags.

---

## 11.3 Box czy sphere?

### Box
**Plusy:**
- łatwy do wygenerowania,
- prosty boolean z CAD / STL,
- naturalny dla axis-aligned pipeline.

**Minusy:**
- Robin ma słabsze uzasadnienie geometryczne,
- narożniki są sztuczne.

### Sphere
**Plusy:**
- bardziej naturalna geometria dla radialnego zaniku,
- Robin ma lepszy sens.

**Minusy:**
- czasem mniej wygodna do automatycznego pipeline’u,
- nie zawsze pasuje do istniejącej geometrii roboczej.

### Mój werdykt
- **MVP**: `bbox airbox`,
- **lepsza fizyka dla Robin**: opcjonalny `sphere airbox`.

---

## 12. Jak to liczyć w relaksacji

Sama relaksacja **nie zmienia** istoty open-boundary demag.  
Demag jest po prostu liniowym operatorem, którego wywołujesz przy każdej ocenie `H_eff`.

Dla jednej oceny RHS LLG:

1. policz `H_ex`,
2. policz `H_demag`,
3. dodaj `H_ext`,
4. zbuduj `H_eff`,
5. policz RHS LLG / krok relaksacji.

### Bardzo ważna własność

Dla ustalonej geometrii i siatki macierz demagu z airboxem jest **stała**.  
Zmienia się tylko prawa strona zależna od $\mathbf{M}$.

To oznacza:
- matrycę i preconditioner budujesz raz,
- w każdej iteracji składasz tylko RHS,
- możesz warm-startować solve poprzednim potencjałem.

To czyni airbox FEM znacznie bardziej atrakcyjnym w relaksacji niż mogłoby się wydawać.

---

## 13. Konkretne algorytmy do wdrożenia

## 13.1 Algorytm A — `setup_demag_airbox`

```text
function setup_demag_airbox(mesh, region_tags, bc_config, solver_config):
    W = H1_scalar_space(mesh, order=1)

    magnetic_elements = elements_with_region("magnetic")
    outer_boundary_facets = facets_with_tag("Gamma_out")

    K = assemble_laplacian(W, all_elements)

    if bc_config.kind == "dirichlet":
        A = K
        essential_dofs = boundary_dofs(W, outer_boundary_facets)
        eliminate_dirichlet(A, essential_dofs, value=0)
    else if bc_config.kind == "robin":
        B = assemble_boundary_mass(W, outer_boundary_facets)
        beta = compute_beta(mesh, bc_config)
        A = K + beta * B
        essential_dofs = none

    preconditioner = build_preconditioner(A, solver_config)
    cache_geometry_data(mesh)   # volumes, gradients, connectivity, markers

    return DemagAirboxOperator {
        W,
        magnetic_elements,
        outer_boundary_facets,
        A,
        preconditioner,
        essential_dofs,
        cached_geometry,
        previous_u = 0
    }
```

### Komentarz
To jest budowane **raz na całą relaksację**.

---

## 13.2 Algorytm B — `assemble_demag_rhs`

```text
function assemble_demag_rhs(op, m):
    b = zero_vector(op.W.ndofs)

    for element e in op.magnetic_elements:
        node_ids = e.scalar_node_ids
        magnetization_node_ids = e.magnetization_node_ids

        M_bar = average(Ms * m at magnetization_node_ids)
        C_e   = op.cached_geometry[e].gradients   # 4x3
        V_e   = op.cached_geometry[e].volume

        b_local = V_e * C_e * M_bar
        add_local_vector(b, node_ids, b_local)

    if op.essential_dofs exist:
        apply_dirichlet_rhs_correction(b, op.essential_dofs, value=0)

    return b
```

### Uwaga
Dla P1 i średniej elementowej to jest bardzo tanie.  
Potem można to uogólnić na:
- wyższy rząd,
- przestrzennie zmienne `M_s`,
- dokładniejszą kwadraturę.

---

## 13.3 Algorytm C — `solve_demag_airbox`

```text
function solve_demag_airbox(op, m):
    b = assemble_demag_rhs(op, m)

    u = solve_linear_system(
        A = op.A,
        rhs = b,
        M = op.preconditioner,
        x0 = op.previous_u
    )

    op.previous_u = u

    H_demag_elementwise = []
    for element e in op.magnetic_elements:
        u_local = gather(u, e.scalar_node_ids)
        C_e = op.cached_geometry[e].gradients
        H_e = - transpose(C_e) * u_local
        H_demag_elementwise[e] = H_e

    E_demag = compute_energy(op, u, H_demag_elementwise)

    return {u, H_demag_elementwise, E_demag}
```

---

## 13.4 Algorytm D — użycie w Heun / LLG

```text
function llg_heun_step(state, dt, demag_op):
    H_ex = exchange_field(state.m)
    demag_1 = solve_demag_airbox(demag_op, state.m)
    H_eff_1 = H_ex + demag_1.H + H_ext(state)

    k1 = llg_rhs(state.m, H_eff_1)

    m_trial = normalize(state.m + dt * k1)

    H_ex_trial = exchange_field(m_trial)
    demag_2 = solve_demag_airbox(demag_op, m_trial)
    H_eff_2 = H_ex_trial + demag_2.H + H_ext(state)

    k2 = llg_rhs(m_trial, H_eff_2)

    m_new = normalize(state.m + 0.5 * dt * (k1 + k2))

    return m_new
```

### Wniosek
Demag operator jest po prostu „usługą” dla solvera relaksacji.  
Nie trzeba specjalnego algorytmu relaksacji tylko dla airboxa.

---

## 13.5 Algorytm E — adaptacyjny dobór rozmiaru airboxa

To polecam jako procedurę kalibracyjną dla fullmagu.

```text
function calibrate_airbox(problem, scales=[2,3,5], robin_factors=[1,2]):
    reference = solve_with_transfer_grid_exact(problem)

    results = []

    for s in scales:
        mesh_s = build_airbox_mesh(problem.geometry, scale=s)

        for c in robin_factors:
            op = setup_demag_airbox(mesh_s, bc=Robin(c))

            for test_state in benchmark_states(problem):
                out = solve_demag_airbox(op, test_state.m)

                rel_E = relative_error(out.E_demag, reference.E_demag)
                rel_H = relative_error_norm(out.H_demag, reference.H_demag)

                results.append((s, c, test_state.name, rel_E, rel_H))

    choose_smallest_configuration_meeting_tolerance(results)
    return results
```

### Benchmark states
Na start:
- uniform `+x`,
- uniform `+y`,
- uniform `+z`,
- losowy stan,
- stan po krótkiej relaksacji.

To wystarczy, żeby dobrać:
- `padding_factor`,
- `beta factor`,
- sensowną strategię meshowania.

---

## 13.6 Algorytm F — opcjonalna kondensacja DOF-ów airboxa

To nie jest konieczne na MVP, ale jest bardzo sensownym krokiem optymalizacyjnym.

Podziel DOF-y na:
- `r` — region „istotny” (magnes + interfejs),
- `a` — interior air DOFs.

Masz układ:

$$
\begin{bmatrix}
A_{rr} & A_{ra} \\
A_{ar} & A_{aa}
\end{bmatrix}
\begin{bmatrix}
u_r \\
u_a
\end{bmatrix}
=
\begin{bmatrix}
b_r \\
0
\end{bmatrix}.
$$

Po eliminacji:

$$
S u_r = b_r,
\qquad
S = A_{rr} - A_{ra} A_{aa}^{-1} A_{ar}.
$$

### Kiedy to ma sens
- gdy airbox ma dużo DOF-ów,
- geometria jest stała,
- robisz dużo kroków relaksacji,
- część zewnętrzna jest liniowa.

### Mój werdykt
To jest świetna **Phase 1.5 / 2** optymalizacja.

---

## 14. Co wdrażać w jakiej kolejności

## 14.1 Faza 0 — zostaw to, co już działa

Zachowaj:
- `transfer_grid_exact` jako reference / oracle,
- obecny kontrakt `H_demag`, `E_demag`.

To jest bardzo ważne do walidacji.

---

## 14.2 Faza 1 — minimalny naukowo uczciwy mesh-native FEM demag

### MVP-1A
Obsłuż tylko **mesh wejściowy z gotowym airboxem**.

To daje:
- mały koszt wdrożeniowy,
- pełny test fizyki,
- brak potrzeby budowania automatycznego meshera.

### MVP-1B
Dodaj:
- `airbox_dirichlet`,
- `airbox_robin`,
- sparse assemble + CG/AMG,
- region-aware assembly,
- eksport `H_demag`, `E_demag`.

### To już da ogromny postęp
W tym momencie fullmag ma już prawdziwy FEM demag z open boundary, nawet jeśli jeszcze przybliżony.

---

## 14.3 Faza 2 — jakość i wydajność

- automatyczne generowanie airboxa z geometrii,
- grading siatki,
- Robin z konfigurowalnym `beta_mode`,
- ewentualna kondensacja DOF-ów powietrza,
- shell transformation.

---

## 14.4 Faza 3 — dokładny docelowy open boundary

- FEM–BEM Fredkin–Koehler,
- H/H2-matrix compression,
- albo FMM dla tetra mesh.

To jest moment, kiedy airbox przestaje być centralny, a staje się tylko jedną z realizacji.

---

## 15. Rekomendacje solverowe

## 15.1 CPU reference
Najprościej:
- assemble sparse CSR,
- CG / PCG,
- AMG jako preconditioner.

To jest idealne dla pierwszego reference runnera.

## 15.2 GPU / MFEM + libCEED + hypre
Dla późniejszej ścieżki:
- operator Laplace + boundary mass są naturalne dla H1,
- można je traktować partial-assembly / matrix-free,
- demag wciąż jest liniowym solve’em na stałej macierzy.

### Moja rada praktyczna
Nie komplikowałbym GPU na samym początku.  
Najpierw:
1. **sparse assembled CPU version**,  
2. potem przenieść tę samą matematykę do MFEM/libCEED.

---

## 16. Jak to zwalidować

## 16.1 Testy obowiązkowe

1. **Pozytywność energii**
   $$
   E_{\text{demag}} \ge 0
   $$
   dla sensownych stanów.

2. **Thin-film sanity check**
   Dla płaskiego elementu:
   - uniform out-of-plane powinien mieć większą energię demag niż in-plane.

3. **Zbieżność względem rozmiaru airboxa**
   Sprawdź:
   - `s = 2, 3, 5`,
   - Dirichlet vs Robin,
   - czułość energii i pola.

4. **Zbieżność względem mesha w airboxie**
   Koarsenowanie powinno mieć mały wpływ po osiągnięciu sensownego zagęszczenia przy interfejsie.

5. **Porównanie do `transfer_grid_exact`**
   To powinien być główny automatyczny benchmark fullmagu.

---

## 16.2 Benchmarki fizyczne

### Sfera
Dla jednorodnej magnetyzacji:
- klasyczny benchmark,
- współczynnik demag `N = 1/3`.

### Prostopadłościan / cienka warstwa
- bardzo dobre do sprawdzania shape anisotropy,
- wrażliwe na błędy open boundary.

### Dwie oddzielone bryły
- sprawdza długozasięgowe sprzężenie dipolowe.

### Wnęka / dziura
- sprawdza, czy solve na domenie `magnet + void + air` jest poprawny.

### Struktura periodyczna
- tu **nie** walidujesz airboxa, tylko poprawne przejście na PBC.

---

## 16.3 Tolerancje

Na start sensowne są dwa poziomy:

### Tolerancje inżynierskie
- energia względna: `1e-3 – 1e-2`,
- pole lokalne: kilka procent.

### Tolerancje referencyjne
- energia względna: `<= 1e-3`,
- lepsza zgodność dla wybranych benchmarków.

Nie oczekiwałbym „bitwise identity” między airbox FEM a transfer-grid exact.  
Ważna jest **zgodność fizyczna i zbieżność**.

---

## 17. Czego bym nie robił

1. **Nie liczyłbym demagu tylko na siatce magnesu** bez żadnego open-boundary treatment.  
2. **Nie zakładałbym**, że jeden `beta` będzie optymalny dla wszystkich geometrii.  
3. **Nie wyrzucałbym** `transfer_grid_exact` po wdrożeniu airboxa — to świetny oracle.  
4. **Nie robiłbym** automatycznego „doklejania airboxa” do gotowego tetra mesha bez remeshu.  
5. **Nie używałbym airboxa do problemów periodycznych**.  
6. **Nie mieszałbym** semantyki regionu magnetycznego z bootstrapowym markerem `1` w finalnej architekturze.

---

## 18. Mój ostateczny plan dla fullmagu

## Etap 1 — od razu wdroż
**`airbox_robin` + sparse FEM solve**, ale najpierw tylko dla mesha, który już ma region `air`.

To jest najbardziej opłacalny pierwszy krok.

### Konkretnie:
- `W_h` na całym mesh,
- RHS tylko po `magnetic`,
- `K` na całej domenie,
- `B` tylko na `Gamma_out`,
- `A = K + beta B`,
- `H_demag = -grad(u)` w elementach magnetycznych,
- `E_demag` z tej samej formy,
- reuse preconditionera w relaksacji.

---

## Etap 2 — dołóż wygodę
- automatyczne generowanie airboxa,
- grading,
- tryby `bbox` / `sphere`,
- `beta_mode = legacy | dipole | user`.

---

## Etap 3 — dołóż jakość
- shell transformation,
- lepsze asymptotic BC,
- opcjonalnie statyczna kondensacja air DOF.

---

## Etap 4 — docelowa wersja high-end
- FEM–BEM z kompresją H/H2,
- albo FEM + FMM na tetraedrach.

---

## 19. Mój werdykt końcowy

### Jeżeli pytanie brzmi:
> „Czy musimy uwzględniać airbox?”

to odpowiedź brzmi:

- **Tak**, jeśli chcesz mieć **mesh-native FEM demag** dla izolowanego obiektu i dziś masz tylko mesh wewnątrz struktury.
- **Nie**, jeśli demag liczysz przez inną metodę otwartej domeny (`transfer_grid_exact`, FEM–BEM, PBC, FMM).

### Jeżeli pytanie brzmi:
> „Co wdrożyć najpierw w fullmagu?”

to moja odpowiedź jest jednoznaczna:

1. **zostawić `transfer_grid_exact` jako baseline**,  
2. **wdrożyć `airbox_robin` jako pierwszy prawdziwy FEM demag**,  
3. **dodać `airbox_dirichlet` jako fallback/test**,  
4. **dopiero później shell transform**,  
5. **długofalowo iść w FEM–BEM/H2/FMM**.

To jest najlepszy kompromis między:
- naukową uczciwością,
- prostotą,
- wydajnością,
- i kompatybilnością z obecną architekturą fullmagu.

---

## 20. Lista zadań implementacyjnych „na jutro”

### Minimalny sprint
- [ ] dodać jawne rozróżnienie regionów `magnetic` / `air`,
- [ ] dodać boundary tag `Gamma_out`,
- [ ] dodać `demag_realization = airbox_dirichlet | airbox_robin`,
- [ ] złożyć `K`, `B`, `b`,
- [ ] zaimplementować odzyskiwanie `H_demag = -grad(u)`,
- [ ] porównać `E_demag` i `H_demag` z `transfer_grid_exact`.

### Następny sprint
- [ ] warm start solve’u,
- [ ] AMG / lepszy preconditioner,
- [ ] grading airboxa,
- [ ] testy zbieżności po rozmiarze airboxa,
- [ ] benchmark sphere / thin film / two bodies.

### Później
- [ ] auto-airbox z geometrii,
- [ ] shell transform,
- [ ] kondensacja DOF-ów powietrza,
- [ ] FEM–BEM.

---

## 21. Bibliografia i źródła

### Dokumentacja repo / fullmag

**[FM1]** Fullmag, `docs/physics/0520-fem-robin-airbox-demag-bootstrap-reference.md`.  
Bootstrap executable FEM demagnetization: Robin scalar potential and transfer-grid exact demag.

**[FM2]** Fullmag, `docs/physics/0430-fem-dipolar-demag-mfem-gpu-foundations.md`.  
FEM foundations for dipolar self-interaction (demagnetization) on MFEM/libCEED/hypre.

**[FM3]** Fullmag, `docs/physics/0100-mesh-and-region-discretization.md`.  
Mesh and region discretization.

**[FM4]** Fullmag, `docs/specs/problem-ir-v0.md`.  
ProblemIR v0.

### Publikacje naukowe

**[P1]** Fredkin, D. R., Koehler, T. R.  
*Hybrid method for computing demagnetizing fields*.  
IEEE Transactions on Magnetics, 26, 415–417 (1990).  
DOI: `10.1109/20.106342`

**[P2]** Brunotte, X., Meunier, G., Imhoff, J.-F.  
*Finite element modeling of unbounded problems using transformations: A rigorous, powerful and easy solution*.  
IEEE Transactions on Magnetics, 28(2), 1663–1666 (1992).  
DOI: `10.1109/20.124021`

**[P3]** Bruckner, F. et al.  
*3D FEM–BEM-coupling method to solve magnetostatic Maxwell equations*.  
Journal of Magnetism and Magnetic Materials, 324(10), 1862–1866 (2012).  
DOI: `10.1016/j.jmmm.2012.01.016`

**[P4]** Abert, C., Exl, L., Bruckner, F., Drews, A., Suess, D.  
*magnum.fe: A micromagnetic finite-element simulation code based on FEniCS*.  
Journal of Magnetism and Magnetic Materials, 345, 29–35 (2013).  
DOI: `10.1016/j.jmmm.2013.05.051`

**[P5]** Abert, C., Exl, L., Selke, G., Drews, A., Schrefl, T.  
*Numerical methods for the stray-field calculation: A comparison of recently developed algorithms*.  
Journal of Magnetism and Magnetic Materials, 326, 176–185 (2013).  
DOI: `10.1016/j.jmmm.2012.08.041`

**[P6]** Meeker, D.  
*Improvised Open Boundary Conditions for Magnetic Finite Elements*.  
IEEE Transactions on Magnetics, 49(10), 5243–5247 (2013).  
DOI: `10.1109/TMAG.2013.2260348`

**[P7]** Bruckner, F. et al.  
*Solving Large-Scale Inverse Magnetostatic Problems using the Adjoint Method*.  
Scientific Reports, 7, 40816 (2017).  
DOI: `10.1038/srep40816`

**[P8]** Palmesi, P. et al.  
*Highly parallel demagnetization field calculation using the fast multipole method on tetrahedral meshes with continuous sources*.  
Journal of Magnetism and Magnetic Materials, 442, 409–416 (2017).  
DOI: `10.1016/j.jmmm.2017.06.128`

**[P9]** Abert, C.  
*Micromagnetics and spintronics: models and numerical methods*.  
European Physical Journal B, 92, 120 (2019).  
DOI: `10.1140/epjb/e2019-90599-6`

**[P10]** Hertel, R., Christophersen, S., Börm, S.  
*Large-scale magnetostatic field calculation in finite element micromagnetics with H2-matrices*.  
Journal of Magnetism and Magnetic Materials, 477, 118–123 (2019).  
DOI: `10.1016/j.jmmm.2018.12.103`

**[P11]** Bruckner, F., Ducevic, A., Heistracher, P., Abert, C., Suess, D.  
*Strayfield calculation for micromagnetic simulations using true periodic boundary conditions*.  
Scientific Reports, 11, 9202 (2021).  
DOI: `10.1038/s41598-021-88541-9`

**[P12]** Schröder, J., Reichel, M., Birk, C.  
*An efficient numerical scheme for the FE-approximation of magnetic stray fields in infinite domains*.  
Computational Mechanics, 70, 141–153 (2022).  
DOI: `10.1007/s00466-022-02162-1`

---

## 22. Jednozdaniowa rekomendacja końcowa

**Dla fullmagu zrobiłbym teraz `airbox_robin` jako pierwszy mesh-native FEM demag, ale zostawiłbym `transfer_grid_exact` jako oracle i od początku projektował interfejs tak, aby później bezboleśnie podmienić realizację na `shell_transform` albo `FEM–BEM/H2/FMM`.**
