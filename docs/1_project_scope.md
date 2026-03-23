Tak — i to jest bardzo dobry kierunek. Najważniejsza decyzja brzmi jednak tak: **wspólny interfejs ma opisywać problem fizyczny, a nie siatkę**. To jest dokładnie lekcja z Ubermag: problem jest definiowany ponad backendami, a wykonanie delegowane do konkretnego kalkulatora; jednocześnie ich własna dokumentacja uczciwie pokazuje, że wspólny interfejs nie oznacza pełnej zgodności każdej funkcji między backendami. ([ubermag.github.io][1])

Mój werdykt technologiczny byłby taki: **Next.js na froncie, Rust jako control-plane + parser + IR + scheduler + runner, C++/CUDA jako warstwa obliczeniowa, własny backend FDM oraz backend FEM oparty o MFEM + libCEED + hypre**. MFEM pasuje tu bardzo dobrze, bo ma GPU support, pracuje z hypre i mocno stawia na partial assembly ważne dla GPU; libCEED daje do tego model operatorów/QFunction i backendy CUDA/HIP/SYCL. Z istniejących solverów najbardziej sensownie jest kopiować nie tyle kod, co wzorce: z MuMax3 prosty workflow i FDM, z MuMax+ separację extensible core od interfejsu, z BORIS myślenie multiphysics i ścieżkę do multi-GPU. ([GitHub][2])

### Go czy Rust?

Na nowy projekt wybrałbym **Rust**, nie Go, ale z jednym ważnym zastrzeżeniem: **kernels produkcyjne nadal pisałbym w CUDA/C++**. Go jest sprawdzone — MuMax3 buduje się z Go + CUDA + C, a jego moduły pokazują własne bindingi do CUDA driver API, cuFFT i cuRAND. Natomiast do architektury z parserem, IR, capability matrix, workerami, web API i dwoma backendami Rust daje Ci lepszy model typów, bezpieczniejsze FFI i lepszą organizację dużego systemu. Dodatkowo istnieją dojrzałe opakowania typu `cudarc` dla Driver/NVRTC/cuBLAS/cuSPARSE/cuSOLVER, ale pełne „CUDA w samym Ruście” nadal jest opisane przez własny projekt jako wczesne i rebootowane, więc nie robiłbym na tym rdzenia solvera. ([GitHub][3])

Czyli praktycznie:

* **Rust**: parser, AST, IR, planner, API, job runner, storage, telemetry, część host-side FDM.
* **CUDA/C++**: kernels FDM, cuFFT path, wydajne operatory lokalne.
* **C++**: cały most do MFEM/libCEED/hypre po stronie FEM.
* **C ABI** między Rust a backendami natywnymi, nie bezpośrednie wiązanie całego MFEM do Rust.

### MFEM czy coś innego?

**MFEM byłby moim pierwszym wyborem.**
deal.II jest mocne, ale dziś idzie w stronę Kokkos jako GPU portability layer; oficjalny changelog mówi, że dawne CUDAWrappers zostały usunięte. DOLFINx/FEniCSx jest świetny do PETSc-centric workflow, ale jego własna dokumentacja pokazuje, że naturalnym środkiem ciężkości są obiekty PETSc i stack bardziej badawczy niż „własny silnik C++/CUDA z backend abstraction”. Dla Twojego celu MFEM po prostu lepiej siada. Jedno zastrzeżenie: publiczna strona MFEM o performance nadal opisuje partial assembly na GPU głównie w kontekście elementów tensor-product, więc jeśli chcesz od razu iść mocno w tetra/simplex-heavy FEM, zrób wczesny spike techniczny zanim zamrozisz zakres v1. ([Deal.II][4])

---

## Docelowa architektura

```text
Next.js UI / CLI / API clients
            │
            ▼
   Script DSL + Visual Editor
            │
            ▼
      Parser + Type Checker
            │
            ▼
     Canonical Problem IR
            │
            ▼
  Planner + Capability Checker
      │          │          │
      ▼          ▼          ▼
   FDM Plan    FEM Plan   Hybrid Plan
      │          │          │
      ▼          ▼          ▼
 CUDA Runtime  MFEM/libCEED  Coupling Runtime
      │          │          │
      └──────► Common Artifact Layer ◄──────┘
                     │
                     ▼
          Viewer / Compare / Export / API
```

