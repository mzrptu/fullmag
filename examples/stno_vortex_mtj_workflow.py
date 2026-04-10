"""Canonical Fullmag script generated from the model builder.

Source: stno_vortex_mtj_workflow.py
Entrypoint: flat_workspace
"""

from pathlib import Path
import os

import fullmag as fm

SCRIPT_DIR = Path(__file__).resolve().parent
RELAXED_STATE_ZARR = SCRIPT_DIR / "stno_vortex_relaxed_m.zarr.zip"
RELAXED_STATE_H5 = SCRIPT_DIR / "stno_vortex_relaxed_m.h5"
USE_SAVED_RELAXED_STATE = RELAXED_STATE_ZARR.exists()
USE_SAVED_RELAXED_STATE = USE_SAVED_RELAXED_STATE and os.getenv("FULLMAG_USE_SAVED_STATE") == "1"

study = fm.study("stno_vortex_mtj_workflow")

# Engine
study.engine("fem")
study.device("cpu", precision="double")
study.universe(
    mode="auto",
    size=(500e-9, 500e-9, 50e-9),
    center=(0, 0, 0),
    padding=(0, 0, 0),
    airbox_hmax=200e-9,
)
study.interactive(True)

# Geometry & Material (effective CoFeB/NiFe free layer)
free = study.geometry(
    # NOTE:
    # Wrap cylinder in a no-op Translate to force the generic OCC CSG meshing
    # path (with internal geometric scaling), which is more robust for very
    # thin nanoscale cylinders than the direct cylinder mesher path.
    fm.Translate(
        fm.Cylinder(radius=200e-9, height=9e-9, name="free_disk"),
        (0.0, 0.0, 0.0),
    ),
    name="free",
)
free.Ms = 700e3
free.Aex = 1.2e-11
free.alpha = 0.01
free.m = (
    fm.load_magnetization(RELAXED_STATE_ZARR, format="zarr")
    if USE_SAVED_RELAXED_STATE
    else fm.texture.vortex(circulation=+1, core_polarity=+1)
)

# Mesh
study.object_mesh_defaults(
    algorithm_2d=6,
    algorithm_3d=1,
    size_factor=1,
    size_from_curvature=1,
    smoothing_steps=1,
    optimize_iterations=1,
    narrow_regions=1,
    compute_quality=True,
    per_element_quality=True,
)
free.mesh(
    hmax=12e-9,
    order=1,
    algorithm_2d=1,
    algorithm_3d=1,
    size_factor=1,
    size_from_curvature=1,
    smoothing_steps=1,
    optimize_iterations=1,
    narrow_regions=1,
    compute_quality=True,
    per_element_quality=True,
)
study.build_domain_mesh()

study.demag(realization="poisson_robin")

# Optional weak DC bias field (along +z)
study.b_ext(0.02, theta=0, phi=0)

# Solver
study.solver(max_error=1e-6, integrator="rk45", g=2.115)

# Outputs
study.tableautosave(10e-12)

# Run
# if not USE_SAVED_RELAXED_STATE:
#     relax_result = study.relax(
#         tol=1e-5,
#         max_steps=100_000,
#         algorithm="llg_overdamped",
#     )
#     if hasattr(relax_result, "save_state"):
#         relax_result.save_state(RELAXED_STATE_ZARR, format="zarr")
#         relax_result.save_state(RELAXED_STATE_H5, format="h5")

# study.run(100e-9)

# # Optional spectral diagnostics
# study.eigenmodes(
#     count=20,
#     target="lowest",
#     include_demag=True,
#     equilibrium_source="relax",
# )
