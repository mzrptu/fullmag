from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fullmag._validation import as_vector3, require_positive


@dataclass(frozen=True, slots=True)
class Exchange:
    def to_ir(self) -> dict[str, object]:
        return {"kind": "exchange"}


@dataclass(frozen=True, slots=True)
class Demag:
    def to_ir(self) -> dict[str, object]:
        return {"kind": "demag"}


@dataclass(frozen=True, slots=True)
class InterfacialDMI:
    D: float

    def __post_init__(self) -> None:
        require_positive(self.D, "D")

    def to_ir(self) -> dict[str, object]:
        return {"kind": "interfacial_dmi", "D": self.D}


@dataclass(frozen=True, slots=True)
class Zeeman:
    B: tuple[float, float, float]

    def __init__(self, B: Sequence[float]) -> None:
        object.__setattr__(self, "B", as_vector3(B, "B"))

    def to_ir(self) -> dict[str, object]:
        return {"kind": "zeeman", "B": list(self.B)}
