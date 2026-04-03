from __future__ import annotations

import math
import tempfile
from pathlib import Path
from typing import Mapping

import numpy as np

from fullmag._progress import emit_progress, emit_progress_event
from fullmag.model.discretization import FDM, FEM, PerObjectMeshRecipe, SharedMeshAssemblyPolicy
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

from .gmsh_bridge import (
    AirboxOptions,
    MeshData,
    MeshOptions,
    generate_mesh,
    generate_mesh_from_file,
)
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
    declared_size = _optional_vec3(study_universe.get("size"))
    airbox_hmax = study_universe.get("airbox_hmax")
    resolved_airbox_hmax = float(airbox_hmax) if airbox_hmax is not None else None

    # Treat an explicit declared size as an authoritative airbox, even when the
    # builder currently marks the universe as "auto". The frontend/script
    # builder can preserve auto mode while still materializing a fixed box.
    if declared_size is not None:
        if resolved_mode in {"manual", "auto"}:
            return AirboxOptions(
                size=declared_size,
                center=declared_center,
                hmax=resolved_airbox_hmax,
            )
        return None

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
        hmax=resolved_airbox_hmax,
    )


def _coerce_positive_float(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        candidate = float(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped or stripped == "auto":
            return None
        try:
            candidate = float(stripped)
        except ValueError:
            return None
    else:
        return None
    return candidate if math.isfinite(candidate) and candidate > 0.0 else None


def _shared_domain_local_size_fields(
    geometries: list[Geometry],
    *,
    default_hmax: float,
    per_geometry: object,
    bounds_by_name: dict[str, tuple] | None = None,
) -> list[dict[str, object]]:
    if not isinstance(per_geometry, list):
        return []

    override_by_name: dict[str, Mapping[str, object]] = {}
    for entry in per_geometry:
        if not isinstance(entry, Mapping):
            continue
        raw_name = entry.get("geometry") or entry.get("geometry_name")
        if not isinstance(raw_name, str) or not raw_name.strip():
            continue
        override_by_name[raw_name.strip()] = entry

    fields: list[dict[str, object]] = []
    sentinel_outside = default_hmax  # Use global hmax as outside-box fallback; 1e18 crashed MMG3D
    for geometry in geometries:
        if bounds_by_name is not None:
            bounds_pair = bounds_by_name.get(geometry.geometry_name)
            if bounds_pair is None:
                continue
            bounds_min, bounds_max = bounds_pair
        else:
            bounds_min, bounds_max = geometry_bounds(geometry, source_root=None)
        # geometry_bounds returns (None, None) when file cannot be found — skip
        if bounds_min is None or bounds_max is None:
            continue
        entry = override_by_name.get(geometry.geometry_name)
        target_hmax = _coerce_positive_float(entry.get("hmax") if entry else None) or default_hmax
        extent = np.asarray(bounds_max, dtype=np.float64) - np.asarray(bounds_min, dtype=np.float64)
        min_extent = max(float(np.min(extent)), target_hmax)
        interface_h = min(target_hmax, default_hmax) * 0.6
        interface_pad = max(target_hmax * 0.5, min_extent * 0.05)
        transition_pad = max(target_hmax * 2.5, min_extent * 0.15)
        # Use a two-stage refinement policy:
        # 1. a tight inner box that keeps the magnetic body itself dense
        # 2. a broader transition halo that relaxes towards the coarse airbox
        # This avoids the previous behaviour where the halo scaled with the
        # coarse global hmax and spilled across most of the air domain.
        fields.append(
            {
                "kind": "Box",
                "params": {
                    "VIn": float(interface_h),
                    "VOut": float(target_hmax),
                    "XMin": float(bounds_min[0] - interface_pad),
                    "XMax": float(bounds_max[0] + interface_pad),
                    "YMin": float(bounds_min[1] - interface_pad),
                    "YMax": float(bounds_max[1] + interface_pad),
                    "ZMin": float(bounds_min[2] - interface_pad),
                    "ZMax": float(bounds_max[2] + interface_pad),
                },
            }
        )
        fields.append(
            {
                "kind": "Box",
                "params": {
                    "VIn": float(target_hmax),
                    "VOut": float(sentinel_outside),
                    "XMin": float(bounds_min[0] - transition_pad),
                    "XMax": float(bounds_max[0] + transition_pad),
                    "YMin": float(bounds_min[1] - transition_pad),
                    "YMax": float(bounds_max[1] + transition_pad),
                    "ZMin": float(bounds_min[2] - transition_pad),
                    "ZMax": float(bounds_max[2] + transition_pad),
                },
            }
        )
    return fields


def _resolve_per_object_mesh_options(
    geometries: list[Geometry],
    per_object_recipes: dict[str, PerObjectMeshRecipe],
    assembly_policy: SharedMeshAssemblyPolicy,
    *,
    default_hmax: float,
    bounds_by_name: dict[str, tuple] | None = None,
) -> list[dict[str, object]]:
    """Build size-field overrides from per-object mesh recipes.

    For each geometry that has an associated :class:`PerObjectMeshRecipe`, a
    Box size field is injected centred around the object's bounding box.  The
    element size inside the box is taken from ``recipe.hmax`` (or the global
    ``default_hmax`` when not set) and the size field boundary tolerance is
    scaled by ``assembly_policy.interface_hmax_factor``.
    """
    extra_fields: list[dict[str, object]] = []
    for geometry in geometries:
        recipe = per_object_recipes.get(geometry.geometry_name)
        if recipe is None:
            continue
        if bounds_by_name is not None:
            bounds_pair = bounds_by_name.get(geometry.geometry_name)
            if bounds_pair is None:
                continue
            bounds_min, bounds_max = bounds_pair
        else:
            bounds_min, bounds_max = geometry_bounds(geometry, source_root=None)
        # geometry_bounds returns (None, None) when file cannot be found — skip
        if bounds_min is None or bounds_max is None:
            continue
        target_hmax = recipe.hmax if recipe.hmax is not None else default_hmax
        extent = np.asarray(bounds_max, dtype=np.float64) - np.asarray(bounds_min, dtype=np.float64)
        min_extent = max(float(np.min(extent)), target_hmax)
        # The interface factor controls how tightly the refined region tracks
        # the object boundary.  Values < 1 mean finer elements at interfaces.
        interface_h = target_hmax * assembly_policy.interface_hmax_factor
        interface_pad = max(interface_h * 1.0, min_extent * 0.05)
        transition_pad = max(target_hmax * 2.5, min_extent * 0.15)
        extra_fields.append(
            {
                "kind": "Box",
                "params": {
                    "VIn": float(interface_h),
                    "VOut": float(target_hmax),
                    "XMin": float(bounds_min[0] - interface_pad),
                    "XMax": float(bounds_max[0] + interface_pad),
                    "YMin": float(bounds_min[1] - interface_pad),
                    "YMax": float(bounds_max[1] + interface_pad),
                    "ZMin": float(bounds_min[2] - interface_pad),
                    "ZMax": float(bounds_max[2] + interface_pad),
                },
            }
        )
        extra_fields.append(
            {
                "kind": "Box",
                "params": {
                    "VIn": float(target_hmax),
                    "VOut": float(default_hmax),
                    "XMin": float(bounds_min[0] - transition_pad),
                    "XMax": float(bounds_max[0] + transition_pad),
                    "YMin": float(bounds_min[1] - transition_pad),
                    "YMax": float(bounds_max[1] + transition_pad),
                    "ZMin": float(bounds_min[2] - transition_pad),
                    "ZMax": float(bounds_max[2] + transition_pad),
                },
            }
        )
        # Inject any extra size fields declared directly on the recipe.
        for sf in recipe.size_fields:
            if isinstance(sf, dict):
                extra_fields.append(sf)
    return extra_fields


def _mesh_options_from_runtime_metadata(
    mesh_workflow: Mapping[str, object] | None,
    *,
    geometries: list[Geometry],
    default_hmax: float,
    bounds_by_name: dict[str, tuple] | None = None,
) -> MeshOptions:
    raw_mesh_options = (
        mesh_workflow.get("mesh_options")
        if isinstance(mesh_workflow, Mapping)
        and isinstance(mesh_workflow.get("mesh_options"), Mapping)
        else {}
    )
    assert isinstance(raw_mesh_options, Mapping)
    size_fields = (
        [field for field in raw_mesh_options.get("size_fields", []) if isinstance(field, Mapping)]
        if isinstance(raw_mesh_options.get("size_fields"), list)
        else []
    )
    size_fields.extend(
        _shared_domain_local_size_fields(
            geometries,
            default_hmax=default_hmax,
            per_geometry=mesh_workflow.get("per_geometry") if isinstance(mesh_workflow, Mapping) else None,
            bounds_by_name=bounds_by_name,
        )
    )
    optimize = raw_mesh_options.get("optimize")
    return MeshOptions(
        algorithm_2d=int(raw_mesh_options.get("algorithm_2d", 6)),
        algorithm_3d=int(raw_mesh_options.get("algorithm_3d", 1)),
        hmin=_coerce_positive_float(raw_mesh_options.get("hmin")),
        calibrate_for=(
            str(raw_mesh_options.get("calibrate_for"))
            if isinstance(raw_mesh_options.get("calibrate_for"), str)
            else None
        ),
        size_preset=(
            str(raw_mesh_options.get("size_preset"))
            if isinstance(raw_mesh_options.get("size_preset"), str)
            else None
        ),
        size_factor=float(raw_mesh_options.get("size_factor", 1.0)),
        size_from_curvature=int(raw_mesh_options.get("size_from_curvature", 0)),
        curvature_factor=_coerce_positive_float(raw_mesh_options.get("curvature_factor")),
        growth_rate=_coerce_positive_float(raw_mesh_options.get("growth_rate")),
        narrow_regions=int(raw_mesh_options.get("narrow_regions", 0)),
        narrow_region_resolution=_coerce_positive_float(
            raw_mesh_options.get("narrow_region_resolution")
        ),
        smoothing_steps=int(raw_mesh_options.get("smoothing_steps", 1)),
        optimize=str(optimize) if isinstance(optimize, str) and optimize.strip() else None,
        optimize_iters=int(raw_mesh_options.get("optimize_iterations", 1)),
        size_fields=size_fields,
        compute_quality=bool(raw_mesh_options.get("compute_quality", False)),
        per_element_quality=bool(raw_mesh_options.get("per_element_quality", False)),
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


def _bounds_center(
    bounds_min: tuple[float, float, float],
    bounds_max: tuple[float, float, float],
) -> np.ndarray:
    return 0.5 * (np.asarray(bounds_min, dtype=np.float64) + np.asarray(bounds_max, dtype=np.float64))


def _bounds_intersection_volume(
    left_min: tuple[float, float, float],
    left_max: tuple[float, float, float],
    right_min: tuple[float, float, float],
    right_max: tuple[float, float, float],
) -> float:
    overlap = np.minimum(np.asarray(left_max), np.asarray(right_max)) - np.maximum(
        np.asarray(left_min),
        np.asarray(right_min),
    )
    if np.any(overlap <= 0.0):
        return 0.0
    return float(np.prod(overlap))


def _element_bounds_for_marker(
    mesh: MeshData,
    marker: int,
) -> tuple[tuple[float, float, float], tuple[float, float, float]] | None:
    mask = np.asarray(mesh.element_markers, dtype=np.int32) == int(marker)
    if not np.any(mask):
        return None
    element_nodes = mesh.nodes[mesh.elements[mask].reshape(-1)]
    mins = element_nodes.min(axis=0)
    maxs = element_nodes.max(axis=0)
    return (
        (float(mins[0]), float(mins[1]), float(mins[2])),
        (float(maxs[0]), float(maxs[1]), float(maxs[2])),
    )


def _match_geometry_bounds_to_source_markers(
    geometries: list[Geometry],
    mesh: MeshData,
) -> dict[str, int] | None:
    geometry_bounds_by_name: dict[str, tuple[tuple[float, float, float], tuple[float, float, float]]] = {}
    for geometry in geometries:
        bounds_min, bounds_max = geometry_bounds(geometry)
        if bounds_min is None or bounds_max is None:
            return None
        geometry_bounds_by_name[geometry.geometry_name] = (bounds_min, bounds_max)

    marker_candidates = sorted(
        int(marker)
        for marker in np.unique(np.asarray(mesh.element_markers, dtype=np.int32))
        if int(marker) > 0
    )
    if len(marker_candidates) < len(geometries):
        return None

    magnetic_markers = marker_candidates[: len(geometries)]
    source_bounds_by_marker: dict[int, tuple[tuple[float, float, float], tuple[float, float, float]]] = {}
    for marker in magnetic_markers:
        bounds = _element_bounds_for_marker(mesh, marker)
        if bounds is None:
            return None
        source_bounds_by_marker[marker] = bounds

    unmatched_geometry_names = {geometry.geometry_name for geometry in geometries}
    marker_mapping: dict[str, int] = {}
    for marker in magnetic_markers:
        source_min, source_max = source_bounds_by_marker[marker]
        source_center = _bounds_center(source_min, source_max)
        best_name: str | None = None
        best_intersection = -1.0
        best_distance = math.inf
        for geometry_name in unmatched_geometry_names:
            geometry_min, geometry_max = geometry_bounds_by_name[geometry_name]
            intersection = _bounds_intersection_volume(
                source_min,
                source_max,
                geometry_min,
                geometry_max,
            )
            geometry_center = _bounds_center(geometry_min, geometry_max)
            distance = float(np.linalg.norm(source_center - geometry_center))
            if intersection > best_intersection + 1e-30 or (
                math.isclose(intersection, best_intersection) and distance < best_distance
            ):
                best_name = geometry_name
                best_intersection = intersection
                best_distance = distance
        if best_name is None:
            return None
        marker_mapping[best_name] = marker
        unmatched_geometry_names.remove(best_name)

    if unmatched_geometry_names:
        return None
    return marker_mapping


def _count_nodes_for_element_mask(mesh: MeshData, element_mask: np.ndarray) -> int:
    if mesh.elements.size == 0 or not np.any(element_mask):
        return 0
    return int(np.unique(mesh.elements[element_mask].reshape(-1)).size)


def _display_mesh_partition_name(name: str) -> str:
    if name.endswith("_geom") and len(name) > len("_geom"):
        return name[: -len("_geom")]
    return name


def _emit_shared_domain_mesh_summary(
    mesh: MeshData,
    region_markers: list[dict[str, object]],
) -> None:
    emit_progress(
        "Total mesh: "
        f"{mesh.elements.shape[0]} tetrahedra, {mesh.nodes.shape[0]} nodes, "
        f"{mesh.boundary_faces.shape[0]} boundary faces"
    )

    element_markers = np.asarray(mesh.element_markers, dtype=np.int32)
    air_mask = element_markers == 0
    if np.any(air_mask):
        emit_progress(
            "Mesh part airbox: "
            f"{int(np.count_nonzero(air_mask))} tetrahedra, "
            f"{_count_nodes_for_element_mask(mesh, air_mask)} nodes"
        )

    for entry in region_markers:
        geometry_name = entry.get("geometry_name")
        marker = entry.get("marker")
        if not isinstance(geometry_name, str) or not isinstance(marker, int):
            continue
        part_mask = element_markers == int(marker)
        part_label = _display_mesh_partition_name(geometry_name)
        emit_progress(
            f"Mesh part {part_label}: "
            f"{int(np.count_nonzero(part_mask))} tetrahedra, "
            f"{_count_nodes_for_element_mask(mesh, part_mask)} nodes"
        )


def realize_fem_domain_mesh_asset(
    geometries: list[Geometry],
    hints: FEM,
    *,
    study_universe: Mapping[str, object] | None = None,
    mesh_workflow: Mapping[str, object] | None = None,
    per_object_recipes: dict[str, PerObjectMeshRecipe] | None = None,
    assembly_policy: SharedMeshAssemblyPolicy | None = None,
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

    # Compute bounds directly from already-loaded, scaled component meshes (SI coords).
    # This is more reliable than geometry_bounds(source_root=None) which may fail to
    # locate ImportedGeometry STL files when the subprocess CWD differs from the script dir.
    bounds_by_name: dict[str, tuple] = {}
    for geometry, comp_mesh in zip(geometries, component_meshes):
        verts = np.asarray(comp_mesh.vertices)
        bounds_by_name[geometry.geometry_name] = (
            tuple(float(v) for v in verts.min(axis=0)),
            tuple(float(v) for v in verts.max(axis=0)),
        )

    combined_surface = trimesh.util.concatenate(component_meshes)
    with tempfile.TemporaryDirectory(prefix="fullmag-fem-domain-") as tmp_dir:
        surface_path = Path(tmp_dir) / "shared_domain_surface.stl"
        combined_surface.export(surface_path)
        emit_progress("Preparing shared FEM domain mesh asset")
        mesh_options = _mesh_options_from_runtime_metadata(
            mesh_workflow,
            geometries=geometries,
            default_hmax=float(hints.hmax),
            bounds_by_name=bounds_by_name,
        )
        # Overlay per-object recipe size fields on top of the workflow fields.
        if per_object_recipes:
            _policy = assembly_policy if assembly_policy is not None else SharedMeshAssemblyPolicy()
            recipe_fields = _resolve_per_object_mesh_options(
                geometries,
                per_object_recipes,
                _policy,
                default_hmax=float(hints.hmax),
                bounds_by_name=bounds_by_name,
            )
            if recipe_fields:
                # Prepend recipe fields so they take priority over generic workflow fields.
                existing = list(mesh_options.size_fields)
                from dataclasses import replace as _dc_replace  # local import to avoid polluting module namespace
                mesh_options = _dc_replace(mesh_options, size_fields=recipe_fields + existing)
                emit_progress(
                    f"Per-object mesh recipes active: {len(per_object_recipes)} objects, "
                    f"{len(recipe_fields)} extra size fields"
                )
        if mesh_options.size_fields:
            emit_progress(
                f"Shared-domain local sizing active ({len(mesh_options.size_fields)} size fields)"
            )
        # Raise the Gmsh CharacteristicLengthMax to the maximum of all intended element sizes
        # so coarser per-geometry overrides (VIn > hints.hmax) are not silently clamped.
        # The airbox hmax takes natural precedence as the coarsest intended size.
        effective_hmax = float(hints.hmax)
        if airbox is not None and airbox.hmax is not None and float(airbox.hmax) > effective_hmax:
            effective_hmax = float(airbox.hmax)
        for field in mesh_options.size_fields:
            vin = field.get("params", {}).get("VIn") if isinstance(field.get("params"), dict) else None
            if isinstance(vin, (int, float)) and float(vin) > effective_hmax:
                effective_hmax = float(vin)
        mesh = generate_mesh_from_file(
            surface_path,
            hmax=effective_hmax,
            order=hints.order,
            airbox=airbox,
            options=mesh_options,
        )

    source_markers = np.asarray(mesh.element_markers, dtype=np.int32)
    marker_mapping = _match_geometry_bounds_to_source_markers(geometries, mesh)
    assigned_markers = np.zeros(mesh.n_elements, dtype=np.int32)
    region_markers: list[dict[str, object]] = []
    if marker_mapping is not None:
        for used_marker, geometry in enumerate(geometries, start=1):
            source_marker = marker_mapping.get(geometry.geometry_name)
            if source_marker is None:
                raise ValueError(
                    f"shared FEM domain mesh classification could not map geometry "
                    f"'{geometry.geometry_name}' to a source marker"
                )
            assigned_markers[source_markers == source_marker] = used_marker
            region_markers.append(
                {
                    "geometry_name": geometry.geometry_name,
                    "marker": used_marker,
                }
            )
    else:
        element_centroids = mesh.nodes[mesh.elements].mean(axis=1)
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
        per_domain_quality=mesh.per_domain_quality,
    )
    _emit_shared_domain_mesh_summary(classified_mesh, region_markers)
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
