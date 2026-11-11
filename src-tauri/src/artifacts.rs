use std::collections::{HashSet, VecDeque};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::http::{Request, Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext};

const MAX_ARTIFACT_BYTES: usize = 2 * 1024 * 1024;
const MAX_ARTIFACTS: usize = 16;
const MAX_ZIP_ARTIFACTS: usize = 64;
const MAX_ZIP_BYTES: usize = 16 * 1024 * 1024;
const CSP: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src 'none'; worker-src blob:; form-action 'none'; base-uri 'none'; frame-src 'self'";

#[derive(Debug, Deserialize)]
pub struct ArtifactZipEntry {
    name: String,
    content: String,
}

fn invisible(value: char) -> bool {
    value.is_control()
        || matches!(
            value,
            '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
        )
}

fn reserved_stem(stem: &str) -> bool {
    let lower = stem.to_ascii_lowercase();
    lower == "con"
        || lower == "prn"
        || lower == "aux"
        || lower == "nul"
        || ["com", "lpt"].iter().any(|prefix| {
            lower.strip_prefix(prefix).is_some_and(|rest| {
                rest.len() == 1 && ('1'..='9').contains(&rest.chars().next().unwrap_or('0'))
            })
        })
}

fn zip_entry_name(raw: &str, index: usize, used: &mut HashSet<String>) -> String {
    let leaf = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let cleaned = leaf
        .chars()
        .map(|value| {
            if invisible(value)
                || matches!(value, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                ' '
            } else {
                value
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(['.', ' '])
        .chars()
        .take(100)
        .collect::<String>();
    let base = if cleaned.is_empty() {
        format!("artifact-{}", index + 1)
    } else {
        cleaned
    };
    let (stem, extension) = match base.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => {
            (stem.to_string(), format!(".{extension}"))
        }
        _ => (base, String::new()),
    };
    let stem = if reserved_stem(&stem) {
        format!("artifact-{stem}")
    } else {
        stem
    };
    let mut candidate = format!("{stem}{extension}");
    let mut suffix = 2;
    while !used.insert(candidate.to_ascii_lowercase()) {
        candidate = format!("{stem}-{suffix}{extension}");
        suffix += 1;
    }
    candidate
}

#[tauri::command]
pub fn artifact_zip_export(
    destination: String,
    entries: Vec<ArtifactZipEntry>,
) -> Result<usize, String> {
    if entries.is_empty() || entries.len() > MAX_ZIP_ARTIFACTS {
        return Err(format!("artifact zip needs 1-{MAX_ZIP_ARTIFACTS} versions"));
    }
    let bytes = entries
        .iter()
        .map(|entry| entry.content.len())
        .sum::<usize>();
    if bytes > MAX_ZIP_BYTES
        || entries
            .iter()
            .any(|entry| entry.content.len() > MAX_ARTIFACT_BYTES)
    {
        return Err("artifact zip is too large".to_string());
    }
    let path = PathBuf::from(destination);
    if path.as_os_str().is_empty() || path.is_dir() {
        return Err("choose a zip file destination".to_string());
    }
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        return Err("choose a .zip file destination".to_string());
    }
    let parent = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let temp = parent.join(format!(".myagent-{}.zip.part", uuid::Uuid::new_v4()));
    let written = write_zip(&temp, &entries);
    if let Err(error) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }
    std::fs::rename(&temp, &path).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        format!("save zip: {error}")
    })?;
    Ok(entries.len())
}

