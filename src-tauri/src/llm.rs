use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::Notify;

use crate::error::{AppError, AppResult};
use crate::state::StreamState;
use crate::vault;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta { text: String },
    Done,
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
}

#[derive(Deserialize)]
pub struct TitleRequest {
    pub base_url: String,
    pub connection_id: String,
    pub model: String,
    pub user_text: String,
    pub assistant_text: String,
}

fn truncate_chars(text: &str, max: usize) -> String {
    let truncated: String = text.chars().take(max).collect();
    if text.chars().count() > max {
        format!("{truncated}…")
    } else {
        truncated
    }
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
) -> AppResult<()> {
    let key = vault::get_api_key(&req.connection_id)?;
    let cancel = state.register(&req.request_id)?;

    let result = stream_completion(&client, &req, key, &on_event, &cancel).await;
    state.finish(&req.request_id);
    result
}

async fn stream_completion(
    client: &reqwest::Client,
    req: &ChatRequest,
    key: String,
    on_event: &Channel<StreamEvent>,
    cancel: &Notify,
) -> AppResult<()> {
    let messages: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    let mut body = serde_json::json!({
        "model": req.model,
        "messages": messages,
        "stream": true,
    });
    if let Some(temperature) = req.temperature {
        body["temperature"] = serde_json::json!(temperature);
    }

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
                return Ok(());
            }

            if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(text) = value["choices"][0]["delta"]["content"].as_str() {
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
    Ok(())
}
