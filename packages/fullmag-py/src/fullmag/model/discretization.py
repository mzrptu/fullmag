from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fullmag._validation import as_vector3, require_positive


@dataclass(frozen=True, slots=True)
class FDM:
    cell: tuple[float, float, float]

    def __init__(self, cell: Sequence[float]) -> None:
        vector = as_vector3(cell, "cell")
        for index, component in enumerate(vector):
            require_positive(component, f"cell[{index}]")
        object.__setattr__(self, "cell", vector)

    def to_ir(self) -> dict[str, object]:
        return {"cell": list(self.cell)}


@dataclass(frozen=True, slots=True)
class FEM:
    order: int
    hmax: float
    mesh: str | None = None

    def __post_init__(self) -> None:
        if self.order < 1:
            raise ValueError("order must be >= 1")
        require_positive(self.hmax, "hmax")
        if self.mesh is not None and not self.mesh.strip():
            raise ValueError("mesh must not be empty when provided")

    def to_ir(self) -> dict[str, object]:
        return {
            "order": self.order,
            "hmax": self.hmax,
            "mesh": self.mesh,
        }


@dataclass(frozen=True, slots=True)
class Hybrid:
    demag: str

    def __post_init__(self) -> None:
        if not self.demag.strip():
            raise ValueError("demag must not be empty")

    def to_ir(self) -> dict[str, object]:
        return {"demag": self.demag}


@dataclass(frozen=True, slots=True)
class DiscretizationHints:
    fdm: FDM | None = None
    fem: FEM | None = None
    hybrid: Hybrid | None = None

    def to_ir(self) -> dict[str, object]:
        return {
            "fdm": self.fdm.to_ir() if self.fdm else None,
            "fem": self.fem.to_ir() if self.fem else None,
            "hybrid": self.hybrid.to_ir() if self.hybrid else None,
        }
