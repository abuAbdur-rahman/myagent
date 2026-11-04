pub mod commands;
pub mod embed;
pub mod file;
pub mod index;
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

static META: OnceLock<Regex> = OnceLock::new();

fn meta_pattern() -> &'static Regex {
    META.get_or_init(|| {
        Regex::new(
            r"(?i)(queued for (the user to )?review|queued as|approve the memory prompts?|memory prompts?|not saved until|nothing is stored until|waiting for review|nothing was queued|already in memory|the user sees a card|i'?ve saved|i have saved)",
        )
        .expect("meta pattern compiles")
    })
}

pub fn looks_like_meta(text: &str) -> bool {
    meta_pattern().is_match(text)
}

pub fn similarity(a: &str, b: &str) -> f32 {
    fn tokens(text: &str) -> std::collections::HashSet<String> {
        text.to_lowercase()
            .split(|value: char| !value.is_alphanumeric())
            .filter(|token| token.len() >= 3)
            .map(str::to_string)
            .collect()
    }
    let left = tokens(a);
    let right = tokens(b);
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let shared = left.intersection(&right).count() as f32;
    let smallest = left.len().min(right.len()) as f32;
    shared / smallest
}

pub fn explicit_memory_request(text: &str) -> bool {
    static REQUEST: OnceLock<Regex> = OnceLock::new();
    let pattern = REQUEST.get_or_init(|| {
        Regex::new(r"(?i)\b(remember|save (this|that)|don'?t forget|keep in mind|note that)\b")
            .expect("explicit memory pattern compiles")
    });
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_lowercase();
    if trimmed.ends_with('?')
        && !lower.contains("remember this")
        && !lower.contains("remember that")
    {
        return false;
    }
    pattern.is_match(trimmed)
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

    #[test]
    fn notes_about_the_memory_system_are_refused() {
        assert!(looks_like_meta(
            "Both are queued as Convert Clicks project-only memories"
        ));
        assert!(looks_like_meta("Approve the memory prompts to save them."));
        assert!(looks_like_meta("Nothing is stored until you save it."));
        assert!(looks_like_meta("The user sees a card and can undo it."));
        assert!(!looks_like_meta(
            "CES billing uses Xero as the source of truth."
        ));
        assert!(!looks_like_meta(
            "The request moves to QA, then Client Review, then Done."
        ));
    }

    #[test]
    fn near_duplicates_are_measured_by_token_overlap() {
        assert!(similarity("uses pnpm instead of npm", "uses pnpm not npm") > 0.5);
        assert!(
            similarity(
                "CES billing uses Xero as the accounting source of truth",
                "CES billing uses Xero as the accounting source of truth for invoices"
            ) > 0.85
        );
        assert!(
            similarity(
                "CES billing uses Xero as the accounting source of truth",
                "Convert Clicks deploys Softr over Airtable"
            ) < 0.3
        );
    }

    #[test]
    fn only_explicit_requests_count_as_explicit() {
        assert!(explicit_memory_request("remember this: I use pnpm"));
        assert!(explicit_memory_request(
            "Please remember that CES uses Xero."
        ));
        assert!(explicit_memory_request("don't forget the billing window"));
        assert!(!explicit_memory_request("Do you remember what I said?"));
        assert!(!explicit_memory_request(
            "What's the difference between services?"
        ));
    }
}
