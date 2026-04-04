//! Sparse FEM linear algebra infrastructure (WP-05).
//!
//! Provides COO → CSR assembly from tetrahedral element stiffness matrices
//! and a simple diagonal-preconditioned Conjugate Gradient solver for SPD
//! systems (Poisson / Robin demag).
//!
//! The dense path in `fem.rs` is intentionally left unchanged.  This module
//! is additive: new code paths can migrate to sparse incrementally, measured
//! against the dense reference for parity.
//!
//! # Memory layout
//! `CsrMatrix` uses the standard row-major CSR layout:
//! - `row_ptr[i]..row_ptr[i+1]` indexes the non-zeros in row `i`,
//! - `col_idx[k]` is the column, `values[k]` is the entry,
//! - Storage is 0-indexed.

use std::collections::BTreeMap;

// ─────────────────────────────────────────────────────────────────────────────
// Public data types
// ─────────────────────────────────────────────────────────────────────────────

/// Compressed Sparse Row matrix (square or rectangular, f64).
#[derive(Debug, Clone, PartialEq)]
pub struct CsrMatrix {
    /// Number of rows (and columns for square systems).
    pub nrows: usize,
    /// Number of columns.
    pub ncols: usize,
    /// CSR row pointers: `row_ptr[i]..row_ptr[i+1]` is the range of non-zeros in row `i`.
    /// Length `nrows + 1`.
    pub row_ptr: Vec<usize>,
    /// Column indices of each non-zero.  Length == `nnz`.
    pub col_idx: Vec<u32>,
    /// Values of each non-zero.  Length == `nnz`.
    pub values: Vec<f64>,
}

impl CsrMatrix {
    /// Number of structural non-zeros.
    #[inline]
    pub fn nnz(&self) -> usize {
        self.values.len()
    }

    /// Apply `y = A * x` (matrix–vector multiply).
    pub fn matvec(&self, x: &[f64], y: &mut [f64]) {
        assert_eq!(x.len(), self.ncols);
        assert_eq!(y.len(), self.nrows);
        for i in 0..self.nrows {
            let mut acc = 0.0;
            for k in self.row_ptr[i]..self.row_ptr[i + 1] {
                acc += self.values[k] * x[self.col_idx[k] as usize];
            }
            y[i] = acc;
        }
    }

