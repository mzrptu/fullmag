//! FFT workspace, Newell kernel spectra, and 3D FFT transforms for spectral demag.

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use std::sync::Arc;

use crate::newell;
use crate::Vector3;

// ── FftWorkspace ───────────────────────────────────────────────────────

/// Cached FFT plans and scratch buffers for spectral demag.
///
/// Build once per grid via [`ExchangeLlgProblem::create_workspace`] and pass
/// into [`ExchangeLlgProblem::step`].  This avoids rebuilding `FftPlanner`
/// and re-planning every call to `demag_field_from_vectors`.
pub struct FftWorkspace {
    pub(crate) fwd_x: Arc<dyn Fft<f64>>,
    pub(crate) fwd_y: Arc<dyn Fft<f64>>,
    pub(crate) fwd_z: Arc<dyn Fft<f64>>,
    pub(crate) inv_x: Arc<dyn Fft<f64>>,
    pub(crate) inv_y: Arc<dyn Fft<f64>>,
    pub(crate) inv_z: Arc<dyn Fft<f64>>,
    /// Padded grid dimensions (2×N per axis).
    pub px: usize,
    pub py: usize,
    pub pz: usize,
    /// Re-usable scratch line buffers.
    pub(crate) line_y: Vec<Complex<f64>>,
    pub(crate) line_z: Vec<Complex<f64>>,
    /// Re-usable padded frequency-domain buffers (avoids allocation per demag call).
    pub(crate) buf_mx: Vec<Complex<f64>>,
    pub(crate) buf_my: Vec<Complex<f64>>,
    pub(crate) buf_mz: Vec<Complex<f64>>,
    pub(crate) buf_hx: Vec<Complex<f64>>,
    pub(crate) buf_hy: Vec<Complex<f64>>,
    pub(crate) buf_hz: Vec<Complex<f64>>,
    /// Precomputed Newell kernel spectra (FFT of real-space demagnetization tensors).
    pub(crate) kern_xx: Vec<Complex<f64>>,
    pub(crate) kern_yy: Vec<Complex<f64>>,
    pub(crate) kern_zz: Vec<Complex<f64>>,
    pub(crate) kern_xy: Vec<Complex<f64>>,
    pub(crate) kern_xz: Vec<Complex<f64>>,
    pub(crate) kern_yz: Vec<Complex<f64>>,
}

#[derive(Debug, Clone)]
pub struct DemagKernelSpectra {
    pub px: usize,
    pub py: usize,
    pub pz: usize,
    /// Interleaved complex spectra: [re0, im0, re1, im1, ...]
    pub n_xx: Vec<f64>,
    pub n_yy: Vec<f64>,
    pub n_zz: Vec<f64>,
    pub n_xy: Vec<f64>,
    pub n_xz: Vec<f64>,
    pub n_yz: Vec<f64>,
}

impl FftWorkspace {
    pub fn new(nx: usize, ny: usize, nz: usize, dx: f64, dy: f64, dz: f64) -> Self {
        let px = nx * 2;
        let py = ny * 2;
        let pz = nz * 2;
        let padded_len = px * py * pz;
        let mut planner = FftPlanner::<f64>::new();
        let zero = Complex::new(0.0, 0.0);

        let fwd_x = planner.plan_fft_forward(px);
        let fwd_y = planner.plan_fft_forward(py);
        let fwd_z = planner.plan_fft_forward(pz);

        // Precompute Newell kernels in real space, then FFT each component.
        let nk = newell::compute_newell_kernels(nx, ny, nz, dx, dy, dz);

        let fft_kernel = |real: Vec<f64>| -> Vec<Complex<f64>> {
            let mut buf: Vec<Complex<f64>> =
                real.into_iter().map(|v| Complex::new(v, 0.0)).collect();
            // 3D FFT: x then y then z, same as fft3_m_forward
            let mut line_y_tmp = vec![zero; py];
            let mut line_z_tmp = vec![zero; pz];
            fft3_core(
                &mut buf,
                px,
                py,
                pz,
                &*fwd_x,
                &*fwd_y,
                &*fwd_z,
                &mut line_y_tmp,
                &mut line_z_tmp,
            );
            buf
        };

        let kern_xx = fft_kernel(nk.n_xx);
        let kern_yy = fft_kernel(nk.n_yy);
        let kern_zz = fft_kernel(nk.n_zz);
        let kern_xy = fft_kernel(nk.n_xy);
        let kern_xz = fft_kernel(nk.n_xz);
        let kern_yz = fft_kernel(nk.n_yz);

        Self {
            fwd_x,
            fwd_y: planner.plan_fft_forward(py),
            fwd_z: planner.plan_fft_forward(pz),
            inv_x: planner.plan_fft_inverse(px),
            inv_y: planner.plan_fft_inverse(py),
            inv_z: planner.plan_fft_inverse(pz),
            px,
            py,
            pz,
            line_y: vec![zero; py],
            line_z: vec![zero; pz],
            buf_mx: vec![zero; padded_len],
            buf_my: vec![zero; padded_len],
            buf_mz: vec![zero; padded_len],
            buf_hx: vec![zero; padded_len],
            buf_hy: vec![zero; padded_len],
            buf_hz: vec![zero; padded_len],
            kern_xx,
            kern_yy,
            kern_zz,
            kern_xy,
            kern_xz,
            kern_yz,
        }
    }

