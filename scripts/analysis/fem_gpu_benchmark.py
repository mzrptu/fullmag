#!/usr/bin/env python3
"""Run FEM CPU/GPU benchmark sweeps and write a CSV summary."""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BENCHMARK_DIR = REPO_ROOT / "docs" / "reports"
CSV_PATH = BENCHMARK_DIR / "fem_gpu_benchmark_results.csv"
FULLMAG_CPU = REPO_ROOT / ".fullmag" / "local" / "bin" / "fullmag"
FULLMAG_GPU = REPO_ROOT / ".fullmag" / "runtimes" / "fem-gpu-host" / "bin" / "fullmag-fem-gpu"
BENCH_SCRIPT = REPO_ROOT / "examples" / "bench_fem_gpu_long.py"

PRESET_MESHES = {
    "coarse": REPO_ROOT / "examples" / "assets" / "box_40x20x10_coarse.mesh.json",
    "bench": REPO_ROOT / "examples" / "assets" / "bench_box_200x50x10nm.mesh.json",
    "fine": REPO_ROOT / "examples" / "assets" / "bench_box_fine.mesh.json",
    "4985": REPO_ROOT / "examples" / "assets" / "bench_box_fine.mesh.json",
}
DEFAULT_MESHES = ["coarse", "bench", "fine"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FEM CPU/GPU benchmark sweep")
    parser.add_argument(
        "--meshes",
        type=str,
        default=None,
        help="Comma-separated mesh presets or .mesh.json paths",
    )
    parser.add_argument(
        "--sizes",
        type=str,
        default=None,
        help="Legacy alias for --meshes",
    )
    parser.add_argument(
        "--steps",
        type=int,
        default=1000,
        help="Number of LLG steps per run",
    )
    parser.add_argument(
        "--dt",
        type=float,
        default=1e-13,
        help="Fixed timestep in seconds",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=str(CSV_PATH),
        help="Output CSV path",
    )
    return parser.parse_args()


def resolve_mesh_token(token: str) -> Path:
    cleaned = token.strip()
    if not cleaned:
        raise ValueError("empty mesh token")
    if cleaned in PRESET_MESHES:
        return PRESET_MESHES[cleaned]
    candidate = Path(cleaned)
    if not candidate.is_absolute():
        candidate = REPO_ROOT / candidate
    return candidate


def resolve_meshes(meshes_arg: str | None, sizes_arg: str | None) -> list[Path]:
    raw = meshes_arg or sizes_arg
    tokens = DEFAULT_MESHES if raw is None else [part for part in raw.split(",") if part.strip()]
    meshes = [resolve_mesh_token(token) for token in tokens]
    return meshes


def load_mesh_stats(mesh_path: Path) -> dict[str, object]:
    payload = json.loads(mesh_path.read_text(encoding="utf-8"))
    return {
        "mesh_name": payload.get("mesh_name", mesh_path.stem),
        "mesh_path": str(mesh_path),
        "node_count": len(payload.get("nodes", [])),
        "element_count": len(payload.get("elements", [])),
        "boundary_face_count": len(payload.get("boundary_faces", [])),
    }


def parse_benchmark_result(output: str) -> dict[str, object] | None:
    for line in reversed(output.splitlines()):
        if line.startswith("BENCHMARK_RESULT="):
            return json.loads(line.split("=", 1)[1])
    return None


def run_backend(
    *,
    backend_label: str,
    binary: Path,
    mesh_path: Path,
    steps: int,
    dt: float,
    extra_env: dict[str, str],
) -> dict[str, object]:
    row = {
        "backend": backend_label,
        "binary": str(binary),
        "steps": steps,
        "dt_s": dt,
        **load_mesh_stats(mesh_path),
    }
    if not binary.is_file():
        row["status"] = "missing_binary"
        return row

    env = os.environ.copy()
    env.update(extra_env)
    env["FULLMAG_BENCH_MESH"] = str(mesh_path)
    env["FULLMAG_BENCH_STEPS"] = str(steps)
    env["FULLMAG_BENCH_DT"] = repr(dt)

    with tempfile.TemporaryDirectory(prefix=f"fullmag_{backend_label.lower()}_bench_") as run_dir:
        env["FULLMAG_RUN_DIR"] = run_dir
        started = time.perf_counter_ns()
        completed = subprocess.run(
            [str(binary), str(BENCH_SCRIPT), "--headless"],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        wall_time_ms = (time.perf_counter_ns() - started) / 1_000_000.0

    combined_output = "\n".join(
        part for part in [completed.stdout, completed.stderr] if part.strip()
    )
    payload = parse_benchmark_result(combined_output)

    row.update(
        {
            "status": "ok" if completed.returncode == 0 and payload is not None else "failed",
            "returncode": completed.returncode,
            "wall_time_ms": round(wall_time_ms, 3),
            "stdout_lines": len(completed.stdout.splitlines()),
            "stderr_lines": len(completed.stderr.splitlines()),
        }
    )
    if payload is not None:
        row.update(
            {
                "executed_steps": payload.get("executed_steps"),
                "final_time_s": payload.get("final_time_s"),
                "final_e_total_j": payload.get("final_e_total_j"),
                "final_e_ex_j": payload.get("final_e_ex_j"),
                "final_e_demag_j": payload.get("final_e_demag_j"),
                "step_wall_time_ms": ns_to_ms(payload.get("wall_time_ns")),
                "exchange_wall_time_ms": ns_to_ms(payload.get("exchange_wall_time_ns")),
                "demag_wall_time_ms": ns_to_ms(payload.get("demag_wall_time_ns")),
                "rhs_wall_time_ms": ns_to_ms(payload.get("rhs_wall_time_ns")),
                "extra_energy_wall_time_ms": ns_to_ms(
                    payload.get("extra_energy_wall_time_ns")
                ),
                "snapshot_wall_time_ms": ns_to_ms(payload.get("snapshot_wall_time_ns")),
                "rhs_evals": payload.get("rhs_evals"),
                "demag_solves": payload.get("demag_solves"),
                "rejected_attempts": payload.get("rejected_attempts"),
                "fsal_reused": payload.get("fsal_reused"),
                "max_dm_dt": payload.get("max_dm_dt"),
                "max_h_eff": payload.get("max_h_eff"),
                "max_h_demag": payload.get("max_h_demag"),
                "e_ani": payload.get("e_ani"),
                "e_dmi": payload.get("e_dmi"),
            }
        )
    else:
        row["error"] = "missing BENCHMARK_RESULT payload"

    if completed.returncode != 0:
        row["error"] = truncate_error(combined_output)

    return row


def ns_to_ms(value: object) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value) / 1_000_000.0, 6)
    except (TypeError, ValueError):
        return None


