from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil
from typing import Any

from fullmag.model.geometry import Box, Cylinder, Difference, Geometry, ImportedGeometry


def _import_trimesh() -> Any:
    try:
        import trimesh  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise ImportError(
            "trimesh is required for STL import/export helpers. "
            "Install with: pip install 'fullmag[meshing]'"
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
    if isinstance(geometry, Box):
        return trimesh.creation.box(extents=geometry.size)
    if isinstance(geometry, Cylinder):
        return trimesh.creation.cylinder(
            radius=geometry.radius,
            height=geometry.height,
            sections=cylinder_sections,
        )
    if isinstance(geometry, Difference):
        base = _geometry_to_trimesh(geometry.base, trimesh, cylinder_sections)
        tool = _geometry_to_trimesh(geometry.tool, trimesh, cylinder_sections)
        return base.difference(tool)
    raise TypeError(f"unsupported geometry for trimesh conversion: {type(geometry)!r}")
