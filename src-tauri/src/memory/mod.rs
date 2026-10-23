pub mod commands;
pub mod file;
pub mod migrate;
pub mod store;

use std::sync::OnceLock;

use regex::Regex;

static SECRET: OnceLock<Regex> = OnceLock::new();

fn secret_pattern() -> &'static Regex {
    SECRET.get_or_init(|| {
        Regex::new(
            r"(?i)(sk-[a-z0-9_-]{16,}|gh[opsu]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|glpat-[a-z0-9_-]{20,}|xox[bpoas]-[a-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}|aws_?secret(?:_access_key)?\s*[:=]\s*\S{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9\-._~+/]{16,}|(password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*\S{6,})",
        )
        .expect("secret pattern compiles")
    })
}

pub fn looks_secret(text: &str) -> bool {
    let lower = text.to_lowercase();
    if secret_pattern().is_match(text) {
        return true;
    }
    text.split(|value: char| !value.is_ascii_hexdigit())
        .any(|run| run.len() >= 64)
        || text.split_whitespace().any(|word| {
            let trimmed = word.trim_matches(|value: char| {
                !value.is_ascii_alphanumeric() && value != '+' && value != '/' && value != '='
            });
            trimmed.len() >= 60
                && trimmed.ends_with('=')
                && trimmed.chars().any(|value| value.is_ascii_uppercase())
                && trimmed.chars().any(|value| value.is_ascii_lowercase())
        })
        || lower.contains("authorization: basic ")
}

pub fn secret_message() -> &'static str {
    "That looks like a secret (API key, token or password). Memory never stores credentials."
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obvious_keys_are_secrets() {
        assert!(looks_secret("remember this sk-abcdefghijklmnop123"));
        assert!(looks_secret("key AKIAABCDEFGHIJKLMNOP"));
        assert!(looks_secret("token=abcdef123456"));
        assert!(looks_secret("Authorization: Bearer abcdefghijklmnopqrst"));
        assert!(looks_secret(
            "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----"
        ));
        assert!(looks_secret(&format!("hash {}", "a".repeat(64))));
        assert!(looks_secret(
            "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
        ));
        assert!(looks_secret(
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
        ));
        assert!(looks_secret("gho_abcdefghijklmnopqrstuvwxyz"));
    }

    #[test]
    fn ordinary_notes_are_not_secrets() {
        assert!(!looks_secret("Prefers dark mode and short answers."));
        assert!(!looks_secret("The project uses Tauri and SQLite."));
        assert!(!looks_secret("Ships on Windows only; no macOS branch."));
        assert!(!looks_secret(
            "commit deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
        ));
        assert!(!looks_secret("Password managers are fine to discuss."));
    }
}
