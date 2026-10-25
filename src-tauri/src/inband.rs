//! Recovery for DeepSeek's DSML tool-call envelope.
//!
//! Newer DeepSeek models, and gateways that do not translate them, ship tool
//! calls as markup inside `content` instead of structured `tool_calls`. The
//! model loses the call, and the markup becomes the answer. This module
//! scans the text stream and turns the envelope back into calls.
//!
//! The envelope is a `tool_calls` wrapper holding `invoke` blocks, each with
//! `parameter` children. The delimiter is not stable across hosts: the
//! canonical form uses U+FF5C FULLWIDTH VERTICAL LINE, an ASCII-pipe variant
//! uses `|DSML|`, and some hosts double the bar. All spellings normalize to
//! the same tag key, so the scanner never has to know which one arrived.
//!
//! Recovery only. Nothing here validates a tool name or a schema; that
//! happens downstream, exactly as it does for structured calls.

use serde_json::{Map, Value};

const BAR_FULLWIDTH: char = '\u{FF5C}';
const BAR_DOUBLE: char = '\u{2016}';
const SEPARATOR: char = '\u{2581}';

/// A tag longer than this is prose that happens to contain an angle bracket.
const MAX_TAG_LEN: usize = 160;

#[derive(Debug, Clone, PartialEq)]
pub enum InbandEvent {
    Text(String),
    Call { name: String, arguments: String },
}

#[derive(Debug, Default)]
pub struct DsmlScanner {
    buf: String,
    state: State,
    call_name: String,
    params: Vec<(String, Value)>,
    param_name: String,
    param_json: bool,
    param_value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum State {
    #[default]
    Outside,
    Calls,
    Invoke,
    Param,
}

struct Decoded {
    raw: String,
    closing: bool,
    key: String,
    attrs: String,
}

enum Taken {
    Need,
    Literal(String),
    Token(Decoded),
}

fn normalize_key(head: &str) -> String {
    let mut out = String::new();
    for ch in head.chars() {
        match ch {
            BAR_FULLWIDTH | BAR_DOUBLE | '|' => {}
            SEPARATOR => out.push('_'),
            ch => out.push(ch.to_ascii_lowercase()),
        }
    }
    let mut key = out;
    if let Some(rest) = key.strip_prefix("dsml") {
        key = rest.to_string();
    }
    key.trim_matches('_').to_string()
}

fn decode(raw: &str) -> Option<Decoded> {
    let body = raw.strip_prefix('<')?.strip_suffix('>')?;
    let body = body.trim();
    if body.is_empty() || body.starts_with('!') || body.starts_with('?') {
        return None;
    }
    let closing = body.starts_with('/');
    let rest = if closing {
        body[1..].trim_start()
    } else {
        body
    };
    let dsml = rest
        .chars()
        .any(|ch| ch == BAR_FULLWIDTH || ch == BAR_DOUBLE || ch == '|' || ch == SEPARATOR)
        || rest.to_ascii_lowercase().contains("dsml");
    if !dsml {
        return None;
    }
    let head_end = rest
        .char_indices()
        .find(|(_, ch)| ch.is_whitespace())
        .map(|(index, _)| index)
        .unwrap_or(rest.len());
    let key = normalize_key(&rest[..head_end]);
    if key.is_empty() {
        return None;
    }
    Some(Decoded {
        raw: raw.to_string(),
        closing,
        key,
        attrs: rest[head_end..].trim().to_string(),
    })
}

fn attr(attrs: &str, name: &str) -> Option<String> {
    let mut search = attrs;
    let needle = format!("{name}=");
    loop {
        let index = search.find(&needle)?;
        let boundary = index == 0
            || search[..index]
                .chars()
                .next_back()
                .is_some_and(char::is_whitespace);
        let after = &search[index + needle.len()..];
        if boundary {
            let quote = after.chars().next()?;
            if quote != '"' && quote != '\'' {
                return None;
            }
            let rest = &after[1..];
            let end = rest.find(quote)?;
            return Some(rest[..end].to_string());
        }
        search = after;
    }
}

/// Locate the first `close` tag for `name`, so a literal `<` inside a
/// parameter value cannot be mistaken for one.
fn find_close(buf: &str, name: &str) -> Option<(usize, usize)> {
    let mut from = 0;
    while let Some(offset) = buf[from..].find('<') {
        let start = from + offset;
        let gt = buf[start..].find('>')?;
        let end = start + gt;
        if end + 1 - start > MAX_TAG_LEN {
            from = start + 1;
            continue;
        }
        if let Some(tag) = decode(&buf[start..=end])
            && tag.closing
            && tag.key == name
        {
            return Some((start, end + 1));
        }
        from = start + 1;
    }
    None
}

fn is_control(key: &str) -> bool {
    matches!(key, "begin_of_sentence" | "end_of_sentence" | "boa" | "eos")
}

fn known(key: &str) -> bool {
    matches!(key, "tool_calls" | "invoke" | "parameter")
}

impl DsmlScanner {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, delta: &str) -> Vec<InbandEvent> {
        if delta.is_empty() {
            return Vec::new();
        }
        self.buf.push_str(delta);
        let mut out = Vec::new();
        loop {
            let progressed = match self.state {
                State::Outside => self.step_outside(&mut out),
                State::Calls => self.step_calls(&mut out),
                State::Invoke => self.step_invoke(&mut out),
                State::Param => self.step_param(&mut out),
            };
            if !progressed {
                break;
            }
        }
        out
    }

