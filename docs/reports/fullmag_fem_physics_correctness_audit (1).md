
# Audyt poprawności fizycznej solvera FEM w Fullmag
**Zakres:** backend FEM native/MFEM, CPU reference FEM, runner/dispatch, preview/runtime contract  
**Repozytorium:** `MateuszZelent/fullmag`  
**Cel audytu:** wyjaśnić, dlaczego po ostatnich zmianach siatki relaksacja wygląda niefizycznie, dlaczego tekstura bez prądu nie schodzi do oczekiwanego vorteksu oraz sprawdzić, czy oddziaływania FEM są zaimplementowane poprawnie.

---

## 1. Executive summary

### Najważniejszy wniosek
**Najbardziej prawdopodobną przyczyną Twojego obecnego błędu jest rozjazd kontraktu regionów/markerów po zmianach siatki.**  
W aktualnym kodzie:

- **CPU/reference FEM** traktuje w wielu miejscach *wszystkie niezerowe markery* jako magnetyczne albo – gdy markery są jednorodne – traktuje *całą siatkę jako magnetyczną* (`crates/fullmag-engine/src/fem.rs:1470-1477`).
- **Preview/UI** uznaje za aktywne magnetycznie tylko elementy z markerem `!= 0` (`crates/fullmag-runner/src/preview.rs:282-303`).
- **Native FEM / MFEM**:
  - buduje lokalny `magnetic_element_mask` wg własnej heurystyki (`native/backends/fem/src/context.cpp:309-340`),
  - ale **samą macierz wymiany i masę składa wyłącznie na atrybucie MFEM = 1** (`native/backends/fem/src/mfem_bridge.cpp:2274-2290`),
  - a podczas importu siatki **marker 0 mapuje na atrybut MFEM 2**, marker 1 na atrybut 1, a każdy inny marker pozostaje „jak jest” (`native/backends/fem/src/mfem_bridge.cpp:2215-2223`).

To oznacza, że po zmianie markerów siatki wystarczy jeden z poniższych przypadków, aby natywny solver FEM liczył błędną fizykę albo wręcz zgubił całe oddziaływanie wymiany:

- wszystkie elementy mają marker `0`,
- wszystkie elementy mają marker `2` / `5` / inny `!= 1`,
- siatka ma marker magnetyczny różny od `1`,
- siatka ma wiele regionów, ale tylko jedna część kodu rozumie, które regiony są magnetyczne.

W takich scenariuszach **native MFEM może zbudować pustą albo prawie pustą macierz wymiany/masy**, podczas gdy CPU reference i preview nadal uznają tę samą siatkę za magnetyczną. To jest dokładnie ten typ awarii, który daje:
- niefizyczną relaksację,
- „dziwne” dochodzenie do stanu końcowego,
- czarne / nieaktywne / zerowe strzałki w preview,
- pozornie jednoczesne zepsucie kilku warstw naraz.

### Drugi bardzo ważny wniosek
Nawet gdy markerów nie dotykałeś, **native FEM nie składa do faktycznego `H_eff` wszystkich oddziaływań, które API i statystyki sugerują jako „zaimplementowane”**. W szczególności:
- **cubic anisotropy** jest liczona do energii/statystyk, ale nie jest dodawana do rzeczywistego `H_eff`,
- **bulk DMI** jest liczona do energii/statystyk, ale nie jest dodawana do rzeczywistego `H_eff`,
- **Oersted** i **thermal noise** nie są częścią realnego kroku czasowego; są dokładane tylko w ścieżce uploadu magnetyzacji, a nie w właściwym steperze (`native/backends/fem/src/context.cpp:522-627`, `native/backends/fem/src/mfem_bridge.cpp:1600-1699`, `1715-1759`).

### Trzeci ważny wniosek
**Fallback do CPU reference FEM może całkowicie zmienić model fizyczny**. CPU reference runner sam deklaruje, że wykonuje tylko:
- `Exchange`,
- opcjonalny bootstrap `Demag`,
- opcjonalny `Zeeman`,
- `LLG(heun)`,

czyli bez anisotropii, DMI, cubic anisotropy, magnetoelastic, thermal, Oersted itd. (`crates/fullmag-runner/src/fem_reference.rs:1-7`, `140-145`).  
Jeżeli więc uruchomienie zeszło z native FEM GPU/CPU do CPU reference, to mogłeś nie testować „tego samego” solvera fizycznie.

---

## 2. Metodologia audytu

Przejrzałem i porównałem:

### Ścieżki wykonania
- `crates/fullmag-runner/src/dispatch.rs`
- `crates/fullmag-runner/src/native_fem.rs`
- `crates/fullmag-runner/src/fem_reference.rs`
- `crates/fullmag-runner/src/preview.rs`

### Rdzeń fizyki FEM
- `native/backends/fem/src/context.cpp`
- `native/backends/fem/src/mfem_bridge.cpp`
- `native/backends/fem/src/api.cpp`
- `native/backends/fem/include/context.hpp`
- `native/include/fullmag_fem.h`

### CPU/reference FEM
- `crates/fullmag-engine/src/fem.rs`
- `crates/fullmag-engine/src/lib.rs`
- `crates/fullmag-engine/src/magnetoelastic.rs`

### Specyfikacje / notatki fizyczne
- `docs/physics/0410-fem-exchange-demag-zeeman-mfem-gpu.md`
- `docs/physics/0430-fem-dipolar-demag-mfem-gpu-foundations.md`
- `docs/physics/0450-fem-interfacial-dmi-mfem-gpu.md`
- `docs/physics/0470-fem-bulk-dmi-mfem-gpu.md`
- `docs/physics/0520-fem-robin-airbox-demag-bootstrap-reference.md`
- `docs/physics/0720-fem-magnetoelastic-small-strain-mfem-gpu.md`

Analiza była prowadzona pod kątem:
1. **zgodności między deklarowaną a faktyczną fizyką**,  
2. **spójności między backendami**,  
3. **zgodności pola efektywnego i energii**,  
4. **wrażliwości na zmiany siatki / markerów / pól materiałowych**,  
5. **prawdopodobieństwa wytłumaczenia Twojego objawu**.

