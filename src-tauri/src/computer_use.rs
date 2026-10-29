use std::collections::BTreeMap;
use std::path::PathBuf;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const APP_ID: &str = "com.abdul.myagent";
pub const AUDIT_FILE: &str = "computer-use-audit.jsonl";
pub const BUILTIN_SERVER_NAME: &str = "computer-use";

pub const HARD_DENIED_EXES: &[&str] = &[
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    "wt.exe",
    "windowsterminal.exe",
    "conhost.exe",
    "openconsole.exe",
    "bash.exe",
    "wsl.exe",
    "mintty.exe",
    "putty.exe",
    "kitty.exe",
    "alacritty.exe",
    "wezterm-gui.exe",
    "hyper.exe",
    "tabby.exe",
    "mshta.exe",
    "rundll32.exe",
    "regsvr32.exe",
    "wscript.exe",
    "cscript.exe",
    "certutil.exe",
    "explorer.exe",
    "taskkill.exe",
    "reg.exe",
    "schtasks.exe",
    "sc.exe",
    "net.exe",
    "net1.exe",
    "psexec.exe",
    "wmic.exe",
    "bitsadmin.exe",
    "installutil.exe",
    "msbuild.exe",
    "csc.exe",
    "powershell_ise.exe",
    "1password.exe",
    "1passwordbrowserservice.exe",
    "bitwarden.exe",
    "keepass.exe",
    "keepassxc.exe",
    "lastpass.exe",
    "dashlane.exe",
    "enpass.exe",
    "roboform.exe",
    "nordpass.exe",
    "keeper.exe",
    "taskmgr.exe",
    "procexp.exe",
    "procmon.exe",
    "autoruns.exe",
    "msconfig.exe",
    "regedit.exe",
    "consent.exe",
    "logonui.exe",
    "lockapp.exe",
    "credentialuibroker.exe",
    "useraccountcontrolsettings.exe",
    "windowssecurity.exe",
    "securityhealthsystray.exe",
    "msmpeng.exe",
    "avp.exe",
    "bdagent.exe",
    "csrss.exe",
    "wininit.exe",
    "winlogon.exe",
    "services.exe",
    "lsass.exe",
    "smss.exe",
    "sihost.exe",
    "fontdrvhost.exe",
];

pub const HARD_DENIED_TITLE_MARKERS: &[&str] = &["user account control", "secure desktop"];

pub fn hard_deny_reason(exe: &str, title: &str) -> Option<String> {
    let name = std::path::Path::new(exe)
        .file_name()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_else(|| exe.trim().to_ascii_lowercase());
    if HARD_DENIED_EXES.iter().any(|denied| *denied == name) {
        return Some(format!("{name} is a hard-denied app"));
    }
    let title = title.to_ascii_lowercase();
    if let Some(marker) = HARD_DENIED_TITLE_MARKERS
        .iter()
        .find(|marker| title.contains(**marker))
    {
        return Some(format!(
            "window title contains hard-denied marker {marker:?}"
        ));
    }
    None
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AppTier {
    #[default]
    View,
    Interact,
    Full,
}

impl AppTier {
    pub fn as_str(self) -> &'static str {
        match self {
            AppTier::View => "view",
            AppTier::Interact => "interact",
            AppTier::Full => "full",
        }
    }

    pub fn allows(self, needed: AppTier) -> bool {
        match needed {
            AppTier::View => true,
            AppTier::Interact => matches!(self, AppTier::Interact | AppTier::Full),
            AppTier::Full => self == AppTier::Full,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppPolicy {
    pub path: String,
    pub name: String,
    pub tier: AppTier,
    pub publisher: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ComputerUseConfig {
    pub enabled: bool,
    pub paused: bool,
    pub dry_run: bool,
    pub overlay: bool,
    pub hotkey: String,
    pub max_actions_per_run: u32,
    pub audit_thumbnails: bool,
    pub allow: Vec<AppPolicy>,
    pub deny: Vec<String>,
}

impl Default for ComputerUseConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            paused: false,
            dry_run: false,
            overlay: true,
            hotkey: "Ctrl+Alt+Shift+P".to_string(),
            max_actions_per_run: 100,
            audit_thumbnails: false,
            allow: Vec::new(),
            deny: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub at: u64,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub dry_run: bool,
    pub ok: bool,
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

pub fn data_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .map(|dir| dir.join(APP_ID))
        .ok_or_else(|| "could not resolve the app data directory".to_string())
}

pub fn config_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("computer-use.json"))
}

pub fn audit_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(AUDIT_FILE))
}

