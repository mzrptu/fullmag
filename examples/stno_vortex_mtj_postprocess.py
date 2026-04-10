"""STNO vortex MTJ — post-processing example.

Demonstrates how to analyze STNO time-domain output:
  1. Load magnetization time traces (mx, my, mz vs time).
  2. Compute PSD via ``psd_from_trace``.
  3. Extract peak frequency and linewidth.
  4. Track vortex core position and compute orbit metrics.

This script works on synthetic data for demonstration; replace the
synthetic generator with actual simulation output for real analysis.
"""

from __future__ import annotations

import numpy as np
from fullmag.analysis import (
    psd_from_trace,
    peak_frequency,
    fit_lorentzian_linewidth,
    linewidth_halfmax,
    track_vortex_core,
    core_orbit_radius,
    core_phase,
)
from fullmag.analysis.vortex_fit import (
    track_vortex_core_subpixel,
    compute_orbit_metrics,
)

# ── 1. Synthetic time trace (replace with real sim output) ──

T_TOTAL = 100e-9      # 100 ns total
DT = 10e-12           # 10 ps sampling
F_GYRATION = 500e6    # 500 MHz vortex gyration
ORBIT_R = 10e-9       # 10 nm orbit radius
LINEWIDTH_TARGET = 5e6  # 5 MHz FWHM

t = np.arange(0.0, T_TOTAL, DT)
noise_amp = 0.01
# Synthetic magnetization with single gyration mode
mx = ORBIT_R * np.cos(2 * np.pi * F_GYRATION * t) + noise_amp * np.random.randn(len(t))
my = ORBIT_R * np.sin(2 * np.pi * F_GYRATION * t) + noise_amp * np.random.randn(len(t))
mz = np.full_like(t, 0.9) + 0.01 * np.random.randn(len(t))

# ── 2. PSD and peak frequency ───────────────────────────────

freqs, psd_mx = psd_from_trace(t, mx, window="hann", discard_transient=5e-9)
_, psd_my = psd_from_trace(t, my, window="hann", discard_transient=5e-9)

# Find peak frequency in mx channel
f_peak = peak_frequency(freqs, psd_mx, fmin=100e6, fmax=2e9)
print(f"Peak frequency: {f_peak / 1e6:.1f} MHz  (expected: {F_GYRATION / 1e6:.1f} MHz)")

assert abs(f_peak - F_GYRATION) < 50e6, f"peak frequency {f_peak} too far from {F_GYRATION}"

# ── 3. Linewidth analysis ───────────────────────────────────

# Fast half-max estimate
hm_result = linewidth_halfmax(freqs, psd_mx, fmin=100e6, fmax=2e9)
print(f"Half-max FWHM: {hm_result['fwhm'] / 1e6:.2f} MHz")

# Production Lorentzian fit
fit_result = fit_lorentzian_linewidth(freqs, psd_mx, fmin=100e6, fmax=2e9)
print(f"Lorentzian fit: f0={fit_result.f0_hz / 1e6:.1f} MHz, "
      f"FWHM={fit_result.fwhm_hz / 1e6:.2f} MHz, "
      f"Q={fit_result.q_factor:.0f}, R²={fit_result.fit_r2}")
assert fit_result.fwhm_hz > 0, "linewidth must be positive"

# ── 4. Vortex core tracking ─────────────────────────────────

# Synthetic spatial data: 21×21 grid, single frame
nx, ny = 21, 21
x_grid = np.linspace(-50e-9, 50e-9, nx)
y_grid = np.linspace(-50e-9, 50e-9, ny)
xx, yy = np.meshgrid(x_grid, y_grid)
x_flat = xx.ravel()
y_flat = yy.ravel()

# Simulate several frames of moving vortex core
n_frames = 200
dt_frame = T_TOTAL / n_frames
xc_track = np.empty(n_frames)
yc_track = np.empty(n_frames)
t_frames = np.arange(n_frames) * dt_frame

for i in range(n_frames):
    angle = 2 * np.pi * F_GYRATION * t_frames[i]
    core_x = ORBIT_R * np.cos(angle)
    core_y = ORBIT_R * np.sin(angle)
    r = np.sqrt((x_flat - core_x) ** 2 + (y_flat - core_y) ** 2)
    mz_spatial = np.exp(-(r / 5e-9) ** 2)

    # Basic tracker
    xc, yc = track_vortex_core(mz_spatial, x_flat, y_flat, method="weighted_centroid")
    xc_track[i] = xc
    yc_track[i] = yc

# ── 5. Orbit analysis ───────────────────────────────────────

radii = core_orbit_radius(xc_track, yc_track, center=(0.0, 0.0))
phases = core_phase(xc_track, yc_track, center=(0.0, 0.0))
mean_r = float(np.mean(radii))
print(f"Mean orbit radius: {mean_r / 1e-9:.2f} nm  (expected: {ORBIT_R / 1e-9:.1f} nm)")
assert mean_r > 0, "orbit radius must be positive"

# Advanced orbit metrics
metrics = compute_orbit_metrics(xc_track, yc_track, t_frames)
print(f"Orbit center: ({metrics.orbit_center[0] / 1e-9:.2f}, "
      f"{metrics.orbit_center[1] / 1e-9:.2f}) nm")
print(f"Ellipticity: {metrics.ellipticity:.3f}")
if metrics.angular_frequency_hz is not None:
    print(f"Gyration frequency: {metrics.angular_frequency_hz / 1e6:.1f} MHz")

print("\n=== STNO postprocess example completed successfully ===")