fn write_zip(path: &std::path::Path, entries: &[ArtifactZipEntry]) -> Result<(), String> {
    let file = std::fs::File::create(path).map_err(|error| format!("create zip: {error}"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut used = HashSet::new();
    for (index, entry) in entries.iter().enumerate() {
        let name = zip_entry_name(&entry.name, index, &mut used);
        archive
            .start_file(name, options)
            .map_err(|error| format!("start zip entry: {error}"))?;
        archive
            .write_all(entry.content.as_bytes())
            .map_err(|error| format!("write zip entry: {error}"))?;
    }
    archive
        .finish()
        .map_err(|error| format!("finish zip: {error}"))?;
    Ok(())
}

const SHELL: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html, body { margin: 0; width: 100%; height: 100%; background: #fff; }
iframe { display: block; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<iframe id="artifact-frame" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" referrerpolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'"></iframe>
<script>
const artifact = __ARTIFACT__;
document.getElementById("artifact-frame").srcdoc = artifact;
</script>
</body>
</html>"#;

const INLINE_BASE_STYLE: &str = r#"<style>
:root {
  color-scheme: dark;
  --myagent-bg: #232220;
  --myagent-card: #2b2a27;
  --myagent-raised: #32312d;
  --myagent-fg: #ebe8e2;
  --myagent-muted: #b4afa6;
  --myagent-border: rgba(255, 248, 235, 0.12);
  --myagent-accent: oklch(0.55 0.14 38);
  --myagent-accent-text: oklch(0.78 0.12 38);
  --myagent-accent-soft: oklch(0.7 0.14 38 / 0.16);
  --myagent-success: #6cc48a;
  --myagent-warning: #e6b055;
  --myagent-danger: #f0757c;
  --myagent-info: #7db1f0;
  --myagent-radius: 12px;
  --myagent-font: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
}
html {
  background: transparent;
}
body {
  visibility: hidden;
  margin: 0;
  background: var(--myagent-bg);
  color: var(--myagent-fg);
  font-family: var(--myagent-font);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
</style>"#;

const INLINE_REPORTER: &str = r#"<script>
(function () {
  var last = 0;
  var revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    if (document.body) document.body.style.visibility = "";
  }
  function report() {
    var root = document.documentElement;
    var body = document.body;
    var height = Math.max(root ? root.scrollHeight : 0, body ? body.scrollHeight : 0);
    height = Math.max(80, Math.min(2000, Math.round(height)));
    if (Math.abs(height - last) < 2) return;
    last = height;
    parent.postMessage({ type: "myagent:height", height: height }, "*");
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "myagent:theme" || !data.tokens) return;
    var root = document.documentElement;
    if (data.mode === "light" || data.mode === "dark") {
      root.style.colorScheme = data.mode;
    }
    Object.keys(data.tokens).forEach(function (name) {
      var value = data.tokens[name];
      if (typeof value === "string" && /^[\w#'"(),.%\/\s-]{1,120}$/.test(value)) {
        root.style.setProperty(name, value);
      }
    });
    reveal();
    report();
  });
  window.addEventListener("load", report);
  window.addEventListener("resize", report);
  if (window.ResizeObserver && document.body) {
    new ResizeObserver(report).observe(document.body);
  }
  setTimeout(report, 50);
  setTimeout(report, 400);
  setTimeout(reveal, 300);
})();
</script>"#;

pub struct ArtifactStore {
    entries: Mutex<VecDeque<(String, String)>>,
}

impl Default for ArtifactStore {
    fn default() -> Self {
        Self {
            entries: Mutex::new(VecDeque::new()),
        }
    }
}

impl ArtifactStore {
    fn put(&self, html: &str) -> Result<String, String> {
        if html.trim().is_empty() {
            return Err("artifact is empty".to_string());
        }
        if html.len() > MAX_ARTIFACT_BYTES {
            return Err("artifact is larger than 2 MB".to_string());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "artifact store is unavailable".to_string())?;
        entries.push_back((id.clone(), html.to_string()));
        while entries.len() > MAX_ARTIFACTS {
            entries.pop_front();
        }
        Ok(id)
    }

    fn get(&self, id: &str) -> Result<Option<String>, String> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| "artifact store is unavailable".to_string())?;
        Ok(entries
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, html)| html.clone()))
    }

    fn remove(&self, id: &str) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        entries.retain(|(key, _)| key != id);
    }
}

fn shell(html: &str) -> Result<String, String> {
    let json =
        serde_json::to_string(html).map_err(|error| format!("artifact encoding: {error}"))?;
    let json = json
        .replace('<', "\\u003c")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    Ok(SHELL.replace("__ARTIFACT__", &json))
}

fn secure_headers(builder: tauri::http::response::Builder) -> tauri::http::response::Builder {
    builder
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("Content-Security-Policy", CSP)
        .header(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-write=()",
        )
}

