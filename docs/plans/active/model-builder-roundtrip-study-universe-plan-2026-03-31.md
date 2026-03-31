# Fullmag Model Builder Round-Trip Plan

## Summary
This document captures the target architecture and the implementation direction for the new Fullmag Model Builder. The goal is to make the model builder round-trip cleanly between:

- Python scripts
- the semantic in-memory model
- the UI tree and inspector
- the executable `Problem` lowered to runtime

The new public Python surface is `study`-based and intentionally stays close to the current examples:

```python
study = fm.study("example")

body = study.geometry(...)
body.Ms = ...
body.Aex = ...
body.alpha = ...
body.m = ...

study.solver(...)
study.relax(...)
study.run(...)
```

The core design principles are:

- the semantic graph is the only source of truth
- the UI behaves like a command-based editor: every action maps to a semantic builder command
- Python is a canonical projection of the graph, not the primary storage format
- the model may express more than the current runtime can execute
- runtime constraints are reported through diagnostics and capabilities, not by shrinking the builder model

## Goals

### Product goals
- Make the UI tree reflect the exact conceptual structure of a simulation.
- Make Python and UI symmetric enough that editing in one can be represented in the other.
- Support more than one ferromagnetic object in one study.
- Support a study-level `Universe` that can describe the world/domain for FDM and the air-box source for FEM.
- Make object selection in the Study Builder drive object highlighting in 3D.

### Technical goals
- Replace the current lossy flat builder view with a canonical semantic graph.
- Introduce a study-root Python API without forcing a large stylistic rewrite of examples.
- Preserve compatibility during migration through a flat-API shim.
- Create a clean place for global mesh defaults and per-object mesh overrides.

## Current-state diagnosis
- The repo already has a strong semantic model centered on `Problem`, `Ferromagnet`, `Material`, `Geometry`, and `Study`.
- The current flat `world.py` API looks object-like at the magnet level, but still lowers a lot of state globally.
- The current builder-facing UI is mostly driven by ad-hoc frontend state and a flat geometry draft, not by one canonical graph.
- The repo already emits a `runtime_metadata.model_builder` manifest, but the main UI tree is still manually assembled.
- FDM and FEM execution already expose enough structure to seed the new design, but several multi-object and per-object mesh behaviors remain partial.

## Target architecture

### 1. One canonical root: `StudyBuilder`
Every builder session is rooted in a `StudyBuilder`. The builder owns:

- `Universe`
- `Objects`
- `Physics`
- `Mesh Defaults`
- `Study`
- `Outputs`
- `Capabilities`

The Python DSL should map to that structure directly:

```python
study = fm.study("nanoflower")
study.engine("fem")
study.universe(...)

flower = study.geometry(...)
flower.Ms = ...
flower.m = ...
flower.mesh(...)

study.mesh(...)
study.b_ext(...)
study.solver(...)
study.relax(...)
study.run(...)
```

### 2. One canonical graph: `model_builder.v2`
The new builder contract is a graph, not a flat draft. It must contain:

- `study`
- `universe`
- `objects`
- `physics`
- `mesh_defaults`
- `solver`
- `stages`
- `outputs`
- `current_modules`
- `mechanics`
- `capabilities`
- `source_contract`

The UI tree is a projection of this graph. The Python emitter is a projection of this graph. Lowering to `Problem` is a projection of this graph.

### 3. Round-trip model
The desired round-trip is:

1. Run Python in builder capture mode.
2. Record semantic builder operations and construct a semantic graph.
3. Present and mutate that graph in the UI.
4. Emit a deterministic canonical Python script from the graph.
5. Re-load that script into the same graph shape.

The implementation should avoid AST patching as the main path. A full-file deterministic rewrite is preferred.

## Universe

### Why `Universe` exists
The simulation needs a study-level spatial envelope.

For FDM:
- it defines the world/domain box used for the regular grid
- it allows explicit control over empty space around objects
- it creates a stable place for world extent and origin

For FEM:
- it acts as the study-level source for air-box generation
- it provides a stable domain concept even when the magnetic geometry is smaller than the outer domain

### Universe representation
`Universe` is a rectangular box described by:

- `mode: "auto" | "manual"`
- `size: (sx, sy, sz)`
- `center: (cx, cy, cz)`
- `padding: (px, py, pz)`

In addition, the model tracks:

- `effective_size`
- `effective_center`

### Universe semantics
`mode="auto"`:
- the universe auto-fits the object bounding box
- padding expands the fitted size
- moving or editing geometry updates the effective universe automatically

