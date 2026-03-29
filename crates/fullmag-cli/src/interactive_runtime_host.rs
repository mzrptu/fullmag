use super::*;

#[derive(Debug, Default)]
struct CurrentLiveControlState {
    preview_request: fullmag_runner::LivePreviewRequest,
    queue: VecDeque<SessionCommand>,
}

#[derive(Clone)]
pub(super) struct CurrentLivePreviewConfigHandle {
    shared: Arc<(Mutex<CurrentLiveControlState>, Condvar)>,
    stop: Arc<AtomicBool>,
}

impl CurrentLivePreviewConfigHandle {
    pub(super) fn spawn() -> Self {
        let initial_preview_request = current_live_preview_config().unwrap_or_default();
        let handle = Self {
            shared: Arc::new((
                Mutex::new(CurrentLiveControlState {
                    preview_request: initial_preview_request,
                    queue: VecDeque::new(),
                }),
                Condvar::new(),
            )),
            stop: Arc::new(AtomicBool::new(false)),
        };
        let worker = handle.clone();
        std::thread::spawn(move || {
            let mut after_seq = 0u64;
            while !worker.stop.load(Ordering::Relaxed) {
                match wait_for_current_live_control(after_seq, 15_000) {
                    Ok(Some(command)) => {
                        after_seq = after_seq.max(command.seq);
                        let (lock, cvar) = &*worker.shared;
                        if let Ok(mut state) = lock.lock() {
                            state.queue.push_back(command);
                            cvar.notify_all();
                        }
                    }
                    Ok(None) => {}
                    Err(_) => std::thread::sleep(Duration::from_millis(100)),
                }
            }
            let (_, cvar) = &*worker.shared;
            cvar.notify_all();
        });
        handle
    }

    pub(super) fn snapshot(&self) -> fullmag_runner::LivePreviewRequest {
        let (lock, _) = &*self.shared;
        lock.lock()
            .map(|state| state.preview_request.clone())
            .unwrap_or_default()
    }

    pub(super) fn apply_preview_command(&self, command: &SessionCommand) {
        let Some(preview_config) = command.preview_config.clone() else {
            return;
        };
        let (lock, _) = &*self.shared;
        if let Ok(mut state) = lock.lock() {
            state.preview_request = preview_config;
        }
    }

    fn pop_front_matching(
        &self,
        predicate: impl Fn(&SessionCommand) -> bool,
    ) -> Option<SessionCommand> {
        let (lock, _) = &*self.shared;
        let mut state = lock.lock().ok()?;
        if !state.queue.front().is_some_and(&predicate) {
            return None;
        }
        state.queue.pop_front()
    }

    pub(super) fn wait_next_command(&self, timeout: Duration) -> Option<SessionCommand> {
        let (lock, cvar) = &*self.shared;
        let mut state = lock.lock().ok()?;
        if state.queue.is_empty() {
            let waited = cvar.wait_timeout(state, timeout).ok()?;
            state = waited.0;
        }
        state.queue.pop_front()
    }

    pub(super) fn process_running_control(&self) -> Option<fullmag_runner::StepAction> {
        loop {
            let Some(command) = self.pop_front_matching(|command| {
                matches!(
                    command.kind.as_str(),
                    "preview_update" | "preview_refresh" | "pause" | "stop" | "close"
                )
            }) else {
                return None;
            };
            match command.kind.as_str() {
                "preview_update" | "preview_refresh" => self.apply_preview_command(&command),
                "pause" | "stop" | "close" => {
                    eprintln!(
                        "interactive: received '{}' command — cancelling stage",
                        command.kind
                    );
                    return Some(fullmag_runner::StepAction::Stop);
                }
                _ => {}
            }
        }
    }
}

impl Drop for CurrentLivePreviewConfigHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let (_, cvar) = &*self.shared;
        cvar.notify_all();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InteractivePreviewStatus {
    Running,
    AwaitingCommand,
    Closed,
}

#[derive(Debug, Clone)]
struct InteractivePreviewSourceState {
    status: InteractivePreviewStatus,
    continuation_magnetization: Option<Vec<[f64; 3]>>,
    generation: u64,
}

pub(super) struct InteractiveRuntimeHost {
    control: CurrentLivePreviewConfigHandle,
    preview_source: Arc<Mutex<InteractivePreviewSourceState>>,
    runtime: Option<fullmag_runner::InteractiveRuntime>,
    base_problem: ProblemIR,
    artifact_dir: PathBuf,
    runtime_capable: bool,
    dynamic_idle_preview_supported: bool,
    latest_field_cache_supported: bool,
}

