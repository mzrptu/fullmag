# Raport weryfikacji aktualnej implementacji FEM w Fullmag
**Zakres:** ponowna kontrola najnowszej publicznej wersji repo po ostatnich poprawkach solvera FEM i siatki  
**Repozytorium:** `MateuszZelent/fullmag`  
**Cel:** sprawdzić, co zostało już wdrożone poprawnie, co nadal jest fizycznie lub architektonicznie niepoprawne, oraz które elementy nadal mogą tłumaczyć złą relaksację i brak oczekiwanego vorteksu.

---

## 1. Executive summary

## Werdykt
**Nie, nie wszystko jest jeszcze zaimplementowane poprawnie.**

Jednocześnie trzeba uczciwie powiedzieć, że w stosunku do poprzedniego audytu nastąpił **istotny postęp**. W aktualnym stanie kodu potwierdziłem kilka ważnych napraw:

- zniknął stary krytyczny błąd, w którym exchange/mass były składane wyłącznie na MFEM attribute `1`; teraz aktywne atrybuty magnetyczne są wyprowadzane z rzeczywistego `magnetic_element_mask` (`native/backends/fem/src/mfem_bridge.cpp:2337-2398`),
- poprawiono logikę włączania oddziaływań dla przypadków typu `field-only` / `Ku2-only` (`crates/fullmag-runner/src/native_fem.rs:274-329`, `native/backends/fem/src/mfem_bridge.cpp:722-726`, `792-795`),
- cubic anisotropy i bulk DMI wchodzą już do realnego `H_eff` w kroku dynamiki (`native/backends/fem/src/mfem_bridge.cpp:1683-1711`),
- poprawiono spójność znaku i energii dla uniaxial anisotropy (`native/backends/fem/src/mfem_bridge.cpp:757-768`),
- walidacja Poissona/air-box boundary conditions jest wyraźnie lepsza i przestała być całkowicie „cicha” (`native/backends/fem/src/mfem_bridge.cpp:2551-2612`),
- dodano podstawową walidację długości pól materiałowych oraz normalizację osi anizotropii (`native/backends/fem/src/context.cpp:222-260`).

To są realne, ważne naprawy.

### Ale nadal zostały poważne problemy
Najważniejsze z nich to:

1. **Nadal nie ma bezpiecznego, jawnego kontraktu regionów magnetycznych.**  
   Kod jest już spójniejszy niż wcześniej, ale obecna heurystyka „0 = air, non-zero = magnetic; all-nonzero = wszystko magnetyczne” nadal może dać złą fizykę po zmianie siatki, jeśli air/support są oznaczane niezerowymi markerami (`native/backends/fem/src/context.cpp:351-368`, `crates/fullmag-runner/src/preview.rs:315-321`, `crates/fullmag-engine/src/fem.rs:1701-1707`). To nadal jest **najmocniejszy kandydat** na źródło regresji po zmianach mesh.

2. **Thermal noise jest nadal fizycznie błędne.**  
   Pole termiczne jest generowane w ścieżce `upload_magnetization`, a krok czasowy tylko dodaje wcześniej wygenerowany bufor (`native/backends/fem/src/context.cpp:564-692`, `native/backends/fem/src/mfem_bridge.cpp:1736-1739`). To znaczy, że dla `T > 0` szum jest w praktyce „zamrożony”, a nie losowany zgodnie z czasem.

3. **Implementacja Oersteda jest semantycznie niepełna.**  
   API przyjmuje dowolną oś cylindra, ale kod liczy wyłącznie przypadek nieskończonego przewodnika wzdłuż osi `z` (`native/include/fullmag_fem.h:156-167`, `native/backends/fem/src/context.cpp:412-446`).

4. **DMI nadal nie jest zdyskretyzowane zgodnie z własnymi notatkami FEM.**  
   Znaki i włączenie do `H_eff` są poprawione, ale implementacja nadal nie realizuje weak residual + weighted mass projection opisanych w `0450` i `0470`; zamiast tego wykonuje bezpośrednie pętle elementowe i nodal averaging (`docs/physics/0450-fem-interfacial-dmi-mfem-gpu.md:124-145, 284-299`, `docs/physics/0470-fem-bulk-dmi-mfem-gpu.md:102-107, 222-258`, `native/backends/fem/src/mfem_bridge.cpp:884-1045`, `1060-1225`).