    /// Zero out all six M/H frequency-domain buffers.
    pub(crate) fn clear_bufs(&mut self) {
        let zero = Complex::new(0.0, 0.0);
        #[cfg(feature = "parallel")]
        {
            use rayon::prelude::*;
            self.buf_mx.par_iter_mut().for_each(|v| *v = zero);
            self.buf_my.par_iter_mut().for_each(|v| *v = zero);
            self.buf_mz.par_iter_mut().for_each(|v| *v = zero);
            self.buf_hx.par_iter_mut().for_each(|v| *v = zero);
            self.buf_hy.par_iter_mut().for_each(|v| *v = zero);
            self.buf_hz.par_iter_mut().for_each(|v| *v = zero);
        }
        #[cfg(not(feature = "parallel"))]
        {
            for v in self
                .buf_mx
                .iter_mut()
                .chain(self.buf_my.iter_mut())
                .chain(self.buf_mz.iter_mut())
                .chain(self.buf_hx.iter_mut())
                .chain(self.buf_hy.iter_mut())
                .chain(self.buf_hz.iter_mut())
            {
                *v = zero;
            }
        }
    }

    /// Forward FFT on the three M-component buffers (buf_mx, buf_my, buf_mz).
    pub(crate) fn fft3_m_forward(&mut self) {
        fft3_core(
            &mut self.buf_mx,
            self.px,
            self.py,
            self.pz,
            &*self.fwd_x,
            &*self.fwd_y,
            &*self.fwd_z,
            &mut self.line_y,
            &mut self.line_z,
        );
        fft3_core(
            &mut self.buf_my,
            self.px,
            self.py,
            self.pz,
            &*self.fwd_x,
            &*self.fwd_y,
            &*self.fwd_z,
            &mut self.line_y,
            &mut self.line_z,
        );
        fft3_core(
            &mut self.buf_mz,
            self.px,
            self.py,
            self.pz,
            &*self.fwd_x,
            &*self.fwd_y,
            &*self.fwd_z,
            &mut self.line_y,
            &mut self.line_z,
        );
    }

    /// Inverse FFT on the three H-component buffers (buf_hx, buf_hy, buf_hz).
    pub(crate) fn fft3_h_inverse(&mut self) {
        fft3_core(
            &mut self.buf_hx,
            self.px,
            self.py,
            self.pz,
            &*self.inv_x,
            &*self.inv_y,
            &*self.inv_z,
            &mut self.line_y,
            &mut self.line_z,
        );
        fft3_core(
            &mut self.buf_hy,
            self.px,
            self.py,
            self.pz,
            &*self.inv_x,
            &*self.inv_y,
            &*self.inv_z,
            &mut self.line_y,
            &mut self.line_z,
        );
        fft3_core(
            &mut self.buf_hz,
            self.px,
            self.py,
            self.pz,
            &*self.inv_x,
            &*self.inv_y,
            &*self.inv_z,
            &mut self.line_y,
            &mut self.line_z,
        );
    }
}

// ── Newell kernel spectra helpers ──────────────────────────────────────

pub fn compute_newell_kernel_spectra(
    nx: usize,
    ny: usize,
    nz: usize,
    dx: f64,
    dy: f64,
    dz: f64,
) -> DemagKernelSpectra {
    let workspace = FftWorkspace::new(nx, ny, nz, dx, dy, dz);
    let flatten = |values: &[Complex<f64>]| -> Vec<f64> {
        let mut flat = Vec::with_capacity(values.len() * 2);
        for value in values {
            flat.push(value.re);
            flat.push(value.im);
        }
        flat
    };

    DemagKernelSpectra {
        px: workspace.px,
        py: workspace.py,
        pz: workspace.pz,
        n_xx: flatten(&workspace.kern_xx),
        n_yy: flatten(&workspace.kern_yy),
        n_zz: flatten(&workspace.kern_zz),
        n_xy: flatten(&workspace.kern_xy),
        n_xz: flatten(&workspace.kern_xz),
        n_yz: flatten(&workspace.kern_yz),
    }
}

