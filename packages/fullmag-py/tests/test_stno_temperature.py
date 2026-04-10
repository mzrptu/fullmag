"""Tests for temperature / ThermalNoise consistency validation in Problem."""

from __future__ import annotations

import unittest

import fullmag as fm
from fullmag.model.energy import ThermalNoise


def _make_problem(**kwargs) -> fm.Problem:
    """Build a minimal Problem with given overrides."""
    geometry = fm.Box(size=(100e-9, 100e-9, 5e-9), name="layer")
    material = fm.Material(name="Py", Ms=800e3, A=13e-12, alpha=0.01)
    magnet = fm.Ferromagnet(name="layer", geometry=geometry, material=material)
    defaults = dict(
        name="test",
        magnets=[magnet],
        energy=[fm.Exchange(), fm.Demag(), fm.Zeeman(B=(0, 0, 0.1))],
        study=fm.TimeEvolution(
            dynamics=fm.LLG(),
            outputs=[fm.SaveScalar("E_total", every=10e-12)],
        ),
    )
    defaults.update(kwargs)
    return fm.Problem(**defaults)


class TestTemperatureValidation(unittest.TestCase):
    """F01: temperature/ThermalNoise consistency checks."""

    def test_simple_temperature(self) -> None:
        """Problem with temperature but no ThermalNoise is OK."""
        p = _make_problem(temperature=300.0)
        self.assertEqual(p.temperature, 300.0)

    def test_simple_thermal_noise(self) -> None:
        """Problem with ThermalNoise only is OK."""
        base_energy = [fm.Exchange(), fm.Demag(), ThermalNoise(temperature=300.0)]
        p = _make_problem(energy=base_energy)
        self.assertEqual(len([e for e in p.energy if isinstance(e, ThermalNoise)]), 1)

    def test_matching_temperature_ok(self) -> None:
        """If both set and match → OK."""
        base_energy = [fm.Exchange(), fm.Demag(), ThermalNoise(temperature=300.0)]
        p = _make_problem(energy=base_energy, temperature=300.0)
        self.assertEqual(p.temperature, 300.0)

    def test_conflict_temperature_raises(self) -> None:
        """ThermalNoise.temperature != Problem.temperature → ValueError."""
        base_energy = [fm.Exchange(), fm.Demag(), ThermalNoise(temperature=4.2)]
        with self.assertRaises(ValueError) as ctx:
            _make_problem(energy=base_energy, temperature=300.0)
        self.assertIn("conflicts", str(ctx.exception))

    def test_multiple_thermal_noise_raises(self) -> None:
        """More than one ThermalNoise term → ValueError."""
        base_energy = [
            fm.Exchange(),
            fm.Demag(),
            ThermalNoise(temperature=300.0),
            ThermalNoise(temperature=300.0),
        ]
        with self.assertRaises(ValueError) as ctx:
            _make_problem(energy=base_energy)
        self.assertIn("at most one", str(ctx.exception))

    def test_negative_temperature_raises(self) -> None:
        """Negative temperature triggers validation."""
        with self.assertRaises(ValueError):
            _make_problem(temperature=-1.0)


if __name__ == "__main__":
    unittest.main()
