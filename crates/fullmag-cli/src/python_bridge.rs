use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command as ProcessCommand, Stdio};

use anyhow::{anyhow, bail, Context, Result};

use crate::args::ScriptCli;
use crate::control_room::repo_root;
use crate::types::{LoadedMagnetizationState, PythonProgressCallback, PythonProgressEnvelope, PythonProgressEvent, ScriptExecutionConfig};

pub(crate) const PYTHON_PROGRESS_PREFIX: &str = "[fullmag-progress] ";
const PYTHON_PROGRESS_JSON_PREFIX: &str = "json:";

pub(crate) fn parse_python_progress_event(message: &str) -> PythonProgressEvent {
    let trimmed = message.trim();
    let Some(payload) = trimmed.strip_prefix(PYTHON_PROGRESS_JSON_PREFIX) else {
        return PythonProgressEvent::Message(trimmed.to_string());
    };

    let Ok(envelope) = serde_json::from_str::<PythonProgressEnvelope>(payload) else {
        return PythonProgressEvent::Message(trimmed.to_string());
    };

    match envelope.kind.as_str() {
        "fem_surface_preview" => match (envelope.geometry_name, envelope.fem_mesh) {
            (Some(geometry_name), Some(fem_mesh)) => PythonProgressEvent::FemSurfacePreview {
                geometry_name,
                fem_mesh,
                message: envelope.message,
            },
            _ => PythonProgressEvent::Message(trimmed.to_string()),
        },
        _ => PythonProgressEvent::Message(trimmed.to_string()),
    }
}

pub(crate) fn run_python_helper(args: &[String]) -> Result<std::process::Output> {
    run_python_helper_with_progress(args, None)
}

pub(crate) fn run_python_helper_with_progress(
    args: &[String],
    progress_callback: Option<PythonProgressCallback>,
) -> Result<std::process::Output> {
    let local_python = repo_root()
        .join(".fullmag")
        .join("local")
        .join("python")
        .join("bin")
        .join("python");
    let repo_python = repo_root().join(".venv").join("bin").join("python");
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

    let pythonpath = repo_root().join("packages").join("fullmag-py").join("src");
    let fem_mesh_cache_dir = repo_root()
        .join(".fullmag")
        .join("local")
        .join("cache")
        .join("fem_mesh_assets");
    let inherited_pythonpath = std::env::var("PYTHONPATH").ok();

    let mut last_error = None;
    for candidate in candidates {
        let mut command = ProcessCommand::new(&candidate);
        command.args(args);
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        command.env("PYTHONUNBUFFERED", "1");
        if progress_callback.is_some() {
            command.env("FULLMAG_PROGRESS", "1");
        }
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

        match command.spawn() {
            Ok(mut child) => {
                let stdout = child
                    .stdout
                    .take()
                    .ok_or_else(|| anyhow!("python helper stdout was not piped"))?;
                let stderr = child
                    .stderr
                    .take()
                    .ok_or_else(|| anyhow!("python helper stderr was not piped"))?;
                let stdout_thread = std::thread::spawn(move || -> Result<Vec<u8>> {
                    let mut stdout = stdout;
                    let mut bytes = Vec::new();
                    stdout.read_to_end(&mut bytes)?;
                    Ok(bytes)
                });
                let stderr_progress = progress_callback.clone();
                let stderr_thread = std::thread::spawn(move || -> Result<Vec<u8>> {
                    let mut reader = BufReader::new(stderr);
                    let mut collected = Vec::new();
                    loop {
                        let mut line = String::new();
                        let read = reader.read_line(&mut line)?;
                        if read == 0 {
                            break;
                        }
                        collected.extend_from_slice(line.as_bytes());
                        if let Some(callback) = stderr_progress.as_ref() {
                            if let Some(message) =
                                line.trim_end().strip_prefix(PYTHON_PROGRESS_PREFIX)
                            {
                                callback(parse_python_progress_event(message));
                            }
                        }
                    }
                    Ok(collected)
                });
                let status = child.wait()?;
                let stdout = stdout_thread
                    .join()
                    .map_err(|_| anyhow!("python helper stdout reader panicked"))??;
                let stderr = stderr_thread
                    .join()
                    .map_err(|_| anyhow!("python helper stderr reader panicked"))??;
                return Ok(std::process::Output {
                    status,
                    stdout,
                    stderr,
                });
            }
            Err(error) => last_error = Some(format!("{}: {}", candidate, error)),
        }
    }

    Err(anyhow!(
        "failed to spawn python helper ({})",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    ))
}

