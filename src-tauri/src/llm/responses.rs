use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use futures_util::StreamExt;
use serde_json::{Value, json};
use tokio::sync::Notify;

use super::{
    EventSink, Iteration, StreamEvent, finish_iteration_parts, is_cancel_shutdown, message_text,
    post_with_retry,
};
use crate::error::{AppError, AppResult};
use crate::sse::{self, SseItem};

const MAX_CALLS: usize = 64;
const MAX_ARGUMENT_BYTES: usize = 256 * 1024;
const MAX_OUTPUT_ITEMS: usize = 256;
const MAX_SSE_EVENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_ITEM_TEXT_BYTES: usize = 1024 * 1024;
const MAX_STREAM_TEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_STREAM_REASONING_BYTES: usize = 4 * 1024 * 1024;

fn cache() -> &'static Mutex<HashSet<String>> {
    static CACHE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn key(base_url: &str, model: &str) -> String {
    format!("{}|{}", base_url.trim_end_matches('/'), model)
}

pub(super) fn only(base_url: &str, model: &str) -> bool {
    cache()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .contains(&key(base_url, model))
}

pub(super) fn mark(base_url: &str, model: &str) {
    cache()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(key(base_url, model));
}

pub(super) fn requires_responses(error: &AppError) -> bool {
    let AppError::Upstream(message) = error else {
        return false;
    };
    if !message.trim_start().starts_with("400") {
        return false;
    }
    let lower = message.to_ascii_lowercase();
    let names_both = lower.contains("chat/completions") && lower.contains("responses");
    let explicit = lower.contains("does not support")
        || lower.contains("not supported")
        || lower.contains("use /v1/responses");
    names_both && explicit
}

pub(super) fn body(
    model: &str,
    history: &[Value],
    tools: Option<&Value>,
    effort: Option<&str>,
    stream: bool,
) -> Value {
    let mut body = json!({
        "model": model,
        "input": input(history),
        "stream": stream,
        "store": false,
    });
    if let Some(specs) = tools {
        let defs = tool_defs(specs);
        if defs.as_array().is_some_and(|list| !list.is_empty()) {
            body["tools"] = defs;
        }
    }
    if let Some(effort) = effort.filter(|value| !value.is_empty() && *value != "none") {
        body["reasoning"] = json!({ "effort": effort });
        body["include"] = json!(["reasoning.encrypted_content"]);
    }
    body
}

fn input(history: &[Value]) -> Vec<Value> {
    let mut out = Vec::new();
    for (index, message) in history.iter().enumerate() {
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        match role {
            "tool" => {
                let fallback = format!("call-unknown-{index}");
                let call_id = message
                    .get("tool_call_id")
                    .and_then(Value::as_str)
                    .unwrap_or(&fallback);
                let output = message.get("content").map(message_text).unwrap_or_default();
                out.push(json!({
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": output,
                }));
            }
            "assistant" => {
                let start = out.len();
                let mut saw_message = false;
                let mut replayed_calls = HashSet::new();
                if let Some(items) = message.get("responses_items").and_then(Value::as_array) {
                    for item in items {
                        if let Some(item) = sanitize_item(item) {
                            match item.get("type").and_then(Value::as_str) {
                                Some("message") => saw_message = true,
                                Some("function_call") => {
                                    if let Some(call_id) =
                                        item.get("call_id").and_then(Value::as_str)
                                    {
                                        replayed_calls.insert(call_id.to_string());
                                    }
                                }
                                _ => {}
                            }
                            out.push(item);
                        }
                    }
                }
                let content = message.get("content").unwrap_or(&Value::Null);
                let text = message_text(content);
                if !text.is_empty() && !saw_message {
                    let at = out[start..]
                        .iter()
                        .position(|item| {
                            item.get("type").and_then(Value::as_str) == Some("function_call")
                        })
                        .map(|offset| start + offset)
                        .unwrap_or(out.len());
                    out.insert(at, json!({ "role": "assistant", "content": text }));
                }
                if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
                    for (index, call) in calls.iter().enumerate() {
                        let call_id = call
                            .get("id")
                            .and_then(Value::as_str)
                            .or_else(|| call.get("call_id").and_then(Value::as_str))
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("call-{index}"));
                        if replayed_calls.contains(&call_id) {
                            continue;
                        }
                        let name = call
                            .get("function")
                            .and_then(|function| function.get("name"))
                            .and_then(Value::as_str)
                            .or_else(|| call.get("name").and_then(Value::as_str))
                            .unwrap_or("");
                        if name.is_empty() {
                            continue;
                        }
                        let arguments = call
                            .get("function")
                            .and_then(|function| function.get("arguments"))
                            .and_then(Value::as_str)
                            .or_else(|| call.get("arguments").and_then(Value::as_str))
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or("{}");
                        out.push(json!({
                            "type": "function_call",
                            "call_id": call_id,
                            "name": name,
                            "arguments": arguments,
                        }));
                    }
                }
            }
            "system" | "user" | "developer" => {
                let content = message.get("content").unwrap_or(&Value::Null);
                if let Some(content) = input_content(content) {
                    out.push(json!({ "role": role, "content": content }));
                }
            }
            _ => {}
        }
    }
    out
}

