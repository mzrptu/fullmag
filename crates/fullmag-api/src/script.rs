//! Script builder, Python helper invocation, and magnetization state IO.

use crate::error::ApiError;
use crate::types::*;
use crate::ReadMagnetizationStateHelperResponse;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;

pub(crate) fn repo_root() -> PathBuf {
    if let Some(root) = std::env::var_os("FULLMAG_REPO_ROOT") {
        return PathBuf::from(root);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate dir should have parent")
        .parent()
        .expect("workspace root should exist")
        .to_path_buf()
}

pub(crate) fn rewrite_script_via_python_helper(
    repo_root: &Path,
    workspace_root: &Path,
    script_path: &Path,
    overrides: Option<&Value>,
) -> Result<ScriptSyncResponse, ApiError> {
    let mut helper_args = vec![
        "-m".to_string(),
        "fullmag.runtime.helper".to_string(),
        "rewrite-script".to_string(),
        "--script".to_string(),
        script_path.display().to_string(),
        "--write".to_string(),
    ];

    let overrides_path = if let Some(overrides) = overrides {
        std::fs::create_dir_all(workspace_root).map_err(|error| {
            ApiError::internal(format!("failed to prepare workspace: {}", error))
        })?;
        let path = workspace_root.join(format!("script-sync-{}.json", uuid_v4_hex()));
        let body = serde_json::to_string_pretty(overrides).map_err(|error| {
            ApiError::internal(format!("failed to serialize overrides: {}", error))
        })?;
        std::fs::write(&path, body).map_err(|error| {
            ApiError::internal(format!("failed to persist overrides: {}", error))
        })?;
        helper_args.push("--overrides-json".to_string());
        helper_args.push(path.display().to_string());
        Some(path)
    } else {
        None
    };

    let output = run_python_helper(repo_root, &helper_args);
    if let Some(path) = overrides_path {
        let _ = std::fs::remove_file(path);
    }
    let output = output?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::internal(format!(
            "python rewrite helper failed: {}",
            stderr.trim()
        )));
    }

    serde_json::from_slice::<ScriptSyncResponse>(&output.stdout).map_err(|error| {
        ApiError::internal(format!(
            "failed to deserialize rewrite helper response: {}",
            error
        ))
    })
}

pub(crate) fn load_script_builder_state(
    repo_root: &Path,
    _workspace_root: &Path,
    script_path: &Path,
) -> Result<ScriptBuilderState, ApiError> {
    let helper_args = vec![
        "-m".to_string(),
        "fullmag.runtime.helper".to_string(),
        "export-builder-draft".to_string(),
        "--script".to_string(),
        script_path.display().to_string(),
    ];
    let output = run_python_helper(repo_root, &helper_args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::internal(format!(
            "python builder helper failed: {}",
            stderr.trim()
        )));
    }
    serde_json::from_slice::<ScriptBuilderState>(&output.stdout).map_err(|error| {
        ApiError::internal(format!(
            "failed to deserialize builder draft response: {}",
            error
        ))
    })
}

pub(crate) fn model_builder_graph_from_script_builder(
    builder: &ScriptBuilderState,
) -> ModelBuilderGraphState {
    ModelBuilderGraphState {
        version: "model_builder.v2".to_string(),
        revision: builder.revision,
        study: ModelBuilderGraphStudyState {
            id: "study".to_string(),
            kind: "study".to_string(),
            label: "Study".to_string(),
            solver: builder.solver.clone(),
            mesh_defaults: builder.mesh.clone(),
            stages: builder.stages.clone(),
            initial_state: builder.initial_state.clone(),
        },
        universe: ModelBuilderGraphUniverseState {
            id: "universe".to_string(),
            kind: "universe".to_string(),
            label: "Universe".to_string(),
            value: builder.universe.clone(),
        },
        objects: ModelBuilderGraphObjectsState {
            id: "objects".to_string(),
            kind: "objects".to_string(),
            label: "Objects".to_string(),
            items: builder
                .geometries
                .iter()
                .map(|geometry| ModelBuilderGraphObjectState {
                    id: geometry.name.clone(),
                    kind: "ferromagnet".to_string(),
                    name: geometry.name.clone(),
                    label: geometry.name.clone(),
                    geometry: geometry.clone(),
                    tree: ModelBuilderGraphObjectTreeRefs {
                        geometry: format!("geo-{}", geometry.name),
                        material: format!("mat-{}", geometry.name),
                        region: format!("reg-{}", geometry.name),
                        mesh: format!("geo-{}-mesh", geometry.name),
                    },
                })
                .collect(),
        },
        current_modules: ModelBuilderGraphCurrentModulesState {
            id: "current_modules".to_string(),
            kind: "current_modules".to_string(),
            label: "Antennas / RF".to_string(),
            modules: builder.current_modules.clone(),
            excitation_analysis: builder.excitation_analysis.clone(),
        },
    }
}

