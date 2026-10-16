use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

pub const DEFAULT_TIMEOUT_MS: u64 = 60_000;
pub const MAX_TIMEOUTS_BEFORE_RESTART: u32 = 3;
const PROTOCOL_VERSION: &str = "2024-11-05";

pub fn mcp_namespace(server: &str) -> String {
    server
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn mcp_name(server: &str, tool: &str) -> String {
    format!("{}_{}", mcp_namespace(server), mcp_namespace(tool))
}

pub fn split_mcp_name(name: &str) -> Option<(String, String)> {
    let (server, tool) = name.split_once('_')?;
    if server.is_empty() || tool.is_empty() {
        return None;
    }
    Some((server.to_string(), tool.to_string()))
}

pub fn unavailable(server: &str) -> String {
    format!("MCP_UNAVAILABLE:{server}")
}

pub fn timed_out(name: &str) -> String {
    format!("MCP_TIMEOUT:{name}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_sanitize_and_join() {
        assert_eq!(mcp_name("srv-a", "do.things"), "srv-a_do_things");
        assert_eq!(mcp_name("weird name!", "x/y"), "weird_name__x_y");
    }

    #[test]
    fn splits_namespaced_names() {
        assert_eq!(
            split_mcp_name("srv_tool"),
            Some(("srv".to_string(), "tool".to_string()))
        );
        assert!(split_mcp_name("plain").is_none());
        assert!(split_mcp_name("_tool").is_none());
    }

    #[test]
    fn failure_strings_are_model_actionable() {
        assert_eq!(unavailable("fs"), "MCP_UNAVAILABLE:fs");
        assert_eq!(timed_out("fs_read"), "MCP_TIMEOUT:fs_read");
    }
}

#[derive(Debug, Clone)]
pub struct McpToolDef {
    pub server: String,
    pub tool: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone)]
