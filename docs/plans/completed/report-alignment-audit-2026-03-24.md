# Report Alignment Audit Against the Local Worktree

- Status: active
- Last updated: 2026-03-24
- Parent target architecture: `docs/specs/fullmag-application-architecture-v2.md`
- Related status docs:
  - `docs/plans/active/implementation-status-and-next-plans-2026-03-23.md`
  - `docs/specs/session-run-api-v1.md`
  - `docs/specs/capability-matrix-v0.md`

## 1. Why this document exists

An external review summarized the repository as "close, but still not one coherent application".

That conclusion was directionally useful, but it was based on a public repository state that no
longer exactly matches the current local worktree.

This document records the honest alignment between:

1. the external report,
2. the current local implementation,
3. the remaining real gaps.

## 2. Executive verdict

The report is **directionally correct** about the historical drift between specs, launcher model,
runtime shell, and executable scope.

It is **not fully up to date** for the local worktree.

### 2.1 What the report gets right

- the repository needed one canonical application story,
- the narrow executable solver baseline had to stay honest,
- the product shell mattered more than adding more physics immediately,
- session/run/control-room work remained an important integration axis.

### 2.2 What is now outdated in the report

Several of the report's main criticisms are no longer fully true locally:

- the public launcher is no longer Python-owned,
- `Study` is no longer absent from the public model,
- `StudyIR` is no longer absent from the Rust contract,
- a bootstrap session/run shell now exists in code,
- the README is no longer describing only a planning scaffold.

### 2.3 What remains genuinely open

The following concerns remain real:

- capability vocabulary is still inconsistent across specs,
- the session shell exists only in bootstrap form,
- the browser control room is still only a first slice,
- the GPU/FDM path is not yet a fully closed, verified product milestone.

## 3. Report claims versus local reality

## 3.1 Launcher ownership

### Report claim

The public `fullmag` launcher is still Python-owned.

### Local reality

This is no longer true in the local worktree.

The Rust CLI host now accepts the normal user flow:

```bash
fullmag script.py
```

and delegates script loading through a spawned Python helper.

Relevant implementation:

- `crates/fullmag-cli/src/main.rs`
- `packages/fullmag-py/src/fullmag/runtime/helper.py`
- `packages/fullmag-py/pyproject.toml`

### Audit status

**Closed locally**, though packaging polish still remains a practical concern.

## 3.2 Missing `Study` in the public model

### Report claim

The public model still has only `Problem(..., dynamics=..., outputs=...)` and does not have a
real `Study` layer.

### Local reality

This is no longer true in the local worktree.

The Python API now exposes:

- `TimeEvolution`
- a `study=` pathway on `Problem`
- a compatibility shim that still accepts the older `dynamics + outputs` shape

Relevant implementation:

- `packages/fullmag-py/src/fullmag/model/study.py`
- `packages/fullmag-py/src/fullmag/model/problem.py`
- `packages/fullmag-py/src/fullmag/model/__init__.py`
- `packages/fullmag-py/src/fullmag/__init__.py`

### Audit status

**Closed locally**.

## 3.3 Missing `StudyIR`

### Report claim

The Rust side still revolves around `DynamicsIR` only and does not yet have `StudyIR`.

### Local reality

This is no longer true in the local worktree.

The canonical IR now contains typed `StudyIR`, and planning uses `problem.study`.

Relevant implementation:

- `crates/fullmag-ir/src/lib.rs`
- `crates/fullmag-plan/src/lib.rs`

### Audit status

**Closed locally**.

## 3.4 Missing session/run shell in code

### Report claim

The code still lacks real session/run API surfaces and still lacks a run-first control room.

### Local reality

This is only **partially true**.

The current local worktree now includes:

- bootstrap file-backed session manifests,
- bootstrap session/run API routes,
- a first `/runs/[id]` route in the web app.

Relevant implementation:

- `crates/fullmag-api/src/main.rs`
- `apps/web/app/runs/[id]/page.tsx`

What still remains missing:

- richer in-memory session lifecycle ownership,
- polished browser-opened live loop,
- production-grade event streaming semantics,
- a deeper control-room UI.

### Audit status

**Partially closed**.

## 3.5 README still tells an obsolete story

### Report claim

The root README still describes the repository as a planning-first scaffold and not as a project
with a real executable path.

### Local reality

This is no longer true in the local worktree.

The root README now describes:

- the Rust-hosted launcher,
- the `Model + Study + Runtime` API,
- the session/bootstrap shell,
- the current executable baseline.

Relevant implementation:

- `readme.md`

### Audit status

**Closed locally**.

## 3.6 Capability/status vocabulary mismatch

### Report claim

The architecture uses a four-state capability vocabulary, while the capability matrix still uses
an older status model.

### Local reality

This is still true.

The v2 architecture speaks in terms of:

- `semantic_only`
- `planned`
- `internal_reference`
- `public_executable`

while `docs/specs/capability-matrix-v0.md` still uses the earlier three-tier model:

- `semantic-only`
- `internal-reference`
- `public-executable`

### Audit status

**Still open**.

This is currently the clearest remaining docs-level inconsistency.

## 4. Honest current state after the audit

The repository is now best described as:

> a real executable exchange-only baseline plus a bootstrap application shell under the v2 target architecture

That is stronger than "planning-only", but weaker than "fully coherent finished product shell".

### 4.1 What is now coherent

- one canonical target architecture,
- one launcher ownership model,
- one public model split:
  - model
  - study
  - runtime
- one typed IR direction through `StudyIR`,
- one narrow executable baseline,
- one bootstrap session/run shell,
- one README that roughly matches the code.

### 4.2 What is still not fully coherent

- capability-state language across specs,
- session shell depth,
- live browser behavior,
- GPU/FDM product closeout,
- final runtime hardening and packaging polish.

## 5. Recommended next fixes after this audit

The smallest remaining alignment set is now:

1. **unify capability vocabulary**
   - update `docs/specs/capability-matrix-v0.md`
   - use the same status terms everywhere

2. **deepen the bootstrap session shell**
   - harden `/v1/sessions/*`
   - harden `/v1/runs/*`
   - stabilize event payloads

3. **harden `/runs/[id]` into the real first screen**
   - artifacts
   - logs
   - provenance
   - live status updates

4. **close GPU/FDM honestly**
   - wire the CUDA path all the way through the runtime shell
   - verify parity and calibration
   - update `0300` and capability docs to match the real milestone

## 6. Non-goals of this audit

This document does not redefine architecture.

It only records whether the code and docs are aligned with the already accepted architecture.

For target product truth, read:

- `docs/specs/fullmag-application-architecture-v2.md`

For current sequencing, read:

- `docs/plans/active/implementation-status-and-next-plans-2026-03-23.md`