pub fn compute_newell_kernel_spectra_thin_film_2d(
    nx: usize,
    ny: usize,
    dx: f64,
    dy: f64,
    dz: f64,
) -> DemagKernelSpectra {
    let nk = newell::compute_newell_kernels(nx, ny, 1, dx, dy, dz);
    let px = nk.px;
    let py = nk.py;
    let pz = 1usize;
    let plane_len = px * py;
    let zero = Complex::new(0.0, 0.0);
    let mut planner = FftPlanner::<f64>::new();
    let fwd_x = planner.plan_fft_forward(px);
    let fwd_y = planner.plan_fft_forward(py);
    let fwd_z = planner.plan_fft_forward(1);

    let fft_kernel_2d = |real_3d: Vec<f64>| -> Vec<Complex<f64>> {
        let mut plane = Vec::with_capacity(plane_len);
        for y in 0..py {
            for x in 0..px {
                plane.push(Complex::new(real_3d[padded_index(px, py, x, y, 0)], 0.0));
            }
        }
        let mut line_y_tmp = vec![zero; py];
        let mut line_z_tmp = vec![zero; 1];
        fft3_core(
            &mut plane,
            px,
            py,
            pz,
            &*fwd_x,
            &*fwd_y,
            &*fwd_z,
            &mut line_y_tmp,
            &mut line_z_tmp,
        );
        plane
    };

    let flatten = |values: &[Complex<f64>]| -> Vec<f64> {
        let mut flat = Vec::with_capacity(values.len() * 2);
        for value in values {
            flat.push(value.re);
            flat.push(value.im);
        }
        flat
    };

    let kern_xx = fft_kernel_2d(nk.n_xx);
    let kern_yy = fft_kernel_2d(nk.n_yy);
    let kern_zz = fft_kernel_2d(nk.n_zz);
    let kern_xy = fft_kernel_2d(nk.n_xy);
    let kern_xz = fft_kernel_2d(nk.n_xz);
    let kern_yz = fft_kernel_2d(nk.n_yz);

    DemagKernelSpectra {
        px,
        py,
        pz,
        n_xx: flatten(&kern_xx),
        n_yy: flatten(&kern_yy),
        n_zz: flatten(&kern_zz),
        n_xy: flatten(&kern_xy),
        n_xz: flatten(&kern_xz),
        n_yz: flatten(&kern_yz),
    }
}

// ── Free FFT functions ─────────────────────────────────────────────────

/// Core 3D FFT: operates on an external data slice using explicit plan/scratch refs.
///
/// When the `parallel` feature is enabled, the Y-axis and Z-axis transforms
/// are parallelised across independent lines using Rayon.  Each thread
/// allocates a thread-local scratch buffer (O(max(ny, nz))) so that lines
/// within the same z-slab / y-slab can be processed concurrently.
/// The X-axis transforms are **always already contiguous** in memory and are
/// parallelised trivially (each row is independent).
pub(crate) fn fft3_core(
    data: &mut [Complex<f64>],
    nx: usize,
    ny: usize,
    nz: usize,
    fft_x: &dyn Fft<f64>,
    fft_y: &dyn Fft<f64>,
    fft_z: &dyn Fft<f64>,
    _line_y: &mut [Complex<f64>],
    _line_z: &mut [Complex<f64>],
) {
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        use std::cell::RefCell;

        // Cast the mutable pointer to usize so it is Send+Sync and can be
        // shared across Rayon closures.  We convert back inside each closure.
        // SAFETY: the caller guarantees non-overlapping per-thread access.
        let data_base: usize = data.as_mut_ptr() as usize;
        let data_len = data.len();

        // ---- X-axis transforms: rows are contiguous, each (y,z) row independent ----
        let row_count = ny * nz;
        unsafe {
            (0..row_count).into_par_iter().for_each(|row_idx| {
                let start = row_idx * nx;
                debug_assert!(start + nx <= data_len);
                let ptr = data_base as *mut Complex<f64>;
                let row = std::slice::from_raw_parts_mut(ptr.add(start), nx);
                fft_x.process(row);
            });
        }

        // ---- Y-axis transforms: strided, gather/scatter with thread-local scratch ----
        thread_local! {
            static LINE_Y: RefCell<Vec<Complex<f64>>> = const { RefCell::new(Vec::new()) };
        }
        let col_count_y = nz * nx;
        unsafe {
            (0..col_count_y).into_par_iter().for_each(|col_idx| {
                let z = col_idx / nx;
                let x = col_idx % nx;
                let ptr = data_base as *mut Complex<f64>;
                LINE_Y.with(|cell| {
                    let mut line = cell.borrow_mut();
                    if line.len() < ny {
                        line.resize(ny, Complex::new(0.0, 0.0));
                    }
                    for y in 0..ny {
                        line[y] = *ptr.add(padded_index(nx, ny, x, y, z));
                    }
                    fft_y.process(&mut line[..ny]);
                    for y in 0..ny {
                        *ptr.add(padded_index(nx, ny, x, y, z)) = line[y];
                    }
                });
            });
        }

        // ---- Z-axis transforms: strided, gather/scatter with thread-local scratch ----
        thread_local! {
            static LINE_Z: RefCell<Vec<Complex<f64>>> = const { RefCell::new(Vec::new()) };
        }
        let col_count_z = ny * nx;
        unsafe {
            (0..col_count_z).into_par_iter().for_each(|col_idx| {
                let y = col_idx / nx;
                let x = col_idx % nx;
                let ptr = data_base as *mut Complex<f64>;
                LINE_Z.with(|cell| {
                    let mut line = cell.borrow_mut();
                    if line.len() < nz {
                        line.resize(nz, Complex::new(0.0, 0.0));
                    }
                    for z in 0..nz {
                        line[z] = *ptr.add(padded_index(nx, ny, x, y, z));
                    }
                    fft_z.process(&mut line[..nz]);
                    for z in 0..nz {
                        *ptr.add(padded_index(nx, ny, x, y, z)) = line[z];
                    }
                });
            });
        }
    }

    #[cfg(not(feature = "parallel"))]
    {
        // X-axis transforms (contiguous in memory)
        for z in 0..nz {
            for y in 0..ny {
                let start = padded_index(nx, ny, 0, y, z);
                fft_x.process(&mut data[start..start + nx]);
            }
        }

        // Y-axis transforms (strided, use scratch line)
        let mut line_y_buf = vec![Complex::new(0.0, 0.0); ny];
        for z in 0..nz {
            for x in 0..nx {
                for y in 0..ny {
                    line_y_buf[y] = data[padded_index(nx, ny, x, y, z)];
                }
                fft_y.process(&mut line_y_buf);
                for y in 0..ny {
                    data[padded_index(nx, ny, x, y, z)] = line_y_buf[y];
                }
            }
        }

        // Z-axis transforms (strided, use scratch line)
        let mut line_z_buf = vec![Complex::new(0.0, 0.0); nz];
        for y in 0..ny {
            for x in 0..nx {
                for z in 0..nz {
                    line_z_buf[z] = data[padded_index(nx, ny, x, y, z)];
                }
                fft_z.process(&mut line_z_buf);
                for z in 0..nz {
                    data[padded_index(nx, ny, x, y, z)] = line_z_buf[z];
                }
            }
        }
    }
}

