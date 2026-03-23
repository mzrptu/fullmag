from __future__ import annotations

from dataclasses import dataclass

from fullmag._validation import infer_geometry_format, require_non_empty


@dataclass(frozen=True, slots=True)
class ImportedGeometry:
    source: str
    name: str | None = None

    def __post_init__(self) -> None:
        source = require_non_empty(self.source, "source")
        object.__setattr__(self, "source", source)
        if self.name is not None:
            object.__setattr__(self, "name", require_non_empty(self.name, "name"))

    @property
    def geometry_name(self) -> str:
        if self.name is not None:
            return self.name
        return self.source.rsplit("/", 1)[-1].rsplit(".", 1)[0]

    def to_ir(self) -> dict[str, object]:
        return {
            "name": self.geometry_name,
            "kind": "imported_geometry",
            "source": self.source,
            "format": infer_geometry_format(self.source),
        }
