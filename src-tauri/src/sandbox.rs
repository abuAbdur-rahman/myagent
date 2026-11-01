use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::Manager;
use tokio::process::Command;

const BASE_IMAGE: &str =
    "debian@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587";
const BASELINE_PACKAGES: &[&str] = &[
    "ca-certificates",
    "coreutils",
    "curl",
    "findutils",
    "grep",
    "python3",
    "ripgrep",
    "sed",
    "xz-utils",
];
const NODE_VERSION: &str = "20.20.2";
const NODE_SHA256: &str = "df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d";
const PROTECTED_DIRS: &[&str] = &[
    ".git", ".vscode", ".husky", ".github", ".claude", "skills", "commands",
];
const PROTECTED_FILES: &[&str] = &["AGENTS.md", "CLAUDE.md", ".mcp.json"];
const PREFLIGHT_FILES: &[&str] = &[
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "README.md",
    ".git",
];
const MAX_TIMEOUT_SECS: u64 = 900;
const DEFAULT_TIMEOUT_SECS: u64 = 120;
const MAX_PACKAGES: usize = 80;
const CHECKPOINT_KEEP: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub image_tag: Option<String>,
    #[serde(default = "default_profile")]
    pub profile: String,
    #[serde(default)]
    pub allow_installs: bool,
    #[serde(default)]
    pub packages: Vec<String>,
    #[serde(default)]
    pub cpus: Option<f32>,
    #[serde(default)]
    pub memory_mb: Option<u32>,
    #[serde(skip)]
    pub skill_mounts: Vec<(PathBuf, String)>,
}

fn default_profile() -> String {
    "office".to_string()
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            project_root: None,
            image: None,
            image_tag: None,
            profile: default_profile(),
            allow_installs: false,
            packages: Vec::new(),
            cpus: Some(1.0),
            memory_mb: Some(1024),
            skill_mounts: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SandboxStatus {
    pub state: String,
    pub enabled: bool,
    pub docker: Option<String>,
    pub image: Option<String>,
    pub image_size: Option<u64>,
    pub project_root: Option<String>,
    pub profile: String,
    pub allow_installs: bool,
    pub packages: Vec<String>,
    pub cpus: f32,
    pub memory_mb: u32,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RunResult {
    pub output: String,
    pub exit_code: i32,
    pub checkpoint: Option<String>,
    pub sensitive: Vec<String>,
    pub files: Vec<String>,
    pub duration_ms: u64,
}

struct Checkpoint {
    reference: String,
    tree: String,
}

fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("sandbox.json"))
}

pub fn config(app: &tauri::AppHandle) -> SandboxConfig {
    let Some(path) = config_path(app) else {
        return SandboxConfig::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SandboxConfig::default(),
        Err(error) => {
            eprintln!("sandbox: cannot read config: {error}");
            SandboxConfig::default()
        }
    }
}

pub fn enabled(app: &tauri::AppHandle) -> bool {
    config(app).enabled
}

fn save(app: &tauri::AppHandle, cfg: &SandboxConfig) -> Result<(), String> {
    let path = config_path(app).ok_or("app data directory unavailable")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("sandbox config: {e}"))?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| format!("sandbox config: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("sandbox config: {e}"))
}

fn docker_bin() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(explicit) = std::env::var_os("MYAGENT_DOCKER") {
        candidates.push(PathBuf::from(explicit));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join("docker.exe"));
            candidates.push(dir.join("docker"));
        }
    }
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates
            .push(PathBuf::from(program_files).join("Docker/Docker/resources/bin/docker.exe"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn docker_command(bin: &Path) -> Command {
    let mut command = Command::new(bin);
    #[cfg(windows)]
    {
        command.creation_flags(0x0800_0000);
    }
    command.stdin(Stdio::null());
    command
}

async fn docker_output(
    bin: &Path,
    args: &[String],
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut command = docker_command(bin);
    command.args(args).kill_on_drop(true);
    match tokio::time::timeout(timeout, command.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(format!("docker: {error}")),
        Err(_) => Err("docker command timed out".to_string()),
    }
}

async fn kill_container(bin: &Path, exec_id: &str) {
    let name = format!("myagent-{exec_id}");
    let _ = docker_output(bin, &["kill".into(), name.clone()], Duration::from_secs(10)).await;
    let _ = docker_output(
        bin,
        &["rm".into(), "-f".into(), name],
        Duration::from_secs(10),
    )
    .await;
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

async fn daemon_version(bin: &Path) -> Result<String, String> {
    let output = docker_output(
        bin,
        &[
            "version".into(),
            "--format".into(),
            "{{.Server.Version}}".into(),
        ],
        Duration::from_secs(8),
    )
    .await?;
    if !output.status.success() {
        return Err(text(&output.stderr));
    }
    let version = text(&output.stdout);
    if version.is_empty() {
        return Err("daemon did not report a version".to_string());
    }
    Ok(version)
}

async fn image_info(bin: &Path, image: &str) -> Option<(String, u64)> {
    let output = docker_output(
        bin,
        &[
            "image".into(),
            "inspect".into(),
            "--format".into(),
            "{{.Id}} {{.Size}}".into(),
            image.into(),
        ],
        Duration::from_secs(8),
    )
    .await
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = text(&output.stdout);
    let mut parts = raw.split_whitespace();
    let id = parts.next()?.to_string();
    let size = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    Some((id, size))
}

pub async fn status(app: &tauri::AppHandle) -> SandboxStatus {
    let cfg = config(app);
    let mut status = SandboxStatus {
        state: "not_installed".to_string(),
        enabled: cfg.enabled,
        docker: None,
        image: cfg.image.clone(),
        image_size: None,
        project_root: cfg.project_root.clone(),
        profile: cfg.profile.clone(),
        allow_installs: cfg.allow_installs,
        packages: cfg.packages.clone(),
        cpus: cfg.cpus.unwrap_or(1.0),
        memory_mb: cfg.memory_mb.unwrap_or(1024),
        detail: None,
    };
    let Some(bin) = docker_bin() else {
        status.detail = Some("Docker Desktop was not found".to_string());
        return status;
    };
    match daemon_version(&bin).await {
        Ok(version) => status.docker = Some(version),
        Err(error) => {
            status.state = "daemon_stopped".to_string();
            status.detail = Some(if error.is_empty() {
                "Docker is installed but not running".to_string()
            } else {
                format!("Docker is not running: {error}")
            });
            return status;
        }
    }
    match &cfg.image {
        Some(image) => match image_info(&bin, image).await {
            Some((id, size)) => {
                status.state = "ready".to_string();
                status.image = Some(id);
                status.image_size = Some(size);
                let stale = match expected_tag(&cfg) {
                    Ok(tag) => cfg.image_tag.as_deref() != Some(tag.as_str()),
                    Err(_) => true,
                };
                if stale {
                    status.state = "no_image".to_string();
                    status.detail = Some(
                        "Sandbox image is out of date; rebuild it to add the current toolchain"
                            .to_string(),
                    );
                }
            }
            None => {
                status.state = "no_image".to_string();
                status.detail = Some("Sandbox image is missing or was removed".to_string());
            }
        },
        None => {
            status.state = "no_image".to_string();
            status.detail = Some("Sandbox image has not been built".to_string());
        }
    }
    status
}

fn valid_package(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() || first.is_ascii_digit() => {}
        _ => return false,
    }
    name.len() <= 64
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "+._-".contains(c))
}

const CORE_PACKAGES: &[&str] = &[
    "fontconfig",
    "fonts-dejavu",
    "fonts-liberation",
    "fonts-noto-core",
    "libcairo2",
    "libharfbuzz0b",
    "libpango-1.0-0",
    "libpangoft2-1.0-0",
    "libxml2-utils",
    "ocrmypdf",
    "poppler-utils",
    "python3-pip",
    "python3-venv",
    "qpdf",
    "tesseract-ocr",
    "tesseract-ocr-eng",
    "unzip",
    "zip",
];
const OFFICE_PACKAGES: &[&str] = &[
    "fonts-noto-color-emoji",
    "libreoffice-calc",
    "libreoffice-impress",
    "libreoffice-writer",
];
const FULL_PACKAGES: &[&str] = &[
    "fonts-noto-cjk",
    "tesseract-ocr-ara",
    "tesseract-ocr-deu",
    "tesseract-ocr-fra",
    "tesseract-ocr-hin",
    "tesseract-ocr-por",
    "tesseract-ocr-spa",
];

const PYTHON_REQUIREMENTS: &str = include_str!("../resources/sandbox/requirements.txt");
const NODE_PACKAGE_JSON: &str = include_str!("../resources/sandbox/package.json");
const NODE_PACKAGE_LOCK: &str = include_str!("../resources/sandbox/package-lock.json");
const LO_CONVERT: &str = include_str!("../resources/sandbox/lo-convert.sh");

pub fn profile_packages(profile: &str) -> Result<Vec<String>, String> {
    let mut all: Vec<String> = CORE_PACKAGES.iter().map(|name| name.to_string()).collect();
    match profile {
        "core" => {}
        "office" => all.extend(OFFICE_PACKAGES.iter().map(|name| name.to_string())),
        "full" => {
            all.extend(OFFICE_PACKAGES.iter().map(|name| name.to_string()));
            all.extend(FULL_PACKAGES.iter().map(|name| name.to_string()));
        }
        other => return Err(format!("unknown sandbox profile: {other}")),
    }
    Ok(all)
}

fn digest(parts: &[&str]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0u8]);
    }
    format!("{:x}", hasher.finalize())
}

