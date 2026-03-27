from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from fullmag._progress import emit_progress
from fullmag.model import BackendTarget, ExecutionMode, ExecutionPrecision
from fullmag.runtime.loader import load_problem_from_script


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m fullmag.runtime.helper",
        description="Internal helper for Rust-hosted Fullmag script execution.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    check_syntax = subparsers.add_parser(
        "check-syntax",
        help="Validate that a Python script is syntactically correct without executing it.",
    )
    check_syntax.add_argument("--script", required=True, help="Path to Python script.")

    export_ir = subparsers.add_parser("export-ir", help="Load a Python script and print canonical ProblemIR.")
    export_ir.add_argument("--script", required=True, help="Path to Python script.")
    export_ir.add_argument(
        "--backend",
        choices=[target.value for target in BackendTarget],
    )
    export_ir.add_argument(
        "--mode",
        choices=[mode.value for mode in ExecutionMode],
    )
    export_ir.add_argument(
        "--precision",
        choices=[precision.value for precision in ExecutionPrecision],
    )

    export_run_config = subparsers.add_parser(
        "export-run-config",
        help="Load a Python script and print canonical ProblemIR plus script-owned run defaults.",
    )
    export_run_config.add_argument("--script", required=True, help="Path to Python script.")
    export_run_config.add_argument(
        "--backend",
        choices=[target.value for target in BackendTarget],
    )
    export_run_config.add_argument(
        "--mode",
        choices=[mode.value for mode in ExecutionMode],
    )
    export_run_config.add_argument(
        "--precision",
        choices=[precision.value for precision in ExecutionPrecision],
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.command == "check-syntax":
        script_path = Path(args.script)
        source = script_path.read_text(encoding="utf-8")
        compile(source, str(script_path), "exec")
        print(json.dumps({"status": "ok", "script": str(script_path.resolve())}))
        return 0

    if args.command in {"export-ir", "export-run-config"}:
        emit_progress(f"Loading Python script {Path(args.script).name}")
        loaded = load_problem_from_script(Path(args.script))
        asset_cache = loaded.problem.geometry_asset_cache
        requested_backend = BackendTarget(args.backend) if args.backend is not None else None
        execution_mode = ExecutionMode(args.mode) if args.mode is not None else None
        execution_precision = (
            ExecutionPrecision(args.precision) if args.precision is not None else None
        )
        emit_progress("Building ProblemIR and realizing geometry assets")
        ir = loaded.to_ir(
            requested_backend=requested_backend,
            execution_mode=execution_mode,
            execution_precision=execution_precision,
            asset_cache=asset_cache,
        )
        if args.command == "export-ir":
            print(json.dumps(ir))
            return 0

        print(
            json.dumps(
                {
                    "ir": ir,
                    "default_until_seconds": loaded.default_until_seconds,
                    "stages": [
                        {
                            "ir": stage.to_ir(
                            requested_backend=requested_backend,
                            execution_mode=execution_mode,
                            execution_precision=execution_precision,
                            script_source=loaded.script_source,
                            source_root=loaded.source_path.parent,
                            asset_cache=asset_cache,
                        ),
                            "default_until_seconds": stage.default_until_seconds,
                            "entrypoint_kind": stage.entrypoint_kind,
                        }
                        for stage in (loaded.stages or ())
                    ],
                }
            )
        )
        emit_progress("Run configuration exported")
        return 0

    parser.error(f"Unsupported helper command: {args.command}")
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
