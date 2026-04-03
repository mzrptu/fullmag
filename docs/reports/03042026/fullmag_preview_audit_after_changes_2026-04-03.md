# Fullmag FEM preview audit after latest changes — arrows / HSL / responsive UI

## Executive verdict

The refactor moved the FEM viewport significantly forward:
- `FemMeshView3D` is no longer a single monolith; it now delegates to `ScientificViewportShell`, `FemViewportToolbar`, `FemViewportScene`, `FemPartExplorerPanel`, `FemContextMenu`, and `ViewportOverlayManager`.
- auto-show of the HSL orientation widget is now computed from the effective color state (`showOrientationLegend || legendField === "orientation" || arrowField === "orientation"`).
- the viewport has a shared shell and a first pass at responsive overlay modes (`full` / `compact` / `icon`).

However, the implementation is **not fully finished**.

The main remaining correctness bug is:
- **magnetization arrows are still black because the current `FemArrows` path enables `vertexColors` on the material, but the arrow template geometry only defines `position` and `normal` and does not define a neutral `color` attribute**.

The main remaining UX bug is:
- **the new overlay system is only breakpoint-based, not collision-aware**; gizmos are still anchored independently from the overlay manager, so toolbar / legend / explorer / view cube / HSL sphere can still collide.

## What is already fixed well

### 1. FEM viewport architecture is genuinely improved
Current `FemMeshView3D` is now structured around:
- `ScientificViewportShell`
- `FemViewportToolbar`
- `FemViewportScene`
- `FemPartExplorerPanel`
- `ViewportOverlayManager`
- `FemSelectionHUD` / `FemRefineToolbar`

That is a real architectural improvement over the previous monolithic viewport.

### 2. Orientation widget auto-show is fixed in FEM
The viewport now computes:

```ts
const effectiveShowOrientationLegend =
  showOrientationLegend ||
  legendField === "orientation" ||
  arrowField === "orientation";
```

This is the right behavior and should remove the old “sometimes no HSL sphere” behavior caused purely by a missing parent prop.

### 3. FEM now uses the new shared shell and toolbar
The FEM path is now actually routed through `ScientificViewportShell` and `FemViewportToolbar` instead of drawing the entire toolbar inline in `FemMeshView3D`.

### 4. Legend and part explorer are no longer hard-coded directly inside the viewport body
They are now mounted through `ViewportOverlayManager`, which is the right direction.

## What is still wrong

### A. Black arrows — root cause

#### Current code path
`FemArrows` now uses:
- `MeshBasicMaterial({ vertexColors: true, ... })`
- `mesh.instanceColor = new THREE.InstancedBufferAttribute(...)`
- manual writes into `instanceColor.array`

This looks better than the old code, but the template geometry produced by `useArrowTemplate()` only sets:
- `position`
- `normal`

It does **not** set a `color` attribute.

#### Why this still breaks
With `vertexColors: true`, Three.js enables the `USE_COLOR` shader path.
In the current Three.js shader chunks:
- `color_vertex.glsl.js` initializes `vColor = vec4(1.0)`, then multiplies by `color` when `USE_COLOR` is enabled, and multiplies by `instanceColor.rgb` when `USE_INSTANCING_COLOR` is enabled.
- `color_fragment.glsl.js` applies `vColor` to `diffuseColor` only for the `USE_COLOR` / `USE_COLOR_ALPHA` path.

So if the material has `vertexColors: true` but the geometry does not carry a proper neutral `color` attribute, the final color path is fragile and can collapse to black.

That matches the observed symptom exactly:
- surface shading is colored,
- arrows exist,
- arrows are black already in the initial state.

#### Exact fix
The most direct, robust fix is:

1. Keep `instanceColor`.
2. Keep `vertexColors: true`.
3. Add a neutral white vertex color attribute to the arrow template geometry.

Inside `useArrowTemplate()` after creating `merged`:

```ts
const vertexColors = new Float32Array(totalVerts * 3);
vertexColors.fill(1);
merged.setAttribute("color", new THREE.BufferAttribute(vertexColors, 3));
```

That makes the shader path deterministic:
- vertex color contributes `1,1,1`
- instance color contributes the actual arrow color
- final result is not multiplied by missing / zero vertex color data