### Najważniejsza zasada

**Nie projektuj API typu „ustaw komórkę (i,j,k)” jako części wspólnego DSL.**
To zabija FEM. Wspólny DSL ma operować na:

* geometrii,
* regionach,
* materiałach,
* energiach i dynamice,
* pobudzeniach,
* outputach,
* hintach dyskretyzacji.

Czyli użytkownik opisuje fizykę i geometrię, a dopiero backend robi:

* voxelizację dla FDM,
* meshowanie dla FEM,
* projekcję mesh↔grid dla trybu hybrydowego.

### To, co warto skopiować z istniejących projektów

Z **Ubermag** brałbym ideę backend-neutral DSL.
Z **MuMax3** brałbym lekkość workflow, batch/CLI/server i szybkość FDM; ich moduły zawierają nawet `mumax3-server` jako cluster/web workflow.
Z **MuMax+** brałbym architekturę „napisane od zera, extensible core, C++/CUDA + wyższy interfejs”, a nie dokładne wnętrzności MuMax3.
Z **BORIS** brałbym myślenie o multiphysics i to, że rozwój do multi-GPU nie musi zrywać warstwy skryptowej. Przy okazji: publiczny Boris2 ma już ~164k non-trivial LOC, więc v1 trzeba brutalnie ciąć. ([ubermag.github.io][1])

---

## Jak bym to zaprojektował

### 1. Jedna warstwa skryptowa, ale z trzema trybami

Wspólny DSL powinien mieć trzy tryby pracy:

* **strict** — tylko wspólny podzbiór FDM/FEM; gwarancja, że ten sam skrypt uruchomi się na obu backendach,
* **extended** — wolno używać rozszerzeń backendowych,
* **hybrid** — jawnie aktywujesz coupling FDM↔FEM.

To jest bardzo ważne, bo nawet Ubermag wprost zaznacza, że adapter mumax3 nie wspiera wszystkiego, co wspiera OOMMF. U Ciebie trzeba to zaprojektować od początku, a nie odkryć po roku. ([ubermag.github.io][5])

### 2. Canonical Problem IR

To ma być prawdziwe serce projektu. Nie AST, nie JSON z UI, tylko **silnie typowany IR**.

Przykładowe sekcje IR:

* `GeometryIR`
* `RegionIR`
* `MaterialIR`
* `FieldIR`
* `EnergyTermsIR`
* `DynamicsIR`
* `BoundaryConditionsIR`
* `ExcitationIR`
* `SamplingIR`
* `BackendPolicyIR`
* `ValidationProfileIR`

Każdy run zapisuje:

* oryginalny skrypt,
* znormalizowany IR,
* wersję parsera,
* git SHA backendu,
* GPU model,
* CUDA driver/runtime,
* seed,
* parametry solvera.

To da Ci naukową odtwarzalność.

### 3. Planner i capability matrix

Planner bierze `ProblemIR` i robi dwie rzeczy:

1. sprawdza, czy problem jest legalny dla backendu,
2. obniża go do `ExecutionPlan`.

Przykład:

* `demag` w FDM → FFT/cell-based operator,
* `demag` w FEM → magnetostatics FE operator,
* `demag` w hybrid → projekcja na auxiliary Cartesian grid + FFT + interpolacja z powrotem.

### 4. FDM backend

To powinien być Twój pierwszy szybki backend i pierwszy MVP.

Architektura FDM:

* regularny grid,
* voxelizer regionów i geometrii,
* GPU-resident arrays,
* lokalne termy jako osobne kernels,
* demag przez cuFFT,
* time integrators w stylu MuMax3/MuMax+,
* wspólny format outputów.

Ten backend ma być „workhorse” dla prostych i dużych problemów.

### 5. FEM backend

Tu zrobiłbym wyraźny podział:

