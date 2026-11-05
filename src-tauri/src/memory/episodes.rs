//! Past-chat search over message text.
//!
//! `message_fts` is an FTS5 external-content table over `messages`, kept in
//! sync by triggers so the frontend's SQLite writes need no extra call. The
//! index is derived: `rebuild` recreates it from the rows that are there.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use tauri::AppHandle;

/// Characters of a message kept for a citation.
pub const SNIPPET_CHARS: usize = 320;
/// Past chats injected on one turn.
pub const AUTO_HITS: usize = 2;
/// Candidates read before the term gate keeps the useful ones.
const CANDIDATES: usize = 10;
const MARKER_KEY: &str = "message_index.built";

#[derive(Clone, Debug, Serialize)]
pub struct EpisodeHit {
    pub message_id: String,
    pub conversation_id: String,
    pub title: String,
    pub date: String,
    pub role: String,
    pub snippet: String,
    pub score: f64,
    pub created_at: i64,
}

pub async fn ensure_schema(pool: &SqlitePool) -> Result<(), String> {
    for statement in SCHEMA_STATEMENTS {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| format!("message index schema: {error}"))?;
    }
    Ok(())
}

async fn marker(pool: &SqlitePool) -> Result<bool, String> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM meta WHERE key = ?")
        .bind(MARKER_KEY)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("read message index marker: {error}"))?;
    Ok(value.is_some())
}

const SCHEMA_STATEMENTS: [&str; 4] = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
         content, content='messages', content_rowid='rowid', tokenize='unicode61'
     )",
    "CREATE TRIGGER IF NOT EXISTS message_fts_ai AFTER INSERT ON messages BEGIN
         INSERT INTO message_fts(rowid, content) VALUES (new.rowid, new.content);
     END",
    "CREATE TRIGGER IF NOT EXISTS message_fts_ad AFTER DELETE ON messages BEGIN
         INSERT INTO message_fts(message_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
     END",
    "CREATE TRIGGER IF NOT EXISTS message_fts_au AFTER UPDATE ON messages BEGIN
         INSERT INTO message_fts(message_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
         INSERT INTO message_fts(rowid, content) VALUES (new.rowid, new.content);
     END",
];

/// Index the chats that existed before the triggers did, once.
///
/// The triggers, the rebuild and the marker commit together, so a crash can
/// leave the index untouched but never half-built.
pub async fn backfill(pool: &SqlitePool) -> Result<bool, String> {
    if marker(pool).await.unwrap_or(false) {
        return Ok(false);
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("message index tx: {error}"))?;
    for statement in SCHEMA_STATEMENTS {
        sqlx::query(statement)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("message index schema: {error}"))?;
    }
    sqlx::query("INSERT INTO message_fts(message_fts) VALUES('rebuild')")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("rebuild message index: {error}"))?;
    sqlx::query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(MARKER_KEY)
        .bind("1")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("write message index marker: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("message index commit: {error}"))?;
    Ok(true)
}

/// Recreate the message index from the rows that are stored now.
pub async fn reindex(pool: &SqlitePool) -> Result<(), String> {
    ensure_schema(pool).await?;
    sqlx::query("INSERT INTO message_fts(message_fts) VALUES('rebuild')")
        .execute(pool)
        .await
        .map_err(|error| format!("rebuild message index: {error}"))?;
    Ok(())
}

/// Start the one-off backfill off the caller's thread at startup.
pub fn backfill_async(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match crate::tools::memory_pool(&handle).await {
            Ok(pool) => match backfill(&pool).await {
                Ok(true) => {}
                Ok(false) => {}
                Err(error) => eprintln!("episodes: backfill failed: {error}"),
            },
            Err(error) => eprintln!("episodes: backfill skipped: {error}"),
        }
    });
}

