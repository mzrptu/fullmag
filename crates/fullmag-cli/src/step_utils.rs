use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use fullmag_ir::{BackendPlanIR, ProblemIR};

use crate::live_workspace::LocalLiveWorkspace;
use crate::types::{LiveStateManifest, LiveStepView, ResolvedScriptStage, RunManifest, ScriptExecutionConfig};
use crate::formatting::unix_time_millis;

pub(crate) fn emit_initial_state_warnings(
    live_workspace: Option<&LocalLiveWorkspace>,
    backend_plan: &BackendPlanIR,
) -> Result<()> {
    let diagnostic = crate::diagnostics::diagnose_initial_backend_plan(backend_plan)?;
    for warning in diagnostic.warnings {
        eprintln!("fullmag diagnostic warning: {}", warning);
        if let Some(workspace) = live_workspace {
            workspace.push_log("warning", warning);
        }
    }
    Ok(())
}

pub(crate) fn offset_step_update(
    update: &fullmag_runner::StepUpdate,
    step_offset: u64,
    time_offset: f64,
    finished: bool,
) -> fullmag_runner::StepUpdate {
    let mut adjusted = update.clone();
    adjusted.stats.step += step_offset;
    adjusted.stats.time += time_offset;
    adjusted.finished = finished;
    adjusted
}

pub(crate) fn offset_step_stats(
    steps: &[fullmag_runner::StepStats],
    step_offset: u64,
    time_offset: f64,
) -> Vec<fullmag_runner::StepStats> {
    steps
        .iter()
        .cloned()
        .map(|mut step| {
            step.step += step_offset;
            step.time += time_offset;
            step
        })
        .collect()
}

pub(crate) fn stage_artifact_dir(
    workspace_dir: &Path,
    artifact_dir: &Path,
    stage_index: usize,
    total_stages: usize,
    entrypoint_kind: &str,
) -> PathBuf {
    if stage_index + 1 == total_stages {
        return artifact_dir.to_path_buf();
    }
    workspace_dir
        .join("stages")
        .join(format!("stage_{stage_index:02}_{entrypoint_kind}"))
}

pub(crate) fn flatten_magnetization(values: &[[f64; 3]]) -> Vec<f64> {
    values
        .iter()
        .flat_map(|value| value.iter().copied())
        .collect()
}

pub(crate) fn live_state_manifest_from_update(update: &fullmag_runner::StepUpdate) -> LiveStateManifest {
    LiveStateManifest {
        status: if update.finished {
            "completed".to_string()
        } else {
            "running".to_string()
        },
        updated_at_unix_ms: unix_time_millis().unwrap_or(0),
        latest_step: LiveStepView {
            step: update.stats.step,
            time: update.stats.time,
            dt: update.stats.dt,
            e_ex: update.stats.e_ex,
            e_demag: update.stats.e_demag,
            e_ext: update.stats.e_ext,
            e_total: update.stats.e_total,
            max_dm_dt: update.stats.max_dm_dt,
            max_h_eff: update.stats.max_h_eff,
            max_h_demag: update.stats.max_h_demag,
            wall_time_ns: update.stats.wall_time_ns,
            grid: update.grid,
            fem_mesh: update.fem_mesh.clone(),
            magnetization: update.magnetization.clone(),
            preview_field: update.preview_field.clone(),
            finished: update.finished,
        },
    }
}

pub(crate) fn running_run_manifest_from_update(
    run_id: &str,
    session_id: &str,
    artifact_dir: &Path,
    update: &fullmag_runner::StepUpdate,
) -> RunManifest {
    RunManifest {
        run_id: run_id.to_string(),
        session_id: session_id.to_string(),
        status: if update.finished {
            "completed".to_string()
        } else {
            "running".to_string()
        },
        total_steps: update.stats.step as usize,
        final_time: Some(update.stats.time),
        final_e_ex: Some(update.stats.e_ex),
        final_e_demag: Some(update.stats.e_demag),
        final_e_ext: Some(update.stats.e_ext),
        final_e_total: Some(update.stats.e_total),
        artifact_dir: artifact_dir.display().to_string(),
    }
}

