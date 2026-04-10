//! Session persistence API handlers — save, load, inspect, checkpoints, recovery.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::types::AppState;

use fullmag_session::{
    inspect_fms, pack_fms, unpack_fms,
    FmsExportProfile, FmsRunManifest, FmsSessionManifest, FmsWorkspaceManifest,
    PackOptions, SaveProfile, SessionInspection, SessionStore,
};

// ── Request / Response types ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub(crate) struct SessionExportRequest {
    /// Save profile: "compact", "solved", "resume", "archive".
    pub profile: SaveProfile,
    /// Optional session name override.
    #[serde(default)]
    pub name: Option<String>,
    /// Compression: "speed", "balanced", "smallest".
    #[serde(default)]
    pub compression: Option<fullmag_session::CompressionProfile>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SessionExportResponse {
    pub session_id: String,
    pub profile: SaveProfile,
    /// Base64-encoded `.fms` file content.
    pub fms_base64: String,
    pub size_bytes: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SessionImportInspectRequest {
    /// Base64-encoded `.fms` file content.
    pub fms_base64: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct SessionImportInspectResponse {
    pub inspection: SessionInspection,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SessionImportCommitRequest {
    /// Base64-encoded `.fms` file content.
    pub fms_base64: String,
    /// Restore mode: "resume", "initial_condition", "config_only".
    #[serde(default)]
    #[allow(dead_code)]
    pub restore_mode: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SessionImportCommitResponse {
    pub session_id: String,
    pub restore_class: fullmag_session::RestoreClass,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct CheckpointListResponse {
    pub checkpoints: Vec<CheckpointEntry>,
}

#[derive(Debug, Serialize)]
pub(crate) struct CheckpointEntry {
    pub checkpoint_id: String,
    pub step: u64,
    pub time_s: f64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct RecoveryListResponse {
    pub snapshots: Vec<RecoveryEntry>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RecoveryEntry {
    pub session_id: String,
    pub name: String,
    pub saved_at: String,
    pub profile: SaveProfile,
}

#[derive(Debug, Serialize)]
pub(crate) struct RecoveryClearResponse {
    pub cleared: usize,
}

// ── Helpers ────────────────────────────────────────────────────────────

fn session_store_root(state: &AppState) -> std::path::PathBuf {
    state
        .repo_root
        .join(".fullmag")
        .join("local-live")
        .join("session-store")
}

fn open_store(state: &AppState) -> Result<SessionStore, ApiError> {
    SessionStore::open(session_store_root(state)).map_err(|e| ApiError::internal(e.to_string()))
}

async fn current_session_id(state: &AppState) -> Result<String, ApiError> {
    let current = state.current_live_state.read().await;
    current
        .as_ref()
        .map(|s| s.session.session_id.clone())
        .ok_or_else(|| ApiError::not_found("no active workspace"))
}

async fn collect_project_documents(state: &AppState) -> HashMap<String, Vec<u8>> {
    let mut docs = HashMap::new();
    let guard = state.current_live_state.read().await;
    if let Some(snapshot) = guard.as_ref() {
        // Scene document
        if let Some(scene) = &snapshot.scene_document {
            if let Ok(data) = serde_json::to_vec_pretty(scene) {
                docs.insert("scene_document.json".into(), data);
            }
        }
        // Script builder (stored in builder_adapter)
        if let Some(sb) = &snapshot.builder_adapter {
            if let Ok(data) = serde_json::to_vec_pretty(sb) {
                docs.insert("script_builder.json".into(), data);
            }
        }
        // UI state placeholder (panel layout, analyze selection, etc.)
        docs.insert("ui_state.json".into(), b"{}".to_vec());
    }

    // Try to read the main script from disk.
    if let Some(snapshot) = guard.as_ref() {
        let script_path = std::path::Path::new(&snapshot.session.script_path);
        if script_path.exists() {
            if let Ok(data) = std::fs::read(script_path) {
                docs.insert("main.py".into(), data);
            }
        }
    }

    docs
}

// ── Handlers ───────────────────────────────────────────────────────────

/// `POST /v1/live/current/session/export`
pub(crate) async fn export_session(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SessionExportRequest>,
) -> Result<Json<SessionExportResponse>, ApiError> {
    let session_id = current_session_id(&state).await?;
    let store = open_store(&state)?;

    let name = if let Some(n) = req.name {
        n
    } else {
        let guard = state.current_live_state.read().await;
        guard
            .as_ref()
            .map(|s| s.session.problem_name.clone())
            .unwrap_or_else(|| "Untitled".into())
    };

    let mut session_manifest = FmsSessionManifest::new(&session_id, &name, req.profile);

    // Collect run info from the current state.
    {
        let guard = state.current_live_state.read().await;
        if let Some(snapshot) = guard.as_ref() {
            let run_ref = format!("runs/{}/run_manifest.json", snapshot.session.run_id);
            session_manifest.run_refs.push(run_ref.clone());

            let run_manifest = FmsRunManifest {
                run_id: snapshot.session.run_id.clone(),
                status: fullmag_session::RunStatus::Completed, // simplified
                study_kind: "unknown".into(),
                backend: snapshot.session.requested_backend.clone(),
                precision: snapshot.session.precision.clone(),
                started_at: chrono::Utc::now(),
                finished_at: None,
                total_steps: snapshot
                    .run
                    .as_ref()
                    .map(|r| r.total_steps as u64)
                    .unwrap_or(0),
                total_time_s: snapshot
                    .live_state
                    .as_ref()
                    .map(|ls| ls.latest_step.time)
                    .unwrap_or(0.0),
                plan_ref: None,
                live_state_ref: None,
                latest_checkpoint_ref: None,
                artifact_index_ref: None,
            };
            store
                .commit_run(&run_manifest)
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
    }

    let workspace_manifest = FmsWorkspaceManifest {
        workspace_id: "local-live".into(),
        problem_name: name.clone(),
        project_ref: "project/".into(),
        ui_state_ref: "project/ui_state.json".into(),
        scene_document_ref: "project/scene_document.json".into(),
        script_builder_ref: Some("project/script_builder.json".into()),
        model_builder_graph_ref: None,
        asset_index_ref: None,
    };

    let export_profile = FmsExportProfile::for_profile(req.profile);
    let docs = collect_project_documents(&state).await;

    let opts = PackOptions {
        compression: req.compression.unwrap_or(fullmag_session::CompressionProfile::Balanced),
    };

    store
        .commit_session(&session_manifest)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    // Pack to in-memory buffer.
    let mut buf = Cursor::new(Vec::new());
    pack_fms(
        &mut buf,
        &store,
        &session_manifest,
        &workspace_manifest,
        &export_profile,
        &docs,
        &opts,
    )
    .map_err(|e| ApiError::internal(format!("packing .fms: {e}")))?;

    let fms_bytes = buf.into_inner();
    let fms_base64 = base64_encode(&fms_bytes);

    Ok(Json(SessionExportResponse {
        session_id,
        profile: req.profile,
        fms_base64,
        size_bytes: fms_bytes.len(),
    }))
}

/// `POST /v1/live/current/session/import/inspect`
pub(crate) async fn import_session_inspect(
    Json(req): Json<SessionImportInspectRequest>,
) -> Result<Json<SessionImportInspectResponse>, ApiError> {
    let fms_bytes = base64_decode(&req.fms_base64)
        .map_err(|e| ApiError::bad_request(format!("invalid base64: {e}")))?;

    let inspection = inspect_fms(Cursor::new(&fms_bytes))
        .map_err(|e| ApiError::bad_request(format!("invalid .fms file: {e}")))?;

    Ok(Json(SessionImportInspectResponse { inspection }))
}

/// `POST /v1/live/current/session/import/commit`
pub(crate) async fn import_session_commit(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SessionImportCommitRequest>,
) -> Result<Json<SessionImportCommitResponse>, ApiError> {
    let fms_bytes = base64_decode(&req.fms_base64)
        .map_err(|e| ApiError::bad_request(format!("invalid base64: {e}")))?;

    let store = open_store(&state)?;

    let session = unpack_fms(Cursor::new(&fms_bytes), &store)
        .map_err(|e| ApiError::internal(format!("unpacking .fms: {e}")))?;

    // Determine restore class.
    let inspection = inspect_fms(Cursor::new(&fms_bytes))
        .map_err(|e| ApiError::internal(format!("re-inspecting .fms: {e}")))?;

    Ok(Json(SessionImportCommitResponse {
        session_id: session.session_id,
        restore_class: inspection.restore_class,
        warnings: inspection.warnings,
    }))
}

/// `GET /v1/live/current/checkpoints`
pub(crate) async fn list_checkpoints(
    State(state): State<Arc<AppState>>,
) -> Result<Json<CheckpointListResponse>, ApiError> {
    let store = open_store(&state)?;

    let guard = state.current_live_state.read().await;
    let run_id = guard
        .as_ref()
        .map(|s| s.session.run_id.clone())
        .ok_or_else(|| ApiError::not_found("no active workspace"))?;
    drop(guard);

    let cp = store
        .latest_checkpoint(&run_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let checkpoints = match cp {
        Some(cp) => vec![CheckpointEntry {
            checkpoint_id: cp.checkpoint_id,
            step: cp.step,
            time_s: cp.time_s,
            created_at: cp.created_at.to_rfc3339(),
        }],
        None => vec![],
    };

    Ok(Json(CheckpointListResponse { checkpoints }))
}

/// `GET /v1/live/current/recovery`
pub(crate) async fn list_recovery(
    State(state): State<Arc<AppState>>,
) -> Result<Json<RecoveryListResponse>, ApiError> {
    let store = open_store(&state)?;

    let snapshots = store
        .list_recovery()
        .map_err(|e| ApiError::internal(e.to_string()))?
        .into_iter()
        .map(|m| RecoveryEntry {
            session_id: m.session_id.clone(),
            name: m.name.clone(),
            saved_at: m.saved_at.to_rfc3339(),
            profile: m.profile,
        })
        .collect();

    Ok(Json(RecoveryListResponse { snapshots }))
}

/// `POST /v1/live/current/recovery/clear`
pub(crate) async fn clear_recovery(
    State(state): State<Arc<AppState>>,
) -> Result<Json<RecoveryClearResponse>, ApiError> {
    let store = open_store(&state)?;

    let before = store
        .list_recovery()
        .map_err(|e| ApiError::internal(e.to_string()))?
        .len();
    store
        .clear_recovery()
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(RecoveryClearResponse {
        cleared: before,
    }))
}

// ── Base64 helpers ─────────────────────────────────────────────────────

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn base64_decode(s: &str) -> Result<Vec<u8>, base64::DecodeError> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s)
}
