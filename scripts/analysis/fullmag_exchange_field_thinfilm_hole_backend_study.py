#!/usr/bin/env python3
"""Run a real Fullmag backend study for a perforated Py thin film.

This script uses the actual Fullmag pipeline:
- writes precomputed FDM voxel assets and FEM mesh assets
- generates real `fullmag` problem scripts for each resolution/backend
- runs the Rust-hosted CLI in headless mode
- reads solver artifacts (`H_ex` snapshots) and computes mean |H_ex|

Study:
- Py layer: 1 um x 1 um x 10 nm
- central circular hole: diameter 150 nm
- resolutions: 10 nm, 5 nm, 2 nm, 1 nm
- FDM: actual backend run for each requested in-plane cell size with dz = 10 nm
- FEM: actual backend run on a 1-layer tetra mesh derived from the same active geometry

Important current limitation:
- the present bootstrap FEM path serializes the whole mesh through ProblemIR JSON,
  so very fine FEM meshes become impractical. The script records that honestly and
  skips only the points that exceed a conservative tetra-count threshold.
"""

from __future__ import annotations

import csv
import json
import math
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from textwrap import dedent

import numpy as np


MU0 = 4.0 * math.pi * 1e-7
MS = 800e3
A_EX = 13e-12

LAYER_SIZE = (1e-6, 1e-6, 10e-9)
HOLE_DIAMETER = 150e-9
HOLE_RADIUS = HOLE_DIAMETER / 2.0
RESOLUTIONS_NM = [10.0, 5.0, 2.0, 1.0]

# Current JSON/IR/bootstrap FEM path becomes impractical above this size.
MAX_FEM_TETS = 300_000


def configured_resolutions_nm() -> list[float]:
    raw = os.environ.get("FULLMAG_STUDY_RESOLUTIONS_NM")
    if not raw:
        return list(RESOLUTIONS_NM)
    return [float(part.strip()) for part in raw.split(",") if part.strip()]


def configured_max_fem_tets() -> int:
    raw = os.environ.get("FULLMAG_STUDY_MAX_FEM_TETS")
    if not raw:
        return MAX_FEM_TETS
    return int(raw)


def configured_run_timeout_seconds() -> float | None:
    raw = os.environ.get("FULLMAG_STUDY_TIMEOUT_SECONDS")
    if not raw:
        return None
    return float(raw)


@dataclass(frozen=True)
class StudyResult:
    h_nm: float
    fdm_active_cells: int
    fdm_mean_abs_hex: float | None
    fem_nodes: int | None
    fem_elements: int | None
    fem_mean_abs_hex: float | None
    relative_gap: float | None
    note: str = ""


