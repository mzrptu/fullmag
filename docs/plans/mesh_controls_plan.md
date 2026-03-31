# Mesh Controls Implementation Plan

> COMSOL-level mesh size parameters + interactive lasso refinement

---

## Status Quo

| COMSOL Parameter | Gmsh Equivalent | Fullmag Status |
|---|---|---|
| Maximum element size | `Mesh.CharacteristicLengthMax` | ✅ `hmax` |
| Minimum element size | `Mesh.CharacteristicLengthMin` | ✅ `hmin` |
| Maximum element growth rate | `Mesh.CharacteristicLengthFromCurvature` / size fields | ❌ Missing |
| Curvature factor | `Mesh.MeshSizeFromCurvature` | ⚠️ Have it, inverted semantics vs COMSOL |
| Resolution of narrow regions | No direct Gmsh flag | ❌ Missing |
| **Interactive lasso refinement** | Size fields | ❌ New feature |

### Signal chain for mesh generation (UI → result)

```
MeshSettingsPanel.tsx  (UI state: MeshOptionsState)
  → ControlRoomContext.tsx  handleMeshGenerate()
    → liveApi.queueCommand({ kind: "remesh", mesh_options: {...} })
      → orchestrator.rs  "remesh" command handler (line ~1490)
        → python_bridge.rs  invoke_remesh_full()
          → remesh_cli.py  _mesh_options_from_dict() → generate_*()
            → gmsh_bridge.py  _apply_mesh_options()
              → gmsh C library
```

---

## Feature 1: Growth Rate

### What it does
Controls how fast element sizes can change between neighbours. COMSOL default
is 1.5 (each layer of elements can be at most 1.5× the size of the previous).
Lower values = smoother transitions = more elements.

### Gmsh mapping
There is **no single `Mesh.GradationMax` option** in Gmsh ≥ 4.x that works
like COMSOL's growth rate. The old `Mesh.CharacteristicLengthFromCurvature`
flag is unrelated. Instead, Gmsh offers two approaches:

1. **`Mesh.CharacteristicLengthExtendFromBoundary`** (0, 1, or 2) —
   propagates sizes from boundary inward but is a binary switch, not a ratio.
2. **Explicit size fields** — use a `MathEval` or `Threshold` field that
   spatially grades element size. This is how `add_air_box()` already works.
3. **`Mesh.SmoothRatio`** (default 1.8) — post-mesh smoothing target ratio,
   available via `gmsh.option.setNumber("Mesh.SmoothRatio", r)`. Values
   close to 1.0 force more uniform sizes but increase mesh count. **This is
   the closest single-parameter equivalent to COMSOL's growth rate.**

**Chosen approach:** Expose `Mesh.SmoothRatio` as `growth_rate` with range
[1.1, 3.0], default 1.8 (Gmsh default). Additionally bump `Mesh.Smoothing`
(smoothing passes) when `growth_rate < 1.5` to ensure the constraint is
enforced.

### Changes required

#### 1. Python — `gmsh_bridge.py`

**`MeshOptions` dataclass** (~line 94):
```python
@dataclass(frozen=True, slots=True)
class MeshOptions:
    ...
    growth_rate: float | None = None      # NEW — Mesh.SmoothRatio target
    extend_from_boundary: int = 1         # NEW — Mesh.CharacteristicLengthExtendFromBoundary
    ...
```

**`_apply_mesh_options()`** (~line 835):
```python
if opts.growth_rate is not None:
    gmsh.option.setNumber("Mesh.SmoothRatio", opts.growth_rate)
    # Need extra smoothing passes to enforce a tight growth rate
    if opts.growth_rate < 1.5:
        gmsh.option.setNumber("Mesh.Smoothing", max(opts.smoothing_steps, 5))

gmsh.option.setNumber(
    "Mesh.CharacteristicLengthExtendFromBoundary",
    opts.extend_from_boundary,
)
```

#### 2. Python — `remesh_cli.py`

**`_mesh_options_from_dict()`** (~line 97):
```python
growth_rate=opts.get("growth_rate"),
extend_from_boundary=opts.get("extend_from_boundary", 1),
```

#### 3. TypeScript — `MeshSettingsPanel.tsx`

**`MeshOptionsState` interface** (~line 13):
```typescript
growthRate: string;          // "" = auto (gmsh default 1.8), otherwise float
```

**`DEFAULT_MESH_OPTIONS`** (~line 93):
```typescript
growthRate: "",
```

**UI**: Add a row in the "Advanced" section after `sizeFactor`:
```
Growth Rate    [  1.8  ]   (1.1–3.0, blank = Gmsh default)
```

#### 4. TypeScript — `ControlRoomContext.tsx`

**`handleMeshGenerate`** (~line 700):
```typescript
growth_rate: meshOptions.growthRate ? parseFloat(meshOptions.growthRate) : null,
```

