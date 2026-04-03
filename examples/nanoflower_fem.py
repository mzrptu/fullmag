"""Canonical Fullmag script generated from the model builder.

Source: nanoflower_fem.py
Entrypoint: flat_workspace
"""

import fullmag as fm

study = fm.study("nanoflower_fem")

# Engine
study.engine("fem")
study.device("cuda:0", precision="double")
study.universe(mode="auto", size=(4e-07, 4e-07, 4e-07), center=(0, 0, 0), padding=(0, 0, 0), airbox_hmax=4e-08)
study.interactive(True)

# Geometry & Material
body = study.geometry(fm.ImportedGeometry(source="nanoflower.stl", name="nanoflower_left", scale=1e-09), name="nanoflower_left")
body.Ms = 752000
body.Aex = 1.55e-11
body.alpha = 0.1
body.m = fm.random(seed=1)

# Mesh
study.mesh(hmax=4e-08, order=1, algorithm_2d=6, algorithm_3d=7, size_factor=1, size_from_curvature=0, smoothing_steps=1, optimize_iterations=1, narrow_regions=0, compute_quality=False, per_element_quality=False)
study.build_domain_mesh()
body.mesh(hmax=2e-08)

# Solver
study.solver(integrator="heun", dt=1e-15, gamma=233728.481992)

# Outputs
study.save("m", every=1e-12)
study.save("E_total", every=1e-12)
