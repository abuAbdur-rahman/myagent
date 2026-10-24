use serde_json::Value;

pub struct SseParser {
    buf: Vec<u8>,
    data: Vec<String>,
}

pub enum SseItem {
    Payload(String),
    Done,
}

impl SseParser {
    pub fn new() -> Self {
        SseParser {
            buf: Vec::new(),
            data: Vec::new(),
        }
    }

    pub fn pending_len(&self) -> usize {
        self.buf.len() + self.data.iter().map(String::len).sum::<usize>()
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<SseItem> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let raw: Vec<u8> = self.buf.drain(..=pos).collect();
            let mut line = String::from_utf8(raw)
                .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());
            line.pop();
            if line.ends_with('\r') {
                line.pop();
            }
            if line.is_empty() {
                if !self.data.is_empty() {
                    let payload = std::mem::take(&mut self.data).join("\n");
                    if payload.trim() == "[DONE]" {
                        out.push(SseItem::Done);
                    } else {
                        out.push(SseItem::Payload(payload));
                    }
                }
            } else if line.starts_with(':') {
                continue;
            } else if let Some(rest) = line.strip_prefix("data:") {
                let value = rest.strip_prefix(' ').unwrap_or(rest);
                self.data.push(value.to_string());
            }
        }
        out
    }
}

impl Default for SseParser {
    fn default() -> Self {
        SseParser::new()
    }
}

#[derive(Debug, Default, PartialEq)]
pub struct Usage {
    pub prompt: u64,
    pub completion: u64,
    pub total: u64,
}

#[derive(Debug, Default)]
pub struct ChatChunk {
    pub text: String,
    pub reasoning: String,
    pub usage: Option<Usage>,
    pub finish_reason: Option<String>,
    pub error: Option<String>,
    pub tool_deltas: Vec<ToolCallDelta>,
}

#[derive(Debug, Default, Clone)]
pub struct ToolCallDelta {
    pub index: usize,
    pub id: String,
    pub name: String,
    pub arguments: String,
}

const MAX_TOOL_CALL_INDEX: usize = 64;

