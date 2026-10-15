use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::sync::Notify;

use crate::error::{AppError, AppResult};
use crate::permissions::{self, ApprovalReply};
use crate::sse;
use crate::state::{PendingApproval, StreamState};
use crate::tools;
use crate::vault;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta {
        text: String,
    },
    Reasoning {
        text: String,
    },
    Retract {
        chars: usize,
    },
    Usage {
        prompt_tokens: u64,
        completion_tokens: u64,
        total_tokens: u64,
    },
    Finish {
        reason: Option<String>,
    },
    Retrying {
        attempt: u32,
        max: u32,
    },
    Done,
    ToolStart {
        id: String,
        name: String,
        summary: String,
    },
    ToolResult {
        id: String,
        ok: bool,
        preview: String,
    },
    ApprovalAsked {
        id: String,
        tool: String,
        command: String,
        cwd: String,
    },
    QuestionAsked {
        id: String,
        question: String,
        options: Vec<String>,
        allow_custom: bool,
    },
    Artifact {
        title: String,
        lang: String,
        code: String,
    },
}

#[derive(Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct ChatRequest {
    pub request_id: String,
    pub base_url: String,
    pub connection_id: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    #[serde(default)]
    pub enable_tools: bool,
    #[serde(default)]
    pub max_iterations: Option<u8>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub connection_kind: Option<String>,
}

#[derive(Deserialize)]
pub struct TitleRequest {
    pub base_url: String,
    pub connection_id: String,
    pub model: String,
    pub user_text: String,
    pub assistant_text: String,
    #[serde(default)]
    pub connection_kind: Option<String>,
}

fn effort_allowed(caps: Option<&ModelCaps>, effort: &str) -> bool {
    let Some(entry) = caps else {
        return true;
    };
    if entry.supports_reasoning == Some(false) {
        return false;
    }
    if let Some(efforts) = &entry.efforts {
        return efforts.iter().any(|level| level == effort);
    }
    true
}

fn uses_unified_reasoning(kind: Option<&str>) -> bool {
    matches!(kind, Some("openrouter" | "agentrouter"))
}

async fn apply_optional_params(
    client: &reqwest::Client,
    body: &mut serde_json::Value,
    req: &ChatRequest,
    key: &str,
) {
    if let Some(temperature) = req.temperature {
        body["temperature"] = serde_json::json!(temperature);
    }
    let Some(effort) = req
        .reasoning_effort
        .as_deref()
        .filter(|e| !e.is_empty() && *e != "none")
    else {
        return;
    };
    let caps = fetch_model_caps(client, &req.base_url, key, req.connection_kind.as_deref())
        .await
        .ok()
        .and_then(|entries| entries.into_iter().find(|entry| entry.id == req.model));
    if !effort_allowed(caps.as_ref(), effort) {
        return;
    }
    if uses_unified_reasoning(req.connection_kind.as_deref()) {
        body["reasoning"] = serde_json::json!({ "effort": effort });
    } else {
        body["reasoning_effort"] = serde_json::json!(effort);
    }
}

fn truncate_chars(text: &str, max: usize) -> String {
    let truncated: String = text.chars().take(max).collect();
    if text.chars().count() > max {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn truncate_preview(text: &str) -> String {
    truncate_chars(text.trim(), 500)
}

fn endpoint(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn is_agentrouter_url(url: &str) -> bool {
    url.contains("agentrouter.org")
}

fn is_agentrouter(kind: Option<&str>, url: &str) -> bool {
    kind == Some("agentrouter") || is_agentrouter_url(url)
}

fn agentrouter_headers(
    request: reqwest::RequestBuilder,
    kind: Option<&str>,
    url: &str,
) -> reqwest::RequestBuilder {
    if is_agentrouter(kind, url) {
        request
            .header("User-Agent", "codex_cli_rs/0.114.0")
            .header("originator", "codex_cli_rs")
    } else {
        request
    }
}

fn wants_stream_usage(kind: Option<&str>) -> bool {
    !matches!(kind, Some("agentrouter"))
}

fn is_deepseek_model(model: &str) -> bool {
    model.to_lowercase().contains("deepseek")
}

fn deepseek_guard_active(model: &str, kind: Option<&str>, url: &str) -> bool {
    is_deepseek_model(model) && is_agentrouter(kind, url)
}

fn is_content_blocked_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("content-blocked") && lower.contains("agent_router_api_error")
}

fn is_content_blocked_error(error: &AppError) -> bool {
    matches!(error, AppError::Upstream(message) if is_content_blocked_message(message))
}

fn content_blocked_request_id(message: &str) -> Option<String> {
    let marker = "request id:";
    let start = message.to_ascii_lowercase().find(marker)? + marker.len();
    let id: String = message[start..]
        .trim_start()
        .chars()
        .take_while(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect();
    if id.is_empty() { None } else { Some(id) }
}

fn describe_content_blocked(message: &str) -> String {
    match content_blocked_request_id(message) {
        Some(id) => format!(
            "DeepSeek declined the prompt (content-blocked, request {id}). Rephrase the first message in plain English and retry."
        ),
        None => "DeepSeek declined the prompt (content-blocked). Rephrase the first message in plain English and retry."
            .to_string(),
    }
}

fn sanitize_deepseek_text(text: &str) -> String {
    const REPLACEMENTS: &[(&str, &str)] = &[
        ("Lorem ipsum", "example text"),
        ("lorem ipsum", "example text"),
        ("language model", "large language model"),
        ("Language model", "Large language model"),
        ("virtual assistant", "AI assistant"),
        ("Virtual assistant", "AI assistant"),
        ("I'm here to help", "How can I help"),
        ("here to help", "How can I help"),
        ("placeholder", "example value"),
        ("Placeholder", "Example value"),
        ("dummy data", "sample data"),
        ("Dummy data", "Sample data"),
    ];
    let mut out = text.to_string();
    for (from, to) in REPLACEMENTS {
        out = out.replace(from, to);
    }
    out
}

const DEEPSEEK_CONTEXT_MARK: &str = "[myagent-request]";

fn ends_with_bare_token(text: &str) -> bool {
    let Some(last) = text.split_whitespace().last() else {
        return false;
    };
    let token: String = last
        .trim_matches(|c: char| ".,;:!?()[]{}\"'".contains(c))
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    token.len() >= 6
        && token
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '_' || c == '-')
}

fn deepseek_first_turn(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return format!(
            "{DEEPSEEK_CONTEXT_MARK} The user sent an empty message. Ask what they would like help with."
        );
    }
    let needs_frame = !trimmed.contains(DEEPSEEK_CONTEXT_MARK)
        && (trimmed.chars().count() < 20 || !trimmed.is_ascii() || ends_with_bare_token(trimmed));
    if needs_frame {
        format!(
            "{DEEPSEEK_CONTEXT_MARK} Please handle the following user request. Respond in the user's language.\n\n{trimmed}"
        )
    } else {
        trimmed.to_string()
    }
}

fn harden_deepseek_history(
    history: Vec<serde_json::Value>,
    model: &str,
    kind: Option<&str>,
    url: &str,
) -> Vec<serde_json::Value> {
    if !deepseek_guard_active(model, kind, url) {
        return history;
    }
    let mut out = history;
    let Some(first) = out
        .iter_mut()
        .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
    else {
        return out;
    };
    let Some(text) = first.get("content").and_then(|v| v.as_str()) else {
        return out;
    };
    if text.contains(DEEPSEEK_CONTEXT_MARK) {
        return out;
    }
    let cleaned = sanitize_deepseek_text(text);
    first["content"] = serde_json::json!(deepseek_first_turn(&cleaned));
    out
}

fn agentrouter_pace() -> &'static Mutex<Option<Instant>> {
    static LAST: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
    LAST.get_or_init(|| Mutex::new(None))
}

