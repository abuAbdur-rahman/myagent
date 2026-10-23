use serde::Serialize;
use tauri::AppHandle;

use super::file::{self, Kind};
use super::{migrate, store};
use crate::tools::memory_pool;

#[derive(Serialize)]
pub struct ReadView {
    pub available: bool,
    pub root: String,
    pub global: store::ScopeView,
    pub project: Option<store::ScopeView>,
}

#[derive(Serialize)]
pub struct MetaView {
    pub mtime: u64,
    pub len: u64,
}

fn target<'a>(scope: &'a str, project_id: Option<&'a str>) -> Result<Option<&'a str>, String> {
    match scope {
        "global" => Ok(None),
        "project" => match project_id {
            Some(id) if !id.is_empty() => Ok(Some(id)),
            _ => Err("project memory needs a project id".to_string()),
        },
        _ => Err("scope must be global or project".to_string()),
    }
}

fn kind_of(value: &str) -> Result<Kind, String> {
    Kind::parse(value).ok_or_else(|| "kind must be fact, preference, summary or note".to_string())
}

#[tauri::command]
pub async fn memory_migrate(app: AppHandle) -> Result<migrate::MigrationReport, String> {
    let root = store::root(&app)?;
    let pool = memory_pool(&app).await.map_err(|error| error.to_string())?;
    migrate::run(&pool, &root, env!("CARGO_PKG_VERSION")).await
}

#[tauri::command]
pub fn memory_read(app: AppHandle, project_id: Option<String>) -> Result<ReadView, String> {
    let root = store::root(&app)?;
    Ok(ReadView {
        available: store::has_file(&root),
        root: root.to_string_lossy().to_string(),
        global: store::view(&root, None)?,
        project: match project_id.as_deref() {
            Some(id) if !id.is_empty() => Some(store::view(&root, Some(id))?),
            _ => None,
        },
    })
}

#[tauri::command]
pub fn memory_append(
    app: AppHandle,
    scope: String,
    project_id: Option<String>,
    text: String,
    kind: String,
    id: Option<String>,
    date: Option<String>,
) -> Result<store::EntryView, String> {
    let project = target(&scope, project_id.as_deref())?;
    let kind = kind_of(&kind)?;
    let limit = if id.is_some() { 2000 } else { 200 };
    if text.chars().count() > limit {
        return Err(format!("content too long (max {limit} chars)"));
    }
    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let date = date.unwrap_or_else(file::today);
    let root = store::root(&app)?;
    let entry = store::append(&root, project, &id, &text, kind, &date)?;
    Ok(store::EntryView::from(&entry))
}

#[tauri::command]
pub fn memory_update(
    app: AppHandle,
    scope: String,
    project_id: Option<String>,
    id: String,
    text: Option<String>,
    kind: Option<String>,
) -> Result<bool, String> {
    let project = target(&scope, project_id.as_deref())?;
    if text.is_none() && kind.is_none() {
        return Err("nothing to update: pass text or kind".to_string());
    }
    if let Some(value) = text.as_deref() {
        if value.chars().count() > 2000 {
            return Err("content too long (max 2000 chars)".to_string());
        }
    }
    let kind = match kind.as_deref() {
        Some(value) => Some(kind_of(value)?),
        None => None,
    };
    let root = store::root(&app)?;
    store::update(&root, project, &id, text.as_deref(), kind)
}

#[tauri::command]
pub fn memory_forget(
    app: AppHandle,
    scope: String,
    project_id: Option<String>,
    id: String,
) -> Result<bool, String> {
    let project = target(&scope, project_id.as_deref())?;
    let root = store::root(&app)?;
    store::forget(&root, project, &id)
}

#[tauri::command]
pub fn memory_write_raw(
    app: AppHandle,
    scope: String,
    project_id: Option<String>,
    markdown: String,
    mtime: u64,
    len: u64,
) -> Result<MetaView, String> {
    let project = target(&scope, project_id.as_deref())?;
    let root = store::root(&app)?;
    let (mtime, len) = store::write_raw(&root, project, &markdown, mtime, len)?;
    Ok(MetaView { mtime, len })
}

#[tauri::command]
pub fn memory_project_delete(app: AppHandle, project_id: String) -> Result<(), String> {
    let root = store::root(&app)?;
    store::delete_project(&root, &project_id)
}

#[tauri::command]
pub async fn memory_reset(app: AppHandle) -> Result<(), String> {
    let root = store::root(&app)?;
    store::reset(&root)?;
    let pool = memory_pool(&app).await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM meta WHERE key = ?")
        .bind(migrate::MARKER_KEY)
        .execute(&pool)
        .await
        .map_err(|error| format!("clear memory marker: {error}"))?;
    Ok(())
}
