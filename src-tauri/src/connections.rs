use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

pub(crate) fn app_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("myagent.db"))
        .map_err(|e| e.to_string())
}

pub(crate) async fn ro_pool(app: &AppHandle) -> Result<sqlx::SqlitePool, String> {
    let path = app_db_path(app)?;
    let url = format!("sqlite:{}?mode=ro", path.to_string_lossy());
    sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|e| e.to_string())
}

pub async fn base_url_for(app: &AppHandle, connection_id: &str) -> AppResult<String> {
    let pool = ro_pool(app).await.map_err(AppError::Internal)?;
    base_url_from_pool(&pool, connection_id).await
}

async fn base_url_from_pool(pool: &sqlx::SqlitePool, connection_id: &str) -> AppResult<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT base_url FROM connections WHERE id = ?")
        .bind(connection_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    row.map(|(base_url,)| base_url)
        .filter(|base_url| !base_url.trim().is_empty())
        .ok_or_else(|| AppError::Internal(format!("unknown connection: {connection_id}")))
}

#[cfg(test)]
mod tests {
    use super::base_url_from_pool;

    async fn pool() -> sqlx::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory db");
        sqlx::query(
            "CREATE TABLE connections (id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, kind TEXT NOT NULL, default_model TEXT, created_at INTEGER NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("schema");
        pool
    }

    async fn insert(pool: &sqlx::SqlitePool, id: &str, base_url: &str) {
        sqlx::query("INSERT INTO connections (id, name, base_url, kind, default_model, created_at) VALUES (?, 'P', ?, 'openrouter', NULL, 1)")
            .bind(id)
            .bind(base_url)
            .execute(pool)
            .await
            .expect("insert");
    }

    #[tokio::test]
    async fn resolves_stored_base_url() {
        let pool = pool().await;
        insert(&pool, "c1", "https://openrouter.ai/api/v1").await;
        let url = base_url_from_pool(&pool, "c1").await.expect("lookup");
        assert_eq!(url, "https://openrouter.ai/api/v1");
    }

    #[tokio::test]
    async fn rejects_unknown_connection() {
        let pool = pool().await;
        assert!(base_url_from_pool(&pool, "missing").await.is_err());
    }

    #[tokio::test]
    async fn rejects_blank_base_url() {
        let pool = pool().await;
        insert(&pool, "c2", "   ").await;
        assert!(base_url_from_pool(&pool, "c2").await.is_err());
    }
}