fn toolchain_digest() -> String {
    digest(&[
        PYTHON_REQUIREMENTS,
        NODE_PACKAGE_JSON,
        NODE_PACKAGE_LOCK,
        LO_CONVERT,
    ])
}

fn tool_name(token: &str) -> String {
    let cleaned = token
        .trim_matches(|c| c == '"' || c == '\'')
        .replace('\\', "");
    cleaned
        .rsplit('/')
        .next()
        .unwrap_or(cleaned.as_str())
        .to_ascii_lowercase()
}

fn looks_like_install(tokens: &[String]) -> bool {
    let names: Vec<String> = tokens.iter().map(|token| tool_name(token)).collect();
    let start = names
        .iter()
        .position(|name| {
            !matches!(
                name.as_str(),
                "sudo" | "env" | "command" | "nohup" | "time" | "exec"
            ) && !name.contains('=')
                && !name.starts_with('-')
        })
        .unwrap_or(names.len());
    let names = &names[start..];
    let has = |name: &str| names.iter().any(|item| item == name);
    let first = names.first().map(String::as_str).unwrap_or_default();
    if matches!(first, "sh" | "bash" | "zsh" | "dash")
        && let Some(position) = names.iter().position(|name| name == "-c")
    {
        let rest = tokens[start + position + 1..].join(" ");
        if blocked_install(&rest).is_some() {
            return true;
        }
    }
    if matches!(first, "eval" | "xargs") {
        let rest = tokens[start + 1..].join(" ");
        if blocked_install(&rest).is_some() {
            return true;
        }
    }
    if first == "apt" || first == "apt-get" {
        return true;
    }
    if first == "uv" && has("add") {
        return true;
    }
    if (first == "pip" || first == "pip3") && has("install") {
        return true;
    }
    if first == "uv" && has("pip") && has("install") {
        return true;
    }
    if (first == "python" || first == "python3")
        && names
            .windows(3)
            .any(|window| window[0] == "-m" && window[1] == "pip" && window[2] == "install")
    {
        return true;
    }
    (first == "npm" || first == "pnpm" || first == "yarn")
        && names
            .iter()
            .skip(1)
            .any(|item| matches!(item.as_str(), "install" | "i" | "add" | "ci"))
}

pub fn blocked_install(command: &str) -> Option<String> {
    command
        .split([';', '|', '&', '\n', '\r', '(', ')', '{', '}'])
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .find_map(|segment| {
            let tokens: Vec<String> = segment.split_whitespace().map(str::to_string).collect();
            looks_like_install(&tokens).then(|| segment.to_string())
        })
}

fn packages_for(cfg: &SandboxConfig) -> Result<Vec<String>, String> {
    let mut all: Vec<String> = BASELINE_PACKAGES
        .iter()
        .map(|name| name.to_string())
        .collect();
    for name in profile_packages(&cfg.profile)? {
        if !all.contains(&name) {
            all.push(name);
        }
    }
    for name in &cfg.packages {
        if !valid_package(name) {
            return Err(format!("package name not allowed: {name}"));
        }
        if !all.contains(name) {
            all.push(name.clone());
        }
    }
    if all.len() > MAX_PACKAGES {
        return Err(format!("too many packages (max {MAX_PACKAGES})"));
    }
    all.sort();
    Ok(all)
}

pub fn dockerfile(cfg: &SandboxConfig) -> Result<String, String> {
    let packages = packages_for(cfg)?;
    Ok(format!(
        "FROM {BASE_IMAGE}\n\
         ENV DEBIAN_FRONTEND=noninteractive\n\
         COPY requirements.txt /tmp/requirements.txt\n\
         COPY package.json package-lock.json /opt/node-tools/\n\
         COPY lo-convert /usr/local/bin/lo-convert\n\
         RUN apt-get update \\\n\
          && apt-get install -y --no-install-recommends {} \\\n\
          && rm -rf /var/lib/apt/lists/*\n\
         RUN curl -fsSLo /tmp/node.tar.xz https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.xz \\\n\
          && echo \"{NODE_SHA256}  /tmp/node.tar.xz\" | sha256sum -c - \\\n\
          && mkdir -p /opt/node20 \\\n\
          && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /opt/node20 \\\n\
          && ln -sf /opt/node20/bin/node /usr/local/bin/node \\\n\
          && ln -sf /opt/node20/bin/npm /usr/local/bin/npm \\\n\
          && ln -sf /opt/node20/bin/npx /usr/local/bin/npx \\\n\
          && rm /tmp/node.tar.xz \\\n\
          && node -e 'const major=+process.versions.node.split(\".\")[0]; if (major < 20) process.exit(1)'\n\
         RUN python3 -c 'import sys; assert sys.version_info[:2] == (3, 11), sys.version'\n\
         RUN python3 -m venv /opt/venv \\\n\
          && printf 'pip==26.2.2 --hash=sha256:fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70\\n' > /tmp/pip-lock.txt \\\n\
          && /opt/venv/bin/python -m pip install --no-cache-dir --no-deps --require-hashes -r /tmp/pip-lock.txt \\\n\
          && rm -f /tmp/pip-lock.txt \\\n\
          && /opt/venv/bin/pip install --no-cache-dir --retries 10 --timeout 60 --resume-retries 20 --require-hashes -r /tmp/requirements.txt \\\n\
          && rm -f /tmp/requirements.txt\n\
         RUN --mount=type=cache,target=/root/.npm cd /opt/node-tools && npm ci --no-audit --no-fund --fetch-retries=10 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 --fetch-timeout=600000\n\
         RUN chmod +x /usr/local/bin/lo-convert && fc-cache -f\n\
         ENV PATH=/opt/venv/bin:/opt/node20/bin:/opt/node-tools/node_modules/.bin:$PATH\n\
         ENV NODE_PATH=/opt/node-tools/node_modules\n\
         RUN useradd --create-home --uid 1000 sandbox\n\
         WORKDIR /work\n",
        packages.join(" ")
    ))
}

fn image_tag(profile: &str, packages: &[String], toolchain: &str, dockerfile: &str) -> String {
    let joined = packages.join(" ");
    let hash = digest(&[BASE_IMAGE, profile, joined.as_str(), toolchain, dockerfile]);
    format!("myagent-sandbox:{}", &hash[..16])
}

fn expected_tag(cfg: &SandboxConfig) -> Result<String, String> {
    let packages = packages_for(cfg)?;
    Ok(image_tag(
        &cfg.profile,
        &packages,
        &toolchain_digest(),
        &dockerfile(cfg)?,
    ))
}

pub async fn enable(
    app: &tauri::AppHandle,
    profile: &str,
    packages: &[String],
    project_root: Option<String>,
) -> Result<SandboxStatus, String> {
    let mut cfg = config(app);
    if let Some(root) = project_root {
        cfg.project_root = Some(root);
    }
    profile_packages(profile)?;
    cfg.profile = profile.to_string();
    cfg.packages = packages.to_vec();
    let dockerfile = dockerfile(&cfg)?;
    let root = cfg
        .project_root
        .as_ref()
        .ok_or("choose a project folder before enabling the sandbox")?;
    let root_path = std::fs::canonicalize(root).map_err(|e| format!("project folder: {e}"))?;
    if !root_path.is_dir() {
        return Err("project folder is not a directory".to_string());
    }
    let bin = docker_bin().ok_or("Docker Desktop was not found")?;
    daemon_version(&bin).await?;
    let tag = expected_tag(&cfg)?;
    if let Some((id, _)) = image_info(&bin, &tag).await {
        cfg.enabled = true;
        cfg.image = Some(id);
        cfg.image_tag = Some(tag);
        cfg.project_root = Some(host_path(&root_path));
        save(app, &cfg)?;
        return Ok(status(app).await);
    }
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data directory: {e}"))?;
    let context = data.join("sandbox-build");
    std::fs::create_dir_all(&context).map_err(|e| format!("build context: {e}"))?;
    std::fs::write(context.join("Dockerfile"), &dockerfile)
        .map_err(|e| format!("build context: {e}"))?;
    std::fs::write(context.join("requirements.txt"), PYTHON_REQUIREMENTS)
        .map_err(|e| format!("build context: {e}"))?;
    std::fs::write(context.join("package.json"), NODE_PACKAGE_JSON)
        .map_err(|e| format!("build context: {e}"))?;
    std::fs::write(context.join("package-lock.json"), NODE_PACKAGE_LOCK)
        .map_err(|e| format!("build context: {e}"))?;
    std::fs::write(context.join("lo-convert"), LO_CONVERT.replace("\r\n", "\n"))
        .map_err(|e| format!("build context: {e}"))?;
    let pull = docker_output(
        &bin,
        &["pull".into(), BASE_IMAGE.into()],
        Duration::from_secs(600),
    )
    .await?;
    if !pull.status.success() {
        return Err(format!("docker pull failed: {}", text(&pull.stderr)));
    }
    let build = docker_output(
        &bin,
        &[
            "build".into(),
            "--tag".into(),
            tag.clone(),
            context.display().to_string(),
        ],
        Duration::from_secs(1800),
    )
    .await?;
    if !build.status.success() {
        return Err(format!("docker build failed: {}", text(&build.stderr)));
    }
    let (id, _) = image_info(&bin, &tag)
        .await
        .ok_or("built image could not be inspected")?;
    let verify = docker_output(
        &bin,
        &[
            "run".into(),
            "--rm".into(),
            "--network".into(),
            "none".into(),
            "--read-only".into(),
            "--tmpfs".into(),
            "/tmp:rw,size=64m".into(),
            "--user".into(),
            "1000:1000".into(),
            "--cap-drop".into(),
            "ALL".into(),
            "--security-opt".into(),
            "no-new-privileges".into(),
            id.clone(),
            "sh".into(),
            "-c".into(),
            "command -v python3 && command -v node && command -v rg && command -v lo-convert && test -x /opt/venv/bin/python".into(),
        ],
        Duration::from_secs(120),
    )
    .await?;
    if !verify.status.success() {
        return Err(format!(
            "sandbox image failed verification: {}",
            text(&verify.stderr)
        ));
    }
    cfg.enabled = true;
    cfg.image = Some(id);
    cfg.image_tag = Some(tag);
    cfg.project_root = Some(host_path(&root_path));
    save(app, &cfg)?;
    Ok(status(app).await)
}

