from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

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
            "trimesh is required for STL voxelization helpers. "
            "Install with: pip install 'fullmag[meshing]'"
        ) from exc
    return trimesh


@dataclass(frozen=True, slots=True)
class VoxelMaskData:
    mask: NDArray[np.bool_]
    cell_size: tuple[float, float, float]
    origin: tuple[float, float, float]

    def __post_init__(self) -> None:
        object.__setattr__(self, "mask", np.asarray(self.mask, dtype=np.bool_))
        if self.mask.ndim != 3:
            raise ValueError("mask must have shape (nz, ny, nx)")

    @property
    def shape(self) -> tuple[int, int, int]:
        return tuple(int(v) for v in self.mask.shape)

    @property
    def active_cell_count(self) -> int:
        return int(self.mask.sum())

    @property
    def active_fraction(self) -> float:
        return float(self.mask.mean()) if self.mask.size else 0.0

    def save(self, path: str | Path) -> None:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            target,
            mask=self.mask,
            cell_size=np.asarray(self.cell_size, dtype=np.float64),
            origin=np.asarray(self.origin, dtype=np.float64),
        )

    @classmethod
    def load(cls, path: str | Path) -> "VoxelMaskData":
        data = np.load(Path(path))
        return cls(
            mask=data["mask"],
            cell_size=tuple(float(v) for v in data["cell_size"]),
            origin=tuple(float(v) for v in data["origin"]),
        )

    def to_ir(self, geometry_name: str) -> dict[str, object]:
        nz, ny, nx = self.shape
        return {
            "geometry_name": geometry_name,
            "cells": [nx, ny, nz],
            "cell_size": list(self.cell_size),
            "origin": list(self.origin),
            "active_mask": self.mask.reshape(-1).tolist(),
        }


# ---------------------------------------------------------------------------
# Bounding box computation
# ---------------------------------------------------------------------------
def _bounding_box(geometry: Geometry) -> tuple[float, float, float]:
    """Return (sx, sy, sz) that fully contains the geometry, centered at origin."""
    if isinstance(geometry, Box):
        return geometry.size
    if isinstance(geometry, Cylinder):
        d = 2.0 * geometry.radius
        return (d, d, geometry.height)
    if isinstance(geometry, Ellipsoid):
        return (2.0 * geometry.rx, 2.0 * geometry.ry, 2.0 * geometry.rz)
    if isinstance(geometry, Ellipse):
        return (2.0 * geometry.rx, 2.0 * geometry.ry, geometry.height)
    if isinstance(geometry, Difference):
        return _bounding_box(geometry.base)
    if isinstance(geometry, Union):
        ba = _bounding_box(geometry.a)
        bb = _bounding_box(geometry.b)
        return (max(ba[0], bb[0]), max(ba[1], bb[1]), max(ba[2], bb[2]))
    if isinstance(geometry, Intersection):
        ba = _bounding_box(geometry.a)
        bb = _bounding_box(geometry.b)
        return (min(ba[0], bb[0]), min(ba[1], bb[1]), min(ba[2], bb[2]))
    if isinstance(geometry, Translate):
        inner = _bounding_box(geometry.geometry)
        ox, oy, oz = geometry.offset
        return (
            inner[0] + 2.0 * abs(ox),
            inner[1] + 2.0 * abs(oy),
            inner[2] + 2.0 * abs(oz),
        )
    if isinstance(geometry, ImportedGeometry):
        raise TypeError(
            "cannot compute bounding box for ImportedGeometry; "
            "use _voxelize_imported_geometry directly"
        )
    raise TypeError(f"unsupported geometry type: {type(geometry)!r}")


