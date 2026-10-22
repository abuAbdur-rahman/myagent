use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::sync::Notify;

use crate::connections;
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
    ToolSources {
        id: String,
        domains: Vec<String>,
        files: Vec<String>,
    },
    ApprovalAsked {
        id: String,
        tool: String,
        command: String,
        cwd: String,
        screen: Option<crate::screen::ScreenVerdict>,
        screen_failed: bool,
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
    Subagent {
        parent: String,
        event: Box<StreamEvent>,
    },
}

pub trait EventSink: Send + Sync {
    fn send(&self, event: StreamEvent);
}

impl EventSink for Channel<StreamEvent> {
    fn send(&self, event: StreamEvent) {
        let _ = Channel::send(self, event);
    }
}

pub struct ScopedSink<'a> {
    inner: &'a dyn EventSink,
    parent: String,
}

impl<'a> ScopedSink<'a> {
    pub fn new(inner: &'a dyn EventSink, parent: String) -> Self {
        Self { inner, parent }
    }
}

impl EventSink for ScopedSink<'_> {
    fn send(&self, event: StreamEvent) {
        match event {
            StreamEvent::ApprovalAsked { .. } | StreamEvent::QuestionAsked { .. } => {
                self.inner.send(event);
            }
            other => self.inner.send(StreamEvent::Subagent {
                parent: self.parent.clone(),
                event: Box::new(other),
            }),
        }
    }
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    Text { text: String },
    ImageUrl { image_url: ImageUrl },
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ImageUrl {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: MessageContent,
}

#[derive(Deserialize)]
pub struct ChatRequest {
    pub request_id: String,
    #[serde(skip)]
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
    #[serde(default)]
    pub search_backend: Option<String>,
    #[serde(default)]
    pub search_endpoint: Option<String>,
    #[serde(default)]
    pub vision_fallback_model: Option<String>,
    #[serde(default)]
    pub vision_fallback_connection: Option<String>,
    #[serde(default)]
    pub child_system: Option<String>,
    #[serde(skip)]
    pub subagent: bool,
}

#[derive(Deserialize)]
pub struct TitleRequest {
    #[serde(skip)]
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

fn provider_takes_effort(kind: Option<&str>) -> bool {
    !matches!(kind, Some("deepseek" | "ollama" | "ollama-cloud"))
}

fn attach_effort(body: &mut serde_json::Value, kind: Option<&str>, effort: &str) {
    if !provider_takes_effort(kind) {
        return;
    }
    if uses_unified_reasoning(kind) {
        body["reasoning"] = serde_json::json!({ "effort": effort });
    } else {
        body["reasoning_effort"] = serde_json::json!(effort);
    }
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
    attach_effort(body, req.connection_kind.as_deref(), effort);
}

pub(crate) fn truncate_chars(text: &str, max: usize) -> String {
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

fn domains_in(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for token in text.split(|c: char| {
        c.is_whitespace() || matches!(c, '"' | '\'' | '(' | ')' | '[' | ']' | ',' | '<' | '>')
    }) {
        let trimmed = token.trim_end_matches(['.', ')', ',', ';', ':', '}', ']']);
        let rest = trimmed
            .strip_prefix("https://")
            .or_else(|| trimmed.strip_prefix("http://"));
        let Some(rest) = rest else { continue };
        let host = rest.split(['/', '?', '#']).next().unwrap_or("");
        if host.is_empty() || host.contains(' ') {
            continue;
        }
        if !out.iter().any(|existing| existing == host) {
            out.push(host.to_string());
        }
        if out.len() >= 12 {
            break;
        }
    }
    out
}

const CHILD_SYSTEM: &str = "You are a focused subagent. Complete the task with the tools available, then reply with a concise summary of what you found or changed. You cannot see the parent conversation and you cannot delegate further. Do not ask the user questions unless the task is impossible without one.";

fn strip_tool_spec(specs: &mut serde_json::Value, name: &str) {
    if let Some(list) = specs.as_array_mut() {
        list.retain(|spec| {
            spec.get("function")
                .and_then(|function| function.get("name"))
                .and_then(|value| value.as_str())
                != Some(name)
        });
    }
}

pub(crate) struct TextCompletion<'a> {
    pub client: &'a reqwest::Client,
    pub base_url: &'a str,
    pub key: &'a str,
    pub model: &'a str,
    pub system: &'a str,
    pub user: &'a str,
    pub cancel: &'a Notify,
    pub connection_kind: Option<&'a str>,
}

pub(crate) async fn complete_text(request: TextCompletion<'_>) -> AppResult<String> {
    let TextCompletion {
        client,
        base_url,
        key,
        model,
        system,
        user,
        cancel,
        connection_kind,
    } = request;
    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
        "stream": false,
    });
    let url = endpoint(base_url, "chat/completions");
    let resp = tokio::select! {
        resp = post_with_retry(
            client,
            &url,
            key,
            &body,
            cancel,
            None,
            connection_kind,
        ) => resp?,
        _ = cancel.notified() => return Err(AppError::Cancelled),
    };
    let value: serde_json::Value = resp.json().await.map_err(AppError::from)?;
    let text = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        return Err(AppError::Upstream("empty completion".to_string()));
    }
    Ok(text)
}

fn message_text(content: &serde_json::Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if let Some(parts) = content.as_array() {
        let mut out = String::new();
        for part in parts {
            if let Some(text) = part.get("text").and_then(|value| value.as_str()) {
                out.push_str(text);
            }
        }
        return out;
    }
    String::new()
}

/// Blind-model routing: the frontend only sends `fallback` when the active
/// model lacks vision support. Image parts are stripped (the provider would
/// reject them) and the agent is told to read them via `describe_image`,
/// which re-sends them to the fallback model. `None` leaves history alone.
/// Returns (removed_count, system_note).
fn route_vision(
    history: &mut [serde_json::Value],
    fallback: Option<&str>,
) -> (usize, Option<String>) {
    let Some(model) = fallback.filter(|m| !m.trim().is_empty()) else {
        return (0, None);
    };
    let mut removed = 0;
    for message in history.iter_mut() {
        let Some(parts) = message.get_mut("content").and_then(|c| c.as_array_mut()) else {
            continue;
        };
        let before = parts.len();
        parts.retain(|part| part.get("type").and_then(|t| t.as_str()) != Some("image_url"));
        removed += before - parts.len();
        if parts.len() == 1 && parts[0].get("text").and_then(|t| t.as_str()).is_some() {
            let text = parts[0]["text"].as_str().unwrap_or_default().to_string();
            message["content"] = serde_json::Value::String(text);
        }
    }
    if removed == 0 {
        return (0, None);
    }
    let note = format!(
        "The user attached {removed} image(s) this turn, but the current model ({model}) cannot see images. The files are saved under this conversation's spill/images directory. Call describe_image once per image (index 0..{}) with a specific question, then answer from the descriptions. Never claim to see the images directly.",
        removed - 1,
    );
    (removed, Some(note))
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
    !matches!(kind, Some("agentrouter" | "ollama" | "ollama-cloud"))
}

fn is_deepseek_model(model: &str) -> bool {
    model.to_lowercase().contains("deepseek")
}

fn uses_deepseek_reasoning_replay(model: &str) -> bool {
    let lower = model.to_lowercase();
    lower
        .split('/')
        .any(|segment| segment.trim_start().starts_with("deepseek"))
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

fn replace_unprefixed(text: &str, needle: &str, prefix: &str, replacement: &str) -> String {
    let prefix = prefix.to_lowercase();
    let mut out = String::with_capacity(text.len() + replacement.len());
    let mut rest = text;
    while let Some(pos) = rest.find(needle) {
        let (head, tail) = rest.split_at(pos);
        out.push_str(head);
        if head.to_lowercase().ends_with(prefix.as_str()) {
            out.push_str(needle);
        } else {
            out.push_str(replacement);
        }
        rest = &tail[needle.len()..];
    }
    out.push_str(rest);
    out
}

fn sanitize_deepseek_text(text: &str) -> String {
    const REPLACEMENTS: &[(&str, &str)] = &[
        ("Lorem ipsum", "example text"),
        ("lorem ipsum", "example text"),
        ("virtual assistant", "AI assistant"),
        ("Virtual assistant", "AI assistant"),
        ("I'm here to help", "How can I help"),
        ("here to help", "How can I help"),
        ("placeholder", "example value"),
        ("Placeholder", "Example value"),
        ("dummy data", "sample data"),
        ("Dummy data", "Sample data"),
    ];
    let mut out = replace_unprefixed(text, "language model", "large ", "large language model");
    out = replace_unprefixed(&out, "Language model", "Large ", "Large language model");
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
    pub supports_vision: Option<bool>,
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
                    let modalities: Option<Vec<&str>> = item
                        .get("architecture")
                        .and_then(|a| a.get("input_modalities"))
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|t| t.as_str()).collect());
                    let modality_text = item
                        .get("architecture")
                        .and_then(|a| a.get("modality"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let supports_vision = modalities
                        .as_ref()
                        .map(|m| m.iter().any(|t| t.eq_ignore_ascii_case("image")))
                        .or_else(|| {
                            (!modality_text.is_empty())
                                .then(|| modality_text.to_lowercase().contains("image"))
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
                        supports_vision,
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

async fn fetch_openai_caps(
    client: &reqwest::Client,
    base_url: &str,
    key: &str,
    kind: Option<&str>,
) -> AppResult<Vec<ModelCaps>> {
    let url = endpoint(base_url, "models");
    let request = agentrouter_headers(client.get(url.as_str()).bearer_auth(key), kind, &url);
    let resp = request.send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Upstream(error_body(resp).await));
    }
    let value: serde_json::Value = resp.json().await?;
    Ok(parse_models_caps(&value))
}

async fn fetch_ollama_tags(client: &reqwest::Client, key: &str) -> AppResult<Vec<ModelCaps>> {
    let resp = client
        .get("https://ollama.com/api/tags")
        .bearer_auth(key)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::Upstream(error_body(resp).await));
    }
    let value: serde_json::Value = resp.json().await?;
    Ok(parse_ollama_tags(&value))
}