5. **Heterogeniczna wymiana (`A_field`) nadal nie jest słabą formą z poprawnym współczynnikiem przestrzennym.**  
   Operator exchange jest składany jako zwykły `DiffusionIntegrator`, a dopiero potem wynik jest skalowany lokalnym `A_i / M_{s,i}` (`native/backends/fem/src/mfem_bridge.cpp:2380-2386`, `526-574`). To nie jest równoważne poprawnej dyskretyzacji dla zmiennego `A(x)`.

6. **Warstwa obserwowalności/debug nadal nie daje pełnego obrazu tego, co solver naprawdę liczy.**  
   C ABI deklaruje nowe observables dla cubic/bulk/Oersted/thermal, ale bulk DMI readback jest nadal błędne, a wrapper Rust/UI nie wystawia kompletu nowych pól (`native/include/fullmag_fem.h:40-53`, `native/backends/fem/src/context.cpp:533-547`, `crates/fullmag-runner/src/native_fem.rs:736-769`).

### Najważniejszy praktyczny wniosek
Dla Twojego konkretnego objawu — **tekstura bez prądu, która powinna relaksować do vorteksu, a zachowuje się niefizycznie** — dziś najbardziej podejrzane są przede wszystkim:

1. **kontrakt markerów/regionów po zmianie siatki**,
2. **uruchamianie nie tego backendu, który myślisz** (fallback do CPU reference),
3. **błędna interpretacja preview/debug fields**, jeśli patrzysz na pola, które backend zwraca jako zero albo w ogóle nie eksponuje.

Błędy thermal/Oersted/DMI są realne, ale **same z siebie nie są głównym kandydatem** dla deterministycznego przypadku `T = 0`, `I = 0`, bez aktywnego DMI/Oersteda.

---

## 2. Metodologia weryfikacji

Przejrzałem aktualny stan poniższych warstw:

### Backend native FEM / MFEM
- `native/backends/fem/src/context.cpp`
- `native/backends/fem/src/mfem_bridge.cpp`
- `native/backends/fem/include/context.hpp`
- `native/include/fullmag_fem.h`

### Runtime / runner / preview
- `crates/fullmag-runner/src/native_fem.rs`
- `crates/fullmag-runner/src/dispatch.rs`
- `crates/fullmag-runner/src/preview.rs`

### CPU reference FEM
- `crates/fullmag-engine/src/fem.rs`
- `crates/fullmag-runner/src/fem_reference.rs`

### Dokumentacja fizyczna
- `docs/physics/0410-fem-exchange-demag-zeeman-mfem-gpu.md`
- `docs/physics/0450-fem-interfacial-dmi-mfem-gpu.md`
- `docs/physics/0470-fem-bulk-dmi-mfem-gpu.md`
- `docs/physics/0520-fem-robin-airbox-demag-bootstrap-reference.md`

Ocena była robiona pod kątem:

1. zgodności z wcześniejszym audytem,
2. zgodności implementacji z dokumentami fizycznymi repo,
3. spójności między native backendem, preview i CPU reference,
4. tego, co realnie może tłumaczyć Twoją obecną regresję fizyki.

---

## 3. Co jest już poprawione — potwierdzone naprawy

| Obszar | Status | Dowód | Ocena |
|---|---|---|---|
| Exchange/mass na prawidłowych atrybutach magnetycznych | **Naprawione** | `native/backends/fem/src/mfem_bridge.cpp:2337-2398` | Duży krok naprzód. Stary killer bug z hardcoded `attr=1` już nie występuje. |
| Enable logic dla uniaxial / DMI / cubic | **Naprawione** | `crates/fullmag-runner/src/native_fem.rs:274-329`, `native/backends/fem/src/mfem_bridge.cpp:722-726`, `792-795` | Dobrze. Przypadki typu `field-only` nie są już martwe. |
| Uniaxial: zgodność znak pola ↔ energia | **Naprawione** | `native/backends/fem/src/mfem_bridge.cpp:757-768` | Dobrze. Konwencja easy-axis wygląda spójnie. |
| Cubic anisotropy w `H_eff` | **Naprawione** | `native/backends/fem/src/mfem_bridge.cpp:1683-1705` | Dobrze. To wcześniej było rozjechane. |
| Bulk DMI w `H_eff` | **Naprawione częściowo** | `native/backends/fem/src/mfem_bridge.cpp:1691-1711` | Pole trafia do dynamiki, ale sama dyskretyzacja nadal jest problematyczna. |
| Walidacja boundary markerów w Poisson/air-box | **Wyraźnie poprawione** | `native/backends/fem/src/mfem_bridge.cpp:2551-2612` | Bardzo dobra zmiana. Mniej cichych katastrof. |
| Walidacja długości pól materiałowych | **Naprawione częściowo** | `native/backends/fem/src/context.cpp:222-244` | Dobre, ale nadal brakuje walidacji wartości i niektórych długości specjalnych. |
| Normalizacja osi anizotropii | **Dodane** | `native/backends/fem/src/context.cpp:247-260` | Dobre jako minimum, ale dla cubic nadal niewystarczające. |
| Wspólna heurystyka maski magnetycznej w native/preview/reference | **Poprawiona spójność wewnętrzna** | `native/backends/fem/src/context.cpp:351-368`, `crates/fullmag-runner/src/preview.rs:315-321`, `crates/fullmag-engine/src/fem.rs:1701-1707` | To poprawia spójność kodu, ale nie rozwiązuje problemu semantyki regionów. |

