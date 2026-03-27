# Fullmag Self-Contained Production Distribution Plan

- Status: active productization plan
- Last updated: 2026-03-27
- Parent specs:
  - `docs/specs/fullmag-application-architecture-v2.md`
  - `docs/specs/runtime-distribution-and-managed-backends-v1.md`
  - `docs/specs/session-run-api-v1.md`
- Related plans:
  - `docs/plans/active/fullmag-local-launcher-and-live-ui-plan-2026-03-25.md`

## 1. Purpose

This plan defines how Fullmag reaches a real production distribution model where a Linux user can:

```bash
download -> unpack/install -> run fullmag my_problem.py
```

without requiring:

- Docker,
- Podman,
- manual CUDA toolkit installation,
- manual MFEM/libCEED/hypre installation,
- raw `cargo`,
- raw `pnpm`,
- repo checkout,
- developer-only bootstrap steps.

This is a user-distribution plan, not a developer-workflow plan.

Containers may still exist in CI and internal build/export pipelines, but they must not be part of
the normal end-user execution story.

---

## 2. Product rule for this plan

The production Linux workstation experience must be:

```bash
fullmag my_problem.py
```

with these guarantees:

1. one visible application and one launcher,
2. the browser control room works out of the box,
3. Python authoring works out of the box,
4. CPU execution works out of the box,
5. GPU execution does not require the user to know what runtime image or container to run,
6. heavy runtime assets may still be separate artifacts internally, but they must be resolved by
   Fullmag automatically.

For the user, “managed runtime” must mean:

- bundled with the application package, or
- auto-installed by the launcher into a Fullmag-owned runtime directory.

It must not mean:

- “please install Docker first”,
- “please run `docker compose` manually”,
- “please build the solver runtime yourself”.

---

## 3. Non-goals

This plan does not require:

- one giant statically linked binary containing every backend,
- no GPU driver dependency at all,
- first-class Windows packaging in phase 1,
- first-class macOS packaging in phase 1,
- solving current FEM GPU physics parity in this same document.

Important clarification:

- NVIDIA driver availability remains a host prerequisite for CUDA execution.
- That is acceptable.
- CUDA toolkit, MFEM, libCEED, hypre, Rust, Node, and build containers must not be user
  prerequisites.

---

## 4. Target production artifacts

## 4.1 Phase-1 official artifacts

The first production-grade Linux deliverables should be:

1. `fullmag-linux-x86_64-portable.tar.zst`
2. `fullmag-linux-x86_64.AppImage`

Both should contain the same application payload and runtime layout.

The tarball is the simplest reproducible packaging baseline.
The AppImage is the nicer desktop-facing distribution target.

## 4.2 Optional later artifacts

Later, after the portable layout stabilizes:

1. `.deb`
2. `.rpm`

These should be thin wrappers over the same already-stable runtime layout, not a separate product
branch.

---

## 5. Target package layout

The portable application layout should look like:

```text
fullmag/
  bin/
    fullmag
    fullmag-bin
    fullmag-api
  lib/
    ...
  python/
    bin/python3
    ...
  web/
    index.html
    _next/...
    assets/...
  runtimes/
    cpu-reference/
      manifest.json
      lib/...
    fdm-cuda/
      manifest.json
      lib/...
    fem-gpu/
      manifest.json
      lib/...
  share/
    licenses/
    version.json
```

Key rules:

1. `bin/fullmag` remains the only public launcher.
2. `python/` is bundled and private to Fullmag.
3. `web/` contains prebuilt static control-room assets.
4. `runtimes/*` are runtime packs, not developer build outputs.
5. every runtime pack carries a manifest describing version, capabilities, ABI, and requirements.

---

## 6. Target runtime model

## 6.1 Workstation production runtime policy

For end-user Linux workstation builds, the preferred runtime form is:

- unpacked runtime packs on disk,
- resolved by the launcher locally,
- no OCI engine required on the user machine.

This is fully consistent with the existing runtime-distribution spec because that spec already
allows:

- bundled native libraries,
- prebuilt runtime tarballs,
- platform-specific runtime packages.

The current containerized runtime flow should therefore be treated as:

- an internal build/export mechanism,
- not the public workstation execution mechanism.

## 6.2 Runtime families

Initial production families:

1. `cpu-reference`
2. `fdm-cuda`
3. `fem-gpu`

