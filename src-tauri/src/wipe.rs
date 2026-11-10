use std::path::Path;

use tauri::{AppHandle, Manager};

pub const STORES: &[&str] = &["spill", "documents", "knowledge", "memory"];

pub fn wipe_stores(root: &Path) -> Result<usize, String> {
    let mut removed = 0;
    for name in STORES {
        let dir = root.join(name);
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => removed += 1,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("{}: {error}", dir.display())),
        }
    }
    Ok(removed)
}

#[tauri::command]
pub fn wipe_app_files(app: AppHandle) -> Result<usize, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    wipe_stores(&root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delete_everything_removes_every_store_and_nothing_else() {
        let root = std::env::temp_dir().join(format!("myagent-wipe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("spill/chat-1")).expect("spill dir");
        std::fs::create_dir_all(root.join("documents")).expect("documents dir");
        std::fs::create_dir_all(root.join("knowledge/project-1")).expect("knowledge dir");
        std::fs::create_dir_all(root.join("memory/projects")).expect("memory dir");
        std::fs::write(root.join("spill/chat-1/tool.txt"), b"spill").expect("spill file");
        std::fs::write(root.join("documents/abc.txt"), b"doc").expect("doc file");
        std::fs::write(root.join("knowledge/project-1/chunk.bin"), b"chunk").expect("chunk");
        std::fs::write(root.join("memory/MEMORY.md"), b"- a note").expect("memory file");
        std::fs::write(root.join("unrelated.txt"), b"keep").expect("unrelated file");

        let removed = wipe_stores(&root).expect("wipe");
        assert_eq!(removed, 4);
        for name in STORES {
            assert!(!root.join(name).exists(), "{name} should be gone");
        }
        assert!(root.join("unrelated.txt").exists());
        assert_eq!(wipe_stores(&root).expect("second wipe"), 0);

        std::fs::remove_dir_all(&root).expect("cleanup");
    }
}
