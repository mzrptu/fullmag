from __future__ import annotations

from fullmag.model.discretization import FDM, FEM
from fullmag.model.geometry import Geometry

from .gmsh_bridge import MeshData, generate_mesh, generate_mesh_from_file
from .voxelization import VoxelMaskData, voxelize_geometry


def realize_fem_mesh_asset(geometry: Geometry, hints: FEM) -> MeshData:
    """Resolve a FEM mesh asset from either a prebuilt mesh or geometry source."""

    if hints.mesh is not None:
        return generate_mesh_from_file(hints.mesh, hmax=hints.hmax, order=hints.order)
    return generate_mesh(geometry, hmax=hints.hmax, order=hints.order)


def realize_fdm_grid_asset(geometry: Geometry, hints: FDM) -> VoxelMaskData:
    """Resolve an FDM grid asset by voxelizing the shared geometry contract."""

    return voxelize_geometry(geometry, hints.cell)
