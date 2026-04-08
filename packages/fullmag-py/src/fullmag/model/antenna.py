from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fullmag._validation import (
    as_vector3,
    require_non_empty,
    require_non_negative,
    require_positive,
)
from fullmag.model.energy import Sinusoidal, TimeDependence

# FEM-034 / FEM-035: extensible allow-lists for solver and current_distribution.
# Add new entries here when additional backends or distributions are implemented.
ANTENNA_SOLVERS = {"mqs_2p5d_az"}
CURRENT_DISTRIBUTIONS = {"uniform"}


def _drive_waveform_ir(
    *,
    frequency_hz: float | None,
    phase_rad: float,
    waveform: TimeDependence | None,
) -> dict[str, object] | None:
    if waveform is not None:
        return waveform.to_ir()
    if frequency_hz is None:
        return None
    return Sinusoidal(frequency_hz=frequency_hz, phase_rad=phase_rad).to_ir()


@dataclass(frozen=True, slots=True)
class RfDrive:
    current_a: float
    frequency_hz: float | None = None
    phase_rad: float = 0.0
    waveform: TimeDependence | None = None

    def __post_init__(self) -> None:
        if self.frequency_hz is not None:
            require_positive(self.frequency_hz, "frequency_hz")
        if self.waveform is not None and not hasattr(self.waveform, "to_ir"):
            raise TypeError(
                "waveform must be a Fullmag time-dependence object such as "
                "Sinusoidal(...) or Pulse(...)"
            )

    def to_ir(self) -> dict[str, object]:
        ir = {"current_a": float(self.current_a)}
        waveform_ir = _drive_waveform_ir(
            frequency_hz=self.frequency_hz,
            phase_rad=self.phase_rad,
            waveform=self.waveform,
        )
        if waveform_ir is not None:
            ir["waveform"] = waveform_ir
        return ir


@dataclass(frozen=True, slots=True)
class MicrostripAntenna:
    width: float
    thickness: float
    height_above_magnet: float
    preview_length: float
    center_x: float = 0.0
    center_y: float = 0.0
    current_distribution: str = "uniform"

    def __post_init__(self) -> None:
        require_positive(self.width, "width")
        require_positive(self.thickness, "thickness")
        require_non_negative(self.height_above_magnet, "height_above_magnet")
        require_positive(self.preview_length, "preview_length")
        object.__setattr__(
            self,
            "current_distribution",
            require_non_empty(self.current_distribution, "current_distribution").lower(),
        )
        if self.current_distribution not in CURRENT_DISTRIBUTIONS:
            raise ValueError(
                f"current_distribution must be one of {sorted(CURRENT_DISTRIBUTIONS)}, "
                f"got {self.current_distribution!r}"
            )

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "microstrip",
            "width": self.width,
            "thickness": self.thickness,
            "height_above_magnet": self.height_above_magnet,
            "preview_length": self.preview_length,
            "center_x": self.center_x,
            "center_y": self.center_y,
            "current_distribution": self.current_distribution,
        }


@dataclass(frozen=True, slots=True)
class CPWAntenna:
    signal_width: float
    gap: float
    ground_width: float
    thickness: float
    height_above_magnet: float
    preview_length: float
    center_x: float = 0.0
    center_y: float = 0.0
    current_distribution: str = "uniform"

    def __post_init__(self) -> None:
        require_positive(self.signal_width, "signal_width")
        require_positive(self.gap, "gap")
        require_positive(self.ground_width, "ground_width")
        require_positive(self.thickness, "thickness")
        require_non_negative(self.height_above_magnet, "height_above_magnet")
        require_positive(self.preview_length, "preview_length")
        object.__setattr__(
            self,
            "current_distribution",
            require_non_empty(self.current_distribution, "current_distribution").lower(),
        )
        if self.current_distribution not in CURRENT_DISTRIBUTIONS:
            raise ValueError(
                f"current_distribution must be one of {sorted(CURRENT_DISTRIBUTIONS)}, "
                f"got {self.current_distribution!r}"
            )

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "cpw",
            "signal_width": self.signal_width,
            "gap": self.gap,
            "ground_width": self.ground_width,
            "thickness": self.thickness,
            "height_above_magnet": self.height_above_magnet,
            "preview_length": self.preview_length,
            "center_x": self.center_x,
            "center_y": self.center_y,
            "current_distribution": self.current_distribution,
        }


Antenna = MicrostripAntenna | CPWAntenna


@dataclass(frozen=True, slots=True)
class AntennaFieldSource:
    name: str
    antenna: Antenna
    drive: RfDrive
    solver: str = "mqs_2p5d_az"
    air_box_factor: float = 12.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", require_non_empty(self.name, "name"))
        object.__setattr__(self, "solver", require_non_empty(self.solver, "solver").lower())
        require_positive(self.air_box_factor, "air_box_factor")
        if self.solver not in ANTENNA_SOLVERS:
            raise ValueError(
                f"solver must be one of {sorted(ANTENNA_SOLVERS)}, got {self.solver!r}"
            )

    def to_ir(self) -> dict[str, object]:
        return {
            "kind": "antenna_field_source",
            "name": self.name,
            "solver": self.solver,
            "antenna": self.antenna.to_ir(),
            "drive": self.drive.to_ir(),
            "air_box_factor": self.air_box_factor,
        }


@dataclass(frozen=True, slots=True)
class SpinWaveExcitationAnalysis:
    source: str
    method: str = "source_k_profile"
    propagation_axis: tuple[float, float, float] = (1.0, 0.0, 0.0)
    k_max_rad_per_m: float | None = None
    samples: int = 256

    def __post_init__(self) -> None:
        object.__setattr__(self, "source", require_non_empty(self.source, "source"))
        object.__setattr__(self, "method", require_non_empty(self.method, "method").lower())
        object.__setattr__(
            self, "propagation_axis", as_vector3(self.propagation_axis, "propagation_axis")
        )
        if self.method not in {"source_k_profile"}:
            raise ValueError("method must currently be 'source_k_profile'")
        if self.k_max_rad_per_m is not None:
            require_positive(self.k_max_rad_per_m, "k_max_rad_per_m")
        if self.samples <= 1:
            raise ValueError("samples must be greater than 1")

    def to_ir(self) -> dict[str, object]:
        ir = {
            "source": self.source,
            "method": self.method,
            "propagation_axis": list(self.propagation_axis),
            "samples": int(self.samples),
        }
        if self.k_max_rad_per_m is not None:
            ir["k_max_rad_per_m"] = self.k_max_rad_per_m
        return ir
