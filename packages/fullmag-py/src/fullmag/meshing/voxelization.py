from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from fullmag.model.geometry import Box, Cylinder, Geometry, ImportedGeometry


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


def voxelize_geometry(
    geometry: Geometry,
    cell_size: tuple[float, float, float],
) -> VoxelMaskData:
    if isinstance(geometry, Box):
        return _voxelize_box(geometry.size, cell_size)
    if isinstance(geometry, Cylinder):
        return _voxelize_cylinder(geometry.radius, geometry.height, cell_size)
    if isinstance(geometry, ImportedGeometry):
        return _voxelize_imported_geometry(geometry.source, cell_size)
    raise TypeError(f"unsupported geometry type: {type(geometry)!r}")


def _voxelize_box(
    size: tuple[float, float, float],
    cell_size: tuple[float, float, float],
) -> VoxelMaskData:
    sx, sy, sz = size
    dx, dy, dz = cell_size
    nx = max(1, int(round(sx / dx)))
    ny = max(1, int(round(sy / dy)))
    nz = max(1, int(round(sz / dz)))
    mask = np.ones((nz, ny, nx), dtype=np.bool_)
    return VoxelMaskData(
        mask=mask,
        cell_size=cell_size,
        origin=(-sx / 2.0, -sy / 2.0, -sz / 2.0),
    )


def _voxelize_cylinder(
    radius: float,
    height: float,
    cell_size: tuple[float, float, float],
) -> VoxelMaskData:
    dx, dy, dz = cell_size
    sx = 2.0 * radius
    sy = 2.0 * radius
    sz = height
    nx = max(1, int(round(sx / dx)))
    ny = max(1, int(round(sy / dy)))
    nz = max(1, int(round(sz / dz)))

    xs = (-sx / 2.0) + (np.arange(nx, dtype=np.float64) + 0.5) * dx
    ys = (-sy / 2.0) + (np.arange(ny, dtype=np.float64) + 0.5) * dy
    zz = (-sz / 2.0) + (np.arange(nz, dtype=np.float64) + 0.5) * dz

    xx, yy = np.meshgrid(xs, ys, indexing="xy")
    radial_mask = (xx * xx + yy * yy) <= radius * radius
    mask = np.repeat(radial_mask[np.newaxis, :, :], nz, axis=0)
    mask &= (np.abs(zz)[:, np.newaxis, np.newaxis] <= (height / 2.0))

    return VoxelMaskData(
        mask=mask,
        cell_size=cell_size,
        origin=(-sx / 2.0, -sy / 2.0, -sz / 2.0),
    )


def _voxelize_imported_geometry(
    source: str | Path,
    cell_size: tuple[float, float, float],
) -> VoxelMaskData:
    path = Path(source)
    if path.suffix.lower() != ".stl":
        raise ValueError(
            "initial imported-geometry voxelization scaffold supports only STL surface assets"
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