async fn pace_agentrouter(url: &str, cancel: &Notify) -> bool {
    if !is_agentrouter_url(url) {
        return false;
    }
    let wait = {
        let mut guard = agentrouter_pace().lock().expect("pace lock");
        let now = Instant::now();
        let wait = match *guard {
            Some(next) if next > now => next - now,
            _ => Duration::from_millis(0),
        };
        *guard = Some(now + wait + Duration::from_millis(500));
        wait
    };
    sleep_or_cancel(wait, cancel).await
}

async fn error_body(resp: reqwest::Response) -> String {
    let status = resp.status();
    match resp.text().await {
        Ok(body) if !body.is_empty() => format!("{status}: {body}"),
        Ok(_) => status.to_string(),
        Err(e) => format!("{status} (unreadable body: {e})"),
    }
}

fn is_cancel_shutdown(error: &AppError) -> bool {
    matches!(error, AppError::Cancelled)
}

fn is_retryable_tools_error(error: &AppError) -> bool {
    match error {
        AppError::Upstream(message) => {
            let lower = message.to_lowercase();
            lower.contains("tool")
                || lower.contains("upstream rejected")
                || lower.starts_with("400")
                || lower.starts_with("404")
                || lower.starts_with("422")
                || lower.starts_with("500")
                || lower.starts_with("502")
                || lower.starts_with("503")
                || lower.starts_with("504")
        }
        _ => false,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelCaps {
    pub id: String,
    pub context_length: Option<u64>,
    pub supports_tools: Option<bool>,
    pub supports_reasoning: Option<bool>,
    pub efforts: Option<Vec<String>>,
    pub mandatory: bool,
}

fn parse_models_caps(value: &serde_json::Value) -> Vec<ModelCaps> {
    let mut caps: Vec<ModelCaps> = value
        .get("data")
        .and_then(|data| data.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id")?.as_str()?;
                    if let Some(types) = item
                        .get("supported_endpoint_types")
                        .and_then(|t| t.as_array())
                    {
                        let openai = types
                            .iter()
                            .any(|t| t.as_str().is_some_and(|s| s.eq_ignore_ascii_case("openai")));
                        if !openai {
                            return None;
                        }
                    }
                    let params: Option<Vec<&str>> = item
                        .get("supported_parameters")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|t| t.as_str()).collect());
                    let reasoning = item.get("reasoning");
                    let efforts = reasoning
                        .and_then(|r| r.get("supported_efforts"))
                        .and_then(|e| e.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|t| t.as_str().map(str::to_string))
                                .collect()
                        });
                    let has_reasoning_param = params.as_ref().is_some_and(|p| {
                        p.contains(&"reasoning") || p.contains(&"include_reasoning")
                    });
                    Some(ModelCaps {
                        id: id.to_string(),
                        context_length: item.get("context_length").and_then(|v| v.as_u64()),
                        supports_tools: params
                            .as_ref()
                            .map(|p| p.contains(&"tools") || p.contains(&"tool_choice")),
                        supports_reasoning: match (has_reasoning_param, reasoning.is_some()) {
                            (false, false) if params.is_some() => Some(false),
                            (false, false) => None,
                            _ => Some(true),
                        },
                        efforts,
                        mandatory: reasoning
                            .and_then(|r| r.get("mandatory"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    caps.sort_by(|a, b| a.id.cmp(&b.id));
    caps
}

const CAPS_TTL: Duration = Duration::from_secs(86_400);

type CapsEntry = (Instant, Vec<ModelCaps>);

fn caps_cache() -> &'static Mutex<HashMap<String, CapsEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CapsEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn fetch_model_caps(
    client: &reqwest::Client,
    base_url: &str,
    key: &str,
    kind: Option<&str>,
) -> AppResult<Vec<ModelCaps>> {
    let fresh = caps_cache()
        .lock()
        .expect("caps cache lock")
        .get(base_url)
        .filter(|(at, _)| at.elapsed() < CAPS_TTL)
        .map(|(_, caps)| caps.clone());
    if let Some(caps) = fresh {
        return Ok(caps);
    }
    let url = endpoint(base_url, "models");
    let request = agentrouter_headers(client.get(url.as_str()).bearer_auth(key), kind, &url);
    let resp = request.send().await?;
    if !resp.status().is_success() {
        if let Some((_, stale)) = caps_cache()
            .lock()
            .expect("caps cache lock")
            .get(base_url)
            .cloned()
        {
            return Ok(stale);
        }
        return Err(AppError::Upstream(error_body(resp).await));
    }
    let value: serde_json::Value = resp.json().await?;
    let caps = parse_models_caps(&value);
    caps_cache()
        .lock()
        .expect("caps cache lock")
        .insert(base_url.to_string(), (Instant::now(), caps.clone()));
    Ok(caps)
}

#[tauri::command]
pub async fn list_model_caps(
    base_url: String,
    connection_id: String,
    connection_kind: Option<String>,
    client: State<'_, reqwest::Client>,
) -> AppResult<Vec<ModelCaps>> {
    let key = vault::get_api_key(&connection_id)?;
    fetch_model_caps(&client, &base_url, &key, connection_kind.as_deref()).await
}

#[tauri::command]
pub async fn list_models(
    base_url: String,
    connection_id: String,
    connection_kind: Option<String>,
    client: State<'_, reqwest::Client>,
) -> AppResult<Vec<String>> {
    let key = vault::get_api_key(&connection_id)?;
    Ok(
        fetch_model_caps(&client, &base_url, &key, connection_kind.as_deref())
            .await?
            .into_iter()
            .map(|caps| caps.id)
            .collect(),
    )
}

#[tauri::command]
pub fn cancel_stream(request_id: String, state: State<'_, StreamState>) -> AppResult<()> {
    state.cancel(&request_id)
}

#[derive(Deserialize)]
pub struct SummaryRequest {
    pub base_url: String,
    pub connection_id: String,
    pub model: String,
    pub text: String,
    #[serde(default)]
    pub connection_kind: Option<String>,
}

fn summary_body(model: &str, text: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "Summarize this chat excerpt for context compaction. Reply with terse bullets under exactly these headings. Keep every file path, command, and model name verbatim. Under 300 words, plain text, no preamble.\n## Objective\n## Decisions\n## Work State\n### Completed\n### Active\n## Next Move\n## Relevant Files (max 15)",
            },
            {
                "role": "user",
                "content": truncate_chars(text.trim(), 12_000),
            },
        ],
        "max_tokens": 500,
        "temperature": 0.2,
        "stream": false,
    })
}