pub(crate) fn initial_step_update(backend_plan: &BackendPlanIR) -> fullmag_runner::StepUpdate {
    let stats = fullmag_runner::StepStats {
        step: 0,
        time: 0.0,
        dt: 0.0,
        e_ex: 0.0,
        e_demag: 0.0,
        e_ext: 0.0,
        e_total: 0.0,
        max_dm_dt: 0.0,
        max_h_eff: 0.0,
        max_h_demag: 0.0,
        wall_time_ns: 0,
        ..fullmag_runner::StepStats::default()
    };

    match backend_plan {
        BackendPlanIR::Fdm(fdm) => fullmag_runner::StepUpdate {
            stats,
            grid: [fdm.grid.cells[0], fdm.grid.cells[1], fdm.grid.cells[2]],
            fem_mesh: None,
            magnetization: Some(flatten_magnetization(&fdm.initial_magnetization)),
            preview_field: None,
            scalar_row_due: false,
            finished: false,
        },
        BackendPlanIR::FdmMultilayer(fdm) => fullmag_runner::StepUpdate {
            stats,
            grid: [
                fdm.common_cells[0],
                fdm.common_cells[1],
                fdm.common_cells[2],
            ],
            fem_mesh: None,
            magnetization: None,
            preview_field: None,
            scalar_row_due: false,
            finished: false,
        },
        BackendPlanIR::Fem(fem) => fullmag_runner::StepUpdate {
            stats,
            grid: [0, 0, 0],
            fem_mesh: Some(fullmag_runner::FemMeshPayload {
                nodes: fem.mesh.nodes.clone(),
                elements: fem.mesh.elements.clone(),
                boundary_faces: fem.mesh.boundary_faces.clone(),
            }),
            magnetization: Some(flatten_magnetization(&fem.initial_magnetization)),
            preview_field: None,
            scalar_row_due: false,
            finished: false,
        },
    }
}

pub(crate) fn final_stage_step_update(
    backend_plan: &BackendPlanIR,
    steps: &[fullmag_runner::StepStats],
    final_magnetization: &[[f64; 3]],
    step_offset: u64,
    time_offset: f64,
    finished: bool,
) -> Option<fullmag_runner::StepUpdate> {
    let stats = steps.last()?.clone();
    let stats = offset_step_stats(std::slice::from_ref(&stats), step_offset, time_offset)
        .into_iter()
        .next()
        .expect("single step should offset");

    Some(match backend_plan {
        BackendPlanIR::Fdm(fdm) => fullmag_runner::StepUpdate {
            stats,
            grid: [fdm.grid.cells[0], fdm.grid.cells[1], fdm.grid.cells[2]],
            fem_mesh: None,
            magnetization: Some(flatten_magnetization(final_magnetization)),
            preview_field: None,
            scalar_row_due: true,
            finished,
        },
        BackendPlanIR::FdmMultilayer(fdm) => fullmag_runner::StepUpdate {
            stats,
            grid: [
                fdm.common_cells[0],
                fdm.common_cells[1],
                fdm.common_cells[2],
            ],
            fem_mesh: None,
            magnetization: None,
            preview_field: None,
            scalar_row_due: true,
            finished,
        },
        BackendPlanIR::Fem(fem) => fullmag_runner::StepUpdate {
            stats,
            grid: [0, 0, 0],
            fem_mesh: Some(fullmag_runner::FemMeshPayload {
                nodes: fem.mesh.nodes.clone(),
                elements: fem.mesh.elements.clone(),
                boundary_faces: fem.mesh.boundary_faces.clone(),
            }),
            magnetization: Some(flatten_magnetization(final_magnetization)),
            preview_field: None,
            scalar_row_due: true,
            finished,
        },
    })
}