---

## 3. Diagnoza najbardziej prawdopodobnej przyczyny Twojego aktualnego problemu

### 3.1. Dlaczego po zmianach siatki właśnie markery są podejrzane
Z punktu widzenia kodu, po zmianie siatki wystarczy jedna z następujących zmian, aby solver zaczął zachowywać się „jakby wszystko było zepsute naraz”:

1. **magnetyczny region nie ma już markera `1`, tylko np. `2`;**
2. **importer siatki nie zapisuje markerów i wszystkie elementy lądują jako `0`;**
3. **regiony pomocnicze / air-box / support przeszły z `0` na `99` lub inny niezerowy marker;**
4. **różne warstwy pipeline’u wciąż zgadują region magnetyczny na podstawie różnych heurystyk.**

Wtedy:
- preview może uznać część siatki za nieaktywną albo przeciwnie: za magnetyczną, choć solver jej tak nie traktuje,
- native exchange/mass może zostać złożony na pustym zbiorze elementów,
- DMI/demag mogą używać innego `magnetic mask` niż wymiana,
- CPU reference może dawać inny wynik niż native,
- a w przypadku fallbacku do CPU reference dodatkowo tracisz część oddziaływań.

### 3.2. Tabela prawdy dla markerów – obecne zachowanie
| Przypadek markerów elementów | CPU/reference mask | Preview active mask | Native `magnetic_element_mask` | Native MFEM exchange/mass | Konsekwencja |
|---|---|---|---|---|---|
| brak markerów / wszystkie `0` | **cała siatka magnetyczna** | **nic nieaktywne** (`0 => inactive`) | **cała siatka magnetyczna** | **zero elementów** (0 → attr2, składanie tylko na attr1) | ekstremalnie zły i bardzo prawdopodobny przypadek po zmianie siatki |
| wszystkie `1` | cała siatka magnetyczna | aktywna | cała siatka magnetyczna | działa | jedyny naprawdę spójny bootstrap case |
| wszystkie `2` | cała siatka magnetyczna | aktywna | cała siatka magnetyczna | **zero elementów** (attr2, składanie tylko na attr1) | wymiana/masa znikają |
| mieszane `1` + `0` | marker `!=0` magnetyczny | marker `!=0` aktywny | marker `1` magnetyczny | attr1 | względnie spójne |
| mieszane `1` + `99` | **wszystko magnetyczne** (bo nie ma zera) | **wszystko aktywne** | tylko marker `1` magnetyczny | tylko attr1 | backendy liczą inne domeny |
| mieszane `2` + `0` | marker `2` magnetyczny | marker `2` aktywny | **wszystko magnetyczne** | **attr2 tylko → brak attr1** | krytyczna niespójność |
| mieszane `2` + `99` | **wszystko magnetyczne** | **wszystko aktywne** | **wszystko magnetyczne** | brak sensownego podziału, exchange/mass nie na właściwym regionie | krytyczna niespójność |

### 3.3. Ocena prawdopodobieństwa
Dla Twojego opisu („po poprawkach mesh”, „vortex nie powstaje”, „dziwna relaksacja”, „wszystkie strzałki czarne”) **to jest najbardziej prawdopodobny root cause nr 1**.

---

## 4. Zbiorcza lista ustaleń

| ID | Waga | Pewność | Obszar | Tytuł |
|---|---|---:|---|---|
| F-01 | **Krytyczna** | **Wysoka** | Region contract | Natywny FEM hardcoduje atrybut magnetyczny = 1 i może wyzerować wymianę/masę po zmianie markerów |
| F-02 | **Krytyczna** | **Wysoka** | Backend consistency | CPU/reference, native i preview używają różnych reguł wykrywania regionu magnetycznego |
| F-03 | **Krytyczna** | **Wysoka** | Effective field | `H_eff` w native FEM nie zawiera wszystkich „zaimplementowanych” oddziaływań |
| F-04 | **Krytyczna** | **Wysoka** | Runtime model | Fallback do CPU reference może cicho zmienić model fizyczny |
| F-05 | **Wysoka** | **Wysoka** | Term enable logic | Ku2-only, field-only Ku/DMI/cubic są realnie martwe lub częściowo martwe |
| F-06 | **Wysoka** | **Wysoka** | Anisotropy | Uniaxial anisotropy ma niespójność pole↔energia; dodatni Ku opisuje inną fizykę w dynamice i inną w diagnostyce |
| F-07 | **Wysoka** | **Wysoka** | DMI | Bulk DMI ma zły znak względem specyfikacji i i tak nie trafia do dynamiki |
| F-08 | **Wysoka** | **Wysoka** | DMI FEM formulation | DMI nie jest zaimplementowane jako weak residual / mass projection zgodnie ze specyfikacją |
| F-09 | **Wysoka** | **Wysoka** | Oersted / thermal | Oersted i thermal nie uczestniczą w realnym kroku czasowym |
| F-10 | **Wysoka** | **Wysoka** | Exchange heterogeneity | Zmienny przestrzennie `A_field` nie jest dyskretyzowany wariacyjnie poprawnie |
| F-11 | **Wysoka** | **Wysoka** | Demag BC | Walidacja boundary markerów w Poisson/airbox jest niebezpiecznie słaba |
| F-12 | **Średnia** | **Wysoka** | Outputs | Obserwowalne `H_ani`, `H_dmi`, `H_eff` są niekompletne lub mylące |
| F-13 | **Średnia** | **Wysoka** | Preview | CPU/reference preview dla `H_ani` i `H_dmi` zwraca faktycznie magnetyzację |
| F-14 | **Średnia** | **Wysoka** | Robustness | Brakuje walidacji długości pól materiałowych / strain oraz normalizacji osi |
| F-15 | **Średnia** | **Średnia** | Demag recovery | Recovery `H_demag` przez nodal averaging nie odpowiada zalecanej ścieżce quadrature/L2 projection |

---

## 5. Ustalenia szczegółowe

---

## F-01. Natywny FEM hardcoduje atrybut magnetyczny = 1 i po zmianie markerów może wyzerować wymianę/masę

