use fullmag_engine::fem::{FemLlgProblem, MeshTopology};
use fullmag_engine::{
    EffectiveFieldObservables, EffectiveFieldTerms, LlgConfig, MaterialParameters, TimeIntegrator,
    Vector3, MU0,
};
use fullmag_ir::{
    EigenDampingPolicyIR, EigenNormalizationIR, EquilibriumSourceIR, FemEigenPlanIR, KSamplingIR,
    OutputIR, RelaxationAlgorithmIR, RelaxationControlIR,
};
use nalgebra::{DMatrix, DVector, SymmetricEigen};

use crate::relaxation::relaxation_converged;
use crate::types::{AuxiliaryArtifact, ExecutedRun, RunError, RunResult, RunStatus, StepStats};
use crate::ExecutionProvenance;

const RELAX_DT: f64 = 1e-13;
const RELAX_MAX_STEPS: u64 = 4_000;

pub(crate) fn execute_reference_fem_eigen(
    plan: &FemEigenPlanIR,
    outputs: &[OutputIR],
) -> Result<ExecutedRun, RunError> {
    if plan.precision != fullmag_ir::ExecutionPrecision::Double {
        return Err(RunError {
            message: "execution_precision='single' is not executable in the FEM eigen CPU reference runner; use 'double'".to_string(),
        });
    }

    let initial_magnetization = plan.equilibrium_magnetization.clone();
    let (problem, equilibrium, relaxation_steps, observables) =
        materialize_equilibrium(plan, &initial_magnetization)?;
    let topology = &problem.topology;
    let (active_nodes, node_map) = active_node_mapping(topology);
    if active_nodes.is_empty() {
        return Err(RunError {
            message: "FEM eigen solver found no magnetically active nodes".to_string(),
        });
    }

    let (stiffness, mass) = assemble_projected_scalar_operator(
        topology,
        &node_map,
        &observables,
        plan.enable_exchange,
        plan.enable_demag,
        plan.external_field.is_some(),
    );

    let cholesky = mass.clone().cholesky().ok_or_else(|| RunError {
        message: "FEM eigen mass matrix is singular; ensure the magnetic mesh has active volume"
            .to_string(),
    })?;
    let l = cholesky.l();
    let l_inv = l.clone().try_inverse().ok_or_else(|| RunError {
        message: "failed to invert FEM eigen mass Cholesky factor".to_string(),
    })?;
    let transformed = &l_inv * stiffness * l_inv.transpose();
    let spectrum = SymmetricEigen::new(transformed);

    let mut eigenpairs = spectrum
        .eigenvalues
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            if !value.is_finite() {
                return None;
            }
            let lifted = l_inv.transpose() * spectrum.eigenvectors.column(index).into_owned();
            Some((*value, lifted))
        })
        .collect::<Vec<_>>();

    match &plan.target {
        fullmag_ir::EigenTargetIR::Lowest => {
            eigenpairs.sort_by(|lhs, rhs| {
                lhs.0
                    .partial_cmp(&rhs.0)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }
        fullmag_ir::EigenTargetIR::Nearest { frequency_hz } => {
            eigenpairs.sort_by(|lhs, rhs| {
                let lhs_freq = frequency_from_eigenvalue(plan.gyromagnetic_ratio, lhs.0);
                let rhs_freq = frequency_from_eigenvalue(plan.gyromagnetic_ratio, rhs.0);
                (lhs_freq - *frequency_hz)
                    .abs()
                    .partial_cmp(&(rhs_freq - *frequency_hz).abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }
    }
    let requested_count = usize::try_from(plan.count).unwrap_or(usize::MAX);
    eigenpairs.truncate(requested_count.min(eigenpairs.len()));

    let bases = tangent_bases(&equilibrium);
    let requested_modes = requested_mode_indices(outputs);
    let wants_spectrum = outputs
        .iter()
        .any(|output| matches!(output, OutputIR::EigenSpectrum { .. }));
    let wants_dispersion = outputs
        .iter()
        .any(|output| matches!(output, OutputIR::DispersionCurve { .. }));

    let mut auxiliary_artifacts = Vec::new();
    let mut modes_summary = Vec::with_capacity(eigenpairs.len());
    for (mode_index, (eigenvalue, vector)) in eigenpairs.iter().enumerate() {
        let normalized = normalize_mode(vector.clone(), &mass, &plan.normalization);
        let (real, imag, amplitude, phase, max_amplitude) =
            project_mode_to_tangent_basis(topology.n_nodes, &active_nodes, &normalized, &bases);
        let frequency_hz = frequency_from_eigenvalue(plan.gyromagnetic_ratio, *eigenvalue);
        let angular_frequency =
            angular_frequency_from_eigenvalue(plan.gyromagnetic_ratio, *eigenvalue);
        let norm = modal_norm(&normalized, &mass).sqrt();
        let dominant_polarization =
            classify_polarization(&amplitude, &active_nodes, &equilibrium, max_amplitude);
        let mode_summary = serde_json::json!({
            "index": mode_index,
            "frequency_hz": frequency_hz,
            "angular_frequency_rad_per_s": angular_frequency,
            "eigenvalue_field_au_per_m": (*eigenvalue).max(0.0),
            "norm": norm,
            "max_amplitude": max_amplitude,
            "dominant_polarization": dominant_polarization,
            "k_vector": k_vector_json(plan.k_sampling.as_ref()),
        });
        modes_summary.push(mode_summary.clone());

        if requested_modes.contains(&(mode_index as u32)) {
            let payload = serde_json::json!({
                "index": mode_index,
                "frequency_hz": frequency_hz,
                "angular_frequency_rad_per_s": angular_frequency,
                "max_amplitude": max_amplitude,
                "normalization": normalization_label(plan.normalization),
                "damping_policy": damping_policy_label(plan.damping_policy),
                "dominant_polarization": dominant_polarization,
                "k_vector": k_vector_json(plan.k_sampling.as_ref()),
                "real": real,
                "imag": imag,
                "amplitude": amplitude,
                "phase": phase,
            });
            auxiliary_artifacts.push(json_artifact(
                format!("eigen/modes/mode_{mode_index:04}.json"),
                &payload,
            )?);
        }
    }

    let summary_payload = serde_json::json!({
        "study_kind": "eigenmodes",
        "mesh_name": plan.mesh_name,
        "mode_count": modes_summary.len(),
        "normalization": normalization_label(plan.normalization),
        "damping_policy": damping_policy_label(plan.damping_policy),
        "equilibrium_source": equilibrium_source_json(&plan.equilibrium),
        "operator": {
            "kind": format!("{:?}", plan.operator.kind).to_lowercase(),
            "include_demag": plan.operator.include_demag,
        },
        "k_sampling": k_vector_json(plan.k_sampling.as_ref()),
        "relaxation_steps": relaxation_steps,
        "modes": modes_summary,
    });

    if wants_spectrum {
        auxiliary_artifacts.push(json_artifact("eigen/spectrum.json", &summary_payload)?);
    }
    auxiliary_artifacts.push(json_artifact(
        "eigen/metadata/eigen_summary.json",
        &summary_payload,
    )?);
    auxiliary_artifacts.push(json_artifact(
        "eigen/metadata/normalization.json",
        &serde_json::json!({
            "normalization": normalization_label(plan.normalization),
            "mode_count": summary_payload["mode_count"],
        }),
    )?);
    auxiliary_artifacts.push(json_artifact(
        "eigen/metadata/equilibrium_source.json",
        &equilibrium_source_json(&plan.equilibrium),
    )?);

    if wants_dispersion {
        let k_vector = k_vector_json(plan.k_sampling.as_ref());
        auxiliary_artifacts.push(json_artifact(
            "eigen/dispersion/path.json",
            &serde_json::json!({
                "sampling": plan.k_sampling,
                "k_vector": k_vector,
            }),
        )?);
        auxiliary_artifacts.push(AuxiliaryArtifact {
            relative_path: "eigen/dispersion/branch_table.csv".to_string(),
            bytes: dispersion_csv(plan.k_sampling.as_ref(), &summary_payload["modes"]).into_bytes(),
        });
    }

    let stats = StepStats {
        step: relaxation_steps,
        time: 0.0,
        dt: 0.0,
        e_ex: observables.exchange_energy_joules,
        e_demag: observables.demag_energy_joules,
        e_ext: observables.external_energy_joules,
        e_total: observables.total_energy_joules,
        max_dm_dt: observables.max_rhs_amplitude,
        max_h_eff: observables.max_effective_field_amplitude,
        max_h_demag: observables.max_demag_field_amplitude,
        ..StepStats::default()
    };

    Ok(ExecutedRun {
        result: RunResult {
            status: RunStatus::Completed,
            steps: vec![stats],
            final_magnetization: equilibrium.clone(),
        },
        initial_magnetization,
        field_snapshots: Vec::new(),
        field_snapshot_count: 0,
        auxiliary_artifacts,
        provenance: execution_provenance(plan),
    })
}

fn execution_provenance(plan: &FemEigenPlanIR) -> ExecutionProvenance {
    ExecutionProvenance {
        execution_engine: "cpu_reference_fem_eigen".to_string(),
        precision: "double".to_string(),
        demag_operator_kind: if plan.enable_demag {
            Some(
                plan.demag_realization
                    .clone()
                    .unwrap_or_else(|| "fem_transfer_grid_tensor_fft_newell".to_string()),
            )
        } else {
            None
        },
        fft_backend: None,
        device_name: None,
        compute_capability: None,
        cuda_driver_version: None,
        cuda_runtime_version: None,
    }
}

fn materialize_equilibrium(
    plan: &FemEigenPlanIR,
    initial_magnetization: &[Vector3],
) -> Result<(FemLlgProblem, Vec<Vector3>, u64, EffectiveFieldObservables), RunError> {
    let mut equilibrium_guess = initial_magnetization.to_vec();
    if let EquilibriumSourceIR::Artifact { path } = &plan.equilibrium {
        equilibrium_guess = load_equilibrium_artifact(path, plan.mesh.nodes.len())?;
    }

    let topology = MeshTopology::from_ir(&plan.mesh).map_err(|error| RunError {
        message: format!("MeshTopology: {}", error),
    })?;
    let material = MaterialParameters::new(
        plan.material.saturation_magnetisation,
        plan.material.exchange_stiffness,
        plan.material.damping,
    )
    .map_err(|error| RunError {
        message: format!("Material: {}", error),
    })?;
    let dynamics = LlgConfig::new(plan.gyromagnetic_ratio, TimeIntegrator::RK23)
        .map_err(|error| RunError {
            message: format!("LLG: {}", error),
        })?
        .with_precession_enabled(false);
    let problem = FemLlgProblem::with_terms_and_demag_transfer_grid(
        topology,
        material,
        dynamics,
        EffectiveFieldTerms {
            exchange: plan.enable_exchange,
            demag: plan.enable_demag,
            external_field: plan.external_field,
            per_node_field: None,
            magnetoelastic: None,
        },
        Some([plan.hmax, plan.hmax, plan.hmax]),
    );
    let mut state = problem
        .new_state(equilibrium_guess)
        .map_err(|error| RunError {
            message: format!("State: {}", error),
        })?;

    let mut steps_taken = 0;
    if matches!(plan.equilibrium, EquilibriumSourceIR::RelaxedInitialState) {
        let control = RelaxationControlIR {
            algorithm: RelaxationAlgorithmIR::LlgOverdamped,
            torque_tolerance: 1e-5,
            energy_tolerance: Some(1e-12),
            max_steps: RELAX_MAX_STEPS,
        };
        let mut previous_total_energy = None;
        while steps_taken < RELAX_MAX_STEPS {
            let report = problem
                .step(&mut state, RELAX_DT)
                .map_err(|error| RunError {
                    message: format!("FEM eigen relaxation step {}: {}", steps_taken, error),
                })?;
            steps_taken += 1;
            let stats = StepStats {
                step: steps_taken,
                time: report.time_seconds,
                dt: report.dt_used,
                e_ex: report.exchange_energy_joules,
                e_demag: report.demag_energy_joules,
                e_ext: report.external_energy_joules,
                e_total: report.total_energy_joules,
                max_dm_dt: report.max_rhs_amplitude,
                max_h_eff: report.max_effective_field_amplitude,
                max_h_demag: report.max_demag_field_amplitude,
                ..StepStats::default()
            };
            if relaxation_converged(
                &control,
                &stats,
                previous_total_energy,
                plan.gyromagnetic_ratio,
                plan.material.damping,
                true,
            ) {
                break;
            }
            previous_total_energy = Some(report.total_energy_joules);
        }
    }

    let observables = problem.observe(&state).map_err(|error| RunError {
        message: format!("FEM eigen observables: {}", error),
    })?;
    Ok((
        problem,
        state.magnetization().to_vec(),
        steps_taken,
        observables,
    ))
}

fn load_equilibrium_artifact(path: &str, expected_len: usize) -> Result<Vec<Vector3>, RunError> {
    let raw = std::fs::read_to_string(path).map_err(|error| RunError {
        message: format!("failed to read equilibrium artifact '{}': {}", path, error),
    })?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|error| RunError {
        message: format!("failed to parse equilibrium artifact '{}': {}", path, error),
    })?;
    let values = value
        .get("values")
        .cloned()
        .unwrap_or(value)
        .as_array()
        .cloned()
        .ok_or_else(|| RunError {
            message: format!(
                "equilibrium artifact '{}' must be a JSON array or a field artifact with 'values'",
                path
            ),
        })?;
    if values.len() != expected_len {
        return Err(RunError {
            message: format!(
                "equilibrium artifact '{}' contains {} vectors, expected {}",
                path,
                values.len(),
                expected_len
            ),
        });
    }
    values
        .into_iter()
        .map(|entry| {
            let array = entry.as_array().ok_or_else(|| RunError {
                message: format!(
                    "equilibrium artifact '{}' contains a non-vector entry",
                    path
                ),
            })?;
            if array.len() != 3 {
                return Err(RunError {
                    message: format!("equilibrium artifact '{}' contains a non-3D vector", path),
                });
            }
            Ok([
                array[0].as_f64().unwrap_or(0.0),
                array[1].as_f64().unwrap_or(0.0),
                array[2].as_f64().unwrap_or(0.0),
            ])
        })
        .collect()
}

fn active_node_mapping(topology: &MeshTopology) -> (Vec<usize>, Vec<Option<usize>>) {
    let mut active_nodes = Vec::new();
    let mut mapping = vec![None; topology.n_nodes];
    for (node_index, volume) in topology.magnetic_node_volumes.iter().enumerate() {
        if *volume > 0.0 {
            mapping[node_index] = Some(active_nodes.len());
            active_nodes.push(node_index);
        }
    }
    (active_nodes, mapping)
}

fn assemble_projected_scalar_operator(
    topology: &MeshTopology,
    node_map: &[Option<usize>],
    observables: &EffectiveFieldObservables,
    include_exchange: bool,
    include_demag: bool,
    include_external: bool,
) -> (DMatrix<f64>, DMatrix<f64>) {
    let active_count = node_map.iter().filter(|entry| entry.is_some()).count();
    let mut stiffness = DMatrix::<f64>::zeros(active_count, active_count);
    let mut mass = DMatrix::<f64>::zeros(active_count, active_count);
    let parallel_field = observables
        .magnetization
        .iter()
        .enumerate()
        .map(|(index, m)| {
            let mut selected_field = [0.0, 0.0, 0.0];
            if include_exchange {
                selected_field = add_vector(selected_field, observables.exchange_field[index]);
            }
            if include_demag {
                selected_field = add_vector(selected_field, observables.demag_field[index]);
            }
            if include_external {
                selected_field = add_vector(selected_field, observables.external_field[index]);
            }
            dot(*m, selected_field).max(0.0)
        })
        .collect::<Vec<_>>();

    for (element_index, element) in topology.elements.iter().enumerate() {
        if !topology.magnetic_element_mask[element_index] {
            continue;
        }
        let volume = topology.element_volumes[element_index];
        let local_mass = [
            [
                2.0 * volume / 20.0,
                volume / 20.0,
                volume / 20.0,
                volume / 20.0,
            ],
            [
                volume / 20.0,
                2.0 * volume / 20.0,
                volume / 20.0,
                volume / 20.0,
            ],
            [
                volume / 20.0,
                volume / 20.0,
                2.0 * volume / 20.0,
                volume / 20.0,
            ],
            [
                volume / 20.0,
                volume / 20.0,
                volume / 20.0,
                2.0 * volume / 20.0,
            ],
        ];
        let local_shift = [
            parallel_field[element[0] as usize],
            parallel_field[element[1] as usize],
            parallel_field[element[2] as usize],
            parallel_field[element[3] as usize],
        ];
        for i in 0..4 {
            let Some(row) = node_map[element[i] as usize] else {
                continue;
            };
            for j in 0..4 {
                let Some(col) = node_map[element[j] as usize] else {
                    continue;
                };
                mass[(row, col)] += local_mass[i][j];
                if include_exchange {
                    stiffness[(row, col)] += topology.element_stiffness[element_index][i][j];
                }
                let shift = 0.5 * (local_shift[i] + local_shift[j]);
                stiffness[(row, col)] += local_mass[i][j] * shift;
            }
        }
    }

    (stiffness, mass)
}

fn normalize_mode(
    vector: DVector<f64>,
    mass: &DMatrix<f64>,
    normalization: &EigenNormalizationIR,
) -> DVector<f64> {
    match normalization {
        EigenNormalizationIR::UnitL2 => {
            let norm = modal_norm(&vector, mass).sqrt().max(1e-30);
            vector / norm
        }
        EigenNormalizationIR::UnitMaxAmplitude => {
            let max_value = vector
                .iter()
                .fold(0.0_f64, |acc, value| acc.max(value.abs()))
                .max(1e-30);
            vector / max_value
        }
    }
}

fn modal_norm(vector: &DVector<f64>, mass: &DMatrix<f64>) -> f64 {
    let projected = mass * vector;
    vector.dot(&projected)
}

fn tangent_bases(equilibrium: &[Vector3]) -> Vec<(Vector3, Vector3)> {
    equilibrium
        .iter()
        .map(|m| {
            let reference = if m[2].abs() < 0.9 {
                [0.0, 0.0, 1.0]
            } else {
                [0.0, 1.0, 0.0]
            };
            let e1 = normalize_vector(cross(reference, *m));
            let e2 = normalize_vector(cross(*m, e1));
            (e1, e2)
        })
        .collect()
}

fn project_mode_to_tangent_basis(
    total_nodes: usize,
    active_nodes: &[usize],
    amplitudes: &DVector<f64>,
    bases: &[(Vector3, Vector3)],
) -> (Vec<Vector3>, Vec<Vector3>, Vec<f64>, Vec<f64>, f64) {
    let mut real = vec![[0.0, 0.0, 0.0]; total_nodes];
    let mut imag = vec![[0.0, 0.0, 0.0]; total_nodes];
    let mut amplitude = vec![0.0; total_nodes];
    let mut phase = vec![0.0; total_nodes];
    let mut max_amplitude: f64 = 0.0;

    for (reduced_index, node_index) in active_nodes.iter().enumerate() {
        let a = amplitudes[reduced_index];
        let (e1, e2) = bases[*node_index];
        real[*node_index] = scale_vector(e1, a);
        imag[*node_index] = scale_vector(e2, a);
        amplitude[*node_index] = a.abs();
        phase[*node_index] = if a >= 0.0 { 0.0 } else { std::f64::consts::PI };
        max_amplitude = max_amplitude.max(a.abs());
    }

    (real, imag, amplitude, phase, max_amplitude)
}

fn frequency_from_eigenvalue(gyromagnetic_ratio: f64, eigenvalue: f64) -> f64 {
    angular_frequency_from_eigenvalue(gyromagnetic_ratio, eigenvalue) / (2.0 * std::f64::consts::PI)
}

fn angular_frequency_from_eigenvalue(gyromagnetic_ratio: f64, eigenvalue: f64) -> f64 {
    gyromagnetic_ratio * MU0 * eigenvalue.max(0.0)
}

fn requested_mode_indices(outputs: &[OutputIR]) -> std::collections::BTreeSet<u32> {
    outputs
        .iter()
        .filter_map(|output| {
            if let OutputIR::EigenMode { indices, .. } = output {
                Some(indices.iter().copied())
            } else {
                None
            }
        })
        .flatten()
        .collect()
}

fn json_artifact(
    path: impl Into<String>,
    value: &serde_json::Value,
) -> Result<AuxiliaryArtifact, RunError> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| RunError {
        message: format!("failed to serialize eigen artifact: {}", error),
    })?;
    Ok(AuxiliaryArtifact {
        relative_path: path.into(),
        bytes,
    })
}

fn normalization_label(normalization: EigenNormalizationIR) -> &'static str {
    match normalization {
        EigenNormalizationIR::UnitL2 => "unit_l2",
        EigenNormalizationIR::UnitMaxAmplitude => "unit_max_amplitude",
    }
}

