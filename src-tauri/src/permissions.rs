use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::time::Duration;
use tauri::AppHandle;
use tauri::Manager;

use crate::error::{AppError, AppResult};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effect {
    Allow,
    Ask,
    Deny,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalReply {
    Once,
    Always,
    Deny,
}

impl ApprovalReply {
    fn from_str(raw: &str) -> Option<ApprovalReply> {
        match raw {
            "once" => Some(ApprovalReply::Once),
            "always" => Some(ApprovalReply::Always),
            "deny" => Some(ApprovalReply::Deny),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rule {
    pub action: String,
    pub resource: String,
    pub effect: Effect,
}

fn matches(pattern: &str, value: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    match pattern.strip_suffix('*') {
        Some(prefix) => value.starts_with(prefix),
        None => pattern == value,
    }
}

pub fn split_segments(command: &str) -> Vec<String> {
    let mut segments: Vec<String> = Vec::new();
    scan_segments(command, &mut segments);
    segments
}

fn scan_segments(source: &str, segments: &mut Vec<String>) {
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = source.chars().peekable();
    while let Some(ch) = chars.next() {
        if let Some(open) = quote {
            if open == '"' && ch == '$' && chars.peek() == Some(&'(') {
                chars.next();
                current.push_str("$(");
                let inner = take_balanced(&mut chars);
                scan_segments(&inner, segments);
                current.push(')');
                continue;
            }
            current.push(ch);
            if ch == open {
                quote = None;
            }
            continue;
        }
        match ch {
            '\'' | '"' => {
                quote = Some(ch);
                current.push(ch);
            }
            '`' => {
                current.push(ch);
                if let Some(escaped) = chars.next() {
                    current.push(escaped);
                }
            }
            ';' | '|' | '\n' | '\r' => {
                if ch == '|' && chars.peek() == Some(&'|') {
                    chars.next();
                }
                push_segment(segments, &mut current);
            }
            '&' if chars.peek() == Some(&'&') => {
                chars.next();
                push_segment(segments, &mut current);
            }
            _ => current.push(ch),
        }
    }
    push_segment(segments, &mut current);
}

fn take_balanced(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut inner = String::new();
    let mut depth = 1usize;
    let mut quote: Option<char> = None;
    while let Some(ch) = chars.next() {
        if quote.is_none() && ch == '`' {
            inner.push(ch);
            if let Some(escaped) = chars.next() {
                inner.push(escaped);
            }
            continue;
        }
        if let Some(open) = quote {
            inner.push(ch);
            if ch == open {
                quote = None;
            }
            continue;
        }
        match ch {
            '\'' | '"' => {
                quote = Some(ch);
                inner.push(ch);
            }
            '(' => {
                depth += 1;
                inner.push(ch);
            }
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return inner;
                }
                inner.push(ch);
            }
            _ => inner.push(ch),
        }
    }
    inner
}

fn push_segment(segments: &mut Vec<String>, current: &mut String) {
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        segments.push(trimmed.to_string());
    }
    current.clear();
}

pub fn decide(action: &str, resources: &[String], rules: &[Rule]) -> Effect {
    let mut effect = Effect::Allow;
    for resource in resources {
        let mut current = Effect::Ask;
        for rule in rules {
            if !matches(&rule.action, action) {
                continue;
            }
            if !matches(&rule.resource, resource) {
                continue;
            }
            if rule.effect == Effect::Deny {
                return Effect::Deny;
            }
            current = rule.effect;
        }
        if current == Effect::Ask {
            effect = Effect::Ask;
        }
    }
    effect
}

pub fn default_rules() -> Vec<Rule> {
    vec![
        Rule {
            action: "get_time".to_string(),
            resource: "*".to_string(),
            effect: Effect::Allow,
        },
        Rule {
            action: "recall_memory".to_string(),
            resource: "*".to_string(),
            effect: Effect::Allow,
        },
        Rule {
            action: "remember".to_string(),
            resource: "*".to_string(),
            effect: Effect::Allow,
        },
        Rule {
            action: "update_memory".to_string(),
            resource: "*".to_string(),
            effect: Effect::Allow,
        },
        Rule {
            action: "delete_memory".to_string(),
            resource: "*".to_string(),
            effect: Effect::Ask,
        },
        Rule {
            action: "save_artifact".to_string(),
            resource: "*".to_string(),
            effect: Effect::Allow,
        },
        Rule {
            action: "ask_user".to_string(),
            resource: "*".to_string(),
            effect: Effect::Allow,
        },
        Rule {
            action: "read_document".to_string(),
            resource: "*".to_string(),
            effect: Effect::Allow,
        },
    ]
}

async fn rules_pool(app: &AppHandle) -> AppResult<SqlitePool> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("app data dir: {e}")))?;
    let options = SqliteConnectOptions::new()
        .filename(dir.join("myagent.db"))
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(5));
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| AppError::Internal(format!("rules database: {e}")))
}

