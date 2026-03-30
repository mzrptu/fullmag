use anyhow::{anyhow, bail, Context, Result};
use clap::Parser;
use fullmag_engine::run_reference_exchange_demo;
use fullmag_ir::{BackendTarget, ProblemIR};
use serde_json::Value;
use std::ffi::OsString;

mod args;
mod control_room;
mod diagnostics;
mod formatting;
mod interactive_runtime_host;
mod live_workspace;
mod orchestrator;
mod python_bridge;
mod step_utils;
mod types;

use args::*;
use formatting::*;
use python_bridge::*;
use step_utils::*;
use types::*;

fn main() -> Result<()> {
    let raw_args = std::env::args_os().collect::<Vec<_>>();
    if is_script_mode(&raw_args) {
        return orchestrator::run_script_mode(raw_args);
    }

    let cli = Cli::parse();

    match cli.command {
        Command::Doctor => {
            println!("fullmag status");
            println!("- public authoring surface: embedded Python API");
            println!("- public local launcher: Rust-hosted `fullmag script.py`");
            println!("- Python bridge: spawned helper exporting canonical ProblemIR");
            println!("- canonical ProblemIR: typed + validated");
            println!("- session artifacts: bootstrap file-based shell");
            println!("- reference LLG + exchange engine: CPU/FDM slice");
            println!("- CUDA FDM backend: native source present, calibration still in progress");
        }
        Command::ExampleIr => {
            let example = ProblemIR::bootstrap_example();
            println!("{}", serde_json::to_string_pretty(&example)?);
        }
        Command::ReferenceExchangeDemo { steps, dt } => {
            let report = run_reference_exchange_demo(steps, dt)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "steps": report.steps,
                    "dt": report.dt,
                    "initial_exchange_energy_joules": report.initial_exchange_energy_joules,
                    "final_exchange_energy_joules": report.final_exchange_energy_joules,
                    "final_time_seconds": report.final_time_seconds,
                    "final_center_magnetization": report.final_center_magnetization,
                    "max_effective_field_amplitude": report.max_effective_field_amplitude,
                    "max_rhs_amplitude": report.max_rhs_amplitude,
                }))?
            );
        }
        Command::ValidateJson { path } => {
            let ir = read_ir(&path)?;
            validate_ir(&ir)?;
            println!("IR validation passed for {}", path.display());
        }
        Command::PlanJson { path, backend } => {
            let ir = read_ir(&path)?;
            validate_ir(&ir)?;
            let plan = ir
                .plan_for(backend.map(BackendTarget::from))
                .map_err(join_errors)?;
            println!("{}", serde_json::to_string_pretty(&plan)?);
        }
        Command::RunJson {
            path,
            until,
            output_dir,
        } => {
            let ir = read_ir(&path)?;
            let execution_plan =
                fullmag_plan::plan(&ir).map_err(|error| anyhow!(error.to_string()))?;
            emit_initial_state_warnings(None, &execution_plan.backend_plan)?;
            let result = fullmag_runner::run_problem(&ir, until, &output_dir)
                .map_err(|e| anyhow!("{}", e))?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "status": result.status,
                    "total_steps": result.steps.len(),
                    "final_energy": result.steps.last().map(|s| s.e_ex),
                    "final_total_energy": result.steps.last().map(|s| s.e_total),
                    "output_dir": output_dir.display().to_string(),
                }))?
            );
        }
        Command::ResolveRuntimeInvocation { shell, raw_args } => {
            let resolution = resolve_runtime_invocation(raw_args)?;
            if shell {
                println!("script_mode={}", if resolution.script_mode { 1 } else { 0 });
                println!("requested_backend={}", resolution.requested_backend);
                println!("resolved_backend={}", resolution.resolved_backend);
                println!("requested_device={}", resolution.requested_device);
                println!("requested_precision={}", resolution.requested_precision);
                println!(
                    "preferred_runtime_family={}",
                    resolution.preferred_runtime_family
                );
                println!(
                    "local_engine_id={}",
                    resolution.local_engine_id.as_deref().unwrap_or("")
                );
                println!(
                    "local_engine_label={}",
                    resolution.local_engine_label.as_deref().unwrap_or("")
                );
                println!(
                    "requires_managed_runtime={}",
                    if resolution.requires_managed_runtime {
                        1
                    } else {
                        0
                    }
                );
                println!("entrypoint_kind={}", resolution.entrypoint_kind);
            } else {
                println!("{}", serde_json::to_string(&resolution)?);
            }
        }
    }

    Ok(())
}

