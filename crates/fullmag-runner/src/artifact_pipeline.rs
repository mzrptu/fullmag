//! Buffered asynchronous artifact streaming for long-running solver outputs.
//!
//! Public `run_problem*` entry points use this pipeline to move large field
//! snapshots off the hot simulation path as early as possible. The channel is
//! bounded, so the solver gets back-pressure instead of unbounded RAM growth if
//! disk I/O falls behind.

use crate::artifacts::{
    write_field_file, write_scalar_row, write_scalars_csv_header, FieldArtifactContext,
};
use crate::types::{ExecutionProvenance, FieldSnapshot, RunError, StepStats};

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, SyncSender};
use std::thread::{self, JoinHandle};

pub(crate) const DEFAULT_ARTIFACT_PIPELINE_CAPACITY: usize = 4;

#[derive(Debug, Clone, Default)]
pub(crate) struct ArtifactPipelineSummary {
    pub scalar_rows_written: usize,
    pub field_snapshots_written: usize,
}

enum ArtifactJob {
    ScalarRow(StepStats),
    FieldSnapshot {
        snapshot: FieldSnapshot,
        provenance: ExecutionProvenance,
    },
    Shutdown,
}

#[derive(Clone)]
pub(crate) struct ArtifactPipelineSender {
    tx: SyncSender<ArtifactJob>,
}

impl ArtifactPipelineSender {
    fn push(&self, job: ArtifactJob) -> Result<(), RunError> {
        self.tx.send(job).map_err(|_| RunError {
            message:
                "artifact writer thread became unavailable while streaming solver outputs"
                    .to_string(),
        })
    }
}

pub(crate) struct ArtifactPipeline {
    tx: Option<SyncSender<ArtifactJob>>,
    handle: Option<JoinHandle<Result<ArtifactPipelineSummary, String>>>,
}

impl ArtifactPipeline {
    pub(crate) fn start(
        output_dir: PathBuf,
        field_context: FieldArtifactContext,
        capacity: usize,
    ) -> Result<Self, RunError> {
        fs::create_dir_all(&output_dir).map_err(|error| RunError {
            message: format!(
                "failed to create artifact output directory '{}': {}",
                output_dir.display(),
                error
            ),
        })?;
        let (tx, rx) = mpsc::sync_channel::<ArtifactJob>(capacity.max(1));
        let handle = thread::Builder::new()
            .name("fullmag-artifact-writer".into())
            .spawn(move || writer_loop(&output_dir, field_context, rx))
            .map_err(|error| RunError {
                message: format!("failed to spawn artifact writer thread: {}", error),
            })?;

        Ok(Self {
            tx: Some(tx),
            handle: Some(handle),
        })
    }

    pub(crate) fn sender(&self) -> ArtifactPipelineSender {
        ArtifactPipelineSender {
            tx: self
                .tx
                .as_ref()
                .expect("artifact pipeline sender requested after finish")
                .clone(),
        }
    }

    pub(crate) fn finish(&mut self) -> Result<ArtifactPipelineSummary, RunError> {
        if let Some(tx) = self.tx.take() {
            tx.send(ArtifactJob::Shutdown).map_err(|_| RunError {
                message: "failed to signal artifact writer shutdown".to_string(),
            })?;
        }

        let Some(handle) = self.handle.take() else {
            return Ok(ArtifactPipelineSummary::default());
        };
        handle
            .join()
            .map_err(|_| RunError {
                message: "artifact writer thread panicked".to_string(),
            })?
            .map_err(|message| RunError { message })
    }
}

