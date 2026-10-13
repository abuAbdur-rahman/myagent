use std::time::Duration;

use serde_json::{Value, json};
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

const OUTPUT_CAP: usize = 32 * 1024;
const ARTIFACT_CAP: usize = 200_000;
const COMMAND_CAP: usize = 8_000;
const MEMORY_CAP: usize = 2_000;

pub struct ArtifactPayload {
    pub title: String,
    pub lang: String,
    pub code: String,
}

pub struct ExecOutput {
    pub output: String,
    pub artifact: Option<ArtifactPayload>,
}

fn arg_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn truncate_tail(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{}…\n[truncated, {} of {} bytes shown]",
        &text[..end],
        end,
        text.len()
    )
}

pub fn tool_specs() -> Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "get_time",
                "description": "Get the current date and time (UTC and local Unix timestamp).",
                "parameters": { "type": "object", "properties": {}, "additionalProperties": false },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "remember",
                "description": "Save a durable fact about the user. Use only when the user asks to remember something or states a lasting preference.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": { "type": "string", "description": "The fact, one or two sentences." },
                        "kind": { "type": "string", "enum": ["fact", "preference", "summary", "note"] },
                        "scope": { "type": "string", "enum": ["global", "project"], "description": "project = current project only, global = every chat." },
                    },
                    "required": ["content"],
                    "additionalProperties": false,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "recall_memory",
                "description": "Search saved memories (global and current project) by keyword.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "limit": { "type": "integer", "minimum": 1, "maximum": 20 },
                    },
                    "required": ["query"],
                    "additionalProperties": false,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "run_powershell",
                "description": "Run a non-interactive Windows PowerShell command and return its output. Prefer read-only inspection (listing files, reading versions); never run destructive commands (deletion, formatting, permission changes) without the user explicitly asking for that exact command.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" },
                        "timeout_secs": { "type": "integer", "minimum": 5, "maximum": 300 },
                    },
                    "required": ["command"],
                    "additionalProperties": false,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "save_artifact",
                "description": "Open a titled code artifact in the user's side panel (with copy and download). Use for complete deliverables the user will reuse. For interactive pages use language html.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "language": { "type": "string", "description": "Short identifier such as html, python, rust, markdown." },
                        "content": { "type": "string" },
                    },
                    "required": ["title", "language", "content"],
                    "additionalProperties": false,
                },
            },
        },
    ])
}

async fn memory_pool(app: &AppHandle) -> AppResult<SqlitePool> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("app data dir: {e}")))?;
    let options = SqliteConnectOptions::new()
        .filename(dir.join("myagent.db"))
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(5));
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| AppError::Internal(format!("memory database: {e}")))
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

pub fn summarize_call(name: &str, args: &Value) -> String {
    match name {
        "remember" => arg_str(args, "content")
            .map(|c| {
                let short: String = c.chars().take(60).collect();
                format!("Remember: {short}")
            })
            .unwrap_or_else(|| "Remember a fact".to_string()),
        "recall_memory" => format!("Recall: {}", arg_str(args, "query").unwrap_or_default()),
        "run_powershell" => {
            let cmd: String = arg_str(args, "command")
                .unwrap_or_default()
                .chars()
                .take(80)
                .collect();
            format!("Run: {cmd}")
        }
        "save_artifact" => format!(
            "Save artifact: {}",
            arg_str(args, "title").unwrap_or_default()
        ),
        _ => name.to_string(),
    }
}

