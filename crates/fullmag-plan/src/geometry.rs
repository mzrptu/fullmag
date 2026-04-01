use fullmag_ir::{FdmHintsIR, FdmMaterialIR, GeometryEntryIR};

use crate::util::GRID_TOLERANCE;

#[derive(Debug, Clone)]
pub(crate) enum GeometryShape {
    Box {
        size: [f64; 3],
    },
    Cylinder {
        radius: f64,
        height: f64,
    },
    Imported {
        source: String,
        format: String,
    },
    Difference {
        base: std::boxed::Box<GeometryShape>,
        tool: std::boxed::Box<GeometryShape>,
    },
}

#[derive(Debug, Clone)]
pub(crate) struct PlacedGeometry {
    pub name: String,
    pub shape: GeometryShape,
    pub translation: [f64; 3],
}

#[derive(Debug, Clone)]
pub(crate) struct LoweredBody {
    pub magnet_name: String,
    pub bounding_size: [f64; 3],
    pub native_grid: [u32; 3],
    pub native_cell_size: [f64; 3],
    pub native_origin: [f64; 3],
    pub native_active_mask: Option<Vec<bool>>,
    pub initial_magnetization: Vec<[f64; 3]>,
    pub material: FdmMaterialIR,
}

pub(crate) fn ir_to_shape(entry: &GeometryEntryIR) -> GeometryShape {
    match entry {
        GeometryEntryIR::Box { size, .. } => GeometryShape::Box { size: *size },
        GeometryEntryIR::Cylinder { radius, height, .. } => GeometryShape::Cylinder {
            radius: *radius,
            height: *height,
        },
        GeometryEntryIR::ImportedGeometry { source, format, .. } => GeometryShape::Imported {
            source: source.clone(),
            format: format.clone(),
        },
        GeometryEntryIR::Difference { base, tool, .. } => GeometryShape::Difference {
            base: std::boxed::Box::new(ir_to_shape(base)),
            tool: std::boxed::Box::new(ir_to_shape(tool)),
        },
        GeometryEntryIR::Union { a, .. } => ir_to_shape(a),
        GeometryEntryIR::Intersection { a, .. } => ir_to_shape(a),
        GeometryEntryIR::Translate { base, .. } => ir_to_shape(base),
        GeometryEntryIR::Ellipsoid { radii, .. } => GeometryShape::Box {
            size: [radii[0] * 2.0, radii[1] * 2.0, radii[2] * 2.0],
        },
        GeometryEntryIR::Sphere { radius, .. } => GeometryShape::Box {
            size: [*radius * 2.0, *radius * 2.0, *radius * 2.0],
        },
        GeometryEntryIR::Ellipse { radii, height, .. } => GeometryShape::Cylinder {
            radius: radii[0].max(radii[1]),
            height: *height,
        },
    }
}

pub(crate) fn extract_multilayer_geometry(
    entry: &GeometryEntryIR,
) -> Result<PlacedGeometry, String> {
    match entry {
        GeometryEntryIR::Translate { name, base, by } => {
            let mut placed = extract_multilayer_geometry(base)?;
            placed.name = name.clone();
            for axis in 0..3 {
                placed.translation[axis] += by[axis];
            }
            Ok(placed)
        }
        GeometryEntryIR::Box { .. }
        | GeometryEntryIR::Cylinder { .. }
        | GeometryEntryIR::ImportedGeometry { .. }
        | GeometryEntryIR::Difference { .. } => Ok(PlacedGeometry {
            name: entry.name().to_string(),
            shape: ir_to_shape(entry),
            translation: [0.0, 0.0, 0.0],
        }),
        GeometryEntryIR::Union { .. } | GeometryEntryIR::Intersection { .. } => Err(format!(
            "geometry '{}' uses CSG union/intersection which is not yet supported by the public multilayer planner; use Box/Cylinder/Difference with optional Translate",
            entry.name()
        )),
        GeometryEntryIR::Ellipsoid { .. }
        | GeometryEntryIR::Sphere { .. }
        | GeometryEntryIR::Ellipse { .. } => Err(format!(
            "geometry '{}' is not yet supported by the public multilayer planner; use Box/Cylinder/Difference with optional Translate",
            entry.name()
        )),
    }
}

