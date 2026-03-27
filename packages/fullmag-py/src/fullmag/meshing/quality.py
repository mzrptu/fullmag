from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .gmsh_bridge import MeshData


@dataclass(frozen=True, slots=True)
class MeshValidationReport:
    """Basic mesh validation report (inverted elements, volume range)."""

    n_nodes: int
    n_elements: int
    n_boundary_faces: int
    n_inverted: int
    min_volume: float
    max_volume: float
    is_valid: bool


def validate_mesh(mesh: MeshData) -> MeshValidationReport:
    """Validate mesh topology and element orientation."""
    volumes: list[float] = []
    inverted = 0

    for element in mesh.elements:
        n0, n1, n2, n3 = (int(v) for v in element)
        p0 = mesh.nodes[n0]
        p1 = mesh.nodes[n1]
        p2 = mesh.nodes[n2]
        p3 = mesh.nodes[n3]
        mat = np.column_stack([p1 - p0, p2 - p0, p3 - p0])
        signed_volume = float(np.linalg.det(mat) / 6.0)
        if signed_volume <= 0.0:
            inverted += 1
        volumes.append(abs(signed_volume))

    min_volume = min(volumes) if volumes else 0.0
    max_volume = max(volumes) if volumes else 0.0
    is_valid = mesh.n_nodes >= 4 and mesh.n_elements > 0 and inverted == 0 and min_volume > 0.0

    return MeshValidationReport(
        n_nodes=mesh.n_nodes,
        n_elements=mesh.n_elements,
        n_boundary_faces=mesh.n_boundary_faces,
        n_inverted=inverted,
        min_volume=min_volume,
        max_volume=max_volume,
        is_valid=is_valid,
    )
