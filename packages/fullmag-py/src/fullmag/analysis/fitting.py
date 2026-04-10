"""Production-grade spectral fitting for STNO linewidth analysis.

Provides:
- ``fit_lorentzian_linewidth`` — proper least-squares Lorentzian fit with
  linear background, returning ``LinewidthFitResult`` with uncertainties.
- ``linewidth_halfmax`` — fast half-maximum crossing estimator (no fit).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class LinewidthFitResult:
    """Result of a Lorentzian linewidth fit.

    Attributes
    ----------
    f0_hz : float
        Peak center frequency [Hz].
    fwhm_hz : float
        Full width at half maximum [Hz].  Linewidth = FWHM.
    q_factor : float
        Quality factor Q = f0 / FWHM.
    amplitude : float
        Peak amplitude above background.
    background_offset : float
        Constant background level B0.
    background_slope : float
        Linear background slope B1 [1/Hz].
    fit_r2 : float | None
        Coefficient of determination R² of the fit.  ``None`` when
        the fit is degenerate.
    covariance : NDArray | None
        Full covariance matrix of the fitted parameters
        ``[f0, gamma, A, B0, B1]``.
    fit_window_hz : tuple[float, float]
        Frequency window used for fitting.
    method : str
        Fitting method descriptor.
    """

    f0_hz: float
    fwhm_hz: float
    q_factor: float
    amplitude: float
    background_offset: float
    background_slope: float
    fit_r2: float | None
    covariance: NDArray | None
    fit_window_hz: tuple[float, float]
    method: str


def _lorentzian_with_background(
    f: NDArray, f0: float, gamma: float, A: float, B0: float, B1: float,
) -> NDArray:
    r"""Lorentzian + linear background model.

    .. math::
        S(f) = B_0 + B_1 \cdot f + \frac{A}{1 + \left(\frac{f - f_0}{\gamma}\right)^2}

    where FWHM = 2γ.
    """
    return B0 + B1 * f + A / (1.0 + ((f - f0) / gamma) ** 2)


def fit_lorentzian_linewidth(
    freqs: NDArray[np.floating],
    psd: NDArray[np.floating],
    *,
    f_center: float | None = None,
    fmin: float | None = None,
    fmax: float | None = None,
    fit_window_factor: float = 5.0,
) -> LinewidthFitResult:
    """Fit a Lorentzian peak with linear background to the PSD.

    Parameters
    ----------
    freqs : ndarray
        Frequency array [Hz].
    psd : ndarray
        Power spectral density values.
    f_center : float, optional
        Initial guess for center frequency [Hz].  If ``None``, uses the
        frequency of maximum PSD within ``[fmin, fmax]``.
    fmin, fmax : float, optional
        Global search range for the peak.
    fit_window_factor : float
        The fit window extends ±(fit_window_factor × initial_FWHM_estimate)
        around the peak.  Increase for noisy data.

    Returns
    -------
    LinewidthFitResult
        Structured fit result.
    """
    from scipy.optimize import curve_fit

    freqs = np.asarray(freqs, dtype=np.float64)
    psd = np.asarray(psd, dtype=np.float64)

    # Global mask for fmin/fmax
    global_mask = np.ones(len(freqs), dtype=bool)
    effective_fmin = fmin if fmin is not None else float(freqs[0])
    effective_fmax = fmax if fmax is not None else float(freqs[-1])
    global_mask &= freqs >= effective_fmin
    global_mask &= freqs <= effective_fmax

    f_glob = freqs[global_mask]
    p_glob = psd[global_mask]

    if len(f_glob) < 5:
        raise ValueError("too few frequency points in the fit range")

    # Initial peak estimate
    if f_center is None:
        idx_peak = int(np.argmax(p_glob))
        f_center = float(f_glob[idx_peak])
    else:
        idx_peak = int(np.argmin(np.abs(f_glob - f_center)))
    peak_power = float(p_glob[idx_peak])

    # Initial FWHM estimate via half-max crossing
    half_max = peak_power / 2.0
    above = p_glob >= half_max
    if np.any(above):
        indices = np.where(above)[0]
        initial_fwhm = float(f_glob[indices[-1]] - f_glob[indices[0]])
    else:
        initial_fwhm = float(f_glob[-1] - f_glob[0]) / 10.0
    if initial_fwhm < float(np.mean(np.diff(f_glob))) * 2:
        initial_fwhm = float(np.mean(np.diff(f_glob))) * 4

    # Narrow the fitting window
    hw = fit_window_factor * initial_fwhm
    win_lo = f_center - hw
    win_hi = f_center + hw
    win_mask = (f_glob >= win_lo) & (f_glob <= win_hi)
    f_fit = f_glob[win_mask]
    p_fit = p_glob[win_mask]

    if len(f_fit) < 5:
        f_fit = f_glob
        p_fit = p_glob
        win_lo = float(f_glob[0])
        win_hi = float(f_glob[-1])

    # Initial parameter guesses: [f0, gamma, A, B0, B1]
    gamma0 = max(initial_fwhm / 2.0, float(np.mean(np.diff(f_fit))))
    A0 = peak_power
    B0_0 = float(np.percentile(p_fit, 10))
    B1_0 = 0.0
    p0 = [f_center, gamma0, A0, B0_0, B1_0]

    bounds_lo = [float(f_fit[0]), float(np.mean(np.diff(f_fit))) * 0.1, 0.0, -np.inf, -np.inf]
    bounds_hi = [float(f_fit[-1]), float(f_fit[-1] - f_fit[0]), np.inf, np.inf, np.inf]

    try:
        popt, pcov = curve_fit(
            _lorentzian_with_background,
            f_fit,
            p_fit,
            p0=p0,
            bounds=(bounds_lo, bounds_hi),
            maxfev=10000,
        )
    except RuntimeError:
        # Fallback: return half-max estimate
        return LinewidthFitResult(
            f0_hz=f_center,
            fwhm_hz=initial_fwhm,
            q_factor=f_center / initial_fwhm if initial_fwhm > 0 else 0.0,
            amplitude=peak_power,
            background_offset=0.0,
            background_slope=0.0,
            fit_r2=None,
            covariance=None,
            fit_window_hz=(win_lo, win_hi),
            method="halfmax_fallback",
        )

    f0_fit, gamma_fit, A_fit, B0_fit, B1_fit = popt
    fwhm_fit = 2.0 * abs(gamma_fit)

    # R²
    ss_res = float(np.sum((p_fit - _lorentzian_with_background(f_fit, *popt)) ** 2))
    ss_tot = float(np.sum((p_fit - np.mean(p_fit)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else None

    q_factor = f0_fit / fwhm_fit if fwhm_fit > 0 else 0.0

    return LinewidthFitResult(
        f0_hz=float(f0_fit),
        fwhm_hz=float(fwhm_fit),
        q_factor=float(q_factor),
        amplitude=float(A_fit),
        background_offset=float(B0_fit),
        background_slope=float(B1_fit),
        fit_r2=r2,
        covariance=pcov,
        fit_window_hz=(win_lo, win_hi),
        method="lorentzian_curve_fit",
    )


def linewidth_halfmax(
    freqs: NDArray[np.floating],
    psd: NDArray[np.floating],
    *,
    f_center: float | None = None,
    fmin: float = 0.0,
    fmax: float | None = None,
) -> dict[str, float]:
    """Fast half-maximum crossing estimator for linewidth.

    This is *not* a Lorentzian fit — use :func:`fit_lorentzian_linewidth`
    for production measurements.

    Parameters
    ----------
    freqs, psd : ndarray
        Frequency and PSD arrays.
    f_center : float, optional
        Expected center frequency [Hz].
    fmin, fmax : float
        Search range.

    Returns
    -------
    dict
        ``{"f_center": float, "fwhm": float, "peak_power": float}``
    """
    freqs = np.asarray(freqs)
    psd = np.asarray(psd)

    mask = freqs >= fmin
    if fmax is not None:
        mask &= freqs <= fmax
    f_sel = freqs[mask]
    p_sel = psd[mask]

    if len(f_sel) == 0:
        raise ValueError(f"no frequencies in range [{fmin}, {fmax}]")

    if f_center is None:
        f_center = float(f_sel[np.argmax(p_sel)])

    peak_power = float(np.max(p_sel))
    half_max = peak_power / 2.0

    above = p_sel >= half_max
    if not np.any(above):
        return {"f_center": f_center, "fwhm": 0.0, "peak_power": peak_power}

    indices = np.where(above)[0]
    f_low = float(f_sel[indices[0]])
    f_high = float(f_sel[indices[-1]])
    fwhm = f_high - f_low

    return {"f_center": f_center, "fwhm": fwhm, "peak_power": peak_power}