pub fn audit_dir() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("computer-use-audit"))
}

pub fn load_config() -> ComputerUseConfig {
    let Ok(path) = config_path() else {
        return ComputerUseConfig::default();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return ComputerUseConfig::default();
    };
    match serde_json::from_str::<ComputerUseConfig>(&raw) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("computer-use: config parse failed: {error}");
            ComputerUseConfig::default()
        }
    }
}

fn normalize(mut config: ComputerUseConfig) -> Result<ComputerUseConfig, String> {
    config.max_actions_per_run = config.max_actions_per_run.clamp(1, 1_000);
    config.hotkey = config.hotkey.trim().to_string();
    if config.hotkey.is_empty() || config.hotkey.len() > 64 {
        return Err("hotkey must be 1-64 characters".to_string());
    }
    #[cfg(windows)]
    crate::computer_use_hotkey::validate(&config.hotkey)?;
    for policy in &config.allow {
        let path = policy.path.trim();
        if !path.is_empty() && !std::path::Path::new(path).is_absolute() {
            return Err("allowlist paths must be absolute".to_string());
        }
    }
    let mut seen_policies = std::collections::HashSet::new();
    config.allow = config
        .allow
        .into_iter()
        .filter_map(|mut policy| {
            policy.path = policy.path.trim().to_string();
            policy.name = policy.name.trim().to_string();
            policy.publisher = policy
                .publisher
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            if policy.path.is_empty() && policy.name.is_empty() {
                return None;
            }
            let key = (
                policy.path.to_ascii_lowercase(),
                policy.name.to_ascii_lowercase(),
            );
            seen_policies.insert(key).then_some(policy)
        })
        .collect();
    let mut seen = std::collections::HashSet::new();
    config.deny = config
        .deny
        .into_iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .filter(|value| seen.insert(value.clone()))
        .collect();
    Ok(config)
}

pub fn save_config(config: ComputerUseConfig) -> Result<ComputerUseConfig, String> {
    let config = normalize(config)?;
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4().simple()));
    std::fs::write(&temp, raw).map_err(|e| e.to_string())?;
    if let Err(error) = std::fs::rename(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        return Err(error.to_string());
    }
    Ok(config)
}

pub fn append_audit(entry: &AuditEntry) {
    let Ok(path) = audit_path() else {
        return;
    };
    if let Some(parent) = path.parent()
        && let Err(error) = std::fs::create_dir_all(parent)
    {
        eprintln!("computer-use: audit directory failed: {error}");
        return;
    }
    trim_audit(&path);
    let Ok(mut line) = serde_json::to_string(entry) else {
        return;
    };
    line.push('\n');
    use std::io::Write;
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        Ok(mut file) => {
            if let Err(error) = file.write_all(line.as_bytes()) {
                eprintln!("computer-use: audit write failed: {error}");
            }
        }
        Err(error) => eprintln!("computer-use: audit open failed: {error}"),
    }
}

fn trim_audit(path: &std::path::Path) {
    let Ok(metadata) = std::fs::metadata(path) else {
        return;
    };
    if metadata.len() <= 4 * 1024 * 1024 {
        return;
    }
    let Ok(raw) = std::fs::read_to_string(path) else {
        return;
    };
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(5_000);
    let mut kept = lines[start..].join("\n");
    kept.push('\n');
    if let Err(error) = std::fs::write(path, kept) {
        eprintln!("computer-use: audit trim failed: {error}");
    }
}

fn read_audit(limit: usize) -> Result<Vec<AuditEntry>, String> {
    let path = audit_path()?;
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut entries: Vec<AuditEntry> = Vec::new();
    for line in raw.lines() {
        match serde_json::from_str::<AuditEntry>(line) {
            Ok(entry) => entries.push(entry),
            Err(error) => eprintln!("computer-use: skipping malformed audit line: {error}"),
        }
    }
    entries.reverse();
    entries.truncate(limit);
    Ok(entries)
}

#[tauri::command]
pub fn computer_use_config() -> ComputerUseConfig {
    load_config()
}

#[tauri::command]
pub fn computer_use_set_config(
    app: AppHandle,
    config: ComputerUseConfig,
) -> Result<ComputerUseConfig, String> {
    let config = save_config(config)?;
    #[cfg(windows)]
    after_config_save(&app, &config);
    #[cfg(not(windows))]
    let _ = app;
    Ok(config)
}