pub(crate) fn voxelize_shape(
    shape: &GeometryShape,
    cell_size: [f64; 3],
    errors: &mut Vec<String>,
) -> ([f64; 3], Option<Vec<bool>>, [u32; 3]) {
    match shape {
        GeometryShape::Box { size } => {
            let grid_cells = [
                (size[0] / cell_size[0]).round().max(1.0) as u32,
                (size[1] / cell_size[1]).round().max(1.0) as u32,
                (size[2] / cell_size[2]).round().max(1.0) as u32,
            ];
            (*size, None, grid_cells)
        }
        GeometryShape::Cylinder { radius, height } => {
            let diameter = 2.0 * radius;
            let bbox = [diameter, diameter, *height];
            let nx = (bbox[0] / cell_size[0]).round().max(1.0) as u32;
            let ny = (bbox[1] / cell_size[1]).round().max(1.0) as u32;
            let nz = (bbox[2] / cell_size[2]).round().max(1.0) as u32;
            let n = (nx * ny * nz) as usize;
            let cx = nx as f64 * cell_size[0] * 0.5;
            let cy = ny as f64 * cell_size[1] * 0.5;
            let r2 = radius * radius;
            let mut mask = vec![false; n];
            for z in 0..nz {
                for y in 0..ny {
                    for x in 0..nx {
                        let px = (x as f64 + 0.5) * cell_size[0] - cx;
                        let py = (y as f64 + 0.5) * cell_size[1] - cy;
                        let idx = (x + nx * (y + ny * z)) as usize;
                        mask[idx] = (px * px + py * py) <= r2;
                    }
                }
            }
            (bbox, Some(mask), [nx, ny, nz])
        }
        GeometryShape::Imported { source, format } => {
            errors.push(format!(
                "geometry '{}:{}' requires a precomputed FDM grid asset in the public multilayer planner",
                format, source
            ));
            ([1.0, 1.0, 1.0], None, [1, 1, 1])
        }
        GeometryShape::Difference { base, tool } => {
            let bbox = match base.as_ref() {
                GeometryShape::Box { size } => *size,
                GeometryShape::Cylinder { radius, height } => [2.0 * radius, 2.0 * radius, *height],
                _ => {
                    errors.push("CSG Difference: base must be a Box or Cylinder".to_string());
                    [1.0, 1.0, 1.0]
                }
            };
            let nx = (bbox[0] / cell_size[0]).round().max(1.0) as u32;
            let ny = (bbox[1] / cell_size[1]).round().max(1.0) as u32;
            let nz = (bbox[2] / cell_size[2]).round().max(1.0) as u32;
            let n = (nx * ny * nz) as usize;
            let mut mask = vec![true; n];
            if let GeometryShape::Cylinder { radius, .. } = base.as_ref() {
                let cx = nx as f64 * cell_size[0] * 0.5;
                let cy = ny as f64 * cell_size[1] * 0.5;
                let r2 = radius * radius;
                for z in 0..nz {
                    for y in 0..ny {
                        for x in 0..nx {
                            let px = (x as f64 + 0.5) * cell_size[0] - cx;
                            let py = (y as f64 + 0.5) * cell_size[1] - cy;
                            let idx = (x + nx * (y + ny * z)) as usize;
                            mask[idx] = (px * px + py * py) <= r2;
                        }
                    }
                }
            }

            match tool.as_ref() {
                GeometryShape::Cylinder { radius, .. } => {
                    let cx = nx as f64 * cell_size[0] * 0.5;
                    let cy = ny as f64 * cell_size[1] * 0.5;
                    let r2 = radius * radius;
                    for z in 0..nz {
                        for y in 0..ny {
                            for x in 0..nx {
                                let px = (x as f64 + 0.5) * cell_size[0] - cx;
                                let py = (y as f64 + 0.5) * cell_size[1] - cy;
                                let idx = (x + nx * (y + ny * z)) as usize;
                                if (px * px + py * py) <= r2 {
                                    mask[idx] = false;
                                }
                            }
                        }
                    }
                }
                GeometryShape::Box { size: tool_size } => {
                    let hx = tool_size[0] * 0.5;
                    let hy = tool_size[1] * 0.5;
                    let cx = nx as f64 * cell_size[0] * 0.5;
                    let cy = ny as f64 * cell_size[1] * 0.5;
                    for z in 0..nz {
                        for y in 0..ny {
                            for x in 0..nx {
                                let px = (x as f64 + 0.5) * cell_size[0] - cx;
                                let py = (y as f64 + 0.5) * cell_size[1] - cy;
                                let idx = (x + nx * (y + ny * z)) as usize;
                                if px.abs() <= hx && py.abs() <= hy {
                                    mask[idx] = false;
                                }
                            }
                        }
                    }
                }
                _ => {
                    errors.push("CSG Difference: tool must be a Box or Cylinder".to_string());
                }
            }

            (bbox, Some(mask), [nx, ny, nz])
        }
    }
}

pub(crate) fn validate_realized_grid(
    label: &str,
    requested_size: [f64; 3],
    realized_cells: [u32; 3],
    cell_size: [f64; 3],
    errors: &mut Vec<String>,
) {
    let realized_size = [
        realized_cells[0] as f64 * cell_size[0],
        realized_cells[1] as f64 * cell_size[1],
        realized_cells[2] as f64 * cell_size[2],
    ];
    for axis in 0..3 {
        if requested_size[axis] <= 0.0 {
            continue;
        }
        let rel_err = (realized_size[axis] - requested_size[axis]).abs() / requested_size[axis];
        if rel_err > GRID_TOLERANCE {
            let axis_name = ["x", "y", "z"][axis];
            errors.push(format!(
                "{} size along {} ({:.6e} m) is not an integer multiple of cell size ({:.6e} m); realized grid would be {:.6e} m (relative error {:.2e})",
                label,
                axis_name,
                requested_size[axis],
                cell_size[axis],
                realized_size[axis],
                rel_err
            ));
        }
    }
}

pub(crate) fn fdm_default_cell(hints: &FdmHintsIR) -> [f64; 3] {
    hints.default_cell.unwrap_or(hints.cell)
}

pub(crate) fn cell_for_magnet(hints: &FdmHintsIR, magnet_name: &str) -> [f64; 3] {
    hints
        .per_magnet
        .as_ref()
        .and_then(|per_magnet| per_magnet.get(magnet_name))
        .map(|grid| grid.cell)
        .unwrap_or_else(|| fdm_default_cell(hints))
}
