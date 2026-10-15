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
}

#[derive(Deserialize)]
pub struct TitleRequest {
    pub base_url: String,
    pub connection_id: String,
    pub model: String,
    pub user_text: String,
    pub assistant_text: String,
}

fn apply_optional_params(body: &mut serde_json::Value, req: &ChatRequest) {
    if let Some(temperature) = req.temperature {
        body["temperature"] = serde_json::json!(temperature);
    }
    if let Some(effort) = req
        .reasoning_effort
        .as_deref()
        .filter(|e| !e.is_empty() && *e != "none")
    {
        body["reasoning"] = serde_json::json!({ "effort": effort });
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

fn agentrouter_headers(request: reqwest::RequestBuilder, url: &str) -> reqwest::RequestBuilder {
    if is_agentrouter_url(url) {
        request
            .header("User-Agent", "codex_cli_rs/0.114.0")
            .header("originator", "codex_cli_rs")
    } else {
        request
    }
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
                || lower.starts_with("400")
                || lower.starts_with("404")
                || lower.starts_with("422")
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
                        let openai = types.iter().any(|t| t.as_str() == Some("openai"));
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
    let request = agentrouter_headers(client.get(url.as_str()).bearer_auth(key), &url);
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
    client: State<'_, reqwest::Client>,
) -> AppResult<Vec<ModelCaps>> {
    let key = vault::get_api_key(&connection_id)?;
    fetch_model_caps(&client, &base_url, &key).await
}

#[tauri::command]
pub async fn list_models(
    base_url: String,
    connection_id: String,
    client: State<'_, reqwest::Client>,
) -> AppResult<Vec<String>> {
    let key = vault::get_api_key(&connection_id)?;
    Ok(fetch_model_caps(&client, &base_url, &key)
        .await?
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
    pub base_url: String,
    pub connection_id: String,
    pub model: String,
    pub text: String,
}

fn summary_body(model: &str, text: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "Summarize this chat excerpt for context compaction. Cover: the user's goal, key decisions, files touched, and open tasks. Under 300 words, plain text, no preamble.",
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
        "max_tokens": 24,
        "temperature": 0.3,
        "stream": false,
    });

    let request = agentrouter_headers(client.post(url.clone()).bearer_auth(key), &url);
    let resp = request.json(&body).send().await?;

    if !resp.status().is_success() {
        return Err(AppError::Upstream(error_body(resp).await));
    }

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
) -> AppResult<reqwest::Response> {
    let mut last_error: Option<AppError> = None;
    for attempt in 0..MAX_ATTEMPTS {
        let request = agentrouter_headers(client.post(url).bearer_auth(key), url);
        match request.json(body).send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return Ok(resp);
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
    for (_, id, name) in accumulator.flush_unannounced() {
        let _ = on_event.send(StreamEvent::ToolStart {
            id,
            name: name.clone(),
            summary: tools::summarize_call(&name, &serde_json::Value::Null),
        });
    }
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
) -> AppResult<Option<Iteration>> {
    let resp = match post_with_retry(client, url, key, body, cancel, Some(on_event)).await {
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
                    for (_, id, name) in accumulator.apply(mapped.tool_deltas) {
                        let _ = on_event.send(StreamEvent::ToolStart {
                            id,
                            name: name.clone(),
                            summary: tools::summarize_call(&name, &serde_json::Value::Null),
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
            "messages": history,
            "tools": tools,
            "stream": true,
        });
        apply_optional_params(&mut body, req);

        let iteration =
            match stream_agentic_iteration(client, &url, &key, &body, cancel, on_event).await {
                Ok(Some(iteration)) => iteration,
                Ok(None) => return Ok(()),
                Err(error) if is_retryable_tools_error(&error) => {
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
    let mut body = serde_json::json!({
        "model": req.model,
        "messages": history,
        "stream": true,
    });
    apply_optional_params(&mut body, req);

    let resp = match post_with_retry(
        client,
        &endpoint(&req.base_url, "chat/completions"),
        &key,
        &body,
        cancel,
        Some(on_event),
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
        let resp = post_with_retry(&test_client(), &url, "key", &body(), &cancel, None)
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
        let error = post_with_retry(&test_client(), &url, "key", &body(), &cancel, None)
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
}
