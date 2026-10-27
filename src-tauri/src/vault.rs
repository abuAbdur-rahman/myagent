use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use keyring::Entry;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.abdul.myagent";
const MAX_PROVIDER_KEYS: usize = 10;
const KEY_COOLDOWN: Duration = Duration::from_secs(10 * 60);

static KEY_COOLDOWNS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

fn cooldowns() -> &'static Mutex<HashMap<String, Instant>> {
    KEY_COOLDOWNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cooldown_key(connection_id: &str, key: &str) -> String {
    format!("{connection_id}\u{1f}{key}")
}

fn cooldown_remaining(connection_id: &str, key: &str) -> Option<u64> {
    let id = cooldown_key(connection_id, key);
    let mut guard = cooldowns().lock().unwrap_or_else(|e| e.into_inner());
    let deadline = *guard.get(&id)?;
    let now = Instant::now();
    if deadline <= now {
        guard.remove(&id);
        None
    } else {
        Some((deadline - now).as_secs().max(1))
    }
}

pub fn mark_provider_key_exhausted(connection_id: &str, key: &str) {
    cooldowns()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            cooldown_key(connection_id, key),
            Instant::now() + KEY_COOLDOWN,
        );
}

fn clear_connection_cooldowns(connection_id: &str) {
    let prefix = format!("{connection_id}\u{1f}");
    cooldowns()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|id, _| !id.starts_with(&prefix));
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderKeyInfo {
    pub index: usize,
    pub hint: String,
    pub cooldown_secs: Option<u64>,
}

fn parse_provider_keys(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.starts_with('[') {
        return serde_json::from_str::<Vec<String>>(trimmed)
            .unwrap_or_default()
            .into_iter()
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty())
            .collect();
    }
    if trimmed.is_empty() {
        Vec::new()
    } else {
        vec![trimmed.to_string()]
    }
}

fn store_provider_keys(connection_id: &str, keys: &[String]) -> AppResult<()> {
    match keys {
        [] => delete_secret(connection_id),
        [key] => set_secret(connection_id, key),
        _ => {
            let raw = serde_json::to_string(keys).map_err(|e| AppError::Vault(e.to_string()))?;
            set_secret(connection_id, &raw)
        }
    }
}

pub fn read_provider_keys(connection_id: &str) -> AppResult<Vec<String>> {
    Ok(read_secret(connection_id)?
        .map(|raw| parse_provider_keys(&raw))
        .unwrap_or_default())
}

pub fn first_available_provider_key(connection_id: &str) -> AppResult<Option<String>> {
    let keys = read_provider_keys(connection_id)?;
    for key in keys {
        if cooldown_remaining(connection_id, &key).is_none() {
            return Ok(Some(key));
        }
    }
    Ok(None)
}

fn next_available_key(
    keys: &[String],
    current: &str,
    mut available: impl FnMut(&str) -> bool,
) -> Option<String> {
    if keys.is_empty() {
        return None;
    }
    let start = keys
        .iter()
        .position(|key| key == current)
        .map(|index| (index + 1) % keys.len())
        .unwrap_or(0);
    for offset in 0..keys.len() {
        let key = &keys[(start + offset) % keys.len()];
        if available(key) {
            return Some(key.clone());
        }
    }
    None
}

pub fn next_provider_key(connection_id: &str, current: &str) -> AppResult<Option<String>> {
    let keys = read_provider_keys(connection_id)?;
    Ok(next_available_key(&keys, current, |key| {
        cooldown_remaining(connection_id, key).is_none()
    }))
}

pub fn earliest_provider_key_cooldown(connection_id: &str) -> AppResult<Option<u64>> {
    let keys = read_provider_keys(connection_id)?;
    Ok(keys
        .iter()
        .filter_map(|key| cooldown_remaining(connection_id, key))
        .min())
}

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
    let key = api_key.trim().to_string();
    clear_connection_cooldowns(&connection_id);
    if key.is_empty() {
        delete_secret(&connection_id)
    } else {
        set_secret(&connection_id, &key)
    }
}

#[tauri::command]
pub fn add_provider_key(connection_id: String, api_key: String) -> AppResult<usize> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err(AppError::Vault("empty provider key".to_string()));
    }
    let mut keys = read_provider_keys(&connection_id)?;
    if !keys.iter().any(|existing| existing == key) {
        if keys.len() >= MAX_PROVIDER_KEYS {
            return Err(AppError::Vault(format!(
                "at most {MAX_PROVIDER_KEYS} provider keys"
            )));
        }
        keys.push(key.to_string());
    }
    store_provider_keys(&connection_id, &keys)?;
    Ok(keys.len())
}

#[tauri::command]
pub fn remove_provider_key(connection_id: String, index: usize) -> AppResult<usize> {
    let mut keys = read_provider_keys(&connection_id)?;
    if index >= keys.len() {
        return Err(AppError::Vault(
            "no provider key at that position".to_string(),
        ));
    }
    let removed = keys.remove(index);
    cooldowns()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&cooldown_key(&connection_id, &removed));
    store_provider_keys(&connection_id, &keys)?;
    Ok(keys.len())
}

#[tauri::command]
pub fn provider_key_hints(connection_id: String) -> AppResult<Vec<ProviderKeyInfo>> {
    let keys = read_provider_keys(&connection_id)?;
    Ok(keys
        .into_iter()
        .enumerate()
        .map(|(index, key)| ProviderKeyInfo {
            index,
            hint: crate::websearch::mask_key(&key),
            cooldown_secs: cooldown_remaining(&connection_id, &key),
        })
        .collect())
}

#[tauri::command]
pub fn has_api_key(connection_id: String) -> AppResult<bool> {
    Ok(!read_provider_keys(&connection_id)?.is_empty())
}

#[tauri::command]
pub fn api_key_hint(connection_id: String) -> AppResult<Option<String>> {
    Ok(read_provider_keys(&connection_id)?
        .first()
        .map(|secret| crate::websearch::mask_key(secret)))
}

#[tauri::command]
pub fn delete_api_key(connection_id: String) -> AppResult<()> {
    clear_connection_cooldowns(&connection_id);
    delete_secret(&connection_id)
}

pub fn get_api_key(connection_id: &str) -> AppResult<String> {
    read_provider_keys(connection_id)?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Vault("no API key stored".to_string()))
}

pub fn read_api_key(connection_id: &str) -> AppResult<Option<String>> {
    Ok(read_provider_keys(connection_id)?.into_iter().next())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_single_key_and_a_json_list() {
        assert_eq!(parse_provider_keys("sk-one"), vec!["sk-one"]);
        assert_eq!(
            parse_provider_keys(r#"["sk-one", " sk-two ", ""]"#),
            vec!["sk-one", "sk-two"]
        );
        assert!(parse_provider_keys("   ").is_empty());
    }

    #[test]
    fn rotation_skips_cooling_keys_and_wraps() {
        let keys = vec![
            "sk-one".to_string(),
            "sk-two".to_string(),
            "sk-three".to_string(),
        ];
        assert_eq!(
            next_available_key(&keys, "sk-one", |key| key != "sk-two"),
            Some("sk-three".to_string())
        );
        assert_eq!(
            next_available_key(&keys, "sk-three", |key| key != "sk-two"),
            Some("sk-one".to_string())
        );
        assert_eq!(
            next_available_key(&keys, "sk-one", |key| key != "sk-one" && key != "sk-two"),
            Some("sk-three".to_string())
        );
        assert_eq!(next_available_key(&keys, "sk-one", |_| false), None);
    }
}
