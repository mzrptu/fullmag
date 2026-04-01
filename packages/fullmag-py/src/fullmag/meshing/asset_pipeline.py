from __future__ import annotations

import math
import tempfile
from pathlib import Path
from typing import Mapping

import numpy as np

from fullmag._progress import emit_progress, emit_progress_event
from fullmag.model.discretization import FDM, FEM
from fullmag.model.domain_frame import geometry_bounds
from fullmag.model.geometry import (
    Box,
    Cylinder,
    Difference,
    Ellipse,
    Ellipsoid,
    Geometry,
    ImportedGeometry,
    Intersection,
    Translate,
    Union,
)

from .gmsh_bridge import AirboxOptions, MeshData, generate_mesh, generate_mesh_from_file
from .surface_assets import _geometry_to_trimesh, _import_trimesh, build_surface_preview_payload
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


def realize_fem_mesh_asset(
    geometry: Geometry,
    hints: FEM,
    *,
    study_universe: Mapping[str, object] | None = None,
) -> MeshData:
    """Resolve a FEM mesh asset from either a prebuilt mesh or geometry source."""

    # The executable FEM lowering path increasingly depends on study-level
    # universe/domain metadata. The actual air-box meshing policy is still
    # determined by the active mesh source/generator, but we keep the value in
    # the call signature now so the higher layers can pass it through without
    # losing intent or cache correctness.
    _ = study_universe

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


def _study_universe_airbox_options(
    geometries: list[Geometry],
    study_universe: Mapping[str, object] | None,
) -> AirboxOptions | None:
    if not study_universe:
        return None

    mode = study_universe.get("mode")
    resolved_mode = str(mode) if isinstance(mode, str) else "auto"
    declared_center = _optional_vec3(study_universe.get("center")) or (0.0, 0.0, 0.0)

    if resolved_mode == "manual":
        declared_size = _optional_vec3(study_universe.get("size"))
        if declared_size is None:
            return None
        return AirboxOptions(
            size=declared_size,
            center=declared_center,
        )

    padding = _optional_vec3(study_universe.get("padding")) or (0.0, 0.0, 0.0)
    if not any(component > 0.0 for component in padding):
        return None

    per_geometry_bounds = [
        geometry_bounds(geometry, source_root=None)
        for geometry in geometries
    ]
    valid_bounds = [bounds for bounds in per_geometry_bounds if bounds is not None]
    if not valid_bounds:
        return None

    mins = np.asarray([bounds[0] for bounds in valid_bounds], dtype=np.float64)
    maxs = np.asarray([bounds[1] for bounds in valid_bounds], dtype=np.float64)
    object_min = mins.min(axis=0)
    object_max = maxs.max(axis=0)
    size = tuple(
        float(object_max[axis] - object_min[axis] + 2.0 * padding[axis])
        for axis in range(3)
    )
    center = tuple(float(0.5 * (object_min[axis] + object_max[axis])) for axis in range(3))
    return AirboxOptions(
        size=size,
        center=center,
    )