pub async fn disable(app: &tauri::AppHandle) -> Result<SandboxStatus, String> {
    let mut cfg = config(app);
    cfg.enabled = false;
    save(app, &cfg)?;
    Ok(status(app).await)
}

pub async fn reap_orphans() -> Result<usize, String> {
    let Some(bin) = docker_bin() else {
        return Ok(0);
    };
    let output = docker_output(
        &bin,
        &[
            "ps".into(),
            "-aq".into(),
            "--filter".into(),
            "label=myagent.sandbox=1".into(),
        ],
        Duration::from_secs(10),
    )
    .await?;
    if !output.status.success() {
        return Ok(0);
    }
    let mut removed = 0;
    for id in text(&output.stdout).split_whitespace() {
        let kill = docker_output(
            &bin,
            &["rm".into(), "-f".into(), id.to_string()],
            Duration::from_secs(20),
        )
        .await;
        if matches!(kill, Ok(out) if out.status.success()) {
            removed += 1;
        }
    }
    Ok(removed)
}

fn relative_cwd(root: &Path, cwd: &str) -> Result<String, String> {
    let requested = if cwd.trim().is_empty() || cwd == "." {
        root.to_path_buf()
    } else {
        root.join(cwd)
    };
    let resolved = std::fs::canonicalize(&requested)
        .map_err(|_| format!("working directory not found: {cwd}"))?;
    if !resolved.starts_with(root) {
        return Err("working directory must stay inside the project folder".to_string());
    }
    if !resolved.is_dir() {
        return Err("working directory is not a folder".to_string());
    }
    let rel = resolved
        .strip_prefix(root)
        .map_err(|_| "working directory escapes the project".to_string())?;
    let rel = rel.to_string_lossy().replace('\\', "/");
    Ok(if rel.is_empty() { ".".to_string() } else { rel })
}

fn host_path(path: &Path) -> String {
    let value = path.display().to_string();
    #[cfg(windows)]
    {
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    value
}

fn mount(source: &Path, target: &str) -> String {
    format!("{}:{target}", host_path(source))
}

pub fn run_args(
    cfg: &SandboxConfig,
    root: &Path,
    cwd: &str,
    command: &str,
    timeout_secs: u64,
    exec_id: &str,
    preflight: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "run".into(),
        "--rm".into(),
        "--name".into(),
        format!("myagent-{exec_id}"),
        "--label".into(),
        "myagent.sandbox=1".into(),
        "--network".into(),
        "none".into(),
        "--read-only".into(),
        "--tmpfs".into(),
        "/tmp:rw,size=256m".into(),
        "--user".into(),
        "1000:1000".into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--security-opt".into(),
        "no-new-privileges".into(),
        "--env".into(),
        "HOME=/tmp".into(),
        "--memory".into(),
        format!("{}m", cfg.memory_mb.unwrap_or(1024)),
        "--memory-swap".into(),
        format!("{}m", cfg.memory_mb.unwrap_or(1024)),
        "--cpus".into(),
        format!("{}", cfg.cpus.unwrap_or(1.0)),
        "--pids-limit".into(),
        "256".into(),
        "-v".into(),
        mount(root, "/work:rw"),
    ];
    for name in PROTECTED_DIRS {
        let path = root.join(name);
        if path.exists() {
            args.push("-v".into());
            args.push(mount(&path, &format!("/work/{name}:ro")));
        }
    }
    for name in PROTECTED_FILES {
        let path = root.join(name);
        if path.exists() {
            args.push("-v".into());
            args.push(mount(&path, &format!("/work/{name}:ro")));
        }
    }
    for (source, target) in &cfg.skill_mounts {
        args.push("-v".into());
        args.push(mount(source, target));
    }
    let workdir = if cwd == "." {
        "/work".to_string()
    } else {
        format!("/work/{cwd}")
    };
    args.push("-w".into());
    args.push(workdir);
    args.push(cfg.image.clone().unwrap_or_default());
    args.push("timeout".into());
    args.push(timeout_secs.to_string());
    args.push("sh".into());
    args.push("-c".into());
    let mut script = String::new();
    if let Some(file) = preflight {
        script.push_str(&format!(
            "test -e /work/{file} || {{ echo 'project folder not visible inside the container'; exit 97; }}; "
        ));
    }
    script.push_str(command);
    args.push(script);
    args
}

struct Placeholders(Vec<(PathBuf, bool)>);

impl Drop for Placeholders {
    fn drop(&mut self) {
        for (path, is_dir) in &self.0 {
            let _ = if *is_dir {
                std::fs::remove_dir(path)
            } else {
                std::fs::remove_file(path)
            };
        }
    }
}

fn ensure_protected(root: &Path) -> Result<Placeholders, String> {
    let mut created = Placeholders(Vec::new());
    for name in PROTECTED_DIRS {
        let path = root.join(name);
        if !path.exists() {
            std::fs::create_dir(&path).map_err(|e| format!("prepare {name}: {e}"))?;
            created.0.push((path, true));
        }
    }
    for name in PROTECTED_FILES {
        let path = root.join(name);
        if !path.exists() {
            std::fs::write(&path, []).map_err(|e| format!("prepare {name}: {e}"))?;
            created.0.push((path, false));
        }
    }
    Ok(created)
}

fn preflight_for(root: &Path) -> Option<&'static str> {
    PREFLIGHT_FILES
        .iter()
        .copied()
        .find(|name| root.join(name).exists())
}

fn git_bin() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join("git.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn git(
    args: &[String],
    root: &Path,
    env: &[(&str, String)],
) -> Result<std::process::Output, String> {
    let bin = git_bin().ok_or("git was not found")?;
    let mut command = std::process::Command::new(bin);
    command.arg("-C").arg(root).args(args);
    for (key, value) in env {
        command.env(key, value);
    }
    command
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())
}

fn checkpoint(data: &Path, root: &Path, exec_id: &str) -> Result<Option<Checkpoint>, String> {
    if git_bin().is_none() || !root.join(".git").exists() {
        return Ok(None);
    }
    let head = git(
        &["rev-parse".into(), "--verify".into(), "HEAD".into()],
        root,
        &[],
    );
    if !matches!(&head, Ok(out) if out.status.success()) {
        return Ok(None);
    }
    let index = data
        .join("sandbox-index")
        .join(format!("pre-{exec_id}.index"));
    if let Some(dir) = index.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let index_value = index.display().to_string();
    let env = [("GIT_INDEX_FILE", index_value.clone())];
    for args in [
        vec!["read-tree".to_string(), "HEAD".to_string()],
        vec!["add".to_string(), "-A".to_string()],
    ] {
        let out = git(&args, root, &env)?;
        if !out.status.success() {
            let _ = std::fs::remove_file(&index);
            return Err(format!("checkpoint failed: {}", text(&out.stderr)));
        }
    }
    let tree_out = git(&["write-tree".into()], root, &env)?;
    if !tree_out.status.success() {
        let _ = std::fs::remove_file(&index);
        return Err(format!("checkpoint failed: {}", text(&tree_out.stderr)));
    }
    let tree = text(&tree_out.stdout);
    let message = format!("pre-exec {exec_id}");
    let commit = git(
        &[
            "commit-tree".into(),
            tree.clone(),
            "-p".into(),
            "HEAD".into(),
            "-m".into(),
            message,
        ],
        root,
        &[
            ("GIT_INDEX_FILE", index_value),
            ("GIT_AUTHOR_NAME", "myagent".into()),
            ("GIT_AUTHOR_EMAIL", "myagent@localhost".into()),
            ("GIT_COMMITTER_NAME", "myagent".into()),
            ("GIT_COMMITTER_EMAIL", "myagent@localhost".into()),
        ],
    )?;
    let _ = std::fs::remove_file(&index);
    if !commit.status.success() {
        return Err(format!("checkpoint failed: {}", text(&commit.stderr)));
    }
    let commit_id = text(&commit.stdout);
    let reference = format!("refs/myagent/pre-exec/{exec_id}");
    let update = git(
        &["update-ref".into(), reference.clone(), commit_id],
        root,
        &[],
    )?;
    if !update.status.success() {
        return Err(format!("checkpoint ref failed: {}", text(&update.stderr)));
    }
    prune_checkpoints(root);
    Ok(Some(Checkpoint { reference, tree }))
}

fn best_effort_checkpoint(app: &tauri::AppHandle, root: &Path) -> Option<String> {
    let data = app.path().app_data_dir().ok()?;
    let exec_id = format!("host-{}", &uuid::Uuid::new_v4().to_string()[..12]);
    match checkpoint(&data, root, &exec_id) {
        Ok(Some(cp)) => Some(cp.reference),
        Ok(None) => None,
        Err(error) => {
            eprintln!("host checkpoint: {error}");
            None
        }
    }
}