#### Secondary cleanup
After that fix, prefer this update path:

```ts
const color = new THREE.Color();
for (let i = 0; i < count; i += 1) {
  color.fromArray(colors, i * 3);
  mesh.setColorAt(i, color);
}
mesh.instanceColor!.needsUpdate = true;
```

This is easier to reason about than manually mutating `instanceColor.array`.

### B. Responsive overlay system is still only half-done
`ViewportOverlayManager` currently does only this:
- observes viewport size,
- computes `mode` from width,
- lets children choose between `full`, `compact`, and `icon`.

What it does **not** do:
- measure overlay bounding boxes,
- resolve collisions,
- move lower-priority overlays,
- dock gizmos together,
- push panels into drawers / overflow automatically.

So the current system is responsive only in a coarse breakpoint sense, not in a real layout-manager sense.

### C. View cube and HSL sphere are still outside the real overlay manager
`ScientificViewportShell` mounts `ViewportGizmoStack` separately.
`ViewportGizmoStack` hard-codes:
- `ViewCube cubeClassName="top-3 right-3"`
- `axisClassName="bottom-5 right-5"`
- HSL sphere position from a class like `top-[118px] right-3`

So the gizmo stack does not participate in the same collision-resolution space as legend / part explorer / warning banners.

### D. Toolbar compact mode is not yet truly viewport-responsive
`FemViewportToolbar` supports `compact`, but in `FemMeshView3D` it is still driven mainly by mesh-part count logic:

```ts
compact={hasMeshParts && meshParts.length > 0 && meshParts.length > 3}
```

That is not actual viewport responsiveness.
A narrow viewport with only one part can still get a toolbar that is too wide.

### E. HSL sphere is improved, but not fully solved as a UX system
The “sometimes missing” problem from state logic is mostly fixed by `effectiveShowOrientationLegend`.
But the widget still depends on a fixed top-right placement and can still visually clash with:
- toolbar
- part explorer
- view cube
- axis gizmo

So the logic bug is largely fixed, but the placement system is not.

## What to patch next, in order

### Priority 1 — fix black arrows
Patch `apps/web/components/preview/r3f/FemArrows.tsx`:

1. Add neutral white vertex color attribute to template geometry.
2. Keep `instanceColor`.
3. Switch color writes to `mesh.setColorAt()` for clarity.
4. Keep `MeshBasicMaterial` for now until correctness is restored.

### Priority 2 — make gizmos part of the overlay layout system
Refactor:
- `ScientificViewportShell.tsx`
- `ViewportGizmoStack.tsx`
- `ViewportOverlayManager.tsx`

So that ViewCube / axis gizmo / HSL sphere are overlay slots with priority, not separately pinned widgets.

### Priority 3 — turn breakpoint mode into real collision management
Extend `ViewportOverlayManager` to:
- measure child slots,
- assign priorities,
- move lower-priority slots,
- collapse low-priority panels into drawers / popovers.

### Priority 4 — make toolbar compactness depend on actual viewport width
Pass `mode` from `ViewportOverlayManager` into the toolbar and derive:
- full
- compact
- overflow

from layout state, not from mesh-part count.

## Minimal acceptance tests

### Arrow color regression
1. Open FEM preview in the initial state with `orientation` arrow coloring.
2. Arrows must show multiple colors immediately.
3. Switching `arrowColorField` between `orientation`, `x`, `y`, `z`, `magnitude` must visibly change colors.
4. Surface and arrows must agree on sign/orientation for a few hand-checked nodes.

### Orientation widget regression
1. Set surface color to `orientation` -> HSL sphere must appear.
2. Set arrow color to `orientation` with surface color not orientation -> HSL sphere must still appear.
3. Set neither to orientation -> HSL sphere may disappear.

### Responsive overlay regression
1. Large viewport: full toolbar + explorer + legend + gizmos visible without overlap.
2. Medium viewport: compact toolbar, explorer reduced.
3. Small viewport: low-priority overlays collapse without collisions.

## Bottom line

You fixed the architecture much more than before. The viewport is now on the right path.

But the implementation is **not finished yet**.
The arrows are still black because the current arrow instancing path is still semantically wrong for Three.js color handling.
And the responsive system is still only a breakpoint system, not a true overlay layout engine.