impl InteractiveRuntimeHost {
    pub(super) fn new(
        control: CurrentLivePreviewConfigHandle,
        base_problem: ProblemIR,
        artifact_dir: PathBuf,
        backend_plan: &BackendPlanIR,
    ) -> Self {
        Self {
            control,
            preview_source: Arc::new(Mutex::new(InteractivePreviewSourceState {
                status: InteractivePreviewStatus::Closed,
                continuation_magnetization: None,
                generation: 0,
            })),
            runtime: None,
            base_problem,
            artifact_dir,
            runtime_capable: matches!(backend_plan, BackendPlanIR::Fdm(_) | BackendPlanIR::Fem(_)),
            dynamic_idle_preview_supported: supports_dynamic_live_preview(backend_plan),
            latest_field_cache_supported: supports_interactive_latest_field_cache(backend_plan),
        }
    }

    pub(super) fn control(&self) -> CurrentLivePreviewConfigHandle {
        self.control.clone()
    }

    pub(super) fn wait_next_command(&self, timeout: Duration) -> Option<SessionCommand> {
        self.control.wait_next_command(timeout)
    }

    pub(super) fn mark_running(&self) {
        if let Ok(mut preview_state) = self.preview_source.lock() {
            preview_state.status = InteractivePreviewStatus::Running;
            preview_state.generation = preview_state.generation.saturating_add(1);
        }
    }

    pub(super) fn mark_closed(&self) {
        if let Ok(mut preview_state) = self.preview_source.lock() {
            preview_state.status = InteractivePreviewStatus::Closed;
        }
    }

    pub(super) fn enter_awaiting_command(
        &mut self,
        continuation_magnetization: Option<Vec<[f64; 3]>>,
        live_workspace: &LocalLiveWorkspace,
    ) {
        let awaiting_generation = if let Ok(mut preview_state) = self.preview_source.lock() {
            preview_state.status = InteractivePreviewStatus::AwaitingCommand;
            preview_state.continuation_magnetization = continuation_magnetization.clone();
            preview_state.generation = preview_state.generation.saturating_add(1);
            preview_state.generation
        } else {
            0
        };

        let continuation_slice = continuation_magnetization.as_deref();
        self.ensure_base_runtime_ready(continuation_slice, live_workspace);

        if self.latest_field_cache_supported {
            let preview_request = self.control.snapshot();
            spawn_interactive_preview_cache_refresh(
                self.artifact_dir.clone(),
                self.base_problem.clone(),
                Arc::clone(&self.preview_source),
                live_workspace.clone(),
                preview_request,
                awaiting_generation,
            );
        }

        self.refresh_idle_preview(continuation_slice, live_workspace);
    }

    pub(super) fn handle_preview_command(
        &mut self,
        command: &SessionCommand,
        live_workspace: &LocalLiveWorkspace,
    ) -> bool {
        if !matches!(command.kind.as_str(), "preview_update" | "preview_refresh") {
            return false;
        }

        self.control.apply_preview_command(command);
        let continuation_magnetization = self.continuation_magnetization();
        let current_generation = self
            .preview_source
            .lock()
            .map(|state| state.generation)
            .unwrap_or(0);

        if self.latest_field_cache_supported {
            let preview_request = self.control.snapshot();
            spawn_interactive_preview_cache_refresh(
                self.artifact_dir.clone(),
                self.base_problem.clone(),
                Arc::clone(&self.preview_source),
                live_workspace.clone(),
                preview_request,
                current_generation,
            );
        }

        self.refresh_idle_preview(continuation_magnetization.as_deref(), live_workspace);
        true
    }

    pub(super) fn ensure_runtime_for_problem(
        &mut self,
        problem: &ProblemIR,
        continuation_magnetization: Option<&[[f64; 3]]>,
    ) -> Result<()> {
        if !self.runtime_capable {
            return Ok(());
        }
        ensure_interactive_preview_runtime(&mut self.runtime, problem, continuation_magnetization)
    }

    pub(super) fn runtime_mut(&mut self) -> Option<&mut fullmag_runner::InteractiveRuntime> {
        self.runtime.as_mut()
    }

