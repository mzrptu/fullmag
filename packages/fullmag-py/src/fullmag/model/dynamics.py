from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class LLG:
    """Landau-Lifshitz-Gilbert dynamics placeholder for the bootstrap API."""

    def to_ir(self) -> dict[str, object]:
        return {"kind": "llg"}
