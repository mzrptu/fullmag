from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fullmag._validation import as_vector3


@dataclass(frozen=True, slots=True)
class UniformMagnetization:
    value: tuple[float, float, float]

    def __init__(self, value: Sequence[float]) -> None:
        object.__setattr__(self, "value", as_vector3(value, "value"))

    def to_ir(self) -> dict[str, object]:
        return {"kind": "uniform", "value": list(self.value)}


def uniform(value: Sequence[float]) -> UniformMagnetization:
    return UniformMagnetization(value)