### Podsumowanie tej sekcji
Nie jesteś już w punkcie wyjścia. Kilka poprzednich, bardzo groźnych błędów rzeczywiście zostało usuniętych. To ważne, bo oznacza, że obecna regresja nie jest już „tym samym bugiem” co wcześniej.

---

## 4. Co nadal jest niepoprawne lub niebezpieczne

## G-01. Nadal brak jawnego kontraktu regionów magnetycznych
**Waga:** wysoka  
**Status:** nierozwiązane architektonicznie  
**Pewność:** wysoka

### Dowód w kodzie
Aktualna heurystyka w trzech warstwach jest taka sama:

- `native/backends/fem/src/context.cpp:351-368`
- `crates/fullmag-runner/src/preview.rs:315-321`
- `crates/fullmag-engine/src/fem.rs:1701-1707`

Reguła jest obecnie następująca:

- jeśli są jednocześnie `0` i `!=0`, to `0` jest air, `!=0` są magnetyczne,
- jeśli wszystkie markery są `0`, cała siatka jest traktowana jako magnetyczna,
- jeśli wszystkie markery są `!=0`, cała siatka jest traktowana jako magnetyczna.

Testy to potwierdzają:

- `crates/fullmag-runner/src/preview.rs:503-516`
- `crates/fullmag-engine/src/fem.rs:2301-2314`

Jednocześnie dokument bootstrap FEM nadal mówi coś innego:

- `docs/physics/0520-fem-robin-airbox-demag-bootstrap-reference.md:143-151`

Tam obowiązuje zasada:

- jeśli wszystkie markery są identyczne — cała siatka magnetyczna,
- jeśli markerów jest kilka i występuje marker `1`, to **marker `1` jest regionem magnetycznym**, a reszta to support/air-box.

### Co to oznacza praktycznie
Wewnętrznie kod jest dziś bardziej spójny niż wcześniej, ale **dalej jest semantycznie niebezpieczny**, bo nie ma jawnego opisu regionów magnetycznych w IR/runtime.

Najbardziej niebezpieczne przypadki po zmianie mesha:

| Markery elementów | Aktualne zachowanie | Czy to może być błędne fizycznie? |
|---|---|---|
| `[1, 0]` | `1` magnetyczne, `0` air | zwykle OK |
| `[2, 0]` | `2` magnetyczne, `0` air | teraz OK, stary bug z `attr=1` jest już naprawiony |
| `[1, 2]` | **oba regiony magnetyczne** | bardzo niebezpieczne, jeśli `2` to support/air |
| `[10, 20]` | **cała siatka magnetyczna** | bardzo niebezpieczne, jeśli jeden marker nie jest materiałem magnetycznym |
| `all zero` | cała siatka magnetyczna | semantycznie dwuznaczne |

### Dlaczego to nadal może tłumaczyć brak vorteksu
Jeżeli po poprawkach siatki air/support przestały być oznaczane zerem i np. dostały marker `2`, to aktualna logika potraktuje je jako część domeny magnetycznej. Wtedy:

- exchange działa na złej domenie,
- demag liczy inny problem niż zamierzony,
- relaksacja może zejść do stanu, który nie ma nic wspólnego z oczekiwanym układem fizycznym.

To jest nadal **najbardziej prawdopodobny kandydat** na błąd bezpośrednio związany z „po poprawkach mesha”.

### Co poprawić
1. Wprowadzić **jawny realization layer**: które regiony są magnetyczne, które są support/air, jakie mają materiały.
2. Przestać zgadywać domenę magnetyczną z samych markerów w trzech różnych warstwach.
3. Dodać twardą walidację: jeśli mesh ma kilka niezerowych markerów, a runtime nie dostał jawnej mapy regionów, to uruchomienie ma kończyć się błędem, a nie heurystyką.
4. Zsynchronizować dokument `0520` z rzeczywistym kontraktem albo odwrotnie — zmienić runtime tak, by odpowiadał dokumentacji.

