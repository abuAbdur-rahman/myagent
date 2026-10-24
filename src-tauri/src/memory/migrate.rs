use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use super::file::{self, Doc, Entry, Kind, Section};
use super::store;

pub const MARKER_KEY: &str = "memory.migrated";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct MigrationReport {
    pub migrated: bool,
    pub reason: String,
    pub at: String,
    pub version: String,
    pub global: usize,
    pub project: usize,
    pub notes: usize,
    pub unassigned: usize,
    pub skipped: usize,
    pub duplicates: usize,
    pub files: Vec<String>,
    pub legacy: Option<String>,
    #[serde(default)]
    pub ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct MemoryRow {
    id: String,
    scope: String,
    project_id: Option<String>,
    kind: String,
    content: String,
    source_conversation_id: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize)]
struct Backup {
    version: u32,
    app_version: String,
    at: String,
    counts: BTreeMap<String, usize>,
    memories: Vec<MemoryRow>,
}

#[derive(Serialize)]
struct Unassigned {
    version: u32,
    app_version: String,
    at: String,
    rows: Vec<MemoryRow>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn stamp() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string()
}

async fn read_marker(pool: &SqlitePool) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM meta WHERE key = ?")
        .bind(MARKER_KEY)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("read memory marker: {error}"))
}

async fn write_marker(pool: &SqlitePool, report: &MigrationReport) -> Result<(), String> {
    let value =
        serde_json::to_string(report).map_err(|error| format!("serialize report: {error}"))?;
    sqlx::query("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
        .bind(MARKER_KEY)
        .bind(value)
        .execute(pool)
        .await
        .map_err(|error| format!("write memory marker: {error}"))?;
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create {parent:?}: {error}"))?;
    }
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| format!("serialize {path:?}: {error}"))?;
    let mut handle = fs::File::create(path).map_err(|error| format!("create {path:?}: {error}"))?;
    handle
        .write_all(text.as_bytes())
        .map_err(|error| format!("write {path:?}: {error}"))?;
    handle
        .sync_all()
        .map_err(|error| format!("sync {path:?}: {error}"))?;
    Ok(())
}

