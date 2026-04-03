use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use crate::control_room::{api_is_ready, api_port, publish_current_live_state};
use crate::formatting::{push_engine_log, unix_time_millis};
use crate::types::*;

#[derive(Debug, Clone)]
pub(crate) struct LocalLiveWorkspaceState {
    pub session: SessionManifest,
    pub run: RunManifest,
    pub live_state: LiveStateManifest,
    pub metadata: Option<serde_json::Value>,
    pub mesh_workspace: Option<serde_json::Value>,
    pub latest_scalar_row: Option<CurrentLiveScalarRow>,
    pub latest_fields: CurrentLiveLatestFields,
    pub preview_fields: CurrentLivePreviewFieldCache,
    pub pending_preview_fields: CurrentLivePreviewFieldCache,
    pub clear_preview_cache: bool,
    pub engine_log: Vec<EngineLogEntry>,
}

impl LocalLiveWorkspaceState {
    pub fn build_publish_payload(
        &self,
        preview_fields: Option<Vec<fullmag_runner::LivePreviewField>>,
        clear_preview_cache: bool,
    ) -> CurrentLivePublishPayload {
        let mut live_state = self.live_state.clone();
        let mut metadata = self.metadata.clone();

        // Promote fem_mesh to a top-level payload field — this makes the mesh
        // lifecycle an explicit event rather than a hidden one-time-at-step-0
        // trick relying on API-side caching.  After promotion the step view no
        // longer carries the mesh, so the API protocol is unambiguous.
        let fem_mesh = live_state.latest_step.fem_mesh.take();
        if live_state.latest_step.step > 0 {
            metadata = None;
        }

        CurrentLivePublishPayload {
            fem_mesh,
            session: Some(self.session.clone()),
            session_status: Some(self.session.status.clone()),
            metadata,
            run: Some(self.run.clone()),
            runtime_status: live_state.runtime_status,
            live_state: Some(live_state),
            mesh_workspace: self.mesh_workspace.clone(),
            latest_scalar_row: self.latest_scalar_row.clone(),
            latest_fields: (!self.latest_fields.is_empty()).then_some(self.latest_fields.clone()),
            preview_fields,
            clear_preview_cache,
            engine_log: Some(self.engine_log.clone()),
        }
    }

    pub fn snapshot(&self) -> CurrentLivePublishPayload {
        self.build_publish_payload(
            (!self.preview_fields.is_empty()).then_some(self.preview_fields.to_vec()),
            self.clear_preview_cache,
        )
    }

    pub fn publish_delta(&mut self) -> CurrentLivePublishPayload {
        let preview_fields = (!self.pending_preview_fields.is_empty())
            .then_some(self.pending_preview_fields.take_vec());
        let clear_preview_cache = std::mem::take(&mut self.clear_preview_cache);
        self.build_publish_payload(preview_fields, clear_preview_cache)
    }
}

#[derive(Clone)]
pub(crate) struct LocalLiveWorkspace {
    state: Arc<Mutex<LocalLiveWorkspaceState>>,
    publisher: CurrentLivePublisher,
}

impl LocalLiveWorkspace {
    pub fn new(initial: LocalLiveWorkspaceState, publisher: CurrentLivePublisher) -> Self {
        Self {
            state: Arc::new(Mutex::new(initial)),
            publisher,
        }
    }

    pub fn replace(&self, next: LocalLiveWorkspaceState) {
        if let Ok(mut state) = self.state.lock() {
            *state = next;
        }
        self.publish_snapshot();
    }

    pub fn update<F>(&self, mutate: F)
    where
        F: FnOnce(&mut LocalLiveWorkspaceState),
    {
        if let Ok(mut state) = self.state.lock() {
            mutate(&mut state);
        }
        self.publish_snapshot();
    }

    pub fn snapshot(&self) -> LocalLiveWorkspaceState {
        self.state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_else(|_| panic!("local live workspace state lock poisoned"))
    }

    pub fn publish_snapshot(&self) {
        let snapshot = self
            .state
            .lock()
            .map(|mut state| state.publish_delta())
            .unwrap_or_default();
        self.publisher.replace(snapshot);
    }

    pub fn push_log(&self, level: &str, message: impl Into<String>) {
        if let Ok(mut state) = self.state.lock() {
            push_engine_log(&mut state.engine_log, level, message);
        }
        self.publish_snapshot();
    }
}

