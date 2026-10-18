use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::extract::{self, ExtractFailure};
use crate::tools::safe_segment;

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DocumentRef {
    pub name: String,
    pub mime: String,
    pub sha256: String,
}

#[derive(Debug, Serialize)]
pub struct IngestedDocument {
    pub sha256: String,
    pub path: String,
    pub chars: usize,
}

fn failed(error: impl std::fmt::Display) -> ExtractFailure {
    ExtractFailure::new("failed", error.to_string())
}

fn valid_sha(sha: &str) -> bool {
    sha.len() == 64 && sha.chars().all(|char| char.is_ascii_hexdigit())
}

fn dedupe(shas: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    shas.into_iter()
        .filter(|sha| seen.insert(sha.clone()))
        .collect()
}

fn documents_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("documents"))
}

fn document_path(app: &AppHandle, sha256: &str) -> Result<std::path::PathBuf, String> {
    if !valid_sha(sha256) {
        return Err("invalid document hash".to_string());
    }
    Ok(documents_dir(app)?.join(format!("{sha256}.txt")))
}

fn knowledge_path(
    app: &AppHandle,
    project_id: &str,
    sha256: &str,
) -> Result<std::path::PathBuf, String> {
    let project = safe_segment(project_id);
    if project.is_empty() || !valid_sha(sha256) {
        return Err("invalid project id or document hash".to_string());
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("knowledge")
        .join(project)
        .join(format!("{sha256}.txt")))
}

pub fn read_text(
    app: &AppHandle,
    sha256: &str,
    legacy_project: Option<&str>,
) -> Result<String, String> {
    let path = document_path(app, sha256)?;
    let path = if path.exists() {
        path
    } else if let Some(project) = legacy_project {
        let legacy = knowledge_path(app, project, sha256)?;
        if legacy.exists() {
            legacy
        } else {
            return Err("document text is missing".to_string());
        }
    } else {
        return Err("document text is missing".to_string());
    };
    let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.len() > MAX_TEXT_BYTES {
        return Err(format!(
            "{}: document exceeds {MAX_TEXT_BYTES} bytes",
            path.display()
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub async fn attachment_ingest(
    app: AppHandle,
    name: String,
    mime: String,
    data: String,
    sha256: String,
) -> Result<IngestedDocument, ExtractFailure> {
    if !valid_sha(&sha256) {
        return Err(ExtractFailure::new("bad_payload", "invalid document hash"));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| ExtractFailure::new("bad_payload", "attachment bytes could not be decoded"))?;

    let text = tauri::async_runtime::spawn_blocking(move || {
        extract::extract_guarded(&name, &mime, &bytes)
    })
    .await
    .map_err(|_| ExtractFailure::new("crashed", "this document could not be read safely"))??;

    if text.len() as u64 > MAX_TEXT_BYTES {
        return Err(ExtractFailure::new(
            "too_large",
            format!("extracted text exceeds {MAX_TEXT_BYTES} bytes"),
        ));
    }

    let path = document_path(&app, &sha256).map_err(failed)?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| failed(format!("{}: {e}", parent.display())))?;
        }
        std::fs::write(&path, &text).map_err(|e| failed(format!("{}: {e}", path.display())))?;
    }

    Ok(IngestedDocument {
        sha256,
        path: path.to_string_lossy().into_owned(),
        chars: text.chars().count(),
    })
}

#[tauri::command]
pub async fn document_read(
    app: AppHandle,
    sha256: String,
    project_id: Option<String>,
) -> Result<String, ExtractFailure> {
    read_text(&app, &sha256, project_id.as_deref()).map_err(failed)
}

#[tauri::command]
pub async fn documents_wipe_unreferenced(
    app: AppHandle,
    shas: Vec<String>,
) -> Result<usize, ExtractFailure> {
    let pool = crate::tools::memory_pool(&app).await.map_err(failed)?;
    let mut removed = 0usize;
    for sha in dedupe(shas) {
        if !valid_sha(&sha) {
            continue;
        }
        let referenced: Option<(i64,)> = sqlx::query_as(
            "SELECT 1 FROM chat_docs WHERE sha256 = ?1
             UNION ALL
             SELECT 1 FROM knowledge_docs WHERE sha256 = ?1
             LIMIT 1",
        )
        .bind(&sha)
        .fetch_optional(&pool)
        .await
        .map_err(failed)?;
        if referenced.is_some() {
            continue;
        }
        let path = document_path(&app, &sha).map_err(failed)?;
        match std::fs::remove_file(&path) {
            Ok(()) => removed += 1,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(failed(format!("{}: {error}", path.display()))),
        }
    }
    Ok(removed)
}

#[tauri::command]
pub async fn documents_wipe_all(app: AppHandle) -> Result<(), ExtractFailure> {
    let dir = documents_dir(&app).map_err(failed)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| failed(format!("{}: {e}", dir.display())))?;
    }
    Ok(())
}

