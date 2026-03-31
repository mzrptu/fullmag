"""Imported STL nanoflower executed with the study-root scripting API.

Study-root scripting API — compatible with the emerging model builder.
    fullmag examples/nanoflower_fdm.py
"""

import fullmag as fm

study = fm.study("nanoflower_fdm")

# ── Engine ──────────────────────────────────────────────────
study.engine("fem")
study.device("cuda:0", precision="double")
study.interactive(True)
study.universe(
    mode="manual",
    size=(800e-9, 800e-9, 800e-9),
    center=(0.0, 0.0, 0.0),
)

# ── Geometry & Material ─────────────────────────────────────
flower = study.geometry(
    fm.ImportedGeometry(
        source="nanoflower.stl",
        units="nm",
        name="nanoflower",
        volume="full",
    ),
    name="nanoflower",
)

flower.Ms = 752e3       # saturation magnetisation [A/m]
flower.Aex = 15.5e-12   # exchange stiffness [J/m]
flower.alpha = 0.1      # Gilbert damping
flower.m = fm.uniform(0.1,0.0001,0.99)
# flower.m.loadfile() # Removed to prevent error, uses uniform state from line 27
# ── External field ──────────────────────────────────────────
# Cartesian:  study.b_ext(0, 0, 0.1)          # 0.1 T along z
# Spherical:  study.b_ext(0.1, theta=0, phi=0) # same, via angles (degrees)
flower.mesh(hmax=20e-9, order=1).build() 

study.b_ext(0.1, theta=0, phi=0)  # 0.1 T along +z
# ── Solver ──────────────────────────────────────────────────
# study.solver(dt=1e-15, g=2.115)
study.solver(max_error=1e-6, integrator="rk45", g=2.115)

# ── Outputs ─────────────────────────────────────────────────
# study.save("m", every=1e-13)
study.tableautosave(1e-13)

# ── Run ─────────────────────────────────────────────────────
study.wait_for_solve(True)
study.relax(
    tol=1e-6,                       # torque tolerance (max_dm_dt)
    max_steps=100_000,               # limit kroków
    algorithm="llg_overdamped",     # algorytm relaksacji
)
study.run(1e-9)
