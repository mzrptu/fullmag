use anyhow::{bail, Context, Result};
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command as ProcessCommand, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::live_workspace::LocalLiveWorkspace;
use crate::types::*;

pub(crate) const LOCALHOST_HTTP_HOST: &str = "localhost";
pub(crate) const LOOPBACK_V4_OCTETS: [u8; 4] = [127, 0, 0, 1];

static RESOLVED_API_PORT: OnceLock<u16> = OnceLock::new();

pub(crate) fn api_port() -> u16 {
    *RESOLVED_API_PORT.get().expect("API port not yet resolved")
}

pub(crate) fn api_base_url() -> String {
    format!("http://localhost:{}", api_port())
}

pub(crate) fn resolve_api_port() -> Result<u16> {
    const CANDIDATE_API_PORTS: &[u16] =
        &[8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089];
    for &port in CANDIDATE_API_PORTS {
        if port_is_bindable(port) {
            return Ok(port);
        }
    }
    bail!("no free API port found in {:?}", CANDIDATE_API_PORTS)
}

pub(crate) fn init_api_port() -> Result<()> {
    RESOLVED_API_PORT
        .set(resolve_api_port()?)
        .map_err(|_| anyhow::anyhow!("API port already resolved"))
}

pub(crate) struct ControlRoomGuard {
    web_port: Option<u16>,
    api_child: Option<std::process::Child>,
}

impl ControlRoomGuard {
    pub fn inactive() -> Self {
        Self {
            web_port: None,
            api_child: None,
        }
    }

    pub fn active(web_port: u16, api_child: std::process::Child) -> Self {
        Self {
            web_port: Some(web_port),
            api_child: Some(api_child),
        }
    }
}

impl Drop for ControlRoomGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.api_child.take() {
            let _ = child.kill();
        }
        let Some(web_port) = self.web_port else {
            return;
        };
        eprintln!("fullmag tearing down control room (port {web_port})");
        stop_control_room_frontend_processes(web_port);
    }
}

