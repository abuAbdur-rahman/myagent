use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::sync::Notify;

use crate::error::{AppError, AppResult};
use crate::state::StreamState;
use crate::tools;
use crate::vault;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta {
        text: String,
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

async fn error_body(resp: reqwest::Response) -> String {
    let status = resp.status();
    match resp.text().await {
        Ok(body) if !body.is_empty() => format!("{status}: {body}"),
        Ok(_) => status.to_string(),
        Err(e) => format!("{status} (unreadable body: {e})"),
    }
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

#[tauri::command]
pub async fn list_models(
    base_url: String,
    connection_id: String,
    client: State<'_, reqwest::Client>,
) -> AppResult<Vec<String>> {
    let key = vault::get_api_key(&connection_id)?;
    let resp = client
        .get(endpoint(&base_url, "models"))
        .bearer_auth(key)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AppError::Upstream(error_body(resp).await));
    }

    let value: serde_json::Value = resp.json().await?;
    let mut models: Vec<String> = value
        .get("data")
        .and_then(|data| data.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("id")
                        .and_then(|id| id.as_str())
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    Ok(models)
}

#[tauri::command]
pub fn cancel_stream(request_id: String, state: State<'_, StreamState>) -> AppResult<()> {
    state.cancel(&request_id)
}

#[tauri::command]
pub async fn suggest_title(
    req: TitleRequest,
    client: State<'_, reqwest::Client>,
) -> AppResult<String> {
    let key = vault::get_api_key(&req.connection_id)?;
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

    let resp = client
        .post(endpoint(&req.base_url, "chat/completions"))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await?;

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

async fn post_completion(
    client: &reqwest::Client,
    url: &str,
    key: &str,
    body: &serde_json::Value,
) -> AppResult<serde_json::Value> {
    let resp = client.post(url).bearer_auth(key).json(body).send().await?;

    if !resp.status().is_success() {
        return Err(AppError::Upstream(error_body(resp).await));
    }
    resp.json().await.map_err(AppError::from)
}

fn tool_calls_of(message: &serde_json::Value) -> Vec<serde_json::Value> {
    message
        .get("tool_calls")
        .and_then(|calls| calls.as_array())
        .cloned()
        .unwrap_or_default()
}

fn message_text(message: &serde_json::Value) -> Option<String> {
    message
        .get("content")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
}

fn empty_response_error(value: &serde_json::Value) -> AppError {
    let reason = value["choices"][0]
        .get("finish_reason")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let excerpt = truncate_chars(&serde_json::to_string(value).unwrap_or_default(), 500);
    AppError::Upstream(format!(
        "empty response from provider (finish: {reason}): {excerpt}"
    ))
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
    let max = req.max_iterations.unwrap_or(8).clamp(1, 16);

    for _ in 0..max {
        if state.take_cancelled(&req.request_id) {
            return Ok(());
        }
        let mut body = serde_json::json!({
            "model": req.model,
            "messages": history,
            "tools": tools,
            "stream": false,
        });
        apply_optional_params(&mut body, req);

        let value = match post_completion(client, &url, &key, &body).await {
            Ok(value) => value,
            Err(error) if is_retryable_tools_error(&error) => {
                return stream_completion(client, req, key, history, on_event, cancel).await;
            }
            Err(error) => return Err(error),
        };

        let message = value["choices"][0]["message"].clone();
        let calls = tool_calls_of(&message);
        if calls.is_empty() && message_text(&message).is_none() {
            return Err(empty_response_error(&value));
        }
        if calls.is_empty() {
            break;
        }

        history.push(serde_json::json!({
            "role": "assistant",
            "content": message.get("content"),
            "tool_calls": calls,
        }));

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

            match tools::execute(app, &name, args, req.project_id.as_deref()).await {
                Ok(done) => {
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

    let resp = client
        .post(endpoint(&req.base_url, "chat/completions"))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AppError::Upstream(error_body(resp).await));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut received: u32 = 0;
    let notified = cancel.notified();
    tokio::pin!(notified);

    loop {
        let next = tokio::select! {
            _ = &mut notified => return Ok(()),
            next = stream.next() => next,
        };

        let Some(chunk) = next else { break };
        buffer.extend_from_slice(&chunk?);

        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
            let line = String::from_utf8_lossy(&buffer[..pos]).trim().to_string();
            buffer.drain(..=pos);

            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                let _ = on_event.send(StreamEvent::Done);
                return if received == 0 {
                    Err(AppError::Upstream(
                        "empty response from provider".to_string(),
                    ))
                } else {
                    Ok(())
                };
            }

            if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(text) = value["choices"][0]["delta"]["content"].as_str() {
                    if !text.is_empty() {
                        received += 1;
                    }
                    let _ = on_event.send(StreamEvent::Delta {
                        text: text.to_string(),
                    });
                }
                if let Some(err) = value
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                {
                    return Err(AppError::Upstream(err.to_string()));
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