fn damping_policy_label(policy: EigenDampingPolicyIR) -> &'static str {
    match policy {
        EigenDampingPolicyIR::Ignore => "ignore",
        EigenDampingPolicyIR::Include => "include",
    }
}

fn equilibrium_source_json(equilibrium: &EquilibriumSourceIR) -> serde_json::Value {
    match equilibrium {
        EquilibriumSourceIR::Provided => serde_json::json!({ "kind": "provided" }),
        EquilibriumSourceIR::RelaxedInitialState => {
            serde_json::json!({ "kind": "relaxed_initial_state" })
        }
        EquilibriumSourceIR::Artifact { path } => {
            serde_json::json!({ "kind": "artifact", "path": path })
        }
    }
}

fn k_vector_json(k_sampling: Option<&KSamplingIR>) -> serde_json::Value {
    match k_sampling {
        Some(KSamplingIR::Single { k_vector }) => serde_json::json!(k_vector),
        None => serde_json::Value::Null,
    }
}

fn dispersion_csv(k_sampling: Option<&KSamplingIR>, modes: &serde_json::Value) -> String {
    let k_vector = match k_sampling {
        Some(KSamplingIR::Single { k_vector }) => *k_vector,
        None => [0.0, 0.0, 0.0],
    };
    let mut csv = String::from("mode_index,kx,ky,kz,frequency_hz,angular_frequency_rad_per_s\n");
    if let Some(entries) = modes.as_array() {
        for entry in entries {
            csv.push_str(&format!(
                "{},{:.15e},{:.15e},{:.15e},{:.15e},{:.15e}\n",
                entry["index"].as_u64().unwrap_or(0),
                k_vector[0],
                k_vector[1],
                k_vector[2],
                entry["frequency_hz"].as_f64().unwrap_or(0.0),
                entry["angular_frequency_rad_per_s"].as_f64().unwrap_or(0.0),
            ));
        }
    }
    csv
}

