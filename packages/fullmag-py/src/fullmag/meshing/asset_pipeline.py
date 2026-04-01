from __future__ import annotations

import math
from typing import Mapping

import numpy as np

from fullmag._progress import emit_progress, emit_progress_event
from fullmag.model.discretization import FDM, FEM
from fullmag.model.geometry import Geometry, ImportedGeometry, Translate

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


def _split_outer_translation(
    geometry: Geometry,
) -> tuple[Geometry, tuple[float, float, float]]:
    translation = np.zeros(3, dtype=np.float64)
    current: Geometry = geometry
    while isinstance(current, Translate):
        translation += np.asarray(current.offset, dtype=np.float64)
        current = current.geometry
    return current, (float(translation[0]), float(translation[1]), float(translation[2]))


def _optional_vec3(
    value: object,
) -> tuple[float, float, float] | None:
    if value is None:
        return None
    if isinstance(value, np.ndarray):
        array = np.asarray(value, dtype=np.float64)
    else:
        try:
            array = np.asarray(tuple(value), dtype=np.float64)  # type: ignore[arg-type]
        except TypeError:
            return None
    if array.shape != (3,) or np.any(~np.isfinite(array)):
        return None
    return (float(array[0]), float(array[1]), float(array[2]))


def _cells_from_size(
    size: tuple[float, float, float],
    cell_size: tuple[float, float, float],
) -> tuple[int, int, int]:
    return tuple(
        max(1, int(math.ceil(size[axis] / cell_size[axis] - 1e-12)))
        for axis in range(3)
    )


def _expand_mask_to_domain(
    tight: VoxelMaskData,
    *,
    domain_origin: tuple[float, float, float],
    domain_cells: tuple[int, int, int],
) -> VoxelMaskData:
    cell = np.asarray(tight.cell_size, dtype=np.float64)
    tight_origin = np.asarray(tight.origin, dtype=np.float64)
    domain_origin_vec = np.asarray(domain_origin, dtype=np.float64)
    tight_cells_xyz = np.asarray((tight.shape[2], tight.shape[1], tight.shape[0]), dtype=int)
    domain_cells_xyz = np.asarray(domain_cells, dtype=int)

    delta = (tight_origin - domain_origin_vec) / cell
    start_xyz = np.rint(delta).astype(int)
    if np.any(start_xyz < 0) or np.any(start_xyz + tight_cells_xyz > domain_cells_xyz):
        raise ValueError(
            "study universe is smaller than the realized FDM geometry extent; "
            "increase the universe size or switch back to auto mode"
        )
    actual_origin = tight_origin - start_xyz.astype(np.float64) * cell

    target = np.zeros(
        (int(domain_cells_xyz[2]), int(domain_cells_xyz[1]), int(domain_cells_xyz[0])),
        dtype=np.bool_,
    )
    sx, sy, sz = int(start_xyz[0]), int(start_xyz[1]), int(start_xyz[2])
    nx, ny, nz = int(tight_cells_xyz[0]), int(tight_cells_xyz[1]), int(tight_cells_xyz[2])
    target[sz : sz + nz, sy : sy + ny, sx : sx + nx] = tight.mask
    return VoxelMaskData(
        mask=target,
        cell_size=tight.cell_size,
        origin=(float(actual_origin[0]), float(actual_origin[1]), float(actual_origin[2])),
    )


def _apply_study_universe_to_fdm_asset(
    tight: VoxelMaskData,
    *,
    translation: tuple[float, float, float],
    study_universe: Mapping[str, object] | None,
) -> VoxelMaskData:
    if not study_universe:
        return tight

    mode = study_universe.get("mode")
    resolved_mode = str(mode) if isinstance(mode, str) else "auto"
    padding = _optional_vec3(study_universe.get("padding")) or (0.0, 0.0, 0.0)
    cell = tight.cell_size
    tight_cells = (tight.shape[2], tight.shape[1], tight.shape[0])
    tight_size = tuple(float(tight_cells[axis] * cell[axis]) for axis in range(3))

    if resolved_mode == "manual":
        declared_size = _optional_vec3(study_universe.get("size"))
        if declared_size is None:
            return tight
        center = _optional_vec3(study_universe.get("center")) or (0.0, 0.0, 0.0)
        domain_cells = _cells_from_size(declared_size, cell)
        realized_size = tuple(float(domain_cells[axis] * cell[axis]) for axis in range(3))
        domain_origin = tuple(
            float(center[axis] - realized_size[axis] * 0.5 - translation[axis])
            for axis in range(3)
        )
        return _expand_mask_to_domain(
            tight,
            domain_origin=domain_origin,
            domain_cells=domain_cells,
        )

    if any(component > 0.0 for component in padding):
        tight_center = tuple(
            float(tight.origin[axis] + tight_size[axis] * 0.5)
            for axis in range(3)
        )
        padded_size = tuple(
            float(tight_size[axis] + 2.0 * padding[axis])
            for axis in range(3)
        )
        domain_cells = _cells_from_size(padded_size, cell)
        realized_size = tuple(float(domain_cells[axis] * cell[axis]) for axis in range(3))
        domain_origin = tuple(
            float(tight_center[axis] - realized_size[axis] * 0.5)
            for axis in range(3)
        )
        return _expand_mask_to_domain(
            tight,
            domain_origin=domain_origin,
            domain_cells=domain_cells,
        )

    return tight


def realize_fdm_grid_asset(
    geometry: Geometry,
    hints: FDM,
    *,
    study_universe: Mapping[str, object] | None = None,
) -> VoxelMaskData:
    """Resolve an FDM grid asset by voxelizing the shared geometry contract."""

    base_geometry, translation = _split_outer_translation(geometry)
    tight = voxelize_geometry(base_geometry, hints.cell)
    return _apply_study_universe_to_fdm_asset(
        tight,
        translation=translation,
        study_universe=study_universe,
    )
