//! Hybrid memory index: FTS5/BM25 plus local MiniLM vectors, fused with RRF.
//!
//! Memory stays the source of truth in markdown files. This module only derives
//! two SQLite tables and one FTS5 table so `recall_memory` can rank notes by
//! meaning instead of substring matching.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use tauri::AppHandle;

use super::{embed, store};

/// Reciprocal Rank Fusion constant from the original RRF paper.
pub const RRF_K: f64 = 60.0;
/// How many candidates each retriever contributes before fusion.
pub const CANDIDATES: usize = 40;
/// Notes per embedding call. Small enough to keep a command responsive.
pub const BATCH: usize = 32;
/// Minimum cosine for a note that only the vector retriever found.
///
/// MiniLM compresses its range, so this is a floor, not a judgement: 0.88 was
/// measured for unrelated notes that share a domain, and 0.95 for a clear
/// match. FTS5 acts as the precision signal, so this gate is only used when
/// keyword search finds nothing.
const VECTOR_FLOOR: f32 = 0.88;

#[derive(Clone, Debug, Serialize)]
pub struct SearchHit {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub date: String,
    pub scope: String,
    pub score: f64,
    pub trusted: bool,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct FillReport {
    pub scanned: usize,
    pub embedded: usize,
    pub skipped: usize,
    pub removed: usize,
    pub vectors: bool,
    pub errors: Vec<String>,
}

#[derive(Clone)]
struct Note {
    id: String,
    kind: String,
    date: String,
    scope: String,
    text: String,
    hash: String,
    untrusted: bool,
}

fn hash_of(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn project_ids(root: &Path) -> Vec<String> {
    let mut ids = Vec::new();
    let Ok(entries) = std::fs::read_dir(root.join("projects")) else {
        return ids;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|ext| ext == "md").unwrap_or(false)
            && let Some(stem) = path.file_stem().and_then(|value| value.to_str())
            && store::safe_project_id(stem)
        {
            ids.push(stem.to_string());
        }
    }
    ids
}

/// Serializes fills so a snapshot read before a delete cannot commit after the
/// newer one and restore removed notes.
static FILL_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Split a user query into safe FTS5 terms. Every term is quoted, so operators
/// and punctuation in the query cannot change the meaning of the expression.
pub fn fts_query(query: &str) -> String {
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

/// Fuse two ranked id lists with Reciprocal Rank Fusion.
fn fuse(fts: &[String], vectors: &[String]) -> Vec<(String, f64)> {
    let mut scores: HashMap<String, f64> = HashMap::new();
    for (rank, id) in fts.iter().enumerate() {
        *scores.entry(id.clone()).or_default() += 1.0 / (RRF_K + rank as f64 + 1.0);
    }
    for (rank, id) in vectors.iter().enumerate() {
        *scores.entry(id.clone()).or_default() += 1.0 / (RRF_K + rank as f64 + 1.0);
    }
    let mut ranked: Vec<(String, f64)> = scores.into_iter().collect();
    ranked.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
    });
    ranked
}

/// Rebuild the derived index off the caller's thread after a memory write.
/// Embeddings are kept by text hash, so only new or edited notes are re-embedded.
pub fn refresh(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match crate::tools::memory_pool(&handle).await {
            Ok(pool) => {
                if let Err(error) = fill_embeddings(&pool, &handle).await {
                    eprintln!("memory: index refresh failed: {error}");
                }
            }
            Err(error) => eprintln!("memory: index refresh skipped: {error}"),
        }
    });
}