---

## G-02. Nadal bardzo łatwo uruchomić nie ten backend FEM, który myślisz
**Waga:** wysoka  
**Status:** nierozwiązane operacyjnie  
**Pewność:** wysoka

### Dowód w kodzie
`crates/fullmag-runner/src/dispatch.rs:124-189` oraz `555-615` pokazują, że fallback do CPU reference nadal następuje m.in. gdy:

- są aktywne `current_modules`,
- native GPU backend jest niedostępny,
- `fe_order != 1`,
- mesh jest zbyt mały względem polityki `FULLMAG_FEM_GPU_MIN_NODES`,
- użytkownik nie wymusił GPU, a polityka jest `auto`.

Dodatkowo CPU reference przy fallbacku **ignoruje** część fizyki:

- uniaxial anisotropy,
- cubic anisotropy,
- interfacial DMI,
- bulk DMI,
- magnetoelastic,
- Oersted,
- thermal,

co jest wprost sygnalizowane w `crates/fullmag-runner/src/dispatch.rs:560-595`.

### Znaczenie praktyczne
Jeśli testujesz „nową implementację FEM”, ale runtime zjechał na CPU reference, to możesz patrzeć na wynik całkiem innego modelu fizycznego niż myślisz.

### Czy to tłumaczy Twój obecny vortex bug?
**Może, ale nie musi.**  
Jeżeli test jest prosty (`exchange + demag + Zeeman`, `T=0`, `I=0`), CPU reference powinien i tak być fizycznie bliższy oczekiwanemu wynikowi niż solver z kompletnie złą domeną magnetyczną. Dlatego fallback jest dla mnie dziś **problemem obowiązkowym do wyeliminowania**, ale nie jedynym podejrzanym.

### Co poprawić
1. Zrobić fail-closed: jeśli plan zawiera termy nieobsługiwane przez CPU reference i nie ustawiono jawnej zgody na fallback, uruchomienie ma kończyć się błędem.
2. Zapisywać resolved backend do wyników, logów, UI i artefaktów.
3. W UI pokazywać twardy badge typu: `FEM backend resolved to: cpu_reference` / `native_gpu`.

---

## G-03. Thermal noise nadal jest fizycznie zaimplementowane błędnie
**Waga:** wysoka dla `T > 0`, niska dla `T = 0`  
**Status:** nienaprawione  
**Pewność:** wysoka

### Dowód w kodzie
Generowanie `H_therm` siedzi w `context_upload_magnetization_f64`:

- `native/backends/fem/src/context.cpp:564-692`

Natomiast właściwy krok dynamiki w `compute_effective_fields_for_magnetization` tylko dodaje wcześniej istniejący bufor:

- `native/backends/fem/src/mfem_bridge.cpp:1736-1739`

Rust wrapper rozdziela te ścieżki:

- upload: `crates/fullmag-runner/src/native_fem.rs:628-643`
- step: `crates/fullmag-runner/src/native_fem.rs:514-549`

### Dlaczego to jest źle
Dla stochastycznego LLG pole termiczne powinno być generowane zgodnie z krokami czasu i wybraną interpretacją integratora. Obecny kod generuje je przy uploadzie magnetyzacji, czyli de facto:

- szum może pozostać taki sam przez wiele kroków,
- zależy od lifecycle uploadu, a nie od lifecycle steppera,
- nie odpowiada fizycznie poprawnej realizacji Brown field.

### Wpływ
Dla `T > 0` wyniki są dziś **fizycznie niewiarygodne**.

### Czy to tłumaczy Twój obecny przypadek?
Jeżeli testujesz relaksację bez prądu przy `T = 0`, to **nie** jest to główny podejrzany. Jeśli jednak temperatura nie jest zerowa, to to jest błąd wysokiej wagi.

### Co poprawić
1. Losować `H_therm` we właściwej ścieżce steppera, a nie w uploadzie.
2. Dla Heuna/stochastic Heuna zdecydować formalnie, czy w obrębie jednego kroku predictor/corrector używa tej samej realizacji szumu.
3. Przy adaptive stepping zdefiniować regułę dla rejected steps, żeby nie łamać statystyki procesu.

---

## G-04. Oersted ma niespójne API i niepoprawną obsługę czasu
**Waga:** średnio-wysoka  
**Status:** nienaprawione  
**Pewność:** wysoka

### Część A — oś cylindra jest ignorowana
API przyjmuje:

- `oersted_center[3]`
- `oersted_axis[3]`

co widać w:

- `native/include/fullmag_fem.h:156-167`
- `crates/fullmag-runner/src/native_fem.rs:418-428`

Ale sama implementacja w:

- `native/backends/fem/src/context.cpp:412-446`

liczy pole wyłącznie z różnic `dx, dy` w płaszczyźnie `xy` i ustawia składową `z` na zero. `oersted_axis` nie bierze udziału w obliczeniu.

### Część B — wymuszenie czasowe nie jest stage-time aware
Skalowanie `I(t)` korzysta z `ctx.current_time`:

- `native/backends/fem/src/mfem_bridge.cpp:1714-1733`

ale explicit RK/Heun ocenia RHS dla wielu stage’y bez przekazywania czasu stage’owego:

- `native/backends/fem/src/mfem_bridge.cpp:2819-2965`
- `native/backends/fem/src/mfem_bridge.cpp:3150-3355`

`ctx.current_time` jest aktualizowane dopiero po zaakceptowanym kroku.

### Dlaczego to jest źle
To oznacza, że w ramach jednego kroku wszystkie stage’e widzą to samo `t_n`, a nie `t_n + c_s dt`. Dla forcingu sinusoidalnego/pulsowego jest to formalnie niepoprawne.

### Czy to tłumaczy brak vorteksu bez prądu?
Nie, jeśli `I = 0` i Oersted jest wyłączony. To jest problem realny, ale nie główny kandydat dla Twojego deterministycznego testu bez prądu.

### Co poprawić
1. Albo natychmiast ograniczyć API do cylindra wzdłuż `z` i rzucać błąd dla innej osi,
2. albo zaimplementować ogólną geometrię cylindra z osią dowolną w przestrzeni.
3. Do RHS przekazywać czas stage’owy `t_stage = t_n + c_s dt`.

---

## G-05. DMI nadal nie odpowiada opisanej w repo metodzie FEM
**Waga:** wysoka dla runów z DMI  
**Status:** nienaprawione metodycznie  
**Pewność:** wysoka

### Dowód w dokumentacji
Dla interfacial DMI repo jasno mówi, że podstawowym obiektem FEM powinien być weak residual, a pole ma być odzyskiwane przez weighted mass projection:

- `docs/physics/0450-fem-interfacial-dmi-mfem-gpu.md:124-145`
- `docs/physics/0450-fem-interfacial-dmi-mfem-gpu.md:284-299`

Dla bulk DMI repo mówi to samo:

- `docs/physics/0470-fem-bulk-dmi-mfem-gpu.md:102-107`
- `docs/physics/0470-fem-bulk-dmi-mfem-gpu.md:222-258`

### Dowód w implementacji
Obecna implementacja:

- `native/backends/fem/src/mfem_bridge.cpp:884-1045` — interfacial DMI,
- `native/backends/fem/src/mfem_bridge.cpp:1060-1225` — bulk DMI,

robi bezpośrednie pętle po elementach i punktach całkowania, oblicza strong-form style pochodne, a następnie uśrednia wynik nodalnie przez akumulację wag i normalizację (`1032-1040`, `1210-1214`).

### Problem
To **nie jest** ta metoda, którą własna dokumentacja repo wskazuje jako poprawny obiekt FEM.

Konsekwencje:

- naturalne warunki brzegowe DMI nie są reprezentowane w sposób wynikający z residualu,
- zgodność energia ↔ pole ↔ residual nie jest gwarantowana,
- diagnostyka „DMI działa / nie działa” może być myląca, bo znak i obecność w `H_eff` są już poprawione, ale sama dyskretyzacja nadal jest przybliżona heurystycznie.

### Co poprawić
1. Zaimplementować residual `R(m; v)` zgodnie z notatkami `0450` i `0470`.
2. Odtwarzać pole przez `M_{μ0 M_s} H = -g`.
3. Utrzymać możliwość projekcji lumped-mass dla explicit RK, ale jako świadomy wybór w ramach tej samej słabej formy.

### Czy to tłumaczy Twój obecny vortex case?
Tylko wtedy, gdy DMI jest faktycznie włączone. Jeżeli test bez prądu jest też bez DMI, to nie jest to główny kandydat na obecną regresję.

---

## G-06. Heterogeniczna wymiana (`A_field`) nadal nie jest wariacyjnie poprawna
**Waga:** średnia-wysoka przy `A_field`  
**Status:** nienaprawione  
**Pewność:** wysoka

### Dowód w kodzie
Operator exchange jest składany jako zwykły diffusion operator:

- `native/backends/fem/src/mfem_bridge.cpp:2380-2386`

Następnie wynik jest lokalnie skalowany przez `A_i / M_{s,i}`:

- `native/backends/fem/src/mfem_bridge.cpp:526-574`

### Problem
Dla przestrzennie zmiennego `A(x)` poprawny exchange field ma formę z `∇·(A ∇m)`, a nie postać „najpierw Laplasjan, potem lokalne mnożenie”. Obecny kod jest poprawny tylko dla przypadku jednorodnego `A` albo jako przybliżenie bootstrapowe.

### Wpływ
Jeżeli używasz `A_field`, zwłaszcza na granicach materiałów lub warstw, exchange jest nadal podejrzane fizycznie.

### Co poprawić
1. Złożyć operator z odpowiednim spatial coefficient w weak form.
2. Jeśli `M_s` też jest zmienne, zdecydować formalnie, jak reprezentujesz pole efektywne i gdzie dokładnie stoi `1/M_s` w dyskretyzacji.
3. Dodać test interfejsu materiałowego z analitycznym / referencyjnym zachowaniem.

### Czy to tłumaczy Twój obecny przypadek?
Tylko wtedy, gdy używasz przestrzennie zmiennego `A_field`. Przy jednorodnym materiale to raczej nie jest główny podejrzany.

---

## G-07. Observables i preview nadal nie pokazują pełnej prawdy o solverze
**Waga:** średnia  
**Status:** nienaprawione  
**Pewność:** wysoka

### Co jest nie tak
#### 1. C ABI deklaruje więcej pól niż wrapper realnie wystawia
Nowe observables istnieją w C ABI:

- `native/include/fullmag_fem.h:40-53`

Ale wrapper Rust/UI nadal wystawia tylko część z nich:

- `crates/fullmag-runner/src/native_fem.rs:736-769`

Brakuje osobnych ścieżek dla:

- `H_ani_cubic`,
- `H_dmi_bulk`,
- `H_oe`,
- `H_therm`.

#### 2. Bulk DMI observable nadal jest błędne
W `context_copy_field_f64`:

- `native/backends/fem/src/context.cpp:537-541`

`FULLMAG_FEM_OBSERVABLE_H_DMI_BULK` zwraca `ctx.h_dmi_xyz`, a nie osobny bufor bulk DMI. Komentarz TODO to wprost przyznaje.

#### 3. Nieobliczone pole zwraca zero zamiast twardej informacji diagnostycznej
`native/backends/fem/src/context.cpp:554-557` zwraca zera, gdy dane pole nie istnieje lub nie zostało policzone.

### Dlaczego to jest ważne
To nie musi psuć samej dynamiki, ale bardzo łatwo psuje debugowanie. Możesz patrzeć na czarne/zerowe strzałki i wyciągać wniosek „solver liczy zero”, podczas gdy w praktyce:

- patrzysz na niewystawione pole,
- patrzysz na placeholder zero,
- albo patrzysz na pole tylko częściowo reprezentowane.

### Co poprawić
1. Dodać brakujący osobny bufor kontekstowy dla `h_bulk_dmi_xyz` i konsekwentnie używać już istniejących ścieżek dla `h_oe_xyz` oraz `h_therm_xyz`.
2. Wystawić wszystkie observables w Rust wrapperze i UI.
3. Dla nieobliczonych pól zwracać jawny status diagnostyczny zamiast cichego zera.

### Czy to może tłumaczyć „czarne strzałki”?
**Tak — jako problem diagnostyczny / preview.**  
Nie musi tłumaczyć złej dynamiki, ale może tłumaczyć, dlaczego obraz debugowy wygląda jakby wszystko było wyzerowane.

---

## G-08. Cubic anisotropy ma zbyt słabą walidację osi
**Waga:** średnia  
**Status:** nienaprawione  
**Pewność:** wysoka

### Dowód w kodzie
`native/backends/fem/src/context.cpp:247-260` normalizuje `cubic_axis1` i `cubic_axis2`, ale nie sprawdza ich ortogonalności.

W `native/backends/fem/src/mfem_bridge.cpp:802-807` trzecia oś jest budowana jako `c3 = c1 × c2`, bez dodatkowej normalizacji i bez walidacji przypadku prawie współliniowego.

### Problem
Jeśli użytkownik poda osie nieortogonalne albo prawie współliniowe, solver nie zgłasza błędu, tylko liczy z geometrią osi, która nie odpowiada poprawnej bazie krystalograficznej.

### Co poprawić
1. Albo robić Gram-Schmidt + renormalizację,
2. albo rzucać błąd, gdy `|c1 × c2|` jest za małe lub `|c1 · c2|` za duże.