impl Drop for ArtifactPipeline {
    fn drop(&mut self) {
        if let Some(tx) = self.tx.take() {
            let _ = tx.send(ArtifactJob::Shutdown);
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

pub(crate) struct ArtifactRecorder {
    field_snapshots: Vec<FieldSnapshot>,
    field_snapshot_count: usize,
    pipeline: Option<ArtifactPipelineSender>,
    provenance: ExecutionProvenance,
}

impl ArtifactRecorder {
    pub(crate) fn in_memory(provenance: ExecutionProvenance) -> Self {
        Self {
            field_snapshots: Vec::new(),
            field_snapshot_count: 0,
            pipeline: None,
            provenance,
        }
    }

    pub(crate) fn streaming(
        provenance: ExecutionProvenance,
        pipeline: ArtifactPipelineSender,
    ) -> Self {
        Self {
            field_snapshots: Vec::new(),
            field_snapshot_count: 0,
            pipeline: Some(pipeline),
            provenance,
        }
    }

    pub(crate) fn provenance(&self) -> &ExecutionProvenance {
        &self.provenance
    }

    pub(crate) fn record_scalar(&mut self, stats: &StepStats) -> Result<(), RunError> {
        if let Some(pipeline) = self.pipeline.as_ref() {
            pipeline.push(ArtifactJob::ScalarRow(stats.clone()))?;
        }
        Ok(())
    }

    pub(crate) fn record_field_snapshot(
        &mut self,
        snapshot: FieldSnapshot,
    ) -> Result<(), RunError> {
        if let Some(pipeline) = self.pipeline.as_ref() {
            pipeline.push(ArtifactJob::FieldSnapshot {
                snapshot,
                provenance: self.provenance.clone(),
            })?;
        } else {
            self.field_snapshots.push(snapshot);
        }
        self.field_snapshot_count += 1;
        Ok(())
    }

    pub(crate) fn finish(self) -> (Vec<FieldSnapshot>, usize, ExecutionProvenance) {
        (
            self.field_snapshots,
            self.field_snapshot_count,
            self.provenance,
        )
    }
}

fn writer_loop(
    output_dir: &Path,
    field_context: FieldArtifactContext,
    rx: mpsc::Receiver<ArtifactJob>,
) -> Result<ArtifactPipelineSummary, String> {
    fs::create_dir_all(output_dir)
        .map_err(|error| format!("failed to prepare output directory: {}", error))?;

    let scalars_path = output_dir.join("scalars.csv");
    let fields_dir = output_dir.join("fields");
    let mut summary = ArtifactPipelineSummary::default();
    let mut scalar_writer: Option<BufWriter<File>> = None;

    for job in rx {
        match job {
            ArtifactJob::ScalarRow(stats) => {
                if scalar_writer.is_none() {
                    let file = File::create(&scalars_path).map_err(|error| {
                        format!(
                            "failed to create scalar trace '{}': {}",
                            scalars_path.display(),
                            error
                        )
                    })?;
                    let mut writer = BufWriter::new(file);
                    write_scalars_csv_header(&mut writer).map_err(|error| {
                        format!(
                            "failed to write scalar trace header '{}': {}",
                            scalars_path.display(),
                            error
                        )
                    })?;
                    scalar_writer = Some(writer);
                }
                write_scalar_row(
                    scalar_writer
                        .as_mut()
                        .expect("scalar writer initialized before row write"),
                    &stats,
                )
                .map_err(|error| {
                    format!(
                        "failed to append scalar trace row to '{}': {}",
                        scalars_path.display(),
                        error
                    )
                })?;
                summary.scalar_rows_written += 1;
            }
            ArtifactJob::FieldSnapshot {
                snapshot,
                provenance,
            } => {
                let observable_dir = fields_dir.join(&snapshot.name);
                fs::create_dir_all(&observable_dir).map_err(|error| {
                    format!(
                        "failed to create field snapshot directory '{}': {}",
                        observable_dir.display(),
                        error
                    )
                })?;
                let snapshot_path = observable_dir.join(format!("step_{:06}.json", snapshot.step));
                write_field_file(
                    &snapshot_path,
                    &field_context,
                    &provenance,
                    &snapshot.name,
                    snapshot.step,
                    snapshot.time,
                    snapshot.solver_dt,
                    &snapshot.values,
                )
                .map_err(|error| {
                    format!(
                        "failed to write field snapshot '{}': {}",
                        snapshot_path.display(),
                        error
                    )
                })?;
                summary.field_snapshots_written += 1;
            }
            ArtifactJob::Shutdown => break,
        }
    }

    if let Some(mut writer) = scalar_writer {
        writer.flush().map_err(|error| {
            format!(
                "failed to flush scalar trace '{}': {}",
                scalars_path.display(),
                error
            )
        })?;
    }

    Ok(summary)
}