async fn rows(pool: &SqlitePool) -> Result<Vec<MemoryRow>, String> {
    let rows = sqlx::query(
        "SELECT id, scope, project_id, kind, content, source_conversation_id, created_at, updated_at FROM memories ORDER BY created_at ASC, id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("read memories: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| MemoryRow {
            id: row.get("id"),
            scope: row.get("scope"),
            project_id: row.get("project_id"),
            kind: row.get("kind"),
            content: row.get("content"),
            source_conversation_id: row.get("source_conversation_id"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect())
}

async fn live_projects(pool: &SqlitePool) -> Result<HashSet<String>, String> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT id FROM projects")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("read projects: {error}"))?;
    Ok(rows.into_iter().collect())
}

fn row_entry(row: &MemoryRow, project_file: bool) -> (Section, Entry) {
    let content = file::one_line(&row.content);
    let id = file::canonical_id(&row.id);
    let date = file::date_of_millis(row.created_at);
    match Kind::parse(&row.kind) {
        Some(kind) if project_file => {
            let raw = if kind == Kind::Note {
                None
            } else {
                Some(row.kind.clone())
            };
            (
                Section::Project,
                Entry {
                    id,
                    text: content,
                    date,
                    kind,
                    raw_kind: raw,
                    untrusted: false,
                },
            )
        }
        Some(kind) => {
            let section = kind.section();
            let raw = if kind == section.default_kind() {
                None
            } else {
                Some(row.kind.clone())
            };
            (
                section,
                Entry {
                    id,
                    text: content,
                    date,
                    kind,
                    raw_kind: raw,
                    untrusted: false,
                },
            )
        }
        None if project_file => (
            Section::Project,
            Entry {
                id,
                text: content,
                date,
                kind: Kind::Note,
                raw_kind: Some(row.kind.clone()),
                untrusted: false,
            },
        ),
        None => (
            Section::Decisions,
            Entry {
                id,
                text: content,
                date,
                kind: Kind::Summary,
                raw_kind: Some(row.kind.clone()),
                untrusted: false,
            },
        ),
    }
}

fn normalized(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

async fn merge_late_rows(
    pool: &SqlitePool,
    root: &Path,
    report: &mut MigrationReport,
) -> Result<(), String> {
    let all = rows(pool).await?;
    let known: HashSet<String> = report.ids.iter().map(|id| file::canonical_id(id)).collect();
    let projects = live_projects(pool).await?;
    let mut changed = false;
    for row in all {
        let id = file::canonical_id(&row.id);
        if known.contains(&id) {
            continue;
        }
        changed = true;
        if file::one_line(&row.content).is_empty() {
            report.ids.push(row.id);
            continue;
        }
        let project = if row.scope == "project" {
            match row.project_id.as_deref() {
                Some(pid) if projects.contains(pid) && store::safe_project_id(pid) => Some(pid),
                _ => {
                    report.ids.push(row.id);
                    continue;
                }
            }
        } else {
            None
        };
        let doc = store::read(root, project)?;
        let needle = normalized(&row.content);
        if doc.entry(&id).is_some() || doc.entries().any(|entry| normalized(&entry.text) == needle)
        {
            report.ids.push(row.id);
            continue;
        }
        let (_, entry) = row_entry(&row, project.is_some());
        store::append(
            root,
            project,
            &id,
            &entry.text,
            entry.kind,
            &entry.date,
            false,
        )?;
        report.ids.push(row.id);
    }
    if changed {
        write_marker(pool, report).await?;
    }
    Ok(())
}

pub async fn run(pool: &SqlitePool, root: &Path, version: &str) -> Result<MigrationReport, String> {
    if let Some(value) = read_marker(pool).await? {
        let mut report: MigrationReport = serde_json::from_str(&value).unwrap_or_default();
        report.migrated = false;
        report.reason = "already-migrated".to_string();
        if let Err(error) = merge_late_rows(pool, root, &mut report).await {
            report.reason = format!("already-migrated; late merge failed: {error}");
        }
        return Ok(report);
    }

    if store::has_file(root) {
        let ids = rows(pool).await?.into_iter().map(|row| row.id).collect();
        let report = MigrationReport {
            migrated: false,
            reason: "file-present".to_string(),
            at: now(),
            version: version.to_string(),
            ids,
            ..MigrationReport::default()
        };
        write_marker(pool, &report).await?;
        return Ok(report);
    }

    let rows = rows(pool).await?;
    let projects = live_projects(pool).await?;
    let at = now();
    let legacy_rel = format!("legacy/memories-{}.json", stamp());
    let legacy_path = root.join(&legacy_rel);
    let mut counts = BTreeMap::new();
    counts.insert("memories".to_string(), rows.len());
    write_json(
        &legacy_path,
        &Backup {
            version: 1,
            app_version: version.to_string(),
            at: at.clone(),
            counts,
            memories: rows.clone(),
        },
    )?;

    let mut global = Doc::default();
    let mut project_docs: BTreeMap<String, Doc> = BTreeMap::new();
    let mut unassigned_rows: Vec<MemoryRow> = Vec::new();
    let mut file_names: Vec<String> = Vec::new();
    let mut skipped = 0;
    let mut duplicates = 0;
    let mut seen_content: HashMap<(Option<String>, String), usize> = HashMap::new();
    let mut global_notes = 0;
    let mut project_notes = 0;

    for row in &rows {
        if file::one_line(&row.content).is_empty() {
            skipped += 1;
            continue;
        }
        let project_key = if row.scope == "project" {
            match row.project_id.as_deref() {
                Some(id) if projects.contains(id) && store::safe_project_id(id) => {
                    Some(id.to_string())
                }
                _ => {
                    unassigned_rows.push(row.clone());
                    continue;
                }
            }
        } else {
            None
        };
        let key = (project_key.clone(), file::one_line(&row.content));
        let count = seen_content.entry(key).or_insert(0);
        *count += 1;
        if *count > 1 {
            duplicates += 1;
        }
        let (section, entry) = row_entry(row, project_key.is_some());
        match project_key {
            Some(id) => {
                let doc = project_docs.entry(id).or_default();
                doc.push(section, entry);
                project_notes += 1;
            }
            None => {
                global.push(section, entry);
                global_notes += 1;
            }
        }
    }

    for (id, doc) in &project_docs {
        let relative = format!("projects/{id}.md");
        store::write_atomic(&root.join(&relative), &file::render(doc))?;
        file_names.push(relative);
    }

    if !unassigned_rows.is_empty() {
        write_json(
            &root.join("legacy/unassigned.json"),
            &Unassigned {
                version: 1,
                app_version: version.to_string(),
                at: at.clone(),
                rows: unassigned_rows.clone(),
            },
        )?;
    }

    store::write_atomic(&root.join(store::GLOBAL_FILE), &file::render(&global))?;
    file_names.push(store::GLOBAL_FILE.to_string());

    let report = MigrationReport {
        migrated: true,
        reason: "migrated".to_string(),
        at,
        version: version.to_string(),
        global: global_notes,
        project: project_notes,
        notes: global_notes + project_notes,
        unassigned: unassigned_rows.len(),
        skipped,
        duplicates,
        files: file_names,
        legacy: Some(legacy_path.to_string_lossy().to_string()),
        ids: rows.iter().map(|row| row.id.clone()).collect(),
    };
    write_marker(pool, &report).await?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Executor;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::path::PathBuf;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("pool");
        sqlx::raw_sql(
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
             CREATE TABLE memories (id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT, kind TEXT NOT NULL, content TEXT NOT NULL, source_conversation_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .execute(&pool)
        .await
        .expect("schema");
        pool
    }

    fn root(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("myagent-migrate-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    async fn insert(
        pool: &SqlitePool,
        id: &str,
        scope: &str,
        project_id: Option<&str>,
        kind: &str,
        content: &str,
        created_at: i64,
    ) {
        sqlx::query("INSERT INTO memories (id, scope, project_id, kind, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(id)
            .bind(scope)
            .bind(project_id)
            .bind(kind)
            .bind(content)
            .bind(created_at)
            .bind(created_at)
            .execute(pool)
            .await
            .expect("row");
    }

    #[tokio::test]
    async fn migrates_rows_into_global_and_project_files_without_touching_the_table() {
        let pool = pool().await;
        let dir = root("rows");
        pool.execute("INSERT INTO projects (id, name) VALUES ('11111111-2222-3333-4444-555555555555', 'Work')")
            .await
            .expect("project");
        insert(
            &pool,
            "7f2a9c1e-5b6d-4a3f-8c2e-1d0b9a8f7e6d",
            "global",
            None,
            "fact",
            "Prefers concise answers",
            1_760_000_000_000,
        )
        .await;
        insert(
            &pool,
            "91c0d2f4-a6b8-e0c2-d4f6-a8b0c2e4f6a8",
            "global",
            None,
            "preference",
            "Answers in\nshort bullets",
            1_760_000_001_000,
        )
        .await;
        insert(
            &pool,
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "project",
            Some("11111111-2222-3333-4444-555555555555"),
            "note",
            "Staging first",
            1_760_000_002_000,
        )
        .await;
        insert(
            &pool,
            "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
            "project",
            Some("dead-project"),
            "note",
            "Orphan note",
            1_760_000_003_000,
        )
        .await;
        insert(
            &pool,
            "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee",
            "global",
            None,
            "weird",
            "Legacy kind",
            1_760_000_004_000,
        )
        .await;
        insert(
            &pool,
            "dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee",
            "global",
            None,
            "note",
            "   ",
            1_760_000_005_000,
        )
        .await;

        let report = run(&pool, &dir, "0.5.0").await.expect("migrate");
        assert!(report.migrated);
        assert_eq!(report.global, 3);
        assert_eq!(report.project, 1);
        assert_eq!(report.unassigned, 1);
        assert_eq!(report.skipped, 1);
        assert_eq!(report.notes, 4);
        assert!(report.legacy.is_some());

        let global = fs::read_to_string(dir.join("MEMORY.md")).expect("global file");
        assert!(global.contains("Prefers concise answers"));
        assert!(global.contains("Answers in short bullets"));
        assert!(global.contains("k:weird"));
        assert!(!global.contains("Orphan note"));

        let project =
            fs::read_to_string(dir.join("projects/11111111-2222-3333-4444-555555555555.md"))
                .expect("project file");
        assert!(project.contains("Staging first"));

        let unassigned = fs::read_to_string(dir.join("legacy/unassigned.json")).expect("orphans");
        assert!(unassigned.contains("Orphan note"));

        let backup = fs::read_to_string(dir.join(report.legacy.unwrap())).expect("backup");
        assert!(backup.contains("Orphan note"));
        assert!(backup.contains("Legacy kind"));

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM memories")
            .fetch_one(&pool)
            .await
            .expect("count");
        assert_eq!(count, 6);
        let kind: String = sqlx::query_scalar(
            "SELECT kind FROM memories WHERE id = 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee'",
        )
        .fetch_one(&pool)
        .await
        .expect("kind");
        assert_eq!(kind, "weird");
    }

    #[tokio::test]
    async fn a_second_run_is_a_no_op() {
        let pool = pool().await;
        let dir = root("twice");
        insert(
            &pool,
            "7f2a9c1e-5b6d-4a3f-8c2e-1d0b9a8f7e6d",
            "global",
            None,
            "fact",
            "one",
            1_760_000_000_000,
        )
        .await;
        let first = run(&pool, &dir, "0.5.0").await.expect("first");
        assert!(first.migrated);
        let second = run(&pool, &dir, "0.5.0").await.expect("second");
        assert!(!second.migrated);
        assert_eq!(second.reason, "already-migrated");
        let text = fs::read_to_string(dir.join("MEMORY.md")).expect("file");
        assert_eq!(text.matches("one").count(), 1);
    }

    #[tokio::test]
    async fn an_existing_file_blocks_the_import() {
        let pool = pool().await;
        let dir = root("present");
        fs::create_dir_all(&dir).expect("dir");
        fs::write(dir.join("MEMORY.md"), "# MEMORY\n\n## User\n- mine\n").expect("file");
        insert(
            &pool,
            "7f2a9c1e-5b6d-4a3f-8c2e-1d0b9a8f7e6d",
            "global",
            None,
            "fact",
            "from db",
            1_760_000_000_000,
        )
        .await;
        let report = run(&pool, &dir, "0.5.0").await.expect("run");
        assert_eq!(report.reason, "file-present");
        let text = fs::read_to_string(dir.join("MEMORY.md")).expect("file");
        assert!(text.contains("- mine"));
        assert!(!text.contains("from db"));

        let second = run(&pool, &dir, "0.5.0").await.expect("second");
        assert_eq!(second.reason, "already-migrated");
        let text = fs::read_to_string(dir.join("MEMORY.md")).expect("file");
        assert!(!text.contains("from db"));
    }

    #[tokio::test]
    async fn a_lost_marker_does_not_import_twice() {
        let pool = pool().await;
        let dir = root("lostmarker");
        insert(
            &pool,
            "7f2a9c1e-5b6d-4a3f-8c2e-1d0b9a8f7e6d",
            "global",
            None,
            "fact",
            "one",
            1_760_000_000_000,
        )
        .await;
        run(&pool, &dir, "0.5.0").await.expect("first");
        assert!(store::forget(&dir, None, "7f2a9c1e-5b6d-4a3f-8c2e-1d0b9a8f7e6d").expect("forget"));
        sqlx::query("DELETE FROM meta")
            .execute(&pool)
            .await
            .expect("drop marker");
        let second = run(&pool, &dir, "0.5.0").await.expect("second");
        assert_eq!(second.reason, "file-present");
        assert_eq!(second.ids.len(), 1);
        let third = run(&pool, &dir, "0.5.0").await.expect("third");
        assert_eq!(third.reason, "already-migrated");
        let text = fs::read_to_string(dir.join("MEMORY.md")).expect("file");
        assert!(!text.contains("one"));
    }

    #[tokio::test]
    async fn a_two_thousand_char_note_is_kept_whole() {
        let pool = pool().await;
        let dir = root("long");
        let long = "x".repeat(2000);
        insert(
            &pool,
            "7f2a9c1e-5b6d-4a3f-8c2e-1d0b9a8f7e6d",
            "global",
            None,
            "fact",
            &long,
            1_760_000_000_000,
        )
        .await;
        run(&pool, &dir, "0.5.0").await.expect("run");
        let text = fs::read_to_string(dir.join("MEMORY.md")).expect("file");
        assert_eq!(text.matches(&long).count(), 1);
    }

    #[tokio::test]
    async fn a_note_saved_after_the_migration_merges_but_a_deleted_note_stays_deleted() {
        let pool = pool().await;
        let dir = root("late");
        insert(
            &pool,
            "11111111-1111-1111-1111-111111111111",
            "global",
            None,
            "fact",
            "First note",
            1,
        )
        .await;
        insert(
            &pool,
            "22222222-2222-2222-2222-222222222222",
            "global",
            None,
            "fact",
            "Second note",
            2,
        )
        .await;
        let first = run(&pool, &dir, "0.5.0").await.expect("first");
        assert_eq!(first.notes, 2);

        assert!(store::forget(&dir, None, "11111111-1111-1111-1111-111111111111").expect("forget"));
        insert(
            &pool,
            "33333333-3333-3333-3333-333333333333",
            "global",
            None,
            "fact",
            "Added after",
            3,
        )
        .await;

        let second = run(&pool, &dir, "0.5.0").await.expect("second");
        assert!(!second.migrated);
        let doc = store::read(&dir, None).expect("read");
        let texts: Vec<&str> = doc.entries().map(|entry| entry.text.as_str()).collect();
        assert!(texts.contains(&"Second note"));
        assert!(texts.contains(&"Added after"));
        assert!(!texts.contains(&"First note"));

        let third = run(&pool, &dir, "0.5.0").await.expect("third");
        assert!(!third.migrated);
        let doc = store::read(&dir, None).expect("read");
        assert_eq!(doc.entries().count(), 2);
    }
}