fn input_content(content: &Value) -> Option<Value> {
    if let Some(text) = content.as_str() {
        return Some(json!(text));
    }
    let parts = content.as_array()?;
    let mut out = Vec::new();
    for part in parts {
        match part.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    out.push(json!({ "type": "input_text", "text": text }));
                }
            }
            Some("image_url") => {
                let image = part.get("image_url").unwrap_or(&Value::Null);
                let url = image
                    .get("url")
                    .and_then(Value::as_str)
                    .or_else(|| image.as_str())
                    .unwrap_or("");
                if url.is_empty() {
                    continue;
                }
                let mut item = json!({ "type": "input_image", "image_url": url });
                if let Some(detail) = image.get("detail").and_then(Value::as_str) {
                    item["detail"] = json!(detail);
                }
                out.push(item);
            }
            _ => {}
        }
    }
    if out.is_empty() {
        out.push(json!({ "type": "input_text", "text": "[unsupported content]" }));
    }
    Some(Value::Array(out))
}

fn tool_defs(specs: &Value) -> Value {
    let Some(list) = specs.as_array() else {
        return json!([]);
    };
    let out: Vec<Value> = list
        .iter()
        .filter_map(|spec| {
            let function = spec.get("function");
            let name = function
                .and_then(|value| value.get("name"))
                .and_then(Value::as_str)
                .or_else(|| spec.get("name").and_then(Value::as_str))?;
            let mut def = json!({ "type": "function", "name": name });
            let description = function
                .and_then(|value| value.get("description"))
                .and_then(Value::as_str)
                .or_else(|| spec.get("description").and_then(Value::as_str));
            if let Some(description) = description {
                def["description"] = json!(description);
            }
            let parameters = function
                .and_then(|value| value.get("parameters"))
                .or_else(|| spec.get("parameters"));
            def["parameters"] = parameters
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
            Some(def)
        })
        .collect();
    Value::Array(out)
}

fn sanitize_item(item: &Value) -> Option<Value> {
    match item.get("type").and_then(Value::as_str)? {
        "reasoning" => {
            let encrypted = item.get("encrypted_content").and_then(Value::as_str)?;
            if encrypted.len() > MAX_ITEM_TEXT_BYTES {
                return None;
            }
            let mut out = json!({ "type": "reasoning", "encrypted_content": encrypted });
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                out["id"] = json!(id);
            }
            if let Some(summary) = item.get("summary").filter(|value| value.is_array()) {
                out["summary"] = summary.clone();
            }
            Some(out)
        }
        "message" => {
            let mut content = Vec::new();
            for part in item
                .get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                match part.get("type").and_then(Value::as_str) {
                    Some("output_text") => {
                        if let Some(text) = part.get("text").and_then(Value::as_str)
                            && text.len() <= MAX_ITEM_TEXT_BYTES
                        {
                            content.push(json!({ "type": "output_text", "text": text }));
                        }
                    }
                    Some("refusal") => {
                        if let Some(text) = part.get("refusal").and_then(Value::as_str)
                            && text.len() <= MAX_ITEM_TEXT_BYTES
                        {
                            content.push(json!({ "type": "refusal", "refusal": text }));
                        }
                    }
                    _ => {}
                }
            }
            if content.is_empty() {
                None
            } else {
                let mut out = json!({
                    "type": "message",
                    "role": "assistant",
                    "content": content,
                });
                if let Some(id) = item.get("id").and_then(Value::as_str) {
                    out["id"] = json!(id);
                }
                if let Some(phase) = item.get("phase").and_then(Value::as_str) {
                    out["phase"] = json!(phase);
                }
                Some(out)
            }
        }
        "function_call" => {
            let call_id = item
                .get("call_id")
                .and_then(Value::as_str)
                .or_else(|| item.get("id").and_then(Value::as_str))
                .unwrap_or("");
            let name = item.get("name").and_then(Value::as_str).unwrap_or("");
            if call_id.is_empty() || name.is_empty() {
                return None;
            }
            let arguments = item
                .get("arguments")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("{}");
            if arguments.len() > MAX_ARGUMENT_BYTES {
                return None;
            }
            let mut out = json!({
                "type": "function_call",
                "call_id": call_id,
                "name": name,
                "arguments": arguments,
            });
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                out["id"] = json!(id);
            }
            Some(out)
        }
        _ => None,
    }
}

