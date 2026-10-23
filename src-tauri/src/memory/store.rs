use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::Manager;

use super::file::{self, Doc, Entry, Kind, Section};

pub const GLOBAL_FILE: &str = "MEMORY.md";

static LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|error| error.into_inner())
}

pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data directory: {error}"))?;
    Ok(dir.join("memory"))
}

pub fn scope_path(root: &Path, project_id: Option<&str>) -> Result<PathBuf, String> {
    match project_id {
        None => Ok(root.join(GLOBAL_FILE)),
        Some(id) => {
            if !safe_project_id(id) {
                return Err("invalid project id".to_string());
            }
            Ok(root.join("projects").join(format!("{id}.md")))
        }
    }
}

pub fn safe_project_id(id: &str) -> bool {
    let valid_len = id.len() == 32 || id.len() == 36;
    valid_len && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

pub fn has_file(root: &Path) -> bool {
    root.join(GLOBAL_FILE).is_file()
}

fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".bak");
    path.with_file_name(name)
}

fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

pub fn meta(path: &Path) -> (u64, u64) {
    match fs::metadata(path) {
        Ok(meta) => {
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_micros() as u64)
                .unwrap_or(0);
            (modified, meta.len())
        }
        Err(_) => (0, 0),
    }
}

pub fn read(root: &Path, project_id: Option<&str>) -> Result<Doc, String> {
    let path = scope_path(root, project_id)?;
    let target = if path.is_file() {
        path.clone()
    } else {
        let backup = backup_path(&path);
        if !backup.is_file() {
            return Ok(Doc::default());
        }
        let _ = fs::rename(&backup, &path);
        path.clone()
    };
    let text = fs::read_to_string(&target).map_err(|error| format!("read {target:?}: {error}"))?;
    Ok(file::parse(&text))
}

pub(crate) fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create {parent:?}: {error}"))?;
    }
    let temp = temp_path(path);
    {
        let mut handle =
            fs::File::create(&temp).map_err(|error| format!("create {temp:?}: {error}"))?;
        handle
            .write_all(text.as_bytes())
            .map_err(|error| format!("write {temp:?}: {error}"))?;
        handle
            .sync_all()
            .map_err(|error| format!("sync {temp:?}: {error}"))?;
    }
    if !path.exists() {
        return fs::rename(&temp, path).map_err(|error| format!("rename {temp:?}: {error}"));
    }
    let backup = backup_path(path);
    let _ = fs::remove_file(&backup);
    if let Err(error) = fs::rename(path, &backup) {
        let _ = fs::remove_file(&temp);
        return Err(format!("rotate {path:?}: {error}"));
    }
    match fs::rename(&temp, path) {
        Ok(()) => {
            let _ = fs::remove_file(&backup);
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(&backup, path);
            let _ = fs::remove_file(&temp);
            Err(format!("rename {temp:?}: {error}"))
        }
    }
}

pub fn append(
    root: &Path,
    project_id: Option<&str>,
    id: &str,
    text: &str,
    kind: Kind,
    date: &str,
    untrusted: bool,
) -> Result<Entry, String> {
    let id = file::canonical_id(id);
    let text = file::one_line(text);
    if text.is_empty() {
        return Err("memory text is empty".to_string());
    }
    let _guard = lock();
    let path = scope_path(root, project_id)?;
    let mut doc = read(root, project_id)?;
    if let Some(existing) = doc.entry(&id) {
        return Ok(existing.clone());
    }
    let section = if project_id.is_some() {
        Section::Project
    } else {
        kind.section()
    };
    let mut entry = Entry::new(id, text, date.to_string(), kind);
    entry.untrusted = untrusted;
    doc.push(section, entry.clone());
    write_atomic(&path, &file::render(&doc))?;
    Ok(entry)
}

pub fn update(
    root: &Path,
    project_id: Option<&str>,
    id: &str,
    text: Option<&str>,
    kind: Option<Kind>,
) -> Result<bool, String> {
    let id = file::canonical_id(id);
    let _guard = lock();
    let path = scope_path(root, project_id)?;
    let mut doc = read(root, project_id)?;
    if !doc.update(&id, text, kind) {
        return Ok(false);
    }
    write_atomic(&path, &file::render(&doc))?;
    Ok(true)
}

