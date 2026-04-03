# Fullmag preview diagnosis — FEM / magnetization / overlay responsiveness

## Executive summary

Current FEM preview is improved, but not fully migrated to the new shared viewport system.

Main findings:

1. `FemMeshView3D.tsx` still contains a large inline overlay/toolbar system instead of using the shared viewport primitives.
2. Overlay collision handling is still manual (`absolute top/left/right/bottom`) rather than layout-managed.
3. The HSL orientation widget is still controlled by `showOrientationLegend` and defaults to hidden.
4. The magnetization arrow color regression is most likely in `FemArrows.tsx`, not in `magnetizationColor.ts`.
5. `layers.ts` / `useRenderPolicy.ts` exist but are not yet the actual source of truth for FEM preview rendering.

## Evidence

### FEM preview still owns its own toolbar and HUD
- `FemMeshView3D.tsx` keeps a large absolute overlay toolbar inside the viewport.
- It also owns bottom status badges, part explorer, context menu, hover tooltip, screenshot button, and HSL sphere mounting.

### Shared viewport primitives exist but are not the active FEM shell
- `ViewportToolbar3D.tsx`
- `ViewportToolGroup.tsx`
- `ViewportIconAction.tsx`
- `ViewportPopoverPanel.tsx`
- `ViewportStatusChips.tsx`

### Layout is still hard-coded
- `FieldLegend.tsx` -> absolute bottom-left
- `HslSphere.tsx` -> absolute bottom-left
- `ViewCube.tsx` -> absolute top-right + bottom-right
- `FemMeshView3D.tsx` -> top toolbar, right part explorer, bottom status, floating context menu
- `BoundsPreview3D.tsx` -> own ViewCube and bottom-left badge

### Arrow color regression
- `FemArrows.tsx` computes colors with `applyMagnetizationHsl(...)`.
- It renders an `instancedMesh` and attaches colors via `instanceColor`.
- This path is more fragile after upgrades than the surface path in `FemGeometry.tsx`, which writes colors into `geometry.attributes.color` and uses `vertexColors`.

## Most likely root cause of black arrows

Most likely regression:

- the surface mesh path still works because it uses baked vertex colors on geometry;
- the arrow path relies on `instancedMesh + instanceColor` plumbing;
- after the upgrade, this path is likely no longer updating or binding instance colors robustly enough.

This explains the exact symptom:
- surface colors still look correct,
- arrows render, but appear black.

## Immediate fix

### `FemArrows.tsx`

1. Stop relying only on declarative `attach="instanceColor"`.
2. Imperatively assign per-instance colors after matrix upload:
   - either `meshRef.current.setColorAt(i, color)`
   - or set `meshRef.current.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)`.
3. Include `colors` in the update effect dependency list.
4. For debugging, temporarily switch arrow material to `meshBasicMaterial` to verify that the color pipeline works before reintroducing lit shading.
5. After the pipeline is stable, move to a controlled material mode:
   - `scientific-flat` (exact colors)
   - `scientific-shaded` (soft physically lit arrows)

## HSL sphere / orientation widget diagnosis

Current problem is not only visual overlap.

The widget is still gated by `showOrientationLegend`, and `FemMeshView3D.tsx` defaults this prop to `false`.
That means it will disappear whenever the parent stops passing the prop during migration.

## Immediate HSL fix

### `FemMeshView3D.tsx`

Introduce:

```ts
const effectiveShowOrientationLegend =
  showOrientationLegend ||
  legendField === "orientation" ||
  arrowField === "orientation";
```

and render the HSL widget from that derived state.

## Responsive overlay refactor

### New invariant

No overlay component should own its own absolute docking coordinates.

Instead:
- every overlay registers preferred anchors,
- the viewport layout manager computes safe positions,
- overlays degrade through levels: full -> compact -> icon -> drawer.

### New file

`apps/web/components/preview/ViewportOverlayManager.tsx`

Responsibilities:
- observe viewport size with `ResizeObserver`
- collect overlay descriptors
- compute safe zones
- avoid intersections
- compact low-priority overlays when needed

### Overlay descriptor shape

```ts
type OverlayAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type OverlayDescriptor = {
  id: string;
  preferredAnchor: OverlayAnchor;
  priority: number;
  minWidth: number;
  minHeight: number;
  compactWidth?: number;
  compactHeight?: number;
  canCompact?: boolean;
  canHide?: boolean;
};
```

### Collision strategy

1. place top toolbar first
2. place right inspector second
3. place ViewCube / gizmo stack third
4. place field legend fourth
5. place status chips and badges last
6. if collision:
   - compact toolbar groups into icon-only groups
   - collapse part explorer into drawer
   - move HSL sphere under ViewCube or into color popover
   - collapse status strip into chips

## Per-file changes

### `FemMeshView3D.tsx`
- remove inline absolute toolbar implementation
- mount `ViewportToolbar3D`
- move explorer to responsive drawer on medium widths
- move bottom stats into `ViewportStatusChip`
- derive `effectiveShowOrientationLegend`
- stop absolute ownership of legend / HSL / cube positions

### `HslSphere.tsx`
- accept `size`, `compact`, `anchorClassName`
- do not hardcode `bottom-4 left-4`
- support compact mode without labels

### `ViewCube.tsx`
- accept layout props from overlay manager
- unify with HSL widget into `ViewportGizmoStack`

### `FieldLegend.tsx`
- remove hardcoded `absolute bottom-3 left-3`
- render as normal overlay content

### `ViewportToolbar3D.tsx`
- add overflow slot
- add row budget / compact mode

### `ViewportToolGroup.tsx`
- add icon-only compact variant

### `ViewportPopoverPanel.tsx`
- allow auto-flip left/right and top/bottom

### `layers.ts` / `useRenderPolicy.ts`
- wire them into FEM geometry, arrows, axes, gizmos, overlays
- stop ad-hoc renderOrder/depthWrite decisions inside each component

## Recommended breakpoints

- `>= 1600px`: full toolbar + right explorer + legend + gizmo stack
- `1280–1599px`: compact toolbar labels, narrower explorer
- `1024–1279px`: explorer becomes drawer, HSL below ViewCube or in popover
- `< 1024px`: icon toolbar only, legend collapses, HSL hidden behind toggle, bottom status becomes chips only

## Acceptance criteria

1. Arrows regain orientation colors and match the HSL legend.
2. HSL widget appears automatically when orientation coloring is active.
3. No overlay overlaps another overlay at 1280px, 1440px, 1720px.
4. FEM preview uses shared viewport primitives instead of bespoke inline toolbar markup.
5. Render layers/policies are driven through shared policy helpers.