#[tauri::command]
pub async fn summarize(
    req: SummaryRequest,
    client: State<'_, reqwest::Client>,
) -> AppResult<String> {
    let key = vault::get_api_key(&req.connection_id)?;
    let cancel = Notify::new();
    let resp = post_with_retry(
        &client,
        &endpoint(&req.base_url, "chat/completions"),
        &key,
        &summary_body(&req.model, &req.text),
        &cancel,
        None,
        req.connection_kind.as_deref(),
    )
    .await?;
    let value: serde_json::Value = resp.json().await.map_err(AppError::from)?;
    let summary = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    if summary.is_empty() {
        return Err(AppError::Upstream("empty summary".to_string()));
    }
    Ok(summary.chars().take(2000).collect())
}

#[tauri::command]
pub async fn suggest_title(
    req: TitleRequest,
    client: State<'_, reqwest::Client>,
) -> AppResult<String> {
    let key = vault::get_api_key(&req.connection_id)?;
    let url = endpoint(&req.base_url, "chat/completions");
    let body = serde_json::json!({
        "model": req.model,
        "messages": [
            {
                "role": "system",
                "content": "Title this conversation in 6 words or fewer. Plain text only: no quotes, no punctuation, no preamble.",
            },
            {
                "role": "user",
                "content": format!(
                    "User asked: {}\n\nAssistant answered (excerpt): {}",
                    truncate_chars(req.user_text.trim(), 300),
                    truncate_chars(req.assistant_text.trim(), 500),
                ),
            },
        ],
        "max_tokens": 512,
        "temperature": 0.3,
        "stream": false,
    });

    let cancel = Notify::new();
    let resp = post_with_retry(
        &client,
        &url,
        &key,
        &body,
        &cancel,
        None,
        req.connection_kind.as_deref(),
    )
    .await?;

    let value: serde_json::Value = resp.json().await?;
    let title = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '.' || c == ':')
        .trim()
        .to_string();
    let title: String = title.chars().take(60).collect();
    if title.is_empty() {
        return Err(AppError::Upstream("empty title".to_string()));
    }
    Ok(title)
}

#[tauri::command]
pub async fn chat_stream(
    req: ChatRequest,
    on_event: Channel<StreamEvent>,
    state: State<'_, StreamState>,
    client: State<'_, reqwest::Client>,
    app: AppHandle,
) -> AppResult<()> {
    let key = vault::get_api_key(&req.connection_id)?;
    let cancel = state.register(&req.request_id)?;

    let result = if req.enable_tools {
        run_agentic(&client, &app, &req, key, &on_event, &cancel, &state).await
    } else {
        let history: Vec<serde_json::Value> = req
            .messages
            .iter()
            .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
            .collect();
        stream_completion(&client, &req, key, history, &on_event, &cancel).await
    };
    state.finish(&req.request_id);
    result
}

const MAX_ATTEMPTS: u32 = 3;

fn retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

fn retry_after_secs(resp: &reqwest::Response) -> Option<u64> {
    resp.headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
}

fn backoff_delay(attempt: u32, retry_after_secs: Option<u64>) -> Duration {
    if let Some(secs) = retry_after_secs {
        return Duration::from_secs(secs.min(30));
    }
    let base_ms = 500u64.saturating_mul(2u64.pow(attempt.min(4)));
    let jitter_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::from(d.subsec_nanos() % 250))
        .unwrap_or(0);
    Duration::from_millis(base_ms + jitter_ms)
}

async fn sleep_or_cancel(delay: Duration, cancel: &Notify) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(delay) => false,
        _ = cancel.notified() => true,
    }
}

async fn post_with_retry(
    client: &reqwest::Client,
    url: &str,
    key: &str,
    body: &serde_json::Value,
    cancel: &Notify,
    on_event: Option<&Channel<StreamEvent>>,
    kind: Option<&str>,
) -> AppResult<reqwest::Response> {
    if pace_agentrouter(url, cancel).await {
        return Err(AppError::Cancelled);
    }
    let mut last_error: Option<AppError> = None;
    let mut blocked_retries = 0u32;
    for attempt in 0..MAX_ATTEMPTS {
        let request = agentrouter_headers(client.post(url).bearer_auth(key), kind, url);
        match request.json(body).send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return Ok(resp);
                }
                if status == reqwest::StatusCode::BAD_REQUEST {
                    let message = error_body(resp).await;
                    if is_content_blocked_message(&message) {
                        if blocked_retries < 2 {
                            blocked_retries += 1;
                            if sleep_or_cancel(
                                Duration::from_millis(1500 * u64::from(blocked_retries)),
                                cancel,
                            )
                            .await
                            {
                                return Err(AppError::Cancelled);
                            }
                            continue;
                        }
                        return Err(AppError::Upstream(describe_content_blocked(&message)));
                    }
                    return Err(AppError::Upstream(message));
                }
                if retryable_status(status) && attempt + 1 < MAX_ATTEMPTS {
                    let wait = backoff_delay(attempt, retry_after_secs(&resp));
                    drop(resp);
                    if let Some(ch) = on_event {
                        let _ = ch.send(StreamEvent::Retrying {
                            attempt: attempt + 2,
                            max: MAX_ATTEMPTS,
                        });
                    }
                    if sleep_or_cancel(wait, cancel).await {
                        return Err(AppError::Cancelled);
                    }
                    continue;
                }
                return Err(AppError::Upstream(error_body(resp).await));
            }
            Err(error) => {
                last_error = Some(AppError::from(error));
                if attempt + 1 < MAX_ATTEMPTS {
                    if let Some(ch) = on_event {
                        let _ = ch.send(StreamEvent::Retrying {
                            attempt: attempt + 2,
                            max: MAX_ATTEMPTS,
                        });
                    }
                    if sleep_or_cancel(backoff_delay(attempt, None), cancel).await {
                        return Err(AppError::Cancelled);
                    }
                    continue;
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| AppError::Network("retry exhausted".to_string())))
}

