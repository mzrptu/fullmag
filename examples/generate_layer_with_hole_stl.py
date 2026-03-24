"""Generate STL mesh of Permalloy layer 1000×1000×10 nm with 150nm radius hole.

Usage:
    python examples/generate_layer_with_hole_stl.py
"""

import fullmag as fm

# ── Geometry: Box with cylindrical hole ──────────
layer = fm.Box(size=(1000e-9, 1000e-9, 10e-9), name="layer")
hole = fm.Cylinder(radius=150e-9, height=10e-9, name="hole")
body = fm.Difference(base=layer, tool=hole, name="py_layer_with_hole")

# ── Generate FEM tetrahedral mesh via Gmsh ───────
mesh = fm.generate_mesh(body, hmax=20e-9)
print(f"Mesh: {mesh.n_nodes} nodes, {mesh.n_elements} tetrahedra, {mesh.n_boundary_faces} boundary faces")

# ── Export ────────────────────────────────────────
mesh.save("py_layer_with_hole.mesh.json")
mesh.export_stl("py_layer_with_hole.stl")
print("Saved: py_layer_with_hole.mesh.json")
print("Saved: py_layer_with_hole.stl")
