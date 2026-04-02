from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any
import math

import numpy as np
from numpy.typing import NDArray

from fullmag._progress import emit_progress
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


# ---------------------------------------------------------------------------
# Mesh quality report
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class MeshQualityReport:
    """Per-element quality metrics extracted from Gmsh.

    Attributes:
        n_elements: Total element count.
        sicn_min: Minimum Signed Inverse Condition Number (ideal → 1).
        sicn_max: Maximum SICN.
        sicn_mean: Mean SICN across all elements.
        sicn_p5: 5th-percentile SICN (worst-case tail).
        sicn_histogram: 20 bins across [-1, 1].
        gamma_min: Minimum inscribed/circumscribed ratio (ideal → 1).
        gamma_mean: Mean gamma.
        gamma_histogram: 20 bins across [0, 1].
        volume_min: Smallest element volume.
        volume_max: Largest element volume.
        volume_mean: Mean element volume.
        volume_std: Standard deviation of volumes.
        avg_quality: Global ``Mesh.AvgQuality`` (ICN) from Gmsh.
        element_sicn: Per-element SICN values (None if not requested).
        element_gamma: Per-element gamma values (None if not requested).
    """

    n_elements: int
    sicn_min: float
    sicn_max: float
    sicn_mean: float
    sicn_p5: float
    sicn_histogram: list[int]
    gamma_min: float
    gamma_mean: float
    gamma_histogram: list[int]
    volume_min: float
    volume_max: float
    volume_mean: float
    volume_std: float
    avg_quality: float
    element_sicn: list[float] | None = None
    element_gamma: list[float] | None = None


# ---------------------------------------------------------------------------
# Mesh generation options
# ---------------------------------------------------------------------------
# 2D algorithm constants
ALGO_2D_MESHADAPT = 1
ALGO_2D_AUTOMATIC = 2
ALGO_2D_DELAUNAY = 5
ALGO_2D_FRONTAL_DELAUNAY = 6
ALGO_2D_BAMG = 7
ALGO_2D_FRONTAL_QUADS = 8

# 3D algorithm constants
ALGO_3D_DELAUNAY = 1
ALGO_3D_FRONTAL = 4
ALGO_3D_MMG3D = 7
ALGO_3D_HXT = 10


@dataclass(frozen=True, slots=True)
class MeshOptions:
    """Advanced mesh generation options passed through to Gmsh.

    All fields have safe defaults that match Gmsh 4.x behaviour.
    """

    algorithm_2d: int = ALGO_2D_FRONTAL_DELAUNAY
    algorithm_3d: int = ALGO_3D_DELAUNAY
    hmin: float | None = None
    size_factor: float = 1.0
    size_from_curvature: int = 0
    growth_rate: float | None = None
    narrow_regions: int = 0
    smoothing_steps: int = 1
    optimize: str | None = None
    optimize_iters: int = 1
    size_fields: list[dict[str, Any]] = field(default_factory=list)
    compute_quality: bool = False
    per_element_quality: bool = False


@dataclass(frozen=True, slots=True)
class AirboxOptions:
    """Configuration for automatic airbox (open-boundary domain) generation.

    Attributes:
        padding_factor: Domain scale relative to magnetic body bbox
                        (e.g. 3.0 means air domain is 3× the body in each axis).
        shape: Outer shell geometry: ``"bbox"`` or ``"sphere"``.
        grading_ratio: Element growth ratio from interface toward outer boundary.
        boundary_marker: Gmsh physical group tag for the outer boundary Γ_out.
    """

    padding_factor: float = 3.0
    shape: str = "bbox"
    grading_ratio: float = 1.4
    boundary_marker: int = 99
    size: tuple[float, float, float] | None = None
    center: tuple[float, float, float] | None = None
    hmax: float | None = None


@dataclass(frozen=True, slots=True)
class SizeFieldData:
    """Nodal target element sizes for adaptive remeshing.

    Attributes:
        node_coords: (N, 3) array of node coordinates from the previous mesh.
        h_values: (N,) array of target element sizes at each node.
    """

    node_coords: NDArray[np.float64]
    h_values: NDArray[np.float64]

    def __post_init__(self) -> None:
        coords = np.asarray(self.node_coords, dtype=np.float64)
        h = np.asarray(self.h_values, dtype=np.float64)
        object.__setattr__(self, "node_coords", coords)
        object.__setattr__(self, "h_values", h)
        if coords.ndim != 2 or coords.shape[1] != 3:
            raise ValueError("node_coords must have shape (N, 3)")
        if h.ndim != 1 or h.shape[0] != coords.shape[0]:
            raise ValueError("h_values must have shape (N,)")
        if np.any(h <= 0):
            raise ValueError("h_values must be strictly positive")


def _peel_translate_chain(
    geometry: Geometry,
) -> tuple[tuple[float, float, float], Geometry]:
    """Collapse a chain of ``Translate`` wrappers into an accumulated offset.

    Returns ``(accumulated_offset, inner_geometry)`` where *inner_geometry* is
    the first non-``Translate`` node in the chain.
    """
    dx, dy, dz = 0.0, 0.0, 0.0
    g: Geometry = geometry
    while isinstance(g, Translate):
        ox, oy, oz = g.offset
        dx += ox
        dy += oy
        dz += oz
        g = g.geometry
    return (dx, dy, dz), g


def _import_gmsh() -> Any:
    try:
        import gmsh  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise ImportError(
            "Gmsh Python SDK is required for FEM meshing. "
            "Install with: python -m pip install 'gmsh>=4.12'"
        ) from exc
    return gmsh


def _import_meshio() -> Any:
    try:
        import meshio  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise ImportError(
            "meshio is required to read pre-generated mesh files. "
            "Install with: python -m pip install 'meshio>=5.3'"
        ) from exc
    return meshio