pub struct McpServerConfig {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub transport: String,
    pub cmd: Option<String>,
    pub url: Option<String>,
    pub allow_tools: Option<Vec<String>>,
    pub timeout_ms: Option<u64>,
    pub _enabled: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct McpServerRow {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub transport: String,
    pub cmd: Option<String>,
    pub url: Option<String>,
    pub allow_tools: Option<String>,
    pub timeout_ms: Option<i64>,
    pub enabled: bool,
}

fn valid_server_name(name: &str) -> bool {
    !name.trim().is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[tauri::command]
pub async fn mcp_list(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<Vec<McpServerRow>, String> {
    let pool = crate::tools::memory_pool(&app)
        .await
        .map_err(|e| e.to_string())?;
    let rows: Vec<McpRow> =
        sqlx::query_as("SELECT id, project_id, name, transport, cmd, url, allow_tools, timeout_ms, enabled FROM mcp_servers WHERE project_id IS ? OR project_id IS NULL ORDER BY name ASC")
            .bind(&project_id)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(
            |(id, project_id, name, transport, cmd, url, allow_tools, timeout_ms, enabled)| {
                McpServerRow {
                    id,
                    project_id,
                    name,
                    transport,
                    cmd,
                    url,
                    allow_tools,
                    timeout_ms,
                    enabled: enabled != 0,
                }
            },
        )
        .collect())
}

#[tauri::command]
pub async fn mcp_add(
    app: AppHandle,
    project_id: Option<String>,
    name: String,
    transport: String,
    cmd: Option<String>,
    url: Option<String>,
) -> Result<McpServerRow, String> {
    let name = name.trim().to_string();
    if !valid_server_name(&name) {
        return Err("server name must be 1-64 chars: letters, digits, - or _".to_string());
    }
    if transport != "stdio" && transport != "sse" {
        return Err("transport must be stdio or sse".to_string());
    }
    if transport == "stdio" && cmd.as_deref().is_none_or(|c| c.trim().is_empty()) {
        return Err("stdio servers need a command".to_string());
    }
    if transport == "sse" {
        let endpoint = url.as_deref().unwrap_or("");
        if !endpoint.starts_with("http://") && !endpoint.starts_with("https://") {
            return Err("sse servers need an http(s) url".to_string());
        }
    }
    let pool = crate::tools::memory_pool(&app)
        .await
        .map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    sqlx::query("INSERT INTO mcp_servers (id, project_id, name, transport, cmd, url, allow_tools, timeout_ms, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?)")
        .bind(&id)
        .bind(&project_id)
        .bind(&name)
        .bind(&transport)
        .bind(&cmd)
        .bind(&url)
        .bind(now)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(McpServerRow {
        id,
        project_id,
        name,
        transport,
        cmd,
        url,
        allow_tools: None,
        timeout_ms: None,
        enabled: true,
    })
}

#[tauri::command]
pub async fn mcp_remove(app: AppHandle, id: String) -> Result<(), String> {
    let pool = crate::tools::memory_pool(&app)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM mcp_servers WHERE id = ?")
        .bind(&id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_toggle(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let pool = crate::tools::memory_pool(&app)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("UPDATE mcp_servers SET enabled = ? WHERE id = ?")
        .bind(if enabled { 1 } else { 0 })
        .bind(&id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

struct Session {
    config: McpServerConfig,
    transport: ActiveTransport,
    tools: Vec<McpToolDef>,
    timeouts: u32,
    next_id: u64,
}

type McpRow = (
    String,
    Option<String>,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<i64>,
    i64,
);

struct StdioHandles {
    child: Child,
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
}

enum ActiveTransport {
    Stdio(Box<StdioHandles>),
    Sse { url: String },
}

impl Session {
    fn timeout(&self) -> Duration {
        Duration::from_millis(
            self.config
                .timeout_ms
                .unwrap_or(DEFAULT_TIMEOUT_MS)
                .clamp(1000, 300_000),
        )
    }
}

#[derive(Default)]
pub struct McpState {
    sessions: tokio::sync::Mutex<HashMap<String, Session>>,
}

impl McpState {
    fn key(config: &McpServerConfig) -> String {
        format!(
            "{}\u{1f}{}",
            config.project_id.as_deref().unwrap_or(""),
            config.id
        )
    }
}

fn parse_tools(server: &str, value: &Value) -> Vec<McpToolDef> {
    value
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .map(|tools| {
            tools
                .iter()
                .filter_map(|tool| {
                    let name = tool.get("name")?.as_str()?;
                    Some(McpToolDef {
                        server: server.to_string(),
                        tool: name.to_string(),
                        description: tool
                            .get("description")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string(),
                        input_schema: tool.get("inputSchema").cloned().unwrap_or(json!({
                            "type": "object",
                            "properties": {},
                        })),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn result_text(result: &Value) -> (bool, String) {
    let is_error = result
        .get("isError")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let text = result
        .get("content")
        .and_then(|c| c.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| {
                    if p.get("type").and_then(|t| t.as_str()) == Some("text") {
                        p.get("text").and_then(|t| t.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    (is_error, text)
}

fn initialize_body(id: u64) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "myagent", "version": "0.3.0"},
        },
    })
}

async fn stdio_roundtrip(
    stdin: &mut tokio::process::ChildStdin,
    stdout: &mut BufReader<tokio::process::ChildStdout>,
    timeout: Duration,
    request: &Value,
) -> Result<Value, String> {
    let id = request.get("id").and_then(|v| v.as_u64());
    let mut line = serde_json::to_string(request).map_err(|e| e.to_string())?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    let mut buf = String::new();
    loop {
        buf.clear();
        tokio::select! {
            read = stdout.read_line(&mut buf) => {
                let n = read.map_err(|e| e.to_string())?;
                if n == 0 {
                    return Err("server closed stdio".to_string());
                }
            }
            _ = &mut deadline => return Err("timeout".to_string()),
        }
        let trimmed = buf.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if value.get("method").and_then(|m| m.as_str()) == Some("notifications/tools/list_changed")
        {
            continue;
        }
        if id.is_some_and(|wanted| value.get("id").and_then(|v| v.as_u64()) != Some(wanted)) {
            continue;
        }
        if let Some(error) = value.get("error") {
            let message = error
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown server error");
            return Err(message.to_string());
        }
        return Ok(value);
    }
}

async fn spawn_stdio(config: &McpServerConfig) -> Result<ActiveTransport, String> {
    let cmd = config.cmd.as_deref().unwrap_or("").trim();
    if cmd.is_empty() {
        return Err("stdio server needs a command".to_string());
    }
    let mut parts = cmd.split_whitespace();
    let program = parts.next().ok_or_else(|| "empty command".to_string())?;
    let mut command = Command::new(program);
    command
        .args(parts)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let stdin = child.stdin.take().ok_or_else(|| "no stdin".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    Ok(ActiveTransport::Stdio(Box::new(StdioHandles {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })))
}

fn take_id(session: &mut Session) -> u64 {
    session.next_id += 1;
    session.next_id
}

async fn initialize_session(session: &mut Session) -> Result<(), String> {
    let timeout = session.timeout();
    let name = session.config.name.clone();
    let init_id = take_id(session);
    let list_id = take_id(session);
    match &mut session.transport {
        ActiveTransport::Stdio(handles) => {
            let StdioHandles { stdin, stdout, .. } = handles.as_mut();
            stdio_roundtrip(stdin, stdout, timeout, &initialize_body(init_id)).await?;
            let notify = json!({"jsonrpc": "2.0", "method": "notifications/initialized"});
            let mut line = serde_json::to_string(&notify).map_err(|e| e.to_string())?;
            line.push('\n');
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            let listed = stdio_roundtrip(
                stdin,
                stdout,
                timeout,
                &json!({"jsonrpc": "2.0", "id": list_id, "method": "tools/list", "params": {}}),
            )
            .await?;
            session.tools = filter_tools(&session.config, parse_tools(&name, &listed));
            Ok(())
        }
        ActiveTransport::Sse { url } => {
            let listed_init = sse_request(url, &initialize_body(init_id), timeout).await?;
            let _ = listed_init;
            let tools = sse_request(
                url,
                &json!({"jsonrpc": "2.0", "id": list_id, "method": "tools/list", "params": {}}),
                timeout,
            )
            .await?;
            session.tools = filter_tools(&session.config, parse_tools(&name, &tools));
            Ok(())
        }
    }
}

fn filter_tools(config: &McpServerConfig, tools: Vec<McpToolDef>) -> Vec<McpToolDef> {
    match &config.allow_tools {
        None => tools,
        Some(allow) if allow.is_empty() => tools,
        Some(allow) => tools
            .into_iter()
            .filter(|t| allow.contains(&t.tool))
            .collect(),
    }
}

async fn sse_request(url: &str, request: &Value, timeout: Duration) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let response = tokio::time::timeout(timeout, client.post(url).json(request).send())
        .await
        .map_err(|_| "timeout".to_string())?
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let text = tokio::time::timeout(timeout, response.text())
        .await
        .map_err(|_| "timeout".to_string())?
        .map_err(|e| e.to_string())?;
    let wanted = request.get("id").and_then(|v| v.as_u64());
    for chunk in text.split("data:") {
        let trimmed = chunk.trim();
        if trimmed.is_empty() || trimmed == "[DONE]" {
            continue;
        }
        let end = trimmed
            .find("\n\n")
            .or_else(|| trimmed.find('\n'))
            .unwrap_or(trimmed.len());
        let Ok(value) = serde_json::from_str::<Value>(trimmed[..end].trim()) else {
            continue;
        };
        if wanted.is_some_and(|id| value.get("id").and_then(|v| v.as_u64()) != Some(id)) {
            continue;
        }
        if let Some(error) = value.get("error") {
            let message = error
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown server error");
            return Err(message.to_string());
        }
        return Ok(value);
    }
    Err("no JSON-RPC response".to_string())
}

async fn call_on_session(
    session: &mut Session,
    tool: &str,
    args: &Value,
) -> Result<String, String> {
    let timeout = session.timeout();
    let id = take_id(session);
    let result = match &mut session.transport {
        ActiveTransport::Stdio(handles) => {
            let StdioHandles { stdin, stdout, .. } = handles.as_mut();
            stdio_roundtrip(
                stdin,
                stdout,
                timeout,
                &json!({"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": {"name": tool, "arguments": args}}),
            )
            .await
        }
        ActiveTransport::Sse { url } => {
            sse_request(
                url,
                &json!({"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": {"name": tool, "arguments": args}}),
                timeout,
            )
            .await
        }
    };
    match result {
        Ok(value) => {
            let result = value.get("result").cloned().unwrap_or(Value::Null);
            let (is_error, text) = result_text(&result);
            if is_error {
                return Err(if text.is_empty() {
                    "MCP tool returned an error".to_string()
                } else {
                    text
                });
            }
            Ok(text)
        }
        Err(error) => {
            if error == "timeout" {
                session.timeouts += 1;
            }
            Err(error)
        }
    }
}

fn app_db_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("myagent.db"))
        .map_err(|e| e.to_string())
}

async fn load_configs(
    app: &AppHandle,
    project: Option<&str>,
) -> Result<Vec<McpServerConfig>, String> {
    let path = app_db_path(app)?;
    let url = format!("sqlite:{}?mode=ro", path.to_string_lossy());
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|e| e.to_string())?;
    let rows: Vec<McpRow> =
        sqlx::query_as("SELECT id, project_id, name, transport, cmd, url, allow_tools, timeout_ms, enabled FROM mcp_servers WHERE enabled = 1 AND (project_id IS ? OR project_id IS NULL)")
            .bind(project)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(
            |(id, project_id, name, transport, cmd, url, allow_tools, timeout_ms, enabled)| {
                let allow =
                    allow_tools.and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok());
                McpServerConfig {
                    id,
                    project_id,
                    name,
                    transport,
                    cmd,
                    url,
                    allow_tools: allow,
                    timeout_ms: timeout_ms.map(|v| v as u64),
                    _enabled: enabled != 0,
                }
            },
        )
        .collect())
}

pub async fn flush(app: &AppHandle, project: Option<&str>) -> Result<Vec<McpToolDef>, String> {
    let configs = load_configs(app, project).await?;
    let state = app.state::<McpState>();
    let mut guard = state.sessions.lock().await;
    let live: HashSet<String> = configs.iter().map(McpState::key).collect();
    guard.retain(|key, _| live.contains(key));
    let mut defs = Vec::new();
    for config in configs {
        let key = McpState::key(&config);
        if !guard.contains_key(&key) {
            let transport = if config.transport == "sse" {
                ActiveTransport::Sse {
                    url: config.url.clone().unwrap_or_default(),
                }
            } else {
                match spawn_stdio(&config).await {
                    Ok(transport) => transport,
                    Err(error) => {
                        eprintln!("mcp: spawn {} failed: {error}", config.name);
                        continue;
                    }
                }
            };
            guard.insert(
                key.clone(),
                Session {
                    config,
                    transport,
                    tools: Vec::new(),
                    timeouts: 0,
                    next_id: 0,
                },
            );
        }
        let session = guard.get_mut(&key).expect("just inserted");
        if session.tools.is_empty() {
            match initialize_session(session).await {
                Ok(()) => {}
                Err(error) => {
                    eprintln!("mcp: initialize {} failed: {error}", session.config.name);
                    if let Some(dead) = guard.remove(&key) {
                        kill_session(dead).await;
                    }
                    continue;
                }
            }
        }
        defs.extend(session.tools.clone());
    }
    Ok(defs)
}

pub fn spec_for(def: &McpToolDef) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": mcp_name(&def.server, &def.tool),
            "description": def.description,
            "parameters": def.input_schema,
        },
    })
}

fn find_key(
    guard: &HashMap<String, Session>,
    project: Option<&str>,
    server: &str,
    tool: &str,
) -> Option<String> {
    let mut fallback = None;
    for (key, session) in guard {
        let scope = session.config.project_id.as_deref();
        if scope != project && scope.is_some() {
            continue;
        }
        if mcp_namespace(&session.config.name) != server {
            continue;
        }
        if !session.tools.iter().any(|t| mcp_namespace(&t.tool) == tool) {
            continue;
        }
        if scope == project {
            return Some(key.clone());
        }
        fallback = Some(key.clone());
    }
    fallback
}

async fn kill_session(session: Session) {
    if let ActiveTransport::Stdio(mut handles) = session.transport {
        let _ = handles.child.kill().await;
    }
}

pub async fn try_execute(
    app: &AppHandle,
    project: Option<&str>,
    name: &str,
    args: Value,
    _cancel: &tokio::sync::Notify,
) -> Option<Result<crate::tools::ExecOutput, String>> {
    let (server, tool) = split_mcp_name(name)?;
    let state = app.state::<McpState>();
    let mut guard = state.sessions.lock().await;
    let key = find_key(&guard, project, &server, &tool)?;
    let session = guard.get_mut(&key)?;
    if session.timeouts >= MAX_TIMEOUTS_BEFORE_RESTART {
        if let Some(session) = guard.remove(&key) {
            kill_session(session).await;
        }
        return Some(Err(unavailable(&server)));
    }
    let qualified = mcp_name(&session.config.name, &tool);
    let outcome = call_on_session(session, &tool, &args).await;
    match outcome {
        Ok(text) => {
            if let Some(session) = guard.get_mut(&key) {
                session.timeouts = 0;
            }
            Some(Ok(crate::tools::ExecOutput {
                output: text,
                artifact: None,
            }))
        }
        Err(error) => {
            if error == "timeout" {
                let dead = guard
                    .get(&key)
                    .is_some_and(|s| s.timeouts >= MAX_TIMEOUTS_BEFORE_RESTART);
                if dead {
                    if let Some(session) = guard.remove(&key) {
                        kill_session(session).await;
                    }
                }
                return Some(Err(timed_out(&qualified)));
            }
            Some(Err(error))
        }
    }
}