* **MFEM**: mesh, spaces, forms, boundary conditions, high-level FE machinery,
* **libCEED**: GPU-first operator execution i extensible operator fragments,
* **hypre**: preconditioning/solvers.

Na poziomie architektury każdy term energii powinien być osobnym fragmentem operatora. To bardzo dobrze pasuje do libCEED, bo `CeedOperator` składa operatory, a `CeedQFunction` jest naturalnym miejscem na implementację lokalnych członów i może być JIT-kompilowany dla GPU backendów. ([libCEED][6])

### 6. Hybrid backend — tu jest Twoja prawdziwa nowość

Twoja realna innowacja nie powinna brzmieć „mam dwa backendy”, tylko:

> **mam jeden physics IR, jeden DSL, wspólne outputy i trzeci tryb hybrydowy, który łączy zalety FEM i FDM**

Najbardziej sensowna wersja hybrydy na start:

* geometria + lokalne operatory na siatce FEM,
* demag liczony na pomocniczej siatce kartezjańskiej FFT,
* projekcja `m_fem -> grid_aux`,
* FFT demag,
* interpolacja `H_demag -> fem`.

To jest trudne, ale dużo bardziej realistyczne niż pełne „wszystko na wszystkim” od dnia 1.

---

## Frontend i backend aplikacyjny

### Frontend Next.js

Frontend nie powinien zawierać logiki fizycznej. Ma być **control room**:

* edytor skryptów,
* formularzowy edytor problemu,
* upload STEP/STL/MSH,
* uruchamianie jobów,
* podgląd logów,
* viewer wyników,
* porównywarka FDM vs FEM,
* dashboard klastrów/GPU.

Bardzo dobry wzorzec: **tekstowy DSL + formularze + oba zapisują ten sam ProblemIR**.

### Backend aplikacyjny

```text
Browser (Next.js)
   │  HTTPS / WebSocket
   ▼
Rust API Gateway
   │
   ├── Auth / Jobs / Artifacts metadata
   ├── Script compile service
   ├── Scheduler
   └── Result query service
          │
          ▼
      GPU Workers
   ├── FDM worker
   ├── FEM worker
   └── Hybrid worker
```

Proponowany stack:

* **Rust API**: Axum lub Actix,
* **RPC do workerów**: gRPC,
* **DB metadata**: Postgres,
* **artifact storage**: S3/MinIO,
* **queue/events**: NATS albo Redis,
* **observability**: OpenTelemetry + Prometheus.

### Bardzo ważny detal FFI

Nie próbuj wiązać całego MFEM do Rust 1:1.
Zrób cienkie, stabilne C ABI:

```c
mm_backend* mm_backend_create(const mm_plan* plan);
int mm_backend_run(mm_backend* handle, const mm_run_opts* opts);
int mm_backend_step(mm_backend* handle, uint64_t nsteps);
int mm_backend_get_field(mm_backend* handle, const char* name, mm_array_view* out);
void mm_backend_destroy(mm_backend* handle);
```

MFEM/hypre/libCEED/CUDA typy chowasz całkowicie po stronie natywnej.

---

## Szkic DSL

Tak bym to widział:

```text
problem "dw_track" {
  mode = "strict"
  backend = "auto"      // auto | fdm | fem | hybrid

  geometry = import("track.step")

  material "Py" {
    Ms = 800e3
    A  = 13e-12
    alpha = 0.01
    Ku1 = 0.5e6
    anisU = vector(0, 0, 1)
  }

  region "track" {
    shape = geometry
    material = "Py"
  }

  energy {
    exchange()
    demag()
    dmi(type="interfacial", D=3e-3)
    zeeman(B=vector(0,0,0.1))
  }

  dynamics {
    llg()
    t_end = 10e-9
    dt = adaptive
  }

  discretization {
    fdm { cell = [2e-9, 2e-9, 1e-9] }
    fem { order = 1, hmax = 2e-9 }
    hybrid { demag = "fft_aux_grid" }
  }

  outputs {
    save field("m") every 10e-12
    save scalar("E_total") every 10e-12
  }
}
```

