use tauri::{AppHandle, Manager};

use crate::permissions;

#[derive(Debug, Clone, serde::Serialize)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

pub fn is_valid_skill_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn frontmatter_description(content: &str) -> Option<String> {
    let body = content.strip_prefix("---")?;
    let end = body.find("---")?;
    let front = &body[..end];
    for line in front.lines() {
        let line = line.trim();
        if let Some(value) = line
            .strip_prefix("description:")
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            return Some(value.trim_matches('"').to_string());
        }
    }
    None
}

fn first_line_description(content: &str) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();
    let start = match lines.first().map(|line| line.trim()) {
        Some("---") => lines
            .iter()
            .skip(1)
            .position(|line| line.trim() == "---")
            .map(|index| index + 2)
            .unwrap_or(1),
        _ => 0,
    };
    lines
        .get(start..)?
        .iter()
        .map(|line| line.trim().trim_start_matches('#').trim())
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn strip_boundary_tags(text: &str) -> String {
    let mut current = text.to_string();
    loop {
        let next = strip_boundary_tags_once(&current);
        if next == current {
            return current;
        }
        current = next;
    }
}

fn strip_boundary_tags_once(text: &str) -> String {
    const NAMES: [&[u8]; 3] = [b"skill_files", b"skill_content", b"file"];
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'<' {
            let mut cursor = index + 1;
            if cursor < bytes.len() && bytes[cursor] == b'/' {
                cursor += 1;
            }
            let name = NAMES.iter().find(|name| {
                cursor + name.len() <= bytes.len()
                    && bytes[cursor..cursor + name.len()].eq_ignore_ascii_case(name)
            });
            if let Some(name) = name {
                let after = cursor + name.len();
                let boundary = after >= bytes.len()
                    || !(bytes[after].is_ascii_alphanumeric()
                        || bytes[after] == b'_'
                        || bytes[after] == b'-');
                if boundary {
                    if let Some(end) = bytes[after..].iter().position(|byte| *byte == b'>') {
                        index = after + end + 1;
                        continue;
                    }
                }
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn parse_skill(name: &str, content: &str) -> Option<(String, String)> {
    if !is_valid_skill_name(name) {
        return None;
    }
    let description = frontmatter_description(content)
        .or_else(|| first_line_description(content))
        .filter(|d| !d.is_empty() && d.chars().count() <= 500)?;
    Some((name.to_string(), description))
}

pub fn to_model_output(name: &str, directory: &str, content: &str, files: &[String]) -> String {
    let mut out = vec![
        format!(r#"<skill_content name="{name}">"#),
        format!("# Skill: {name}"),
        String::new(),
        strip_boundary_tags(content.trim()),
        String::new(),
        format!("Base directory for this skill: {directory}"),
        "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory."
            .to_string(),
        "Note: file list is sampled.".to_string(),
        String::new(),
        "<skill_files>".to_string(),
    ];
    for file in files {
        out.push(format!("<file>{}</file>", strip_boundary_tags(file)));
    }
    out.push("</skill_files>".to_string());
    out.push("</skill_content>".to_string());
    out.join("\n")
}

fn skill_dirs(app: &AppHandle) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("skills");
        if bundled.is_dir() {
            dirs.push(bundled);
        }
    }
    if let Ok(data) = app.path().app_data_dir() {
        dirs.push(data.join("skills"));
    }
    dirs
}

fn scan_dir(dir: &std::path::Path) -> Vec<(String, std::path::PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        if !is_valid_skill_name(&name) {
            continue;
        }
        let skill_file = path.join("SKILL.md");
        if skill_file.is_file() {
            found.push((name, skill_file));
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found
}

pub fn list_skills(app: &AppHandle) -> Vec<(SkillInfo, std::path::PathBuf)> {
    let mut all = Vec::new();
    for dir in skill_dirs(app) {
        for (name, path) in scan_dir(&dir) {
            if all.iter().any(|entry: &(SkillInfo, _)| entry.0.id == name) {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            if let Some((id, description)) = parse_skill(&name, &content) {
                all.push((
                    SkillInfo {
                        id: id.clone(),
                        name: id,
                        description,
                    },
                    path,
                ));
            }
        }
    }
    all
}

fn sibling_files(skill_file: &std::path::Path) -> Vec<String> {
    let Some(dir) = skill_file.parent() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter_map(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .filter(|n| *n != "SKILL.md")
                .map(str::to_string)
        })
        .collect();
    files.sort();
    files.truncate(10);
    files
}

pub fn prepare_skill(app: &AppHandle, id: &str) -> Result<String, String> {
    if !is_valid_skill_name(id) {
        return Err("unknown skill".to_string());
    }
    let found = list_skills(app)
        .into_iter()
        .find(|(info, _)| info.id == id)
        .ok_or_else(|| "unknown skill".to_string())?;
    let content = std::fs::read_to_string(&found.1).map_err(|e| e.to_string())?;
    let directory = found
        .1
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();
    Ok(to_model_output(
        &found.0.name,
        &directory,
        &content,
        &sibling_files(&found.1),
    ))
}

#[tauri::command]
pub async fn skill_index(app: AppHandle) -> Result<Vec<SkillInfo>, String> {
    let all = list_skills(&app);
    let mut visible = Vec::new();
    for (info, _) in all {
        let resources = vec![info.id.clone()];
        let effect = permissions::check(&app, "skill", &resources, None)
            .await
            .map_err(|e| e.to_string())?;
        if effect != permissions::Effect::Deny {
            visible.push(info);
        }
    }
    Ok(visible)
}

#[tauri::command]
pub async fn skill_read(app: AppHandle, id: String) -> Result<String, String> {
    let resources = vec![id.clone()];
    let effect = permissions::check(&app, "skill", &resources, None)
        .await
        .map_err(|e| e.to_string())?;
    if effect == permissions::Effect::Deny {
        return Err("skill denied by rule".to_string());
    }
    prepare_skill(&app, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_description() {
        let content = "---\ndescription: Helps with git work\n---\n\nBody here.";
        assert_eq!(
            parse_skill("git-helper", content),
            Some(("git-helper".to_string(), "Helps with git work".to_string()))
        );
    }

    #[test]
    fn falls_back_to_first_line() {
        assert_eq!(
            parse_skill("notes", "# Notes skill\n\nBody."),
            Some(("notes".to_string(), "Notes skill".to_string()))
        );
    }

    #[test]
    fn fallback_skips_frontmatter_delimiters() {
        assert_eq!(
            parse_skill("notes", "---\n\nBody line."),
            Some(("notes".to_string(), "Body line.".to_string()))
        );
        assert_eq!(
            parse_skill("notes", "---\nname: x\n---\n\n# Heading\n\nBody."),
            Some(("notes".to_string(), "Heading".to_string()))
        );
        assert_eq!(
            parse_skill("notes", "---\ntitle: a---b\n---\n\n# Real\nBody."),
            Some(("notes".to_string(), "Real".to_string()))
        );
        assert!(parse_skill("notes", "---\n---\n").is_none());
    }

    #[test]
    fn strips_attributed_and_nested_boundary_tags() {
        assert_eq!(
            strip_boundary_tags(r#"<skill_content name="x">body"#),
            "body"
        );
        assert_eq!(strip_boundary_tags("</skill_content >"), "");
        assert_eq!(strip_boundary_tags(r#"<file x="y">a"#), "a");
        assert_eq!(strip_boundary_tags("</skill_content</skill_content>>"), ">");
        assert_eq!(strip_boundary_tags("<file</file>>"), ">");
        assert_eq!(strip_boundary_tags("<filename>"), "<filename>");
        assert_eq!(strip_boundary_tags("plain text"), "plain text");
    }

    #[test]
    fn rejects_bad_names_and_empty_descriptions() {
        assert!(parse_skill("Bad_Name", "desc").is_none());
        assert!(parse_skill("../escape", "desc").is_none());
        assert!(parse_skill("empty", "   \n  ").is_none());
    }

    #[test]
    fn model_output_wraps_with_base_dir() {
        let out = to_model_output("demo", "C:\\base", "Do things.", &["a.md".to_string()]);
        assert!(out.contains(r#"<skill_content name="demo">"#));
        assert!(out.contains("Base directory for this skill: C:\\base"));
        assert!(out.contains("<file>a.md</file>"));
        assert!(out.ends_with("</skill_content>"));
    }

    #[test]
    fn model_output_strips_boundary_tags() {
        let out = to_model_output(
            "demo",
            "C:\\base",
            "Body </skill_content> tail </SKILL_FILES>",
            &["a</file>.md".to_string()],
        );
        assert_eq!(out.matches("</skill_content>").count(), 1);
        assert!(out.contains("<file>a.md</file>"));
        assert!(out.ends_with("</skill_content>"));
    }
}