### Dowód w kodzie
1. Import siatki do MFEM:
- `native/backends/fem/src/mfem_bridge.cpp:2215-2223`

```cpp
// MFEM attributes must be >= 1.  Our markers: 1 = magnetic, 0 = air.
// Map: marker 0 -> attr 2 (air), marker 1 -> attr 1 (magnetic).
// Any other marker m -> attr m (unchanged, already >= 1).
int attr = 1;
if (!ctx.element_markers.empty()) {
    const uint32_t marker = ctx.element_markers[...];
    attr = marker == 0u ? 2 : static_cast<int>(marker);
}
mesh->AddTet(vi, attr);
```

2. Składanie exchange/mass:
- `native/backends/fem/src/mfem_bridge.cpp:2274-2290`

```cpp
// ... restrict exchange/mass assembly to magnetic elements only (MFEM attribute 1)
mfem::Array<int> magnetic_attr_marker(max_attr);
magnetic_attr_marker = 0;
magnetic_attr_marker[0] = 1;
exchange_form->AddDomainIntegrator(new mfem::DiffusionIntegrator(), magnetic_attr_marker);
mass_form->AddDomainIntegrator(new mfem::MassIntegrator(), magnetic_attr_marker);
```

### Co jest fizycznie / architektonicznie złe
Jeżeli magnetyczny region nie ma markera `1`, tylko np. `2`, to:
- elementy dostają atrybut MFEM `2`,
- ale exchange/mass są składane **wyłącznie na attr=1**,
- więc **wymiana i masa mogą zostać złożone na pustym zbiorze elementów**.

To samo dotyczy:
- siatek bez markerów (domyślnie w native wypełniane zerami),
- siatek „all zero”,
- siatek single-region z markerem różnym od `1`.

### Objawy
- `H_ex` bliskie zeru mimo poprawnej geometrii i `A > 0`,
- relaksacja bez oczekiwanego wygładzenia tekstury,
- brak formowania vorteksu albo jego szybki rozpad,
- „dziwne” zachowanie, gdy demag jeszcze działa, ale exchange nie.

### Dlaczego to tłumaczy Twój przypadek
Vortex w cienkim elementarnym układzie bez prądu zwykle powstaje z konkurencji **exchange + demag**.  
Jeżeli po zmianie siatki exchange znika albo działa na złej domenie, relaksacja staje się natychmiast niefizyczna.

### Zalecana naprawa
#### Naprawa minimalna
- przestać hardcodować `attribute 1`,
- zbudować `mfem::Array<int> magnetic_attr_marker` z **rzeczywiście aktywnych atrybutów magnetycznych**.

#### Naprawa poprawna architektonicznie
- planner powinien produkować **jawny kontrakt region/material realization** (zgodnie ze spec: `docs/physics/0410-fem-exchange-demag-zeeman-mfem-gpu.md:551-559`),
- do backendów i preview trzeba przekazywać **gotowy boolean mask / set regionów magnetycznych**, a nie zgadywać go trzy razy.

#### Twarde walidacje, które muszą dojść
Przy starcie native FEM należy logować i walidować:
- histogram `element_markers`,
- histogram MFEM attributes,
- liczbę aktywnych elementów magnetycznych,
- liczbę węzłów z `lumped_mass > 0`,
- liczbę niezerowych wierszy macierzy exchange.

Jeżeli `enable_exchange == true`, a `magnetic_attr_marker` daje 0 aktywnych elementów:
- **natychmiastowy błąd**, nie fallback i nie cicha kontynuacja.

### Test regresyjny
Dodać fixture tests dla siatek:
- all markers `1`,
- all markers `0`,
- all markers `2`,
- mixed `1/0`,
- mixed `2/0`,
- mixed `1/99`,
- mixed `2/99`.

Dla każdej:
- porównać `active magnetic elements`,
- `nonzero lumped mass nodes`,
- normę `H_ex`,
- zgodność między preview / native / CPU reference.

---

## F-02. CPU/reference, native i preview używają różnych reguł wykrywania domeny magnetycznej

### Dowód w kodzie
#### CPU/reference FEM
- `crates/fullmag-engine/src/fem.rs:1470-1477`

```rust
fn magnetic_element_mask_from_markers(markers: &[u32]) -> Vec<bool> {
    let has_air = markers.iter().any(|&marker| marker == 0);
    let has_magnetic = markers.iter().any(|&marker| marker != 0);
    if has_air && has_magnetic {
        markers.iter().map(|&marker| marker != 0).collect()
    } else {
        vec![true; markers.len()]
    }
}
```

#### Preview/UI
- `crates/fullmag-runner/src/preview.rs:282-303`

Preview aktywuje tylko elementy z markerem `!= 0`.

#### Native local mask
- `native/backends/fem/src/context.cpp:309-340`

Native uznaje marker `1` za magnetyczny tylko wtedy, gdy marker `1` współistnieje z innymi; w pozostałych przypadkach zostawia **całą siatkę magnetyczną**.

#### Dokumentacja bootstrap contract
- `docs/physics/0520-fem-robin-airbox-demag-bootstrap-reference.md:141-150`

Dokument mówi:
- jeśli wszystkie markery identyczne → cała siatka magnetyczna,
- jeśli marker `1` jest obecny w mesh z wieloma markerami → `1` jest regionem magnetycznym.

### Problem
Nie ma jednego kontraktu. Są co najmniej **cztery różne kontrakty**:
1. CPU reference,
2. preview,
3. native local mask,
4. native MFEM assembly.

### Skutek
- te same dane wejściowe są interpretowane inaczej przez różne warstwy,
- ten sam run może mieć inne „magnetic domain” w preview, exchange, demag i CPU fallbacku,
- debugowanie „na oko” staje się praktycznie niemożliwe.

### Zalecana naprawa
- jeden wspólny moduł `resolved_region_contract`,
- jedna struktura np.:
  - `magnetic_element_mask: Vec<bool>`,
  - `magnetic_node_mask: Vec<bool>`,
  - `magnetic_region_ids: Vec<u32>`,
  - `support_region_ids: Vec<u32>`,
  - `outer_boundary_marker: Option<u32>`.