### Czy to tłumaczy Twój przypadek?
Tylko jeśli używasz cubic anisotropy z niestandardowymi osiami. Dla domyślnych osi nie jest to główny podejrzany.

---

## G-09. Magnetoelastic ma nadal lukę walidacyjną w C ABI
**Waga:** średnia  
**Status:** częściowo nienaprawione  
**Pewność:** wysoka

### Dowód w kodzie
Plan C ABI przewiduje dwa warianty:

- uniform strain: `6` wartości,
- per-node strain: `6 * n_nodes`,

co widać w `native/include/fullmag_fem.h:172-178`.

Ale `native/backends/fem/src/context.cpp:463-466` kopiuje `mel_strain_voigt` bez walidacji długości, a `native/backends/fem/src/context.cpp:767-771` później zakłada, że dane są albo `6`, albo `6*n_nodes`.

### Dodatkowa uwaga
Aktualny wrapper Rust i tak przekazuje tylko wariant uniform:

- `crates/fullmag-runner/src/native_fem.rs:430-474`

więc dziś problem nie musi być aktywny w Twojej ścieżce Python → Rust. Ale sam backend natywny nadal ma tu niezamkniętą lukę.

### Co poprawić
Dodać twardą walidację:

- jeśli `mel_uniform_strain = 1`, długość ma być dokładnie `6`,
- jeśli `mel_uniform_strain = 0`, długość ma być dokładnie `6 * n_nodes`.

---

## G-10. Native stepper nadal odmawia pracy bez exchange/demag
**Waga:** średnia  
**Status:** nienaprawione  
**Pewność:** wysoka

### Dowód w kodzie
`native/backends/fem/src/mfem_bridge.cpp:2759-2760`, `2833-2835`, `3156-3157` nadal wymagają, by włączone było co najmniej exchange lub demag.

### Problem
To blokuje scenariusze typu:

- pure Zeeman,
- pure anisotropy,
- pure DMI,
- czysto termiczne testy bootstrapowe,

mimo że część tych termów jest już implementowana.

### Ocena
To nie jest dziś główny root cause Twojej regresji, ale pokazuje, że solver nadal nie jest domknięty jako ogólny backend FEM.

---

## G-11. Nadal brakuje twardej walidacji wartości materiałowych
**Waga:** średnia  
**Status:** nienaprawione  
**Pewność:** wysoka

### Dowód w kodzie
Masz już walidację długości pól (`context.cpp:222-244`), ale nadal nie ma walidacji typu:

- `Ms > 0` na wszystkich węzłach magnetycznych,
- `A >= 0`,
- `alpha >= 0`,
- brak `NaN` / `Inf`.

Jednocześnie kilka jąder dzieli przez `Ms_i` bez ochrony:

- uniaxial: `native/backends/fem/src/mfem_bridge.cpp:748-749`,
- cubic: `824-827`,
- interfacial DMI: `972`,
- bulk DMI: `1140`.

### Problem
Jedna zła wartość w polu materiałowym może dać lokalne `Inf/NaN` i bardzo trudne do debugowania objawy.

### Co poprawić
Walidować wszystkie pola materiałowe na wejściu przed inicjalizacją backendu i failować twardo przy wartościach niepoprawnych.

---

## 5. Co dziś jest najbardziej prawdopodobnym źródłem Twojej obecnej regresji

## Ranking podejrzanych przy `T = 0`, `I = 0`, relaksacja do vorteksu

### 1. Błędna interpretacja regionów po zmianie siatki
To nadal jest numer jeden.  
Jeżeli nowe meshe nie kodują air/support przez marker `0`, tylko np. używają kilku niezerowych markerów, obecna heurystyka wciągnie te regiony do domeny magnetycznej.

### 2. Uruchamiasz inny backend niż myślisz
Fallback do CPU reference lub innego resolved runtime musi zostać wykluczony natychmiast. Bez tego nie wiadomo, który solver w ogóle oceniasz.

### 3. Preview / observables wprowadzają Cię w błąd
Jeśli patrzysz na pole niewystawione albo zero-placeholder, możesz interpretować objaw jako „solver policzył zero”, chociaż problem jest w warstwie debugowej.

### 4. Dopiero potem: DMI / Oersted / thermal / `A_field`
To są realne błędy, ale tylko wtedy, gdy te termy są faktycznie aktywne.

---

## 6. Co dziś można uznać za względnie wiarygodne, a czego jeszcze nie

