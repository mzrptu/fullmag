from __future__ import annotations

import numpy as np

from fullmag._progress import emit_progress, emit_progress_event
from fullmag.model.discretization import FDM, FEM
from fullmag.model.geometry import Geometry, ImportedGeometry

from .gmsh_bridge import MeshData, generate_mesh, generate_mesh_from_file
from .surface_assets import build_surface_preview_payload
from .voxelization import VoxelMaskData, voxelize_geometry


def _surface_preview_to_mesh_data(preview: dict[str, object]) -> MeshData:
    nodes = np.asarray(preview.get("nodes", []), dtype=np.float64)
    boundary_faces = np.asarray(preview.get("boundary_faces", []), dtype=np.int32)
    if nodes.ndim != 2 or nodes.shape[1] != 3:
        raise ValueError("surface preview nodes must have shape (N, 3)")
    if boundary_faces.ndim != 2 or (boundary_faces.size and boundary_faces.shape[1] != 3):
        raise ValueError("surface preview boundary_faces must have shape (F, 3)")
    return MeshData(
        nodes=nodes,
        elements=np.zeros((0, 4), dtype=np.int32),
        element_markers=np.zeros((0,), dtype=np.int32),
        boundary_faces=boundary_faces,
        boundary_markers=np.ones((boundary_faces.shape[0],), dtype=np.int32),
    )


def realize_fem_mesh_asset(geometry: Geometry, hints: FEM) -> MeshData:
    """Resolve a FEM mesh asset from either a prebuilt mesh or geometry source."""

    preview = build_surface_preview_payload(geometry)
    if preview is not None:
        emit_progress_event(
            {
                "kind": "fem_surface_preview",
                "geometry_name": geometry.geometry_name,
                "fem_mesh": preview,
                "is_preview": True,
                "message": (
                    f"Surface preview ready for '{geometry.geometry_name}': "
                    f"{len(preview['nodes'])} vertices, {len(preview['boundary_faces'])} faces"
                ),
            }
        )

    surface_only = (
        hints.mesh is None
        and isinstance(geometry, ImportedGeometry)
        and geometry.volume == "surface"
    )
    if surface_only:
        if preview is None:
            raise ValueError(
                f"ImportedGeometry(volume='surface') for '{geometry.geometry_name}' "
                "requires a readable surface source preview. "
                "Currently this preview path is supported for STL-backed imports."
            )
        emit_progress(
            f"Using surface-only mesh for '{geometry.geometry_name}' "
            f"with {len(preview['boundary_faces'])} boundary faces"
        )
        return _surface_preview_to_mesh_data(preview)

    if hints.mesh is not None:
        emit_progress(f"Resolving FEM mesh from source '{hints.mesh}'")
        mesh = generate_mesh_from_file(hints.mesh, hmax=hints.hmax, order=hints.order)
    else:
        emit_progress(
            f"Generating FEM mesh from geometry '{geometry.geometry_name}' with hmax={hints.hmax:.4e}"
        )
        mesh = generate_mesh(geometry, hmax=hints.hmax, order=hints.order)

    if mesh.n_elements == 0:
        raise ValueError(
            f"FEM mesh for '{geometry.geometry_name}' contains 0 tetrahedral elements. "
            "The geometry surface may not be watertight or manifold. "
            "Try repairing the STL in a mesh tool like MeshLab or reducing hmax."
        )

    return mesh


def realize_fdm_grid_asset(geometry: Geometry, hints: FDM) -> VoxelMaskData:
    """Resolve an FDM grid asset by voxelizing the shared geometry contract."""

    return voxelize_geometry(geometry, hints.cell)