- preview, CPU reference i native mają korzystać z **tej samej pre-resolved semantyki**.

### Ocena
To nie jest drobny bug; to jest **błąd warstwy semantycznej**.

---

## F-03. `H_eff` w native FEM nie zawiera wszystkich oddziaływań, które API/statystyki sugerują jako obecne

### Dowód w kodzie
#### Faktyczne składanie `H_eff`
- `native/backends/fem/src/mfem_bridge.cpp:1600-1699`

Do `H_eff` trafiają:
- exchange,
- demag,
- external uniform field,
- uniaxial anisotropy,
- interfacial DMI,
- magnetoelastic.

Nie trafiają:
- cubic anisotropy,
- bulk DMI,
- Oersted,
- thermal noise.

#### Statystyki energii
- `native/backends/fem/src/mfem_bridge.cpp:1723-1758`

Do energii/statystyk trafiają:
- uniaxial anisotropy,
- cubic anisotropy,
- interfacial DMI,
- bulk DMI,
- magnetoelastic.

### Problem
Masz sytuację:
- **to, co raportuje energia**, nie jest tym samym,
- co faktycznie działa w dynamice LLG.

To jest krytyczny błąd, bo:
- relaksacja zachodzi po innym `H_eff` niż to, które sugerują logi/statystyki,
- nie można ufać raportowanemu `E_total`,
- porównania CPU/GPU/FDM/FEM stają się mylące.

### Zalecana naprawa
Wprowadzić **jedno źródło prawdy**:
- np. `assemble_term_fields(ctx, m) -> TermFields`,
- gdzie `TermFields` zawiera wszystkie komponenty:
  - `h_ex`, `h_demag`, `h_ext`, `h_ani_uni`, `h_ani_cubic`,
  - `h_dmi_interfacial`, `h_dmi_bulk`,
  - `h_oersted`, `h_thermal`, `h_mel`.
- Następnie:
  - `H_eff = suma(TermFields)`,
  - energie wyliczać **z tych samych termów** lub z jednej wspólnej funkcji energetycznej.

### Test regresyjny
Dla każdego oddziaływania osobno:
- uruchomić przypadek z włączonym tylko jednym termem,
- sprawdzić, że:
  - norma odpowiedniego `H_term` > 0,
  - `H_eff` = `H_term`,
  - `E_total` zawiera tylko energię tego termu,
  - wyłączenie termu zeruje zarówno pole, jak i energię.

---

## F-04. Fallback do CPU reference może cicho zmienić model fizyczny

### Dowód w kodzie
#### CPU reference deklarowany zakres
- `crates/fullmag-runner/src/fem_reference.rs:1-7`
- `crates/fullmag-runner/src/fem_reference.rs:140-145`

CPU reference obsługuje tylko:
- exchange,
- optional demag,
- external field / per-node field,
- brak anisotropii, DMI, cubic, magnetoelastic, thermal, Oersted.

#### Dispatch / fallback
- `crates/fullmag-runner/src/dispatch.rs:146-190`
- `crates/fullmag-runner/src/dispatch.rs:544-565`

Przy braku native GPU lub przy małej siatce może nastąpić fallback do CPU reference.

### Problem
Użytkownik może myśleć, że testuje FEM z pełnym zakresem oddziaływań, a w rzeczywistości uruchamia wąski solver referencyjny.

### Wpływ na bieżącą diagnozę
To jest szczególnie groźne, bo:
- przy fallbacku objawy „złej fizyki” mogą pochodzić nie z błędu native FEM, tylko z **utraconych oddziaływań**,
- jeśli preview pokazuje Ci wynik CPU reference, a Ty interpretujesz go jako native FEM, debug idzie w złą stronę.

### Zalecana naprawa
- jeśli plan zawiera oddziaływanie nieobsługiwane przez CPU reference, a runtime chce fallbackować:
  - **zwrócić błąd**, nie cicho wykonywać run.
- w metadanych / UI / logach zawsze surfacować:
  - resolved engine,
  - resolved term set,
  - resolved domain contract.

---

## F-05. Część oddziaływań jest realnie „martwa” przez błędną logikę enable/guard

### 5.1. Uniaxial anisotropy – Ku2-only lub field-only są wyłączone
#### Dowód
- `crates/fullmag-runner/src/native_fem.rs:274-281`
- `native/backends/fem/src/mfem_bridge.cpp:721-726`

Runner ustawia `has_uniaxial_anisotropy` tylko wtedy, gdy istnieje **uniform `uniaxial_anisotropy`**.  
Backend dodatkowo wraca z funkcji, gdy `ctx.anisotropy_Ku == 0.0`, ignorując:
- `Ku2`,
- `Ku_field`,
- `Ku2_field`.

### 5.2. Cubic anisotropy – Kc2/Kc3-only albo field-only są wyłączone
#### Dowód
- `crates/fullmag-runner/src/native_fem.rs:286-293`
- `native/backends/fem/src/mfem_bridge.cpp:787-795`

Runner ustawia `has_cubic_anisotropy` tylko na podstawie `kc1`.  
Jeśli użytkownik poda tylko `kc2`, `kc3` lub tylko `kc*_field`, oddziaływanie może nie wejść.

### 5.3. Interfacial / bulk DMI – field-only nie działa
#### Dowód
- `crates/fullmag-runner/src/native_fem.rs:282-285`, `349-358`
- `native/backends/fem/src/mfem_bridge.cpp:892-896`, `1064-1068`

Jeżeli `dind_field` / `dbulk_field` istnieją, ale uniform `dmi_constant` / `bulk_dmi_constant` są zerowe lub `None`,
to term nie zostanie poprawnie uruchomiony.

### Dlaczego to jest ważne
To są błędy nie tylko funkcjonalne, ale też fizyczne:
- API wygląda jakby wspierało spatially varying coefficients,
- backend w praktyce tego nie realizuje.

### Zalecana naprawa
Dla każdego termu enable condition musi być:
- `uniform_coeff_nonzero || coefficient_field_present_and_nonzero`.

