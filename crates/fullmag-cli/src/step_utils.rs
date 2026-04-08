use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use fullmag_ir::{BackendPlanIR, ProblemIR};
use serde_json::Value;

use crate::formatting::unix_time_millis;
use crate::live_workspace::LocalLiveWorkspace;
use crate::types::{
    LiveStateManifest, LiveStepView, ResolvedScriptStage, RunManifest, ScriptExecutionConfig,
    StudyPipelineDocument, StudyPipelineNode,
};

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

pub(crate) fn live_state_manifest_from_update(
    update: &fullmag_runner::StepUpdate,
) -> LiveStateManifest {
    let status_str = if update.finished {
        "completed"
    } else {
        "running"
    };
    LiveStateManifest {
        status: status_str.to_string(),
        runtime_status: Some(fullmag_runner::RuntimeStatus::from_status_code(status_str)),
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
            cached_preview_fields: None,
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
            cached_preview_fields: None,
            scalar_row_due: false,
            finished: false,
        },
        BackendPlanIR::Fem(fem) => fullmag_runner::StepUpdate {
            stats,
            grid: [0, 0, 0],
            fem_mesh: Some(fullmag_runner::FemMeshPayload::from(fem)),
            magnetization: Some(flatten_magnetization(&fem.initial_magnetization)),
            preview_field: None,
            cached_preview_fields: None,
            scalar_row_due: false,
            finished: false,
        },
        BackendPlanIR::FemEigen(fem) => fullmag_runner::StepUpdate {
            stats,
            grid: [0, 0, 0],
            fem_mesh: Some(fullmag_runner::FemMeshPayload::from(fem)),
            magnetization: Some(flatten_magnetization(&fem.equilibrium_magnetization)),
            preview_field: None,
            cached_preview_fields: None,
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
            cached_preview_fields: None,
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
            cached_preview_fields: None,
            scalar_row_due: true,
            finished,
        },
        BackendPlanIR::Fem(fem) => fullmag_runner::StepUpdate {
            stats,
            grid: [0, 0, 0],
            fem_mesh: Some(fullmag_runner::FemMeshPayload::from(fem)),
            magnetization: Some(flatten_magnetization(final_magnetization)),
            preview_field: None,
            cached_preview_fields: None,
            scalar_row_due: true,
            finished,
        },
        BackendPlanIR::FemEigen(fem) => fullmag_runner::StepUpdate {
            stats,
            grid: [0, 0, 0],
            fem_mesh: Some(fullmag_runner::FemMeshPayload::from(fem)),
            magnetization: Some(flatten_magnetization(final_magnetization)),
            preview_field: None,
            cached_preview_fields: None,
            scalar_row_due: true,
            finished,
        },
    })
}

pub(crate) fn resolve_script_until_seconds(
    ir: &ProblemIR,
    default_until_seconds: Option<f64>,
) -> Result<f64> {
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
        fullmag_ir::StudyIR::Eigenmodes { .. } => Ok(0.0),
    }
}

