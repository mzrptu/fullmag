use anyhow::{anyhow, bail, Context, Result};
use clap::{Parser, ValueEnum};
use fullmag_ir::{BackendPlanIR, BackendTarget, ExecutionPlanIR, ProblemIR};
use std::ffi::OsString;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::args::*;
use crate::control_room::*;
use crate::formatting::*;
use crate::interactive_runtime_host::{CurrentLiveDisplaySelectionHandle, InteractiveRuntimeHost};
use crate::live_workspace::*;
use crate::python_bridge::*;
use crate::step_utils::*;
use crate::types::*;

// ── helpers local to the orchestrator ────────────────────────────────────────

fn current_live_metadata(
    problem: &ProblemIR,
    plan: &ExecutionPlanIR,
    status: &str,
) -> serde_json::Value {
    let live_preview_supported_quantities = match &plan.backend_plan {
        BackendPlanIR::Fdm(_) | BackendPlanIR::Fem(_) => {
            fullmag_runner::quantities::interactive_preview_quantity_ids()
        }
        BackendPlanIR::FdmMultilayer(_) => vec!["m"],
        BackendPlanIR::FemEigen(_) => vec![],
    };
    let runtime_engine = fullmag_runner::resolve_runtime_engine(problem)
        .ok()
        .map(|engine| {
            serde_json::json!({
                "backend_family": engine.backend_family,
                "engine_id": engine.engine_id,
                "engine_label": engine.engine_label,
                "accelerator": engine.accelerator,
            })
        });
    serde_json::json!({
        "problem_name": &problem.problem_meta.name,
        "ir_version": &problem.ir_version,
        "source_hash": &problem.problem_meta.source_hash,
        "problem_meta": &problem.problem_meta,
        "execution_plan": plan,
        "runtime_engine": runtime_engine,
        "artifact_layout": current_artifact_layout(plan),
        "meshing_capabilities": current_meshing_capabilities(plan),
        "live_preview": {
            "mode": "active_source",
            "supported_quantities": live_preview_supported_quantities,
            "downsampling": "runner_side_binned",
        },
        "engine_version": env!("CARGO_PKG_VERSION"),
        "status": status,
    })
}

#[allow(clippy::too_many_arguments)]
fn build_session_manifest(
    session_id: &str,
    run_id: &str,
    status: &str,
    interactive_session_requested: bool,
    script_path: &Path,
    problem_name: &str,
    requested_backend: &str,
    execution_mode: &str,
    precision: &str,
    artifact_dir: &Path,
    started_at_unix_ms: u128,
    finished_at_unix_ms: u128,
    plan_summary: serde_json::Value,
) -> SessionManifest {
    SessionManifest {
        session_id: session_id.to_string(),
        run_id: run_id.to_string(),
        status: status.to_string(),
        interactive_session_requested,
        script_path: script_path.display().to_string(),
        problem_name: problem_name.to_string(),
        requested_backend: requested_backend.to_string(),
        execution_mode: execution_mode.to_string(),
        precision: precision.to_string(),
        artifact_dir: artifact_dir.display().to_string(),
        started_at_unix_ms,
        finished_at_unix_ms,
        plan_summary,
    }
}

fn build_run_manifest(
    run_id: &str,
    session_id: &str,
    status: &str,
    artifact_dir: &Path,
) -> RunManifest {
    run_manifest_from_steps(run_id, session_id, status, artifact_dir, &[])
}

fn run_manifest_from_steps(
    run_id: &str,
    session_id: &str,
    status: &str,
    artifact_dir: &Path,
    steps: &[fullmag_runner::StepStats],
) -> RunManifest {
    RunManifest {
        run_id: run_id.to_string(),
        session_id: session_id.to_string(),
        status: status.to_string(),
        total_steps: steps.last().map(|step| step.step as usize).unwrap_or(0),
        final_time: steps.last().map(|step| step.time),
        final_e_ex: steps.last().map(|step| step.e_ex),
        final_e_demag: steps.last().map(|step| step.e_demag),
        final_e_ext: steps.last().map(|step| step.e_ext),
        final_e_total: steps.last().map(|step| step.e_total),
        artifact_dir: artifact_dir.display().to_string(),
    }
}

fn announce_session_start(_session_id: &str, script_path: &Path, backend: &str, headless: bool) {
    eprintln!("fullmag live workspace started");
    eprintln!("- script: {}", script_path.display());
    eprintln!("- requested_backend: {}", backend);
    if headless {
        eprintln!(
            "- live_hint: start the control room manually with `./scripts/dev-control-room.sh`"
        );
    } else {
        eprintln!("- live_hint: GUI bootstrap requested before solver start");
    }
}

fn print_script_summary(summary: &ScriptRunSummary) {
    println!("fullmag workspace summary");
    println!("- workspace_id: {}", summary.session_id);
    println!("- run_id: {}", summary.run_id);
    println!("- script: {}", summary.script_path);
    println!("- problem: {}", summary.problem_name);
    println!(
        "- execution: backend={} mode={} precision={}",
        summary.backend, summary.mode, summary.precision
    );
    println!("- status: {}", summary.status);
    println!("- total_steps: {}", summary.total_steps);
    if let Some(final_time) = summary.final_time {
        println!("- final_time: {:.6e} s", final_time);
    }
    if let Some(final_e_ex) = summary.final_e_ex {
        println!("- final_E_ex: {:.6e} J", final_e_ex);
    }
    if let Some(final_e_demag) = summary.final_e_demag {
        println!("- final_E_demag: {:.6e} J", final_e_demag);
    }
    if let Some(final_e_ext) = summary.final_e_ext {
        println!("- final_E_ext: {:.6e} J", final_e_ext);
    }
    if let Some(final_e_total) = summary.final_e_total {
        println!("- final_E_total: {:.6e} J", final_e_total);
    }
    println!("- artifact_dir: {}", summary.artifact_dir);
    println!("- workspace_dir: {}", summary.workspace_dir);
    println!("- web_ui: bootstrap auto-launch attempted for this workspace");
    println!(
        "- control_room_hint: if the browser did not open, run `./scripts/dev-control-room.sh {}` from the repo root for this workspace",
        summary.session_id
    );
}

fn refresh_problem_preview_state(
    base_problem: &ProblemIR,
    continuation_magnetization: Option<&[[f64; 3]]>,
    display_selection: &CurrentDisplaySelection,
    live_workspace: &LocalLiveWorkspace,
    refresh_cache: bool,
) -> Result<()> {
    let mut problem = base_problem.clone();
    if let Some(previous_final_magnetization) = continuation_magnetization {
        apply_continuation_initial_state(&mut problem, previous_final_magnetization)?;
    }

    let preview_field =
        fullmag_runner::snapshot_problem_preview(&problem, &display_selection.preview_request())?;
    live_workspace.update(|state| {
        state.live_state.updated_at_unix_ms = unix_time_millis().unwrap_or(0);
        state.live_state.latest_step.preview_field = Some(preview_field.clone());
        if refresh_cache {
            clear_cached_preview_fields(state);
        }
    });

    if refresh_cache {
        let cached_quantities = fullmag_runner::quantities::cached_preview_quantity_ids();
        let cached_fields = fullmag_runner::snapshot_problem_vector_fields(
            &problem,
            &cached_quantities,
            &display_selection.preview_request(),
        )?;
        live_workspace.update(|state| {
            replace_cached_preview_fields(state, cached_fields.clone());
        });
    }

    Ok(())
}

// ── main orchestration entry point ───────────────────────────────────────────