# ---------------------------------------------------------------------------
# SDF-based containment test (vectorized numpy)
# ---------------------------------------------------------------------------
def _contains(
    geometry: Geometry,
    xx: NDArray[np.float64],
    yy: NDArray[np.float64],
    zz: NDArray[np.float64],
) -> NDArray[np.bool_]:
    """Return boolean mask of cells contained in the geometry.

    xx, yy, zz are 3D arrays of cell center coordinates (shape nz, ny, nx).
    """
    if isinstance(geometry, Box):
        sx, sy, sz = geometry.size
        return (
            (np.abs(xx) <= sx / 2.0)
            & (np.abs(yy) <= sy / 2.0)
            & (np.abs(zz) <= sz / 2.0)
        )

    if isinstance(geometry, Cylinder):
        r = geometry.radius
        h = geometry.height
        return (xx * xx + yy * yy <= r * r) & (np.abs(zz) <= h / 2.0)

    if isinstance(geometry, Ellipsoid):
        rx, ry, rz = geometry.rx, geometry.ry, geometry.rz
        return (xx / rx) ** 2 + (yy / ry) ** 2 + (zz / rz) ** 2 <= 1.0

    if isinstance(geometry, Ellipse):
        rx, ry, h = geometry.rx, geometry.ry, geometry.height
        return ((xx / rx) ** 2 + (yy / ry) ** 2 <= 1.0) & (np.abs(zz) <= h / 2.0)

    if isinstance(geometry, Difference):
        base_mask = _contains(geometry.base, xx, yy, zz)
        tool_mask = _contains(geometry.tool, xx, yy, zz)
        return base_mask & ~tool_mask

    if isinstance(geometry, Union):
        return _contains(geometry.a, xx, yy, zz) | _contains(geometry.b, xx, yy, zz)

    if isinstance(geometry, Intersection):
        return _contains(geometry.a, xx, yy, zz) & _contains(geometry.b, xx, yy, zz)

    if isinstance(geometry, Translate):
        ox, oy, oz = geometry.offset
        return _contains(geometry.geometry, xx - ox, yy - oy, zz - oz)

    raise TypeError(f"unsupported geometry type for containment test: {type(geometry)!r}")


# ---------------------------------------------------------------------------
# Main voxelization entry point
# ---------------------------------------------------------------------------
def voxelize_geometry(
    geometry: Geometry,
    cell_size: tuple[float, float, float],
) -> VoxelMaskData:
    """Convert any Geometry into a VoxelMaskData using SDF containment.

    For ImportedGeometry, delegates to file-based loading.
    For all other types, uses recursive ``_contains`` evaluation.
    """
    if isinstance(geometry, ImportedGeometry):
        return _voxelize_imported_geometry(geometry.source, cell_size)

    # Compute bounding box and grid
    sx, sy, sz = _bounding_box(geometry)
    dx, dy, dz = cell_size
    nx = max(1, int(round(sx / dx)))
    ny = max(1, int(round(sy / dy)))
    nz = max(1, int(round(sz / dz)))

    # Cell center coordinates
    xs = -sx / 2.0 + (np.arange(nx, dtype=np.float64) + 0.5) * dx
    ys = -sy / 2.0 + (np.arange(ny, dtype=np.float64) + 0.5) * dy
    zs = -sz / 2.0 + (np.arange(nz, dtype=np.float64) + 0.5) * dz

    # 3D meshgrid: xx[iz, iy, ix], yy[iz, iy, ix], zz[iz, iy, ix]
    xx_2d, yy_2d = np.meshgrid(xs, ys, indexing="xy")
    xx = np.broadcast_to(xx_2d[np.newaxis, :, :], (nz, ny, nx)).copy()
    yy = np.broadcast_to(yy_2d[np.newaxis, :, :], (nz, ny, nx)).copy()
    zz = np.broadcast_to(
        zs[:, np.newaxis, np.newaxis], (nz, ny, nx)
    ).copy()

    mask = _contains(geometry, xx, yy, zz)

    return VoxelMaskData(
        mask=mask,
        cell_size=cell_size,
        origin=(-sx / 2.0, -sy / 2.0, -sz / 2.0),
    )


# ---------------------------------------------------------------------------
# Imported geometry (NPZ / STL)
# ---------------------------------------------------------------------------
def _voxelize_imported_geometry(
    source: str | Path,
    cell_size: tuple[float, float, float],
) -> VoxelMaskData:
    path = Path(source)
    if path.suffix.lower() == ".npz":
        mask_data = VoxelMaskData.load(path)
        if any(
            not np.isclose(mask_data.cell_size[index], cell_size[index])
            for index in range(3)
        ):
            raise ValueError(
                "precomputed voxel mask cell size does not match requested FDM cell size"
            )
        return mask_data
    if path.suffix.lower() != ".stl":
        raise ValueError(
            "initial imported-geometry voxelization scaffold supports only STL or precomputed .npz voxel assets"
        )

    dx, dy, dz = cell_size
    if not np.isclose(dx, dy) or not np.isclose(dx, dz):
        raise NotImplementedError(
            "initial STL voxelization scaffold supports only isotropic cell size"
        )

    trimesh = _import_trimesh()
    mesh = trimesh.load_mesh(path, force="mesh")
    voxel_grid = mesh.voxelized(dx)
    matrix = np.asarray(voxel_grid.matrix, dtype=np.bool_)
    translation = np.asarray(voxel_grid.transform[:3, 3], dtype=np.float64)

    return VoxelMaskData(
        mask=matrix,
        cell_size=(dx, dy, dz),
        origin=(float(translation[0]), float(translation[1]), float(translation[2])),
    )
