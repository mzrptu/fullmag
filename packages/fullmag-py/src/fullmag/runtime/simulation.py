from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from fullmag._core import run_problem_json
from fullmag.init import save_magnetization
from fullmag.model import BackendTarget, ExecutionMode, ExecutionPrecision, Problem


@dataclass(frozen=True, slots=True)
class StepStats:
    """Stats for a single time step from the runner."""

    step: int
    time: float
    dt: float
    e_ex: float
    e_demag: float
    e_ext: float
    e_total: float
    max_dm_dt: float
    max_h_eff: float
    wall_time_ns: int


@dataclass(frozen=True, slots=True)
class Result:
    status: str
    backend: BackendTarget
    mode: ExecutionMode
    precision: ExecutionPrecision
    notes: Sequence[str] = ()
    steps: Sequence[StepStats] = ()
    final_magnetization: list[list[float]] | None = None
    output_dir: str | None = None

    def save_state(
        self,
        path: str | Path,
        *,
        format: str = "auto",
        dataset: str = "values",
    ) -> Path:
        if self.final_magnetization is None:
            raise ValueError("result does not contain final_magnetization")
        return save_magnetization(
            path,
            self.final_magnetization,
            format=format,
            dataset=dataset,
        )


@dataclass(slots=True)
class Simulation:
    problem: Problem
    backend: BackendTarget | str | None = None
    mode: ExecutionMode | str | None = None
    precision: ExecutionPrecision | str | None = None

    def __post_init__(self) -> None:
        runtime = self.problem.runtime
        self.backend = runtime.backend_target if self.backend is None else BackendTarget(self.backend)
        self.mode = runtime.execution_mode if self.mode is None else ExecutionMode(self.mode)
        self.precision = (
            runtime.execution_precision
            if self.precision is None
            else ExecutionPrecision(self.precision)
        )
        if self.backend is BackendTarget.HYBRID and self.mode is not ExecutionMode.HYBRID:
            raise ValueError("backend='hybrid' requires mode='hybrid'")
        if self.mode is ExecutionMode.HYBRID and self.backend is not BackendTarget.HYBRID:
            raise ValueError("mode='hybrid' requires backend='hybrid'")

    def to_ir(self, *, script_source: str | None = None, entrypoint_kind: str = "direct") -> dict[str, object]:
        return self.problem.to_ir(
            requested_backend=self.backend,
            execution_mode=self.mode,
            execution_precision=self.precision,
            script_source=script_source,
            entrypoint_kind=entrypoint_kind,
        )

    def plan(self) -> Result:
        return Result(
            status="planned",
            backend=self.backend,
            mode=self.mode,
            precision=self.precision,
            notes=[
                "Public script lowering is still planning-only.",
                "Use Simulation.run(until=...) to execute on the reference FDM engine.",
            ],
        )

    def run(self, *, until: float | None = None, output_dir: str | None = None) -> Result:
        """Run the simulation through the reference engine.

        For Phase 1, the executable FDM subset supports Box + LLG with
        Exchange / Demag / Zeeman combinations on the CPU reference path.
        Everything else returns an honest error message.

        Args:
            until: Simulation stop time in seconds. Required for execution.
            output_dir: Directory for artifact output. Defaults to 'run_output'.
        """
        if until is None:
            return Result(
                status="planned",
                backend=self.backend,
                mode=self.mode,
                precision=self.precision,
                notes=["No stop time provided. Call .run(until=<seconds>) to execute."],
            )

        ir = self.to_ir()

        # Try the native runner
        run_result = run_problem_json(ir, until, output_dir)

        if run_result is None:
            # Native core not available — fall back to planning-only
            return Result(
                status="not-executable",
                backend=self.backend,
                mode=self.mode,
                precision=self.precision,
                notes=[
                    "Native runner (fullmag-py-core) is not installed.",
                    "Install it via 'maturin develop' in crates/fullmag-py-core/ to enable execution.",
                ],
            )

        return result_from_run_payload(
            run_result,
            backend=self.backend,
            mode=self.mode,
            precision=self.precision,
            output_dir=output_dir or "run_output",
        )


def result_from_run_payload(
    run_result: dict[str, Any],
    *,
    backend: BackendTarget,
    mode: ExecutionMode,
    precision: ExecutionPrecision,
    output_dir: str | None,
) -> Result:
    """Convert a native runner payload into a public runtime Result."""
    step_stats = [
        StepStats(
            step=s["step"],
            time=s["time"],
            dt=s["dt"],
            e_ex=s["e_ex"],
            e_demag=s.get("e_demag", 0.0),
            e_ext=s.get("e_ext", 0.0),
            e_total=s.get("e_total", s["e_ex"]),
            max_dm_dt=s["max_dm_dt"],
            max_h_eff=s["max_h_eff"],
            wall_time_ns=s["wall_time_ns"],
        )
        for s in run_result.get("steps", [])
    ]

    return Result(
        status=run_result.get("status", "completed"),
        backend=backend,
        mode=mode,
        precision=precision,
        steps=step_stats,
        final_magnetization=run_result.get("final_magnetization"),
        output_dir=output_dir,
    )