fn build_response(status: StatusCode, body: Vec<u8>) -> Response<Vec<u8>> {
    secure_headers(Response::builder())
        .status(status)
        .body(body)
        .unwrap_or_else(|_| Response::new(b"artifact preview failed".to_vec()))
}

fn shell_response(html: &str) -> Response<Vec<u8>> {
    match shell(html) {
        Ok(body) => build_response(StatusCode::OK, body.into_bytes()),
        Err(error) => {
            eprintln!("artifact preview: {error}");
            build_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                b"artifact preview failed".to_vec(),
            )
        }
    }
}

fn with_base_style(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    if let Some(start) = lower.find("<head")
        && let Some(offset) = html[start..].find('>')
    {
        let at = start + offset + 1;
        return format!("{}{}{}", &html[..at], INLINE_BASE_STYLE, &html[at..]);
    }
    if let Some(start) = lower.find("<body")
        && let Some(offset) = html[start..].find('>')
    {
        let at = start + offset + 1;
        return format!("{}{}{}", &html[..at], INLINE_BASE_STYLE, &html[at..]);
    }
    format!("{INLINE_BASE_STYLE}{html}")
}

fn inline_html(html: &str) -> String {
    let styled = with_base_style(html);
    let lower = styled.to_ascii_lowercase();
    match lower.rfind("</body>") {
        Some(index) => format!(
            "{}{}{}",
            &styled[..index],
            INLINE_REPORTER,
            &styled[index..]
        ),
        None => format!("{styled}{INLINE_REPORTER}"),
    }
}

fn inline_response(html: &str) -> Response<Vec<u8>> {
    build_response(StatusCode::OK, inline_html(html).into_bytes())
}

fn internal_error() -> Response<Vec<u8>> {
    build_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        b"artifact preview failed".to_vec(),
    )
}

fn not_found() -> Response<Vec<u8>> {
    build_response(StatusCode::NOT_FOUND, b"artifact not found".to_vec())
}

fn requested_id(path: &str) -> Option<&str> {
    path.strip_prefix("/s/")
        .filter(|id| !id.is_empty() && !id.contains('/'))
}

pub fn serve<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let path = request.uri().path();
    if let Some(id) = path
        .strip_prefix("/i/")
        .filter(|id| !id.is_empty() && !id.contains('/'))
    {
        return match ctx.app_handle().state::<ArtifactStore>().get(id) {
            Ok(Some(html)) => inline_response(&html),
            Ok(None) => not_found(),
            Err(_) => internal_error(),
        };
    }
    let Some(id) = requested_id(path) else {
        return not_found();
    };
    match ctx.app_handle().state::<ArtifactStore>().get(id) {
        Ok(Some(html)) => shell_response(&html),
        Ok(None) => not_found(),
        Err(_) => internal_error(),
    }
}

#[derive(serde::Serialize)]
pub struct ArtifactPreviewHandle {
    pub id: String,
    pub url: String,
}

#[tauri::command]
pub fn artifact_preview_url(
    app: tauri::AppHandle,
    html: String,
) -> Result<ArtifactPreviewHandle, String> {
    let id = app.state::<ArtifactStore>().put(&html)?;
    Ok(ArtifactPreviewHandle {
        url: format!("http://artifact.localhost/s/{id}"),
        id,
    })
}

#[tauri::command]
pub fn artifact_inline_url(
    app: tauri::AppHandle,
    html: String,
) -> Result<ArtifactPreviewHandle, String> {
    let id = app.state::<ArtifactStore>().put(&html)?;
    Ok(ArtifactPreviewHandle {
        url: format!("http://artifact.localhost/i/{id}"),
        id,
    })
}

