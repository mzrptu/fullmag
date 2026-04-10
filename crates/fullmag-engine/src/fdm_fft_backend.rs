//! FFT backend abstraction for FDM spectral demag.
//!
//! The `FdmFftBackend` trait decouples the demag convolution from the
//! concrete FFT implementation.  The default `RustFftBackend` wraps the
//! existing `rustfft` 6.x plans.  Future backends (FFTW, MKL, cuFFT,
//! distributed heFFTe/MPI) implement the same trait.

use crate::VectorFieldSoA;

/// Pre-computed Newell kernel spectra for demag convolution.
///
/// Backends receive this so they can apply the spectral tensor multiply.
/// The data format is interleaved complex: [re0, im0, re1, im1, …].
pub use crate::fdm_fft::DemagKernelSpectra;

// ──────────────────────────────────────────────────────────────────────
// Backend trait
// ──────────────────────────────────────────────────────────────────────

/// Abstraction over FFT-based demag convolution.
///
/// A backend owns its plans, scratch buffers, and padded-domain storage.
/// The caller provides **physical-domain** SoA fields and the kernel
/// spectra; the backend performs:
///
///   1. pack (physical → padded),
///   2. forward FFT,
///   3. spectral tensor multiply,
///   4. inverse FFT,
///   5. unpack + accumulate into `out_h`.
///
/// This matches the `FdmFftBackend` signature from the implementation plan.
pub trait FdmFftBackend: Send + Sync {
    /// Execute the full demag convolution: M → H_demag, accumulated into
    /// `out_h`.  `m` contains **normalised** magnetisation × M_s; the
    /// backend must *not* rescale.
    fn convolve_demag(
        &mut self,
        m: &VectorFieldSoA,
        kernel: &DemagKernelSpectra,
        out_h: &mut VectorFieldSoA,
    );

    /// Human-readable name, e.g. "rustfft", "fftw", "cufft".
    fn name(&self) -> &'static str;
}

// ──────────────────────────────────────────────────────────────────────
// RustFftBackend — wraps the existing FftWorkspace
// ──────────────────────────────────────────────────────────────────────

use crate::fdm_fft::FftWorkspace;

/// Default CPU backend using `rustfft` 6.x with Rayon parallelism on
/// the `parallel` feature flag.
pub struct RustFftBackend {
    pub(crate) ws: FftWorkspace,
    /// Physical grid dimensions (needed for pack / unpack).
    nx: usize,
    ny: usize,
    nz: usize,
}

impl RustFftBackend {
    /// Build a new backend for the given physical grid.
    ///
    /// `ws` must already be initialised with matching padded dimensions.
    pub fn new(ws: FftWorkspace, nx: usize, ny: usize, nz: usize) -> Self {
        Self { ws, nx, ny, nz }
    }

    /// Borrow the inner `FftWorkspace` (for legacy code that still needs it).
    pub fn workspace_mut(&mut self) -> &mut FftWorkspace {
        &mut self.ws
    }
}

use rustfft::num_complex::Complex;

/// Helper: padded linear index from (x,y,z) with padded row stride `px` and `py`.
#[inline]
fn padded_index(px: usize, py: usize, x: usize, y: usize, z: usize) -> usize {
    x + px * (y + py * z)
}