@dataclass(frozen=True, slots=True)
class MeshData:
    """Tetrahedral mesh data ready for FEM lowering."""

    nodes: NDArray[np.float64]
    elements: NDArray[np.int32]
    element_markers: NDArray[np.int32]
    boundary_faces: NDArray[np.int32]
    boundary_markers: NDArray[np.int32]
    quality: MeshQualityReport | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "nodes", np.asarray(self.nodes, dtype=np.float64))
        object.__setattr__(self, "elements", np.asarray(self.elements, dtype=np.int32))
        object.__setattr__(self, "element_markers", np.asarray(self.element_markers, dtype=np.int32))
        object.__setattr__(self, "boundary_faces", np.asarray(self.boundary_faces, dtype=np.int32))
        object.__setattr__(self, "boundary_markers", np.asarray(self.boundary_markers, dtype=np.int32))
        self.validate()

    @property
    def n_nodes(self) -> int:
        return int(self.nodes.shape[0])

    @property
    def n_elements(self) -> int:
        return int(self.elements.shape[0])

    @property
    def n_boundary_faces(self) -> int:
        return int(self.boundary_faces.shape[0])

    def validate(self) -> None:
        if self.nodes.ndim != 2 or self.nodes.shape[1] != 3:
            raise ValueError("nodes must have shape (N, 3)")
        if self.elements.ndim != 2 or self.elements.shape[1] != 4:
            raise ValueError("elements must have shape (M, 4)")
        if self.element_markers.shape != (self.n_elements,):
            raise ValueError("element_markers must have shape (M,)")
        if self.boundary_faces.ndim != 2 or (
            self.boundary_faces.size != 0 and self.boundary_faces.shape[1] != 3
        ):
            raise ValueError("boundary_faces must have shape (F, 3)")
        if self.boundary_markers.shape != (self.n_boundary_faces,):
            raise ValueError("boundary_markers must have shape (F,)")
        if self.elements.size and (self.elements.min() < 0 or self.elements.max() >= self.n_nodes):
            raise ValueError("elements contain invalid node indices")
        if self.boundary_faces.size and (
            self.boundary_faces.min() < 0 or self.boundary_faces.max() >= self.n_nodes
        ):
            raise ValueError("boundary_faces contain invalid node indices")

    def save(self, path: str | Path) -> None:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.suffix.lower() == ".json":
            target.write_text(
                json.dumps(
                    {
                        "mesh_name": target.stem,
                        "nodes": self.nodes.tolist(),
                        "elements": self.elements.tolist(),
                        "element_markers": self.element_markers.tolist(),
                        "boundary_faces": self.boundary_faces.tolist(),
                        "boundary_markers": self.boundary_markers.tolist(),
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            return
        np.savez_compressed(
            target,
            nodes=self.nodes,
            elements=self.elements,
            element_markers=self.element_markers,
            boundary_faces=self.boundary_faces,
            boundary_markers=self.boundary_markers,
        )

    def export_stl(self, path: str | Path) -> Path:
        """Export boundary surface as binary STL (zero dependencies)."""
        import struct
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        n_faces = self.n_boundary_faces
        with open(target, "wb") as fp:
            fp.write(b"\0" * 80)  # header
            fp.write(struct.pack("<I", n_faces))
            for fi in range(n_faces):
                v0, v1, v2 = self.nodes[self.boundary_faces[fi]]
                e1 = v1 - v0
                e2 = v2 - v0
                normal = np.cross(e1, e2)
                norm_len = np.linalg.norm(normal)
                if norm_len > 0:
                    normal /= norm_len
                fp.write(struct.pack("<3f", *normal.astype(np.float32)))
                fp.write(struct.pack("<3f", *v0.astype(np.float32)))
                fp.write(struct.pack("<3f", *v1.astype(np.float32)))
                fp.write(struct.pack("<3f", *v2.astype(np.float32)))
                fp.write(struct.pack("<H", 0))  # attribute byte count
        return target

    def export_vtk(
        self,
        path: str | Path,
        fields: dict[str, NDArray] | None = None,
    ) -> Path:
        """Export full tetrahedral mesh as VTK legacy file.

        Args:
            path: Destination file path.
            fields: Optional dict of per-node field data to include.
                    Keys are field names (e.g. "m", "H_ex").
                    Values are arrays of shape (n_nodes, 3) for vectors
                    or (n_nodes,) for scalars.
        """
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        n = self.n_nodes
        m = self.n_elements
        with open(target, "w", encoding="utf-8") as fp:
            fp.write("# vtk DataFile Version 3.0\n")
            fp.write("fullmag tetrahedral mesh\n")
            fp.write("ASCII\n")
            fp.write("DATASET UNSTRUCTURED_GRID\n")
            fp.write(f"POINTS {n} double\n")
            for node in self.nodes:
                fp.write(f"{node[0]:.15e} {node[1]:.15e} {node[2]:.15e}\n")
            fp.write(f"\nCELLS {m} {m * 5}\n")
            for tet in self.elements:
                fp.write(f"4 {tet[0]} {tet[1]} {tet[2]} {tet[3]}\n")
            fp.write(f"\nCELL_TYPES {m}\n")
            for _ in range(m):
                fp.write("10\n")  # VTK_TETRA = 10
            fp.write(f"\nCELL_DATA {m}\n")
            fp.write("SCALARS region int 1\n")
            fp.write("LOOKUP_TABLE default\n")
            for marker in self.element_markers:
                fp.write(f"{marker}\n")
            # Per-node field data
            if fields:
                fp.write(f"\nPOINT_DATA {n}\n")
                for name, data in fields.items():
                    arr = np.asarray(data)
                    if arr.ndim == 2 and arr.shape[1] == 3:
                        fp.write(f"VECTORS {name} double\n")
                        for vec in arr:
                            fp.write(f"{vec[0]:.15e} {vec[1]:.15e} {vec[2]:.15e}\n")
                    elif arr.ndim == 1:
                        fp.write(f"SCALARS {name} double 1\n")
                        fp.write("LOOKUP_TABLE default\n")
                        for val in arr:
                            fp.write(f"{val:.15e}\n")
        return target

    @classmethod
    def load(cls, path: str | Path) -> "MeshData":
        source = Path(path)
        if source.suffix.lower() == ".json":
            payload = json.loads(source.read_text(encoding="utf-8"))
            return cls(
                nodes=np.asarray(payload["nodes"], dtype=np.float64),
                elements=np.asarray(payload["elements"], dtype=np.int32),
                element_markers=np.asarray(payload["element_markers"], dtype=np.int32),
                boundary_faces=np.asarray(payload["boundary_faces"], dtype=np.int32),
                boundary_markers=np.asarray(payload["boundary_markers"], dtype=np.int32),
            )

        data = np.load(source)
        return cls(
            nodes=data["nodes"],
            elements=data["elements"],
            element_markers=data["element_markers"],
            boundary_faces=data["boundary_faces"],
            boundary_markers=data["boundary_markers"],
        )

    def to_ir(self, mesh_name: str) -> dict[str, object]:
        return {
            "mesh_name": mesh_name,
            "nodes": self.nodes.tolist(),
            "elements": self.elements.tolist(),
            "element_markers": self.element_markers.tolist(),
            "boundary_faces": self.boundary_faces.tolist(),
            "boundary_markers": self.boundary_markers.tolist(),
        }


def _add_airbox_geo(
    gmsh: Any,
    body_vol_tags: list[int],
    body_surf_tags: list[int],
    airbox: AirboxOptions,
    hmax: float,
) -> int | None:
    """Add an airbox around a GEO-kernel body using pure GEO primitives.

    This is the GEO-kernel equivalent of :func:`_add_airbox_and_fragment`.
    It is required for STL-imported bodies whose entities live in the GEO
    kernel and are invisible to OCC boolean operations.

    The airbox volume is defined as the box (or sphere-approximation)
    bounded externally by six planar faces and internally by the body
    surface.  The body surface loop is reused as a *hole* in the airbox
    shell, producing a conforming interface without OCC ``fragment``.

    After return the model has physical groups:
      - volume physical groups 1..N = magnetic bodies,
      - volume physical group N+1 = air,
      - surface physical group ``airbox.boundary_marker`` = Γ_out,
      - surface physical group 10 = magnetic–air interface.
    """
    # 1 — bounding box of magnetic body
    xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(-1, -1)
    dx, dy, dz = xmax - xmin, ymax - ymin, zmax - zmin
    cx, cy, cz = (xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2
    pf = airbox.padding_factor

    # 2 — compute outer box dimensions
    explicit_size = airbox.size
    explicit_center = airbox.center
    if explicit_size is not None:
        ox, oy, oz = explicit_size
        if min(ox, oy, oz) <= 0.0:
            raise ValueError("airbox.size components must be positive")
        if explicit_center is not None:
            cx, cy, cz = explicit_center
    elif airbox.shape == "sphere":
        # Approximate sphere with bounding box for the GEO path
        R = max(dx, dy, dz) / 2 * pf
        ox = oy = oz = 2.0 * R
    else:  # bbox
        ox, oy, oz = dx * pf, dy * pf, dz * pf

    x0, y0, z0 = cx - ox / 2, cy - oy / 2, cz - oz / 2
    x1, y1, z1 = cx + ox / 2, cy + oy / 2, cz + oz / 2
    h_outer = airbox.hmax if airbox.hmax is not None else hmax * max(airbox.grading_ratio ** 4, 1.0)

    # 3 — build box geometry using GEO points/lines/surfaces
    p = []
    for z in [z0, z1]:
        for y in [y0, y1]:
            for x in [x0, x1]:
                p.append(gmsh.model.geo.addPoint(x, y, z, h_outer))
    # p[0..7]: bottom-face (z0) then top-face (z1), each in order (x0y0, x1y0, x0y1, x1y1)

    # Bottom face edges
    lb = [
        gmsh.model.geo.addLine(p[0], p[1]),
        gmsh.model.geo.addLine(p[1], p[3]),
        gmsh.model.geo.addLine(p[3], p[2]),
        gmsh.model.geo.addLine(p[2], p[0]),
    ]
    # Top face edges
    lt = [
        gmsh.model.geo.addLine(p[4], p[5]),
        gmsh.model.geo.addLine(p[5], p[7]),
        gmsh.model.geo.addLine(p[7], p[6]),
        gmsh.model.geo.addLine(p[6], p[4]),
    ]
    # Vertical edges
    lv = [
        gmsh.model.geo.addLine(p[0], p[4]),
        gmsh.model.geo.addLine(p[1], p[5]),
        gmsh.model.geo.addLine(p[2], p[6]),
        gmsh.model.geo.addLine(p[3], p[7]),
    ]

    # 6 planar faces
    cl_bot = gmsh.model.geo.addCurveLoop([lb[0], lb[1], lb[2], lb[3]])
    cl_top = gmsh.model.geo.addCurveLoop([lt[0], lt[1], lt[2], lt[3]])
    cl_front = gmsh.model.geo.addCurveLoop([lb[0], lv[1], -lt[0], -lv[0]])
    cl_back = gmsh.model.geo.addCurveLoop([lb[2], lv[2], -lt[2], -lv[3]])
    cl_left = gmsh.model.geo.addCurveLoop([lb[3], lv[0], -lt[3], -lv[2]])
    cl_right = gmsh.model.geo.addCurveLoop([lb[1], lv[3], -lt[1], -lv[1]])

    s_bot = gmsh.model.geo.addPlaneSurface([cl_bot])
    s_top = gmsh.model.geo.addPlaneSurface([cl_top])
    s_front = gmsh.model.geo.addPlaneSurface([cl_front])
    s_back = gmsh.model.geo.addPlaneSurface([cl_back])
    s_left = gmsh.model.geo.addPlaneSurface([cl_left])
    s_right = gmsh.model.geo.addPlaneSurface([cl_right])
    outer_surf_tags = [s_bot, s_top, s_front, s_back, s_left, s_right]

    # 4 — airbox volume: outer box faces + body surfaces as inner hole
    air_sl = gmsh.model.geo.addSurfaceLoop(outer_surf_tags + body_surf_tags)
    air_vol = gmsh.model.geo.addVolume([air_sl])
    gmsh.model.geo.synchronize()

    # 5 — physical groups (same convention as the OCC path)
    for index, body_vol_tag in enumerate(body_vol_tags, start=1):
        gmsh.model.addPhysicalGroup(3, [body_vol_tag], tag=index)
        gmsh.model.setPhysicalName(3, index, f"magnetic_{index}")
    air_tag = len(body_vol_tags) + 1
    gmsh.model.addPhysicalGroup(3, [air_vol], tag=air_tag)
    gmsh.model.setPhysicalName(3, air_tag, "air")
    gmsh.model.addPhysicalGroup(2, outer_surf_tags, tag=airbox.boundary_marker)
    gmsh.model.setPhysicalName(2, airbox.boundary_marker, "Gamma_out")
    gmsh.model.addPhysicalGroup(2, body_surf_tags, tag=10)
    gmsh.model.setPhysicalName(2, 10, "mag_air_interface")

    # 6 — mesh grading: fine at interface, coarse at outer boundary
    if airbox.grading_ratio > 1.0:
        if explicit_size is not None:
            d_outer = max(
                max(ox - dx, 0.0),
                max(oy - dy, 0.0),
                max(oz - dz, 0.0),
            ) / 2.0
        else:
            d_outer = max(dx, dy, dz) * (pf - 1) / 2

        gmsh.model.mesh.field.add("Distance", 1)
        gmsh.model.mesh.field.setNumbers(1, "SurfacesList", body_surf_tags)

        gmsh.model.mesh.field.add("Threshold", 2)
        gmsh.model.mesh.field.setNumber(2, "InField", 1)
        gmsh.model.mesh.field.setNumber(2, "SizeMin", hmax)
        gmsh.model.mesh.field.setNumber(2, "SizeMax", h_outer)
        gmsh.model.mesh.field.setNumber(2, "DistMin", 0.0)
        gmsh.model.mesh.field.setNumber(2, "DistMax", max(d_outer, hmax))
        return 2
    return None


def _add_airbox_and_fragment(
    gmsh: Any,
    magnetic_tags: list[tuple[int, int]],
    airbox: AirboxOptions,
    hmax: float,
) -> int | None:
    """Add an airbox around the magnetic body and fragment for a conforming mesh.

    After this call the Gmsh model has physical groups:
      - volume tag 1 = magnetic, volume tag 2 = air,
      - surface tag ``airbox.boundary_marker`` = Γ_out,
      - surface tag 10 = magnetic–air interface.

    A graded ``Threshold`` size field is set so that element size equals
    ``hmax`` at the interface and grows by ``grading_ratio`` toward the outer
    boundary.

    .. note::

       This function requires all *magnetic_tags* to be OCC entities.
       For GEO-kernel bodies (e.g. STL imports), use :func:`_add_airbox_geo`
       instead.
    """
    # 1 — bounding box of magnetic body
    xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(-1, -1)
    dx, dy, dz = xmax - xmin, ymax - ymin, zmax - zmin
    cx, cy, cz = (xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2
    pf = airbox.padding_factor

    # 2 — outer shell geometry
    explicit_size = airbox.size
    explicit_center = airbox.center
    if explicit_size is not None:
        ox, oy, oz = explicit_size
        if min(ox, oy, oz) <= 0.0:
            raise ValueError("airbox.size components must be positive")
        if explicit_center is not None:
            cx, cy, cz = explicit_center
        if airbox.shape == "sphere":
            radius = max(ox, oy, oz) / 2.0
            outer_tag = gmsh.model.occ.addSphere(cx, cy, cz, radius)
        else:  # bbox
            outer_tag = gmsh.model.occ.addBox(
                cx - ox / 2, cy - oy / 2, cz - oz / 2, ox, oy, oz,
            )
    elif airbox.shape == "sphere":
        R = max(dx, dy, dz) / 2 * pf
        outer_tag = gmsh.model.occ.addSphere(cx, cy, cz, R)
        ox = oy = oz = 2.0 * R
    else:  # bbox
        ox, oy, oz = dx * pf, dy * pf, dz * pf
        outer_tag = gmsh.model.occ.addBox(
            cx - ox / 2, cy - oy / 2, cz - oz / 2, ox, oy, oz,
        )
    outer_dimtags = [(3, outer_tag)]

    # 3 — OCC fragment: conforming interface between magnetic body and airbox
    result, result_map = gmsh.model.occ.fragment(outer_dimtags, magnetic_tags)
    gmsh.model.occ.synchronize()

    if not result_map:
        raise RuntimeError(
            "OCC fragment returned an empty result_map — the magnetic body "
            "entities are likely not in the OCC kernel.  If the geometry was "
            "built from an STL file via the GEO kernel (classifySurfaces / "
            "createGeometry / geo.addVolume), use _add_airbox_geo() instead."
        )

    # 4 — identify magnetic vs air volumes via result_map
    #     result_map[0]  → children of outer_dimtags  (air + overlap)
    #     result_map[1:] → children of magnetic_tags  (the magnetic region)
    magnetic_vol_tags: list[int] = []
    for parent_idx in range(1, len(result_map)):
        for dim, tag in result_map[parent_idx]:
            if dim == 3 and tag not in magnetic_vol_tags:
                magnetic_vol_tags.append(tag)
    air_vol_tags: list[int] = []
    for dim, tag in result_map[0]:
        if dim == 3 and tag not in magnetic_vol_tags:
            air_vol_tags.append(tag)

    if not magnetic_vol_tags:
        raise RuntimeError(
            "airbox fragment produced no magnetic volumes — check geometry"
        )
    if not air_vol_tags:
        raise RuntimeError(
            "airbox fragment produced no air volumes — padding_factor too small?"
        )

    # 5 — physical groups → element_markers
    gmsh.model.addPhysicalGroup(3, magnetic_vol_tags, tag=1)
    gmsh.model.setPhysicalName(3, 1, "magnetic")
    gmsh.model.addPhysicalGroup(3, air_vol_tags, tag=2)
    gmsh.model.setPhysicalName(3, 2, "air")

    # 6 — boundary tags
    #     outer surfaces of air that are NOT the mag–air interface → Γ_out
    air_boundary = gmsh.model.getBoundary(
        [(3, t) for t in air_vol_tags], oriented=False,
    )
    mag_boundary = gmsh.model.getBoundary(
        [(3, t) for t in magnetic_vol_tags], oriented=False,
    )
    interface_tags = {abs(tag) for _, tag in mag_boundary}
    gamma_out = sorted({abs(tag) for _, tag in air_boundary} - interface_tags)
    interface_list = sorted(interface_tags)

    if gamma_out:
        gmsh.model.addPhysicalGroup(2, gamma_out, tag=airbox.boundary_marker)
        gmsh.model.setPhysicalName(2, airbox.boundary_marker, "Gamma_out")
    if interface_list:
        gmsh.model.addPhysicalGroup(2, interface_list, tag=10)
        gmsh.model.setPhysicalName(2, 10, "mag_air_interface")

    # 7 — mesh grading: fine at interface, coarse at outer boundary
    if airbox.grading_ratio > 1.0:
        h_outer = airbox.hmax if airbox.hmax is not None else hmax * airbox.grading_ratio ** 4
        if explicit_size is not None:
            d_outer = max(
                max(ox - dx, 0.0),
                max(oy - dy, 0.0),
                max(oz - dz, 0.0),
            ) / 2.0
        else:
            d_outer = max(dx, dy, dz) * (pf - 1) / 2

        gmsh.model.mesh.field.add("Distance", 1)
        gmsh.model.mesh.field.setNumbers(1, "SurfacesList", interface_list)

        gmsh.model.mesh.field.add("Threshold", 2)
        gmsh.model.mesh.field.setNumber(2, "InField", 1)
        gmsh.model.mesh.field.setNumber(2, "SizeMin", hmax)
        gmsh.model.mesh.field.setNumber(2, "SizeMax", h_outer)
        gmsh.model.mesh.field.setNumber(2, "DistMin", 0.0)
        gmsh.model.mesh.field.setNumber(2, "DistMax", max(d_outer, hmax))
        return 2
    return None


def generate_mesh(
    geometry: Geometry,
    hmax: float,
    order: int = 1,
    air_padding: float = 0.0,
    airbox: AirboxOptions | None = None,
    options: MeshOptions | None = None,
) -> MeshData:
    """Generate a tetrahedral mesh for the given geometry.

    Args:
        geometry: Fullmag geometry descriptor.
        hmax: Maximum element size (SI metres).
        order: Finite-element order (1 = linear, 2 = quadratic).
        air_padding: Scalar padding factor (legacy). Use *airbox* instead.
        airbox: Structured airbox configuration. When given, takes precedence
                over *air_padding*.
        options: Advanced Gmsh options (algorithms, quality, size fields).
    """
    resolved_airbox = airbox or (
        AirboxOptions(padding_factor=air_padding) if air_padding > 0 else None
    )
    opts = options or MeshOptions()
    if isinstance(geometry, Box):
        return generate_box_mesh(geometry.size, hmax=hmax, order=order, airbox=resolved_airbox, options=opts)
    if isinstance(geometry, Cylinder):
        return generate_cylinder_mesh(
            geometry.radius,
            geometry.height,
            hmax=hmax,
            order=order,
            airbox=resolved_airbox,
            options=opts,
        )
    if isinstance(geometry, (Difference, Union, Intersection, Translate, Ellipsoid, Ellipse)):
        # A chain of Translate wrapping an ImportedGeometry cannot go through
        # the OCC CSG pipeline (OCC cannot ingest STL/NPZ sources). Detect this
        # pattern, mesh the imported file directly, and apply the accumulated
        # translation to the resulting mesh nodes instead.
        if isinstance(geometry, Translate):
            offset, inner = _peel_translate_chain(geometry)
            if isinstance(inner, ImportedGeometry):
                mesh = generate_mesh_from_file(
                    inner.source,
                    hmax=hmax,
                    order=order,
                    airbox=resolved_airbox,
                    scale=inner.scale,
                    options=opts,
                )
                ox, oy, oz = offset
                if ox != 0.0 or oy != 0.0 or oz != 0.0:
                    shift = np.array([ox, oy, oz], dtype=np.float64)
                    mesh = MeshData(
                        nodes=mesh.nodes + shift,
                        elements=mesh.elements,
                        element_markers=mesh.element_markers,
                        boundary_faces=mesh.boundary_faces,
                        boundary_markers=mesh.boundary_markers,
                        quality=mesh.quality,
                    )
                return mesh
        return _generate_csg_mesh(geometry, hmax=hmax, order=order, airbox=resolved_airbox, options=opts)
    if isinstance(geometry, ImportedGeometry):
        return generate_mesh_from_file(
            geometry.source,
            hmax=hmax,
            order=order,
            air_padding=air_padding,
            airbox=resolved_airbox,
            scale=geometry.scale,
            options=opts,
        )
    raise TypeError(f"unsupported geometry type: {type(geometry)!r}")


def generate_box_mesh(
    size: tuple[float, float, float],
    hmax: float,
    order: int = 1,
    air_padding: float = 0.0,
    airbox: AirboxOptions | None = None,
    options: MeshOptions | None = None,
) -> MeshData:
    resolved = airbox or (AirboxOptions(padding_factor=air_padding) if air_padding > 0 else None)
    opts = options or MeshOptions()
    emit_progress("Gmsh: generating box geometry")
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add("fullmag_box")
        sx, sy, sz = size
        gmsh.model.occ.addBox(-sx / 2.0, -sy / 2.0, -sz / 2.0, sx, sy, sz)
        gmsh.model.occ.synchronize()
        has_airbox = resolved is not None
        airbox_field_ids: list[int] = []
        if has_airbox:
            emit_progress("Gmsh: adding airbox domain")
            airbox_field = _add_airbox_and_fragment(
                gmsh, [(3, 1)], resolved, hmax,
            )
            if airbox_field is not None:
                airbox_field_ids.append(airbox_field)
        emit_progress("Gmsh: generating 3D tetrahedral mesh")
        _apply_mesh_options(gmsh, hmax, order, opts, preexisting_field_ids=airbox_field_ids)
        gmsh.model.mesh.generate(3)
        _apply_post_mesh_options(gmsh, opts)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None
        mesh = _extract_mesh_data(gmsh, quality=quality, has_physical_groups=has_airbox)
        emit_progress(
            f"Gmsh: mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements, {mesh.n_boundary_faces} boundary faces"
        )
        return mesh
    finally:  # pragma: no branch
        gmsh.finalize()


def generate_cylinder_mesh(
    radius: float,
    height: float,
    hmax: float,
    order: int = 1,
    air_padding: float = 0.0,
    airbox: AirboxOptions | None = None,
    options: MeshOptions | None = None,
) -> MeshData:
    resolved = airbox or (AirboxOptions(padding_factor=air_padding) if air_padding > 0 else None)
    opts = options or MeshOptions()
    emit_progress("Gmsh: generating cylinder geometry")
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add("fullmag_cylinder")
        gmsh.model.occ.addCylinder(0.0, 0.0, -height / 2.0, 0.0, 0.0, height, radius)
        gmsh.model.occ.synchronize()
        has_airbox = resolved is not None
        airbox_field_ids: list[int] = []
        if has_airbox:
            emit_progress("Gmsh: adding airbox domain")
            airbox_field = _add_airbox_and_fragment(
                gmsh, [(3, 1)], resolved, hmax,
            )
            if airbox_field is not None:
                airbox_field_ids.append(airbox_field)
        emit_progress("Gmsh: generating 3D tetrahedral mesh")
        _apply_mesh_options(gmsh, hmax, order, opts, preexisting_field_ids=airbox_field_ids)
        gmsh.model.mesh.generate(3)
        _apply_post_mesh_options(gmsh, opts)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None
        mesh = _extract_mesh_data(gmsh, quality=quality, has_physical_groups=has_airbox)
        emit_progress(
            f"Gmsh: mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements, {mesh.n_boundary_faces} boundary faces"
        )
        return mesh
    finally:  # pragma: no branch
        gmsh.finalize()


def generate_difference_mesh(
    geometry: Difference,
    hmax: float,
    order: int = 1,
    options: MeshOptions | None = None,
) -> MeshData:
    """Mesh a CSG Difference via Gmsh OCC boolean cut.

    OCC has numerical precision limits, so we scale geometry from SI metres
    to micrometres (×1e6) for boolean ops, then scale nodes back (×1e-6).
    """
    opts = options or MeshOptions()
    SCALE = 1e6  # m → µm
    emit_progress("Gmsh: building OCC difference geometry")
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add("fullmag_difference")
        base_tags = _add_geometry_to_occ(gmsh, geometry.base, scale=SCALE)
        tool_tags = _add_geometry_to_occ(gmsh, geometry.tool, scale=SCALE)
        gmsh.model.occ.cut(base_tags, tool_tags)
        gmsh.model.occ.synchronize()
        emit_progress("Gmsh: generating 3D tetrahedral mesh")
        _apply_mesh_options(gmsh, hmax * SCALE, order, opts, hscale=SCALE)
        gmsh.model.mesh.generate(3)
        _apply_post_mesh_options(gmsh, opts)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None
        mesh = _extract_mesh_data(gmsh, quality=quality)
        emit_progress(
            f"Gmsh: mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements, {mesh.n_boundary_faces} boundary faces"
        )
        # Scale nodes back to SI metres
        return MeshData(
            nodes=mesh.nodes / SCALE,
            elements=mesh.elements,
            element_markers=mesh.element_markers,
            boundary_faces=mesh.boundary_faces,
            boundary_markers=mesh.boundary_markers,
            quality=quality,
        )
    finally:  # pragma: no branch
        gmsh.finalize()


def _generate_csg_mesh(
    geometry: Geometry,
    hmax: float,
    order: int = 1,
    airbox: AirboxOptions | None = None,
    options: MeshOptions | None = None,
) -> MeshData:
    """Mesh any geometry type via the generic OCC pipeline.

    Uses micrometre scaling (×1e6) for OCC numerical stability.
    """
    opts = options or MeshOptions()
    SCALE = 1e6
    emit_progress("Gmsh: building OCC geometry")
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add("fullmag_csg")
        mag_tags = _add_geometry_to_occ(gmsh, geometry, scale=SCALE)
        gmsh.model.occ.synchronize()
        has_airbox = airbox is not None
        airbox_field_ids: list[int] = []
        if has_airbox:
            emit_progress("Gmsh: adding airbox domain")
            airbox_field = _add_airbox_and_fragment(
                gmsh, mag_tags, airbox, hmax * SCALE,
            )
            if airbox_field is not None:
                airbox_field_ids.append(airbox_field)
        emit_progress("Gmsh: generating 3D tetrahedral mesh")
        _apply_mesh_options(
            gmsh,
            hmax * SCALE,
            order,
            opts,
            hscale=SCALE,
            preexisting_field_ids=airbox_field_ids,
        )
        gmsh.model.mesh.generate(3)
        _apply_post_mesh_options(gmsh, opts)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None
        mesh = _extract_mesh_data(gmsh, quality=quality, has_physical_groups=has_airbox)
        emit_progress(
            f"Gmsh: mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements, {mesh.n_boundary_faces} boundary faces"
        )
        return MeshData(
            nodes=mesh.nodes / SCALE,
            elements=mesh.elements,
            element_markers=mesh.element_markers,
            boundary_faces=mesh.boundary_faces,
            boundary_markers=mesh.boundary_markers,
            quality=quality,
        )
    finally:  # pragma: no branch
        gmsh.finalize()


def _add_geometry_to_occ(
    gmsh: Any,
    geometry: Geometry,
    scale: float = 1.0,
) -> list[tuple[int, int]]:
    """Add a geometry primitive to the Gmsh OCC kernel.

    Returns list of (dim, tag) tuples suitable for boolean operations.
    Supports recursive CSG nesting.
    All dimensions are multiplied by `scale` before passing to OCC.
    """
    if isinstance(geometry, Box):
        sx, sy, sz = [d * scale for d in geometry.size]
        tag = gmsh.model.occ.addBox(-sx / 2.0, -sy / 2.0, -sz / 2.0, sx, sy, sz)
        return [(3, tag)]
    if isinstance(geometry, Cylinder):
        r = geometry.radius * scale
        h = geometry.height * scale
        tag = gmsh.model.occ.addCylinder(
            0.0, 0.0, -h / 2.0,
            0.0, 0.0, h,
            r,
        )
        return [(3, tag)]
    if isinstance(geometry, Ellipsoid):
        # OCC: create sphere with max radius, then dilate to ellipsoid
        rmax = max(geometry.rx, geometry.ry, geometry.rz) * scale
        tag = gmsh.model.occ.addSphere(0.0, 0.0, 0.0, rmax)
        fx = (geometry.rx * scale) / rmax
        fy = (geometry.ry * scale) / rmax
        fz = (geometry.rz * scale) / rmax
        gmsh.model.occ.dilate([(3, tag)], 0.0, 0.0, 0.0, fx, fy, fz)
        return [(3, tag)]
    if isinstance(geometry, Ellipse):
        # Elliptical cylinder: create circular cylinder, then dilate x/y
        rmax = max(geometry.rx, geometry.ry) * scale
        h = geometry.height * scale
        tag = gmsh.model.occ.addCylinder(
            0.0, 0.0, -h / 2.0,
            0.0, 0.0, h,
            rmax,
        )
        fx = (geometry.rx * scale) / rmax
        fy = (geometry.ry * scale) / rmax
        gmsh.model.occ.dilate([(3, tag)], 0.0, 0.0, 0.0, fx, fy, 1.0)
        return [(3, tag)]
    if isinstance(geometry, Difference):
        base_tags = _add_geometry_to_occ(gmsh, geometry.base, scale=scale)
        tool_tags = _add_geometry_to_occ(gmsh, geometry.tool, scale=scale)
        result, _ = gmsh.model.occ.cut(base_tags, tool_tags)
        return result
    if isinstance(geometry, Union):
        a_tags = _add_geometry_to_occ(gmsh, geometry.a, scale=scale)
        b_tags = _add_geometry_to_occ(gmsh, geometry.b, scale=scale)
        result, _ = gmsh.model.occ.fuse(a_tags, b_tags)
        return result
    if isinstance(geometry, Intersection):
        a_tags = _add_geometry_to_occ(gmsh, geometry.a, scale=scale)
        b_tags = _add_geometry_to_occ(gmsh, geometry.b, scale=scale)
        result, _ = gmsh.model.occ.intersect(a_tags, b_tags)
        return result
    if isinstance(geometry, Translate):
        inner_tags = _add_geometry_to_occ(gmsh, geometry.geometry, scale=scale)
        ox, oy, oz = [d * scale for d in geometry.offset]
        gmsh.model.occ.translate(inner_tags, ox, oy, oz)
        return inner_tags
    if isinstance(geometry, ImportedGeometry):
        # Only CAD formats (STEP/IGES/BREP) can be loaded into the OCC kernel
        # via importShapes. STL and mesh files must go through the GEO pipeline
        # (see generate_mesh for the Translate-over-ImportedGeometry path).
        source = Path(geometry.source)
        suffix = source.suffix.lower()
        if suffix not in {".step", ".stp", ".iges", ".igs", ".brep"}:
            raise TypeError(
                f"ImportedGeometry source '{source.name}' cannot be used inside a CSG "
                f"boolean operation — only STEP, IGES, and BREP files are supported in "
                f"the OCC kernel. For STL sources, wrap the geometry only in Translate "
                f"(not boolean ops) and call geometry.mesh().build() directly."
            )
        tags = gmsh.model.occ.importShapes(str(source))
        # Apply the effective scale (unit-adjusted) via OCC dilate
        raw_scale = geometry.scale
        if isinstance(raw_scale, (int, float)):
            sx = sy = sz = float(raw_scale) * scale
        else:
            sx, sy, sz = (float(c) * scale for c in raw_scale)
        if sx != 1.0 or sy != 1.0 or sz != 1.0:
            gmsh.model.occ.dilate(tags, 0.0, 0.0, 0.0, sx, sy, sz)
        return list(tags)
    raise TypeError(
        f"unsupported geometry type for OCC meshing: {type(geometry)!r}"
    )


def generate_mesh_from_file(
    source: str | Path,
    hmax: float,
    order: int = 1,
    air_padding: float = 0.0,
    airbox: AirboxOptions | None = None,
    scale: float | tuple[float, float, float] = 1.0,
    options: MeshOptions | None = None,
) -> MeshData:
    resolved = airbox or (AirboxOptions(padding_factor=air_padding) if air_padding > 0 else None)
    opts = options or MeshOptions()
    path = Path(source)
    suffix = path.suffix.lower()
    scale_xyz = _normalize_scale_xyz(scale)
    source_hmax = _source_hmax_from_scale(hmax, scale_xyz)
    if suffix in {".json", ".npz"}:
        emit_progress(f"Loading pre-generated FEM mesh from {path.name}")
        return _scale_mesh_nodes(MeshData.load(path), scale_xyz)
    if suffix in {".msh", ".vtk", ".vtu", ".xdmf"}:
        emit_progress(f"Loading external mesh file {path.name}")
        return _scale_mesh_nodes(_read_mesh_file(path), scale_xyz)
    if suffix in {".step", ".stp", ".iges", ".igs"}:
        emit_progress(f"Gmsh: meshing CAD file {path.name}")
        return _mesh_cad_file(
            path,
            hmax=source_hmax,
            order=order,
            airbox=resolved,
            scale_xyz=scale_xyz,
            options=opts,
        )
    if suffix == ".stl":
        emit_progress(f"Gmsh: meshing STL surface {path.name}")
        return _mesh_stl_surface(
            path,
            hmax=source_hmax,
            order=order,
            airbox=resolved,
            scale_xyz=scale_xyz,
            options=opts,
        )
    raise ValueError(f"unsupported mesh/geometry source format: {path.suffix}")


def _mesh_cad_file(
    path: Path,
    hmax: float,
    order: int,
    airbox: AirboxOptions | None = None,
    scale_xyz: NDArray[np.float64] = np.ones(3),
    options: MeshOptions | None = None,
) -> MeshData:
    opts = options or MeshOptions()
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add(path.stem)
        emit_progress("Gmsh: importing CAD shapes")
        gmsh.model.occ.importShapes(str(path))
        gmsh.model.occ.synchronize()
        has_airbox = airbox is not None
        airbox_field_ids: list[int] = []
        if has_airbox:
            emit_progress("Gmsh: adding airbox domain")
            volumes = gmsh.model.getEntities(dim=3)
            airbox_field = _add_airbox_and_fragment(gmsh, volumes, airbox, hmax)
            if airbox_field is not None:
                airbox_field_ids.append(airbox_field)
        emit_progress("Gmsh: generating 3D tetrahedral mesh")
        _apply_mesh_options(gmsh, hmax, order, opts, preexisting_field_ids=airbox_field_ids)
        gmsh.model.mesh.generate(3)
        _apply_post_mesh_options(gmsh, opts)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None
        mesh = _scale_mesh_nodes(
            _extract_mesh_data(gmsh, quality=quality, has_physical_groups=has_airbox),
            scale_xyz,
        )
        emit_progress(
            f"Gmsh: mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements, {mesh.n_boundary_faces} boundary faces"
        )
        return mesh
    finally:  # pragma: no branch
        gmsh.finalize()


def _build_stl_volume_model(
    gmsh: object,
    path: Path,
) -> tuple[list[int], list[int]]:
    """Classify an STL surface into watertight volume model(s) via the GEO kernel.

    Shared by both initial meshing (``_mesh_stl_surface``) and adaptive
    remeshing (``_remesh_imported``).  After return, the Gmsh model contains
    one or more volume entities ready for ``generate(3)``.

    When the STL contains multiple disconnected closed surfaces (e.g. two
    nanoflower bodies concatenated into a single file), each connected
    component is turned into a separate GEO volume.

    Returns:
        A tuple ``(volume_tags, surface_tags)`` of the created GEO entities.
        *volume_tags* may contain more than one tag for multi-body STLs.
        These are needed by :func:`_add_airbox_geo` to build the airbox
        shell around the body.
    """
    from collections import defaultdict

    emit_progress("Gmsh: importing STL surface")
    gmsh.merge(str(path))
    angle = 40.0 * math.pi / 180.0
    emit_progress("Gmsh: classifying STL surfaces")
    gmsh.model.mesh.classifySurfaces(
        angle,
        boundary=True,
        forReparametrization=True,
        curveAngle=math.pi,
    )
    emit_progress("Gmsh: creating geometry from classified surfaces")
    gmsh.model.mesh.createGeometry()
    surfaces = gmsh.model.getEntities(2)
    if not surfaces:
        raise ValueError(f"failed to recover closed surfaces from STL: {path}")
    surface_tags = [tag for _, tag in surfaces]

    # --- detect connected components via shared edges (union-find) ---
    edge_to_surfs: dict[int, set[int]] = defaultdict(set)
    for _, stag in surfaces:
        edges = gmsh.model.getBoundary([(2, stag)], oriented=False)
        for _, etag in edges:
            edge_to_surfs[abs(etag)].add(stag)

    parent: dict[int, int] = {t: t for t in surface_tags}

    def _find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def _union(a: int, b: int) -> None:
        ra, rb = _find(a), _find(b)
        if ra != rb:
            parent[ra] = rb

    for _edge_tag, stags in edge_to_surfs.items():
        tags_list = list(stags)
        for i in range(1, len(tags_list)):
            _union(tags_list[0], tags_list[i])

    components: dict[int, list[int]] = defaultdict(list)
    for t in surface_tags:
        components[_find(t)].append(t)

    # --- create one volume per connected component ---
    volume_tags: list[int] = []
    if len(components) == 1:
        # Single body — simple path (preserves original behaviour)
        sl = gmsh.model.geo.addSurfaceLoop(surface_tags)
        volume_tags.append(gmsh.model.geo.addVolume([sl]))
    else:
        for _root, comp_surfs in components.items():
            sl = gmsh.model.geo.addSurfaceLoop(comp_surfs)
            volume_tags.append(gmsh.model.geo.addVolume([sl]))

    gmsh.model.geo.synchronize()
    return volume_tags, surface_tags


def _mesh_stl_surface(
    path: Path,
    hmax: float,
    order: int,
    airbox: AirboxOptions | None = None,
    scale_xyz: NDArray[np.float64] = np.ones(3),
    options: MeshOptions | None = None,
) -> MeshData:
    opts = options or MeshOptions()
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add(path.stem)
        body_vols, body_surfs = _build_stl_volume_model(gmsh, path)
        has_airbox = airbox is not None
        airbox_field_ids: list[int] = []
        if has_airbox:
            emit_progress("Gmsh: adding airbox domain")
            airbox_field = _add_airbox_geo(gmsh, body_vols, body_surfs, airbox, hmax)
            if airbox_field is not None:
                airbox_field_ids.append(airbox_field)
        emit_progress("Gmsh: generating 3D tetrahedral mesh")
        _apply_mesh_options(gmsh, hmax, order, opts, preexisting_field_ids=airbox_field_ids)
        gmsh.model.mesh.generate(3)
        _apply_post_mesh_options(gmsh, opts)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None
        mesh = _scale_mesh_nodes(
            _extract_mesh_data(gmsh, quality=quality, has_physical_groups=has_airbox),
            scale_xyz,
        )
        emit_progress(
            f"Gmsh: mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements, {mesh.n_boundary_faces} boundary faces"
        )
        return mesh
    finally:  # pragma: no branch
        gmsh.finalize()


def _read_mesh_file(path: Path) -> MeshData:
    meshio = _import_meshio()
    mesh = meshio.read(path)
    tetra = _first_cell_block(mesh, {"tetra"})
    triangles = _first_cell_block(mesh, {"triangle"}, allow_empty=True)
    nodes = np.asarray(mesh.points[:, :3], dtype=np.float64)
    elements = np.asarray(tetra, dtype=np.int32)
    boundary_faces = np.asarray(triangles, dtype=np.int32)
    element_markers = np.ones(elements.shape[0], dtype=np.int32)
    boundary_markers = np.ones(boundary_faces.shape[0], dtype=np.int32)
    return MeshData(
        nodes=nodes,
        elements=elements,
        element_markers=element_markers,
        boundary_faces=boundary_faces,
        boundary_markers=boundary_markers,
    )


def _normalize_scale_xyz(scale: float | tuple[float, float, float]) -> NDArray[np.float64]:
    if isinstance(scale, (int, float)):
        return np.full(3, float(scale), dtype=np.float64)
    return np.asarray(scale, dtype=np.float64)


def _source_hmax_from_scale(hmax: float, scale_xyz: NDArray[np.float64]) -> float:
    # Imported files are meshed in their own source coordinates. Convert the
    # requested SI hmax into a source-space target using the most restrictive
    # axis so anisotropic scales do not under-resolve the final SI geometry.
    positive_scales = scale_xyz[scale_xyz > 0]
    if positive_scales.size == 0:
        raise ValueError("imported geometry scale must be strictly positive")
    return float(hmax / float(np.max(positive_scales)))


def _scale_mesh_nodes(mesh: MeshData, scale_xyz: NDArray[np.float64]) -> MeshData:
    if np.allclose(scale_xyz, 1.0):
        return mesh
    return MeshData(
        nodes=np.asarray(mesh.nodes, dtype=np.float64) * scale_xyz.reshape(1, 3),
        elements=mesh.elements,
        element_markers=mesh.element_markers,
        boundary_faces=mesh.boundary_faces,
        boundary_markers=mesh.boundary_markers,
    )


def _first_cell_block(mesh: Any, allowed: set[str], allow_empty: bool = False) -> NDArray[np.int32]:
    for cell_block in mesh.cells:
        if cell_block.type in allowed:
            return np.asarray(cell_block.data, dtype=np.int32)
    if allow_empty:
        width = 3 if "triangle" in allowed else 4
        return np.zeros((0, width), dtype=np.int32)
    raise ValueError(f"mesh does not contain required cell types: {sorted(allowed)}")


def _extract_mesh_data(
    gmsh: Any,
    quality: MeshQualityReport | None = None,
    has_physical_groups: bool = False,
) -> MeshData:
    emit_progress("Gmsh: extracting mesh data")
    node_tags, coords, _ = gmsh.model.mesh.getNodes()
    if len(node_tags) == 0:
        raise ValueError("gmsh produced an empty node set")

    node_index = {int(tag): idx for idx, tag in enumerate(node_tags)}
    nodes = np.asarray(coords, dtype=np.float64).reshape(-1, 3)

    if has_physical_groups:
        # ── Region-aware extraction via physical groups ──
        elements_list: list[list[int]] = []
        markers_list: list[int] = []
        for _dim, phys_tag in gmsh.model.getPhysicalGroups(dim=3):
            entities = gmsh.model.getEntitiesForPhysicalGroup(3, phys_tag)
            for entity in entities:
                elem_types, _elem_tags, node_ids = gmsh.model.mesh.getElements(3, entity)
                for etype, nids in zip(elem_types, node_ids):
                    _, _, _, num_nodes, _, npn = gmsh.model.mesh.getElementProperties(int(etype))
                    if npn < 4:
                        continue
                    flat = [node_index[int(t)] for t in nids]
                    for start in range(0, len(flat), num_nodes):
                        elements_list.append(flat[start : start + 4])
                        markers_list.append(phys_tag)

        bfaces_list: list[list[int]] = []
        bmarkers_list: list[int] = []
        for _dim, phys_tag in gmsh.model.getPhysicalGroups(dim=2):
            entities = gmsh.model.getEntitiesForPhysicalGroup(2, phys_tag)
            for entity in entities:
                elem_types, _elem_tags, node_ids = gmsh.model.mesh.getElements(2, entity)
                for etype, nids in zip(elem_types, node_ids):
                    _, _, _, num_nodes, _, npn = gmsh.model.mesh.getElementProperties(int(etype))
                    if npn < 3:
                        continue
                    flat = [node_index[int(t)] for t in nids]
                    for start in range(0, len(flat), num_nodes):
                        bfaces_list.append(flat[start : start + 3])
                        bmarkers_list.append(phys_tag)

        elements = (
            np.asarray(elements_list, dtype=np.int32)
            if elements_list
            else np.zeros((0, 4), dtype=np.int32)
        )
        element_markers = (
            np.asarray(markers_list, dtype=np.int32)
            if markers_list
            else np.zeros(0, dtype=np.int32)
        )
        boundary_faces = (
            np.asarray(bfaces_list, dtype=np.int32)
            if bfaces_list
            else np.zeros((0, 3), dtype=np.int32)
        )
        boundary_markers = (
            np.asarray(bmarkers_list, dtype=np.int32)
            if bmarkers_list
            else np.zeros(0, dtype=np.int32)
        )
    else:
        # ── Legacy single-region path ──
        element_blocks = gmsh.model.mesh.getElements(dim=3)
        elements = _extract_gmsh_connectivity(
            gmsh, element_blocks, node_index, nodes_per_element=4
        )

        boundary_blocks = gmsh.model.mesh.getElements(dim=2)
        boundary_faces = _extract_gmsh_connectivity(
            gmsh, boundary_blocks, node_index, nodes_per_element=3
        )

        element_markers = np.ones(elements.shape[0], dtype=np.int32)
        boundary_markers = np.ones(boundary_faces.shape[0], dtype=np.int32)

    return MeshData(
        nodes=nodes,
        elements=elements,
        element_markers=element_markers,
        boundary_faces=boundary_faces,
        boundary_markers=boundary_markers,
        quality=quality,
    )


# ---------------------------------------------------------------------------
# Gmsh option helpers
# ---------------------------------------------------------------------------
def _apply_mesh_options(
    gmsh: Any,
    hmax: float,
    order: int,
    opts: MeshOptions,
    hscale: float = 1.0,
    preexisting_field_ids: list[int] | None = None,
) -> None:
    """Apply MeshOptions to the Gmsh context before mesh.generate()."""
    emit_progress("Gmsh: applying mesh options")
    gmsh.option.setNumber("Mesh.CharacteristicLengthMax", hmax)
    # The exported mesh asset is intentionally first-order topology.
    # Higher-order FEM lives in the solver space (`fe_order`), not in the
    # geometric mesh connectivity. Generating quadratic Gmsh elements here
    # introduces mid-edge nodes that are not part of our MeshIR contract and
    # has produced unstable/degenerate tetrahedra for imported STL cases.
    gmsh.option.setNumber("Mesh.ElementOrder", 1)
    gmsh.option.setNumber("Mesh.Algorithm", opts.algorithm_2d)
    gmsh.option.setNumber("Mesh.Algorithm3D", opts.algorithm_3d)
    gmsh.option.setNumber("Mesh.MeshSizeFactor", opts.size_factor)
    gmsh.option.setNumber("Mesh.Smoothing", opts.smoothing_steps)

    if opts.hmin is not None:
        gmsh.option.setNumber("Mesh.CharacteristicLengthMin", opts.hmin * hscale)

    if opts.size_from_curvature > 0:
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", opts.size_from_curvature)

    if opts.growth_rate is not None:
        gmsh.option.setNumber("Mesh.SmoothRatio", opts.growth_rate)
        if opts.growth_rate < 1.5:
            gmsh.option.setNumber("Mesh.Smoothing", max(opts.smoothing_steps, 5))

    extra_field_ids: list[int] = list(preexisting_field_ids or [])

    if opts.narrow_regions > 0:
        fid = _add_narrow_region_field(gmsh, opts.narrow_regions, hmax, hscale)
        if fid is not None:
            extra_field_ids.append(fid)

    if opts.size_fields:
        emit_progress("Gmsh: configuring mesh size fields")
        _configure_mesh_size_fields(gmsh, opts.size_fields, hscale, extra_field_ids)
    elif extra_field_ids:
        # No explicit size_fields but we have auto-generated fields (e.g. narrow regions)
        emit_progress("Gmsh: configuring mesh size fields")
        _configure_mesh_size_fields(gmsh, [], hscale, extra_field_ids)


def _apply_post_mesh_options(gmsh: Any, opts: MeshOptions) -> None:
    """Apply post-generation options (optimization passes)."""
    if opts.optimize is not None:
        method = opts.optimize
        niter = opts.optimize_iters
        emit_progress(f"Gmsh: optimizing mesh (method={method!r}, iters={niter})")
        gmsh.model.mesh.optimize(method, niter=niter)


def _add_narrow_region_field(
    gmsh: Any,
    n_resolve: int,
    hmax: float,
    hscale: float = 1.0,
) -> int | None:
    """Add a size field that refines narrow regions of the geometry.

    Uses a Distance field from all boundary surfaces: the local wall
    thickness is approximately ``2 × dist_to_nearest_boundary``.
    The target element size is ``thickness / n_resolve``, clamped to
    ``[hmax * 0.05, hmax]`` (scaled by *hscale*).

    Returns the Gmsh field ID of a MathEval field, or ``None`` when
    no surfaces are present.
    """
    if n_resolve < 1:
        return None

    surfaces = gmsh.model.getEntities(2)
    if not surfaces:
        return None
    surf_tags = [t for _, t in surfaces]

    f_dist = gmsh.model.mesh.field.add("Distance")
    gmsh.model.mesh.field.setNumbers(f_dist, "SurfacesList", surf_tags)
    gmsh.model.mesh.field.setNumber(f_dist, "Sampling", 20)

    hmin_val = hmax * 0.05 * hscale
    hmax_val = hmax * hscale
    # target_h = 2*dist / n_resolve, clamped to [hmin_val, hmax_val]
    expr = f"Min(Max(2*F{f_dist}/{n_resolve}, {hmin_val}), {hmax_val})"
    f_math = gmsh.model.mesh.field.add("MathEval")
    gmsh.model.mesh.field.setString(f_math, "F", expr)
    return f_math


def _configure_mesh_size_fields(
    gmsh: Any,
    fields: list[dict[str, Any]],
    hscale: float = 1.0,
    extra_field_ids: list[int] | None = None,
) -> None:
    """Configure Gmsh mesh size fields from JSON-serializable configs.

    Each field config dict has:
        {"kind": "Box", "params": {"VIn": ..., "VOut": ..., ...}}

    Size values (VIn, VOut, hMin, hMax, SizeMin, SizeMax, Radius, etc.)
    are automatically scaled by ``hscale`` when the parameter name
    contains a size-like keyword.
    """
    _SIZE_PARAMS = {
        "vin", "vout", "hmin", "hmax", "hbulk",
        "sizemin", "sizemax", "distmin", "distmax",
        "radius", "thickness",
        "sizeminnormal", "sizemintangent",
        "sizemaxnormal", "sizemaxtangent",
    }

    field_ids = []
    for config in fields:
        kind = config["kind"]
        fid = gmsh.model.mesh.field.add(kind)
        for key, value in config.get("params", {}).items():
            if isinstance(value, str):
                gmsh.model.mesh.field.setString(fid, key, value)
            elif isinstance(value, list):
                gmsh.model.mesh.field.setNumbers(fid, key, value)
            else:
                # Auto-scale size-like params for µm-scaled geometries
                if hscale != 1.0 and key.lower() in _SIZE_PARAMS:
                    value = value * hscale
                gmsh.model.mesh.field.setNumber(fid, key, value)
        field_ids.append(fid)

    if extra_field_ids:
        field_ids.extend(extra_field_ids)

    if field_ids:
        if len(field_ids) > 1:
            combo = gmsh.model.mesh.field.add("Min")
            gmsh.model.mesh.field.setNumbers(combo, "FieldsList", field_ids)
            gmsh.model.mesh.field.setAsBackgroundMesh(combo)
        else:
            gmsh.model.mesh.field.setAsBackgroundMesh(field_ids[0])


def _extract_quality_metrics(
    gmsh: Any,
    opts: MeshOptions,
) -> MeshQualityReport:
    """Extract per-element quality metrics from the current Gmsh mesh."""
    emit_progress("Gmsh: extracting quality metrics")

    # Collect all 3D element tags
    elem_types, elem_tags_blocks, _ = gmsh.model.mesh.getElements(dim=3)
    all_tags: list[int] = []
    for block in elem_tags_blocks:
        all_tags.extend(int(t) for t in block)

    if not all_tags:
        return MeshQualityReport(
            n_elements=0,
            sicn_min=0.0, sicn_max=0.0, sicn_mean=0.0, sicn_p5=0.0,
            sicn_histogram=[0] * 20,
            gamma_min=0.0, gamma_mean=0.0,
            gamma_histogram=[0] * 20,
            volume_min=0.0, volume_max=0.0, volume_mean=0.0, volume_std=0.0,
            avg_quality=0.0,
        )

    sicn = np.asarray(gmsh.model.mesh.getElementQualities(all_tags, "minSICN"))
    gamma = np.asarray(gmsh.model.mesh.getElementQualities(all_tags, "gamma"))
    vols = np.asarray(gmsh.model.mesh.getElementQualities(all_tags, "volume"))
    avg_q = gmsh.option.getNumber("Mesh.AvgQuality")

    sicn_hist, _ = np.histogram(sicn, bins=20, range=(-1.0, 1.0))
    gamma_hist, _ = np.histogram(gamma, bins=20, range=(0.0, 1.0))

    return MeshQualityReport(
        n_elements=len(all_tags),
        sicn_min=float(np.min(sicn)),
        sicn_max=float(np.max(sicn)),
        sicn_mean=float(np.mean(sicn)),
        sicn_p5=float(np.percentile(sicn, 5)),
        sicn_histogram=sicn_hist.tolist(),
        gamma_min=float(np.min(gamma)),
        gamma_mean=float(np.mean(gamma)),
        gamma_histogram=gamma_hist.tolist(),
        volume_min=float(np.min(vols)),
        volume_max=float(np.max(vols)),
        volume_mean=float(np.mean(vols)),
        volume_std=float(np.std(vols)),
        avg_quality=float(avg_q),
        element_sicn=sicn.tolist() if opts.per_element_quality else None,
        element_gamma=gamma.tolist() if opts.per_element_quality else None,
    )


def _extract_gmsh_connectivity(
    gmsh: Any,
    element_blocks: tuple[list[int], list[np.ndarray], list[np.ndarray]],
    node_index: dict[int, int],
    nodes_per_element: int,
) -> NDArray[np.int32]:
    element_types, _, node_tags_blocks = element_blocks
    rows: list[list[int]] = []
    for element_type, tags in zip(element_types, node_tags_blocks):
        _, _, _, num_nodes, _, num_primary_nodes = gmsh.model.mesh.getElementProperties(
            int(element_type)
        )
        if num_primary_nodes < nodes_per_element:
            raise ValueError(
                f"gmsh element type {element_type} exposes only {num_primary_nodes} "
                f"primary nodes, expected at least {nodes_per_element}"
            )
        flat = [node_index[int(tag)] for tag in tags]
        if len(flat) % num_nodes != 0:
            raise ValueError(
                f"gmsh connectivity for element type {element_type} has {len(flat)} "
                f"entries, not divisible by {num_nodes}"
            )
        for start in range(0, len(flat), num_nodes):
            element_nodes = flat[start : start + num_nodes]
            rows.append(element_nodes[:nodes_per_element])
    if not rows:
        return np.zeros((0, nodes_per_element), dtype=np.int32)
    return np.asarray(rows, dtype=np.int32)


# ---------------------------------------------------------------------------
# Adaptive remeshing with PostView background size field
# ---------------------------------------------------------------------------
def _apply_postview_background_mesh(
    gmsh: Any,
    sf: SizeFieldData,
    coord_scale: float = 1.0,
) -> None:
    """Inject a PostView-based background mesh size field into Gmsh.

    Creates a Gmsh view with scattered-point (SP) data from the nodal
    size field computed by the Rust error estimator, then registers a
    PostView field as the background mesh.

    Disables all other automatic size sources so the PostView controls
    element sizes exclusively.

    Args:
        gmsh: Initialised Gmsh module.
        sf: Nodal size field (coordinates + h values).
        coord_scale: Multiplier applied to node coordinates and h values
                     to match the internal Gmsh model scale (e.g. 1e6
                     for µm-scaled OCC models).
    """
    # Disable competing size sources
    gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 0)
    gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 0)
    gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)

    # Build list data: each SP entry = [x, y, z, h]
    view_tag = gmsh.view.add("afem_size_field")
    n = sf.node_coords.shape[0]
    # addListData expects list of lists: each sub-list = [x, y, z, val]
    data: list[list[float]] = []
    for i in range(n):
        x, y, z = sf.node_coords[i] * coord_scale
        h = float(sf.h_values[i]) * coord_scale
        data.append([x, y, z, h])
    gmsh.view.addListData(view_tag, "SP", n, data)

    # Create PostView field and set as background mesh
    fid = gmsh.model.mesh.field.add("PostView")
    gmsh.model.mesh.field.setNumber(fid, "ViewTag", view_tag)
    gmsh.model.mesh.field.setAsBackgroundMesh(fid)


def remesh_with_size_field(
    geometry: "Geometry",
    size_field: SizeFieldData,
    hmax: float,
    order: int = 1,
    air_padding: float = 0.0,
    options: MeshOptions | None = None,
) -> MeshData:
    """Re-mesh geometry using an adaptive size field from error estimation.

    This is the primary entry point for the AFEM remesh step.  It
    reconstructs the OCC geometry, injects a PostView background mesh
    derived from the Rust-side nodal size field, and generates a new
    tetrahedral mesh conforming to those target element sizes.

    Args:
        geometry: Fullmag geometry descriptor (same as for generate_mesh).
        size_field: Nodal size field produced by the error estimator.
        hmax: Fallback maximum element size (SI metres). Used as upper
              bound and for CharacteristicLengthMax.
        order: Mesh element order (always 1 for current pipeline).
        air_padding: Reserved for future air-box meshing.
        options: Optional advanced Gmsh options.
    """
    opts = options or MeshOptions()

    # Delegate to type-specific remeshers that share the OCC pipeline
    if isinstance(geometry, Box):
        return _remesh_box(geometry, size_field, hmax, order, air_padding, opts)
    if isinstance(geometry, Cylinder):
        return _remesh_cylinder(geometry, size_field, hmax, order, air_padding, opts)
    if isinstance(geometry, (Difference, Union, Intersection, Translate, Ellipsoid, Ellipse)):
        return _remesh_csg(geometry, size_field, hmax, order, opts)
    if isinstance(geometry, ImportedGeometry):
        return _remesh_imported(geometry, size_field, hmax, order, air_padding, opts)
    raise TypeError(f"unsupported geometry type for adaptive remeshing: {type(geometry)!r}")


def _remesh_box(
    geometry: Box,
    sf: SizeFieldData,
    hmax: float,
    order: int,
    air_padding: float,
    opts: MeshOptions,
) -> MeshData:
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add("fullmag_box_afem")
        emit_progress("AFEM: building OCC box geometry")
        sx, sy, sz = geometry.size
        gmsh.model.occ.addBox(-sx / 2.0, -sy / 2.0, -sz / 2.0, sx, sy, sz)
        gmsh.model.occ.synchronize()
        emit_progress("AFEM: applying adaptive size field")
        _apply_mesh_options(gmsh, hmax, order, opts)
        _apply_postview_background_mesh(gmsh, sf)
        emit_progress("AFEM: generating adaptive 3D mesh")
        gmsh.model.mesh.generate(3)
        _apply_post_mesh_options(gmsh, opts)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None
        mesh = _extract_mesh_data(gmsh, quality=quality)
        emit_progress(
            f"AFEM: mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements"
        )
        return mesh
    finally:
        gmsh.finalize()


def _remesh_cylinder(
    geometry: Cylinder,
    sf: SizeFieldData,
    hmax: float,
    order: int,
    air_padding: float,
    opts: MeshOptions,
) -> MeshData:
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add("fullmag_cylinder_afem")
        emit_progress("AFEM: building OCC cylinder geometry")
        gmsh.model.occ.addCylinder(
            0.0, 0.0, -geometry.height / 2.0,
            0.0, 0.0, geometry.height,
            geometry.radius,
        )
        gmsh.model.occ.synchronize()
        emit_progress("AFEM: applying adaptive size field")
        _apply_mesh_options(gmsh, hmax, order, opts)
        _apply_postview_background_mesh(gmsh, sf)
        emit_progress("AFEM: generating adaptive 3D mesh")
        gmsh.model.mesh.generate(3)
        _apply_post_mesh_options(gmsh, opts)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None
        mesh = _extract_mesh_data(gmsh, quality=quality)
        emit_progress(
            f"AFEM: mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements"
        )
        return mesh
    finally:
        gmsh.finalize()


def _remesh_csg(
    geometry: "Geometry",
    sf: SizeFieldData,
    hmax: float,
    order: int,
    opts: MeshOptions,
) -> MeshData:
    SCALE = 1e6
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add("fullmag_csg_afem")
        emit_progress("AFEM: building OCC geometry")
        _add_geometry_to_occ(gmsh, geometry, scale=SCALE)
        gmsh.model.occ.synchronize()
        emit_progress("AFEM: applying adaptive size field (µm-scaled)")
        _apply_mesh_options(gmsh, hmax * SCALE, order, opts, hscale=SCALE)
        _apply_postview_background_mesh(gmsh, sf, coord_scale=SCALE)
        emit_progress("AFEM: generating adaptive 3D mesh")
        gmsh.model.mesh.generate(3)
        _apply_post_mesh_options(gmsh, opts)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None
        mesh = _extract_mesh_data(gmsh, quality=quality)
        emit_progress(
            f"AFEM: mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements"
        )
        return MeshData(
            nodes=mesh.nodes / SCALE,
            elements=mesh.elements,
            element_markers=mesh.element_markers,
            boundary_faces=mesh.boundary_faces,
            boundary_markers=mesh.boundary_markers,
            quality=quality,
        )
    finally:
        gmsh.finalize()


def _remesh_imported(
    geometry: "ImportedGeometry",
    sf: SizeFieldData,
    hmax: float,
    order: int,
    air_padding: float,
    opts: MeshOptions,
) -> MeshData:
    path = Path(geometry.source)
    suffix = path.suffix.lower()
    scale_xyz = _normalize_scale_xyz(geometry.scale)
    source_hmax = _source_hmax_from_scale(hmax, scale_xyz)
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add(path.stem + "_afem")
        if suffix in {".step", ".stp", ".iges", ".igs"}:
            emit_progress("AFEM: importing CAD shapes")
            gmsh.model.occ.importShapes(str(path))
            gmsh.model.occ.synchronize()
        elif suffix == ".stl":
            emit_progress("AFEM: importing STL surface")
            _build_stl_volume_model(gmsh, path)  # return values unused here
        else:
            raise ValueError(
                f"adaptive remeshing from file format {suffix!r} not supported; "
                "use .step/.stp/.iges/.igs/.stl"
            )
        emit_progress("AFEM: applying adaptive size field")
        _apply_mesh_options(gmsh, source_hmax, order, opts)
        # Size field coordinates are in SI; scale to source space
        inv_scale = 1.0 / float(np.max(scale_xyz[scale_xyz > 0]))
        _apply_postview_background_mesh(gmsh, sf, coord_scale=inv_scale)
        emit_progress("AFEM: generating adaptive 3D mesh")
        gmsh.model.mesh.generate(3)
        _apply_post_mesh_options(gmsh, opts)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None
        mesh = _scale_mesh_nodes(_extract_mesh_data(gmsh, quality=quality), scale_xyz)
        emit_progress(
            f"AFEM: mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements"
        )
        return mesh
    finally:
        gmsh.finalize()


# ---------------------------------------------------------------------------
# Air-box mesh generation for Poisson demag (S01)
# ---------------------------------------------------------------------------
def add_air_box(
    geometry: Geometry,
    hmax: float,
    factor: float = 3.0,
    grading: float = 0.3,
    order: int = 1,
    boundary_marker: int = 99,
    options: MeshOptions | None = None,
) -> MeshData:
    """Generate a tetrahedral mesh with an air-box surrounding the magnetic region.

    The magnetic volume gets ``element_marker=1``, the air region gets
    ``element_marker=0``.  Boundary faces on the outer air-box surface get
    ``boundary_marker`` (default 99) for Dirichlet/Robin BC application.

    The air-box extends ``factor`` times the magnetic bounding box in each
    direction (centered on the magnet centroid).  ``grading`` controls how
    much the mesh coarsens between the magnet surface and the outer boundary
    (0 = uniform, 1 = maximum grading).

    Args:
        geometry: Magnetic body geometry (Box, Cylinder, Sphere, etc.).
        hmax: Maximum element size on the magnetic body (SI metres).
        factor: Air-box size as a multiple of the magnetic bounding-box diagonal.
        grading: Mesh grading factor (0–1).  Higher = coarser air far from magnet.
        order: FE order (1 = linear P1, 2 = quadratic P2).
        boundary_marker: Marker assigned to outer air-box boundary faces.
        options: Advanced Gmsh meshing options.

    Returns:
        MeshData with both magnetic (marker=1) and air (marker=0) elements.
    """
    if factor < 1.5:
        raise ValueError(f"air_box factor must be >= 1.5, got {factor}")
    if not 0.0 <= grading <= 1.0:
        raise ValueError(f"grading must be in [0, 1], got {grading}")

    opts = options or MeshOptions()
    gmsh = _import_gmsh()
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add("fullmag_airbox")

        # ── Create magnetic volume via Gmsh OCC ──
        mag_tag = _create_occ_geometry(gmsh, geometry)
        # Get bounding box of magnetic volume
        xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.occ.getBoundingBox(3, mag_tag)
        cx, cy, cz = (xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2
        dx, dy, dz = xmax - xmin, ymax - ymin, zmax - zmin
        diag = math.sqrt(dx * dx + dy * dy + dz * dz)

        # ── Create air-box as a larger box ──
        half = factor * diag / 2.0
        air_tag = gmsh.model.occ.addBox(
            cx - half, cy - half, cz - half,
            2 * half, 2 * half, 2 * half,
        )

        # ── Boolean cut: air = box - magnet, preserving both ──
        # Fragment produces non-overlapping volumes sharing interfaces
        result, result_map = gmsh.model.occ.fragment(
            [(3, air_tag)], [(3, mag_tag)]
        )
        gmsh.model.occ.synchronize()

        # ── Identify which fragment is the magnet and which is air ──
        # The magnetic volume is the one inside the original magnet bounding box
        volumes = gmsh.model.getEntities(3)
        mag_volumes = []
        air_volumes = []
        for dim, tag in volumes:
            bb = gmsh.model.getBoundingBox(dim, tag)
            vol_cx = (bb[0] + bb[3]) / 2
            vol_cy = (bb[1] + bb[4]) / 2
            vol_cz = (bb[2] + bb[5]) / 2
            vol_dx = bb[3] - bb[0]
            vol_dy = bb[4] - bb[1]
            vol_dz = bb[5] - bb[2]
            # If the volume fits within the original magnet bbox (with tolerance),
            # it's the magnetic region; otherwise it's air.
            tol = 0.1 * diag
            if (vol_dx < dx + tol and vol_dy < dy + tol and vol_dz < dz + tol
                    and abs(vol_cx - cx) < tol and abs(vol_cy - cy) < tol
                    and abs(vol_cz - cz) < tol):
                mag_volumes.append(tag)
            else:
                air_volumes.append(tag)

        if not mag_volumes:
            raise RuntimeError(
                "air-box generation failed: could not identify magnetic volume after fragment"
            )

        # ── Physical groups: magnetic=1, air=0 ──
        gmsh.model.addPhysicalGroup(3, mag_volumes, tag=1)
        gmsh.model.setPhysicalName(3, 1, "magnetic")
        gmsh.model.addPhysicalGroup(3, air_volumes, tag=2)
        gmsh.model.setPhysicalName(3, 2, "air")

        # ── Outer boundary: faces on the air-box exterior ──
        # Identify boundary faces of air volumes that are on the outer box surface
        outer_faces = []
        for air_tag_i in air_volumes:
            bnd = gmsh.model.getBoundary([(3, air_tag_i)], oriented=False)
            for _, face_tag in bnd:
                bb = gmsh.model.getBoundingBox(2, face_tag)
                face_cx = (bb[0] + bb[3]) / 2
                face_cy = (bb[1] + bb[4]) / 2
                face_cz = (bb[2] + bb[5]) / 2
                # Check if face is on the outer box boundary
                eps = 0.01 * half
                on_outer = (
                    abs(bb[0] - (cx - half)) < eps or abs(bb[3] - (cx + half)) < eps
                    or abs(bb[1] - (cy - half)) < eps or abs(bb[4] - (cy + half)) < eps
                    or abs(bb[2] - (cz - half)) < eps or abs(bb[5] - (cz + half)) < eps
                )
                if on_outer and face_tag not in outer_faces:
                    outer_faces.append(face_tag)
        if outer_faces:
            gmsh.model.addPhysicalGroup(2, outer_faces, tag=boundary_marker)
            gmsh.model.setPhysicalName(2, boundary_marker, "outer_boundary")

        # ── Mesh size: fine near magnet surface, coarser in air ──
        gmsh.option.setNumber("Mesh.MeshSizeMax", hmax * factor * (1.0 + 2.0 * grading))
        gmsh.option.setNumber("Mesh.MeshSizeMin", hmax * 0.1)

        # Size field: distance from magnetic surface + threshold
        mag_surfaces = []
        for mv in mag_volumes:
            bnd = gmsh.model.getBoundary([(3, mv)], oriented=False)
            mag_surfaces.extend([abs(t) for _, t in bnd])
        mag_surfaces = list(set(mag_surfaces))

        f_dist = gmsh.model.mesh.field.add("Distance")
        gmsh.model.mesh.field.setNumbers(f_dist, "SurfacesList", mag_surfaces)

        f_thresh = gmsh.model.mesh.field.add("Threshold")
        gmsh.model.mesh.field.setNumber(f_thresh, "InField", f_dist)
        gmsh.model.mesh.field.setNumber(f_thresh, "SizeMin", hmax)
        gmsh.model.mesh.field.setNumber(f_thresh, "SizeMax", hmax * factor * (1.0 + 2.0 * grading))
        gmsh.model.mesh.field.setNumber(f_thresh, "DistMin", 0.0)
        gmsh.model.mesh.field.setNumber(f_thresh, "DistMax", half * grading + hmax)

        f_min = gmsh.model.mesh.field.add("Min")
        gmsh.model.mesh.field.setNumbers(f_min, "FieldsList", [f_thresh])
        gmsh.model.mesh.field.setAsBackgroundMesh(f_min)

        gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 0)
        gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 0)
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)
        gmsh.option.setNumber("Mesh.Algorithm3D", opts.algorithm_3d)

        if order > 1:
            gmsh.option.setNumber("Mesh.ElementOrder", order)

        # ── Generate ──
        emit_progress("Gmsh: generating air-box 3D mesh")
        gmsh.model.mesh.generate(3)
        quality = _extract_quality_metrics(gmsh, opts) if opts.compute_quality else None

        # ── Extract mesh data ──
        mesh = _extract_airbox_mesh_data(gmsh, mag_volumes, air_volumes, boundary_marker, quality)
        emit_progress(
            f"Gmsh: air-box mesh ready — {mesh.n_nodes} nodes, {mesh.n_elements} elements "
            f"(magnetic: {int((mesh.element_markers == 1).sum())}, "
            f"air: {int((mesh.element_markers == 0).sum())})"
        )
        return mesh
    finally:
        gmsh.finalize()