    /// Flush at end of stream. An incomplete envelope yields no call.
    pub fn finish(&mut self) -> Vec<InbandEvent> {
        let mut out = Vec::new();
        if self.state == State::Outside {
            let rest = std::mem::take(&mut self.buf);
            let partial_tag = rest.starts_with('<')
                && rest.chars().any(|ch| {
                    ch == BAR_FULLWIDTH || ch == BAR_DOUBLE || ch == '|' || ch == SEPARATOR
                });
            if !rest.is_empty() && !partial_tag {
                out.push(InbandEvent::Text(rest));
            }
        }
        self.buf.clear();
        self.state = State::Outside;
        self.call_name.clear();
        self.params.clear();
        self.param_name.clear();
        self.param_value.clear();
        out
    }

    fn take_tag(&mut self) -> Taken {
        let Some(end) = self.buf.find('>') else {
            if self.buf.chars().count() > MAX_TAG_LEN {
                let first = self.buf.remove(0);
                return Taken::Literal(first.to_string());
            }
            return Taken::Need;
        };
        let start = usize::from(self.buf.starts_with('<'));
        if let Some(next) = self.buf[start..].find('<').map(|i| i + start)
            && next < end
        {
            let raw: String = self.buf[..next].to_string();
            self.buf.drain(..next);
            return Taken::Literal(raw);
        }
        let raw: String = self.buf[..=end].to_string();
        self.buf.drain(..=end);
        match decode(&raw) {
            Some(tag) => Taken::Token(tag),
            None => Taken::Literal(raw),
        }
    }

    fn store_param(&mut self) {
        let raw = std::mem::take(&mut self.param_value);
        let value = if self.param_json {
            serde_json::from_str::<Value>(&raw).unwrap_or(Value::String(raw))
        } else {
            Value::String(raw)
        };
        if !self.param_name.is_empty() {
            let name = std::mem::take(&mut self.param_name);
            self.params.push((name, value));
        }
        self.param_name.clear();
    }

    fn emit_call(&mut self, out: &mut Vec<InbandEvent>) {
        let name = std::mem::take(&mut self.call_name);
        let params = std::mem::take(&mut self.params);
        if name.is_empty() {
            self.params.clear();
            return;
        }
        let mut map = Map::new();
        for (key, value) in params {
            map.insert(key, value);
        }
        out.push(InbandEvent::Call {
            name,
            arguments: Value::Object(map).to_string(),
        });
    }

    fn step_outside(&mut self, out: &mut Vec<InbandEvent>) -> bool {
        if self.buf.is_empty() {
            return false;
        }
        let Some(index) = self.buf.find('<') else {
            let text = std::mem::take(&mut self.buf);
            out.push(InbandEvent::Text(text));
            return true;
        };
        if index > 0 {
            let text: String = self.buf.drain(..index).collect();
            out.push(InbandEvent::Text(text));
            return true;
        }
        match self.take_tag() {
            Taken::Need => false,
            Taken::Literal(raw) => {
                out.push(InbandEvent::Text(raw));
                true
            }
            Taken::Token(tag) => {
                if tag.closing {
                    return true;
                }
                match tag.key.as_str() {
                    "tool_calls" => {
                        self.state = State::Calls;
                    }
                    key if known(key) || is_control(key) => {}
                    _ => out.push(InbandEvent::Text(tag.raw)),
                }
                true
            }
        }
    }