fn approval_resources(name: &str, args: &serde_json::Value) -> Vec<String> {
    if name == "run_powershell" {
        if let Some(command) = args.get("command").and_then(|v| v.as_str()) {
            let segments = permissions::split_segments(command);
            if !segments.is_empty() {
                return segments;
            }
            return vec![command.to_string()];
        }
    }
    vec!["*".to_string()]
}

fn tool_text_message(id: &str, text: &str) -> serde_json::Value {
    serde_json::json!({
        "role": "tool",
        "tool_call_id": id,
        "content": text,
    })
}

const PRUNE_KEEP_TOOL_MESSAGES: usize = 1;

fn prune_tool_history(history: &[serde_json::Value]) -> Vec<serde_json::Value> {
    let tool_total = history
        .iter()
        .filter(|m| m.get("role").and_then(|r| r.as_str()) == Some("tool"))
        .count();
    let mut seen = 0;
    history
        .iter()
        .map(|m| {
            let is_tool = m.get("role").and_then(|r| r.as_str()) == Some("tool");
            if !is_tool {
                return m.clone();
            }
            seen += 1;
            if tool_total - seen < PRUNE_KEEP_TOOL_MESSAGES {
                return m.clone();
            }
            let mut pruned = m.clone();
            pruned["content"] = serde_json::json!("[older tool output omitted]");
            pruned
        })
        .collect()
}

struct RepeatGuard {
    last_key: Option<String>,
    streak: u32,
}

impl RepeatGuard {
    fn new() -> Self {
        Self {
            last_key: None,
            streak: 0,
        }
    }

    fn note(&mut self, key: String) -> u32 {
        if self.last_key.as_deref() == Some(key.as_str()) {
            self.streak += 1;
        } else {
            self.streak = 1;
            self.last_key = Some(key);
        }
        self.streak
    }

    fn reset(&mut self) {
        self.streak = 0;
        self.last_key = None;
    }
}

struct Iteration {
    text: String,
    calls: Vec<serde_json::Value>,
}

fn collapsible_call(name: &str) -> bool {
    matches!(name, "get_time" | "recall_memory")
}

fn finish_iteration(
    text: String,
    accumulator: &mut sse::ToolCallAccumulator,
    on_event: &Channel<StreamEvent>,
) -> AppResult<Iteration> {
    accumulator.flush_unannounced();
    let calls = accumulator.calls();
    if text.is_empty() && calls.is_empty() {
        return Err(AppError::Upstream(
            "empty response from provider".to_string(),
        ));
    }
    if !text.is_empty() && !calls.is_empty() {
        let _ = on_event.send(StreamEvent::Retract {
            chars: text.chars().count(),
        });
    }
    Ok(Iteration { text, calls })
}

async fn stream_agentic_iteration(
    client: &reqwest::Client,
    url: &str,
    key: &str,
    body: &serde_json::Value,
    cancel: &Notify,
    on_event: &Channel<StreamEvent>,
    kind: Option<&str>,
) -> AppResult<Option<Iteration>> {
    let resp = match post_with_retry(client, url, key, body, cancel, Some(on_event), kind).await {
        Ok(resp) => resp,
        Err(error) if is_cancel_shutdown(&error) => return Ok(None),
        Err(error) => return Err(error),
    };

    let mut stream = resp.bytes_stream();
    let mut parser = sse::SseParser::new();
    let mut accumulator = sse::ToolCallAccumulator::new();
    let mut text = String::new();
    let notified = cancel.notified();
    tokio::pin!(notified);

    loop {
        let next = tokio::select! {
            _ = &mut notified => return Ok(None),
            next = stream.next() => next,
        };

        let Some(chunk) = next else { break };
        for item in parser.feed(&chunk?) {
            match item {
                sse::SseItem::Done => {
                    let _ = on_event.send(StreamEvent::Done);
                    return finish_iteration(text, &mut accumulator, on_event).map(Some);
                }
                sse::SseItem::Payload(payload) => {
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) else {
                        continue;
                    };
                    let mapped = sse::map_chunk(&value);
                    if let Some(message) = mapped.error {
                        return Err(AppError::Upstream(message));
                    }
                    if !mapped.text.is_empty() {
                        text.push_str(&mapped.text);
                        let _ = on_event.send(StreamEvent::Delta { text: mapped.text });
                    }
                    if !mapped.reasoning.is_empty() {
                        let _ = on_event.send(StreamEvent::Reasoning {
                            text: mapped.reasoning,
                        });
                    }
                    accumulator.apply(mapped.tool_deltas);
                    if let Some(usage) = mapped.usage {
                        let _ = on_event.send(StreamEvent::Usage {
                            prompt_tokens: usage.prompt,
                            completion_tokens: usage.completion,
                            total_tokens: usage.total,
                        });
                    }
                    if mapped.finish_reason.is_some() {
                        let _ = on_event.send(StreamEvent::Finish {
                            reason: mapped.finish_reason,
                        });
                    }
                }
            }
        }
    }

    finish_iteration(text, &mut accumulator, on_event).map(Some)
}

