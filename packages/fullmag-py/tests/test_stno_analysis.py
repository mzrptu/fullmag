"""Tests for STNO spectral analysis and fitting routines."""

from __future__ import annotations

import unittest

import numpy as np

from fullmag.analysis.spectrum import (
    fft_from_trace,
    peak_frequency,
    psd_from_trace,
)
from fullmag.analysis.fitting import (
    LinewidthFitResult,
    fit_lorentzian_linewidth,
    linewidth_halfmax,
)
from fullmag.analysis.vortex import (
    core_orbit_radius,
    core_phase,
    track_vortex_core,
)
from fullmag.analysis.vortex_fit import (
    CoreTrackResult,
    OrbitMetrics,
    compute_orbit_metrics,
    track_vortex_core_subpixel,
)


# ── helpers ─────────────────────────────────────────────────

def _synthetic_sinusoid(
    f_hz: float = 500e6,
    dt: float = 10e-12,
    t_total: float = 50e-9,
    noise: float = 0.01,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (time, signal) for a pure sinusoid with optional noise."""
    rng = np.random.default_rng(42)
    t = np.arange(0.0, t_total, dt)
    signal = np.sin(2.0 * np.pi * f_hz * t)
    if noise > 0:
        signal += noise * rng.standard_normal(len(t))
    return t, signal


def _lorentzian_psd(
    freqs: np.ndarray,
    f0: float = 500e6,
    gamma: float = 5e6,
    A: float = 1.0,
    B0: float = 0.001,
) -> np.ndarray:
    """Return a synthetic Lorentzian PSD with linear background."""
    return B0 + A / (1.0 + ((freqs - f0) / gamma) ** 2)


def _vortex_mz_frame(
    nx: int = 21,
    ny: int = 21,
    lx: float = 100e-9,
    ly: float = 100e-9,
    core_xy: tuple[float, float] = (10e-9, 5e-9),
    sigma: float = 5e-9,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (mz, x_flat, y_flat) for a Gaussian vortex core profile."""
    x1d = np.linspace(-lx / 2, lx / 2, nx)
    y1d = np.linspace(-ly / 2, ly / 2, ny)
    xx, yy = np.meshgrid(x1d, y1d)
    x_flat = xx.ravel()
    y_flat = yy.ravel()
    r2 = (x_flat - core_xy[0]) ** 2 + (y_flat - core_xy[1]) ** 2
    mz = np.exp(-r2 / (2.0 * sigma ** 2))
    return mz, x_flat, y_flat


# ── PSD tests ───────────────────────────────────────────────

class TestPSD(unittest.TestCase):
    def test_psd_shape(self) -> None:
        t, sig = _synthetic_sinusoid()
        freqs, psd = psd_from_trace(t, sig)
        self.assertEqual(len(freqs), len(psd))
        self.assertTrue(len(freqs) > 0)

    def test_peak_frequency_accuracy(self) -> None:
        f_target = 500e6
        t, sig = _synthetic_sinusoid(f_hz=f_target, noise=0.0)
        freqs, psd = psd_from_trace(t, sig)
        f_peak = peak_frequency(freqs, psd, fmin=100e6, fmax=2e9)
        self.assertAlmostEqual(f_peak, f_target, delta=20e6)

    def test_peak_frequency_with_noise(self) -> None:
        f_target = 800e6
        t, sig = _synthetic_sinusoid(f_hz=f_target, noise=0.05)
        freqs, psd = psd_from_trace(t, sig)
        f_peak = peak_frequency(freqs, psd, fmin=100e6, fmax=2e9)
        self.assertAlmostEqual(f_peak, f_target, delta=50e6)

    def test_fft_from_trace_complex(self) -> None:
        t, sig = _synthetic_sinusoid()
        freqs, spectrum = fft_from_trace(t, sig)
        self.assertTrue(np.iscomplexobj(spectrum))
        self.assertEqual(len(freqs), len(spectrum))

    def test_discard_transient(self) -> None:
        t, sig = _synthetic_sinusoid(t_total=50e-9)
        freqs1, psd1 = psd_from_trace(t, sig, discard_transient=0.0)
        freqs2, psd2 = psd_from_trace(t, sig, discard_transient=10e-9)
        # After discarding more, fewer frequency points
        self.assertLessEqual(len(freqs2), len(freqs1))


# ── Linewidth fitting tests ────────────────────────────────

class TestLinewidthFit(unittest.TestCase):
    def test_lorentzian_fit_on_synthetic(self) -> None:
        """Fit a Lorentzian PSD and verify f0, FWHM recovery."""
        f0 = 500e6
        gamma = 5e6  # FWHM = 10 MHz
        freqs = np.linspace(100e6, 2e9, 10000)
        psd = _lorentzian_psd(freqs, f0=f0, gamma=gamma, A=1.0, B0=0.001)

        result = fit_lorentzian_linewidth(freqs, psd, fmin=100e6, fmax=2e9)

        self.assertIsInstance(result, LinewidthFitResult)
        self.assertAlmostEqual(result.f0_hz, f0, delta=5e6)
        self.assertAlmostEqual(result.fwhm_hz, 2 * gamma, delta=5e6)
        self.assertGreater(result.q_factor, 0)
        self.assertEqual(result.method, "lorentzian_curve_fit")
        self.assertIsNotNone(result.fit_r2)
        self.assertGreater(result.fit_r2, 0.99)  # type: ignore[arg-type]

    def test_lorentzian_fit_with_noise(self) -> None:
        """Fit with added noise still recovers approximate parameters."""
        rng = np.random.default_rng(123)
        f0 = 700e6
        gamma = 10e6
        freqs = np.linspace(100e6, 2e9, 5000)
        psd = _lorentzian_psd(freqs, f0=f0, gamma=gamma, A=1.0, B0=0.01)
        psd += 0.01 * rng.standard_normal(len(freqs))
        psd = np.maximum(psd, 0.0)

        result = fit_lorentzian_linewidth(freqs, psd, fmin=100e6, fmax=2e9)
        self.assertAlmostEqual(result.f0_hz, f0, delta=30e6)
        self.assertAlmostEqual(result.fwhm_hz, 2 * gamma, delta=30e6)

    def test_linewidth_halfmax(self) -> None:
        """Half-max estimator returns sensible values."""
        f0 = 500e6
        gamma = 5e6
        freqs = np.linspace(100e6, 2e9, 10000)
        psd = _lorentzian_psd(freqs, f0=f0, gamma=gamma)

        result = linewidth_halfmax(freqs, psd, fmin=100e6, fmax=2e9)
        self.assertIn("f_center", result)
        self.assertIn("fwhm", result)
        self.assertIn("peak_power", result)
        self.assertGreater(result["fwhm"], 0)

    def test_fit_too_few_points_raises(self) -> None:
        """Fitting with < 5 points should raise."""
        freqs = np.array([1e9, 2e9])
        psd = np.array([0.5, 0.5])
        with self.assertRaises(ValueError):
            fit_lorentzian_linewidth(freqs, psd)

    def test_result_fields(self) -> None:
        """All LinewidthFitResult fields are populated."""
        freqs = np.linspace(100e6, 2e9, 1000)
        psd = _lorentzian_psd(freqs)
        result = fit_lorentzian_linewidth(freqs, psd)
        self.assertIsInstance(result.f0_hz, float)
        self.assertIsInstance(result.fwhm_hz, float)
        self.assertIsInstance(result.q_factor, float)
        self.assertIsInstance(result.amplitude, float)
        self.assertIsInstance(result.background_offset, float)
        self.assertIsInstance(result.background_slope, float)
        self.assertIsInstance(result.fit_window_hz, tuple)
        self.assertIsInstance(result.method, str)


# ── Vortex core tracking tests ─────────────────────────────

class TestVortexTracking(unittest.TestCase):
    def test_basic_track_core(self) -> None:
        """Basic tracker finds the core near the true position."""
        cx, cy = 10e-9, 5e-9
        mz, x, y = _vortex_mz_frame(core_xy=(cx, cy))
        xc, yc = track_vortex_core(mz, x, y, method="weighted_centroid")
        self.assertAlmostEqual(xc, cx, delta=5e-9)
        self.assertAlmostEqual(yc, cy, delta=5e-9)

    def test_subpixel_argmax(self) -> None:
        cx, cy = 10e-9, 5e-9
        mz, x, y = _vortex_mz_frame(core_xy=(cx, cy))
        result = track_vortex_core_subpixel(mz, x, y, method="argmax_mz")
        self.assertIsInstance(result, CoreTrackResult)
        self.assertAlmostEqual(result.x, cx, delta=10e-9)
        self.assertAlmostEqual(result.y, cy, delta=10e-9)

    def test_subpixel_quadratic(self) -> None:
        cx, cy = 10e-9, 5e-9
        mz, x, y = _vortex_mz_frame(core_xy=(cx, cy))
        result = track_vortex_core_subpixel(mz, x, y, method="quadratic_subpixel")
        self.assertIsInstance(result, CoreTrackResult)
        self.assertEqual(result.method, "quadratic_subpixel")
        self.assertAlmostEqual(result.x, cx, delta=8e-9)
        self.assertAlmostEqual(result.y, cy, delta=8e-9)
        self.assertGreater(result.confidence, 0)

    def test_subpixel_weighted_centroid(self) -> None:
        cx, cy = -5e-9, 15e-9
        mz, x, y = _vortex_mz_frame(core_xy=(cx, cy))
        result = track_vortex_core_subpixel(mz, x, y, method="weighted_centroid")
        self.assertEqual(result.method, "weighted_centroid")
        self.assertAlmostEqual(result.x, cx, delta=8e-9)
        self.assertAlmostEqual(result.y, cy, delta=8e-9)

    def test_subpixel_continuity_regularized(self) -> None:
        cx, cy = 10e-9, 5e-9
        mz, x, y = _vortex_mz_frame(core_xy=(cx, cy))
        result = track_vortex_core_subpixel(
            mz, x, y,
            method="continuity_regularized",
            prev_pos=(8e-9, 3e-9),
            max_jump=20e-9,
        )
        self.assertEqual(result.method, "continuity_regularized")
        self.assertAlmostEqual(result.x, cx, delta=15e-9)
        self.assertAlmostEqual(result.y, cy, delta=15e-9)

    def test_continuity_clamp(self) -> None:
        """Jump exceeding max_jump is clamped."""
        cx, cy = 40e-9, 40e-9
        mz, x, y = _vortex_mz_frame(core_xy=(cx, cy))
        result = track_vortex_core_subpixel(
            mz, x, y,
            method="continuity_regularized",
            prev_pos=(0.0, 0.0),
            max_jump=5e-9,
        )
        dist = np.sqrt(result.x ** 2 + result.y ** 2)
        self.assertLessEqual(dist, 5e-9 + 1e-12)
        self.assertLess(result.confidence, 0.5)

    def test_unknown_method_raises(self) -> None:
        mz, x, y = _vortex_mz_frame()
        with self.assertRaises(ValueError):
            track_vortex_core_subpixel(mz, x, y, method="nonexistent")

    def test_mismatched_arrays_raises(self) -> None:
        mz = np.ones(10)
        x = np.ones(10)
        y = np.ones(5)
        with self.assertRaises(ValueError):
            track_vortex_core_subpixel(mz, x, y)


# ── Orbit metrics tests ────────────────────────────────────

class TestOrbitMetrics(unittest.TestCase):
    def test_circular_orbit(self) -> None:
        """Perfect circular orbit yields zero ellipticity and correct radius."""
        n = 200
        R = 10e-9
        t = np.linspace(0, 1e-8, n)
        xc = R * np.cos(2 * np.pi * 500e6 * t)
        yc = R * np.sin(2 * np.pi * 500e6 * t)

        metrics = compute_orbit_metrics(xc, yc, t)
        self.assertIsInstance(metrics, OrbitMetrics)
        self.assertAlmostEqual(metrics.mean_radius, R, delta=2e-9)
        self.assertLess(metrics.ellipticity, 0.2)  # nearly circular
        self.assertIsNotNone(metrics.angular_frequency_hz)

    def test_orbit_radius_helper(self) -> None:
        n = 100
        R = 15e-9
        angles = np.linspace(0, 2 * np.pi, n)
        xc = R * np.cos(angles)
        yc = R * np.sin(angles)
        radii = core_orbit_radius(xc, yc, center=(0.0, 0.0))
        self.assertAlmostEqual(float(np.mean(radii)), R, delta=1e-9)

    def test_core_phase_unwrapped(self) -> None:
        n = 100
        angles = np.linspace(0, 4 * np.pi, n)
        xc = 10e-9 * np.cos(angles)
        yc = 10e-9 * np.sin(angles)
        phases = core_phase(xc, yc, center=(0.0, 0.0), unwrap=True)
        # After 2 full turns, total phase change should be ~4π
        total_change = abs(phases[-1] - phases[0])
        self.assertAlmostEqual(total_change, 4 * np.pi, delta=0.5)

    def test_metrics_without_time(self) -> None:
        n = 50
        xc = 10e-9 * np.cos(np.linspace(0, 2 * np.pi, n))
        yc = 10e-9 * np.sin(np.linspace(0, 2 * np.pi, n))
        metrics = compute_orbit_metrics(xc, yc, t=None)
        self.assertIsNone(metrics.angular_frequency_hz)
        self.assertGreater(metrics.mean_radius, 0)


if __name__ == "__main__":
    unittest.main()
