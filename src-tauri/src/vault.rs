use keyring::Entry;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.abdul.myagent";

fn entry(key: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, key).map_err(|e| AppError::Vault(e.to_string()))
}

pub fn set_secret(key: &str, secret: &str) -> AppResult<()> {
    entry(key)?
        .set_password(secret)
        .map_err(|e| AppError::Vault(e.to_string()))
}

pub fn read_secret(key: &str) -> AppResult<Option<String>> {
    match entry(key)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Vault(e.to_string())),
    }
}

pub fn delete_secret(key: &str) -> AppResult<()> {
    match entry(key)?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Vault(e.to_string())),
    }
}

#[tauri::command]
pub fn set_api_key(connection_id: String, api_key: String) -> AppResult<()> {
    set_secret(&connection_id, &api_key)
}

#[tauri::command]
pub fn has_api_key(connection_id: String) -> AppResult<bool> {
    Ok(read_secret(&connection_id)?.is_some())
}

#[tauri::command]
pub fn api_key_hint(connection_id: String) -> AppResult<Option<String>> {
    Ok(read_secret(&connection_id)?.map(|secret| crate::websearch::mask_key(&secret)))
}

#[tauri::command]
pub fn delete_api_key(connection_id: String) -> AppResult<()> {
    delete_secret(&connection_id)
}

pub fn get_api_key(connection_id: &str) -> AppResult<String> {
    entry(connection_id)?
        .get_password()
        .map_err(|e| AppError::Vault(e.to_string()))
}

pub fn read_api_key(connection_id: &str) -> AppResult<Option<String>> {
    read_secret(connection_id)
}
