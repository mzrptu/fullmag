"""Canonical Fullmag script generated from the model builder.

Source: nanoflower_fem.py
Entrypoint: flat_workspace
"""

import fullmag as fm

study = fm.study("nanoflower_fem")

# Engine
study.engine("fem")
study.device("cuda:0", precision="double")
study.universe(mode="auto", size=(4e-07, 4e-07, 4e-07), center=(0, 0, 0), padding=(0, 0, 0), airbox_hmax=8e-08)
study.interactive(True)

# Geometry & Material
body = study.geometry(fm.ImportedGeometry(source="nanoflower.stl", name="nanoflower_left", scale=1e-09), name="nanoflower_left")
body.Ms = 752000
body.Aex = 1.55e-11
body.alpha = 0.1
body.m = fm.random(seed=1)

# Mesh
study.object_mesh_defaults(algorithm_2d=6, algorithm_3d=1, size_factor=1, size_from_curvature=0, smoothing_steps=1, optimize_iterations=1, narrow_regions=0, compute_quality=False, per_element_quality=False)
body.mesh(hmax=20e-09, order=1, algorithm_2d=1, algorithm_3d=1, size_factor=1, size_from_curvature=1, smoothing_steps=1, optimize_iterations=1, narrow_regions=1, compute_quality=True, per_element_quality=True)
study.build_domain_mesh()


# study.b_ext(0.001, theta=0, phi=0)  # 0.1 T along +z
# ── Solver ──────────────────────────────────────────────────
# study.solver(dt=1e-15, g=2.115)
study.solver(max_error=1e-6, integrator="rk45", g=2.115)

# ── Outputs ─────────────────────────────────────────────────
# study.save("m", every=1e-13)
study.tableautosave(1e-13)

# ── Run ─────────────────────────────────────────────────────
study.relax(
    tol=1e-6,                       # torque tolerance (max_dm_dt)
    max_steps=100_000,               # limit kroków
    algorithm="llg_overdamped",     # algorytm relaksacji
)
study.run(1e-9)
