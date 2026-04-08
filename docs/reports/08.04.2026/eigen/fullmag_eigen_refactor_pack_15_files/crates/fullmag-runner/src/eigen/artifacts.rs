use crate::eigen::types::{PathSolveResult, SingleKModeResult, SingleKSolveResult};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
struct ModeSummaryArtifact {
    raw_mode_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch_id: Option<usize>,
    frequency_real_hz: f64,
    frequency_imag_hz: f64,
    angular_frequency_rad_per_s: f64,
    eigenvalue_real: f64,
    eigenvalue_imag: f64,
    norm: f64,
    max_amplitude: f64,
    dominant_polarization: String,
    k_vector: [f64; 3],
}

#[derive(Debug, Clone, Serialize)]
struct SampleArtifact {
    sample_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    k_vector: [f64; 3],
    path_s: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    segment_index: Option<usize>,
    t_in_segment: f64,
    modes: Vec<ModeSummaryArtifact>,
}

#[derive(Debug, Clone, Serialize)]
struct PathArtifact<'a> {
    schema_version: &'static str,
    solver_model: &'a str,
    sample_count: usize,
    samples: Vec<SampleArtifact>,
}

#[derive(Debug, Clone, Serialize)]
struct BranchPointArtifact {
    sample_index: usize,
    raw_mode_index: usize,
    frequency_real_hz: f64,
    frequency_imag_hz: f64,
    tracking_confidence: f64,
    overlap_prev: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
struct BranchArtifact {
    branch_id: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    points: Vec<BranchPointArtifact>,
}

#[derive(Debug, Clone, Serialize)]
struct BranchesArtifact {
    schema_version: &'static str,
    solver_model: String,
    branches: Vec<BranchArtifact>,
}

#[derive(Debug, Clone, Serialize)]
struct ModeArtifact<'a> {
    schema_version: &'static str,
    solver_model: &'a str,
    sample_index: usize,
    raw_mode_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch_id: Option<usize>,
    frequency_real_hz: f64,
    frequency_imag_hz: f64,
    angular_frequency_rad_per_s: f64,
    eigenvalue_real: f64,
    eigenvalue_imag: f64,
    normalization: &'static str,
    damping_policy: &'static str,
    dominant_polarization: &'a str,
    k_vector: [f64; 3],
    real: &'a [[f64; 3]],
    imag: &'a [[f64; 3]],
    amplitude: &'a [f64],
    phase: &'a [f64],
}

fn summarize_mode(sample: &SingleKSolveResult, mode: &SingleKModeResult) -> ModeSummaryArtifact {
    ModeSummaryArtifact {
        raw_mode_index: mode.raw_mode_index,
        branch_id: mode.branch_id,
        frequency_real_hz: mode.frequency_real_hz,
        frequency_imag_hz: mode.frequency_imag_hz,
        angular_frequency_rad_per_s: mode.angular_frequency_rad_per_s,
        eigenvalue_real: mode.eigenvalue_real,
        eigenvalue_imag: mode.eigenvalue_imag,
        norm: mode.norm,
        max_amplitude: mode.max_amplitude,
        dominant_polarization: mode.dominant_polarization.clone(),
        k_vector: sample.sample.k_vector,
    }
}

pub fn write_path_bundle(base_dir: &Path, result: &PathSolveResult) -> std::io::Result<()> {
    let eigen_dir = base_dir.join("eigen");
    fs::create_dir_all(&eigen_dir)?;
    let samples: Vec<SampleArtifact> = result
        .samples
        .iter()
        .map(|sample| SampleArtifact {
            sample_index: sample.sample.sample_index,
            label: sample.sample.label.clone(),
            k_vector: sample.sample.k_vector,
            path_s: sample.sample.path_s,
            segment_index: sample.sample.segment_index,
            t_in_segment: sample.sample.t_in_segment,
            modes: sample
                .modes
                .iter()
                .map(|mode| summarize_mode(sample, mode))
                .collect(),
        })
        .collect();
    let path_artifact = PathArtifact {
        schema_version: "2",
        solver_model: result.solver_model.as_str(),
        sample_count: samples.len(),
        samples: samples.clone(),
    };
    fs::write(
        eigen_dir.join("path.json"),
        serde_json::to_vec_pretty(&path_artifact).unwrap(),
    )?;
    fs::write(
        eigen_dir.join("samples.json"),
        serde_json::to_vec_pretty(&samples).unwrap(),
    )?;
    Ok(())
}