fn dot(a: Vector3, b: Vector3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: Vector3, b: Vector3) -> Vector3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn norm(a: Vector3) -> f64 {
    dot(a, a).sqrt()
}

fn normalize_vector(a: Vector3) -> Vector3 {
    let magnitude = norm(a);
    if magnitude <= 1e-30 {
        [1.0, 0.0, 0.0]
    } else {
        scale_vector(a, 1.0 / magnitude)
    }
}

fn scale_vector(a: Vector3, factor: f64) -> Vector3 {
    [a[0] * factor, a[1] * factor, a[2] * factor]
}

fn add_vector(a: Vector3, b: Vector3) -> Vector3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

/// Classify the dominant polarization character of a spin-wave mode.
///
/// Heuristics (all for the real scalar LLG linearization):
/// - `"uniform"`: mode amplitude is spatially homogeneous (Kittel / macrospin mode).
///   Criterion: mean amplitude over active nodes ≥ 60 % of the maximum.
/// - `"op"`: equilibrium is predominantly out-of-plane (|⟨mz⟩| > 0.7 ⇒ mz-dominated modes).
/// - `"ip"`: default for in-plane equilibrium configurations.
/// - `"mixed"`: fallback when the active node set is empty or max amplitude is degenerate.
fn classify_polarization(
    amplitude: &[f64],
    active_nodes: &[usize],
    equilibrium: &[Vector3],
    max_amplitude: f64,
) -> &'static str {
    if active_nodes.is_empty() || max_amplitude < 1e-30 {
        return "mixed";
    }

    let n = active_nodes.len() as f64;

    // Spatial uniformity: mean / max over active nodes.
    let mean_amplitude: f64 = active_nodes.iter().map(|&i| amplitude[i]).sum::<f64>() / n;
    if mean_amplitude / max_amplitude > 0.6 {
        return "uniform";
    }

    // Determine equilibrium orientation: average |mz| over active nodes.
    let mean_mz_abs: f64 = if equilibrium.len() > *active_nodes.iter().max().unwrap_or(&0) {
        active_nodes
            .iter()
            .map(|&i| equilibrium[i][2].abs())
            .sum::<f64>()
            / n
    } else {
        0.0
    };

    if mean_mz_abs > 0.7 {
        "op"
    } else {
        "ip"
    }
}
