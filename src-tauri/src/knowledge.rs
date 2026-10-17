use tauri::{AppHandle, Manager};

use crate::tools::safe_segment;

const MAX_SIDECAR_BYTES: u64 = 2 * 1024 * 1024;

fn sidecar_path(
    app: &AppHandle,
    project_id: &str,
    sha256: &str,
) -> Result<std::path::PathBuf, String> {
    let project = safe_segment(project_id);
    let sha = safe_segment(sha256);
    if project.is_empty() || sha.is_empty() {
        return Err("invalid project id or sha".to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("knowledge")
        .join(project);
    Ok(dir.join(format!("{sha}.txt")))
}

#[tauri::command]
pub async fn knowledge_sidecar_write(
    app: AppHandle,
    project_id: String,
    sha256: String,
    text: String,
) -> Result<String, String> {
    let path = sidecar_path(&app, &project_id, &sha256)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn knowledge_sidecar_read(
    app: AppHandle,
    project_id: String,
    sha256: String,
) -> Result<String, String> {
    let path = sidecar_path(&app, &project_id, &sha256)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.len() > MAX_SIDECAR_BYTES {
        return Err(format!(
            "{}: sidecar exceeds {} bytes",
            path.display(),
            MAX_SIDECAR_BYTES
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub async fn knowledge_sidecar_wipe(app: AppHandle, project_id: String) -> Result<(), String> {
    let project = safe_segment(&project_id);
    if project.is_empty() {
        return Err("invalid project id".to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("knowledge")
        .join(project);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn knowledge_sidecar_delete(
    app: AppHandle,
    project_id: String,
    sha256: String,
) -> Result<(), String> {
    let path = sidecar_path(&app, &project_id, &sha256)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn knowledge_sidecar_wipe_all(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("knowledge");
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    Ok(())
}
