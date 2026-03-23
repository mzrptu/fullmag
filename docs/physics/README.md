# Physics documentation

Ten katalog jest **obowiązkowym dziennikiem naukowym projektu**.

## Złota zasada

Każda nowa funkcja fizyczna, numeryczna lub walidacyjna musi być tutaj opisana **zanim** przejdzie do implementacji. Dotyczy to m.in.:

- geometrii i mesh pipeline,
- exchange,
- anisotropy,
- demag,
- DMI,
- Zeeman,
- STT/SOT,
- time integration,
- projection mesh↔grid,
- warunków brzegowych,
- artifact semantics,
- benchmarków i walidacji.

## Cel

Budujemy dokumentację tak, aby mogła ewoluować w stronę:

- wewnętrznej dokumentacji architektoniczno-fizycznej,
- suplementów do publikacji naukowych,
- materiałów walidacyjnych dla backendów FDM/FEM/hybrid,
- źródła prawdy dla agentów i implementerów.

## Minimalny workflow

1. Zidentyfikuj nową funkcję fizyczną lub numeryczną.
2. Utwórz dokument w `docs/physics/` na bazie szablonu.
3. Opisz równania, założenia, jednostki, zakres obowiązywania i walidację.
4. Sprawdź wpływ na Python API, `ProblemIR`, planner, capability matrix i backendy.
5. Dopiero wtedy przejdź do implementacji.
6. Po implementacji uzupełnij dokument o status, wyniki walidacji i ograniczenia.

## Konwencja nazewnictwa

Zalecany format:

- `0000-physics-documentation-standard.md`
- `0100-mesh-and-region-discretization.md`
- `0200-exchange.md`
- `0210-dmi-interfacial.md`
- `0300-demagnetization.md`

Numeracja ma pomagać w porządku merytorycznym, nie w biurokracji.
