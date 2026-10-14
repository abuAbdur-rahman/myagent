mod error;
mod llm;
mod permissions;
mod sse;
mod state;
mod tools;
mod vault;

use std::time::Duration;

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:myagent.db", migrations)
                .build(),
        )
        .manage(
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .read_timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build HTTP client"),
        )
        .manage(state::StreamState::default())
        .invoke_handler(tauri::generate_handler![
            vault::set_api_key,
            vault::has_api_key,
            vault::delete_api_key,
            llm::list_models,
            llm::cancel_stream,
            llm::chat_stream,
            llm::suggest_title,
            permissions::permission_check,
            permissions::permission_allow,
            permissions::approval_reply,
            permissions::question_answer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
