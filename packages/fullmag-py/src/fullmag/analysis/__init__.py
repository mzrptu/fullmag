"""Post-processing and analysis utilities for Fullmag simulation outputs.

Provides tools for:
- FFT / PSD spectral analysis of magnetization time traces
- Vortex core position tracking
- Linewidth extraction
- Oscillation diagnostics
"""

from fullmag.analysis.spectrum import (
    fft_from_trace,
    linewidth_lorentzian,
    peak_frequency,
    psd_from_trace,
)
from fullmag.analysis.vortex import (
    core_orbit_radius,
    core_phase,
    track_vortex_core,
)

__all__ = [
    "core_orbit_radius",
    "core_phase",
    "fft_from_trace",
    "linewidth_lorentzian",
    "peak_frequency",
    "psd_from_trace",
    "track_vortex_core",
]