fn merge_preview_field_payloads(
    existing: Option<Vec<fullmag_runner::LivePreviewField>>,
    incoming: Option<Vec<fullmag_runner::LivePreviewField>>,
) -> Option<Vec<fullmag_runner::LivePreviewField>> {
    let mut merged = BTreeMap::new();
    for field in existing.into_iter().flatten() {
        merged.insert(field.quantity.clone(), field);
    }
    for field in incoming.into_iter().flatten() {
        merged.insert(field.quantity.clone(), field);
    }
    (!merged.is_empty()).then(|| merged.into_values().collect())
}

#[derive(Clone)]
pub(crate) struct CurrentLivePublisher {
    pending: Arc<AtomicBool>,
    sending: Arc<AtomicBool>,
    payload: Arc<Mutex<CurrentLivePublishPayload>>,
    wake_tx: mpsc::SyncSender<()>,
}

const CURRENT_LIVE_MIN_PUBLISH_INTERVAL: Duration = Duration::from_millis(50);

impl CurrentLivePublisher {
    pub fn spawn(session_id: &str) -> Self {
        let (wake_tx, wake_rx) = mpsc::sync_channel(1);
        let pending = Arc::new(AtomicBool::new(false));
        let sending = Arc::new(AtomicBool::new(false));
        let payload = Arc::new(Mutex::new(CurrentLivePublishPayload::default()));
        let worker_pending = Arc::clone(&pending);
        let worker_sending = Arc::clone(&sending);
        let worker_payload = Arc::clone(&payload);
        let worker_session_id = session_id.to_string();
        let thread_name = format!("fullmag-live-publisher-{session_id}");
        std::thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                current_live_publisher_loop(
                    worker_session_id,
                    worker_pending,
                    worker_sending,
                    worker_payload,
                    wake_rx,
                )
            })
            .expect("current live publisher thread should spawn");

        Self {
            pending,
            sending,
            payload,
            wake_tx,
        }
    }

    pub fn request_publish(&self) {
        self.pending.store(true, Ordering::Release);
        match self.wake_tx.try_send(()) {
            Ok(()) | Err(mpsc::TrySendError::Full(())) => {}
            Err(mpsc::TrySendError::Disconnected(())) => {}
        }
    }

    pub fn replace(&self, payload: CurrentLivePublishPayload) {
        if let Ok(mut slot) = self.payload.lock() {
            let should_merge_preview =
                self.pending.load(Ordering::Acquire) || self.sending.load(Ordering::Acquire);
            let merged_preview_fields = if payload.clear_preview_cache {
                payload.preview_fields.clone()
            } else if should_merge_preview {
                merge_preview_field_payloads(
                    slot.preview_fields.take(),
                    payload.preview_fields.clone(),
                )
            } else {
                payload.preview_fields.clone()
            };
            let clear_preview_cache =
                (should_merge_preview && slot.clear_preview_cache) || payload.clear_preview_cache;
            *slot = payload;
            slot.preview_fields = merged_preview_fields;
            slot.clear_preview_cache = clear_preview_cache;
        }
        self.request_publish();
    }
}

fn current_live_publisher_loop(
    session_id: String,
    pending: Arc<AtomicBool>,
    sending: Arc<AtomicBool>,
    payload: Arc<Mutex<CurrentLivePublishPayload>>,
    wake_rx: mpsc::Receiver<()>,
) {
    let mut last_publish_at: Option<Instant> = None;
    while wake_rx.recv().is_ok() {
        while pending.swap(false, Ordering::AcqRel) {
            if let Some(last_publish_at) = last_publish_at {
                let elapsed = last_publish_at.elapsed();
                if elapsed < CURRENT_LIVE_MIN_PUBLISH_INTERVAL {
                    std::thread::sleep(CURRENT_LIVE_MIN_PUBLISH_INTERVAL - elapsed);
                }
            }
            let snapshot = payload.lock().map(|slot| slot.clone()).unwrap_or_default();
            sending.store(true, Ordering::Release);
            let publish_result = publish_current_live_state(&session_id, &snapshot);
            sending.store(false, Ordering::Release);
            if let Err(error) = publish_result {
                pending.store(true, Ordering::Release);
                if api_is_ready(api_port()) {
                    eprintln!("fullmag live publish warning: {}", error);
                }
            }
            last_publish_at = Some(Instant::now());
        }
    }

    if pending.swap(false, Ordering::AcqRel) {
        let snapshot = payload.lock().map(|slot| slot.clone()).unwrap_or_default();
        sending.store(true, Ordering::Release);
        let publish_result = publish_current_live_state(&session_id, &snapshot);
        sending.store(false, Ordering::Release);
        if let Err(error) = publish_result {
            if api_is_ready(api_port()) {
                eprintln!("fullmag live publish warning: {}", error);
            }
        }
    }
}

