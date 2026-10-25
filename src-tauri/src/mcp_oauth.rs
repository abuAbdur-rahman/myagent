use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rmcp::transport::auth::{
    AuthError, AuthorizationManager, AuthorizationRequest, CredentialStore, OAuthState,
    StoredCredentials,
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

const OAUTH_KEY_PREFIX: &str = "mcp-oauth";
const CHUNK_CHARS: usize = 1000;
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

fn is_loopback_host(url: &reqwest::Url) -> bool {
    match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false),
        None => false,
    }
}

fn validate_oauth_resource(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|e| format!("mcp url rejected: {e}"))?;
    if url.scheme() == "https" {
        crate::webfetch::validate_url_opts(raw, true, false)
            .map_err(|e| format!("mcp url rejected: {e}"))?;
        return Ok(url);
    }
    if url.scheme() == "http" && is_loopback_host(&url) {
        crate::webfetch::validate_url_opts(raw, true, true)
            .map_err(|e| format!("mcp url rejected: {e}"))?;
        return Ok(url);
    }
    Err("mcp oauth requires https, except loopback http".to_string())
}

fn validate_authorization_url(raw: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(raw).map_err(|e| format!("authorization url is invalid: {e}"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("authorization url has credentials".to_string());
    }
    if url.scheme() == "https" || (url.scheme() == "http" && is_loopback_host(&url)) {
        return Ok(());
    }
    Err("authorization url is not https".to_string())
}

fn base_key(server_id: &str) -> String {
    format!("{OAUTH_KEY_PREFIX}:{server_id}")
}

struct CredentialManifest {
    generation: Option<String>,
    count: usize,
}

fn manifest(generation: &str, count: usize) -> String {
    format!("v2:{generation}:{count}")
}

fn parse_count(value: &str) -> Option<usize> {
    value.parse().ok().filter(|count| *count <= 1024)
}

fn parse_manifest(value: &str) -> Option<CredentialManifest> {
    if let Some(rest) = value.strip_prefix("v1:") {
        return parse_count(rest).map(|count| CredentialManifest {
            generation: None,
            count,
        });
    }
    let rest = value.strip_prefix("v2:")?;
    let (generation, count) = rest.split_once(':')?;
    if generation.is_empty() || !generation.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    parse_count(count).map(|count| CredentialManifest {
        generation: Some(generation.to_string()),
        count,
    })
}

fn chunk_key(server_id: &str, generation: Option<&str>, index: usize) -> String {
    match generation {
        Some(generation) => format!("{}:chunk:{generation}:{index}", base_key(server_id)),
        None => format!("{}:chunk:{index}", base_key(server_id)),
    }
}

fn read_manifest(server_id: &str) -> Result<Option<CredentialManifest>, String> {
    let Some(value) = crate::vault::read_secret(&base_key(server_id)).map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    parse_manifest(&value)
        .map(Some)
        .ok_or_else(|| "oauth credential manifest is invalid".to_string())
}

fn clear_chunks(server_id: &str, generation: Option<&str>, count: usize) -> Result<(), String> {
    for index in 0..count {
        crate::vault::delete_secret(&chunk_key(server_id, generation, index))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn clear_orphan_chunks(server_id: &str) -> Result<(), String> {
    for index in 0..1024 {
        match crate::vault::read_secret(&chunk_key(server_id, None, index)) {
            Ok(Some(_)) => {
                crate::vault::delete_secret(&chunk_key(server_id, None, index))
                    .map_err(|e| e.to_string())?;
            }
            Ok(None) => return Ok(()),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn blob_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    static BLOB_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    BLOB_LOCK
        .lock()
        .map_err(|_| "oauth credential store is poisoned".to_string())
}

fn save_blob(server_id: &str, bytes: &[u8]) -> Result<(), String> {
    let _guard = blob_lock()?;
    let encoded = BASE64.encode(bytes);
    let chunks: Vec<&[u8]> = encoded.as_bytes().chunks(CHUNK_CHARS).collect();
    let generation = uuid::Uuid::new_v4().simple().to_string();
    let previous = match read_manifest(server_id) {
        Ok(previous) => previous,
        Err(error) => {
            eprintln!("mcp oauth: replacing invalid credential manifest: {error}");
            if let Err(cleanup) = clear_orphan_chunks(server_id) {
                eprintln!("mcp oauth: orphan chunk cleanup failed: {cleanup}");
            }
            None
        }
    };
    let write = (|| -> Result<(), String> {
        for (index, chunk) in chunks.iter().enumerate() {
            let text = std::str::from_utf8(chunk).map_err(|e| e.to_string())?;
            crate::vault::set_secret(&chunk_key(server_id, Some(&generation), index), text)
                .map_err(|e| e.to_string())?;
        }
        crate::vault::set_secret(&base_key(server_id), &manifest(&generation, chunks.len()))
            .map_err(|e| e.to_string())
    })();
    if let Err(error) = write {
        if let Err(cleanup) = clear_chunks(server_id, Some(&generation), chunks.len()) {
            eprintln!("mcp oauth: new credential cleanup failed: {cleanup}");
        }
        return Err(error);
    }
    if let Some(previous) = previous
        && let Err(cleanup) =
            clear_chunks(server_id, previous.generation.as_deref(), previous.count)
    {
        eprintln!("mcp oauth: old credential cleanup failed: {cleanup}");
    }
    Ok(())
}

fn load_blob(server_id: &str) -> Result<Option<Vec<u8>>, String> {
    let _guard = blob_lock()?;
    let Some(manifest) = read_manifest(server_id)? else {
        return Ok(None);
    };
    let mut encoded = String::new();
    for index in 0..manifest.count {
        let chunk =
            crate::vault::read_secret(&chunk_key(server_id, manifest.generation.as_deref(), index))
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "oauth credential is incomplete".to_string())?;
        encoded.push_str(&chunk);
    }
    BASE64
        .decode(encoded.as_bytes())
        .map(Some)
        .map_err(|e| format!("oauth credential is invalid: {e}"))
}

fn clear_blob(server_id: &str) -> Result<(), String> {
    let _guard = blob_lock()?;
    match read_manifest(server_id) {
        Ok(Some(manifest)) => {
            clear_chunks(server_id, manifest.generation.as_deref(), manifest.count)?;
        }
        Ok(None) => {}
        Err(error) => {
            eprintln!("mcp oauth: clearing invalid credential manifest: {error}");
            if let Err(cleanup) = clear_orphan_chunks(server_id) {
                eprintln!("mcp oauth: orphan chunk cleanup failed: {cleanup}");
            }
        }
    }
    crate::vault::delete_secret(&base_key(server_id)).map_err(|e| e.to_string())
}

pub fn has_credentials(server_id: &str) -> bool {
    match load_blob(server_id) {
        Ok(Some(bytes)) => serde_json::from_slice::<StoredCredentials>(&bytes).is_ok(),
        Ok(None) => false,
        Err(error) => {
            eprintln!("mcp oauth: credential lookup failed for {server_id}: {error}");
            false
        }
    }
}

pub fn clear_credentials(server_id: &str) -> Result<(), String> {
    clear_blob(server_id)
}

#[derive(Clone)]
struct VaultCredentialStore {
    server_id: String,
}

impl VaultCredentialStore {
    fn new(server_id: &str) -> Self {
        Self {
            server_id: server_id.to_string(),
        }
    }
}

#[async_trait::async_trait]
impl CredentialStore for VaultCredentialStore {
    async fn load(&self) -> Result<Option<StoredCredentials>, AuthError> {
        let bytes = load_blob(&self.server_id).map_err(AuthError::CredentialStoreError)?;
        match bytes {
            Some(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|e| AuthError::CredentialStoreError(e.to_string())),
            None => Ok(None),
        }
    }

    async fn save(&self, credentials: StoredCredentials) -> Result<(), AuthError> {
        let bytes = serde_json::to_vec(&credentials)
            .map_err(|e| AuthError::CredentialStoreError(e.to_string()))?;
        save_blob(&self.server_id, &bytes).map_err(AuthError::CredentialStoreError)
    }

    async fn clear(&self) -> Result<(), AuthError> {
        clear_blob(&self.server_id).map_err(AuthError::CredentialStoreError)
    }

    async fn on_refresh_token_rejected(
        &self,
        _credentials: &StoredCredentials,
    ) -> Result<(), AuthError> {
        self.clear().await
    }
}

fn auth_error(error: AuthError) -> String {
    match error {
        AuthError::AuthorizationRequired => "authorization required".to_string(),
        AuthError::TokenRefreshRejected(_) => "authorization expired; reconnect".to_string(),
        other => other.to_string(),
    }
}

fn stored_access_token(server_id: &str) -> Result<Option<String>, String> {
    #[derive(serde::Deserialize)]
    struct TokenFields {
        access_token: String,
        #[serde(default)]
        expires_in: Option<u64>,
    }

    #[derive(serde::Deserialize)]
    struct StoredToken {
        token_response: Option<TokenFields>,
        #[serde(default)]
        token_received_at: Option<u64>,
    }

    let Some(bytes) = load_blob(server_id)? else {
        return Ok(None);
    };
    let stored: StoredToken =
        serde_json::from_slice(&bytes).map_err(|e| format!("oauth credential is invalid: {e}"))?;
    let Some(token) = stored.token_response else {
        return Ok(None);
    };
    let received = stored.token_received_at.unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let fresh = match token.expires_in {
        Some(expires) => now.saturating_sub(received) + 30 < expires,
        None => true,
    };
    if fresh {
        Ok(Some(token.access_token))
    } else {
        Ok(None)
    }
}

pub async fn access_token(server_id: &str, url: &str) -> Result<String, String> {
    validate_oauth_resource(url)?;
    if let Some(token) = stored_access_token(server_id)? {
        return Ok(token);
    }
    let mut manager = AuthorizationManager::new(url).await.map_err(auth_error)?;
    manager.set_credential_store(VaultCredentialStore::new(server_id));
    if !manager.initialize_from_store().await.map_err(auth_error)? {
        return Err("authorization required".to_string());
    }
    let token = manager.get_access_token().await.map_err(auth_error)?;
    if token.is_empty() {
        return Err("authorization required".to_string());
    }
    Ok(token)
}

struct ActiveAuth {
    generation: u64,
    sender: oneshot::Sender<()>,
}

static CANCELS: OnceLock<tokio::sync::Mutex<HashMap<String, ActiveAuth>>> = OnceLock::new();
static NEXT_AUTH: AtomicU64 = AtomicU64::new(1);

fn cancels() -> &'static tokio::sync::Mutex<HashMap<String, ActiveAuth>> {
    CANCELS.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}

pub async fn cancel(server_id: &str) -> Result<(), String> {
    if let Some(active) = cancels().lock().await.remove(server_id) {
        let _ = active.sender.send(());
    }
    Ok(())
}

pub async fn authorize(server_id: &str, url: &str) -> Result<(), String> {
    validate_oauth_resource(url)?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("could not start the oauth callback listener: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("could not read the callback address: {e}"))?;
    let redirect_uri = format!("http://127.0.0.1:{}/callback", addr.port());
    let generation = NEXT_AUTH.fetch_add(1, Ordering::Relaxed);
    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let mut guard = cancels().lock().await;
        if guard.contains_key(server_id) {
            return Err("authorization already in progress".to_string());
        }
        guard.insert(
            server_id.to_string(),
            ActiveAuth {
                generation,
                sender: cancel_tx,
            },
        );
    }
    let result = tokio::select! {
        _ = cancel_rx => Err("authorization cancelled".to_string()),
        result = tokio::time::timeout(
            CALLBACK_TIMEOUT,
            run_authorization(server_id, url, &redirect_uri, listener),
        ) => match result {
            Ok(result) => result,
            Err(_) => Err("timed out waiting for the browser".to_string()),
        },
    };
    {
        let mut guard = cancels().lock().await;
        if guard.get(server_id).map(|active| active.generation) == Some(generation) {
            guard.remove(server_id);
        }
    }
    result
}

async fn probe_challenge(url: &str) -> Option<String> {
    let client = match reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            eprintln!("mcp oauth: challenge client failed: {error}");
            return None;
        }
    };
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "MyAgent",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    });
    match client
        .post(url)
        .header(
            reqwest::header::ACCEPT,
            "application/json, text/event-stream",
        )
        .json(&body)
        .send()
        .await
    {
        Ok(response) => {
            if response.status() != reqwest::StatusCode::UNAUTHORIZED {
                return None;
            }
            response
                .headers()
                .get(reqwest::header::WWW_AUTHENTICATE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string)
        }
        Err(error) => {
            eprintln!("mcp oauth: challenge probe failed: {error}");
            None
        }
    }
}