    fn continuation_magnetization(&self) -> Option<Vec<[f64; 3]>> {
        self.preview_source
            .lock()
            .map(|state| state.continuation_magnetization.clone())
            .unwrap_or(None)
    }

    fn ensure_base_runtime_ready(
        &mut self,
        continuation_magnetization: Option<&[[f64; 3]]>,
        live_workspace: &LocalLiveWorkspace,
    ) {
        if !self.runtime_capable {
            return;
        }

        if self.runtime.is_none() {
            match create_interactive_preview_runtime(&self.base_problem, continuation_magnetization)
            {
                Ok(runtime) => {
                    self.runtime = Some(runtime);
                }
                Err(error) => {
                    eprintln!("interactive preview runtime warning: {}", error);
                    live_workspace.push_log(
                        "warn",
                        format!("Idle live preview runtime unavailable: {}", error),
                    );
                    return;
                }
            }
        } else if let (Some(runtime), Some(magnetization)) =
            (self.runtime.as_mut(), continuation_magnetization)
        {
            if let Err(error) = runtime.upload_magnetization(magnetization) {
                eprintln!("interactive preview runtime warning: {}", error);
                live_workspace.push_log(
                    "warn",
                    format!("Idle live preview runtime resync failed: {}", error),
                );
                self.runtime = None;
            }
        }
    }

    fn refresh_idle_preview(
        &mut self,
        continuation_magnetization: Option<&[[f64; 3]]>,
        live_workspace: &LocalLiveWorkspace,
    ) {
        if let Some(runtime) = self.runtime.as_mut() {
            let preview_request = self.control.snapshot();
            if let Err(error) = refresh_interactive_preview_runtime_snapshot(
                runtime,
                &preview_request,
                live_workspace,
            ) {
                eprintln!("interactive preview runtime warning: {}", error);
                live_workspace.push_log(
                    "warn",
                    format!("Idle live preview snapshot failed: {}", error),
                );
                self.runtime = None;
            } else {
                return;
            }
        }

        if self.dynamic_idle_preview_supported {
            let preview_request = self.control.snapshot();
            if let Err(error) = refresh_interactive_preview_snapshot(
                &self.base_problem,
                continuation_magnetization,
                &preview_request,
                live_workspace,
            ) {
                eprintln!("interactive preview refresh warning: {}", error);
                live_workspace.push_log(
                    "warn",
                    format!("Idle live preview refresh warning: {}", error),
                );
            }
        }
    }
}

fn refresh_interactive_preview_snapshot(
    base_problem: &ProblemIR,
    continuation_magnetization: Option<&[[f64; 3]]>,
    request: &fullmag_runner::LivePreviewRequest,
    live_workspace: &LocalLiveWorkspace,
) -> Result<()> {
    let mut problem = base_problem.clone();
    if let Some(previous_final_magnetization) = continuation_magnetization {
        apply_continuation_initial_state(&mut problem, previous_final_magnetization)?;
    }
    let preview_field = fullmag_runner::snapshot_problem_preview(&problem, request)?;
    live_workspace.update(|state| {
        state.live_state.updated_at_unix_ms = unix_time_millis().unwrap_or(0);
        state.live_state.latest_step.preview_field = Some(preview_field.clone());
    });
    Ok(())
}

fn create_interactive_preview_runtime(
    base_problem: &ProblemIR,
    continuation_magnetization: Option<&[[f64; 3]]>,
) -> Result<fullmag_runner::InteractiveRuntime> {
    fullmag_runner::create_interactive_runtime(base_problem, continuation_magnetization)
        .map_err(|error| anyhow!(error.to_string()))
}

fn ensure_interactive_preview_runtime(
    runtime: &mut Option<fullmag_runner::InteractiveRuntime>,
    problem: &ProblemIR,
    continuation_magnetization: Option<&[[f64; 3]]>,
) -> Result<()> {
    let needs_rebuild = runtime.as_ref().map_or(true, |current| {
        !current.matches_problem(problem).unwrap_or(true)
    });
    if needs_rebuild {
        *runtime = Some(create_interactive_preview_runtime(
            problem,
            continuation_magnetization,
        )?);
    }

    Ok(())
}

fn refresh_interactive_preview_runtime_snapshot(
    runtime: &mut fullmag_runner::InteractiveRuntime,
    request: &fullmag_runner::LivePreviewRequest,
    live_workspace: &LocalLiveWorkspace,
) -> Result<()> {
    let preview_field = runtime.snapshot_preview(request)?;
    live_workspace.update(|state| {
        state.live_state.updated_at_unix_ms = unix_time_millis().unwrap_or(0);
        state.live_state.latest_step.preview_field = Some(preview_field.clone());
    });
    Ok(())
}