fn str_of(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

pub struct ToolCallAccumulator {
    slots: Vec<AccumulatorSlot>,
}

struct AccumulatorSlot {
    id: String,
    name: String,
    arguments: String,
    announced: bool,
    announced_id: Option<String>,
}

impl ToolCallAccumulator {
    pub fn new() -> Self {
        Self { slots: Vec::new() }
    }

    fn effective_id(slot: &AccumulatorSlot, index: usize) -> String {
        if let Some(id) = slot.announced_id.clone() {
            return id;
        }
        if slot.id.is_empty() {
            format!("stream-{index}")
        } else {
            slot.id.clone()
        }
    }

    pub fn apply(&mut self, deltas: Vec<ToolCallDelta>) -> Vec<(usize, String, String)> {
        let mut newly_named = Vec::new();
        for delta in deltas {
            while self.slots.len() <= delta.index {
                self.slots.push(AccumulatorSlot {
                    id: String::new(),
                    name: String::new(),
                    arguments: String::new(),
                    announced: false,
                    announced_id: None,
                });
            }
            let slot = &mut self.slots[delta.index];
            if !delta.id.is_empty() {
                slot.id = delta.id;
            }
            if !delta.name.is_empty() {
                slot.name = delta.name;
            }
            slot.arguments.push_str(&delta.arguments);
            if !slot.name.is_empty() && !slot.id.is_empty() && !slot.announced {
                slot.announced = true;
                slot.announced_id = Some(slot.id.clone());
                newly_named.push((delta.index, slot.id.clone(), slot.name.clone()));
            }
        }
        newly_named
    }

    pub fn flush_unannounced(&mut self) -> Vec<(usize, String, String)> {
        let mut named = Vec::new();
        for (index, slot) in self.slots.iter_mut().enumerate() {
            if slot.name.is_empty() || slot.announced {
                continue;
            }
            slot.announced = true;
            let id = Self::effective_id(slot, index);
            slot.announced_id = Some(id.clone());
            named.push((index, id, slot.name.clone()));
        }
        named
    }

    pub fn calls(&self) -> Vec<Value> {
        self.slots
            .iter()
            .enumerate()
            .filter(|(_, slot)| !slot.name.is_empty())
            .map(|(index, slot)| {
                serde_json::json!({
                    "id": Self::effective_id(slot, index),
                    "type": "function",
                    "function": {
                        "name": slot.name,
                        "arguments": slot.arguments,
                    },
                })
            })
            .collect()
    }
}

impl Default for ToolCallAccumulator {
    fn default() -> Self {
        Self::new()
    }
}

fn u64_of(value: &Value, keys: &[&str]) -> u64 {
    keys.iter()
        .filter_map(|k| value.get(k))
        .find_map(|v| v.as_u64())
        .unwrap_or(0)
}

pub fn normalize_usage(usage: &Value) -> Usage {
    let prompt = u64_of(
        usage,
        &["prompt_tokens", "input_tokens", "prompt_eval_count"],
    );
    let completion = u64_of(usage, &["completion_tokens", "output_tokens", "eval_count"]);
    let total = usage
        .get("total_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(prompt + completion);
    Usage {
        prompt,
        completion,
        total,
    }
}

pub fn map_chunk(value: &Value) -> ChatChunk {
    let mut chunk = ChatChunk::default();
    if let Some(message) = value.get("error").and_then(|e| e.get("message")) {
        chunk.error = message.as_str().map(|s| s.to_string());
        return chunk;
    }
    let choice = &value["choices"][0];
    if let Some(delta) = choice.get("delta") {
        if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
            chunk.text = text.to_string();
        }
        for key in ["reasoning_content", "reasoning", "thinking"] {
            if let Some(text) = delta.get(key).and_then(|v| v.as_str()) {
                if !text.is_empty() {
                    chunk.reasoning = text.to_string();
                    break;
                }
            }
        }
        if let Some(calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
            for (position, call) in calls.iter().enumerate() {
                let index = call
                    .get("index")
                    .and_then(|v| v.as_u64())
                    .and_then(|i| usize::try_from(i).ok())
                    .filter(|i| *i <= MAX_TOOL_CALL_INDEX)
                    .unwrap_or(position);
                let function = call.get("function").unwrap_or(&Value::Null);
                chunk.tool_deltas.push(ToolCallDelta {
                    index,
                    id: str_of(call, "id"),
                    name: str_of(function, "name"),
                    arguments: str_of(function, "arguments"),
                });
            }
        }
    }
    if let Some(reason) = choice.get("finish_reason").and_then(|v| v.as_str()) {
        chunk.finish_reason = Some(reason.to_string());
    }
    if let Some(usage) = value.get("usage") {
        chunk.usage = Some(normalize_usage(usage));
    }
    chunk
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_all(parser: &mut SseParser, raw: &str, cut: usize) -> Vec<SseItem> {
        let bytes = raw.as_bytes();
        let mut out = Vec::new();
        for piece in bytes.chunks(cut) {
            out.extend(parser.feed(piece));
        }
        out
    }

    fn payloads(items: Vec<SseItem>) -> Vec<String> {
        items
            .into_iter()
            .filter_map(|item| match item {
                SseItem::Payload(payload) => Some(payload),
                SseItem::Done => None,
            })
            .collect()
    }

    #[test]
    fn coalesces_split_chunks_and_crlf() {
        let raw = include_str!("../tests/fixtures/coalesced.sse");
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 7);
        assert_eq!(payloads(items), vec!["{\"a\":1}", "{\"b\":2}"]);
    }

    #[test]
    fn keeps_multibyte_chars_split_across_chunks() {
        let raw = include_str!("../tests/fixtures/multibyte.sse");
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 1);
        assert_eq!(payloads(items), vec!["{\"text\":\"hi 👍\"}"]);
    }

    #[test]
    fn ignores_comments_and_blank_keepalives() {
        let raw = include_str!("../tests/fixtures/comments.sse");
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 5);
        assert_eq!(payloads(items), vec!["{\"a\":1}", "{\"b\":2}"]);
    }

    #[test]
    fn recorded_usage_chunk_fixture() {
        let raw = include_str!("../tests/fixtures/usage.sse");
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 9);
        let mut text = String::new();
        let mut finish = None;
        let mut usage = None;
        for item in items {
            match item {
                SseItem::Payload(payload) => {
                    let value: Value = serde_json::from_str(&payload).unwrap();
                    let chunk = map_chunk(&value);
                    text.push_str(&chunk.text);
                    finish = chunk.finish_reason.or(finish);
                    usage = chunk.usage.or(usage);
                }
                SseItem::Done => {}
            }
        }
        assert_eq!(text, "part");
        assert_eq!(finish.as_deref(), Some("stop"));
        assert_eq!(
            usage,
            Some(Usage {
                prompt: 44,
                completion: 6,
                total: 50,
            })
        );
    }

    #[test]
    fn joins_multiline_data_and_detects_done() {
        let raw = include_str!("../tests/fixtures/multiline.sse");
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 100);
        assert_eq!(payloads(items), vec!["line1\nline2"]);
        let mut parser = SseParser::new();
        let done = parser.feed(b"data: [DONE]\n\n");
        assert!(matches!(done.as_slice(), [SseItem::Done]));
    }

    #[test]
    fn recorded_plain_fixture() {
        let raw = include_str!("../tests/fixtures/plain.sse");
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 11);
        let mut text = String::new();
        let mut finish = None;
        let mut done = false;
        for item in items {
            match item {
                SseItem::Payload(payload) => {
                    let value: Value = serde_json::from_str(&payload).unwrap();
                    let chunk = map_chunk(&value);
                    text.push_str(&chunk.text);
                    finish = chunk.finish_reason.or(finish);
                }
                SseItem::Done => done = true,
            }
        }
        assert_eq!(text, "Hello world");
        assert_eq!(finish.as_deref(), Some("stop"));
        assert!(done);
    }

    #[test]
    fn recorded_reasoning_fixture() {
        let raw = include_str!("../tests/fixtures/reasoning.sse");
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 13);
        let mut reasoning = String::new();
        let mut text = String::new();
        for item in items {
            match item {
                SseItem::Payload(payload) => {
                    let value: Value = serde_json::from_str(&payload).unwrap();
                    let chunk = map_chunk(&value);
                    reasoning.push_str(&chunk.reasoning);
                    text.push_str(&chunk.text);
                }
                SseItem::Done => {}
            }
        }
        assert_eq!(reasoning, "Let me think. Yes.");
        assert_eq!(text, "42");
    }

    #[test]
    fn recorded_length_and_usage_fixture() {
        let raw = include_str!("../tests/fixtures/length.sse");
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 64);
        let mut finish = None;
        let mut usage = None;
        for item in items {
            match item {
                SseItem::Payload(payload) => {
                    let value: Value = serde_json::from_str(&payload).unwrap();
                    let chunk = map_chunk(&value);
                    finish = chunk.finish_reason.or(finish);
                    usage = chunk.usage.or(usage);
                }
                SseItem::Done => {}
            }
        }
        assert_eq!(finish.as_deref(), Some("length"));
        assert_eq!(
            usage,
            Some(Usage {
                prompt: 120,
                completion: 30,
                total: 150,
            })
        );
    }

    #[test]
    fn recorded_mid_stream_error_fixture() {
        let raw = include_str!("../tests/fixtures/mid_error.sse");
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 64);
        let mut error = None;
        for item in items {
            match item {
                SseItem::Payload(payload) => {
                    let value: Value = serde_json::from_str(&payload).unwrap();
                    error = map_chunk(&value).error.or(error);
                }
                SseItem::Done => {}
            }
        }
        assert_eq!(error.as_deref(), Some("upstream overloaded"));
    }

    #[test]
    fn usage_fallback_chain_and_total() {
        let openai = serde_json::json!({
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
        });
        assert_eq!(
            normalize_usage(&openai),
            Usage {
                prompt: 10,
                completion: 5,
                total: 15,
            }
        );
        let ollama_like = serde_json::json!({
            "prompt_eval_count": 40,
            "eval_count": 8,
        });
        assert_eq!(
            normalize_usage(&ollama_like),
            Usage {
                prompt: 40,
                completion: 8,
                total: 48,
            }
        );
        let anthropic_like = serde_json::json!({
            "input_tokens": 100,
            "output_tokens": 20,
            "total_tokens": 120,
        });
        assert_eq!(
            normalize_usage(&anthropic_like),
            Usage {
                prompt: 100,
                completion: 20,
                total: 120,
            }
        );
    }

    #[test]
    fn recorded_tool_calls_fixture_assembles_split_arguments() {
        let raw = include_str!("../tests/fixtures/tools.sse");
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 7);
        let mut accumulator = ToolCallAccumulator::new();
        let mut text = String::new();
        let mut finish = None;
        let mut announced = Vec::new();
        let mut done = false;
        for item in items {
            match item {
                SseItem::Payload(payload) => {
                    let value: Value = serde_json::from_str(&payload).unwrap();
                    let chunk = map_chunk(&value);
                    text.push_str(&chunk.text);
                    finish = chunk.finish_reason.or(finish);
                    announced.extend(accumulator.apply(chunk.tool_deltas));
                }
                SseItem::Done => done = true,
            }
        }
        assert_eq!(text, "I will check the time and list files.");
        assert_eq!(finish.as_deref(), Some("tool_calls"));
        assert!(done);
        assert_eq!(
            announced,
            vec![
                (0, "call_time_1".to_string(), "get_time".to_string()),
                (1, "call_run_2".to_string(), "run_powershell".to_string()),
            ]
        );
        let calls = accumulator.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["id"], serde_json::json!("call_time_1"));
        assert_eq!(calls[0]["function"]["name"], serde_json::json!("get_time"));
        assert_eq!(
            calls[1]["function"]["arguments"],
            serde_json::json!("{\"command\":\"Get-Date\"}")
        );
        let args: Value =
            serde_json::from_str(calls[1]["function"]["arguments"].as_str().unwrap()).unwrap();
        assert_eq!(args["command"], serde_json::json!("Get-Date"));
    }

    #[test]
    fn accumulator_announces_once_and_falls_back_without_id() {
        let mut accumulator = ToolCallAccumulator::new();
        let named = accumulator.apply(vec![ToolCallDelta {
            index: 0,
            id: String::new(),
            name: "get_time".to_string(),
            arguments: String::new(),
        }]);
        assert!(named.is_empty());
        let named = accumulator.apply(vec![ToolCallDelta {
            index: 0,
            id: String::new(),
            name: "get_time".to_string(),
            arguments: String::new(),
        }]);
        assert!(named.is_empty());
        let flushed = accumulator.flush_unannounced();
        assert_eq!(
            flushed,
            vec![(0, "stream-0".to_string(), "get_time".to_string())]
        );
        let calls = accumulator.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["id"], serde_json::json!("stream-0"));
    }
}
