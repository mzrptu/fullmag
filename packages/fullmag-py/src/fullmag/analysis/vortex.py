"""Vortex core position tracking and orbit analysis.

Provides tools for extracting the vortex core position from spatially
resolved magnetization snapshots and analyzing the resulting orbital dynamics.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


def track_vortex_core(
    mz: NDArray[np.floating],
    x: NDArray[np.floating],
    y: NDArray[np.floating],
    *,
    power: float = 4.0,
    method: str = "weighted_centroid",
) -> tuple[float, float]:
    """Estimate the vortex core position from spatially resolved m_z.

    The vortex core is located where |m_z| is maximal.  The weighted-centroid
    method uses w(r) = max(m_z, 0)^p as weights to compute the center of mass.

    Parameters
    ----------
    mz : ndarray, shape (N,) or (Ny, Nx)
        Out-of-plane magnetization component at each node/cell.
    x : ndarray
        x-coordinates of each node/cell [m].
    y : ndarray
        y-coordinates of each node/cell [m].
    power : float
        Exponent for weighting.  Higher values sharpen localization.
        Default: 4.0.
    method : str
        ``"weighted_centroid"`` (default) or ``"max_mz"``.

    Returns
    -------
    (Xc, Yc) : tuple of float
        Estimated vortex core position [m].
    """
    mz = np.asarray(mz, dtype=np.float64).ravel()
    x = np.asarray(x, dtype=np.float64).ravel()
    y = np.asarray(y, dtype=np.float64).ravel()

    if len(mz) != len(x) or len(mz) != len(y):
        raise ValueError("mz, x, y must have the same length")

    if method == "max_mz":
        idx = np.argmax(np.abs(mz))
        return float(x[idx]), float(y[idx])

    # Weighted centroid
    w = np.maximum(mz, 0.0) ** power
    total_w = np.sum(w)
    if total_w < 1e-30:
        # Fallback: try with |mz|
        w = np.abs(mz) ** power
        total_w = np.sum(w)
    if total_w < 1e-30:
        raise ValueError("all weights are zero — no vortex core detected")

    xc = float(np.sum(x * w) / total_w)
    yc = float(np.sum(y * w) / total_w)
    return xc, yc


def core_orbit_radius(
    xc: NDArray[np.floating],
    yc: NDArray[np.floating],
    *,
    center: tuple[float, float] = (0.0, 0.0),
) -> NDArray[np.floating]:
    """Compute the orbital radius of the vortex core around a center point.

    Parameters
    ----------
    xc, yc : ndarray
        Time series of the vortex core position [m].
    center : tuple of 2 floats
        Center of the orbit (usually the disk center) [m].

    Returns
    -------
    ndarray
        Orbital radius at each time step [m].
    """
    xc = np.asarray(xc, dtype=np.float64)
    yc = np.asarray(yc, dtype=np.float64)
    return np.sqrt((xc - center[0]) ** 2 + (yc - center[1]) ** 2)


def core_phase(
    xc: NDArray[np.floating],
    yc: NDArray[np.floating],
    *,
    center: tuple[float, float] = (0.0, 0.0),
    unwrap: bool = True,
) -> NDArray[np.floating]:
    """Compute the angular phase of the vortex core orbit.

    Parameters
    ----------
    xc, yc : ndarray
        Time series of the vortex core position [m].
    center : tuple of 2 floats
        Center of the orbit [m].
    unwrap : bool
        If True, unwrap the phase for continuous tracking.

    Returns
    -------
    ndarray
        Phase angle [rad].
    """
    xc = np.asarray(xc, dtype=np.float64)
    yc = np.asarray(yc, dtype=np.float64)
    phi = np.arctan2(yc - center[1], xc - center[0])
    if unwrap:
        phi = np.unwrap(phi)
    return phi