fn parse_ollama_tags(value: &serde_json::Value) -> Vec<ModelCaps> {
    value
        .get("models")
        .and_then(|models| models.as_array())
        .map(|models| {
            models
                .iter()
                .filter_map(|model| {
                    let id = model
                        .get("name")
                        .and_then(|name| name.as_str())
                        .or_else(|| model.get("model").and_then(|name| name.as_str()))?;
                    Some(ModelCaps {
                        id: id.to_string(),
                        context_length: None,
                        supports_tools: None,
                        supports_reasoning: None,
                        supports_vision: None,
                        efforts: None,
                        mandatory: false,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
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
    let cloud = kind == Some("ollama-cloud");
    let caps = match fetch_openai_caps(client, base_url, key, kind).await {
        Ok(caps) if !caps.is_empty() => caps,
        Ok(_) if cloud => fetch_ollama_tags(client, key).await?,
        Ok(caps) => caps,
        Err(error) => {
            if cloud {
                fetch_ollama_tags(client, key).await?
            } else if let Some((_, stale)) = caps_cache()
                .lock()
                .expect("caps cache lock")
                .get(base_url)
                .cloned()
            {
                stale
            } else {
                return Err(error);
            }
        }
    };
    caps_cache()
        .lock()
        .expect("caps cache lock")
        .insert(base_url.to_string(), (Instant::now(), caps.clone()));
    Ok(caps)
}

fn read_key(connection_id: &str, kind: Option<&str>) -> AppResult<String> {
    match vault::get_api_key(connection_id) {
        Ok(key) => Ok(key),
        Err(_) if kind == Some("ollama") => Ok(String::new()),
        Err(error) => Err(error),
    }
}

fn model_seeds(kind: Option<&str>) -> &'static [&'static str] {
    match kind {
        Some("deepseek") => &["deepseek-chat", "deepseek-reasoner"],
        _ => &[],
    }
}

fn with_model_seeds(kind: Option<&str>, mut caps: Vec<ModelCaps>) -> Vec<ModelCaps> {
    for seed in model_seeds(kind) {
        if caps.iter().any(|caps| caps.id == *seed) {
            continue;
        }
        caps.push(ModelCaps {
            id: (*seed).to_string(),
            context_length: None,
            supports_tools: Some(true),
            supports_reasoning: Some(*seed == "deepseek-reasoner"),
            supports_vision: Some(false),
            efforts: None,
            mandatory: false,
        });
    }
    caps
}

#[tauri::command]
pub async fn list_model_caps(
    app: AppHandle,
    connection_id: String,
    connection_kind: Option<String>,
    client: State<'_, reqwest::Client>,
) -> AppResult<Vec<ModelCaps>> {
    let base_url = connections::base_url_for(&app, &connection_id).await?;
    let key = read_key(&connection_id, connection_kind.as_deref())?;
    let caps = fetch_model_caps(&client, &base_url, &key, connection_kind.as_deref()).await?;
    Ok(with_model_seeds(connection_kind.as_deref(), caps))
}

#[tauri::command]
pub async fn list_models(
    app: AppHandle,
    connection_id: String,
    connection_kind: Option<String>,
    client: State<'_, reqwest::Client>,
) -> AppResult<Vec<String>> {
    let base_url = connections::base_url_for(&app, &connection_id).await?;
    let key = read_key(&connection_id, connection_kind.as_deref())?;
    let caps = fetch_model_caps(&client, &base_url, &key, connection_kind.as_deref()).await?;
    Ok(with_model_seeds(connection_kind.as_deref(), caps)
        .into_iter()
        .map(|caps| caps.id)
        .collect())
}

#[tauri::command]
pub fn cancel_stream(request_id: String, state: State<'_, StreamState>) -> AppResult<()> {
    state.cancel(&request_id)
}

#[derive(Deserialize)]
pub struct SummaryRequest {
    #[serde(skip)]
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
    mut req: SummaryRequest,
    client: State<'_, reqwest::Client>,
    app: AppHandle,
) -> AppResult<String> {
    req.base_url = connections::base_url_for(&app, &req.connection_id).await?;
    let key = read_key(&req.connection_id, req.connection_kind.as_deref())?;
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
    mut req: TitleRequest,
    client: State<'_, reqwest::Client>,
    app: AppHandle,
) -> AppResult<String> {
    req.base_url = connections::base_url_for(&app, &req.connection_id).await?;
    let key = read_key(&req.connection_id, req.connection_kind.as_deref())?;
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
        "max_tokens": 2048,
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
    let title = message_text(&value["choices"][0]["message"]["content"])
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
    mut req: ChatRequest,
    on_event: Channel<StreamEvent>,
    state: State<'_, StreamState>,
    client: State<'_, reqwest::Client>,
    app: AppHandle,
) -> AppResult<()> {
    req.base_url = connections::base_url_for(&app, &req.connection_id).await?;
    let key = read_key(&req.connection_id, req.connection_kind.as_deref())?;
    let cancel = state.register(&req.request_id)?;

    let result = if req.enable_tools {
        run_agentic(&client, &app, &req, key, &on_event, &cancel, state.inner())
            .await
            .map(|_| ())
    } else {
        let url = endpoint(&req.base_url, "chat/completions");
        let history: Vec<serde_json::Value> = req
            .messages
            .iter()
            .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
            .collect();
        let history =
            harden_deepseek_history(history, &req.model, req.connection_kind.as_deref(), &url);
        stream_completion(&client, &req, key, history, &on_event, &cancel).await
    };
    state.finish(&req.request_id);
    result
}

const MAX_ATTEMPTS: u32 = 10;

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
    on_event: Option<&dyn EventSink>,
    kind: Option<&str>,
) -> AppResult<reqwest::Response> {
    if pace_agentrouter(url, cancel).await {
        return Err(AppError::Cancelled);
    }
    let mut last_error: Option<AppError> = None;
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
                        return Err(AppError::Upstream(describe_content_blocked(&message)));
                    }
                    return Err(AppError::Upstream(message));
                }
                if retryable_status(status) && attempt + 1 < MAX_ATTEMPTS {
                    let wait = backoff_delay(attempt, retry_after_secs(&resp));
                    drop(resp);
                    if let Some(ch) = on_event {
                        ch.send(StreamEvent::Retrying {
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
                        ch.send(StreamEvent::Retrying {
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

fn approval_audit_label(reply: ApprovalReply) -> &'static str {
    match reply {
        ApprovalReply::Always => "always",
        ApprovalReply::Once => "once",
        ApprovalReply::Deny => "deny(user)",
    }
}

fn approval_resources(name: &str, args: &serde_json::Value) -> Vec<String> {
    if name == "sandbox_run" {
        if let Some(command) = args.get("command").and_then(|v| v.as_str()) {
            let segments = permissions::split_segments(command);
            if !segments.is_empty() {
                return segments;
            }
            return vec![command.trim().to_string()];
        }
    }
    if name.starts_with("sandbox_") {
        for key in ["path", "pattern"] {
            if let Some(value) = args.get(key).and_then(|v| v.as_str()) {
                return vec![value.trim().to_string()];
            }
        }
    }
    if name == "run_powershell" {
        if let Some(command) = args.get("command").and_then(|v| v.as_str()) {
            let segments = permissions::split_segments(command);
            if !segments.is_empty() {
                return segments;
            }
            return vec![command.to_string()];
        }
    }
    if name == "web_fetch" {
        if let Some(url) = args.get("url").and_then(|v| v.as_str()) {
            if let Ok(parsed) = reqwest::Url::parse(url.trim()) {
                if let Some(host) = parsed.host_str() {
                    let bare = host.trim_start_matches('[').trim_end_matches(']');
                    return vec![bare.to_string()];
                }
            }
            return vec![url.trim().to_string()];
        }
    }
    if name == "web_search" {
        if let Some(query) = args.get("query").and_then(|v| v.as_str()) {
            return vec![query.trim().to_string()];
        }
    }
    if name == "research_run" {
        if let Some(query) = args.get("query").and_then(|v| v.as_str()) {
            return vec![query.trim().to_string()];
        }
    }
    if name == "skill" {
        if let Some(id) = args.get("id").and_then(|v| v.as_str()) {
            return vec![id.trim().to_string()];
        }
    }
    if name == "describe_image" {
        if let Some(index) = args.get("index").and_then(|v| v.as_u64()) {
            return vec![format!("image#{index}")];
        }
    }
    if name == "read_document" {
        if let Some(document) = args.get("name").and_then(|v| v.as_str()) {
            return vec![document.trim().to_string()];
        }
    }
    if name == "update_memory" || name == "delete_memory" {
        if let Some(id) = args
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(tools::canonical_memory_id)
        {
            return vec![id];
        }
    }
    vec![name.to_string()]
}

fn assistant_tool_message(
    text: &str,
    calls: &[serde_json::Value],
    reasoning: &str,
    replay_reasoning: bool,
) -> serde_json::Value {
    let mut message = serde_json::json!({
        "role": "assistant",
        "content": text,
        "tool_calls": calls,
    });
    if replay_reasoning {
        message["reasoning_content"] = serde_json::json!(reasoning);
    }
    message
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
    reasoning: String,
}

fn collapsible_call(name: &str) -> bool {
    matches!(name, "get_time" | "recall_memory")
}

fn should_retract(text: &str, calls: &[serde_json::Value]) -> bool {
    !text.is_empty() && !calls.is_empty()
}

fn collect_inband(
    events: Vec<crate::inband::InbandEvent>,
    healed: &mut Vec<(String, String)>,
    text: &mut String,
    on_event: &dyn EventSink,
) {
    for event in events {
        match event {
            crate::inband::InbandEvent::Text(visible) => {
                if visible.is_empty() {
                    continue;
                }
                text.push_str(&visible);
                on_event.send(StreamEvent::Delta { text: visible });
            }
            crate::inband::InbandEvent::Call { name, arguments } => healed.push((name, arguments)),
        }
    }
}

/// Structured calls win. Healed ones are only used when the gateway sent none.
fn absorb_healed(accumulator: &mut sse::ToolCallAccumulator, healed: Vec<(String, String)>) {
    if healed.is_empty() || !accumulator.calls().is_empty() {
        return;
    }
    let deltas = healed
        .into_iter()
        .enumerate()
        .map(|(index, (name, arguments))| sse::ToolCallDelta {
            index,
            id: format!("dsml-{index}"),
            name,
            arguments,
        })
        .collect();
    accumulator.apply(deltas);
}

fn finish_iteration(
    text: String,
    reasoning: String,
    accumulator: &mut sse::ToolCallAccumulator,
    on_event: &dyn EventSink,
) -> AppResult<Iteration> {
    accumulator.flush_unannounced();
    let calls = accumulator.calls();
    if text.is_empty() && calls.is_empty() {
        return Err(AppError::Upstream(
            "empty response from provider".to_string(),
        ));
    }
    if should_retract(&text, &calls) {
        on_event.send(StreamEvent::Retract {
            chars: text.chars().count(),
        });
    }
    Ok(Iteration {
        text,
        calls,
        reasoning,
    })
}

async fn stream_agentic_iteration(
    client: &reqwest::Client,
    url: &str,
    key: &str,
    body: &serde_json::Value,
    cancel: &Notify,
    on_event: &dyn EventSink,
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
    let mut reasoning = String::new();
    let mut scanner = crate::inband::DsmlScanner::new();
    let mut healed: Vec<(String, String)> = Vec::new();
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
                    collect_inband(scanner.finish(), &mut healed, &mut text, on_event);
                    absorb_healed(&mut accumulator, std::mem::take(&mut healed));
                    on_event.send(StreamEvent::Done);
                    return finish_iteration(text, reasoning, &mut accumulator, on_event).map(Some);
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
                        collect_inband(
                            scanner.push(&mapped.text),
                            &mut healed,
                            &mut text,
                            on_event,
                        );
                    }
                    if !mapped.reasoning.is_empty() {
                        reasoning.push_str(&mapped.reasoning);
                        on_event.send(StreamEvent::Reasoning {
                            text: mapped.reasoning,
                        });
                    }
                    accumulator.apply(mapped.tool_deltas);
                    if let Some(usage) = mapped.usage {
                        on_event.send(StreamEvent::Usage {
                            prompt_tokens: usage.prompt,
                            completion_tokens: usage.completion,
                            total_tokens: usage.total,
                        });
                    }
                    if mapped.finish_reason.is_some() {
                        on_event.send(StreamEvent::Finish {
                            reason: mapped.finish_reason,
                        });
                    }
                }
            }
        }
    }

    collect_inband(scanner.finish(), &mut healed, &mut text, on_event);
    absorb_healed(&mut accumulator, std::mem::take(&mut healed));
    finish_iteration(text, reasoning, &mut accumulator, on_event).map(Some)
}

enum StepControl {
    Continue,
    StopTurn,
}

trait ModelClient {
    async fn stream_step(
        &self,
        messages: &[serde_json::Value],
        use_tools: bool,
    ) -> AppResult<Option<Iteration>>;
}

trait ToolRunner {
    async fn run(
        &mut self,
        call: &serde_json::Value,
        history: &mut Vec<serde_json::Value>,
    ) -> AppResult<StepControl>;
}

fn history_has_tool_message(history: &[serde_json::Value]) -> bool {
    history
        .iter()
        .any(|m| m.get("role").and_then(|r| r.as_str()) == Some("tool"))
}

async fn agent_loop<M: ModelClient, T: ToolRunner>(
    model: &M,
    tools: &mut T,
    history: &mut Vec<serde_json::Value>,
    max_iterations: usize,
    replay_reasoning: bool,
) -> AppResult<String> {
    for _ in 0..max_iterations {
        let step = match model.stream_step(history.as_slice(), true).await {
            Ok(Some(step)) => step,
            Ok(None) => return Ok(String::new()),
            Err(error)
                if is_retryable_tools_error(&error)
                    && !is_content_blocked_error(&error)
                    && !history_has_tool_message(history) =>
            {
                model.stream_step(history.as_slice(), false).await?;
                return Ok(String::new());
            }
            Err(error) => return Err(error),
        };
        if step.calls.is_empty() {
            return Ok(step.text);
        }
        history.push(assistant_tool_message(
            &step.text,
            &step.calls,
            &step.reasoning,
            replay_reasoning,
        ));
        for call in &step.calls {
            match tools.run(call, history).await? {
                StepControl::Continue => {}
                StepControl::StopTurn => return Ok(step.text),
            }
        }
    }
    model.stream_step(history.as_slice(), false).await?;
    Ok(String::new())
}

struct RealModel<'a> {
    client: &'a reqwest::Client,
    url: String,
    key: String,
    req: &'a ChatRequest,
    cancel: &'a Notify,
    state: &'a StreamState,
    on_event: &'a dyn EventSink,
    tool_specs: serde_json::Value,
}

impl ModelClient for RealModel<'_> {
    async fn stream_step(
        &self,
        messages: &[serde_json::Value],
        use_tools: bool,
    ) -> AppResult<Option<Iteration>> {
        if self.state.is_cancelled(&self.req.request_id) {
            return Ok(None);
        }
        if !use_tools {
            return stream_completion(
                self.client,
                self.req,
                self.key.clone(),
                messages.to_vec(),
                self.on_event,
                self.cancel,
            )
            .await
            .map(|()| None);
        }
        let mut body = serde_json::json!({
            "model": self.req.model,
            "messages": prune_tool_history(messages),
            "tools": self.tool_specs,
            "stream": true,
        });
        if wants_stream_usage(self.req.connection_kind.as_deref()) {
            body["stream_options"] = serde_json::json!({ "include_usage": true });
        }
        apply_optional_params(self.client, &mut body, self.req, &self.key).await;
        stream_agentic_iteration(
            self.client,
            &self.url,
            &self.key,
            &body,
            self.cancel,
            self.on_event,
            self.req.connection_kind.as_deref(),
        )
        .await
    }
}

struct RealTools<'a> {
    client: &'a reqwest::Client,
    app: &'a AppHandle,
    req: &'a ChatRequest,
    state: &'a StreamState,
    cancel: &'a Notify,
    on_event: &'a dyn EventSink,
    key: &'a str,
    repeat: RepeatGuard,
    last_pure: Option<(String, String)>,
    children: u32,
}