fn prune_checkpoints(root: &Path) {
    let Ok(list) = git(
        &[
            "for-each-ref".into(),
            "--sort=creatordate".into(),
            "--format=%(refname)".into(),
            "refs/myagent/pre-exec/".into(),
        ],
        root,
        &[],
    ) else {
        return;
    };
    if !list.status.success() {
        return;
    }
    let listing = text(&list.stdout);
    let refs: Vec<&str> = listing
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if refs.len() <= CHECKPOINT_KEEP {
        return;
    }
    for reference in &refs[..refs.len() - CHECKPOINT_KEEP] {
        let _ = git(
            &["update-ref".into(), "-d".into(), reference.to_string()],
            root,
            &[],
        );
    }
}

fn tree_after(data: &Path, root: &Path, exec_id: &str) -> Option<String> {
    let index = data
        .join("sandbox-index")
        .join(format!("post-{exec_id}.index"));
    std::fs::create_dir_all(index.parent()?).ok()?;
    let value = index.display().to_string();
    let env = [("GIT_INDEX_FILE", value)];
    for args in [
        vec!["read-tree".to_string(), "HEAD".to_string()],
        vec!["add".to_string(), "-A".to_string()],
    ] {
        let out = git(&args, root, &env).ok()?;
        if !out.status.success() {
            let _ = std::fs::remove_file(&index);
            return None;
        }
    }
    let tree = git(&["write-tree".into()], root, &env).ok()?;
    let _ = std::fs::remove_file(&index);
    if !tree.status.success() {
        return None;
    }
    Some(text(&tree.stdout))
}

fn recent_project_files(root: &Path, since: std::time::SystemTime) -> Vec<String> {
    let cutoff = since.checked_sub(Duration::from_secs(2)).unwrap_or(since);
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(false)
        .git_ignore(false)
        .git_global(false)
        .git_exclude(false)
        .filter_entry(|entry| {
            !matches!(
                entry.file_name().to_string_lossy().as_ref(),
                ".git" | "node_modules" | "target" | ".venv" | "__pycache__"
            )
        });
    let mut files = Vec::new();
    for entry in builder.build().filter_map(|entry| entry.ok()).take(20_000) {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if modified < cutoff {
            continue;
        }
        let path = entry.path();
        if let Ok(rel) = path.strip_prefix(root) {
            files.push(rel.to_string_lossy().replace('\\', "/"));
            if files.len() >= 100 {
                break;
            }
        }
    }
    files
}