pub(crate) fn spawn_control_room(
    _session_id: &str,
    dev_mode: bool,
    requested_port: Option<u16>,
    live_workspace: &LocalLiveWorkspace,
) -> Result<(u16, std::process::Child)> {
    let root = repo_root();
    let log_dir = root.join(".fullmag").join("logs");
    let url_file = root.join(".fullmag").join("control-room-url.txt");
    let mode_file = root.join(".fullmag").join("control-room-mode.txt");
    let web_dir = root.join("apps").join("web");
    let static_web_root = root.join(".fullmag").join("local").join("web");
    let external_control_room_available = if dev_mode {
        command_exists("node") && web_dir.join("dev-server.mjs").is_file()
    } else {
        command_exists("node")
            && web_dir.join("dev-server.mjs").is_file()
            && static_web_root.join("index.html").is_file()
    };
    fs::create_dir_all(&log_dir)?;

    eprintln!("  starting fullmag-api on :{} ...", api_port());
    let api_log =
        fs::File::create(log_dir.join("fullmag-api.log")).context("failed to create api log")?;
    let api_err = api_log.try_clone()?;

    let self_exe = std::env::current_exe().unwrap_or_default();
    let mut child = spawn_fullmag_api(
        &root,
        &self_exe,
        api_log,
        api_err,
        external_control_room_available,
    )?;
    wait_for_api_ready(api_port(), &mut child, Duration::from_secs(60))?;
    publish_current_live_workspace_snapshot(live_workspace)?;
    live_workspace.publish_snapshot();

    let web_port = resolve_web_port(requested_port, &url_file)?;
    let desired_mode = if dev_mode { "dev" } else { "static" };

    if external_control_room_available {
        let web_cache_dir = web_dir.join(".next");
        let current_mode = fs::read_to_string(&mode_file).ok();

        if port_is_listening(web_port)
            && (!frontend_is_ready(web_port)
                || current_mode.as_deref().map(str::trim) != Some(desired_mode))
        {
            eprintln!("  restarting control room on :{} ...", web_port);
            stop_control_room_frontend_processes(web_port);
            if dev_mode {
                let _ = fs::remove_dir_all(&web_cache_dir);
            }
        }

        if !frontend_is_ready(web_port) {
            eprintln!("  starting control room on :{} ...", web_port);
            let web_log = fs::File::create(log_dir.join("control-room.log"))
                .context("failed to create frontend log")?;
            let web_err = web_log.try_clone()?;

            let mut command = ProcessCommand::new("node");
            command
                .args([
                    "dev-server.mjs",
                    "--hostname",
                    "0.0.0.0",
                    "--port",
                    &web_port.to_string(),
                    "--api-target",
                    &api_base_url(),
                ])
                .current_dir(&web_dir)
                .env("FULLMAG_API_PROXY_TARGET", api_base_url())
                .stdin(Stdio::null())
                .stdout(web_log)
                .stderr(web_err);

            if !dev_mode {
                command
                    .arg("--static-root")
                    .arg(&static_web_root)
                    .env("FULLMAG_STATIC_WEB_ROOT", &static_web_root);
            }

            command
                .spawn()
                .context("failed to spawn control room server")?;

            let _ = fs::write(&url_file, format!("http://localhost:{}", web_port));
            let _ = fs::write(&mode_file, desired_mode);

            for _ in 0..300 {
                if frontend_is_ready_for_bootstrap(web_port) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            if !frontend_is_ready_for_bootstrap(web_port) {
                bail!("control room did not become ready on :{}", web_port);
            }
        } else {
            eprintln!("  reusing control room on :{}", web_port);
        }

        let url = format!("http://localhost:{web_port}/");
        eprintln!("  gui server: {}", url);
        if let Ok(opener) = which_opener() {
            let _ = ProcessCommand::new(opener)
                .arg(&url)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
        return Ok((web_port, child));
    }

    if !dev_mode {
        if !static_control_room_is_ready(api_port(), Duration::from_secs(20)) {
            bail!(
                "built control room did not become ready on :{}; rebuild the static control room with `make web-build-static` or `just build-static-control-room`, or run `fullmag --dev ...`",
                api_port()
            );
        }

        let url = format!("http://{LOCALHOST_HTTP_HOST}:{}/", api_port());
        eprintln!("  gui server: {}", url);
        if let Ok(opener) = which_opener() {
            let _ = ProcessCommand::new(opener)
                .arg(&url)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
        return Ok((web_port, child));
    }

    bail!(
        "control room dev mode requires a local Node frontend; run `just build-static-control-room` and omit `--dev`, or install Node and keep `apps/web/dev-server.mjs` available"
    )
}

pub(crate) fn publish_current_live_workspace_snapshot(
    live_workspace: &LocalLiveWorkspace,
) -> Result<()> {
    let snapshot = live_workspace.snapshot().snapshot();
    publish_current_live_state(
        snapshot
            .session
            .as_ref()
            .map(|session| session.session_id.as_str())
            .unwrap_or("current"),
        &snapshot,
    )
}

fn resolve_web_port(requested: Option<u16>, url_file: &Path) -> Result<u16> {
    const CANDIDATE_PORTS: &[u16] = &[3000, 3001, 3002, 3003, 3004, 3005, 3010];

    if let Some(port) = requested {
        return Ok(port);
    }

    if let Ok(stored) = fs::read_to_string(url_file) {
        let stored = stored.trim();
        if let Some(port_str) = stored.rsplit(':').next() {
            if let Ok(port) = port_str.parse::<u16>() {
                if port_is_listening(port) {
                    return Ok(port);
                }
                if port_is_bindable(port) {
                    return Ok(port);
                }
            }
        }
    }

    for &port in CANDIDATE_PORTS {
        if port_is_listening(port) {
            return Ok(port);
        }
    }

    for &port in CANDIDATE_PORTS {
        if port_is_bindable(port) {
            return Ok(port);
        }
    }

    bail!("no free port found in {:?}", CANDIDATE_PORTS)
}

pub(crate) fn port_is_listening(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

pub(crate) fn port_is_bindable(port: u16) -> bool {
    std::net::TcpListener::bind((std::net::Ipv4Addr::from(LOOPBACK_V4_OCTETS), port)).is_ok()
}

fn frontend_is_ready(port: u16) -> bool {
    frontend_is_ready_with_timeout(port, Duration::from_millis(500))
}

fn frontend_is_ready_for_bootstrap(port: u16) -> bool {
    frontend_is_ready_with_timeout(port, Duration::from_secs(20))
}

fn static_control_room_is_ready(port: u16, timeout: Duration) -> bool {
    if !api_is_ready(port) {
        return false;
    }

    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .expect("static control room readiness client should build")
        .get(format!("http://{LOCALHOST_HTTP_HOST}:{port}/"))
        .send()
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn frontend_is_ready_with_timeout(port: u16, timeout: Duration) -> bool {
    if !port_is_listening(port) {
        return false;
    }

    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .expect("frontend readiness client should build")
        .get(format!("http://{LOCALHOST_HTTP_HOST}:{port}/"))
        .send()
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn stop_control_room_frontend_processes(port: u16) {
    let hosts = [
        "0.0.0.0".to_string(),
        std::net::Ipv4Addr::from(LOOPBACK_V4_OCTETS).to_string(),
        LOCALHOST_HTTP_HOST.to_string(),
    ];
    for host in hosts {
        for pattern in [
            format!("next dev --hostname {host} --port {port}"),
            format!("node dev-server.mjs --hostname {host} --port {port}"),
        ] {
            let _ = ProcessCommand::new("pkill")
                .args(["-f", &pattern])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while port_is_listening(port) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub(crate) fn api_is_ready(port: u16) -> bool {
    let addr = std::net::SocketAddr::from((LOOPBACK_V4_OCTETS, port));
    let mut stream = match std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(250)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
    if stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

pub(crate) fn current_live_api_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("current live API client should build")
    })
}

pub(crate) fn publish_current_live_state(
    session_id: &str,
    payload: &CurrentLivePublishPayload,
) -> Result<()> {
    current_live_api_client()
        .post(format!("{}/v1/live/current/publish", api_base_url()))
        .json(&CurrentLivePublishRequest {
            session_id,
            session: payload.session.as_ref(),
            session_status: payload.session_status.as_deref(),
            metadata: payload.metadata.as_ref(),
            mesh_workspace: payload.mesh_workspace.as_ref(),
            run: payload.run.as_ref(),
            live_state: payload.live_state.as_ref(),
            latest_scalar_row: payload.latest_scalar_row.as_ref(),
            latest_fields: payload.latest_fields.as_ref(),
            preview_fields: payload.preview_fields.as_deref(),
            clear_preview_cache: payload.clear_preview_cache,
            engine_log: payload.engine_log.as_deref(),
            fem_mesh: payload.fem_mesh.as_ref(),
        })
        .send()
        .context("failed to publish current live state")?
        .error_for_status()
        .context("current live publish endpoint returned error")?;
    Ok(())
}

pub(crate) fn spawn_fullmag_api(
    root: &Path,
    self_exe: &Path,
    stdout: fs::File,
    stderr: fs::File,
    disable_static_control_room: bool,
) -> Result<std::process::Child> {
    let sibling_api = self_exe.with_file_name("fullmag-api");
    let candidates = [
        sibling_api,
        root.join(".fullmag")
            .join("local")
            .join("bin")
            .join("fullmag-api"),
        root.join(".fullmag")
            .join("target")
            .join("release")
            .join("fullmag-api"),
        root.join(".fullmag")
            .join("target")
            .join("debug")
            .join("fullmag-api"),
        root.join("target").join("release").join("fullmag-api"),
        root.join("target").join("debug").join("fullmag-api"),
    ];

    if let Some(path) = candidates.iter().find(|candidate| candidate.exists()) {
        let mut command = ProcessCommand::new(path);
        command
            .current_dir(root)
            .env("FULLMAG_API_PORT", api_port().to_string())
            .env(
                "FULLMAG_WEB_STATIC_DIR",
                root.join(".fullmag").join("local").join("web"),
            )
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr);
        configure_repo_local_library_env(&mut command, root, Some(path));
        if disable_static_control_room {
            command.env("FULLMAG_DISABLE_STATIC_CONTROL_ROOM", "1");
        }
        return command
            .spawn()
            .with_context(|| format!("failed to spawn fullmag-api binary {}", path.display()));
    }

    let mut command = ProcessCommand::new("cargo");
    command
        .args(["run", "-p", "fullmag-api"])
        .current_dir(root)
        .env("FULLMAG_API_PORT", api_port().to_string())
        .env(
            "FULLMAG_WEB_STATIC_DIR",
            root.join(".fullmag").join("local").join("web"),
        )
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);
    configure_repo_local_library_env(&mut command, root, None);
    if disable_static_control_room {
        command.env("FULLMAG_DISABLE_STATIC_CONTROL_ROOM", "1");
    }
    command
        .spawn()
        .context("failed to spawn fullmag-api via cargo")
}

fn configure_repo_local_library_env(
    command: &mut ProcessCommand,
    root: &Path,
    executable_path: Option<&Path>,
) {
    let mut library_dirs = Vec::new();
    if let Some(parent) = executable_path.and_then(|path| path.parent()) {
        library_dirs.push(parent.join("../lib"));
    }
    library_dirs.push(root.join(".fullmag").join("local").join("lib"));

    let Some(lib_dir) = library_dirs.into_iter().find(|path| path.is_dir()) else {
        return;
    };

    let mut merged = OsString::from(lib_dir.as_os_str());
    if let Some(current) = std::env::var_os("LD_LIBRARY_PATH") {
        if !current.is_empty() {
            merged.push(":");
            merged.push(current);
        }
    }
    command.env("LD_LIBRARY_PATH", merged);
}

fn wait_for_api_ready(port: u16, child: &mut std::process::Child, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if api_is_ready(port) {
            return Ok(());
        }
        if let Some(status) = child
            .try_wait()
            .context("failed to poll fullmag-api process")?
        {
            bail!(
                "fullmag-api exited before becoming ready (status: {})",
                status
            );
        }
        if Instant::now() >= deadline {
            bail!("fullmag-api did not become ready on :{}", port);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub(crate) fn which_opener() -> Result<String> {
    for cmd in ["xdg-open", "open", "wslview"] {
        if ProcessCommand::new("which")
            .arg(cmd)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Ok(cmd.to_string());
        }
    }
    bail!("no browser opener found")
}

pub(crate) fn command_exists(cmd: &str) -> bool {
    ProcessCommand::new("which")
        .arg(cmd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub(crate) fn repo_root() -> PathBuf {
    if let Some(root) = std::env::var_os("FULLMAG_REPO_ROOT") {
        return PathBuf::from(root);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate dir should have parent")
        .parent()
        .expect("workspace root should exist")
        .to_path_buf()
}