impl RealTools<'_> {
    async fn run_child(
        &mut self,
        call_id: &str,
        task: &str,
        model: Option<&str>,
    ) -> AppResult<String> {
        if self.req.subagent {
            return Err(AppError::Internal(
                "delegate_task is not available inside a subagent".to_string(),
            ));
        }
        if self.children >= 3 {
            return Err(AppError::Internal(
                "at most 3 subagents per turn".to_string(),
            ));
        }
        let task = task.trim();
        if task.is_empty() {
            return Err(AppError::Internal("delegate_task needs a task".to_string()));
        }
        let model = model
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(self.req.model.as_str());
        if model.chars().count() > 128 {
            return Err(AppError::Internal("model id is too long".to_string()));
        }
        self.children += 1;
        let system = self
            .req
            .child_system
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(CHILD_SYSTEM);
        let child = ChatRequest {
            request_id: format!("{}:d{}", self.req.request_id, self.children),
            base_url: self.req.base_url.clone(),
            connection_id: self.req.connection_id.clone(),
            model: model.to_string(),
            messages: vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: MessageContent::Text(truncate_chars(system, 8000)),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: MessageContent::Text(truncate_chars(task, 8000)),
                },
            ],
            temperature: None,
            enable_tools: true,
            max_iterations: Some(8),
            project_id: self.req.project_id.clone(),
            conversation_id: self.req.conversation_id.clone(),
            reasoning_effort: self.req.reasoning_effort.clone(),
            connection_kind: self.req.connection_kind.clone(),
            search_backend: self.req.search_backend.clone(),
            search_endpoint: self.req.search_endpoint.clone(),
            vision_fallback_model: self.req.vision_fallback_model.clone(),
            vision_fallback_connection: self.req.vision_fallback_connection.clone(),
            child_system: None,
            subagent: true,
        };
        let sink = ScopedSink::new(self.on_event, call_id.to_string());
        Box::pin(run_agentic(
            self.client,
            self.app,
            &child,
            self.key.to_string(),
            &sink,
            self.cancel,
            self.state,
        ))
        .await
    }
}

