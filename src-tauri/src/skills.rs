use tauri::{AppHandle, Manager};

use crate::permissions;

#[derive(Debug, Clone, serde::Serialize)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub title: String,
    pub version: String,
    pub summary: String,
    pub description: String,
    pub source: String,
    pub enabled: bool,
    pub directory: String,
    pub triggers: Vec<String>,
    pub requires_tools: Vec<String>,
    pub requires_python: Vec<String>,
    pub requires_node: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct SkillDraft {
    pub id: String,
    pub title: String,
    pub version: String,
    pub summary: String,
    pub triggers: Vec<String>,
    pub requires_tools: Vec<String>,
    pub requires_python: Vec<String>,
    pub requires_node: Vec<String>,
    pub body: String,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct DoctorResult {
    pub skill: String,
    pub ok: bool,
    pub missing: Vec<String>,
    pub failed_tests: Vec<String>,
    pub versions: std::collections::BTreeMap<String, String>,
    pub detail: Option<String>,
}

#[derive(Debug, Default, PartialEq)]
pub struct SkillMeta {
    pub id: Option<String>,
    pub title: Option<String>,
    pub version: Option<String>,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub triggers: Vec<String>,
    pub requires_tools: Vec<String>,
    pub requires_python: Vec<String>,
    pub requires_node: Vec<String>,
    pub network: Option<String>,
    pub writes: Vec<String>,
}

pub fn is_valid_skill_name(name: &str) -> bool {
    const RESERVED: &[&str] = &[
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    !name.is_empty()
        && name.len() <= 64
        && !RESERVED.contains(&name)
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_reparse_meta(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn frontmatter_block(content: &str) -> Option<&str> {
    let body = content.strip_prefix("---")?;
    let body = body
        .strip_prefix("\r\n")
        .or_else(|| body.strip_prefix('\n'))?;
    let mut offset = 0;
    for line in body.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']).trim() == "---" {
            return Some(&body[..offset]);
        }
        offset += line.len();
    }
    None
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    let value = value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
        .unwrap_or(value);
    value.trim().to_string()
}

fn inline_list(value: &str) -> Vec<String> {
    let value = value.trim();
    let inner = value
        .strip_prefix('[')
        .and_then(|v| v.strip_suffix(']'))
        .unwrap_or(value);
    inner
        .split(',')
        .map(unquote)
        .filter(|item| !item.is_empty())
        .collect()
}

fn push_list(out: &mut Vec<String>, raw: &str) {
    for item in inline_list(raw) {
        if !out.contains(&item) {
            out.push(item);
        }
    }
}

fn apply_scalar(meta: &mut SkillMeta, key: &str, value: &str) {
    let value = unquote(value);
    match key {
        "id" | "name" => meta.id = Some(value),
        "title" => meta.title = Some(value),
        "version" => meta.version = Some(value),
        "summary" => meta.summary = Some(value),
        "description" => meta.description = Some(value),
        "triggers" => push_list(&mut meta.triggers, value.as_str()),
        "requires_tools" => push_list(&mut meta.requires_tools, value.as_str()),
        "writes" => push_list(&mut meta.writes, value.as_str()),
        "requires_imports" => apply_flow_imports(meta, value.as_str()),
        "network" => meta.network = Some(value),
        _ => {}
    }
}

fn apply_flow_imports(meta: &mut SkillMeta, value: &str) {
    let Some(inner) = value.trim().strip_prefix('{') else {
        return;
    };
    let inner = inner.strip_suffix('}').unwrap_or(inner);
    let mut depth = 0;
    let mut current = String::new();
    let mut parts = Vec::new();
    for ch in inner.chars() {
        match ch {
            '[' | '{' => depth += 1,
            ']' | '}' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(current.trim().to_string());
                current.clear();
                continue;
            }
            _ => {}
        }
        current.push(ch);
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    for part in parts {
        let Some((key, list)) = part.split_once(':') else {
            continue;
        };
        let target = match key.trim() {
            "python" => &mut meta.requires_python,
            "node" => &mut meta.requires_node,
            _ => continue,
        };
        for item in inline_list(list.trim()) {
            if !target.contains(&item) {
                target.push(item);
            }
        }
    }
}

fn apply_list_item(meta: &mut SkillMeta, key: &str, item: &str) {
    let item = unquote(item);
    if item.is_empty() {
        return;
    }
    let target = match key {
        "triggers" => &mut meta.triggers,
        "requires_tools" => &mut meta.requires_tools,
        "writes" => &mut meta.writes,
        "requires_imports.python" => &mut meta.requires_python,
        "requires_imports.node" => &mut meta.requires_node,
        _ => return,
    };
    if !target.contains(&item) {
        target.push(item);
    }
}

pub fn parse_meta(content: &str) -> SkillMeta {
    let mut meta = SkillMeta::default();
    let Some(front) = frontmatter_block(content) else {
        return meta;
    };
    let mut key = String::new();
    let mut nested = String::new();
    let mut sub = String::new();
    for line in front.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        if let Some(item) = trimmed.strip_prefix("- ") {
            let full = if nested.is_empty() {
                key.clone()
            } else {
                format!("{nested}.{sub}")
            };
            apply_list_item(&mut meta, &full, item);
            continue;
        }
        let Some((raw_key, raw_value)) = trimmed.split_once(':') else {
            continue;
        };
        let raw_key = raw_key.trim();
        if indent == 0 {
            key = raw_key.to_string();
            nested.clear();
            sub.clear();
            apply_scalar(&mut meta, key.as_str(), raw_value);
            continue;
        }
        if key == "requires_imports" {
            nested = key.clone();
            sub = raw_key.to_string();
            let list = raw_value.trim();
            if list.starts_with('[') {
                let target = if raw_key == "python" {
                    &mut meta.requires_python
                } else if raw_key == "node" {
                    &mut meta.requires_node
                } else {
                    continue;
                };
                for item in inline_list(list) {
                    if !target.contains(&item) {
                        target.push(item);
                    }
                }
            }
            continue;
        }
        apply_scalar(&mut meta, raw_key, raw_value);
    }
    meta
}

fn frontmatter_description(content: &str) -> Option<String> {
    let meta = parse_meta(content);
    meta.summary.or(meta.description)
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

const MAX_STRIP_PASSES: usize = 8;
const BOUNDARY_NAMES: [&[u8]; 3] = [b"skill_files", b"skill_content", b"file"];

const NO_GT: usize = usize::MAX;

fn next_gt_offsets(bytes: &[u8]) -> Vec<usize> {
    let mut next: Vec<usize> = vec![NO_GT; bytes.len()];
    let mut seen = NO_GT;
    for index in (0..bytes.len()).rev() {
        if bytes[index] == b'>' {
            seen = index;
        }
        next[index] = seen;
    }
    next
}

fn first_char(bytes: &[u8], index: usize) -> Option<char> {
    let width = match *bytes.get(index)? {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        _ => return None,
    };
    std::str::from_utf8(bytes.get(index..index + width)?)
        .ok()?
        .chars()
        .next()
}

fn is_tag_boundary(bytes: &[u8], index: usize) -> bool {
    match bytes.get(index) {
        Some(&b'>') | Some(&b'/') => true,
        Some(_) => {
            first_char(bytes, index).is_some_and(|ch| ch == '\u{feff}' || ch.is_whitespace())
        }
        None => false,
    }
}

fn is_tag_boundary_or_end(bytes: &[u8], index: usize) -> bool {
    index >= bytes.len() || (bytes.get(index) != Some(&b'>') && is_tag_boundary(bytes, index))
}

fn boundary_name_at(bytes: &[u8], cursor: usize) -> Option<usize> {
    BOUNDARY_NAMES.iter().find_map(|name| {
        let end = cursor + name.len();
        (end <= bytes.len() && bytes[cursor..end].eq_ignore_ascii_case(name)).then_some(end)
    })
}

fn match_boundary_prefix(bytes: &[u8], index: usize) -> bool {
    if bytes.get(index) != Some(&b'<') {
        return false;
    }
    let mut cursor = index + 1;
    if bytes.get(cursor) == Some(&b'/') {
        cursor += 1;
    }
    boundary_name_at(bytes, cursor).is_some_and(|end| is_tag_boundary_or_end(bytes, end))
}

fn match_boundary_tag(bytes: &[u8], next_gt: &[usize], index: usize) -> Option<usize> {
    if *bytes.get(index)? != b'<' {
        return None;
    }
    let mut cursor = index + 1;
    if bytes.get(cursor) == Some(&b'/') {
        cursor += 1;
    }
    let after = boundary_name_at(bytes, cursor)?;
    if !is_tag_boundary(bytes, after) {
        return None;
    }
    let end = next_gt[after];
    if end == NO_GT {
        return None;
    }
    Some(end + 1)
}

fn strip_boundary_tags(text: &str) -> String {
    let mut current = text.to_string();
    for _ in 0..MAX_STRIP_PASSES {
        let next = strip_boundary_tags_once(&current);
        if next == current {
            return current;
        }
        current = next;
    }
    neutralize_boundary_tags(&current)
}

fn strip_boundary_tags_once(text: &str) -> String {
    let bytes = text.as_bytes();
    let next_gt = next_gt_offsets(bytes);
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if let Some(end) = match_boundary_tag(bytes, &next_gt, index) {
            index = end;
            continue;
        }
        if match_boundary_prefix(bytes, index) {
            out.extend_from_slice(b"&lt;");
            index += 1;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(out).expect("boundary scan preserves UTF-8")
}

fn neutralize_boundary_tags(text: &str) -> String {
    let bytes = text.as_bytes();
    let next_gt = next_gt_offsets(bytes);
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if let Some(end) = match_boundary_tag(bytes, &next_gt, index) {
            out.extend_from_slice(b"&lt;");
            for byte in &bytes[index + 1..end] {
                if *byte == b'<' {
                    out.extend_from_slice(b"&lt;");
                } else {
                    out.push(*byte);
                }
            }
            index = end;
            continue;
        }
        if match_boundary_prefix(bytes, index) {
            out.extend_from_slice(b"&lt;");
            index += 1;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(out).expect("boundary scan preserves UTF-8")
}

pub fn parse_skill(name: &str, content: &str) -> Option<(String, String)> {
    if !is_valid_skill_name(name) {
        return None;
    }
    let description = frontmatter_description(content)
        .or_else(|| first_line_description(content))
        .filter(|d| !d.is_empty())?;
    let description: String = description.chars().take(500).collect();
    Some((name.to_string(), description))
}

const MAX_SKILL_BODY_CHARS: usize = 24_000;

pub fn cap_skill_body(content: &str) -> String {
    let total = content.chars().count();
    if total <= MAX_SKILL_BODY_CHARS {
        return content.to_string();
    }
    let kept: String = content.chars().take(MAX_SKILL_BODY_CHARS).collect();
    format!(
        "{kept}\n\n[truncated: skill body is {total} chars; showing the first {MAX_SKILL_BODY_CHARS}. Read the file for the rest.]"
    )
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

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct SkillState {
    #[serde(default)]
    disabled: Vec<String>,
}

fn state_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("skills.json"))
}

fn state_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

fn load_state(app: &AppHandle) -> SkillState {
    let Some(path) = state_path(app) else {
        return SkillState::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(state) => state,
            Err(error) => {
                eprintln!("skills: cannot parse state, keeping skills enabled: {error}");
                SkillState::default()
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SkillState::default(),
        Err(error) => {
            eprintln!("skills: cannot read state: {error}");
            SkillState::default()
        }
    }
}

fn save_state(app: &AppHandle, state: &SkillState) -> Result<(), String> {
    let path = state_path(app).ok_or("app data directory unavailable")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, &path).map_err(|e| e.to_string())
}

fn skill_dirs(app: &AppHandle) -> Vec<(std::path::PathBuf, &'static str)> {
    let mut dirs = Vec::new();
    if let Ok(data) = app.path().app_data_dir() {
        dirs.push((data.join("skills"), "user"));
    }
    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("skills");
        if bundled.is_dir() {
            dirs.push((bundled, "builtin"));
        }
    }
    #[cfg(debug_assertions)]
    {
        let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("skills");
        if dev.is_dir() && !dirs.iter().any(|(dir, _)| dir == &dev) {
            dirs.push((dev, "builtin"));
        }
    }
    dirs
}

pub fn sandbox_mounts(app: &AppHandle) -> Vec<(std::path::PathBuf, String)> {
    let mut mounts = Vec::new();
    for (dir, source) in skill_dirs(app) {
        if !dir.is_dir() {
            continue;
        }
        let target = if source == "user" {
            "/opt/skills-user:ro"
        } else {
            "/opt/skills:ro"
        };
        if mounts.iter().any(|(_, existing)| existing == target) {
            continue;
        }
        mounts.push((dir, target.to_string()));
    }
    mounts
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
    let disabled = load_state(app).disabled;
    let mut all: Vec<(SkillInfo, std::path::PathBuf)> = Vec::new();
    for (dir, source) in skill_dirs(app) {
        for (name, path) in scan_dir(&dir) {
            if all.iter().any(|entry| entry.0.id == name) {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Some((id, description)) = parse_skill(&name, &content) else {
                continue;
            };
            let meta = parse_meta(&content);
            let title = meta.title.clone().unwrap_or_else(|| id.clone());
            let summary = meta.summary.clone().unwrap_or_else(|| description.clone());
            let version = meta.version.clone().unwrap_or_else(|| "0.0.0".to_string());
            let directory = path
                .parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default();
            all.push((
                SkillInfo {
                    id: id.clone(),
                    name: id.clone(),
                    title,
                    version,
                    summary: summary.clone(),
                    description,
                    source: source.to_string(),
                    enabled: !disabled.iter().any(|item| item == &id),
                    directory,
                    triggers: meta.triggers,
                    requires_tools: meta.requires_tools,
                    requires_python: meta.requires_python,
                    requires_node: meta.requires_node,
                },
                path,
            ));
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

fn unknown_skill(id: &str, skills: &[(SkillInfo, std::path::PathBuf)]) -> String {
    let available: Vec<&str> = skills
        .iter()
        .filter(|(info, _)| info.enabled)
        .map(|(info, _)| info.id.as_str())
        .collect();
    if available.is_empty() {
        format!("unknown skill: {id}; no enabled skills are available")
    } else {
        format!("unknown skill: {id}; available: {}", available.join(", "))
    }
}

pub fn prepare_skill(app: &AppHandle, id: &str) -> Result<String, String> {
    if !is_valid_skill_name(id) {
        return Err(format!("unknown skill: {id}"));
    }
    let all = list_skills(app);
    let Some(found) = all.iter().find(|(info, _)| info.id == id) else {
        return Err(unknown_skill(id, &all));
    };
    if !found.0.enabled {
        return Err("skill is disabled".to_string());
    }
    let content = std::fs::read_to_string(&found.1).map_err(|e| e.to_string())?;
    let content = cap_skill_body(&content);
    let directory = if found.0.source == "user" {
        format!("/opt/skills-user/{}", found.0.id)
    } else {
        format!("/opt/skills/{}", found.0.id)
    };
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
        if !info.enabled {
            continue;
        }
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

fn user_skills_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("skills"))
        .map_err(|e| format!("app data directory: {e}"))
}

fn builtin_skill_exists(app: &AppHandle, id: &str) -> bool {
    skill_dirs(app)
        .into_iter()
        .filter(|(_, source)| *source != "user")
        .any(|(dir, _)| dir.join(id).join("SKILL.md").is_file())
}

fn write_user_skill(app: &AppHandle, id: &str, content: &str, replace: bool) -> Result<(), String> {
    if !is_valid_skill_name(id) {
        return Err(format!("invalid skill id: {id}"));
    }
    if builtin_skill_exists(app, id) {
        return Err(format!("'{id}' is a built-in skill id; choose another id"));
    }
    let dir = user_skills_dir(app)?.join(id);
    let skill_file = dir.join("SKILL.md");
    if skill_file.exists() && !replace {
        return Err(format!("skill '{id}' already exists; import it to replace"));
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("skill folder: {e}"))?;
    let temp = dir.join("SKILL.md.tmp");
    std::fs::write(&temp, content).map_err(|e| format!("skill file: {e}"))?;
    std::fs::rename(&temp, skill_file).map_err(|e| format!("skill file: {e}"))
}

fn clean_field(value: &str, name: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{name} is required"));
    }
    if value.chars().count() > max {
        return Err(format!("{name} is too long (max {max})"));
    }
    if value.contains(['\n', '\r', '"', '\\']) {
        return Err(format!(
            "{name} cannot contain quotes, backslashes or line breaks"
        ));
    }
    Ok(value.to_string())
}

fn clean_list(values: &[String], name: &str) -> Result<Vec<String>, String> {
    if values.len() > 40 {
        return Err(format!("{name} has too many entries (max 40)"));
    }
    let mut out = Vec::new();
    for value in values {
        let value = clean_field(value, name, 96)?;
        if value.contains([',', '[', ']']) {
            return Err(format!("{name} entries cannot contain commas or brackets"));
        }
        if !out.contains(&value) {
            out.push(value);
        }
    }
    Ok(out)
}

fn require_token(value: &str, name: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 96
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c));
    if valid {
        Ok(())
    } else {
        Err(format!("{name} has an invalid entry: {value}"))
    }
}

fn draft_markdown(draft: &SkillDraft) -> Result<String, String> {
    if !is_valid_skill_name(&draft.id) {
        return Err("id must be lowercase letters, digits or hyphens".to_string());
    }
    let title = clean_field(&draft.title, "title", 120)?;
    let version = clean_field(&draft.version, "version", 32)?;
    let summary = clean_field(&draft.summary, "summary", 500)?;
    let triggers = clean_list(&draft.triggers, "triggers")?;
    let tools = clean_list(&draft.requires_tools, "requires_tools")?;
    let python = clean_list(&draft.requires_python, "requires_python")?;
    let node = clean_list(&draft.requires_node, "requires_node")?;
    for tool in &tools {
        require_token(tool, "requires_tools")?;
    }
    for module in python.iter().chain(&node) {
        require_token(module, "requires_imports")?;
    }
    let body = draft.body.trim();
    if body.is_empty() {
        return Err("body is required".to_string());
    }
    if body.chars().count() > 200_000 {
        return Err("body is too large (max 200000 characters)".to_string());
    }
    let list = |items: &[String]| {
        items
            .iter()
            .map(|item| format!("\"{item}\""))
            .collect::<Vec<_>>()
            .join(", ")
    };
    Ok(format!(
        "---\nid: \"{}\"\ntitle: \"{}\"\nversion: \"{}\"\ntriggers: [{}]\nrequires_tools: [{}]\nrequires_imports:\n  python: [{}]\n  node: [{}]\nnetwork: none\nwrites: [\"outputs/\"]\nsummary: \"{}\"\n---\n\n{}\n",
        draft.id,
        title,
        version,
        list(&triggers),
        list(&tools),
        list(&python),
        list(&node),
        summary,
        body
    ))
}

fn validate_raw_skill(content: &str) -> Result<String, String> {
    if content.chars().count() > 300_000 {
        return Err("skill file is too large (max 300000 characters)".to_string());
    }
    let meta = parse_meta(content);
    let id = meta
        .id
        .filter(|id| is_valid_skill_name(id))
        .ok_or("frontmatter needs a valid id")?;
    if parse_skill(&id, content).is_none() {
        return Err("frontmatter needs a summary or description".to_string());
    }
    Ok(id)
}

fn copy_skill_tree(source: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    let mut files = 0usize;
    let mut bytes = 0u64;
    fn walk(
        source: &std::path::Path,
        target: &std::path::Path,
        files: &mut usize,
        bytes: &mut u64,
        depth: usize,
    ) -> Result<(), String> {
        if depth > 8 {
            return Err("skill folder is nested too deeply".to_string());
        }
        for entry in std::fs::read_dir(source)
            .map_err(|e| format!("skill folder: {e}"))?
            .filter_map(|entry| entry.ok())
        {
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink() || is_reparse_meta(&metadata) {
                return Err(format!(
                    "skill folders cannot contain links or junctions: {}",
                    path.display()
                ));
            }
            let name = entry.file_name();
            let destination = target.join(&name);
            if metadata.is_dir() {
                std::fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
                walk(&path, &destination, files, bytes, depth + 1)?;
            } else if metadata.is_file() {
                *files += 1;
                *bytes += metadata.len();
                if *files > 200 {
                    return Err("skill folder has too many files (max 200)".to_string());
                }
                if *bytes > 20 * 1024 * 1024 {
                    return Err("skill folder is larger than 20 MB".to_string());
                }
                std::fs::copy(&path, &destination).map_err(|e| format!("copy skill file: {e}"))?;
            }
        }
        Ok(())
    }
    walk(source, target, &mut files, &mut bytes, 0)
}

#[tauri::command]
pub async fn skills_save_draft(
    app: AppHandle,
    draft: SkillDraft,
) -> Result<Vec<SkillInfo>, String> {
    let content = draft_markdown(&draft)?;
    write_user_skill(&app, &draft.id, &content, false)?;
    skills_list(app).await
}

#[tauri::command]
pub async fn skills_save_raw(app: AppHandle, content: String) -> Result<Vec<SkillInfo>, String> {
    let id = validate_raw_skill(&content)?;
    write_user_skill(&app, &id, &content, false)?;
    skills_list(app).await
}

#[tauri::command]
pub async fn skills_import(app: AppHandle, path: String) -> Result<Vec<SkillInfo>, String> {
    let source = std::path::PathBuf::from(&path);
    let metadata = std::fs::symlink_metadata(&source).map_err(|e| format!("skill source: {e}"))?;
    if metadata.file_type().is_symlink() || is_reparse_meta(&metadata) {
        return Err("skill source cannot be a link or junction".to_string());
    }
    if metadata.is_file() {
        if metadata.len() > 1024 * 1024 {
            return Err("skill file is larger than 1 MB".to_string());
        }
        let content = std::fs::read_to_string(&source)
            .map_err(|e| format!("skill file must be UTF-8 text: {e}"))?;
        let id = validate_raw_skill(&content)?;
        write_user_skill(&app, &id, &content, true)?;
    } else if metadata.is_dir() {
        let id = source
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
            .ok_or("skill folder needs a name")?;
        if !is_valid_skill_name(&id) {
            return Err(
                "skill folder name must be lowercase letters, digits or hyphens".to_string(),
            );
        }
        let skill_file = source.join("SKILL.md");
        if !skill_file.is_file() {
            return Err("skill folder needs a SKILL.md".to_string());
        }
        let content = std::fs::read_to_string(&skill_file)
            .map_err(|e| format!("SKILL.md must be UTF-8 text: {e}"))?;
        if let Some(meta_id) = parse_meta(&content).id
            && meta_id != id
        {
            return Err("skill folder name must match the frontmatter id".to_string());
        }
        validate_raw_skill(&content)?;
        if builtin_skill_exists(&app, &id) {
            return Err(format!("'{id}' is a built-in skill id; choose another id"));
        }
        let base = user_skills_dir(&app)?;
        let target = base.join(&id);
        if std::fs::canonicalize(&source).ok() == std::fs::canonicalize(&target).ok() {
            return Err("skill is already in the user skills folder".to_string());
        }
        let staging = base.join(format!(".import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        if let Err(error) = copy_skill_tree(&source, &staging) {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
        let staging_file = staging.join("SKILL.md");
        if let Err(error) = std::fs::write(&staging_file, &content) {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("skill file: {error}"));
        }
        let backup = base.join(format!(".backup-{}", uuid::Uuid::new_v4()));
        let had_target = target.exists();
        if had_target {
            std::fs::rename(&target, &backup).map_err(|e| format!("replace skill: {e}"))?;
        }
        if let Err(error) = std::fs::rename(&staging, &target) {
            let _ = std::fs::remove_dir_all(&staging);
            if had_target {
                let _ = std::fs::rename(&backup, &target);
            }
            return Err(format!("install skill: {error}"));
        }
        if had_target {
            let _ = std::fs::remove_dir_all(&backup);
        }
    } else {
        return Err("skill source must be a SKILL.md file or a folder".to_string());
    }
    skills_list(app).await
}

fn safe_requirement(value: &str, extra: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || extra.contains(c))
}

pub(crate) fn doctor_script(info: &SkillInfo) -> Result<String, String> {
    for tool in &info.requires_tools {
        if !safe_requirement(tool, "._+-") {
            return Err(format!("invalid tool requirement: {tool}"));
        }
    }
    for module in info.requires_python.iter().chain(&info.requires_node) {
        if !safe_requirement(module, "._-") {
            return Err(format!("invalid import requirement: {module}"));
        }
    }
    let container = if info.source == "user" {
        "/opt/skills-user"
    } else {
        "/opt/skills"
    };
    let dir = format!("{container}/{}", info.id);
    let mut script = String::from("set -u\n");
    for tool in &info.requires_tools {
        script.push_str(&format!(
            "if command -v {tool} >/dev/null 2>&1; then v=$({tool} --version 2>&1 | head -n 1); printf 'VERSION\\t{tool}\\t%s\\n' \"$v\"; else printf 'MISSING\\t{tool}\\n'; fi\n"
        ));
    }
    if !info.requires_python.is_empty() {
        let modules = info
            .requires_python
            .iter()
            .map(|module| format!("\"{module}\""))
            .collect::<Vec<_>>()
            .join(", ");
        script.push_str(&format!(
            "if command -v python3 >/dev/null 2>&1; then python3 - <<'PY'\nimport importlib.util\nfor mod in ({modules},):\n    try:\n        found = importlib.util.find_spec(mod) is not None\n    except Exception:\n        found = False\n    if not found:\n        print(\"IMPORTMISS\\tpython\\t\" + mod)\nPY\nelse\n  for mod in {modules}; do printf 'IMPORTMISS\\tpython\\t%s\\n' \"$mod\"; done\nfi\n"
        ));
    }
    if !info.requires_node.is_empty() {
        let modules = info
            .requires_node
            .iter()
            .map(|module| format!("\"{module}\""))
            .collect::<Vec<_>>()
            .join(" ");
        script.push_str(&format!(
            "if command -v node >/dev/null 2>&1; then for mod in {modules}; do node -e 'try{{require.resolve(process.argv[1])}}catch(e){{process.exit(1)}}' \"$mod\" >/dev/null 2>&1 || printf 'IMPORTMISS\\tnode\\t%s\\n' \"$mod\"; done; else for mod in {modules}; do printf 'IMPORTMISS\\tnode\\t%s\\n' \"$mod\"; done; fi\n"
        ));
    }
    script.push_str(&format!(
        "if [ -f {dir}/tests/run.sh ]; then out=$(mktemp -d /tmp/myagent-doctor-XXXXXX); mkdir -p \"$out/outputs\"; log=$out/test.log; if (cd \"$out\" && SKILL_DIR={dir} OUTPUTS=\"$out/outputs\" timeout 120 sh {dir}/tests/run.sh >\"$log\" 2>&1); then printf 'TEST\\tOK\\tgolden\\n'; else printf 'TEST\\tFAIL\\tgolden\\n'; tail -n 20 \"$log\" | sed 's/^/DETAIL\\t/'; fi; rm -rf \"$out\"; fi\n"
    ));
    Ok(script)
}

fn clean_version(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(120)
        .collect()
}

#[tauri::command]
pub async fn skills_list(app: AppHandle) -> Result<Vec<SkillInfo>, String> {
    Ok(list_skills(&app)
        .into_iter()
        .map(|(info, _)| info)
        .collect())
}

#[tauri::command]
pub async fn skills_read(app: AppHandle, id: String) -> Result<String, String> {
    if !is_valid_skill_name(&id) {
        return Err("unknown skill".to_string());
    }
    let found = list_skills(&app)
        .into_iter()
        .find(|(info, _)| info.id == id)
        .ok_or_else(|| "unknown skill".to_string())?;
    std::fs::read_to_string(&found.1).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn skills_set_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<Vec<SkillInfo>, String> {
    if !is_valid_skill_name(&id) {
        return Err("unknown skill".to_string());
    }
    if !list_skills(&app).iter().any(|(info, _)| info.id == id) {
        return Err("unknown skill".to_string());
    }
    {
        let _guard = state_lock()
            .lock()
            .map_err(|_| "skills state is locked".to_string())?;
        let mut state = load_state(&app);
        state.disabled.retain(|item| item != &id);
        if !enabled {
            state.disabled.push(id);
        }
        save_state(&app, &state)?;
    }
    skills_list(app).await
}

#[tauri::command]
pub async fn skills_doctor(app: AppHandle, id: String) -> Result<DoctorResult, String> {
    let found = list_skills(&app)
        .into_iter()
        .find(|(info, _)| info.id == id)
        .ok_or_else(|| "unknown skill".to_string())?;
    let info = found.0;
    let resources = vec![info.id.clone()];
    let effect = permissions::check(&app, "skill", &resources, None)
        .await
        .map_err(|e| e.to_string())?;
    if effect == permissions::Effect::Deny {
        return Err("skill denied by rule".to_string());
    }
    let mut result = DoctorResult {
        skill: info.id.clone(),
        ok: false,
        ..DoctorResult::default()
    };
    let sandbox = crate::sandbox::config(&app);
    if !sandbox.enabled || sandbox.image.is_none() {
        result.detail = Some("Enable the sandbox to run skill checks.".to_string());
        return Ok(result);
    }
    let script = doctor_script(&info)?;
    let cancel = tokio::sync::Notify::new();
    let run = crate::sandbox::run(&app, &script, ".", Some(180), None, &cancel).await?;
    let mut log_lines: Vec<String> = Vec::new();
    for line in run.output.lines() {
        if let Some(text) = line.strip_prefix("DETAIL\t") {
            log_lines.push(text.to_string());
            continue;
        }
        let mut parts = line.splitn(3, '\t');
        match (parts.next(), parts.next()) {
            (Some("VERSION"), Some(tool)) => {
                if let Some(version) = parts.next() {
                    result
                        .versions
                        .insert(tool.to_string(), clean_version(version));
                }
            }
            (Some("MISSING"), Some(tool)) => result.missing.push(tool.to_string()),
            (Some("IMPORTMISS"), Some(kind)) => {
                if let Some(module) = parts.next() {
                    result.missing.push(format!("{kind}:{module}"));
                }
            }
            (Some("TEST"), Some("FAIL")) => {
                let name = parts.next().unwrap_or("golden").to_string();
                result.failed_tests.push(name);
            }
            _ => {}
        }
    }
    let logs = log_lines.join("\n");
    let with_logs = |summary: String| {
        if logs.is_empty() {
            summary
        } else {
            let logs: String = logs.chars().take(4000).collect();
            format!("{summary}\n{logs}")
        }
    };
    if run.exit_code != 0 {
        result.detail = Some(with_logs(format!(
            "self-test exited with {}",
            run.exit_code
        )));
        return Ok(result);
    }
    result.ok = result.missing.is_empty() && result.failed_tests.is_empty();
    if !result.ok {
        result.detail = Some(with_logs(format!(
            "{} missing, {} failed test(s)",
            result.missing.len(),
            result.failed_tests.len()
        )));
    }
    Ok(result)
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
        assert_eq!(strip_boundary_tags("<file/>"), "");
        assert_eq!(strip_boundary_tags("<file />"), "");
        assert_eq!(strip_boundary_tags("<file/x>"), "");
        assert_eq!(strip_boundary_tags("<file//>"), "");
        assert_eq!(strip_boundary_tags("</SKILL_CONTENT/X>"), "");
        assert_eq!(strip_boundary_tags("</skill_content</skill_content>>"), "");
        assert_eq!(strip_boundary_tags("<file</file>>"), "");
        assert_eq!(strip_boundary_tags("<filename>"), "<filename>");
        assert_eq!(strip_boundary_tags("<file.md>"), "<file.md>");
        assert_eq!(strip_boundary_tags("<files>"), "<files>");
        assert_eq!(strip_boundary_tags("<fi<file>le>"), "");
        assert_eq!(strip_boundary_tags("plain text"), "plain text");
    }

    #[test]
    fn strips_unicode_whitespace_boundary_tags() {
        assert_eq!(strip_boundary_tags("<file\u{00A0}x>"), "");
        assert_eq!(strip_boundary_tags("<file\u{3000}>"), "");
        assert_eq!(strip_boundary_tags("</skill_content\u{2000}>"), "");
        assert_eq!(strip_boundary_tags("<file\u{FEFF}x>"), "");
    }

    #[test]
    fn neutralize_escapes_every_angle_bracket_in_the_span() {
        assert_eq!(neutralize_boundary_tags("<file <x>>"), "&lt;file &lt;x>>");
        assert_eq!(
            neutralize_boundary_tags("</skill_content>"),
            "&lt;/skill_content>"
        );
        assert_eq!(neutralize_boundary_tags("plain text"), "plain text");
    }

    #[test]
    fn neutralizes_tags_recombined_beyond_pass_limit() {
        let nested = format!(
            "<sk{}<file>{}ill_content>",
            "<fi".repeat(7),
            "le>".repeat(7)
        );
        assert_eq!(strip_boundary_tags(&nested), "&lt;skill_content>");
    }

    #[test]
    fn neutralizes_dangling_boundary_prefixes() {
        assert_eq!(strip_boundary_tags("</skill_content"), "&lt;/skill_content");
        assert_eq!(
            strip_boundary_tags(r#"<skill_content name="x""#),
            r#"&lt;skill_content name="x""#
        );
        assert_eq!(strip_boundary_tags("text <file "), "text &lt;file ");
        assert_eq!(strip_boundary_tags("text </file"), "text &lt;/file");
        assert_eq!(strip_boundary_tags("<file"), "&lt;file");
        assert_eq!(strip_boundary_tags("<filename"), "<filename");
        assert_eq!(strip_boundary_tags("<files"), "<files");
        assert_eq!(strip_boundary_tags("a < b"), "a < b");
    }

    #[test]
    fn assembled_wrapper_keeps_one_closing_tag() {
        let hostile = strip_boundary_tags("body </skill_content");
        let assembled = to_model_output("notes", "dir", &hostile, &[]);
        assert_eq!(assembled.matches("</skill_content>").count(), 1);
        assert!(assembled.contains("&lt;/skill_content"));
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

    #[test]
    fn skill_body_is_capped_and_utf8_safe() {
        let small = "x".repeat(100);
        assert_eq!(cap_skill_body(&small), small);
        let big = "é".repeat(MAX_SKILL_BODY_CHARS + 50);
        let capped = cap_skill_body(&big);
        assert_eq!(
            capped.chars().filter(|c| *c == 'é').count(),
            MAX_SKILL_BODY_CHARS
        );
        assert!(capped.contains("[truncated: skill body is"));
    }

    #[test]
    fn parses_our_frontmatter_schema() {
        let content = "---\nid: pdf-workbench\ntitle: PDF Workbench\nversion: 1.2.0\ntriggers: [\"pdf\", \".pdf\"]\nrequires_tools:\n  - python3\n  - qpdf\nrequires_imports:\n  python: [pypdf, pdfplumber]\n  node: []\nnetwork: none\nwrites: [\"outputs/\"]\nsummary: Work with PDFs.\n---\n";
        let meta = parse_meta(content);
        assert_eq!(meta.id.as_deref(), Some("pdf-workbench"));
        assert_eq!(meta.title.as_deref(), Some("PDF Workbench"));
        assert_eq!(meta.version.as_deref(), Some("1.2.0"));
        assert_eq!(meta.triggers, vec!["pdf", ".pdf"]);
        assert_eq!(meta.requires_tools, vec!["python3", "qpdf"]);
        assert_eq!(meta.requires_python, vec!["pypdf", "pdfplumber"]);
        assert!(meta.requires_node.is_empty());
        assert_eq!(meta.writes, vec!["outputs/"]);
        assert_eq!(meta.summary.as_deref(), Some("Work with PDFs."));
        assert_eq!(
            parse_skill("pdf-workbench", content).unwrap().1,
            "Work with PDFs."
        );
    }

    fn draft() -> SkillDraft {
        SkillDraft {
            id: "my-skill".into(),
            title: "My Skill".into(),
            version: "1.0.0".into(),
            summary: "One line".into(),
            triggers: vec!["pdf".into(), "merge".into()],
            requires_tools: vec!["qpdf".into()],
            requires_python: vec!["pypdf".into()],
            requires_node: vec![],
            body: "# My Skill\n\nDo the thing.".into(),
        }
    }

    #[test]
    fn draft_markdown_round_trips_through_the_parser() {
        let content = draft_markdown(&draft()).unwrap();
        let meta = parse_meta(&content);
        assert_eq!(meta.id.as_deref(), Some("my-skill"));
        assert_eq!(meta.title.as_deref(), Some("My Skill"));
        assert_eq!(meta.triggers, vec!["pdf", "merge"]);
        assert_eq!(meta.requires_python, vec!["pypdf"]);
        assert_eq!(meta.summary.as_deref(), Some("One line"));
        assert!(content.contains("Do the thing."));
    }

    #[test]
    fn draft_rejects_unsafe_fields_and_bad_ids() {
        let mut bad = draft();
        bad.id = "Bad Id".into();
        assert!(draft_markdown(&bad).is_err());
        let mut bad = draft();
        bad.title = "a \"quote\"".into();
        assert!(draft_markdown(&bad).is_err());
        let mut bad = draft();
        bad.body = "   ".into();
        assert!(draft_markdown(&bad).is_err());
        let mut bad = draft();
        bad.requires_tools = vec!["qpdf; rm".into()];
        assert!(draft_markdown(&bad).is_err());
    }

    #[test]
    fn raw_skill_needs_a_valid_id_and_summary() {
        assert_eq!(
            validate_raw_skill("---\nid: notes\nsummary: Notes\n---\nBody").unwrap(),
            "notes"
        );
        assert!(validate_raw_skill("---\ntitle: No id\n---\nBody").is_err());
        assert!(validate_raw_skill("---\nid: notes\n---\n").is_err());
    }

    #[test]
    fn every_bundled_skill_parses() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/skills");
        let mut found = 0;
        for entry in std::fs::read_dir(root)
            .unwrap()
            .filter_map(|entry| entry.ok())
        {
            let path = entry.path().join("SKILL.md");
            if !path.is_file() {
                continue;
            }
            let content = std::fs::read_to_string(&path).unwrap();
            let name = entry.file_name().to_string_lossy().to_string();
            assert!(
                parse_skill(&name, &content).is_some(),
                "{name} should parse"
            );
            found += 1;
        }
        assert!(found >= 4, "expected four bundled skills, found {found}");
    }

    #[test]
    fn bundled_pdf_skill_has_the_expected_contract() {
        let content = include_str!("../resources/skills/pdf-workbench/SKILL.md");
        let meta = parse_meta(content);
        assert_eq!(meta.id.as_deref(), Some("pdf-workbench"));
        assert_eq!(meta.version.as_deref(), Some("1.0.0"));
        assert!(meta.requires_tools.contains(&"qpdf".to_string()));
        assert!(meta.requires_python.contains(&"pypdf".to_string()));
        assert_eq!(meta.writes, vec!["outputs/"]);
        assert!(parse_skill("pdf-workbench", content).is_some());
    }

    #[test]
    fn parses_flow_import_map() {
        let content = "---\nrequires_imports: {python: [pypdf, pdfplumber], node: [sharp]}\n---\n";
        let meta = parse_meta(content);
        assert_eq!(meta.requires_python, vec!["pypdf", "pdfplumber"]);
        assert_eq!(meta.requires_node, vec!["sharp"]);
    }

    #[test]
    fn frontmatter_ignores_dashes_inside_values() {
        let content = "---\nsummary: Use a---b and c\nversion: 1.0.0\n---\nBody";
        let meta = parse_meta(content);
        assert_eq!(meta.summary.as_deref(), Some("Use a---b and c"));
        assert_eq!(meta.version.as_deref(), Some("1.0.0"));
        assert!(content.contains("Body"));
    }

    #[test]
    fn parses_block_import_lists() {
        let content = "---\nrequires_imports:\n  python:\n    - pypdf\n  node:\n    - sharp\n---\n";
        let meta = parse_meta(content);
        assert_eq!(meta.requires_python, vec!["pypdf"]);
        assert_eq!(meta.requires_node, vec!["sharp"]);
    }

    #[test]
    fn old_frontmatter_still_parses() {
        let meta = parse_meta("---\nname: notes\ndescription: Old style\n---\n");
        assert_eq!(meta.id.as_deref(), Some("notes"));
        assert_eq!(meta.description.as_deref(), Some("Old style"));
    }

    #[test]
    fn doctor_script_rejects_shell_metacharacters() {
        let mut info = SkillInfo {
            id: "demo".into(),
            name: "demo".into(),
            title: "Demo".into(),
            version: "1.0.0".into(),
            summary: "Demo".into(),
            description: "Demo".into(),
            source: "builtin".into(),
            enabled: true,
            directory: String::new(),
            triggers: Vec::new(),
            requires_tools: vec!["python3; rm -rf /".into()],
            requires_python: Vec::new(),
            requires_node: Vec::new(),
        };
        assert!(doctor_script(&info).is_err());
        info.requires_tools = vec!["python3".into()];
        info.requires_python = vec!["pypdf; touch /tmp/x".into()];
        assert!(doctor_script(&info).is_err());
        info.requires_python = vec!["pypdf".into()];
        let script = doctor_script(&info).unwrap();
        assert!(script.contains("/opt/skills/demo"));
        assert!(script.contains("command -v python3"));
    }
}
