# Repo blueprint

> [!IMPORTANT]
> **Skrypty symulacyjne w Pythonie (OOP)** — wzorem mumax+ warstwa skryptowa to pakiet Python `fullmag`.
> Nie ma własnego DSL ani parsera. Użytkownik pisze obiektowy Python, który buduje `ProblemIR`.

## Top-level layout

- `apps/web` — Next.js control room for editing problems, launching jobs, and browsing artifacts.
- `packages/fullmag-py` — **pakiet Python (`fullmag`)**: obiektowy interfejs do definiowania problemów symulacyjnych, walidacja (pydantic), serializacja `ProblemIR`.
- `crates/fullmag-ir` — canonical domain model and serializable IR.
- `crates/fullmag-cli` — local CLI for validation, planning, and development workflows.
- `crates/fullmag-api` — HTTP entrypoint for the control plane.
- `native/` — C ABI and backend implementations for FDM/FEM/hybrid compute work.
- `proto/` — API and worker contracts.
- `docs/` — scope, ADRs, specifications, physics notes, and future implementation plans.
- `docs/physics` — obowiązkowa dokumentacja naukowa dla każdej implementowanej funkcji fizycznej lub numerycznej.

## Near-term MVP flow

1. Author or edit a problem spec **jako skrypt Pythonowy** (`import fullmag as fm`).
2. Najpierw opisz nową fizykę lub numerykę w `docs/physics/` jak notatkę naukową.
3. Python API buduje i waliduje `ProblemIR` (pydantic + type hints).
4. Serializacja IR (JSON/protobuf) do Rust control-plane.
5. Validate against execution mode and backend capabilities (Rust-side).
6. Lower to an execution plan.
7. Dispatch to a backend worker.
8. Persist artifacts and provenance.
9. Inspect results in web UI.
