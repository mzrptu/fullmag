use std::f64::consts::PI;

use fullmag_ir::{AntennaIR, CurrentModuleIR, FemPlanIR};

use crate::types::RunError;

const FIELD_EPSILON2: f64 = 1e-30;

pub(crate) fn compute_antenna_field(plan: &FemPlanIR) -> Result<Vec<[f64; 3]>, RunError> {
    if plan.current_modules.is_empty() {
        return Ok(vec![[0.0, 0.0, 0.0]; plan.mesh.nodes.len()]);
    }

    let Some(bounds) = magnetic_bounds(plan) else {
        return Ok(vec![[0.0, 0.0, 0.0]; plan.mesh.nodes.len()]);
    };

    let mut total = vec![[0.0, 0.0, 0.0]; plan.mesh.nodes.len()];
    for module in &plan.current_modules {
        match module {
            CurrentModuleIR::AntennaFieldSource { antenna, drive, .. } => {
                add_antenna_field(&mut total, &plan.mesh.nodes, bounds, antenna, drive.current_a);
            }
        }
    }
    Ok(total)
}

fn add_antenna_field(
    total: &mut [[f64; 3]],
    nodes: &[[f64; 3]],
    magnetic_bounds: ([f64; 3], [f64; 3]),
    antenna: &AntennaIR,
    current_a: f64,
) {
    let ([min_x, min_y, _min_z], [max_x, max_y, max_z]) = magnetic_bounds;
    let center_x0 = 0.5 * (min_x + max_x);
    let center_y0 = 0.5 * (min_y + max_y);

    match antenna {
        AntennaIR::Microstrip {
            width,
            thickness,
            height_above_magnet,
            center_x,
            center_y,
            ..
        } => {
            let z_center = max_z + height_above_magnet + 0.5 * thickness;
            add_rectangular_conductor(
                total,
                nodes,
                center_x0 + center_x,
                center_y0 + center_y,
                z_center,
                *width,
                *thickness,
                current_a,
            );
        }
        AntennaIR::Cpw {
            signal_width,
            gap,
            ground_width,
            thickness,
            height_above_magnet,
            center_x,
            center_y,
            ..
        } => {
            let z_center = max_z + height_above_magnet + 0.5 * thickness;
            let x_center = center_x0 + center_x;
            let y_center = center_y0 + center_y;
            let ground_offset = 0.5 * signal_width + gap + 0.5 * ground_width;
            add_rectangular_conductor(
                total,
                nodes,
                x_center,
                y_center,
                z_center,
                *signal_width,
                *thickness,
                current_a,
            );
            add_rectangular_conductor(
                total,
                nodes,
                x_center - ground_offset,
                y_center,
                z_center,
                *ground_width,
                *thickness,
                -0.5 * current_a,
            );
            add_rectangular_conductor(
                total,
                nodes,
                x_center + ground_offset,
                y_center,
                z_center,
                *ground_width,
                *thickness,
                -0.5 * current_a,
            );
        }
    }
}

fn add_rectangular_conductor(
    total: &mut [[f64; 3]],
    nodes: &[[f64; 3]],
    x_center: f64,
    _y_center: f64,
    z_center: f64,
    width: f64,
    thickness: f64,
    current_a: f64,
) {
    if width <= 0.0 || thickness <= 0.0 || current_a == 0.0 {
        return;
    }

    let samples_x = quadrature_samples(width, thickness);
    let samples_z = quadrature_samples(thickness, width).min(8);
    let sample_count = (samples_x * samples_z) as f64;
    let sample_current = current_a / sample_count;
    let x0 = x_center - 0.5 * width;
    let z0 = z_center - 0.5 * thickness;

    for ix in 0..samples_x {
        let sx = x0 + (ix as f64 + 0.5) * width / samples_x as f64;
        for iz in 0..samples_z {
            let sz = z0 + (iz as f64 + 0.5) * thickness / samples_z as f64;
            for (node, field) in nodes.iter().zip(total.iter_mut()) {
                let rx = node[0] - sx;
                let rz = node[2] - sz;
                let r2 = (rx * rx + rz * rz).max(FIELD_EPSILON2);
                let coeff = sample_current / (2.0 * PI * r2);
                field[0] += -rz * coeff;
                field[2] += rx * coeff;
            }
        }
    }
}

fn quadrature_samples(primary: f64, secondary: f64) -> usize {
    let aspect = if secondary > 0.0 {
        (primary / secondary).abs()
    } else {
        1.0
    };
    aspect.round().clamp(4.0, 16.0) as usize
}

fn magnetic_bounds(plan: &FemPlanIR) -> Option<([f64; 3], [f64; 3])> {
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    let mut found = false;

    for (element, marker) in plan.mesh.elements.iter().zip(plan.mesh.element_markers.iter()) {
        if *marker == 0 {
            continue;
        }
        for &node_idx in element {
            let node = plan.mesh.nodes.get(node_idx as usize)?;
            for axis in 0..3 {
                min[axis] = min[axis].min(node[axis]);
                max[axis] = max[axis].max(node[axis]);
            }
            found = true;
        }
    }

    if found {
        Some((min, max))
    } else if let Some(first) = plan.mesh.nodes.first() {
        let mut min = *first;
        let mut max = *first;
        for node in &plan.mesh.nodes[1..] {
            for axis in 0..3 {
                min[axis] = min[axis].min(node[axis]);
                max[axis] = max[axis].max(node[axis]);
            }
        }
        Some((min, max))
    } else {
        None
    }
}