async fn run_authorization(
    server_id: &str,
    url: &str,
    redirect_uri: &str,
    listener: TcpListener,
) -> Result<(), String> {
    let mut state = OAuthState::new(url, None).await.map_err(auth_error)?;
    match &mut state {
        OAuthState::Unauthorized(manager) => {
            manager.set_credential_store(VaultCredentialStore::new(server_id));
        }
        _ => return Err("oauth state is not ready".to_string()),
    }
    let mut request = AuthorizationRequest::new(redirect_uri)
        .with_client_name("MyAgent")
        .with_application_type("native");
    if let Some(challenge) = probe_challenge(url).await {
        request = request.with_challenge(challenge);
    }
    state
        .start_authorization(request)
        .await
        .map_err(auth_error)?;
    let auth_url = state.get_authorization_url().await.map_err(auth_error)?;
    validate_authorization_url(&auth_url)?;
    tauri_plugin_opener::open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("could not open the browser: {e}"))?;
    let callback_url = wait_for_callback(listener, redirect_uri).await?;
    state
        .handle_callback_url(&callback_url)
        .await
        .map_err(auth_error)?;
    let manager = state
        .into_authorization_manager()
        .ok_or_else(|| "authorization did not complete".to_string())?;
    manager.get_access_token().await.map_err(auth_error)?;
    if !has_credentials(server_id) {
        return Err("authorization did not store credentials".to_string());
    }
    Ok(())
}