pub(super) fn text(value: &Value) -> String {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return text.to_string();
    }
    value
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(output_item_text)
        .collect()
}

fn output_item_text(item: &Value) -> Option<String> {
    if item.get("type").and_then(Value::as_str) != Some("message") {
        return None;
    }
    let mut out = String::new();
    for part in item
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        match part.get("type").and_then(Value::as_str) {
            Some("output_text") => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    out.push_str(text);
                }
            }
            Some("refusal") => {
                if let Some(text) = part.get("refusal").and_then(Value::as_str) {
                    out.push_str(text);
                }
            }
            _ => {}
        }
    }
    if out.is_empty() { None } else { Some(out) }
}

#[derive(Default, Clone)]
struct CallSlot {
    item_id: String,
    call_id: String,
    name: String,
    arguments: String,
    overflowed: bool,
}

#[derive(Default)]
struct Update {
    text: String,
    reasoning: String,
    usage: Option<sse::Usage>,
    finish: Option<String>,
    done: bool,
}

#[derive(Default)]
pub(super) struct StreamState {
    text: String,
    reasoning: String,
    calls: Vec<CallSlot>,
    by_item: HashMap<String, usize>,
    output_items: Vec<Value>,
}

impl StreamState {
    fn apply(&mut self, event: &Value) -> Result<Update, String> {
        let mut update = Update::default();
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "response.output_text.delta" | "response.refusal.delta" => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                    if self.text.len().saturating_add(delta.len()) > MAX_STREAM_TEXT_BYTES {
                        return Err("response text too large".to_string());
                    }
                    self.text.push_str(delta);
                    update.text = delta.to_string();
                }
            }
            "response.output_text.done" => {
                if self.text.is_empty()
                    && let Some(text) = event.get("text").and_then(Value::as_str)
                {
                    if text.len() > MAX_STREAM_TEXT_BYTES {
                        return Err("response text too large".to_string());
                    }
                    self.text = text.to_string();
                    update.text = text.to_string();
                }
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                    if self.reasoning.len().saturating_add(delta.len()) > MAX_STREAM_REASONING_BYTES
                    {
                        return Err("response reasoning too large".to_string());
                    }
                    self.reasoning.push_str(delta);
                    update.reasoning = delta.to_string();
                }
            }
            "response.reasoning_summary_text.done" => {
                if self.reasoning.is_empty()
                    && let Some(text) = event.get("text").and_then(Value::as_str)
                {
                    if text.len() > MAX_STREAM_REASONING_BYTES {
                        return Err("response reasoning too large".to_string());
                    }
                    self.reasoning = text.to_string();
                    update.reasoning = text.to_string();
                }
            }
            "response.output_item.added" => {
                if let Some(item) = event.get("item")
                    && item.get("type").and_then(Value::as_str) == Some("function_call")
                {
                    self.add_call(item);
                }
            }
            "response.function_call_arguments.delta" => {
                let id = event
                    .get("item_id")
                    .and_then(Value::as_str)
                    .or_else(|| event.get("call_id").and_then(Value::as_str))
                    .unwrap_or("");
                let delta = event.get("delta").and_then(Value::as_str).unwrap_or("");
                if let Some(index) = self.argument_index(id) {
                    let slot = &mut self.calls[index];
                    if slot.arguments.len().saturating_add(delta.len()) > MAX_ARGUMENT_BYTES {
                        slot.overflowed = true;
                        slot.arguments.clear();
                    } else {
                        slot.arguments.push_str(delta);
                    }
                }
            }
            "response.function_call_arguments.done" => {
                let id = event
                    .get("item_id")
                    .and_then(Value::as_str)
                    .or_else(|| event.get("call_id").and_then(Value::as_str))
                    .unwrap_or("");
                if let Some(arguments) = event.get("arguments").and_then(Value::as_str)
                    && let Some(index) = self.argument_index(id)
                {
                    if arguments.len() > MAX_ARGUMENT_BYTES {
                        self.calls[index].overflowed = true;
                        self.calls[index].arguments.clear();
                    } else {
                        self.calls[index].arguments = arguments.to_string();
                    }
                }
            }
            "response.output_item.done" => {
                if let Some(item) = event.get("item") {
                    match item.get("type").and_then(Value::as_str) {
                        Some("function_call") => self.upsert_call(item),
                        Some("message") if self.text.is_empty() => {
                            if let Some(text) = output_item_text(item) {
                                if text.len() > MAX_STREAM_TEXT_BYTES {
                                    return Err("response text too large".to_string());
                                }
                                self.text = text.clone();
                                update.text = text;
                            }
                        }
                        _ => {}
                    }
                }
            }
            "response.completed" | "response.incomplete" => {
                let response = event.get("response").unwrap_or(&Value::Null);
                if matches!(
                    response.get("status").and_then(Value::as_str),
                    Some("failed" | "cancelled")
                ) {
                    return Err(response_error(event));
                }
                if let Some(items) = response.get("output").and_then(Value::as_array) {
                    self.output_items = items.iter().take(MAX_OUTPUT_ITEMS).cloned().collect();
                    self.rebuild_calls(items);
                    if self.text.is_empty() {
                        let text = items
                            .iter()
                            .filter_map(output_item_text)
                            .collect::<String>();
                        if text.len() > MAX_STREAM_TEXT_BYTES {
                            return Err("response text too large".to_string());
                        }
                        if !text.is_empty() {
                            self.text = text.clone();
                            update.text = text;
                        }
                    }
                }
                let usage = response
                    .get("usage")
                    .filter(|value| value.is_object())
                    .map(sse::normalize_usage);
                update.usage = usage;
                update.finish = finish_reason(response);
                update.done = true;
            }
            "response.failed" => return Err(response_error(event)),
            "error" => return Err(event_error(event)),
            _ => {}
        }
        Ok(update)
    }

    fn index_for(&self, id: &str) -> Option<usize> {
        if id.is_empty() {
            return None;
        }
        self.by_item.get(id).copied().or_else(|| {
            self.calls
                .iter()
                .position(|slot| slot.item_id == id || slot.call_id == id)
        })
    }

    fn call_index(&self, item_id: &str, call_id: &str) -> Option<usize> {
        self.index_for(item_id).or_else(|| self.index_for(call_id))
    }

    fn argument_index(&self, id: &str) -> Option<usize> {
        if id.is_empty() {
            return (self.calls.len() == 1).then_some(0);
        }
        self.index_for(id)
    }

    fn add_call(&mut self, item: &Value) {
        if self.calls.len() >= MAX_CALLS {
            return;
        }
        let item_id = item
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let call_id = item
            .get("call_id")
            .and_then(Value::as_str)
            .or_else(|| item.get("id").and_then(Value::as_str))
            .unwrap_or("")
            .to_string();
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            return;
        }
        if let Some(index) = self.call_index(&item_id, &call_id) {
            self.calls[index].call_id = call_id;
            self.calls[index].name = name;
            return;
        }
        let index = self.calls.len();
        if !item_id.is_empty() {
            self.by_item.insert(item_id.clone(), index);
        }
        if !call_id.is_empty() {
            self.by_item.entry(call_id.clone()).or_insert(index);
        }
        self.calls.push(CallSlot {
            item_id,
            call_id,
            name,
            arguments: item
                .get("arguments")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            overflowed: false,
        });
    }

    fn upsert_call(&mut self, item: &Value) {
        let item_id = item
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let call_id = item
            .get("call_id")
            .and_then(Value::as_str)
            .or_else(|| item.get("id").and_then(Value::as_str))
            .unwrap_or("")
            .to_string();
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let arguments = item
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let overflowed = arguments.len() > MAX_ARGUMENT_BYTES;
        if let Some(index) = self.call_index(&item_id, &call_id) {
            if !call_id.is_empty() {
                self.calls[index].call_id = call_id;
            }
            if !name.is_empty() {
                self.calls[index].name = name;
            }
            if overflowed {
                self.calls[index].overflowed = true;
            } else if !arguments.is_empty() {
                self.calls[index].arguments = arguments;
            }
            return;
        }
        if name.is_empty() || overflowed {
            return;
        }
        if self.calls.len() >= MAX_CALLS {
            return;
        }
        let index = self.calls.len();
        if !item_id.is_empty() {
            self.by_item.insert(item_id.clone(), index);
        }
        if !call_id.is_empty() {
            self.by_item.entry(call_id.clone()).or_insert(index);
        }
        self.calls.push(CallSlot {
            item_id,
            call_id,
            name,
            arguments,
            overflowed: false,
        });
    }

    fn rebuild_calls(&mut self, items: &[Value]) {
        let mut calls = Vec::new();
        for item in items {
            if item.get("type").and_then(Value::as_str) != Some("function_call") {
                continue;
            }
            if calls.len() >= MAX_CALLS {
                break;
            }
            let item_id = item
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let call_id = item
                .get("call_id")
                .and_then(Value::as_str)
                .or_else(|| item.get("id").and_then(Value::as_str))
                .unwrap_or("")
                .to_string();
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                continue;
            }
            let arguments = item
                .get("arguments")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            calls.push(CallSlot {
                item_id,
                call_id,
                name,
                arguments,
                overflowed: false,
            });
        }
        if calls.is_empty() {
            return;
        }
        let mut known = HashSet::new();
        for slot in &calls {
            if !slot.call_id.is_empty() {
                known.insert(slot.call_id.clone());
            }
            if !slot.item_id.is_empty() {
                known.insert(slot.item_id.clone());
            }
        }
        for slot in &self.calls {
            if calls.len() >= MAX_CALLS {
                break;
            }
            if slot.overflowed || slot.name.is_empty() {
                continue;
            }
            let id = if !slot.call_id.is_empty() {
                slot.call_id.as_str()
            } else {
                slot.item_id.as_str()
            };
            if !id.is_empty() && known.contains(id) {
                continue;
            }
            calls.push(slot.clone());
        }
        self.calls = calls;
        self.by_item.clear();
        for (index, slot) in self.calls.iter().enumerate() {
            if !slot.item_id.is_empty() {
                self.by_item.insert(slot.item_id.clone(), index);
            }
            if !slot.call_id.is_empty() {
                self.by_item.entry(slot.call_id.clone()).or_insert(index);
            }
        }
    }

    fn calls(&self) -> Vec<Value> {
        self.calls
            .iter()
            .enumerate()
            .filter(|(_, slot)| !slot.name.is_empty() && !slot.overflowed)
            .map(|(index, slot)| {
                let id = if !slot.call_id.is_empty() {
                    slot.call_id.clone()
                } else if !slot.item_id.is_empty() {
                    slot.item_id.clone()
                } else {
                    format!("call-{index}")
                };
                let arguments = if slot.arguments.trim().is_empty() {
                    "{}".to_string()
                } else {
                    slot.arguments.clone()
                };
                json!({
                    "id": id,
                    "type": "function",
                    "function": {
                        "name": slot.name,
                        "arguments": arguments,
                    },
                })
            })
            .collect()
    }

    fn responses_items(&self) -> Vec<Value> {
        let mut items: Vec<Value> = self
            .output_items
            .iter()
            .take(MAX_OUTPUT_ITEMS)
            .filter_map(sanitize_item)
            .collect();
        let present: HashSet<String> = items
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
            .filter_map(|item| item.get("call_id").and_then(Value::as_str))
            .map(str::to_string)
            .collect();
        for (index, call) in self.calls.iter().enumerate() {
            if call.name.is_empty() || call.overflowed {
                continue;
            }
            let call_id = if !call.call_id.is_empty() {
                call.call_id.clone()
            } else if !call.item_id.is_empty() {
                call.item_id.clone()
            } else {
                format!("call-{index}")
            };
            if present.contains(&call_id) {
                continue;
            }
            items.push(json!({
                "type": "function_call",
                "call_id": call_id,
                "name": call.name,
                "arguments": if call.arguments.trim().is_empty() {
                    "{}".to_string()
                } else {
                    call.arguments.clone()
                },
            }));
        }
        items
    }
}

