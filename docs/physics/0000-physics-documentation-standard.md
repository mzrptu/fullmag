# Physics documentation standard

- Status: active
- Last updated: 2026-03-23

## Mission

Każdy dokument w `docs/physics/` ma być napisany tak, jakby miał stać się częścią suplementu do publikacji naukowej albo wewnętrznego technical note dla solvera.

## Required sections

Każdy nowy temat powinien zawierać przynajmniej:

1. **Problem statement**
   - Co modelujemy?
   - Dlaczego to jest potrzebne?
   - Jaki fragment fizyki lub numeryki to reprezentuje?

2. **Physical model**
   - równania,
   - definicje symboli,
   - jednostki SI,
   - założenia i przybliżenia.

3. **Numerical interpretation**
   - jak model przechodzi do FDM,
   - jak model przechodzi do FEM,
   - co oznacza w trybie hybrid,
   - jakie są różnice semantyczne między backendami.

4. **IR and API impact**
   - jakie obiekty Python API są potrzebne,
   - jakie pola trafiają do `ProblemIR`,
   - jakie capability checks są wymagane,
   - jaki plan wykonania ma powstać.

5. **Validation strategy**
   - benchmarki analityczne,
   - benchmarki numeryczne,
   - porównania cross-backend,
   - tolerancje i obserwable.

6. **Completeness checklist**
   - Python API,
   - `ProblemIR`,
   - planner,
   - capability matrix,
   - FDM,
   - FEM,
   - hybrid,
   - outputs,
   - tests,
   - docs.

7. **Known limits and deferred work**
   - co nie działa,
   - co jest ograniczone,
   - co świadomie odkładamy.

## Quality bar

Dokument ma pozwalać odpowiedzieć na pytania:

- czy implementujemy właściwą fizykę,
- czy implementujemy ją spójnie we wszystkich warstwach systemu,
- czy wiemy jak to zwalidować,
- czy znamy granice modelu.

Jeżeli odpowiedź brzmi „nie”, dokument jest niekompletny.