pub(crate) fn script_builder_from_model_builder_graph(
    graph: &ModelBuilderGraphState,
) -> ScriptBuilderState {
    ScriptBuilderState {
        revision: graph.revision,
        solver: graph.study.solver.clone(),
        mesh: graph.study.mesh_defaults.clone(),
        universe: graph.universe.value.clone(),
        stages: graph.study.stages.clone(),
        initial_state: graph.study.initial_state.clone(),
        geometries: graph
            .objects
            .items
            .iter()
            .map(|object_state| object_state.geometry.clone())
            .collect(),
        current_modules: graph.current_modules.modules.clone(),
        excitation_analysis: graph.current_modules.excitation_analysis.clone(),
    }
}

pub(crate) fn script_builder_overrides(builder: &ScriptBuilderState) -> Value {
    serde_json::json!({
        "solver": {
            "integrator": if builder.solver.integrator.trim().is_empty() { Value::Null } else { Value::String(builder.solver.integrator.clone()) },
            "fixed_timestep": parse_optional_text_f64(&builder.solver.fixed_timestep),
            "relax": {
                "algorithm": if builder.solver.relax_algorithm.trim().is_empty() { Value::Null } else { Value::String(builder.solver.relax_algorithm.clone()) },
                "torque_tolerance": parse_optional_text_f64(&builder.solver.torque_tolerance),
                "energy_tolerance": parse_optional_text_f64(&builder.solver.energy_tolerance),
                "max_steps": parse_optional_text_u64(&builder.solver.max_relax_steps),
            },
        },
        "mesh": {
            "algorithm_2d": builder.mesh.algorithm_2d,
            "algorithm_3d": builder.mesh.algorithm_3d,
            "hmax": parse_optional_text_f64_or_auto(&builder.mesh.hmax),
            "hmin": parse_optional_text_f64(&builder.mesh.hmin),
            "size_factor": builder.mesh.size_factor,
            "size_from_curvature": builder.mesh.size_from_curvature,
            "growth_rate": parse_optional_text_f64(&builder.mesh.growth_rate),
            "narrow_regions": builder.mesh.narrow_regions,
            "smoothing_steps": builder.mesh.smoothing_steps,
            "optimize": if builder.mesh.optimize.trim().is_empty() { Value::Null } else { Value::String(builder.mesh.optimize.clone()) },
            "optimize_iterations": builder.mesh.optimize_iterations,
            "compute_quality": builder.mesh.compute_quality,
            "per_element_quality": builder.mesh.per_element_quality,
            "adaptive_mesh": if !builder.mesh.adaptive_enabled { Value::Null } else { serde_json::json!({
                "enabled": builder.mesh.adaptive_enabled,
                "policy": builder.mesh.adaptive_policy,
                "theta": builder.mesh.adaptive_theta,
                "h_min": parse_optional_text_f64(&builder.mesh.adaptive_h_min),
                "h_max": parse_optional_text_f64(&builder.mesh.adaptive_h_max),
                "max_passes": builder.mesh.adaptive_max_passes,
                "error_tolerance": parse_optional_text_f64(&builder.mesh.adaptive_error_tolerance),
            }) },
        },
        "universe": builder.universe.as_ref().map(|universe| serde_json::json!({
            "mode": universe.mode,
            "size": universe.size,
            "center": universe.center,
            "padding": universe.padding,
        })).unwrap_or(Value::Null),
        "stages": builder.stages.iter().map(|stage| serde_json::json!({
            "kind": stage.kind,
            "entrypoint_kind": stage.entrypoint_kind,
            "integrator": if stage.integrator.trim().is_empty() { Value::Null } else { Value::String(stage.integrator.clone()) },
            "fixed_timestep": parse_optional_text_f64(&stage.fixed_timestep),
            "until_seconds": parse_optional_text_f64(&stage.until_seconds),
            "relax_algorithm": if stage.relax_algorithm.trim().is_empty() { Value::Null } else { Value::String(stage.relax_algorithm.clone()) },
            "torque_tolerance": parse_optional_text_f64(&stage.torque_tolerance),
            "energy_tolerance": parse_optional_text_f64(&stage.energy_tolerance),
            "max_steps": parse_optional_text_u64(&stage.max_steps),
        })).collect::<Vec<_>>(),
        "initial_state": builder.initial_state.as_ref().map(|initial_state| serde_json::json!({
            "magnet_name": initial_state.magnet_name,
            "source_path": initial_state.source_path,
            "format": initial_state.format,
            "dataset": initial_state.dataset,
            "sample_index": initial_state.sample_index,
        })).unwrap_or(Value::Null),
        "geometries": builder.geometries.iter().map(|geo| serde_json::json!({
            "name": geo.name,
            "region_name": geo.region_name,
            "geometry_kind": geo.geometry_kind,
            "geometry_params": geo.geometry_params,
            "bounds_min": geo.bounds_min,
            "bounds_max": geo.bounds_max,
            "material": {
                "Ms": geo.material.ms,
                "Aex": geo.material.aex,
                "alpha": geo.material.alpha,
                "Dind": geo.material.dind,
            },
            "magnetization": {
                "kind": geo.magnetization.kind,
                "value": geo.magnetization.value,
                "seed": geo.magnetization.seed,
                "source_path": geo.magnetization.source_path,
                "source_format": geo.magnetization.source_format,
                "dataset": geo.magnetization.dataset,
                "sample_index": geo.magnetization.sample_index,
            },
            "mesh": geo.mesh.as_ref().map(|m| serde_json::json!({
                "mode": m.mode,
                "hmax": parse_optional_text_f64_or_auto(&m.hmax),
                "hmin": parse_optional_text_f64(&m.hmin),
                "order": m.order,
                "source": m.source,
                "algorithm_2d": m.algorithm_2d,
                "algorithm_3d": m.algorithm_3d,
                "size_factor": m.size_factor,
                "size_from_curvature": m.size_from_curvature,
                "growth_rate": parse_optional_text_f64(&m.growth_rate),
                "narrow_regions": m.narrow_regions,
                "smoothing_steps": m.smoothing_steps,
                "optimize": m.optimize,
                "optimize_iterations": m.optimize_iterations,
                "compute_quality": m.compute_quality,
                "per_element_quality": m.per_element_quality,
                "size_fields": m.size_fields.iter().map(|field| serde_json::json!({
                    "kind": field.kind,
                    "params": field.params,
                })).collect::<Vec<_>>(),
                "operations": m.operations.iter().map(|operation| serde_json::json!({
                    "kind": operation.kind,
                    "params": operation.params,
                })).collect::<Vec<_>>(),
                "build_requested": m.build_requested,
            })),
        })).collect::<Vec<_>>(),
        "current_modules": builder.current_modules.iter().map(|module| serde_json::json!({
            "kind": module.kind,
            "name": module.name,
            "solver": module.solver,
            "air_box_factor": module.air_box_factor,
            "antenna_kind": module.antenna_kind,
            "antenna_params": module.antenna_params,
            "drive": {
                "current_a": module.drive.current_a,
                "frequency_hz": module.drive.frequency_hz,
                "phase_rad": module.drive.phase_rad,
                "waveform": module.drive.waveform,
            },
        })).collect::<Vec<_>>(),
        "excitation_analysis": builder.excitation_analysis.as_ref().map(|analysis| serde_json::json!({
            "source": analysis.source,
            "method": analysis.method,
            "propagation_axis": analysis.propagation_axis,
            "k_max_rad_per_m": analysis.k_max_rad_per_m,
            "samples": analysis.samples,
        })).unwrap_or(Value::Null),
    })
}