pub(crate) fn resolve_script_until_seconds(ir: &ProblemIR, default_until_seconds: Option<f64>) -> Result<f64> {
    if let Some(until_seconds) = default_until_seconds {
        return Ok(until_seconds);
    }

    match &ir.study {
        fullmag_ir::StudyIR::Relaxation {
            dynamics,
            max_steps,
            ..
        } => {
            let dt = match dynamics {
                fullmag_ir::DynamicsIR::Llg { fixed_timestep, .. } => {
                    fixed_timestep.unwrap_or(1e-13)
                }
            };
            Ok(dt * (*max_steps as f64))
        }
        fullmag_ir::StudyIR::TimeEvolution { .. } => bail!(
            "no stop time provided. Define DEFAULT_UNTIL in the script for time-evolution runs"
        ),
    }
}

pub(crate) fn materialize_script_stages(config: ScriptExecutionConfig) -> Result<Vec<ResolvedScriptStage>> {
    let ScriptExecutionConfig {
        mut ir,
        shared_geometry_assets,
        default_until_seconds,
        stages,
    } = config;

    if ir.geometry_assets.is_none() {
        ir.geometry_assets = shared_geometry_assets.clone();
    }

    if stages.is_empty() {
        let entrypoint_kind = ir.problem_meta.entrypoint_kind.clone();
        return Ok(vec![ResolvedScriptStage {
            until_seconds: if entrypoint_kind == "flat_workspace" {
                0.0
            } else {
                resolve_script_until_seconds(&ir, default_until_seconds)?
            },
            ir,
            entrypoint_kind: if entrypoint_kind.is_empty() {
                "direct_script".to_string()
            } else {
                entrypoint_kind
            },
        }]);
    }

    stages
        .into_iter()
        .map(|mut stage| {
            if stage.ir.geometry_assets.is_none() {
                stage.ir.geometry_assets = shared_geometry_assets.clone();
            }
            Ok(ResolvedScriptStage {
                until_seconds: resolve_script_until_seconds(
                    &stage.ir,
                    stage.default_until_seconds,
                )?,
                ir: stage.ir,
                entrypoint_kind: stage.entrypoint_kind,
            })
        })
        .collect()
}

pub(crate) fn apply_continuation_initial_state(
    problem: &mut ProblemIR,
    final_magnetization: &[[f64; 3]],
) -> Result<()> {
    if problem.magnets.len() != 1 {
        bail!(
            "multi-stage flat scripts currently require exactly one magnet; found {}",
            problem.magnets.len()
        );
    }

    problem.magnets[0].initial_magnetization =
        Some(fullmag_ir::InitialMagnetizationIR::SampledField {
            values: final_magnetization.to_vec(),
        });
    Ok(())
}

/// Estimate available system RAM in bytes.
///
/// Reads `/proc/meminfo` (Linux). Falls back to 16 GB if unavailable.
pub(crate) fn available_system_ram_bytes() -> u64 {
    if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
        for line in content.lines() {
            if let Some(rest) = line.strip_prefix("MemAvailable:") {
                let kb_str = rest.trim().trim_end_matches("kB").trim();
                if let Ok(kb) = kb_str.parse::<u64>() {
                    return kb * 1024;
                }
            }
        }
    }
    16 * 1024 * 1024 * 1024 // fallback: 16 GB
}

/// Estimate RAM required for dense FEM demag solver.
///
/// The CPU reference solver allocates 3 dense N×N matrices of f64 (8 bytes each).
pub(crate) fn estimate_fem_dense_ram(node_count: usize) -> u64 {
    let n = node_count as u64;
    n * n * 24 // 3 × N × N × 8 bytes
}

