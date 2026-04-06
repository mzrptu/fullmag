use async_stream::stream;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path as AxumPath, Query, State};
use axum::http::header::CONTENT_TYPE;
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::{
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use fullmag_authoring::{SceneDocument, ScriptBuilderInitialState};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, watch, Mutex, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;

use fullmag_runner::quantities::{quantity_spec, QuantityKind};
use fullmag_runner::{
    CommandAckEvent, DisplaySelection, LivePreviewField, MeshCommandTargetEvent,
    RuntimeEventEnvelope, StepUpdate,
};

mod artifacts;
mod assets;
mod error;
mod preview;
mod quantities;
mod script;
mod session;
mod types;
use artifacts::*;
use assets::*;
use error::ApiError;
use preview::*;
use quantities::*;
use script::*;
use session::*;
use types::*;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    let repo_root = repo_root();
    let current_workspace_root = repo_root
        .join(".fullmag")
        .join("local-live")
        .join("current");
    let static_web_root = resolve_static_web_root(&repo_root);

    let state = Arc::new(AppState {
        repo_root: repo_root.clone(),
        current_workspace_root,
        live_channels: Arc::new(RwLock::new(HashMap::new())),
        current_live_state: Arc::new(RwLock::new(None)),
        current_live_public_snapshot: Arc::new(RwLock::new(None)),
        current_live_events: broadcast::channel(256).0,
        current_live_vector_payload_seq: Arc::new(AtomicU32::new(0)),
        current_display_selection: Arc::new(RwLock::new(CurrentDisplaySelection::default())),
        current_control_queue: Arc::new(Mutex::new(VecDeque::new())),
        current_control_events: watch::channel(0).0,
        current_control_next_seq: Arc::new(Mutex::new(0)),
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/meta/vision", get(vision))
        .route("/v1/runtime/capabilities", get(get_runtime_capabilities))
        .route(
            "/v1/live/current/gpu/telemetry",
            get(get_current_gpu_telemetry),
        )
        .route(
            "/v1/live/current/bootstrap",
            get(get_current_live_bootstrap),
        )
        .route("/v1/live/current/state", get(get_current_live_state))
        .route("/v1/live/current/events", get(get_current_live_events))
        .route("/v1/live/current/publish", post(publish_current_live_state))
        .route(
            "/v1/live/current/create",
            post(create_current_live_workspace),
        )
        .route(
            "/v1/live/current/preview/selection",
            get(get_current_display_selection).post(set_current_preview_selection),
        )
        .route(
            "/v1/live/current/preview/quantity",
            post(set_current_preview_quantity),
        )
        .route(
            "/v1/live/current/preview/component",
            post(set_current_preview_component),
        )
        .route(
            "/v1/live/current/preview/XChosenSize",
            post(set_current_preview_x_chosen_size),
        )
        .route(
            "/v1/live/current/preview/everyN",
            post(set_current_preview_every_n),
        )
        .route(
            "/v1/live/current/preview/YChosenSize",
            post(set_current_preview_y_chosen_size),
        )
        .route(
            "/v1/live/current/preview/autoScaleEnabled",
            post(set_current_preview_auto_scale),
        )
        .route(
            "/v1/live/current/preview/maxPoints",
            post(set_current_preview_max_points),
        )
        .route(
            "/v1/live/current/preview/layer",
            post(set_current_preview_layer),
        )
        .route(
            "/v1/live/current/preview/allLayers",
            post(set_current_preview_all_layers),
        )
        .route(
            "/v1/live/current/preview/refresh",
            post(refresh_current_preview),
        )
        .route(
            "/v1/live/current/commands",
            post(enqueue_current_live_command),
        )
        .route(
            "/v1/live/current/commands/next",
            get(dequeue_current_live_command),
        )
        .route(
            "/v1/live/current/control/wait",
            get(wait_current_live_control),
        )
        .route(
            "/v1/live/current/assets/import",
            post(import_current_live_asset),
        )
        .route(
            "/v1/live/current/state/export",
            post(export_current_live_state),
        )
        .route(
            "/v1/live/current/state/import",
            post(import_current_live_state),
        )
        .route(
            "/v1/live/current/script/sync",
            post(sync_current_live_script),
        )
        .route("/v1/live/current/scene", post(update_current_live_scene))
        .route(
            "/v1/live/current/artifacts",
            get(list_current_live_artifacts),
        )
        .route(
            "/v1/live/current/artifacts/file",
            get(read_current_live_artifact),
        )
        .route(
            "/v1/live/current/eigen/spectrum",
            get(get_current_live_eigen_spectrum),
        )
        .route(
            "/v1/live/current/eigen/mode",
            get(get_current_live_eigen_mode),
        )
        .route(
            "/v1/live/current/eigen/dispersion",
            get(get_current_live_eigen_dispersion),
        )
        .route("/v1/docs/physics", get(list_physics_docs))
        .route("/v1/run", post(start_run))
        .route("/ws/live/current", get(ws_current_live))
        .route("/ws/live/:run_id", get(ws_live))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(cors)
        .with_state(state);

    let app = if let Some(static_root) = static_web_root {
        info!(path = %static_root.display(), "serving built control room");
        app.fallback_service(
            ServeDir::new(&static_root)
                .append_index_html_on_directories(true)
                .fallback(ServeFile::new(static_root.join("index.html"))),
        )
    } else {
        app
    };

    let port: u16 = std::env::var("FULLMAG_API_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!(%addr, "starting fullmag-api");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("binding API listener should succeed");

    axum::serve(listener, app)
        .await
        .expect("serving API should succeed");
}

fn resolve_static_web_root(repo_root: &Path) -> Option<PathBuf> {
    if std::env::var("FULLMAG_DISABLE_STATIC_CONTROL_ROOM")
        .map(|value| value == "1")
        .unwrap_or(false)
    {
        return None;
    }

    let candidates = [
        std::env::var_os("FULLMAG_WEB_STATIC_DIR").map(PathBuf::from),
        Some(repo_root.join(".fullmag").join("local").join("web")),
        Some(repo_root.join("apps").join("web").join("out")),
    ];

    candidates
        .into_iter()
        .flatten()
        .find(|path| path.join("index.html").is_file())
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "fullmag-api",
    })
}

async fn vision() -> Json<VisionResponse> {
    Json(VisionResponse {
        north_star:
            "Describe one physical problem and execute it through FDM, FEM, or hybrid plans.",
        modes: ["strict", "extended", "hybrid"],
        runtime_spine: "current-live",
    })
}

async fn get_runtime_capabilities(
    State(state): State<Arc<AppState>>,
) -> Json<fullmag_runner::HostCapabilityMatrix> {
    let runtimes_dir = state.repo_root.join("runtimes");
    Json(fullmag_runner::RuntimeRegistry::discover(&runtimes_dir).capability_matrix())
}

async fn get_current_gpu_telemetry() -> Result<Json<GpuTelemetryResponse>, ApiError> {
    let output = tokio::task::spawn_blocking(sample_gpu_telemetry)
        .await
        .map_err(|error| {
            ApiError::internal(format!("gpu telemetry task join failed: {error}"))
        })??;
    Ok(Json(output))
}

fn sample_gpu_telemetry() -> Result<GpuTelemetryResponse, ApiError> {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=index,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .map_err(|error| ApiError::internal(format!("failed to launch nvidia-smi: {error}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if stderr.is_empty() {
            format!("nvidia-smi exited with status {}", output.status)
        } else {
            stderr
        };
        return Err(ApiError::internal(format!(
            "failed to sample GPU telemetry: {detail}"
        )));
    }

    let stdout = String::from_utf8(output.stdout).map_err(|error| {
        ApiError::internal(format!("nvidia-smi emitted invalid UTF-8: {error}"))
    })?;

    let mut devices = Vec::new();
    for line in stdout.lines().filter(|line| !line.trim().is_empty()) {
        let parts = line.split(',').map(|part| part.trim()).collect::<Vec<_>>();
        if parts.len() != 7 {
            return Err(ApiError::internal(format!(
                "unexpected nvidia-smi output shape: '{line}'"
            )));
        }
        devices.push(GpuTelemetryDevice {
            index: parts[0].parse().map_err(|error| {
                ApiError::internal(format!("failed to parse GPU index from '{line}': {error}"))
            })?,
            name: parts[1].to_string(),
            utilization_gpu_percent: parts[2].parse().map_err(|error| {
                ApiError::internal(format!(
                    "failed to parse GPU utilization from '{line}': {error}"
                ))
            })?,
            utilization_memory_percent: parts[3].parse().map_err(|error| {
                ApiError::internal(format!(
                    "failed to parse GPU memory utilization from '{line}': {error}"
                ))
            })?,
            memory_used_mb: parts[4].parse().map_err(|error| {
                ApiError::internal(format!(
                    "failed to parse GPU memory used from '{line}': {error}"
                ))
            })?,
            memory_total_mb: parts[5].parse().map_err(|error| {
                ApiError::internal(format!(
                    "failed to parse GPU memory total from '{line}': {error}"
                ))
            })?,
            temperature_c: parts[6].parse().ok(),
        });
    }

    Ok(GpuTelemetryResponse {
        sample_time_unix_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0),
        devices,
    })
}

async fn get_current_live_bootstrap(
    State(state): State<Arc<AppState>>,
) -> Result<Response, ApiError> {
    // If a live workspace exists, return its bootstrap payload.
    if let Some(snapshot) = state.current_live_public_snapshot.read().await.as_ref() {
        let json = bootstrap_workspace_payload(snapshot)?;
        return Ok(([(CONTENT_TYPE, "application/json")], json).into_response());
    }

    // No live workspace — auto-create a bootstrapping interactive workspace
    // so the control room can immediately transition out of the loading state.
    let json = auto_create_workspace(&state).await?;
    let payload = bootstrap_workspace_payload(&json)?;
    Ok(([(CONTENT_TYPE, "application/json")], payload).into_response())
}

/// Create an empty interactive workspace and publish it to the live state.
/// Returns the serialized public snapshot JSON.
async fn auto_create_workspace(state: &AppState) -> Result<String, ApiError> {
    let now = unix_time_millis_now();
    let session_id = format!("ui-session-{}-{}", now, std::process::id());
    let run_id = format!("run-{}", &session_id);
    let artifact_dir = state
        .repo_root
        .join(".fullmag")
        .join("local-live")
        .join("history")
        .join(&session_id)
        .join("artifacts");
    let _ = std::fs::create_dir_all(&artifact_dir);

    let publish_req = CurrentLivePublishRequest {
        session_id: session_id.clone(),
        session: Some(SessionManifest {
            session_id: session_id.clone(),
            run_id,
            status: "interactive".to_string(),
            interactive_session_requested: true,
            script_path: String::new(),
            problem_name: "New Simulation".to_string(),
            requested_backend: "auto".to_string(),
            explicit_selection: false,
            requested_device: "auto".to_string(),
            requested_precision: "double".to_string(),
            requested_mode: "strict".to_string(),
            execution_mode: "strict".to_string(),
            precision: "double".to_string(),
            resolved_backend: None,
            resolved_device: None,
            resolved_precision: None,
            resolved_mode: None,
            resolved_runtime_family: None,
            resolved_engine_id: None,
            resolved_worker: None,
            resolved_fallback: None,
            artifact_dir: artifact_dir.display().to_string(),
            started_at_unix_ms: now,
            finished_at_unix_ms: now,
            plan_summary: json!({}),
        }),
        session_status: None,
        metadata: None,
        mesh_workspace: None,
        run: None,
        live_state: None,
        latest_scalar_row: None,
        latest_fields: None,
        preview_fields: None,
        clear_preview_cache: false,
        engine_log: None,
        fem_mesh: None,
    };

    let next = default_current_live_state(&publish_req);
    let ws_messages = build_current_live_ws_messages(state, &next)?;
    let public_json = serialize_current_live_response(&next, true)?;
    *state.current_live_state.write().await = Some(next);
    *state.current_live_public_snapshot.write().await = Some(public_json.clone());
    send_current_live_ws_messages(state, ws_messages);
    Ok(public_json)
}

fn bootstrap_workspace_payload(snapshot_json: &str) -> Result<String, ApiError> {
    let value: Value = serde_json::from_str(snapshot_json).map_err(|error| {
        ApiError::internal(format!(
            "failed to parse workspace bootstrap snapshot: {error}"
        ))
    })?;
    let mut object = value
        .as_object()
        .cloned()
        .ok_or_else(|| ApiError::internal("workspace bootstrap snapshot must be a JSON object"))?;
    object.insert("mode".to_string(), Value::String("workspace".to_string()));
    serde_json::to_string(&Value::Object(object)).map_err(|error| {
        ApiError::internal(format!("failed to encode workspace bootstrap: {error}"))
    })
}

/// POST /v1/live/current/create — create a bootstrapping workspace in-process.
///
/// Called by the web UI when the user clicks "Create New Simulation" and no
/// live workspace exists yet (hub mode). Creates a minimal bootstrapping
/// `SessionStateResponse`, publishes it, and returns the bootstrap payload so
/// the client can immediately transition out of the loading state.
#[derive(Debug, Deserialize)]
struct CreateWorkspaceRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    backend: Option<String>,
}