pub(crate) fn parse_optional_text_f64(raw: &str) -> Value {
    raw.trim()
        .parse::<f64>()
        .ok()
        .map_or(Value::Null, Value::from)
}

pub(crate) fn parse_optional_text_f64_or_auto(raw: &str) -> Value {
    let trimmed = raw.trim();
    if trimmed.eq_ignore_ascii_case("auto") {
        return Value::String("auto".to_string());
    }
    parse_optional_text_f64(trimmed)
}

pub(crate) fn parse_optional_text_u64(raw: &str) -> Value {
    raw.trim()
        .parse::<u64>()
        .ok()
        .map_or(Value::Null, Value::from)
}

pub(crate) fn read_magnetization_state_with_python(
    repo_root: &Path,
    path: &Path,
    format: Option<&str>,
    dataset: Option<&str>,
    sample_index: Option<i64>,
) -> Result<ReadMagnetizationStateHelperResponse, ApiError> {
    let mut helper_args = vec![
        "-m".to_string(),
        "fullmag.runtime.helper".to_string(),
        "read-magnetization-state".to_string(),
        "--path".to_string(),
        path.display().to_string(),
    ];
    if let Some(format) = format {
        helper_args.push("--format".to_string());
        helper_args.push(format.to_string());
    }
    if let Some(dataset) = dataset {
        helper_args.push("--dataset".to_string());
        helper_args.push(dataset.to_string());
    }
    if let Some(sample_index) = sample_index {
        helper_args.push("--sample".to_string());
        helper_args.push(sample_index.to_string());
    }

    let output = run_python_helper(repo_root, &helper_args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::bad_request(format!(
            "python magnetization-state reader failed: {}",
            stderr.trim()
        )));
    }
    serde_json::from_slice::<ReadMagnetizationStateHelperResponse>(&output.stdout).map_err(
        |error| {
            ApiError::internal(format!(
                "failed to deserialize state reader output: {}",
                error
            ))
        },
    )
}

