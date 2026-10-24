use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rmcp::transport::auth::{
    AuthError, AuthorizationManager, AuthorizationRequest, CredentialStore, OAuthState,
    StoredCredentials,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

const OAUTH_KEY_PREFIX: &str = "mcp-oauth";
const CHUNK_CHARS: usize = 1000;
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

fn base_key(server_id: &str) -> String {
    format!("{OAUTH_KEY_PREFIX}:{server_id}")
}

fn chunk_key(server_id: &str, index: usize) -> String {
    format!("{}:chunk:{index}", base_key(server_id))
}

fn manifest(count: usize) -> String {
    format!("v1:{count}")
}

fn parse_manifest(value: &str) -> Option<usize> {
    value.strip_prefix("v1:")?.parse().ok()
}

fn read_manifest(server_id: &str) -> Result<Option<usize>, String> {
    let Some(value) = crate::vault::read_secret(&base_key(server_id)).map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    parse_manifest(&value)
        .map(Some)
        .ok_or_else(|| "oauth credential manifest is invalid".to_string())
}

fn clear_chunks(server_id: &str, count: usize) -> Result<(), String> {
    for index in 0..count {
        crate::vault::delete_secret(&chunk_key(server_id, index)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn clear_orphan_chunks(server_id: &str) -> Result<(), String> {
    for index in 0..1024 {
        match crate::vault::read_secret(&chunk_key(server_id, index)) {
            Ok(Some(_)) => {
                crate::vault::delete_secret(&chunk_key(server_id, index))
                    .map_err(|e| e.to_string())?;
            }
            Ok(None) => return Ok(()),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn save_blob(server_id: &str, bytes: &[u8]) -> Result<(), String> {
    let encoded = BASE64.encode(bytes);
    let chunks: Vec<&[u8]> = encoded.as_bytes().chunks(CHUNK_CHARS).collect();
    match read_manifest(server_id) {
        Ok(Some(old)) => clear_chunks(server_id, old)?,
        Ok(None) => {}
        Err(error) => {
            eprintln!("mcp oauth: replacing invalid credential manifest: {error}");
            if let Err(cleanup) = clear_orphan_chunks(server_id) {
                eprintln!("mcp oauth: orphan chunk cleanup failed: {cleanup}");
            }
        }
    }
    crate::vault::set_secret(&base_key(server_id), &manifest(chunks.len()))
        .map_err(|e| e.to_string())?;
    for (index, chunk) in chunks.iter().enumerate() {
        let text = std::str::from_utf8(chunk).map_err(|e| e.to_string())?;
        crate::vault::set_secret(&chunk_key(server_id, index), text).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn load_blob(server_id: &str) -> Result<Option<Vec<u8>>, String> {
    let Some(count) = read_manifest(server_id)? else {
        return Ok(None);
    };
    let mut encoded = String::new();
    for index in 0..count {
        let chunk = crate::vault::read_secret(&chunk_key(server_id, index))
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
    match read_manifest(server_id) {
        Ok(Some(count)) => clear_chunks(server_id, count)?,
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

static CANCELS: OnceLock<tokio::sync::Mutex<HashMap<String, oneshot::Sender<()>>>> =
    OnceLock::new();

fn cancels() -> &'static tokio::sync::Mutex<HashMap<String, oneshot::Sender<()>>> {
    CANCELS.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}

pub async fn cancel(server_id: &str) -> Result<(), String> {
    if let Some(sender) = cancels().lock().await.remove(server_id) {
        let _ = sender.send(());
    }
    Ok(())
}

pub async fn authorize(server_id: &str, url: &str) -> Result<(), String> {
    crate::webfetch::validate_url_opts(url, true, false)
        .map_err(|e| format!("mcp url rejected: {e}"))?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("could not start the oauth callback listener: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("could not read the callback address: {e}"))?;
    let redirect_uri = format!("http://127.0.0.1:{}/callback", addr.port());
    let (cancel_tx, cancel_rx) = oneshot::channel();
    cancels()
        .lock()
        .await
        .insert(server_id.to_string(), cancel_tx);
    let result = run_authorization(server_id, url, &redirect_uri, listener, cancel_rx).await;
    cancels().lock().await.remove(server_id);
    result
}

async fn probe_challenge(url: &str) -> Option<String> {
    let client = match reqwest::Client::builder()
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
    cancel_rx: oneshot::Receiver<()>,
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
    tauri_plugin_opener::open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("could not open the browser: {e}"))?;
    let callback_url = wait_for_callback(listener, redirect_uri, cancel_rx).await?;
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

async fn wait_for_callback(
    listener: TcpListener,
    redirect_uri: &str,
    mut cancel_rx: oneshot::Receiver<()>,
) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + CALLBACK_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("timed out waiting for the browser".to_string());
        }
        let accepted = tokio::select! {
            _ = &mut cancel_rx => return Err("authorization cancelled".to_string()),
            accepted = tokio::time::timeout(remaining, listener.accept()) => accepted,
        };
        let (mut socket, _) = accepted
            .map_err(|_| "timed out waiting for the browser".to_string())?
            .map_err(|e| format!("callback listener failed: {e}"))?;
        let mut buf = [0u8; 8192];
        let read = tokio::time::timeout(Duration::from_secs(10), socket.read(&mut buf)).await;
        let read = match read {
            Ok(Ok(read)) => read,
            Ok(Err(error)) => {
                eprintln!("mcp oauth: callback read failed: {error}");
                continue;
            }
            Err(_) => {
                eprintln!("mcp oauth: callback read timed out");
                continue;
            }
        };
        let request = String::from_utf8_lossy(&buf[..read]);
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("/");
        if !target.starts_with("/callback") {
            respond(&mut socket, 404, "Not found").await;
            continue;
        }
        if let Some(error) = callback_error(target) {
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
        assert_eq!(parse_manifest(&manifest(3)), Some(3));
        assert_eq!(parse_manifest("v1:0"), Some(0));
        assert_eq!(parse_manifest("v2:3"), None);
        assert_eq!(parse_manifest("nonsense"), None);
    }

    #[test]
    fn chunk_keys_are_stable() {
        assert_eq!(base_key("s1"), "mcp-oauth:s1");
        assert_eq!(chunk_key("s1", 2), "mcp-oauth:s1:chunk:2");
    }

    #[test]
    fn html_escapes_callback_text() {
        assert_eq!(
            html_escape("<script>alert(\"x\")</script>"),
            "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
        );
    }
}