async fn create_current_live_workspace(
    State(state): State<Arc<AppState>>,
    Json(_req): Json<CreateWorkspaceRequest>,
) -> Result<Response, ApiError> {
    // If a workspace already exists, just return its bootstrap payload.
    if let Some(snapshot) = state.current_live_public_snapshot.read().await.as_ref() {
        let json = bootstrap_workspace_payload(snapshot)?;
        return Ok(([(CONTENT_TYPE, "application/json")], json).into_response());
    }

    let json = auto_create_workspace(&state).await?;
    let payload = bootstrap_workspace_payload(&json)?;
    Ok(([(CONTENT_TYPE, "application/json")], payload).into_response())
}

async fn get_current_live_state(State(state): State<Arc<AppState>>) -> Result<Response, ApiError> {
    get_current_live_bootstrap(State(state)).await
}

async fn get_current_display_selection(
    State(state): State<Arc<AppState>>,
) -> Result<Json<CurrentDisplaySelection>, ApiError> {
    Ok(Json(state.current_display_selection.read().await.clone()))
}

async fn get_current_live_events(
    State(state): State<Arc<AppState>>,
) -> Result<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let mut rx = state.current_live_events.subscribe();
    let initial_snapshot = state
        .current_live_public_snapshot
        .read()
        .await
        .as_ref()
        .cloned();
    let stream = stream! {
        if let Some(json) = initial_snapshot {
            yield Ok(Event::default().event("session_state").data(json));
        }

        loop {
            match rx.recv().await {
                Ok(_) => {
                    let current_json = state
                        .current_live_public_snapshot
                        .read()
                        .await
                        .as_ref()
                        .cloned();
                    if let Some(json) = current_json {
                        yield Ok(Event::default().event("session_state").data(json));
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

fn is_preview_control_command(command: &SessionCommand) -> bool {
    matches!(
        command.kind.as_str(),
        "display_selection_update" | "preview_update" | "preview_refresh"
    )
}

async fn enqueue_current_control_command(
    state: &Arc<AppState>,
    mut command: SessionCommand,
) -> SessionCommand {
    let seq = {
        let mut next_seq = state.current_control_next_seq.lock().await;
        *next_seq = next_seq.saturating_add(1);
        *next_seq
    };
    command.seq = seq;
    state
        .current_control_queue
        .lock()
        .await
        .push_back(command.clone());
    let _ = state.current_control_events.send(seq);
    command
}

async fn take_next_current_control_command_after(
    state: &Arc<AppState>,
    after_seq: u64,
    include_preview: bool,
) -> Option<SessionCommand> {
    let mut queue = state.current_control_queue.lock().await;
    let mut index = 0usize;
    while index < queue.len() {
        let Some(command) = queue.get(index) else {
            break;
        };
        if command.seq <= after_seq {
            let _ = queue.remove(index);
            continue;
        }
        if !include_preview && is_preview_control_command(command) {
            index += 1;
            continue;
        }
        return queue.remove(index);
    }
    None
}

fn build_preview_control_command(
    display_selection: &CurrentDisplaySelection,
    refresh_only: bool,
) -> SessionCommand {
    let preview_config = display_selection.preview_request();
    SessionCommand {
        seq: 0,
        command_id: format!(
            "cmd-{}",
            if refresh_only {
                format!("preview-refresh-{}", uuid_v4_hex())
            } else {
                format!("display-selection-{}", uuid_v4_hex())
            }
        ),
        kind: if refresh_only {
            "preview_refresh".to_string()
        } else {
            "display_selection_update".to_string()
        },
        created_at_unix_ms: unix_time_millis_now(),
        until_seconds: None,
        max_steps: None,
        torque_tolerance: None,
        energy_tolerance: None,
        integrator: None,
        fixed_timestep: None,
        relax_algorithm: None,
        relax_alpha: None,
        mesh_options: None,
        mesh_target: None,
        mesh_reason: None,
        state_path: None,
        state_format: None,
        state_dataset: None,
        state_sample_index: None,
        display_selection: Some(display_selection.clone()),
        preview_config: Some(preview_config),
    }
}

fn canonicalize_display_selection(selection: &mut DisplaySelection) -> Result<(), ApiError> {
    selection.kind = DisplaySelection::kind_for_quantity(&selection.quantity);
    if selection.component.trim().is_empty()
        && !matches!(selection.kind, fullmag_runner::DisplayKind::GlobalScalar)
    {
        selection.component = "3D".to_string();
    }
    Ok(())
}

async fn publish_current_live_state(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CurrentLivePublishRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let has_live_state_update = req.live_state.is_some();
    let has_scalar_row_update = req.latest_scalar_row.is_some();
    let has_latest_fields_update = req.latest_fields.is_some();
    let allow_previous_preview_fallback = !req.clear_preview_cache;
    let reset_preview = state
        .current_live_state
        .read()
        .await
        .as_ref()
        .map(|existing| existing.session.session_id != req.session_id)
        .unwrap_or(false);
    if reset_preview {
        let display_selection = CurrentDisplaySelection::default();
        *state.current_display_selection.write().await = display_selection.clone();
        state.current_control_queue.lock().await.clear();
        *state.current_control_next_seq.lock().await = 0;
        let _ = state.current_control_events.send(0);
        let _ = std::fs::remove_dir_all(&state.current_workspace_root);
    }
    let display_selection = state.current_display_selection.read().await.clone();
    let selected_cached_preview_updated = req
        .preview_fields
        .as_ref()
        .is_some_and(|fields| cached_preview_update_matches_selection(fields, &display_selection));
    let has_cached_preview_update = req.clear_preview_cache || selected_cached_preview_updated;
    let preview_config = display_selection.preview_request();
    let mut current = state.current_live_state.write().await;
    let mut next = match current.take() {
        Some(existing) if existing.session.session_id == req.session_id => existing,
        _ => default_current_live_state(&req),
    };
    let previous_preview = next.preview.clone();
    apply_current_live_publish(&mut next, req)?;
    next.display_selection = display_selection.clone();
    next.preview_config = preview_config.clone();
    if next.scene_document.is_none() && !next.session.script_path.trim().is_empty() {
        match load_scene_document_state(
            &state.repo_root,
            &state.current_workspace_root,
            Path::new(next.session.script_path.trim()),
        ) {
            Ok(scene_document) => {
                next.builder_adapter = scene_document_builder_projection(&scene_document).ok();
                next.scene_document = Some(scene_document);
            }
            Err(e) => {
                eprintln!(
                    "[fullmag-api] failed to load scene document for '{}': {:?}",
                    next.session.script_path.trim(),
                    e
                );
            }
        }
    }
    let has_fresh_preview = live_state_has_fresh_preview(next.live_state.as_ref());
    let should_rebuild_preview = has_fresh_preview
        || has_latest_fields_update
        || has_cached_preview_update
        || (matches!(
            next.display_selection.selection.kind,
            fullmag_runner::DisplayKind::GlobalScalar
        ) && (has_live_state_update || has_scalar_row_update));
    next.preview = if should_rebuild_preview {
        let rebuilt = build_preview_state(&next, &next.display_selection, &preview_config);
        if allow_previous_preview_fallback {
            rebuilt.or(previous_preview)
        } else {
            rebuilt
        }
    } else {
        previous_preview
    };
    let session_state_messages = build_current_live_ws_messages(&state, &next)?;
    let public_json = serialize_current_live_response(&next, true)?;
    *current = Some(next);
    drop(current);
    *state.current_live_public_snapshot.write().await = Some(public_json);

    send_current_live_ws_messages(&state, session_state_messages);
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn set_current_preview_quantity(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreviewQuantityRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Update, move |config| {
        config.quantity = req.quantity;
    })
    .await
}

async fn set_current_preview_selection(
    State(state): State<Arc<AppState>>,
    Json(selection): Json<DisplaySelection>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Update, move |current| {
        *current = selection;
    })
    .await
}

async fn set_current_preview_component(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreviewComponentRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Update, move |config| {
        config.component = req.component;
    })
    .await
}

async fn set_current_preview_x_chosen_size(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreviewXChosenSizeRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Update, move |config| {
        config.x_chosen_size = req.x_chosen_size as u32;
    })
    .await
}

async fn set_current_preview_every_n(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreviewEveryNRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Update, move |config| {
        config.every_n = req.every_n.clamp(1, u32::MAX as usize) as u32;
    })
    .await
}

async fn set_current_preview_y_chosen_size(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreviewYChosenSizeRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Update, move |config| {
        config.y_chosen_size = req.y_chosen_size as u32;
    })
    .await
}