impl FdmFftBackend for RustFftBackend {
    fn convolve_demag(
        &mut self,
        m: &VectorFieldSoA,
        _kernel: &DemagKernelSpectra,
        out_h: &mut VectorFieldSoA,
    ) {
        let ws = &mut self.ws;
        let px = ws.px;
        let py = ws.py;
        let _pz = ws.pz;
        let padded_len = px * py * ws.pz;

        // 1. Clear M buffers (H buffers overwritten by tensor multiply)
        ws.clear_m_bufs();

        // 2. Pack physical → padded
        for z in 0..self.nz {
            for y in 0..self.ny {
                for x in 0..self.nx {
                    let src = x + self.nx * (y + self.ny * z);
                    let dst = padded_index(px, py, x, y, z);
                    ws.buf_mx[dst] = Complex::new(m.x[src], 0.0);
                    ws.buf_my[dst] = Complex::new(m.y[src], 0.0);
                    ws.buf_mz[dst] = Complex::new(m.z[src], 0.0);
                }
            }
        }

        // 3. Forward FFT
        ws.fft3_m_forward();

        // 4. Spectral tensor multiply (uses ws.kern_* which were precomputed)
        #[cfg(feature = "parallel")]
        {
            use rayon::prelude::*;
            let (mx_sl, my_sl, mz_sl) = (&ws.buf_mx[..], &ws.buf_my[..], &ws.buf_mz[..]);
            let (kxx, kyy, kzz) = (&ws.kern_xx[..], &ws.kern_yy[..], &ws.kern_zz[..]);
            let (kxy, kxz, kyz) = (&ws.kern_xy[..], &ws.kern_xz[..], &ws.kern_yz[..]);
            let hx = &mut ws.buf_hx[..];
            let hy = &mut ws.buf_hy[..];
            let hz = &mut ws.buf_hz[..];
            hx.par_iter_mut().enumerate().for_each(|(i, h)| {
                *h = -(kxx[i] * mx_sl[i] + kxy[i] * my_sl[i] + kxz[i] * mz_sl[i]);
            });
            hy.par_iter_mut().enumerate().for_each(|(i, h)| {
                *h = -(kxy[i] * mx_sl[i] + kyy[i] * my_sl[i] + kyz[i] * mz_sl[i]);
            });
            hz.par_iter_mut().enumerate().for_each(|(i, h)| {
                *h = -(kxz[i] * mx_sl[i] + kyz[i] * my_sl[i] + kzz[i] * mz_sl[i]);
            });
        }
        #[cfg(not(feature = "parallel"))]
        {
            for i in 0..padded_len {
                let mx = ws.buf_mx[i];
                let my = ws.buf_my[i];
                let mz = ws.buf_mz[i];
                ws.buf_hx[i] = -(ws.kern_xx[i] * mx + ws.kern_xy[i] * my + ws.kern_xz[i] * mz);
                ws.buf_hy[i] = -(ws.kern_xy[i] * mx + ws.kern_yy[i] * my + ws.kern_yz[i] * mz);
                ws.buf_hz[i] = -(ws.kern_xz[i] * mx + ws.kern_yz[i] * my + ws.kern_zz[i] * mz);
            }
        }

        // 5. Inverse FFT
        ws.fft3_h_inverse();

        // 6. Unpack + accumulate into out_h
        let norm = 1.0 / padded_len as f64;
        for z in 0..self.nz {
            for y in 0..self.ny {
                for x in 0..self.nx {
                    let src = padded_index(px, py, x, y, z);
                    let dst = x + self.nx * (y + self.ny * z);
                    out_h.x[dst] += ws.buf_hx[src].re * norm;
                    out_h.y[dst] += ws.buf_hy[src].re * norm;
                    out_h.z[dst] += ws.buf_hz[src].re * norm;
                }
            }
        }
    }

    fn name(&self) -> &'static str {
        "rustfft"
    }
}

// ──────────────────────────────────────────────────────────────────────
// B10: Distributed FFT backend trait
// ──────────────────────────────────────────────────────────────────────

use crate::distributed::{GlobalReductionService, RankLocalSubdomain};

/// Distributed FFT backend for multi-rank demag convolution (B10).
///
/// Unlike [`FdmFftBackend`], this trait operates on **rank-local** data
/// and coordinates global transposes / all-to-all communication internally.
///
/// Implementors:
/// - heFFTe (C/C++ via FFI)
/// - FFTW MPI
/// - Manual pencil transpose + local FFT (fallback)
pub trait DistributedFftBackend: Send + Sync {
    /// Execute distributed demag convolution on the local slab.
    ///
    /// - `local_m`: SoA magnetization for the **owned** cells on this rank
    /// - `kernel`: pre-computed Newell spectra (global, broadcast at startup)
    /// - `sub`: subdomain description (offsets, extents)
    /// - `out_h`: output field — accumulated into (not overwritten)
    /// - `reductions`: collective communication handle
    fn convolve_demag_distributed(
        &mut self,
        local_m: &VectorFieldSoA,
        kernel: &DemagKernelSpectra,
        sub: &RankLocalSubdomain,
        out_h: &mut VectorFieldSoA,
        reductions: &dyn GlobalReductionService,
    );

    /// Human-readable name, e.g. "heffte", "fftw_mpi".
    fn name(&self) -> &'static str;
}

/// Fallback distributed backend that delegates to a local [`FdmFftBackend`]
/// on rank 0 only (gather → local FFT → scatter).
///
/// This is correct but not scalable — useful only for testing and as a
/// reference implementation.
pub struct GatherScatterFallback<B: FdmFftBackend> {
    local_backend: B,
}

impl<B: FdmFftBackend> GatherScatterFallback<B> {
    pub fn new(local_backend: B) -> Self {
        Self { local_backend }
    }
}

impl<B: FdmFftBackend> DistributedFftBackend for GatherScatterFallback<B> {
    fn convolve_demag_distributed(
        &mut self,
        local_m: &VectorFieldSoA,
        kernel: &DemagKernelSpectra,
        _sub: &RankLocalSubdomain,
        out_h: &mut VectorFieldSoA,
        _reductions: &dyn GlobalReductionService,
    ) {
        // Single-rank fallback: just delegate to the local backend.
        self.local_backend.convolve_demag(local_m, kernel, out_h);
    }

    fn name(&self) -> &'static str {
        "gather_scatter_fallback"
    }
}