fn changed_between(root: &Path, base: &str, after: &str) -> Vec<String> {
    let names = git(
        &[
            "diff-tree".into(),
            "--no-commit-id".into(),
            "--name-only".into(),
            "-r".into(),
            base.to_string(),
            after.to_string(),
        ],
        root,
        &[],
    );
    let mut paths: Vec<String> = match names {
        Ok(out) if out.status.success() => text(&out.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    };
    if let Ok(raw) = git(
        &[
            "diff-tree".into(),
            "--no-commit-id".into(),
            "--raw".into(),
            "-r".into(),
            base.to_string(),
            after.to_string(),
        ],
        root,
        &[],
    ) && raw.status.success()
    {
        for line in text(&raw.stdout).lines() {
            let mut parts = line.split_whitespace();
            let _old = parts.next();
            let new_mode = parts.next().unwrap_or("");
            if new_mode == "100755"
                && let Some(path) = line.split('\t').nth(1)
            {
                paths.push(path.to_string());
            }
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

fn changed_unstaged(root: &Path) -> Vec<String> {
    let Ok(out) = git(
        &["status".into(), "--porcelain".into(), "-z".into()],
        root,
        &[],
    ) else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    let mut paths = Vec::new();
    for entry in out.stdout.split(|byte| *byte == 0) {
        if entry.len() > 3 {
            let value = String::from_utf8_lossy(&entry[3..]).to_string();
            if !value.is_empty() {
                paths.push(value);
            }
        }
    }
    paths
}

pub fn is_sensitive(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let name = normalized.rsplit('/').next().unwrap_or(&normalized);
    if name.contains(".config.") {
        return true;
    }
    if matches!(
        name,
        "package.json"
            | "package-lock.json"
            | "yarn.lock"
            | "pnpm-lock.yaml"
            | "Cargo.lock"
            | "Makefile"
            | "poetry.lock"
            | "uv.lock"
            | "go.sum"
    ) {
        return true;
    }
    if name.starts_with("requirements") && name.ends_with(".txt") {
        return true;
    }
    if name.ends_with(".sh") || name.starts_with(".env") {
        return true;
    }
    if normalized == "AGENTS.md"
        || normalized == "CLAUDE.md"
        || normalized == ".mcp.json"
        || normalized.starts_with(".git/")
        || normalized.starts_with(".vscode/")
        || normalized.starts_with(".github/")
        || normalized.starts_with(".husky/")
        || normalized.starts_with(".claude/")
        || normalized.starts_with("skills/")
        || normalized.starts_with("commands/")
    {
        return true;
    }
    false
}

fn recent_config_changes(root: &Path, since: std::time::SystemTime) -> Vec<String> {
    let threshold = since.checked_sub(Duration::from_secs(2)).unwrap_or(since);
    let mut found = Vec::new();
    for entry in walk_project(root).flatten() {
        if found.len() >= 200 {
            break;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if modified < threshold {
            continue;
        }
        let rel = display_rel(root, entry.path());
        if is_sensitive(&rel) {
            found.push(rel);
        }
    }
    found
}

fn receipt(
    data: &Path,
    root: &Path,
    exec_id: &str,
    checkpoint: Option<&Checkpoint>,
    since: Option<std::time::SystemTime>,
) -> Vec<String> {
    let paths = match checkpoint {
        Some(checkpoint) => tree_after(data, root, exec_id)
            .map(|after| changed_between(root, &checkpoint.tree, &after))
            .unwrap_or_else(|| changed_unstaged(root)),
        None => match since {
            Some(since) => recent_config_changes(root, since),
            None => changed_unstaged(root),
        },
    };
    let mut sensitive: Vec<String> = paths.into_iter().filter(|p| is_sensitive(p)).collect();
    sensitive.sort();
    sensitive.dedup();
    sensitive.truncate(50);
    sensitive
}

pub async fn run(
    app: &tauri::AppHandle,
    command: &str,
    cwd: &str,
    timeout_secs: Option<u64>,
    conversation_id: Option<&str>,
    cancel: &tokio::sync::Notify,
) -> Result<RunResult, String> {
    let mut cfg = config(app);
    if !cfg.enabled {
        return Err("sandbox is off".to_string());
    }
    cfg.skill_mounts = crate::skills::sandbox_mounts(app);
    let root = project_root(app)?;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data directory: {e}"))?;
    let result = run_inner(&cfg, &root, &data, command, cwd, timeout_secs, cancel).await?;
    let detail = serde_json::json!({
        "command": command,
        "exit": result.exit_code,
        "ms": result.duration_ms,
        "cwd": cwd,
        "checkpoint": result.checkpoint,
        "sensitive": result.sensitive,
    })
    .to_string();
    crate::tools::log_audit_meta(
        app,
        conversation_id,
        "sandbox_run",
        "allow",
        &detail,
        crate::tools::AuditMeta {
            source: "sandbox",
            duration_ms: Some(result.duration_ms),
            exit_code: Some(result.exit_code),
        },
    )
    .await;
    Ok(result)
}

pub(crate) async fn run_inner(
    cfg: &SandboxConfig,
    root: &Path,
    data: &Path,
    command: &str,
    cwd: &str,
    timeout_secs: Option<u64>,
    cancel: &tokio::sync::Notify,
) -> Result<RunResult, String> {
    if cfg.image.is_none() {
        return Err("sandbox image is not built".to_string());
    }
    let tag =
        expected_tag(cfg).map_err(|error| format!("sandbox image is out of date: {error}"))?;
    if cfg.image_tag.as_deref() != Some(tag.as_str()) {
        return Err("sandbox image is out of date; rebuild the sandbox".to_string());
    }
    if !cfg.allow_installs
        && let Some(segment) = blocked_install(command)
    {
        return Err(format!(
            "installs are blocked in the sandbox: {segment}. Turn on Allow installs for this project to run it."
        ));
    }
    let bin = docker_bin().ok_or("Docker Desktop was not found")?;
    daemon_version(&bin).await?;
    let relative = relative_cwd(root, cwd)?;
    let exec_id = uuid::Uuid::new_v4().to_string()[..12].to_string();
    let timeout_secs = timeout_secs
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .clamp(1, MAX_TIMEOUT_SECS);
    let started = std::time::Instant::now();
    let started_at = std::time::SystemTime::now();
    let checkpoint = {
        let data = data.to_path_buf();
        let root = root.to_path_buf();
        let exec_id = exec_id.clone();
        tokio::task::spawn_blocking(move || checkpoint(&data, &root, &exec_id))
            .await
            .map_err(|e| e.to_string())??
    };
    let placeholders = ensure_protected(root)?;
    let preflight = preflight_for(root);
    let args = run_args(
        cfg,
        root,
        &relative,
        command,
        timeout_secs,
        &exec_id,
        preflight,
    );
    let child = docker_command(&bin)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("docker run: {e}"))?;
    let wait = child.wait_with_output();
    tokio::pin!(wait);
    enum Stop {
        Done(std::io::Result<std::process::Output>),
        Cancelled,
        TimedOut,
    }
    let stop = tokio::select! {
        result = &mut wait => Stop::Done(result),
        _ = cancel.notified() => Stop::Cancelled,
        _ = tokio::time::sleep(Duration::from_secs(timeout_secs + 5)) => Stop::TimedOut,
    };
    let (stdout_bytes, stderr_bytes, exit_code) = match stop {
        Stop::Cancelled => {
            kill_container(&bin, &exec_id).await;
            return Err("sandbox command cancelled".to_string());
        }
        Stop::TimedOut => {
            kill_container(&bin, &exec_id).await;
            (
                Vec::new(),
                format!("sandbox command stopped after {timeout_secs}s").into_bytes(),
                124,
            )
        }
        Stop::Done(result) => {
            let output = result.map_err(|e| format!("docker run: {e}"))?;
            (
                output.stdout,
                output.stderr,
                output.status.code().unwrap_or(-1),
            )
        }
    };
    drop(placeholders);
    if exit_code == 97 && text(&stdout_bytes).contains("project folder not visible") {
        return Err("project folder not visible inside the container".to_string());
    }
    let duration_ms = started.elapsed().as_millis() as u64;
    let checkpoint_ref = checkpoint.as_ref().map(|c| c.reference.clone());
    let sensitive = {
        let data = data.to_path_buf();
        let root = root.to_path_buf();
        let exec_id = exec_id.clone();
        let tree = checkpoint.as_ref().map(|c| c.tree.clone());
        tokio::task::spawn_blocking(move || {
            let checkpoint = tree.map(|tree| Checkpoint {
                reference: String::new(),
                tree,
            });
            receipt(
                &data,
                &root,
                &exec_id,
                checkpoint.as_ref(),
                Some(started_at),
            )
        })
        .await
        .map_err(|e| e.to_string())?
    };
    let mut files: Vec<String> = if let Some(cp) = &checkpoint {
        tree_after(data, root, &exec_id)
            .map(|after| changed_between(root, &cp.tree, &after))
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    files.extend(recent_project_files(root, started_at));
    files.sort();
    files.dedup();
    let mut text_out = String::new();
    let stdout = String::from_utf8_lossy(&stdout_bytes);
    let stderr = String::from_utf8_lossy(&stderr_bytes);
    if !stdout.trim().is_empty() {
        text_out.push_str(&format!("stdout:\n{stdout}\n"));
    }
    if !stderr.trim().is_empty() {
        text_out.push_str(&format!("stderr:\n{stderr}\n"));
    }
    if !files.is_empty() {
        text_out.push_str("\ncreated files:\n");
        for file in &files {
            text_out.push_str(file);
            text_out.push('\n');
        }
    }
    Ok(RunResult {
        output: text_out,
        exit_code,
        checkpoint: checkpoint_ref,
        sensitive,
        files,
        duration_ms,
    })
}

pub fn project_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cfg = config(app);
    let root = cfg.project_root.ok_or("sandbox has no project folder")?;
    let root = std::fs::canonicalize(root).map_err(|e| format!("project folder: {e}"))?;
    if !root.is_dir() {
        return Err("project folder is not a directory".to_string());
    }
    Ok(root)
}

fn relative_path(rel: &str) -> Result<PathBuf, String> {
    let path = Path::new(rel);
    if path.is_absolute() {
        return Err("use a path relative to the project folder".to_string());
    }
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => {
                let name = part.to_string_lossy();
                if name.contains(':') || name.ends_with('.') || name.ends_with(' ') {
                    return Err("invalid path component".to_string());
                }
                out.push(part);
            }
            std::path::Component::CurDir => {}
            _ => return Err("path must stay inside the project folder".to_string()),
        }
    }
    if out.as_os_str().is_empty() {
        return Err("empty path".to_string());
    }
    Ok(out)
}

#[cfg(windows)]
fn is_reparse(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse(meta: &std::fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

fn protected_write(rel: &Path) -> bool {
    let mut parts = rel.components();
    let Some(first) = parts.next() else {
        return true;
    };
    let first = first.as_os_str().to_string_lossy();
    if PROTECTED_DIRS
        .iter()
        .any(|dir| dir.eq_ignore_ascii_case(&first))
    {
        return true;
    }
    if parts.next().is_none()
        && PROTECTED_FILES
            .iter()
            .any(|file| file.eq_ignore_ascii_case(&first))
    {
        return true;
    }
    false
}

pub fn resolve_read(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
    let root = project_root(app)?;
    read_at(&root, rel)
}

fn read_at(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = relative_path(rel)?;
    let candidate = root.join(&rel);
    let resolved =
        std::fs::canonicalize(&candidate).map_err(|_| format!("not found: {}", rel.display()))?;
    if !resolved.starts_with(root) {
        return Err("path escapes the project folder".to_string());
    }
    Ok(resolved)
}

pub fn resolve_write(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
    let root = project_root(app)?;
    write_at(&root, rel)
}

fn write_at(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = relative_path(rel)?;
    if protected_write(&rel) {
        return Err(format!("{} is protected and read-only", rel.display()));
    }
    let candidate = root.join(&rel);
    if let Ok(meta) = std::fs::symlink_metadata(&candidate)
        && is_reparse(&meta)
    {
        return Err("refusing to write through a link".to_string());
    }
    let mut anchor = candidate
        .parent()
        .ok_or("path has no parent folder")?
        .to_path_buf();
    let mut missing = Vec::new();
    while !anchor.exists() {
        let name = anchor
            .file_name()
            .ok_or("path has no existing ancestor")?
            .to_os_string();
        missing.push(name);
        anchor = anchor
            .parent()
            .ok_or("path has no existing ancestor")?
            .to_path_buf();
    }
    let resolved = std::fs::canonicalize(&anchor).map_err(|e| format!("path: {e}"))?;
    if !resolved.starts_with(root) {
        return Err("path escapes the project folder".to_string());
    }
    let mut final_path = resolved;
    for part in missing.iter().rev() {
        final_path.push(part);
    }
    if let Some(name) = candidate.file_name() {
        final_path.push(name);
    }
    if !final_path.starts_with(root) {
        return Err("path escapes the project folder".to_string());
    }
    if final_path.strip_prefix(root).is_ok_and(protected_write) {
        return Err(format!("{} is protected and read-only", rel.display()));
    }
    Ok(final_path)
}

pub fn read_file(
    app: &tauri::AppHandle,
    rel: &str,
    start: usize,
    max_chars: usize,
) -> Result<String, String> {
    let path = resolve_read(app, rel)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("read: {e}"))?;
    if bytes.contains(&0) {
        return Err("binary file; use run_powershell or sandbox_run for binary data".to_string());
    }
    let text = String::from_utf8_lossy(&bytes);
    let total = text.chars().count();
    let body: String = text.chars().skip(start).take(max_chars).collect();
    let mut out = format!("{rel} ({total} chars)\n{body}");
    if start + body.chars().count() < total {
        out.push_str(&format!(
            "\n[truncated at {} of {total} chars; call sandbox_read with start to continue]",
            start + body.chars().count()
        ));
    }
    Ok(out)
}

pub fn write_file(app: &tauri::AppHandle, rel: &str, content: &str) -> Result<String, String> {
    let path = resolve_write(app, rel)?;
    if content.len() > 2_000_000 {
        return Err("content too large (max 2 MB)".to_string());
    }
    if path.exists() {
        best_effort_checkpoint(app, &project_root(app)?);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create folder: {e}"))?;
    }
    std::fs::write(&path, content).map_err(|e| format!("write: {e}"))?;
    Ok(format!("wrote {} bytes to {rel}", content.len()))
}

pub fn edit_file(
    app: &tauri::AppHandle,
    rel: &str,
    old: &str,
    new: &str,
    replace_all: bool,
) -> Result<String, String> {
    if old.is_empty() {
        return Err("old text must not be empty".to_string());
    }
    let path = resolve_write(app, rel)?;
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read: {e}"))?;
    best_effort_checkpoint(app, &project_root(app)?);
    let count = text.matches(old).count();
    if count == 0 {
        return Err("old text was not found".to_string());
    }
    let updated = if replace_all {
        text.replace(old, new)
    } else {
        text.replacen(old, new, 1)
    };
    std::fs::write(&path, updated).map_err(|e| format!("write: {e}"))?;
    Ok(format!(
        "edited {rel}: {} replacement{}",
        if replace_all { count } else { 1 },
        if count == 1 { "" } else { "s" }
    ))
}

pub fn delete_file(app: &tauri::AppHandle, rel: &str) -> Result<String, String> {
    let path = resolve_write(app, rel)?;
    let meta = std::fs::symlink_metadata(&path).map_err(|e| format!("delete: {e}"))?;
    if is_reparse(&meta) {
        return Err("refusing to delete a link".to_string());
    }
    best_effort_checkpoint(app, &project_root(app)?);
    if meta.is_dir() {
        let empty = std::fs::read_dir(&path)
            .map_err(|e| format!("delete: {e}"))?
            .next()
            .is_none();
        if !empty {
            return Err("folder is not empty; delete its files first".to_string());
        }
        std::fs::remove_dir(&path).map_err(|e| format!("delete: {e}"))?;
    } else {
        std::fs::remove_file(&path).map_err(|e| format!("delete: {e}"))?;
    }
    Ok(format!("deleted {rel}"))
}

fn walk_project(root: &Path) -> ignore::Walk {
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .filter_entry(|entry| entry.file_name() != ".git");
    builder.build()
}

fn display_rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn glob_files(
    app: &tauri::AppHandle,
    pattern: &str,
    max_results: usize,
) -> Result<Vec<String>, String> {
    let root = project_root(app)?;
    let matcher = globset::GlobBuilder::new(pattern)
        .literal_separator(true)
        .build()
        .map_err(|e| format!("pattern: {e}"))?
        .compile_matcher();
    let match_name = !pattern.contains('/');
    let mut found = Vec::new();
    for entry in walk_project(&root).filter_map(Result::ok) {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let rel = display_rel(&root, entry.path());
        let name = entry.file_name().to_string_lossy();
        if matcher.is_match(&rel) || (match_name && matcher.is_match(name.as_ref())) {
            found.push(rel);
            if found.len() >= max_results {
                break;
            }
        }
    }
    found.sort();
    Ok(found)
}

pub fn grep_files(
    app: &tauri::AppHandle,
    pattern: &str,
    file_glob: Option<&str>,
    max_results: usize,
) -> Result<Vec<String>, String> {
    let root = project_root(app)?;
    let regex = regex::RegexBuilder::new(pattern)
        .case_insensitive(true)
        .build()
        .map_err(|e| format!("pattern: {e}"))?;
    let file_matcher = match file_glob {
        Some(glob) => Some(
            globset::GlobBuilder::new(glob)
                .literal_separator(true)
                .build()
                .map_err(|e| format!("glob: {e}"))?
                .compile_matcher(),
        ),
        None => None,
    };
    let mut found = Vec::new();
    for entry in walk_project(&root).filter_map(Result::ok) {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let rel = display_rel(&root, entry.path());
        if let Some(matcher) = &file_matcher
            && !matcher.is_match(&rel)
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        if bytes.len() > 2_000_000 || bytes.contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        for (index, line) in text.lines().enumerate() {
            if regex.is_match(line) {
                found.push(format!("{rel}:{}: {}", index + 1, line.trim_end()));
                if found.len() >= max_results {
                    return Ok(found);
                }
            }
        }
    }
    Ok(found)
}

#[derive(Debug, serde::Serialize)]
pub struct ArtifactPreview {
    pub absolute: String,
    pub images: Vec<String>,
    pub text: String,
}

const PREVIEW_PAGES: usize = 3;

pub async fn preview_file(app: &tauri::AppHandle, rel: &str) -> Result<ArtifactPreview, String> {
    use base64::Engine;
    let cfg = config(app);
    if !cfg.enabled || cfg.image.is_none() {
        return Err("Enable the sandbox to preview this file".to_string());
    }
    let tag =
        expected_tag(&cfg).map_err(|error| format!("sandbox image is out of date: {error}"))?;
    if cfg.image_tag.as_deref() != Some(tag.as_str()) {
        return Err("Sandbox image is out of date; rebuild it to preview files".to_string());
    }
    let root = project_root(app)?;
    let path = resolve_read(app, rel)?;
    let absolute = path.display().to_string();
    let relative = path
        .strip_prefix(&root)
        .map_err(|_| "preview file is outside the project".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let office = matches!(
        extension.as_str(),
        "docx" | "pptx" | "xlsx" | "odt" | "ods" | "odp"
    );
    if !office && extension != "pdf" {
        return Err("preview supports PDF, DOCX, PPTX and XLSX".to_string());
    }
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data directory: {e}"))?;
    let temp = data.join("preview").join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&temp).map_err(|e| format!("preview folder: {e}"))?;
    let bin = docker_bin().ok_or("Docker Desktop was not found")?;
    daemon_version(&bin).await?;
    let script = if office {
        "lo-convert \"$PREVIEW_FILE\" /preview pdf >/dev/null 2>&1 || exit 2; pdf=$(find /preview -maxdepth 1 -name '*.pdf' | head -n 1); test -n \"$pdf\" || exit 3; pdftocairo -png -r 120 -f 1 -l 3 \"$pdf\" /preview/page || exit 4; pdftotext -layout \"$pdf\" /preview/text.txt 2>/dev/null || true"
    } else {
        "pdftocairo -png -r 120 -f 1 -l 3 \"$PREVIEW_FILE\" /preview/page || exit 4; pdftotext -layout \"$PREVIEW_FILE\" /preview/text.txt 2>/dev/null || true"
    };
    let args: Vec<String> = vec![
        "run".into(),
        "--rm".into(),
        "--network".into(),
        "none".into(),
        "--read-only".into(),
        "--tmpfs".into(),
        "/tmp:rw,size=256m".into(),
        "--user".into(),
        "1000:1000".into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--security-opt".into(),
        "no-new-privileges".into(),
        "--env".into(),
        "HOME=/tmp".into(),
        "--env".into(),
        format!("PREVIEW_FILE=/work/{relative}"),
        "--memory".into(),
        "1024m".into(),
        "--pids-limit".into(),
        "256".into(),
        "-v".into(),
        mount(&root, "/work:ro"),
        "-v".into(),
        mount(&temp, "/preview:rw"),
        "-w".into(),
        "/work".into(),
        cfg.image.clone().unwrap_or_default(),
        "timeout".into(),
        "120".into(),
        "sh".into(),
        "-c".into(),
        script.into(),
    ];
    let output = docker_output(&bin, &args, Duration::from_secs(180)).await;
    let output = match output {
        Ok(value) => value,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&temp);
            return Err(error);
        }
    };
    if !output.status.success() {
        let detail = text(&output.stderr);
        let _ = std::fs::remove_dir_all(&temp);
        return Err(if detail.is_empty() {
            "preview conversion failed".to_string()
        } else {
            format!("preview conversion failed: {detail}")
        });
    }
    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&temp)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("png"))
        .collect();
    files.sort();
    let mut images = Vec::new();
    for file in files.into_iter().take(PREVIEW_PAGES) {
        let Ok(bytes) = std::fs::read(&file) else {
            continue;
        };
        if bytes.len() > 4 * 1024 * 1024 {
            continue;
        }
        images.push(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
    }
    let text = std::fs::read_to_string(temp.join("text.txt"))
        .unwrap_or_default()
        .chars()
        .take(8000)
        .collect();
    let _ = std::fs::remove_dir_all(&temp);
    if images.is_empty() {
        return Err("preview produced no pages".to_string());
    }
    Ok(ArtifactPreview {
        absolute,
        images,
        text,
    })
}

