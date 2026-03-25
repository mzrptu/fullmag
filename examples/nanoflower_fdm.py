"""Imported STL nanoflower executed on the FDM backend.

Flat scripting API — inspired by mumax3.
    fullmag examples/nanoflower_fdm.py
"""

import fullmag as fm

TARGET_SIZE = (330e-9, 330e-9, 5e-9)
SOURCE_STL_EXTENT = (
    329.98683166503906,
    329.9898681640625,
    112.44074249267578,
)
STL_TO_TARGET_SCALE = tuple(
    TARGET_SIZE[index] / SOURCE_STL_EXTENT[index]
    for index in range(3)
)

# ── Engine ──────────────────────────────────────────────────
fm.name("nanoflower_fdm")
fm.engine("fdm")
fm.device("cuda:0")
fm.cell(5e-9, 5e-9, 5e-9)

# ── Geometry & Material ─────────────────────────────────────
flower = fm.geometry(
    fm.ImportedGeometry(
        source="nanoflower.stl",
        scale=STL_TO_TARGET_SCALE,
        name="nanoflower",
    ),
    name="nanoflower",
)
flower.Ms = 752e3       # saturation magnetisation [A/m]
flower.Aex = 15.5e-12   # exchange stiffness [J/m]
flower.alpha = 0.1      # Gilbert damping
flower.m = fm.uniform(1, 0, 0)

# ── Solver ──────────────────────────────────────────────────
fm.solver(dt=1e-15, g=2.115)

# ── Outputs ─────────────────────────────────────────────────
fm.save("m", every=1e-13)
fm.save("E_ex", every=1e-13)
fm.save("E_demag", every=1e-13)
fm.save("E_total", every=1e-13)

# ── Run ─────────────────────────────────────────────────────
fm.relax()
fm.run(5e-10)
