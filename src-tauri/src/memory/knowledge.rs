//! Project knowledge chunks: heading-aware splitting plus the same hybrid
//! retrieval as memory, always scoped to one project.
//!
//! Documents stay content-addressed on disk. This module derives chunk rows,
//! their FTS5 terms and their MiniLM vectors so a paraphrased question can find
//! the paragraph that answers it and cite the document it came from.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use tauri::AppHandle;

use super::embed;

/// Characters per chunk before it is windowed further.
pub const CHUNK_CHARS: usize = 1000;
/// Characters repeated from the previous window so a sentence is not cut in half.
pub const OVERLAP_CHARS: usize = 150;
/// How many candidates each retriever contributes before fusion.
const CANDIDATES: usize = 40;
/// Reciprocal Rank Fusion constant, same value as the memory index.
const RRF_K: f64 = 60.0;
/// Minimum cosine for a chunk that only the vector retriever found.
const VECTOR_FLOOR: f32 = 0.88;

#[derive(Clone, Debug, Serialize)]
pub struct KnowledgeHit {
    pub doc_id: String,
    pub name: String,
    pub ord: i64,
    pub heading: Option<String>,
    pub text: String,
    pub score: f64,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct KnowledgeFillReport {
    pub documents: usize,
    pub chunks: usize,
    pub embedded: usize,
    pub removed: usize,
    pub vectors: bool,
    pub errors: Vec<String>,
}

#[derive(Clone)]
struct Chunk {
    id: String,
    doc_id: String,
    project_id: String,
    ord: i64,
    heading: Option<String>,
    text: String,
    hash: String,
}

fn hash_of(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn chunk_id(doc_id: &str, ord: i64) -> String {
    format!("{doc_id}:{ord}")
}

/// Split one document into citation-sized chunks.
///
/// Markdown headings start a new chunk, so a retrieved chunk carries the
/// section it belongs to. Text without headings is windowed at
/// [`CHUNK_CHARS`] with [`OVERLAP_CHARS`] of overlap.
pub fn chunk_text(text: &str) -> Vec<(Option<String>, String)> {
    let mut chunks: Vec<(Option<String>, String)> = Vec::new();
    let mut heading: Option<String> = None;
    let mut body = String::new();
    for line in text.lines() {
        let is_heading = line.trim_start().starts_with('#');
        if is_heading && !body.trim().is_empty() {
            push_section(&mut chunks, heading.take(), &body);
            body.clear();
        }
        if is_heading {
            heading = Some(line.trim_start().trim_start_matches('#').trim().to_string());
        }
        body.push_str(line);
        body.push('\n');
    }
    if !body.trim().is_empty() {
        push_section(&mut chunks, heading, &body);
    }
    chunks
}

fn push_section(chunks: &mut Vec<(Option<String>, String)>, heading: Option<String>, body: &str) {
    let text = body.trim();
    if text.is_empty() {
        return;
    }
    let mut start = 0;
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= CHUNK_CHARS {
        chunks.push((heading, text.to_string()));
        return;
    }
    while start < chars.len() {
        let end = (start + CHUNK_CHARS).min(chars.len());
        let slice: String = chars[start..end].iter().collect();
        chunks.push((heading.clone(), slice.trim().to_string()));
        if end == chars.len() {
            break;
        }
        start = end.saturating_sub(OVERLAP_CHARS);
    }
}

/// Split a user query into safe FTS5 terms, every one quoted.
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

pub async fn ensure_schema(pool: &SqlitePool) -> Result<(), String> {
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS knowledge_chunks (
             id TEXT PRIMARY KEY,
             doc_id TEXT NOT NULL,
             project_id TEXT NOT NULL,
             ord INTEGER NOT NULL,
             heading TEXT,
             text TEXT NOT NULL,
             hash TEXT NOT NULL
         );
         CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(id UNINDEXED, text, heading);
         CREATE TABLE IF NOT EXISTS knowledge_vectors (
             id TEXT PRIMARY KEY,
             hash TEXT NOT NULL,
             vector BLOB NOT NULL,
             dim INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_project ON knowledge_chunks(project_id);
         CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id);",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("knowledge schema: {error}"))?;
    Ok(())
}

static FILL_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Rebuild one project's chunks off the caller's thread after an upload or a
/// document delete, so the upload command stays fast.
pub fn refresh(app: &AppHandle, project_id: &str) {
    let handle = app.clone();
    let project = project_id.to_string();
    tauri::async_runtime::spawn(async move {
        match crate::tools::memory_pool(&handle).await {
            Ok(pool) => {
                if let Err(error) = fill_embeddings(&pool, &handle, &project).await {
                    eprintln!("knowledge: index refresh failed: {error}");
                }
            }
            Err(error) => eprintln!("knowledge: index refresh skipped: {error}"),
        }
    });
}

async fn project_docs(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let rows = sqlx::query(
        "SELECT id, sha256 FROM knowledge_docs WHERE project_id = ? ORDER BY created_at ASC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("read knowledge docs: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| (row.get::<String, _>("id"), row.get::<String, _>("sha256")))
        .collect())
}

/// Chunk and embed every document of one project.
pub async fn fill_embeddings(
    pool: &SqlitePool,
    app: &AppHandle,
    project_id: &str,
) -> Result<KnowledgeFillReport, String> {
    let _guard = FILL_LOCK.lock().await;
    ensure_schema(pool).await?;
    let mut report = KnowledgeFillReport {
        vectors: embed::available(app),
        ..KnowledgeFillReport::default()
    };

    let docs = project_docs(pool, project_id).await?;
    let mut live_docs: HashSet<String> = HashSet::new();
    let mut failed_docs: Vec<String> = Vec::new();
    let mut chunks: HashMap<String, Chunk> = HashMap::new();

    for (doc_id, sha256) in &docs {
        let text = match crate::documents::read_text(app, sha256, Some(project_id)) {
            Ok(text) => text,
            Err(error) => {
                report.errors.push(format!(
                    "read {doc_id}: {error}; keeping its indexed chunks"
                ));
                failed_docs.push(doc_id.clone());
                continue;
            }
        };
        live_docs.insert(doc_id.clone());
        for (ord, (heading, body)) in chunk_text(&text).into_iter().enumerate() {
            let ord = ord as i64;
            let id = chunk_id(doc_id, ord);
            report.chunks += 1;
            chunks.insert(
                id.clone(),
                Chunk {
                    id,
                    doc_id: doc_id.clone(),
                    project_id: project_id.to_string(),
                    ord,
                    heading,
                    hash: hash_of(&body),
                    text: body,
                },
            );
        }
    }
    report.documents = live_docs.len();

    let protected = protected_ids(pool, project_id, &failed_docs).await?;
    for id in &protected {
        chunks.remove(id);
    }

    let existing: HashMap<String, String> = sqlx::query("SELECT id, hash FROM knowledge_vectors")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("read knowledge vectors: {error}"))?
        .into_iter()
        .map(|row| (row.get::<String, _>("id"), row.get::<String, _>("hash")))
        .collect();

