use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use std::fs;
use std::path::PathBuf;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendInput {
    scope: String,
    project_id: Option<String>,
    text: String,
    kind: String,
    id: Option<String>,
    date: Option<String>,
    trust: Option<String>,
}

fn memory_date(date: Option<String>) -> Result<String, String> {
    match date {
        Some(value)
            if value.len() == 10
                && chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d").is_ok() =>
        {
            Ok(value)
        }
        Some(_) => Err("date must be YYYY-MM-DD".to_string()),
        None => Ok(file::today()),
    }
}

#[tauri::command]
pub fn memory_append(app: AppHandle, input: AppendInput) -> Result<store::EntryView, String> {
    let project = target(&input.scope, input.project_id.as_deref())?;
    let kind = kind_of(&input.kind)?;
    if input.text.chars().count() > 2000 {
        return Err("content too long (max 2000 chars)".to_string());
    }
    if super::looks_secret(&input.text) {
        return Err(super::secret_message().to_string());
    }
    let id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let date = memory_date(input.date)?;
    let untrusted = input.trust.as_deref() == Some("untrusted");
    let root = store::root(&app)?;
    let entry = store::append(&root, project, &id, &input.text, kind, &date, untrusted)?;
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
        if super::looks_secret(value) {
            return Err(super::secret_message().to_string());
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

#[derive(Clone, Debug, Deserialize, Serialize)]
struct UnassignedRow {
    id: String,
    content: String,
    kind: String,
    created_at: i64,
}

#[derive(Debug, Deserialize, Serialize)]
struct UnassignedFile {
    rows: Vec<UnassignedRow>,
}

#[derive(Serialize)]
pub struct UnassignedView {
    pub id: String,
    pub content: String,
    pub kind: String,
    pub created_at: i64,
}

fn unassigned_path(root: &std::path::Path) -> PathBuf {
    root.join("legacy/unassigned.json")
}

fn read_unassigned(root: &std::path::Path) -> Result<Option<UnassignedFile>, String> {
    let path = unassigned_path(root);
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|error| format!("read {path:?}: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("read {path:?}: {error}")),
    }
}

fn save_unassigned(root: &std::path::Path, file: &UnassignedFile) -> Result<(), String> {
    let path = unassigned_path(root);
    if file.rows.is_empty() {
        return match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("remove {path:?}: {error}")),
        };
    }
    let text = serde_json::to_string_pretty(file)
        .map_err(|error| format!("serialize {path:?}: {error}"))?;
    fs::write(&path, text).map_err(|error| format!("write {path:?}: {error}"))
}

#[tauri::command]
pub fn memory_unassigned(app: AppHandle) -> Result<Vec<UnassignedView>, String> {
    let root = store::root(&app)?;
    let Some(file) = read_unassigned(&root)? else {
        return Ok(Vec::new());
    };
    Ok(file
        .rows
        .into_iter()
        .map(|row| UnassignedView {
            id: row.id,
            content: row.content,
            kind: row.kind,
            created_at: row.created_at,
        })
        .collect())
}

#[tauri::command]
pub fn memory_assign_unassigned(
    app: AppHandle,
    id: String,
    scope: String,
    project_id: Option<String>,
) -> Result<(), String> {
    let root = store::root(&app)?;
    let project = target(&scope, project_id.as_deref())?;
    let mut file = read_unassigned(&root)?.ok_or("that note is no longer waiting")?;
    let index = file
        .rows
        .iter()
        .position(|row| row.id == id)
        .ok_or("that note is no longer waiting")?;
    let row = file.rows[index].clone();
    if super::looks_secret(&row.content) {
        return Err(super::secret_message().to_string());
    }
    let kind = Kind::parse(&row.kind).unwrap_or(Kind::Note);
    store::append(
        &root,
        project,
        &row.id,
        &row.content,
        kind,
        &file::date_of_millis(row.created_at),
        false,
    )?;
    file.rows.remove(index);
    save_unassigned(&root, &file)
}

#[tauri::command]
pub fn memory_discard_unassigned(app: AppHandle, id: String) -> Result<(), String> {
    let root = store::root(&app)?;
    let mut file = read_unassigned(&root)?.ok_or("that note is no longer waiting")?;
    let index = file
        .rows
        .iter()
        .position(|row| row.id == id)
        .ok_or("that note is no longer waiting")?;
    file.rows.remove(index);
    save_unassigned(&root, &file)
}

#[cfg(test)]
mod tests {
    use super::memory_date;

    #[test]
    fn append_dates_must_be_iso_days() {
        assert_eq!(
            memory_date(Some("2026-10-24".to_string())).expect("valid"),
            "2026-10-24"
        );
        assert_eq!(
            memory_date(Some("2026-02-30".to_string())).expect_err("bad day"),
            "date must be YYYY-MM-DD"
        );
        assert_eq!(
            memory_date(Some("+010000-01-01".to_string())).expect_err("bad year"),
            "date must be YYYY-MM-DD"
        );
        assert_eq!(memory_date(None).expect("today").len(), 10);
    }
}