### Effort estimate
~30 min — 4 files, all are additive one-liners.

---

## Feature 2: Resolution of Narrow Regions

### What it does
COMSOL automatically detects thin channels / narrow gaps in the geometry and
ensures enough elements span the gap so the physics is captured. A value of
1 means "at least 1 element across the narrowest region."  Higher values
put more elements across.

### Why it's hard
Gmsh has **no built-in narrow-region detection**. COMSOL's implementation
uses a medial-axis / thickness-field computation on the CAD model.

### Implementation strategy

**Approach: Thickness-aware size field via Distance fields from opposing surfaces**

For each closed volume we can:
1. Compute a **Distance field from all boundary surfaces** of the volume.
2. The **local thickness** at a point is approximately `2 × distance_to_nearest_boundary`.
3. Set the target element size = `thickness / n_resolve` where `n_resolve`
   is the user parameter (default 1, meaning at least 1 element across).
4. Combine with existing size fields using a `Min` field.

This gives a reasonable approximation for convex and mildly concave bodies.
For complex shapes with interior holes, we'd need a full medial-axis
transform, which is out of scope for v1.

### Changes required

#### 1. Python — `gmsh_bridge.py`

**`MeshOptions` dataclass**:
```python
narrow_regions: int = 0    # 0 = disabled, 1+ = min elements across narrow gap
```

**New function `_add_narrow_region_field()`**:
```python
def _add_narrow_region_field(
    gmsh: Any,
    n_resolve: int,
    hmax: float,
    hscale: float = 1.0,
) -> int | None:
    """Add a size field that refines narrow regions of the geometry.

    Uses Distance field from all boundary surfaces: local thickness ≈
    2 × dist_to_boundary.  Target size = thickness / n_resolve.
    """
    if n_resolve < 1:
        return None

    surfaces = gmsh.model.getEntities(2)
    if not surfaces:
        return None
    surf_tags = [t for _, t in surfaces]

    f_dist = gmsh.model.mesh.field.add("Distance")
    gmsh.model.mesh.field.setNumbers(f_dist, "SurfacesList", surf_tags)
    gmsh.model.mesh.field.setNumber(f_dist, "Sampling", 20)

    # MathEval: target_h = 2*dist / n_resolve, clamped to [hmin, hmax]
    hmin_val = hmax * 0.05 * hscale
    hmax_val = hmax * hscale
    expr = f"Min(Max(2*F{f_dist}/{n_resolve}, {hmin_val}), {hmax_val})"
    f_math = gmsh.model.mesh.field.add("MathEval")
    gmsh.model.mesh.field.setString(f_math, "F", expr)
    return f_math
```

**`_apply_mesh_options()`** — after existing size fields:
```python
if opts.narrow_regions > 0:
    narrow_fid = _add_narrow_region_field(gmsh, opts.narrow_regions, hmax, hscale)
    if narrow_fid is not None:
        # Must combine with existing background mesh if any
        _add_to_background_min(gmsh, narrow_fid)
```

We need a small helper `_add_to_background_min()` that checks if there's
already a background mesh field and merges the new field into a `Min`
combination. Alternatively, pass list of extra field IDs into
`_configure_mesh_size_fields()`.

#### 2. Python — `remesh_cli.py`

```python
narrow_regions=opts.get("narrow_regions", 0),
```

#### 3. TypeScript — `MeshSettingsPanel.tsx`

**`MeshOptionsState`**:
```typescript
narrowRegions: number;       // 0 = off, 1–10
```

**UI**: Slider or integer input in the Advanced section:
```
Narrow Regions  [ 0 ] ──●──  (0 = off, 1 = 1 elem across, up to 10)
```

#### 4. TypeScript — `ControlRoomContext.tsx`

```typescript
narrow_regions: meshOptions.narrowRegions,
```

### Known limitations
- The Distance→MathEval approach is an approximation. It works well for
  thin layers (discs, shells) and gaps between bodies, but may over-refine
  near convex corners where the distance field is naturally small.
- A proper medial-axis transform would be more accurate but requires
  significant computational effort (potential v2 enhancement).
- For imported STL meshes without clean CAD surfaces, the boundary
  triangulation resolution limits accuracy of the Distance field.

### Effort estimate
~2–4 hours — mostly the new `_add_narrow_region_field()` function +
integration with existing background-mesh logic.

---

## Feature 3: Interactive Lasso Refinement