Przykładowa zasada:
- uniaxial enabled jeśli `Ku != 0 || Ku2 != 0 || Ku_field nonempty || Ku2_field nonempty`,
- cubic enabled jeśli **dowolny** z `Kc1/Kc2/Kc3` lub `kc*_field` jest obecny,
- DMI enabled jeśli `D_uniform != 0 || D_field nonempty`.

---

## F-06. Uniaxial anisotropy ma niespójność pole↔energia, a dodatni Ku opisuje inną fizykę w dynamice i inną w diagnostyce

### Dowód w kodzie
- `native/backends/fem/src/mfem_bridge.cpp:714-770`

Pole:
```cpp
// H_ani = (2Ku1/μ₀Ms)(m·û)û + (4Ku2/μ₀Ms)(m·û)³û
```

Energia raportowana:
```cpp
// E = -Ku1(1 - (m·û)²) - Ku2(1 - (m·û)²)²
```

### Analiza
Dla pierwszego rzędu:
- pole odpowiada potencjałowi typu `-Ku (m·u)^2` (easy-axis dla `Ku > 0`),
- ale raportowana energia `-Ku(1 - (m·u)^2) = -Ku + Ku(m·u)^2` ma minimum dla `m·u = 0`, czyli opisuje **easy-plane** dla `Ku > 0`.

To oznacza:
- dynamika liczy jedno,
- raportowana energia opisuje co innego.

Dla drugiego rzędu (`Ku2`) niespójność też istnieje – raportowana energia nie jest potencjałem, którego pochodna daje zakodowane pole.

### Konsekwencje
- `E_ani` nie może być używana do wiarygodnej diagnostyki relaksacji,
- `E_total` może rosnąć/spadać „dziwnie” nawet gdy sam LLG jest formalnie stabilny,
- porównania do FDM i literatury stają się mylące.

### Zalecana naprawa
- ustalić **jedną** konwencję energetyczną,
- z niej symbolicznie lub programowo wyprowadzać pole,
- nie pisać energii i pola ręcznie w dwóch miejscach niezależnie.

### Dodatkowy problem
- oś anisotropii nie jest normalizowana ani walidowana (`native/backends/fem/src/context.cpp:189-203`, brak normalizacji w backendzie),
- jeśli użytkownik poda nieunitary axis, amplituda pola i energii będzie błędna.

### Test regresyjny
Dla jednego węzła / jednorodnego stanu:
- obracać `m` wokół osi,
- porównać numeryczną pochodną energii z polem,
- sprawdzić minima energii dla dodatniego `Ku`.

---

## F-07. Bulk DMI ma zły znak względem specyfikacji i i tak nie bierze udziału w dynamice

### Dowód
#### Specyfikacja
- `docs/physics/0470-fem-bulk-dmi-mfem-gpu.md:91-99`

\[
H_{\mathrm{bDMI}} = -\frac{2D}{\mu_0 M_s} (\nabla \times m)
\]

#### Implementacja
- `native/backends/fem/src/mfem_bridge.cpp:1049-1168`

Kod implementuje:
```cpp
/// H_dmi = (2D / μ₀Ms) ∇ × m
const double hx = prefactor * curl_x;
const double hy = prefactor * curl_y;
const double hz = prefactor * curl_z;
```

#### Dodatkowo
- `native/backends/fem/src/mfem_bridge.cpp:1665-1678`
- `1715-1746`

Bulk DMI jest liczony do statystyk energii, ale **nie jest dodawany do faktycznego `H_eff`**.

### Konsekwencje
- obecnie bulk DMI jest jednocześnie:
  - **źle zdefiniowane znakowo** względem specyfikacji,
  - **nieaktywne dynamicznie**.

### Zalecana naprawa
1. poprawić znak w `compute_bulk_dmi_field`,
2. dodać bulk DMI do właściwego `H_eff`,
3. dodać osobny test chirality / helix handedness.

### Test regresyjny
- 1D helix / skyrmion chirality benchmark,
- porównanie znaku energii i kierunku skrętu z przypadkiem analitycznym / referencyjnym.

---

## F-08. DMI nie jest zaimplementowane jako weak residual / mass projection zgodnie ze specyfikacją FEM

### Dowód
#### Interfacial DMI code path
- `native/backends/fem/src/mfem_bridge.cpp:883-1041`

Kod:
- liczy gradient w pętli po elementach,
- składa „pole” przez nodal averaging,
- nie implementuje residual form jako podstawowego obiektu FEM.

#### Bulk DMI code path
- `native/backends/fem/src/mfem_bridge.cpp:1049-1210`

Analogicznie.

#### Specyfikacja
- `docs/physics/0450-fem-interfacial-dmi-mfem-gpu.md:264-299`
- `docs/physics/0470-fem-bulk-dmi-mfem-gpu.md:102-107`

Dokumentacja mówi wprost, że:
- poprawnym obiektem FEM jest **weak residual**,
- pole do LLG powinno być odzyskiwane z residualu przez **mass projection**,
- dla free-surface boundary physics nie należy ręcznie doklejać osobnej fizyki, tylko wynika ona z wariacji energii.

### Problem
Obecna implementacja jest „strong-form sampled field”, a nie właściwą dyskretyzacją residualu.  
To ma kilka skutków:
- słabsza zgodność wariacyjna,
- ryzyko złego zachowania przy brzegach,
- brak gwarancji poprawnej free-surface DMI canting physics,
- trudniejsza spójność z energią i z przyszłą ścieżką libCEED.

### Ocena
To nie musi być jedyny root cause obecnego błędu, ale jest to **istotna niezgodność metodyczna**.

### Zalecana naprawa
- zaimplementować DMI jako:
  1. weak residual,
  2. opcjonalnie lumped/consistent mass projection do pola,
  3. docelowo matrix-free/libCEED QFunction zgodnie z notatką.

### Test regresyjny
- edge canting w pasku z iDMI,
- 3D Bloch helix dla bulk DMI,
- convergence vs mesh refinement.

---

## F-09. Oersted i thermal nie biorą udziału w realnym steperze czasowym

