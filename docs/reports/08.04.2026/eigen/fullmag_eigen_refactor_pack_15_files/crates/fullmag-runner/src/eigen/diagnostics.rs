use nalgebra::{DMatrix, DVector};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ResidualRow {
    pub mode_index: usize,
    pub residual_l2: f64,
    pub residual_linf: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrthogonalityEntry {
    pub lhs_mode_index: usize,
    pub rhs_mode_index: usize,
    pub mass_inner_product: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TangentLeakageRow {
    pub mode_index: usize,
    pub leakage_mean_abs: f64,
    pub leakage_max_abs: f64,
}

pub fn residual_rows(
    stiffness: &DMatrix<f64>,
    mass: &DMatrix<f64>,
    eigenpairs: &[(f64, DVector<f64>)],
) -> Vec<ResidualRow> {
    eigenpairs
        .iter()
        .enumerate()
        .map(|(mode_index, (eigenvalue, vector))| {
            let residual = stiffness * vector - mass * vector * *eigenvalue;
            let residual_l2 = residual.norm();
            let residual_linf = residual
                .iter()
                .fold(0.0_f64, |acc, value| acc.max(value.abs()));
            ResidualRow {
                mode_index,
                residual_l2,
                residual_linf,
            }
        })
        .collect()
}

pub fn orthogonality_table(
    mass: &DMatrix<f64>,
    modes: &[DVector<f64>],
) -> Vec<OrthogonalityEntry> {
    let mut rows = Vec::new();
    for (lhs_index, lhs) in modes.iter().enumerate() {
        for (rhs_index, rhs) in modes.iter().enumerate() {
            let value = lhs.dot(&(mass * rhs));
            rows.push(OrthogonalityEntry {
                lhs_mode_index: lhs_index,
                rhs_mode_index: rhs_index,
                mass_inner_product: value,
            });
        }
    }
    rows
}

pub fn tangent_leakage(
    equilibrium: &[[f64; 3]],
    lifted_modes: &[Vec<[f64; 3]>],
) -> Vec<TangentLeakageRow> {
    lifted_modes
        .iter()
        .enumerate()
        .map(|(mode_index, mode)| {
            let mut values = Vec::new();
            for (m0, dm) in equilibrium.iter().zip(mode.iter()) {
                let dot = m0[0] * dm[0] + m0[1] * dm[1] + m0[2] * dm[2];
                values.push(dot.abs());
            }
            let leakage_mean_abs = if values.is_empty() {
                0.0
            } else {
                values.iter().sum::<f64>() / values.len() as f64
            };
            let leakage_max_abs = values
                .iter()
                .copied()
                .fold(0.0_f64, |acc, value| acc.max(value));
            TangentLeakageRow {
                mode_index,
                leakage_mean_abs,
                leakage_max_abs,
            }
        })
        .collect()
}