pub async fn ensure_schema(pool: &SqlitePool) -> Result<(), String> {
    sqlx::raw_sql(
        "CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, text);
         CREATE TABLE IF NOT EXISTS memory_docs (
             id TEXT PRIMARY KEY,
             kind TEXT NOT NULL,
             date TEXT NOT NULL,
             scope TEXT NOT NULL,
             text TEXT NOT NULL,
             hash TEXT NOT NULL,
             untrusted INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS memory_vectors (
             id TEXT PRIMARY KEY,
             hash TEXT NOT NULL,
             vector BLOB NOT NULL,
             dim INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_memory_docs_scope ON memory_docs(scope);",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("memory index schema: {error}"))?;
    Ok(())
}

/// Ids already indexed for scopes whose markdown could not be read. Their rows
/// survive the rewrite so a transient read error does not hide them from recall.
async fn protected_ids(
    pool: &SqlitePool,
    failed_scopes: &[String],
) -> Result<HashSet<String>, String> {
    if failed_scopes.is_empty() {
        return Ok(HashSet::new());
    }
    let placeholders = vec!["?"; failed_scopes.len()].join(",");
    let sql = format!("SELECT id FROM memory_docs WHERE scope IN ({placeholders})");
    let mut builder = sqlx::query_scalar::<_, String>(&sql);
    for scope in failed_scopes {
        builder = builder.bind(scope);
    }
    builder
        .fetch_all(pool)
        .await
        .map_err(|error| format!("read protected memory ids: {error}"))
        .map(|ids| ids.into_iter().collect())
}

/// Drop a deleted project's derived rows while holding the fill lock, so a fill
/// that read the markdown before the delete cannot commit them back.
pub async fn purge_project(pool: &SqlitePool, project_id: &str) -> Result<(), String> {
    let _guard = FILL_LOCK.lock().await;
    ensure_schema(pool).await?;
    let scope = format!("project:{project_id}");
    for sql in [
        "DELETE FROM memory_fts WHERE id IN (SELECT id FROM memory_docs WHERE scope = ?)",
        "DELETE FROM memory_vectors WHERE id IN (SELECT id FROM memory_docs WHERE scope = ?)",
        "DELETE FROM memory_docs WHERE scope = ?",
    ] {
        sqlx::query(sql)
            .bind(&scope)
            .execute(pool)
            .await
            .map_err(|error| format!("purge {scope}: {error}"))?;
    }
    Ok(())
}

/// Rebuild the text index and embed every note whose text changed.
///
/// The markdown files are read first, then the database is rewritten in one
/// transaction. A note that fails to embed is still indexed for FTS5 and will
/// be retried on the next fill because its vector hash stays stale.
pub async fn fill_embeddings(pool: &SqlitePool, app: &AppHandle) -> Result<FillReport, String> {
    let _guard = FILL_LOCK.lock().await;
    ensure_schema(pool).await?;
    let root = store::root(app)?;
    let mut report = FillReport {
        vectors: embed::available(app),
        ..FillReport::default()
    };

    let mut notes: HashMap<String, Note> = HashMap::new();
    let mut failed_scopes: Vec<String> = Vec::new();
    let mut scopes: Vec<(Option<String>, String)> = vec![(None, "global".to_string())];
    for id in project_ids(&root) {
        scopes.push((Some(id.clone()), format!("project:{id}")));
    }
    for (project, scope) in &scopes {
        let doc = match store::read(&root, project.as_deref()) {
            Ok(doc) => doc,
            Err(error) => {
                report
                    .errors
                    .push(format!("read {scope}: {error}; keeping its indexed notes"));
                failed_scopes.push(scope.clone());
                continue;
            }
        };
        for entry in doc.entries() {
            report.scanned += 1;
            let collides = notes
                .get(&entry.id)
                .is_some_and(|existing| existing.scope != *scope);
            if collides {
                report.errors.push(format!(
                    "duplicate memory id {} in {scope}; kept the earlier scope",
                    entry.id
                ));
                continue;
            }
            notes.insert(
                entry.id.clone(),
                Note {
                    id: entry.id.clone(),
                    kind: entry.kind_label(),
                    date: entry.date.clone(),
                    scope: scope.clone(),
                    text: entry.text.clone(),
                    hash: hash_of(&entry.text),
                    untrusted: entry.untrusted,
                },
            );
        }
    }

    let protected = protected_ids(pool, &failed_scopes).await?;
    for id in &protected {
        notes.remove(id);
    }

    let existing: HashMap<String, String> = sqlx::query("SELECT id, hash FROM memory_vectors")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("read memory vectors: {error}"))?
        .into_iter()
        .map(|row| (row.get::<String, _>("id"), row.get::<String, _>("hash")))
        .collect();

    let mut pending: Vec<&Note> = Vec::new();
    for (id, note) in &notes {
        if existing
            .get(id)
            .map(|hash| hash == &note.hash)
            .unwrap_or(false)
        {
            report.skipped += 1;
        } else {
            pending.push(note);
        }
    }

    let mut vectors: HashMap<String, Vec<f32>> = HashMap::new();
    if report.vectors {
        let mut index = 0;
        while index < pending.len() {
            let end = (index + BATCH).min(pending.len());
            let texts: Vec<String> = pending[index..end]
                .iter()
                .map(|note| note.text.clone())
                .collect();
            match embed::embed_texts(app, &texts) {
                Ok(rows) => {
                    for (note, vector) in pending[index..end].iter().zip(rows) {
                        vectors.insert(note.id.clone(), vector);
                    }
                }
                Err(error) => report.errors.push(error),
            }
            index = end;
        }
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("memory index tx: {error}"))?;
    if protected.is_empty() {
        sqlx::query("DELETE FROM memory_docs")
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("clear memory docs: {error}"))?;
    } else {
        let placeholders = vec!["?"; protected.len()].join(",");
        let sql = format!("DELETE FROM memory_docs WHERE id NOT IN ({placeholders})");
        let mut builder = sqlx::query(&sql);
        for id in &protected {
            builder = builder.bind(id);
        }
        builder
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("clear memory docs: {error}"))?;
    }
    sqlx::query("DELETE FROM memory_fts WHERE id NOT IN (SELECT id FROM memory_docs)")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("clear memory fts: {error}"))?;

    for note in notes.values() {
        sqlx::query(
            "INSERT INTO memory_docs (id, kind, date, scope, text, hash, untrusted) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(&note.id)
        .bind(&note.kind)
        .bind(&note.date)
        .bind(&note.scope)
        .bind(&note.text)
        .bind(&note.hash)
        .bind(if note.untrusted { 1i64 } else { 0i64 })
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("memory docs: {error}"))?;
        sqlx::query("INSERT INTO memory_fts (id, text) VALUES (?, ?)")
            .bind(&note.id)
            .bind(&note.text)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("memory fts: {error}"))?;
    }

    for id in existing.keys() {
        if !notes.contains_key(id) && !protected.contains(id) {
            sqlx::query("DELETE FROM memory_vectors WHERE id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|error| format!("drop memory vector: {error}"))?;
            report.removed += 1;
        }
    }

    for note in &pending {
        if vectors.contains_key(&note.id) {
            continue;
        }
        sqlx::query("DELETE FROM memory_vectors WHERE id = ?")
            .bind(&note.id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("drop stale memory vector: {error}"))?;
    }

    for (id, vector) in &vectors {
        let Some(note) = notes.get(id) else { continue };
        sqlx::query(
            "INSERT INTO memory_vectors (id, hash, vector, dim) VALUES (?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET hash=excluded.hash, vector=excluded.vector, dim=excluded.dim",
        )
        .bind(id)
        .bind(&note.hash)
        .bind(embed::encode(vector))
        .bind(vector.len() as i64)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("memory vector: {error}"))?;
        report.embedded += 1;
    }

    tx.commit()
        .await
        .map_err(|error| format!("memory index commit: {error}"))?;
    Ok(report)
}

