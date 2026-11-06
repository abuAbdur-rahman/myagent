use std::collections::VecDeque;
use std::sync::Mutex;

use tauri::http::{Request, Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext};

const MAX_ARTIFACT_BYTES: usize = 2 * 1024 * 1024;
const MAX_ARTIFACTS: usize = 8;
const CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'self' data: blob:";

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
<iframe id="artifact-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'"></iframe>
<script>
const artifact = __ARTIFACT__;
document.getElementById("artifact-frame").srcdoc = artifact;
</script>
</body>
</html>"#;

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
            "camera=(), microphone=(), geolocation=(), clipboard-write=()",
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

fn internal_error() -> Response<Vec<u8>> {
    build_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        b"artifact preview failed".to_vec(),
    )
}

fn not_found() -> Response<Vec<u8>> {
    build_response(StatusCode::NOT_FOUND, b"artifact not found".to_vec())
}

pub fn serve<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let path = request.uri().path();
    let Some(id) = path.strip_prefix("/s/") else {
        return not_found();
    };
    match ctx.app_handle().state::<ArtifactStore>().get(id) {
        Ok(Some(html)) => shell_response(&html),
        Ok(None) => not_found(),
        Err(_) => internal_error(),
    }
}

#[tauri::command]
pub fn artifact_preview_url(app: tauri::AppHandle, html: String) -> Result<String, String> {
    let id = app.state::<ArtifactStore>().put(&html)?;
    Ok(format!("https://artifact.localhost/s/{id}"))
}

#[tauri::command]
pub fn artifact_preview_drop(app: tauri::AppHandle, id: String) {
    app.state::<ArtifactStore>().remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(entries.back().unwrap().1, "<h1>9</h1>");
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
        assert!(body.contains("sandbox=\"allow-scripts\""));
    }

    #[test]
    fn shell_response_locks_down_network_and_ipc() {
        let response = shell_response("<h1>ok</h1>");
        assert_eq!(response.status(), StatusCode::OK);
        let csp = header_value(&response, "content-security-policy");
        assert!(csp.contains("connect-src 'none'"));
        assert!(csp.contains("script-src 'unsafe-inline'"));
        assert!(csp.contains("default-src 'none'"));
        assert_eq!(header_value(&response, "cache-control"), "no-store");
    }

    #[test]
    fn unknown_artifacts_are_not_found() {
        assert_eq!(not_found().status(), StatusCode::NOT_FOUND);
    }
}
