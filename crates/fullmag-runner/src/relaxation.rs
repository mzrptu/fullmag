use fullmag_ir::RelaxationControlIR;

use crate::types::StepStats;

pub(crate) fn relaxation_converged(
    control: &RelaxationControlIR,
    stats: &StepStats,
    previous_total_energy: Option<f64>,
    gyromagnetic_ratio: f64,
    damping: f64,
) -> bool {
    let max_torque = approximate_max_torque(stats.max_dm_dt, gyromagnetic_ratio, damping);
    if max_torque > control.torque_tolerance {
        return false;
    }
    match (control.energy_tolerance, previous_total_energy) {
        (Some(energy_tolerance), Some(previous_energy)) => {
            (previous_energy - stats.e_total).abs() <= energy_tolerance
        }
        (Some(_), None) => false,
        (None, _) => true,
    }
}

pub(crate) fn approximate_max_torque(max_dm_dt: f64, gyromagnetic_ratio: f64, damping: f64) -> f64 {
    if gyromagnetic_ratio <= 0.0 {
        return f64::INFINITY;
    }
    max_dm_dt * (1.0 + damping * damping).sqrt() / gyromagnetic_ratio
}
