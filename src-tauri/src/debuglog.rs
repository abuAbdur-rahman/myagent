use std::io::Write;

use tauri::{AppHandle, Manager};

const MAX_LOG_BYTES: u64 = 512 * 1024;

fn log_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("logs");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("myagent.log"))
}

#[tauri::command]
pub fn debug_log_append(app: AppHandle, line: String) -> Result<(), String> {
    let path = log_path(&app)?;
    let rotate = std::fs::metadata(&path)
        .map(|meta| meta.len() > MAX_LOG_BYTES)
        .unwrap_or(false);
    if rotate {
        let rotated = path.with_extension("log.1");
        let _ = std::fs::remove_file(&rotated);
        std::fs::rename(&path, &rotated).map_err(|error| error.to_string())?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

#[tauri::command]
pub fn debug_log_path(app: AppHandle) -> Result<String, String> {
    Ok(log_path(&app)?.to_string_lossy().to_string())
}