Klucz: zmiana `backend = "fdm"` na `"fem"` lub `"hybrid"` nie zmienia fizyki, tylko sposób dyskretyzacji.

---

## Plan wdrożenia — 26 etapów

### Faza A — fundamenty

1. **Zamrożenie zakresu v1 fizyki.**
   Na start: ferromagnetyczne LLG, exchange, anisotropy, demag, Zeeman, DMI, podstawowe STT/SOT. AFM i magnetoelasticity dopiero później.

2. **Zdefiniowanie wspólnej semantyki DSL.**
   Spisz, co znaczy „ten sam problem” niezależnie od backendu.

3. **Ustalenie jednostek i konwencji współrzędnych.**
   SI everywhere, jeden origin convention, jedna semantyka regionów.

4. **Projekt `ProblemIR`.**
   Wersjonowany, typowany, serializowalny.

5. **Projekt capability matrix.**
   Każdy backend deklaruje legalne geometrie, termy, BC, outputy, solver features.

6. **Projekt trybów `strict / extended / hybrid`.**
   To musi istnieć od początku, inaczej API się rozjedzie.

### Faza B — repo i core

7. **Monorepo i build orchestration.**
   Cargo workspace + CMake dla native libs + pnpm dla web.

8. **Parser, linter i formatter DSL.**
   Nie tylko parser — od razu walidacja i sensowne błędy.

9. **Type checker i semantic validator.**
   Sprawdza jednostki, zgodność regionów, poprawność energii, legalność backendu.

10. **CLI runner lokalny.**
    Jeden binarny entrypoint do uruchamiania jobów bez frontendu.

11. **Artifact model.**
    Format snapshotów, tabel, checkpointów, meshy, logów, provenance.

12. **Common field API.**
    Jednolite nazwy `m`, `H_eff`, `E_exch`, `E_demag`, itd.

### Faza C — control plane i frontend

13. **Rust API Gateway.**
    Job submit, job status, artifact listing, stream logów.

14. **Scheduler i worker protocol.**
    Plan → dispatch → execution → artifact finalize.

15. **Storage layer.**
    Postgres dla metadata, MinIO/S3 dla danych ciężkich.

16. **Next.js editor.**
    Monaco editor, walidacja, templates, syntax help.

17. **Dashboard jobów.**
    Queue, running, failed, finished, GPU assignment.

18. **Viewer wyników.**
    Tabele, wykresy, slice plots, eksport do ParaView/OVF/HDF5.

### Faza D — backend FDM

19. **Voxelizer i region masks.**
    Geometria -> grid, region assignment, material mapping.

20. **GPU memory layout i array abstractions.**
    SoA layout, scratch buffers, pooling.

21. **Lokalne CUDA kernels.**
    Exchange, anisotropy, Zeeman, damping, torque terms.

22. **Demag FFT.**
    cuFFT path, kernel caching, PBC strategy.

23. **Time integrators FDM.**
    Relax, LLG time solve, adaptive stepping, checkpoints.

24. **Walidacja FDM.**
    μMAG standard problems, analityczne przypadki, cross-check z MuMax3. MuMax+ paper też opiera walidację o μMAG, mumax3 i analitykę, więc to jest dobry wzorzec testowy. ([Nature][7])

### Faza E — backend FEM

25. **Pipeline geometrii i meshy.**
    Import STEP/STL/MSH, tagowanie regionów, mesh repair.

26. **Most C ABI do MFEM/libCEED/hypre.**
    Rust widzi tylko stabilny interfejs C.

27. **Przestrzenie i pola FEM.**
    Mapowanie materiałów, regionów i field variables na mesh.

28. **Lokalne operatory FEM na GPU.**
    Exchange, anisotropy, Zeeman, DMI jako operator fragments.

29. **Magnetostatics v1 w FEM.**
    Najpierw poprawna wersja „air-box / open-boundary approximation”, nie od razu perfekcyjny high-end BEM/FEM.

30. **Time integrators FEM.**
    Relax, time-stepping, checkpoint/restart, common output layer.

