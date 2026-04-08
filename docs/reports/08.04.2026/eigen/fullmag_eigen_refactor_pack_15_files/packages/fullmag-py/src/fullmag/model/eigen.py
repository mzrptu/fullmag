from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from fullmag._validation import require_non_empty, require_positive

KVector = tuple[float, float, float]

SUPPORTED_TRACKING_METHODS = {
    "overlap_greedy",
    "overlap_hungarian",
}


def _normalize_vec3(value: Sequence[float], name: str) -> KVector:
    if len(value) != 3:
        raise ValueError(f"{name} must have exactly three components")
    return (float(value[0]), float(value[1]), float(value[2]))


def _tuple_of_positive_ints(values: Sequence[int], name: str) -> tuple[int, ...]:
    normalized = tuple(int(v) for v in values)
    if not normalized:
        raise ValueError(f"{name} must not be empty")
    if any(v <= 0 for v in normalized):
        raise ValueError(f"{name} must contain positive integers only")
    return normalized


@dataclass(frozen=True, slots=True)
class KPoint:
    label: str | None
    k: KVector

    def __post_init__(self) -> None:
        if self.label is not None:
            object.__setattr__(self, "label", require_non_empty(self.label, "label"))
        object.__setattr__(self, "k", _normalize_vec3(self.k, "k"))

    def to_ir(self) -> dict[str, object]:
        return {
            "label": self.label,
            "k_vector": list(self.k),
        }


@dataclass(frozen=True, slots=True)
class KPath:
    points: Sequence[KPoint]
    samples_per_segment: Sequence[int]
    closed: bool = False

    def __post_init__(self) -> None:
        normalized_points = tuple(self.points)
        if len(normalized_points) < 2:
            raise ValueError("KPath requires at least two points")
        object.__setattr__(self, "points", normalized_points)

        normalized_samples = _tuple_of_positive_ints(
            self.samples_per_segment,
            "samples_per_segment",
        )
        expected_segments = len(normalized_points) if self.closed else len(normalized_points) - 1
        if len(normalized_samples) != expected_segments:
            raise ValueError(
                "samples_per_segment must have length equal to the number of path segments "
                f"({expected_segments})"
            )
        object.__setattr__(self, "samples_per_segment", normalized_samples)

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "path",
            "points": [point.to_ir() for point in self.points],
            "samples_per_segment": list(self.samples_per_segment),
            "closed": self.closed,
        }


@dataclass(frozen=True, slots=True)
class ModeTracking:
    method: str = "overlap_hungarian"
    frequency_window_hz: float | None = None
    overlap_floor: float = 0.50
    max_branch_gap: int = 1

    def __post_init__(self) -> None:
        if self.method not in SUPPORTED_TRACKING_METHODS:
            supported = ", ".join(sorted(SUPPORTED_TRACKING_METHODS))
            raise ValueError(f"method must be one of: {supported}")
        if self.frequency_window_hz is not None:
            require_positive(self.frequency_window_hz, "frequency_window_hz")
        require_positive(self.overlap_floor, "overlap_floor")
        if not (0.0 <= self.overlap_floor <= 1.0):
            raise ValueError("overlap_floor must be in the interval [0, 1]")
        if self.max_branch_gap < 0:
            raise ValueError("max_branch_gap must be >= 0")

    def to_ir(self) -> dict[str, object]:
        return {
            "method": self.method,
            "frequency_window_hz": self.frequency_window_hz,
            "overlap_floor": self.overlap_floor,
            "max_branch_gap": self.max_branch_gap,
        }


def serialize_k_sampling(value: object | None) -> dict[str, object] | None:
    if value is None:
        return None
    if isinstance(value, KPath):
        return value.to_ir()
    if isinstance(value, KPoint):
        return {
            "kind": "single",
            "k_vector": list(value.k),
        }
    if isinstance(value, tuple | list):
        k = _normalize_vec3(value, "k_sampling")
        return {
            "kind": "single",
            "k_vector": list(k),
        }
    raise ValueError(
        "k_sampling must be None, a 3-vector, KPoint, or KPath"
    )


def coerce_k_sampling(
    *,
    k_sampling: object | None,
    legacy_k_vector: Sequence[float] | None,
) -> dict[str, object] | None:
    if k_sampling is not None and legacy_k_vector is not None:
        raise ValueError("use either k_sampling or k_vector, not both")
    if k_sampling is not None:
        return serialize_k_sampling(k_sampling)
    if legacy_k_vector is not None:
        return serialize_k_sampling(tuple(float(v) for v in legacy_k_vector))
    return None


def is_zero_k_vector(value: Sequence[float] | None) -> bool:
    if value is None:
        return True
    vec = _normalize_vec3(value, "value")
    return all(component == 0.0 for component in vec)


__all__ = [
    "KVector",
    "KPoint",
    "KPath",
    "ModeTracking",
    "coerce_k_sampling",
    "is_zero_k_vector",
    "serialize_k_sampling",
]