pub fn forget(root: &Path, project_id: Option<&str>, id: &str) -> Result<bool, String> {
    let id = file::canonical_id(id);
    let _guard = lock();
    let path = scope_path(root, project_id)?;
    let mut doc = read(root, project_id)?;
    if !doc.forget(&id) {
        return Ok(false);
    }
    write_atomic(&path, &file::render(&doc))?;
    Ok(true)
}

pub fn update_any(
    root: &Path,
    project_id: Option<&str>,
    id: &str,
    text: Option<&str>,
    kind: Option<Kind>,
) -> Result<bool, String> {
    if update(root, project_id, id, text, kind)? {
        return Ok(true);
    }
    if project_id.is_some() && update(root, None, id, text, kind)? {
        return Ok(true);
    }
    Ok(false)
}

pub fn forget_any(root: &Path, project_id: Option<&str>, id: &str) -> Result<bool, String> {
    if forget(root, project_id, id)? {
        return Ok(true);
    }
    if project_id.is_some() && forget(root, None, id)? {
        return Ok(true);
    }
    Ok(false)
}

pub fn write_raw(
    root: &Path,
    project_id: Option<&str>,
    markdown: &str,
    expected_mtime: u64,
    expected_len: u64,
) -> Result<(u64, u64), String> {
    let _guard = lock();
    let path = scope_path(root, project_id)?;
    let (mtime, len) = meta(&path);
    if (mtime, len) != (expected_mtime, expected_len) {
        return Err("changed on disk".to_string());
    }
    let doc = file::parse(markdown);
    write_atomic(&path, &file::render(&doc))?;
    Ok(meta(&path))
}

pub fn delete_project(root: &Path, project_id: &str) -> Result<(), String> {
    let _guard = lock();
    let path = scope_path(root, Some(project_id))?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove {path:?}: {error}")),
    }
}