pub(crate) fn read_ir(path: &Path) -> Result<ProblemIR> {
    let content = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

pub(crate) fn validate_ir(ir: &ProblemIR) -> Result<()> {
    ir.validate().map_err(join_errors)?;
    if ir.problem_meta.script_language != "python" {
        anyhow::bail!("Only Python-authored ProblemIR is supported in bootstrap mode")
    }
    Ok(())
}

pub(crate) fn join_errors(errors: Vec<String>) -> anyhow::Error {
    anyhow::anyhow!(errors.join("; "))
}

pub(crate) fn build_interactive_command_stage(
    base_problem: &ProblemIR,
    command: &crate::types::SessionCommand,
) -> Result<Option<ResolvedScriptStage>> {
    match command.kind.as_str() {
        "close" | "stop" => Ok(None),
        "pause" => Ok(None),
        "run" => {
            let until_seconds = command
                .until_seconds
                .ok_or_else(|| anyhow::anyhow!("interactive 'run' command requires until_seconds"))?;
            if until_seconds <= 0.0 {
                anyhow::bail!("interactive 'run' command requires positive until_seconds");
            }

            let mut ir = base_problem.clone();
            let mut dynamics = ir.study.dynamics().clone();
            if let fullmag_ir::DynamicsIR::Llg { ref mut integrator, ref mut fixed_timestep, .. } = dynamics {
                if let Some(ref int_str) = command.integrator {
                    if let Ok(parsed_integrator) = serde_json::from_value(serde_json::json!(int_str)) {
                        *integrator = parsed_integrator;
                    } else {
                        eprintln!("[fullmag] warning: failed to parse integrator '{}'", int_str);
                    }
                }
                if let Some(ft) = command.fixed_timestep {
                    *fixed_timestep = Some(ft);
                } else if command.integrator.as_deref() == Some("rk45") || command.integrator.as_deref() == Some("rk23") {
                    *fixed_timestep = None;
                }
            }
            let sampling = ir.study.sampling().clone();
            ir.problem_meta.entrypoint_kind = "interactive_run".to_string();
            ir.study = fullmag_ir::StudyIR::TimeEvolution { dynamics, sampling };

            Ok(Some(ResolvedScriptStage {
                ir,
                until_seconds,
                entrypoint_kind: "interactive_run".to_string(),
            }))
        }
        "relax" => {
            let mut ir = base_problem.clone();
            let dynamics = ir.study.dynamics().clone();
            let sampling = ir.study.sampling().clone();
            let max_steps = command.max_steps.unwrap_or(50_000);
            let torque_tolerance = command.torque_tolerance.unwrap_or(1e-6);

            if let Some(alpha) = command.relax_alpha {
                for mat in &mut ir.materials {
                    mat.damping = alpha;
                }
            }

            let algorithm = command.relax_algorithm.as_deref()
                .and_then(|s| serde_json::from_value(serde_json::json!(s)).ok())
                .unwrap_or(fullmag_ir::RelaxationAlgorithmIR::LlgOverdamped);

            ir.problem_meta.entrypoint_kind = "interactive_relax".to_string();
            ir.study = fullmag_ir::StudyIR::Relaxation {
                algorithm,
                dynamics: dynamics.clone(),
                torque_tolerance,
                energy_tolerance: command.energy_tolerance,
                max_steps,
                sampling,
            };

            let until_seconds = match dynamics {
                fullmag_ir::DynamicsIR::Llg { fixed_timestep, .. } => {
                    fixed_timestep.unwrap_or(1e-13) * max_steps as f64
                }
            };

            Ok(Some(ResolvedScriptStage {
                ir,
                until_seconds,
                entrypoint_kind: "interactive_relax".to_string(),
            }))
        }
        other => anyhow::bail!("unsupported interactive command kind '{other}'"),
    }
}

pub(crate) fn supports_dynamic_live_preview(backend_plan: &BackendPlanIR) -> bool {
    matches!(backend_plan, BackendPlanIR::Fdm(_) | BackendPlanIR::Fem(_))
}

pub(crate) fn supports_interactive_latest_field_cache(backend_plan: &BackendPlanIR) -> bool {
    matches!(backend_plan, BackendPlanIR::Fdm(_) | BackendPlanIR::Fem(_))
}