### 9.1. Oersted
#### Dowód
- `native/backends/fem/src/context.cpp:546-566` — Oersted dodawany tylko w `context_upload_magnetization_f64`
- `native/backends/fem/src/mfem_bridge.cpp:1600-1699` — brak Oersted w `compute_effective_fields_for_magnetization`
- `native/backends/fem/src/context.cpp:356-405` — `oersted_axis` jest czytany, ale pole jest liczone tak, jakby przewodnik zawsze był w osi `z`

### Problem
- pole Oersteda nie jest częścią realnego kroku LLG,
- czasowa modulacja Oersteda nie jest aktualizowana per-step,
- `oersted_axis` jest ignorowana,
- `H_EXT` nie reprezentuje całego zewnętrznego pola przyłożonego.

### 9.2. Thermal
#### Dowód
- `native/backends/fem/src/context.cpp:575-627` — thermal dodawane tylko przy uploadzie
- `native/backends/fem/src/mfem_bridge.cpp:1600-1699` — brak thermal w realnym `H_eff`

Dodatkowe problemy:
- amplituda liczona z **globalnych średnich** `alpha`, `Ms`, `V_node`,
- RNG jest `static thread_local std::mt19937_64 rng(42)`, więc komentarz o seedzie „from step counter” nie zgadza się z implementacją.

### Konsekwencje
- symulacje z temperaturą nie realizują poprawnego sLLG,
- symulacje z current/Oersted nie realizują poprawnej dynamiki,
- energetyka / obserwowalne nie odpowiadają fizyce.

### Zalecana naprawa
- thermal i Oersted mają wejść do **tej samej wspólnej ścieżki składania `H_eff`**, co exchange/demag/anisotropy/DMI,
- thermal generować **per-step**,
- sigma liczyć **lokalnie** (per-node / per-dof), nie z globalnych średnich,
- RNG powiązać jawnie z seedem runu i numerem kroku.

---

## F-10. Zmienny przestrzennie `A_field` nie jest dyskretyzowany wariacyjnie poprawnie

### Dowód
- `native/backends/fem/src/mfem_bridge.cpp:526-575`

Kod robi:
1. `tmp = K * m`, gdzie `K` pochodzi z jednolitego `DiffusionIntegrator`,
2. potem skaluje wynik węzłowo przez `A_i`.

### Problem
Dla przestrzennie zmiennego `A(x)` poprawny operator FE powinien odpowiadać:
\[
\nabla \cdot (A \nabla m)
\]
a nie:
\[
A \cdot \Delta m
\]
z mnożeniem **po** złożeniu jednorodnego Laplasjanu.

Na jednorodnym materiale to przejdzie.  
Na interfejsach materiałowych – **nie**.

### Konsekwencje
- błędny exchange na granicach materiałów,
- zła energia exchange dla `A_field`,
- brak poprawnej fizyki wielomateriałowej.

### Zalecana naprawa
- użyć coefficient-aware `DiffusionIntegrator` lub własnego operatora z `A(x)` wewnątrz integratora,
- testy na 2-region patch problem.

---

## F-11. Walidacja boundary markerów w Poisson/airbox jest niebezpiecznie słaba

### Dowód
- `native/backends/fem/src/mfem_bridge.cpp:2411-2477`

#### Robin path
Jeżeli `poisson_boundary_marker` jest niepoprawny:
- boundary marker array zostaje zerowa,
- boundary mass form może wyjść pusta,
- kod i tak buduje `A = K + β B`, czyli efektywnie `A = K`,
- co może dać operator singularyczny / błędne BC bez jawnego błędu.

#### Dirichlet path
Jeżeli nie znajdzie essential DOFs:
```cpp
if (ctx.poisson_ess_tdof_list.empty()) {
    ctx.poisson_ess_tdof_list.push_back(0);
}
```
Czyli pinowany jest arbitralnie **DOF 0**, zamiast prawdziwej zewnętrznej granicy.

### Problem
To jest cicha korupcja fizyki po zmianie siatki/boundary markers.

### Zalecana naprawa
- brak poprawnego boundary marker → **error**, nie fallback,
- logować:
  - rozpoznane boundary attributes,
  - liczbę DOF-ów na outer boundary,
  - tryb Dirichlet/Robin,
  - użyte `β` i `R*`.

### Test regresyjny
- poprawny boundary marker,
- marker nieistniejący,
- brak boundary markers,
- all-zero boundary markers.

---

## F-12. Obserwowalne `H_ani`, `H_dmi`, `H_eff` są niekompletne lub mylące

### Dowód
- `native/backends/fem/src/context.cpp:466-490`

`H_ANI` zwraca tylko `ctx.h_ani_xyz`:
- czyli tylko uniaxial,
- bez cubic anisotropy.

`H_DMI` zwraca tylko `ctx.h_dmi_xyz`:
- czyli interfacial DMI,
- bez bulk DMI.

`H_EXT` zwraca tylko `ctx.h_ext_xyz`:
- bez Oersted.

`H_EFF` po kroku native nie zawiera cubic/bulk/Oersted/thermal.

### Konsekwencja
Debugging na podstawie snapshotów może prowadzić do błędnych wniosków:
- „pole jest zero”, choć energia mówi co innego,
- „term działa”, choć nie bierze udziału w dynamice.

### Zalecana naprawa
Rozszerzyć model obserwowalnych:
- `H_ani_uni`,
- `H_ani_cubic`,
- `H_dmi_i`,
- `H_dmi_b`,
- `H_oe`,
- `H_thermal`,
- `H_eff`.

---

## F-13. CPU/reference preview dla `H_ani` i `H_dmi` zwraca faktycznie magnetyzację

### Dowód
- `crates/fullmag-runner/src/preview.rs:46-57`

`select_observables()` obsługuje tylko:
- `H_ex`,
- `H_demag`,
- `H_ant`,
- `H_ext`,
- `H_eff`,
- a wszystko inne zwraca `magnetization`.

### Problem
Jeśli ścieżka preview idzie przez `StateObservables` CPU/reference, żądanie `H_ani` albo `H_dmi` może pokazywać po prostu `m`, a nie dane pole.