pub fn reset(root: &Path) -> Result<(), String> {
    let _guard = lock();
    match fs::remove_dir_all(root) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove {root:?}: {error}")),
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct EntryView {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub date: String,
    pub created_at: i64,
    pub untrusted: bool,
}

impl From<&Entry> for EntryView {
    fn from(entry: &Entry) -> Self {
        Self {
            id: entry.id.clone(),
            text: entry.text.clone(),
            kind: entry.kind_label(),
            date: entry.date.clone(),
            created_at: file::millis_of_date(&entry.date),
            untrusted: entry.untrusted,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ScopeView {
    pub path: String,
    pub exists: bool,
    pub mtime: u64,
    pub len: u64,
    pub notes: usize,
    pub entries: Vec<EntryView>,
    pub sent: Vec<String>,
    pub omitted: usize,
    pub chars: usize,
    pub markdown: String,
}

pub fn view(root: &Path, project_id: Option<&str>) -> Result<ScopeView, String> {
    let path = scope_path(root, project_id)?;
    let doc = read(root, project_id)?;
    let mut entries: Vec<Entry> = doc.entries().cloned().collect();
    let sent = file::sent(&entries);
    let (mtime, len) = meta(&path);
    let notes = doc.len();
    let markdown = fs::read_to_string(&path).unwrap_or_else(|_| file::render(&Doc::default()));
    Ok(ScopeView {
        path: path.to_string_lossy().to_string(),
        exists: path.is_file(),
        mtime,
        len,
        notes,
        entries: entries
            .drain(..)
            .map(|entry| EntryView::from(&entry))
            .collect(),
        sent: sent.ids,
        omitted: sent.omitted,
        chars: sent.chars,
        markdown,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("myagent-memory-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn id(n: u8) -> String {
        format!("{:032x}", n)
    }

    #[test]
    fn append_read_update_and_forget_round_trip() {
        let dir = root("store");
        let entry = append(
            &dir,
            None,
            &id(1),
            "first note",
            Kind::Fact,
            "2026-10-20",
            false,
        )
        .expect("append");
        assert_eq!(entry.id, id(1));
        let doc = read(&dir, None).expect("read");
        assert_eq!(doc.entry(&id(1)).unwrap().text, "first note");

        assert!(
            update(&dir, None, &id(1), Some("changed"), Some(Kind::Preference)).expect("update")
        );
        let doc = read(&dir, None).expect("read");
        let entry = doc.entry(&id(1)).unwrap();
        assert_eq!(entry.text, "changed");
        assert_eq!(entry.kind, Kind::Preference);

        assert!(forget(&dir, None, &id(1)).expect("forget"));
        assert_eq!(read(&dir, None).expect("read").len(), 0);
        assert!(!forget(&dir, None, &id(1)).expect("second forget"));
    }

    #[test]
    fn a_project_memory_lands_in_its_own_file_under_project() {
        let dir = root("project");
        let project = "11111111-2222-3333-4444-555555555555";
        append(
            &dir,
            Some(project),
            &id(2),
            "staging first",
            Kind::Preference,
            "2026-10-20",
            false,
        )
        .expect("append");
        let text = fs::read_to_string(scope_path(&dir, Some(project)).unwrap()).expect("file");
        assert!(text.contains("## Project"));
        assert!(text.contains("k:preference"));
        assert!(!scope_path(&dir, None).unwrap().exists());
    }

    #[test]
    fn the_path_jail_rejects_traversal() {
        let dir = root("jail");
        assert!(scope_path(&dir, Some("../escape")).is_err());
        assert!(scope_path(&dir, Some("CON")).is_err());
        assert!(scope_path(&dir, Some("..")).is_err());
        assert!(scope_path(&dir, Some("11111111-2222-3333-4444-555555555555")).is_ok());
    }

    #[test]
    fn an_atomic_write_leaves_no_temp_or_backup() {
        let dir = root("atomic");
        append(&dir, None, &id(3), "one", Kind::Fact, "2026-10-20", false).expect("append");
        append(&dir, None, &id(4), "two", Kind::Fact, "2026-10-20", false).expect("append");
        let path = scope_path(&dir, None).unwrap();
        assert!(path.is_file());
        assert!(!temp_path(&path).exists());
        assert!(!backup_path(&path).exists());
    }

    #[test]
    fn a_lost_file_recovers_from_the_backup() {
        let dir = root("backup");
        append(
            &dir,
            None,
            &id(5),
            "keep me",
            Kind::Fact,
            "2026-10-20",
            false,
        )
        .expect("append");
        let path = scope_path(&dir, None).unwrap();
        fs::rename(&path, backup_path(&path)).expect("simulate crash");
        let doc = read(&dir, None).expect("read");
        assert_eq!(doc.entry(&id(5)).unwrap().text, "keep me");
        assert!(path.is_file());
    }

    #[test]
    fn write_raw_rejects_a_stale_mtime() {
        let dir = root("raw");
        append(&dir, None, &id(6), "one", Kind::Fact, "2026-10-20", false).expect("append");
        let path = scope_path(&dir, None).unwrap();
        let (mtime, len) = meta(&path);
        let edited = file::render(&file::parse(
            "# MEMORY\n\n## User\n- one <!--m:00000000000000000000000000000006 2026-10-20-->\n- two <!--m:00000000000000000000000000000007 2026-10-20-->\n",
        ));
        write_raw(&dir, None, &edited, mtime, len).expect("first writer wins");
        assert!(write_raw(&dir, None, &edited, mtime, len).is_err());
    }

    #[test]
    fn two_writers_serialise_and_both_notes_survive() {
        let dir = root("threads");
        let handles: Vec<_> = (10..20)
            .map(|n| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    append(
                        &dir,
                        None,
                        &id(n),
                        &format!("note {n}"),
                        Kind::Fact,
                        "2026-10-20",
                        false,
                    )
                    .expect("append");
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("thread");
        }
        assert_eq!(read(&dir, None).expect("read").len(), 10);
    }

    #[test]
    fn a_view_reports_the_budget_and_the_sent_ids() {
        let dir = root("view");
        append(
            &dir,
            None,
            &id(7),
            "visible",
            Kind::Fact,
            "2026-10-20",
            false,
        )
        .expect("append");
        let view = view(&dir, None).expect("view");
        assert_eq!(view.notes, 1);
        assert_eq!(view.entries.len(), 1);
        assert_eq!(view.sent, vec![id(7)]);
        assert_eq!(view.omitted, 0);
        assert!(view.exists);
    }

    #[test]
    fn delete_project_and_reset_remove_the_files() {
        let dir = root("delete");
        let project = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        append(
            &dir,
            Some(project),
            &id(8),
            "p",
            Kind::Note,
            "2026-10-20",
            false,
        )
        .expect("append");
        delete_project(&dir, project).expect("delete");
        assert!(!scope_path(&dir, Some(project)).unwrap().exists());
        append(&dir, None, &id(9), "g", Kind::Fact, "2026-10-20", false).expect("append");
        reset(&dir).expect("reset");
        assert!(!dir.exists());
    }
}