#[tauri::command]
pub fn artifact_preview_drop(app: tauri::AppHandle, id: String) {
    app.state::<ArtifactStore>().remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn header_value(response: &Response<Vec<u8>>, name: &str) -> String {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string()
    }

    #[test]
    fn store_keeps_only_the_latest_artifacts() {
        let store = ArtifactStore::default();
        for index in 0..(MAX_ARTIFACTS + 2) {
            store.put(&format!("<h1>{index}</h1>")).unwrap();
        }
        let entries = store.entries.lock().unwrap();
        assert_eq!(entries.len(), MAX_ARTIFACTS);
        assert_eq!(
            entries.back().unwrap().1,
            format!("<h1>{}</h1>", MAX_ARTIFACTS + 1)
        );
    }

    #[test]
    fn store_rejects_empty_and_oversized_artifacts() {
        let store = ArtifactStore::default();
        assert!(store.put(" ").is_err());
        assert!(store.put(&"x".repeat(MAX_ARTIFACT_BYTES + 1)).is_err());
    }

    #[test]
    fn shell_escapes_markup_that_could_close_the_script() {
        let body = shell("</script><script>alert(1)</script>").unwrap();
        assert!(!body.contains("</script><script>alert(1)</script>"));
        assert!(body.contains("\\u003c/script"));
        assert!(body.contains("sandbox=\"allow-scripts allow-forms"));
        assert!(!body.contains("allow-same-origin"));
    }

    #[test]
    fn shell_response_allows_cdn_assets_but_keeps_network_and_forms_closed() {
        let response = shell_response("<h1>ok</h1>");
        assert_eq!(response.status(), StatusCode::OK);
        let csp = header_value(&response, "content-security-policy");
        assert!(csp.contains("connect-src 'none'"));
        assert!(csp.contains("form-action 'none'"));
        assert!(csp.contains("script-src 'unsafe-inline' 'unsafe-eval' https:"));
        assert!(csp.contains("img-src data: blob: https:"));
        assert!(csp.contains("default-src 'none'"));
        assert_eq!(header_value(&response, "cache-control"), "no-store");
    }

    #[test]
    fn artifact_frames_deny_device_capture_and_geolocation() {
        let response = shell_response("<h1>ok</h1>");
        assert_eq!(
            header_value(&response, "permissions-policy"),
            "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-write=()"
        );
        let body = shell("<h1>ok</h1>").unwrap();
        assert!(body.contains(
            "allow=\"camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'\""
        ));
        assert!(!body.contains("allow-same-origin"));
    }

    #[test]
    fn unknown_artifacts_are_not_found() {
        assert_eq!(not_found().status(), StatusCode::NOT_FOUND);
        assert_eq!(requested_id("/s/"), None);
        assert_eq!(requested_id("/s/a/b"), None);
        assert_eq!(requested_id("/x/abc"), None);
        assert_eq!(requested_id("/s/abc"), Some("abc"));
    }

    #[test]
    fn csp_blocks_external_frames_but_keeps_the_srcdoc_frame() {
        let csp = header_value(&shell_response("<h1>ok</h1>"), "content-security-policy");
        assert!(csp.contains("frame-src 'self'"));
        assert!(!csp.contains("frame-src 'none'"));
    }

    #[test]
    fn inline_html_injects_the_reporter_before_body() {
        let html = inline_html("<html><body><p>x</p></body></html>");
        let reporter = html.find(INLINE_REPORTER).expect("reporter present");
        let body = html.find("</body>").expect("body present");
        assert!(reporter < body);
        assert!(html.contains("myagent:height"));
        assert!(html.contains("myagent:theme"));
        assert!(html.contains(r#".%\/\s-"#));
    }

    #[test]
    fn inline_html_appends_the_reporter_without_a_body() {
        let html = inline_html("<h1>x</h1>");
        assert!(html.ends_with(INLINE_REPORTER));
    }

    #[test]
    fn inline_html_adds_theme_defaults_before_the_page_styles() {
        let styled = inline_html(
            "<html><head><style>body { color: red }</style></head><body><p>x</p></body></html>",
        );
        let base = styled.find(INLINE_BASE_STYLE).expect("base style present");
        let page = styled.find("color: red").expect("page style present");
        assert!(base < page);
        assert!(styled.contains("--myagent-accent"));
        assert!(styled.contains("visibility: hidden"));

        let fragment = inline_html("<h1>x</h1>");
        assert!(fragment.starts_with(INLINE_BASE_STYLE));

        let no_head = inline_html("<body class=\"x\"><p>y</p></body>");
        let base = no_head.find(INLINE_BASE_STYLE).expect("base style present");
        let body = no_head.find("<p>y</p>").expect("content present");
        assert!(base < body);
    }

    #[test]
    fn inline_response_keeps_the_artifact_csp() {
        let response = inline_response("<h1>ok</h1>");
        assert_eq!(response.status(), StatusCode::OK);
        let csp = header_value(&response, "content-security-policy");
        assert!(csp.contains("connect-src 'none'"));
        assert!(csp.contains("script-src 'unsafe-inline' 'unsafe-eval' https:"));
        assert!(csp.contains("default-src 'none'"));
    }

    #[test]
    fn zip_export_writes_every_version_with_safe_unique_names() {
        let path = std::env::temp_dir().join(format!(
            "myagent-artifact-versions-{}.zip",
            uuid::Uuid::new_v4()
        ));
        let count = artifact_zip_export(
            path.to_string_lossy().to_string(),
            vec![
                ArtifactZipEntry {
                    name: "../Page.html".to_string(),
                    content: "<h1>one</h1>".to_string(),
                },
                ArtifactZipEntry {
                    name: "Page.html".to_string(),
                    content: "<h1>two</h1>".to_string(),
                },
            ],
        )
        .expect("zip export");
        assert_eq!(count, 2);

        let file = std::fs::File::open(&path).expect("open zip");
        let mut archive = zip::ZipArchive::new(file).expect("read zip");
        assert_eq!(archive.len(), 2);
        assert_eq!(archive.by_index(0).expect("first").name(), "Page.html");
        assert_eq!(archive.by_index(1).expect("second").name(), "Page-2.html");
        let mut content = String::new();
        archive
            .by_name("Page-2.html")
            .expect("named entry")
            .read_to_string(&mut content)
            .expect("entry text");
        assert_eq!(content, "<h1>two</h1>");
        drop(archive);
        std::fs::remove_file(&path).expect("remove zip");
    }

    #[test]
    fn zip_entry_names_avoid_device_stems_and_invisible_characters() {
        let mut used = HashSet::new();
        assert_eq!(
            zip_entry_name("CON.html", 0, &mut used),
            "artifact-CON.html"
        );
        assert_eq!(zip_entry_name("LPT9", 1, &mut used), "artifact-LPT9");
        assert_eq!(
            zip_entry_name("invoice\u{202e}exe.html", 2, &mut used),
            "invoice exe.html"
        );
        assert_eq!(zip_entry_name("console.html", 3, &mut used), "console.html");
    }

    #[test]
    fn zip_export_requires_a_zip_destination_and_keeps_the_old_file_on_error() {
        let dir =
            std::env::temp_dir().join(format!("myagent-artifact-dest-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        assert!(
            artifact_zip_export(
                dir.join("versions.html").to_string_lossy().to_string(),
                vec![ArtifactZipEntry {
                    name: "a.html".to_string(),
                    content: "<h1>a</h1>".to_string(),
                }],
            )
            .is_err()
        );

        let path = dir.join("versions.zip");
        std::fs::write(&path, "keep me").expect("seed file");
        let result = artifact_zip_export(
            path.to_string_lossy().to_string(),
            vec![ArtifactZipEntry {
                name: "a.html".to_string(),
                content: "<h1>a</h1>".to_string(),
            }],
        );
        assert!(result.is_ok());
        let entries = std::fs::read_dir(&dir)
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .count();
        assert_eq!(entries, 1, "no .part file is left behind");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn zip_export_rejects_empty_and_oversized_sets() {
        let path = std::env::temp_dir()
            .join(format!(
                "myagent-artifact-empty-{}.zip",
                uuid::Uuid::new_v4()
            ))
            .to_string_lossy()
            .to_string();
        assert!(artifact_zip_export(path.clone(), Vec::new()).is_err());
        let entries = (0..=MAX_ZIP_ARTIFACTS)
            .map(|index| ArtifactZipEntry {
                name: format!("{index}.txt"),
                content: String::new(),
            })
            .collect();
        assert!(artifact_zip_export(path, entries).is_err());
    }
}
