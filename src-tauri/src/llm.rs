use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::error::{AppError, AppResult};
use crate::state::StreamState;
use crate::vault;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta { text: String },
    Done,
    Error { message: String },
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

fn endpoint(base_url: &str, path: &str) -> String {
    format!("{}/{}", base_url.trim_end_matches('/'), path.trim_start_matches('/'))
}

#[tauri::command]
pub async fn list_models(base_url: String, connection_id: String) -> AppResult<Vec<String>> {
    let key = vault::get_api_key(&connection_id)?;
    let resp = reqwest::Client::new()
        .get(endpoint(&base_url, "models"))
        .bearer_auth(key)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Upstream(format!("{status}: {body}")));
    }

    let value: serde_json::Value = resp.json().await?;
    let mut models = Vec::new();
    if let Some(data) = value.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                models.push(id.to_string());
            }
        }
    }
    models.sort();
    Ok(models)
}

#[tauri::command]
pub fn cancel_stream(request_id: String, state: tauri::State<'_, StreamState>) -> AppResult<()> {
    state.cancel(&request_id)
}

#[tauri::command]
pub async fn chat_stream(
    req: ChatRequest,
    on_event: Channel<StreamEvent>,
    state: tauri::State<'_, StreamState>,
) -> AppResult<()> {
    let key = vault::get_api_key(&req.connection_id)?;

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

    let resp = reqwest::Client::new()
        .post(endpoint(&req.base_url, "chat/completions"))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let message = format!("{status}: {text}");
        let _ = on_event.send(StreamEvent::Error {
            message: message.clone(),
        });
        return Err(AppError::Upstream(message));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        if state.take_cancelled(&req.request_id) {
            return Ok(());
        }
        let chunk = chunk?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
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
                if let Some(err) = value.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
                    let _ = on_event.send(StreamEvent::Error {
                        message: err.to_string(),
                    });
                    return Err(AppError::Upstream(err.to_string()));
                }
            }
        }
    }

    let _ = on_event.send(StreamEvent::Done);
    Ok(())
}
