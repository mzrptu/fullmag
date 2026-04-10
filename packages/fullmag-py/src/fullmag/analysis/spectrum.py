"""Spectral analysis utilities for magnetization time traces.

Functions for computing FFT, power spectral density (PSD), extracting peak
frequencies, and fitting linewidths from micromagnetic simulation output.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


def fft_from_trace(
    t: NDArray[np.floating],
    signal: NDArray[np.floating],
    *,
    window: str = "hann",
    discard_transient: float = 0.0,
) -> tuple[NDArray[np.floating], NDArray[np.complexfloating]]:
    """Compute the one-sided FFT of a time-domain signal.

    Parameters
    ----------
    t : array-like
        Time array [s].
    signal : array-like
        Signal values (e.g. mx(t), my(t)).
    window : str
        Window function name (any supported by ``numpy``).  Default: ``"hann"``.
    discard_transient : float
        Discard initial time interval [s] before computing FFT.

    Returns
    -------
    freqs : ndarray
        Positive frequencies [Hz].
    spectrum : ndarray (complex)
        Complex FFT coefficients.
    """
    t = np.asarray(t, dtype=np.float64)
    signal = np.asarray(signal, dtype=np.float64)

    if discard_transient > 0:
        mask = t >= discard_transient
        t = t[mask]
        signal = signal[mask]

    if len(t) < 2:
        raise ValueError("need at least 2 data points after discarding transient")

    dt = np.mean(np.diff(t))
    n = len(signal)

    # Apply window
    if window == "hann":
        w = np.hanning(n)
    elif window == "hamming":
        w = np.hamming(n)
    elif window == "blackman":
        w = np.blackman(n)
    elif window == "none":
        w = np.ones(n)
    else:
        w = np.hanning(n)

    windowed = (signal - np.mean(signal)) * w

    fft_vals = np.fft.rfft(windowed)
    freqs = np.fft.rfftfreq(n, d=dt)

    return freqs, fft_vals


def psd_from_trace(
    t: NDArray[np.floating],
    signal: NDArray[np.floating],
    *,
    window: str = "hann",
    discard_transient: float = 0.0,
) -> tuple[NDArray[np.floating], NDArray[np.floating]]:
    """Compute the one-sided power spectral density (PSD).

    Parameters
    ----------
    t : array-like
        Time array [s].
    signal : array-like
        Signal values.
    window : str
        Window function name.  Default: ``"hann"``.
    discard_transient : float
        Discard initial time interval [s].

    Returns
    -------
    freqs : ndarray
        Positive frequencies [Hz].
    psd : ndarray
        Power spectral density [signal²/Hz].
    """
    freqs, fft_vals = fft_from_trace(
        t, signal, window=window, discard_transient=discard_transient,
    )
    dt = np.mean(np.diff(np.asarray(t, dtype=np.float64)))
    n = len(np.asarray(signal))
    if discard_transient > 0:
        mask = np.asarray(t) >= discard_transient
        n = int(np.sum(mask))

    # Normalize: PSD = |FFT|² / (n * fs), one-sided → ×2
    fs = 1.0 / dt
    psd = 2.0 * np.abs(fft_vals) ** 2 / (n * fs)
    psd[0] /= 2.0  # DC component not doubled
    if len(psd) > 1 and n % 2 == 0:
        psd[-1] /= 2.0  # Nyquist not doubled

    return freqs, psd


def peak_frequency(
    freqs: NDArray[np.floating],
    psd: NDArray[np.floating],
    *,
    fmin: float = 0.0,
    fmax: float | None = None,
) -> float:
    """Find the frequency with maximum PSD in a given range.

    Parameters
    ----------
    freqs : ndarray
        Frequency array [Hz].
    psd : ndarray
        Power spectral density.
    fmin : float
        Lower frequency bound [Hz].
    fmax : float, optional
        Upper frequency bound [Hz].  Default: Nyquist.

    Returns
    -------
    float
        Peak frequency [Hz].
    """
    freqs = np.asarray(freqs)
    psd = np.asarray(psd)
    mask = freqs >= fmin
    if fmax is not None:
        mask &= freqs <= fmax
    if not np.any(mask):
        raise ValueError(f"no frequencies in range [{fmin}, {fmax}]")
    idx = np.argmax(psd[mask])
    return float(freqs[mask][idx])


def linewidth_lorentzian(
    freqs: NDArray[np.floating],
    psd: NDArray[np.floating],
    *,
    f_center: float | None = None,
    fmin: float = 0.0,
    fmax: float | None = None,
) -> dict[str, float]:
    """Estimate linewidth by half-maximum width crossing.

    .. deprecated::
        This function is a simple half-max estimator, not a proper Lorentzian
        fit.  Use :func:`fullmag.analysis.fitting.fit_lorentzian_linewidth`
        for production measurements, or
        :func:`fullmag.analysis.fitting.linewidth_halfmax` as a named
        replacement for this estimator.

    Parameters
    ----------
    freqs : ndarray
        Frequency array [Hz].
    psd : ndarray
        Power spectral density.
    f_center : float, optional
        Center frequency [Hz].  If None, uses peak_frequency.
    fmin, fmax : float
        Frequency range for fitting.

    Returns
    -------
    dict
        ``{"f_center": float, "fwhm": float, "peak_power": float}``
    """
    import warnings
    warnings.warn(
        "linewidth_lorentzian is a half-max estimator, not a Lorentzian fit. "
        "Use fullmag.analysis.fitting.fit_lorentzian_linewidth for production use.",
        DeprecationWarning,
        stacklevel=2,
    )
    freqs = np.asarray(freqs)
    psd = np.asarray(psd)

    mask = freqs >= fmin
    if fmax is not None:
        mask &= freqs <= fmax
    f_sel = freqs[mask]
    p_sel = psd[mask]

    if f_center is None:
        f_center = float(f_sel[np.argmax(p_sel)])

    peak_power = float(np.max(p_sel))
    half_max = peak_power / 2.0

    # Find indices where PSD crosses half-max
    above = p_sel >= half_max
    if not np.any(above):
        return {"f_center": f_center, "fwhm": 0.0, "peak_power": peak_power}

    indices = np.where(above)[0]
    f_low = float(f_sel[indices[0]])
    f_high = float(f_sel[indices[-1]])
    fwhm = f_high - f_low

    return {"f_center": f_center, "fwhm": fwhm, "peak_power": peak_power}