`mode="manual"`:
- the declared size and center are used directly
- the universe is not silently modified by geometry edits
- a separate `FitUniverseToObjects` action can update the declared values explicitly

### Universe overflow policy
The builder uses:
- auto-expand behavior in `auto` mode
- stable declared values in `manual` mode

This keeps the UI ergonomic while preserving explicit control when the user locks the domain.

### Universe lowering
FDM:
- the universe defines the world box
- `grid_origin = center - size / 2`
- extents are snapped to the cell lattice
- snapped values belong in `effective_values`, not in the declared config

FEM:
- the universe is the preferred air-box source
- the explicit-universe path should coexist with legacy factor-based air-box generation
- when the mesh already contains air elements, the universe may become informational and diagnostics must reflect that

## Objects and geometry

### Object model
The main editable entity is not raw geometry but a physical object, initially a ferromagnet.

Each object holds:

- `name`
- `kind = "ferromagnet"`
- `geometry_stack`
- `material`
- `initial_state`
- `mesh`
- `diagnostics`
- `effective_values`

### Geometry stack
Geometry is stored as a sequence of semantic operations, not a flattened parameter bag.

Supported operations:

- `primitive_box`
- `primitive_cylinder`
- `primitive_ellipsoid`
- `imported_geometry`
- `translate`
- `rotate`
- `scale`
- `union`
- `difference`
- `intersection`

Each op stores:

- `op_id`
- `op_kind`
- `args`
- `enabled`

This is the key requirement for Blender-like behavior: every UI action should correspond to a semantic operation that can also be emitted to Python.

### Material and state
Each object stores its own:

- `Ms`
- `Aex`
- `alpha`
- optional additional material law fields later
- `m0` / initial state

The public Python stays property-based:

```python
body.Ms = ...
body.Aex = ...
body.alpha = ...
body.m = fm.uniform(...)
```

## Mesh model

### Global vs per-object mesh
The first supported FEM inheritance model is intentionally simple:

- every object uses `mesh_mode = "inherit" | "custom"`

`inherit`:
- the object uses the full study-level FEM mesh defaults

`custom`:
- the object uses a local mesh override and no longer follows global changes

This is preferred over a layered partial-merge model for the first implementation because it is much easier to explain, render, test, and round-trip.

### Mesh defaults
Study-level mesh defaults contain:

FDM:
- default cell size
- optional per-object native grid hints
- demag strategy metadata

FEM:
- global `hmax`
- global `order`
- optional source mesh
- air-box policy metadata

### Per-object mesh
Each object stores:

- `mesh_mode`
- `mesh_override` when custom
- `effective_mesh`

The UI must support:

- `Use Global Mesh`
- `Customize Mesh`
- `Reset To Global`

### Behavior rules
Changing global FEM mesh defaults:
- updates only objects in `inherit`
- leaves `custom` objects unchanged

Example:
- `nanoflower_A`: inherit
- `nanoflower_B`: custom(hmax=20nm)

Changing global `hmax`:
- updates `nanoflower_A`
- does not touch `nanoflower_B`

## Selection and 3D interaction

### Selection state
The builder needs a dedicated semantic selection state:

- `selected_object_id`

This is separate from generic tree node selection.

### Viewport behavior
When an object is selected in the Study Builder:

- the selected object is highlighted
- other objects are slightly dimmed
- the scene remains visible

This provides context without hiding the rest of the study.

### Camera behavior
Selecting an object:
- does not auto-move the camera

Separate actions:
- `Focus Object`
- optional double-click tree behavior later

### Rendering inputs
The viewport should receive:

- `selected_object_id`
- per-object bounds
- lightweight object render/selection descriptors

The repo already has the right general pattern for this in overlay-specific highlighting; the object highlight path should follow the same idea.

## Python API surface

### New canonical API
The public API becomes `study`-based:

```python
study = fm.study("example")
study.engine("fdm")
study.universe(...)

body = study.geometry(...)
body.Ms = ...
body.Aex = ...
body.alpha = ...
body.m = fm.uniform(...)

study.cell(...)
study.mesh(...)
study.b_ext(...)
study.solver(...)
study.relax(...)
study.run(...)
```

### Compatibility
The existing flat API remains temporarily as a shim:

- `fm.geometry(...)`
- `fm.solver(...)`
- `fm.run(...)`
- etc.

The shim exists for compatibility only. New examples and the future emitter should use the `study`-based API.

### Example migration policy
Existing example scripts should change minimally:

- add `study = fm.study(...)`
- move study-wide calls from `fm.*` to `study.*`
- keep object handles and property-style assignments
- keep object-local `mesh(...)` calls for custom FEM mesh overrides

## UI tree shape

### FDM study tree
```text
Study
├─ Universe
│  ├─ mode
│  ├─ size
│  ├─ center
│  └─ effective grid
├─ Objects
│  └─ nanoflower
│     ├─ Geometry Stack
│     ├─ Material & State
│     └─ Mesh
│        └─ inherit global FDM grid
├─ Physics
├─ Mesh Defaults
├─ Study
└─ Outputs
```

### FEM study tree
```text
Study
├─ Universe
│  ├─ mode
│  ├─ size
│  ├─ center
│  └─ role: air-box source
├─ Objects
│  ├─ nanoflower_A
│  │  ├─ Geometry Stack
│  │  ├─ Material & State
│  │  └─ Mesh
│  │     └─ mode: inherit
│  └─ nanoflower_B
│     ├─ Geometry Stack
│     ├─ Material & State
│     └─ Mesh
│        └─ mode: custom
├─ Physics
├─ Mesh Defaults
├─ Study
└─ Outputs
```

## Command model
UI mutations should flow only through semantic commands. Initial command set:

- `AddObject`
- `RemoveObject`
- `RenameObject`
- `InsertGeometryOp`
- `UpdateGeometryOp`
- `MoveGeometryOp`
- `DeleteGeometryOp`
- `SetMaterialField`
- `SetInitialState`
- `SetMeshDefaults`
- `SetObjectMeshMode`
- `SetMeshOverride`
- `ResetObjectMeshToGlobal`
- `SetUniverseMode`
- `SetUniverseSize`
- `SetUniverseCenter`
- `SetUniversePadding`
- `FitUniverseToObjects`
- `SetPhysicsTerm`
- `SetSolver`
- `UpsertStage`
- `SetOutputs`
- `SelectObject`
- `FocusObject`

This command model is important for deterministic round-trip behavior and future undo/redo.

## Capabilities and diagnostics
The builder model may express more than the runtime currently executes. The capability layer must surface:

- multi-object support by backend
- preview support by backend and plan type
- per-object mesh support
- explicit-universe support
- explicit-air-box support
- unsupported combinations and downgrade reasons

The builder should not hide model features simply because a backend is not yet ready. Instead, it must explain what is or is not executable.

## Implementation plan

### Tranche 1
Seed the new public surface without breaking the existing runtime path:

- add `fm.study()`
- add `StudyBuilder`
- add `study.universe(...)`
- persist study/universe metadata into built problems
- include universe in the builder manifest
- convert at least one example to the new style
- add tests

### Tranche 2
Start the semantic graph transition:

- replace the flat geometry draft with graph-shaped builder state
- add explicit universe to frontend state
- project the tree from graph nodes instead of manual assembly

### Tranche 3
Move the Python emitter to the canonical `study`-based style:

- deterministic full-file rewrite
- canonical object order and operation order
- explicit universe emission
- mesh defaults + object mesh modes in script output

### Tranche 4
Wire visualization and selection:

- semantic object selection state
- 3D object highlighting and dimming
- focus action
- object-aware overlays

### Tranche 5
Lowering and runtime alignment:

- FDM world box lowering from universe
- FEM explicit air-box lowering from universe
- capability diagnostics for unsupported paths

## Test plan

### Semantic round-trip
- canonical script -> graph -> canonical script -> graph
- operation order stays stable
- no semantic loss across re-load

### Universe
- auto mode tracks objects
- manual mode stays fixed
- padding is applied correctly
- FDM snapped values are exposed as effective values
- FEM explicit air-box data is preserved

### Mesh inheritance
- global FEM mesh updates affect inherit objects only
- custom object mesh stays unchanged
- reset-to-global restores inheritance

### Multi-object selection
- selecting one object highlights it
- others dim but remain visible
- focus action works independently

### Migration and compatibility
- flat API still works through the shim
- new `study`-based scripts load successfully
- old examples still lower correctly after minimal migration

### Diagnostics
- unsupported runtime paths surface as diagnostics instead of silent failure

## Assumptions
- The semantic graph is the source of truth.
- The canonical public Python style is `study`-based.
- Property-style object configuration remains supported.
- Universe is modeled as `size + center`, not `bounds_min + bounds_max`.
- The first FEM global/local mesh relationship is `inherit | custom`.
- Selection highlights the object and dims others instead of isolating the scene.
- Camera focus is a separate explicit action.
- Full-file deterministic rewrite is preferred over AST patching.