pub fn write_branch_bundle(base_dir: &Path, result: &PathSolveResult) -> std::io::Result<()> {
    let eigen_dir = base_dir.join("eigen");
    fs::create_dir_all(&eigen_dir)?;
    let branches = result
        .branches
        .iter()
        .map(|branch| BranchArtifact {
            branch_id: branch.branch_id,
            label: branch.label.clone(),
            points: branch
                .points
                .iter()
                .map(|point| BranchPointArtifact {
                    sample_index: point.sample_index,
                    raw_mode_index: point.raw_mode_index,
                    frequency_real_hz: point.frequency_real_hz,
                    frequency_imag_hz: point.frequency_imag_hz,
                    tracking_confidence: point.tracking_confidence,
                    overlap_prev: point.overlap_prev,
                })
                .collect(),
        })
        .collect();
    let payload = BranchesArtifact {
        schema_version: "2",
        solver_model: result.solver_model.as_str().to_string(),
        branches,
    };
    fs::write(
        eigen_dir.join("branches.json"),
        serde_json::to_vec_pretty(&payload).unwrap(),
    )?;

    let mut csv = Vec::<u8>::new();
    writeln!(
        &mut csv,
        "sample_index,branch_id,raw_mode_index,frequency_real_hz,frequency_imag_hz,tracking_confidence,overlap_prev"
    )?;
    for branch in &result.branches {
        for point in &branch.points {
            writeln!(
                &mut csv,
                "{},{},{},{:.16e},{:.16e},{:.6},{}",
                point.sample_index,
                branch.branch_id,
                point.raw_mode_index,
                point.frequency_real_hz,
                point.frequency_imag_hz,
                point.tracking_confidence,
                point
                    .overlap_prev
                    .map(|value| format!("{value:.6}"))
                    .unwrap_or_default(),
            )?;
        }
    }
    fs::write(eigen_dir.join("branch_table.csv"), csv)?;
    Ok(())
}

pub fn write_mode_bundle(base_dir: &Path, result: &PathSolveResult) -> std::io::Result<()> {
    let eigen_dir = base_dir.join("eigen").join("modes");
    for sample in &result.samples {
        let sample_dir = eigen_dir.join(format!("sample_{:04}", sample.sample.sample_index));
        fs::create_dir_all(&sample_dir)?;
        for mode in &sample.modes {
            let real = mode.lifted_real.as_deref().unwrap_or(&[]);
            let imag = mode.lifted_imag.as_deref().unwrap_or(&[]);
            let amplitude = mode.amplitude.as_deref().unwrap_or(&[]);
            let phase = mode.phase.as_deref().unwrap_or(&[]);
            let payload = ModeArtifact {
                schema_version: "2",
                solver_model: result.solver_model.as_str(),
                sample_index: sample.sample.sample_index,
                raw_mode_index: mode.raw_mode_index,
                branch_id: mode.branch_id,
                frequency_real_hz: mode.frequency_real_hz,
                frequency_imag_hz: mode.frequency_imag_hz,
                angular_frequency_rad_per_s: mode.angular_frequency_rad_per_s,
                eigenvalue_real: mode.eigenvalue_real,
                eigenvalue_imag: mode.eigenvalue_imag,
                normalization: "unit_l2",
                damping_policy: "ignore",
                dominant_polarization: &mode.dominant_polarization,
                k_vector: sample.sample.k_vector,
                real,
                imag,
                amplitude,
                phase,
            };
            fs::write(
                sample_dir.join(format!("mode_{:04}.json", mode.raw_mode_index)),
                serde_json::to_vec_pretty(&payload).unwrap(),
            )?;
        }
    }
    Ok(())
}
