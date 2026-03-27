from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil
from typing import Any

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


def _import_trimesh() -> Any:
    try:
        import trimesh  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise ImportError(
            "trimesh is required for STL import/export helpers. "
            "Install with: python -m pip install 'trimesh>=4.2'"
        ) from exc
    return trimesh


@dataclass(frozen=True, slots=True)
class SurfaceAsset:
    path: Path
    format: str
    watertight: bool | None
    bounds_min: tuple[float, float, float] | None
    bounds_max: tuple[float, float, float] | None


def load_surface_asset(source: str | Path) -> SurfaceAsset:
    path = Path(source)
    fmt = path.suffix.lower().lstrip(".")
    if fmt not in {"stl", "step", "stp", "iges", "igs"}:
        raise ValueError(f"unsupported geometry asset format: {path.suffix}")

    if fmt != "stl":
        return SurfaceAsset(
            path=path,
            format=fmt,
            watertight=None,
            bounds_min=None,
            bounds_max=None,
        )

    trimesh = _import_trimesh()
    mesh = trimesh.load_mesh(path, force="mesh")
    bounds = mesh.bounds
    return SurfaceAsset(
        path=path,
        format=fmt,
        watertight=bool(mesh.is_watertight),
        bounds_min=tuple(float(value) for value in bounds[0]),
        bounds_max=tuple(float(value) for value in bounds[1]),
    )


def build_surface_preview_payload(geometry: Geometry) -> dict[str, object] | None:
    try:
        trimesh = _import_trimesh()
        mesh = _geometry_to_trimesh(geometry, trimesh)
    except Exception:
        return None

    if mesh is None:
        return None

    mesh = mesh.copy()
    if hasattr(mesh, "remove_unreferenced_vertices"):
        mesh.remove_unreferenced_vertices()
    if hasattr(mesh, "merge_vertices"):
        mesh.merge_vertices()

    vertices = getattr(mesh, "vertices", None)
    faces = getattr(mesh, "faces", None)
    if vertices is None or faces is None or len(vertices) == 0 or len(faces) == 0:
        return None

    return {
        "nodes": [[float(x), float(y), float(z)] for x, y, z in vertices.tolist()],
        "elements": [],
        "boundary_faces": [
            [int(face[0]), int(face[1]), int(face[2])] for face in faces.tolist()
        ],
    }


def export_geometry_to_stl(
    geometry: Geometry,
    destination: str | Path,
    *,
    cylinder_sections: int = 48,
) -> Path:
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)

    if isinstance(geometry, ImportedGeometry):
        source = Path(geometry.source)
        if source.suffix.lower() != ".stl":
            raise ValueError(
                "exporting ImportedGeometry to STL is only passthrough-supported when the source is already .stl"
            )
        if source.resolve() != target.resolve():
            shutil.copyfile(source, target)
        return target

    trimesh = _import_trimesh()
    if isinstance(geometry, Box):
        mesh = trimesh.creation.box(extents=geometry.size)
    elif isinstance(geometry, Cylinder):
        mesh = trimesh.creation.cylinder(
            radius=geometry.radius,
            height=geometry.height,
            sections=cylinder_sections,
        )
    elif isinstance(geometry, Difference):
        base_mesh = _geometry_to_trimesh(geometry.base, trimesh, cylinder_sections)
        tool_mesh = _geometry_to_trimesh(geometry.tool, trimesh, cylinder_sections)
        try:
            mesh = base_mesh.difference(tool_mesh)
        except Exception:
            # Fallback: generate via Gmsh and export boundary faces
            from .gmsh_bridge import generate_difference_mesh
            mesh_data = generate_difference_mesh(geometry, hmax=min(geometry.base.size) / 20.0 if isinstance(geometry.base, Box) else 5e-9)
            return mesh_data.export_stl(target)
    else:
        raise TypeError(f"unsupported geometry type: {type(geometry)!r}")

    mesh.export(target)
    return target


def _geometry_to_trimesh(
    geometry: Geometry,
    trimesh: Any,
    cylinder_sections: int = 48,
) -> Any:
    """Convert a geometry primitive to a trimesh Trimesh object."""
    if isinstance(geometry, ImportedGeometry):
        return _imported_geometry_to_trimesh(geometry, trimesh)
    if isinstance(geometry, Box):
        return trimesh.creation.box(extents=geometry.size)
    if isinstance(geometry, Cylinder):
        return trimesh.creation.cylinder(
            radius=geometry.radius,
            height=geometry.height,
            sections=cylinder_sections,
        )
    if isinstance(geometry, Ellipsoid):
        mesh = trimesh.creation.icosphere(subdivisions=3, radius=1.0)
        mesh.vertices[:, 0] *= geometry.rx
        mesh.vertices[:, 1] *= geometry.ry
        mesh.vertices[:, 2] *= geometry.rz
        return mesh
    if isinstance(geometry, Ellipse):
        mesh = trimesh.creation.cylinder(radius=1.0, height=geometry.height, sections=cylinder_sections)
        mesh.vertices[:, 0] *= geometry.rx
        mesh.vertices[:, 1] *= geometry.ry
        return mesh
    if isinstance(geometry, Difference):
        base = _geometry_to_trimesh(geometry.base, trimesh, cylinder_sections)
        tool = _geometry_to_trimesh(geometry.tool, trimesh, cylinder_sections)
        return base.difference(tool)
    if isinstance(geometry, Union):
        a = _geometry_to_trimesh(geometry.a, trimesh, cylinder_sections)
        b = _geometry_to_trimesh(geometry.b, trimesh, cylinder_sections)
        return a.union(b)
    if isinstance(geometry, Intersection):
        a = _geometry_to_trimesh(geometry.a, trimesh, cylinder_sections)
        b = _geometry_to_trimesh(geometry.b, trimesh, cylinder_sections)
        return a.intersection(b)
    if isinstance(geometry, Translate):
        mesh = _geometry_to_trimesh(geometry.geometry, trimesh, cylinder_sections)
        mesh = mesh.copy()
        mesh.apply_translation(geometry.offset)
        return mesh
    raise TypeError(f"unsupported geometry for trimesh conversion: {type(geometry)!r}")


def _imported_geometry_to_trimesh(geometry: ImportedGeometry, trimesh: Any) -> Any:
    source = Path(geometry.source)
    if source.suffix.lower() != ".stl":
        raise ValueError(
            "surface preview currently supports ImportedGeometry when the source is STL"
        )

    mesh = trimesh.load_mesh(source, force="mesh")
    mesh = mesh.copy()
    scale = geometry.scale
    if isinstance(scale, (int, float)):
        mesh.apply_scale(float(scale))
    else:
        mesh.vertices *= scale
    return mesh
