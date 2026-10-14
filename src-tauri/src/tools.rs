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

pub(crate) fn safe_segment(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect()
}

fn spill_file_path(
    app: &AppHandle,
    conversation_id: &str,
    call_id: &str,
) -> Option<std::path::PathBuf> {
    let conversation = safe_segment(conversation_id);
    let call = safe_segment(call_id);
    if conversation.is_empty() || call.is_empty() {
        return None;
    }
    let dir = app.path().app_data_dir().ok()?;
    Some(
        dir.join("spill")
            .join(conversation)
            .join(format!("{call}.txt")),
    )
}

fn write_spill(
    app: &AppHandle,
    conversation_id: &str,
    call_id: &str,
    text: &str,
) -> Option<String> {
    let path = spill_file_path(app, conversation_id, call_id)?;
    if let Err(error) = std::fs::create_dir_all(path.parent()?) {
        eprintln!("spill: create dir failed: {error}");
        return None;
    }
    if let Err(error) = std::fs::write(&path, text) {
        eprintln!("spill: write failed: {error}");
        return None;
    }
    path.to_str().map(str::to_string)
}

fn cap_output(text: &str, spill: Option<&str>) -> String {
    if text.len() <= OUTPUT_CAP {
        return text.to_string();
    }
    let mut end = OUTPUT_CAP;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    match spill {
        Some(path) => format!(
            "{}...\n[truncated, {} of {} bytes shown; full output at {}]",
            &text[..end],
            end,
            text.len(),
            path
        ),
        None => truncate_tail(text, OUTPUT_CAP),
    }
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
        {
            "type": "function",
            "function": {
                "name": "ask_user",
                "description": "Ask the user a question with fixed options and an optional free-text answer. Use when a choice blocks progress (ambiguous request, destructive scope, missing decision). The user's answer returns as the tool result.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "question": { "type": "string", "description": "The question, one or two sentences." },
                        "options": { "type": "array", "items": { "type": "string" }, "description": "Up to four short options. May be empty when free text suffices.", "maxItems": 4 },
                        "allow_custom": { "type": "boolean", "description": "Offer a free-text answer too (default true)." },
                    },
                    "required": ["question", "options"],
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
        "ask_user" => {
            let short: String = arg_str(args, "question")
                .unwrap_or_default()
                .chars()
                .take(80)
                .collect();
            format!("Ask: {short}")
        }
        _ => name.to_string(),
    }
}

pub struct Question {
    pub question: String,
    pub options: Vec<String>,
    pub allow_custom: bool,
}

pub fn parse_question(args: &Value) -> Result<Question, String> {
    let question = arg_str(args, "question").ok_or("missing question")?;
    if question.chars().count() > 500 {
        return Err("question too long (max 500 chars)".to_string());
    }
    let options: Vec<String> = args
        .get("options")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if options.len() > 4 {
        return Err("options must have at most 4 non-empty entries".to_string());
    }
    if options.iter().any(|o| o.chars().count() > 200) {
        return Err("each option must be at most 200 chars".to_string());
    }
    let allow_custom = args
        .get("allow_custom")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    if options.is_empty() && !allow_custom {
        return Err("a question with no options must allow a custom answer".to_string());
    }
    Ok(Question {
        question,
        options,
        allow_custom,
    })
}

pub async fn execute(
    app: &AppHandle,
    name: &str,
    args: Value,
    call_id: &str,
    conversation_id: Option<&str>,
    project_id: Option<&str>,
    cancel: &tokio::sync::Notify,
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
            let work = async move {
                tokio::time::timeout(Duration::from_secs(timeout_secs), child.wait_with_output())
                    .await
            };
            tokio::pin!(work);
            let result = tokio::select! {
                result = &mut work => result,
                _ = cancel.notified() => {
                    return Err("cancelled by user".to_string());
                }
            };
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
            let full = text.trim_end().to_string();
            let spill = if full.len() > OUTPUT_CAP {
                conversation_id.and_then(|cid| write_spill(app, cid, call_id, &full))
            } else {
                None
            };
            Ok(ExecOutput {
                output: cap_output(&full, spill.as_deref()),
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
        "ask_user" => Err("ask_user is answered by the agent loop".to_string()),
        other => Err(format!("unknown tool: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_valid_question() {
        let question = parse_question(&json!({
            "question": "Deploy now?",
            "options": ["Yes", "No"],
        }))
        .unwrap();
        assert_eq!(question.question, "Deploy now?");
        assert_eq!(question.options, vec!["Yes", "No"]);
        assert!(question.allow_custom);
    }

    #[test]
    fn rejects_bad_questions() {
        assert!(parse_question(&json!({"options": ["A", "B"]})).is_err());
        assert!(parse_question(&json!({"question": "", "options": ["A"]})).is_err());
        assert!(
            parse_question(&json!({"question": "Q?", "options": ["A", "B", "C", "D", "E"]}))
                .is_err()
        );
        assert!(
            parse_question(&json!({"question": "Q?", "options": [], "allow_custom": false}))
                .is_err()
        );
    }

    #[test]
    fn allows_options_free_question() {
        let question = parse_question(&json!({"question": "Q?", "options": []})).unwrap();
        assert!(question.options.is_empty());
        assert!(question.allow_custom);
    }

    #[test]
    fn safe_segment_strips_path_characters() {
        assert_eq!(safe_segment("abc-123_X"), "abc-123_X");
        assert_eq!(safe_segment("../../etc/passwd"), "etcpasswd");
        assert_eq!(safe_segment("call_abc 123!"), "call_abc123");
        assert!(safe_segment("").is_empty());
    }

    #[test]
    fn cap_output_passes_short_text_through() {
        assert_eq!(cap_output("small", None), "small");
        assert_eq!(cap_output("small", Some("C:\\spill\\x.txt")), "small");
    }

    #[test]
    fn cap_output_marks_spill_path_when_present() {
        let long = "x".repeat(OUTPUT_CAP + 100);
        let capped = cap_output(&long, Some("C:\\spill\\chat\\call.txt"));
        assert!(capped.len() < long.len());
        assert!(capped.contains("full output at C:\\spill\\chat\\call.txt"));
        assert!(capped.contains(&format!("of {} bytes shown", long.len())));
        let fallback = cap_output(&long, None);
        assert!(!fallback.contains("full output at"));
        assert!(fallback.contains("truncated"));
    }

    #[test]
    fn cap_output_never_splits_multibyte_chars() {
        let euro = char::from_u32(0x20AC).unwrap().to_string();
        let mut long = "a".repeat(OUTPUT_CAP - 1);
        long.push_str(&euro);
        assert!(long.len() > OUTPUT_CAP);
        let capped = cap_output(&long, None);
        assert!(capped.is_char_boundary(capped.len()));
        assert!(!capped.contains(&euro));
        assert!(capped.contains("truncated"));
    }
}
