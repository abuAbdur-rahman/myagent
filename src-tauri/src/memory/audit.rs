//! One row per item injected into a turn, so recall can be explained later.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

/// Audit rows older than this are swept on the next write.
pub const RETENTION_DAYS: i64 = 30;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AuditItem {
    /// `durable`, `recalled`, `knowledge` or `episode`.
    pub source: String,
    pub item_id: String,
    pub label: String,
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub trust: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AuditWrite {
    pub conversation_id: String,
    pub turn_id: Option<String>,
    pub query: String,
    #[serde(default)]
    pub ms: Option<i64>,
    pub items: Vec<AuditItem>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuditRow {
    pub source: String,
    pub item_id: String,
    pub label: String,
    pub score: Option<f64>,
    pub trust: Option<String>,
    pub created_at: i64,
}

pub async fn ensure_schema(pool: &SqlitePool) -> Result<(), String> {
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS memory_retrieval_audit (
             id TEXT PRIMARY KEY,
             conversation_id TEXT NOT NULL,
             turn_id TEXT,
             query TEXT NOT NULL,
             note_id TEXT,
             source TEXT NOT NULL,
             label TEXT NOT NULL,
             bm25_rank INTEGER,
             vector_rank INTEGER,
             rrf REAL,
             recency REAL,
             trust TEXT,
             chosen INTEGER NOT NULL,
             jev_prob REAL,
             ms INTEGER,
             created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_memory_audit_created
             ON memory_retrieval_audit(created_at);",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("audit schema: {error}"))?;
    Ok(())
}

/// Write one turn's injected items and drop rows past the retention window.
pub async fn record(pool: &SqlitePool, write: &AuditWrite) -> Result<(), String> {
    ensure_schema(pool).await?;
    let now = chrono::Utc::now().timestamp_millis();
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("audit tx: {error}"))?;
    for item in &write.items {
        sqlx::query(
            "INSERT INTO memory_retrieval_audit \
             (id, conversation_id, turn_id, query, note_id, source, label, rrf, trust, chosen, ms, created_at) \
             VALUES (?,?,?,?,?,?,?,?,?,1,?,?)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&write.conversation_id)
        .bind(&write.turn_id)
        .bind(&write.query)
        .bind(&item.item_id)
        .bind(&item.source)
        .bind(&item.label)
        .bind(item.score)
        .bind(&item.trust)
        .bind(write.ms)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("audit insert: {error}"))?;
    }
    let cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    sqlx::query("DELETE FROM memory_retrieval_audit WHERE created_at < ?")
        .bind(cutoff)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("audit sweep: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("audit commit: {error}"))
}

/// The newest injected items, newest first.
pub async fn recent(pool: &SqlitePool, limit: usize) -> Result<Vec<AuditRow>, String> {
    ensure_schema(pool).await?;
    let rows = sqlx::query(
        "SELECT source, note_id, label, rrf, trust, created_at \
         FROM memory_retrieval_audit ORDER BY created_at DESC, rowid DESC LIMIT ?",
    )
    .bind(limit.clamp(1, 200) as i64)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("audit read: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| AuditRow {
            source: row.get("source"),
            item_id: row.get("note_id"),
            label: row.get("label"),
            score: row.get("rrf"),
            trust: row.get("trust"),
            created_at: row.get("created_at"),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rows_round_trip_and_sweep() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("memory db");
        ensure_schema(&pool).await.expect("schema");
        record(
            &pool,
            &AuditWrite {
                conversation_id: "c1".to_string(),
                turn_id: None,
                query: "billing".to_string(),
                ms: Some(4),
                items: vec![AuditItem {
                    source: "recalled".to_string(),
                    item_id: "n1".to_string(),
                    label: "CES uses Xero".to_string(),
                    score: Some(0.03),
                    trust: Some("trusted".to_string()),
                }],
            },
        )
        .await
        .expect("write");
        let rows = recent(&pool, 10).await.expect("read");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].item_id, "n1");
        assert_eq!(rows[0].source, "recalled");

        sqlx::query("UPDATE memory_retrieval_audit SET created_at = 0")
            .execute(&pool)
            .await
            .expect("age rows");
        record(
            &pool,
            &AuditWrite {
                conversation_id: "c1".to_string(),
                turn_id: None,
                query: "again".to_string(),
                ms: None,
                items: Vec::new(),
            },
        )
        .await
        .expect("sweep");
        assert!(recent(&pool, 10).await.expect("read").is_empty());
    }
}