    fn step_calls(&mut self, out: &mut Vec<InbandEvent>) -> bool {
        if self.buf.is_empty() {
            return false;
        }
        let Some(index) = self.buf.find('<') else {
            let text = std::mem::take(&mut self.buf);
            if !text.trim().is_empty() {
                out.push(InbandEvent::Text(text));
                self.state = State::Outside;
            }
            return true;
        };
        if index > 0 {
            let text: String = self.buf.drain(..index).collect();
            if !text.trim().is_empty() {
                out.push(InbandEvent::Text(text));
                self.state = State::Outside;
            }
            return true;
        }
        match self.take_tag() {
            Taken::Need => false,
            Taken::Literal(_) => true,
            Taken::Token(tag) => {
                match (tag.key.as_str(), tag.closing) {
                    ("tool_calls", true) => self.state = State::Outside,
                    ("invoke", false) => {
                        self.call_name = attr(&tag.attrs, "name").unwrap_or_default();
                        self.params.clear();
                        self.state = State::Invoke;
                    }
                    _ => {}
                }
                true
            }
        }
    }

    fn step_invoke(&mut self, out: &mut Vec<InbandEvent>) -> bool {
        if self.buf.is_empty() {
            return false;
        }
        let Some(index) = self.buf.find('<') else {
            self.buf.clear();
            return true;
        };
        if index > 0 {
            self.buf.drain(..index);
            return true;
        }
        match self.take_tag() {
            Taken::Need => false,
            Taken::Literal(_) => true,
            Taken::Token(tag) => {
                match (tag.key.as_str(), tag.closing) {
                    ("parameter", false) => {
                        self.param_name = attr(&tag.attrs, "name").unwrap_or_default();
                        self.param_json = attr(&tag.attrs, "string")
                            .is_some_and(|value| value.eq_ignore_ascii_case("false"));
                        self.param_value.clear();
                        self.state = State::Param;
                    }
                    ("invoke", true) => {
                        self.emit_call(out);
                        self.state = State::Calls;
                    }
                    ("tool_calls", true) => {
                        self.emit_call(out);
                        self.state = State::Outside;
                    }
                    _ => {}
                }
                true
            }
        }
    }

    fn step_param(&mut self, _out: &mut Vec<InbandEvent>) -> bool {
        if self.buf.is_empty() {
            return false;
        }
        let Some((start, end)) = find_close(&self.buf, "parameter") else {
            return false;
        };
        let value: String = self.buf[..start].to_string();
        self.param_value.push_str(&value);
        self.buf.drain(..end);
        self.store_param();
        self.state = State::Invoke;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLOSE_PREFIX: &str = concat!("<", "/");

    fn fw(name: &str) -> String {
        format!("<{b}{name}{b}>", b = BAR_FULLWIDTH)
    }

    fn fw_close(name: &str) -> String {
        format!("{CLOSE_PREFIX}{b}{name}{b}>", b = BAR_FULLWIDTH)
    }

    fn ascii(name: &str) -> String {
        format!("<|DSML|{name}>")
    }

    fn ascii_close(name: &str) -> String {
        format!("{CLOSE_PREFIX}|DSML|{name}>")
    }

    fn doubled(name: &str) -> String {
        format!("<{b}{b}DSML{b}{b}{name}>", b = BAR_DOUBLE)
    }

    fn doubled_close(name: &str) -> String {
        format!("{CLOSE_PREFIX}{b}{b}DSML{b}{b}{name}>", b = BAR_DOUBLE)
    }

    fn scan_all(text: &str) -> (String, Vec<(String, String)>) {
        let mut scanner = DsmlScanner::new();
        let mut events = scanner.push(text);
        events.extend(scanner.finish());
        let mut visible = String::new();
        let mut calls = Vec::new();
        for event in events {
            match event {
                InbandEvent::Text(text) => visible.push_str(&text),
                InbandEvent::Call { name, arguments } => calls.push((name, arguments)),
            }
        }
        (visible, calls)
    }

    fn call(name: &str, params: &[(&str, &str, bool)]) -> String {
        let mut out = String::new();
        out.push_str(&fw("tool_calls"));
        out.push_str(&fw(&format!("invoke name=\"{name}\"")));
        for (param, value, as_string) in params {
            let flag = if *as_string { "true" } else { "false" };
            out.push_str(&fw(&format!(
                "parameter name=\"{param}\" string=\"{flag}\""
            )));
            out.push_str(value);
            out.push_str(&fw_close("parameter"));
        }
        out.push_str(&fw_close("invoke"));
        out.push_str(&fw_close("tool_calls"));
        out
    }

    #[test]
    fn plain_text_is_untouched() {
        let text = "before <div>keep</div> and a < b and Vec<T>\nafter";
        let (visible, calls) = scan_all(text);
        assert_eq!(visible, text);
        assert!(calls.is_empty());
    }

    #[test]
    fn fullwidth_envelope_becomes_a_call() {
        let raw = call("run_powershell", &[("command", "Get-Date", true)]);
        let (visible, calls) = scan_all(&format!("done\n{raw}"));
        assert_eq!(visible, "done\n");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "run_powershell");
        let args: Value = serde_json::from_str(&calls[0].1).unwrap();
        assert_eq!(args["command"], serde_json::json!("Get-Date"));
    }

