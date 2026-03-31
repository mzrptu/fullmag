# Script Model Builder And Runtime Resolution — 2026-03-29

## Goal

Make the public `fullmag` launcher behave like one application driven by the Python-authored model:

- the Python script remains the source of intent,
- the launcher resolves runtime from the script/model,
- the GUI sees a semantic model-builder contract instead of only opaque `script_source`,
- future `UI -> canonical Python rewrite` can be built on the same contract.

This is intentionally closer to the COMSOL-style mental model:

- user authors a model in Python,
- Fullmag materializes a semantic builder model,
- the UI operates on that builder model,
- the script becomes a canonical projection of the model rather than the only editable storage format.

## Implemented In This Slice

### 1. Script-aware runtime resolution

Added a hidden CLI path:

- `fullmag resolve-runtime-invocation --shell -- <original invocation>`

It:

- recognizes script mode using the same argument contract as the public launcher,
- loads the script through the Python helper,
- exports a lightweight `ProblemIR` without heavy geometry assets,
- resolves requested backend/device/precision from the script-owned model,
- emits the preferred runtime family (`cpu-reference`, `fdm-cuda`, `fem-gpu`, ...),
- reports whether managed FEM GPU runtime is required.

The repo-local wrapper in `.fullmag/local/bin/fullmag` now uses this resolver at launch time.

Consequence:

- runtime dispatch is no longer gated only by stale `launcher-build-mode`,
- `fem + cuda` can route to managed FEM GPU runtime even when the local host launcher itself is only `cuda`,
- `fdm + cuda` stays on the local CUDA worker.

### 2. Lightweight capture path for runtime probing

Added a lightweight capture mode to the Python flat-script loader:

- explicit `mesh.build()` / `build_mesh()` during script capture no longer materializes heavy assets when the resolver only needs intent,
- mesh intent is preserved,
- startup runtime detection avoids accidental second meshing pass.

### 3. Model-builder metadata in `ProblemIR`

Each materialized `ProblemIR.problem_meta.runtime_metadata` now carries:

- `model_builder`
- `script_sync`

The builder payload includes:

- source kind (`flat_script`, `build_function`, `problem_object`, ...),
- entrypoint kind,
- editable scopes,
- runtime/material/geometry/energy/study/discretization semantic payload,
- mesh workflow metadata when present.

This is the first stable contract intended for GUI-backed model editing.

### 4. GUI visibility

Control-room settings now expose a `Script Builder` section showing:

- builder source kind,
- entrypoint,
- canonical rewrite strategy,
- current phase,
- editable scopes.

This makes the builder contract visible to the user and keeps future UI editing aligned with one source of truth.

## Verified

- `cargo check -p fullmag-cli -p fullmag-runner`
- `PYTHONPYCACHEPREFIX=/tmp/fullmag-pyc python3 -m py_compile ...problem.py ...helper.py ...loader.py ...world.py`
- `./apps/web/node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json`
- smoke via `cargo run -p fullmag-cli -- resolve-runtime-invocation --shell -- examples/nanoflower_fem.py`
- smoke via repo-local wrapper `.fullmag/local/bin/fullmag resolve-runtime-invocation --shell -- examples/nanoflower_fem.py`
- smoke via repo-local wrapper `.fullmag/local/bin/fullmag resolve-runtime-invocation --shell -- examples/nanoflower_fdm.py`

Observed resolution:

- FEM script requesting CUDA resolves to `preferred_runtime_family=fem-gpu` and `requires_managed_runtime=1`
- FDM script requesting CUDA resolves to `preferred_runtime_family=fdm-cuda` and stays local

## Implemented Since Then

The first end-to-end `UI -> canonical Python rewrite` slice is now in place for current live workspaces:

1. Python helper gained `rewrite-script`, which loads the original script in lightweight mode, rebuilds a canonical flat-script projection, and can write it back atomically.
2. The renderer supports:
   - flat scripts,
   - `build() -> Problem`,
   - top-level `problem = Problem(...)`.
3. The control-room API exposes `POST /v1/live/current/script/sync`.
4. The `Script Builder` panel now has a real `Sync UI To Script` action.
5. Current mesh and solver panel values are passed as rewrite overrides, so the rewritten `.py` reflects UI-edited `Mesh` and `Solver` settings instead of only the last materialized script state.

This closes the “foundation only” gap and turns the builder contract into a working round-trip for the most important current workflows.

## Implemented After That

The current live workspace now has a real session-local `script_builder` store for the first editable scopes:

1. Python helper exposes `export-builder-draft`, which projects builder-owned `solver` and `mesh` state from the source script.
2. `fullmag-api` stores that draft on the current live snapshot and serves it through bootstrap / WS snapshot events.
3. The control room hydrates `Solver` and `Mesh` panels from `script_builder` once per session instead of relying only on backend-plan inspection.
4. Panel edits are now persisted back into the session-local builder store via `POST /v1/live/current/script/builder`.
5. `Sync UI To Script` first flushes the latest builder draft, then asks the Python side to rewrite canonical `.py` from the stored builder state.

Consequence:

- `Mesh` and `Solver` no longer travel only as one-shot rewrite overrides,
- the session now has an explicit editable builder draft,
- “sync to script” became a commit/finalize step over builder state rather than the only place where UI edits exist.

## Remaining Next Step

Broaden persistent builder mutations beyond `mesh` and `solver`:

1. define first-class session-local builder slices for `geometry`, `materials`, and `study`,
2. let the tree/selection model in the GUI edit those slices directly,
3. support preview-before-write and optional auto-sync semantics on top of the same builder store,
4. add conflict-aware script rewrite for advanced constructs instead of fail-fast only,
5. eventually make the Python script a canonical projection of a richer session builder graph, not just a flat rewrite target.