#[tauri::command]
pub async fn sandbox_preview(
    app: tauri::AppHandle,
    path: String,
) -> Result<ArtifactPreview, String> {
    preview_file(&app, &path).await
}

#[tauri::command]
pub async fn sandbox_status(app: tauri::AppHandle) -> Result<SandboxStatus, String> {
    Ok(status(&app).await)
}

#[tauri::command]
pub async fn sandbox_enable(
    app: tauri::AppHandle,
    profile: String,
    packages: Vec<String>,
    project_root: Option<String>,
) -> Result<SandboxStatus, String> {
    enable(&app, &profile, &packages, project_root).await
}

#[tauri::command]
pub async fn sandbox_disable(app: tauri::AppHandle) -> Result<SandboxStatus, String> {
    disable(&app).await
}

#[tauri::command]
pub async fn sandbox_rebuild(app: tauri::AppHandle) -> Result<SandboxStatus, String> {
    let cfg = config(&app);
    enable(&app, &cfg.profile, &cfg.packages, None).await
}

#[tauri::command]
pub async fn sandbox_set_allow_installs(
    app: tauri::AppHandle,
    allow: bool,
) -> Result<SandboxStatus, String> {
    let mut cfg = config(&app);
    cfg.allow_installs = allow;
    save(&app, &cfg)?;
    Ok(status(&app).await)
}

#[tauri::command]
pub async fn sandbox_reap() -> Result<usize, String> {
    reap_orphans().await
}