pub(crate) fn check_script_syntax_via_python(script_path: &Path) -> Result<()> {
    let helper_args = vec![
        "-m".to_string(),
        "fullmag.runtime.helper".to_string(),
        "check-syntax".to_string(),
        "--script".to_string(),
        script_path.display().to_string(),
    ];

    let output = run_python_helper(&helper_args)
        .with_context(|| format!("failed to syntax-check {}", script_path.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("python syntax check failed: {}", stderr.trim());
    }
    Ok(())
}

pub(crate) fn export_script_execution_config_via_python(
    script_path: &Path,
    args: &ScriptCli,
    progress_callback: Option<PythonProgressCallback>,
) -> Result<ScriptExecutionConfig> {
    export_script_execution_config_via_python_with_options(
        script_path,
        args,
        false,
        progress_callback,
    )
}

pub(crate) fn export_script_execution_config_via_python_with_options(
    script_path: &Path,
    args: &ScriptCli,
    skip_geometry_assets: bool,
    progress_callback: Option<PythonProgressCallback>,
) -> Result<ScriptExecutionConfig> {
    use clap::ValueEnum;
    let mut helper_args = vec![
        "-m".to_string(),
        "fullmag.runtime.helper".to_string(),
        "export-run-config".to_string(),
        "--script".to_string(),
        script_path.display().to_string(),
    ];
    if let Some(backend) = args.backend {
        helper_args.push("--backend".to_string());
        helper_args.push(backend.to_possible_value().unwrap().get_name().to_string());
    }
    if let Some(mode) = args.mode {
        helper_args.push("--mode".to_string());
        helper_args.push(mode.to_possible_value().unwrap().get_name().to_string());
    }
    if let Some(precision) = args.precision {
        helper_args.push("--precision".to_string());
        helper_args.push(
            precision
                .to_possible_value()
                .unwrap()
                .get_name()
                .to_string(),
        );
    }
    if skip_geometry_assets {
        helper_args.push("--skip-geometry-assets".to_string());
    }

    let output = run_python_helper_with_progress(&helper_args, progress_callback)
        .with_context(|| format!("failed to export ProblemIR from {}", script_path.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("python helper failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8(output.stdout)
        .context("python helper did not return valid UTF-8 JSON")?;
    serde_json::from_str(&stdout)
        .context("failed to deserialize script execution config from python helper")
}

pub(crate) fn read_magnetization_state(
    path: &Path,
    format: Option<&str>,
    dataset: Option<&str>,
    sample_index: Option<i64>,
) -> Result<LoadedMagnetizationState> {
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

    let output = run_python_helper(&helper_args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("failed to load magnetization state: {}", stderr.trim());
    }
    serde_json::from_slice::<LoadedMagnetizationState>(&output.stdout)
        .context("failed to parse magnetization state payload")
}

pub(crate) fn invoke_remesh(
    geometry_entry: &fullmag_ir::GeometryEntryIR,
    hmax: f64,
    fe_order: u32,
    mesh_options: &serde_json::Value,
) -> Result<fullmag_ir::MeshIR> {
    let payload = serde_json::json!({
        "geometry": geometry_entry,
        "hmax": hmax,
        "order": fe_order,
        "mesh_options": mesh_options,
    });
    let payload_str = serde_json::to_string(&payload)?;

    let script = format!(
        "import sys; sys.stdin = __import__('io').StringIO({payload_json}); \
         from fullmag.meshing.remesh_cli import main; main()",
        payload_json = serde_json::to_string(&payload_str)?,
    );
    let output = run_python_helper(&["-c".to_string(), script])?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "remesh_cli.py failed (exit {}):\n{}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        );
    }
    let mesh: fullmag_ir::MeshIR =
        serde_json::from_slice(&output.stdout).context("failed to parse remesh output")?;
    Ok(mesh)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_python_progress_event_extracts_fem_surface_preview() {
        let event = parse_python_progress_event(
            r#"json:{"kind":"fem_surface_preview","geometry_name":"nanoflower","fem_mesh":{"nodes":[[0.0,0.0,0.0],[1.0,0.0,0.0],[0.0,1.0,0.0]],"elements":[],"boundary_faces":[[0,1,2]]},"message":"Surface preview ready"}"#,
        );

        match event {
            PythonProgressEvent::FemSurfacePreview {
                geometry_name,
                fem_mesh,
                message,
            } => {
                assert_eq!(geometry_name, "nanoflower");
                assert_eq!(fem_mesh.nodes.len(), 3);
                assert_eq!(fem_mesh.boundary_faces.len(), 1);
                assert!(fem_mesh.elements.is_empty());
                assert_eq!(message.as_deref(), Some("Surface preview ready"));
            }
            other => panic!("expected fem surface preview event, got {:?}", other),
        }
    }
}
