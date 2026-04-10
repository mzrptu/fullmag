"""Spin-transfer torque (STT) model definitions for Fullmag.

Provides ergonomic wrappers for configuring Zhang–Li and Slonczewski STT
in micromagnetic simulations.  The underlying IR fields are already present
in ``ProblemIR`` — these classes expose them through a clean Python API.

Physics
-------
The LLG equation with STT takes the form::

    dm/dt = −γ μ₀ m × H_eff + α m × dm/dt + τ_STT

Zhang–Li (CIP)
~~~~~~~~~~~~~~
    τ_ZL = −(u · ∇)m + β m × (u · ∇)m

    u = J P g μ_B / (2 e M_s)

Slonczewski (CPP, MTJ)
~~~~~~~~~~~~~~~~~~~~~~~
    τ_Slonc = σ(J, P, Λ, ...) m × (m × p) + σ'(J, ε', ...) m × p

Parameters map to ``ProblemIR`` fields:
    current_density      → current_density   [A/m²]
    degree               → stt_degree        (P, dimensionless)
    beta                 → stt_beta          (β, non-adiabaticity)
    spin_polarization    → stt_spin_polarization  (p̂, unit vector)
    lambda_asymmetry     → stt_lambda        (Λ, asymmetry)
    epsilon_prime        → stt_epsilon_prime  (ε', field-like term)

Sign conventions
----------------
- Positive ``current_density`` flows in the +z direction for CPP geometry.
- ``spin_polarization`` is the unit vector of the fixed-layer magnetization.
- ``degree`` (P) is the spin polarization efficiency, 0 < P ≤ 1.
- ``lambda_asymmetry`` (Λ ≥ 1) controls the angular dependence of torque.
- ``epsilon_prime`` is the secondary (field-like) STT coefficient.
- ``beta`` is the non-adiabaticity parameter for Zhang–Li.

See also: ``fullmag/docs/physics/stt_sign_conventions.md``
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fullmag._validation import as_vector3


@dataclass(frozen=True, slots=True)
class SlonczewskiSTT:
    """Slonczewski spin-transfer torque for CPP / MTJ geometry.

    Parameters
    ----------
    current_density : tuple of 3 floats
        Current density vector [A/m²].  For CPP, typically (0, 0, Jz).
    spin_polarization : tuple of 3 floats
        Unit vector of fixed-layer polarization direction.
    degree : float
        Spin polarization efficiency P (0 < P ≤ 1).  Default: 0.4.
    lambda_asymmetry : float
        Slonczewski asymmetry parameter Λ (≥ 1).  Default: 1.0.
    epsilon_prime : float, optional
        Secondary (field-like) spin-transfer coefficient ε'.  Default: 0.0.
    """

    current_density: tuple[float, float, float]
    spin_polarization: tuple[float, float, float]
    degree: float = 0.4
    lambda_asymmetry: float = 1.0
    epsilon_prime: float = 0.0

    def __init__(
        self,
        current_density: Sequence[float],
        spin_polarization: Sequence[float],
        degree: float = 0.4,
        lambda_asymmetry: float = 1.0,
        epsilon_prime: float = 0.0,
    ) -> None:
        object.__setattr__(self, "current_density", as_vector3(current_density, "current_density"))
        object.__setattr__(self, "spin_polarization", as_vector3(spin_polarization, "spin_polarization"))
        if not (0.0 < degree <= 1.0):
            raise ValueError(f"degree (P) must be in (0, 1], got {degree}")
        object.__setattr__(self, "degree", float(degree))
        if lambda_asymmetry < 1.0:
            raise ValueError(f"lambda_asymmetry (Λ) must be >= 1, got {lambda_asymmetry}")
        object.__setattr__(self, "lambda_asymmetry", float(lambda_asymmetry))
        object.__setattr__(self, "epsilon_prime", float(epsilon_prime))

    def to_ir_fields(self) -> dict[str, object]:
        """Return IR-level fields to merge into the top-level ProblemIR dict."""
        return {
            "current_density": list(self.current_density),
            "stt_degree": self.degree,
            "stt_spin_polarization": list(self.spin_polarization),
            "stt_lambda": self.lambda_asymmetry,
            "stt_epsilon_prime": self.epsilon_prime,
        }


@dataclass(frozen=True, slots=True)
class ZhangLiSTT:
    """Zhang–Li spin-transfer torque for CIP geometry.

    Parameters
    ----------
    current_density : tuple of 3 floats
        Current density vector [A/m²].
    degree : float
        Spin polarization efficiency P (0 < P ≤ 1).  Default: 0.4.
    beta : float
        Non-adiabaticity parameter β.  Default: 0.0.
    """

    current_density: tuple[float, float, float]
    degree: float = 0.4
    beta: float = 0.0

    def __init__(
        self,
        current_density: Sequence[float],
        degree: float = 0.4,
        beta: float = 0.0,
    ) -> None:
        object.__setattr__(self, "current_density", as_vector3(current_density, "current_density"))
        if not (0.0 < degree <= 1.0):
            raise ValueError(f"degree (P) must be in (0, 1], got {degree}")
        object.__setattr__(self, "degree", float(degree))
        if beta < 0.0:
            raise ValueError(f"beta must be >= 0, got {beta}")
        object.__setattr__(self, "beta", float(beta))

    def to_ir_fields(self) -> dict[str, object]:
        """Return IR-level fields to merge into the top-level ProblemIR dict."""
        return {
            "current_density": list(self.current_density),
            "stt_degree": self.degree,
            "stt_beta": self.beta,
        }


SpinTorque = SlonczewskiSTT | ZhangLiSTT
"""Union type for any supported STT model."""