#[tauri::command]
pub async fn sandbox_set_limits(
    app: tauri::AppHandle,
    cpus: f32,
    memory_mb: u32,
) -> Result<SandboxStatus, String> {
    if !cpus.is_finite() || cpus <= 0.0 {
        return Err("cpus must be a positive number".to_string());
    }
    let mut cfg = config(&app);
    cfg.cpus = Some(cpus.clamp(0.5, 8.0));
    cfg.memory_mb = Some(memory_mb.clamp(256, 8192));
    save(&app, &cfg)?;
    Ok(status(&app).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> SandboxConfig {
        SandboxConfig {
            enabled: true,
            project_root: None,
            image: Some("sha256:abc".to_string()),
            image_tag: None,
            profile: "office".to_string(),
            allow_installs: false,
            packages: Vec::new(),
            cpus: Some(1.0),
            memory_mb: Some(1024),
            skill_mounts: Vec::new(),
        }
    }

    #[test]
    fn run_args_carry_the_isolation_flags() {
        let root = std::path::Path::new(r"D:\oss\demo");
        let args = run_args(
            &cfg(),
            root,
            "src",
            "python3 -c 'print(1)'",
            60,
            "exec1",
            Some("package.json"),
        );
        let joined = args.join(" ");
        for flag in [
            "--network none",
            "--read-only",
            "--user 1000:1000",
            "--cap-drop ALL",
            "--security-opt no-new-privileges",
            "--pids-limit 256",
            "--memory 1024m",
            "--memory-swap 1024m",
            "--cpus 1",
            "--tmpfs /tmp:rw,size=256m",
            "--label myagent.sandbox=1",
            "--name myagent-exec1",
        ] {
            assert!(joined.contains(flag), "missing {flag}: {joined}");
        }
        assert!(joined.contains("-w /work/src"));
        assert!(joined.contains("timeout 60 sh -c"));
        assert!(joined.contains("test -e /work/package.json"));
        assert!(
            !joined.contains("DOCKER_HOST"),
            "no secret env may be passed"
        );
    }

    #[test]
    fn run_args_mount_the_project_and_overlay_sensitive_paths() {
        let root = std::env::temp_dir().join(format!("myagent-mount-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join(".github")).unwrap();
        std::fs::write(root.join("AGENTS.md"), "x").unwrap();
        let placeholders = ensure_protected(&root).unwrap();
        let args = run_args(&cfg(), &root, ".", "true", 30, "exec2", None);
        let joined = args.join(" ");
        assert!(joined.contains(&format!("{}:/work:rw", root.display())));
        assert!(joined.contains(&format!("{}:/work/.git:ro", root.join(".git").display())));
        assert!(joined.contains(&format!(
            "{}:/work/AGENTS.md:ro",
            root.join("AGENTS.md").display()
        )));
        assert!(joined.contains(&format!(
            "{}:/work/skills:ro",
            root.join("skills").display()
        )));
        assert!(joined.contains(&format!(
            "{}:/work/.vscode:ro",
            root.join(".vscode").display()
        )));
        assert!(joined.contains(&format!(
            "{}:/work/.mcp.json:ro",
            root.join(".mcp.json").display()
        )));
        drop(placeholders);
        assert!(!root.join("skills").exists());
        assert!(!root.join(".vscode").exists());
        assert!(!root.join(".mcp.json").exists());
        assert!(root.join(".git").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn windows_path_aliases_are_rejected() {
        assert!(relative_path("AGENTS.md ").is_err());
        assert!(relative_path("src./main.rs").is_err());
        assert!(relative_path("a:b").is_err());
        assert!(relative_path(r"..\x").is_err());
        assert!(relative_path("src/main.rs").is_ok());
    }

    #[test]
    fn packages_are_validated_before_the_build() {
        let mut cfg = cfg();
        cfg.packages = vec!["ripgrep".into(), "jq".into()];
        assert!(dockerfile(&cfg).unwrap().contains("jq"));
        cfg.packages = vec!["jq; curl evil".into()];
        assert!(dockerfile(&cfg).is_err());
        cfg.packages = vec!["UPPER".into()];
        assert!(dockerfile(&cfg).is_err());
    }

    #[test]
    fn sensitive_paths_cover_config_and_hook_files() {
        for path in [
            "package.json",
            "vite.config.ts",
            ".github/workflows/ci.yml",
            ".husky/pre-commit",
            "AGENTS.md",
            ".mcp.json",
            "scripts/build.sh",
            ".env.local",
            "requirements-dev.txt",
            "pnpm-lock.yaml",
        ] {
            assert!(is_sensitive(path), "{path} should be sensitive");
        }
        for path in ["src/main.ts", "README.md", "docs/notes.md"] {
            assert!(!is_sensitive(path), "{path} should not be sensitive");
        }
    }

    #[test]
    fn relative_cwd_stays_inside_the_project() {
        let root = std::env::temp_dir().join(format!("myagent-cwd-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).unwrap();
        let root = std::fs::canonicalize(&root).unwrap();
        assert_eq!(relative_cwd(&root, ".").unwrap(), ".");
        assert_eq!(relative_cwd(&root, "src").unwrap(), "src");
        assert!(relative_cwd(&root, "..").is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn image_tags_follow_the_package_list() {
        let one = image_tag("office", &["a".to_string()], "lock1", "docker1");
        let two = image_tag("office", &["b".to_string()], "lock1", "docker1");
        let three = image_tag("core", &["a".to_string()], "lock1", "docker1");
        let four = image_tag("office", &["a".to_string()], "lock2", "docker1");
        let five = image_tag("office", &["a".to_string()], "lock1", "docker2");
        assert_ne!(one, two);
        assert_ne!(one, three);
        assert_ne!(one, four);
        assert_ne!(one, five);
        assert_eq!(
            one,
            image_tag("office", &["a".to_string()], "lock1", "docker1")
        );
        assert!(one.starts_with("myagent-sandbox:"));
    }

    #[test]
    fn installs_are_blocked_in_sandbox_commands() {
        for command in [
            "pip install pypdf",
            "pip3 install --upgrade pypdf",
            "ls; apt-get install -y jq",
            "sudo apt-get install -y jq",
            "sudo -E pip install pypdf",
            "env -i pip install pypdf",
            "FOO=1 npm install",
            "sh -c 'pip install pypdf'",
            "eval 'npm ci'",
            "xargs pip install",
            "uv add pypdf",
            "p\\ip install pypdf",
            "'pip' install pypdf",
            "python3 -m pip install pypdf",
            "npm install",
            "npm ci",
            "pnpm add sharp",
            "yarn add pdf-lib",
        ] {
            assert!(
                blocked_install(command).is_some(),
                "{command} should be blocked"
            );
        }
        for command in [
            "pip list",
            "npm run build",
            "python3 script.py",
            "apt-cache show jq",
            "git status",
        ] {
            assert!(blocked_install(command).is_none(), "{command} should run");
        }
    }

    #[test]
    fn upgrading_from_0_8_0_defaults_the_profile_and_marks_the_image_stale() {
        let old = r#"{"enabled":true,"project_root":"D:\\oss\\demo","image":"sha256:old","packages":[],"cpus":1.0,"memory_mb":1024}"#;
        let cfg: SandboxConfig = serde_json::from_str(old).unwrap();
        assert_eq!(cfg.profile, "office");
        assert!(!cfg.allow_installs);
        assert!(cfg.skill_mounts.is_empty());
        assert!(cfg.image_tag.is_none());
        let tag = expected_tag(&cfg).unwrap();
        assert_ne!(cfg.image_tag.as_deref(), Some(tag.as_str()));
    }

    #[test]
    fn profiles_select_apt_sets() {
        let core = profile_packages("core").unwrap();
        let office = profile_packages("office").unwrap();
        let full = profile_packages("full").unwrap();
        assert!(!core.contains(&"libreoffice-writer".to_string()));
        assert!(office.contains(&"libreoffice-writer".to_string()));
        assert!(full.contains(&"fonts-noto-cjk".to_string()));
        assert!(profile_packages("huge").is_err());
        let mut cfg = cfg();
        cfg.profile = "core".to_string();
        let docker = dockerfile(&cfg).unwrap();
        assert!(docker.contains("requirements.txt"));
        assert!(docker.contains("npm ci"));
        assert!(docker.contains("lo-convert"));
        assert!(docker.contains("node-v20.20.2-linux-x64.tar.xz"));
        assert!(docker.contains("sha256sum -c -"));
        assert!(docker.contains("process.versions.node"));
    }

    #[test]
    fn jail_rejects_escapes_and_protected_paths() {
        let root = std::env::temp_dir().join(format!("myagent-jail-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.txt"), "hello").unwrap();
        let root = std::fs::canonicalize(&root).unwrap();

        assert!(read_at(&root, "../outside.txt").is_err());
        assert!(read_at(&root, "src/../../outside.txt").is_err());
        assert!(read_at(&root, r"C:\Windows\win.ini").is_err());
        assert!(read_at(&root, "/etc/passwd").is_err());
        assert!(read_at(&root, "").is_err());
        assert!(read_at(&root, "src/a.txt").is_ok());

        assert!(write_at(&root, "src/b.txt").is_ok());
        assert!(write_at(&root, ".git/config").is_err());
        assert!(write_at(&root, ".github/workflows/ci.yml").is_err());
        assert!(write_at(&root, "AGENTS.md").is_err());
        assert!(write_at(&root, "skills/demo/SKILL.md").is_err());
        assert!(write_at(&root, "new/deep/file.txt").is_ok());

        let outside = std::env::temp_dir().join(format!("myagent-out-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(&outside, root.join("link")).is_ok();
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(&outside, root.join("link")).is_ok();
        if linked {
            assert!(read_at(&root, "link/secret.txt").is_err());
            assert!(write_at(&root, "link/new.txt").is_err());
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
    }

    fn it_image() -> Option<String> {
        if std::env::var("MYAGENT_SANDBOX_IT").ok().as_deref() != Some("1") {
            return None;
        }
        std::env::var("MYAGENT_SANDBOX_TEST_IMAGE").ok()
    }

    fn it_project() -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("myagent-it-{}", uuid::Uuid::new_v4()));
        let project = base.join("project");
        let data = base.join("data");
        std::fs::create_dir_all(project.join(".git/hooks")).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(project.join("package.json"), "{\"name\":\"demo\"}\n").unwrap();
        std::fs::write(project.join("AGENTS.md"), "keep\n").unwrap();
        (project, data)
    }

    fn it_config(image: &str) -> SandboxConfig {
        let mut cfg = SandboxConfig {
            enabled: true,
            project_root: None,
            image: Some(image.to_string()),
            image_tag: None,
            profile: "office".to_string(),
            allow_installs: false,
            packages: Vec::new(),
            cpus: Some(1.0),
            memory_mb: Some(512),
            skill_mounts: Vec::new(),
        };
        cfg.image_tag = expected_tag(&cfg).ok();
        cfg
    }

    #[tokio::test]
    #[ignore = "builds the toolchain image (about 1.5 GB) and runs a skill self-test"]
    async fn toolchain_image_passes_skill_doctor() {
        let bin = docker_bin().expect("docker binary");
        daemon_version(&bin).await.unwrap();
        let mut cfg = cfg();
        cfg.profile = "office".to_string();
        cfg.image = None;
        cfg.image_tag = None;
        let context =
            std::env::temp_dir().join(format!("myagent-toolchain-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&context).unwrap();
        std::fs::write(context.join("Dockerfile"), dockerfile(&cfg).unwrap()).unwrap();
        std::fs::write(context.join("requirements.txt"), PYTHON_REQUIREMENTS).unwrap();
        std::fs::write(context.join("package.json"), NODE_PACKAGE_JSON).unwrap();
        std::fs::write(context.join("package-lock.json"), NODE_PACKAGE_LOCK).unwrap();
        std::fs::write(context.join("lo-convert"), LO_CONVERT.replace("\r\n", "\n")).unwrap();
        let tag = expected_tag(&cfg).unwrap();
        let pull = docker_output(
            &bin,
            &["pull".into(), BASE_IMAGE.into()],
            Duration::from_secs(900),
        )
        .await
        .unwrap();
        assert!(pull.status.success(), "{}", text(&pull.stderr));
        let build = docker_output(
            &bin,
            &[
                "build".into(),
                "--tag".into(),
                tag.clone(),
                context.display().to_string(),
            ],
            Duration::from_secs(3600),
        )
        .await
        .unwrap();
        assert!(build.status.success(), "{}", text(&build.stderr));

        let skills = context.join("skills");
        std::fs::create_dir_all(skills.join("demo/tests")).unwrap();
        std::fs::write(
            skills.join("demo/SKILL.md"),
            "---\nid: demo\nversion: 1.0.0\n---\nFixture",
        )
        .unwrap();
        std::fs::write(
            skills.join("demo/tests/run.sh"),
            "#!/bin/sh\nset -eu\n/opt/venv/bin/python -c \"import pypdf, pdfplumber, reportlab, pptx, PIL, pandas, openpyxl\"\nnode -e \"require('pptxgenjs'); require('pdf-lib'); require('sharp')\"\ncommand -v lo-convert\nqpdf --version >/dev/null\nsoffice --version >/dev/null\necho ok > \"$OUTPUTS/ok.txt\"\n",
        )
        .unwrap();
        let info = crate::skills::SkillInfo {
            id: "demo".into(),
            name: "demo".into(),
            title: "Demo".into(),
            version: "1.0.0".into(),
            summary: "Fixture".into(),
            description: "Fixture".into(),
            source: "builtin".into(),
            enabled: true,
            directory: String::new(),
            triggers: Vec::new(),
            requires_tools: vec!["python3".into(), "qpdf".into(), "soffice".into()],
            requires_python: vec!["pypdf".into(), "pptx".into()],
            requires_node: vec!["pptxgenjs".into(), "sharp".into()],
        };
        let script = crate::skills::doctor_script(&info).unwrap();
        let run = docker_output(
            &bin,
            &[
                "run".into(),
                "--rm".into(),
                "--network".into(),
                "none".into(),
                "--read-only".into(),
                "--tmpfs".into(),
                "/tmp:rw,size=256m".into(),
                "--user".into(),
                "1000:1000".into(),
                "--cap-drop".into(),
                "ALL".into(),
                "--security-opt".into(),
                "no-new-privileges".into(),
                "--env".into(),
                "HOME=/tmp".into(),
                "-v".into(),
                format!("{}:/opt/skills:ro", skills.display()),
                tag,
                "timeout".into(),
                "180".into(),
                "sh".into(),
                "-c".into(),
                script,
            ],
            Duration::from_secs(300),
        )
        .await
        .unwrap();
        let output = format!("{}\n{}", text(&run.stdout), text(&run.stderr));
        assert!(run.status.success(), "{output}");
        assert!(!output.contains("MISSING"), "{output}");
        assert!(!output.contains("IMPORTMISS"), "{output}");
        assert!(output.contains("TEST\tOK"), "{output}");
        std::fs::remove_dir_all(&context).unwrap();
    }

    #[tokio::test]
    #[ignore]
    async fn container_has_no_network_and_no_secrets() {
        let Some(image) = it_image() else { return };
        let (project, data) = it_project();
        let root = std::fs::canonicalize(&project).unwrap();
        let cfg = it_config(&image);
        let cancel = tokio::sync::Notify::new();
        let network = run_inner(
            &cfg,
            &root,
            &data,
            "python3 -c \"import socket; socket.create_connection(('1.1.1.1', 80), 2)\"",
            ".",
            Some(20),
            &cancel,
        )
        .await
        .unwrap();
        assert_ne!(network.exit_code, 0, "network must be unreachable");
        let env = run_inner(&cfg, &root, &data, "env", ".", Some(20), &cancel)
            .await
            .unwrap();
        assert!(env.output.contains("HOME=/tmp"));
        let lowered = env.output.to_lowercase();
        assert!(
            !lowered.contains("api_key"),
            "no host key may enter the container"
        );
        assert!(
            !lowered.contains("token="),
            "no host token may enter the container"
        );
        let host = run_inner(
            &cfg,
            &root,
            &data,
            "cat /proc/self/environ",
            ".",
            Some(20),
            &cancel,
        )
        .await
        .unwrap();
        let lowered = host.output.to_lowercase();
        assert!(!lowered.contains("api_key"));
        assert!(!lowered.contains("token="));
        std::fs::remove_dir_all(project.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    #[ignore]
    async fn protected_paths_stay_read_only_inside_the_container() {
        let Some(image) = it_image() else { return };
        let (project, data) = it_project();
        let root = std::fs::canonicalize(&project).unwrap();
        let cfg = it_config(&image);
        let cancel = tokio::sync::Notify::new();
        let result = run_inner(
            &cfg,
            &root,
            &data,
            "echo pwned > .git/hooks/pre-commit; echo pwned > AGENTS.md",
            ".",
            Some(20),
            &cancel,
        )
        .await
        .unwrap();
        assert_ne!(result.exit_code, 0);
        assert!(!project.join(".git/hooks/pre-commit").exists());
        assert_eq!(
            std::fs::read_to_string(project.join("AGENTS.md")).unwrap(),
            "keep\n"
        );
        std::fs::remove_dir_all(project.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    #[ignore]
    async fn checkpoint_restores_untracked_files_after_mass_delete() {
        let Some(image) = it_image() else { return };
        let (project, data) = it_project();
        let git = git_bin().unwrap();
        std::process::Command::new(&git)
            .args(["-C", project.to_str().unwrap(), "init", "-q"])
            .status()
            .unwrap();
        std::fs::write(project.join("tracked.txt"), "tracked\n").unwrap();
        std::process::Command::new(&git)
            .args(["-C", project.to_str().unwrap(), "add", "-A"])
            .status()
            .unwrap();
        std::process::Command::new(&git)
            .args([
                "-C",
                project.to_str().unwrap(),
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@localhost",
                "commit",
                "-qm",
                "init",
            ])
            .status()
            .unwrap();
        std::fs::write(project.join("untracked.txt"), "precious\n").unwrap();
        let root = std::fs::canonicalize(&project).unwrap();
        let cfg = it_config(&image);
        let cancel = tokio::sync::Notify::new();
        let result = run_inner(
            &cfg,
            &root,
            &data,
            "find . -mindepth 1 -maxdepth 1 ! -name .git ! -name AGENTS.md -exec rm -rf {} +",
            ".",
            Some(30),
            &cancel,
        )
        .await
        .unwrap();
        let checkpoint = result.checkpoint.expect("checkpoint ref");
        let remaining: Vec<String> = std::fs::read_dir(&project)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(remaining.len(), 2, "unexpected survivors: {remaining:?}");
        assert!(remaining.contains(&".git".to_string()));
        assert!(remaining.contains(&"AGENTS.md".to_string()));
        std::process::Command::new(&git)
            .args([
                "-C",
                project.to_str().unwrap(),
                "checkout",
                &checkpoint,
                "--",
                ".",
            ])
            .status()
            .unwrap();
        let restored = std::fs::read_to_string(project.join("untracked.txt")).unwrap();
        assert_eq!(restored.trim(), "precious");
        std::fs::remove_dir_all(project.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    #[ignore]
    async fn timeout_kills_the_container() {
        let Some(image) = it_image() else { return };
        let (project, data) = it_project();
        let root = std::fs::canonicalize(&project).unwrap();
        let cfg = it_config(&image);
        let cancel = tokio::sync::Notify::new();
        let started = std::time::Instant::now();
        let result = run_inner(&cfg, &root, &data, "sleep 60", ".", Some(2), &cancel)
            .await
            .unwrap();
        assert_eq!(result.exit_code, 124, "timeout must terminate the command");
        assert!(started.elapsed() < Duration::from_secs(20));
        std::fs::remove_dir_all(project.parent().unwrap()).unwrap();
    }

    #[tokio::test]
    #[ignore]
    async fn sensitive_receipt_lists_package_json() {
        let Some(image) = it_image() else { return };
        let (project, data) = it_project();
        let git = git_bin().unwrap();
        std::process::Command::new(&git)
            .args(["-C", project.to_str().unwrap(), "init", "-q"])
            .status()
            .unwrap();
        std::process::Command::new(&git)
            .args(["-C", project.to_str().unwrap(), "add", "-A"])
            .status()
            .unwrap();
        std::process::Command::new(&git)
            .args([
                "-C",
                project.to_str().unwrap(),
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@localhost",
                "commit",
                "-qm",
                "init",
            ])
            .status()
            .unwrap();
        let root = std::fs::canonicalize(&project).unwrap();
        let cfg = it_config(&image);
        let cancel = tokio::sync::Notify::new();
        let result = run_inner(
            &cfg,
            &root,
            &data,
            "echo '{\"name\":\"changed\"}' > package.json",
            ".",
            Some(20),
            &cancel,
        )
        .await
        .unwrap();
        assert!(result.sensitive.iter().any(|path| path == "package.json"));
        std::fs::remove_dir_all(project.parent().unwrap()).unwrap();
    }
}