fn scope_of(project_id: Option<&str>) -> String {
    project_id.unwrap_or("").to_string()
}

async fn load_rules_from(pool: &SqlitePool, project_id: Option<&str>) -> AppResult<Vec<Rule>> {
    let scope = scope_of(project_id);
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT action, resource, effect FROM permission_rules WHERE project_id = '' OR project_id = ? ORDER BY project_id",
    )
    .bind(&scope)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(format!("load rules: {e}")))?;
    let mut rules = default_rules();
    for (action, resource, effect) in rows {
        let effect = match effect.as_str() {
            "allow" => Effect::Allow,
            "deny" => Effect::Deny,
            _ => Effect::Ask,
        };
        rules.push(Rule {
            action,
            resource,
            effect,
        });
    }
    Ok(rules)
}

pub async fn load_rules(app: &AppHandle, project_id: Option<&str>) -> AppResult<Vec<Rule>> {
    let pool = rules_pool(app).await?;
    load_rules_from(&pool, project_id).await
}

pub async fn check(
    app: &AppHandle,
    action: &str,
    resources: &[String],
    project_id: Option<&str>,
) -> AppResult<Effect> {
    if let Some(effect) = crate::mcp::policy(app, project_id, action).await {
        return Ok(effect);
    }
    let rules = load_rules(app, project_id).await?;
    Ok(decide(action, resources, &rules))
}

pub async fn allow_always(
    app: &AppHandle,
    action: &str,
    resource: &str,
    project_id: Option<&str>,
) -> AppResult<()> {
    let pool = rules_pool(app).await?;
    allow_always_from(&pool, action, resource, project_id).await
}

pub(crate) async fn allow_always_from(
    pool: &SqlitePool,
    action: &str,
    resource: &str,
    project_id: Option<&str>,
) -> AppResult<()> {
    if resource == "*" {
        return Err(AppError::Internal(
            "refusing to store a blanket allow rule".to_string(),
        ));
    }
    sqlx::query(
        "INSERT INTO permission_rules (action, resource, effect, project_id) VALUES (?, ?, 'allow', ?) ON CONFLICT (action, resource, project_id) DO UPDATE SET effect = 'allow'",
    )
    .bind(action)
    .bind(resource)
    .bind(scope_of(project_id))
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("save rule: {e}")))?;
    Ok(())
}

pub(crate) async fn allow_tool(
    app: &AppHandle,
    action: &str,
    project_id: Option<&str>,
) -> AppResult<()> {
    let pool = rules_pool(app).await?;
    allow_tool_from(&pool, action, project_id).await
}

pub(crate) async fn allow_tool_from(
    pool: &SqlitePool,
    action: &str,
    project_id: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO permission_rules (action, resource, effect, project_id) VALUES (?, '*', 'allow', ?) ON CONFLICT (action, resource, project_id) DO UPDATE SET effect = 'allow'",
    )
    .bind(action)
    .bind(scope_of(project_id))
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("save rule: {e}")))?;
    Ok(())
}

pub fn tool_wide_allow(action: &str) -> bool {
    matches!(action, "web_fetch" | "web_search")
}

#[derive(Deserialize)]
pub struct CheckRequest {
    pub action: String,
    #[serde(default)]
    pub resources: Vec<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Serialize)]
pub struct CheckResponse {
    pub effect: Effect,
}

#[tauri::command]
pub async fn permission_check(app: AppHandle, req: CheckRequest) -> AppResult<CheckResponse> {
    let resources = if req.resources.is_empty() {
        vec!["*".to_string()]
    } else {
        req.resources
    };
    let effect = check(&app, &req.action, &resources, req.project_id.as_deref()).await?;
    Ok(CheckResponse { effect })
}

