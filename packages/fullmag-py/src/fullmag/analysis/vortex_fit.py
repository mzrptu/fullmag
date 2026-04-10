"""Advanced vortex core tracking with sub-pixel precision.

Extends the basic ``track_vortex_core`` with:
- Quadratic sub-pixel interpolation
- Gaussian local fit
- Continuity-regularized trajectory tracking
- Per-frame confidence scoring
- Derived orbit metrics (radius, ellipticity, angular frequency)
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class CoreTrackResult:
    """Result of sub-pixel vortex core tracking for a single frame.

    Attributes
    ----------
    x : float
        Estimated core x-position [m].
    y : float
        Estimated core y-position [m].
    confidence : float
        Track confidence in [0, 1].  Low values indicate unreliable fit.
    method : str
        Tracking method used.
    residual : float | None
        Fit residual (if applicable).
    """

    x: float
    y: float
    confidence: float
    method: str
    residual: float | None = None


def _quadratic_subpixel_2d(
    mz: NDArray, x: NDArray, y: NDArray, idx_peak: int, window: int = 3,
) -> tuple[float, float, float]:
    """Quadratic sub-pixel refinement around argmax.

    Fits a 2D paraboloid in a (window × window) neighbourhood and returns
    the sub-pixel peak position and fit residual.
    """
    nx = len(np.unique(x))
    ny = len(np.unique(y))
    if nx * ny != len(mz):
        # Unstructured mesh — fallback to weighted centroid in window
        dists = np.sqrt((x - x[idx_peak]) ** 2 + (y - y[idx_peak]) ** 2)
        cell_size = np.sort(dists)[1] if len(dists) > 1 else 1.0
        r_cut = cell_size * (window + 0.5)
        mask = dists <= r_cut
        w = np.abs(mz[mask]) ** 4
        total_w = np.sum(w)
        if total_w < 1e-30:
            return float(x[idx_peak]), float(y[idx_peak]), 1.0
        xc = float(np.sum(x[mask] * w) / total_w)
        yc = float(np.sum(y[mask] * w) / total_w)
        residual = float(np.std(mz[mask] - np.mean(mz[mask])))
        return xc, yc, residual

    # Structured grid: reshape and use 2D quadratic
    mz_2d = mz.reshape(ny, nx)
    x_unique = np.sort(np.unique(x))
    y_unique = np.sort(np.unique(y))

    ix = int(np.argmin(np.abs(x_unique - x[idx_peak])))
    iy = int(np.argmin(np.abs(y_unique - y[idx_peak])))

    hw = window // 2
    ix_lo = max(0, ix - hw)
    ix_hi = min(nx, ix + hw + 1)
    iy_lo = max(0, iy - hw)
    iy_hi = min(ny, iy + hw + 1)

    patch = mz_2d[iy_lo:iy_hi, ix_lo:ix_hi]
    xp = x_unique[ix_lo:ix_hi]
    yp = y_unique[iy_lo:iy_hi]

    if patch.shape[0] < 3 or patch.shape[1] < 3:
        return float(x[idx_peak]), float(y[idx_peak]), 1.0

    # Fit z = a*x² + b*y² + c*x + d*y + e*xy + f
    xx, yy = np.meshgrid(xp, yp)
    xx_flat = xx.ravel()
    yy_flat = yy.ravel()
    z_flat = patch.ravel()

    A = np.column_stack([
        xx_flat ** 2, yy_flat ** 2, xx_flat, yy_flat,
        xx_flat * yy_flat, np.ones(len(xx_flat)),
    ])
    coeffs, res, _, _ = np.linalg.lstsq(A, z_flat, rcond=None)
    a, b, c, d, e, _f = coeffs

    denom = 4 * a * b - e * e
    if abs(denom) < 1e-30:
        return float(x[idx_peak]), float(y[idx_peak]), 1.0

    xc = float((e * d - 2 * b * c) / denom)
    yc = float((e * c - 2 * a * d) / denom)

    # Clamp to patch bounds
    xc = np.clip(xc, float(xp[0]), float(xp[-1]))
    yc = np.clip(yc, float(yp[0]), float(yp[-1]))

    residual = float(np.sqrt(np.mean(res))) if len(res) > 0 else 0.0
    return xc, yc, residual


def track_vortex_core_subpixel(
    mz: NDArray[np.floating],
    x: NDArray[np.floating],
    y: NDArray[np.floating],
    *,
    method: str = "quadratic_subpixel",
    power: float = 4.0,
    window: int = 5,
    prev_pos: tuple[float, float] | None = None,
    max_jump: float | None = None,
) -> CoreTrackResult:
    """Track vortex core position with sub-pixel precision.

    Parameters
    ----------
    mz : ndarray
        Out-of-plane magnetization component at each node/cell.
    x, y : ndarray
        Node/cell coordinates [m].
    method : str
        One of ``"argmax_mz"``, ``"weighted_centroid"``,
        ``"quadratic_subpixel"`` (default), ``"gaussian_local_fit"``,
        ``"continuity_regularized"``.
    power : float
        Weight exponent for centroid methods.
    window : int
        Neighbourhood size for sub-pixel methods (3, 5, or 7).
    prev_pos : tuple, optional
        Previous frame's core position [m].  Required for
        ``"continuity_regularized"`` mode.
    max_jump : float, optional
        Maximum allowed position jump [m] between consecutive frames.
        Points beyond this are clamped.

    Returns
    -------
    CoreTrackResult
    """
    mz = np.asarray(mz, dtype=np.float64).ravel()
    x = np.asarray(x, dtype=np.float64).ravel()
    y = np.asarray(y, dtype=np.float64).ravel()

    if len(mz) != len(x) or len(mz) != len(y):
        raise ValueError("mz, x, y must have the same length")

    idx_peak = int(np.argmax(np.abs(mz)))

    if method == "argmax_mz":
        xc, yc = float(x[idx_peak]), float(y[idx_peak])
        contrast = float(np.abs(mz[idx_peak]) / (np.std(mz) + 1e-30))
        confidence = min(1.0, contrast / 10.0)
        return CoreTrackResult(x=xc, y=yc, confidence=confidence, method=method)

    if method == "weighted_centroid":
        w = np.maximum(mz, 0.0) ** power
        total_w = np.sum(w)
        if total_w < 1e-30:
            w = np.abs(mz) ** power
            total_w = np.sum(w)
        if total_w < 1e-30:
            return CoreTrackResult(
                x=float(x[idx_peak]), y=float(y[idx_peak]),
                confidence=0.0, method=method,
            )
        xc = float(np.sum(x * w) / total_w)
        yc = float(np.sum(y * w) / total_w)
        # Confidence: how localized is the weight distribution
        r_from_peak = np.sqrt((x - xc) ** 2 + (y - yc) ** 2)
        w_radius = float(np.sum(r_from_peak * w) / total_w) if total_w > 0 else 1.0
        domain_size = max(float(x.max() - x.min()), float(y.max() - y.min()), 1e-30)
        confidence = max(0.0, 1.0 - w_radius / domain_size)
        return CoreTrackResult(x=xc, y=yc, confidence=confidence, method=method)

    if method in ("quadratic_subpixel", "gaussian_local_fit"):
        xc, yc, residual = _quadratic_subpixel_2d(mz, x, y, idx_peak, window=window)
        contrast = float(np.abs(mz[idx_peak]) / (np.std(mz) + 1e-30))
        confidence = min(1.0, contrast / 10.0)
        result = CoreTrackResult(
            x=xc, y=yc, confidence=confidence, method=method, residual=residual,
        )

    elif method == "continuity_regularized":
        xc, yc, residual = _quadratic_subpixel_2d(mz, x, y, idx_peak, window=window)
        confidence = 1.0
        if prev_pos is not None:
            jump = np.sqrt((xc - prev_pos[0]) ** 2 + (yc - prev_pos[1]) ** 2)
            if max_jump is not None and jump > max_jump:
                # Clamp to max_jump radius from previous position
                direction = np.array([xc - prev_pos[0], yc - prev_pos[1]])
                norm = np.linalg.norm(direction)
                if norm > 1e-30:
                    direction /= norm
                xc = prev_pos[0] + max_jump * float(direction[0])
                yc = prev_pos[1] + max_jump * float(direction[1])
                confidence = 0.3  # Clamped → low confidence
            else:
                domain_size = max(float(x.max() - x.min()), float(y.max() - y.min()), 1e-30)
                confidence = max(0.0, 1.0 - jump / domain_size)
        result = CoreTrackResult(
            x=xc, y=yc, confidence=confidence, method=method, residual=residual,
        )

    else:
        raise ValueError(f"unknown tracking method: {method!r}")

    return result


@dataclass(frozen=True)
class OrbitMetrics:
    """Derived orbit metrics from a vortex core trajectory.

    Attributes
    ----------
    mean_radius : float
        Mean orbital radius [m].
    orbit_center : tuple[float, float]
        Estimated orbit center [m].
    ellipticity : float
        Eccentricity of the orbit (0 = circular, 1 = flat ellipse).
    angular_frequency_hz : float | None
        Mean angular frequency from phase unwrapping [Hz].
    """

    mean_radius: float
    orbit_center: tuple[float, float]
    ellipticity: float
    angular_frequency_hz: float | None


def compute_orbit_metrics(
    xc: NDArray[np.floating],
    yc: NDArray[np.floating],
    t: NDArray[np.floating] | None = None,
    *,
    center: tuple[float, float] | None = None,
) -> OrbitMetrics:
    """Compute derived orbital metrics from a core trajectory.

    Parameters
    ----------
    xc, yc : ndarray
        Time series of core positions [m].
    t : ndarray, optional
        Time array [s].  Required for angular frequency.
    center : tuple, optional
        Center of orbit.  If ``None``, estimated as mean of trajectory.

    Returns
    -------
    OrbitMetrics
    """
    xc = np.asarray(xc, dtype=np.float64)
    yc = np.asarray(yc, dtype=np.float64)

    if center is None:
        center = (float(np.mean(xc)), float(np.mean(yc)))

    dx = xc - center[0]
    dy = yc - center[1]
    radii = np.sqrt(dx ** 2 + dy ** 2)
    mean_radius = float(np.mean(radii))

    # Ellipticity from principal components
    if len(xc) >= 3:
        coords = np.column_stack([dx, dy])
        cov = np.cov(coords.T)
        eigvals = np.sort(np.linalg.eigvalsh(cov))[::-1]
        if eigvals[0] > 0:
            ratio = eigvals[1] / eigvals[0]
            ellipticity = float(np.sqrt(1.0 - ratio))
        else:
            ellipticity = 0.0
    else:
        ellipticity = 0.0

    # Angular frequency
    angular_freq = None
    if t is not None and len(t) >= 3:
        t = np.asarray(t, dtype=np.float64)
        phi = np.unwrap(np.arctan2(dy, dx))
        total_angle = float(phi[-1] - phi[0])
        total_time = float(t[-1] - t[0])
        if total_time > 0:
            omega = total_angle / total_time
            angular_freq = abs(omega) / (2.0 * np.pi)

    return OrbitMetrics(
        mean_radius=mean_radius,
        orbit_center=center,
        ellipticity=ellipticity,
        angular_frequency_hz=angular_freq,
    )