pub async fn fts_candidates(
    pool: &SqlitePool,
    expression: &str,
    scope: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT memory_fts.id AS id FROM memory_fts \
         JOIN memory_docs ON memory_docs.id = memory_fts.id \
         WHERE memory_fts MATCH ? AND (memory_docs.scope = 'global' OR memory_docs.scope = ?) \
         ORDER BY bm25(memory_fts) LIMIT ?",
    )
    .bind(expression)
    .bind(scope)
    .bind(CANDIDATES as i64)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("memory fts search: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| row.get::<String, _>("id"))
        .collect())
}

/// Rank notes by FTS5 BM25 and vector cosine, fused with Reciprocal Rank Fusion.
///
/// A global chat reads only global notes. A project chat reads global notes and
/// its own project file. If the embedding model is not installed the vector
/// list stays empty and the result is plain FTS5 ranking.
pub async fn search(
    pool: &SqlitePool,
    app: &AppHandle,
    query: &str,
    project_id: Option<&str>,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    ensure_schema(pool).await?;
    let limit = limit.clamp(1, 20);
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let expression = fts_query(query);
    let scope = match project_id {
        Some(id) => format!("project:{id}"),
        None => String::new(),
    };

    let fts = if expression.is_empty() {
        Vec::new()
    } else {
        fts_candidates(pool, &expression, &scope).await?
    };

    let mut vectors: Vec<String> = Vec::new();
    if embed::available(app)
        && let Some(query_vector) = embed::try_embed_query(app, query)
    {
        let rows = sqlx::query(
            "SELECT memory_vectors.id AS id, memory_vectors.vector AS vector \
             FROM memory_vectors \
             JOIN memory_docs ON memory_docs.id = memory_vectors.id \
             WHERE memory_docs.scope = 'global' OR memory_docs.scope = ?",
        )
        .bind(&scope)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("memory vector search: {error}"))?;
        let mut scored: Vec<(String, f32)> = rows
            .into_iter()
            .filter_map(|row| {
                let id: String = row.get("id");
                let blob: Vec<u8> = row.get("vector");
                let vector = embed::decode(&blob);
                if vector.len() != query_vector.len() {
                    return None;
                }
                Some((id, embed::cosine(&query_vector, &vector)))
            })
            .collect();
        scored.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        if fts.is_empty() {
            scored.retain(|(_, score)| *score >= VECTOR_FLOOR);
        }
        vectors = scored
            .into_iter()
            .take(CANDIDATES)
            .map(|(id, _)| id)
            .collect();
    }

    let mut ranked = fuse(&fts, &vectors);
    ranked.truncate(limit);
    if ranked.is_empty() {
        return Ok(Vec::new());
    }

    let ids: Vec<String> = ranked.iter().map(|(id, _)| id.clone()).collect();
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!(
        "SELECT id, kind, date, scope, text, untrusted FROM memory_docs WHERE id IN ({placeholders})"
    );
    let mut builder = sqlx::query(&sql);
    for id in &ids {
        builder = builder.bind(id);
    }
    let rows = builder
        .fetch_all(pool)
        .await
        .map_err(|error| format!("memory hit lookup: {error}"))?;
    let mut meta: HashMap<String, (String, String, String, String, bool)> = HashMap::new();
    for row in rows {
        meta.insert(
            row.get("id"),
            (
                row.get("kind"),
                row.get("date"),
                row.get("scope"),
                row.get("text"),
                row.get::<i64, _>("untrusted") == 0,
            ),
        );
    }
    Ok(ranked
        .into_iter()
        .filter_map(|(id, score)| {
            meta.remove(&id)
                .map(|(kind, date, scope, text, trusted)| SearchHit {
                    id,
                    text,
                    kind,
                    date,
                    scope,
                    score,
                    trusted,
                })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_query_quotes_terms_and_drops_operators() {
        assert_eq!(
            fts_query("Convert Clicks OR project"),
            "\"convert\" OR \"clicks\" OR \"project\""
        );
        assert_eq!(fts_query("C++"), "\"c\"");
        assert_eq!(fts_query("  ??"), "");
    }

    #[test]
    fn fusion_puts_agreement_first() {
        let fts = vec!["a".to_string(), "b".to_string()];
        let vectors = vec!["b".to_string(), "c".to_string()];
        let ranked = fuse(&fts, &vectors);
        assert_eq!(ranked[0].0, "b");
        assert_eq!(ranked.len(), 3);
    }

    #[test]
    fn fusion_is_empty_without_candidates() {
        assert!(fuse(&[], &[]).is_empty());
    }

    #[test]
    fn fusion_breaks_equal_scores_stably() {
        let ranked = fuse(
            &["b".to_string(), "a".to_string()],
            &["a".to_string(), "b".to_string()],
        );
        assert_eq!(ranked[0].0, "a");
        assert_eq!(ranked[1].0, "b");
    }

    #[tokio::test]
    async fn fts_search_ranks_and_scopes_notes() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("memory db");
        ensure_schema(&pool).await.expect("schema");
        for (id, scope, text) in [
            ("g1", "global", "The user prefers short answers"),
            (
                "g2",
                "global",
                "The release pipeline builds an NSIS installer",
            ),
            (
                "p1",
                "project:alpha",
                "Checkout uses the hosted payment page",
            ),
            ("p2", "project:beta", "Checkout is disabled in beta"),
        ] {
            sqlx::query(
                "INSERT INTO memory_docs (id, kind, date, scope, text, hash, untrusted) \
                 VALUES (?, 'note', '2026-01-01', ?, ?, '', 0)",
            )
            .bind(id)
            .bind(scope)
            .bind(text)
            .execute(&pool)
            .await
            .expect("doc");
            sqlx::query("INSERT INTO memory_fts (id, text) VALUES (?, ?)")
                .bind(id)
                .bind(text)
                .execute(&pool)
                .await
                .expect("fts");
        }
        let ids = fts_candidates(&pool, &fts_query("checkout page"), "project:alpha")
            .await
            .expect("search");
        assert_eq!(ids.first().map(String::as_str), Some("p1"));
        assert!(!ids.iter().any(|id| id == "p2"));
        let ids = fts_candidates(&pool, &fts_query("checkout"), "")
            .await
            .expect("global search");
        assert!(ids.is_empty());
        let ids = fts_candidates(&pool, &fts_query("short answers"), "")
            .await
            .expect("global memory search");
        assert_eq!(ids, vec!["g1"]);
    }
}