#[derive(Deserialize)]
pub struct AllowRequest {
    pub action: String,
    pub resource: String,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[tauri::command]
pub async fn permission_allow(app: AppHandle, req: AllowRequest) -> AppResult<()> {
    allow_always(&app, &req.action, &req.resource, req.project_id.as_deref()).await
}

#[derive(Deserialize)]
pub struct ReplyRequest {
    pub id: String,
    pub reply: String,
}

/// A flagged call may be allowed once but must never persist an allow rule.
pub fn effective_reply(screen_flag: bool, reply: ApprovalReply) -> ApprovalReply {
    if screen_flag && reply == ApprovalReply::Always {
        ApprovalReply::Once
    } else {
        reply
    }
}

/// What (if anything) may be persisted for a reply. A flagged call resolves to
/// `Once`, so it can never produce a plan that writes a rule.
#[derive(Debug, PartialEq)]
pub enum PersistPlan {
    None,
    ToolWide,
    Resources,
}

pub fn resolve_reply(
    screen_flag: bool,
    reply: ApprovalReply,
    action: &str,
    resources: &[String],
) -> (ApprovalReply, PersistPlan) {
    let reply = effective_reply(screen_flag, reply);
    let plan = if reply == ApprovalReply::Always {
        if tool_wide_allow(action) {
            PersistPlan::ToolWide
        } else if resources.is_empty() {
            PersistPlan::None
        } else {
            PersistPlan::Resources
        }
    } else {
        PersistPlan::None
    };
    (reply, plan)
}

#[tauri::command]
pub async fn approval_reply(
    app: AppHandle,
    state: tauri::State<'_, crate::state::StreamState>,
    req: ReplyRequest,
) -> AppResult<()> {
    let reply = ApprovalReply::from_str(&req.reply)
        .ok_or_else(|| AppError::Internal("unknown approval reply".to_string()))?;
    let Some(pending) = state.take_pending(&req.id) else {
        return Err(AppError::Internal("approval already resolved".to_string()));
    };
    let (reply, plan) = resolve_reply(
        pending.screen_flag,
        reply,
        &pending.action,
        &pending.resources,
    );
    if plan != PersistPlan::None {
        let result = match plan {
            PersistPlan::ToolWide => {
                allow_tool(&app, &pending.action, pending.project_id.as_deref()).await
            }
            _ => {
                let mut outcome = Ok(());
                for resource in &pending.resources {
                    if let Err(error) = allow_always(
                        &app,
                        &pending.action,
                        resource,
                        pending.project_id.as_deref(),
                    )
                    .await
                    {
                        outcome = Err(error);
                        break;
                    }
                }
                outcome
            }
        };
        if let Err(error) = result {
            let _ = pending.tx.send(ApprovalReply::Once);
            return Err(error);
        }
    }
    let _ = pending.tx.send(reply);
    Ok(())
}

#[derive(Deserialize)]
pub struct AnswerRequest {
    pub id: String,
    pub answer: String,
}

#[tauri::command]
pub async fn question_answer(
    state: tauri::State<'_, crate::state::StreamState>,
    req: AnswerRequest,
) -> AppResult<()> {
    let answer = req.answer.trim().to_string();
    if answer.is_empty() || answer.chars().count() > 2000 {
        return Err(AppError::Internal(
            "answer must be 1 to 2000 chars".to_string(),
        ));
    }
    let Some(tx) = state.take_question(&req.id) else {
        return Err(AppError::Internal("question already resolved".to_string()));
    };
    let _ = tx.send(answer);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(action: &str, resource: &str, effect: Effect) -> Rule {
        Rule {
            action: action.to_string(),
            resource: resource.to_string(),
            effect,
        }
    }

    #[test]
    fn segments_split_compound_commands() {
        assert_eq!(
            split_segments("Get-ChildItem; Remove-Item C:\\tmp && Get-Date || Get-X"),
            vec!["Get-ChildItem", "Remove-Item C:\\tmp", "Get-Date", "Get-X"]
        );
        assert_eq!(split_segments("  Get-X  \n\n"), vec!["Get-X"]);
        assert!(split_segments("").is_empty());
    }

    #[test]
    fn segments_split_pipelines() {
        assert_eq!(
            split_segments("Get-Process | Where-Object CPU -gt 10 | Stop-Process"),
            vec!["Get-Process", "Where-Object CPU -gt 10", "Stop-Process"]
        );
        assert_eq!(
            split_segments("Get-Content a.txt > b.txt || Write-Output failed"),
            vec!["Get-Content a.txt > b.txt", "Write-Output failed"]
        );
    }

    #[test]
    fn segments_split_subexpressions() {
        assert_eq!(
            split_segments("$x = $(Get-Date; Remove-Item C:\\tmp)"),
            vec!["$x = $(Get-Date", "Remove-Item C:\\tmp)"]
        );
        assert_eq!(
            split_segments("Get-Item `$env:TEMP"),
            vec!["Get-Item `$env:TEMP"]
        );
    }

    #[test]
    fn segments_keep_quoted_separators() {
        assert_eq!(
            split_segments("Write-Output \"one;two|three\" ; Get-Date"),
            vec!["Write-Output \"one;two|three\"", "Get-Date"]
        );
        assert_eq!(
            split_segments("Remove-Item 'a && b'"),
            vec!["Remove-Item 'a && b'"]
        );
    }

    #[test]
    fn segments_keep_escaped_separators() {
        assert_eq!(
            split_segments("Write-Output one`;two"),
            vec!["Write-Output one`;two"]
        );
        assert_eq!(
            split_segments("Get-Date & Get-Item x"),
            vec!["Get-Date & Get-Item x"]
        );
    }

    #[test]
    fn segments_split_quoted_subexpressions() {
        assert_eq!(
            split_segments("Write-Output \"$(Get-Date; Remove-Item C:\\x)\""),
            vec!["Get-Date", "Remove-Item C:\\x", "Write-Output \"$()\""]
        );
        assert_eq!(
            split_segments("Remove-Item '$(a; b)'"),
            vec!["Remove-Item '$(a; b)'"]
        );
    }

    #[test]
    fn segments_split_statements_on_newlines() {
        assert_eq!(
            split_segments("Get-ChildItem\r\nRemove-Item C:\\x"),
            vec!["Get-ChildItem", "Remove-Item C:\\x"]
        );
        assert_eq!(
            split_segments("Get-Date \"a\nb\"\nRemove-Item C:\\x"),
            vec!["Get-Date \"a\nb\"", "Remove-Item C:\\x"]
        );
    }

    #[test]
    fn default_is_ask() {
        assert_eq!(
            decide("run_powershell", &["Get-X".to_string()], &[]),
            Effect::Ask
        );
    }

    #[test]
    fn last_matching_rule_wins() {
        let rules = vec![
            rule("run_powershell", "*", Effect::Allow),
            rule("run_powershell", "Remove-*", Effect::Ask),
        ];
        assert_eq!(
            decide("run_powershell", &["Remove-Item".to_string()], &rules),
            Effect::Ask
        );
        assert_eq!(
            decide("run_powershell", &["Get-ChildItem".to_string()], &rules),
            Effect::Allow
        );
    }

    #[test]
    fn deny_beats_allow_across_resources() {
        let rules = vec![
            rule("edit", "*", Effect::Deny),
            rule("edit", "*", Effect::Allow),
        ];
        assert_eq!(
            decide("edit", &["a.txt".to_string(), "b.txt".to_string()], &rules),
            Effect::Deny
        );
        let rules = vec![
            rule("edit", "a.txt", Effect::Deny),
            rule("edit", "*", Effect::Allow),
        ];
        assert_eq!(
            decide("edit", &["a.txt".to_string(), "b.txt".to_string()], &rules),
            Effect::Deny
        );
        let rules = vec![rule("edit", "*", Effect::Allow)];
        assert_eq!(
            decide("edit", &["a.txt".to_string(), "b.txt".to_string()], &rules),
            Effect::Allow
        );
    }

    #[test]
    fn wildcard_action_and_resource() {
        let rules = vec![rule("*", "*", Effect::Deny)];
        assert_eq!(
            decide("anything", &["whatever".to_string()], &rules),
            Effect::Deny
        );
    }

    #[test]
    fn server_prefix_action_matches_namespaced_tools() {
        let rules = vec![
            rule("fs_*", "*", Effect::Allow),
            rule("fs_delete", "*", Effect::Deny),
        ];
        assert_eq!(decide("fs_read", &["*".to_string()], &rules), Effect::Allow);
        assert_eq!(
            decide("fs_delete", &["*".to_string()], &rules),
            Effect::Deny
        );
        assert_eq!(decide("db_query", &["*".to_string()], &rules), Effect::Ask);
    }

    #[test]
    fn default_rules_let_read_only_through() {
        let rules = default_rules();
        assert_eq!(
            decide("get_time", &["*".to_string()], &rules),
            Effect::Allow
        );
        assert_eq!(
            decide("recall_memory", &["*".to_string()], &rules),
            Effect::Allow
        );
        assert_eq!(
            decide("remember", &["*".to_string()], &rules),
            Effect::Allow
        );
        assert_eq!(
            decide("update_memory", &["*".to_string()], &rules),
            Effect::Allow
        );
        assert_eq!(
            decide("delete_memory", &["*".to_string()], &rules),
            Effect::Ask
        );
        assert_eq!(
            decide("save_artifact", &["*".to_string()], &rules),
            Effect::Allow
        );
        assert_eq!(
            decide("read_document", &["report.pdf".to_string()], &rules),
            Effect::Allow
        );
        assert_eq!(
            decide("run_powershell", &["Get-X".to_string()], &rules),
            Effect::Ask
        );
    }

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory db");
        sqlx::query(
            "CREATE TABLE permission_rules (action TEXT NOT NULL, resource TEXT NOT NULL, effect TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '', PRIMARY KEY (action, resource, project_id))",
        )
        .execute(&pool)
        .await
        .expect("permission_rules schema");
        pool
    }

