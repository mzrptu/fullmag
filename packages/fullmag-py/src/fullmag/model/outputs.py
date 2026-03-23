from __future__ import annotations

from dataclasses import dataclass

from fullmag._validation import require_non_empty, require_positive


@dataclass(frozen=True, slots=True)
class SaveField:
    field: str
    every: float

    def __post_init__(self) -> None:
        object.__setattr__(self, "field", require_non_empty(self.field, "field"))
        require_positive(self.every, "every")

    def to_ir(self) -> dict[str, object]:
        return {"kind": "field", "name": self.field, "every_seconds": self.every}


@dataclass(frozen=True, slots=True)
class SaveScalar:
    scalar: str
    every: float

    def __post_init__(self) -> None:
        object.__setattr__(self, "scalar", require_non_empty(self.scalar, "scalar"))
        require_positive(self.every, "every")

    def to_ir(self) -> dict[str, object]:
        return {"kind": "scalar", "name": self.scalar, "every_seconds": self.every}
