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
    realization: str | None = None

    def __post_init__(self) -> None:
        allowed = (
            None,
            "auto",
            "transfer_grid",
            "poisson_airbox",
            "airbox_dirichlet",
            "airbox_robin",
        )
        if self.realization not in allowed:
            raise ValueError(
                f"Demag realization must be one of {allowed!r}, got {self.realization!r}"
            )

    def to_ir(self) -> dict[str, object]:
        ir: dict[str, object] = {"kind": "demag"}
        if self.realization is not None:
            ir["realization"] = self.realization
        return ir


@dataclass(frozen=True, slots=True)
class InterfacialDMI:
    D: float

    def __post_init__(self) -> None:
        require_positive(self.D, "D")

    def to_ir(self) -> dict[str, object]:
        return {"kind": "interfacial_dmi", "D": self.D}


@dataclass(frozen=True, slots=True)
class BulkDMI:
    D: float

    def __post_init__(self) -> None:
        require_positive(self.D, "D")

    def to_ir(self) -> dict[str, object]:
        return {"kind": "bulk_dmi", "D": self.D}


@dataclass(frozen=True, slots=True)
class Zeeman:
    B: tuple[float, float, float]

    def __init__(self, B: Sequence[float]) -> None:
        object.__setattr__(self, "B", as_vector3(B, "B"))

    def to_ir(self) -> dict[str, object]:
        return {"kind": "zeeman", "B": list(self.B)}


# ── Time dependence envelopes for Oersted field current ──


@dataclass(frozen=True, slots=True)
class Constant:
    """Constant time dependence (default)."""

    def to_ir(self) -> dict[str, object]:
        return {"kind": "constant"}


@dataclass(frozen=True, slots=True)
class Sinusoidal:
    """Sinusoidal time dependence: I(t) = I_dc * (sin(2π·freq·t + phase) + offset)."""

    frequency_hz: float
    phase_rad: float = 0.0
    offset: float = 0.0

    def __post_init__(self) -> None:
        require_positive(self.frequency_hz, "frequency_hz")

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "sinusoidal",
            "frequency_hz": self.frequency_hz,
            "phase_rad": self.phase_rad,
            "offset": self.offset,
        }


@dataclass(frozen=True, slots=True)
class Pulse:
    """Rectangular pulse: I(t) = I_dc for t_on ≤ t < t_off, else 0."""

    t_on: float
    t_off: float

    def __post_init__(self) -> None:
        if self.t_off <= self.t_on:
            raise ValueError("t_off must be greater than t_on")

    def to_ir(self) -> dict[str, object]:
        return {"kind": "pulse", "t_on": self.t_on, "t_off": self.t_off}


TimeDependence = Constant | Sinusoidal | Pulse


@dataclass(frozen=True, slots=True)
class OerstedCylinder:
    """Oersted field from a cylindrical conductor (STNO / MTJ pillar).

    The field profile H_oe(x,y,z) is computed analytically using Ampère's
    law for an infinite cylinder and precomputed once on the GPU.  At each
    integration step the field is scaled by ``current * time_dependence(t)``.

    Parameters
    ----------
    current : float
        DC current amplitude in Amperes.  Sign determines chirality.
    radius : float
        Cylinder radius in metres.
    center : sequence of 3 floats, optional
        Cross-section centre [m].  Default: (0, 0, 0).
    axis : sequence of 3 floats, optional
        Current-flow axis (unit vector).  Default: (0, 0, 1) = +z.
    time_dependence : TimeDependence, optional
        Time-varying envelope.  Default: constant.
    """

    current: float
    radius: float
    center: tuple[float, float, float] = (0.0, 0.0, 0.0)
    axis: tuple[float, float, float] = (0.0, 0.0, 1.0)
    time_dependence: TimeDependence | None = None

    def __init__(
        self,
        current: float,
        radius: float,
        center: Sequence[float] = (0.0, 0.0, 0.0),
        axis: Sequence[float] = (0.0, 0.0, 1.0),
        time_dependence: TimeDependence | None = None,
    ) -> None:
        require_positive(radius, "radius")
        object.__setattr__(self, "current", float(current))
        object.__setattr__(self, "radius", float(radius))
        object.__setattr__(self, "center", as_vector3(center, "center"))
        object.__setattr__(self, "axis", as_vector3(axis, "axis"))
        object.__setattr__(self, "time_dependence", time_dependence)

    def to_ir(self) -> dict[str, object]:
        ir: dict[str, object] = {
            "kind": "oersted_cylinder",
            "current": self.current,
            "radius": self.radius,
            "center": list(self.center),
            "axis": list(self.axis),
        }
        if self.time_dependence is not None:
            ir["time_dependence"] = self.time_dependence.to_ir()
        return ir


@dataclass(frozen=True, slots=True)
class Magnetoelastic:
    """Magnetoelastic coupling energy between a magnet and an elastic body.

    Parameters
    ----------
    magnet : str
        Name of the ``Ferromagnet``.
    body : str
        Name of the ``ElasticBody``.
    law : str
        Name of the ``MagnetostrictionLaw``.
    """

    magnet: str
    body: str
    law: str

    def __post_init__(self) -> None:
        from fullmag._validation import require_non_empty

        object.__setattr__(self, "magnet", require_non_empty(self.magnet, "magnet"))
        object.__setattr__(self, "body", require_non_empty(self.body, "body"))
        object.__setattr__(self, "law", require_non_empty(self.law, "law"))

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "magnetoelastic",
            "magnet": self.magnet,
            "body": self.body,
            "law": self.law,
        }
