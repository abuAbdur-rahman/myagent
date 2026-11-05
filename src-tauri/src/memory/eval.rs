//! Memory retrieval probe gate.
//!
//! Loads `fixtures/memory/probes.json`, builds the FTS half of the memory index
//! in an in-memory database and checks recall@5 against the gate. Probes marked
//! `semantic` need the MiniLM model, which only the app can load, so they are
//! reported and never gated here.
//!
//! Run with `npm run eval:memory`.

#![cfg(test)]

use std::path::PathBuf;

use serde::Deserialize;
use sqlx::SqlitePool;

use super::index::{ensure_schema, fts_candidates, fts_query};

/// Minimum recall@5 over the keyword probes.
const RECALL_GATE: f64 = 0.85;

#[derive(Deserialize)]
struct Fixture {
    notes: Vec<Note>,
    probes: Vec<Probe>,
}

#[derive(Deserialize)]
struct Note {
    id: String,
    kind: String,
    text: String,
}

#[derive(Deserialize)]
struct Probe {
    query: String,
    expect: String,
    #[serde(default)]
    semantic: bool,
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("fixtures")
        .join("memory")
        .join("probes.json")
}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    text.chars()
        .take(limit.saturating_sub(1))
        .collect::<String>()
        + "…"
}

#[tokio::test]
async fn probe_gate() {
    let raw = std::fs::read_to_string(fixture_path()).expect("fixture probes.json");
    let fixture: Fixture = serde_json::from_str(&raw).expect("fixture json");

    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("memory db");
    ensure_schema(&pool).await.expect("schema");
    for note in &fixture.notes {
        sqlx::query(
            "INSERT INTO memory_docs (id, kind, date, scope, text, hash, untrusted) \
             VALUES (?, ?, '2026-01-01', 'global', ?, '', 0)",
        )
        .bind(&note.id)
        .bind(&note.kind)
        .bind(&note.text)
        .execute(&pool)
        .await
        .expect("doc");
        sqlx::query("INSERT INTO memory_fts (id, text) VALUES (?, ?)")
            .bind(&note.id)
            .bind(&note.text)
            .execute(&pool)
            .await
            .expect("fts");
    }

    let mut keyword_total = 0usize;
    let mut keyword_hits = 0usize;
    let mut reciprocal = 0.0f64;
    let mut semantic_total = 0usize;
    let mut semantic_hits = 0usize;

    println!("{:<56} {:<5} expected", "probe", "rank");
    for probe in &fixture.probes {
        let expression = fts_query(&probe.query);
        let ids = if expression.is_empty() {
            Vec::new()
        } else {
            fts_candidates(&pool, &expression, "")
                .await
                .expect("search")
        };
        let rank = ids
            .iter()
            .take(5)
            .position(|id| id == &probe.expect)
            .map(|index| index + 1);
        let shown = rank
            .map(|rank| rank.to_string())
            .unwrap_or_else(|| "miss".to_string());
        let marker = if probe.semantic { " (semantic)" } else { "" };
        println!(
            "{:<56} {:<5} {}{}",
            truncate(&probe.query, 54),
            shown,
            probe.expect,
            marker
        );
        if probe.semantic {
            semantic_total += 1;
            if rank.is_some() {
                semantic_hits += 1;
            }
        } else {
            keyword_total += 1;
            if let Some(rank) = rank {
                keyword_hits += 1;
                reciprocal += 1.0 / rank as f64;
            }
        }
    }

    let recall = keyword_hits as f64 / keyword_total.max(1) as f64;
    let mrr = reciprocal / keyword_total.max(1) as f64;
    println!();
    println!(
        "keyword probes: recall@5 {:.2} ({}/{}), MRR {:.2}",
        recall, keyword_hits, keyword_total, mrr
    );
    if semantic_total > 0 {
        println!(
            "semantic probes (needs the installed MiniLM model, not gated): {}/{}",
            semantic_hits, semantic_total
        );
    }
    assert!(
        recall >= RECALL_GATE,
        "recall@5 {recall:.2} is below the {RECALL_GATE:.2} gate"
    );
    println!("passed: recall@5 gate {RECALL_GATE:.2}");
}
