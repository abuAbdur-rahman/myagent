use std::path::Path;

use tauri::Manager;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct StorageUsage {
    pub db_bytes: u64,
    pub documents_bytes: u64,
    pub spill_bytes: u64,
    pub files: u64,
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn dir_usage(path: &Path) -> (u64, u64) {
    let mut bytes = 0;
    let mut files = 0;
    let Ok(entries) = std::fs::read_dir(path) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let child = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => {
                let (inner_bytes, inner_files) = dir_usage(&child);
                bytes += inner_bytes;
                files += inner_files;
            }
            Ok(_) => {
                bytes += file_len(&child);
                files += 1;
            }
            Err(error) => eprintln!("storage: cannot stat {}: {error}", child.display()),
        }
    }
    (bytes, files)
}

#[tauri::command]
pub fn storage_usage(app: tauri::AppHandle) -> Result<StorageUsage, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_bytes = file_len(&base.join("myagent.db")) + file_len(&base.join("myagent.db-wal"));
    let (documents_bytes, document_files) = dir_usage(&base.join("documents"));
    let (spill_bytes, spill_files) = dir_usage(&base.join("spill"));
    Ok(StorageUsage {
        db_bytes,
        documents_bytes,
        spill_bytes,
        files: document_files + spill_files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("myagent-storage-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    #[test]
    fn sizes_files_recursively() {
        let dir = scratch("recursive");
        std::fs::write(dir.join("a.bin"), [0u8; 10]).expect("write a");
        let nested = dir.join("nested");
        std::fs::create_dir_all(&nested).expect("create nested");
        std::fs::write(nested.join("b.bin"), [0u8; 25]).expect("write b");

        let (bytes, files) = dir_usage(&dir);
        assert_eq!(bytes, 35);
        assert_eq!(files, 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_directory_is_empty() {
        let (bytes, files) = dir_usage(&std::env::temp_dir().join("myagent-storage-absent"));
        assert_eq!(bytes, 0);
        assert_eq!(files, 0);
    }
}
