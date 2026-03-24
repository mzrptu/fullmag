#!/usr/bin/env python3
"""Thin-film Py exchange-field resolution study for FDM and FEM.

Study setup requested in the product discussion:
- Py layer: 1 um x 1 um x 10 nm
- in-plane magnetization texture
- compare average exchange field between FDM and FEM
- resolution ladder: 1 nm, 2 nm, 5 nm, 10 nm (in-plane)

To keep the study tractable while preserving the same physical average, the
magnetization is chosen invariant along y and z. Therefore the 3D thin film is
represented by:
- FDM: Nx x 1 x 1 structured grid with cell = (h, Ly, Lz)
- FEM: Nx x 1 x 1 structured tetra mesh over the full 3D slab

Outputs:
- .fullmag/studies/thinfilm_exchange_field_resolution.csv
- .fullmag/studies/thinfilm_exchange_field_resolution.svg
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

MU0 = 4.0 * math.pi * 1e-7
MS = 800e3
A_EX = 13e-12
LAYER_SIZE = (1e-6, 1e-6, 10e-9)
IN_PLANE_H_NM = [1.0, 2.0, 5.0, 10.0]


Vector3 = tuple[float, float, float]


def add(a: Vector3, b: Vector3) -> Vector3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vector3, b: Vector3) -> Vector3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Vector3, s: float) -> Vector3:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Vector3, b: Vector3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(a: Vector3) -> float:
    return math.sqrt(max(dot(a, a), 0.0))


def normalized(a: Vector3) -> Vector3:
    n = norm(a)
    if n <= 1e-30:
        raise ValueError("zero vector cannot be normalized")
    return scale(a, 1.0 / n)


@dataclass(frozen=True)
class StudyPoint:
    h_nm: float
    fdm_cells_x: int
    fem_divisions_x: int
    fem_nodes: int
    fem_elements: int
    fdm_mean_abs_hex: float
    fem_mean_abs_hex: float
    relative_mean_gap: float


@dataclass(frozen=True)
class MeshTopology:
    nodes: list[Vector3]
    elements: list[tuple[int, int, int, int]]
    element_stiffness: list[list[list[float]]]
    node_volumes: list[float]
    total_volume: float


def theta_profile(x: float, lx: float) -> float:
    # Smooth in-plane profile with zero normal derivative at both ends.
    return 0.45 * math.pi * math.cos(2.0 * math.pi * x / lx)


def magnetization_profile(x: float, lx: float) -> Vector3:
    theta = theta_profile(x, lx)
    return normalized((math.cos(theta), math.sin(theta), 0.0))


def relative_gap(lhs: float, rhs: float) -> float:
    return abs(lhs - rhs) / max(abs(lhs), abs(rhs), 1e-30)


def fdm_exchange_field_for_h(h_nm: float) -> tuple[int, float]:
    lx, _, _ = LAYER_SIZE
    h = h_nm * 1e-9
    nx = max(1, round(lx / h))
    dx = lx / nx
    prefactor = 2.0 * A_EX / (MU0 * MS)

    m = [magnetization_profile(-0.5 * lx + (i + 0.5) * dx, lx) for i in range(nx)]
    field: list[Vector3] = []
    for i in range(nx):
        center = m[i]
        left = m[max(i - 1, 0)]
        right = m[min(i + 1, nx - 1)]
        lap = tuple((right[c] - 2.0 * center[c] + left[c]) / (dx * dx) for c in range(3))
        field.append(scale(lap, prefactor))

    mean_abs_hex = sum(norm(value) for value in field) / nx
    return nx, mean_abs_hex


def inverse_transpose_3x3(cols: tuple[Vector3, Vector3, Vector3], det: float) -> tuple[Vector3, Vector3, Vector3]:
    (a11, a21, a31), (a12, a22, a32), (a13, a23, a33) = cols
    inv_det = 1.0 / det
    return (
        ((a22 * a33 - a23 * a32) * inv_det, (a23 * a31 - a21 * a33) * inv_det, (a21 * a32 - a22 * a31) * inv_det),
        ((a13 * a32 - a12 * a33) * inv_det, (a11 * a33 - a13 * a31) * inv_det, (a12 * a31 - a11 * a32) * inv_det),
        ((a12 * a23 - a13 * a22) * inv_det, (a13 * a21 - a11 * a23) * inv_det, (a11 * a22 - a12 * a21) * inv_det),
    )


def structured_node_index(i: int, j: int, k: int, nx: int, ny: int) -> int:
    return i + (nx + 1) * (j + (ny + 1) * k)


def build_structured_box_tet_mesh(nx: int, ny: int = 1, nz: int = 1) -> MeshTopology:
    lx, ly, lz = LAYER_SIZE
    dx = lx / nx
    dy = ly / ny
    dz = lz / nz

    nodes: list[Vector3] = []
    for k in range(nz + 1):
        z = -0.5 * lz + k * dz
        for j in range(ny + 1):
            y = -0.5 * ly + j * dy
            for i in range(nx + 1):
                x = -0.5 * lx + i * dx
                nodes.append((x, y, z))

    elements: list[tuple[int, int, int, int]] = []
    stiffness_list: list[list[list[float]]] = []
    node_volumes = [0.0 for _ in nodes]
    total_volume = 0.0

    for k in range(nz):
        for j in range(ny):
            for i in range(nx):
                n0 = structured_node_index(i, j, k, nx, ny)
                n1 = structured_node_index(i + 1, j, k, nx, ny)
                n2 = structured_node_index(i + 1, j + 1, k, nx, ny)
                n3 = structured_node_index(i, j + 1, k, nx, ny)
                n4 = structured_node_index(i, j, k + 1, nx, ny)
                n5 = structured_node_index(i + 1, j, k + 1, nx, ny)
                n6 = structured_node_index(i + 1, j + 1, k + 1, nx, ny)
                n7 = structured_node_index(i, j + 1, k + 1, nx, ny)
                local_tets = [
                    (n0, n1, n2, n6),
                    (n0, n2, n3, n6),
                    (n0, n3, n7, n6),
                    (n0, n7, n4, n6),
                    (n0, n4, n5, n6),
                    (n0, n5, n1, n6),
                ]
                for tet in local_tets:
                    p0 = nodes[tet[0]]
                    p1 = nodes[tet[1]]
                    p2 = nodes[tet[2]]
                    p3 = nodes[tet[3]]
                    d1 = sub(p1, p0)
                    d2 = sub(p2, p0)
                    d3 = sub(p3, p0)
                    det = dot(d1, (
                        d2[1] * d3[2] - d2[2] * d3[1],
                        d2[2] * d3[0] - d2[0] * d3[2],
                        d2[0] * d3[1] - d2[1] * d3[0],
                    ))
                    volume = abs(det) / 6.0
                    inv_t = inverse_transpose_3x3((d1, d2, d3), det)
                    grad1 = (inv_t[0][0], inv_t[1][0], inv_t[2][0])
                    grad2 = (inv_t[0][1], inv_t[1][1], inv_t[2][1])
                    grad3 = (inv_t[0][2], inv_t[1][2], inv_t[2][2])
                    grad0 = scale(add(add(grad1, grad2), grad3), -1.0)
                    grads = (grad0, grad1, grad2, grad3)
                    stiffness = [[0.0] * 4 for _ in range(4)]
                    for a in range(4):
                        for b in range(4):
                            stiffness[a][b] = volume * dot(grads[a], grads[b])
                    for node in tet:
                        node_volumes[node] += volume / 4.0
                    total_volume += volume
                    elements.append(tet)
                    stiffness_list.append(stiffness)

    return MeshTopology(
        nodes=nodes,
        elements=elements,
        element_stiffness=stiffness_list,
        node_volumes=node_volumes,
        total_volume=total_volume,
    )


def fem_exchange_field_for_h(h_nm: float) -> tuple[int, int, int, float]:
    lx, _, _ = LAYER_SIZE
    h = h_nm * 1e-9
    nx = max(1, round(lx / h))
    topology = build_structured_box_tet_mesh(nx)
    coeff = 2.0 * A_EX / (MU0 * MS)
    magnetization = [magnetization_profile(node[0], lx) for node in topology.nodes]
    field = [(0.0, 0.0, 0.0) for _ in topology.nodes]

    for tet, stiffness in zip(topology.elements, topology.element_stiffness):
        local_m = [magnetization[node] for node in tet]
        for a in range(4):
            contribution = (0.0, 0.0, 0.0)
            for b in range(4):
                contribution = add(contribution, scale(local_m[b], stiffness[a][b]))
            node = tet[a]
            field[node] = add(field[node], scale(contribution, -coeff))

    weighted_sum = 0.0
    for index, value in enumerate(field):
        lumped_mass = topology.node_volumes[index]
        if lumped_mass > 0.0:
            value = scale(value, 1.0 / lumped_mass)
            field[index] = value
            weighted_sum += lumped_mass * norm(value)

    mean_abs_hex = weighted_sum / max(topology.total_volume, 1e-30)
    return nx, len(topology.nodes), len(topology.elements), mean_abs_hex


def run_study() -> list[StudyPoint]:
    results: list[StudyPoint] = []
    for h_nm in IN_PLANE_H_NM:
        fdm_cells_x, fdm_mean = fdm_exchange_field_for_h(h_nm)
        fem_divisions_x, fem_nodes, fem_elements, fem_mean = fem_exchange_field_for_h(h_nm)
        results.append(
            StudyPoint(
                h_nm=h_nm,
                fdm_cells_x=fdm_cells_x,
                fem_divisions_x=fem_divisions_x,
                fem_nodes=fem_nodes,
                fem_elements=fem_elements,
                fdm_mean_abs_hex=fdm_mean,
                fem_mean_abs_hex=fem_mean,
                relative_mean_gap=relative_gap(fdm_mean, fem_mean),
            )
        )
    return results


def write_csv(results: Iterable[StudyPoint], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow([
            "h_nm",
            "fdm_cells_x",
            "fem_divisions_x",
            "fem_nodes",
            "fem_elements",
            "fdm_mean_abs_hex_a_per_m",
            "fem_mean_abs_hex_a_per_m",
            "relative_mean_gap",
        ])
        for row in results:
            writer.writerow([
                row.h_nm,
                row.fdm_cells_x,
                row.fem_divisions_x,
                row.fem_nodes,
                row.fem_elements,
                f"{row.fdm_mean_abs_hex:.16e}",
                f"{row.fem_mean_abs_hex:.16e}",
                f"{row.relative_mean_gap:.16e}",
            ])


def build_path(points: list[tuple[float, float]]) -> str:
    return " ".join(
        (f"M {x:.2f} {y:.2f}" if index == 0 else f"L {x:.2f} {y:.2f}")
        for index, (x, y) in enumerate(points)
    )


def write_svg(results: list[StudyPoint], path: Path) -> None:
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

    x_values = [row.h_nm for row in results]
    x_min = min(x_values)
    x_max = max(x_values)
    log_min = math.log10(x_min)
    log_max = math.log10(x_max)

    def map_x(h_nm: float) -> float:
        t = (math.log10(h_nm) - log_min) / max(log_max - log_min, 1e-30)
        return left + t * chart_width

    field_values = [row.fdm_mean_abs_hex for row in results] + [row.fem_mean_abs_hex for row in results]
    field_min = min(field_values)
    field_max = max(field_values)
    field_pad = 0.08 * (field_max - field_min)
    field_min -= field_pad
    field_max += field_pad

    gap_values = [row.relative_mean_gap for row in results]
    gap_min = 0.0
    gap_max = max(gap_values)
    gap_max += 0.1 * max(gap_max, 1e-30)

    def map_y(value: float, vmin: float, vmax: float, bottom: float) -> float:
        return bottom - ((value - vmin) / max(vmax - vmin, 1e-30)) * chart_height

    fdm_points = [(map_x(row.h_nm), map_y(row.fdm_mean_abs_hex, field_min, field_max, upper_bottom)) for row in results]
    fem_points = [(map_x(row.h_nm), map_y(row.fem_mean_abs_hex, field_min, field_max, upper_bottom)) for row in results]
    gap_points = [(map_x(row.h_nm), map_y(row.relative_mean_gap, gap_min, gap_max, lower_bottom)) for row in results]

    svg: list[str] = []
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">')
    svg.append('<rect width="100%" height="100%" fill="#07101c"/>')
    svg.append('<style>text{font-family:IBM Plex Sans,Segoe UI,sans-serif;fill:#d9e6ff}.muted{fill:#8ea3c5}.axis{stroke:#50627f;stroke-width:1}.grid{stroke:#203047;stroke-width:1;stroke-dasharray:4 6}.fdm{stroke:#57c8b6;fill:none;stroke-width:3}.fem{stroke:#6ba7ff;fill:none;stroke-width:3}.gap{stroke:#ffb86c;fill:none;stroke-width:3}</style>')
    svg.append('<text x="100" y="40" font-size="26" font-weight="700">Py thin-film exchange-field resolution study</text>')
    svg.append('<text x="100" y="64" class="muted" font-size="14">1 µm × 1 µm × 10 nm Py layer, in-plane smooth texture, mean |H_ex| compared between FDM and FEM.</text>')

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
        svg.append(f'<text x="{x:.2f}" y="{lower_bottom + 40:.2f}" text-anchor="middle" class="muted" font-size="11">FDM {row.fdm_cells_x} · FEM {row.fem_elements} tets</text>')

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

    svg.append(f'<path d="{build_path(fdm_points)}" class="fdm"/>')
    svg.append(f'<path d="{build_path(fem_points)}" class="fem"/>')
    svg.append(f'<path d="{build_path(gap_points)}" class="gap"/>')

    legend_y = height - 56.0
    svg.append(f'<line x1="100" y1="{legend_y:.2f}" x2="132" y2="{legend_y:.2f}" class="fdm"/>')
    svg.append(f'<text x="142" y="{legend_y + 4:.2f}" font-size="12">FDM mean |H_ex|</text>')
    svg.append(f'<line x1="330" y1="{legend_y:.2f}" x2="362" y2="{legend_y:.2f}" class="fem"/>')
    svg.append(f'<text x="372" y="{legend_y + 4:.2f}" font-size="12">FEM mean |H_ex|</text>')
    svg.append(f'<line x1="560" y1="{legend_y:.2f}" x2="592" y2="{legend_y:.2f}" class="gap"/>')
    svg.append(f'<text x="602" y="{legend_y + 4:.2f}" font-size="12">Relative FDM/FEM gap</text>')
    svg.append('</svg>')
    path.write_text("\n".join(svg), encoding="utf-8")


def main() -> None:
    results = run_study()
    repo_root = Path(__file__).resolve().parents[2]
    root = repo_root / '.fullmag' / 'studies'
    csv_path = root / 'thinfilm_exchange_field_resolution.csv'
    svg_path = root / 'thinfilm_exchange_field_resolution.svg'
    write_csv(results, csv_path)
    write_svg(results, svg_path)

    print('thin-film exchange study written:')
    print(f'- {csv_path}')
    print(f'- {svg_path}')
    for row in results:
        print(
            f'h={row.h_nm:.0f} nm | '
            f'FDM mean|Hex|={row.fdm_mean_abs_hex:.6e} A/m | '
            f'FEM mean|Hex|={row.fem_mean_abs_hex:.6e} A/m | '
            f'gap={row.relative_mean_gap:.4f}'
        )


if __name__ == '__main__':
    main()
