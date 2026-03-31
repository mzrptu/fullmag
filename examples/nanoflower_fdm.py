"""Imported STL nanoflower executed on the FDM backend.

Flat scripting API — inspired by mumax3.
    fullmag examples/nanoflower_fdm.py
"""

import fullmag as fm

# ── Engine ──────────────────────────────────────────────────
fm.name("nanoflower_fdm")
fm.engine("fem")
fm.device("cuda:0", precision="double")
# fm.cell(5e-9, 5e-9, 5e-9)
fm.interactive(True)

# ── Geometry & Material ─────────────────────────────────────
flower = fm.geometry(
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
# Cartesian:  fm.b_ext(0, 0, 0.1)          # 0.1 T along z
# Spherical:  fm.b_ext(0.1, theta=0, phi=0) # same, via angles (degrees)
flower.mesh(hmax=20e-9, order=1).build() 

fm.b_ext(0.1, theta=0, phi=0)  # 0.1 T along +z
# ── Solver ──────────────────────────────────────────────────
# fm.solver(dt=1e-15, g=2.115)
fm.solver(max_error=1e-6, integrator="rk45", g=2.115)

# ── Outputs ─────────────────────────────────────────────────
# fm.save("m", every=1e-13)
fm.tableautosave(1e-13)

# ── Run ─────────────────────────────────────────────────────
fm.wait_for_solve(True)
fm.relax(
    tol=1e-6,                       # torque tolerance (max_dm_dt)
    max_steps=100_000,               # limit kroków
    algorithm="llg_overdamped",     # algorytm relaksacji
)
fm.run(1e-9)
