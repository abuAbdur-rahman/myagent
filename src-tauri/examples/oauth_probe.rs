use std::sync::Mutex;

use rmcp::transport::auth::{
    AuthError, AuthorizationRequest, CredentialStore, OAuthState, StoredCredentials,
};

#[derive(Default)]
struct MemoryStore {
    value: Mutex<Option<StoredCredentials>>,
}

#[async_trait::async_trait]
impl CredentialStore for MemoryStore {
    async fn load(&self) -> Result<Option<StoredCredentials>, AuthError> {
        Ok(self.value.lock().expect("store").clone())
    }

    async fn save(&self, credentials: StoredCredentials) -> Result<(), AuthError> {
        *self.value.lock().expect("store") = Some(credentials);
        Ok(())
    }

    async fn clear(&self) -> Result<(), AuthError> {
        *self.value.lock().expect("store") = None;
        Ok(())
    }

    async fn on_refresh_token_rejected(
        &self,
        _credentials: &StoredCredentials,
    ) -> Result<(), AuthError> {
        Ok(())
    }
}

#[tokio::main]
async fn main() {
    let url = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "https://mcp.airtable.com/mcp".to_string());
    let redirect = "http://127.0.0.1:49152/callback";
    let mut state = match OAuthState::new(&url, None).await {
        Ok(state) => state,
        Err(error) => {
            println!("new failed: {error}");
            return;
        }
    };
    match &mut state {
        OAuthState::Unauthorized(manager) => {
            manager.set_credential_store(MemoryStore::default());
        }
        _ => {
            println!("state not unauthorized");
            return;
        }
    }
    let request = AuthorizationRequest::new(redirect)
        .with_client_name("MyAgent")
        .with_application_type("native");
    if let Err(error) = state.start_authorization(request).await {
        println!("start failed: {error}");
        return;
    }
    match state.get_authorization_url().await {
        Ok(url) => println!("authorization url: {url}"),
        Err(error) => println!("url failed: {error}"),
    }
}