fn refresh_interactive_preview_fields(
    base_problem: &ProblemIR,
    continuation_magnetization: Option<&[[f64; 3]]>,
    request: &fullmag_runner::LivePreviewRequest,
) -> Result<Vec<fullmag_runner::LivePreviewField>> {
    let mut problem = base_problem.clone();
    if let Some(previous_final_magnetization) = continuation_magnetization {
        apply_continuation_initial_state(&mut problem, previous_final_magnetization)?;
    }
    Ok(fullmag_runner::snapshot_problem_vector_fields(
        &problem,
        &["H_ex", "H_demag", "H_ext", "H_eff"],
        request,
    )?)
}

fn interactive_preview_cache_path(artifact_dir: &Path) -> PathBuf {
    artifact_dir.join("interactive_preview_cache.json")
}

fn write_interactive_preview_cache(
    artifact_dir: &Path,
    preview_fields: &[fullmag_runner::LivePreviewField],
) -> Result<()> {
    fs::create_dir_all(artifact_dir)?;
    let path = interactive_preview_cache_path(artifact_dir);
    let tmp_path = path.with_extension("json.tmp");
    let payload =
        serde_json::to_vec(preview_fields).context("failed to encode interactive preview cache")?;
    fs::write(&tmp_path, payload)
        .with_context(|| format!("failed to write {}", tmp_path.display()))?;
    fs::rename(&tmp_path, &path).with_context(|| format!("failed to move {}", path.display()))?;
    Ok(())
}

fn spawn_interactive_preview_cache_refresh(
    artifact_dir: PathBuf,
    base_problem: ProblemIR,
    source_state: Arc<Mutex<InteractivePreviewSourceState>>,
    live_workspace: LocalLiveWorkspace,
    request: fullmag_runner::LivePreviewRequest,
    generation: u64,
) {
    std::thread::spawn(move || {
        let continuation_magnetization = source_state
            .lock()
            .map(|state| {
                if state.status == InteractivePreviewStatus::AwaitingCommand
                    && state.generation == generation
                {
                    state.continuation_magnetization.clone()
                } else {
                    None
                }
            })
            .unwrap_or(None);

        let Ok(preview_fields) = refresh_interactive_preview_fields(
            &base_problem,
            continuation_magnetization.as_deref(),
            &request,
        ) else {
            return;
        };

        let should_publish = source_state
            .lock()
            .map(|state| {
                state.status == InteractivePreviewStatus::AwaitingCommand
                    && state.generation == generation
            })
            .unwrap_or(false);
        if !should_publish {
            return;
        }

        live_workspace.update(|state| {
            state.preview_fields = preview_fields.clone();
        });

        if let Err(error) = write_interactive_preview_cache(&artifact_dir, &preview_fields) {
            eprintln!("interactive preview-cache warning: {}", error);
        }
    });
}

fn wait_for_current_live_control(
    after_seq: u64,
    timeout_ms: u64,
) -> Result<Option<SessionCommand>> {
    let response = match current_live_api_client()
        .get(format!("{}/v1/live/current/control/wait", api_base_url()))
        .query(&[
            ("afterSeq", after_seq.to_string()),
            ("timeoutMs", timeout_ms.to_string()),
        ])
        .send()
    {
        Ok(response) => response,
        Err(_) => return Ok(None),
    };

    match response.status() {
        reqwest::StatusCode::NO_CONTENT => Ok(None),
        reqwest::StatusCode::NOT_FOUND => Ok(None),
        status if status.is_success() => response
            .json::<SessionCommand>()
            .context("failed to decode current live control command")
            .map(Some),
        status => bail!(
            "current live control wait endpoint returned HTTP {}",
            status
        ),
    }
}

fn current_live_preview_config() -> Result<fullmag_runner::LivePreviewRequest> {
    current_live_api_client()
        .get(format!("{}/v1/live/current/preview/config", api_base_url()))
        .send()
        .context("failed to fetch current live preview config")?
        .error_for_status()
        .context("current live preview config endpoint returned error")?
        .json::<fullmag_runner::LivePreviewRequest>()
        .context("failed to decode current live preview config")
}