    let mut pending: Vec<&Chunk> = Vec::new();
    for chunk in chunks.values() {
        match existing.get(&chunk.id) {
            Some(hash) if hash == &chunk.hash => {}
            _ => pending.push(chunk),
        }
    }

    let mut vectors: HashMap<String, Vec<f32>> = HashMap::new();
    if report.vectors {
        let mut index = 0;
        while index < pending.len() {
            let end = (index + super::index::BATCH).min(pending.len());
            let texts: Vec<String> = pending[index..end]
                .iter()
                .map(|chunk| chunk.text.clone())
                .collect();
            match embed::embed_texts(app, &texts) {
                Ok(rows) => {
                    for (chunk, vector) in pending[index..end].iter().zip(rows) {
                        vectors.insert(chunk.id.clone(), vector);
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
        .map_err(|error| format!("knowledge index tx: {error}"))?;
    if protected.is_empty() {
        sqlx::query("DELETE FROM knowledge_chunks WHERE project_id = ?")
            .bind(project_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("clear knowledge chunks: {error}"))?;
    } else {
        let placeholders = vec!["?"; protected.len()].join(",");
        let sql = format!(
            "DELETE FROM knowledge_chunks WHERE project_id = ? AND id NOT IN ({placeholders})"
        );
        let mut builder = sqlx::query(&sql).bind(project_id);
        for id in &protected {
            builder = builder.bind(id);
        }
        builder
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("clear knowledge chunks: {error}"))?;
    }

    for chunk in chunks.values() {
        sqlx::query(
            "INSERT INTO knowledge_chunks (id, doc_id, project_id, ord, heading, text, hash) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(&chunk.id)
        .bind(&chunk.doc_id)
        .bind(&chunk.project_id)
        .bind(chunk.ord)
        .bind(&chunk.heading)
        .bind(&chunk.text)
        .bind(&chunk.hash)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("knowledge chunk: {error}"))?;
        sqlx::query("INSERT INTO knowledge_chunks_fts (id, text, heading) VALUES (?, ?, ?)")
            .bind(&chunk.id)
            .bind(&chunk.text)
            .bind(chunk.heading.as_deref().unwrap_or(""))
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("knowledge fts: {error}"))?;
    }
    sqlx::query(
        "DELETE FROM knowledge_chunks_fts WHERE id NOT IN (SELECT id FROM knowledge_chunks)",
    )
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("clear knowledge fts: {error}"))?;

    let keep: HashSet<&String> = chunks.keys().collect();
    for id in existing.keys() {
        if !keep.contains(id) && !protected.contains(id) {
            sqlx::query("DELETE FROM knowledge_vectors WHERE id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|error| format!("drop knowledge vector: {error}"))?;
            report.removed += 1;
        }
    }
    for chunk in &pending {
        if vectors.contains_key(&chunk.id) {
            continue;
        }
        sqlx::query("DELETE FROM knowledge_vectors WHERE id = ?")
            .bind(&chunk.id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("drop stale knowledge vector: {error}"))?;
    }
    for (id, vector) in &vectors {
        let Some(chunk) = chunks.get(id) else {
            continue;
        };
        sqlx::query(
            "INSERT INTO knowledge_vectors (id, hash, vector, dim) VALUES (?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET hash=excluded.hash, vector=excluded.vector, dim=excluded.dim",
        )
        .bind(id)
        .bind(&chunk.hash)
        .bind(embed::encode(vector))
        .bind(vector.len() as i64)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("knowledge vector: {error}"))?;
        report.embedded += 1;
    }

    tx.commit()
        .await
        .map_err(|error| format!("knowledge index commit: {error}"))?;
    Ok(report)
}

/// Chunks already indexed for documents whose text could not be read now.
async fn protected_ids(
    pool: &SqlitePool,
    project_id: &str,
    failed_docs: &[String],
) -> Result<HashSet<String>, String> {
    if failed_docs.is_empty() {
        return Ok(HashSet::new());
    }
    let placeholders = vec!["?"; failed_docs.len()].join(",");
    let sql = format!(
        "SELECT id FROM knowledge_chunks WHERE project_id = ? AND doc_id IN ({placeholders})"
    );
    let mut builder = sqlx::query_scalar::<_, String>(&sql).bind(project_id);
    for doc_id in failed_docs {
        builder = builder.bind(doc_id);
    }
    builder
        .fetch_all(pool)
        .await
        .map_err(|error| format!("read protected chunk ids: {error}"))
        .map(|ids| ids.into_iter().collect())
}

/// Drop one document's chunks, terms and vectors. Runs before the delete
/// returns so a removed document cannot be cited.
pub async fn purge_doc(pool: &SqlitePool, doc_id: &str) -> Result<(), String> {
    let _guard = FILL_LOCK.lock().await;
    ensure_schema(pool).await?;
    purge_rows(pool, "doc_id", doc_id).await
}

/// Drop every chunk of a project, used when the project itself is removed.
pub async fn purge_project(pool: &SqlitePool, project_id: &str) -> Result<(), String> {
    let _guard = FILL_LOCK.lock().await;
    ensure_schema(pool).await?;
    purge_rows(pool, "project_id", project_id).await
}

async fn purge_rows(pool: &SqlitePool, column: &str, value: &str) -> Result<(), String> {
    let chunks = format!("SELECT id FROM knowledge_chunks WHERE {column} = ?");
    let fts = format!("DELETE FROM knowledge_chunks_fts WHERE id IN ({chunks})");
    let vectors = format!("DELETE FROM knowledge_vectors WHERE id IN ({chunks})");
    let rows = format!("DELETE FROM knowledge_chunks WHERE {column} = ?");
    for sql in [fts, vectors, rows] {
        sqlx::query(&sql)
            .bind(value)
            .execute(pool)
            .await
            .map_err(|error| format!("purge knowledge rows: {error}"))?;
    }
    Ok(())
}

/// Rank one project's chunks by BM25 and cosine, fused with RRF.
pub async fn search(
    pool: &SqlitePool,
    app: &AppHandle,
    query: &str,
    project_id: &str,
    limit: usize,
) -> Result<Vec<KnowledgeHit>, String> {
    ensure_schema(pool).await?;
    let limit = limit.clamp(1, 20);
    let expression = fts_query(query);
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let fts = if expression.is_empty() {
        Vec::new()
    } else {
        sqlx::query(
            "SELECT knowledge_chunks_fts.id AS id FROM knowledge_chunks_fts \
             JOIN knowledge_chunks ON knowledge_chunks.id = knowledge_chunks_fts.id \
             WHERE knowledge_chunks_fts MATCH ? AND knowledge_chunks.project_id = ? \
             ORDER BY bm25(knowledge_chunks_fts) LIMIT ?",
        )
        .bind(&expression)
        .bind(project_id)
        .bind(CANDIDATES as i64)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("knowledge fts search: {error}"))?
        .into_iter()
        .map(|row| row.get::<String, _>("id"))
        .collect()
    };

    let mut vectors: Vec<String> = Vec::new();
    if embed::available(app)
        && let Some(query_vector) = embed::try_embed_query(app, query)
    {
        let rows = sqlx::query(
            "SELECT knowledge_vectors.id AS id, knowledge_vectors.vector AS vector \
             FROM knowledge_vectors \
             JOIN knowledge_chunks ON knowledge_chunks.id = knowledge_vectors.id \
             WHERE knowledge_chunks.project_id = ?",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("knowledge vector search: {error}"))?;
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
    });
    ranked.truncate(limit);
    if ranked.is_empty() {
        return Ok(Vec::new());
    }