pub async fn conversation_documents(
    app: &AppHandle,
    conversation: &str,
) -> AppResult<Vec<DocumentRef>> {
    let pool = crate::tools::memory_pool(app).await?;
    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT name, mime, sha256 FROM chat_docs WHERE conversation_id = ?1
         UNION
         SELECT k.name, k.mime, k.sha256 FROM knowledge_docs k
         WHERE k.project_id = (SELECT project_id FROM conversations WHERE id = ?1)",
    )
    .bind(conversation)
    .fetch_all(&pool)
    .await
    .map_err(|e| AppError::Internal(format!("conversation documents: {e}")))?;
    Ok(rows
        .into_iter()
        .map(|(name, mime, sha256)| DocumentRef { name, mime, sha256 })
        .collect())
}

pub async fn conversation_project(app: &AppHandle, conversation: &str) -> Option<String> {
    let pool = crate::tools::memory_pool(app).await.ok()?;
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT project_id FROM conversations WHERE id = ?1")
            .bind(conversation)
            .fetch_optional(&pool)
            .await
            .ok()?;
    row.and_then(|value| value.0)
}

pub fn match_document<'a>(documents: &'a [DocumentRef], query: &str) -> Option<&'a DocumentRef> {
    let needle = query.trim();
    if needle.is_empty() {
        return None;
    }
    let lowered = needle.to_ascii_lowercase();
    documents
        .iter()
        .find(|doc| doc.sha256 == needle)
        .or_else(|| {
            documents
                .iter()
                .find(|doc| doc.name.eq_ignore_ascii_case(needle))
        })
        .or_else(|| {
            documents
                .iter()
                .find(|doc| doc.name.to_ascii_lowercase().contains(&lowered))
        })
        .or_else(|| {
            documents
                .iter()
                .find(|doc| doc.sha256.starts_with(&lowered))
        })
}

pub fn document_index(documents: &[DocumentRef]) -> String {
    documents
        .iter()
        .map(|doc| format!("{} ({})", doc.name, doc.mime))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn docs() -> Vec<DocumentRef> {
        vec![
            DocumentRef {
                name: "report.pdf".to_string(),
                mime: "application/pdf".to_string(),
                sha256: "a".repeat(64),
            },
            DocumentRef {
                name: "Budget.XLSX".to_string(),
                mime: "application/vnd.ms-excel".to_string(),
                sha256: "b".repeat(64),
            },
        ]
    }

    #[test]
    fn accepts_only_sixty_four_hex_characters() {
        assert!(valid_sha(&"a".repeat(64)));
        assert!(valid_sha(&"0123456789abcdef".repeat(4)));
        assert!(!valid_sha(""));
        assert!(!valid_sha(&"a".repeat(63)));
        assert!(!valid_sha(&"g".repeat(64)));
        assert!(!valid_sha("../../etc/passwd"));
    }

    #[test]
    fn dedupes_repeated_hashes() {
        let shas = vec!["one".to_string(), "two".to_string(), "one".to_string()];
        assert_eq!(dedupe(shas), vec!["one".to_string(), "two".to_string()]);
    }

    #[test]
    fn matches_by_exact_name_hash_prefix_and_case() {
        let documents = docs();
        assert_eq!(
            match_document(&documents, "report.pdf").map(|doc| doc.name.as_str()),
            Some("report.pdf")
        );
        assert_eq!(
            match_document(&documents, "budget.xlsx").map(|doc| doc.name.as_str()),
            Some("Budget.XLSX")
        );
        assert_eq!(
            match_document(&documents, &"a".repeat(64)).map(|doc| doc.name.as_str()),
            Some("report.pdf")
        );
        assert_eq!(
            match_document(&documents, &"b".repeat(8)).map(|doc| doc.name.as_str()),
            Some("Budget.XLSX")
        );
    }

    #[test]
    fn matches_a_partial_name_and_refuses_an_unknown_one() {
        let documents = docs();
        assert_eq!(
            match_document(&documents, "report").map(|doc| doc.name.as_str()),
            Some("report.pdf")
        );
        assert!(match_document(&documents, "missing.txt").is_none());
        assert!(match_document(&documents, "   ").is_none());
    }

    #[test]
    fn lists_documents_for_the_tool_description() {
        assert_eq!(
            document_index(&docs()),
            "report.pdf (application/pdf), Budget.XLSX (application/vnd.ms-excel)"
        );
        assert_eq!(document_index(&[]), "");
    }
}
