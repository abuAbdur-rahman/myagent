use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, mpsc};

use serde::Deserialize;

use crate::sse::{SseItem, SseParser};

const FIXTURE_NAMES: [&str; 10] = [
    "plain",
    "reasoning",
    "tools",
    "length",
    "mid_error",
    "comments",
    "usage",
    "coalesced",
    "multibyte",
    "multiline",
];

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ExpectedSseEvent {
    Payload { data: String },
    Done,
}

fn fixture_path(name: &str, extension: &str) -> PathBuf {
    assert!(FIXTURE_NAMES.contains(&name), "unknown fixture: {name}");
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(format!("{name}.{extension}"))
}

pub(crate) fn fixture_text(name: &str) -> String {
    std::fs::read_to_string(fixture_path(name, "sse"))
        .unwrap_or_else(|error| panic!("read {name}.sse: {error}"))
}

fn expected_events(name: &str) -> Vec<ExpectedSseEvent> {
    let text = std::fs::read_to_string(fixture_path(name, "events.jsonl"))
        .unwrap_or_else(|error| panic!("read {name}.events.jsonl: {error}"));
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .enumerate()
        .map(|(index, line)| {
            serde_json::from_str(line).unwrap_or_else(|error| {
                panic!("parse {name}.events.jsonl line {}: {error}", index + 1)
            })
        })
        .collect()
}

fn replay(raw: &str, cut: usize) -> Vec<ExpectedSseEvent> {
    let mut parser = SseParser::new();
    raw.as_bytes()
        .chunks(cut)
        .flat_map(|piece| parser.feed(piece))
        .map(|event| match event {
            SseItem::Payload(data) => ExpectedSseEvent::Payload { data },
            SseItem::Done => ExpectedSseEvent::Done,
        })
        .collect()
}

pub(crate) fn assert_fixture_events(name: &str) {
    let raw = fixture_text(name);
    let expected = expected_events(name);
    for cut in [1, 7, 64] {
        assert_eq!(
            replay(&raw, cut),
            expected,
            "{name}.sse differs at chunk size {cut}"
        );
    }
}

pub(crate) struct FixtureProvider {
    pub(crate) base_url: String,
    connections: Arc<AtomicUsize>,
    release: Option<mpsc::Sender<()>>,
}

impl FixtureProvider {
    pub(crate) fn connections(&self) -> usize {
        self.connections.load(Ordering::SeqCst)
    }

    pub(crate) fn release(&mut self) {
        self.release.take();
    }
}

fn first_event_end(raw: &str) -> usize {
    raw.find("\r\n\r\n")
        .map(|index| index + 4)
        .or_else(|| raw.find("\n\n").map(|index| index + 2))
        .unwrap_or(raw.len())
}

pub(crate) fn fixture_provider(
    name: &str,
    chunk_size: usize,
    pause_after_first: bool,
) -> FixtureProvider {
    let raw = fixture_text(name);
    let split = if pause_after_first {
        first_event_end(&raw)
    } else {
        raw.len()
    };
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture provider");
    let address = listener.local_addr().expect("fixture provider address");
    let connections = Arc::new(AtomicUsize::new(0));
    let seen = connections.clone();
    let (release, gate) = mpsc::channel();
    let size = chunk_size.max(1);
    std::thread::spawn(move || {
        let Ok((stream, _)) = listener.accept() else {
            return;
        };
        seen.fetch_add(1, Ordering::SeqCst);
        let mut reader = BufReader::new(stream.try_clone().expect("clone fixture stream"));
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
            if let Some((header, value)) = trimmed.split_once(':')
                && header.eq_ignore_ascii_case("Content-Length")
            {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
        let mut request_body = vec![0u8; content_length];
        let _ = reader.read_exact(&mut request_body);
        let mut stream = reader.into_inner();
        let _ = stream.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
        );
        for chunk in raw.as_bytes()[..split].chunks(size) {
            if stream.write_all(chunk).is_err() {
                return;
            }
            let _ = stream.flush();
        }
        if pause_after_first {
            let _ = gate.recv();
        }
        for chunk in raw.as_bytes()[split..].chunks(size) {
            if stream.write_all(chunk).is_err() {
                return;
            }
            let _ = stream.flush();
        }
    });
    FixtureProvider {
        base_url: format!("http://{address}"),
        connections,
        release: pause_after_first.then_some(release),
    }
}