### Waga
To jest bardziej błąd diagnostyczny niż błąd dynamiki, ale przy debugowaniu „czarnych strzałek” jest bardzo istotny.

### Zalecana naprawa
- preview ma zwracać błąd „quantity unsupported by this backend”,
- nigdy cichy fallback na `m`.

---

## F-14. Brakuje walidacji długości pól materiałowych / strain oraz normalizacji osi

### Dowód
#### Brak walidacji długości per-node fields
- `native/backends/fem/src/context.cpp:205-220`
- funkcje liczące potem indeksują bezpośrednio np.:
  - `ctx.Ms_field[i]`,
  - `ctx.Ku_field[i]`,
  - `ctx.Dind_field[gdof]`,
  - `ctx.Kc1_field[i]`.

#### Brak walidacji/normalizacji osi
- `native/backends/fem/src/context.cpp:189-203` — osie są tylko kopiowane,
- brak normalizacji `anisotropy_axis`, `cubic_axis1`, `cubic_axis2`,
- brak walidacji ortogonalności `c1`, `c2`.

### Problem
Po zmianie siatki i pól materiałowych to jest bardzo niebezpieczne:
- przy mismatchu długości masz UB / OOB / śmieciowe pole,
- przy nieunitary axis amplituda pola i energii jest błędna.

### Zalecana naprawa
Przy starcie planu:
- sprawdzać `field_len == n_nodes` dla wszystkich pól per-node,
- `mel_strain_len == 6` albo `6*n_nodes`,
- normalizować `anisotropy_axis`,
- dla cubic: wymagać dwóch osi jednostkowych i wzajemnie prostopadłych, albo jawnie ortonormalizować.

---

## F-15. Recovery `H_demag` przez nodal averaging nie odpowiada zalecanej ścieżce quadrature/L2 projection

### Dowód
- `native/backends/fem/src/mfem_bridge.cpp:2010-2142`
- `docs/physics/0430-fem-dipolar-demag-mfem-gpu-foundations.md:251-264`

Dokumentacja zaleca:
- użyć `-∇u` bezpośrednio w residuale LLG,
- albo wykonać poprawną `L^2` projection.

Kod robi:
- element gradient,
- rozrzucenie na DOF-y przez averaging.

### Ocena
To nie jest tak krytyczne jak marker contract lub brak termów w `H_eff`, ale jest to **odchylenie metodyczne**, które może zniekształcać pole demag przy grubszych siatkach / złożonych geometriach.

### Zalecana naprawa
- jeśli `H_demag` ma być polem jawnie używanym przez integrator:
  - robić lumped/consistent mass projection,
- albo przenieść demag bezpośrednio do residualu LLG.

---

## 6. Interakcja po interakcji – stan faktyczny

| Oddziaływanie | API/plan sugeruje wsparcie | Wchodzi do faktycznego `H_eff`? | Energia/statystyki | Observables | CPU fallback | Uwagi |
|---|---|---|---|---|---|---|
| Exchange | tak | **tak** | tak | tak | tak | krytycznie zależne od marker contract; zmienny `A_field` źle zdyskretyzowany |
| Demag | tak | **tak** | tak | tak | tak | BC validation słaba; field recovery nieidealny |
| Uniform external / Zeeman | tak | **tak** | tak | `H_EXT` | tak | w porządku jako uniform term |
| Uniaxial anisotropy | tak | **częściowo** | **tak, ale niespójnie** | `H_ANI` | nie | Ku2-only i field-only martwe; energia niezgodna z polem |
| Cubic anisotropy | tak | **nie** | **tak** | **niepełne** | nie | stats-only, nie dynamiczne |
| Interfacial DMI | tak | **tak (częściowo)** | tak | `H_DMI` | nie | weak-form mismatch; field-only martwe |
| Bulk DMI | tak | **nie** | **tak** | **niepełne** | nie | zły znak + stats-only |
| Oersted | tak | **nie w steperze** | niepełne | niepełne | nie | upload-only, axis ignored |
| Thermal | tak | **nie w steperze** | n/d | nie | nie | upload-only, złe sigma/locality |
| Magnetoelastic | tak | **tak** | tak | `H_MEL` | nie | wymaga jeszcze walidacji długości strain |

---

## 7. Co moim zdaniem jest **najpierw** do sprawdzenia na żywym runie

To jest „stop the bleeding” lista diagnostyczna. Nie wymaga przebudowy architektury, a szybko potwierdzi root cause.

### 7.1. Natychmiast wypisz w logach
Dla każdego runu FEM:
- resolved engine (`native_fem` vs `cpu_reference`),
- histogram `element_markers`,
- histogram MFEM `attributes`,
- `magnetic_element_count`,
- `magnetic_node_count`,
- liczba węzłów z `lumped_mass > 0`,
- `||H_ex||_max`,
- `||H_demag||_max`,
- `||H_eff||_max`,
- lista termów naprawdę dodanych do `H_eff`.

### 7.2. Twarde czerwone flagi
Jeżeli którykolwiek z poniższych warunków jest prawdziwy, run należy uznać za **nieważny fizycznie**:
- `enable_exchange == true` i `nonzero_lumped_mass_nodes == 0`,
- `magnetic_element_count > 0` ale `exchange_form` ma zero aktywnych elementów,
- resolved engine = CPU reference, a plan zawiera anisotropy / DMI / magnetoelastic / thermal / Oersted,
- bulk DMI / cubic anisotropy mają niezerową energię, ale nie są w `H_eff`.

### 7.3. Najbardziej użyteczny minimalny eksperyment
Uruchomić **ten sam** przypadek 4 razy:
1. native FEM, marker `1`,
2. native FEM, marker `2`,
3. native FEM, marker `0`,
4. CPU reference.

Porównać:
- `H_ex max`,
- `E_ex`,
- `m_avg`,
- mapę aktywnych węzłów w preview.

Jeżeli przypadki 2 i 3 „siadają”, a 1 działa – marker bug jest potwierdzony.

---

## 8. Rekomendowana kolejność napraw