pub(crate) fn materialize_script_stages(
    config: ScriptExecutionConfig,
) -> Result<Vec<ResolvedScriptStage>> {
    let ScriptExecutionConfig {
        mut ir,
        shared_geometry_assets,
        default_until_seconds,
        study_pipeline,
        stages,
    } = config;

    if ir.geometry_assets.is_none() {
        ir.geometry_assets = shared_geometry_assets.clone();
    }

    if stages.is_empty() {
        if let Some(document) = study_pipeline {
            let materialized = materialize_study_pipeline(&document, &ir, default_until_seconds)?;
            if !materialized.is_empty() {
                return Ok(materialized);
            }
        }
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

fn materialize_study_pipeline(
    document: &StudyPipelineDocument,
    base_ir: &ProblemIR,
    default_until_seconds: Option<f64>,
) -> Result<Vec<ResolvedScriptStage>> {
    if document.version != "study_pipeline.v1" {
        bail!(
            "unsupported study pipeline version '{}' while materializing script stages",
            document.version
        );
    }
    let mut stages = Vec::new();
    walk_study_pipeline_nodes(&document.nodes, base_ir, default_until_seconds, &mut stages)?;
    Ok(stages)
}

fn walk_study_pipeline_nodes(
    nodes: &[StudyPipelineNode],
    base_ir: &ProblemIR,
    default_until_seconds: Option<f64>,
    out: &mut Vec<ResolvedScriptStage>,
) -> Result<()> {
    for node in nodes {
        match node {
            StudyPipelineNode::Primitive {
                enabled,
                stage_kind,
                payload,
                label,
                ..
            } => {
                if !enabled {
                    continue;
                }
                out.push(
                    materialize_pipeline_primitive(
                        base_ir,
                        stage_kind,
                        payload,
                        default_until_seconds,
                    )
                    .with_context(|| {
                        format!("failed to materialize study pipeline node '{label}'")
                    })?,
                );
            }
            StudyPipelineNode::Macro {
                enabled,
                macro_kind,
                label,
                ..
            } => {
                if !enabled {
                    continue;
                }
                bail!(
                    "study pipeline macro '{}' ('{}') requires prior materialization into explicit stages",
                    label,
                    macro_kind
                );
            }
            StudyPipelineNode::Group {
                enabled, children, ..
            } => {
                if !enabled {
                    continue;
                }
                walk_study_pipeline_nodes(children, base_ir, default_until_seconds, out)?;
            }
        }
    }
    Ok(())
}

fn materialize_pipeline_primitive(
    base_ir: &ProblemIR,
    stage_kind: &str,
    payload: &std::collections::BTreeMap<String, Value>,
    default_until_seconds: Option<f64>,
) -> Result<ResolvedScriptStage> {
    let normalized_kind = stage_kind.trim().to_ascii_lowercase();
    match normalized_kind.as_str() {
        "run" => materialize_pipeline_run(base_ir, payload, default_until_seconds),
        "relax" => materialize_pipeline_relax(base_ir, payload),
        "eigenmodes" => materialize_pipeline_eigenmodes(base_ir, payload),
        other => bail!(
            "study pipeline primitive stage '{}' is not yet executable by the runtime; materialize it into explicit stages first",
            other
        ),
    }
}

fn materialize_pipeline_run(
    base_ir: &ProblemIR,
    payload: &std::collections::BTreeMap<String, Value>,
    default_until_seconds: Option<f64>,
) -> Result<ResolvedScriptStage> {
    let mut ir = base_ir.clone();
    let mut dynamics = ir.study.dynamics().clone();
    apply_dynamics_overrides(&mut dynamics, payload)?;
    let sampling = ir.study.sampling().clone();
    let entrypoint_kind = payload_string(payload, "entrypoint_kind")
        .unwrap_or_else(|| "study_pipeline_run".to_string());
    ir.problem_meta.entrypoint_kind = entrypoint_kind.clone();
    ir.study = fullmag_ir::StudyIR::TimeEvolution { dynamics, sampling };
    let until_seconds = resolve_script_until_seconds(
        &ir,
        payload_f64(payload, "until_seconds")?.or(default_until_seconds),
    )?;
    if until_seconds <= 0.0 {
        bail!("run study pipeline stage requires a positive until_seconds value");
    }
    Ok(ResolvedScriptStage {
        ir,
        until_seconds,
        entrypoint_kind,
    })
}

fn materialize_pipeline_relax(
    base_ir: &ProblemIR,
    payload: &std::collections::BTreeMap<String, Value>,
) -> Result<ResolvedScriptStage> {
    let mut ir = base_ir.clone();
    let mut dynamics = ir.study.dynamics().clone();
    apply_dynamics_overrides(&mut dynamics, payload)?;
    let sampling = ir.study.sampling().clone();
    let entrypoint_kind = payload_string(payload, "entrypoint_kind")
        .unwrap_or_else(|| "study_pipeline_relax".to_string());
    ir.problem_meta.entrypoint_kind = entrypoint_kind.clone();
    ir.study = fullmag_ir::StudyIR::Relaxation {
        algorithm: payload_relaxation_algorithm(payload)?
            .unwrap_or(fullmag_ir::RelaxationAlgorithmIR::LlgOverdamped),
        dynamics,
        torque_tolerance: payload_f64(payload, "torque_tolerance")?.unwrap_or(1e-6),
        energy_tolerance: payload_f64(payload, "energy_tolerance")?,
        max_steps: payload_u64(payload, "max_steps")?.unwrap_or(50_000),
        sampling,
    };
    let until_seconds = resolve_script_until_seconds(&ir, None)?;
    Ok(ResolvedScriptStage {
        ir,
        until_seconds,
        entrypoint_kind,
    })
}

fn materialize_pipeline_eigenmodes(
    base_ir: &ProblemIR,
    payload: &std::collections::BTreeMap<String, Value>,
) -> Result<ResolvedScriptStage> {
    let mut ir = base_ir.clone();
    let mut dynamics = ir.study.dynamics().clone();
    apply_dynamics_overrides(&mut dynamics, payload)?;
    let sampling = ir.study.sampling().clone();
    let entrypoint_kind = payload_string(payload, "entrypoint_kind")
        .unwrap_or_else(|| "study_pipeline_eigenmodes".to_string());
    let current_eigen = match &base_ir.study {
        fullmag_ir::StudyIR::Eigenmodes {
            operator,
            count,
            target,
            equilibrium,
            k_sampling,
            normalization,
            damping_policy,
            spin_wave_bc,
            ..
        } => Some((
            operator.clone(),
            *count,
            target.clone(),
            equilibrium.clone(),
            k_sampling.clone(),
            *normalization,
            *damping_policy,
            spin_wave_bc.clone(),
        )),
        _ => None,
    };
    let default_count = current_eigen
        .as_ref()
        .map(|current| current.1)
        .unwrap_or(10);
    let default_target = current_eigen
        .as_ref()
        .map(|current| current.2.clone())
        .unwrap_or(fullmag_ir::EigenTargetIR::Lowest);
    let default_equilibrium = current_eigen
        .as_ref()
        .map(|current| current.3.clone())
        .unwrap_or(fullmag_ir::EquilibriumSourceIR::RelaxedInitialState);
    let default_normalization = current_eigen
        .as_ref()
        .map(|current| current.5)
        .unwrap_or(fullmag_ir::EigenNormalizationIR::UnitL2);
    let default_damping_policy = current_eigen
        .as_ref()
        .map(|current| current.6)
        .unwrap_or(fullmag_ir::EigenDampingPolicyIR::Ignore);
    let default_spin_wave_bc = current_eigen
        .as_ref()
        .map(|current| current.7.clone())
        .unwrap_or_default();
    let include_demag = payload_bool(payload, "eigen_include_demag")?.unwrap_or_else(|| {
        current_eigen
            .as_ref()
            .map(|current| current.0.include_demag)
            .unwrap_or(true)
    });

    ir.problem_meta.entrypoint_kind = entrypoint_kind.clone();
    ir.study = fullmag_ir::StudyIR::Eigenmodes {
        dynamics,
        operator: fullmag_ir::EigenOperatorConfigIR {
            kind: fullmag_ir::EigenOperatorIR::LinearizedLlg,
            include_demag,
        },
        count: payload_u32(payload, "eigen_count")?.unwrap_or(default_count),
        target: payload_eigen_target(payload, default_target)?,
        equilibrium: payload_equilibrium_source(payload, default_equilibrium)?,
        k_sampling: payload_k_sampling(
            payload,
            current_eigen.as_ref().and_then(|current| current.4.clone()),
        )?,
        normalization: payload_eigen_normalization(payload)?.unwrap_or(default_normalization),
        damping_policy: payload_eigen_damping_policy(payload)?.unwrap_or(default_damping_policy),
        spin_wave_bc: payload_spin_wave_bc(payload)?.unwrap_or(default_spin_wave_bc),
        sampling,
    };

    Ok(ResolvedScriptStage {
        ir,
        until_seconds: 0.0,
        entrypoint_kind,
    })
}

fn apply_dynamics_overrides(
    dynamics: &mut fullmag_ir::DynamicsIR,
    payload: &std::collections::BTreeMap<String, Value>,
) -> Result<()> {
    match dynamics {
        fullmag_ir::DynamicsIR::Llg {
            integrator,
            fixed_timestep,
            ..
        } => {
            let integrator_override = payload_string(payload, "integrator");
            if let Some(value) = integrator_override.as_ref() {
                *integrator = value.clone();
            }
            if payload.contains_key("fixed_timestep") {
                *fixed_timestep = payload_f64(payload, "fixed_timestep")?;
            } else if matches!(integrator_override.as_deref(), Some("rk45" | "rk23")) {
                *fixed_timestep = None;
            }
        }
    }
    Ok(())
}

fn payload_string(
    payload: &std::collections::BTreeMap<String, Value>,
    key: &str,
) -> Option<String> {
    match payload.get(key) {
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(Value::Number(value)) => Some(value.to_string()),
        Some(Value::Bool(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn payload_f64(
    payload: &std::collections::BTreeMap<String, Value>,
    key: &str,
) -> Result<Option<f64>> {
    let Some(raw_value) = payload.get(key) else {
        return Ok(None);
    };
    match raw_value {
        Value::Null => Ok(None),
        Value::String(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            trimmed
                .parse::<f64>()
                .with_context(|| format!("invalid floating-point value for payload field '{key}'"))
                .map(Some)
        }
        Value::Number(value) => value
            .as_f64()
            .map(Some)
            .ok_or_else(|| anyhow::anyhow!("invalid numeric value for payload field '{key}'")),
        _ => bail!("payload field '{key}' must be a number or numeric string"),
    }
}

fn payload_u64(
    payload: &std::collections::BTreeMap<String, Value>,
    key: &str,
) -> Result<Option<u64>> {
    let Some(raw_value) = payload.get(key) else {
        return Ok(None);
    };
    match raw_value {
        Value::Null => Ok(None),
        Value::String(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            trimmed
                .parse::<u64>()
                .with_context(|| format!("invalid integer value for payload field '{key}'"))
                .map(Some)
        }
        Value::Number(value) => value
            .as_u64()
            .map(Some)
            .ok_or_else(|| anyhow::anyhow!("invalid integer value for payload field '{key}'")),
        _ => bail!("payload field '{key}' must be an integer or integer string"),
    }
}

fn payload_u32(
    payload: &std::collections::BTreeMap<String, Value>,
    key: &str,
) -> Result<Option<u32>> {
    payload_u64(payload, key)?.map_or(Ok(None), |value| {
        u32::try_from(value)
            .with_context(|| format!("payload field '{key}' does not fit into u32"))
            .map(Some)
    })
}

fn payload_bool(
    payload: &std::collections::BTreeMap<String, Value>,
    key: &str,
) -> Result<Option<bool>> {
    let Some(raw_value) = payload.get(key) else {
        return Ok(None);
    };
    match raw_value {
        Value::Null => Ok(None),
        Value::Bool(value) => Ok(Some(*value)),
        Value::String(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            match trimmed {
                "true" => Ok(Some(true)),
                "false" => Ok(Some(false)),
                _ => bail!("payload field '{key}' must be a boolean or 'true'/'false' string"),
            }
        }
        _ => bail!("payload field '{key}' must be a boolean"),
    }
}

fn payload_relaxation_algorithm(
    payload: &std::collections::BTreeMap<String, Value>,
) -> Result<Option<fullmag_ir::RelaxationAlgorithmIR>> {
    match payload_string(payload, "relax_algorithm") {
        Some(value) => serde_json::from_value(Value::String(value))
            .context("invalid relax_algorithm in study pipeline payload")
            .map(Some),
        None => Ok(None),
    }
}

fn payload_eigen_target(
    payload: &std::collections::BTreeMap<String, Value>,
    default_target: fullmag_ir::EigenTargetIR,
) -> Result<fullmag_ir::EigenTargetIR> {
    let target_kind =
        payload_string(payload, "eigen_target").unwrap_or_else(|| match default_target {
            fullmag_ir::EigenTargetIR::Lowest => "lowest".to_string(),
            fullmag_ir::EigenTargetIR::Nearest { .. } => "nearest".to_string(),
        });
    match target_kind.as_str() {
        "lowest" => Ok(fullmag_ir::EigenTargetIR::Lowest),
        "nearest" => {
            let default_frequency = match default_target {
                fullmag_ir::EigenTargetIR::Nearest { frequency_hz } => Some(frequency_hz),
                fullmag_ir::EigenTargetIR::Lowest => None,
            };
            let frequency_hz = payload_f64(payload, "eigen_target_frequency")?
                .or(default_frequency)
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "study pipeline eigenmodes stage with eigen_target='nearest' requires eigen_target_frequency"
                    )
                })?;
            Ok(fullmag_ir::EigenTargetIR::Nearest { frequency_hz })
        }
        other => bail!("unsupported eigen_target value '{other}'"),
    }
}

fn payload_equilibrium_source(
    payload: &std::collections::BTreeMap<String, Value>,
    default_equilibrium: fullmag_ir::EquilibriumSourceIR,
) -> Result<fullmag_ir::EquilibriumSourceIR> {
    let default_label = match &default_equilibrium {
        fullmag_ir::EquilibriumSourceIR::Provided => "provided",
        fullmag_ir::EquilibriumSourceIR::RelaxedInitialState => "relax",
        fullmag_ir::EquilibriumSourceIR::Artifact { .. } => "artifact",
    };
    let source = payload_string(payload, "eigen_equilibrium_source")
        .unwrap_or_else(|| default_label.to_string());
    match source.as_str() {
        "provided" => Ok(fullmag_ir::EquilibriumSourceIR::Provided),
        "relax" => Ok(fullmag_ir::EquilibriumSourceIR::RelaxedInitialState),
        "artifact" => {
            let path = payload_string(payload, "eigen_equilibrium_artifact").or_else(|| {
                match default_equilibrium {
                    fullmag_ir::EquilibriumSourceIR::Artifact { path } => Some(path),
                    _ => None,
                }
            });
            let path = path.ok_or_else(|| {
                anyhow::anyhow!(
                    "study pipeline eigenmodes stage with equilibrium_source='artifact' requires eigen_equilibrium_artifact"
                )
            })?;
            Ok(fullmag_ir::EquilibriumSourceIR::Artifact { path })
        }
        other => bail!("unsupported eigen_equilibrium_source value '{other}'"),
    }
}

fn payload_eigen_normalization(
    payload: &std::collections::BTreeMap<String, Value>,
) -> Result<Option<fullmag_ir::EigenNormalizationIR>> {
    match payload_string(payload, "eigen_normalization") {
        Some(value) => serde_json::from_value(Value::String(value))
            .context("invalid eigen_normalization in study pipeline payload")
            .map(Some),
        None => Ok(None),
    }
}

fn payload_eigen_damping_policy(
    payload: &std::collections::BTreeMap<String, Value>,
) -> Result<Option<fullmag_ir::EigenDampingPolicyIR>> {
    match payload_string(payload, "eigen_damping_policy") {
        Some(value) => serde_json::from_value(Value::String(value))
            .context("invalid eigen_damping_policy in study pipeline payload")
            .map(Some),
        None => Ok(None),
    }
}

fn payload_k_sampling(
    payload: &std::collections::BTreeMap<String, Value>,
    default_sampling: Option<fullmag_ir::KSamplingIR>,
) -> Result<Option<fullmag_ir::KSamplingIR>> {
    let parsed = match payload.get("eigen_k_vector") {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                let values: Vec<f64> = trimmed
                    .split(',')
                    .map(|component| {
                        component.trim().parse::<f64>().with_context(|| {
                            "invalid eigen_k_vector component in study pipeline payload"
                        })
                    })
                    .collect::<Result<Vec<_>>>()?;
                if values.len() != 3 {
                    bail!("eigen_k_vector must contain exactly 3 comma-separated values");
                }
                Some([values[0], values[1], values[2]])
            }
        }
        Some(Value::Array(values)) => {
            if values.len() != 3 {
                bail!("eigen_k_vector array must contain exactly 3 entries");
            }
            Some([
                values[0]
                    .as_f64()
                    .ok_or_else(|| anyhow::anyhow!("invalid eigen_k_vector[0] value"))?,
                values[1]
                    .as_f64()
                    .ok_or_else(|| anyhow::anyhow!("invalid eigen_k_vector[1] value"))?,
                values[2]
                    .as_f64()
                    .ok_or_else(|| anyhow::anyhow!("invalid eigen_k_vector[2] value"))?,
            ])
        }
        _ => bail!("eigen_k_vector must be a comma-separated string or 3-element array"),
    };
    Ok(match parsed {
        Some(k_vector) => Some(fullmag_ir::KSamplingIR::Single { k_vector }),
        None => default_sampling,
    })
}

fn payload_spin_wave_bc(
    payload: &std::collections::BTreeMap<String, Value>,
) -> Result<Option<fullmag_ir::SpinWaveBoundaryConditionIR>> {
    if let Some(config) = payload.get("eigen_spin_wave_bc_config") {
        if matches!(config, Value::Null) {
            return Ok(None);
        }
        return serde_json::from_value(config.clone())
            .context("invalid eigen_spin_wave_bc_config in study pipeline payload")
            .map(Some);
    }
    match payload_string(payload, "eigen_spin_wave_bc") {
        Some(value) => serde_json::from_value(Value::String(value))
            .context("invalid eigen_spin_wave_bc in study pipeline payload")
            .map(Some),
        None => Ok(None),
    }
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
        "close" => Ok(None),
        "stop" | "break" | "pause" | "resume" => anyhow::bail!(
            "interactive control command '{}' must be handled before stage materialization",
            command.kind
        ),
        "run" => {
            let until_seconds = command.until_seconds.ok_or_else(|| {
                anyhow::anyhow!("interactive 'run' command requires until_seconds")
            })?;
            if until_seconds <= 0.0 {
                anyhow::bail!("interactive 'run' command requires positive until_seconds");
            }

            let mut ir = base_problem.clone();
            let mut dynamics = ir.study.dynamics().clone();
            let fullmag_ir::DynamicsIR::Llg {
                ref mut integrator,
                ref mut fixed_timestep,
                ..
            } = dynamics;
            if let Some(ref int_str) = command.integrator {
                if let Ok(parsed_integrator) = serde_json::from_value(serde_json::json!(int_str)) {
                    *integrator = parsed_integrator;
                } else {
                    eprintln!(
                        "[fullmag] warning: failed to parse integrator '{}'",
                        int_str
                    );
                }
            }
            if let Some(ft) = command.fixed_timestep {
                *fixed_timestep = Some(ft);
            } else if command.integrator.as_deref() == Some("rk45")
                || command.integrator.as_deref() == Some("rk23")
            {
                *fixed_timestep = None;
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

            // Default relax_alpha = 1.0 for optimal overdamped convergence
            // (user can still override to any value via command.relax_alpha)
            let effective_alpha = command.relax_alpha.unwrap_or(1.0);
            for mat in &mut ir.materials {
                mat.damping = effective_alpha;
            }

            let algorithm = command
                .relax_algorithm
                .as_deref()
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

pub(crate) fn build_resumable_interactive_command(
    command: &crate::types::SessionCommand,
    stage_result: &fullmag_runner::RunResult,
) -> Option<crate::types::SessionCommand> {
    match command.kind.as_str() {
        "run" => {
            let requested_until_seconds = command.until_seconds?;
            let elapsed_seconds = stage_result
                .steps
                .last()
                .map(|step| step.time)
                .unwrap_or(0.0);
            let remaining_until_seconds = (requested_until_seconds - elapsed_seconds).max(0.0);
            if remaining_until_seconds <= 0.0 {
                return None;
            }
            let mut resumed = command.clone();
            resumed.until_seconds = Some(remaining_until_seconds);
            Some(resumed)
        }
        "relax" => {
            let requested_max_steps = command.max_steps.unwrap_or(50_000);
            let executed_steps = stage_result.steps.last().map(|step| step.step).unwrap_or(0);
            let remaining_max_steps = requested_max_steps.saturating_sub(executed_steps);
            if remaining_max_steps == 0 {
                return None;
            }
            let mut resumed = command.clone();
            resumed.max_steps = Some(remaining_max_steps);
            Some(resumed)
        }
        _ => None,
    }
}

pub(crate) fn supports_dynamic_live_preview(backend_plan: &BackendPlanIR) -> bool {
    matches!(backend_plan, BackendPlanIR::Fdm(_) | BackendPlanIR::Fem(_))
}

#[cfg(test)]
mod tests {
    use super::*;
    use fullmag_ir::ProblemIR;
    use serde_json::json;

    fn sample_problem_ir() -> ProblemIR {
        serde_json::from_value(json!({
            "ir_version": "0.2.0",
            "problem_meta": {
                "name": "pipeline_test",
                "description": null,
                "script_language": "python",
                "script_source": null,
                "script_api_version": "0.2.0",
                "serializer_version": "0.2.0",
                "entrypoint_kind": "direct_script",
                "source_hash": null,
                "runtime_metadata": {},
                "backend_revision": null,
                "seeds": []
            },
            "geometry": {
                "entries": [
                    {
                        "kind": "box",
                        "name": "track",
                        "size": [1.0, 1.0, 1.0]
                    }
                ]
            },
            "regions": [
                {
                    "name": "track",
                    "geometry": "track"
                }
            ],
            "materials": [
                {
                    "name": "Py",
                    "saturation_magnetisation": 800000.0,
                    "exchange_stiffness": 1.3e-11,
                    "damping": 0.01,
                    "uniaxial_anisotropy": null,
                    "anisotropy_axis": null
                }
            ],
            "magnets": [
                {
                    "name": "track",
                    "region": "track",
                    "material": "Py",
                    "initial_magnetization": {
                        "kind": "uniform",
                        "value": [1.0, 0.0, 0.0]
                    }
                }
            ],
            "energy_terms": [
                {
                    "kind": "exchange"
                }
            ],
            "study": {
                "kind": "time_evolution",
                "dynamics": {
                    "kind": "llg",
                    "gyromagnetic_ratio": 221000.0,
                    "integrator": "rk45",
                    "fixed_timestep": 1e-13
                },
                "sampling": {
                    "outputs": []
                }
            },
            "backend_policy": {
                "requested_backend": "fdm",
                "execution_precision": "double",
                "discretization_hints": null
            },
            "validation_profile": {
                "execution_mode": "strict"
            }
        }))
        .expect("sample ProblemIR should deserialize")
    }

    #[test]
    fn materialize_script_stages_uses_study_pipeline_when_explicit_stages_are_absent() {
        let config = ScriptExecutionConfig {
            ir: sample_problem_ir(),
            shared_geometry_assets: None,
            default_until_seconds: Some(5e-12),
            study_pipeline: Some(StudyPipelineDocument {
                version: "study_pipeline.v1".to_string(),
                nodes: vec![
                    StudyPipelineNode::Primitive {
                        id: "stage_1_run".to_string(),
                        label: "Imported Stage 1".to_string(),
                        enabled: true,
                        notes: None,
                        source: Some("script_imported".to_string()),
                        stage_kind: "run".to_string(),
                        payload: serde_json::from_value(json!({
                            "kind": "run",
                            "entrypoint_kind": "pipeline_run",
                            "integrator": "rk45",
                            "fixed_timestep": "",
                            "until_seconds": "5e-12"
                        }))
                        .expect("payload"),
                    },
                    StudyPipelineNode::Primitive {
                        id: "stage_2_relax".to_string(),
                        label: "Imported Stage 2".to_string(),
                        enabled: true,
                        notes: None,
                        source: Some("script_imported".to_string()),
                        stage_kind: "relax".to_string(),
                        payload: serde_json::from_value(json!({
                            "kind": "relax",
                            "entrypoint_kind": "pipeline_relax",
                            "integrator": "rk45",
                            "fixed_timestep": "2e-13",
                            "relax_algorithm": "llg_overdamped",
                            "torque_tolerance": "1e-6",
                            "max_steps": "25"
                        }))
                        .expect("payload"),
                    },
                ],
            }),
            stages: vec![],
        };

        let stages = materialize_script_stages(config).expect("pipeline should materialize");
        assert_eq!(stages.len(), 2);
        assert_eq!(stages[0].entrypoint_kind, "pipeline_run");
        assert!((stages[0].until_seconds - 5e-12).abs() < 1e-24);
        assert_eq!(stages[1].entrypoint_kind, "pipeline_relax");
        assert!(matches!(
            stages[1].ir.study,
            fullmag_ir::StudyIR::Relaxation { max_steps: 25, .. }
        ));
        assert!((stages[1].until_seconds - (25.0 * 2e-13)).abs() < 1e-24);
    }

    #[test]
    fn materialize_script_stages_prefers_explicit_stages_over_study_pipeline() {
        let explicit_stage = crate::types::ScriptExecutionStage {
            ir: sample_problem_ir(),
            default_until_seconds: Some(7e-12),
            entrypoint_kind: "explicit_run".to_string(),
        };
        let config = ScriptExecutionConfig {
            ir: sample_problem_ir(),
            shared_geometry_assets: None,
            default_until_seconds: Some(5e-12),
            study_pipeline: Some(StudyPipelineDocument {
                version: "study_pipeline.v1".to_string(),
                nodes: vec![StudyPipelineNode::Primitive {
                    id: "stage_1_run".to_string(),
                    label: "Imported Stage 1".to_string(),
                    enabled: true,
                    notes: None,
                    source: Some("script_imported".to_string()),
                    stage_kind: "run".to_string(),
                    payload: serde_json::from_value(json!({
                        "kind": "run",
                        "entrypoint_kind": "pipeline_run",
                        "until_seconds": "5e-12"
                    }))
                    .expect("payload"),
                }],
            }),
            stages: vec![explicit_stage],
        };

        let stages = materialize_script_stages(config).expect("explicit stages should win");
        assert_eq!(stages.len(), 1);
        assert_eq!(stages[0].entrypoint_kind, "explicit_run");
        assert!((stages[0].until_seconds - 7e-12).abs() < 1e-24);
    }
}