pub(crate) fn convert_magnetization_state_with_python(
    repo_root: &Path,
    input_path: &Path,
    output_path: &Path,
    input_format: Option<&str>,
    output_format: Option<&str>,
    input_dataset: Option<&str>,
    output_dataset: Option<&str>,
    sample_index: Option<i64>,
) -> Result<(), ApiError> {
    let mut helper_args = vec![
        "-m".to_string(),
        "fullmag.runtime.helper".to_string(),
        "convert-magnetization-state".to_string(),
        "--input-path".to_string(),
        input_path.display().to_string(),
        "--output-path".to_string(),
        output_path.display().to_string(),
    ];
    if let Some(input_format) = input_format {
        helper_args.push("--input-format".to_string());
        helper_args.push(input_format.to_string());
    }
    if let Some(output_format) = output_format {
        helper_args.push("--output-format".to_string());
        helper_args.push(output_format.to_string());
    }
    if let Some(input_dataset) = input_dataset {
        helper_args.push("--input-dataset".to_string());
        helper_args.push(input_dataset.to_string());
    }
    if let Some(output_dataset) = output_dataset {
        helper_args.push("--output-dataset".to_string());
        helper_args.push(output_dataset.to_string());
    }
    if let Some(sample_index) = sample_index {
        helper_args.push("--sample".to_string());
        helper_args.push(sample_index.to_string());
    }

    let output = run_python_helper(repo_root, &helper_args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::bad_request(format!(
            "python magnetization-state converter failed: {}",
            stderr.trim()
        )));
    }
    Ok(())
}