### Concept
User draws a lasso (freeform polygon) or box selection on the 3D mesh view.
All mesh elements inside the selection region are identified. The user clicks
"Refine" or "Coarsen", and the mesh is regenerated with a local size field
that only affects the selected region.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  FemMeshView3D (Three.js / R3F canvas)                   │
│                                                          │
│  [existing] click = select face(s)                       │
│  [new]      shift+drag = lasso/box select elements       │
│             → compute 3D bounding region (OBB or convex  │
│               hull) from selected elements' centroids    │
│             → emit LassoSelection { center, extents,     │
│               target_h }                                 │
│                                                          │
│  [new]      floating toolbar on selection:                │
│             [Refine ×2] [Refine ×4] [Coarsen ×2] [Clear]│
└─────────────────────────┬────────────────────────────────┘
                          │ LassoSelection
                          ▼
┌──────────────────────────────────────────────────────────┐
│  ControlRoomContext                                       │
│                                                          │
│  handleLassoRefine(selection, factor):                   │
│    1. Convert selection to a size field spec:            │
│       { kind: "Box", params: { VIn, VOut, XMin, ... } } │
│    2. Merge into meshOptions.size_fields[]               │
│    3. queueCommand({ kind: "remesh", mesh_options })     │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  Rust orchestrator → Python remesh_cli → gmsh_bridge     │
│                                                          │
│  size_fields already flow through the entire pipeline!   │
│  gmsh_bridge._configure_mesh_size_fields() creates       │
│  Box / Ball / Threshold fields and combines via Min.     │
│                                                          │
│  No changes needed in the backend pipeline.              │
└──────────────────────────────────────────────────────────┘
```

### Key insight
The **backend already supports arbitrary size fields** via `MeshOptions.size_fields`.
The `_configure_mesh_size_fields()` function (gmsh_bridge.py, line ~878)
creates Gmsh fields from JSON dicts like `{"kind": "Box", "params": {...}}`.
This means lasso refinement is **purely a frontend feature** — we just need
to compute the Box/Ball parameters from the visual selection and pass them
as `size_fields` entries.

### Implementation plan

#### Phase A: Selection tool (~1 day)

##### A1. Lasso/box select mode

Add a selection mode toggle to the `FemMeshView3D` toolbar:

```typescript
// New toolbar button
<button data-active={selectMode === "lasso"} onClick={() => setSelectMode(s => s === "lasso" ? "none" : "lasso")}>
  ◇ Lasso