    /// Diagonal entries `A[i,i]`.  Missing diagonals are reported as 0.
    pub fn diagonal(&self) -> Vec<f64> {
        let mut diag = vec![0.0; self.nrows];
        for i in 0..self.nrows {
            for k in self.row_ptr[i]..self.row_ptr[i + 1] {
                if self.col_idx[k] as usize == i {
                    diag[i] = self.values[k];
                    break;
                }
            }
        }
        diag
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// COO intermediate structure and CsrMatrix builder
// ─────────────────────────────────────────────────────────────────────────────

/// Coordinate-list (COO) entry accumulator.
/// Duplicate (row, col) pairs are summed on conversion to CSR.
pub struct CooAssembler {
    nrows: usize,
    ncols: usize,
    /// Map `(row, col) → accumulated value`.
    entries: BTreeMap<(u32, u32), f64>,
}

impl CooAssembler {
    pub fn new(nrows: usize, ncols: usize) -> Self {
        Self {
            nrows,
            ncols,
            entries: BTreeMap::new(),
        }
    }

    /// Accumulate a scalar contribution at position `(row, col)`.
    #[inline]
    pub fn add(&mut self, row: usize, col: usize, value: f64) {
        *self.entries.entry((row as u32, col as u32)).or_insert(0.0) += value;
    }

    /// Add a 4×4 local element stiffness matrix for a tetrahedral element,
    /// given global node indices `nodes[4]`.
    pub fn add_tet_local(&mut self, nodes: &[u32; 4], local: &[[f64; 4]; 4]) {
        for i in 0..4 {
            for j in 0..4 {
                self.add(nodes[i] as usize, nodes[j] as usize, local[i][j]);
            }
        }
    }

    /// Add a 3×3 local boundary mass matrix for a triangular boundary face,
    /// given global node indices `face[3]`.
    pub fn add_tri_local(&mut self, face: &[u32; 3], local: &[[f64; 3]; 3]) {
        for i in 0..3 {
            for j in 0..3 {
                self.add(face[i] as usize, face[j] as usize, local[i][j]);
            }
        }
    }

    /// Convert accumulated COO entries to CSR.  Drops structurally zero
    /// entries (value == 0 after summation).
    pub fn into_csr(self) -> CsrMatrix {
        let nrows = self.nrows;
        let ncols = self.ncols;
        let mut row_ptr = vec![0usize; nrows + 1];
        let mut col_idx: Vec<u32> = Vec::with_capacity(self.entries.len());
        let mut values: Vec<f64> = Vec::with_capacity(self.entries.len());

        // Count non-zeros per row.
        for &(row, _col) in self.entries.keys() {
            row_ptr[row as usize + 1] += 1;
        }
        // Prefix sum to get row offsets.
        for i in 0..nrows {
            row_ptr[i + 1] += row_ptr[i];
        }
        // Fill col_idx and values.
        for ((row, col), val) in &self.entries {
            col_idx.push(*col);
            values.push(*val);
            let _ = row; // already counted
        }
        // BTreeMap iterates in (row, col) lexicographic order, so col_idx
        // within each row is automatically sorted ascending.

        CsrMatrix {
            nrows,
            ncols,
            row_ptr,
            col_idx,
            values,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Assemble FEM stiffness + Robin boundary mass from mesh topology data
// ─────────────────────────────────────────────────────────────────────────────

/// Assemble the Laplacian stiffness matrix K from per-element stiffness
/// matrices and optionally add the Robin boundary mass term β·M_∂Ω.
///
/// # Arguments
/// * `n_nodes` — total number of mesh nodes,
/// * `elements` — list of tetrahedral elements (4 global node indices each),
/// * `element_stiffness` — per-element 4×4 stiffness matrices (K_e),
/// * `boundary_faces` — list of triangular boundary faces (3 global node indices),
/// * `robin_beta` — Robin coefficient β; pass `0.0` to skip the boundary mass term.
///
/// Returns the assembled CSR matrix `K + β·M_∂Ω`.
pub fn assemble_stiffness_robin(
    n_nodes: usize,
    elements: &[[u32; 4]],
    element_stiffness: &[[[f64; 4]; 4]],
    nodes: &[[f64; 3]],
    boundary_faces: &[[u32; 3]],
    robin_beta: f64,
) -> CsrMatrix {
    let mut coo = CooAssembler::new(n_nodes, n_nodes);

    for (element, local) in elements.iter().zip(element_stiffness.iter()) {
        coo.add_tet_local(element, local);
    }

    if robin_beta != 0.0 {
        for face in boundary_faces {
            let p0 = nodes[face[0] as usize];
            let p1 = nodes[face[1] as usize];
            let p2 = nodes[face[2] as usize];
            let area = triangle_area(p0, p1, p2);
            let local = [
                [robin_beta * 2.0 * area / 12.0, robin_beta * area / 12.0, robin_beta * area / 12.0],
                [robin_beta * area / 12.0, robin_beta * 2.0 * area / 12.0, robin_beta * area / 12.0],
                [robin_beta * area / 12.0, robin_beta * area / 12.0, robin_beta * 2.0 * area / 12.0],
            ];
            coo.add_tri_local(face, &local);
        }
    }

    coo.into_csr()
}

// ─────────────────────────────────────────────────────────────────────────────
// Linear solver: diagonal-preconditioned Conjugate Gradient
// ─────────────────────────────────────────────────────────────────────────────

/// Convergence report from an iterative linear solve.
#[derive(Debug, Clone, PartialEq)]
pub struct LinearSolveReport {
    /// Number of iterations performed.
    pub iterations: u32,
    /// Absolute residual `‖r‖₂` at termination.
    pub abs_residual: f64,
    /// Relative residual `‖r‖₂ / ‖b‖₂` at termination.
    pub rel_residual: f64,
    /// Whether the solver converged within tolerance.
    pub converged: bool,
}

/// Error from iterative linear solve.
#[derive(Debug, Clone, PartialEq)]
pub struct LinearSolveError {
    pub message: String,
}

impl std::fmt::Display for LinearSolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "linear solve failed: {}", self.message)
    }
}

impl std::error::Error for LinearSolveError {}

/// Solve `A·x = b` using the diagonal-preconditioned Conjugate Gradient method.
///
/// `A` must be symmetric positive definite (SPD).  Initial guess `x` is
/// used as the starting point (initialise to zero for a cold start).
///
/// # Arguments
/// * `a`         — SPD sparse system matrix,
/// * `b`         — right-hand side vector,
/// * `x`         — initial guess / solution output (length `n`),
/// * `tol`       — relative residual tolerance (`‖r‖₂ / ‖b‖₂ < tol`),
/// * `max_iter`  — maximum number of CG iterations.
pub fn pcg_solve(
    a: &CsrMatrix,
    b: &[f64],
    x: &mut [f64],
    tol: f64,
    max_iter: u32,
) -> Result<LinearSolveReport, LinearSolveError> {
    let n = a.nrows;
    if n == 0 {
        return Ok(LinearSolveReport {
            iterations: 0,
            abs_residual: 0.0,
            rel_residual: 0.0,
            converged: true,
        });
    }
    if b.len() != n || x.len() != n {
        return Err(LinearSolveError {
            message: format!(
                "dimension mismatch: A is {}x{}, b has {}, x has {}",
                n, n, b.len(), x.len()
            ),
        });
    }

    // Diagonal preconditioner: M⁻¹ = diag(A)⁻¹ (Jacobi).
    let diag = a.diagonal();
    let m_inv: Vec<f64> = diag
        .iter()
        .map(|&d| if d.abs() > 1e-300 { 1.0 / d } else { 1.0 })
        .collect();

    let b_norm = l2_norm(b);
    if b_norm == 0.0 {
        x.fill(0.0);
        return Ok(LinearSolveReport {
            iterations: 0,
            abs_residual: 0.0,
            rel_residual: 0.0,
            converged: true,
        });
    }

    // r = b - A·x
    let mut r = vec![0.0; n];
    a.matvec(x, &mut r);
    for i in 0..n {
        r[i] = b[i] - r[i];
    }

    // z = M⁻¹ · r
    let mut z: Vec<f64> = r.iter().zip(m_inv.iter()).map(|(&ri, &mi)| ri * mi).collect();
    let mut p = z.clone();
    let mut rz = dot_product(&r, &z);

    let mut ap = vec![0.0; n];

    for iter in 0..max_iter {
        a.matvec(&p, &mut ap);
        let pap = dot_product(&p, &ap);
        if pap.abs() <= 1e-300 {
            break;
        }
        let alpha = rz / pap;

        for i in 0..n {
            x[i] += alpha * p[i];
            r[i] -= alpha * ap[i];
        }

        let abs_res = l2_norm(&r);
        let rel_res = abs_res / b_norm;

        if rel_res < tol {
            return Ok(LinearSolveReport {
                iterations: iter + 1,
                abs_residual: abs_res,
                rel_residual: rel_res,
                converged: true,
            });
        }

        // z = M⁻¹ · r
        for i in 0..n {
            z[i] = r[i] * m_inv[i];
        }
        let rz_new = dot_product(&r, &z);
        let beta = rz_new / rz;
        rz = rz_new;

        for i in 0..n {
            p[i] = z[i] + beta * p[i];
        }
    }

    let abs_res = l2_norm(&r);
    let rel_res = abs_res / b_norm;
    Ok(LinearSolveReport {
        iterations: max_iter,
        abs_residual: abs_res,
        rel_residual: rel_res,
        converged: rel_res < tol,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

fn dot_product(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(&ai, &bi)| ai * bi).sum()
}

fn l2_norm(v: &[f64]) -> f64 {
    dot_product(v, v).sqrt()
}

fn triangle_area(p0: [f64; 3], p1: [f64; 3], p2: [f64; 3]) -> f64 {
    let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let cx = e1[1] * e2[2] - e1[2] * e2[1];
    let cy = e1[2] * e2[0] - e1[0] * e2[2];
    let cz = e1[0] * e2[1] - e1[1] * e2[0];
    0.5 * (cx * cx + cy * cy + cz * cz).sqrt()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a simple 5-point 1-D Laplacian: tridiagonal [-1, 2, -1] (periodic removed).
    fn tridiagonal_laplacian(n: usize) -> CsrMatrix {
        let mut coo = CooAssembler::new(n, n);
        for i in 0..n {
            coo.add(i, i, 2.0);
            if i > 0 {
                coo.add(i, i - 1, -1.0);
                coo.add(i - 1, i, -1.0);
            }
        }
        coo.into_csr()
    }

    #[test]
    fn csr_matvec_identity() {
        let n = 4;
        let mut coo = CooAssembler::new(n, n);
        for i in 0..n {
            coo.add(i, i, 1.0);
        }
        let identity = coo.into_csr();
        let x = vec![1.0, 2.0, 3.0, 4.0];
        let mut y = vec![0.0; n];
        identity.matvec(&x, &mut y);
        assert_eq!(y, x);
    }

    #[test]
    fn csr_matvec_laplacian() {
        // 3-point stencil: [2, -1; -1, 2]
        let laplacian = tridiagonal_laplacian(2);
        let x = vec![1.0, 0.0];
        let mut y = vec![0.0; 2];
        laplacian.matvec(&x, &mut y);
        // [2·1 + (-1)·0, (-1)·1 + 2·0] = [2, -1]
        assert!((y[0] - 2.0).abs() < 1e-14);
        assert!((y[1] + 1.0).abs() < 1e-14);
    }

    #[test]
    fn coo_duplicate_entries_are_summed() {
        let mut coo = CooAssembler::new(2, 2);
        coo.add(0, 0, 1.0);
        coo.add(0, 0, 1.0); // duplicate
        coo.add(0, 0, 1.0); // triplicate
        let csr = coo.into_csr();
        assert!((csr.values[0] - 3.0).abs() < 1e-14);
    }

    #[test]
    fn pcg_solves_laplacian() {
        let n = 8;
        let a = tridiagonal_laplacian(n);
        // b = A · x_exact, with x_exact = [1, 2, ..., n]
        let x_exact: Vec<f64> = (1..=n).map(|i| i as f64).collect();
        let mut b = vec![0.0; n];
        a.matvec(&x_exact, &mut b);

        let mut x = vec![0.0; n];
        let report = pcg_solve(&a, &b, &mut x, 1e-10, 200).expect("PCG failed");

        assert!(report.converged, "PCG did not converge: {:?}", report);
        for (xi, xe) in x.iter().zip(x_exact.iter()) {
            assert!((xi - xe).abs() < 1e-8, "solution mismatch: {xi} vs {xe}");
        }
    }

    #[test]
    fn pcg_zero_rhs_returns_zero_solution() {
        let n = 4;
        let a = tridiagonal_laplacian(n);
        let b = vec![0.0; n];
        let mut x = vec![1.0; n]; // non-zero initial guess
        let report = pcg_solve(&a, &b, &mut x, 1e-12, 100).unwrap();
        assert!(report.converged);
        for &xi in &x {
            assert!(xi.abs() < 1e-14);
        }
    }

    #[test]
    fn assemble_stiffness_without_robin_is_laplacian_like() {
        // Single unit tetrahedron: nodes at (0,0,0),(1,0,0),(0,1,0),(0,0,1).
        let nodes: Vec<[f64; 3]> = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ];
        let elements: Vec<[u32; 4]> = vec![[0, 1, 2, 3]];
        // Compute element stiffness manually.
        let d1 = [1.0, 0.0, 0.0f64];
        let d2 = [0.0, 1.0, 0.0f64];
        let d3 = [0.0, 0.0, 1.0f64];
        let det = d1[0] * (d2[1] * d3[2] - d2[2] * d3[1])
            - d1[1] * (d2[0] * d3[2] - d2[2] * d3[0])
            + d1[2] * (d2[0] * d3[1] - d2[1] * d3[0]);
        let vol = det.abs() / 6.0;

        // For unit tet, grads are known: grad_phi_1=(1,0,0), etc.
        // K_ij = vol * dot(grad_i, grad_j)
        // grad_0 = -(grad_1 + grad_2 + grad_3) = (-1,-1,-1)
        let gradients: [[f64; 3]; 4] = [
            [-1.0, -1.0, -1.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ];
        let mut local = [[0.0f64; 4]; 4];
        for i in 0..4 {
            for j in 0..4 {
                let dp = gradients[i][0] * gradients[j][0]
                    + gradients[i][1] * gradients[j][1]
                    + gradients[i][2] * gradients[j][2];
                local[i][j] = vol * dp;
            }
        }
        let element_stiffness = vec![local];

        let a = assemble_stiffness_robin(
            nodes.len(),
            &elements,
            &element_stiffness,
            &nodes,
            &[],   // no boundary faces
            0.0,   // no Robin
        );

        // Symmetry check: A[i,j] == A[j,i]
        for i in 0..4 {
            for j in 0..4 {
                let aij = {
                    let row = a.row_ptr[i]..a.row_ptr[i + 1];
                    a.col_idx[row.clone()]
                        .iter()
                        .zip(&a.values[row])
                        .find(|(&c, _)| c as usize == j)
                        .map(|(_, &v)| v)
                        .unwrap_or(0.0)
                };
                let aji = {
                    let row = a.row_ptr[j]..a.row_ptr[j + 1];
                    a.col_idx[row.clone()]
                        .iter()
                        .zip(&a.values[row])
                        .find(|(&c, _)| c as usize == i)
                        .map(|(_, &v)| v)
                        .unwrap_or(0.0)
                };
                assert!(
                    (aij - aji).abs() < 1e-14,
                    "K[{i},{j}]={aij} != K[{j},{i}]={aji}"
                );
            }
        }
        // Row sums of consistent stiffness for Laplacian should be 0 (Neumann
        // consistency: K 1 = 0  for pure stiffness without any BC).
        for i in 0..4 {
            let row_sum: f64 = {
                let range = a.row_ptr[i]..a.row_ptr[i + 1];
                a.values[range].iter().sum()
            };
            assert!(row_sum.abs() < 1e-13, "row {i} sum = {row_sum}");
        }
    }
}