async fn set_current_preview_auto_scale(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreviewAutoScaleRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Update, move |config| {
        config.auto_scale_enabled = req.auto_scale_enabled;
    })
    .await
}

async fn set_current_preview_max_points(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreviewMaxPointsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Update, move |config| {
        config.max_points = req.max_points.min(u32::MAX as usize) as u32;
    })
    .await
}

async fn set_current_preview_layer(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreviewLayerRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Update, move |config| {
        config.layer = req.layer as u32;
    })
    .await
}

async fn set_current_preview_all_layers(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PreviewAllLayersRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Update, move |config| {
        config.all_layers = req.all_layers;
    })
    .await
}

async fn refresh_current_preview(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    mutate_current_preview(&state, PreviewControlMode::Refresh, |_config| {}).await
}

async fn enqueue_current_live_command(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SessionCommandRequest>,
) -> Result<Json<SessionCommandResponse>, ApiError> {
    let session_id = current_live_session_id(&state).await?;
    let command = enqueue_current_control_command(&state, build_session_command(req)?).await;
    eprintln!(
        "[fullmag-api] RX <- frontend command {} seq={} id={}",
        command.kind, command.seq, command.command_id
    );
    if let Some(mesh_options) = command.mesh_options.as_ref() {
        eprintln!("[fullmag-api]    mesh_options: {}", mesh_options);
    }
    if let Some(mesh_target) = command.mesh_target.as_ref() {
        eprintln!("[fullmag-api]    mesh_target: {:?}", mesh_target);
    }
    if let Some(mesh_reason) = command.mesh_reason.as_ref() {
        eprintln!("[fullmag-api]    mesh_reason: {}", mesh_reason);
    }
    let ack_json = serialize_runtime_event(&build_command_ack_event(&session_id, &command))?;
    let _ = state
        .current_live_events
        .send(CurrentLiveWireMessage::Text(ack_json));
    eprintln!(
        "[fullmag-api] TX -> frontend ack {} seq={} id={}",
        command.kind, command.seq, command.command_id
    );
    let response = SessionCommandResponse {
        command_id: command.command_id.clone(),
        session_id,
        seq: command.seq,
        kind: command.kind.clone(),
        queued_path: format!("memory://current/{}", command.command_id),
    };
    Ok(Json(response))
}

