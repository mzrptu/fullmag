# 0530 — Magnetic Preset Textures (Authoring -> FEM/FDM Sampling)

## Scope
- Defines `InitialMagnetizationIR::PresetTexture` as an analytic volumetric vector field.
- Covers deterministic sampling to solver points for both FEM nodes and FDM cell centers.

## Coordinate Pipeline
For each sample point:
1. Select source space:
   - `mapping.space = "object"` -> use object-local coordinates,
   - otherwise use world coordinates.
2. Apply projection (`planar_xy`, `planar_xz`, `planar_yz`, otherwise identity).
3. Apply inverse texture transform:
   - `p' = inv(translate ∘ rotate ∘ scale around pivot)(p)`.
4. Apply clamp mode:
   - `clamp`, `repeat|wrap`, `mirror`.
5. Evaluate preset function `m = f(p', params)`.
6. Normalize output vector.

## Presets (v1)
- `uniform`
- `random_seeded`
- `vortex`
- `antivortex`
- `bloch_skyrmion`
- `neel_skyrmion`
- `domain_wall`
- `two_domain`
- `helical`
- `conical`

## FEM/FDM Contract
- Planner performs sampling during lowering (`preset_texture` is executable directly).
- Runtime receives explicit vectors (`Vec<[f64; 3]>`) as initial state.
- No UV mapping is required; this is volumetric sampling on physical coordinates.

## Safety / Validation
- All outputs must be finite and normalized.
- Missing required preset params fail planning.
- Inactive points (FDM mask) are forced to `[0,0,0]`.

