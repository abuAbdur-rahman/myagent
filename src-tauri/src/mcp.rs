use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

pub const DEFAULT_TIMEOUT_MS: u64 = 60_000;
pub const MAX_TIMEOUTS_BEFORE_RESTART: u32 = 3;
const MCP_PREFIX: &str = "mcp__";
const PROTOCOL_VERSION: &str = "2024-11-05";
const MAX_MCP_TEXT_BYTES: usize = 64 * 1024;

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
    format!(
        "{MCP_PREFIX}{}__{}",
        mcp_namespace(server),
        mcp_namespace(tool)
    )
}

fn cap_mcp_text(text: String) -> String {
    if text.len() <= MAX_MCP_TEXT_BYTES {
        return text;
    }
    let mut end = MAX_MCP_TEXT_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{}\n[MCP output truncated: {} of {} bytes shown]",
        &text[..end],
        end,
        text.len()
    )
}

fn split_command(cmd: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for ch in cmd.chars() {
        match quote {
            Some(q) => {
                if ch == q {
                    quote = None;
                } else {
                    current.push(ch);
                }
            }
            None => {
                if ch == '"' || ch == '\'' {
                    quote = Some(ch);
                    started = true;
                } else if ch.is_whitespace() {
                    if started {
                        parts.push(std::mem::take(&mut current));
                        started = false;
                    }
                } else {
                    current.push(ch);
                    started = true;
                }
            }
        }
    }
    if started {
        parts.push(current);
    }
    parts
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
        assert_eq!(mcp_name("srv-a", "do.things"), "mcp__srv-a__do_things");
        assert_eq!(mcp_name("weird name!", "x/y"), "mcp__weird_name___x_y");
    }

    #[test]
    fn alias_prefix_cannot_shadow_builtins() {
        for (server, tool) in [("get", "time"), ("recall", "memory"), ("save", "artifact")] {
            let alias = mcp_name(server, tool);
            assert!(alias.starts_with(MCP_PREFIX));
            assert_ne!(alias, format!("{server}_{tool}"));
        }
    }

    #[test]
    fn aliases_are_unambiguous_across_underscores() {
        assert_ne!(mcp_name("fs_server", "read"), mcp_name("fs", "server_read"));
    }

    #[test]
    fn server_namespace_extracts_prefix() {
        assert_eq!(
            server_namespace(&mcp_name("srv-a", "do.things")),
            Some("srv-a")
        );
        assert_eq!(server_namespace("mcp__srv-a"), None);
        assert_eq!(server_namespace("fs_read"), None);
    }

    #[test]
    fn caps_long_output() {
        let short = "ok".to_string();
        assert_eq!(cap_mcp_text(short), "ok");
        let long = "x".repeat(MAX_MCP_TEXT_BYTES + 10);
        let capped = cap_mcp_text(long);
        assert!(capped.starts_with(&"x".repeat(MAX_MCP_TEXT_BYTES)));
        assert!(capped.ends_with("bytes shown]"));
    }

    #[test]
    fn splits_command_respecting_quotes() {
        assert_eq!(split_command("npx -y server"), vec!["npx", "-y", "server"]);
        assert_eq!(
            split_command(r#""C:\Program Files\srv.exe" --port 1"#),
            vec![r"C:\Program Files\srv.exe", "--port", "1"]
        );
        assert_eq!(split_command("  "), Vec::<String>::new());
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
        crate::webfetch::validate_url_opts(endpoint, true, false)
            .map_err(|e| format!("sse url rejected: {e}"))?;
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
    _child: Child,
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

struct CatalogEntry {
    alias: String,
    key: String,
    tool: String,
    project: Option<String>,
}

#[derive(Default)]
pub struct McpState {
    sessions: tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<Session>>>>,
    catalog: std::sync::RwLock<Vec<CatalogEntry>>,
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
            "clientInfo": {"name": "myagent", "version": env!("CARGO_PKG_VERSION")},
        },
    })
}

