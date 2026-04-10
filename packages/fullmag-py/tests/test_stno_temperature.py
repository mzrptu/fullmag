"""Tests for temperature / ThermalNoise consistency validation in Problem."""

from __future__ import annotations

import unittest

from fullmag.model.energy import (
    Demag,
    Exchange,
    ThermalNoise,
    Zeeman,
)
from fullmag.model.problem import Problem
from fullmag.model.magnet import Ferromagnet
from fullmag.model.material import MaterialSpec


def _minimal_magnet() -> Ferromagnet:
    """Return a minimal ferromagnet for Problem construction."""
    return Ferromagnet(
        name="layer",
        material=MaterialSpec(
            ms=800e3,
            a_ex=13e-12,
            alpha=0.01,
        ),
        geometry="box:100e-9,100e-9,5e-9",
    )


def _minimal_energy() -> list:
    return [Exchange(), Demag(), Zeeman(direction=[0, 0, 1], magnitude=0.0)]


class TestTemperatureValidation(unittest.TestCase):
    """F01: temperature/ThermalNoise consistency checks."""

    def test_simple_temperature(self) -> None:
        """Problem with temperature but no ThermalNoise is OK."""
        p = Problem(
            name="t_only",
            magnets=[_minimal_magnet()],
            energy=_minimal_energy(),
            temperature=300.0,
        )
        self.assertAlmostEqual(p.temperature, 300.0)

    def test_simple_thermal_noise(self) -> None:
        """Problem with ThermalNoise only is OK."""
        p = Problem(
            name="tn_only",
            magnets=[_minimal_magnet()],
            energy=[*_minimal_energy(), ThermalNoise(temperature=300.0)],
        )
        self.assertEqual(len([e for e in p.energy if isinstance(e, ThermalNoise)]), 1)

    def test_matching_temperature_ok(self) -> None:
        """If both set and match → OK."""
        p = Problem(
            name="match",
            magnets=[_minimal_magnet()],
            energy=[*_minimal_energy(), ThermalNoise(temperature=300.0)],
            temperature=300.0,
        )
        self.assertAlmostEqual(p.temperature, 300.0)

    def test_conflict_temperature_raises(self) -> None:
        """ThermalNoise.temperature != Problem.temperature → ValueError."""
        with self.assertRaises(ValueError) as ctx:
            Problem(
                name="conflict",
                magnets=[_minimal_magnet()],
                energy=[*_minimal_energy(), ThermalNoise(temperature=4.2)],
                temperature=300.0,
            )
        self.assertIn("conflicts", str(ctx.exception))

    def test_multiple_thermal_noise_raises(self) -> None:
        """More than one ThermalNoise term → ValueError."""
        with self.assertRaises(ValueError) as ctx:
            Problem(
                name="double",
                magnets=[_minimal_magnet()],
                energy=[
                    *_minimal_energy(),
                    ThermalNoise(temperature=300.0),
                    ThermalNoise(temperature=300.0),
                ],
            )
        self.assertIn("at most one", str(ctx.exception))

    def test_negative_temperature_raises(self) -> None:
        """Negative temperature triggers validation."""
        with self.assertRaises(ValueError):
            Problem(
                name="neg",
                magnets=[_minimal_magnet()],
                energy=_minimal_energy(),
                temperature=-1.0,
            )


if __name__ == "__main__":
    unittest.main()
