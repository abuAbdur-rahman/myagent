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
}

fn u64_of(value: &Value, keys: &[&str]) -> u64 {
    keys.iter()
        .filter_map(|k| value.get(k))
        .find_map(|v| v.as_u64())
        .unwrap_or(0)
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
    }
    if let Some(reason) = choice.get("finish_reason").and_then(|v| v.as_str()) {
        chunk.finish_reason = Some(reason.to_string());
    }
    if let Some(usage) = value.get("usage") {
        chunk.usage = Some(Usage {
            prompt: u64_of(usage, &["prompt_tokens", "input_tokens"]),
            completion: u64_of(usage, &["completion_tokens", "output_tokens"]),
            total: u64_of(usage, &["total_tokens"]),
        });
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
        let raw = "data: {\"a\":1}\r\n\r\ndata: {\"b\":2}\n\n";
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 7);
        assert_eq!(payloads(items), vec!["{\"a\":1}", "{\"b\":2}"]);
    }

    #[test]
    fn keeps_multibyte_chars_split_across_chunks() {
        let raw = "data: {\"text\":\"hi 👍\"}\n\n";
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 1);
        assert_eq!(payloads(items), vec!["{\"text\":\"hi 👍\"}"]);
    }

    #[test]
    fn ignores_comments_and_blank_keepalives() {
        let raw = ": ping\n\ndata: {\"a\":1}\n\n\n";
        let mut parser = SseParser::new();
        let items = feed_all(&mut parser, raw, 5);
        assert_eq!(payloads(items), vec!["{\"a\":1}"]);
    }

    #[test]
    fn joins_multiline_data_and_detects_done() {
        let raw = "data: line1\ndata: line2\n\n";
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
}