</button>
```

When `selectMode === "lasso"`:
- Hold Shift + drag → draw rectangle on screen (simple box select first,
  freeform polygon as v2)
- On mouse-up, use GPU raycasting or frustum intersection to find all
  boundary faces whose centroids fall inside the 2D screen rectangle
- Highlight selected region (extend existing `FemHighlightView`)

##### A2. 3D region computation

From the selected face indices, compute centroid and axis-aligned bounding
box (AABB) of the selected region in world space:

```typescript
function computeSelectionAABB(
  nodes: number[],
  boundaryFaces: number[],
  selectedFaceIndices: number[],
): { center: [number, number, number]; halfExtents: [number, number, number] } {
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (const fi of selectedFaceIndices) {
    for (let v = 0; v < 3; v++) {
      const ni = boundaryFaces[fi * 3 + v];
      const x = nodes[ni * 3], y = nodes[ni * 3 + 1], z = nodes[ni * 3 + 2];
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
      zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
    }
  }
  return {
    center: [(xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2],
    halfExtents: [(xmax - xmin) / 2, (ymax - ymin) / 2, (zmax - zmin) / 2],
  };
}
```

#### Phase B: Refine/Coarsen action (~0.5 day)

##### B1. Floating action toolbar

When faces are selected (already tracked in `selectedFaces` state), show a
floating toolbar near the selection:

```typescript
{selectedFaces.length > 0 && (
  <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2 rounded-lg bg-card/90 backdrop-blur-md border border-border/50 shadow-xl z-30">
    <span className="text-xs text-muted-foreground">{selectedFaces.length} faces</span>
    <button onClick={() => onRefine?.(selectedFaces, 0.5)}>Refine ×2</button>
    <button onClick={() => onRefine?.(selectedFaces, 0.25)}>Refine ×4</button>
    <button onClick={() => onRefine?.(selectedFaces, 2.0)}>Coarsen ×2</button>
    <button onClick={() => setSelectedFaces([])}>Clear</button>
  </div>
)}
```

##### B2. Size field generation

In `ControlRoomContext`, convert the selection + factor to a Gmsh size field:

```typescript
const handleRefine = useCallback(async (faceIndices: number[], factor: number) => {
  const meshData = /* current mesh data */;
  const aabb = computeSelectionAABB(meshData.nodes, meshData.boundaryFaces, faceIndices);
  const currentHmax = parseFloat(meshOptions.hmax) || lastKnownHmax;
  const targetH = currentHmax * factor;
  // Pad the AABB slightly so the transition zone doesn't clip the selection
  const pad = currentHmax * 2;

  const sizeField = {
    kind: "Box",
    params: {
      VIn: targetH,
      VOut: currentHmax,
      XMin: aabb.center[0] - aabb.halfExtents[0] - pad,
      XMax: aabb.center[0] + aabb.halfExtents[0] + pad,
      YMin: aabb.center[1] - aabb.halfExtents[1] - pad,
      YMax: aabb.center[1] + aabb.halfExtents[1] + pad,
      ZMin: aabb.center[2] - aabb.halfExtents[2] - pad,
      ZMax: aabb.center[2] + aabb.halfExtents[2] + pad,
    },
  };

  // Accumulate refinement zones (allow multiple lasso selections)
  const updatedSizeFields = [...(currentSizeFields || []), sizeField];

  await liveApi.queueCommand({
    kind: "remesh",
    mesh_options: {
      ...currentMeshOptionsAsDict(),
      size_fields: updatedSizeFields,
    },
  });
}, [meshOptions, liveApi]);
```

##### B3. Backend

**No changes needed.** The `size_fields` array already flows through:
- `remesh_cli.py` passes them to `MeshOptions`
- `_configure_mesh_size_fields()` creates Gmsh Box fields
- Parameters like `VIn`, `VOut`, `XMin` etc. are auto-scaled by `hscale`

The only addition: pass `size_fields` from the mesh_options dict in
`_mesh_options_from_dict()`:
```python
size_fields=opts.get("size_fields", []),
```

(Currently not mapped — this is the one backend line that needs adding.)

#### Phase C: UX Polish (~0.5 day)

- **Visual preview**: Before remeshing, render a semi-transparent box
  gizmo showing the refinement zone in the 3D view
- **Undo**: Store refinement zone history, allow removing individual zones
- **Ball selection**: Alternative to Box for spherical refinement regions
  (useful for point defects/singularities)
- **Persistent zones**: Show existing refinement zones as wireframe boxes
  in the 3D view, allow click-to-delete

### Effort estimate
~2–3 days total:
- Phase A (selection): 1 day (box select is straightforward, lasso is more work)
- Phase B (refine/coarsen): 0.5 day (mostly wiring, backend is ready)
- Phase C (polish): 0.5–1 day (gizmos, undo, multi-zone management)

---

## Implementation Order

Recommended order (each feature is independently shippable):

1. **Growth rate** (30 min) — immediate value, 4 one-line changes
2. **Lasso refinement** Phase A+B (1.5 days) — high-impact UX differentiator
3. **Narrow regions** (2–4 hours) — useful for thin-film physics
4. **Lasso refinement** Phase C (0.5–1 day) — polish

### Files touched (summary)

| File | Feature 1 | Feature 2 | Feature 3 |
|---|---|---|---|
| `gmsh_bridge.py` — `MeshOptions` | `growth_rate` | `narrow_regions` | — |
| `gmsh_bridge.py` — `_apply_mesh_options()` | `SmoothRatio` | `_add_narrow_field` | — |
| `remesh_cli.py` — `_mesh_options_from_dict()` | +1 field | +1 field | +`size_fields` |
| `MeshSettingsPanel.tsx` — `MeshOptionsState` | `growthRate` | `narrowRegions` | — |
| `MeshSettingsPanel.tsx` — UI | slider | slider | — |
| `ControlRoomContext.tsx` — `handleMeshGenerate` | +1 field | +1 field | — |
| `ControlRoomContext.tsx` — new `handleRefine` | — | — | ✅ |
| `FemMeshView3D.tsx` — selection mode | — | — | ✅ |
| `FemMeshView3D.tsx` — floating toolbar | — | — | ✅ |
| `orchestrator.rs` | — | — | — |
| `python_bridge.rs` | — | — | — |

Note: Rust files do **not** need changes for any of these features because
`mesh_options` is passed as opaque `serde_json::Value` through the entire
Rust layer.

---

## COMSOL-Style Presets (bonus)

Once all 5 parameters are exposed, we can add COMSOL-like named presets:

| Preset | hmax | hmin | growth_rate | curvature | narrow |
|---|---|---|---|---|---|
| Extremely coarse | 2× auto | — | 3.0 | 0 | 0 |
| Coarse | 1.5× auto | — | 2.0 | 0 | 0 |
| Normal | auto | — | 1.8 | 0 | 0 |
| Fine | 0.7× auto | auto/20 | 1.5 | 12 | 1 |
| Finer | 0.5× auto | auto/40 | 1.3 | 18 | 1 |
| Extra fine | 0.35× auto | auto/80 | 1.2 | 24 | 2 |
| Extremely fine | 0.25× auto | auto/100 | 1.1 | 36 | 3 |

This would be a dropdown in `MeshSettingsPanel.tsx` that sets all fields at
once (similar to the current `adaptivePolicy` preset).
