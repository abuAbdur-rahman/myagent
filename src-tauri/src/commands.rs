use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileCommand {
    pub name: String,
    pub description: String,
    pub body: String,
}

pub fn is_valid_command_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub fn parse_command(name: &str, content: &str) -> Option<(String, String)> {
    if !is_valid_command_name(name) {
        return None;
    }
    let mut lines = content.lines();
    let description = lines
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('#')
        .trim()
        .to_string();
    if description.is_empty() {
        return None;
    }
    let body: String = lines.collect::<Vec<_>>().join("\n").trim().to_string();
    if body.is_empty() {
        return None;
    }
    Some((description, body))
}

fn command_dirs(app: &AppHandle, project_id: Option<&str>) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("commands");
        if bundled.is_dir() {
            dirs.push(bundled);
        }
    }
    if let Ok(data) = app.path().app_data_dir() {
        dirs.push(data.join("commands"));
        if let Some(project) = project_id {
            let safe: String = project
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .take(64)
                .collect();
            if !safe.is_empty() {
                dirs.push(data.join("commands").join(safe));
            }
        }
    }
    dirs
}

fn scan_dir(dir: &std::path::Path) -> Vec<(String, String)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        found.push((name, content));
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found
}

pub fn list_commands(app: &AppHandle, project_id: Option<&str>) -> Vec<FileCommand> {
    let mut all: Vec<FileCommand> = Vec::new();
    for dir in command_dirs(app, project_id) {
        for (name, content) in scan_dir(&dir) {
            if all.iter().any(|c| c.name == name) {
                continue;
            }
            if let Some((description, body)) = parse_command(&name, &content) {
                all.push(FileCommand {
                    name,
                    description,
                    body,
                });
            }
        }
    }
    all
}

#[tauri::command]
pub async fn list_commands_cmd(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<Vec<FileCommand>, String> {
    Ok(list_commands(&app, project_id.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_description_and_body() {
        let parsed = parse_command("deploy", "Ship it\nRun `./ship $ARGUMENTS`.").expect("parsed");
        assert_eq!(parsed.0, "Ship it");
        assert!(parsed.1.contains("$ARGUMENTS"));
    }

    #[test]
    fn rejects_bad_stems_and_empty_parts() {
        assert!(parse_command("Bad_Name", "Desc\nBody").is_none());
        assert!(parse_command("ok", "").is_none());
        assert!(parse_command("ok", "Only description").is_none());
    }

    #[test]
    fn missing_dir_lists_nothing() {
        assert!(scan_dir(std::path::Path::new("Z:\\definitely\\not\\here")).is_empty());
    }
}