pub async fn execute(
    app: &AppHandle,
    name: &str,
    args: Value,
    project_id: Option<&str>,
) -> Result<ExecOutput, String> {
    match name {
        "get_time" => {
            let now = chrono::Utc::now();
            Ok(ExecOutput {
                output: format!(
                    "{} (unix {})",
                    now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
                    now.timestamp()
                ),
                artifact: None,
            })
        }
        "remember" => {
            let content = arg_str(&args, "content").ok_or("missing content")?;
            if content.chars().count() > MEMORY_CAP {
                return Err("content too long (max 2000 chars)".to_string());
            }
            let kind = arg_str(&args, "kind").unwrap_or_else(|| "fact".to_string());
            if !["fact", "preference", "summary", "note"].contains(&kind.as_str()) {
                return Err("kind must be fact, preference, summary or note".to_string());
            }
            let scope = arg_str(&args, "scope").unwrap_or_else(|| "global".to_string());
            if !["global", "project"].contains(&scope.as_str()) {
                return Err("scope must be global or project".to_string());
            }
            if scope == "project" && project_id.is_none() {
                return Err("no active project for project-scoped memory".to_string());
            }
            let pool = memory_pool(app).await.map_err(|e| e.to_string())?;
            let id = uuid::Uuid::new_v4().to_string();
            let now = now_millis();
            sqlx::query(
                "INSERT INTO memories (id, scope, project_id, kind, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&scope)
            .bind(if scope == "project" { project_id } else { None })
            .bind(&kind)
            .bind(&content)
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .map_err(|e| format!("database: {e}"))?;
            Ok(ExecOutput {
                output: format!("Saved to {scope} memory."),
                artifact: None,
            })
        }
        "recall_memory" => {
            let query = arg_str(&args, "query").ok_or("missing query")?;
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(5)
                .clamp(1, 20) as i64;
            let pool = memory_pool(app).await.map_err(|e| e.to_string())?;
            let pattern = like_pattern(&query);
            let rows: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
                "SELECT kind, content, project_id, scope FROM memories WHERE content LIKE ? ESCAPE '\\' AND (scope = 'global' OR project_id IS ? OR project_id = ?) ORDER BY created_at DESC LIMIT ?",
            )
            .bind(&pattern)
            .bind(project_id)
            .bind(project_id)
            .bind(limit)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("database: {e}"))?;
            if rows.is_empty() {
                return Ok(ExecOutput {
                    output: "No matching memories.".to_string(),
                    artifact: None,
                });
            }
            let lines: Vec<String> = rows
                .into_iter()
                .map(|(kind, content, pid, scope)| {
                    let where_ = if scope == "project" && pid.as_deref() == project_id {
                        "this project"
                    } else {
                        "global"
                    };
                    format!("- ({kind}, {where_}) {content}")
                })
                .collect();
            Ok(ExecOutput {
                output: lines.join("\n"),
                artifact: None,
            })
        }
        "run_powershell" => {
            let command = arg_str(&args, "command").ok_or("missing command")?;
            if command.chars().count() > COMMAND_CAP {
                return Err("command too long (max 8000 chars)".to_string());
            }
            let timeout_secs = args
                .get("timeout_secs")
                .and_then(|v| v.as_u64())
                .unwrap_or(60)
                .clamp(5, 300);
            let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string());
            let child = tokio::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &command])
                .current_dir(&home)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .map_err(|e| format!("spawn: {e}"))?;
            let result =
                tokio::time::timeout(Duration::from_secs(timeout_secs), child.wait_with_output())
                    .await;
            let output = match result {
                Ok(Ok(out)) => out,
                Ok(Err(e)) => return Err(format!("run: {e}")),
                Err(_) => return Err(format!("timed out after {timeout_secs}s")),
            };
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let mut text = format!("exit code: {}\n", output.status.code().unwrap_or(-1));
            if !stdout.trim().is_empty() {
                text.push_str(&format!("stdout:\n{stdout}\n"));
            }
            if !stderr.trim().is_empty() {
                text.push_str(&format!("stderr:\n{stderr}\n"));
            }
            Ok(ExecOutput {
                output: truncate_tail(text.trim_end(), OUTPUT_CAP),
                artifact: None,
            })
        }
        "save_artifact" => {
            let title = arg_str(&args, "title").ok_or("missing title")?;
            let language = arg_str(&args, "language")
                .ok_or("missing language")?
                .to_lowercase();
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty())
                .ok_or("missing content")?;
            if title.chars().count() > 120 {
                return Err("title too long (max 120 chars)".to_string());
            }
            if content.chars().count() > ARTIFACT_CAP {
                return Err("content too long (max 200000 chars)".to_string());
            }
            Ok(ExecOutput {
                output: format!(
                    "Saved artifact '{title}' ({} chars) and opened it in the user's panel.",
                    content.chars().count()
                ),
                artifact: Some(ArtifactPayload {
                    title,
                    lang: language,
                    code: content,
                }),
            })
        }
        other => Err(format!("unknown tool: {other}")),
    }
}