    let ids: Vec<String> = ranked.iter().map(|(id, _)| id.clone()).collect();
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!(
        "SELECT knowledge_chunks.id AS id, knowledge_chunks.doc_id AS doc_id, \
                knowledge_chunks.ord AS ord, knowledge_chunks.heading AS heading, \
                knowledge_chunks.text AS text, knowledge_docs.name AS name \
         FROM knowledge_chunks \
         JOIN knowledge_docs ON knowledge_docs.id = knowledge_chunks.doc_id \
         WHERE knowledge_chunks.id IN ({placeholders})"
    );
    let mut builder = sqlx::query(&sql);
    for id in &ids {
        builder = builder.bind(id);
    }
    let rows = builder
        .fetch_all(pool)
        .await
        .map_err(|error| format!("knowledge hit lookup: {error}"))?;
    let mut meta: HashMap<String, (String, String, i64, Option<String>, String)> = HashMap::new();
    for row in rows {
        meta.insert(
            row.get("id"),
            (
                row.get("doc_id"),
                row.get("name"),
                row.get("ord"),
                row.get("heading"),
                row.get("text"),
            ),
        );
    }
    Ok(ranked
        .into_iter()
        .filter_map(|(id, score)| {
            meta.remove(&id)
                .map(|(doc_id, name, ord, heading, text)| KnowledgeHit {
                    doc_id,
                    name,
                    ord,
                    heading,
                    text,
                    score,
                })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_start_a_chunk_and_are_kept() {
        let chunks = chunk_text("# Services\nHosted service.\n\n## Ongoing\nManaged monthly.\n");
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].0.as_deref(), Some("Services"));
        assert!(chunks[0].1.contains("Hosted service."));
        assert_eq!(chunks[1].0.as_deref(), Some("Ongoing"));
    }

    #[test]
    fn long_text_is_windowed_with_overlap() {
        let text = "x".repeat(CHUNK_CHARS * 2 + 10);
        let chunks = chunk_text(&text);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].1.chars().count(), CHUNK_CHARS);
        assert_eq!(chunks[1].1.chars().count(), CHUNK_CHARS);
    }

    #[test]
    fn short_documents_stay_one_chunk() {
        let chunks = chunk_text("Just one paragraph about billing.");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].0, None);
    }

    #[test]
    fn blank_documents_produce_no_chunks() {
        assert!(chunk_text("   \n\n\t\n").is_empty());
    }

    #[tokio::test]
    async fn search_is_scoped_to_one_project() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("memory db");
        ensure_schema(&pool).await.expect("schema");
        for (id, project, text) in [
            ("a0", "alpha", "Checkout uses the hosted payment page."),
            ("b0", "beta", "Checkout is disabled in beta."),
        ] {
            sqlx::query(
                "INSERT INTO knowledge_chunks (id, doc_id, project_id, ord, heading, text, hash) \
                 VALUES (?, 'doc', ?, 0, NULL, ?, '')",
            )
            .bind(id)
            .bind(project)
            .bind(text)
            .execute(&pool)
            .await
            .expect("chunk");
            sqlx::query("INSERT INTO knowledge_chunks_fts (id, text, heading) VALUES (?, ?, '')")
                .bind(id)
                .bind(text)
                .execute(&pool)
                .await
                .expect("fts");
        }
        let ids = sqlx::query_scalar::<_, String>(
            "SELECT knowledge_chunks_fts.id FROM knowledge_chunks_fts \
             JOIN knowledge_chunks ON knowledge_chunks.id = knowledge_chunks_fts.id \
             WHERE knowledge_chunks_fts MATCH ? AND knowledge_chunks.project_id = ?",
        )
        .bind(fts_query("checkout payment"))
        .bind("alpha")
        .fetch_all(&pool)
        .await
        .expect("search");
        assert_eq!(ids, vec!["a0".to_string()]);
    }

    #[tokio::test]
    async fn purging_a_document_removes_its_chunks_and_vectors() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("memory db");
        ensure_schema(&pool).await.expect("schema");
        sqlx::query(
            "INSERT INTO knowledge_chunks (id, doc_id, project_id, ord, heading, text, hash) \
             VALUES ('d1:0', 'd1', 'p1', 0, NULL, 'text', 'h')",
        )
        .execute(&pool)
        .await
        .expect("chunk");
        sqlx::query(
            "INSERT INTO knowledge_chunks_fts (id, text, heading) VALUES ('d1:0', 'text', '')",
        )
        .execute(&pool)
        .await
        .expect("fts");
        sqlx::query("INSERT INTO knowledge_vectors (id, hash, vector, dim) VALUES ('d1:0', 'h', x'00000000', 1)")
            .execute(&pool)
            .await
            .expect("vector");
        purge_doc(&pool, "d1").await.expect("purge");
        let chunks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM knowledge_chunks")
            .fetch_one(&pool)
            .await
            .expect("count chunks");
        let vectors: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM knowledge_vectors")
            .fetch_one(&pool)
            .await
            .expect("count vectors");
        assert_eq!(chunks, 0);
        assert_eq!(vectors, 0);
    }
}