fn finish_reason(response: &Value) -> Option<String> {
    let status = response.get("status").and_then(Value::as_str);
    match status {
        Some("incomplete") => {
            let reason = response
                .get("incomplete_details")
                .and_then(|details| details.get("reason"))
                .and_then(Value::as_str)
                .unwrap_or("length");
            Some(if reason == "max_output_tokens" {
                "length".to_string()
            } else {
                reason.to_string()
            })
        }
        Some("completed") => Some("stop".to_string()),
        _ => None,
    }
}

fn response_error(event: &Value) -> String {
    event
        .get("response")
        .and_then(|response| response.get("error"))
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| {
            event
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
        })
        .or_else(|| event.get("message").and_then(Value::as_str))
        .unwrap_or("response failed")
        .to_string()
}

fn event_error(event: &Value) -> String {
    event
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| {
            event
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
        })
        .unwrap_or("responses stream error")
        .to_string()
}

pub(super) async fn stream_iteration(
    client: &reqwest::Client,
    url: &str,
    key: &str,
    body: &Value,
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
    let mut state = StreamState::default();
    let notified = cancel.notified();
    tokio::pin!(notified);

    loop {
        let next = tokio::select! {
            _ = &mut notified => return Ok(None),
            next = stream.next() => next,
        };
        let Some(chunk) = next else {
            break;
        };
        let chunk = chunk?;
        if chunk.len() > MAX_SSE_EVENT_BYTES {
            return Err(AppError::Upstream("responses chunk too large".to_string()));
        }
        for item in parser.feed(&chunk) {
            match item {
                SseItem::Done => {
                    on_event.send(StreamEvent::Done);
                    return finish(&state, on_event);
                }
                SseItem::Payload(payload) => {
                    let Ok(value) = serde_json::from_str::<Value>(&payload) else {
                        continue;
                    };
                    let update = state.apply(&value).map_err(AppError::Upstream)?;
                    if !update.text.is_empty() {
                        on_event.send(StreamEvent::Delta { text: update.text });
                    }
                    if !update.reasoning.is_empty() {
                        on_event.send(StreamEvent::Reasoning {
                            text: update.reasoning,
                        });
                    }
                    if let Some(usage) = update.usage {
                        on_event.send(StreamEvent::Usage {
                            prompt_tokens: usage.prompt,
                            completion_tokens: usage.completion,
                            total_tokens: usage.total,
                        });
                    }
                    if update.finish.is_some() {
                        on_event.send(StreamEvent::Finish {
                            reason: update.finish,
                        });
                    }
                    if update.done {
                        on_event.send(StreamEvent::Done);
                        return finish(&state, on_event);
                    }
                }
            }
        }
        if parser.pending_len() > MAX_SSE_EVENT_BYTES {
            return Err(AppError::Upstream("responses event too large".to_string()));
        }
    }

    on_event.send(StreamEvent::Done);
    finish(&state, on_event)
}