async fn run_agentic(
    client: &reqwest::Client,
    app: &AppHandle,
    req: &ChatRequest,
    key: String,
    on_event: &Channel<StreamEvent>,
    cancel: &Notify,
    state: &State<'_, StreamState>,
) -> AppResult<()> {
    let url = endpoint(&req.base_url, "chat/completions");
    let mut history: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();
    history = harden_deepseek_history(history, &req.model, req.connection_kind.as_deref(), &url);
    let tools = tools::tool_specs();
    let max = req.max_iterations.unwrap_or(25).clamp(1, 32);
    let mut repeat = RepeatGuard::new();
    let mut last_pure: Option<(String, String)> = None;

    for _ in 0..max {
        if state.take_cancelled(&req.request_id) {
            return Ok(());
        }
        let mut body = serde_json::json!({
            "model": req.model,
            "messages": prune_tool_history(&history),
            "tools": tools,
            "stream": true,
        });
        if wants_stream_usage(req.connection_kind.as_deref()) {
            body["stream_options"] = serde_json::json!({ "include_usage": true });
        }
        apply_optional_params(client, &mut body, req, &key).await;

        let iteration = match stream_agentic_iteration(
            client,
            &url,
            &key,
            &body,
            cancel,
            on_event,
            req.connection_kind.as_deref(),
        )
        .await
        {
            Ok(Some(iteration)) => iteration,
            Ok(None) => return Ok(()),
            Err(error)
                if is_retryable_tools_error(&error)
                    && !is_content_blocked_error(&error)
                    && !history
                        .iter()
                        .any(|m| m.get("role").and_then(|r| r.as_str()) == Some("tool")) =>
            {
                return stream_completion(client, req, key, history, on_event, cancel).await;
            }
            Err(error) => return Err(error),
        };
        if iteration.calls.is_empty() {
            break;
        }

        history.push(serde_json::json!({
            "role": "assistant",
            "content": iteration.text,
            "tool_calls": iteration.calls,
        }));

        let calls = iteration.calls;

        for call in &calls {
            if state.take_cancelled(&req.request_id) {
                return Ok(());
            }
            let id = call
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let name = call
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let args: serde_json::Value = call
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|v| v.as_str())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::Value::Null);

            let _ = on_event.send(StreamEvent::ToolStart {
                id: id.clone(),
                name: name.clone(),
                summary: tools::summarize_call(&name, &args),
            });

            let repeat_key = format!(
                "{name}\n{}",
                serde_json::to_string(&args).unwrap_or_default()
            );
            let streak = repeat.note(repeat_key.clone());
            if collapsible_call(&name) {
                if last_pure.as_ref().is_some_and(|(k, _)| k == &repeat_key) {
                    let output = last_pure
                        .as_ref()
                        .map(|(_, o)| o.clone())
                        .unwrap_or_default();
                    history.push(tool_text_message(&id, &output));
                    if streak < 3 {
                        continue;
                    }
                }
            } else {
                last_pure = None;
            }
            if streak >= 3 {
                let question_id = format!("{}:{id}:repeat", req.request_id);
                let (tx, rx) = tokio::sync::oneshot::channel();
                state.insert_question(&question_id, tx)?;
                let _ = on_event.send(StreamEvent::QuestionAsked {
                    id: question_id.clone(),
                    question: format!(
                        "`{name}` was called 3 times in a row with identical arguments. The turn is paused."
                    ),
                    options: vec!["Keep going".to_string(), "Stop here".to_string()],
                    allow_custom: true,
                });
                let answer = tokio::select! {
                    answer = rx => answer.unwrap_or_default(),
                    _ = cancel.notified() => return Ok(()),
                };
                if answer.trim().is_empty() || answer == "Stop here" {
                    let _ = on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: false,
                        preview: "Stopped: repeated tool call".to_string(),
                    });
                    history.push(tool_text_message(
                        &id,
                        "Stopped by user: same tool call repeated 3 times",
                    ));
                    return Ok(());
                }
                if answer != "Keep going" {
                    let _ = on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: true,
                        preview: answer.chars().take(120).collect(),
                    });
                    history.push(tool_text_message(&id, &format!("User guidance: {answer}")));
                }
                repeat.reset();
            }

            let resources = approval_resources(&name, &args);
            let decision = permissions::check(app, &name, &resources, req.project_id.as_deref())
                .await
                .unwrap_or(permissions::Effect::Ask);
            if decision == permissions::Effect::Deny {
                let _ = on_event.send(StreamEvent::ToolResult {
                    id: id.clone(),
                    ok: false,
                    preview: "Denied by rule".to_string(),
                });
                history.push(tool_text_message(&id, "denied by rule"));
                continue;
            }
            if decision == permissions::Effect::Ask {
                let approval_id = format!("{}:{id}", req.request_id);
                let command = if name == "run_powershell" {
                    resources.join("\n")
                } else {
                    tools::summarize_call(&name, &args)
                };
                let cwd = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string());
                let (tx, rx) = tokio::sync::oneshot::channel();
                state.insert_pending(
                    &approval_id,
                    PendingApproval {
                        action: name.clone(),
                        resources: resources.clone(),
                        project_id: req.project_id.clone(),
                        tx,
                    },
                )?;
                let _ = on_event.send(StreamEvent::ApprovalAsked {
                    id: approval_id.clone(),
                    tool: name.clone(),
                    command,
                    cwd,
                });
                let reply = tokio::select! {
                    reply = rx => reply.unwrap_or(ApprovalReply::Deny),
                    _ = cancel.notified() => return Ok(()),
                };
                if reply == ApprovalReply::Deny {
                    let _ = on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: false,
                        preview: "Denied by user".to_string(),
                    });
                    history.push(tool_text_message(&id, "denied by user"));
                    continue;
                }
            }

            if name == "ask_user" {
                match tools::parse_question(&args) {
                    Err(message) => {
                        let _ = on_event.send(StreamEvent::ToolResult {
                            id: id.clone(),
                            ok: false,
                            preview: message.clone(),
                        });
                        history.push(tool_text_message(&id, &format!("Error: {message}")));
                    }
                    Ok(asked) => {
                        let question_id = format!("{}:{id}", req.request_id);
                        let (tx, rx) = tokio::sync::oneshot::channel();
                        state.insert_question(&question_id, tx)?;
                        let _ = on_event.send(StreamEvent::QuestionAsked {
                            id: question_id.clone(),
                            question: asked.question,
                            options: asked.options,
                            allow_custom: asked.allow_custom,
                        });
                        let answer = tokio::select! {
                            answer = rx => answer.unwrap_or_default(),
                            _ = cancel.notified() => return Ok(()),
                        };
                        let content = if answer.trim().is_empty() {
                            "no answer (cancelled)".to_string()
                        } else {
                            answer
                        };
                        let _ = on_event.send(StreamEvent::ToolResult {
                            id: id.clone(),
                            ok: true,
                            preview: truncate_preview(&content),
                        });
                        history.push(tool_text_message(&id, &content));
                    }
                }
                continue;
            }

            match tools::execute(
                app,
                &name,
                args,
                &id,
                req.conversation_id.as_deref(),
                req.project_id.as_deref(),
                cancel,
            )
            .await
            {
                Ok(done) => {
                    if collapsible_call(&name) {
                        last_pure = Some((repeat_key.clone(), done.output.clone()));
                    }
                    if let Some(artifact) = done.artifact {
                        let _ = on_event.send(StreamEvent::Artifact {
                            title: artifact.title,
                            lang: artifact.lang,
                            code: artifact.code,
                        });
                    }
                    let _ = on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: true,
                        preview: truncate_preview(&done.output),
                    });
                    history.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": id,
                        "content": done.output,
                    }));
                }
                Err(message) => {
                    let _ = on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: false,
                        preview: truncate_preview(&message),
                    });
                    history.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": id,
                        "content": format!("Error: {message}"),
                    }));
                }
            }
        }
    }

    stream_completion(client, req, key, history, on_event, cancel).await
}