fn is_script_mode(raw_args: &[OsString]) -> bool {
    const SUBCOMMANDS: &[&str] = &[
        "doctor",
        "example-ir",
        "reference-exchange-demo",
        "validate-json",
        "plan-json",
        "run-json",
        "resolve-runtime-invocation",
    ];
    const FLAG_ONLY: &[&str] = &["-i", "--interactive", "--headless", "--dev", "--json"];
    const VALUE_FLAGS: &[&str] = &[
        "--backend",
        "--mode",
        "--precision",
        "--output-dir",
        "--workspace-root",
        "--web-port",
    ];

    let mut index = 1usize;
    while index < raw_args.len() {
        let Some(arg) = raw_args[index].to_str() else {
            return false;
        };

        if SUBCOMMANDS.contains(&arg) {
            return false;
        }
        if FLAG_ONLY.contains(&arg) {
            index += 1;
            continue;
        }
        if VALUE_FLAGS.contains(&arg) {
            index += 2;
            continue;
        }
        if VALUE_FLAGS
            .iter()
            .any(|flag| arg.starts_with(&format!("{flag}=")))
        {
            index += 1;
            continue;
        }
        if arg == "--" {
            return raw_args.get(index + 1).is_some();
        }
        if arg.starts_with('-') {
            return false;
        }
        return true;
    }

    false
}

fn resolve_runtime_invocation(raw_args: Vec<OsString>) -> Result<RuntimeResolutionSummary> {
    let mut invocation_args = vec![OsString::from("fullmag")];
    invocation_args.extend(raw_args.iter().cloned());
    if !is_script_mode(&invocation_args) {
        return Ok(RuntimeResolutionSummary {
            script_mode: false,
            requested_backend: String::new(),
            resolved_backend: String::new(),
            requested_device: String::new(),
            requested_precision: String::new(),
            preferred_runtime_family: String::new(),
            local_engine_id: None,
            local_engine_label: None,
            requires_managed_runtime: false,
            entrypoint_kind: String::new(),
        });
    }

    let args =
        ScriptCli::try_parse_from(invocation_args).map_err(|error| anyhow!(error.to_string()))?;
    let script_path = args
        .script
        .canonicalize()
        .with_context(|| format!("failed to resolve script path {}", args.script.display()))?;
    let config =
        export_script_execution_config_via_python_with_options(&script_path, &args, true, None)?;
    let problem = config
        .stages
        .last()
        .map(|stage| &stage.ir)
        .unwrap_or(&config.ir);
    let resolved_backend = resolved_backend_from_problem(problem);
    let requested_device = runtime_selection_string(problem, "device", "auto");
    let preferred_runtime_family =
        preferred_runtime_family_for_problem(problem, resolved_backend, &requested_device);
    let (local_engine_id, local_engine_label, requires_managed_runtime) =
        local_engine_resolution(problem, resolved_backend, &preferred_runtime_family);

    Ok(RuntimeResolutionSummary {
        script_mode: true,
        requested_backend: backend_target_name(problem.backend_policy.requested_backend)
            .to_string(),
        resolved_backend: backend_target_name(resolved_backend).to_string(),
        requested_device,
        requested_precision: execution_precision_name(problem.backend_policy.execution_precision)
            .to_string(),
        preferred_runtime_family,
        local_engine_id,
        local_engine_label,
        requires_managed_runtime,
        entrypoint_kind: problem.problem_meta.entrypoint_kind.clone(),
    })
}

fn resolved_backend_from_problem(problem: &ProblemIR) -> BackendTarget {
    match problem.backend_policy.requested_backend {
        BackendTarget::Auto => {
            let hints = problem.backend_policy.discretization_hints.as_ref();
            let has_fdm = hints.and_then(|value| value.fdm.as_ref()).is_some()
                || problem
                    .geometry_assets
                    .as_ref()
                    .is_some_and(|assets| !assets.fdm_grid_assets.is_empty());
            let has_fem = hints.and_then(|value| value.fem.as_ref()).is_some()
                || problem
                    .geometry_assets
                    .as_ref()
                    .is_some_and(|assets| !assets.fem_mesh_assets.is_empty());
            match (has_fdm, has_fem) {
                (false, true) => BackendTarget::Fem,
                _ => BackendTarget::Fdm,
            }
        }
        other => other,
    }
}

fn runtime_selection_string(problem: &ProblemIR, key: &str, default: &str) -> String {
    problem
        .problem_meta
        .runtime_metadata
        .get("runtime_selection")
        .and_then(Value::as_object)
        .and_then(|selection| selection.get(key))
        .and_then(Value::as_str)
        .unwrap_or(default)
        .to_string()
}