    #[test]
    fn ascii_spelling_becomes_a_call() {
        let mut raw = String::new();
        raw.push_str(&ascii("tool_calls"));
        raw.push_str(&ascii("invoke name=\"get_time\""));
        raw.push_str(&ascii("parameter name=\"tz\" string=\"true\""));
        raw.push_str("UTC");
        raw.push_str(&ascii_close("parameter"));
        raw.push_str(&ascii_close("invoke"));
        raw.push_str(&ascii_close("tool_calls"));
        let (visible, calls) = scan_all(&raw);
        assert_eq!(visible, "");
        assert_eq!(
            calls,
            vec![("get_time".to_string(), "{\"tz\":\"UTC\"}".to_string())]
        );
    }

    #[test]
    fn doubled_bar_spelling_becomes_a_call() {
        let mut raw = String::new();
        raw.push_str(&doubled("tool_calls"));
        raw.push_str(&doubled("invoke name=\"read_file\""));
        raw.push_str(&doubled("parameter name=\"path\" string=\"true\""));
        raw.push_str("C:\\\\tmp\\\\a.txt");
        raw.push_str(&doubled_close("parameter"));
        raw.push_str(&doubled_close("invoke"));
        raw.push_str(&doubled_close("tool_calls"));
        let (_, calls) = scan_all(&raw);
        assert_eq!(calls.len(), 1);
        let args: Value = serde_json::from_str(&calls[0].1).unwrap();
        assert_eq!(args["path"], serde_json::json!("C:\\\\tmp\\\\a.txt"));
    }

    #[test]
    fn string_false_parses_typed_json() {
        let raw = call("set_count", &[("n", "15", false), ("flag", "true", false)]);
        let (_, calls) = scan_all(&raw);
        let args: Value = serde_json::from_str(&calls[0].1).unwrap();
        assert_eq!(args["n"], serde_json::json!(15));
        assert_eq!(args["flag"], serde_json::json!(true));
    }

    #[test]
    fn string_true_keeps_raw_text() {
        let raw = call("echo", &[("q", "{\"a\":1}", true)]);
        let (_, calls) = scan_all(&raw);
        let args: Value = serde_json::from_str(&calls[0].1).unwrap();
        assert_eq!(args["q"], serde_json::json!("{\"a\":1}"));
    }