/// 3D FFT using cached workspace plans (avoids per-call FftPlanner).
#[allow(dead_code)]
pub(crate) fn fft3_with_workspace(data: &mut [Complex<f64>], ws: &mut FftWorkspace, inverse: bool) {
    let (fft_x, fft_y, fft_z) = if inverse {
        (&*ws.inv_x, &*ws.inv_y, &*ws.inv_z)
    } else {
        (&*ws.fwd_x, &*ws.fwd_y, &*ws.fwd_z)
    };
    fft3_core(
        data,
        ws.px,
        ws.py,
        ws.pz,
        fft_x,
        fft_y,
        fft_z,
        &mut ws.line_y,
        &mut ws.line_z,
    );
}

/// Legacy wrapper — creates workspace on the fly (used only in tests).
#[allow(dead_code)]
pub(crate) fn fft3_in_place(data: &mut [Complex<f64>], nx: usize, ny: usize, nz: usize, inverse: bool) {
    let mut ws = FftWorkspace::new(nx / 2, ny / 2, nz / 2, 1.0, 1.0, 1.0);
    fft3_with_workspace(data, &mut ws, inverse);
}

pub(crate) fn padded_index(nx: usize, ny: usize, x: usize, y: usize, z: usize) -> usize {
    x + nx * (y + ny * z)
}

// ── Utility ────────────────────────────────────────────────────────────

/// Allocate a vector of zero 3-vectors.
pub(crate) fn zero_vectors(len: usize) -> Vec<Vector3> {
    vec![[0.0, 0.0, 0.0]; len]
}

/// Combine 4 field contributions into H_eff.
pub(crate) fn combine_fields_4(
    exchange_field: &[Vector3],
    demag_field: &[Vector3],
    external_field: &[Vector3],
    mel_field: &[Vector3],
) -> Vec<Vector3> {
    use crate::add;
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        (0..exchange_field.len())
            .into_par_iter()
            .map(|i| {
                add(
                    add(add(exchange_field[i], demag_field[i]), external_field[i]),
                    mel_field[i],
                )
            })
            .collect()
    }
    #[cfg(not(feature = "parallel"))]
    {
        (0..exchange_field.len())
            .map(|i| {
                add(
                    add(add(exchange_field[i], demag_field[i]), external_field[i]),
                    mel_field[i],
                )
            })
            .collect()
    }
}
