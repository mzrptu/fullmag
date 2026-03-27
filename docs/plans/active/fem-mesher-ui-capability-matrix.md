# FEM Mesher UI Capability Matrix

## Goal

Build the FEM mesh workspace around the real Gmsh API surface, not around arbitrary viewer controls.

## Current Backend Reality

The current public FEM authoring contract exposes only:

- `order`
- `hmax`
- `mesh`

The current Gmsh bridge already uses:

- `gmsh.model.mesh.classifySurfaces(...)`
- `gmsh.model.mesh.createGeometry()`
- `gmsh.model.mesh.generate(3)`
- `gmsh.option.setNumber("Mesh.CharacteristicLengthMax", hmax)`
- `gmsh.option.setNumber("Mesh.ElementOrder", order)`

This means the runtime already has a mesher pipeline, but the public API and GUI expose only a very small subset.

## Verified Gmsh API Surface

Verified locally from the installed Gmsh Python bindings:

### Generation / Source Handling

- `generate(dim=3)`
- `classifySurfaces(...)`
- `createGeometry(...)`
- `setOrder(order)`

### Sizing

- `setSize(dimTags, size)`
- `setSizeAtParametricPoints(dim, tag, parametricCoord, sizes)`
- `setSizeFromBoundary(...)`
- `setSizeCallback(...)`
- `model.mesh.field.*`
- `field.setAsBackgroundMesh(...)`

### Quality / Cleanup

- `refine()`
- `optimize(method="", force=False, niter=1, dimTags=[])`
- `setSmoothing(dim, tag, val)`
- `removeDuplicateNodes(...)`
- `removeDuplicateElements(...)`
- `renumberNodes(...)`
- `renumberElements(...)`

### Structured / Advanced

- `setTransfiniteCurve(...)`
- `setTransfiniteSurface(...)`
- `setRecombine(...)`
- `recombine()`
- `embed(...)`
- `partition()`
- `unpartition()`

## UI Mapping

### Ship Now

- Global max element size (`hmax`)
- Element order
- Source selection / source summary
- STL classification summary
- Mesh quality readout
- Surface preview before volume meshing

### Next Public Mesher Controls

- Uniform refine step count
- Mesh optimizer method + iterations
- Laplace smoothing iterations
- Duplicate cleanup actions
- Renumbering actions

### After That

- Local size fields based on distance / threshold / background mesh
- Point and curve constraints
- Transfinite controls for structured CAD workflows
- Recombine controls where surface/hex workflows make sense

## Product Direction

For FEM, the UI should move toward a COMSOL-like split:

- `Model / Mesh` tree on the left
- selected mesh node settings in a central settings panel
- graphics viewport on the right
- quality / messages / log below

The important constraint is that each visible UI control should map to:

1. a real Gmsh API call,
2. a stable Fullmag authoring field,
3. a clear execution phase:
   - pre-mesh setup
   - generate
   - repair / optimize
   - inspect / export

## Immediate Implementation Rule

Do not add new mesh UI controls unless the backend metadata declares them and the control has a defined backend mapping.
