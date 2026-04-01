"""Imported STL nanoflower executed on the FEM backend.

Flat scripting API — inspired by mumax3.
    fullmag examples/nanoflower_fem.py
"""

import fullmag as fm

# ── Engine ──────────────────────────────────────────────────
fm.name("nanoflower_fem")
fm.engine("fem")
fm.device("cuda:0")

# ── Geometry & Material ─────────────────────────────────────
FLOWER_SPAN_X = 329.98683166503906e-9
FLOWER_GAP_X = 5e-9
FLOWER_PITCH_X = FLOWER_SPAN_X + FLOWER_GAP_X
FLOWER_OFFSET_X = 0.5 * FLOWER_PITCH_X


def add_nanoflower(name: str, offset_x: float, seed: int):
    flower = fm.geometry(
        fm.ImportedGeometry(
            source="nanoflower.stl",
            units="nm",
            name=name,
        ).translate((offset_x, 0.0, 0.0)),
        name=name,
    )
    flower.Ms = 752e3       # saturation magnetisation [A/m]
    flower.Aex = 15.5e-12   # exchange stiffness [J/m]
    flower.alpha = 0.1      # Gilbert damping
    flower.m = fm.random(seed=seed)
    flower.mesh(hmax=2.5e-9, order=1).build()
    return flower


flower_left = add_nanoflower("nanoflower_left", -FLOWER_OFFSET_X, seed=1)
flower_right = add_nanoflower("nanoflower_right", FLOWER_OFFSET_X, seed=2)

# ── Solver ──────────────────────────────────────────────────
fm.solver(dt=1e-15, g=2.115, integrator="heun")

# ── Outputs ─────────────────────────────────────────────────
fm.save("m", every=1e-13)
fm.save("E_ex", every=1e-13)
fm.save("E_demag", every=1e-13)
fm.save("E_total", every=1e-13)

# ── Run ─────────────────────────────────────────────────────
# fm.relax()
# fm.run(5e-10)
