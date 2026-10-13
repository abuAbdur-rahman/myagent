use std::fmt;

#[derive(Debug, serde::Serialize)]
pub enum AppError {
    Vault(String),
    Network(String),
    Upstream(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Vault(m) => write!(f, "vault error: {m}"),
            AppError::Network(m) => write!(f, "network error: {m}"),
            AppError::Upstream(m) => write!(f, "upstream error: {m}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Upstream(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
