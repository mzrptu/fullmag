use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub api_base: String,
    pub ui_url: String,
    pub launch_intent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickedTextFile {
    pub path: String,
    pub name: String,
    pub text: String,
}

#[tauri::command]
pub async fn open_file_dialog(app: AppHandle) -> Result<Option<PickedTextFile>, String> {
    let result = app
        .dialog()
        .file()
        .add_filter(
            "Simulation files",
            &["py", "json", "fm", "yaml", "yml", "txt"],
        )
        .blocking_pick_file();
    let Some(path) = result else {
        return Ok(None);
    };

    let file_path = path
        .into_path()
        .map_err(|_| "selected path is not available on this platform".to_string())?;
    let text = fs::read_to_string(&file_path)
        .map_err(|error| format!("failed to read {}: {error}", file_path.display()))?;
    let name = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("selected_file")
        .to_string();

    Ok(Some(PickedTextFile {
        path: file_path.display().to_string(),
        name,
        text,
    }))
}

#[tauri::command]
pub async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    let open_target = if target.is_dir() {
        target
    } else {
        target.parent().unwrap_or(target)
    };

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(open_target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(open_target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(open_target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_app_config(app: AppHandle) -> AppConfig {
    app.state::<AppConfig>().inner().clone()
}