async fn wait_for_callback(listener: TcpListener, redirect_uri: &str) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + CALLBACK_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("timed out waiting for the browser".to_string());
        }
        let (mut socket, _) = tokio::time::timeout(remaining, listener.accept())
            .await
            .map_err(|_| "timed out waiting for the browser".to_string())?
            .map_err(|e| format!("callback listener failed: {e}"))?;
        let target = {
            let mut reader = tokio::io::BufReader::new((&mut socket).take(8192));
            let mut line = String::new();
            let read =
                tokio::time::timeout(Duration::from_secs(10), reader.read_line(&mut line)).await;
            match read {
                Ok(Ok(read)) if read > 0 && line.ends_with('\n') => {
                    line.split_whitespace().nth(1).unwrap_or("/").to_string()
                }
                Ok(Ok(_)) => {
                    respond(&mut socket, 400, "Bad request").await;
                    continue;
                }
                Ok(Err(error)) => {
                    eprintln!("mcp oauth: callback read failed: {error}");
                    continue;
                }
                Err(_) => {
                    eprintln!("mcp oauth: callback read timed out");
                    continue;
                }
            }
        };
        if !target.starts_with("/callback") {
            respond(&mut socket, 404, "Not found").await;
            continue;
        }
        if let Some(error) = callback_error(&target) {
            respond(&mut socket, 200, &format!("Authorization failed: {error}")).await;
            return Err(format!("authorization failed: {error}"));
        }
        respond(
            &mut socket,
            200,
            "Authorization complete. You can close this window.",
        )
        .await;
        let base = redirect_uri.trim_end_matches("/callback");
        return Ok(format!("{base}{target}"));
    }
}