    #[tokio::test]
    async fn always_allow_persists_and_stops_asking() {
        let pool = test_pool().await;
        allow_always_from(&pool, "web_fetch", "example.com", None)
            .await
            .expect("store allow");
        let rules = load_rules_from(&pool, None).await.expect("load rules");
        assert_eq!(
            decide("web_fetch", &["example.com".to_string()], &rules),
            Effect::Allow
        );
        assert_eq!(
            decide("web_fetch", &["other.com".to_string()], &rules),
            Effect::Ask
        );
    }

    #[tokio::test]
    async fn always_allow_refuses_blanket() {
        let pool = test_pool().await;
        assert!(
            allow_always_from(&pool, "web_search", "*", None)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn tool_allow_covers_every_resource() {
        let pool = test_pool().await;
        allow_tool_from(&pool, "web_search", None)
            .await
            .expect("store tool allow");
        let rules = load_rules_from(&pool, None).await.expect("load rules");
        assert_eq!(
            decide("web_search", &["any query".to_string()], &rules),
            Effect::Allow
        );
        assert_eq!(
            decide("web_search", &["another query".to_string()], &rules),
            Effect::Allow
        );
        assert_eq!(
            decide("web_fetch", &["example.com".to_string()], &rules),
            Effect::Ask
        );
    }

    #[test]
    fn flagged_approvals_never_produce_a_persist_plan() {
        let resource = vec!["C:\\tmp".to_string()];
        let host = vec!["example.com".to_string()];
        assert_eq!(
            resolve_reply(true, ApprovalReply::Always, "run_powershell", &resource),
            (ApprovalReply::Once, PersistPlan::None)
        );
        assert_eq!(
            resolve_reply(true, ApprovalReply::Always, "web_fetch", &host),
            (ApprovalReply::Once, PersistPlan::None)
        );
        assert_eq!(
            resolve_reply(false, ApprovalReply::Always, "run_powershell", &resource),
            (ApprovalReply::Always, PersistPlan::Resources)
        );
        assert_eq!(
            resolve_reply(false, ApprovalReply::Always, "web_fetch", &host),
            (ApprovalReply::Always, PersistPlan::ToolWide)
        );
        assert_eq!(
            resolve_reply(false, ApprovalReply::Deny, "run_powershell", &resource),
            (ApprovalReply::Deny, PersistPlan::None)
        );
    }

    #[test]
    fn flagged_approvals_never_persist_always() {
        assert_eq!(
            effective_reply(true, ApprovalReply::Always),
            ApprovalReply::Once
        );
        assert_eq!(
            effective_reply(true, ApprovalReply::Once),
            ApprovalReply::Once
        );
        assert_eq!(
            effective_reply(true, ApprovalReply::Deny),
            ApprovalReply::Deny
        );
        assert_eq!(
            effective_reply(false, ApprovalReply::Always),
            ApprovalReply::Always
        );
    }

    #[test]
    fn tool_wide_allow_only_for_network_tools() {
        assert!(tool_wide_allow("web_fetch"));
        assert!(tool_wide_allow("web_search"));
        assert!(!tool_wide_allow("run_powershell"));
        assert!(!tool_wide_allow("save_artifact"));
    }
}