async fn dequeue_current_live_command(
    State(state): State<Arc<AppState>>,
) -> Result<Response, ApiError> {
    let command = take_next_current_control_command_after(&state, 0, false).await;
    match command {
        Some(command) => Ok(Json(command).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

async fn wait_current_live_control(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ControlWaitQuery>,
) -> Result<Response, ApiError> {
    let _ = current_live_session_id(&state).await?;
    if let Some(command) =
        take_next_current_control_command_after(&state, query.after_seq, true).await
    {
        return Ok(Json(command).into_response());
    }

    let timeout_ms = query.timeout_ms.clamp(100, 20_000);
    let mut rx = state.current_control_events.subscribe();
    let state_for_wait = Arc::clone(&state);
    let waited = tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), async move {
        loop {
            rx.changed()
                .await
                .map_err(|_| ApiError::internal("control command stream closed"))?;
            if let Some(command) =
                take_next_current_control_command_after(&state_for_wait, query.after_seq, true)
                    .await
            {
                return Ok::<SessionCommand, ApiError>(command);
            }
        }
    })
    .await;

    match waited {
        Ok(Ok(command)) => Ok(Json(command).into_response()),
        Ok(Err(error)) => Err(error),
        Err(_) => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

async fn import_current_live_asset(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImportSessionAssetRequest>,
) -> Result<Json<SessionAssetImportResponse>, ApiError> {
    let response = import_asset_for_current_workspace(&state, req).await?;
    Ok(Json(response))
}

async fn export_current_live_state(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ExportMagnetizationStateRequest>,
) -> Result<Json<ExportMagnetizationStateResponse>, ApiError> {
    let response = export_magnetization_state_for_current_workspace(&state, req).await?;
    Ok(Json(response))
}

async fn import_current_live_state(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImportMagnetizationStateRequest>,
) -> Result<Json<ImportMagnetizationStateResponse>, ApiError> {
    let response = import_magnetization_state_for_current_workspace(&state, req).await?;
    Ok(Json(response))
}

async fn list_current_live_artifacts(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ArtifactEntry>>, ApiError> {
    let current = state.current_live_state.read().await;
    let snapshot = current
        .as_ref()
        .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
    let artifact_dir = current_artifact_dir(snapshot);
    drop(current);
    Ok(Json(read_artifacts_from_dir(artifact_dir.as_deref())?))
}

async fn read_current_live_artifact(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ArtifactFileQuery>,
) -> Result<Response, ApiError> {
    let current = state.current_live_state.read().await;
    let snapshot = current
        .as_ref()
        .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
    let artifact_dir = current_artifact_dir(snapshot)
        .ok_or_else(|| ApiError::not_found("no artifact directory for the active workspace"))?;
    drop(current);

    let relative = sanitize_artifact_relative_path(&query.path)?;
    let artifact_path = artifact_dir.join(&relative);
    if !artifact_path.exists() || !artifact_path.is_file() {
        return Err(ApiError::not_found(format!(
            "artifact '{}' was not found",
            query.path
        )));
    }

    let content_type = match artifact_path.extension().and_then(|ext| ext.to_str()) {
        Some("json") => "application/json; charset=utf-8",
        Some("csv") => "text/csv; charset=utf-8",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    let bytes = std::fs::read(&artifact_path)
        .map_err(|error| ApiError::internal(format!("failed to read artifact: {}", error)))?;
    Ok(([(CONTENT_TYPE, content_type)], bytes).into_response())
}

async fn get_current_live_eigen_spectrum(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let artifact_dir = require_current_live_artifact_dir(&state).await?;
    for candidate in ["eigen/spectrum.json", "eigen/metadata/eigen_summary.json"] {
        if try_resolve_artifact_path(&artifact_dir, candidate)?.is_some() {
            return Ok(Json(read_json_artifact_value(&artifact_dir, candidate)?));
        }
    }
    Err(ApiError::not_found(
        "no eigen spectrum artifact found in the active workspace",
    ))
}

async fn get_current_live_eigen_mode(
    State(state): State<Arc<AppState>>,
    Query(query): Query<EigenModeQuery>,
) -> Result<Json<Value>, ApiError> {
    let artifact_dir = require_current_live_artifact_dir(&state).await?;
    let relative_path = format!("eigen/modes/mode_{:04}.json", query.index);
    Ok(Json(read_json_artifact_value(
        &artifact_dir,
        &relative_path,
    )?))
}

async fn get_current_live_eigen_dispersion(
    State(state): State<Arc<AppState>>,
) -> Result<Json<EigenDispersionResponse>, ApiError> {
    let artifact_dir = require_current_live_artifact_dir(&state).await?;
    let csv_path = "eigen/dispersion/branch_table.csv";
    let csv_content = read_text_artifact_value(&artifact_dir, csv_path)?;
    let path_metadata =
        if try_resolve_artifact_path(&artifact_dir, "eigen/dispersion/path.json")?.is_some() {
            Some(read_json_artifact_value(
                &artifact_dir,
                "eigen/dispersion/path.json",
            )?)
        } else {
            None
        };
    Ok(Json(EigenDispersionResponse {
        csv_path: csv_path.to_string(),
        path_metadata,
        rows: parse_eigen_dispersion_csv(&csv_content)?,
    }))
}

/// POST /v1/run — start a simulation run and broadcast live updates.
async fn start_run(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RunRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let output_dir = PathBuf::from(&req.output_dir);
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| ApiError::internal(format!("failed to create output dir: {}", e)))?;

    let run_id = format!("run-{}", uuid_v4_hex());
    let (tx, _) = broadcast::channel::<StepUpdate>(256);
    {
        let mut channels = state.live_channels.write().await;
        channels.insert(run_id.clone(), tx.clone());
    }

    let problem = req.problem;
    let until = req.until_seconds;
    let channels = state.live_channels.clone();
    let rid = run_id.clone();

    // Spawn runner in a blocking task (runner is synchronous)
    tokio::task::spawn_blocking(move || {
        let result = fullmag_runner::run_problem_with_callback(
            &problem,
            until,
            &output_dir,
            10, // send magnetization every 10 steps
            |update| {
                let _ = tx.send(update);
                fullmag_runner::StepAction::Continue
            },
        );
        match result {
            Ok(_) => info!(run_id = %rid, "run completed successfully"),
            Err(e) => tracing::error!(run_id = %rid, "run failed: {}", e),
        }
        // Dropping tx closes the broadcast channel; subscribers will see Closed.
        drop(tx);
        // Schedule cleanup of the channel registry entry.
        let handle = tokio::runtime::Handle::current();
        handle.spawn(async move {
            channels.write().await.remove(&rid);
        });
    });

    Ok(Json(serde_json::json!({
        "status": "started",
        "run_id": run_id,
        "message": format!("simulation started, connect to /ws/live/{} for updates", run_id)
    })))
}

/// GET /ws/live/:run_id — WebSocket endpoint for live step updates.
async fn ws_live(
    State(state): State<Arc<AppState>>,
    AxumPath(run_id): AxumPath<String>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, ApiError> {
    let channels = state.live_channels.read().await;
    let tx = channels
        .get(&run_id)
        .cloned()
        .ok_or_else(|| ApiError::not_found(format!("no active run with id '{}'", run_id)))?;
    drop(channels);
    Ok(ws.on_upgrade(move |socket| handle_ws(socket, tx)))
}

async fn ws_current_live(
    State(state): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, ApiError> {
    Ok(ws.on_upgrade(move |socket| handle_current_live_ws(socket, state)))
}

async fn handle_ws(mut socket: WebSocket, tx: broadcast::Sender<StepUpdate>) {
    let mut rx = tx.subscribe();

    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(update) => {
                        let json = match serde_json::to_string(&update) {
                            Ok(j) => j,
                            Err(_) => continue,
                        };
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break; // client disconnected
                        }
                        if update.finished {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("ws client lagged {n} messages");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            // Check for client disconnect
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

async fn handle_current_live_ws(mut socket: WebSocket, state: Arc<AppState>) {
    let initial_snapshot = {
        let current = state.current_live_state.read().await;
        current
            .as_ref()
            .map(|snapshot| build_current_live_ws_messages(&state, snapshot))
            .transpose()
    };
    match initial_snapshot {
        Ok(Some(messages)) => {
            for message in messages {
                let outbound = match message {
                    CurrentLiveWireMessage::Text(text) => Message::Text(text.into()),
                    CurrentLiveWireMessage::Binary(bytes) => Message::Binary(bytes.into()),
                };
                if socket.send(outbound).await.is_err() {
                    return;
                }
            }
        }
        Ok(None) => {}
        Err(error) => {
            tracing::warn!(
                "failed to serialize initial current-live session_state: {:?}",
                error
            );
            return;
        }
    }

    let mut rx = state.current_live_events.subscribe();
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(message) => {
                        let outbound = match message {
                            CurrentLiveWireMessage::Text(text) => Message::Text(text.into()),
                            CurrentLiveWireMessage::Binary(bytes) => Message::Binary(bytes.into()),
                        };
                        if socket.send(outbound).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

fn build_session_command(req: SessionCommandRequest) -> Result<SessionCommand, ApiError> {
    let kind = req.kind.trim().to_lowercase();
    if !matches!(
        kind.as_str(),
        "run"
            | "relax"
            | "close"
            | "stop"
            | "break"
            | "pause"
            | "resume"
            | "remesh"
            | "solve"
            | "compute"
            | "load_state"
    ) {
        return Err(ApiError::bad_request(format!(
            "unsupported command kind '{}'",
            req.kind
        )));
    }
    if kind == "run" && req.until_seconds.unwrap_or(0.0) <= 0.0 {
        return Err(ApiError::bad_request(
            "run command requires positive until_seconds",
        ));
    }
    if kind == "relax" && req.max_steps.unwrap_or(0) == 0 {
        return Err(ApiError::bad_request(
            "relax command requires positive max_steps",
        ));
    }
    if kind == "load_state"
        && req
            .state_path
            .as_ref()
            .map(|path| path.trim().is_empty())
            .unwrap_or(true)
    {
        return Err(ApiError::bad_request(
            "load_state command requires state_path",
        ));
    }
    if kind == "remesh" && req.mesh_target.is_none() {
        return Err(ApiError::bad_request("remesh command requires mesh_target"));
    }
    if kind != "remesh" && req.mesh_target.is_some() {
        return Err(ApiError::bad_request(
            "mesh_target is supported only for remesh commands",
        ));
    }
    if kind != "remesh" && req.mesh_reason.is_some() {
        return Err(ApiError::bad_request(
            "mesh_reason is supported only for remesh commands",
        ));
    }

    Ok(SessionCommand {
        seq: 0,
        command_id: format!("cmd-{}", uuid_v4_hex()),
        kind,
        created_at_unix_ms: unix_time_millis_now(),
        until_seconds: req.until_seconds,
        max_steps: req.max_steps,
        torque_tolerance: req.torque_tolerance,
        energy_tolerance: req.energy_tolerance,
        integrator: req.integrator,
        fixed_timestep: req.fixed_timestep,
        relax_algorithm: req.relax_algorithm,
        relax_alpha: req.relax_alpha,
        mesh_options: req.mesh_options,
        mesh_target: req.mesh_target,
        mesh_reason: req.mesh_reason,
        state_path: req.state_path,
        state_format: req.state_format,
        state_dataset: req.state_dataset,
        state_sample_index: req.state_sample_index,
        display_selection: None,
        preview_config: None,
    })
}

async fn import_asset_for_current_workspace(
    state: &Arc<AppState>,
    req: ImportSessionAssetRequest,
) -> Result<SessionAssetImportResponse, ApiError> {
    let (session_id, imports_dir) = {
        let current = state.current_live_state.read().await;
        let snapshot = current
            .as_ref()
            .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
        let session_id = snapshot.session.session_id.clone();
        let artifact_dir = current_artifact_dir(snapshot)
            .unwrap_or_else(|| state.current_workspace_root.join("artifacts"));
        (session_id, artifact_dir.join("imports"))
    };

    let response = import_asset_into_dir(state, &session_id, imports_dir.clone(), req)?;
    let artifacts = read_artifacts_from_dir(imports_dir.parent())?;
    let (messages, public_json) = {
        let mut current = state.current_live_state.write().await;
        let snapshot = current
            .as_mut()
            .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
        snapshot.artifacts = artifacts;
        let messages = build_current_live_ws_messages(&state, snapshot)?;
        let public_json = serialize_current_live_response(snapshot, true)?;
        (messages, public_json)
    };
    *state.current_live_public_snapshot.write().await = Some(public_json);
    send_current_live_ws_messages(&state, messages);
    Ok(response)
}

fn import_asset_into_dir(
    state: &AppState,
    session_id: &str,
    imports_dir: PathBuf,
    req: ImportSessionAssetRequest,
) -> Result<SessionAssetImportResponse, ApiError> {
    let safe_file_name = sanitize_file_name(&req.file_name);
    if safe_file_name.is_empty() {
        return Err(ApiError::bad_request("file_name must not be empty"));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&req.content_base64)
        .map_err(|error| ApiError::bad_request(format!("invalid base64 payload: {}", error)))?;

    std::fs::create_dir_all(&imports_dir)?;

    let asset_id = format!("asset-{}", uuid_v4_hex());
    let stored_name = format!("{}-{}", asset_id, safe_file_name);
    let stored_path = imports_dir.join(&stored_name);
    std::fs::write(&stored_path, &bytes)?;

    let summary = summarize_uploaded_asset(&safe_file_name, &bytes)?;
    let response = SessionAssetImportResponse {
        asset_id: asset_id.clone(),
        session_id: session_id.to_string(),
        stored_path: make_repo_relative(&state.repo_root, &stored_path),
        target_realization: req.target_realization,
        summary,
    };

    let manifest_path = imports_dir.join(format!("{}.asset.json", asset_id));
    let manifest_text = serde_json::to_string_pretty(&response).map_err(|error| {
        ApiError::internal(format!("failed to serialize asset manifest: {}", error))
    })?;
    std::fs::write(manifest_path, manifest_text)?;

    Ok(response)
}

#[derive(Debug, Deserialize)]
struct ReadMagnetizationStateHelperResponse {
    format: String,
    dataset: Option<String>,
    sample_index: Option<i64>,
    vector_count: usize,
    values: Vec<[f64; 3]>,
}

fn normalize_magnetization_state_format(
    requested: Option<&str>,
    file_name: Option<&str>,
) -> Result<String, ApiError> {
    let normalized = requested
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    if let Some(value) = normalized {
        return match value.as_str() {
            "json" => Ok("json".to_string()),
            "zarr" => Ok("zarr".to_string()),
            "h5" | "hdf5" => Ok("h5".to_string()),
            _ => Err(ApiError::bad_request(format!(
                "unsupported magnetization state format '{}'",
                value
            ))),
        };
    }

    let lower = file_name.unwrap_or_default().to_lowercase();
    if lower.ends_with(".zarr.zip") || lower.ends_with(".zarr") {
        return Ok("zarr".to_string());
    }
    if lower.ends_with(".h5") || lower.ends_with(".hdf5") {
        return Ok("h5".to_string());
    }
    Ok("json".to_string())
}

fn preferred_magnetization_state_suffix(format: &str) -> &'static str {
    match format {
        "json" => ".json",
        "zarr" => ".zarr.zip",
        "h5" => ".h5",
        _ => ".json",
    }
}

fn ensure_magnetization_state_file_name(file_name: &str, format: &str) -> String {
    let safe = sanitize_file_name(file_name);
    if safe.is_empty() {
        return default_magnetization_state_file_name(format);
    }
    let lower = safe.to_lowercase();
    if format == "zarr" && lower.ends_with(".zarr") {
        return format!("{safe}.zip");
    }
    if format == "h5" && (lower.ends_with(".h5") || lower.ends_with(".hdf5")) {
        return safe;
    }
    if lower.ends_with(preferred_magnetization_state_suffix(format)) {
        return safe;
    }
    format!("{safe}{}", preferred_magnetization_state_suffix(format))
}

fn default_magnetization_state_file_name(format: &str) -> String {
    let timestamp = unix_time_millis_now();
    format!(
        "m_state_{}{}",
        timestamp,
        preferred_magnetization_state_suffix(format)
    )
}

fn magnetization_state_json_payload(values: &[[f64; 3]]) -> Vec<u8> {
    serde_json::to_vec_pretty(&serde_json::json!({
        "kind": "magnetization_state",
        "observable": "m",
        "format": "json",
        "vector_count": values.len(),
        "values": values,
    }))
    .expect("magnetization state JSON encoding should succeed")
}

fn flat_magnetization_to_vectors(values: &[f64]) -> Result<Vec<[f64; 3]>, ApiError> {
    if values.len() % 3 != 0 {
        return Err(ApiError::internal(format!(
            "expected flat magnetization length divisible by 3, got {}",
            values.len()
        )));
    }
    Ok(values
        .chunks_exact(3)
        .map(|chunk| [chunk[0], chunk[1], chunk[2]])
        .collect())
}

fn current_workspace_magnetization_source(
    snapshot: &SessionStateResponse,
    artifact_dir: &Path,
    repo_root: &Path,
) -> Result<Vec<[f64; 3]>, ApiError> {
    if let Some(live_state) = snapshot.live_state.as_ref() {
        if let Some(values) = live_state.latest_step.magnetization.as_ref() {
            return flat_magnetization_to_vectors(values);
        }
    }

    for candidate in ["m_final.json", "m_initial.json"] {
        let path = artifact_dir.join(candidate);
        if path.is_file() {
            return read_magnetization_state_with_python(repo_root, &path, None, None, None)
                .map(|loaded| loaded.values);
        }
    }

    Err(ApiError::not_found(
        "no current magnetization state is available yet for export",
    ))
}

async fn export_magnetization_state_for_current_workspace(
    state: &Arc<AppState>,
    req: ExportMagnetizationStateRequest,
) -> Result<ExportMagnetizationStateResponse, ApiError> {
    let (artifact_dir, vectors) = {
        let current = state.current_live_state.read().await;
        let snapshot = current
            .as_ref()
            .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
        let artifact_dir = current_artifact_dir(snapshot)
            .unwrap_or_else(|| state.current_workspace_root.join("artifacts"));
        let vectors =
            current_workspace_magnetization_source(snapshot, &artifact_dir, &state.repo_root)?;
        (artifact_dir, vectors)
    };

    let format =
        normalize_magnetization_state_format(req.format.as_deref(), req.file_name.as_deref())?;
    let file_name = req
        .file_name
        .as_deref()
        .map(|value| ensure_magnetization_state_file_name(value, &format))
        .unwrap_or_else(|| default_magnetization_state_file_name(&format));
    let exports_dir = artifact_dir.join("exports");
    let export_path = exports_dir.join(&file_name);
    std::fs::create_dir_all(&exports_dir)?;

    if format == "json" {
        std::fs::write(&export_path, magnetization_state_json_payload(&vectors))?;
    } else {
        let temp_source_path = exports_dir.join(format!(".state-export-{}.json", uuid_v4_hex()));
        std::fs::write(
            &temp_source_path,
            magnetization_state_json_payload(&vectors),
        )?;
        let convert_result = convert_magnetization_state_with_python(
            &state.repo_root,
            &temp_source_path,
            &export_path,
            Some("json"),
            Some(&format),
            None,
            req.dataset.as_deref(),
            None,
        );
        let _ = std::fs::remove_file(&temp_source_path);
        convert_result?;
    }

    let content_base64 =
        base64::engine::general_purpose::STANDARD.encode(std::fs::read(&export_path)?);
    let vector_count = vectors.len();
    let artifacts = read_artifacts_from_dir(Some(&artifact_dir))?;
    let (messages, public_json) = {
        let mut current = state.current_live_state.write().await;
        let snapshot = current
            .as_mut()
            .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
        snapshot.artifacts = artifacts;
        let messages = build_current_live_ws_messages(&state, snapshot)?;
        let public_json = serialize_current_live_response(snapshot, true)?;
        (messages, public_json)
    };
    *state.current_live_public_snapshot.write().await = Some(public_json);
    send_current_live_ws_messages(&state, messages);

    Ok(ExportMagnetizationStateResponse {
        file_name,
        format,
        stored_path: make_repo_relative(&state.repo_root, &export_path),
        vector_count,
        content_base64,
    })
}

async fn import_magnetization_state_for_current_workspace(
    state: &Arc<AppState>,
    req: ImportMagnetizationStateRequest,
) -> Result<ImportMagnetizationStateResponse, ApiError> {
    let format = normalize_magnetization_state_format(req.format.as_deref(), Some(&req.file_name))?;
    let file_name = ensure_magnetization_state_file_name(&req.file_name, &format);
    let (session_id, imports_dir, session_status) = {
        let current = state.current_live_state.read().await;
        let snapshot = current
            .as_ref()
            .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
        let session_id = snapshot.session.session_id.clone();
        let artifact_dir = current_artifact_dir(snapshot)
            .unwrap_or_else(|| state.current_workspace_root.join("artifacts"));
        (
            session_id,
            artifact_dir.join("imports"),
            snapshot.session.status.clone(),
        )
    };

    if req.apply_to_workspace
        && !matches!(
            session_status.as_str(),
            "awaiting_command" | "waiting_for_compute"
        )
    {
        return Err(ApiError::bad_request(
            "workspace state import can only be applied while awaiting_command or waiting_for_compute",
        ));
    }

    let imported = import_asset_into_dir(
        state,
        &session_id,
        imports_dir.clone(),
        ImportSessionAssetRequest {
            file_name: file_name.clone(),
            content_base64: req.content_base64.clone(),
            target_realization: "magnetization_state".to_string(),
        },
    )?;
    let stored_abs_path = state.repo_root.join(&imported.stored_path);
    let loaded = read_magnetization_state_with_python(
        &state.repo_root,
        &stored_abs_path,
        Some(&format),
        req.dataset.as_deref(),
        req.sample_index,
    )?;
    let command = if req.apply_to_workspace {
        Some(
            enqueue_current_control_command(
                state,
                SessionCommand {
                    seq: 0,
                    command_id: format!("cmd-{}", uuid_v4_hex()),
                    kind: "load_state".to_string(),
                    created_at_unix_ms: unix_time_millis_now(),
                    until_seconds: None,
                    max_steps: None,
                    torque_tolerance: None,
                    energy_tolerance: None,
                    integrator: None,
                    fixed_timestep: None,
                    relax_algorithm: None,
                    relax_alpha: None,
                    mesh_options: None,
                    mesh_target: None,
                    mesh_reason: None,
                    state_path: Some(stored_abs_path.display().to_string()),
                    state_format: Some(loaded.format.clone()),
                    state_dataset: loaded.dataset.clone(),
                    state_sample_index: req.sample_index.or(loaded.sample_index),
                    display_selection: None,
                    preview_config: None,
                },
            )
            .await,
        )
    } else {
        None
    };

    let artifacts = read_artifacts_from_dir(imports_dir.parent())?;
    let (messages, public_json) = {
        let mut current = state.current_live_state.write().await;
        let snapshot = current
            .as_mut()
            .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
        snapshot.artifacts = artifacts;
        if req.attach_to_script_builder {
            if snapshot.scene_document.is_none() && !snapshot.session.script_path.trim().is_empty()
            {
                let scene_document = load_scene_document_state(
                    &state.repo_root,
                    &state.current_workspace_root,
                    Path::new(snapshot.session.script_path.trim()),
                )?;
                snapshot.builder_adapter = scene_document_builder_projection(&scene_document).ok();
                snapshot.scene_document = Some(scene_document);
            }
            if let Some(scene_document) = snapshot.scene_document.as_mut() {
                scene_document.study.initial_state = Some(ScriptBuilderInitialState {
                    magnet_name: None,
                    source_path: stored_abs_path.display().to_string(),
                    format: loaded.format.clone(),
                    dataset: loaded.dataset.clone(),
                    sample_index: req.sample_index.or(loaded.sample_index),
                });
                scene_document.revision = scene_document.revision.saturating_add(1);
                snapshot.builder_adapter = scene_document_builder_projection(scene_document).ok();
            }
        }
        let messages = build_current_live_ws_messages(&state, snapshot)?;
        let public_json = serialize_current_live_response(snapshot, true)?;
        (messages, public_json)
    };
    *state.current_live_public_snapshot.write().await = Some(public_json);
    send_current_live_ws_messages(&state, messages);

    if let Some(command) = command {
        let _ = command;
    }

    Ok(ImportMagnetizationStateResponse {
        asset_id: imported.asset_id,
        session_id,
        stored_path: imported.stored_path,
        file_name,
        format: loaded.format,
        vector_count: loaded.vector_count,
        applied_to_workspace: req.apply_to_workspace,
        attached_to_script_builder: req.attach_to_script_builder,
    })
}

async fn sync_current_live_script(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ScriptSyncRequest>,
) -> Result<Json<ScriptSyncResponse>, ApiError> {
    let (script_path, scene_document) = {
        let current = state.current_live_state.read().await;
        let snapshot = current
            .as_ref()
            .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
        let script_path = snapshot.session.script_path.trim();
        if script_path.is_empty() {
            return Err(ApiError::bad_request(
                "active local live workspace does not expose a script path",
            ));
        }
        (PathBuf::from(script_path), snapshot.scene_document.clone())
    };

    if !script_path.is_file() {
        return Err(ApiError::bad_request(format!(
            "script path does not exist: {}",
            script_path.display()
        )));
    }

    let overrides = if let Some(overrides) = req.overrides.clone() {
        Some(overrides)
    } else if let Some(scene_document) = scene_document.as_ref() {
        Some(scene_document_overrides(scene_document)?)
    } else {
        None
    };
    eprintln!(
        "[fullmag-api] RX <- frontend script sync {}",
        script_path.display()
    );
    let response = rewrite_script_via_python_helper(
        &state.repo_root,
        &state.current_workspace_root,
        &script_path,
        overrides.as_ref(),
    )?;
    eprintln!(
        "[fullmag-api] TX -> frontend script sync ok {}",
        response.script_path
    );
    Ok(Json(response))
}

async fn update_current_live_scene(
    State(state): State<Arc<AppState>>,
    Json(mut scene_document): Json<SceneDocument>,
) -> Result<Json<SceneDocument>, ApiError> {
    eprintln!(
        "[fullmag-api] RX <- frontend scene update revision={} version={}",
        scene_document.revision, scene_document.version
    );
    let (scene_document, session_state_messages, public_json) = {
        let mut current = state.current_live_state.write().await;
        let snapshot = current
            .as_mut()
            .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
        if snapshot.scene_document.is_none() && !snapshot.session.script_path.trim().is_empty() {
            let current_scene = load_scene_document_state(
                &state.repo_root,
                &state.current_workspace_root,
                Path::new(snapshot.session.script_path.trim()),
            )?;
            snapshot.builder_adapter = scene_document_builder_projection(&current_scene).ok();
            snapshot.scene_document = Some(current_scene);
        }
        let next_revision = snapshot
            .scene_document
            .as_ref()
            .map(|current_scene| current_scene.revision.saturating_add(1))
            .unwrap_or_else(|| scene_document.revision.saturating_add(1));
        scene_document.version = "scene.v1".to_string();
        scene_document.revision = next_revision;
        let builder_state = scene_document_builder_projection(&scene_document)?;
        snapshot.builder_adapter = Some(builder_state);
        snapshot.scene_document = Some(scene_document.clone());
        let session_state_messages = build_current_live_ws_messages(&state, snapshot)?;
        let public_json = serialize_current_live_response(snapshot, true)?;
        (scene_document, session_state_messages, public_json)
    };

    *state.current_live_public_snapshot.write().await = Some(public_json);
    send_current_live_ws_messages(&state, session_state_messages);
    eprintln!(
        "[fullmag-api] TX -> frontend scene update committed revision={}",
        scene_document.revision
    );
    Ok(Json(scene_document))
}

async fn list_physics_docs(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<String>>, ApiError> {
    let physics_dir = state.repo_root.join("docs/physics");
    let mut docs = Vec::new();
    for entry in std::fs::read_dir(&physics_dir)
        .map_err(|_| ApiError::not_found(format!("missing {}", physics_dir.display())))?
    {
        let entry = entry.map_err(ApiError::from)?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
            docs.push(
                path.strip_prefix(&state.repo_root)
                    .unwrap_or(&path)
                    .display()
                    .to_string(),
            );
        }
    }
    docs.sort();
    Ok(Json(docs))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PreviewControlMode {
    Update,
    Refresh,
}

async fn mutate_current_preview<F>(
    state: &Arc<AppState>,
    control_mode: PreviewControlMode,
    mutate: F,
) -> Result<Json<serde_json::Value>, ApiError>
where
    F: FnOnce(&mut DisplaySelection),
{
    let display_selection = {
        let mut current = state.current_display_selection.write().await;
        mutate(&mut current.selection);
        canonicalize_display_selection(&mut current.selection)?;
        current.revision = current.revision.saturating_add(1);
        current.clone()
    };
    let preview_config = display_selection.preview_request();

    let (session_id, session_state_messages, public_json) = {
        let mut current = state.current_live_state.write().await;
        let snapshot = current
            .as_mut()
            .ok_or_else(|| ApiError::not_found("no active local live workspace"))?;
        let previous_preview = snapshot.preview.clone();
        snapshot.display_selection = display_selection.clone();
        snapshot.preview_config = preview_config.clone();
        snapshot.preview =
            build_preview_state(snapshot, &snapshot.display_selection, &preview_config)
                .or(previous_preview);
        let public_json = serialize_current_live_response(snapshot, true)?;
        (
            snapshot.session.session_id.clone(),
            build_current_live_ws_messages(&state, snapshot)?,
            public_json,
        )
    };
    *state.current_live_public_snapshot.write().await = Some(public_json);

    let command = enqueue_current_control_command(
        state,
        build_preview_control_command(
            &display_selection,
            matches!(control_mode, PreviewControlMode::Refresh),
        ),
    )
    .await;
    let ack_json = serialize_runtime_event(&build_command_ack_event(&session_id, &command))?;
    let _ = state
        .current_live_events
        .send(CurrentLiveWireMessage::Text(ack_json));
    send_current_live_ws_messages(&state, session_state_messages);
    Ok(Json(
        serde_json::json!({ "status": "ok", "control_seq": command.seq }),
    ))
}

const CURRENT_LIVE_VECTOR_FRAME_MAGIC: [u8; 4] = *b"FMVP";
const CURRENT_LIVE_VECTOR_FRAME_VERSION: u8 = 1;
const CURRENT_LIVE_VECTOR_FRAME_KIND_F64: u8 = 1;
const CURRENT_LIVE_VECTOR_FRAME_HEADER_LEN: usize = 16;

fn next_current_live_vector_payload_id(state: &AppState) -> u32 {
    state
        .current_live_vector_payload_seq
        .fetch_add(1, Ordering::Relaxed)
        .wrapping_add(1)
}

fn preview_vector_values(preview: Option<&PreviewState>) -> Option<&[f64]> {
    match preview {
        Some(PreviewState::Spatial(state)) => state.vector_field_values.as_deref(),
        _ => None,
    }
}

fn ws_preview_state(
    preview: Option<&PreviewState>,
    vector_payload_id: Option<u32>,
) -> Option<PreviewState> {
    match preview {
        Some(PreviewState::Spatial(state)) => {
            let mut cloned = state.clone();
            if vector_payload_id.is_some() {
                cloned.vector_payload_id = vector_payload_id;
                cloned.vector_field_values = None;
            }
            Some(PreviewState::Spatial(cloned))
        }
        Some(PreviewState::GlobalScalar(state)) => Some(PreviewState::GlobalScalar(state.clone())),
        None => None,
    }
}

fn serialize_current_live_vector_binary(payload_id: u32, values: &[f64]) -> Vec<u8> {
    let mut out = Vec::with_capacity(CURRENT_LIVE_VECTOR_FRAME_HEADER_LEN + values.len() * 8);
    out.extend_from_slice(&CURRENT_LIVE_VECTOR_FRAME_MAGIC);
    out.push(CURRENT_LIVE_VECTOR_FRAME_VERSION);
    out.push(CURRENT_LIVE_VECTOR_FRAME_KIND_F64);
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&payload_id.to_le_bytes());
    out.extend_from_slice(&(values.len() as u32).to_le_bytes());
    for value in values {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

fn build_current_live_ws_messages(
    state: &AppState,
    snapshot: &SessionStateResponse,
) -> Result<Vec<CurrentLiveWireMessage>, ApiError> {
    let vector_payload_id = preview_vector_values(snapshot.preview.as_ref())
        .map(|_| next_current_live_vector_payload_id(state));
    let mut messages = Vec::new();
    if let (Some(payload_id), Some(values)) = (
        vector_payload_id,
        preview_vector_values(snapshot.preview.as_ref()),
    ) {
        messages.push(CurrentLiveWireMessage::Binary(
            serialize_current_live_vector_binary(payload_id, values),
        ));
    }
    messages.push(CurrentLiveWireMessage::Text(
        serialize_current_live_session_event(snapshot, vector_payload_id)?,
    ));
    Ok(messages)
}

fn send_current_live_ws_messages(state: &AppState, messages: Vec<CurrentLiveWireMessage>) {
    for message in messages {
        let _ = state.current_live_events.send(message);
    }
}

fn serialize_current_live_session_event(
    snapshot: &SessionStateResponse,
    vector_payload_id: Option<u32>,
) -> Result<String, ApiError> {
    serde_json::to_string(&CurrentLiveEvent::SessionState {
        state: SessionStateEventView {
            session_protocol_version: &snapshot.session_protocol_version,
            capability_profile_version: &snapshot.capability_profile_version,
            session: &snapshot.session,
            run: snapshot.run.as_ref(),
            live_state: snapshot.live_state.as_ref(),
            runtime_status: &snapshot.runtime_status,
            capabilities: snapshot.capabilities.as_ref(),
            metadata: snapshot.metadata.as_ref(),
            mesh_workspace: snapshot.mesh_workspace.as_ref(),
            scene_document: snapshot.scene_document.as_ref(),
            scalar_rows: &snapshot.scalar_rows,
            engine_log: &snapshot.engine_log,
            quantities: &snapshot.quantities,
            fem_mesh: snapshot.fem_mesh.as_ref(),
            latest_fields: &snapshot.latest_fields,
            artifacts: &snapshot.artifacts,
            display_selection: &snapshot.display_selection,
            preview_config: &snapshot.preview_config,
            preview: ws_preview_state(snapshot.preview.as_ref(), vector_payload_id),
        },
    })
    .map_err(|error| ApiError::internal(format!("failed to serialize current state: {}", error)))
}

fn serialize_current_live_response(
    snapshot: &SessionStateResponse,
    include_preview: bool,
) -> Result<String, ApiError> {
    serde_json::to_string(&SessionStateResponseView {
        session: &snapshot.session,
        run: snapshot.run.as_ref(),
        live_state: snapshot.live_state.as_ref(),
        runtime_status: &snapshot.runtime_status,
        metadata: snapshot.metadata.as_ref(),
        mesh_workspace: snapshot.mesh_workspace.as_ref(),
        scene_document: snapshot.scene_document.as_ref(),
        scalar_rows: &snapshot.scalar_rows,
        engine_log: &snapshot.engine_log,
        quantities: &snapshot.quantities,
        fem_mesh: snapshot.fem_mesh.as_ref(),
        latest_fields: &snapshot.latest_fields,
        artifacts: &snapshot.artifacts,
        display_selection: &snapshot.display_selection,
        preview_config: &snapshot.preview_config,
        preview: include_preview
            .then_some(snapshot.preview.as_ref())
            .flatten(),
    })
    .map_err(|error| ApiError::internal(format!("failed to serialize current state: {}", error)))
}

fn serialize_runtime_event(event: &RuntimeEventEnvelope) -> Result<String, ApiError> {
    serde_json::to_string(event).map_err(|error| {
        ApiError::internal(format!("failed to serialize runtime event: {}", error))
    })
}

fn build_command_ack_event(session_id: &str, command: &SessionCommand) -> RuntimeEventEnvelope {
    RuntimeEventEnvelope::CommandAck(CommandAckEvent {
        session_id: session_id.to_string(),
        seq: command.seq,
        command_id: command.command_id.clone(),
        command_kind: command.kind.clone(),
        issued_at_unix_ms: command.created_at_unix_ms,
        mesh_target: command.mesh_target.as_ref().map(mesh_command_target_event),
        mesh_reason: command.mesh_reason.clone(),
        display_selection: command.display_selection.clone(),
    })
}

fn mesh_command_target_event(target: &MeshCommandTarget) -> MeshCommandTargetEvent {
    match target {
        MeshCommandTarget::StudyDomain => MeshCommandTargetEvent::StudyDomain,
        MeshCommandTarget::AdaptiveFollowup => MeshCommandTargetEvent::AdaptiveFollowup,
        MeshCommandTarget::Airbox => MeshCommandTargetEvent::Airbox,
        MeshCommandTarget::ObjectMesh { object_id } => MeshCommandTargetEvent::ObjectMesh {
            object_id: object_id.clone(),
        },
    }
}

fn live_state_has_fresh_preview(live_state: Option<&LiveState>) -> bool {
    live_state
        .and_then(|state| state.latest_step.preview_field.as_ref())
        .is_some()
}

fn build_preview_state(
    current: &SessionStateResponse,
    display_selection: &CurrentDisplaySelection,
    config: &CurrentPreviewConfig,
) -> Option<PreviewState> {
    match display_selection.selection.kind {
        fullmag_runner::DisplayKind::GlobalScalar => {
            build_global_scalar_preview_state(current, display_selection)
        }
        fullmag_runner::DisplayKind::VectorField | fullmag_runner::DisplayKind::SpatialScalar => {
            build_spatial_preview_state(current, display_selection, config)
        }
    }
}

fn build_spatial_preview_state(
    current: &SessionStateResponse,
    display_selection: &CurrentDisplaySelection,
    config: &CurrentPreviewConfig,
) -> Option<PreviewState> {
    let selection = &display_selection.selection;
    let quantity = resolve_preview_quantity(current, &selection.quantity)?;
    let component = normalize_preview_component(&selection.component);
    let (source_step, source_time) = current_preview_source(current);

    if let Some(field) = current
        .live_state
        .as_ref()
        .and_then(|state| state.latest_step.preview_field.as_ref())
        .filter(|field| field.config_revision == config.revision && field.quantity == quantity)
    {
        return build_preview_state_from_live_field(
            current,
            field,
            display_selection,
            config,
            component,
            source_step,
            source_time,
        );
    }

    if let Some(mut field) = current
        .live_state
        .as_ref()
        .and_then(|state| state.latest_step.preview_field.as_ref())
        .filter(|field| field.quantity == quantity)
        .cloned()
    {
        field.config_revision = config.revision;
        return build_preview_state_from_live_field(
            current,
            &field,
            display_selection,
            config,
            component,
            source_step,
            source_time,
        );
    }

    if let Some(mut field) = cached_preview_field_owned(current, &quantity) {
        field.config_revision = config.revision;
        return build_preview_state_from_live_field(
            current,
            &field,
            display_selection,
            config,
            component,
            source_step,
            source_time,
        );
    }

    let unit = quantity_unit(&quantity).to_string();
    let display_kind = display_kind_for_quantity(&quantity).to_string();
    let quantity_domain = crate::preview::quantity_spatial_domain(&quantity).to_string();

    if let Some(mesh) = current.fem_mesh.as_ref() {
        let vectors = current_vector_field(current, &quantity)?.0;
        if vectors.len() != mesh.nodes.len() {
            return None;
        }
        let (min, max) = component_min_max(&vectors, component);
        let active_mask = crate::preview::mesh_preview_active_mask(mesh, &quantity);
        return Some(PreviewState::Spatial(SpatialPreviewState {
            display_kind,
            config_revision: config.revision,
            source_step,
            source_time,
            spatial_kind: "mesh".to_string(),
            quantity,
            unit,
            quantity_domain,
            component: component.to_string(),
            layer: 0,
            all_layers: true,
            view_type: if component == "3D" { "3D" } else { "2D" }.to_string(),
            vector_payload_id: None,
            vector_field_values: Some(flatten_vectors(&vectors)),
            scalar_field: Vec::new(),
            min,
            max,
            n_comp: 3,
            max_points: config.max_points as usize,
            data_points_count: vectors.len(),
            x_possible_sizes: Vec::new(),
            y_possible_sizes: Vec::new(),
            x_chosen_size: 0,
            y_chosen_size: 0,
            applied_x_chosen_size: 0,
            applied_y_chosen_size: 0,
            applied_layer_stride: 1,
            auto_scale_enabled: config.auto_scale_enabled,
            auto_downscaled: false,
            auto_downscale_message: None,
            preview_grid: [vectors.len(), 1, 1],
            fem_mesh: Some(mesh.clone()),
            original_node_count: Some(mesh.nodes.len()),
            original_face_count: Some(mesh.boundary_faces.len()),
            active_mask,
        }));
    }

    let (vectors, grid) = current_vector_field(current, &quantity)?;
    if vectors.is_empty() {
        return None;
    }
    let [full_x, full_y, full_z] = grid;
    if full_x == 0 || full_y == 0 || full_z == 0 || vectors.len() != full_x * full_y * full_z {
        return None;
    }

    let x_possible_sizes = candidate_preview_sizes(full_x);
    let y_possible_sizes = candidate_preview_sizes(full_y);
    let requested_x = choose_preview_size(config.x_chosen_size as usize, &x_possible_sizes, full_x);
    let requested_y = choose_preview_size(config.y_chosen_size as usize, &y_possible_sizes, full_y);

    if component == "3D" {
        let (applied_x, applied_y, stride, auto_downscaled) = if config.auto_scale_enabled {
            fit_preview_grid_3d(requested_x, requested_y, full_z, config.max_points as usize)
        } else {
            (requested_x, requested_y, 1, false)
        };
        let preview_z = full_z.div_ceil(stride).max(1);

        let vectors = resample_grid_vectors_3d(
            &vectors,
            [full_x, full_y, full_z],
            [applied_x, applied_y, preview_z],
            stride,
        );
        let (min, max) = component_min_max(&vectors, component);
        let auto_downscale_message = auto_downscaled.then(|| {
            format!(
                "Preview auto-fit from {}x{}x{} to {}x{}x{} within {} points",
                full_x, full_y, full_z, applied_x, applied_y, preview_z, config.max_points
            )
        });
        return Some(PreviewState::Spatial(SpatialPreviewState {
            display_kind,
            config_revision: config.revision,
            source_step,
            source_time,
            spatial_kind: "grid".to_string(),
            quantity,
            unit,
            quantity_domain,
            component: component.to_string(),
            layer: (config.layer as usize).min(full_z.saturating_sub(1)),
            all_layers: config.all_layers,
            view_type: "3D".to_string(),
            vector_payload_id: None,
            vector_field_values: Some(flatten_vectors(&vectors)),
            scalar_field: Vec::new(),
            min,
            max,
            n_comp: 3,
            max_points: config.max_points as usize,
            data_points_count: vectors.len(),
            x_possible_sizes: x_possible_sizes.clone(),
            y_possible_sizes: y_possible_sizes.clone(),
            x_chosen_size: requested_x,
            y_chosen_size: requested_y,
            applied_x_chosen_size: applied_x,
            applied_y_chosen_size: applied_y,
            applied_layer_stride: stride,
            auto_scale_enabled: config.auto_scale_enabled,
            auto_downscaled,
            auto_downscale_message,
            preview_grid: [applied_x, applied_y, preview_z],
            fem_mesh: None,
            original_node_count: None,
            original_face_count: None,
            active_mask: None,
        }));
    }

    let layer = (config.layer as usize).min(full_z.saturating_sub(1));
    let effective_layers = if config.all_layers { full_z } else { 1 };
    let (applied_x, applied_y, auto_downscaled) = if config.auto_scale_enabled {
        fit_preview_grid_2d(
            requested_x,
            requested_y,
            effective_layers,
            config.max_points as usize,
        )
    } else {
        (requested_x, requested_y, false)
    };
    let scalar_field = resample_grid_scalar_2d(
        &vectors,
        [full_x, full_y, full_z],
        [applied_x, applied_y],
        component,
        layer,
        config.all_layers,
    );
    let (min, max) = scalar_min_max(&scalar_field);
    let auto_downscale_message = auto_downscaled.then(|| {
        format!(
            "Preview auto-fit from {}x{} to {}x{} within {} points",
            full_x, full_y, applied_x, applied_y, config.max_points
        )
    });
    Some(PreviewState::Spatial(SpatialPreviewState {
        display_kind,
        config_revision: config.revision,
        source_step,
        source_time,
        spatial_kind: "grid".to_string(),
        quantity,
        unit,
        quantity_domain,
        component: component.to_string(),
        layer,
        all_layers: config.all_layers,
        view_type: "2D".to_string(),
        vector_payload_id: None,
        vector_field_values: None,
        scalar_field,
        min,
        max,
        n_comp: 1,
        max_points: config.max_points as usize,
        data_points_count: applied_x * applied_y,
        x_possible_sizes,
        y_possible_sizes,
        x_chosen_size: requested_x,
        y_chosen_size: requested_y,
        applied_x_chosen_size: applied_x,
        applied_y_chosen_size: applied_y,
        applied_layer_stride: 1,
        auto_scale_enabled: config.auto_scale_enabled,
        auto_downscaled,
        auto_downscale_message,
        preview_grid: [applied_x, applied_y, 1],
        fem_mesh: None,
        original_node_count: None,
        original_face_count: None,
        active_mask: None,
    }))
}

fn build_global_scalar_preview_state(
    current: &SessionStateResponse,
    display_selection: &CurrentDisplaySelection,
) -> Option<PreviewState> {
    let quantity = resolve_global_scalar_quantity(current, &display_selection.selection.quantity)?;
    let value = current_global_scalar_value(current, &quantity)?;
    let (source_step, source_time) = current_preview_source(current);
    Some(PreviewState::GlobalScalar(GlobalScalarPreviewState {
        display_kind: display_kind_for_quantity(&quantity).to_string(),
        config_revision: display_selection.revision,
        source_step,
        source_time,
        quantity: quantity.clone(),
        unit: quantity_unit(&quantity).to_string(),
        value,
    }))
}

fn build_preview_state_from_live_field(
    current: &SessionStateResponse,
    field: &LivePreviewField,
    display_selection: &CurrentDisplaySelection,
    config: &CurrentPreviewConfig,
    component: &str,
    source_step: u64,
    source_time: f64,
) -> Option<PreviewState> {
    let preview_grid = [
        field.preview_grid[0] as usize,
        field.preview_grid[1] as usize,
        field.preview_grid[2] as usize,
    ];
    let original_grid = [
        field.original_grid[0] as usize,
        field.original_grid[1] as usize,
        field.original_grid[2] as usize,
    ];
    let vectors = field
        .vector_field_values
        .chunks_exact(3)
        .map(|chunk| [chunk[0], chunk[1], chunk[2]])
        .collect::<Vec<_>>();
    let display_kind = display_kind_for_quantity(&field.quantity).to_string();

    if field.spatial_kind == "mesh" {
        let mesh = current
            .fem_mesh
            .as_ref()
            .or_else(|| {
                current
                    .live_state
                    .as_ref()
                    .and_then(|state| state.latest_step.fem_mesh.as_ref())
            })?
            .clone();
        let (min, max) = component_min_max(&vectors, component);
        let active_mask = field
            .active_mask
            .clone()
            .or_else(|| crate::preview::mesh_preview_active_mask(&mesh, &field.quantity));
        return Some(PreviewState::Spatial(SpatialPreviewState {
            display_kind,
            config_revision: field.config_revision,
            source_step,
            source_time,
            spatial_kind: "mesh".to_string(),
            quantity: field.quantity.clone(),
            unit: field.unit.clone(),
            quantity_domain: field.quantity_domain.clone(),
            component: component.to_string(),
            layer: 0,
            all_layers: true,
            view_type: if component == "3D" { "3D" } else { "2D" }.to_string(),
            vector_payload_id: None,
            vector_field_values: Some(field.vector_field_values.clone()),
            scalar_field: Vec::new(),
            min,
            max,
            n_comp: 3,
            max_points: config.max_points as usize,
            data_points_count: vectors.len(),
            x_possible_sizes: Vec::new(),
            y_possible_sizes: Vec::new(),
            x_chosen_size: field.x_chosen_size as usize,
            y_chosen_size: field.y_chosen_size as usize,
            applied_x_chosen_size: field.applied_x_chosen_size as usize,
            applied_y_chosen_size: field.applied_y_chosen_size as usize,
            applied_layer_stride: field.applied_layer_stride as usize,
            auto_scale_enabled: config.auto_scale_enabled,
            auto_downscaled: field.auto_downscaled,
            auto_downscale_message: field.auto_downscale_message.clone(),
            preview_grid,
            fem_mesh: Some(mesh.clone()),
            original_node_count: Some(mesh.nodes.len()),
            original_face_count: Some(mesh.boundary_faces.len()),
            active_mask,
        }));
    }

    let x_possible_sizes = if original_grid[0] > 0 {
        candidate_preview_sizes(original_grid[0])
    } else {
        Vec::new()
    };
    let y_possible_sizes = if original_grid[1] > 0 {
        candidate_preview_sizes(original_grid[1])
    } else {
        Vec::new()
    };

    if component == "3D" {
        let (min, max) = component_min_max(&vectors, component);
        return Some(PreviewState::Spatial(SpatialPreviewState {
            display_kind,
            config_revision: field.config_revision,
            source_step,
            source_time,
            spatial_kind: "grid".to_string(),
            quantity: field.quantity.clone(),
            unit: field.unit.clone(),
            quantity_domain: field.quantity_domain.clone(),
            component: component.to_string(),
            layer: display_selection
                .selection
                .layer
                .min(field.original_grid[2].saturating_sub(1)) as usize,
            all_layers: display_selection.selection.all_layers,
            view_type: "3D".to_string(),
            vector_payload_id: None,
            vector_field_values: Some(field.vector_field_values.clone()),
            scalar_field: Vec::new(),
            min,
            max,
            n_comp: 3,
            max_points: config.max_points as usize,
            data_points_count: vectors.len(),
            x_possible_sizes,
            y_possible_sizes,
            x_chosen_size: field.x_chosen_size as usize,
            y_chosen_size: field.y_chosen_size as usize,
            applied_x_chosen_size: field.applied_x_chosen_size as usize,
            applied_y_chosen_size: field.applied_y_chosen_size as usize,
            applied_layer_stride: field.applied_layer_stride as usize,
            auto_scale_enabled: config.auto_scale_enabled,
            auto_downscaled: field.auto_downscaled,
            auto_downscale_message: field.auto_downscale_message.clone(),
            preview_grid,
            fem_mesh: None,
            original_node_count: None,
            original_face_count: None,
            active_mask: field.active_mask.clone(),
        }));
    }

    let scalar_field = sampled_grid_scalar_2d(&vectors, preview_grid, component);
    let (min, max) = scalar_min_max(&scalar_field);
    Some(PreviewState::Spatial(SpatialPreviewState {
        display_kind,
        config_revision: field.config_revision,
        source_step,
        source_time,
        spatial_kind: "grid".to_string(),
        quantity: field.quantity.clone(),
        unit: field.unit.clone(),
        quantity_domain: field.quantity_domain.clone(),
        component: component.to_string(),
        layer: display_selection
            .selection
            .layer
            .min(field.original_grid[2].saturating_sub(1)) as usize,
        all_layers: display_selection.selection.all_layers,
        view_type: "2D".to_string(),
        vector_payload_id: None,
        vector_field_values: None,
        scalar_field,
        min,
        max,
        n_comp: 1,
        max_points: config.max_points as usize,
        data_points_count: preview_grid[0] * preview_grid[1],
        x_possible_sizes,
        y_possible_sizes,
        x_chosen_size: field.x_chosen_size as usize,
        y_chosen_size: field.y_chosen_size as usize,
        applied_x_chosen_size: field.applied_x_chosen_size as usize,
        applied_y_chosen_size: field.applied_y_chosen_size as usize,
        applied_layer_stride: field.applied_layer_stride as usize,
        auto_scale_enabled: config.auto_scale_enabled,
        auto_downscaled: field.auto_downscaled,
        auto_downscale_message: field.auto_downscale_message.clone(),
        preview_grid,
        fem_mesh: None,
        original_node_count: None,
        original_face_count: None,
        active_mask: field.active_mask.clone(),
    }))
}

fn resolve_preview_quantity(current: &SessionStateResponse, requested: &str) -> Option<String> {
    let is_preview_compatible = |quantity_id: &str| {
        quantity_spec(quantity_id).is_some_and(|spec| spec.kind != QuantityKind::GlobalScalar)
    };
    if current.quantities.iter().any(|quantity| {
        quantity.available && quantity.id == requested && is_preview_compatible(&quantity.id)
    }) {
        return Some(requested.to_string());
    }
    current
        .quantities
        .iter()
        .find(|quantity| quantity.available && is_preview_compatible(&quantity.id))
        .map(|quantity| quantity.id.clone())
}

fn resolve_global_scalar_quantity(
    current: &SessionStateResponse,
    requested: &str,
) -> Option<String> {
    let is_global_scalar = |quantity_id: &str| {
        quantity_spec(quantity_id).is_some_and(|spec| spec.kind == QuantityKind::GlobalScalar)
    };
    if current.quantities.iter().any(|quantity| {
        quantity.available && quantity.id == requested && is_global_scalar(&quantity.id)
    }) {
        return Some(requested.to_string());
    }
    current
        .quantities
        .iter()
        .find(|quantity| quantity.available && is_global_scalar(&quantity.id))
        .map(|quantity| quantity.id.clone())
}

fn current_preview_source(current: &SessionStateResponse) -> (u64, f64) {
    if let Some(live_state) = current.live_state.as_ref() {
        return (live_state.latest_step.step, live_state.latest_step.time);
    }
    if let Some(row) = current.scalar_rows.last() {
        return (row.step, row.time);
    }
    if let Some(run) = current.run.as_ref() {
        return (run.total_steps as u64, run.final_time.unwrap_or(0.0));
    }
    (0, 0.0)
}

fn current_global_scalar_value(current: &SessionStateResponse, quantity: &str) -> Option<f64> {
    let metric_key = quantity_spec(quantity)?.scalar_metric_key?;
    current
        .scalar_rows
        .last()
        .and_then(|row| scalar_row_metric_value(row, metric_key))
        .or_else(|| {
            current
                .live_state
                .as_ref()
                .and_then(|state| live_step_metric_value(&state.latest_step, metric_key))
        })
        .or_else(|| run_manifest_scalar_value(current.run.as_ref(), metric_key))
}

fn scalar_row_metric_value(row: &ScalarRow, metric_key: &str) -> Option<f64> {
    match metric_key {
        "e_ex" => Some(row.e_ex),
        "e_demag" => Some(row.e_demag),
        "e_ext" => Some(row.e_ext),
        "e_total" => Some(row.e_total),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::bootstrap_workspace_payload;

    #[test]
    fn workspace_bootstrap_payload_injects_mode() {
        let payload = bootstrap_workspace_payload(r#"{"session":{"session_id":"s1"},"run":null}"#)
            .expect("workspace bootstrap payload should encode");
        let value: serde_json::Value =
            serde_json::from_str(&payload).expect("payload should be valid json");
        assert_eq!(
            value.get("mode").and_then(serde_json::Value::as_str),
            Some("workspace")
        );
        assert_eq!(
            value
                .get("session")
                .and_then(serde_json::Value::as_object)
                .and_then(|session| session.get("session_id"))
                .and_then(serde_json::Value::as_str),
            Some("s1")
        );
    }
}