def _create_occ_geometry(gmsh: Any, geometry: Geometry) -> int:
    """Create a Gmsh OCC volume from a fullmag Geometry and return its tag."""
    if isinstance(geometry, Box):
        sx, sy, sz = geometry.size
        return gmsh.model.occ.addBox(-sx / 2, -sy / 2, -sz / 2, sx, sy, sz)
    if isinstance(geometry, Cylinder):
        return gmsh.model.occ.addCylinder(
            0, 0, -geometry.height / 2, 0, 0, geometry.height, geometry.radius
        )
    if isinstance(geometry, Ellipsoid):
        tag = gmsh.model.occ.addSphere(0, 0, 0, 1.0)
        rx, ry, rz = geometry.semi_axes
        gmsh.model.occ.dilate([(3, tag)], 0, 0, 0, rx, ry, rz)
        return tag
    # Fallback for CSG or imported: create a sphere placeholder
    # (real implementation would walk the CSG tree)
    raise TypeError(f"add_air_box does not yet support {type(geometry).__name__} geometry")


def _extract_airbox_mesh_data(
    gmsh: Any,
    mag_volumes: list[int],
    air_volumes: list[int],
    boundary_marker: int,
    quality: MeshQualityReport | None,
) -> MeshData:
    """Extract mesh data with correct element markers from an air-box mesh.

    magnetic volumes → element_marker=1, air volumes → element_marker=0.
    """
    # Get all nodes
    node_tags, node_coords, _ = gmsh.model.mesh.getNodes()
    n_gmsh_nodes = len(node_tags)
    # Build tag→index mapping
    tag_to_idx: dict[int, int] = {}
    max_tag = int(node_tags.max()) if n_gmsh_nodes > 0 else 0
    coords_3d = node_coords.reshape(-1, 3)
    # Renumber into contiguous array
    reindex = np.full(max_tag + 1, -1, dtype=np.int32)
    for i, tag in enumerate(node_tags):
        reindex[int(tag)] = i

    nodes = coords_3d.copy()

    # Collect elements with markers
    all_elements: list[np.ndarray] = []
    all_markers: list[np.ndarray] = []

    mag_set = set(mag_volumes)
    for dim, vol_tag in gmsh.model.getEntities(3):
        elem_types, elem_tags, elem_node_tags = gmsh.model.mesh.getElements(dim, vol_tag)
        for et, etags, enodes in zip(elem_types, elem_tags, elem_node_tags):
            props = gmsh.model.mesh.getElementProperties(et)
            if props[0] != "Tetrahedron":
                continue
            n_per = props[3]
            if n_per < 4:
                continue
            node_array = np.array(enodes, dtype=np.int64).reshape(-1, n_per)
            # Take first 4 nodes (linear P1 corners)
            tets = node_array[:, :4]
            n_tets = tets.shape[0]
            marker = 1 if vol_tag in mag_set else 0
            reindexed = reindex[tets.ravel()].reshape(-1, 4)
            all_elements.append(reindexed)
            all_markers.append(np.full(n_tets, marker, dtype=np.int32))

    if not all_elements:
        raise RuntimeError("air-box mesh generation produced zero tetrahedra")

    elements = np.concatenate(all_elements, axis=0)
    element_markers = np.concatenate(all_markers, axis=0)

    # Collect boundary faces
    all_bnd_faces: list[np.ndarray] = []
    all_bnd_markers: list[np.ndarray] = []
    for dim, surf_tag in gmsh.model.getEntities(2):
        elem_types, elem_tags, elem_node_tags = gmsh.model.mesh.getElements(dim, surf_tag)
        for et, etags, enodes in zip(elem_types, elem_tags, elem_node_tags):
            props = gmsh.model.mesh.getElementProperties(et)
            if props[0] != "Triangle":
                continue
            n_per = props[3]
            node_array = np.array(enodes, dtype=np.int64).reshape(-1, n_per)
            tris = node_array[:, :3]
            n_tris = tris.shape[0]
            reindexed = reindex[tris.ravel()].reshape(-1, 3)
            all_bnd_faces.append(reindexed)
            # Check if this surface belongs to the outer boundary physical group
            phys_groups = gmsh.model.getPhysicalGroupsForEntity(2, surf_tag)
            bm = boundary_marker if boundary_marker in phys_groups else 1
            all_bnd_markers.append(np.full(n_tris, bm, dtype=np.int32))

    if all_bnd_faces:
        boundary_faces = np.concatenate(all_bnd_faces, axis=0)
        boundary_markers_arr = np.concatenate(all_bnd_markers, axis=0)
    else:
        boundary_faces = np.zeros((0, 3), dtype=np.int32)
        boundary_markers_arr = np.zeros(0, dtype=np.int32)

    return MeshData(
        nodes=nodes,
        elements=elements,
        element_markers=element_markers,
        boundary_faces=boundary_faces,
        boundary_markers=boundary_markers_arr,
        quality=quality,
    )
