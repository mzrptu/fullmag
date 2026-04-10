"""Tests for spin-torque dataclasses and their IR serialisation."""

from __future__ import annotations

import unittest

from fullmag.model.spin_torque import SlonczewskiSTT, ZhangLiSTT, SpinTorque


class TestSlonczewskiSTT(unittest.TestCase):
    # ── construction ────────────────────────────────────────────
    def test_basic_construction(self) -> None:
        stt = SlonczewskiSTT(
            current_density=[0.0, 0.0, 5e10],
            spin_polarization=[0.0, 0.0, 1.0],
        )
        self.assertEqual(stt.current_density, (0.0, 0.0, 5e10))
        self.assertEqual(stt.spin_polarization, (0.0, 0.0, 1.0))
        self.assertAlmostEqual(stt.degree, 0.4)
        self.assertAlmostEqual(stt.lambda_asymmetry, 1.0)
        self.assertAlmostEqual(stt.epsilon_prime, 0.0)

    def test_custom_parameters(self) -> None:
        stt = SlonczewskiSTT(
            current_density=[1e11, 0, 0],
            spin_polarization=[1, 0, 0],
            degree=0.7,
            lambda_asymmetry=2.0,
            epsilon_prime=0.01,
        )
        self.assertAlmostEqual(stt.degree, 0.7)
        self.assertAlmostEqual(stt.lambda_asymmetry, 2.0)
        self.assertAlmostEqual(stt.epsilon_prime, 0.01)

    def test_is_frozen(self) -> None:
        stt = SlonczewskiSTT([0, 0, 1e10], [0, 0, 1])
        with self.assertRaises(AttributeError):
            stt.degree = 0.5  # type: ignore[misc]

    # ── IR round-trip ───────────────────────────────────────────
    def test_to_ir_fields_keys(self) -> None:
        stt = SlonczewskiSTT([0, 0, 5e10], [0, 0, 1])
        ir = stt.to_ir_fields()
        for key in (
            "current_density",
            "stt_degree",
            "stt_spin_polarization",
            "stt_lambda",
            "stt_epsilon_prime",
        ):
            self.assertIn(key, ir)

    def test_to_ir_values(self) -> None:
        stt = SlonczewskiSTT([0, 0, 5e10], [0, 0, 1], degree=0.6)
        ir = stt.to_ir_fields()
        self.assertEqual(ir["current_density"], [0.0, 0.0, 5e10])
        self.assertEqual(ir["stt_spin_polarization"], [0.0, 0.0, 1.0])
        self.assertAlmostEqual(float(ir["stt_degree"]), 0.6)  # type: ignore[arg-type]


class TestZhangLiSTT(unittest.TestCase):
    def test_basic_construction(self) -> None:
        stt = ZhangLiSTT(current_density=[1e11, 0, 0])
        self.assertEqual(stt.current_density, (1e11, 0.0, 0.0))
        self.assertAlmostEqual(stt.degree, 0.4)
        self.assertAlmostEqual(stt.beta, 0.0)

    def test_to_ir_fields_keys(self) -> None:
        stt = ZhangLiSTT([1e11, 0, 0], beta=0.04)
        ir = stt.to_ir_fields()
        self.assertIn("current_density", ir)
        self.assertIn("stt_degree", ir)
        self.assertIn("stt_beta", ir)
        self.assertAlmostEqual(float(ir["stt_beta"]), 0.04)  # type: ignore[arg-type]

    def test_is_frozen(self) -> None:
        stt = ZhangLiSTT([1e11, 0, 0])
        with self.assertRaises(AttributeError):
            stt.beta = 0.1  # type: ignore[misc]


class TestSpinTorqueUnion(unittest.TestCase):
    def test_isinstance_slonczewski(self) -> None:
        stt: SpinTorque = SlonczewskiSTT([0, 0, 5e10], [0, 0, 1])
        self.assertIsInstance(stt, SlonczewskiSTT)

    def test_isinstance_zhangli(self) -> None:
        stt: SpinTorque = ZhangLiSTT([1e11, 0, 0])
        self.assertIsInstance(stt, ZhangLiSTT)


if __name__ == "__main__":
    unittest.main()
