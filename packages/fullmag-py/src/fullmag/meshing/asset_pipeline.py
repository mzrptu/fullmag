from __future__ import annotations

from fullmag._progress import emit_progress, emit_progress_event
from fullmag.model.discretization import FDM, FEM
from fullmag.model.geometry import Geometry

from .gmsh_bridge import MeshData, generate_mesh, generate_mesh_from_file
from .surface_assets import build_surface_preview_payload
from .voxelization import VoxelMaskData, voxelize_geometry


def realize_fem_mesh_asset(geometry: Geometry, hints: FEM) -> MeshData:
    """Resolve a FEM mesh asset from either a prebuilt mesh or geometry source."""

    preview = build_surface_preview_payload(geometry)
    if preview is not None:
        emit_progress_event(
            {
                "kind": "fem_surface_preview",
                "geometry_name": geometry.geometry_name,
                "fem_mesh": preview,
                "message": (
                    f"Surface preview ready for '{geometry.geometry_name}': "
                    f"{len(preview['nodes'])} vertices, {len(preview['boundary_faces'])} faces"
                ),
            }
        )

    if hints.mesh is not None:
        emit_progress(f"Resolving FEM mesh from source '{hints.mesh}'")
        return generate_mesh_from_file(hints.mesh, hmax=hints.hmax, order=hints.order)
    emit_progress(
        f"Generating FEM mesh from geometry '{geometry.geometry_name}' with hmax={hints.hmax:.4e}"
    )
    return generate_mesh(geometry, hmax=hints.hmax, order=hints.order)


def realize_fdm_grid_asset(geometry: Geometry, hints: FDM) -> VoxelMaskData:
    """Resolve an FDM grid asset by voxelizing the shared geometry contract."""

    return voxelize_geometry(geometry, hints.cell)