pub(crate) fn run_python_helper(
    repo_root: &Path,
    args: &[String],
) -> Result<std::process::Output, ApiError> {
    let local_python = repo_root
        .join(".fullmag")
        .join("local")
        .join("python")
        .join("bin")
        .join("python");
    let repo_python = repo_root.join(".venv").join("bin").join("python");
    let mut candidates = Vec::new();

    if let Ok(preferred) = std::env::var("FULLMAG_PYTHON") {
        candidates.push(preferred);
    } else {
        for candidate in [local_python, repo_python] {
            if candidate.is_file() {
                candidates.push(candidate.display().to_string());
            }
        }
    }
    for fallback in ["python3", "python"] {
        if !candidates.iter().any(|candidate| candidate == fallback) {
            candidates.push(fallback.to_string());
        }
    }

    let pythonpath = repo_root.join("packages").join("fullmag-py").join("src");
    let fem_mesh_cache_dir = repo_root
        .join(".fullmag")
        .join("local")
        .join("cache")
        .join("fem_mesh_assets");
    let inherited_pythonpath = std::env::var("PYTHONPATH").ok();
    let mut last_error = None;

    for candidate in candidates {
        let mut command = ProcessCommand::new(&candidate);
        command.args(args);
        command.env("PYTHONUNBUFFERED", "1");
        command.env("FULLMAG_FEM_MESH_CACHE_DIR", &fem_mesh_cache_dir);
        if pythonpath.exists() {
            let mut merged = pythonpath.display().to_string();
            if let Some(existing) = &inherited_pythonpath {
                if !existing.is_empty() {
                    merged.push(':');
                    merged.push_str(existing);
                }
            }
            command.env("PYTHONPATH", merged);
        }

        match command.output() {
            Ok(output) => return Ok(output),
            Err(error) => {
                last_error = Some(format!("{}: {}", candidate, error));
            }
        }
    }

    Err(ApiError::internal(format!(
        "failed to spawn python helper ({})",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::{parse_eigen_dispersion_csv, sanitize_artifact_relative_path};
    use axum::http::StatusCode;

    #[test]
    fn sanitize_artifact_relative_path_rejects_parent_segments() {
        let error = sanitize_artifact_relative_path("../secret.json")
            .expect_err("parent segments must be rejected");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn parse_eigen_dispersion_csv_decodes_rows() {
        let csv =
            "mode_index,kx,ky,kz,frequency_hz,angular_frequency_rad_per_s\n0,0.0,1.0,2.0,3.0,4.0\n";
        let rows = parse_eigen_dispersion_csv(csv).expect("csv should parse");
        assert_eq!(
            rows,
            vec![EigenDispersionRow {
                mode_index: 0,
                kx: 0.0,
                ky: 1.0,
                kz: 2.0,
                frequency_hz: 3.0,
                angular_frequency_rad_per_s: 4.0,
            }]
        );
    }

    #[test]
    fn parse_eigen_dispersion_csv_rejects_short_rows() {
        let error = parse_eigen_dispersion_csv(
            "mode_index,kx,ky,kz,frequency_hz,angular_frequency_rad_per_s\n0,1,2\n",
        )
        .expect_err("short rows must fail");
        assert_eq!(error.status, StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn model_builder_graph_round_trips_script_builder_state() {
        let builder = ScriptBuilderState {
            revision: 7,
            solver: ScriptBuilderSolverState {
                integrator: "rk45".to_string(),
                fixed_timestep: "1e-15".to_string(),
                relax_algorithm: "llg_overdamped".to_string(),
                torque_tolerance: "1e-6".to_string(),
                energy_tolerance: "".to_string(),
                max_relax_steps: "1000".to_string(),
            },
            mesh: ScriptBuilderMeshState {
                algorithm_2d: 6,
                algorithm_3d: 1,
                hmax: "20e-9".to_string(),
                hmin: "".to_string(),
                size_factor: 1.0,
                size_from_curvature: 0,
                growth_rate: "".to_string(),
                narrow_regions: 0,
                smoothing_steps: 1,
                optimize: "Netgen".to_string(),
                optimize_iterations: 2,
                compute_quality: true,
                per_element_quality: false,
                adaptive_enabled: false,
                adaptive_policy: "auto".to_string(),
                adaptive_theta: 0.3,
                adaptive_h_min: "".to_string(),
                adaptive_h_max: "".to_string(),
                adaptive_max_passes: 2,
                adaptive_error_tolerance: "1e-3".to_string(),
            },
            universe: Some(ScriptBuilderUniverseState {
                mode: "manual".to_string(),
                size: Some([1.0, 2.0, 3.0]),
                center: Some([0.0, 0.0, 0.0]),
                padding: Some([0.1, 0.2, 0.3]),
            }),
            stages: vec![ScriptBuilderStageState {
                kind: "run".to_string(),
                entrypoint_kind: "study".to_string(),
                integrator: "rk45".to_string(),
                fixed_timestep: "".to_string(),
                until_seconds: "1e-9".to_string(),
                relax_algorithm: "".to_string(),
                torque_tolerance: "".to_string(),
                energy_tolerance: "".to_string(),
                max_steps: "".to_string(),
            }],
            initial_state: Some(ScriptBuilderInitialState {
                magnet_name: Some("flower".to_string()),
                source_path: "/tmp/m0.ovf".to_string(),
                format: "ovf".to_string(),
                dataset: None,
                sample_index: None,
            }),
            geometries: vec![ScriptBuilderGeometryEntry {
                name: "flower".to_string(),
                region_name: Some("core".to_string()),
                geometry_kind: "ImportedGeometry".to_string(),
                geometry_params: serde_json::json!({
                    "source": "flower.stl",
                    "units": "nm",
                }),
                bounds_min: Some([-1.0, -2.0, -3.0]),
                bounds_max: Some([1.0, 2.0, 3.0]),
                material: ScriptBuilderMaterialState {
                    ms: Some(752e3),
                    aex: Some(15.5e-12),
                    alpha: 0.1,
                    dind: None,
                },
                magnetization: ScriptBuilderMagnetizationState {
                    kind: "uniform".to_string(),
                    value: Some(vec![0.1, 0.0, 0.99]),
                    seed: None,
                    source_path: None,
                    source_format: None,
                    dataset: None,
                    sample_index: None,
                },
                mesh: Some(ScriptBuilderPerGeometryMeshState {
                    mode: "custom".to_string(),
                    hmax: "10e-9".to_string(),
                    hmin: "".to_string(),
                    order: Some(1),
                    source: None,
                    algorithm_2d: Some(6),
                    algorithm_3d: Some(10),
                    size_factor: Some(0.8),
                    size_from_curvature: Some(16),
                    growth_rate: "1.6".to_string(),
                    narrow_regions: Some(2),
                    smoothing_steps: Some(3),
                    optimize: Some("Netgen".to_string()),
                    optimize_iterations: Some(4),
                    compute_quality: Some(true),
                    per_element_quality: Some(false),
                    size_fields: vec![ScriptBuilderMeshSizeFieldState {
                        kind: "Ball".to_string(),
                        params: serde_json::json!({ "VIn": 1e-9, "Radius": 10e-9 }),
                    }],
                    operations: vec![ScriptBuilderMeshOperationState {
                        kind: "smooth".to_string(),
                        params: serde_json::json!({ "iterations": 2 }),
                    }],
                    build_requested: true,
                }),
            }],
            current_modules: vec![ScriptBuilderCurrentModuleState {
                kind: "antenna_field_source".to_string(),
                name: "cpw_1".to_string(),
                solver: "mqs_2p5d_az".to_string(),
                air_box_factor: 12.0,
                antenna_kind: "CPWAntenna".to_string(),
                antenna_params: serde_json::json!({ "gap": 1e-6 }),
                drive: ScriptBuilderDriveState {
                    current_a: 0.01,
                    frequency_hz: Some(10e9),
                    phase_rad: 0.0,
                    waveform: None,
                },
            }],
            excitation_analysis: Some(ScriptBuilderExcitationAnalysisState {
                source: "cpw_1".to_string(),
                method: "dispersion".to_string(),
                propagation_axis: [1.0, 0.0, 0.0],
                k_max_rad_per_m: Some(1e7),
                samples: 256,
            }),
        };

        let graph = model_builder_graph_from_script_builder(&builder);
        let round_trip = script_builder_from_model_builder_graph(&graph);

        assert_eq!(round_trip.revision, builder.revision);
        assert_eq!(round_trip.solver.integrator, builder.solver.integrator);
        assert_eq!(round_trip.mesh.hmax, builder.mesh.hmax);
        assert_eq!(
            round_trip.universe.as_ref().and_then(|u| u.size),
            builder.universe.as_ref().and_then(|u| u.size)
        );
        assert_eq!(round_trip.stages.len(), 1);
        assert_eq!(
            round_trip
                .initial_state
                .as_ref()
                .map(|state| state.source_path.clone()),
            Some("/tmp/m0.ovf".to_string())
        );
        assert_eq!(round_trip.geometries.len(), 1);
        assert_eq!(round_trip.geometries[0].name, "flower");
        assert_eq!(round_trip.current_modules.len(), 1);
        assert_eq!(
            round_trip
                .excitation_analysis
                .as_ref()
                .map(|analysis| analysis.source.clone()),
            Some("cpw_1".to_string())
        );
    }

    #[test]
    fn model_builder_graph_uses_stable_object_tree_ids() {
        let builder = ScriptBuilderState {
            revision: 1,
            solver: ScriptBuilderSolverState {
                integrator: "".to_string(),
                fixed_timestep: "".to_string(),
                relax_algorithm: "".to_string(),
                torque_tolerance: "".to_string(),
                energy_tolerance: "".to_string(),
                max_relax_steps: "".to_string(),
            },
            mesh: ScriptBuilderMeshState {
                algorithm_2d: 6,
                algorithm_3d: 1,
                hmax: "".to_string(),
                hmin: "".to_string(),
                size_factor: 1.0,
                size_from_curvature: 0,
                growth_rate: "".to_string(),
                narrow_regions: 0,
                smoothing_steps: 1,
                optimize: "".to_string(),
                optimize_iterations: 1,
                compute_quality: false,
                per_element_quality: false,
                adaptive_enabled: false,
                adaptive_policy: "auto".to_string(),
                adaptive_theta: 0.3,
                adaptive_h_min: "".to_string(),
                adaptive_h_max: "".to_string(),
                adaptive_max_passes: 2,
                adaptive_error_tolerance: "1e-3".to_string(),
            },
            universe: None,
            stages: Vec::new(),
            initial_state: None,
            geometries: vec![ScriptBuilderGeometryEntry {
                name: "nanoflower".to_string(),
                region_name: None,
                geometry_kind: "Box".to_string(),
                geometry_params: serde_json::json!({ "size": [1.0, 1.0, 1.0] }),
                bounds_min: None,
                bounds_max: None,
                material: ScriptBuilderMaterialState {
                    ms: None,
                    aex: None,
                    alpha: 0.1,
                    dind: None,
                },
                magnetization: ScriptBuilderMagnetizationState {
                    kind: "uniform".to_string(),
                    value: Some(vec![1.0, 0.0, 0.0]),
                    seed: None,
                    source_path: None,
                    source_format: None,
                    dataset: None,
                    sample_index: None,
                },
                mesh: None,
            }],
            current_modules: Vec::new(),
            excitation_analysis: None,
        };

        let graph = model_builder_graph_from_script_builder(&builder);
        let object = graph.objects.items.first().expect("object should exist");

        assert_eq!(object.id, "nanoflower");
        assert_eq!(object.tree.geometry, "geo-nanoflower");
        assert_eq!(object.tree.material, "mat-nanoflower");
        assert_eq!(object.tree.mesh, "geo-nanoflower-mesh");
    }

    #[test]
    fn script_builder_state_deserializes_mesh_without_adaptive_fields() {
        let builder: ScriptBuilderState = serde_json::from_value(serde_json::json!({
            "revision": 1,
            "solver": {
                "integrator": "rk45",
                "fixed_timestep": "",
                "relax_algorithm": "llg_overdamped",
                "torque_tolerance": "1e-6",
                "energy_tolerance": "",
                "max_relax_steps": "1000"
            },
            "mesh": {
                "algorithm_2d": 6,
                "algorithm_3d": 1,
                "hmax": "",
                "hmin": "",
                "size_factor": 1.0,
                "size_from_curvature": 0,
                "smoothing_steps": 1,
                "optimize": "",
                "optimize_iterations": 1,
                "compute_quality": false,
                "per_element_quality": false
            },
            "geometries": []
        }))
        .expect("builder draft without adaptive fields should deserialize");

        assert!(!builder.mesh.adaptive_enabled);
        assert_eq!(builder.mesh.adaptive_policy, "manual");
        assert_eq!(builder.mesh.adaptive_theta, 0.3);
        assert_eq!(builder.mesh.adaptive_max_passes, 5);
        assert_eq!(builder.mesh.growth_rate, "");
        assert_eq!(builder.mesh.narrow_regions, 0);
    }
}