### Etap A — krytyczne „stop the bleeding”
1. **usunąć hardcode `attribute 1`** z native MFEM,
2. **ujednolicić region contract** między plannerem, preview, CPU reference i native,
3. dodać walidacje startowe:
   - nonzero magnetic elements,
   - nonzero lumped mass,
   - poprawny boundary marker,
   - field lengths.

### Etap B — spójność fizyki
4. zbudować wspólną ścieżkę składania wszystkich termów `H_eff`,
5. naprawić uniaxial anisotropy pole↔energia,
6. dodać cubic anisotropy i bulk DMI do dynamiki,
7. poprawić znak bulk DMI.

### Etap C — spójność z API i dokumentacją
8. naprawić enable/guard logic dla spatially varying coefficient fields,
9. usunąć ciche fallbacki semantyczne do CPU reference,
10. naprawić observables / preview.

### Etap D — zgodność metody FEM
11. przepisać DMI na weak residual + mass projection / quadrature path,
12. poprawić heterogeniczne exchange `A(x)`,
13. poprawić demag field recovery.

---

## 9. Minimalny zestaw testów regresyjnych, który MUSI dojść

### 9.1. Marker / region contract
- no markers,
- all zero markers,
- all one markers,
- all two markers,
- mixed 1/0,
- mixed 2/0,
- mixed 1/99,
- mixed 2/99.

### 9.2. Term-by-term physics
- exchange-only,
- demag-only,
- Zeeman-only,
- uniaxial-only (`Ku`),
- uniaxial-only (`Ku2`),
- cubic-only (`Kc1`, `Kc2`, `Kc3` osobno),
- interfacial DMI-only,
- bulk DMI-only,
- Oersted-only,
- thermal-only,
- magnetoelastic-only.

### 9.3. Consistency tests
Dla każdego termu:
- `H_eff` zawiera term,
- energia odpowiada termowi,
- observable go pokazuje,
- wyłączenie termu zeruje pole i energię.

### 9.4. Cross-backend tests
- native FEM vs CPU reference tylko dla wspólnego modelu physics slice,
- native FEM vs FDM dla box/film benchmarków,
- dokumentowane case’y z vortex/skyrmion/helix.

---

## 10. Wnioski końcowe

### Wniosek 1
**Nie widzę jednej „małej pomyłki”; widzę kilka równoległych problemów, z których najgroźniejszy jest rozjazd region/material contract po zmianach mesh.**

### Wniosek 2
**Jeżeli po poprawkach siatki marker magnetyczny nie jest równy `1`, albo markery zniknęły / są `0`, native FEM może bardzo łatwo liczyć błędną fizykę.**  
To jest obecnie najbardziej prawdopodobne wyjaśnienie Twojego objawu.

### Wniosek 3
Nawet po naprawie markerów nadal są realne błędy implementacyjne:
- `H_eff` nie zawiera wszystkich termów,
- uniaxial anisotropy ma niespójną energię,
- bulk DMI ma zły znak i nie jest dynamiczne,
- Oersted/thermal nie są częścią realnego kroku,
- CPU fallback może cicho uruchomić inny model.

### Wniosek 4
Dopóki nie naprawisz:
1. region contract,
2. wspólnego składania `H_eff`,
3. semantic guard na fallbackach,

**nie ufałbym żadnemu wynikowi relaksacji FEM jako referencji fizycznej**.

---

## 11. Najkrótsza odpowiedź na Twoje pytanie

**Nie — obecnie nie liczycie „wszystkich oddziaływań FEM” poprawnie i spójnie.**  
Najbardziej podejrzane dla Twojego aktualnego przypadku są:
1. **markery / domena magnetyczna po zmianie siatki**,  
2. **zanik lub błędne złożenie exchange w native FEM**,  
3. **rozjazd między tym, co raportuje solver, a tym, co naprawdę trafia do `H_eff`**,  
4. **możliwy fallback do CPU reference o uboższej fizyce**.

---

## 12. Aneks – najważniejsze referencje do kodu

### Region contract / markery
- `crates/fullmag-engine/src/fem.rs:1470-1477`
- `crates/fullmag-runner/src/preview.rs:282-303`
- `native/backends/fem/src/context.cpp:309-340`
- `native/backends/fem/src/mfem_bridge.cpp:2215-2223`
- `native/backends/fem/src/mfem_bridge.cpp:2274-2290`
- `docs/physics/0520-fem-robin-airbox-demag-bootstrap-reference.md:141-150`
- `docs/physics/0410-fem-exchange-demag-zeeman-mfem-gpu.md:551-559`

### Effective field / energies
- `native/backends/fem/src/mfem_bridge.cpp:1600-1699`
- `native/backends/fem/src/mfem_bridge.cpp:1715-1759`

### Anisotropy / DMI
- `native/backends/fem/src/mfem_bridge.cpp:714-770`
- `native/backends/fem/src/mfem_bridge.cpp:781-876`
- `native/backends/fem/src/mfem_bridge.cpp:883-1041`
- `native/backends/fem/src/mfem_bridge.cpp:1049-1210`
- `docs/physics/0450-fem-interfacial-dmi-mfem-gpu.md:98-116`
- `docs/physics/0450-fem-interfacial-dmi-mfem-gpu.md:264-299`
- `docs/physics/0470-fem-bulk-dmi-mfem-gpu.md:91-99`

### Oersted / thermal / observables
- `native/backends/fem/src/context.cpp:356-405`
- `native/backends/fem/src/context.cpp:466-490`
- `native/backends/fem/src/context.cpp:501-627`

### Exchange heterogeneity / Poisson BC
- `native/backends/fem/src/mfem_bridge.cpp:526-575`
- `native/backends/fem/src/mfem_bridge.cpp:2411-2477`
- `native/backends/fem/src/mfem_bridge.cpp:2010-2142`

### CPU reference slice / fallback
- `crates/fullmag-runner/src/fem_reference.rs:1-7`
- `crates/fullmag-runner/src/fem_reference.rs:140-145`
- `crates/fullmag-runner/src/dispatch.rs:146-190`
- `crates/fullmag-runner/src/dispatch.rs:544-565`
- `crates/fullmag-runner/src/preview.rs:46-57`

---