async fn read_line_capped<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<String>, String> {
    let mut out: Vec<u8> = Vec::new();
    loop {
        let available = reader.fill_buf().await.map_err(|e| e.to_string())?;
        if available.is_empty() {
            if out.is_empty() {
                return Ok(None);
            }
            break;
        }
        let newline = available.iter().position(|&b| b == b'\n');
        let take = newline.map(|i| i + 1).unwrap_or(available.len());
        if out.len() + take > MAX_MCP_TEXT_BYTES {
            return Err("MCP_LINE_TOO_LARGE".to_string());
        }
        out.extend_from_slice(&available[..take]);
        reader.consume(take);
        if newline.is_some() {
            break;
        }
    }
    Ok(Some(String::from_utf8_lossy(&out).into_owned()))
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
    loop {
        let incoming = tokio::select! {
            line = read_line_capped(stdout) => line?,
            _ = &mut deadline => return Err("timeout".to_string()),
        };
        let Some(buf) = incoming else {
            return Err("server closed stdio".to_string());
        };
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
    let parts = split_command(cmd);
    let program = parts.first().ok_or_else(|| "empty command".to_string())?;
    let mut command = Command::new(program);
    command
        .args(&parts[1..])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let stdin = child.stdin.take().ok_or_else(|| "no stdin".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    Ok(ActiveTransport::Stdio(Box::new(StdioHandles {
        _child: child,
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
        Some(allow) => tools
            .into_iter()
            .filter(|t| allow.contains(&t.tool))
            .collect(),
    }
}

async fn read_body_capped(
    mut response: reqwest::Response,
    timeout: Duration,
) -> Result<String, String> {
    let mut buf: Vec<u8> = Vec::new();
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    loop {
        let chunk = tokio::select! {
            chunk = response.chunk() => chunk.map_err(|e| e.to_string())?,
            _ = &mut deadline => return Err("timeout".to_string()),
        };
        match chunk {
            Some(bytes) => {
                if buf.len() + bytes.len() > MAX_MCP_TEXT_BYTES {
                    break;
                }
                buf.extend_from_slice(&bytes);
            }
            None => break,
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

async fn sse_request(url: &str, request: &Value, timeout: Duration) -> Result<Value, String> {
    crate::webfetch::validate_url_opts(url, true, false)
        .map_err(|e| format!("mcp url rejected: {e}"))?;
    let client = reqwest::Client::new();
    let response = tokio::time::timeout(timeout, client.post(url).json(request).send())
        .await
        .map_err(|_| "timeout".to_string())?
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let text = read_body_capped(response, timeout).await?;
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

async fn load_configs(
    app: &AppHandle,
    project: Option<&str>,
) -> Result<Vec<McpServerConfig>, String> {
    let pool = crate::connections::ro_pool(app).await?;
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

async fn collect_catalog(
    state: &McpState,
    configs: &[McpServerConfig],
) -> (Vec<McpToolDef>, Vec<CatalogEntry>) {
    let mut defs: Vec<McpToolDef> = Vec::new();
    let mut catalog: Vec<CatalogEntry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for config in configs {
        let key = McpState::key(config);
        let handle = state.sessions.lock().await.get(&key).cloned();
        let Some(handle) = handle else {
            continue;
        };
        let session = handle.lock().await;
        for def in &session.tools {
            let alias = mcp_name(&def.server, &def.tool);
            if !seen.insert(alias.clone()) {
                eprintln!("mcp: duplicate tool alias {alias} ignored");
                continue;
            }
            defs.push(def.clone());
            catalog.push(CatalogEntry {
                alias,
                key: key.clone(),
                tool: def.tool.clone(),
                project: session.config.project_id.clone(),
            });
        }
    }
    (defs, catalog)
}

fn publish_catalog(state: &McpState, catalog: Vec<CatalogEntry>) {
    if let Ok(mut guard) = state.catalog.write() {
        *guard = catalog;
    }
}

pub async fn flush(app: &AppHandle, project: Option<&str>) -> Result<Vec<McpToolDef>, String> {
    let configs = load_configs(app, project).await?;
    let state = app.state::<McpState>();
    let live: HashSet<String> = configs.iter().map(McpState::key).collect();
    {
        let mut guard = state.sessions.lock().await;
        guard.retain(|key, _| live.contains(key));
    }
    for config in &configs {
        let key = McpState::key(config);
        let existing = state.sessions.lock().await.get(&key).cloned();
        let handle = match existing {
            Some(handle) => handle,
            None => {
                let transport = if config.transport == "sse" {
                    let endpoint = config.url.as_deref().unwrap_or("");
                    if crate::webfetch::validate_url_opts(endpoint, true, false).is_err() {
                        eprintln!("mcp: {} rejected (invalid or non-public url)", config.name);
                        continue;
                    }
                    ActiveTransport::Sse {
                        url: endpoint.to_string(),
                    }
                } else {
                    match spawn_stdio(config).await {
                        Ok(transport) => transport,
                        Err(error) => {
                            eprintln!("mcp: spawn {} failed: {error}", config.name);
                            continue;
                        }
                    }
                };
                let created = Arc::new(tokio::sync::Mutex::new(Session {
                    config: config.clone(),
                    transport,
                    tools: Vec::new(),
                    timeouts: 0,
                    next_id: 0,
                }));
                {
                    let mut session = created.lock().await;
                    if let Err(error) = initialize_session(&mut session).await {
                        eprintln!("mcp: initialize {} failed: {error}", session.config.name);
                        continue;
                    }
                }
                state
                    .sessions
                    .lock()
                    .await
                    .insert(key.clone(), created.clone());
                created
            }
        };
        let mut session = handle.lock().await;
        if session.tools.is_empty() {
            if let Err(error) = initialize_session(&mut session).await {
                eprintln!("mcp: initialize {} failed: {error}", session.config.name);
                continue;
            }
        }
    }
    let (defs, catalog) = collect_catalog(&state, &configs).await;
    publish_catalog(&state, catalog);
    Ok(defs)
}

async fn relist_server(app: &AppHandle, project: Option<&str>, server: &str) -> Result<(), String> {
    let state = app.state::<McpState>();
    let configs = load_configs(app, project).await?;
    let targets: Vec<String> = configs
        .iter()
        .filter(|config| mcp_namespace(&config.name) == server)
        .map(McpState::key)
        .collect();
    let mut relisted = false;
    for key in &targets {
        let handle = state.sessions.lock().await.get(key).cloned();
        let Some(handle) = handle else {
            continue;
        };
        let mut session = handle.lock().await;
        match initialize_session(&mut session).await {
            Ok(()) => relisted = true,
            Err(error) => eprintln!("mcp: re-list {} failed: {error}", session.config.name),
        }
    }
    if !relisted {
        flush(app, project).await?;
        return Ok(());
    }
    let (_defs, catalog) = collect_catalog(&state, &configs).await;
    publish_catalog(&state, catalog);
    Ok(())
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

fn resolve_catalog(
    state: &McpState,
    project: Option<&str>,
    name: &str,
) -> Option<(String, String)> {
    let guard = state.catalog.read().ok()?;
    let mut fallback = None;
    for entry in guard.iter().filter(|entry| entry.alias == name) {
        match entry.project.as_deref() {
            Some(scope) if Some(scope) == project => {
                return Some((entry.key.clone(), entry.tool.clone()));
            }
            None if fallback.is_none() => {
                fallback = Some((entry.key.clone(), entry.tool.clone()));
            }
            _ => {}
        }
    }
    fallback
}

fn server_namespace(name: &str) -> Option<&str> {
    name.strip_prefix(MCP_PREFIX)?
        .split_once("__")
        .map(|(server, _)| server)
}

pub async fn try_execute(
    app: &AppHandle,
    project: Option<&str>,
    name: &str,
    args: Value,
    cancel: &tokio::sync::Notify,
) -> Option<Result<crate::tools::ExecOutput, String>> {
    if !name.starts_with(MCP_PREFIX) {
        return None;
    }
    let state = app.state::<McpState>();
    let mut resolved = resolve_catalog(&state, project, name);
    if resolved.is_none() {
        let refreshed = match server_namespace(name) {
            Some(server) => relist_server(app, project, server).await,
            None => flush(app, project).await.map(|_| ()),
        };
        if let Err(error) = refreshed {
            eprintln!("mcp: refresh for {name} failed: {error}");
        }
        resolved = resolve_catalog(&state, project, name);
    }
    let (key, tool) = resolved?;
    let handle = state.sessions.lock().await.get(&key).cloned()?;
    let mut session = handle.lock().await;
    if session.timeouts >= MAX_TIMEOUTS_BEFORE_RESTART {
        drop(session);
        state.sessions.lock().await.remove(&key);
        return Some(Err(unavailable(name)));
    }
    let outcome = tokio::select! {
        outcome = call_on_session(&mut session, &tool, &args) => outcome,
        _ = cancel.notified() => {
            drop(session);
            state.sessions.lock().await.remove(&key);
            return Some(Err("cancelled by user".to_string()));
        }
    };
    match outcome {
        Ok(text) => {
            session.timeouts = 0;
            Some(Ok(crate::tools::ExecOutput {
                output: cap_mcp_text(text),
                artifact: None,
            }))
        }
        Err(error) => {
            if error == "timeout" {
                let dead = session.timeouts >= MAX_TIMEOUTS_BEFORE_RESTART;
                drop(session);
                if dead {
                    state.sessions.lock().await.remove(&key);
                }
                return Some(Err(timed_out(name)));
            }
            Some(Err(error))
        }
    }
}