def normalized(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    n = np.maximum(n, 1e-30)
    return v / n


def theta_profile(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    lx, ly, _ = LAYER_SIZE
    return 0.35 * math.pi * np.cos(2.0 * math.pi * x / lx) * np.cos(2.0 * math.pi * y / ly)


def magnetization_vectors(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    theta = theta_profile(x, y)
    m = np.stack(
        [
            np.cos(theta),
            np.sin(theta),
            np.zeros_like(theta),
        ],
        axis=-1,
    )
    return normalized(m)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def study_root() -> Path:
    root = repo_root() / ".fullmag" / "studies" / "thinfilm_hole_backend"
    root.mkdir(parents=True, exist_ok=True)
    return root


def node_index(i: int, j: int, k: int, nx: int, ny: int) -> int:
    return i + (nx + 1) * (j + (ny + 1) * k)


def tet_volume(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray, p3: np.ndarray) -> float:
    return abs(np.dot(p1 - p0, np.cross(p2 - p0, p3 - p0))) / 6.0


def relative_gap(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    return abs(a - b) / max(abs(a), abs(b), 1e-30)


def generate_fdm_mask_asset(h_nm: float, target_dir: Path) -> tuple[Path, np.ndarray]:
    h = h_nm * 1e-9
    lx, ly, lz = LAYER_SIZE
    nx = int(round(lx / h))
    ny = int(round(ly / h))
    nz = 1

    xs = -0.5 * lx + (np.arange(nx, dtype=np.float64) + 0.5) * h
    ys = -0.5 * ly + (np.arange(ny, dtype=np.float64) + 0.5) * h
    xx, yy = np.meshgrid(xs, ys, indexing="xy")
    active_xy = (xx * xx + yy * yy) >= HOLE_RADIUS * HOLE_RADIUS
    mask = active_xy[np.newaxis, :, :]

    asset_path = target_dir / f"thinfilm_hole_fdm_{int(h_nm)}nm_mask.npz"
    np.savez_compressed(
        asset_path,
        mask=mask,
        cell_size=np.asarray([h, h, lz], dtype=np.float64),
        origin=np.asarray([-0.5 * lx, -0.5 * ly, -0.5 * lz], dtype=np.float64),
    )
    return asset_path, mask


def generate_fdm_m0(h_nm: float, mask: np.ndarray, target_dir: Path) -> Path:
    h = h_nm * 1e-9
    lx, ly, _ = LAYER_SIZE
    ny, nx = mask.shape[1], mask.shape[2]

    xs = -0.5 * lx + (np.arange(nx, dtype=np.float64) + 0.5) * h
    ys = -0.5 * ly + (np.arange(ny, dtype=np.float64) + 0.5) * h
    xx, yy = np.meshgrid(xs, ys, indexing="xy")
    m = magnetization_vectors(xx, yy)
    values = m.reshape(-1, 3)

    path = target_dir / f"thinfilm_hole_fdm_{int(h_nm)}nm_m0.npy"
    np.save(path, values)
    return path


def generate_fem_mesh_asset(h_nm: float, target_dir: Path) -> tuple[Path, Path, int, int]:
    h = h_nm * 1e-9
    lx, ly, lz = LAYER_SIZE
    nx = int(round(lx / h))
    ny = int(round(ly / h))
    nz = 1

    xs = -0.5 * lx + (np.arange(nx, dtype=np.float64) + 0.5) * h
    ys = -0.5 * ly + (np.arange(ny, dtype=np.float64) + 0.5) * h
    xx, yy = np.meshgrid(xs, ys, indexing="xy")
    active_xy = (xx * xx + yy * yy) >= HOLE_RADIUS * HOLE_RADIUS
    active_count = int(active_xy.sum())
    estimated_tets = active_count * 6
    max_fem_tets = configured_max_fem_tets()
    if estimated_tets > max_fem_tets:
        raise RuntimeError(
            f"estimated FEM size {estimated_tets} tetrahedra exceeds current bootstrap limit {max_fem_tets}"
        )

    x_nodes = -0.5 * lx + np.arange(nx + 1, dtype=np.float64) * h
    y_nodes = -0.5 * ly + np.arange(ny + 1, dtype=np.float64) * h
    z_nodes = np.asarray([-0.5 * lz, 0.5 * lz], dtype=np.float64)

    nodes = np.empty(((nx + 1) * (ny + 1) * 2, 3), dtype=np.float64)
    cursor = 0
    for k, z in enumerate(z_nodes):
        del k
        for y in y_nodes:
            for x in x_nodes:
                nodes[cursor] = (x, y, z)
                cursor += 1

    elements: list[list[int]] = []
    boundary_faces: list[list[int]] = []
    node_volumes = np.zeros(nodes.shape[0], dtype=np.float64)

    local_tets = (
        (0, 1, 2, 6),
        (0, 2, 3, 6),
        (0, 3, 7, 6),
        (0, 7, 4, 6),
        (0, 4, 5, 6),
        (0, 5, 1, 6),
    )
    local_faces = {
        "xmin": ((0, 3, 7), (0, 7, 4)),
        "xmax": ((1, 5, 6), (1, 6, 2)),
        "ymin": ((0, 4, 5), (0, 5, 1)),
        "ymax": ((3, 2, 6), (3, 6, 7)),
        "zmin": ((0, 1, 2), (0, 2, 3)),
        "zmax": ((4, 7, 6), (4, 6, 5)),
    }

    for j in range(ny):
        for i in range(nx):
            if not active_xy[j, i]:
                continue

            cell_nodes = [
                node_index(i, j, 0, nx, ny),
                node_index(i + 1, j, 0, nx, ny),
                node_index(i + 1, j + 1, 0, nx, ny),
                node_index(i, j + 1, 0, nx, ny),
                node_index(i, j, 1, nx, ny),
                node_index(i + 1, j, 1, nx, ny),
                node_index(i + 1, j + 1, 1, nx, ny),
                node_index(i, j + 1, 1, nx, ny),
            ]

            for tet_local in local_tets:
                tet = [cell_nodes[idx] for idx in tet_local]
                p = nodes[np.asarray(tet, dtype=np.int64)]
                volume = tet_volume(p[0], p[1], p[2], p[3])
                for node in tet:
                    node_volumes[node] += volume / 4.0
                elements.append(tet)

            if i == 0 or not active_xy[j, i - 1]:
                for face in local_faces["xmin"]:
                    boundary_faces.append([cell_nodes[idx] for idx in face])
            if i == nx - 1 or not active_xy[j, i + 1]:
                for face in local_faces["xmax"]:
                    boundary_faces.append([cell_nodes[idx] for idx in face])
            if j == 0 or not active_xy[j - 1, i]:
                for face in local_faces["ymin"]:
                    boundary_faces.append([cell_nodes[idx] for idx in face])
            if j == ny - 1 or not active_xy[j + 1, i]:
                for face in local_faces["ymax"]:
                    boundary_faces.append([cell_nodes[idx] for idx in face])
            for face in local_faces["zmin"]:
                boundary_faces.append([cell_nodes[idx] for idx in face])
            for face in local_faces["zmax"]:
                boundary_faces.append([cell_nodes[idx] for idx in face])

    active_nodes = node_volumes > 0.0
    remap = np.full(nodes.shape[0], -1, dtype=np.int32)
    remap[active_nodes] = np.arange(int(active_nodes.sum()), dtype=np.int32)

    compact_nodes = nodes[active_nodes]
    compact_volumes = node_volumes[active_nodes]
    compact_elements = remap[np.asarray(elements, dtype=np.int32)]
    compact_boundary = remap[np.asarray(boundary_faces, dtype=np.int32)]

    mesh_path = target_dir / f"thinfilm_hole_fem_{int(h_nm)}nm_mesh.json"
    mesh_payload = {
        "mesh_name": mesh_path.stem,
        "nodes": compact_nodes.tolist(),
        "elements": compact_elements.tolist(),
        "element_markers": np.ones(compact_elements.shape[0], dtype=np.int32).tolist(),
        "boundary_faces": compact_boundary.tolist(),
        "boundary_markers": np.ones(compact_boundary.shape[0], dtype=np.int32).tolist(),
    }
    mesh_path.write_text(json.dumps(mesh_payload), encoding="utf-8")

    volumes_path = target_dir / f"thinfilm_hole_fem_{int(h_nm)}nm_node_volumes.npy"
    np.save(volumes_path, compact_volumes)

    return mesh_path, volumes_path, int(compact_nodes.shape[0]), int(compact_elements.shape[0])


def generate_fem_m0(mesh_path: Path, target_dir: Path) -> Path:
    payload = json.loads(mesh_path.read_text(encoding="utf-8"))
    nodes = np.asarray(payload["nodes"], dtype=np.float64)
    m = magnetization_vectors(nodes[:, 0], nodes[:, 1])
    path = target_dir / (mesh_path.stem.replace("_mesh", "_m0") + ".npy")
    np.save(path, m)
    return path


def write_problem_script(
    *,
    backend: str,
    h_nm: float,
    geometry_source: Path,
    m0_path: Path,
    asset_path: Path,
    script_path: Path,
) -> None:
    h = h_nm * 1e-9
    lx, ly, lz = LAYER_SIZE

    if backend == "fdm":
        discretization_block = f"fdm=fm.FDM(cell=({h:.16e}, {h:.16e}, {lz:.16e}))"
    else:
        discretization_block = (
            f"fem=fm.FEM(order=1, hmax={h:.16e}, mesh=str(ASSET_PATH))"
        )

    script = dedent(
        f"""
        import numpy as np
        import fullmag as fm

        GEOMETRY_SOURCE = r\"{geometry_source.resolve()}\"
        ASSET_PATH = r\"{asset_path.resolve()}\"
        M0_PATH = r\"{m0_path.resolve()}\"

        def build() -> fm.Problem:
            geometry = fm.ImportedGeometry(source=str(GEOMETRY_SOURCE), name="thinfilm_hole")
            material = fm.Material(name="Py", Ms={MS:.16e}, A={A_EX:.16e}, alpha=0.5)
            m0 = fm.init.SampledMagnetization(np.load(M0_PATH).tolist())
            magnet = fm.Ferromagnet(
                name="film",
                geometry=geometry,
                material=material,
                m0=m0,
            )
            return fm.Problem(
                name="thinfilm_hole_{backend}_{int(h_nm)}nm",
                magnets=[magnet],
                energy=[fm.Exchange()],
                study=fm.TimeEvolution(
                    dynamics=fm.LLG(fixed_timestep=1e-15),
                    outputs=[
                        fm.SaveField("H_ex", every=1e-15),
                        fm.SaveScalar("E_ex", every=1e-15),
                    ],
                ),
                discretization=fm.DiscretizationHints(
                    {discretization_block},
                ),
            )

        if __name__ == "__main__":
            problem = build()
            result = fm.Simulation(problem, backend={backend!r}).run(until=1e-15)
            print(result.status)
        else:
            problem = build()
        """
    ).strip() + "\n"
    script_path.write_text(script, encoding="utf-8")


def ensure_cli_binary() -> Path:
    root = repo_root()
    binary = root / "target" / "debug" / "fullmag"
    if binary.exists():
        return binary
    subprocess.run(
        ["cargo", "+nightly", "build", "-p", "fullmag-cli"],
        cwd=root,
        check=True,
    )
    return binary


def run_fullmag_script(script_path: Path, backend: str, output_dir: Path) -> dict[str, object]:
    binary = ensure_cli_binary()
    root = repo_root()
    env = os.environ.copy()
    pythonpath = str(root / "packages" / "fullmag-py" / "src")
    env["PYTHONPATH"] = pythonpath if not env.get("PYTHONPATH") else f"{pythonpath}:{env['PYTHONPATH']}"
    try:
        completed = subprocess.run(
            [
                str(binary),
                str(script_path),
                "--until",
                "1e-15",
                "--backend",
                backend,
                "--headless",
                "--json",
                "--output-dir",
                str(output_dir),
            ],
            cwd=root,
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=configured_run_timeout_seconds(),
        )
    except subprocess.TimeoutExpired as exc:
        timeout = configured_run_timeout_seconds()
        raise RuntimeError(
            f"{backend} run timed out after {timeout:.1f}s for {script_path.name}"
        ) from exc
    if completed.returncode != 0:
        raise RuntimeError(
            f"{backend} run failed for {script_path.name}:\nSTDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}"
        )
    return json.loads(completed.stdout)


def read_mean_abs_hex_fdm(output_dir: Path, mask: np.ndarray) -> float:
    payload = json.loads((output_dir / "fields" / "H_ex" / "step_000000.json").read_text())
    values = np.asarray(payload["values"], dtype=np.float64)
    magnitudes = np.linalg.norm(values, axis=1)
    active = mask.reshape(-1)
    return float(magnitudes[active].mean())


def read_mean_abs_hex_fem(output_dir: Path, node_volumes_path: Path) -> float:
    payload = json.loads((output_dir / "fields" / "H_ex" / "step_000000.json").read_text())
    values = np.asarray(payload["values"], dtype=np.float64)
    magnitudes = np.linalg.norm(values, axis=1)
    node_volumes = np.load(node_volumes_path)
    return float(np.sum(node_volumes * magnitudes) / np.sum(node_volumes))


def write_csv(results: list[StudyResult], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "h_nm",
                "fdm_active_cells",
                "fdm_mean_abs_hex_a_per_m",
                "fem_nodes",
                "fem_elements",
                "fem_mean_abs_hex_a_per_m",
                "relative_gap",
                "note",
            ]
        )
        for row in results:
            writer.writerow(
                [
                    row.h_nm,
                    row.fdm_active_cells,
                    "" if row.fdm_mean_abs_hex is None else f"{row.fdm_mean_abs_hex:.16e}",
                    "" if row.fem_nodes is None else row.fem_nodes,
                    "" if row.fem_elements is None else row.fem_elements,
                    "" if row.fem_mean_abs_hex is None else f"{row.fem_mean_abs_hex:.16e}",
                    "" if row.relative_gap is None else f"{row.relative_gap:.16e}",
                    row.note,
                ]
            )


def build_path(points: list[tuple[float, float]]) -> str:
    return " ".join(
        (f"M {x:.2f} {y:.2f}" if index == 0 else f"L {x:.2f} {y:.2f}")
        for index, (x, y) in enumerate(points)
    )


def write_svg(results: list[StudyResult], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    width = 980.0
    height = 760.0
    left = 100.0
    right = 40.0
    top = 90.0
    chart_width = width - left - right
    chart_height = 220.0
    gap = 130.0
    upper_bottom = top + chart_height
    lower_top = upper_bottom + gap
    lower_bottom = lower_top + chart_height

    completed = [row for row in results if row.fdm_mean_abs_hex is not None]
    x_values = [row.h_nm for row in completed]
    x_min = min(x_values)
    x_max = max(x_values)
    log_min = math.log10(x_min)
    log_max = math.log10(x_max)

    def map_x(h_nm: float) -> float:
        t = (math.log10(h_nm) - log_min) / max(log_max - log_min, 1e-30)
        return left + t * chart_width

    field_values = [row.fdm_mean_abs_hex for row in completed if row.fdm_mean_abs_hex is not None]
    field_values += [row.fem_mean_abs_hex for row in results if row.fem_mean_abs_hex is not None]
    field_min = min(field_values)
    field_max = max(field_values)
    field_pad = 0.08 * max(field_max - field_min, 1e-30)
    field_min -= field_pad
    field_max += field_pad

    gap_values = [row.relative_gap for row in results if row.relative_gap is not None]
    gap_min = 0.0
    gap_max = max(gap_values) if gap_values else 1.0
    gap_max += 0.1 * max(gap_max, 1e-30)

    def map_y(value: float, vmin: float, vmax: float, bottom: float) -> float:
        return bottom - ((value - vmin) / max(vmax - vmin, 1e-30)) * chart_height

    fdm_points = [
        (map_x(row.h_nm), map_y(row.fdm_mean_abs_hex, field_min, field_max, upper_bottom))
        for row in results
        if row.fdm_mean_abs_hex is not None
    ]
    fem_points = [
        (map_x(row.h_nm), map_y(row.fem_mean_abs_hex, field_min, field_max, upper_bottom))
        for row in results
        if row.fem_mean_abs_hex is not None
    ]
    gap_points = [
        (map_x(row.h_nm), map_y(row.relative_gap, gap_min, gap_max, lower_bottom))
        for row in results
        if row.relative_gap is not None
    ]

    svg: list[str] = []
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">')
    svg.append('<rect width="100%" height="100%" fill="#07101c"/>')
    svg.append('<style>text{font-family:IBM Plex Sans,Segoe UI,sans-serif;fill:#d9e6ff}.muted{fill:#8ea3c5}.axis{stroke:#50627f;stroke-width:1}.grid{stroke:#203047;stroke-width:1;stroke-dasharray:4 6}.fdm{stroke:#57c8b6;fill:none;stroke-width:3}.fem{stroke:#6ba7ff;fill:none;stroke-width:3}.gap{stroke:#ffb86c;fill:none;stroke-width:3}.skip{fill:#ff7b7b}</style>')
    svg.append('<text x="100" y="40" font-size="26" font-weight="700">Fullmag backend study: perforated Py thin-film exchange field</text>')
    svg.append('<text x="100" y="64" class="muted" font-size="14">1 µm × 1 µm × 10 nm, central hole 150 nm, actual Fullmag FDM/FEM backends, mean |H_ex| from solver artifacts.</text>')

    for panel_top, panel_bottom, title in [
        (top, upper_bottom, 'Mean |H_ex| [A/m]'),
        (lower_top, lower_bottom, 'Relative FDM/FEM mean-field gap [-]'),
    ]:
        svg.append(f'<rect x="{left:.2f}" y="{panel_top:.2f}" width="{chart_width:.2f}" height="{chart_height:.2f}" rx="18" fill="rgba(8,16,29,0.72)" stroke="#203047"/>')
        svg.append(f'<text x="{left:.2f}" y="{panel_top - 16:.2f}" font-size="16" font-weight="600">{title}</text>')
        svg.append(f'<line x1="{left:.2f}" y1="{panel_bottom:.2f}" x2="{left + chart_width:.2f}" y2="{panel_bottom:.2f}" class="axis"/>')
        svg.append(f'<line x1="{left:.2f}" y1="{panel_top:.2f}" x2="{left:.2f}" y2="{panel_bottom:.2f}" class="axis"/>')

    for row in results:
        x = map_x(row.h_nm)
        svg.append(f'<line x1="{x:.2f}" y1="{top:.2f}" x2="{x:.2f}" y2="{lower_bottom:.2f}" class="grid" opacity="0.45"/>')
        svg.append(f'<text x="{x:.2f}" y="{lower_bottom + 24:.2f}" text-anchor="middle" class="muted" font-size="12">{row.h_nm:.0f} nm</text>')
        fem_label = "skip" if row.fem_elements is None else f"{row.fem_elements} tets"
        svg.append(f'<text x="{x:.2f}" y="{lower_bottom + 40:.2f}" text-anchor="middle" class="muted" font-size="11">FDM {row.fdm_active_cells} · FEM {fem_label}</text>')

    for idx in range(6):
        t = idx / 5.0
        y1 = upper_bottom - t * chart_height
        field_value = field_min + t * (field_max - field_min)
        svg.append(f'<line x1="{left:.2f}" y1="{y1:.2f}" x2="{left + chart_width:.2f}" y2="{y1:.2f}" class="grid" opacity="0.55"/>')
        svg.append(f'<text x="{left - 10:.2f}" y="{y1 + 4:.2f}" text-anchor="end" class="muted" font-size="11">{field_value:.3e}</text>')

        y2 = lower_bottom - t * chart_height
        gap_value = gap_min + t * (gap_max - gap_min)
        svg.append(f'<line x1="{left:.2f}" y1="{y2:.2f}" x2="{left + chart_width:.2f}" y2="{y2:.2f}" class="grid" opacity="0.55"/>')
        svg.append(f'<text x="{left - 10:.2f}" y="{y2 + 4:.2f}" text-anchor="end" class="muted" font-size="11">{gap_value:.3f}</text>')

    if fdm_points:
        svg.append(f'<path d="{build_path(fdm_points)}" class="fdm"/>')
    if fem_points:
        svg.append(f'<path d="{build_path(fem_points)}" class="fem"/>')
    if gap_points:
        svg.append(f'<path d="{build_path(gap_points)}" class="gap"/>')

    for row in results:
        if row.fem_mean_abs_hex is None:
            x = map_x(row.h_nm)
            svg.append(f'<circle cx="{x:.2f}" cy="{upper_bottom - 12:.2f}" r="6" class="skip"/>')
            note = row.note or "skipped"
            svg.append(f'<text x="{x + 10:.2f}" y="{upper_bottom - 8:.2f}" class="muted" font-size="11">{note}</text>')

    legend_y = height - 56.0
    svg.append(f'<line x1="100" y1="{legend_y:.2f}" x2="132" y2="{legend_y:.2f}" class="fdm"/>')
    svg.append(f'<text x="142" y="{legend_y + 4:.2f}" font-size="12">FDM mean |H_ex|</text>')
    svg.append(f'<line x1="330" y1="{legend_y:.2f}" x2="362" y2="{legend_y:.2f}" class="fem"/>')
    svg.append(f'<text x="372" y="{legend_y + 4:.2f}" font-size="12">FEM mean |H_ex|</text>')
    svg.append(f'<line x1="560" y1="{legend_y:.2f}" x2="592" y2="{legend_y:.2f}" class="gap"/>')
    svg.append(f'<text x="602" y="{legend_y + 4:.2f}" font-size="12">Relative FDM/FEM gap</text>')
    svg.append('</svg>')
    path.write_text("\n".join(svg), encoding="utf-8")


def run_study() -> list[StudyResult]:
    root = study_root()
    inputs_dir = root / "inputs"
    scripts_dir = root / "scripts"
    runs_dir = root / "runs"
    for directory in (inputs_dir, scripts_dir, runs_dir):
        directory.mkdir(parents=True, exist_ok=True)

    results: list[StudyResult] = []

    for h_nm in configured_resolutions_nm():
        fdm_mask_path, mask = generate_fdm_mask_asset(h_nm, inputs_dir)
        fdm_m0_path = generate_fdm_m0(h_nm, mask, inputs_dir)
        fdm_script_path = scripts_dir / f"thinfilm_hole_fdm_{int(h_nm)}nm.py"
        write_problem_script(
            backend="fdm",
            h_nm=h_nm,
            geometry_source=fdm_mask_path,
            m0_path=fdm_m0_path,
            asset_path=fdm_mask_path,
            script_path=fdm_script_path,
        )

        fdm_output_dir = runs_dir / f"fdm_{int(h_nm)}nm"
        run_fullmag_script(fdm_script_path, "fdm", fdm_output_dir)
        fdm_mean = read_mean_abs_hex_fdm(fdm_output_dir, mask)

        fem_nodes: int | None = None
        fem_elements: int | None = None
        fem_mean: float | None = None
        note = ""

        try:
            fem_mesh_path, fem_volumes_path, fem_nodes, fem_elements = generate_fem_mesh_asset(h_nm, inputs_dir)
            fem_m0_path = generate_fem_m0(fem_mesh_path, inputs_dir)
            fem_script_path = scripts_dir / f"thinfilm_hole_fem_{int(h_nm)}nm.py"
            write_problem_script(
                backend="fem",
                h_nm=h_nm,
                geometry_source=fdm_mask_path,
                m0_path=fem_m0_path,
                asset_path=fem_mesh_path,
                script_path=fem_script_path,
            )
            fem_output_dir = runs_dir / f"fem_{int(h_nm)}nm"
            run_fullmag_script(fem_script_path, "fem", fem_output_dir)
            fem_mean = read_mean_abs_hex_fem(fem_output_dir, fem_volumes_path)
        except Exception as exc:  # noqa: BLE001 - study script should record honest skips
            note = str(exc).splitlines()[0]

        results.append(
            StudyResult(
                h_nm=h_nm,
                fdm_active_cells=int(mask.sum()),
                fdm_mean_abs_hex=fdm_mean,
                fem_nodes=fem_nodes,
                fem_elements=fem_elements,
                fem_mean_abs_hex=fem_mean,
                relative_gap=relative_gap(fdm_mean, fem_mean),
                note=note,
            )
        )

    return results


def main() -> None:
    results = run_study()
    root = study_root()
    csv_path = root / "thinfilm_hole_backend_exchange_field.csv"
    svg_path = root / "thinfilm_hole_backend_exchange_field.svg"
    write_csv(results, csv_path)
    write_svg(results, svg_path)

    print("fullmag backend perforated thin-film study written:")
    print(f"- {csv_path}")
    print(f"- {svg_path}")
    for row in results:
        print(
            f"h={row.h_nm:.0f} nm | "
            f"FDM active={row.fdm_active_cells} | "
            f"FDM mean|Hex|={row.fdm_mean_abs_hex:.6e} A/m | "
            f"FEM elems={row.fem_elements if row.fem_elements is not None else 'skip'} | "
            f"FEM mean|Hex|={row.fem_mean_abs_hex:.6e} A/m" if row.fem_mean_abs_hex is not None else
            f"h={row.h_nm:.0f} nm | "
            f"FDM active={row.fdm_active_cells} | "
            f"FDM mean|Hex|={row.fdm_mean_abs_hex:.6e} A/m | "
            f"FEM skipped: {row.note}"
        )


if __name__ == "__main__":
    main()
