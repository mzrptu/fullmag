from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from uuid import uuid4

from fullmag.model import Problem


@dataclass(frozen=True, slots=True)
class LoadedProblem:
    problem: Problem
    source_path: Path
    script_source: str
    entrypoint_kind: str
    default_until_seconds: float | None = None

    def to_ir(
        self,
        *,
        requested_backend,
        execution_mode,
        execution_precision,
    ) -> dict[str, object]:
        return self.problem.to_ir(
            requested_backend=requested_backend,
            execution_mode=execution_mode,
            execution_precision=execution_precision,
            script_source=self.script_source,
            entrypoint_kind=self.entrypoint_kind,
        )


def load_problem_from_script(path: str | Path) -> LoadedProblem:
    import fullmag.world as world

    source_path = Path(path).resolve()
    spec = importlib.util.spec_from_file_location(f"fullmag_user_script_{uuid4().hex}", source_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load script from {source_path}")

    module = importlib.util.module_from_spec(spec)
    world.begin_script_capture()
    try:
        spec.loader.exec_module(module)
        script_source = source_path.read_text(encoding="utf-8")
        captured_problem, captured_entrypoint_kind, captured_default_until = (
            world.finish_script_capture()
        )
        if captured_problem is not None:
            return LoadedProblem(
                problem=captured_problem,
                source_path=source_path,
                script_source=script_source,
                entrypoint_kind=captured_entrypoint_kind or "flat_run",
                default_until_seconds=captured_default_until,
            )

        problem, entrypoint_kind = _extract_problem(module)
        return LoadedProblem(
            problem=problem,
            source_path=source_path,
            script_source=script_source,
            entrypoint_kind=entrypoint_kind,
            default_until_seconds=_extract_default_until(module),
        )
    finally:
        world.finish_script_capture()


def _extract_problem(module: ModuleType) -> tuple[Problem, str]:
    build = getattr(module, "build", None)
    if callable(build):
        problem = build()
        if not isinstance(problem, Problem):
            raise TypeError("build() must return a fullmag.Problem instance")
        return problem, "build"

    problem = getattr(module, "problem", None)
    if isinstance(problem, Problem):
        return problem, "problem"

    raise RuntimeError(
        "Script must define build() -> Problem, a top-level problem, or use flat fm.run()/fm.relax()"
    )


def _extract_default_until(module: ModuleType) -> float | None:
    for attr_name in ("DEFAULT_UNTIL", "default_until"):
        value = getattr(module, attr_name, None)
        if value is None:
            continue
        if not isinstance(value, (int, float)):
            raise TypeError(f"{attr_name} must be a positive number if defined")
        value = float(value)
        if value <= 0.0:
            raise ValueError(f"{attr_name} must be positive if defined")
        return value
    return None