#[tauri::command]
pub fn computer_use_set_paused(app: AppHandle, paused: bool) -> Result<ComputerUseConfig, String> {
    let mut config = load_config();
    config.paused = paused;
    let config = save_config(config)?;
    #[cfg(windows)]
    after_config_save(&app, &config);
    #[cfg(not(windows))]
    let _ = app;
    Ok(config)
}

#[tauri::command]
pub fn computer_use_set_overlay(
    app: AppHandle,
    overlay: bool,
) -> Result<ComputerUseConfig, String> {
    let mut config = load_config();
    config.overlay = overlay;
    let config = save_config(config)?;
    #[cfg(windows)]
    after_config_save(&app, &config);
    #[cfg(not(windows))]
    let _ = app;
    Ok(config)
}

#[cfg(windows)]
fn after_config_save(app: &AppHandle, config: &ComputerUseConfig) {
    crate::computer_use_hotkey::reload();
    sync_overlay(app, config);
    if let Err(error) = app.emit("computer-use-paused", config.paused) {
        eprintln!("computer-use: pause event failed: {error}");
    }
    if let Err(error) = app.emit("computer-use-overlay", config.overlay) {
        eprintln!("computer-use: overlay event failed: {error}");
    }
    if let Err(error) = app.emit("computer-use-config", config) {
        eprintln!("computer-use: config event failed: {error}");
    }
}

#[cfg(windows)]
fn sync_overlay(app: &AppHandle, config: &ComputerUseConfig) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("computer-use") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let result = if config.enabled && config.overlay {
        if visible { Ok(()) } else { window.show() }
    } else if visible {
        window.hide()
    } else {
        Ok(())
    };
    if let Err(error) = result {
        eprintln!("computer-use: overlay visibility failed: {error}");
    }
}

#[cfg(windows)]
pub fn sync_overlay_startup(app: &AppHandle) {
    let config = load_config();
    sync_overlay(app, &config);
}

#[tauri::command]
pub fn computer_use_audit(limit: Option<usize>) -> Result<Vec<AuditEntry>, String> {
    read_audit(limit.unwrap_or(200).clamp(1, 1_000))
}

#[tauri::command]
pub fn computer_use_hard_denies() -> Vec<String> {
    HARD_DENIED_EXES
        .iter()
        .map(|value| value.to_string())
        .collect()
}

#[tauri::command]
pub fn computer_use_audit_image(name: String) -> Result<String, String> {
    if name.is_empty()
        || name.contains("..")
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
    {
        return Err("invalid audit image name".to_string());
    }
    let path = audit_dir()?.join(name);
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn computer_use_clear_audit() -> Result<(), String> {
    let path = audit_path()?;
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    match std::fs::remove_dir_all(audit_dir()?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub async fn ensure_builtin(app: &AppHandle) -> Result<(), String> {
    let marker = data_dir()?.join("computer-use-seeded");
    if marker.exists() {
        return Ok(());
    }
    let pool = crate::tools::memory_pool(app)
        .await
        .map_err(|e| e.to_string())?;
    let exists: Option<String> = sqlx::query_scalar(
        "SELECT id FROM mcp_servers WHERE name = ? AND project_id IS NULL LIMIT 1",
    )
    .bind(BUILTIN_SERVER_NAME)
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?;
    if exists.is_some() {
        if let Err(error) = std::fs::write(&marker, "1") {
            eprintln!("computer-use: seed marker failed: {error}");
        }
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let command = exe.to_string_lossy().to_string();
    let config = crate::mcp::McpConfig {
        command: Some(command.clone()),
        args: vec!["--computer-use".to_string()],
        cwd: None,
        env: BTreeMap::new(),
        url: None,
        headers: BTreeMap::new(),
        timeout_ms: Some(30_000),
    };
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    sqlx::query(
        "INSERT INTO mcp_servers (id, project_id, name, transport, auth_type, cmd, url, allow_tools, timeout_ms, enabled, created_at, config_json) VALUES (?, NULL, ?, 'stdio', 'none', ?, NULL, NULL, 30000, 0, ?, ?)",
    )
    .bind(&id)
    .bind(BUILTIN_SERVER_NAME)
    .bind(&command)
    .bind(now)
    .bind(&config_json)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    if let Err(error) = std::fs::write(&marker, "1") {
        eprintln!("computer-use: seed marker failed: {error}");
    }
    Ok(())
}