def _contains_points_in_geometry(
    geometry: Geometry,
    points: np.ndarray,
) -> np.ndarray:
    if points.size == 0:
        return np.zeros((0,), dtype=np.bool_)

    if isinstance(geometry, Box):
        sx, sy, sz = geometry.size
        return (
            (np.abs(points[:, 0]) <= sx / 2.0)
            & (np.abs(points[:, 1]) <= sy / 2.0)
            & (np.abs(points[:, 2]) <= sz / 2.0)
        )
    if isinstance(geometry, Cylinder):
        radius = geometry.radius
        height = geometry.height
        return (
            points[:, 0] ** 2 + points[:, 1] ** 2 <= radius * radius
        ) & (np.abs(points[:, 2]) <= height / 2.0)
    if isinstance(geometry, Ellipsoid):
        rx, ry, rz = geometry.rx, geometry.ry, geometry.rz
        return (
            (points[:, 0] / rx) ** 2
            + (points[:, 1] / ry) ** 2
            + (points[:, 2] / rz) ** 2
            <= 1.0
        )
    if isinstance(geometry, Ellipse):
        rx, ry, height = geometry.rx, geometry.ry, geometry.height
        return (
            (points[:, 0] / rx) ** 2 + (points[:, 1] / ry) ** 2 <= 1.0
        ) & (np.abs(points[:, 2]) <= height / 2.0)
    if isinstance(geometry, Difference):
        return _contains_points_in_geometry(geometry.base, points) & ~_contains_points_in_geometry(
            geometry.tool,
            points,
        )
    if isinstance(geometry, Union):
        return _contains_points_in_geometry(geometry.a, points) | _contains_points_in_geometry(
            geometry.b,
            points,
        )
    if isinstance(geometry, Intersection):
        return _contains_points_in_geometry(
            geometry.a,
            points,
        ) & _contains_points_in_geometry(geometry.b, points)
    if isinstance(geometry, Translate):
        offset = np.asarray(geometry.offset, dtype=np.float64)
        return _contains_points_in_geometry(geometry.geometry, points - offset.reshape(1, 3))
    if isinstance(geometry, ImportedGeometry):
        trimesh = _import_trimesh()
        surface = _geometry_to_trimesh(geometry, trimesh)
        return np.asarray(surface.contains(points), dtype=np.bool_)
    raise TypeError(f"unsupported geometry type for point containment: {type(geometry)!r}")


def realize_fem_domain_mesh_asset(
    geometries: list[Geometry],
    hints: FEM,
    *,
    study_universe: Mapping[str, object] | None = None,
) -> tuple[MeshData, list[dict[str, object]]]:
    if not geometries:
        raise ValueError("shared FEM domain mesh requires at least one geometry")

    airbox = _study_universe_airbox_options(geometries, study_universe)
    if airbox is None:
        raise ValueError(
            "shared FEM domain mesh generation requires a declared study universe "
            "(manual size/center or auto padding)"
        )

    trimesh = _import_trimesh()
    component_meshes = []
    for geometry in geometries:
        component_mesh = _geometry_to_trimesh(geometry, trimesh)
        component_meshes.append(component_mesh.copy())

    combined_surface = trimesh.util.concatenate(component_meshes)
    with tempfile.TemporaryDirectory(prefix="fullmag-fem-domain-") as tmp_dir:
        surface_path = Path(tmp_dir) / "shared_domain_surface.stl"
        combined_surface.export(surface_path)
        emit_progress("Preparing shared FEM domain mesh asset")
        mesh = generate_mesh_from_file(
            surface_path,
            hmax=hints.hmax,
            order=hints.order,
            airbox=airbox,
        )

    element_centroids = mesh.nodes[mesh.elements].mean(axis=1)
    assigned_markers = np.zeros(mesh.n_elements, dtype=np.int32)
    region_markers: list[dict[str, object]] = []
    used_marker = 1
    for geometry in geometries:
        inside = _contains_points_in_geometry(geometry, element_centroids)
        overlap = inside & (assigned_markers != 0)
        if np.any(overlap):
            raise ValueError(
                f"shared FEM domain mesh classification overlapped for geometry '{geometry.geometry_name}'"
            )
        assigned_markers[inside] = used_marker
        region_markers.append(
            {
                "geometry_name": geometry.geometry_name,
                "marker": used_marker,
            }
        )
        used_marker += 1

    if np.any(assigned_markers == 0):
        source_markers = np.asarray(mesh.element_markers, dtype=np.int32)
        magnetic_source_mask = source_markers == 1
        if np.any(magnetic_source_mask & (assigned_markers == 0)):
            raise ValueError(
                "shared FEM domain mesh contains magnetic elements that could not be mapped "
                "back to any geometry"
            )

    classified_mesh = MeshData(
        nodes=mesh.nodes,
        elements=mesh.elements,
        element_markers=assigned_markers,
        boundary_faces=mesh.boundary_faces,
        boundary_markers=mesh.boundary_markers,
        quality=mesh.quality,
    )
    return classified_mesh, region_markers


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