| Scenariusz | Ocena zaufania |
|---|---|
| `T=0`, `I=0`, jednorodny materiał, bez DMI, bez `A_field`, bez cubic, mesh z jednoznacznym `0=air`, native backend naprawdę uruchomiony | **Średnie** |
| Jak wyżej, ale mesh ma kilka niezerowych markerów i brak jawnej mapy regionów | **Niskie** |
| Run z `T > 0` | **Niskie** |
| Run z Oersted i osią inną niż `z` | **Niskie** |
| Run z time-dependent Oersted | **Niskie** |
| Run z DMI | **Niskie–średnie** (znaki/H_eff poprawione, ale metoda FEM nadal niezgodna z notatkami) |
| Run z heterogenicznym `A_field` | **Niskie** |

---

## 7. Minimalny zestaw eksperymentów diagnostycznych, który teraz zrobiłbym jako pierwszy

## E-01. Twarde potwierdzenie resolved backendu
Dla każdego uruchomienia zapisz do wyniku:

- resolved engine,
- czy uruchomiono `native_gpu` czy `cpu_reference`,
- device info,
- fallback reason, jeśli wystąpił.

Bez tego nie da się sensownie interpretować regresji.

## E-02. Test markerów na tej samej geometrii
Uruchom dokładnie ten sam prosty przypadek relaksacji dla trzech wersji markerów:

1. `[1,0]`,
2. `[2,0]`,
3. `[1,2]`.

Jeżeli `1/0` i `2/0` działają podobnie, a `1/2` psuje fizykę, to masz praktycznie potwierdzony problem semantyki regionów.

## E-03. Dump resolved magnetic domain
Na starcie solvera wypisz:

- histogram markerów elementów,
- histogram aktywnych MFEM attributes,
- liczbę aktywnych elementów magnetycznych,
- liczbę aktywnych węzłów magnetycznych,
- liczbę węzłów z dodatnią lumped mass.

To powinno być artefaktem lub metadanymi runu, nie tylko debug printem.

## E-04. Deterministyczny benchmark referencyjny
Uruchom cienki dysk / prosty element, `T=0`, `I=0`, bez anisotropii i bez DMI, z tą samą siatką i tym samym stanem początkowym:

- native FEM,
- CPU reference FEM,
- ewentualnie FDM referencyjnie.

Porównaj:

- energię exchange,
- energię demag,
- końcowy stan magnetyzacji,
- pozycję i typ minimum.

## E-05. Jeśli używasz DMI albo `A_field`
Wydziel osobne testy dla tych termów. Nie mieszaj ich teraz z podstawową diagnozą vorteksu po zmianie mesha.

---

## 8. Zalecana kolejność dalszych poprawek

1. **Jawny kontrakt regionów/material realization** — to jest dziś najważniejsze.
2. **Fail-closed runtime selection + pełne provenance backendu**.
3. **Poprawa observables/debug path**, żebyś widział prawdziwe pola składowe solvera.
4. **Thermal noise we właściwym lifecycle steppera**.
5. **Oersted: oś + stage-time aware forcing**.
6. **DMI jako weak residual + mass projection**.
7. **Exchange dla zmiennego `A(x)`**.
8. **Walidacje wartości materiałowych i geometrii osi**.

---

## 9. Finalny wniosek

### Co jest dobrą wiadomością
Aktualny solver FEM jest **wyraźnie lepszy** niż w poprzednim audycie. Kilka starych, bardzo groźnych błędów rzeczywiście zostało naprawionych.

### Co jest złą wiadomością
On nadal **nie jest jeszcze fizycznie domknięty** jako solver, któremu można bezwarunkowo ufać w całym zakresie funkcji. Najważniejsze problemy, które zostały, to:

- brak jawnego kontraktu regionów magnetycznych po zmianach siatki,
- bardzo niebezpieczny fallback/runtime ambiguity,
- niepoprawny thermal lifecycle,
- niepełna implementacja Oersteda,
- DMI nadal niespójne z własną metodą FEM repo,
- błędna metoda dla heterogenicznego `A_field`,
- niepełna obserwowalność pól.

### Najkrótsza, praktyczna odpowiedź
**Nie wygląda na to, żeby „wszystko było już dobrze zaimplementowane”.**  
Wygląda raczej na to, że część krytycznych błędów już zamknąłeś, ale nadal zostały elementy, które mogą zarówno psuć fizykę, jak i bardzo utrudniać wiarygodne debugowanie.

Dla Twojego bieżącego problemu z vorteksem po zmianach siatki najpierw uderzałbym w:

1. marker/region semantics,  
2. resolved backend provenance,  
3. pełny dump aktywnej domeny magnetycznej i składowych `H_eff`.

Dopiero potem schodziłbym głębiej w DMI/Oersted/thermal.