Target meaning:

- `cpu-reference` is always present in the base package,
- `fdm-cuda` should be present in GPU-capable production bundles,
- `fem-gpu` should be present in full GPU production bundles once numerically production-ready.

## 6.3 Runtime resolution behavior

At runtime the launcher should:

1. inspect requested execution policy from script and CLI overrides,
2. inspect bundled/installed runtime manifests,
3. resolve to the best matching runtime,
4. emit the requested and resolved runtime in session metadata,
5. fail with a clear product error if a requested path is not installed.

The launcher must never expose:

- container names,
- Docker image references,
- internal export scripts,
- build-system paths.

---

## 7. What must be bundled

## 7.1 Mandatory in the base package

The base package must contain:

1. launcher binary and wrapper,
2. local API binary,
3. static web control-room assets,
4. private Python runtime,
5. Python Fullmag package payload,
6. CPU runtime,
7. provenance/version metadata,
8. runtime manifests,
9. license payloads for bundled third-party components.

## 7.2 Private Python runtime

If the user is supposed to “just run” a Python-authored simulation, Fullmag must not depend on the
system Python for the primary production path.

Therefore the production bundle should ship a private Python runtime, for example based on:

- `python-build-standalone`, or
- an equivalent redistributable CPython layout.

The bundled launcher should set:

- `FULLMAG_PYTHON`,
- `PYTHONPATH`,
- any Fullmag-specific runtime env,

without user intervention.

## 7.3 Static web shell

The production package must not depend on:

- `pnpm`,
- `node`,
- Next.js dev server

at runtime.

The control room should be delivered as prebuilt static assets served by the host-side launcher/API.

The existing `web-build-static` direction is the correct basis for this.

---

## 8. What must not be required from the user

The following must be removed from the production user path:

1. `docker compose`
2. `make install-cli`
3. `just build fullmag`
4. `scripts/export_fem_gpu_runtime.sh`
5. manually exporting `PYTHONPATH`
6. manually setting `LD_LIBRARY_PATH`
7. checking out the repository just to run Fullmag

Those are packager/dev flows only.

---

## 9. Production build pipeline model

## 9.1 Build-time vs runtime separation

We should make a hard distinction between:

- build pipeline dependencies,
- end-user runtime dependencies.

Build pipeline dependencies may still include:

- Docker/OCI,
- Rust nightly,
- Node/pnpm,
- CUDA build images,
- MFEM/libCEED/hypre toolchains.

End-user runtime dependencies should be reduced to:

- Linux,
- glibc baseline compatible with chosen packaging target,
- browser available on the host,
- NVIDIA driver only when GPU runtime is selected.

## 9.2 Canonical build stages

The release pipeline should become:

1. build static web assets,
2. build host launcher binaries,
3. build/export runtime packs,
4. assemble portable filesystem layout,
5. run smoke tests against assembled artifact,
6. produce tarball,
7. optionally wrap as AppImage,
8. publish checksums and provenance manifest.

## 9.3 Canonical artifact assembly command

We should add an explicit packager command such as:

```bash
just package fullmag-portable
```

which creates the full self-contained artifact, not merely the current staging directory.

The current `just package fullmag` is only a partial staging step.

---

## 10. Required implementation workstreams

## 10.1 Workstream A — Stable portable layout

Deliverables:

1. define canonical install tree under `.fullmag/dist/fullmag-linux-x86_64/`,
2. move from staging layout to release layout,
3. add machine-readable `version.json` and runtime manifests,
4. ensure launcher resolves everything relative to its own install root.

Acceptance:

- package can be moved to another directory and still works,
- package does not depend on repo-relative paths.

## 10.2 Workstream B — Bundled Python runtime

Deliverables:

1. choose redistributable CPython packaging strategy,
2. package Fullmag Python DSL into the portable artifact,
3. update launcher to prefer bundled Python in production mode,
4. verify script execution without host Python.

Acceptance:

- `fullmag my_problem.py` works on a clean host without system Python tooling.

## 10.3 Workstream C — Static control-room packaging

Deliverables:

1. make `apps/web` production build emit fully relocatable assets,
2. serve them from `fullmag-api` or launcher-owned static server,
3. remove runtime dependency on `next dev`,
4. keep local-live session UX unchanged.

Acceptance:

- package starts control room with no Node runtime installed on host.