/// Split a query into quoted FTS5 terms.
fn fts_query(query: &str) -> String {
    let mut tokens: Vec<String> = Vec::new();
    for token in query.split(|value: char| !value.is_alphanumeric()) {
        let token = token.to_lowercase();
        if !token.is_empty()
            && !matches!(token.as_str(), "or" | "and" | "not" | "near")
            && !tokens.contains(&token)
        {
            tokens.push(token);
        }
    }
    tokens
        .iter()
        .map(|token| format!("\"{token}\""))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn terms_of(query: &str) -> Vec<String> {
    let mut terms: Vec<String> = Vec::new();
    for token in query.split(|value: char| !value.is_alphanumeric()) {
        let token = token.to_lowercase();
        if token.len() >= 3 && !terms.contains(&token) {
            terms.push(token);
        }
    }
    terms
}

/// How many distinct query terms a snippet contains as whole words.
fn matched_terms(text: &str, terms: &[String]) -> usize {
    let lower = text.to_lowercase();
    let words: HashSet<&str> = lower
        .split(|value: char| !value.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    terms
        .iter()
        .filter(|term| words.contains(term.as_str()))
        .count()
}

/// Cut a snippet around the first query term so the match is visible.
fn snippet_of(text: &str, terms: &[String]) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= SNIPPET_CHARS {
        return flat;
    }
    let lower = flat.to_lowercase();
    let start = terms
        .iter()
        .filter_map(|term| lower.find(term.as_str()))
        .min()
        .map(|byte| {
            let mut cut = byte.min(flat.len());
            while cut > 0 && !flat.is_char_boundary(cut) {
                cut -= 1;
            }
            flat[..cut]
                .chars()
                .count()
                .saturating_sub(SNIPPET_CHARS / 3)
        })
        .unwrap_or(0);
    let mut chars = flat.chars().skip(start);
    let body: String = chars.by_ref().take(SNIPPET_CHARS).collect();
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if chars.next().is_some() { "…" } else { "" };
    format!("{prefix}{body}{suffix}")
}

/// Search past messages. A global chat reads only chats outside a project; a
/// project chat reads that project plus chats outside any project.
pub async fn search(
    pool: &SqlitePool,
    query: &str,
    project_id: Option<&str>,
    exclude_conversation: Option<&str>,
    limit: usize,
) -> Result<Vec<EpisodeHit>, String> {
    if !marker(pool).await.unwrap_or(false) {
        backfill(pool).await?;
    }
    ensure_schema(pool).await?;
    let expression = fts_query(query);
    if expression.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 20);
    let rows = sqlx::query(
        "SELECT messages.id AS id, messages.conversation_id AS conversation_id, \
                messages.role AS role, messages.content AS content, \
                messages.created_at AS created_at, conversations.title AS title, \
                bm25(message_fts) AS rank \
         FROM message_fts \
         JOIN messages ON messages.rowid = message_fts.rowid \
         JOIN conversations ON conversations.id = messages.conversation_id \
         WHERE message_fts MATCH ? \
           AND (conversations.project_id IS NULL OR conversations.project_id = ?) \
           AND messages.content <> '' \
           AND (? IS NULL OR messages.conversation_id <> ?) \
         ORDER BY rank LIMIT ?",
    )
    .bind(&expression)
    .bind(project_id)
    .bind(exclude_conversation)
    .bind(exclude_conversation)
    .bind(limit as i64)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("message search: {error}"))?;

    let terms = terms_of(query);
    let mut hits: Vec<EpisodeHit> = Vec::new();
    for row in rows {
        let content: String = row.get("content");
        let score: f64 = row.get("rank");
        let created: i64 = row.get("created_at");
        let date = chrono::DateTime::from_timestamp_millis(created)
            .unwrap_or_else(|| chrono::DateTime::from_timestamp_millis(0).unwrap())
            .format("%Y-%m-%d")
            .to_string();
        hits.push(EpisodeHit {
            message_id: row.get("id"),
            conversation_id: row.get("conversation_id"),
            title: row.get("title"),
            date,
            role: row.get("role"),
            snippet: snippet_of(&content, &terms),
            score,
            created_at: created,
        });
    }
    hits.sort_by(|left, right| {
        left.score
            .partial_cmp(&right.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    hits.truncate(limit);
    Ok(hits)
}

/// Rank the past chats worth injecting on this turn.
///
/// A hit must contain at least two query terms, or one when the query is a
/// single word. Only the newest qualifying message of a chat is kept, so two
/// snippets never come from the same conversation.
pub async fn recall(
    pool: &SqlitePool,
    query: &str,
    project_id: Option<&str>,
    conversation_id: Option<&str>,
) -> Result<Vec<EpisodeHit>, String> {
    let terms = terms_of(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let required = if terms.len() == 1 { 1 } else { 2 };
    let hits = search(pool, query, project_id, conversation_id, CANDIDATES).await?;
    let mut newest: HashMap<String, EpisodeHit> = HashMap::new();
    for hit in hits {
        if matched_terms(&hit.snippet, &terms) < required {
            continue;
        }
        match newest.get(&hit.conversation_id) {
            Some(seen) if seen.created_at >= hit.created_at => {}
            _ => {
                newest.insert(hit.conversation_id.clone(), hit);
            }
        }
    }
    let mut kept: Vec<EpisodeHit> = newest.into_values().collect();
    kept.sort_by(|left, right| {
        left.score
            .partial_cmp(&right.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    kept.truncate(AUTO_HITS);
    Ok(kept)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn seeded() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("memory db");
        sqlx::raw_sql(
            "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT, created_at INTEGER NOT NULL);
             CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
             CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .execute(&pool)
        .await
        .expect("tables");
        ensure_schema(&pool).await.expect("schema");
        for (id, title, project) in [
            ("g1", "Billing questions", None),
            ("p1", "Convert Clicks work", Some("alpha")),
            ("p2", "Other project", Some("beta")),
        ] {
            sqlx::query(
                "INSERT INTO conversations (id, title, project_id, created_at) VALUES (?,?,?,1)",
            )
            .bind(id)
            .bind(title)
            .bind(project)
            .execute(&pool)
            .await
            .expect("conversation");
        }
        for (id, conversation, role, content) in [
            ("m1", "g1", "user", "How do I export invoices from Xero?"),
            (
                "m2",
                "p1",
                "assistant",
                "Checkout uses the hosted payment page for invoices.",
            ),
            (
                "m3",
                "p2",
                "assistant",
                "Invoices in beta are disabled entirely.",
            ),
        ] {
            sqlx::query(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?,?,?,?,1700000000000)",
            )
            .bind(id)
            .bind(conversation)
            .bind(role)
            .bind(content)
            .execute(&pool)
            .await
            .expect("message");
        }
        pool
    }

    #[tokio::test]
    async fn triggers_index_new_messages() {
        let pool = seeded().await;
        sqlx::query("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('m9','g1','user','A brand new question about invoices',1)")
            .execute(&pool)
            .await
            .expect("insert");
        let hits = search(&pool, "invoices", None, None, 5)
            .await
            .expect("search");
        assert!(hits.iter().any(|hit| hit.message_id == "m9"));
    }

    #[tokio::test]
    async fn a_global_chat_never_reads_project_messages() {
        let pool = seeded().await;
        let hits = search(&pool, "invoices", None, None, 10)
            .await
            .expect("search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].conversation_id, "g1");
        assert_eq!(hits[0].title, "Billing questions");
        assert_eq!(hits[0].date, "2023-11-14");
    }

    #[tokio::test]
    async fn a_project_chat_reads_its_project_and_global_chats() {
        let pool = seeded().await;
        let hits = search(&pool, "invoices", Some("alpha"), None, 10)
            .await
            .expect("search");
        let chats: Vec<&str> = hits
            .iter()
            .map(|hit| hit.conversation_id.as_str())
            .collect();
        assert!(chats.contains(&"p1"));
        assert!(chats.contains(&"g1"));
        assert!(!chats.contains(&"p2"));
    }

    #[tokio::test]
    async fn the_current_chat_is_excluded() {
        let pool = seeded().await;
        let hits = search(&pool, "invoices", Some("alpha"), Some("p1"), 10)
            .await
            .expect("search");
        assert!(!hits.iter().any(|hit| hit.conversation_id == "p1"));
    }

    #[tokio::test]
    async fn recall_needs_two_terms_and_one_hit_per_chat() {
        let pool = seeded().await;
        let hits = recall(&pool, "invoices checkout", Some("alpha"), None)
            .await
            .expect("recall");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].conversation_id, "p1");
        assert!(hits[0].snippet.contains("hosted payment page"));
    }

    #[tokio::test]
    async fn recall_ignores_a_single_shared_word() {
        let pool = seeded().await;
        let hits = recall(&pool, "invoices zebra", Some("alpha"), None)
            .await
            .expect("recall");
        assert!(hits.is_empty());
    }

    #[tokio::test]
    async fn backfill_runs_once() {
        let pool = seeded().await;
        assert!(backfill(&pool).await.expect("first"));
        assert!(!backfill(&pool).await.expect("second"));
    }

    #[test]
    fn snippets_are_windowed_around_the_match() {
        let text = format!("{} invoices {}", "a".repeat(400), "b".repeat(400));
        let snippet = snippet_of(&text, &["invoices".to_string()]);
        assert!(snippet.contains("invoices"));
        assert!(snippet.chars().count() <= SNIPPET_CHARS + 2);
        assert!(snippet.starts_with('…'));
    }

    #[test]
    fn snippets_cut_on_a_character_boundary_for_multibyte_text() {
        let text = format!("{}invoices {}", "😀".repeat(400), "b".repeat(400));
        let snippet = snippet_of(&text, &["invoices".to_string()]);
        assert!(snippet.contains("invoices"));
        assert!(snippet.chars().count() <= SNIPPET_CHARS + 2);
    }

    #[test]
    fn terms_are_deduplicated_and_matched_as_whole_words() {
        let terms = terms_of("invoice invoice checkouts");
        assert_eq!(terms, vec!["invoice".to_string(), "checkouts".to_string()]);
        assert_eq!(matched_terms("an invoice is here", &terms), 1);
        assert_eq!(
            matched_terms("checkouts are off but invoice stands", &terms),
            2
        );
        let single = vec!["invoice".to_string()];
        assert_eq!(matched_terms("invoices everywhere", &single), 0);
    }

    #[tokio::test]
    async fn recall_keeps_the_newest_message_of_a_chat() {
        let pool = seeded().await;
        sqlx::query("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('m10','p1','user','invoices checkout later note',1700000900000)")
            .execute(&pool)
            .await
            .expect("insert");
        let hits = recall(&pool, "invoices checkout", Some("alpha"), None)
            .await
            .expect("recall");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].message_id, "m10");
    }

    #[tokio::test]
    async fn search_backfills_when_the_marker_was_lost() {
        let pool = seeded().await;
        backfill(&pool).await.expect("first");
        sqlx::query("DELETE FROM meta WHERE key = ?")
            .bind(MARKER_KEY)
            .execute(&pool)
            .await
            .expect("drop marker");
        sqlx::query("DELETE FROM message_fts")
            .execute(&pool)
            .await
            .expect("empty index");
        let hits = search(&pool, "invoices", None, None, 5)
            .await
            .expect("search");
        assert!(hits.iter().any(|hit| hit.message_id == "m1"));
    }
}
