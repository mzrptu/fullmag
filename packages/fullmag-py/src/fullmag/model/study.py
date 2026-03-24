from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from fullmag.model.dynamics import LLG
from fullmag.model.outputs import SaveField, SaveScalar
from fullmag._validation import require_positive

OutputSpec = SaveField | SaveScalar
SUPPORTED_RELAXATION_ALGORITHMS = {
    "llg_overdamped",
    "projected_gradient_bb",
    "nonlinear_cg",
    "tangent_plane_implicit",
}


@dataclass(frozen=True, slots=True)
class TimeEvolution:
    dynamics: LLG
    outputs: Sequence[OutputSpec]

    def __post_init__(self) -> None:
        if not self.outputs:
            raise ValueError("TimeEvolution requires at least one output")

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "time_evolution",
            "dynamics": self.dynamics.to_ir(),
            "sampling": {"outputs": [output.to_ir() for output in self.outputs]},
        }


@dataclass(frozen=True, slots=True)
class Relaxation:
    outputs: Sequence[OutputSpec]
    algorithm: str = "llg_overdamped"
    torque_tolerance: float = 1e-4
    energy_tolerance: float | None = None
    max_steps: int = 50_000
    dynamics: LLG = field(default_factory=LLG)

    def __post_init__(self) -> None:
        if not self.outputs:
            raise ValueError("Relaxation requires at least one output")
        if self.algorithm not in SUPPORTED_RELAXATION_ALGORITHMS:
            supported = ", ".join(sorted(SUPPORTED_RELAXATION_ALGORITHMS))
            raise ValueError(f"algorithm must be one of: {supported}")
        require_positive(self.torque_tolerance, "torque_tolerance")
        if self.energy_tolerance is not None:
            require_positive(self.energy_tolerance, "energy_tolerance")
        if self.max_steps <= 0:
            raise ValueError("max_steps must be positive")

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "relaxation",
            "algorithm": self.algorithm,
            "dynamics": self.dynamics.to_ir(),
            "torque_tolerance": self.torque_tolerance,
            "energy_tolerance": self.energy_tolerance,
            "max_steps": self.max_steps,
            "sampling": {"outputs": [output.to_ir() for output in self.outputs]},
        }