fn preferred_runtime_family_for_problem(
    _problem: &ProblemIR,
    resolved_backend: BackendTarget,
    requested_device: &str,
) -> String {
    match (resolved_backend, requested_device) {
        (BackendTarget::Fem, "cuda" | "gpu") => "fem-gpu".to_string(),
        (BackendTarget::Fdm, "cuda" | "gpu") => "fdm-cuda".to_string(),
        (BackendTarget::Hybrid, "cuda" | "gpu") => "hybrid-gpu".to_string(),
        _ => "cpu-reference".to_string(),
    }
}

fn local_engine_resolution(
    problem: &ProblemIR,
    resolved_backend: BackendTarget,
    preferred_runtime_family: &str,
) -> (Option<String>, Option<String>, bool) {
    match preferred_runtime_family {
        "fem-gpu" => {
            let fe_order = problem
                .backend_policy
                .discretization_hints
                .as_ref()
                .and_then(|hints| hints.fem.as_ref())
                .map(|fem| fem.order)
                .unwrap_or(1);
            if fullmag_runner::is_native_fem_gpu_available() && fe_order == 1 {
                (
                    Some("fem_native_gpu".to_string()),
                    Some("Native FEM GPU".to_string()),
                    false,
                )
            } else {
                (
                    Some("fem_cpu_reference".to_string()),
                    Some("CPU FEM".to_string()),
                    true,
                )
            }
        }
        "fdm-cuda" => {
            if fullmag_runner::is_native_fdm_cuda_available() {
                (
                    Some("fdm_cuda".to_string()),
                    Some("CUDA FDM".to_string()),
                    false,
                )
            } else {
                (
                    Some("fdm_cpu_reference".to_string()),
                    Some("CPU FDM".to_string()),
                    false,
                )
            }
        }
        _ => match resolved_backend {
            BackendTarget::Fem => (
                Some("fem_cpu_reference".to_string()),
                Some("CPU FEM".to_string()),
                false,
            ),
            _ => (
                Some("fdm_cpu_reference".to_string()),
                Some("CPU FDM".to_string()),
                false,
            ),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::diagnose_initial_fdm_plan;
    use fullmag_ir::{
        BackendPlanIR, ExchangeBoundaryCondition, ExecutionPrecision, FdmMaterialIR, FemPlanIR,
        GridDimensions, IntegratorChoice, MaterialIR, MeshIR, RelaxationAlgorithmIR,
        RelaxationControlIR,
    };

    #[test]
    fn initial_step_update_bootstraps_fdm_grid_and_magnetization() {
        let plan = BackendPlanIR::Fdm(fullmag_ir::FdmPlanIR {
            grid: GridDimensions { cells: [4, 3, 1] },
            cell_size: [2e-9, 2e-9, 10e-9],
            region_mask: vec![0; 12],
            active_mask: None,
            initial_magnetization: vec![[1.0, 0.0, 0.0]; 12],
            material: FdmMaterialIR {
                name: "Py".to_string(),
                saturation_magnetisation: 800e3,
                exchange_stiffness: 13e-12,
                damping: 0.5,
            },
            enable_exchange: true,
            enable_demag: false,
            external_field: None,
            gyromagnetic_ratio: 2.211e5,
            precision: ExecutionPrecision::Double,
            exchange_bc: ExchangeBoundaryCondition::Neumann,
            integrator: IntegratorChoice::Heun,
            fixed_timestep: Some(1e-13),
            adaptive_timestep: None,
            relaxation: None,
            boundary_correction: None,
            boundary_geometry: None,
            inter_region_exchange: vec![],
        });

        let update = initial_step_update(&plan);
        assert_eq!(update.stats.step, 0);
        assert_eq!(update.grid, [4, 3, 1]);
        assert!(update.fem_mesh.is_none());
        assert_eq!(update.magnetization.as_ref().map(Vec::len), Some(36));
        assert!(!update.finished);
    }

    #[test]
    fn initial_step_update_bootstraps_fem_mesh_and_magnetization() {
        let mesh = MeshIR {
            mesh_name: "tiny".to_string(),
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            elements: vec![[0, 1, 2, 3]],
            element_markers: vec![1],
            boundary_faces: vec![[0, 1, 2]],
            boundary_markers: vec![1],
        };
        let plan = BackendPlanIR::Fem(FemPlanIR {
            mesh_name: mesh.mesh_name.clone(),
            mesh_source: None,
            mesh: mesh.clone(),
            fe_order: 1,
            hmax: 1.0,
            initial_magnetization: vec![[0.0, 1.0, 0.0]; 4],
            material: MaterialIR {
                name: "Py".to_string(),
                saturation_magnetisation: 800e3,
                exchange_stiffness: 13e-12,
                damping: 0.5,
                uniaxial_anisotropy: None,
                anisotropy_axis: None,
                uniaxial_anisotropy_k2: None,
                cubic_anisotropy_kc1: None,
                cubic_anisotropy_kc2: None,
                cubic_anisotropy_kc3: None,
                cubic_anisotropy_axis1: None,
                cubic_anisotropy_axis2: None,
                ms_field: None,
                a_field: None,
                alpha_field: None,
                ku_field: None,
                ku2_field: None,
                kc1_field: None,
                kc2_field: None,
                kc3_field: None,
            },
            enable_exchange: true,
            enable_demag: true,
            external_field: None,
            gyromagnetic_ratio: 2.211e5,
            precision: ExecutionPrecision::Double,
            exchange_bc: ExchangeBoundaryCondition::Neumann,
            integrator: IntegratorChoice::Heun,
            fixed_timestep: Some(1e-13),
            adaptive_timestep: None,
            relaxation: None,
            demag_realization: None,
            air_box_config: None,
            interfacial_dmi: None,
            bulk_dmi: None,
            dind_field: None,
            dbulk_field: None,
            temperature: None,
        });

        let update = initial_step_update(&plan);
        assert_eq!(update.stats.step, 0);
        assert_eq!(update.grid, [0, 0, 0]);
        assert_eq!(
            update.fem_mesh.as_ref().map(|payload| payload.nodes.len()),
            Some(mesh.nodes.len())
        );
        assert_eq!(update.magnetization.as_ref().map(Vec::len), Some(12));
        assert!(!update.finished);
    }

    #[test]
    fn diagnose_initial_fdm_plan_warns_for_uniform_exchange_only_state() {
        let plan = fullmag_ir::FdmPlanIR {
            grid: GridDimensions { cells: [4, 1, 1] },
            cell_size: [2e-9, 2e-9, 2e-9],
            region_mask: vec![0; 4],
            active_mask: None,
            initial_magnetization: vec![[1.0, 0.0, 0.0]; 4],
            material: FdmMaterialIR {
                name: "Py".to_string(),
                saturation_magnetisation: 800e3,
                exchange_stiffness: 13e-12,
                damping: 0.5,
            },
            enable_exchange: true,
            enable_demag: false,
            external_field: None,
            gyromagnetic_ratio: 2.211e5,
            precision: ExecutionPrecision::Double,
            exchange_bc: ExchangeBoundaryCondition::Neumann,
            integrator: IntegratorChoice::Heun,
            fixed_timestep: Some(1e-13),
            adaptive_timestep: None,
            relaxation: None,
            boundary_correction: None,
            boundary_geometry: None,
            inter_region_exchange: vec![],
        };

        let diagnostic = diagnose_initial_fdm_plan(&plan).expect("diagnostic should succeed");
        assert!(
            diagnostic
                .warnings
                .iter()
                .any(|warning| warning.contains("exchange-only configuration")),
            "expected exchange-only warning, got {:?}",
            diagnostic.warnings
        );
        assert!(
            diagnostic
                .warnings
                .iter()
                .any(|warning| warning.contains("Initial torque is numerically zero")),
            "expected zero-torque warning, got {:?}",
            diagnostic.warnings
        );
    }

    #[test]
    fn diagnose_initial_fdm_plan_warns_for_overdamped_relax_with_zero_alpha() {
        let plan = fullmag_ir::FdmPlanIR {
            grid: GridDimensions { cells: [1, 1, 1] },
            cell_size: [2e-9, 2e-9, 2e-9],
            region_mask: vec![0; 1],
            active_mask: None,
            initial_magnetization: vec![[1.0, 0.0, 0.0]],
            material: FdmMaterialIR {
                name: "Py".to_string(),
                saturation_magnetisation: 800e3,
                exchange_stiffness: 13e-12,
                damping: 0.0,
            },
            enable_exchange: false,
            enable_demag: false,
            external_field: Some([0.0, 0.0, 1.0e5]),
            gyromagnetic_ratio: 2.211e5,
            precision: ExecutionPrecision::Double,
            exchange_bc: ExchangeBoundaryCondition::Neumann,
            integrator: IntegratorChoice::Heun,
            fixed_timestep: Some(1e-13),
            adaptive_timestep: None,
            relaxation: Some(RelaxationControlIR {
                algorithm: RelaxationAlgorithmIR::LlgOverdamped,
                torque_tolerance: 1e-6,
                energy_tolerance: None,
                max_steps: 100,
            }),
            boundary_correction: None,
            boundary_geometry: None,
            inter_region_exchange: vec![],
        };

        let diagnostic = diagnose_initial_fdm_plan(&plan).expect("diagnostic should succeed");
        assert!(
            diagnostic
                .warnings
                .iter()
                .any(|warning| warning.contains("alpha=0")),
            "expected alpha=0 warning, got {:?}",
            diagnostic.warnings
        );
    }
}