31. **Walidacja FEM.**
    Analityczne benchmarki + wspólne przypadki z FDM, ale porównywane w tolerancjach fizycznych, nie bitwise.

### Faza F — tryb hybrydowy

32. **Projection operators mesh↔grid.**
    Interpolacja/przenoszenie pól i materiałów.

33. **Auxiliary-grid demag.**
    `m_fem -> grid_aux -> FFT demag -> H_demag -> fem`.

34. **Hybrid scheduler.**
    Jeden step solvera uruchamia kilka operatorów na różnych reprezentacjach.

35. **Hybrid validation.**
    Porównanie z pure FEM i pure FDM dla wybranych geometrii.

### Faza G — rozszerzenia fizyki

36. **AFM / ferrimagnet.**
    MuMax+ pokazuje, że to właśnie tu zaczyna się prawdziwa „next-gen” micromagnetics beyond mumax3. ([Nature][7])

37. **Magnetoelasticity.**
    Najpierw po stronie FEM, później rozsądne uproszczenia dla FDM.

38. **Spin transport / drift-diffusion.**
    To jest już inspiracja bardziej z BORIS niż z MuMax3.

### Faza H — skala i produkcja

39. **Multi-GPU.**
    Najpierw FDM, potem FEM, na końcu hybrid. BORIS pokazuje, że da się utrzymać zgodność warstwy skryptowej przy przejściu do multi-GPU. ([GitHub][8])

40. **MPI / cluster mode.**
    Node-local GPU workers + scheduler-aware dispatch.

41. **Profiling i performance lab.**
    Nsight, roofline, memory transfer audit, operator timings.

42. **Regression CI na GPU.**
    Benchmarki wydajnościowe i testy numeryczne.

43. **Pakiety i deployment.**
    Docker/Apptainer, local mode, cluster mode.

44. **Dokumentacja i przykłady.**
    Templates: skyrmion, DW motion, SOT switching, AFM, magnetoelastic strip.

---

## Co bym zrobił jako v1, a czego nie

**v1 robiłbym tak:**

* jeden wspólny DSL,
* Rust core,
* FDM gotowy produkcyjnie,
* FEM gotowy dla sensownego podzbioru problemów,
* wspólne outputy,
* porównanie FDM/FEM side-by-side,
* bez pełnego multi-GPU i bez pełnego multiphysics.

**v1 nie robiłbym tak:**

* pełny BORIS-scale multiphysics,
* wszystkie geometrie i wszystkie FE spaces od razu,
* wszystkie antiferromagnetyczne modele na obu backendach,
* idealny hybrid od pierwszego sprintu.

Najbardziej wartościowy produktowo komunikat dla tego solvera to nie „mamy FEM i FDM”, tylko:

> **„Opisujesz jeden problem fizyczny, a silnik uruchamia go w FDM, FEM albo hybrydzie — z tą samą warstwą skryptową, wspólnymi outputami i walidowaną zgodnością semantyczną.”**

W następnym kroku rozpiszę etap 1-6 do poziomu konkretnych modułów repo, interfejsów Rust/C++ i pierwszego MVP parsera.

[1]: https://ubermag.github.io/ "https://ubermag.github.io/"
[2]: https://github.com/CEED/MFEM "https://github.com/CEED/MFEM"
[3]: https://github.com/mumax/3 "https://github.com/mumax/3"
[4]: https://www.dealii.org/current/doxygen/deal.II/changes_between_9_6_0_and_9_7_0.html "https://www.dealii.org/current/doxygen/deal.II/changes_between_9_6_0_and_9_7_0.html"
[5]: https://ubermag.github.io/documentation/mumax3c.html "https://ubermag.github.io/documentation/mumax3c.html"
[6]: https://libceed.org/en/latest/api/CeedQFunction/ "https://libceed.org/en/latest/api/CeedQFunction/"
[7]: https://www.nature.com/articles/s41524-025-01893-y "https://www.nature.com/articles/s41524-025-01893-y"
[8]: https://github.com/SerbanL/BORIS "https://github.com/SerbanL/BORIS"