impl ToolRunner for RealTools<'_> {
    async fn run(
        &mut self,
        call: &serde_json::Value,
        history: &mut Vec<serde_json::Value>,
    ) -> AppResult<StepControl> {
        if self.state.is_cancelled(&self.req.request_id) {
            return Ok(StepControl::StopTurn);
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

        self.on_event.send(StreamEvent::ToolStart {
            id: id.clone(),
            name: name.clone(),
            summary: tools::summarize_call(&name, &args),
        });

        let repeat_key = format!(
            "{name}\n{}",
            serde_json::to_string(&args).unwrap_or_default()
        );
        let streak = self.repeat.note(repeat_key.clone());
        if collapsible_call(&name) {
            if self
                .last_pure
                .as_ref()
                .is_some_and(|(k, _)| k == &repeat_key)
            {
                let output = self
                    .last_pure
                    .as_ref()
                    .map(|(_, o)| o.clone())
                    .unwrap_or_default();
                history.push(tool_text_message(&id, &output));
                if streak < 3 {
                    return Ok(StepControl::Continue);
                }
            }
        } else {
            self.last_pure = None;
        }
        if streak >= 3 {
            let question_id = format!("{}:{id}:repeat", self.req.request_id);
            let (tx, rx) = tokio::sync::oneshot::channel();
            self.state.insert_question(&question_id, tx)?;
            self.on_event.send(StreamEvent::QuestionAsked {
                id: question_id.clone(),
                question: format!(
                    "`{name}` was called 3 times in a row with identical arguments. The turn is paused."
                ),
                options: vec!["Keep going".to_string(), "Stop here".to_string()],
                allow_custom: true,
            });
            let answer = tokio::select! {
                answer = rx => answer.unwrap_or_default(),
                _ = self.cancel.notified() => return Ok(StepControl::StopTurn),
            };
            if answer.trim().is_empty() || answer == "Stop here" {
                self.on_event.send(StreamEvent::ToolResult {
                    id: id.clone(),
                    ok: false,
                    preview: "Stopped: repeated tool call".to_string(),
                });
                history.push(tool_text_message(
                    &id,
                    "Stopped by user: same tool call repeated 3 times",
                ));
                return Ok(StepControl::StopTurn);
            }
            if answer != "Keep going" {
                self.on_event.send(StreamEvent::ToolResult {
                    id: id.clone(),
                    ok: true,
                    preview: answer.chars().take(120).collect(),
                });
                history.push(tool_text_message(&id, &format!("User guidance: {answer}")));
            }
            self.repeat.reset();
        }

        let resources = approval_resources(&name, &args);
        let checked =
            permissions::check(self.app, &name, &resources, self.req.project_id.as_deref()).await;
        if let Err(error) = &checked {
            tools::log_audit(
                self.app,
                self.req.conversation_id.as_deref(),
                &name,
                "check(error)",
                &error.to_string(),
            )
            .await;
        }
        let mut decision = checked
            .as_ref()
            .copied()
            .unwrap_or(permissions::Effect::Ask);
        let sandbox_auto = checked.is_ok()
            && decision != permissions::Effect::Deny
            && name.starts_with("sandbox_")
            && crate::sandbox::enabled(self.app);
        let (verdict, screen_failed) = if decision == permissions::Effect::Ask || sandbox_auto {
            match tauri::async_runtime::spawn_blocking(crate::screen::shared)
                .await
                .ok()
                .flatten()
            {
                Some(screener) => {
                    let text = if resources.is_empty() {
                        tools::summarize_call(&name, &args)
                    } else {
                        format!(
                            "{}\n{}",
                            tools::summarize_call(&name, &args),
                            resources.join("\n")
                        )
                    };
                    match tokio::time::timeout(
                        std::time::Duration::from_millis(900),
                        tauri::async_runtime::spawn_blocking(move || screener.screen(&text)),
                    )
                    .await
                    {
                        Ok(Ok(Some(verdict))) => (Some(verdict), false),
                        Ok(Ok(None)) => {
                            eprintln!("screen: no verdict for this call");
                            (None, true)
                        }
                        Ok(Err(error)) => {
                            eprintln!("screen: inference task failed ({error})");
                            (None, true)
                        }
                        Err(_) => {
                            eprintln!("screen: inference timed out");
                            (None, true)
                        }
                    }
                }
                None => (None, crate::screen::installed()),
            }
        } else {
            (None, false)
        };
        if let Some(verdict) = &verdict {
            if verdict.suggest_deny {
                tools::log_audit(
                    self.app,
                    self.req.conversation_id.as_deref(),
                    &name,
                    "screen(flag)",
                    &format!("{} {:.3}", verdict.label, verdict.score),
                )
                .await;
            }
        }
        if screen_failed {
            tools::log_audit(
                self.app,
                self.req.conversation_id.as_deref(),
                &name,
                "screen(unavailable)",
                &resources.join("\n"),
            )
            .await;
        }
        let screen_flag = screen_failed || verdict.as_ref().is_some_and(|v| v.suggest_deny);
        let verdict_ok = matches!(&verdict, Some(v) if !v.suggest_deny);
        if decision == permissions::Effect::Ask && sandbox_auto && verdict_ok && !screen_failed {
            decision = permissions::Effect::Allow;
            if name != "sandbox_run" {
                tools::log_audit(
                    self.app,
                    self.req.conversation_id.as_deref(),
                    &name,
                    "allow(sandbox-screen)",
                    &resources.join("\n"),
                )
                .await;
            }
        }
        if decision == permissions::Effect::Deny {
            tools::log_audit(
                self.app,
                self.req.conversation_id.as_deref(),
                &name,
                "deny(rule)",
                &resources.join("\n"),
            )
            .await;
            self.on_event.send(StreamEvent::ToolResult {
                id: id.clone(),
                ok: false,
                preview: "Denied by rule".to_string(),
            });
            history.push(tool_text_message(&id, "denied by rule"));
            return Ok(StepControl::Continue);
        }
        if decision == permissions::Effect::Ask {
            let approval_id = format!("{}:{id}", self.req.request_id);
            let command = if name == "run_powershell" {
                resources.join("\n")
            } else if name == "update_memory" || name == "delete_memory" {
                tools::memory_approval_text(self.app, &name, &args, self.req.project_id.as_deref())
                    .await
            } else {
                tools::summarize_call(&name, &args)
            };
            let cwd = if name == "update_memory" || name == "delete_memory" {
                "saved memory".to_string()
            } else {
                std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string())
            };
            let (tx, rx) = tokio::sync::oneshot::channel();
            self.state.insert_pending(
                &approval_id,
                PendingApproval {
                    action: name.clone(),
                    resources: resources.clone(),
                    project_id: self.req.project_id.clone(),
                    screen_flag,
                    tx,
                },
            )?;
            self.on_event.send(StreamEvent::ApprovalAsked {
                id: approval_id.clone(),
                tool: name.clone(),
                command,
                cwd,
                screen: verdict.clone(),
                screen_failed,
            });
            let reply = tokio::select! {
                reply = rx => reply.unwrap_or(ApprovalReply::Deny),
                _ = self.cancel.notified() => {
                    tools::log_audit(
                        self.app,
                        self.req.conversation_id.as_deref(),
                        &name,
                        approval_audit_label(ApprovalReply::Deny),
                        &resources.join("\n"),
                    )
                    .await;
                    return Ok(StepControl::StopTurn);
                }
            };
            if reply == ApprovalReply::Deny {
                tools::log_audit(
                    self.app,
                    self.req.conversation_id.as_deref(),
                    &name,
                    approval_audit_label(reply),
                    &resources.join("\n"),
                )
                .await;
                self.on_event.send(StreamEvent::ToolResult {
                    id: id.clone(),
                    ok: false,
                    preview: "Denied by user".to_string(),
                });
                history.push(tool_text_message(&id, "denied by user"));
                return Ok(StepControl::Continue);
            }
            tools::log_audit(
                self.app,
                self.req.conversation_id.as_deref(),
                &name,
                approval_audit_label(reply),
                &resources.join("\n"),
            )
            .await;
        }

        if name == "ask_user" {
            match tools::parse_question(&args) {
                Err(message) => {
                    self.on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: false,
                        preview: message.clone(),
                    });
                    history.push(tool_text_message(&id, &format!("Error: {message}")));
                }
                Ok(asked) => {
                    let question_id = format!("{}:{id}", self.req.request_id);
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    self.state.insert_question(&question_id, tx)?;
                    self.on_event.send(StreamEvent::QuestionAsked {
                        id: question_id.clone(),
                        question: asked.question,
                        options: asked.options,
                        allow_custom: asked.allow_custom,
                    });
                    let answer = tokio::select! {
                        answer = rx => answer.unwrap_or_default(),
                        _ = self.cancel.notified() => return Ok(StepControl::StopTurn),
                    };
                    let content = if answer.trim().is_empty() {
                        "no answer (cancelled)".to_string()
                    } else {
                        answer
                    };
                    self.on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: true,
                        preview: truncate_preview(&content),
                    });
                    history.push(tool_text_message(&id, &content));
                }
            }
            return Ok(StepControl::Continue);
        }

        if name == "delegate_task" {
            let task = args.get("task").and_then(|v| v.as_str()).unwrap_or("");
            let model = args.get("model").and_then(|v| v.as_str());
            match self.run_child(&id, task, model).await {
                Ok(summary) => {
                    let output = if summary.trim().is_empty() {
                        "Subagent finished with no summary.".to_string()
                    } else {
                        truncate_chars(summary.trim(), 6000)
                    };
                    self.on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: true,
                        preview: truncate_preview(&output),
                    });
                    history.push(tool_text_message(&id, &output));
                }
                Err(error) => {
                    let message = error.to_string();
                    self.on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: false,
                        preview: truncate_preview(&message),
                    });
                    history.push(tool_text_message(&id, &format!("Error: {message}")));
                }
            }
            return Ok(StepControl::Continue);
        }

        if name == "research_run" {
            let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let progress = |summary: &str| {
                self.on_event.send(StreamEvent::ToolStart {
                    id: id.clone(),
                    name: "research_run".to_string(),
                    summary: summary.to_string(),
                });
            };
            let result = crate::research::run(
                crate::research::ResearchRequest {
                    app: self.app,
                    client: self.client,
                    base_url: &self.req.base_url,
                    key: self.key,
                    model: &self.req.model,
                    connection_kind: self.req.connection_kind.as_deref(),
                    backend: self.req.search_backend.as_deref(),
                    endpoint: self.req.search_endpoint.as_deref(),
                    query,
                    cancel: self.cancel,
                },
                progress,
            )
            .await;
            match result {
                Ok(outcome) => {
                    self.on_event.send(StreamEvent::Artifact {
                        title: format!("Research: {}", truncate_chars(query.trim(), 80)),
                        lang: "markdown".to_string(),
                        code: outcome.memo.clone(),
                    });
                    tools::log_audit(
                        self.app,
                        self.req.conversation_id.as_deref(),
                        "research_run",
                        "done",
                        &format!(
                            "{} sources, {} pages, {} failed",
                            outcome.sources, outcome.fetched, outcome.failed
                        ),
                    )
                    .await;
                    self.on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: true,
                        preview: truncate_preview(&outcome.memo),
                    });
                    history.push(tool_text_message(&id, &outcome.memo));
                }
                Err(AppError::Cancelled) => return Ok(StepControl::StopTurn),
                Err(error) => {
                    let message = error.to_string();
                    self.on_event.send(StreamEvent::ToolResult {
                        id: id.clone(),
                        ok: false,
                        preview: truncate_preview(&message),
                    });
                    history.push(tool_text_message(&id, &format!("Error: {message}")));
                }
            }
            return Ok(StepControl::Continue);
        }

        let touched_path = if matches!(name.as_str(), "sandbox_write" | "sandbox_edit") {
            args.get("path")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        } else {
            None
        };

        match match crate::mcp::try_execute(
            self.app,
            self.req.project_id.as_deref(),
            &name,
            args.clone(),
            self.cancel,
        )
        .await
        {
            Some(result) => result,
            None => {
                tools::execute(
                    self.app,
                    &name,
                    args,
                    &id,
                    &tools::ExecContext {
                        conversation_id: self.req.conversation_id.as_deref(),
                        project_id: self.req.project_id.as_deref(),
                        search_backend: self.req.search_backend.as_deref(),
                        search_endpoint: self.req.search_endpoint.as_deref(),
                        base_url: Some(self.req.base_url.as_str()),
                        connection_id: Some(self.req.connection_id.as_str()),
                        vision_fallback_model: self.req.vision_fallback_model.as_deref(),
                        vision_fallback_connection: self.req.vision_fallback_connection.as_deref(),
                    },
                    self.cancel,
                )
                .await
            }
        } {
            Ok(done) => {
                if collapsible_call(&name) {
                    self.last_pure = Some((repeat_key.clone(), done.output.clone()));
                }
                if let Some(artifact) = done.artifact {
                    self.on_event.send(StreamEvent::Artifact {
                        title: artifact.title,
                        lang: artifact.lang,
                        code: artifact.code,
                    });
                }
                let domains = if name == "web_search" {
                    domains_in(&done.output)
                } else {
                    Vec::new()
                };
                let files: Vec<String> = touched_path.clone().into_iter().collect();
                if !domains.is_empty() || !files.is_empty() {
                    self.on_event.send(StreamEvent::ToolSources {
                        id: id.clone(),
                        domains,
                        files,
                    });
                }
                self.on_event.send(StreamEvent::ToolResult {
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
                self.on_event.send(StreamEvent::ToolResult {
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
        Ok(StepControl::Continue)
    }
}

async fn run_agentic(
    client: &reqwest::Client,
    app: &AppHandle,
    req: &ChatRequest,
    key: String,
    on_event: &dyn EventSink,
    cancel: &Notify,
    state: &StreamState,
) -> AppResult<String> {
    let url = endpoint(&req.base_url, "chat/completions");
    let mut history: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();
    history = harden_deepseek_history(history, &req.model, req.connection_kind.as_deref(), &url);
    let (removed, note) = route_vision(&mut history, req.vision_fallback_model.as_deref());
    if removed > 0 {
        if let Some(note) = note {
            let at = history
                .iter()
                .position(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"))
                .map(|i| i + 1)
                .unwrap_or(0);
            history.insert(at, serde_json::json!({"role": "system", "content": note}));
        }
    }
    let replay_reasoning = uses_deepseek_reasoning_replay(&req.model);
    let max = req.max_iterations.unwrap_or(25).clamp(1, 32) as usize;
    let blind_model = req
        .vision_fallback_model
        .as_deref()
        .is_some_and(|model| !model.trim().is_empty());
    let has_documents = match req.conversation_id.as_deref() {
        Some(conversation) => {
            match crate::documents::conversation_documents(app, conversation).await {
                Ok(documents) => !documents.is_empty(),
                Err(error) => {
                    eprintln!("read_document gating: {error}");
                    false
                }
            }
        }
        None => false,
    };
    let mut model = RealModel {
        client,
        url,
        key: key.clone(),
        req,
        cancel,
        state,
        on_event,
        tool_specs: {
            let mut specs =
                tools::tool_specs(blind_model, has_documents, crate::sandbox::enabled(app));
            if req.subagent {
                strip_tool_spec(&mut specs, "delegate_task");
            }
            specs
        },
    };
    let mcp_tools = crate::mcp::flush(app, req.project_id.as_deref())
        .await
        .unwrap_or_default();
    if !mcp_tools.is_empty() {
        if let Some(specs) = model.tool_specs.as_array_mut() {
            for def in &mcp_tools {
                specs.push(crate::mcp::spec_for(def));
            }
        }
    }
    let mut runner = RealTools {
        client,
        app,
        req,
        state,
        cancel,
        on_event,
        key: &key,
        repeat: RepeatGuard::new(),
        last_pure: None,
        children: 0,
    };
    agent_loop(&model, &mut runner, &mut history, max, replay_reasoning).await
}

async fn stream_completion(
    client: &reqwest::Client,
    req: &ChatRequest,
    key: String,
    history: Vec<serde_json::Value>,
    on_event: &dyn EventSink,
    cancel: &Notify,
) -> AppResult<()> {
    let url = endpoint(&req.base_url, "chat/completions");
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
                    on_event.send(StreamEvent::Done);
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
                        on_event.send(StreamEvent::Delta { text: mapped.text });
                    }
                    if !mapped.reasoning.is_empty() {
                        received += 1;
                        on_event.send(StreamEvent::Reasoning {
                            text: mapped.reasoning,
                        });
                    }
                    if let Some(usage) = mapped.usage {
                        on_event.send(StreamEvent::Usage {
                            prompt_tokens: usage.prompt,
                            completion_tokens: usage.completion,
                            total_tokens: usage.total,
                        });
                    }
                    if mapped.finish_reason.is_some() {
                        on_event.send(StreamEvent::Finish {
                            reason: mapped.finish_reason,
                        });
                    }
                }
            }
        }
    }

    on_event.send(StreamEvent::Done);
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

    #[test]
    fn deepseek_seeds_fill_an_empty_catalog_without_inventing_a_window() {
        let caps = with_model_seeds(Some("deepseek"), Vec::new());
        let ids: Vec<&str> = caps.iter().map(|caps| caps.id.as_str()).collect();
        assert_eq!(ids, vec!["deepseek-chat", "deepseek-reasoner"]);
        assert!(caps.iter().all(|caps| caps.context_length.is_none()));
        assert!(caps.iter().all(|caps| caps.supports_vision == Some(false)));
        assert_eq!(
            caps.iter()
                .find(|caps| caps.id == "deepseek-reasoner")
                .and_then(|caps| caps.supports_reasoning),
            Some(true)
        );
    }

    #[test]
    fn a_fetched_seed_is_not_duplicated() {
        let fetched = vec![ModelCaps {
            id: "deepseek-chat".to_string(),
            context_length: Some(128_000),
            supports_tools: Some(true),
            supports_reasoning: Some(false),
            supports_vision: Some(false),
            efforts: None,
            mandatory: false,
        }];
        let caps = with_model_seeds(Some("deepseek"), fetched);
        assert_eq!(
            caps.iter()
                .filter(|caps| caps.id == "deepseek-chat")
                .count(),
            1
        );
        assert_eq!(
            caps.iter()
                .find(|caps| caps.id == "deepseek-chat")
                .and_then(|caps| caps.context_length),
            Some(128_000)
        );
    }

    #[test]
    fn other_kinds_get_no_seeds() {
        assert!(with_model_seeds(Some("openrouter"), Vec::new()).is_empty());
    }

    #[test]
    fn ollama_tags_parse_into_models_with_unknown_caps() {
        let value = serde_json::json!({
            "models": [{ "name": "llama3.2:latest" }, { "model": "qwen3:8b" }, { "size": 1 }]
        });
        let caps = parse_ollama_tags(&value);
        let ids: Vec<&str> = caps.iter().map(|caps| caps.id.as_str()).collect();
        assert_eq!(ids, vec!["llama3.2:latest", "qwen3:8b"]);
        assert!(caps.iter().all(|caps| caps.context_length.is_none()));
    }

    #[test]
    fn domains_in_keeps_each_host_once() {
        let text = r#"{"results":[{"url":"https://docs.rs/serde/latest"},{"url":"https://docs.rs/serde/latest?x=1"},{"url":"http://example.com/a"},{"url":"mailto:x@y.z"}]}"#;
        assert_eq!(
            domains_in(text),
            vec!["docs.rs".to_string(), "example.com".to_string()]
        );
    }

    #[test]
    fn domains_in_needs_a_scheme() {
        assert!(domains_in("see docs.rs and example.com").is_empty());
    }

    #[test]
    fn direct_providers_get_no_effort_field() {
        for kind in ["deepseek", "ollama", "ollama-cloud"] {
            let mut body = serde_json::json!({});
            attach_effort(&mut body, Some(kind), "high");
            assert!(
                body.get("reasoning_effort").is_none(),
                "{kind} got reasoning_effort"
            );
            assert!(
                body.get("reasoning").is_none(),
                "{kind} got a reasoning block"
            );
        }
    }

    #[test]
    fn gateways_keep_their_own_effort_shape() {
        let mut openrouter = serde_json::json!({});
        attach_effort(&mut openrouter, Some("openrouter"), "medium");
        assert_eq!(openrouter["reasoning"]["effort"], "medium");

        let mut custom = serde_json::json!({});
        attach_effort(&mut custom, Some("custom"), "low");
        assert_eq!(custom["reasoning_effort"], "low");
    }

    #[test]
    fn ollama_gets_no_stream_usage_option() {
        assert!(!wants_stream_usage(Some("ollama")));
        assert!(!wants_stream_usage(Some("ollama-cloud")));
        assert!(wants_stream_usage(Some("deepseek")));
        assert!(wants_stream_usage(Some("openrouter")));
    }

    struct RecordingSink(Mutex<Vec<StreamEvent>>);

    impl EventSink for RecordingSink {
        fn send(&self, event: StreamEvent) {
            if let Ok(mut events) = self.0.lock() {
                events.push(event);
            }
        }
    }

    fn spec_names(specs: &serde_json::Value) -> Vec<String> {
        specs
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|spec| {
                        spec.get("function")
                            .and_then(|function| function.get("name"))
                            .and_then(|value| value.as_str())
                            .map(str::to_string)
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn scoped_sink_wraps_child_events() {
        let sink = RecordingSink(Mutex::new(Vec::new()));
        let scoped = ScopedSink::new(&sink, "call-1".to_string());
        scoped.send(StreamEvent::Delta {
            text: "hi".to_string(),
        });
        let events = sink.0.lock().expect("events");
        assert_eq!(events.len(), 1);
        let value = serde_json::to_value(&events[0]).expect("json");
        assert_eq!(value["type"], "subagent");
        assert_eq!(value["parent"], "call-1");
        assert_eq!(value["event"]["type"], "delta");
        assert_eq!(value["event"]["text"], "hi");
    }

    #[test]
    fn collect_inband_forwards_text_and_holds_calls() {
        let sink = RecordingSink(Mutex::new(Vec::new()));
        let mut healed = Vec::new();
        let mut text = String::new();
        collect_inband(
            vec![
                crate::inband::InbandEvent::Text("hello".to_string()),
                crate::inband::InbandEvent::Call {
                    name: "get_time".to_string(),
                    arguments: "{}".to_string(),
                },
            ],
            &mut healed,
            &mut text,
            &sink,
        );
        assert_eq!(text, "hello");
        assert_eq!(healed, vec![("get_time".to_string(), "{}".to_string())]);
        let events = sink.0.lock().expect("events");
        assert_eq!(events.len(), 1);
        assert_eq!(
            serde_json::to_value(&events[0]).expect("json")["text"],
            serde_json::json!("hello")
        );
    }

    #[test]
    fn healed_calls_fill_an_empty_accumulator_only() {
        let mut accumulator = sse::ToolCallAccumulator::new();
        absorb_healed(
            &mut accumulator,
            vec![(
                "run_powershell".to_string(),
                "{\"command\":\"x\"}".to_string(),
            )],
        );
        let calls = accumulator.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["id"], serde_json::json!("dsml-0"));

        let mut accumulator = sse::ToolCallAccumulator::new();
        accumulator.apply(vec![sse::ToolCallDelta {
            index: 0,
            id: "call-1".to_string(),
            name: "get_time".to_string(),
            arguments: "{}".to_string(),
        }]);
        absorb_healed(
            &mut accumulator,
            vec![("run_powershell".to_string(), "{}".to_string())],
        );
        let calls = accumulator.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["function"]["name"], serde_json::json!("get_time"));
    }

    #[test]
    fn scoped_sink_keeps_approvals_on_the_parent_stream() {
        let sink = RecordingSink(Mutex::new(Vec::new()));
        let scoped = ScopedSink::new(&sink, "call-1".to_string());
        scoped.send(StreamEvent::ApprovalAsked {
            id: "a1".to_string(),
            tool: "run_powershell".to_string(),
            command: "ls".to_string(),
            cwd: "C:\\".to_string(),
            screen: None,
            screen_failed: false,
        });
        let events = sink.0.lock().expect("events");
        assert_eq!(events.len(), 1);
        let value = serde_json::to_value(&events[0]).expect("json");
        assert_eq!(value["type"], "approval_asked");
        assert!(value.get("parent").is_none());
    }

    #[test]
    fn delegate_task_is_offered_at_depth_zero_only() {
        let mut specs = tools::tool_specs(false, false, false);
        assert!(spec_names(&specs).contains(&"delegate_task".to_string()));
        strip_tool_spec(&mut specs, "delegate_task");
        assert!(!spec_names(&specs).contains(&"delegate_task".to_string()));
        assert!(spec_names(&specs).contains(&"ask_user".to_string()));
    }

    #[test]
    fn renderer_cannot_supply_base_url() {
        let chat: ChatRequest = serde_json::from_str(
            r#"{"request_id":"r1","base_url":"https://attacker.example","connection_id":"c1","model":"m","messages":[]}"#,
        )
        .expect("chat request parses");
        assert!(chat.base_url.is_empty());

        let title: TitleRequest = serde_json::from_str(
            r#"{"base_url":"https://attacker.example","connection_id":"c1","model":"m","user_text":"u","assistant_text":"a"}"#,
        )
        .expect("title request parses");
        assert!(title.base_url.is_empty());

        let summary: SummaryRequest = serde_json::from_str(
            r#"{"base_url":"https://attacker.example","connection_id":"c1","model":"m","text":"t"}"#,
        )
        .expect("summary request parses");
        assert!(summary.base_url.is_empty());
    }

    #[test]
    fn approval_audit_labels_cover_every_reply() {
        assert_eq!(approval_audit_label(ApprovalReply::Once), "once");
        assert_eq!(approval_audit_label(ApprovalReply::Always), "always");
        assert_eq!(approval_audit_label(ApprovalReply::Deny), "deny(user)");
    }

    #[test]
    fn parts_serialize_openai_shape() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: MessageContent::Parts(vec![
                ContentPart::Text {
                    text: "see this".to_string(),
                },
                ContentPart::ImageUrl {
                    image_url: ImageUrl {
                        url: "data:image/jpeg;base64,AAA".to_string(),
                        detail: None,
                    },
                },
            ]),
        };
        let value = serde_json::to_value(&msg).expect("serializes");
        assert_eq!(
            value["content"][0],
            serde_json::json!({"type": "text", "text": "see this"})
        );
        assert_eq!(value["content"][1]["type"], serde_json::json!("image_url"));
        assert_eq!(
            value["content"][1]["image_url"]["url"],
            serde_json::json!("data:image/jpeg;base64,AAA")
        );
    }

    #[test]
    fn message_text_reads_parts() {
        let content = serde_json::json!([
            {"type": "text", "text": "hello "},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,AAA"}},
        ]);
        assert_eq!(message_text(&content), "hello ");
    }

    #[test]
    fn vision_flag_reads_input_modalities() {
        let value = serde_json::json!({"data": [
            {"id": "m-sees", "architecture": {"modality": "text+image->text", "input_modalities": ["text", "image"]}},
            {"id": "m-blind", "architecture": {"modality": "text->text", "input_modalities": ["text"]}},
            {"id": "m-legacy", "supported_parameters": ["tools"]},
        ]});
        let caps = parse_models_caps(&value);
        let sees = caps.iter().find(|c| c.id == "m-sees").expect("sees parsed");
        let blind = caps
            .iter()
            .find(|c| c.id == "m-blind")
            .expect("blind parsed");
        let legacy = caps
            .iter()
            .find(|c| c.id == "m-legacy")
            .expect("legacy parsed");
        assert_eq!(sees.supports_vision, Some(true));
        assert_eq!(blind.supports_vision, Some(false));
        assert_eq!(legacy.supports_vision, None);
    }

    #[test]
    fn blind_model_strips_images_and_notes_tool() {
        let mut history = vec![serde_json::json!({"role": "user", "content": [
            {"type": "text", "text": "look at this"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}},
        ]})];
        let (removed, note) = route_vision(&mut history, Some("fallback-model"));
        assert_eq!(removed, 1);
        let note = note.expect("note for blind model");
        assert!(
            note.contains("describe_image"),
            "tells agent the tool: {note}"
        );
        assert_eq!(history[0]["content"], serde_json::json!("look at this"));
    }

    #[test]
    fn no_fallback_leaves_history_untouched() {
        let mut history = vec![serde_json::json!({"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}},
        ]})];
        let (removed, note) = route_vision(&mut history, None);
        assert_eq!(removed, 0);
        assert!(note.is_none());
        assert!(history[0]["content"].is_array());
    }

    #[test]
    fn describe_image_tool_is_listed_and_gated() {
        let specs = tools::tool_specs(true, true, false);
        let names: Vec<&str> = specs
            .as_array()
            .expect("array")
            .iter()
            .filter_map(|s| s["function"]["name"].as_str())
            .collect();
        assert!(names.contains(&"describe_image"), "spec listed: {names:?}");
        let seeing = tools::tool_specs(false, true, false);
        let seeing_names: Vec<&str> = seeing
            .as_array()
            .expect("array")
            .iter()
            .filter_map(|s| s["function"]["name"].as_str())
            .collect();
        assert!(
            !seeing_names.contains(&"describe_image"),
            "hidden from a seeing model: {seeing_names:?}"
        );
        assert_eq!(
            approval_resources("describe_image", &serde_json::json!({"index": 0})),
            vec!["image#0".to_string()],
            "scoped to the image"
        );
        assert_eq!(
            approval_resources("skill", &serde_json::json!({"id": "git-helper"})),
            vec!["git-helper".to_string()],
            "skill asserts per-id"
        );
        assert_eq!(
            approval_resources("fs_read", &serde_json::json!({"path": "/tmp"})),
            vec!["fs_read".to_string()],
            "unknown tools scope to their own name"
        );
        assert_eq!(
            approval_resources("mcp__fs__read_file", &serde_json::json!({})),
            vec!["mcp__fs__read_file".to_string()],
            "mcp tools scope to the server/tool alias so Always persists"
        );
    }

    #[test]
    fn memory_edit_tools_are_listed_and_approve_per_row() {
        let specs = tools::tool_specs(false, false, false);
        let names: Vec<&str> = specs
            .as_array()
            .expect("array")
            .iter()
            .filter_map(|s| s["function"]["name"].as_str())
            .collect();
        for name in [
            "remember",
            "recall_memory",
            "update_memory",
            "delete_memory",
        ] {
            assert!(names.contains(&name), "{name} listed: {names:?}");
        }
        assert_eq!(
            approval_resources(
                "delete_memory",
                &serde_json::json!({"id": "11111111-1111-4111-8111-111111111111"})
            ),
            vec!["11111111-1111-4111-8111-111111111111".to_string()],
            "a delete rule pins one row, never the whole tool"
        );
        assert_eq!(
            approval_resources(
                "update_memory",
                &serde_json::json!({"id": "11111111-1111-4111-8111-111111111111", "content": "x"})
            ),
            vec!["11111111-1111-4111-8111-111111111111".to_string()],
            "an update rule pins one row"
        );
        assert_eq!(
            approval_resources("delete_memory", &serde_json::json!({"id": "1*"})),
            vec!["delete_memory".to_string()],
            "an id that is not a uuid stays the bare tool name, so a wildcard cannot be stored"
        );
        assert_eq!(
            approval_resources(
                "delete_memory",
                &serde_json::json!({"id": " 11111111-1111-4111-8111-111111111111 "})
            ),
            vec!["11111111-1111-4111-8111-111111111111".to_string()],
            "a padded id is the row, never the tool name the rule would share with every other row"
        );
        assert_eq!(
            approval_resources(
                "delete_memory",
                &serde_json::json!({"id": "11111111111141118111111111111111"})
            ),
            vec!["11111111-1111-4111-8111-111111111111".to_string()],
            "the resource is the canonical uuid, so the form the model sent does not matter"
        );
    }

    #[test]
    fn read_document_tool_is_listed_only_with_documents() {
        let specs = tools::tool_specs(false, true, false);
        let names: Vec<&str> = specs
            .as_array()
            .expect("array")
            .iter()
            .filter_map(|s| s["function"]["name"].as_str())
            .collect();
        assert!(names.contains(&"read_document"), "spec listed: {names:?}");

        let without = tools::tool_specs(true, false, false);
        let without_names: Vec<&str> = without
            .as_array()
            .expect("array")
            .iter()
            .filter_map(|s| s["function"]["name"].as_str())
            .collect();
        assert!(
            !without_names.contains(&"read_document"),
            "hidden without documents: {without_names:?}"
        );
        assert!(
            without_names.contains(&"describe_image"),
            "image path unaffected: {without_names:?}"
        );
        assert_eq!(
            approval_resources("read_document", &serde_json::json!({"name": "report.pdf"})),
            vec!["report.pdf".to_string()],
            "scoped to the document"
        );
    }
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

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

    fn collect_events() -> (Channel<StreamEvent>, Arc<Mutex<Vec<serde_json::Value>>>) {
        let seen: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let channel = Channel::new(move |body: tauri::ipc::InvokeResponseBody| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) {
                    if let Ok(mut guard) = sink.lock() {
                        guard.push(value);
                    }
                }
            }
            Ok(())
        });
        (channel, seen)
    }

    fn delta_texts(seen: &Arc<Mutex<Vec<serde_json::Value>>>) -> Vec<String> {
        seen.lock()
            .map(|guard| {
                guard
                    .iter()
                    .filter(|event| event["type"] == "delta")
                    .filter_map(|event| event["text"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn stream_request(url: &str) -> ChatRequest {
        let mut req: ChatRequest = serde_json::from_str(
            r#"{"request_id":"r1","connection_id":"c1","model":"test","messages":[{"role":"user","content":"hi"}]}"#,
        )
        .expect("chat request parses");
        req.base_url = url.to_string();
        req
    }

    fn serve_sse(
        first: &'static str,
        rest: Vec<&'static str>,
        gate: std::sync::mpsc::Receiver<()>,
        connections: Arc<AtomicUsize>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let addr = listener.local_addr().expect("test server addr");
        std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            connections.fetch_add(1, AtomicOrdering::SeqCst);
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
            let mut request_body = vec![0u8; content_length];
            let _ = reader.read_exact(&mut request_body);
            let mut stream = reader.into_inner();
            let _ = stream.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
            );
            let _ = stream.flush();
            let _ = stream.write_all(first.as_bytes());
            let _ = stream.flush();
            let _ = gate.recv();
            for chunk in rest {
                if stream.write_all(chunk.as_bytes()).is_err() {
                    return;
                }
                let _ = stream.flush();
            }
            std::thread::sleep(Duration::from_millis(200));
        });
        format!("http://{addr}")
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

    #[tokio::test]
    async fn content_blocked_400_does_not_retry() {
        let url = serve_script(vec![(
            "400 Bad Request",
            "",
            r#"{"error":"content-blocked agent_router_api_error request id:abc"}"#,
        )]);
        let cancel = Notify::new();
        let error = post_with_retry(&test_client(), &url, "key", &body(), &cancel, None, None)
            .await
            .expect_err("content-blocked 400 must not retry");
        assert!(
            matches!(error, AppError::Upstream(message) if message.contains("content-blocked"))
        );
    }

    #[tokio::test]
    async fn stream_error_mid_flight_is_not_retried() {
        let connections = Arc::new(AtomicUsize::new(0));
        let (gate_tx, gate_rx) = std::sync::mpsc::channel();
        gate_tx.send(()).expect("pre-release the gate");
        let url = serve_sse(
            "data: {\"choices\":[{\"delta\":{\"content\":\"one\"}}]}\n\n",
            vec!["data: {\"error\":{\"message\":\"upstream exploded\"}}\n\n"],
            gate_rx,
            connections.clone(),
        );
        let req = stream_request(&url);
        let (channel, seen) = collect_events();
        let cancel = Notify::new();
        let error = stream_completion(
            &test_client(),
            &req,
            "key".to_string(),
            vec![serde_json::json!({"role": "user", "content": "hi"})],
            &channel,
            &cancel,
        )
        .await
        .expect_err("a mid-stream error is not retried");
        assert!(
            matches!(error, AppError::Upstream(message) if message.contains("upstream exploded"))
        );
        assert_eq!(delta_texts(&seen), vec!["one"]);
        assert_eq!(connections.load(AtomicOrdering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cancel_mid_stream_keeps_the_text_already_sent() {
        let connections = Arc::new(AtomicUsize::new(0));
        let (gate_tx, gate_rx) = std::sync::mpsc::channel();
        let url = serve_sse(
            "data: {\"choices\":[{\"delta\":{\"content\":\"one\"}}]}\n\n",
            vec![
                "data: {\"choices\":[{\"delta\":{\"content\":\"two\"}}]}\n\n",
                "data: [DONE]\n\n",
            ],
            gate_rx,
            connections.clone(),
        );
        let req = stream_request(&url);
        let (channel, seen) = collect_events();
        let cancel = Arc::new(Notify::new());
        let client = test_client();
        let turn = {
            let cancel = cancel.clone();
            let channel = channel.clone();
            tokio::spawn(async move {
                stream_completion(&client, &req, "key".to_string(), vec![], &channel, &cancel).await
            })
        };
        for _ in 0..500 {
            let empty = seen.lock().map(|guard| guard.is_empty()).unwrap_or(true);
            if !empty {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            delta_texts(&seen),
            vec!["one"],
            "the first delta must arrive before the cancel"
        );
        cancel.notify_one();
        let result = tokio::time::timeout(Duration::from_secs(5), turn).await;
        gate_tx.send(()).expect("release the rest of the stream");
        let result = result
            .expect("the turn must resolve after a cancel")
            .expect("stream task");
        assert!(result.is_ok(), "cancel resolves the turn without an error");
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(
            delta_texts(&seen),
            vec!["one"],
            "later chunks never arrive after a cancel"
        );
    }

    #[test]
    fn final_text_answer_is_never_retracted() {
        assert!(!should_retract("final answer", &[]));
        assert!(!should_retract("", &[]));
    }

    #[test]
    fn tool_preamble_text_is_retracted() {
        let calls = vec![serde_json::json!({ "id": "c1" })];
        assert!(should_retract("let me check", &calls));
        assert!(!should_retract("", &calls));
    }

    #[test]
    fn deepseek_tool_message_replays_reasoning_even_when_empty() {
        let message = assistant_tool_message("ok", &[], "", true);
        assert_eq!(message["role"], "assistant");
        assert_eq!(message["content"], "ok");
        assert_eq!(message["reasoning_content"], "");
    }

    #[test]
    fn non_deepseek_tool_message_omits_reasoning() {
        let message = assistant_tool_message("ok", &[], "step reasoning", false);
        assert!(message.get("reasoning_content").is_none());
    }

    #[test]
    fn deepseek_reasoning_replay_matches_model_family() {
        assert!(uses_deepseek_reasoning_replay("deepseek/deepseek-v4-flash"));
        assert!(uses_deepseek_reasoning_replay("deepseek-chat"));
        assert!(uses_deepseek_reasoning_replay("DeepSeek-R1"));
        assert!(uses_deepseek_reasoning_replay("openrouter/deepseek-v3"));
        assert!(!uses_deepseek_reasoning_replay("my-deepseek-clone"));
        assert!(!uses_deepseek_reasoning_replay("gpt-4o"));
    }

    enum FakeStep {
        Text(&'static str),
        Tool,
    }

    struct FakeModel {
        script: RefCell<VecDeque<FakeStep>>,
        calls: Cell<usize>,
        tools_flags: RefCell<Vec<bool>>,
    }

    impl FakeModel {
        fn new(script: Vec<FakeStep>) -> Self {
            Self {
                script: RefCell::new(script.into()),
                calls: Cell::new(0),
                tools_flags: RefCell::new(Vec::new()),
            }
        }

        fn call_count(&self) -> usize {
            self.calls.get()
        }

        fn tools_flags(&self) -> Vec<bool> {
            self.tools_flags.borrow().clone()
        }
    }

    impl ModelClient for FakeModel {
        async fn stream_step(
            &self,
            _messages: &[serde_json::Value],
            use_tools: bool,
        ) -> AppResult<Option<Iteration>> {
            self.calls.set(self.calls.get() + 1);
            self.tools_flags.borrow_mut().push(use_tools);
            let step = self
                .script
                .borrow_mut()
                .pop_front()
                .unwrap_or(FakeStep::Tool);
            Ok(Some(match step {
                FakeStep::Text(text) => Iteration {
                    text: text.to_string(),
                    calls: Vec::new(),
                    reasoning: String::new(),
                },
                FakeStep::Tool => Iteration {
                    text: String::new(),
                    calls: vec![serde_json::json!({
                        "id": "call-1",
                        "type": "function",
                        "function": { "name": "get_time", "arguments": "{}" },
                    })],
                    reasoning: String::new(),
                },
            }))
        }
    }

    struct FakeTools {
        runs: Cell<usize>,
    }

    impl FakeTools {
        fn new() -> Self {
            Self { runs: Cell::new(0) }
        }
    }

    impl ToolRunner for FakeTools {
        async fn run(
            &mut self,
            _call: &serde_json::Value,
            history: &mut Vec<serde_json::Value>,
        ) -> AppResult<StepControl> {
            self.runs.set(self.runs.get() + 1);
            history.push(tool_text_message("call-1", "ok"));
            Ok(StepControl::Continue)
        }
    }

    #[tokio::test]
    async fn agent_loop_runs_one_tool_round_then_answers() {
        let model = FakeModel::new(vec![FakeStep::Tool, FakeStep::Text("done")]);
        let mut tools = FakeTools::new();
        let mut history = Vec::new();
        agent_loop(&model, &mut tools, &mut history, 25, false)
            .await
            .expect("loop");
        assert_eq!(model.call_count(), 2);
        assert_eq!(tools.runs.get(), 1);
        assert_eq!(model.tools_flags(), vec![true, true]);
        assert!(history_has_tool_message(&history));
    }

    #[tokio::test]
    async fn agent_loop_answers_immediately_without_calling_tools() {
        let model = FakeModel::new(vec![FakeStep::Text("hi")]);
        let mut tools = FakeTools::new();
        let mut history = Vec::new();
        agent_loop(&model, &mut tools, &mut history, 25, false)
            .await
            .expect("loop");
        assert_eq!(model.call_count(), 1);
        assert_eq!(tools.runs.get(), 0);
        assert_eq!(model.tools_flags(), vec![true]);
    }

    #[tokio::test]
    async fn agent_loop_falls_back_without_tools_after_max_iterations() {
        let model = FakeModel::new(Vec::new());
        let mut tools = FakeTools::new();
        let mut history = Vec::new();
        agent_loop(&model, &mut tools, &mut history, 3, false)
            .await
            .expect("loop");
        assert_eq!(model.call_count(), 4);
        assert_eq!(tools.runs.get(), 3);
        assert_eq!(model.tools_flags(), vec![true, true, true, false]);
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
    }

    #[test]
    fn sanitize_stays_stable_on_thick_tripword_turns() {
        let history =
            vec![serde_json::json!({"role": "user", "content": "explain language model"})];
        let once = harden_deepseek_history(
            history.clone(),
            "deepseek-v4-flash",
            Some("agentrouter"),
            "https://agentrouter.org/v1/chat/completions",
        );
        assert_eq!(
            once[0]["content"],
            serde_json::json!("explain large language model")
        );
        let twice = harden_deepseek_history(
            once.clone(),
            "deepseek-v4-flash",
            Some("agentrouter"),
            "https://agentrouter.org/v1/chat/completions",
        );
        assert_eq!(twice, once);
        assert_eq!(
            twice[0]["content"]
                .as_str()
                .unwrap()
                .matches("large language model")
                .count(),
            1
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
            supports_vision: None,
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
                supports_vision: None,
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

    #[test]
    fn message_text_handles_string_and_parts() {
        assert_eq!(message_text(&serde_json::json!("hello")), "hello");
        assert_eq!(
            message_text(&serde_json::json!([
                {"type": "text", "text": "Tit"},
                {"type": "text", "text": "le"}
            ])),
            "Title"
        );
        assert_eq!(message_text(&serde_json::json!(42)), "");
    }

    #[tokio::test]
    #[ignore = "live network; requires AGENTROUTER_KEY"]
    async fn live_title_generation() {
        let Ok(key) = std::env::var("AGENTROUTER_KEY") else {
            panic!("AGENTROUTER_KEY not set");
        };
        let client = reqwest::Client::new();
        let url = endpoint("https://agentrouter.org/v1", "chat/completions");
        let model =
            std::env::var("TITLE_MODEL").unwrap_or_else(|_| "deepseek-v4-flash".to_string());
        let body = serde_json::json!({
            "model": model,
            "messages": [
                {"role": "system", "content": "Title this conversation in 6 words or fewer. Plain text only: no quotes, no punctuation, no preamble."},
                {"role": "user", "content": "User asked: what is two plus two?\n\nAssistant answered (excerpt): Four."}
            ],
            "max_tokens": 512,
            "temperature": 0.3,
            "stream": false
        });
        let cancel = Notify::new();
        let resp = post_with_retry(
            &client,
            &url,
            &key,
            &body,
            &cancel,
            None,
            Some("agentrouter"),
        )
        .await
        .expect("title request");
        let value: serde_json::Value = resp.json().await.expect("title json");
        let title = value["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .trim()
            .to_string();
        eprintln!("LIVE TITLE = {title:?}");
        assert!(!title.is_empty(), "provider returned an empty title");
    }

    #[tokio::test]
    #[ignore = "live network; requires AGENTROUTER_KEY"]
    async fn live_chat_probe() {
        let Ok(key) = std::env::var("AGENTROUTER_KEY") else {
            panic!("AGENTROUTER_KEY not set");
        };
        let client = reqwest::Client::new();
        let url = endpoint("https://agentrouter.org/v1", "chat/completions");
        let model =
            std::env::var("TITLE_MODEL").unwrap_or_else(|_| "deepseek-v4-flash".to_string());
        let body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "say hi"}],
            "stream": false
        });
        let cancel = Notify::new();
        let resp = post_with_retry(
            &client,
            &url,
            &key,
            &body,
            &cancel,
            None,
            Some("agentrouter"),
        )
        .await
        .expect("chat request");
        let value: serde_json::Value = resp.json().await.expect("chat json");
        let content = value["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("");
        eprintln!("LIVE CHAT = {content:?}");
        assert!(!content.trim().is_empty());
    }
}