pub(crate) fn run_script_mode(raw_args: Vec<OsString>) -> Result<()> {
    init_api_port()?;
    let args = ScriptCli::parse_from(raw_args);
    let started_at_unix_ms = unix_time_millis()?;
    let script_path = args
        .script
        .canonicalize()
        .with_context(|| format!("failed to resolve script path {}", args.script.display()))?;
    check_script_syntax_via_python(&script_path)?;
    eprintln!("fullmag syntax check passed");
    eprintln!("- script: {}", script_path.display());
    let requested_backend_name = args
        .backend
        .map(|value| value.to_possible_value().unwrap().get_name().to_string())
        .unwrap_or_else(|| "auto".to_string());
    let requested_mode_name = args
        .mode
        .map(|value| value.to_possible_value().unwrap().get_name().to_string())
        .unwrap_or_else(|| "strict".to_string());
    let requested_precision_name = args
        .precision
        .map(|value| value.to_possible_value().unwrap().get_name().to_string())
        .unwrap_or_else(|| "double".to_string());

    let session_id = format!("session-{}-{}", started_at_unix_ms, std::process::id());
    let run_id = format!("run-{}", session_id);
    let workspace_dir = args.session_root.join(&session_id);
    let artifact_dir = args
        .output_dir
        .clone()
        .unwrap_or_else(|| workspace_dir.join("artifacts"));

    fs::create_dir_all(&workspace_dir)
        .with_context(|| format!("failed to create workspace dir {}", workspace_dir.display()))?;
    let field_every_n = 10;
    let current_live_publisher = CurrentLivePublisher::spawn(&session_id);
    let bootstrapping_session_manifest = build_session_manifest(
        &session_id,
        &run_id,
        "bootstrapping",
        args.interactive,
        &script_path,
        script_path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("fullmag_script"),
        &requested_backend_name,
        &requested_mode_name,
        &requested_precision_name,
        &artifact_dir,
        started_at_unix_ms,
        started_at_unix_ms,
        serde_json::json!({ "status": "bootstrapping" }),
    );
    let bootstrapping_run_manifest =
        build_run_manifest(&run_id, &session_id, "bootstrapping", &artifact_dir);
    let bootstrap_live_state_manifest = bootstrap_live_state("bootstrapping");
    let live_workspace = LocalLiveWorkspace::new(
        LocalLiveWorkspaceState {
            session: bootstrapping_session_manifest.clone(),
            run: bootstrapping_run_manifest.clone(),
            live_state: bootstrap_live_state_manifest.clone(),
            metadata: None,
            latest_scalar_row: None,
            latest_fields: CurrentLiveLatestFields::default(),
            preview_fields: CurrentLivePreviewFieldCache::default(),
            pending_preview_fields: CurrentLivePreviewFieldCache::default(),
            clear_preview_cache: false,
            engine_log: Vec::new(),
        },
        current_live_publisher.clone(),
    );
    let display_selection_handle = CurrentLiveDisplaySelectionHandle::spawn();
    live_workspace.push_log(
        "system",
        format!(
            "Workspace started for {}",
            script_path
                .file_name()
                .and_then(|file_name| file_name.to_str())
                .unwrap_or("script.py")
        ),
    );
    live_workspace.push_log(
        "info",
        format!(
            "Requested backend: {} · mode: {} · precision: {}",
            requested_backend_name, requested_mode_name, requested_precision_name
        ),
    );

    announce_session_start(
        &session_id,
        &script_path,
        &requested_backend_name,
        args.headless,
    );

    let mut _control_room_guard = ControlRoomGuard::inactive();
    if !args.headless {
        let (web_port, child) =
            spawn_control_room(&session_id, args.dev, args.web_port, &live_workspace)
                .with_context(|| {
                    format!(
                        "failed to bootstrap control room for workspace {}",
                        session_id
                    )
                })?;
        eprintln!("fullmag control room bootstrap verified");
        live_workspace.push_log("system", "Control room bootstrap verified");
        _control_room_guard = ControlRoomGuard::active(web_port, child);
    }

    live_workspace.publish_snapshot();
    live_workspace.update(|state| {
        state.session.status = "materializing_script".to_string();
        state.run.status = "materializing_script".to_string();
        set_live_state_status(&mut state.live_state, "materializing_script", Some(false));
    });
    live_workspace.push_log(
        "info",
        "Materializing Python script, importing geometry, and preparing execution plan",
    );
    eprintln!("fullmag materializing script");
    let script_config = match export_script_execution_config_via_python(
        &script_path,
        &args,
        Some({
            let live_workspace = live_workspace.clone();
            Arc::new(move |event: PythonProgressEvent| {
                apply_python_progress_event(&live_workspace, event);
            })
        }),
    ) {
        Ok(config) => config,
        Err(error) => {
            let failed_at_unix_ms = unix_time_millis()?;
            let previous_engine_log = live_workspace.snapshot().engine_log;
            live_workspace.replace(LocalLiveWorkspaceState {
                session: build_session_manifest(
                    &session_id,
                    &run_id,
                    "failed",
                    args.interactive,
                    &script_path,
                    script_path
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .unwrap_or("fullmag_script"),
                    &requested_backend_name,
                    &requested_mode_name,
                    &requested_precision_name,
                    &artifact_dir,
                    started_at_unix_ms,
                    failed_at_unix_ms,
                    serde_json::json!({ "status": "bootstrap_failed" }),
                ),
                run: build_run_manifest(&run_id, &session_id, "failed", &artifact_dir),
                live_state: {
                    let mut live_state = bootstrap_live_state("failed");
                    live_state.latest_step.finished = true;
                    live_state
                },
                metadata: None,
                latest_scalar_row: None,
                latest_fields: CurrentLiveLatestFields::default(),
                preview_fields: CurrentLivePreviewFieldCache::default(),
                pending_preview_fields: CurrentLivePreviewFieldCache::default(),
                clear_preview_cache: false,
                engine_log: previous_engine_log,
            });
            live_workspace.push_log("error", format!("Script materialization failed: {}", error));
            return Err(error);
        }
    };
    let mut stages = materialize_script_stages(script_config)?;
    if stages.is_empty() {
        bail!("script did not produce any executable stages");
    }
    for stage in &stages {
        validate_ir(&stage.ir)?;
    }
    let stage_execution_plans = stages
        .iter()
        .map(|stage| fullmag_plan::plan(&stage.ir).map_err(|error| anyhow!(error.to_string())))
        .collect::<Result<Vec<_>>>()?;

    let mut current_plan_summary = stages[0]
        .ir
        .plan_for(args.backend.map(BackendTarget::from))
        .map_err(join_errors)?;
    let initial_execution_plan = stage_execution_plans[0].clone();
    let initial_update = initial_step_update(&initial_execution_plan.backend_plan);

    let final_problem_name = stages
        .last()
        .expect("stages should be non-empty after validation")
        .ir
        .problem_meta
        .name
        .clone();
    let final_requested_backend = stages
        .last()
        .expect("stages should be non-empty after validation")
        .ir
        .backend_policy
        .requested_backend;
    let final_execution_mode = stages
        .last()
        .expect("stages should be non-empty after validation")
        .ir
        .validation_profile
        .execution_mode;
    let final_precision = stages
        .last()
        .expect("stages should be non-empty after validation")
        .ir
        .backend_policy
        .execution_precision;
    let interactive_template_ir = stages
        .last()
        .expect("stages should be non-empty after validation")
        .ir
        .clone();
    let script_requested_interactive = stages
        .last()
        .and_then(|stage| {
            stage
                .ir
                .problem_meta
                .runtime_metadata
                .get("interactive_session_requested")
        })
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let interactive_requested = args.interactive || script_requested_interactive;

    let previous_engine_log = live_workspace.snapshot().engine_log;
    live_workspace.replace(LocalLiveWorkspaceState {
        session: build_session_manifest(
            &session_id,
            &run_id,
            "running",
            interactive_requested,
            &script_path,
            &final_problem_name,
            backend_target_name(final_requested_backend),
            execution_mode_name(final_execution_mode),
            execution_precision_name(final_precision),
            &artifact_dir,
            started_at_unix_ms,
            started_at_unix_ms,
            plan_summary_json(&current_plan_summary),
        ),
        run: build_run_manifest(&run_id, &session_id, "running", &artifact_dir),
        live_state: live_state_manifest_from_update(&initial_update),
        metadata: Some(current_live_metadata(
            &stages[0].ir,
            &initial_execution_plan,
            "running",
        )),
        latest_scalar_row: None,
        latest_fields: CurrentLiveLatestFields::default(),
        preview_fields: CurrentLivePreviewFieldCache::default(),
        pending_preview_fields: CurrentLivePreviewFieldCache::default(),
        clear_preview_cache: false,
        engine_log: previous_engine_log,
    });
    live_workspace.push_log(
        "system",
        format!(
            "Script materialized — problem: {} · stages: {}",
            final_problem_name,
            stages.len()
        ),
    );
    eprintln!(
        "fullmag script materialized\n- problem: {}\n- stages: {}",
        final_problem_name,
        stages.len()
    );
    for (stage_index, (stage, plan)) in stages.iter().zip(stage_execution_plans.iter()).enumerate()
    {
        log_execution_plan(stage_index, stages.len(), stage, plan);
        for line in execution_plan_log_lines(stage_index, stages.len(), stage, plan) {
            live_workspace.push_log("info", line);
        }
    }

    let stage_count = stages.len();
    let mut aggregated_steps = Vec::<fullmag_runner::StepStats>::new();
    let mut step_offset = 0u64;
    let mut time_offset = 0.0f64;
    let mut continuation_magnetization: Option<Vec<[f64; 3]>> = None;

    // ── wait_for_solve gate ──────────────────────────────────────────────
    let wait_for_solve_requested = stages
        .first()
        .map(|stage| {
            stage
                .ir
                .problem_meta
                .runtime_metadata
                .get("wait_for_solve")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .unwrap_or(false);
    let is_fem_backend = matches!(&initial_execution_plan.backend_plan, BackendPlanIR::Fem(_));

    if wait_for_solve_requested && is_fem_backend {
        eprintln!("[fullmag] waiting for compute — adjust mesh in GUI, then click COMPUTE");
        live_workspace.push_log(
            "system",
            "Waiting for compute — adjust mesh in the control room, then click COMPUTE",
        );
        live_workspace.update(|state| {
            state.session.status = "waiting_for_compute".to_string();
            state.run.status = "waiting_for_compute".to_string();
            set_live_state_status(&mut state.live_state, "waiting_for_compute", Some(false));
        });

        // ── Auto-coarsen: if mesh exceeds available RAM, remesh with larger hmax ──
        if let BackendPlanIR::Fem(fem_plan) = &initial_execution_plan.backend_plan {
            let node_count = fem_plan.mesh.nodes.len();
            let available_ram = available_system_ram_bytes();
            let required_ram = estimate_fem_dense_ram(node_count);
            let ram_budget = (available_ram as f64 * 0.8) as u64;

            if required_ram > ram_budget {
                eprintln!(
                    "[fullmag] mesh too large for available RAM ({} nodes, {:.1} GB required, {:.1} GB available)",
                    node_count,
                    required_ram as f64 / 1e9,
                    available_ram as f64 / 1e9
                );
                live_workspace.push_log(
                    "warn",
                    format!(
                        "⛔ Mesh ({} nodes) requires {:.1} GB but only {:.1} GB available — auto-optimizing",
                        node_count,
                        required_ram as f64 / 1e9,
                        available_ram as f64 / 1e9
                    ),
                );

                let geometry_entry = stages[0].ir.geometry.entries.first().cloned();
                let fe_order = fem_plan.fe_order;
                let mut current_hmax = fem_plan.hmax;

                if let Some(geom) = geometry_entry {
                    for attempt in 1..=5 {
                        current_hmax *= 1.5;
                        eprintln!(
                            "[fullmag] auto-coarsen attempt {}/5 — trying hmax={:.2e}",
                            attempt, current_hmax
                        );
                        live_workspace.push_log(
                            "info",
                            format!(
                                "Auto-coarsen attempt {}/5 — hmax = {:.2e} m",
                                attempt, current_hmax
                            ),
                        );

                        match invoke_remesh(
                            &geom,
                            current_hmax,
                            fe_order,
                            &serde_json::json!({"compute_quality": true}),
                        ) {
                            Ok(new_mesh) => {
                                let new_nodes = new_mesh.nodes.len();
                                let new_ram = estimate_fem_dense_ram(new_nodes);
                                eprintln!(
                                    "[fullmag] auto-coarsen: {} nodes, {:.1} GB required",
                                    new_nodes,
                                    new_ram as f64 / 1e9
                                );

                                for stage in stages.iter_mut() {
                                    if let Some(assets) = stage.ir.geometry_assets.as_mut() {
                                        for fem_asset in assets.fem_mesh_assets.iter_mut() {
                                            fem_asset.mesh = Some(new_mesh.clone());
                                        }
                                    }
                                }

                                if new_ram <= ram_budget {
                                    live_workspace.push_log(
                                        "success",
                                        format!(
                                            "✅ Auto-coarsen complete — {} nodes ({:.1} GB), hmax = {:.2e} m",
                                            new_nodes,
                                            new_ram as f64 / 1e9,
                                            current_hmax
                                        ),
                                    );
                                    eprintln!(
                                        "[fullmag] auto-coarsen: mesh fits in RAM ({} nodes)",
                                        new_nodes
                                    );
                                    break;
                                }
                                live_workspace.push_log(
                                    "info",
                                    format!(
                                        "Still too large ({} nodes, {:.1} GB) — trying larger hmax",
                                        new_nodes,
                                        new_ram as f64 / 1e9
                                    ),
                                );
                            }
                            Err(e) => {
                                eprintln!("[fullmag] auto-coarsen remesh failed: {}", e);
                                live_workspace.push_log(
                                    "error",
                                    format!("Auto-coarsen remesh failed: {}", e),
                                );
                                break;
                            }
                        }
                    }
                }
            } else {
                let ram_msg = format!(
                    "Mesh: {} nodes · Est. RAM: {:.1} GB / {:.1} GB available",
                    node_count,
                    required_ram as f64 / 1e9,
                    available_ram as f64 / 1e9
                );
                live_workspace.push_log("info", &ram_msg);
                eprintln!("[fullmag] {}", ram_msg);
            }
        }

        loop {
            let Some(cmd) = display_selection_handle.wait_next_command(Duration::from_millis(250))
            else {
                continue;
            };

            match cmd.kind.as_str() {
                "preview_update" | "preview_refresh" => {
                    display_selection_handle.apply_preview_command(&cmd);
                    let display_selection = display_selection_handle.display_selection_snapshot();
                    if let Err(error) = refresh_problem_preview_state(
                        &stages[0].ir,
                        continuation_magnetization.as_deref(),
                        &display_selection,
                        &live_workspace,
                        supports_interactive_latest_field_cache(
                            &stage_execution_plans[0].backend_plan,
                        ),
                    ) {
                        live_workspace.push_log(
                            "warn",
                            format!("Preview refresh after selection change failed: {}", error),
                        );
                    }
                    continue;
                }
                "load_state" => {
                    let Some(state_path) = cmd.state_path.as_deref() else {
                        live_workspace
                            .push_log("error", "State import command is missing state_path");
                        continue;
                    };
                    match read_magnetization_state(
                        Path::new(state_path),
                        cmd.state_format.as_deref(),
                        cmd.state_dataset.as_deref(),
                        cmd.state_sample_index,
                    ) {
                        Ok(loaded_state) => {
                            continuation_magnetization = Some(loaded_state.values.clone());
                            live_workspace.update(|state| {
                                state.live_state.updated_at_unix_ms =
                                    unix_time_millis().unwrap_or(0);
                                state.live_state.latest_step.magnetization =
                                    Some(flatten_magnetization(&loaded_state.values));
                                clear_cached_preview_fields(state);
                            });
                            let display_selection =
                                display_selection_handle.display_selection_snapshot();
                            if let Err(error) = refresh_problem_preview_state(
                                &stages[0].ir,
                                continuation_magnetization.as_deref(),
                                &display_selection,
                                &live_workspace,
                                supports_interactive_latest_field_cache(
                                    &stage_execution_plans[0].backend_plan,
                                ),
                            ) {
                                live_workspace.push_log(
                                    "warn",
                                    format!("Loaded state preview refresh failed: {}", error),
                                );
                            }
                            live_workspace.push_log(
                                "success",
                                format!(
                                    "Loaded workspace state from {} ({} vectors)",
                                    state_path, loaded_state.vector_count
                                ),
                            );
                        }
                        Err(error) => {
                            live_workspace.push_log(
                                "error",
                                format!("Failed to load workspace state: {}", error),
                            );
                        }
                    }
                    continue;
                }
                "solve" | "compute" => {
                    eprintln!("[fullmag] compute requested — starting solver");
                    live_workspace.push_log("system", "Compute requested — starting solver");
                    live_workspace.update(|state| {
                        state.session.status = "running".to_string();
                        state.run.status = "running".to_string();
                        set_live_state_status(&mut state.live_state, "running", Some(false));
                        clear_cached_preview_fields(state);
                    });
                    break;
                }
                "remesh" => {
                    let opts = cmd.mesh_options.unwrap_or(serde_json::json!({}));
                    eprintln!("[fullmag] remesh requested with options: {}", opts);
                    live_workspace
                        .push_log("info", format!("Remesh requested — options: {}", opts));
                    let first_stage = &stages[0];
                    let geometry_entry = first_stage.ir.geometry.entries.first();
                    let fem_plan = match &stage_execution_plans[0].backend_plan {
                        BackendPlanIR::Fem(plan) => Some(plan),
                        _ => None,
                    };
                    if let (Some(geom), Some(plan)) = (geometry_entry, fem_plan) {
                        let hmax = opts
                            .get("hmax")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(plan.hmax);
                        match invoke_remesh(geom, hmax, plan.fe_order, &opts) {
                            Ok(new_mesh) => {
                                let node_count = new_mesh.nodes.len();
                                let elem_count = new_mesh.elements.len();
                                let face_count = new_mesh.boundary_faces.len();
                                live_workspace.push_log(
                                    "success",
                                    format!(
                                        "Remesh complete — {} nodes, {} elements, {} boundary faces",
                                        node_count, elem_count, face_count
                                    ),
                                );
                                eprintln!(
                                    "[fullmag] remesh complete — {} nodes, {} elements",
                                    node_count, elem_count
                                );
                                if node_count > 50_000 {
                                    live_workspace.push_log(
                                        "warn",
                                        format!(
                                            "⛔ Mesh has {} nodes — CPU dense solver will likely OOM. Increase hmax.",
                                            node_count
                                        ),
                                    );
                                } else if node_count > 10_000 {
                                    live_workspace.push_log(
                                        "warn",
                                        format!(
                                            "⚠ Mesh has {} nodes — may be slow with CPU dense solver.",
                                            node_count
                                        ),
                                    );
                                }
                                for stage in stages.iter_mut() {
                                    if let Some(assets) = stage.ir.geometry_assets.as_mut() {
                                        for fem_asset in assets.fem_mesh_assets.iter_mut() {
                                            fem_asset.mesh = Some(new_mesh.clone());
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("[fullmag] remesh failed: {}", e);
                                live_workspace.push_log("error", format!("Remesh failed: {}", e));
                            }
                        }
                    } else {
                        live_workspace.push_log(
                            "warn",
                            "Cannot remesh — no geometry entry or FEM plan available",
                        );
                    }
                }
                "stop" => {
                    eprintln!("[fullmag] aborted by user during wait_for_solve");
                    live_workspace.push_log("system", "Aborted by user");
                    live_workspace.update(|state| {
                        state.session.status = "stopped".to_string();
                        state.run.status = "stopped".to_string();
                        set_live_state_status(&mut state.live_state, "stopped", Some(true));
                    });
                    return Ok(());
                }
                other => {
                    eprintln!(
                        "[fullmag] ignoring command '{}' during wait_for_solve",
                        other
                    );
                }
            }
        }
    } else if wait_for_solve_requested && !is_fem_backend {
        eprintln!("[fullmag] wait_for_solve ignored — only supported for FEM backend");
        live_workspace.push_log(
            "warn",
            "wait_for_solve is only supported for FEM backend — proceeding immediately",
        );
    }

    for (stage_index, mut stage) in stages.into_iter().enumerate() {
        if stage.entrypoint_kind == "flat_workspace" {
            live_workspace.push_log(
                "system",
                "Workspace-only script loaded — awaiting control-room command".to_string(),
            );
            continue;
        }
        if let Some(previous_final_magnetization) = continuation_magnetization.as_deref() {
            apply_continuation_initial_state(&mut stage.ir, previous_final_magnetization)?;
        }
        validate_ir(&stage.ir)?;

        current_plan_summary = stage
            .ir
            .plan_for(args.backend.map(BackendTarget::from))
            .map_err(join_errors)?;
        let execution_plan =
            fullmag_plan::plan(&stage.ir).map_err(|error| anyhow!(error.to_string()))?;
        emit_initial_state_warnings(Some(&live_workspace), &execution_plan.backend_plan)?;
        let use_live_callback = matches!(
            &execution_plan.backend_plan,
            BackendPlanIR::Fdm(_) | BackendPlanIR::FdmMultilayer(_) | BackendPlanIR::Fem(_)
        );
        let is_final_stage = stage_index + 1 == stage_count;
        let is_session_final_stage = is_final_stage && !interactive_requested;
        let current_stage_artifact_dir = stage_artifact_dir(
            &workspace_dir,
            &artifact_dir,
            stage_index,
            stage_count,
            &stage.entrypoint_kind,
        );
        fs::create_dir_all(&current_stage_artifact_dir).with_context(|| {
            format!(
                "failed to create stage artifact dir {}",
                current_stage_artifact_dir.display()
            )
        })?;

        let stage_initial_update = offset_step_update(
            &initial_step_update(&execution_plan.backend_plan),
            step_offset,
            time_offset,
            false,
        );
        live_workspace.push_log(
            "system",
            format!(
                "Executing stage {}/{} ({})",
                stage_index + 1,
                stage_count,
                stage.entrypoint_kind
            ),
        );
        live_workspace.update(|state| {
            state.session = build_session_manifest(
                &session_id,
                &run_id,
                "running",
                interactive_requested,
                &script_path,
                &stage.ir.problem_meta.name,
                backend_target_name(stage.ir.backend_policy.requested_backend),
                execution_mode_name(stage.ir.validation_profile.execution_mode),
                execution_precision_name(stage.ir.backend_policy.execution_precision),
                &artifact_dir,
                started_at_unix_ms,
                started_at_unix_ms,
                plan_summary_json(&current_plan_summary),
            );
            state.metadata = Some(current_live_metadata(&stage.ir, &execution_plan, "running"));
            state.run = running_run_manifest_from_update(
                &run_id,
                &session_id,
                &artifact_dir,
                &stage_initial_update,
            );
            state.live_state = live_state_manifest_from_update(&stage_initial_update);
            clear_cached_preview_fields(state);
        });

        let stage_result = match if use_live_callback {
            if supports_dynamic_live_preview(&execution_plan.backend_plan) {
                let display_selection = || display_selection_handle.display_selection_snapshot();
                fullmag_runner::run_problem_with_live_preview(
                    &stage.ir,
                    stage.until_seconds,
                    &current_stage_artifact_dir,
                    field_every_n,
                    &display_selection,
                    |update| {
                        let adjusted = offset_step_update(
                            &update,
                            step_offset,
                            time_offset,
                            update.finished && is_session_final_stage,
                        );
                        let s = &adjusted.stats;
                        let print_step = s.step <= 10
                            || (s.step <= 100 && s.step % 10 == 0)
                            || (s.step <= 1000 && s.step % 100 == 0)
                            || s.step % 1000 == 0
                            || adjusted.finished;
                        if print_step {
                            let wall_ms = s.wall_time_ns as f64 / 1e6;
                            eprintln!(
                                "stage {}/{} ({})  step {:>6}  t={:.4e}  dt={:.3e}  maxTorque={:.4e}  E_total={:.4e}  |H_eff|={:.4e}  [{:.0}ms]",
                                stage_index + 1,
                                stage_count,
                                stage.entrypoint_kind,
                                s.step,
                                s.time,
                                s.dt,
                                s.max_dm_dt,
                                s.e_total,
                                s.max_h_eff,
                                wall_ms
                            );
                        }

                        if adjusted.stats.step <= 1
                            || adjusted.stats.step % field_every_n == 0
                            || adjusted.scalar_row_due
                            || adjusted.preview_field.is_some()
                            || adjusted.finished
                        {
                            live_workspace.update(|state| {
                                state.session.status = if adjusted.finished {
                                    "completed".to_string()
                                } else {
                                    "running".to_string()
                                };
                                state.run = running_run_manifest_from_update(
                                    &run_id,
                                    &session_id,
                                    &artifact_dir,
                                    &adjusted,
                                );
                                state.live_state = live_state_manifest_from_update(&adjusted);
                                set_latest_scalar_row_if_due(state, &adjusted);
                                if let Some(preview_field) = adjusted.preview_field.as_ref() {
                                    upsert_cached_preview_field(state, preview_field);
                                }
                            });
                        }
                        fullmag_runner::StepAction::Continue
                    },
                )
            } else {
                fullmag_runner::run_problem_with_callback(
                    &stage.ir,
                    stage.until_seconds,
                    &current_stage_artifact_dir,
                    field_every_n,
                    |update| {
                        let adjusted = offset_step_update(
                            &update,
                            step_offset,
                            time_offset,
                            update.finished && is_session_final_stage,
                        );
                        let s = &adjusted.stats;
                        let print_step = s.step <= 10
                            || (s.step <= 100 && s.step % 10 == 0)
                            || (s.step <= 1000 && s.step % 100 == 0)
                            || s.step % 1000 == 0
                            || adjusted.finished;
                        if print_step {
                            let wall_ms = s.wall_time_ns as f64 / 1e6;
                            eprintln!(
                                "stage {}/{} ({})  step {:>6}  t={:.4e}  dt={:.3e}  maxTorque={:.4e}  E_total={:.4e}  |H_eff|={:.4e}  [{:.0}ms]",
                                stage_index + 1,
                                stage_count,
                                stage.entrypoint_kind,
                                s.step,
                                s.time,
                                s.dt,
                                s.max_dm_dt,
                                s.e_total,
                                s.max_h_eff,
                                wall_ms
                            );
                        }

                        if adjusted.stats.step <= 1
                            || adjusted.stats.step % field_every_n == 0
                            || adjusted.scalar_row_due
                            || adjusted.finished
                        {
                            live_workspace.update(|state| {
                                state.session.status = if adjusted.finished {
                                    "completed".to_string()
                                } else {
                                    "running".to_string()
                                };
                                state.run = running_run_manifest_from_update(
                                    &run_id,
                                    &session_id,
                                    &artifact_dir,
                                    &adjusted,
                                );
                                state.live_state = live_state_manifest_from_update(&adjusted);
                                set_latest_scalar_row_if_due(state, &adjusted);
                            });
                        }
                        fullmag_runner::StepAction::Continue
                    },
                )
            }
        } else {
            fullmag_runner::run_problem(&stage.ir, stage.until_seconds, &current_stage_artifact_dir)
        } {
            Ok(result) => result,
            Err(error) => {
                let failed_at_unix_ms = unix_time_millis()?;
                let mut snapshot = live_workspace.snapshot();
                snapshot.session = build_session_manifest(
                    &session_id,
                    &run_id,
                    "failed",
                    interactive_requested,
                    &script_path,
                    &final_problem_name,
                    backend_target_name(final_requested_backend),
                    execution_mode_name(final_execution_mode),
                    execution_precision_name(final_precision),
                    &artifact_dir,
                    started_at_unix_ms,
                    failed_at_unix_ms,
                    plan_summary_json(&current_plan_summary),
                );
                snapshot.metadata =
                    Some(current_live_metadata(&stage.ir, &execution_plan, "failed"));
                snapshot.run = run_manifest_from_steps(
                    &run_id,
                    &session_id,
                    "failed",
                    &artifact_dir,
                    &aggregated_steps,
                );
                set_live_state_status(&mut snapshot.live_state, "failed", Some(true));
                live_workspace.replace(snapshot);
                live_workspace.push_log("error", format!("Stage execution failed: {}", error));
                return Err(anyhow!(error.to_string()));
            }
        };

        if !use_live_callback {
            let grid = match &execution_plan.backend_plan {
                BackendPlanIR::Fdm(fdm) => {
                    [fdm.grid.cells[0], fdm.grid.cells[1], fdm.grid.cells[2]]
                }
                BackendPlanIR::FdmMultilayer(fdm) => [
                    fdm.common_cells[0],
                    fdm.common_cells[1],
                    fdm.common_cells[2],
                ],
                BackendPlanIR::Fem(_) | BackendPlanIR::FemEigen(_) => [0, 0, 0],
            };
            let fem_mesh = match &execution_plan.backend_plan {
                BackendPlanIR::Fem(fem) => Some(fullmag_runner::FemMeshPayload {
                    nodes: fem.mesh.nodes.clone(),
                    elements: fem.mesh.elements.clone(),
                    boundary_faces: fem.mesh.boundary_faces.clone(),
                }),
                BackendPlanIR::FemEigen(fem) => Some(fullmag_runner::FemMeshPayload {
                    nodes: fem.mesh.nodes.clone(),
                    elements: fem.mesh.elements.clone(),
                    boundary_faces: fem.mesh.boundary_faces.clone(),
                }),
                BackendPlanIR::Fdm(_) | BackendPlanIR::FdmMultilayer(_) => None,
            };
            for (index, stats) in stage_result.steps.iter().enumerate() {
                let is_final_step = index + 1 == stage_result.steps.len();
                let update = fullmag_runner::StepUpdate {
                    stats: offset_step_stats(std::slice::from_ref(stats), step_offset, time_offset)
                        .into_iter()
                        .next()
                        .expect("single step should offset"),
                    grid,
                    fem_mesh: fem_mesh.clone(),
                    magnetization: if is_final_step
                        && is_session_final_stage
                        && matches!(&execution_plan.backend_plan, BackendPlanIR::Fdm(_))
                    {
                        Some(flatten_magnetization(&stage_result.final_magnetization))
                    } else {
                        None
                    },
                    preview_field: None,
                    scalar_row_due: true,
                    finished: is_final_step && is_session_final_stage,
                };
                if update.stats.step <= 1
                    || update.stats.step % field_every_n == 0
                    || update.scalar_row_due
                    || update.finished
                {
                    live_workspace.update(|state| {
                        state.session.status = if update.finished {
                            "completed".to_string()
                        } else {
                            "running".to_string()
                        };
                        state.run = running_run_manifest_from_update(
                            &run_id,
                            &session_id,
                            &artifact_dir,
                            &update,
                        );
                        state.live_state = live_state_manifest_from_update(&update);
                        set_latest_scalar_row_if_due(state, &update);
                    });
                }
            }
        }

        if let Some(final_update) = final_stage_step_update(
            &execution_plan.backend_plan,
            &stage_result.steps,
            &stage_result.final_magnetization,
            step_offset,
            time_offset,
            is_session_final_stage,
        ) {
            live_workspace.update(|state| {
                state.session.status = if final_update.finished {
                    "completed".to_string()
                } else {
                    "running".to_string()
                };
                state.run = running_run_manifest_from_update(
                    &run_id,
                    &session_id,
                    &artifact_dir,
                    &final_update,
                );
                state.live_state = live_state_manifest_from_update(&final_update);
                set_latest_scalar_row_if_due(state, &final_update);
            });
        }

        let offset_steps = offset_step_stats(&stage_result.steps, step_offset, time_offset);
        if let Some(last) = offset_steps.last() {
            step_offset = last.step;
            time_offset = last.time;
        }
        aggregated_steps.extend(offset_steps);
        continuation_magnetization = Some(stage_result.final_magnetization);
        live_workspace.push_log(
            "success",
            format!(
                "Stage {}/{} ({}) completed",
                stage_index + 1,
                stage_count,
                stage.entrypoint_kind
            ),
        );
    }

    if interactive_requested {
        let awaiting_at_unix_ms = unix_time_millis()?;
        live_workspace.update(|state| {
            state.session = build_session_manifest(
                &session_id,
                &run_id,
                "awaiting_command",
                interactive_requested,
                &script_path,
                &final_problem_name,
                backend_target_name(final_requested_backend),
                execution_mode_name(final_execution_mode),
                execution_precision_name(final_precision),
                &artifact_dir,
                started_at_unix_ms,
                awaiting_at_unix_ms,
                plan_summary_json(&current_plan_summary),
            );
            state.run = run_manifest_from_steps(
                &run_id,
                &session_id,
                "awaiting_command",
                &artifact_dir,
                &aggregated_steps,
            );
            set_live_state_status(&mut state.live_state, "awaiting_command", Some(false));
        });
        live_workspace.push_log(
            "system",
            "Scripted stages finished — workspace is awaiting interactive commands",
        );
        eprintln!("interactive workspace ready");
        eprintln!("- workspace_id: {}", session_id);
        eprintln!("- queue: submit commands through the control room or API");

        let mut interactive_runtime_host = InteractiveRuntimeHost::new(
            display_selection_handle.clone(),
            interactive_template_ir.clone(),
            artifact_dir.clone(),
            &initial_execution_plan.backend_plan,
        );
        interactive_runtime_host
            .enter_awaiting_command(continuation_magnetization.clone(), &live_workspace);

        let mut interactive_stage_index = stage_count;
        loop {
            let Some(command) =
                interactive_runtime_host.wait_next_command(Duration::from_millis(250))
            else {
                continue;
            };

            if interactive_runtime_host.handle_preview_command(&command, &live_workspace) {
                continue;
            }

            if command.kind == "pause" {
                live_workspace.push_log("system", "Paused — awaiting next command");
                continue;
            }

            if command.kind == "load_state" {
                let Some(state_path) = command.state_path.as_deref() else {
                    live_workspace.push_log("error", "State import command is missing state_path");
                    continue;
                };
                match read_magnetization_state(
                    Path::new(state_path),
                    command.state_format.as_deref(),
                    command.state_dataset.as_deref(),
                    command.state_sample_index,
                ) {
                    Ok(loaded_state) => {
                        if let Err(error) = interactive_runtime_host
                            .load_state(loaded_state.values.clone(), &live_workspace)
                        {
                            live_workspace.push_log(
                                "error",
                                format!("Failed to apply imported workspace state: {}", error),
                            );
                            continue;
                        }
                        continuation_magnetization = Some(loaded_state.values);
                        live_workspace.push_log(
                            "success",
                            format!(
                                "Loaded workspace state from {} ({} vectors)",
                                state_path, loaded_state.vector_count
                            ),
                        );
                    }
                    Err(error) => {
                        live_workspace.push_log(
                            "error",
                            format!("Failed to load workspace state: {}", error),
                        );
                    }
                }
                continue;
            }

            let Some(mut stage) =
                (match build_interactive_command_stage(&interactive_template_ir, &command) {
                    Ok(stage) => stage,
                    Err(_) => continue,
                })
            else {
                break;
            };

            if let Some(previous_final_magnetization) = continuation_magnetization.as_deref() {
                apply_continuation_initial_state(&mut stage.ir, previous_final_magnetization)?;
            }
            validate_ir(&stage.ir)?;
            current_plan_summary = stage
                .ir
                .plan_for(args.backend.map(BackendTarget::from))
                .map_err(join_errors)?;
            let execution_plan =
                fullmag_plan::plan(&stage.ir).map_err(|error| anyhow!(error.to_string()))?;
            emit_initial_state_warnings(Some(&live_workspace), &execution_plan.backend_plan)?;
            let use_live_callback = matches!(
                &execution_plan.backend_plan,
                BackendPlanIR::Fdm(_) | BackendPlanIR::FdmMultilayer(_) | BackendPlanIR::Fem(_)
            );
            let current_stage_artifact_dir = stage_artifact_dir(
                &workspace_dir,
                &artifact_dir,
                interactive_stage_index,
                interactive_stage_index + 2,
                &stage.entrypoint_kind,
            );
            fs::create_dir_all(&current_stage_artifact_dir).with_context(|| {
                format!(
                    "failed to create interactive stage artifact dir {}",
                    current_stage_artifact_dir.display()
                )
            })?;
            let running_at_unix_ms = unix_time_millis()?;
            let stage_initial_update = offset_step_update(
                &initial_step_update(&execution_plan.backend_plan),
                step_offset,
                time_offset,
                false,
            );
            live_workspace.push_log(
                "system",
                format!("Executing interactive command: {}", command.kind),
            );
            interactive_runtime_host.mark_running();
            live_workspace.update(|state| {
                state.session = build_session_manifest(
                    &session_id,
                    &run_id,
                    "running",
                    interactive_requested,
                    &script_path,
                    &final_problem_name,
                    backend_target_name(final_requested_backend),
                    execution_mode_name(final_execution_mode),
                    execution_precision_name(final_precision),
                    &artifact_dir,
                    started_at_unix_ms,
                    running_at_unix_ms,
                    plan_summary_json(&current_plan_summary),
                );
                state.run = run_manifest_from_steps(
                    &run_id,
                    &session_id,
                    "running",
                    &artifact_dir,
                    &aggregated_steps,
                );
                state.metadata = Some(current_live_metadata(&stage.ir, &execution_plan, "running"));
                state.live_state = live_state_manifest_from_update(&stage_initial_update);
                clear_cached_preview_fields(state);
            });

            let stage_result = match if use_live_callback {
                let running_control = interactive_runtime_host.control();
                if supports_dynamic_live_preview(&execution_plan.backend_plan) {
                    let display_selection = || running_control.display_selection_snapshot();
                    let mut on_step = |update| {
                        let adjusted = offset_step_update(&update, step_offset, time_offset, false);
                        let s = &adjusted.stats;
                        let print_step = s.step <= 10
                            || (s.step <= 100 && s.step % 10 == 0)
                            || (s.step <= 1000 && s.step % 100 == 0)
                            || s.step % 1000 == 0;
                        if print_step {
                            let wall_ms = s.wall_time_ns as f64 / 1e6;
                            eprintln!(
                                "interactive {}  step {:>6}  t={:.4e}  dt={:.3e}  maxTorque={:.4e}  E_total={:.4e}  |H_eff|={:.4e}  [{:.0}ms]",
                                stage.entrypoint_kind,
                                s.step,
                                s.time,
                                s.dt,
                                s.max_dm_dt,
                                s.e_total,
                                s.max_h_eff,
                                wall_ms
                            );
                        }

                        if adjusted.stats.step <= 1
                            || adjusted.stats.step % field_every_n == 0
                            || adjusted.scalar_row_due
                            || adjusted.preview_field.is_some()
                        {
                            live_workspace.update(|state| {
                                state.session.status = "running".to_string();
                                state.run = running_run_manifest_from_update(
                                    &run_id,
                                    &session_id,
                                    &artifact_dir,
                                    &adjusted,
                                );
                                state.live_state = live_state_manifest_from_update(&adjusted);
                                set_latest_scalar_row_if_due(state, &adjusted);
                                if let Some(preview_field) = adjusted.preview_field.as_ref() {
                                    upsert_cached_preview_field(state, preview_field);
                                }
                            });
                        }

                        if let Some(action) = running_control.process_running_control() {
                            return action;
                        }
                        fullmag_runner::StepAction::Continue
                    };

                    if matches!(
                        &execution_plan.backend_plan,
                        BackendPlanIR::Fdm(_) | BackendPlanIR::Fem(_)
                    ) {
                        if let Err(error) = interactive_runtime_host.ensure_runtime_for_problem(
                            &stage.ir,
                            continuation_magnetization.as_deref(),
                        ) {
                            eprintln!("interactive preview runtime warning: {}", error);
                            live_workspace.push_log(
                                "warn",
                                format!(
                                    "Falling back to one-shot interactive runner path: {}",
                                    error
                                ),
                            );
                        }
                    }

                    if let Some(runtime) = interactive_runtime_host.runtime_mut() {
                        fullmag_runner::run_problem_with_interactive_runtime_live_preview(
                            runtime,
                            &stage.ir,
                            stage.until_seconds,
                            &current_stage_artifact_dir,
                            field_every_n,
                            &display_selection,
                            &mut on_step,
                        )
                    } else {
                        fullmag_runner::run_problem_with_live_preview(
                            &stage.ir,
                            stage.until_seconds,
                            &current_stage_artifact_dir,
                            field_every_n,
                            &display_selection,
                            &mut on_step,
                        )
                    }
                } else {
                    fullmag_runner::run_problem_with_callback(
                        &stage.ir,
                        stage.until_seconds,
                        &current_stage_artifact_dir,
                        field_every_n,
                        |update| {
                            let adjusted =
                                offset_step_update(&update, step_offset, time_offset, false);
                            let s = &adjusted.stats;
                            let print_step = s.step <= 10
                                || (s.step <= 100 && s.step % 10 == 0)
                                || (s.step <= 1000 && s.step % 100 == 0)
                                || s.step % 1000 == 0;
                            if print_step {
                                let wall_ms = s.wall_time_ns as f64 / 1e6;
                                eprintln!(
                                    "interactive {}  step {:>6}  t={:.4e}  dt={:.3e}  maxTorque={:.4e}  E_total={:.4e}  |H_eff|={:.4e}  [{:.0}ms]",
                                    stage.entrypoint_kind,
                                    s.step,
                                    s.time,
                                    s.dt,
                                    s.max_dm_dt,
                                    s.e_total,
                                    s.max_h_eff,
                                    wall_ms
                                );
                            }

                            if adjusted.stats.step <= 1
                                || adjusted.stats.step % field_every_n == 0
                                || adjusted.scalar_row_due
                            {
                                live_workspace.update(|state| {
                                    state.session.status = "running".to_string();
                                    state.run = running_run_manifest_from_update(
                                        &run_id,
                                        &session_id,
                                        &artifact_dir,
                                        &adjusted,
                                    );
                                    state.live_state = live_state_manifest_from_update(&adjusted);
                                    set_latest_scalar_row_if_due(state, &adjusted);
                                    if let Some(preview_field) = adjusted.preview_field.as_ref() {
                                        upsert_cached_preview_field(state, preview_field);
                                    }
                                });
                            }

                            if let Some(action) = running_control.process_running_control() {
                                return action;
                            }
                            fullmag_runner::StepAction::Continue
                        },
                    )
                }
            } else {
                fullmag_runner::run_problem(
                    &stage.ir,
                    stage.until_seconds,
                    &current_stage_artifact_dir,
                )
            } {
                Ok(result) => result,
                Err(error) => {
                    let failed_ready_at_unix_ms = unix_time_millis().unwrap_or(awaiting_at_unix_ms);
                    live_workspace.update(|state| {
                        state.session = build_session_manifest(
                            &session_id,
                            &run_id,
                            "awaiting_command",
                            interactive_requested,
                            &script_path,
                            &final_problem_name,
                            backend_target_name(final_requested_backend),
                            execution_mode_name(final_execution_mode),
                            execution_precision_name(final_precision),
                            &artifact_dir,
                            started_at_unix_ms,
                            failed_ready_at_unix_ms,
                            plan_summary_json(&current_plan_summary),
                        );
                        state.run = run_manifest_from_steps(
                            &run_id,
                            &session_id,
                            "awaiting_command",
                            &artifact_dir,
                            &aggregated_steps,
                        );
                        set_live_state_status(
                            &mut state.live_state,
                            "awaiting_command",
                            Some(false),
                        );
                    });
                    interactive_runtime_host.enter_awaiting_command(
                        continuation_magnetization.clone(),
                        &live_workspace,
                    );
                    eprintln!("interactive command failed: {}", error);
                    live_workspace.push_log(
                        "error",
                        format!("Interactive command {} failed: {}", command.kind, error),
                    );
                    continue;
                }
            };

            // Handle mid-stage cancellation
            if stage_result.status == fullmag_runner::RunStatus::Cancelled {
                let offset_steps = offset_step_stats(&stage_result.steps, step_offset, time_offset);
                if let Some(last) = offset_steps.last() {
                    step_offset = last.step;
                    time_offset = last.time;
                }
                aggregated_steps.extend(offset_steps);
                continuation_magnetization = Some(stage_result.final_magnetization);
                interactive_stage_index += 1;

                let cancelled_at_unix_ms = unix_time_millis()?;
                live_workspace.update(|state| {
                    state.session = build_session_manifest(
                        &session_id,
                        &run_id,
                        "awaiting_command",
                        interactive_requested,
                        &script_path,
                        &final_problem_name,
                        backend_target_name(final_requested_backend),
                        execution_mode_name(final_execution_mode),
                        execution_precision_name(final_precision),
                        &artifact_dir,
                        started_at_unix_ms,
                        cancelled_at_unix_ms,
                        plan_summary_json(&current_plan_summary),
                    );
                    state.run = run_manifest_from_steps(
                        &run_id,
                        &session_id,
                        "awaiting_command",
                        &artifact_dir,
                        &aggregated_steps,
                    );
                    set_live_state_status(&mut state.live_state, "awaiting_command", Some(false));
                });
                interactive_runtime_host
                    .enter_awaiting_command(continuation_magnetization.clone(), &live_workspace);
                eprintln!("interactive command {} cancelled by user", command.kind);
                live_workspace.push_log(
                    "warning",
                    format!(
                        "Interactive command {} cancelled — partial results preserved",
                        command.kind,
                    ),
                );
                continue;
            }

            if !use_live_callback {
                let grid = match &execution_plan.backend_plan {
                    BackendPlanIR::Fdm(fdm) => {
                        [fdm.grid.cells[0], fdm.grid.cells[1], fdm.grid.cells[2]]
                    }
                    BackendPlanIR::FdmMultilayer(fdm) => [
                        fdm.common_cells[0],
                        fdm.common_cells[1],
                        fdm.common_cells[2],
                    ],
                    BackendPlanIR::Fem(_) | BackendPlanIR::FemEigen(_) => [0, 0, 0],
                };
                let fem_mesh = match &execution_plan.backend_plan {
                    BackendPlanIR::Fem(fem) => Some(fullmag_runner::FemMeshPayload {
                        nodes: fem.mesh.nodes.clone(),
                        elements: fem.mesh.elements.clone(),
                        boundary_faces: fem.mesh.boundary_faces.clone(),
                    }),
                    BackendPlanIR::FemEigen(fem) => Some(fullmag_runner::FemMeshPayload {
                        nodes: fem.mesh.nodes.clone(),
                        elements: fem.mesh.elements.clone(),
                        boundary_faces: fem.mesh.boundary_faces.clone(),
                    }),
                    BackendPlanIR::Fdm(_) | BackendPlanIR::FdmMultilayer(_) => None,
                };
                for stats in &stage_result.steps {
                    let update = fullmag_runner::StepUpdate {
                        stats: offset_step_stats(
                            std::slice::from_ref(stats),
                            step_offset,
                            time_offset,
                        )
                        .into_iter()
                        .next()
                        .expect("single step should offset"),
                        grid,
                        fem_mesh: fem_mesh.clone(),
                        magnetization: None,
                        preview_field: None,
                        scalar_row_due: true,
                        finished: false,
                    };
                    if update.stats.step <= 1
                        || update.stats.step % field_every_n == 0
                        || update.scalar_row_due
                    {
                        live_workspace.update(|state| {
                            state.session.status = "running".to_string();
                            state.run = running_run_manifest_from_update(
                                &run_id,
                                &session_id,
                                &artifact_dir,
                                &update,
                            );
                            state.live_state = live_state_manifest_from_update(&update);
                            set_latest_scalar_row_if_due(state, &update);
                        });
                    }
                }
            }

            if let Some(final_update) = final_stage_step_update(
                &execution_plan.backend_plan,
                &stage_result.steps,
                &stage_result.final_magnetization,
                step_offset,
                time_offset,
                false,
            ) {
                live_workspace.update(|state| {
                    state.session.status = if final_update.finished {
                        "completed".to_string()
                    } else {
                        "running".to_string()
                    };
                    state.run = running_run_manifest_from_update(
                        &run_id,
                        &session_id,
                        &artifact_dir,
                        &final_update,
                    );
                    state.live_state = live_state_manifest_from_update(&final_update);
                    set_latest_scalar_row_if_due(state, &final_update);
                });
            }

            let offset_steps = offset_step_stats(&stage_result.steps, step_offset, time_offset);
            if let Some(last) = offset_steps.last() {
                step_offset = last.step;
                time_offset = last.time;
            }
            aggregated_steps.extend(offset_steps);
            continuation_magnetization = Some(stage_result.final_magnetization);
            interactive_stage_index += 1;

            let ready_at_unix_ms = unix_time_millis()?;
            live_workspace.update(|state| {
                state.session = build_session_manifest(
                    &session_id,
                    &run_id,
                    "awaiting_command",
                    interactive_requested,
                    &script_path,
                    &final_problem_name,
                    backend_target_name(final_requested_backend),
                    execution_mode_name(final_execution_mode),
                    execution_precision_name(final_precision),
                    &artifact_dir,
                    started_at_unix_ms,
                    ready_at_unix_ms,
                    plan_summary_json(&current_plan_summary),
                );
                state.run = run_manifest_from_steps(
                    &run_id,
                    &session_id,
                    "awaiting_command",
                    &artifact_dir,
                    &aggregated_steps,
                );
                set_live_state_status(&mut state.live_state, "awaiting_command", Some(false));
            });
            interactive_runtime_host
                .enter_awaiting_command(continuation_magnetization.clone(), &live_workspace);
            live_workspace.push_log(
                "success",
                format!("Interactive command {} completed", command.kind),
            );
        }
        interactive_runtime_host.mark_closed();
        live_workspace.update(|state| {
            set_live_state_status(&mut state.live_state, "completed", Some(true));
        });
    }

    let finished_at_unix_ms = unix_time_millis()?;
    let final_status = fullmag_runner::RunStatus::Completed;

    let summary = ScriptRunSummary {
        session_id: session_id.clone(),
        run_id: run_id.clone(),
        script_path: script_path.display().to_string(),
        problem_name: final_problem_name.clone(),
        status: format!("{:?}", final_status).to_lowercase(),
        backend: backend_target_name(final_requested_backend).to_string(),
        mode: execution_mode_name(final_execution_mode).to_string(),
        precision: execution_precision_name(final_precision).to_string(),
        total_steps: aggregated_steps
            .last()
            .map(|step| step.step as usize)
            .unwrap_or(0),
        final_time: aggregated_steps.last().map(|step| step.time),
        final_e_ex: aggregated_steps.last().map(|step| step.e_ex),
        final_e_demag: aggregated_steps.last().map(|step| step.e_demag),
        final_e_ext: aggregated_steps.last().map(|step| step.e_ext),
        final_e_total: aggregated_steps.last().map(|step| step.e_total),
        artifact_dir: artifact_dir.display().to_string(),
        workspace_dir: workspace_dir.display().to_string(),
    };

    live_workspace.update(|state| {
        state.session = build_session_manifest(
            &session_id,
            &run_id,
            &summary.status,
            interactive_requested,
            &script_path,
            &summary.problem_name,
            &summary.backend,
            &summary.mode,
            &summary.precision,
            &artifact_dir,
            started_at_unix_ms,
            finished_at_unix_ms,
            plan_summary_json(&current_plan_summary),
        );
        state.run = run_manifest_from_steps(
            &run_id,
            &session_id,
            &summary.status,
            &artifact_dir,
            &aggregated_steps,
        );
        state.latest_scalar_row = aggregated_steps.last().map(|step| CurrentLiveScalarRow {
            step: step.step,
            time: step.time,
            solver_dt: step.dt,
            mx: step.mx,
            my: step.my,
            mz: step.mz,
            e_ex: step.e_ex,
            e_demag: step.e_demag,
            e_ext: step.e_ext,
            e_total: step.e_total,
            max_dm_dt: step.max_dm_dt,
            max_h_eff: step.max_h_eff,
            max_h_demag: step.max_h_demag,
        });
        set_live_state_status(&mut state.live_state, &summary.status, Some(true));
    });
    live_workspace.push_log(
        "success",
        format!(
            "Workspace completed — {} steps, final time {}",
            summary.total_steps,
            summary
                .final_time
                .map(|time| format!("{:.4e} s", time))
                .unwrap_or_else(|| "0 s".to_string())
        ),
    );

    if args.json {
        println!("{}", serde_json::to_string_pretty(&summary)?);
    } else {
        print_script_summary(&summary);
    }

    Ok(())
}
