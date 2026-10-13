use keyring::Entry;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.abdul.myagent";

fn entry(connection_id: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, connection_id).map_err(|e| AppError::Vault(e.to_string()))
}

#[tauri::command]
pub fn set_api_key(connection_id: String, api_key: String) -> AppResult<()> {
    entry(&connection_id)?
        .set_password(&api_key)
        .map_err(|e| AppError::Vault(e.to_string()))
}

#[tauri::command]
pub fn has_api_key(connection_id: String) -> AppResult<bool> {
    match entry(&connection_id)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(AppError::Vault(e.to_string())),
    }
}

#[tauri::command]
pub fn delete_api_key(connection_id: String) -> AppResult<()> {
    match entry(&connection_id)?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Vault(e.to_string())),
    }
}

pub fn get_api_key(connection_id: &str) -> AppResult<String> {
    entry(connection_id)?
        .get_password()
        .map_err(|e| AppError::Vault(e.to_string()))
}