## 10.4 Workstream D — Runtime pack manifests and resolver

Deliverables:

1. define `runtime manifest` schema,
2. attach manifest to each runtime pack,
3. implement launcher-side runtime discovery,
4. implement compatibility checks:
   - runtime family,
   - version,
   - ABI contract,
   - GPU requirement,
   - driver requirement hints.

Acceptance:

- launcher resolves runtimes locally with no special scripts.

## 10.5 Workstream E — Replace container-first user path

Deliverables:

1. treat `export_fem_gpu_runtime.sh` as internal build/export tool only,
2. ensure released runtime pack is consumed directly by launcher,
3. remove any user-facing documentation that tells users to run containers manually,
4. retain container flow only for CI/packaging/debug.

Acceptance:

- public workstation docs never require Docker for normal use.

## 10.6 Workstream F — Real packaging outputs

Deliverables:

1. tarball packager,
2. AppImage packager,
3. checksum/signature generation,
4. release smoke tests on extracted artifact,
5. release metadata describing included runtimes.

Acceptance:

- a tester can download one artifact and run it on a clean Linux machine.

---

## 11. Product SKUs

We should stop pretending one artifact will fit every operational case equally well.

Recommended initial workstation SKUs:

## 11.1 `fullmag-linux-x86_64-cpu`

Contains:

- launcher,
- API,
- web,
- Python runtime,
- CPU backend.

Pros:

- smallest,
- easiest to validate,
- first artifact to ship.

## 11.2 `fullmag-linux-x86_64-gpu`

Contains:

- everything from CPU SKU,
- CUDA FDM runtime,
- optionally FEM GPU runtime once production-ready.

Pros:

- closest to “download and run” for serious users.

Constraint:

- still depends on compatible NVIDIA driver from host.

## 11.3 Future optional split

If artifact size becomes unacceptable:

- keep one launcher artifact,
- allow additional runtime packs downloaded by `fullmag runtime install ...`.

This is still acceptable as long as:

- the launcher owns the install,
- the user does not need Docker,
- the UX remains productized.

---

## 12. Minimum viable production target

The first honest production target should be:

1. Linux x86_64 portable tarball,
2. bundled Python runtime,
3. bundled static web shell,
4. bundled CPU runtime,
5. optional bundled CUDA FDM runtime,
6. no Docker required on user machine,
7. no repo checkout required,
8. no build tools required.

This is the narrowest target that truly satisfies:

- download,
- run,
- observe in browser,
- execute a real script.

---

## 13. Acceptance criteria

We should not call this “production distribution” until all of the following are true.

## 13.1 Clean-machine CPU acceptance

On a clean Linux machine:

1. unpack artifact,
2. add `bin/` to `PATH`,
3. run `fullmag examples/exchange_relax.py`,
4. control room opens,
5. run completes,
6. no missing system build tools are required.

## 13.2 Clean-machine GPU acceptance

On a clean Linux machine with NVIDIA driver:

1. unpack artifact,
2. run a CUDA-capable FDM example,
3. launcher resolves GPU runtime automatically,
4. control room opens before compute,
5. run completes,
6. no Docker or CUDA toolkit install is required.

## 13.3 Relocatability acceptance

1. move install directory,
2. rerun the same command,
3. application still works.

## 13.4 Provenance acceptance

Session/run metadata must record:

1. requested execution policy,
2. resolved runtime family,
3. runtime pack version,
4. launcher version,
5. artifact build id.

---

## 14. Immediate repo actions

The next concrete repo tasks should be:

1. add a new release-oriented packager that assembles a relocatable portable layout instead of only
   `.fullmag/dist/fullmag-host`,
2. define and implement runtime manifests for `cpu-reference`, `fdm-cuda`, and exported `fem-gpu`,
3. bundle a private Python runtime into the portable artifact,
4. make static web assets part of the release layout and serve them without Node at runtime,
5. add smoke tests that run against the packaged artifact, not just the repo-local launcher.

---

## 15. Recommendation

The repo should explicitly adopt this rule:

- containers are allowed in build/export and CI,
- containers are not part of the default end-user runtime story.

That gives us both:

1. sane, reproducible heavy-backend builds,
2. a real product that can be downloaded and run directly.

This is the correct path if Fullmag is meant to be shipped as an actual application rather than a
developer environment.