fn callback_error(target: &str) -> Option<String> {
    let query = target.split_once('?')?.1;
    let mut error = None;
    let mut description = None;
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        match key.as_ref() {
            "error" => error = Some(value.into_owned()),
            "error_description" => description = Some(value.into_owned()),
            _ => {}
        }
    }
    error.map(|code| {
        description
            .map(|detail| format!("{code}: {detail}"))
            .unwrap_or(code)
    })
}

async fn respond(socket: &mut TcpStream, status: u16, message: &str) {
    let reason = if status == 200 { "OK" } else { "Not Found" };
    let body = format!(
        "<!doctype html><html><body><p>{}</p></body></html>",
        html_escape(message)
    );
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    if let Err(error) = socket.write_all(response.as_bytes()).await {
        eprintln!("mcp oauth: callback response failed: {error}");
        return;
    }
    if let Err(error) = socket.shutdown().await {
        eprintln!("mcp oauth: callback shutdown failed: {error}");
    }
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_error_reads_error_and_description() {
        let target = "/callback?error=access_denied&error_description=User%20cancelled";
        assert_eq!(
            callback_error(target),
            Some("access_denied: User cancelled".to_string())
        );
        assert_eq!(callback_error("/callback?code=abc&state=xyz"), None);
        assert_eq!(callback_error("/callback"), None);
    }

    #[test]
    fn manifest_round_trips() {
        let parsed = parse_manifest(&manifest("abc123", 3)).expect("v2 manifest");
        assert_eq!(parsed.generation.as_deref(), Some("abc123"));
        assert_eq!(parsed.count, 3);
        let legacy = parse_manifest("v1:0").expect("legacy manifest");
        assert_eq!(legacy.generation, None);
        assert_eq!(legacy.count, 0);
        assert!(parse_manifest("v2:3").is_none());
        assert!(parse_manifest("nonsense").is_none());
        assert!(parse_manifest("v1:1025").is_none());
        assert!(parse_manifest("v2:abc:1025").is_none());
    }

    #[test]
    fn chunk_keys_are_stable() {
        assert_eq!(base_key("s1"), "mcp-oauth:s1");
        assert_eq!(chunk_key("s1", None, 2), "mcp-oauth:s1:chunk:2");
        assert_eq!(chunk_key("s1", Some("abc"), 2), "mcp-oauth:s1:chunk:abc:2");
    }

    #[test]
    fn oauth_resource_requires_https_or_loopback() {
        assert!(validate_oauth_resource("https://mcp.example.com/mcp").is_ok());
        assert!(validate_oauth_resource("https://mcp.example.com:8443/mcp").is_ok());
        assert!(validate_oauth_resource("http://127.0.0.1:8080/mcp").is_ok());
        assert!(validate_oauth_resource("http://localhost:8080/mcp").is_ok());
        assert!(validate_oauth_resource("http://mcp.example.com/mcp").is_err());
        assert!(validate_oauth_resource("https://127.0.0.1/mcp").is_err());
        assert!(validate_oauth_resource("file:///tmp/mcp").is_err());
    }

    #[test]
    fn authorization_url_rejects_unsafe_schemes() {
        assert!(validate_authorization_url("https://auth.example.com/authorize").is_ok());
        assert!(validate_authorization_url("http://127.0.0.1:9000/authorize").is_ok());
        assert!(validate_authorization_url("myagent://callback").is_err());
        assert!(validate_authorization_url("file:///tmp/authorize").is_err());
        assert!(validate_authorization_url("https://user:pass@auth.example.com").is_err());
    }

    #[test]
    fn html_escapes_callback_text() {
        assert_eq!(
            html_escape("<script>alert(\"x\")</script>"),
            "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
        );
    }
}