pub(crate) fn bootstrap_live_state(status: &str) -> LiveStateManifest {
    LiveStateManifest {
        status: status.to_string(),
        runtime_status: Some(fullmag_runner::RuntimeStatus::from_status_code(status)),
        updated_at_unix_ms: unix_time_millis().unwrap_or(0),
        latest_step: LiveStepView {
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
            grid: [0, 0, 0],
            fem_mesh: None,
            magnetization: None,
            preview_field: None,
            finished: false,
        },
    }
}

pub(crate) fn set_live_state_status(
    live_state: &mut LiveStateManifest,
    status: &str,
    finished: Option<bool>,
) {
    live_state.status = status.to_string();
    live_state.runtime_status = Some(fullmag_runner::RuntimeStatus::from_status_code(status));
    live_state.updated_at_unix_ms = unix_time_millis().unwrap_or(0);
    if let Some(finished) = finished {
        live_state.latest_step.finished = finished;
    }
}

pub(crate) fn scalar_row_from_update(update: &fullmag_runner::StepUpdate) -> CurrentLiveScalarRow {
    scalar_row_from_stats(&update.stats)
}

pub(crate) fn scalar_row_from_stats(stats: &fullmag_runner::StepStats) -> CurrentLiveScalarRow {
    CurrentLiveScalarRow {
        step: stats.step,
        time: stats.time,
        solver_dt: stats.dt,
        mx: stats.mx,
        my: stats.my,
        mz: stats.mz,
        e_ex: stats.e_ex,
        e_demag: stats.e_demag,
        e_ext: stats.e_ext,
        e_total: stats.e_total,
        max_dm_dt: stats.max_dm_dt,
        max_h_eff: stats.max_h_eff,
        max_h_demag: stats.max_h_demag,
    }
}

pub(crate) fn set_latest_scalar_row_if_due(
    state: &mut LocalLiveWorkspaceState,
    update: &fullmag_runner::StepUpdate,
) {
    if update.scalar_row_due {
        state.latest_scalar_row = Some(scalar_row_from_update(update));
    }
}

pub(crate) fn clear_cached_preview_fields(state: &mut LocalLiveWorkspaceState) {
    state.preview_fields.clear();
    state.pending_preview_fields.clear();
    state.clear_preview_cache = true;
}

pub(crate) fn replace_cached_preview_fields(
    state: &mut LocalLiveWorkspaceState,
    fields: impl IntoIterator<Item = fullmag_runner::LivePreviewField>,
) {
    state.preview_fields.replace_all(fields);
    state.pending_preview_fields = state.preview_fields.clone();
    state.clear_preview_cache = true;
}

pub(crate) fn upsert_cached_preview_field(
    state: &mut LocalLiveWorkspaceState,
    field: &fullmag_runner::LivePreviewField,
) {
    state.preview_fields.insert(field.clone());
    state.pending_preview_fields.insert(field.clone());
}

pub(crate) fn merge_cached_preview_fields_from_update(
    state: &mut LocalLiveWorkspaceState,
    update: &fullmag_runner::StepUpdate,
) {
    if let Some(fields) = update.cached_preview_fields.as_ref() {
        for field in fields {
            upsert_cached_preview_field(state, field);
        }
    }
    if let Some(preview_field) = update.preview_field.as_ref() {
        upsert_cached_preview_field(state, preview_field);
    }
}

pub(crate) fn apply_python_progress_event(
    live_workspace: &LocalLiveWorkspace,
    event: PythonProgressEvent,
) {
    match event {
        PythonProgressEvent::Message(message) => {
            live_workspace.push_log("info", message);
        }
        PythonProgressEvent::FemSurfacePreview {
            geometry_name,
            fem_mesh,
            message,
        } => {
            live_workspace.update(|state| {
                state.live_state.updated_at_unix_ms = unix_time_millis().unwrap_or(0);
                state.live_state.latest_step.fem_mesh = Some(fem_mesh);
                if let Some(message) = message {
                    push_engine_log(&mut state.engine_log, "info", message);
                } else {
                    push_engine_log(
                        &mut state.engine_log,
                        "info",
                        format!("Surface preview ready for '{}'", geometry_name),
                    );
                }
            });
        }
    }
}
