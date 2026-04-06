#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::AppConfig;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    let url = std::env::var("FULLMAG_UI_URL").unwrap_or_else(|_| "http://localhost:3000".into());
    let api_base =
        std::env::var("FULLMAG_API_BASE").unwrap_or_else(|_| "http://localhost:8083".into());
    let launch_intent =
        std::env::var("FULLMAG_LAUNCH_INTENT").unwrap_or_else(|_| "hub".to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let parsed_url = url.parse().map_err(|error| {
                Box::<dyn std::error::Error>::from(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("invalid FULLMAG_UI_URL: {error}"),
                ))
            })?;

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed_url))
                .title("Fullmag")
                .inner_size(1400.0, 900.0)
                .min_inner_size(800.0, 600.0)
                .center()
                .build()?;

            app.manage(AppConfig {
                api_base: api_base.clone(),
                ui_url: url.clone(),
                launch_intent: launch_intent.clone(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file_dialog,
            commands::reveal_in_file_manager,
            commands::get_app_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running fullmag-ui");
}