async fn stream_completion(
    client: &reqwest::Client,
    req: &ChatRequest,
    key: String,
    history: Vec<serde_json::Value>,
    on_event: &Channel<StreamEvent>,
    cancel: &Notify,
) -> AppResult<()> {
    let url = endpoint(&req.base_url, "chat/completions");
    let history =
        harden_deepseek_history(history, &req.model, req.connection_kind.as_deref(), &url);
    let mut body = serde_json::json!({
        "model": req.model,
        "messages": history,
        "stream": true,
    });
    if wants_stream_usage(req.connection_kind.as_deref()) {
        body["stream_options"] = serde_json::json!({ "include_usage": true });
    }
    apply_optional_params(client, &mut body, req, &key).await;

    let resp = match post_with_retry(
        client,
        &url,
        &key,
        &body,
        cancel,
        Some(on_event),
        req.connection_kind.as_deref(),
    )
    .await
    {
        Ok(resp) => resp,
        Err(error) if is_cancel_shutdown(&error) => return Ok(()),
        Err(error) => return Err(error),
    };

    let mut stream = resp.bytes_stream();
    let mut parser = sse::SseParser::new();
    let mut received: u32 = 0;
    let notified = cancel.notified();
    tokio::pin!(notified);

    loop {
        let next = tokio::select! {
            _ = &mut notified => return Ok(()),
            next = stream.next() => next,
        };

        let Some(chunk) = next else { break };
        for item in parser.feed(&chunk?) {
            match item {
                sse::SseItem::Done => {
                    let _ = on_event.send(StreamEvent::Done);
                    return if received == 0 {
                        Err(AppError::Upstream(
                            "empty response from provider".to_string(),
                        ))
                    } else {
                        Ok(())
                    };
                }
                sse::SseItem::Payload(payload) => {
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) else {
                        continue;
                    };
                    let mapped = sse::map_chunk(&value);
                    if let Some(message) = mapped.error {
                        return Err(AppError::Upstream(message));
                    }
                    if !mapped.text.is_empty() {
                        received += 1;
                        let _ = on_event.send(StreamEvent::Delta { text: mapped.text });
                    }
                    if !mapped.reasoning.is_empty() {
                        received += 1;
                        let _ = on_event.send(StreamEvent::Reasoning {
                            text: mapped.reasoning,
                        });
                    }
                    if let Some(usage) = mapped.usage {
                        let _ = on_event.send(StreamEvent::Usage {
                            prompt_tokens: usage.prompt,
                            completion_tokens: usage.completion,
                            total_tokens: usage.total,
                        });
                    }
                    if mapped.finish_reason.is_some() {
                        let _ = on_event.send(StreamEvent::Finish {
                            reason: mapped.finish_reason,
                        });
                    }
                }
            }
        }
    }

    let _ = on_event.send(StreamEvent::Done);
    if received == 0 {
        return Err(AppError::Upstream(
            "empty response from provider".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    fn serve_script(script: Vec<(&'static str, &'static str, &'static str)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let addr = listener.local_addr().expect("test server addr");
        std::thread::spawn(move || {
            for (status, headers, body) in script {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    let trimmed = line.trim_end();
                    if trimmed.is_empty() {
                        break;
                    }
                    if let Some((name, value)) = trimmed.split_once(':') {
                        if name.eq_ignore_ascii_case("Content-Length") {
                            content_length = value.trim().parse().unwrap_or(0);
                        }
                    }
                }
                let mut body_buf = vec![0u8; content_length];
                let _ = reader.read_exact(&mut body_buf);
                let mut stream = reader.into_inner();
                let response = format!(
                    "HTTP/1.1 {status}\r\n{headers}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{addr}")
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder().build().expect("test client")
    }

    fn body() -> serde_json::Value {
        serde_json::json!({ "model": "test", "messages": [] })
    }

    #[test]
    fn retryable_status_covers_429_and_5xx_only() {
        assert!(retryable_status(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(retryable_status(reqwest::StatusCode::INTERNAL_SERVER_ERROR));
        assert!(retryable_status(reqwest::StatusCode::BAD_GATEWAY));
        assert!(!retryable_status(reqwest::StatusCode::BAD_REQUEST));
        assert!(!retryable_status(reqwest::StatusCode::UNAUTHORIZED));
        assert!(!retryable_status(reqwest::StatusCode::OK));
    }

    #[test]
    fn backoff_honors_retry_after_and_grows() {
        assert_eq!(backoff_delay(0, Some(7)), Duration::from_secs(7));
        assert_eq!(backoff_delay(2, Some(99)), Duration::from_secs(30));
        let first = backoff_delay(0, None);
        let second = backoff_delay(1, None);
        assert!(first >= Duration::from_millis(500));
        assert!(first < Duration::from_millis(750));
        assert!(second >= Duration::from_millis(1000));
        assert!(second < Duration::from_millis(1250));
    }

    #[tokio::test]
    async fn retries_429_then_succeeds() {
        let url = serve_script(vec![
            (
                "429 Too Many Requests",
                "Retry-After: 0\r\n",
                r#"{"error":"slow down"}"#,
            ),
            ("200 OK", "", r#"{"choices":[]}"#),
        ]);
        let cancel = Notify::new();
        let resp = post_with_retry(&test_client(), &url, "key", &body(), &cancel, None, None)
            .await
            .expect("retry should succeed");
        assert!(resp.status().is_success());
        let value: serde_json::Value = resp.json().await.expect("json body");
        assert_eq!(value, serde_json::json!({"choices":[]}));
    }

    #[tokio::test]
    async fn does_not_retry_400() {
        let url = serve_script(vec![("400 Bad Request", "", r#"{"error":"bad"}"#)]);
        let cancel = Notify::new();
        let error = post_with_retry(&test_client(), &url, "key", &body(), &cancel, None, None)
            .await
            .expect_err("400 must not retry");
        assert!(matches!(error, AppError::Upstream(_)));
    }

    #[test]
    fn repeat_guard_counts_consecutive_identical_calls() {
        let mut guard = RepeatGuard::new();
        assert_eq!(guard.note("read::{}".to_string()), 1);
        assert_eq!(guard.note("read::{}".to_string()), 2);
        assert_eq!(guard.note("read::{}".to_string()), 3);
        assert_eq!(guard.note("other::{}".to_string()), 1);
        guard.reset();
        assert_eq!(guard.note("read::{}".to_string()), 1);
    }

    #[test]
    fn summary_body_caps_input_and_targets_model() {
        const WORD: &str = "word ";
        let long = WORD.repeat(5000);
        const WORD_LEN: usize = 5;
        assert!(long.len() > 12_000 + WORD_LEN);
        let body = summary_body("test-model", &long);
        assert_eq!(body["model"], serde_json::json!("test-model"));
        assert_eq!(body["stream"], serde_json::json!(false));
        let content = body["messages"][1]["content"].as_str().unwrap();
        assert!(content.len() <= 12_000 + WORD_LEN);
        assert!(content.starts_with("word word"));
    }

    #[test]
    fn agentrouter_gating_matches_gateway_only() {
        assert!(is_agentrouter_url("https://agentrouter.org/v1/models"));
        assert!(is_agentrouter_url(
            "https://co.agentrouter.org/v1/chat/completions"
        ));
        assert!(!is_agentrouter_url("https://openrouter.ai/api/v1/models"));
        assert!(!is_agentrouter_url("http://127.0.0.1:7777/v1/models"));
    }

    #[test]
    fn agentrouter_gating_accepts_kind_or_url() {
        assert!(is_agentrouter(
            Some("agentrouter"),
            "https://proxy.local/v1"
        ));
        assert!(is_agentrouter(None, "https://agentrouter.org/v1"));
        assert!(!is_agentrouter(
            Some("openrouter"),
            "https://proxy.local/v1"
        ));
        assert!(!is_agentrouter(None, "https://openrouter.ai/api/v1"));
        assert!(wants_stream_usage(Some("openrouter")));
        assert!(!wants_stream_usage(Some("agentrouter")));
    }

    #[test]
    fn content_blocked_detects_gateway_code() {
        let blocked = "400 Bad Request: {\"error\":{\"code\":\"content-blocked\",\"message\":\"content-blocked (request id: 2026101600292781111551vqnnmUltoGkF6)\",\"param\":\"\",\"type\":\"agent_router_api_error\"}}";
        assert!(is_content_blocked_message(blocked));
        assert!(is_content_blocked_error(&AppError::Upstream(
            blocked.to_string()
        )));
        assert_eq!(
            content_blocked_request_id(blocked),
            Some("2026101600292781111551vqnnmUltoGkF6".to_string())
        );
        assert!(describe_content_blocked(blocked).contains("2026101600292781111551vqnnmUltoGkF6"));
        assert!(!is_content_blocked_message("400 Bad Request: bad input"));
        assert!(!is_content_blocked_error(&AppError::Upstream(
            "500 Internal Server Error: boom".to_string()
        )));
    }

    #[test]
    fn deepseek_guard_scopes_model_and_host() {
        assert!(deepseek_guard_active(
            "deepseek-v4-flash",
            Some("agentrouter"),
            "https://proxy.local/v1/chat/completions"
        ));
        assert!(deepseek_guard_active(
            "deepseek-v4-flash",
            None,
            "https://agentrouter.org/v1/chat/completions"
        ));
        assert!(!deepseek_guard_active(
            "gpt-6-astra",
            Some("agentrouter"),
            "https://agentrouter.org/v1/chat/completions"
        ));
        assert!(!deepseek_guard_active(
            "deepseek-v4-flash",
            Some("custom"),
            "https://api.openai.com/v1/chat/completions"
        ));
    }

    #[test]
    fn deepseek_first_turn_frames_thin_shapes() {
        assert!(deepseek_first_turn("hi").starts_with(DEEPSEEK_CONTEXT_MARK));
        assert!(deepseek_first_turn("hola, ¿cómo estás?").starts_with(DEEPSEEK_CONTEXT_MARK));
        assert!(
            deepseek_first_turn("Please handle work kanban task 24edbb12")
                .starts_with(DEEPSEEK_CONTEXT_MARK)
        );
        assert!(deepseek_first_turn("").starts_with(DEEPSEEK_CONTEXT_MARK));
        assert_eq!(
            deepseek_first_turn("Please explain Rust ownership in detail with examples."),
            "Please explain Rust ownership in detail with examples."
        );
        assert_eq!(
            deepseek_first_turn("[myagent-request] Please handle this."),
            "[myagent-request] Please handle this."
        );
    }

    #[test]
    fn sanitize_replaces_deepseek_tripwords() {
        assert_eq!(
            sanitize_deepseek_text("Write Lorem ipsum placeholder dummy data."),
            "Write example text example value sample data."
        );
        assert_eq!(
            sanitize_deepseek_text("As a language model virtual assistant, I'm here to help."),
            "As a large language model AI assistant, How can I help."
        );
    }

    #[test]
    fn harden_touches_first_user_message_only() {
        let history = vec![
            serde_json::json!({"role": "system", "content": "Be helpful"}),
            serde_json::json!({"role": "user", "content": "hi"}),
            serde_json::json!({"role": "assistant", "content": "Hello"}),
            serde_json::json!({"role": "user", "content": "work kanban task t_24edbb12"}),
        ];
        let hardened = harden_deepseek_history(
            history.clone(),
            "deepseek-v4-flash",
            Some("agentrouter"),
            "https://agentrouter.org/v1/chat/completions",
        );
        assert_eq!(hardened[0]["content"], serde_json::json!("Be helpful"));
        assert!(
            hardened[1]["content"]
                .as_str()
                .unwrap()
                .starts_with(DEEPSEEK_CONTEXT_MARK)
        );
        assert_eq!(
            hardened[3]["content"],
            serde_json::json!("work kanban task t_24edbb12")
        );
        let untouched = harden_deepseek_history(
            history.clone(),
            "gpt-6-astra",
            Some("agentrouter"),
            "https://agentrouter.org/v1/chat/completions",
        );
        assert_eq!(untouched, history);
        let twice = harden_deepseek_history(
            hardened.clone(),
            "deepseek-v4-flash",
            Some("agentrouter"),
            "https://agentrouter.org/v1/chat/completions",
        );
        assert_eq!(twice, hardened);
        assert!(
            !twice[1]["content"]
                .as_str()
                .unwrap()
                .contains("large large")
        );
    }

    #[test]
    fn content_blocked_request_id_survives_non_ascii_prefix() {
        let message = "400 Bad Request: {\"error\":{\"code\":\"content-blocked\",\"message\":\"İd content-blocked (request id: abcDEF123)\",\"type\":\"agent_router_api_error\"}}";
        assert_eq!(
            content_blocked_request_id(message),
            Some("abcDEF123".to_string())
        );
        assert!(describe_content_blocked(message).contains("abcDEF123"));
    }

    #[test]
    fn parses_agentrouter_models_shape() {
        let value = serde_json::json!({
            "success": true,
            "data": [
                {"id": "gpt-6.1-sol", "supported_endpoint_types": ["openai"]},
                {"id": "claude-opus-5-5", "supported_endpoint_types": ["anthropic", "openai"]},
                {"id": "voice-only", "supported_endpoint_types": ["audio"]},
                {"no-id": true},
                {"id": "deepseek-v4-flash"}
            ]
        });
        let ids: Vec<String> = parse_models_caps(&value)
            .into_iter()
            .map(|caps| caps.id)
            .collect();
        assert_eq!(
            ids,
            vec![
                "claude-opus-5-5".to_string(),
                "deepseek-v4-flash".to_string(),
                "gpt-6.1-sol".to_string()
            ]
        );
    }

    #[test]
    fn parses_openai_models_shape() {
        let value = serde_json::json!({
            "object": "list",
            "data": [{"id": "b"}, {"id": "a"}]
        });
        let ids: Vec<String> = parse_models_caps(&value)
            .into_iter()
            .map(|caps| caps.id)
            .collect();
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);
        assert!(parse_models_caps(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn parses_openrouter_caps_shape() {
        let value = serde_json::json!({
            "data": [
                {
                    "id": "b-model",
                    "context_length": 200000,
                    "supported_parameters": ["tools", "reasoning"],
                    "reasoning": {
                        "supported_efforts": ["low", "medium"],
                        "mandatory": true
                    }
                },
                {
                    "id": "a-model",
                    "context_length": 128000,
                    "supported_parameters": ["temperature"]
                },
                {"id": "plain"}
            ]
        });
        let caps = parse_models_caps(&value);
        assert_eq!(caps.len(), 3);
        assert_eq!(caps[0].id, "a-model");
        assert_eq!(caps[0].supports_tools, Some(false));
        assert_eq!(caps[0].supports_reasoning, Some(false));
        assert_eq!(caps[1].id, "b-model");
        assert_eq!(caps[1].context_length, Some(200000));
        assert_eq!(caps[1].supports_tools, Some(true));
        assert_eq!(caps[1].supports_reasoning, Some(true));
        assert_eq!(
            caps[1].efforts,
            Some(vec!["low".to_string(), "medium".to_string()])
        );
        assert!(caps[1].mandatory);
        assert_eq!(caps[2].id, "plain");
        assert_eq!(caps[2].supports_tools, None);
        assert_eq!(caps[2].supports_reasoning, None);
    }

    #[test]
    fn parses_agentrouter_caps_shape() {
        let value = serde_json::json!({
            "success": true,
            "data": [
                {"id": "chat-model", "supported_endpoint_types": ["openai"]},
                {"id": "voice", "supported_endpoint_types": ["audio"]}
            ]
        });
        let caps = parse_models_caps(&value);
        assert_eq!(caps.len(), 1);
        assert_eq!(caps[0].id, "chat-model");
        assert_eq!(caps[0].supports_tools, None);
        assert!(parse_models_caps(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn effort_gate_drops_unsupported_effort() {
        assert!(effort_allowed(None, "medium"));
        let no_reasoning = ModelCaps {
            id: "plain".to_string(),
            context_length: None,
            supports_tools: None,
            supports_reasoning: Some(false),
            efforts: None,
            mandatory: false,
        };
        assert!(!effort_allowed(Some(&no_reasoning), "medium"));
        let listed = ModelCaps {
            supports_reasoning: Some(true),
            efforts: Some(vec!["low".to_string()]),
            ..ModelCaps {
                id: "thinker".to_string(),
                context_length: None,
                supports_tools: None,
                supports_reasoning: None,
                efforts: None,
                mandatory: false,
            }
        };
        assert!(effort_allowed(Some(&listed), "low"));
        assert!(!effort_allowed(Some(&listed), "high"));
    }

    #[test]
    fn unified_reasoning_only_for_gateways() {
        assert!(uses_unified_reasoning(Some("openrouter")));
        assert!(uses_unified_reasoning(Some("agentrouter")));
        assert!(!uses_unified_reasoning(Some("custom")));
        assert!(!uses_unified_reasoning(None));
    }

    #[test]
    fn prune_keeps_newest_tool_output_only() {
        let history = vec![
            serde_json::json!({"role": "user", "content": "hi"}),
            tool_text_message("call-1", "old output one"),
            tool_text_message("call-2", "old output two"),
            serde_json::json!({"role": "assistant", "content": "working"}),
            tool_text_message("call-3", "fresh output"),
        ];
        let pruned = prune_tool_history(&history);
        assert_eq!(pruned.len(), 5);
        assert_eq!(pruned[0]["content"], serde_json::json!("hi"));
        assert_eq!(
            pruned[1]["content"],
            serde_json::json!("[older tool output omitted]")
        );
        assert_eq!(pruned[1]["tool_call_id"], serde_json::json!("call-1"));
        assert_eq!(
            pruned[2]["content"],
            serde_json::json!("[older tool output omitted]")
        );
        assert_eq!(pruned[3]["content"], serde_json::json!("working"));
        assert_eq!(pruned[4]["content"], serde_json::json!("fresh output"));
        assert_eq!(pruned[4]["tool_call_id"], serde_json::json!("call-3"));
    }
}
