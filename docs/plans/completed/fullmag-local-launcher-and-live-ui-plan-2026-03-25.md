# Fullmag Local Launcher And Live UI Plan

- Status: active productization plan
- Last updated: 2026-03-25
- Parent specs:
  - `docs/specs/fullmag-application-architecture-v2.md`
  - `docs/specs/runtime-distribution-and-managed-backends-v1.md`
  - `docs/specs/session-run-api-v1.md`

## 1. Purpose

This plan defines how Fullmag reaches the user-facing workflow:

```bash
fullmag examples/py_layer_hole_relax_150nm.py
```

with these product properties:

1. the script already owns the runtime policy,
2. the launcher resolves the runtime automatically,
3. the local browser control room is started before compute begins,
4. the user sees a session URL immediately and can observe progress live,
5. containerized heavy runtimes remain internal execution details rather than the primary user UX.

This plan is intentionally separate from backend numerics plans. It is about product workflow,
runtime resolution, build entrypoints, and live control-room behavior.

---

## 2. Verified current state

## 2.1 What is already true

- `fullmag script.py` is the main launcher path.
- scripts can already carry runtime policy, for example:
  - `runtime=fm.backend.engine("fdm").cuda(1)`
- the launcher now writes session metadata before solver execution and announces `session_id`
  immediately after session creation.
- host-side local runs can already auto-bootstrap:
  - local API,
  - local Next.js control room,
  - browser open attempt.
- a manual dev control-room workflow exists:
  - `./scripts/dev-control-room.sh`
- heavy FEM GPU development is already split into a managed runtime container:
  - `docker/fem-gpu/Dockerfile`

## 2.2 What is still not product-grade

- there is no canonical `justfile` command surface; workflow is split between raw `cargo`,
  `make`, and ad-hoc container commands.
- the current `FEM GPU` path is still developer-oriented and container-oriented.
- the containerized `FEM GPU` command spends time building before a session exists, so live
  observation starts too late for a good product UX.
- the current host/control-room split for containerized compute is understandable only to a
  developer, not a normal user.
- `FEM CUDA` is not yet numerically aligned with `FEM CPU/FDM` for the `py_layer_hole_relax_150nm`
  case, so it is not yet a production runtime.

---

## 3. Product target

## 3.1 Canonical local UX

The production contract for a local Linux user is:

```bash
fullmag my_problem.py
```

Expected behavior:

1. resolve the script path,
2. spawn the Python helper,
3. build and validate canonical `ProblemIR`,
4. create a session immediately,
5. start local API and local control room before compute,
6. print the session URL immediately,
7. optionally open the browser,
8. start the selected compute runtime,
9. stream progress to the session and control room.

The user should not need to manually decide:

- whether to start a separate web server,
- whether to run a container,
- how to find the session URL,
- how to map `script runtime policy -> backend runtime`.

## 3.2 Production versus developer workflow

Two workflows should coexist, but only one is the public default.

### Production default

```bash
fullmag my_problem.py
```

- host launcher owns session bootstrap,
- host launcher owns API + browser UI bootstrap,
- host launcher resolves local runtime versus managed runtime,
- user only sees one application.

### Developer workflow

- `just control-room`
- `just fem-gpu-headless ...`
- manual `docker compose ...`

This remains useful for debugging, but must not be the main documented product workflow.

---

## 4. Build and launch contract

## 4.1 New command surface

The repository should expose one consistent task layer through `justfile`.

Minimum commands:

- `just build fullmag`
- `just build fullmag-host`
- `just build fem-gpu-runtime-host`
- `just package fullmag`
- `just build fem-gpu-runtime`
- `just run examples/py_layer_hole_relax_150nm.py`
- `just control-room`
- `just control-room-stop`

These are developer and packager entrypoints, not replacements for the public `fullmag` launcher.

## 4.2 Meaning of `just build fullmag`

`just build fullmag` should produce a usable local launcher installation:

- `.fullmag/local/bin/fullmag`
- local wrapper script
- any colocated runtime libraries needed for the local path

This is the minimal “build the application” contract for development and packaging.

It does not imply that all heavy runtimes are statically embedded in one ELF.

## 4.3 Meaning of `just build fem-gpu-runtime-host`

This command must:

1. use the managed `fem-gpu` build environment,
2. compile the heavy FEM GPU runtime there,
3. export a host-usable runtime bundle back into the repository workspace.

The output is a host artifact, not merely a built container image.

This is the canonical meaning of:

- build in container,
- run from host.

---

## 5. Runtime-resolution target

## 5.1 Script-owned policy

The script should be the primary source of truth for runtime intent.

Examples:

```python
runtime=fm.backend.engine("fdm").cuda(1)
runtime=fm.backend.engine("fem").gpu(1).device(0)
runtime=fm.backend.cpu().threads(31).engine("fem")
```

CLI flags remain explicit overrides, but normal usage should not need them.

## 5.2 Launcher-owned resolution

The launcher must translate script intent into one of:

- local CPU execution,
- local CUDA FDM execution,
- managed FEM GPU runtime execution,
- future HPC/runtime-pack execution.

For heavy managed runtimes, the launcher must still keep the host-side session/API/UI local and
stable.

That means:

- compute may happen in a container,
- but the session spine stays host-owned.

---

## 6. Live control-room target

## 6.1 Required ordering

For non-headless product runs, the required order is:

1. create session,
2. print `session_id`,
3. start API,
4. start web control room,
5. print clickable URL,
6. open browser,
7. only then start compute.

This ordering is required because Fullmag is intended to feel like mumax-style live observation.

## 6.2 Required behavior for slow runtime startup

If compute runtime startup is slow, the control room must still already exist.

The UI should show at least:

- session metadata,
- runtime resolution state,
- run state such as `starting_runtime`,
- step `0` initial state when available,
- logs/progress while the compute runtime is warming up.

This removes the current confusion where a user waits on build/startup before seeing any session.

## 6.3 Headless mode

`--headless` remains valid and suppresses browser/bootstrap behavior.

But even in headless mode, the launcher should still:

- create the session immediately,
- print the session id immediately,
- print an explicit manual control-room hint.

---

## 7. Missing implementation pieces

## 7.1 Launcher-to-managed-runtime bridge

Still missing:

- host-side runtime resolver for “run this script in managed `fem-gpu` runtime”
- stable handoff contract from host launcher to containerized compute worker
- host-owned session persistence while compute is remote/containerized
- automatic session URL printing before container build/startup

## 7.2 Host-owned web shell for managed runtimes

Still missing:

- one command that starts host API + host control room and then launches managed compute
- removal of the need for manual two-terminal workflows for normal use
- clean signaling in UI/logs of:
  - `resolving_runtime`
  - `starting_runtime`
  - `running`
  - `completed`

## 7.3 Production qualification of FEM GPU

Still missing:

- numerical parity of `FEM CUDA` with `FEM CPU/FDM`
- stable demag behavior for `py_layer_hole_relax_150nm`
- runtime packaging qualified enough to be selected automatically for normal users

Until this is true, `FEM GPU` remains a developer/runtime-under-construction path.

## 7.4 Packaging

Still missing:

- packaging of the launcher as a normal Linux application artifact
  - `AppImage`, `.deb`, or `.rpm`
- stable packaging of colocated local runtime libraries
- productized runtime installation/update/remove flows

---

## 8. Milestones

## M0 — Command surface consolidation

Deliverables:

- `justfile` with canonical dev build/run tasks
- documented `just build fullmag`
- documented `just build fem-gpu-runtime-host`
- documented `just package fullmag`
- no loss of current `make` workflows

Acceptance:

- `just build fullmag`
- `just run examples/py_layer_hole_relax_150nm.py`

## M1 — Host-owned live session bootstrap

Deliverables:

- host session created before compute,
- host API started before compute,
- host control room started before compute,
- URL printed before compute.

Acceptance:

- user sees session URL before first heavy runtime startup step,
- UI shows a live run shell even while runtime warms up.

## M2 — Managed runtime adapter

Deliverables:

- host launcher can resolve script runtime policy to managed `fem-gpu`
- compute runs in managed runtime without the user typing `docker compose`

Acceptance:

- `fullmag my_problem.py`
  launches host UI and managed compute automatically.

## M3 — Production qualification of FEM GPU

Deliverables:

- `FEM CUDA` parity checks against `FEM CPU/FDM`
- stable `py_layer_hole_relax_150nm` run
- honest provenance of selected runtime

Acceptance:

- `FEM CUDA` can be a default managed runtime candidate for suitable scripts.

## M4 — Packaged application

Deliverables:

- packageable launcher artifact
- product docs describing one application with managed runtimes underneath

Acceptance:

- installer or package produces a normal local `fullmag` command without raw repo steps.

---

## 9. Immediate next actions

1. Add `justfile` and make it the canonical workflow layer for repository tasks.
2. Keep `make` for legacy/dev continuity, but point new instructions at `just`.
3. Add one host-side wrapper workflow that starts API/control room first and then launches compute.
4. Move containerized `FEM GPU` under launcher ownership instead of user-owned `docker compose run`.
5. Finish `FEM CUDA` numerical alignment before treating it as a production runtime.
