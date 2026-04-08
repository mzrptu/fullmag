from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fullmag._validation import require_non_empty, require_positive

_KNOWN_FIELDS = {"m", "H_demag", "H_eff", "H_ex", "H_ext"}
_KNOWN_SCALARS = {
    "E_ex",
    "E_demag",
    "E_ext",
    "E_total",
    "time",
    "step",
    "solver_dt",
    "mx",
    "my",
    "mz",
    "max_h_eff",
    "max_dm_dt",
}
_COMPONENTS = {"x", "y", "z"}
_SHORT_ALIASES: dict[str, tuple[str, str]] = {
    f"m{component}": ("m", component) for component in _COMPONENTS
}
_SUPPORTED_EIGEN_SPECTRUM_SCOPES = {"global", "per_sample"}


def parse_snapshot_quantity(raw: str) -> tuple[str, str]:
    if raw in _SHORT_ALIASES:
        return _SHORT_ALIASES[raw]
    for suffix in _COMPONENTS:
        if raw.endswith(f"_{suffix}"):
            candidate = raw[: -(len(suffix) + 1)]
            if candidate in _KNOWN_FIELDS:
                return (candidate, suffix)
    if raw in _KNOWN_FIELDS:
        return (raw, "3D")
    return (raw, "3D")


def _normalize_non_negative_unique_indices(
    values: Sequence[int],
    *,
    name: str,
    allow_empty: bool,
) -> tuple[int, ...]:
    normalized = tuple(int(v) for v in values)
    if not allow_empty and not normalized:
        raise ValueError(f"{name} must not be empty")
    if any(v < 0 for v in normalized):
        raise ValueError(f"{name} must contain values >= 0")
    if len(set(normalized)) != len(normalized):
        raise ValueError(f"{name} must not contain duplicates")
    return normalized


def _serialize_sample_selector(
    *,
    sample_indices: Sequence[int],
    sample_labels: Sequence[str],
) -> dict[str, object] | None:
    normalized_indices = _normalize_non_negative_unique_indices(
        sample_indices,
        name="sample_indices",
        allow_empty=True,
    )
    normalized_labels = tuple(
        require_non_empty(label, "sample_labels entry") for label in sample_labels
    )
    if len(set(normalized_labels)) != len(normalized_labels):
        raise ValueError("sample_labels must not contain duplicates")
    if not normalized_indices and not normalized_labels:
        return None
    return {
        "sample_indices": list(normalized_indices),
        "sample_labels": list(normalized_labels),
    }


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
        if self.scalar not in _KNOWN_SCALARS:
            # Deliberately permissive: custom scalars are allowed by design.
            pass

    def to_ir(self) -> dict[str, object]:
        return {"kind": "scalar", "name": self.scalar, "every_seconds": self.every}


@dataclass(frozen=True, slots=True)
class Snapshot:
    field: str
    component: str
    every: float
    layer: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "field", require_non_empty(self.field, "field"))
        require_positive(self.every, "every")
        if self.component not in ("x", "y", "z", "3D"):
            raise ValueError(
                "snapshot component must be 'x', 'y', 'z', or '3D'"
            )
        if self.layer is not None:
            object.__setattr__(self, "layer", require_non_empty(self.layer, "layer"))

    def to_ir(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "kind": "snapshot",
            "field": self.field,
            "component": self.component,
            "every_seconds": self.every,
        }
        if self.layer is not None:
            payload["layer"] = self.layer
        return payload


@dataclass(frozen=True, slots=True)
class SaveSpectrum:
    quantity: str = "eigenfrequency"
    scope: str = "per_sample"

    def __post_init__(self) -> None:
        object.__setattr__(self, "quantity", require_non_empty(self.quantity, "quantity"))
        if self.scope not in _SUPPORTED_EIGEN_SPECTRUM_SCOPES:
            supported = ", ".join(sorted(_SUPPORTED_EIGEN_SPECTRUM_SCOPES))
            raise ValueError(f"scope must be one of: {supported}")

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "eigen_spectrum",
            "quantity": self.quantity,
            "scope": self.scope,
        }


@dataclass(frozen=True, slots=True)
class SaveMode:
    field: str = "mode"
    indices: Sequence[int] = ()
    branches: Sequence[int] = ()
    sample_indices: Sequence[int] = ()
    sample_labels: Sequence[str] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "field", require_non_empty(self.field, "field"))
        normalized_indices = _normalize_non_negative_unique_indices(
            self.indices,
            name="indices",
            allow_empty=True,
        )
        normalized_branches = _normalize_non_negative_unique_indices(
            self.branches,
            name="branches",
            allow_empty=True,
        )
        if not normalized_indices and not normalized_branches:
            raise ValueError(
                "SaveMode requires at least one raw mode index or tracked branch index"
            )
        object.__setattr__(self, "indices", normalized_indices)
        object.__setattr__(self, "branches", normalized_branches)
        object.__setattr__(
            self,
            "sample_indices",
            _normalize_non_negative_unique_indices(
                self.sample_indices,
                name="sample_indices",
                allow_empty=True,
            ),
        )
        object.__setattr__(
            self,
            "sample_labels",
            tuple(
                require_non_empty(label, "sample_labels entry")
                for label in self.sample_labels
            ),
        )

    def to_ir(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "kind": "eigen_mode",
            "field": self.field,
            "indices": list(self.indices),
        }
        if self.branches:
            payload["branches"] = list(self.branches)
        sample_selector = _serialize_sample_selector(
            sample_indices=self.sample_indices,
            sample_labels=self.sample_labels,
        )
        if sample_selector is not None:
            payload["sample_selector"] = sample_selector
        return payload


@dataclass(frozen=True, slots=True)
class SaveDispersion:
    name: str = "dispersion"
    include_branch_table: bool = True

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", require_non_empty(self.name, "name"))

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "dispersion_curve",
            "name": self.name,
            "include_branch_table": self.include_branch_table,
        }


@dataclass(frozen=True, slots=True)
class SaveEigenDiagnostics:
    include_tracking: bool = True
    include_residuals: bool = True
    include_overlaps: bool = True
    include_tangent_leakage: bool = True
    include_orthogonality: bool = True

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "eigen_diagnostics",
            "include_tracking": self.include_tracking,
            "include_residuals": self.include_residuals,
            "include_overlaps": self.include_overlaps,
            "include_tangent_leakage": self.include_tangent_leakage,
            "include_orthogonality": self.include_orthogonality,
        }


__all__ = [
    "SaveField",
    "SaveScalar",
    "Snapshot",
    "SaveSpectrum",
    "SaveMode",
    "SaveDispersion",
    "SaveEigenDiagnostics",
    "parse_snapshot_quantity",
]