    #[test]
    fn two_calls_in_one_envelope() {
        let mut raw = String::new();
        raw.push_str(&fw("tool_calls"));
        raw.push_str(&fw("invoke name=\"a\""));
        raw.push_str(&fw("parameter name=\"x\" string=\"false\""));
        raw.push('1');
        raw.push_str(&fw_close("parameter"));
        raw.push_str(&fw_close("invoke"));
        raw.push_str(&fw("invoke name=\"b\""));
        raw.push_str(&fw("parameter name=\"y\" string=\"true\""));
        raw.push_str("two");
        raw.push_str(&fw_close("parameter"));
        raw.push_str(&fw_close("invoke"));
        raw.push_str(&fw_close("tool_calls"));
        let (_, calls) = scan_all(&raw);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, "a");
        assert_eq!(calls[1].1, "{\"y\":\"two\"}");
    }

    #[test]
    fn orphan_closers_never_reach_the_text() {
        let raw = format!(
            "hello{}{}{}",
            fw_close("invoke"),
            fw_close("parameter"),
            fw_close("tool_calls")
        );
        let (visible, calls) = scan_all(&raw);
        assert_eq!(visible, "hello");
        assert!(calls.is_empty());
    }

    #[test]
    fn unclosed_envelope_yields_no_call() {
        let raw = format!(
            "start{}",
            [
                fw("tool_calls"),
                fw("invoke name=\"a\""),
                fw("parameter name=\"x\" string=\"true\"")
            ]
            .concat()
        );
        let (visible, calls) = scan_all(&raw);
        assert_eq!(visible, "start");
        assert!(calls.is_empty());
    }

    #[test]
    fn prose_after_a_stray_section_open_is_kept() {
        let raw = format!("{}let me explain", fw("tool_calls"));
        let (visible, calls) = scan_all(&raw);
        assert_eq!(visible, "let me explain");
        assert!(calls.is_empty());
    }

    #[test]
    fn control_tokens_are_dropped() {
        let raw = format!("{}hi{}", fw("begin_of_sentence"), fw("end_of_sentence"));
        let (visible, _) = scan_all(&raw);
        assert_eq!(visible, "hi");
    }

    #[test]
    fn a_comparison_before_an_envelope_does_not_swallow_it() {
        let raw = format!(
            "a < b. {}",
            call("run_powershell", &[("command", "Get-Date", true)])
        );
        let (visible, calls) = scan_all(&raw);
        assert_eq!(visible, "a < b. ");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "run_powershell");

        let chars: Vec<char> = raw.chars().collect();
        for cut in 0..=chars.len() {
            let head: String = chars[..cut].iter().collect();
            let tail: String = chars[cut..].iter().collect();
            let mut scanner = DsmlScanner::new();
            let mut events = scanner.push(&head);
            events.extend(scanner.push(&tail));
            events.extend(scanner.finish());
            let mut text = String::new();
            let mut found = 0;
            for event in events {
                match event {
                    InbandEvent::Text(chunk) => text.push_str(&chunk),
                    InbandEvent::Call { .. } => found += 1,
                }
            }
            assert_eq!(text, "a < b. ", "visible text differs at cut {cut}");
            assert_eq!(found, 1, "call lost at cut {cut}");
        }
    }

    #[test]
    fn split_at_every_char_gives_the_same_result() {
        let raw = format!(
            "lead {}",
            call("run_powershell", &[("command", "Get-Date", true)])
        );
        let (whole_text, whole_calls) = scan_all(&raw);
        let chars: Vec<char> = raw.chars().collect();
        for cut in 0..=chars.len() {
            let head: String = chars[..cut].iter().collect();
            let tail: String = chars[cut..].iter().collect();
            let mut scanner = DsmlScanner::new();
            let mut events = scanner.push(&head);
            events.extend(scanner.push(&tail));
            events.extend(scanner.finish());
            let mut visible = String::new();
            let mut calls = Vec::new();
            for event in events {
                match event {
                    InbandEvent::Text(text) => visible.push_str(&text),
                    InbandEvent::Call { name, arguments } => calls.push((name, arguments)),
                }
            }
            assert_eq!(visible, whole_text, "visible text differs at cut {cut}");
            assert_eq!(calls, whole_calls, "calls differ at cut {cut}");
        }
    }

    #[test]
    fn long_unterminated_angle_bracket_is_flushed_as_text() {
        let raw = format!("{}{}", "<", "x".repeat(MAX_TAG_LEN + 10));
        let (visible, calls) = scan_all(&raw);
        assert_eq!(visible, raw);
        assert!(calls.is_empty());
    }
}
