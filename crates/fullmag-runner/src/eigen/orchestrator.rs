//! Multi-k orchestrator for the current reference FEM eigen kernel.
//!
//! The intent is simple:
//! 1. expand `KSamplingIR` into concrete samples,
//! 2. call the existing single-k solver for each sample,
//! 3. run overlap-based branch tracking,
//! 4. write path / branch / mode artifacts.
//!
//! This file does *not* replace the physics kernel. It wraps it. The current
//! scalar-projected operator can keep living where it is until the full
//! tangent-plane LLG assembly is ready.

use crate::eigen::artifacts::{write_branch_bundle, write_mode_bundle, write_path_bundle};
use crate::eigen::path::expand_k_sampling;
use crate::eigen::tracking::track_branches;
use crate::eigen::types::{KSampleDescriptor, PathSolveResult, SingleKSolveResult};
use crate::types::RunError;
use fullmag_ir::{FemEigenPlanIR, ModeTrackingIR, OutputIR};
use std::path::Path;

pub trait SingleKSolver {
    fn solve_single_k(
        &self,
        plan: &FemEigenPlanIR,
        outputs: &[OutputIR],
        sample: &KSampleDescriptor,
    ) -> Result<SingleKSolveResult, RunError>;
}

pub fn run_path_or_single<S: SingleKSolver>(
    solver: &S,
    plan: &FemEigenPlanIR,
    outputs: &[OutputIR],
    output_dir: Option<&Path>,
    mode_tracking: Option<&ModeTrackingIR>,
) -> Result<PathSolveResult, RunError> {
    let sample_descriptors =
        expand_k_sampling(plan.k_sampling.as_ref()).map_err(|message| RunError { message })?;
    if sample_descriptors.is_empty() {
        return Err(RunError {
            message: "expanded k-sampling produced zero samples".to_string(),
        });
    }

    let mut sample_results = Vec::with_capacity(sample_descriptors.len());
    for sample in &sample_descriptors {
        let solved = solver.solve_single_k(plan, outputs, sample)?;
        sample_results.push(solved);
    }

    let solver_model = sample_results
        .first()
        .map(|sample| sample.solver_model)
        .ok_or_else(|| RunError {
            message: "single-k solve returned no samples".to_string(),
        })?;

    let mut result = PathSolveResult {
        samples: sample_results,
        branches: Vec::new(),
        solver_model,
        notes: vec![format!(
            "{} sample(s) generated from k_sampling",
            sample_descriptors.len()
        )],
    };
    track_branches(&mut result, mode_tracking);

    if let Some(output_dir) = output_dir {
        write_path_bundle(output_dir, &result).map_err(|error| RunError {
            message: format!("failed to write path bundle: {error}"),
        })?;
        write_branch_bundle(output_dir, &result).map_err(|error| RunError {
            message: format!("failed to write branch bundle: {error}"),
        })?;
        write_mode_bundle(output_dir, &result).map_err(|error| RunError {
            message: format!("failed to write mode bundle: {error}"),
        })?;
    }

    Ok(result)
}
