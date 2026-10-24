mod commands;
mod connections;
mod documents;
mod error;
mod extract;
mod inband;
mod knowledge;
mod llm;
mod mcp;
mod memory;
mod permissions;
mod research;
mod sandbox;
mod screen;
mod skills;
mod sse;
mod state;
mod storage;
mod tools;
mod tooltext;
mod vault;
mod voice;
mod webfetch;
mod websearch;

use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn delete_spill(app: AppHandle, conversation_id: String) -> Result<(), String> {
    let safe = tools::safe_segment(&conversation_id);
    if safe.is_empty() {
        return Err("invalid conversation id".to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("spill")
        .join(safe);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_chat_schema",
            sql: "
                CREATE TABLE IF NOT EXISTS connections (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    default_model TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    connection_id TEXT,
                    model TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_messages_conversation
                    ON messages(conversation_id, created_at);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_projects_and_memories",
            sql: "
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    instructions TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    scope TEXT NOT NULL,
                    project_id TEXT,
                    kind TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_memories_scope
                    ON memories(scope, project_id);
                ALTER TABLE conversations ADD COLUMN project_id TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_conversation_pinned",
            sql: "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_conversation_compacted",
            sql: "ALTER TABLE conversations ADD COLUMN compacted INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_hidden_models",
            sql: "
                CREATE TABLE IF NOT EXISTS hidden_models (
                    connection_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    PRIMARY KEY (connection_id, model_id)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_message_reasoning_usage_finish",
            sql: "
                ALTER TABLE messages ADD COLUMN reasoning TEXT;
                ALTER TABLE messages ADD COLUMN thinking_ms INTEGER;
                ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER;
                ALTER TABLE messages ADD COLUMN completion_tokens INTEGER;
                ALTER TABLE messages ADD COLUMN total_tokens INTEGER;
                ALTER TABLE messages ADD COLUMN finish_reason TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_permission_rules",
            sql: "
                CREATE TABLE IF NOT EXISTS permission_rules (
                    action TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    effect TEXT NOT NULL,
                    project_id TEXT NOT NULL DEFAULT '',
                    PRIMARY KEY (action, resource, project_id)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_message_tool_log",
            sql: "ALTER TABLE messages ADD COLUMN tool_log TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_message_artifacts",
            sql: "ALTER TABLE messages ADD COLUMN artifacts TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add_conversation_summary",
            sql: "
                ALTER TABLE conversations ADD COLUMN summary TEXT;
                ALTER TABLE conversations ADD COLUMN summary_through INTEGER;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add_chat_tags",
            sql: "
                CREATE TABLE IF NOT EXISTS chat_tags (
                    chat_id TEXT NOT NULL,
                    tag TEXT NOT NULL,
                    PRIMARY KEY (chat_id, tag)
                );
                CREATE INDEX IF NOT EXISTS idx_chat_tags_tag ON chat_tags(tag);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add_message_model",
            sql: "ALTER TABLE messages ADD COLUMN model TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add_audit_log",
            sql: "
                CREATE TABLE IF NOT EXISTS audit_log (
                    id TEXT PRIMARY KEY,
                    ts INTEGER NOT NULL,
                    conversation_id TEXT,
                    tool TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    detail TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_audit_log_conversation ON audit_log(conversation_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "add_todos",
            sql: "
                CREATE TABLE IF NOT EXISTS todos (
                    id TEXT PRIMARY KEY,
                    chat_id TEXT NOT NULL,
                    text TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    position INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_todos_chat ON todos(chat_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "add_knowledge_docs",
            sql: "
                CREATE TABLE IF NOT EXISTS knowledge_docs (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    chat_id TEXT,
                    name TEXT NOT NULL,
                    mime TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    path TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                    UNIQUE (project_id, sha256)
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_docs(project_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add_mcp_servers",
            sql: "
                CREATE TABLE IF NOT EXISTS mcp_servers (
                    id TEXT PRIMARY KEY,
                    project_id TEXT,
                    name TEXT NOT NULL,
                    transport TEXT NOT NULL,
                    cmd TEXT,
                    url TEXT,
                    allow_tools TEXT,
                    timeout_ms INTEGER,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    UNIQUE(project_id, name)
                );
                CREATE INDEX IF NOT EXISTS idx_mcp_servers_project ON mcp_servers(project_id);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_global_name ON mcp_servers(name) WHERE project_id IS NULL;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "add_mcp_approval_mode",
            sql: "
                ALTER TABLE mcp_servers ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'ask';
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "add_mcp_deny_tools",
            sql: "ALTER TABLE mcp_servers ADD COLUMN deny_tools TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "add_mcp_ask_tools",
            sql: "ALTER TABLE mcp_servers ADD COLUMN ask_tools TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "add_message_attachments",
            sql: "ALTER TABLE messages ADD COLUMN attachments TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "add_chat_docs",
            sql: "
                CREATE TABLE IF NOT EXISTS chat_docs (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    mime TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    path TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    chars INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                    UNIQUE (conversation_id, sha256)
                );
                CREATE INDEX IF NOT EXISTS idx_chat_docs_conversation ON chat_docs(conversation_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "add_pending_memories",
            sql: "
                CREATE TABLE IF NOT EXISTS pending_memories (
                    id TEXT PRIMARY KEY,
                    scope TEXT NOT NULL,
                    project_id TEXT,
                    kind TEXT NOT NULL,
                    content TEXT NOT NULL,
                    conversation_id TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_pending_memories_project ON pending_memories(project_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "add_memory_source",
            sql: "ALTER TABLE memories ADD COLUMN source_conversation_id TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "add_connection_key_tested_at",
            sql: "ALTER TABLE connections ADD COLUMN key_tested_at INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "add_conversation_system_prompt",
            sql: "ALTER TABLE conversations ADD COLUMN system_prompt TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "add_message_rating",
            sql: "ALTER TABLE messages ADD COLUMN rating INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "add_audit_detail_columns",
            sql: "
                ALTER TABLE audit_log ADD COLUMN duration_ms INTEGER;
                ALTER TABLE audit_log ADD COLUMN exit_code INTEGER;
                ALTER TABLE audit_log ADD COLUMN source TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "add_meta",
            sql: "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "add_pending_memory_trust",
            sql: "ALTER TABLE pending_memories ADD COLUMN trust TEXT NOT NULL DEFAULT 'trusted';",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "add_mcp_auth_type",
            sql: "ALTER TABLE mcp_servers ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'none';",
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending = migrations();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_permission_request(|webview, kind| {
            if matches!(kind, tauri::webview::PermissionKind::Microphone)
                && webview.label() == "main"
                && voice::is_enabled(webview.app_handle())
            {
                tauri::webview::PermissionResponse::Allow
            } else {
                tauri::webview::PermissionResponse::Default
            }
        })
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:myagent.db", pending)
                .build(),
        )
        .setup(|app| {
            crate::screen::init_for_app(app.handle());
            tauri::async_runtime::spawn(async move {
                if let Err(error) = crate::sandbox::reap_orphans().await {
                    eprintln!("sandbox: reaping orphans failed: {error}");
                }
            });
            Ok(())
        })
        .manage(
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .read_timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build HTTP client"),
        )
        .manage(mcp::McpState::default())
        .manage(state::StreamState::default())
        .invoke_handler(tauri::generate_handler![
            vault::set_api_key,
            vault::has_api_key,
            vault::api_key_hint,
            vault::delete_api_key,
            llm::list_models,
            llm::verify_provider,
            llm::list_model_caps,
            llm::cancel_stream,
            llm::chat_stream,
            llm::suggest_title,
            llm::summarize,
            memory::commands::memory_migrate,
            memory::commands::memory_read,
            memory::commands::memory_append,
            memory::commands::memory_update,
            memory::commands::memory_forget,
            memory::commands::memory_write_raw,
            memory::commands::memory_project_delete,
            memory::commands::memory_reset,
            memory::commands::memory_unassigned,
            memory::commands::memory_assign_unassigned,
            memory::commands::memory_discard_unassigned,
            delete_spill,
            storage::storage_usage,
            tools::spill_image_write,
            knowledge::knowledge_sidecar_wipe,
            knowledge::knowledge_sidecar_delete,
            knowledge::knowledge_sidecar_wipe_all,
            documents::attachment_ingest,
            documents::document_read,
            documents::documents_wipe_unreferenced,
            documents::documents_wipe_all,
            websearch::search_key_add,
            websearch::search_key_remove,
            websearch::search_key_list,
            websearch::search_key_test,
            websearch::search_key_stats,
            websearch::search_endpoint_test,
            websearch::search_exa_key_set,
            websearch::search_exa_key_hint,
            websearch::search_exa_test,
            permissions::permission_check,
            permissions::permission_allow,
            skills::skill_index,
            skills::skill_read,
            mcp::mcp_list,
            mcp::mcp_add,
            mcp::mcp_remove,
            mcp::mcp_toggle,
            mcp::mcp_update,
            mcp::mcp_set_policy,
            mcp::mcp_set_approval,
            mcp::mcp_set_token,
            mcp::mcp_delete_token,
            mcp::mcp_status,
            mcp::mcp_probe,
            mcp::mcp_test,
            commands::list_commands_cmd,
            permissions::approval_reply,
            permissions::question_answer,
            sandbox::sandbox_status,
            sandbox::sandbox_enable,
            sandbox::sandbox_disable,
            sandbox::sandbox_rebuild,
            sandbox::sandbox_reap,
            sandbox::sandbox_set_limits,
            voice::voice_status,
            voice::voice_enable,
            voice::voice_disable,
            voice::voice_set_provider,
            voice::audio_transcribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod migration_tests {
    use super::migrations;
    use sqlx::Row;

    async fn pool() -> sqlx::SqlitePool {
        sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory db")
    }

    async fn apply_all(pool: &sqlx::SqlitePool) {
        for migration in migrations() {
            sqlx::raw_sql(migration.sql)
                .execute(pool)
                .await
                .unwrap_or_else(|e| {
                    panic!("migration {} does not apply: {e}", migration.description)
                });
        }
    }

    async fn apply_versions(pool: &sqlx::SqlitePool, keep: impl Fn(i64) -> bool) {
        for migration in migrations().into_iter().filter(|m| keep(m.version)) {
            sqlx::raw_sql(migration.sql)
                .execute(pool)
                .await
                .unwrap_or_else(|e| {
                    panic!("migration {} does not apply: {e}", migration.description)
                });
        }
    }

    #[tokio::test]
    async fn mcp_servers_unique_name_per_project() {
        let pool = pool().await;
        apply_all(&pool).await;
        sqlx::query("INSERT INTO mcp_servers (id, project_id, name, transport, cmd, url, allow_tools, timeout_ms, enabled, created_at) VALUES ('s1', 'p1', 'fs', 'stdio', 'npx srv', NULL, NULL, NULL, 1, 1)")
            .execute(&pool)
            .await
            .expect("first server");
        let dup = sqlx::query("INSERT INTO mcp_servers (id, project_id, name, transport, cmd, url, allow_tools, timeout_ms, enabled, created_at) VALUES ('s2', 'p1', 'fs', 'stdio', 'npx srv', NULL, NULL, NULL, 1, 2)")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "duplicate server name per project rejected");
        sqlx::query("INSERT INTO mcp_servers (id, project_id, name, transport, cmd, url, allow_tools, timeout_ms, enabled, created_at) VALUES ('g1', NULL, 'fs', 'stdio', 'npx srv', NULL, NULL, NULL, 1, 3)")
            .execute(&pool)
            .await
            .expect("first global server");
        let global_dup = sqlx::query("INSERT INTO mcp_servers (id, project_id, name, transport, cmd, url, allow_tools, timeout_ms, enabled, created_at) VALUES ('g2', NULL, 'fs', 'stdio', 'npx srv', NULL, NULL, NULL, 1, 4)")
            .execute(&pool)
            .await;
        assert!(global_dup.is_err(), "duplicate global server name rejected");
    }

    #[tokio::test]
    async fn knowledge_docs_rejects_duplicate_sha_per_project() {
        let pool = pool().await;
        apply_all(&pool).await;
        for id in ["p1", "p2"] {
            sqlx::query(
                "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)",
            )
            .bind(id)
            .bind(id)
            .execute(&pool)
            .await
            .expect("seed project");
        }
        sqlx::query("INSERT INTO knowledge_docs (id, project_id, chat_id, name, mime, sha256, path, size, created_at) VALUES ('k1', 'p1', NULL, 'notes.md', 'text/markdown', 'abc123', 'knowledge/p1/abc123.txt', 9, 1)")
            .execute(&pool)
            .await
            .expect("first ingest");
        let dup = sqlx::query("INSERT INTO knowledge_docs (id, project_id, chat_id, name, mime, sha256, path, size, created_at) VALUES ('k2', 'p1', NULL, 'notes-copy.md', 'text/markdown', 'abc123', 'knowledge/p1/abc123.txt', 9, 2)")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "duplicate sha256 in same project rejected");
        sqlx::query("INSERT INTO knowledge_docs (id, project_id, chat_id, name, mime, sha256, path, size, created_at) VALUES ('k3', 'p2', NULL, 'notes.md', 'text/markdown', 'abc123', 'knowledge/p2/abc123.txt', 9, 3)")
            .execute(&pool)
            .await
            .expect("same sha allowed in another project");
    }

    #[tokio::test]
    async fn chat_docs_reject_duplicate_sha_and_cascade_with_the_chat() {
        let pool = pool().await;
        apply_all(&pool).await;
        sqlx::query("INSERT INTO conversations (id, title, connection_id, model, created_at, updated_at) VALUES ('c1', 'Docs', NULL, NULL, 1, 1)")
            .execute(&pool)
            .await
            .expect("conversation row");
        sqlx::query("INSERT INTO chat_docs (id, conversation_id, name, mime, sha256, path, size, chars, created_at) VALUES ('d1', 'c1', 'report.pdf', 'application/pdf', 'abc123', 'documents/abc123.txt', 4096, 1200, 1)")
            .execute(&pool)
            .await
            .expect("first attachment");
        let dup = sqlx::query("INSERT INTO chat_docs (id, conversation_id, name, mime, sha256, path, size, chars, created_at) VALUES ('d2', 'c1', 'report-copy.pdf', 'application/pdf', 'abc123', 'documents/abc123.txt', 4096, 1200, 2)")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "duplicate sha256 in the same chat rejected");

        sqlx::query("INSERT INTO conversations (id, title, connection_id, model, created_at, updated_at) VALUES ('c2', 'Other', NULL, NULL, 1, 1)")
            .execute(&pool)
            .await
            .expect("second conversation");
        sqlx::query("INSERT INTO chat_docs (id, conversation_id, name, mime, sha256, path, size, chars, created_at) VALUES ('d3', 'c2', 'report.pdf', 'application/pdf', 'abc123', 'documents/abc123.txt', 4096, 1200, 3)")
            .execute(&pool)
            .await
            .expect("same bytes allowed in another chat");

        sqlx::query("DELETE FROM conversations WHERE id = 'c1'")
            .execute(&pool)
            .await
            .expect("delete conversation");
        let remaining: i64 = sqlx::query("SELECT COUNT(*) AS c FROM chat_docs")
            .fetch_one(&pool)
            .await
            .expect("chat_docs readable")
            .get("c");
        assert_eq!(remaining, 1, "cascade removed only the deleted chat's rows");
    }

    #[tokio::test]
    async fn all_migrations_apply_cleanly() {
        let pool = pool().await;
        apply_all(&pool).await;
        let count: i64 = sqlx::query("SELECT COUNT(*) AS c FROM conversations")
            .fetch_one(&pool)
            .await
            .expect("schema readable")
            .get("c");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn a_0_4_1_database_migrates_memory_into_a_file_once() {
        let pool = pool().await;
        apply_all(&pool).await;
        let project = "11111111-2222-3333-4444-555555555555";
        sqlx::query(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, 'Work', 1, 1)",
        )
        .bind(project)
        .execute(&pool)
        .await
        .expect("project");
        for (id, scope, project_id, kind, content) in [
            (
                "aaaaaaaa-1111-2222-3333-444444444444",
                "global",
                None,
                "fact",
                "Prefers short answers",
            ),
            (
                "bbbbbbbb-1111-2222-3333-444444444444",
                "project",
                Some(project),
                "note",
                "Staging first",
            ),
        ] {
            sqlx::query("INSERT INTO memories (id, scope, project_id, kind, content, source_conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 1, 1)")
                .bind(id)
                .bind(scope)
                .bind(project_id)
                .bind(kind)
                .bind(content)
                .execute(&pool)
                .await
                .expect("memory");
        }
        sqlx::query("INSERT INTO pending_memories (id, scope, project_id, kind, content, conversation_id, created_at) VALUES ('p1', 'global', NULL, 'note', 'old pending', NULL, 1)")
            .execute(&pool)
            .await
            .expect("pending");

        let dir = std::env::temp_dir().join(format!("myagent-upgrade-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let report = crate::memory::migrate::run(&pool, &dir, "0.5.0")
            .await
            .expect("migrate");
        assert!(report.migrated);
        assert_eq!(report.notes, 2);
        let global = std::fs::read_to_string(dir.join("MEMORY.md")).expect("global file");
        assert!(global.contains("Prefers short answers"));
        let project_file =
            std::fs::read_to_string(dir.join("projects").join(format!("{project}.md")))
                .expect("project file");
        assert!(project_file.contains("Staging first"));

        let trust: String =
            sqlx::query_scalar("SELECT trust FROM pending_memories WHERE id = 'p1'")
                .fetch_one(&pool)
                .await
                .expect("pending survives");
        assert_eq!(trust, "trusted");

        let again = crate::memory::migrate::run(&pool, &dir, "0.5.0")
            .await
            .expect("second run");
        assert!(!again.migrated);
        assert_eq!(
            std::fs::read_to_string(dir.join("MEMORY.md"))
                .expect("global file")
                .matches("Prefers short answers")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn shipped_sqlite_searches_fts5() {
        let pool = pool().await;
        apply_all(&pool).await;
        sqlx::query("INSERT INTO conversations (id, title, connection_id, model, created_at, updated_at) VALUES ('c1', 'Rust notes', NULL, NULL, 1, 1)")
            .execute(&pool)
            .await
            .expect("seed chat");
        sqlx::query("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('m1', 'c1', 'user', 'how do async runtimes work', 2)")
            .execute(&pool)
            .await
            .expect("seed message");
        sqlx::query("CREATE VIRTUAL TABLE probe_fts USING fts5(content)")
            .execute(&pool)
            .await
            .expect("fts5 available in shipped sqlite");
        sqlx::query("INSERT INTO probe_fts (content) VALUES ('how do async runtimes work')")
            .execute(&pool)
            .await
            .expect("fts insert");
        let hit: String =
            sqlx::query("SELECT snippet(probe_fts, 0, '', '', '…', 12) AS s FROM probe_fts WHERE probe_fts MATCH '\"async\"'")
                .fetch_one(&pool)
                .await
                .expect("fts match")
                .get("s");
        assert!(hit.contains("async"), "snippet carries the term");
        let rank: f64 = sqlx::query(
            "SELECT bm25(probe_fts) AS r FROM probe_fts WHERE probe_fts MATCH '\"async\"'",
        )
        .fetch_one(&pool)
        .await
        .expect("bm25 ranks")
        .get("r");
        assert!(rank.is_finite(), "bm25 returns a score");
    }

    #[tokio::test]
    async fn chat_tags_enforce_uniqueness() {
        let pool = pool().await;
        apply_all(&pool).await;
        sqlx::query("INSERT INTO chat_tags (chat_id, tag) VALUES ('c1', 'rust')")
            .execute(&pool)
            .await
            .expect("first tag");
        let dup = sqlx::query("INSERT INTO chat_tags (chat_id, tag) VALUES ('c1', 'rust')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "duplicate chat tag rejected");
    }

    #[tokio::test]
    async fn audit_log_stores_decision_rows() {
        let pool = pool().await;
        apply_all(&pool).await;
        sqlx::query("INSERT INTO audit_log (id, ts, conversation_id, tool, decision, detail) VALUES ('a1', 7, 'c1', 'web_fetch', 'once', 'example.com')")
            .execute(&pool)
            .await
            .expect("audit row");
        let detail: String =
            sqlx::query("SELECT detail AS d FROM audit_log WHERE tool = 'web_fetch'")
                .fetch_one(&pool)
                .await
                .expect("audit readable")
                .get("d");
        assert_eq!(detail, "example.com");
    }

    #[tokio::test]
    async fn audit_columns_migrate_an_old_row_without_data_loss() {
        let pool = pool().await;
        apply_versions(&pool, |version| version <= 26).await;
        sqlx::query("INSERT INTO audit_log (id, ts, conversation_id, tool, decision, detail) VALUES ('old', 7, 'c1', 'web_fetch', 'once', 'example.com')")
            .execute(&pool)
            .await
            .expect("old audit row");
        apply_versions(&pool, |version| version > 26).await;
        let row = sqlx::query(
            "SELECT detail, duration_ms, exit_code, source FROM audit_log WHERE id = 'old'",
        )
        .fetch_one(&pool)
        .await
        .expect("old row survives");
        let detail: String = row.get("detail");
        let duration: Option<i64> = row.get("duration_ms");
        let exit: Option<i64> = row.get("exit_code");
        let source: Option<String> = row.get("source");
        assert_eq!(detail, "example.com");
        assert_eq!(duration, None);
        assert_eq!(exit, None);
        assert_eq!(source, None);
    }

    #[tokio::test]
    async fn todos_are_per_chat() {
        let pool = pool().await;
        apply_all(&pool).await;
        sqlx::query("INSERT INTO todos (id, chat_id, text, status, position, created_at, updated_at) VALUES ('t1', 'c1', 'first', 'pending', 0, 1, 1)")
            .execute(&pool)
            .await
            .expect("todo row");
        let count: i64 = sqlx::query("SELECT COUNT(*) AS c FROM todos WHERE chat_id = 'c1'")
            .fetch_one(&pool)
            .await
            .expect("todos readable")
            .get("c");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn mcp_schema_upgrades_from_v16_without_data_loss() {
        let pool = pool().await;
        apply_versions(&pool, |v| v <= 16).await;

        sqlx::query("INSERT INTO connections (id, name, base_url, kind, default_model, created_at) VALUES ('c1', 'Local', 'https://openrouter.ai/api/v1', 'openai', NULL, 1)")
            .execute(&pool)
            .await
            .expect("connection row");
        sqlx::query("INSERT INTO projects (id, name, description, instructions, created_at, updated_at) VALUES ('p1', 'Work', '', '', 1, 1)")
            .execute(&pool)
            .await
            .expect("project row");
        sqlx::query("INSERT INTO conversations (id, title, connection_id, model, created_at, updated_at, project_id) VALUES ('v1', 'Hi', 'c1', 'm', 1, 1, 'p1')")
            .execute(&pool)
            .await
            .expect("conversation row");
        sqlx::query("INSERT INTO memories (id, scope, project_id, kind, content, created_at, updated_at) VALUES ('m1', 'project', 'p1', 'fact', 'uses sqlite', 1, 1)")
            .execute(&pool)
            .await
            .expect("memory row");
        sqlx::query("INSERT INTO mcp_servers (id, project_id, name, transport, cmd, url, allow_tools, timeout_ms, enabled, created_at) VALUES ('s1', NULL, 'fs', 'stdio', 'npx srv', NULL, '[\"read\"]', 5000, 1, 1)")
            .execute(&pool)
            .await
            .expect("mcp row");

        apply_versions(&pool, |v| v > 16).await;

        let row = sqlx::query("SELECT name, transport, cmd, allow_tools, timeout_ms, enabled, approval_mode, deny_tools, ask_tools, auth_type FROM mcp_servers WHERE id = 's1'")
            .fetch_one(&pool)
            .await
            .expect("server survives the upgrade");
        assert_eq!(row.get::<String, _>("name"), "fs");
        assert_eq!(row.get::<String, _>("transport"), "stdio");
        assert_eq!(row.get::<String, _>("cmd"), "npx srv");
        assert_eq!(row.get::<String, _>("allow_tools"), "[\"read\"]");
        assert_eq!(row.get::<i64, _>("timeout_ms"), 5000);
        assert_eq!(row.get::<i64, _>("enabled"), 1);
        assert_eq!(
            row.get::<String, _>("approval_mode"),
            "ask",
            "existing rows keep asking per call"
        );
        assert_eq!(row.get::<Option<String>, _>("deny_tools"), None);
        assert_eq!(row.get::<Option<String>, _>("ask_tools"), None);
        assert_eq!(
            row.get::<String, _>("auth_type"),
            "none",
            "existing rows keep the unauthenticated transport"
        );

        let servers: i64 = sqlx::query("SELECT COUNT(*) AS c FROM mcp_servers")
            .fetch_one(&pool)
            .await
            .expect("server count")
            .get("c");
        let chats: i64 = sqlx::query("SELECT COUNT(*) AS c FROM conversations")
            .fetch_one(&pool)
            .await
            .expect("chat count")
            .get("c");
        let facts: i64 = sqlx::query("SELECT COUNT(*) AS c FROM memories")
            .fetch_one(&pool)
            .await
            .expect("memory count")
            .get("c");
        assert_eq!((servers, chats, facts), (1, 1, 1), "upgrade drops no rows");
    }
}