def truncate_error(output: str, limit: int = 400) -> str:
    compact = " | ".join(line.strip() for line in output.splitlines() if line.strip())
    return compact[:limit]


def write_csv(results: list[dict[str, object]], output_path: str) -> None:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    if not results:
        return
    fieldnames: list[str] = []
    seen: set[str] = set()
    for row in results:
        for key in row:
            if key not in seen:
                seen.add(key)
                fieldnames.append(key)
    with open(output_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in results:
            writer.writerow(row)
    print(f"Results written to {output_path}")


def main() -> None:
    args = parse_args()
    meshes = resolve_meshes(args.meshes, args.sizes)
    results: list[dict[str, object]] = []

    print(
        f"FEM benchmark sweep: meshes={len(meshes)} steps={args.steps} dt={args.dt:.3e} s"
    )
    for mesh_path in meshes:
        mesh_stats = load_mesh_stats(mesh_path)
        print(
            f"  mesh={mesh_stats['mesh_name']} nodes={mesh_stats['node_count']} elements={mesh_stats['element_count']}"
        )
        results.append(
            run_backend(
                backend_label="fem_cpu",
                binary=FULLMAG_CPU,
                mesh_path=mesh_path,
                steps=args.steps,
                dt=args.dt,
                extra_env={"FULLMAG_FEM_EXECUTION": "cpu"},
            )
        )
        results.append(
            run_backend(
                backend_label="fem_gpu",
                binary=FULLMAG_GPU,
                mesh_path=mesh_path,
                steps=args.steps,
                dt=args.dt,
                extra_env={"FULLMAG_FEM_GPU_INDEX": "0"},
            )
        )

    write_csv(results, args.output)


if __name__ == "__main__":
    main()