fn finish(state: &StreamState, on_event: &dyn EventSink) -> AppResult<Option<Iteration>> {
    finish_iteration_parts(
        state.text.clone(),
        state.reasoning.clone(),
        state.calls(),
        state.responses_items(),
        on_event,
    )
    .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply_all(events: &[Value]) -> Result<StreamState, String> {
        let mut state = StreamState::default();
        for event in events {
            state.apply(event)?;
        }
        Ok(state)
    }

    #[test]
    fn detects_the_agentrouter_marker() {
        let error = AppError::Upstream(
            "400 Bad Request: {\"error\":\"this model does not support /v1/chat/completions, use /v1/responses\"}"
                .to_string(),
        );
        assert!(requires_responses(&error));
        assert!(!requires_responses(&AppError::Upstream(
            "401 Unauthorized".to_string()
        )));
        assert!(!requires_responses(&AppError::Network(
            "connection reset".to_string()
        )));
        assert!(!requires_responses(&AppError::Upstream(
            "401 Unauthorized: this key does not support /v1/chat/completions, use /v1/responses"
                .to_string()
        )));
    }

    #[test]
    fn marker_cache_is_per_base_and_model() {
        let base = "https://responses-test.example/v1";
        assert!(!only(base, "model-a"));
        mark(base, "model-a");
        assert!(only(base, "model-a"));
        assert!(!only(base, "model-b"));
        assert!(!only("https://other.example/v1", "model-a"));
    }

    #[test]
    fn input_converts_text_images_and_tool_round_trip() {
        let history = vec![
            json!({ "role": "system", "content": "be brief" }),
            json!({
                "role": "user",
                "content": [
                    { "type": "text", "text": "what is this" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA", "detail": "low" } }
                ]
            }),
            json!({
                "role": "assistant",
                "content": "checking",
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": { "name": "lookup", "arguments": "{\"q\":\"x\"}" }
                }]
            }),
            json!({ "role": "tool", "tool_call_id": "call_1", "content": "found" }),
        ];
        let converted = input(&history);
        assert_eq!(converted[0]["role"], "system");
        assert_eq!(converted[1]["content"][0]["type"], "input_text");
        assert_eq!(converted[1]["content"][1]["type"], "input_image");
        assert_eq!(
            converted[1]["content"][1]["image_url"],
            "data:image/png;base64,AA"
        );
        assert_eq!(converted[2]["role"], "assistant");
        assert_eq!(converted[3]["type"], "function_call");
        assert_eq!(converted[3]["call_id"], "call_1");
        assert_eq!(converted[4]["type"], "function_call_output");
        assert_eq!(converted[4]["call_id"], "call_1");
    }

    #[test]
    fn raw_response_items_replay_reasoning_and_calls() {
        let history = vec![json!({
            "role": "assistant",
            "content": "preamble",
            "tool_calls": [{ "id": "call_1", "type": "function", "function": { "name": "lookup", "arguments": "{}" } }],
            "responses_items": [
                { "type": "reasoning", "encrypted_content": "opaque", "summary": [] },
                { "type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": "{}" }
            ]
        })];
        let converted = input(&history);
        assert_eq!(converted.len(), 3);
        assert_eq!(converted[0]["type"], "reasoning");
        assert_eq!(converted[1]["role"], "assistant");
        assert_eq!(converted[1]["content"], "preamble");
        assert_eq!(converted[2]["type"], "function_call");
        assert_eq!(converted[2]["call_id"], "call_1");
    }

    #[test]
    fn replay_fills_missing_message_and_function_call() {
        let history = vec![json!({
            "role": "assistant",
            "content": "visible preamble",
            "tool_calls": [{ "id": "call_1", "type": "function", "function": { "name": "lookup", "arguments": "{}" } }],
            "responses_items": [
                { "type": "reasoning", "id": "rs_1", "encrypted_content": "opaque" }
            ]
        })];
        let converted = input(&history);
        assert_eq!(converted.len(), 3);
        assert_eq!(converted[0]["type"], "reasoning");
        assert_eq!(converted[1]["role"], "assistant");
        assert_eq!(converted[1]["content"], "visible preamble");
        assert_eq!(converted[2]["type"], "function_call");
        assert_eq!(converted[2]["call_id"], "call_1");
    }

    #[test]
    fn replay_keeps_function_call_when_completed_output_is_partial() {
        let events = vec![
            json!({ "type": "response.output_item.added", "item": {
                "type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": ""
            }}),
            json!({ "type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": "{\"q\":1}" }),
            json!({ "type": "response.completed", "response": {
                "status": "completed",
                "output": [
                    { "type": "function_call", "id": "fc_2", "call_id": "call_2", "name": "other", "arguments": "{}" }
                ]
            }}),
        ];
        let state = apply_all(&events).expect("stream");
        let calls = state.calls();
        assert_eq!(calls.len(), 2);
        assert!(calls.iter().any(|call| call["id"] == "call_1"));
        assert!(calls.iter().any(|call| call["id"] == "call_2"));
    }

    #[test]
    fn completed_message_keeps_function_calls_seen_only_as_deltas() {
        let events = vec![
            json!({ "type": "response.output_item.added", "item": {
                "type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": ""
            }}),
            json!({ "type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": "{}" }),
            json!({ "type": "response.completed", "response": {
                "status": "completed",
                "output": [{
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": "done" }]
                }]
            }}),
        ];
        let state = apply_all(&events).expect("stream");
        let items = state.responses_items();
        assert_eq!(items.len(), 2);
        assert!(items.iter().any(|item| item["type"] == "message"));
        assert!(
            items
                .iter()
                .any(|item| item["type"] == "function_call" && item["call_id"] == "call_1")
        );
    }

    #[test]
    fn unknown_status_does_not_claim_a_normal_stop() {
        assert_eq!(finish_reason(&json!({ "status": "in_progress" })), None);
        assert_eq!(
            finish_reason(&json!({ "status": "completed" })).as_deref(),
            Some("stop")
        );
    }

    #[test]
    fn sanitizer_drops_reasoning_without_encrypted_content() {
        assert!(sanitize_item(&json!({ "type": "reasoning", "summary": [] })).is_none());
        assert!(sanitize_item(&json!({ "type": "web_search_call" })).is_none());
        assert!(
            sanitize_item(&json!({ "type": "function_call", "call_id": "c", "name": "n" }))
                .is_some()
        );
    }

    #[test]
    fn tools_flatten_from_chat_shape() {
        let specs = json!([{
            "type": "function",
            "function": {
                "name": "lookup",
                "description": "find",
                "parameters": { "type": "object", "properties": {} }
            }
        }]);
        let defs = tool_defs(&specs);
        assert_eq!(defs[0]["type"], "function");
        assert_eq!(defs[0]["name"], "lookup");
        assert_eq!(defs[0]["description"], "find");
        assert!(defs[0].get("function").is_none());
    }

    #[test]
    fn text_reads_multiple_message_parts_and_refusals() {
        let value = json!({
            "output": [
                { "type": "message", "content": [
                    { "type": "output_text", "text": "hello " },
                    { "type": "output_text", "text": "world" }
                ]},
                { "type": "message", "content": [{ "type": "refusal", "refusal": " no" }] }
            ]
        });
        assert_eq!(text(&value), "hello world no");
    }

    #[test]
    fn stream_accumulates_split_arguments_and_completed_output_wins() {
        let events = vec![
            json!({ "type": "response.output_text.delta", "delta": "hi" }),
            json!({ "type": "response.output_item.added", "item": {
                "type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": ""
            }}),
            json!({ "type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": "{\"q\":" }),
            json!({ "type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": "\"x\"}" }),
            json!({ "type": "response.completed", "response": {
                "status": "completed",
                "usage": { "input_tokens": 3, "output_tokens": 4, "total_tokens": 7 },
                "output": [
                    { "type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": "{\"q\":\"x\"}" }
                ]
            }}),
        ];
        let state = apply_all(&events).expect("stream");
        let calls = state.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["id"], "call_1");
        assert_eq!(calls[0]["function"]["arguments"], "{\"q\":\"x\"}");
        assert_eq!(state.responses_items().len(), 1);
    }

    #[test]
    fn body_is_stateless_and_requests_encrypted_reasoning() {
        let body = body(
            "gpt-6-astra",
            &[json!({ "role": "user", "content": "hi" })],
            Some(&json!([{
                "type": "function",
                "function": { "name": "lookup", "parameters": { "type": "object" } }
            }])),
            Some("high"),
            true,
        );
        assert_eq!(body["store"], json!(false));
        assert_eq!(body["include"], json!(["reasoning.encrypted_content"]));
        assert_eq!(body["reasoning"]["effort"], "high");
        assert_eq!(body["tools"][0]["name"], "lookup");
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn body_omits_reasoning_when_effort_is_none() {
        let body = body("gpt-5.6-sol", &[], None, Some("none"), false);
        assert!(body.get("reasoning").is_none());
        assert!(body.get("include").is_none());
        assert!(body.get("tools").is_none());
    }

    #[test]
    fn completed_output_supplies_text_when_no_delta_arrived() {
        let event = json!({
            "type": "response.completed",
            "response": {
                "status": "completed",
                "output": [{
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": "from output" }]
                }]
            }
        });
        let mut state = StreamState::default();
        let update = state.apply(&event).expect("completed");
        assert_eq!(update.text, "from output");
        assert_eq!(state.text, "from output");
        assert_eq!(update.finish.as_deref(), Some("stop"));
    }

    #[test]
    fn completed_output_keeps_streamed_text_without_duplicating_it() {
        let events = vec![
            json!({ "type": "response.output_text.delta", "delta": "hel" }),
            json!({ "type": "response.output_text.delta", "delta": "lo" }),
            json!({
                "type": "response.completed",
                "response": {
                    "status": "completed",
                    "output": [{
                        "type": "message",
                        "role": "assistant",
                        "content": [{ "type": "output_text", "text": "hello" }]
                    }]
                }
            }),
        ];
        let state = apply_all(&events).expect("completed");
        assert_eq!(state.text, "hello");
    }

    #[test]
    fn stream_surfaces_failed_and_error_events() {
        let failed =
            json!({ "type": "response.failed", "response": { "error": { "message": "bad" } } });
        assert_eq!(apply_all(&[failed]).err().as_deref(), Some("bad"));
        let error = json!({ "type": "error", "message": "worse" });
        assert_eq!(apply_all(&[error]).err().as_deref(), Some("worse"));
    }

    #[test]
    fn finish_maps_completed_and_incomplete() {
        assert_eq!(
            finish_reason(&json!({ "status": "completed" })),
            Some("stop".to_string())
        );
        assert_eq!(
            finish_reason(&json!({
                "status": "incomplete",
                "incomplete_details": { "reason": "max_output_tokens" }
            })),
            Some("length".to_string())
        );
        assert_eq!(
            finish_reason(&json!({
                "status": "incomplete",
                "incomplete_details": { "reason": "content_filter" }
            })),
            Some("content_filter".to_string())
        );
    }
}
