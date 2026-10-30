use std::collections::{HashMap, VecDeque};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
    ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::transport::stdio;
use rmcp::{ErrorData as McpError, RoleServer, ServerHandler, ServiceExt};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use uiautomation::UIAutomation;
use uiautomation::clipboards::Clipboard;
use uiautomation::core::UIElement;
use uiautomation::inputs::{Keyboard, Mouse, MouseButton};
use uiautomation::patterns::{
    UIInvokePattern, UIRangeValuePattern, UIScrollPattern, UITogglePattern, UIValuePattern,
};
use uiautomation::screenshots::Screenshot;
use uiautomation::types::{Point, ScrollAmount, TreeScope, UIProperty};
use uiautomation::variants::{Value as VariantValue, Variant};
use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::Graphics::Gdi::{
    BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleBitmap, CreateCompatibleDC, DIB_RGB_COLORS,
    DeleteDC, DeleteObject, GetDC, GetDIBits, HGDIOBJ, ReleaseDC, SelectObject,
};
use windows_sys::Win32::Storage::Xps::PrintWindow;
use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows_sys::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_MOUSE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_WHEEL, MOUSEINPUT, SendInput, SetFocus,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumChildWindows, GetClassNameW, GetForegroundWindow, GetWindowRect,
    GetWindowThreadProcessId, IsIconic, PW_RENDERFULLCONTENT, SW_RESTORE, SendMessageW,
    SetForegroundWindow, ShowWindow, WM_GETOBJECT,
};

use crate::computer_use::{AppTier, AuditEntry, ComputerUseConfig};

const MAX_TEXT: usize = 10_000;
const MAX_KEYS: usize = 200;
const SNAPSHOT_TTL: Duration = Duration::from_secs(600);
const MAX_SNAPSHOTS: usize = 20;
const MAX_TREE_NODES: usize = 1_200;
const MAX_TREE_DEPTH: usize = 8;
const LAZY_MAX_NODES: usize = 400;
const UIA_ROOT_OBJECT_ID: isize = -25;

pub fn run() {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("computer-use: runtime failed: {error}");
            return;
        }
    };
    runtime.block_on(async {
        let server = ComputerUseServer::new();
        match server.serve(stdio()).await {
            Ok(running) => {
                if let Err(error) = running.waiting().await {
                    eprintln!("computer-use: server stopped: {error}");
                }
            }
            Err(error) => eprintln!("computer-use: serve failed: {error}"),
        }
    });
}

#[derive(Clone)]
struct ComputerUseServer {
    snapshots: Arc<Mutex<SnapshotStore>>,
    actions: Arc<AtomicU32>,
    last_action: Arc<Mutex<Option<Instant>>>,
}

impl ComputerUseServer {
    fn new() -> Self {
        Self {
            snapshots: Arc::new(Mutex::new(SnapshotStore::new())),
            actions: Arc::new(AtomicU32::new(0)),
            last_action: Arc::new(Mutex::new(None)),
        }
    }
}

impl ServerHandler for ComputerUseServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "computer-use",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(
                "Observe before acting. Call get_state to get a snapshot and element ids; ids expire and stale ids return stale_snapshot. Chromium and Electron windows expose only browser chrome to UI Automation, so their element ids are toolbar controls, not page content: call screenshot or get_state with screenshot=true, click the page point with app, x and y, then type with confirm=true. Actions require an allowlisted app and the right tier. Hard-denied apps, password fields and secure-desktop input are refused. Check results for stale_snapshot, app_not_allowlisted, tier_denied, hard_denied, computer_use_paused, yield_to_user, publisher_mismatch, chromium_content_unavailable, unverified_focus and dry_run.",
            )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        Ok(ListToolsResult::with_all_items(tools()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let name = request.name.to_string();
        let arguments = request
            .arguments
            .map(Value::Object)
            .unwrap_or_else(|| json!({}));
        Ok(self.dispatch(&name, arguments).await.into())
    }
}

impl ComputerUseServer {
    async fn dispatch(&self, name: &str, arguments: Value) -> CallToolResult {
        let config = crate::computer_use::load_config();
        if !config.enabled {
            self.actions.store(0, Ordering::SeqCst);
            return error_result(
                "computer_use_disabled: turn on Computer use in Settings > Computer use",
            );
        }
        if config.paused {
            self.actions.store(0, Ordering::SeqCst);
            let result = error_result(
                "computer_use_paused: computer use is paused; resume it in Settings or with the kill switch",
            );
            audit_failure(&config, name, &arguments, &result);
            return result;
        }
        let outcome = match name {
            "list_apps" => self.list_apps(&config),
            "list_windows" => parse::<ListWindowsArgs>(&arguments)
                .and_then(|args| self.list_windows(&config, args)),
            "get_state" => {
                parse::<GetStateArgs>(&arguments).and_then(|args| self.get_state(&config, args))
            }
            "screenshot" => {
                parse::<ScreenshotArgs>(&arguments).and_then(|args| self.screenshot(&config, args))
            }
            "invoke" => {
                parse::<ElementArgs>(&arguments).and_then(|args| self.invoke(&config, args))
            }
            "click" => parse::<ClickArgs>(&arguments).and_then(|args| self.click(&config, args)),
            "type_text" => {
                parse::<TypeTextArgs>(&arguments).and_then(|args| self.type_text(&config, args))
            }
            "set_value" => {
                parse::<SetValueArgs>(&arguments).and_then(|args| self.set_value(&config, args))
            }
            "press_keys" => {
                parse::<PressKeysArgs>(&arguments).and_then(|args| self.press_keys(&config, args))
            }
            "scroll" => parse::<ScrollArgs>(&arguments).and_then(|args| self.scroll(&config, args)),
            "drag" => parse::<DragArgs>(&arguments).and_then(|args| self.drag(&config, args)),
            "wait" => match parse::<WaitArgs>(&arguments) {
                Ok(args) => self.wait(&config, args).await,
                Err(error) => Err(error),
            },
            "focus_window" => parse::<FocusWindowArgs>(&arguments)
                .and_then(|args| self.focus_window(&config, args)),
            "launch_app" => {
                parse::<LaunchAppArgs>(&arguments).and_then(|args| self.launch_app(&config, args))
            }
            "read_clipboard" => parse::<ReadClipboardArgs>(&arguments)
                .and_then(|args| self.read_clipboard(&config, args)),
            "write_clipboard" => parse::<WriteClipboardArgs>(&arguments)
                .and_then(|args| self.write_clipboard(&config, args)),
            _ => Err(format!("unknown_tool: {name}")),
        };
        match outcome {
            Ok(result) => result,
            Err(error) => {
                let result = error_result(error);
                audit_failure(&config, name, &arguments, &result);
                result
            }
        }
    }

    fn require_active(&self, config: &ComputerUseConfig) -> Result<(), String> {
        if config.paused {
            return Err(
                "computer_use_paused: computer use is paused; resume it in Settings".to_string(),
            );
        }
        Ok(())
    }

    fn check_budget(&self, config: &ComputerUseConfig) -> Result<(), String> {
        let now = Instant::now();
        if let Ok(mut last) = self.last_action.lock() {
            if last.is_some_and(|previous| now.duration_since(previous) > Duration::from_secs(600))
            {
                self.actions.store(0, Ordering::SeqCst);
            }
            *last = Some(now);
        } else {
            eprintln!("computer-use: action timer lock failed");
        }
        let used = self.actions.fetch_add(1, Ordering::SeqCst);
        if used >= config.max_actions_per_run {
            return Err(format!(
                "action_budget_exhausted: used {} of {} actions this run",
                used, config.max_actions_per_run
            ));
        }
        Ok(())
    }

    fn begin_action(&self, config: &ComputerUseConfig) -> Result<(), String> {
        let last = self.last_action.lock().ok().and_then(|guard| *guard);
        if should_yield(
            crate::computer_use::user_idle_ms(),
            last.map(|last| last.elapsed()),
        ) {
            return Err(
                "yield_to_user: user input detected; pause and confirm before continuing"
                    .to_string(),
            );
        }
        self.check_budget(config)
    }

    fn snapshot(&self, id: &str) -> Result<Snapshot, String> {
        self.snapshots
            .lock()
            .map_err(|_| "state_lock_failed: snapshot store is unavailable".to_string())?
            .get(id)
            .ok_or_else(|| "stale_snapshot: observe again with get_state".to_string())
    }

    fn list_apps(&self, config: &ComputerUseConfig) -> Result<CallToolResult, String> {
        let automation = automation()?;
        let windows = top_level_windows(&automation)?;
        let mut apps: HashMap<u32, AppEntry> = HashMap::new();
        for (_, info) in windows {
            let policy = policy_for(config, &info);
            let entry = apps.entry(info.pid).or_insert_with(|| AppEntry {
                pid: info.pid,
                exe: info.exe.clone(),
                name: info.name.clone(),
                tier: policy.tier,
                blocked: policy.blocked.clone(),
                windows: 0,
                titles: Vec::new(),
            });
            entry.windows += 1;
            if entry.titles.len() < 5
                && !info.title.is_empty()
                && !entry.titles.contains(&info.title)
            {
                entry.titles.push(info.title.clone());
            }
            if let Some(blocked) = policy.blocked {
                entry.blocked = Some(blocked);
                entry.tier = None;
            } else if entry.blocked.is_none() {
                entry.tier = policy.tier;
            }
        }
        let mut apps: Vec<AppEntry> = apps.into_values().collect();
        apps.sort_by(|a, b| a.name.cmp(&b.name).then(a.pid.cmp(&b.pid)));
        let apps: Vec<Value> = apps
            .into_iter()
            .map(|app| {
                json!({
                    "pid": app.pid,
                    "exe": app.exe,
                    "name": app.name,
                    "tier": app.tier.map(AppTier::as_str).unwrap_or("denied"),
                    "blocked": app.blocked,
                    "windows": app.windows,
                    "titles": app.titles,
                })
            })
            .collect();
        Ok(ok_json(json!({
            "enabled": config.enabled,
            "paused": config.paused,
            "dry_run": config.dry_run,
            "apps": apps,
        })))
    }

    fn list_windows(
        &self,
        config: &ComputerUseConfig,
        args: ListWindowsArgs,
    ) -> Result<CallToolResult, String> {
        let automation = automation()?;
        let windows = top_level_windows(&automation)?;
        let filter = args
            .app
            .as_deref()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());
        let mut out = Vec::new();
        for (_, info) in windows {
            if let Some(needle) = &filter {
                let pid_match = info.pid.to_string().as_str() == needle;
                let exe_match = info.exe.to_ascii_lowercase().contains(needle);
                let name_match = info.name.to_ascii_lowercase().contains(needle);
                let title_match = info.title.to_ascii_lowercase().contains(needle);
                if !(pid_match || exe_match || name_match || title_match) {
                    continue;
                }
            }
            let policy = policy_for(config, &info);
            out.push(json!({
                "pid": info.pid,
                "exe": info.exe,
                "name": info.name,
                "title": info.title,
                "class": info.class,
                "bounds": info.rect.to_json(),
                "focused": info.focused,
                "offscreen": info.offscreen,
                "tier": policy.tier.map(AppTier::as_str).unwrap_or("denied"),
                "blocked": policy.blocked,
            }));
            if out.len() >= 200 {
                break;
            }
        }
        let truncated = out.len() >= 200;
        Ok(ok_json(json!({"windows": out, "truncated": truncated})))
    }

    fn get_state(
        &self,
        config: &ComputerUseConfig,
        args: GetStateArgs,
    ) -> Result<CallToolResult, String> {
        let automation = automation()?;
        let (window, info) = resolve_window(&automation, &args.app, args.window.as_deref())?;
        let tier = require_app(config, &info, AppTier::View)?;
        let lazy = is_chromium_window(&info);
        let mut root = window.clone();
        if lazy {
            root = chromium_root(&automation, &info, &window);
        }
        let requested = args.max_nodes.unwrap_or(600).clamp(50, MAX_TREE_NODES);
        let max_nodes = if lazy {
            requested.min(LAZY_MAX_NODES)
        } else {
            requested
        };
        let max_depth = MAX_TREE_DEPTH;
        let (snapshot, mut state) =
            build_state(&automation, &root, &info, tier, max_nodes, max_depth)?;
        if lazy {
            let has_document = state["nodes"]
                .as_array()
                .map(|nodes| {
                    nodes.iter().any(|node| {
                        node["role"]
                            .as_str()
                            .map(|role| role.eq_ignore_ascii_case("Document"))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false);
            state["lazy"] = json!(true);
            state["page_tree_unavailable"] = json!(!has_document);
            state["hint"] = json!(if has_document {
                "chromium_tree_is_shallow: the page tree may be partial, call screenshot or get_state with screenshot=true before acting"
            } else {
                "chromium_page_unavailable: this window exposes only browser chrome to UI Automation, so element ids are toolbar controls, not page content; call screenshot or get_state with screenshot=true, then click by point with app, x and y"
            });
        }
        let snapshot_id = self
            .snapshots
            .lock()
            .map_err(|_| "state_lock_failed: snapshot store is unavailable".to_string())?
            .insert(snapshot);
        state["snapshot"] = json!(snapshot_id);
        if args.screenshot.unwrap_or(false) {
            match capture_element(&window, &info) {
                Ok(shot) => {
                    let (data, width, height) = encode_png(&shot)?;
                    state["screenshot"] = json!({"width": width, "height": height});
                    return Ok(CallToolResult::success(vec![
                        ContentBlock::text(state.to_string()),
                        ContentBlock::image(data, "image/png"),
                    ]));
                }
                Err(error) => {
                    state["screenshot_error"] = json!(error);
                }
            }
        }
        Ok(ok_json(state))
    }

    fn screenshot(
        &self,
        config: &ComputerUseConfig,
        args: ScreenshotArgs,
    ) -> Result<CallToolResult, String> {
        let automation = automation()?;
        let (window, info) = resolve_window(&automation, &args.app, args.window.as_deref())?;
        require_app(config, &info, AppTier::View)?;
        let shot = capture_element(&window, &info)?;
        let (data, width, height) = encode_png(&shot)?;
        let meta = json!({
            "app": info.exe,
            "window": info.title,
            "width": width,
            "height": height,
            "format": "png",
        });
        Ok(CallToolResult::success(vec![
            ContentBlock::text(meta.to_string()),
            ContentBlock::image(data, "image/png"),
        ]))
    }

    fn invoke(
        &self,
        config: &ComputerUseConfig,
        args: ElementArgs,
    ) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        let automation = automation()?;
        let (_snapshot, element_ref, element, info) =
            resolve_snapshot_element(&automation, &self.snapshots, &args.snapshot, &args.element)?;
        require_app(config, &info, AppTier::Interact)?;
        verify_app_argument(&args.app, &info)?;
        if config.dry_run {
            let detail = format!("would invoke {}", element_ref.name);
            audit_action(config, "invoke", &info, true, &detail, None, None);
            return Ok(dry_run_result("invoke", &info, &args.element, &detail));
        }
        self.begin_action(config)?;
        let before = self.thumb(config, &element, &info, "before");
        if let Ok(pattern) = element.get_pattern::<UIInvokePattern>() {
            pattern
                .invoke()
                .map_err(|error| format!("invoke_failed: {error}"))?;
        } else if let Ok(pattern) = element.get_pattern::<UITogglePattern>() {
            pattern
                .toggle()
                .map_err(|error| format!("invoke_failed: {error}"))?;
        } else {
            element
                .click()
                .map_err(|error| format!("invoke_failed: {error}"))?;
        }
        let after = self.thumb(config, &element, &info, "after");
        let detail = format!("invoked {}", element_ref.name);
        audit_action(config, "invoke", &info, false, &detail, before, after);
        Ok(ok_json(json!({
            "ok": true,
            "action": "invoke",
            "app": info.exe,
            "element": args.element,
            "name": element_ref.name,
        })))
    }

    fn click(&self, config: &ComputerUseConfig, args: ClickArgs) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        let automation = automation()?;
        let button = args.button.as_deref().unwrap_or("left");
        if !matches!(button, "left" | "right") {
            return Err("invalid_arguments: button must be left or right".to_string());
        }
        let double = args.double.unwrap_or(false);
        if let (Some(snapshot), Some(element_id)) =
            (args.snapshot.as_deref(), args.element.as_deref())
        {
            let (_snapshot, element_ref, element, info) =
                resolve_snapshot_element(&automation, &self.snapshots, snapshot, element_id)?;
            require_app(config, &info, AppTier::Interact)?;
            verify_app_argument(&args.app, &info)?;
            if config.dry_run {
                let detail = format!(
                    "would click {} with {button}{}",
                    element_ref.name,
                    if double { " double" } else { "" }
                );
                audit_action(config, "click", &info, true, &detail, None, None);
                return Ok(dry_run_result("click", &info, element_id, &detail));
            }
            self.begin_action(config)?;
            raise_window(info.hwnd);
            std::thread::sleep(Duration::from_millis(150));
            require_window_foreground(&info)?;
            let point = element_click_point(&element)?;
            require_point_matches_element(&automation, point, &element, &info)?;
            require_point_in_app(&automation, point, info.pid)?;
            let before = self.thumb(config, &element, &info, "before");
            let mouse = Mouse::new();
            match (button, double) {
                ("right", _) => mouse.right_click(&point),
                (_, true) => mouse.double_click(&point),
                _ => mouse.click(&point),
            }
            .map_err(|error| format!("click_failed: {error}"))?;
            let after = self.thumb(config, &element, &info, "after");
            let detail = format!(
                "clicked {} with {button}{}",
                element_ref.name,
                if double { " double" } else { "" }
            );
            audit_action(config, "click", &info, false, &detail, before, after);
            return Ok(ok_json(json!({
                "ok": true,
                "action": "click",
                "app": info.exe,
                "element": element_id,
                "button": button,
                "double": double,
            })));
        }
        let (Some(x), Some(y)) = (args.x, args.y) else {
            return Err(
                "invalid_arguments: pass snapshot and element, or app with x and y".to_string(),
            );
        };
        let app = args
            .app
            .as_deref()
            .ok_or_else(|| "app_required: pass app with x and y".to_string())?;
        let (window, info) = resolve_window(&automation, app, args.window.as_deref())?;
        require_app(config, &info, AppTier::Interact)?;
        verify_app_argument(&args.app, &info)?;
        if !info.rect.contains(x, y) {
            return Err("invalid_arguments: point must be inside the window".to_string());
        }
        let point = Point::new(x, y);
        if config.dry_run {
            ensure_point_not_password(&automation, point)?;
            require_point_in_app(&automation, point, info.pid)?;
            let detail = format!("would click point ({x}, {y}) with {button}");
            audit_action(config, "click", &info, true, &detail, None, None);
            return Ok(dry_run_result("click", &info, &format!("{x},{y}"), &detail));
        }
        self.begin_action(config)?;
        raise_window(info.hwnd);
        std::thread::sleep(Duration::from_millis(150));
        require_window_foreground(&info)?;
        ensure_point_not_password(&automation, point)?;
        require_point_in_app(&automation, point, info.pid)?;
        let before = self.thumb(config, &window, &info, "before");
        let mouse = Mouse::new();
        match (button, double) {
            ("right", _) => mouse.right_click(&point),
            (_, true) => mouse.double_click(&point),
            _ => mouse.click(&point),
        }
        .map_err(|error| format!("click_failed: {error}"))?;
        let after = self.thumb(config, &window, &info, "after");
        let detail = format!("clicked point ({x}, {y}) with {button}");
        audit_action(config, "click", &info, false, &detail, before, after);
        Ok(ok_json(json!({
            "ok": true,
            "action": "click",
            "app": info.exe,
            "x": x,
            "y": y,
            "button": button,
            "double": double,
        })))
    }

    fn type_text(
        &self,
        config: &ComputerUseConfig,
        args: TypeTextArgs,
    ) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        if args.text.chars().count() > MAX_TEXT {
            return Err(format!("text_too_long: limit is {MAX_TEXT} characters"));
        }
        let automation = automation()?;
        let mut page_tree = true;
        let (info, focus, target, target_name) = if let (Some(snapshot), Some(element)) =
            (args.snapshot.as_deref(), args.element.as_deref())
        {
            let (snapshot, element_ref, element, info) =
                resolve_snapshot_element(&automation, &self.snapshots, snapshot, element)?;
            page_tree = snapshot.has_document;
            (info, element.clone(), Some(element), element_ref.name)
        } else {
            let app = args
                .app
                .as_deref()
                .ok_or_else(|| "app_required: pass app or snapshot and element".to_string())?;
            let (window, info) = resolve_window(&automation, app, None)?;
            let target_name = info.title.clone();
            (info, window, None, target_name)
        };
        require_app(config, &info, AppTier::Interact)?;
        verify_app_argument(&args.app, &info)?;
        if is_chromium_window(&info) {
            if args.snapshot.is_some() || args.element.is_some() {
                if !page_tree {
                    return Err(
                        "chromium_content_unavailable: this Chromium window exposes only browser chrome to UI Automation, so element typing could land in the address bar; take a screenshot, click the page point, then type with confirm=true"
                            .to_string(),
                    );
                }
            } else if !args.confirm.unwrap_or(false) {
                return Err(
                    "unverified_focus: Chromium app-only typing cannot verify the focused control; click the page point, review the screenshot, then retry with confirm=true"
                        .to_string(),
                );
            }
        }
        if config.dry_run {
            let detail = format!(
                "would type {} chars into {}",
                args.text.chars().count(),
                target_name
            );
            audit_action(config, "type_text", &info, true, &detail, None, None);
            return Ok(dry_run_result("type_text", &info, &target_name, &detail));
        }
        self.begin_action(config)?;
        let before = self.thumb(config, &focus, &info, "before");
        if let Some(element) = &target {
            element
                .set_focus()
                .map_err(|error| format!("focus_failed: {error}"))?;
            ensure_focused_app(&automation, info.pid)?;
            ensure_focus_not_password(&automation)?;
            element
                .send_text(&args.text, 10)
                .map_err(|error| format!("type_failed: {error}"))?;
        } else {
            focus_app_for_input(&automation, &focus, info.pid)?;
            Keyboard::new()
                .interval(10)
                .send_text(&args.text)
                .map_err(|error| format!("type_failed: {error}"))?;
        }
        let after = self.thumb(config, &focus, &info, "after");
        let detail = format!(
            "typed {} chars into {}",
            args.text.chars().count(),
            target_name
        );
        audit_action(config, "type_text", &info, false, &detail, before, after);
        Ok(ok_json(json!({
            "ok": true,
            "action": "type_text",
            "app": info.exe,
            "chars": args.text.chars().count(),
            "target": target_name,
        })))
    }

    fn set_value(
        &self,
        config: &ComputerUseConfig,
        args: SetValueArgs,
    ) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        if args.value.chars().count() > MAX_TEXT {
            return Err(format!("text_too_long: limit is {MAX_TEXT} characters"));
        }
        let automation = automation()?;
        let (_snapshot, element_ref, element, info) =
            resolve_snapshot_element(&automation, &self.snapshots, &args.snapshot, &args.element)?;
        require_app(config, &info, AppTier::Interact)?;
        verify_app_argument(&args.app, &info)?;
        if is_chromium_window(&info) && !_snapshot.has_document {
            return Err(
                "chromium_content_unavailable: this Chromium window exposes only browser chrome to UI Automation, so element ids are not page content; take a screenshot, click the point, then type with confirm=true"
                    .to_string(),
            );
        }
        if config.dry_run {
            let detail = format!(
                "would set {} to {} chars",
                element_ref.name,
                args.value.chars().count()
            );
            audit_action(config, "set_value", &info, true, &detail, None, None);
            return Ok(dry_run_result("set_value", &info, &args.element, &detail));
        }
        self.begin_action(config)?;
        let before = self.thumb(config, &element, &info, "before");
        if let Ok(pattern) = element.get_pattern::<UIValuePattern>() {
            pattern
                .set_value(&args.value)
                .map_err(|error| format!("set_value_failed: {error}"))?;
        } else if let Ok(pattern) = element.get_pattern::<UIRangeValuePattern>() {
            let value = args
                .value
                .trim()
                .parse::<f64>()
                .map_err(|_| "invalid_arguments: range value must be a number".to_string())?;
            pattern
                .set_value(value)
                .map_err(|error| format!("set_value_failed: {error}"))?;
        } else {
            return Err("set_value_unsupported: element has no value pattern".to_string());
        }
        let after = self.thumb(config, &element, &info, "after");
        let detail = format!(
            "set {} to {} chars",
            element_ref.name,
            args.value.chars().count()
        );
        audit_action(config, "set_value", &info, false, &detail, before, after);
        Ok(ok_json(json!({
            "ok": true,
            "action": "set_value",
            "app": info.exe,
            "element": args.element,
            "chars": args.value.chars().count(),
        })))
    }

    fn press_keys(
        &self,
        config: &ComputerUseConfig,
        args: PressKeysArgs,
    ) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        validate_keys(&args.keys, args.confirm.unwrap_or(false))?;
        let automation = automation()?;
        let (window, info) = if let Some(snapshot) = args.snapshot.as_deref() {
            let snapshot = self.snapshot(snapshot)?;
            find_window_by_snapshot(&automation, &snapshot)?
        } else {
            let app = args
                .app
                .as_deref()
                .ok_or_else(|| "app_required: pass app or snapshot".to_string())?;
            resolve_window(&automation, app, None)?
        };
        require_app(config, &info, AppTier::Interact)?;
        verify_app_argument(&args.app, &info)?;
        if config.dry_run {
            let detail = format!("would press {}", args.keys);
            audit_action(config, "press_keys", &info, true, &detail, None, None);
            return Ok(dry_run_result("press_keys", &info, "", &detail));
        }
        self.begin_action(config)?;
        let before = self.thumb(config, &window, &info, "before");
        focus_app_for_input(&automation, &window, info.pid)?;
        Keyboard::new()
            .interval(10)
            .send_keys(&args.keys)
            .map_err(|error| format!("keys_failed: {error}"))?;
        let after = self.thumb(config, &window, &info, "after");
        let detail = format!("pressed {}", args.keys);
        audit_action(config, "press_keys", &info, false, &detail, before, after);
        Ok(ok_json(json!({
            "ok": true,
            "action": "press_keys",
            "app": info.exe,
            "keys": args.keys,
        })))
    }

    fn scroll(
        &self,
        config: &ComputerUseConfig,
        args: ScrollArgs,
    ) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        let direction = args.direction.to_ascii_lowercase();
        if !matches!(direction.as_str(), "up" | "down" | "left" | "right") {
            return Err("invalid_arguments: direction must be up, down, left or right".to_string());
        }
        let large = args
            .amount
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case("large"))
            .unwrap_or(false);
        let automation = automation()?;
        let (window, info, target) = if let (Some(snapshot), Some(element)) =
            (args.snapshot.as_deref(), args.element.as_deref())
        {
            let (_snapshot, _element_ref, element, info) =
                resolve_snapshot_element(&automation, &self.snapshots, snapshot, element)?;
            (element.clone(), info, Some(element))
        } else if let Some(snapshot) = args.snapshot.as_deref() {
            let snapshot = self.snapshot(snapshot)?;
            let (window, info) = find_window_by_snapshot(&automation, &snapshot)?;
            (window, info, None)
        } else {
            let app = args
                .app
                .as_deref()
                .ok_or_else(|| "app_required: pass app or snapshot".to_string())?;
            let (window, info) = resolve_window(&automation, app, None)?;
            (window, info, None)
        };
        require_app(config, &info, AppTier::Interact)?;
        verify_app_argument(&args.app, &info)?;
        if config.dry_run {
            let detail = format!(
                "would scroll {direction} by {}",
                if large { "large" } else { "small" }
            );
            audit_action(config, "scroll", &info, true, &detail, None, None);
            return Ok(dry_run_result("scroll", &info, "", &detail));
        }
        self.begin_action(config)?;
        let before = self.thumb(config, &window, &info, "before");
        let mut used_pattern = false;
        if let Some(element) = &target
            && let Ok(pattern) = element.get_pattern::<UIScrollPattern>()
        {
            let small = !large;
            let (horizontal, vertical) = match direction.as_str() {
                "up" => (
                    ScrollAmount::NoAmount,
                    if small {
                        ScrollAmount::SmallDecrement
                    } else {
                        ScrollAmount::LargeDecrement
                    },
                ),
                "down" => (
                    ScrollAmount::NoAmount,
                    if small {
                        ScrollAmount::SmallIncrement
                    } else {
                        ScrollAmount::LargeIncrement
                    },
                ),
                "left" => (
                    if small {
                        ScrollAmount::SmallDecrement
                    } else {
                        ScrollAmount::LargeDecrement
                    },
                    ScrollAmount::NoAmount,
                ),
                _ => (
                    if small {
                        ScrollAmount::SmallIncrement
                    } else {
                        ScrollAmount::LargeIncrement
                    },
                    ScrollAmount::NoAmount,
                ),
            };
            pattern
                .scroll(horizontal, vertical)
                .map_err(|error| format!("scroll_failed: {error}"))?;
            used_pattern = true;
        }
        if !used_pattern {
            let point = target
                .as_ref()
                .and_then(|element| element.get_click_point().ok())
                .unwrap_or_else(|| info.rect.center());
            let step = if large { 360 } else { 120 };
            let (horizontal, delta) = match direction.as_str() {
                "up" => (false, step),
                "down" => (false, -step),
                "left" => (true, -step),
                _ => (true, step),
            };
            require_point_in_app(&automation, point, info.pid)?;
            mouse_wheel(point, horizontal, delta)?;
        }
        let after = self.thumb(config, &window, &info, "after");
        let detail = format!(
            "scrolled {direction} by {}",
            if large { "large" } else { "small" }
        );
        audit_action(config, "scroll", &info, false, &detail, before, after);
        Ok(ok_json(json!({
            "ok": true,
            "action": "scroll",
            "app": info.exe,
            "direction": direction,
            "amount": if large { "large" } else { "small" },
        })))
    }

    fn drag(&self, config: &ComputerUseConfig, args: DragArgs) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        if !args.confirm.unwrap_or(false) {
            return Err("confirmation_required: set confirm=true for drag".to_string());
        }
        let automation = automation()?;
        let (window, info) = resolve_window(&automation, &args.app, None)?;
        require_app(config, &info, AppTier::Interact)?;
        let start = Point::new(args.from_x, args.from_y);
        let end = Point::new(args.to_x, args.to_y);
        if !info.rect.contains(args.from_x, args.from_y)
            || !info.rect.contains(args.to_x, args.to_y)
        {
            return Err("invalid_arguments: drag points must be inside the window".to_string());
        }
        ensure_point_not_password(&automation, start)?;
        ensure_point_not_password(&automation, end)?;
        require_point_in_app(&automation, start, info.pid)?;
        require_point_in_app(&automation, end, info.pid)?;
        if config.dry_run {
            let detail = format!(
                "would drag from ({}, {}) to ({}, {})",
                args.from_x, args.from_y, args.to_x, args.to_y
            );
            audit_action(config, "drag", &info, true, &detail, None, None);
            return Ok(dry_run_result("drag", &info, "", &detail));
        }
        self.begin_action(config)?;
        let before = self.thumb(config, &window, &info, "before");
        let mouse = Mouse::new();
        mouse
            .move_to(&start)
            .map_err(|error| format!("drag_failed: {error}"))?;
        mouse
            .drag_to(MouseButton::LEFT, &end)
            .map_err(|error| format!("drag_failed: {error}"))?;
        let after = self.thumb(config, &window, &info, "after");
        let detail = format!(
            "dragged from ({}, {}) to ({}, {})",
            args.from_x, args.from_y, args.to_x, args.to_y
        );
        audit_action(config, "drag", &info, false, &detail, before, after);
        Ok(ok_json(json!({
            "ok": true,
            "action": "drag",
            "app": info.exe,
            "from": [args.from_x, args.from_y],
            "to": [args.to_x, args.to_y],
        })))
    }

    async fn wait(
        &self,
        config: &ComputerUseConfig,
        args: WaitArgs,
    ) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        let ms = args.ms.unwrap_or(500).min(5_000);
        if config.dry_run {
            let detail = format!("would wait {ms} ms");
            audit_raw(config, "wait", None, None, true, true, &detail, None, None);
            return Ok(ok_json(
                json!({"dry_run": true, "action": "wait", "ms": ms}),
            ));
        }
        self.begin_action(config)?;
        tokio::time::sleep(Duration::from_millis(ms)).await;
        let detail = format!("waited {ms} ms");
        audit_raw(config, "wait", None, None, false, true, &detail, None, None);
        Ok(ok_json(json!({"ok": true, "action": "wait", "ms": ms})))
    }

    fn focus_window(
        &self,
        config: &ComputerUseConfig,
        args: FocusWindowArgs,
    ) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        let automation = automation()?;
        let (window, info) = resolve_window(&automation, &args.app, args.window.as_deref())?;
        require_app(config, &info, AppTier::Interact)?;
        if config.dry_run {
            let detail = format!("would focus {}", info.title);
            audit_action(config, "focus_window", &info, true, &detail, None, None);
            return Ok(dry_run_result("focus_window", &info, "", &detail));
        }
        self.begin_action(config)?;
        window
            .set_focus()
            .map_err(|error| format!("focus_failed: {error}"))?;
        let detail = format!("focused {}", info.title);
        audit_action(config, "focus_window", &info, false, &detail, None, None);
        Ok(ok_json(json!({
            "ok": true,
            "action": "focus_window",
            "app": info.exe,
            "window": info.title,
        })))
    }

    fn launch_app(
        &self,
        config: &ComputerUseConfig,
        args: LaunchAppArgs,
    ) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        if !args.confirm.unwrap_or(false) {
            return Err("confirmation_required: set confirm=true to launch an app".to_string());
        }
        let path = Path::new(&args.path);
        if !path.is_absolute() {
            return Err("invalid_path: launch_app needs an absolute path".to_string());
        }
        let metadata = std::fs::metadata(path).map_err(|error| format!("invalid_path: {error}"))?;
        if !metadata.is_file() {
            return Err("invalid_path: path is not a file".to_string());
        }
        let is_exe = path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"));
        if !is_exe {
            return Err("invalid_path: launch_app only starts .exe files".to_string());
        }
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .ok_or_else(|| "invalid_path: missing file name".to_string())?;
        if let Some(reason) = crate::computer_use::hard_deny_reason(&args.path, "") {
            return Err(format!("hard_denied: {reason}"));
        }
        let policy = config
            .allow
            .iter()
            .find(|policy| {
                if policy.path.trim().is_empty() {
                    policy.name.eq_ignore_ascii_case(&name)
                } else {
                    path_matches(&policy.path, &args.path)
                }
            })
            .ok_or_else(|| {
                format!(
                    "app_not_allowlisted: add {name} to the allowlist in Settings > Computer use"
                )
            })?;
        if policy.tier != AppTier::Full {
            return Err("tier_denied: launch_app requires full access for this app".to_string());
        }
        if policy.path.trim().is_empty() {
            return Err(
                "tier_denied: launch_app requires an allowlist entry with an executable path"
                    .to_string(),
            );
        }
        if let Some(expected) = policy.publisher.as_deref() {
            let actual = crate::computer_use::publisher_for(&args.path);
            if actual.as_deref() != Some(expected) {
                return Err(format!(
                    "publisher_mismatch: {} expected {expected}, got {}",
                    args.path,
                    actual.as_deref().unwrap_or("unsigned or unverifiable")
                ));
            }
        }
        let extra = args.args.unwrap_or_default();
        if extra.len() > 32 {
            return Err("invalid_arguments: at most 32 arguments".to_string());
        }
        for value in &extra {
            if value.len() > 512 || value.contains('\0') {
                return Err("invalid_arguments: each argument must be 1-512 characters".to_string());
            }
        }
        if config.dry_run {
            let detail = format!("would launch {name} with {} args", extra.len());
            audit_raw(
                config,
                "launch_app",
                Some(&args.path),
                None,
                true,
                true,
                &detail,
                None,
                None,
            );
            return Ok(ok_json(json!({
                "dry_run": true,
                "action": "launch_app",
                "path": args.path,
                "args": extra.len(),
            })));
        }
        self.begin_action(config)?;
        let mut command = Command::new(path);
        command.args(&extra);
        command.creation_flags(CREATE_NO_WINDOW);
        let child = command
            .spawn()
            .map_err(|error| format!("launch_failed: {error}"))?;
        let detail = format!("launched {name} with {} args", extra.len());
        audit_raw(
            config,
            "launch_app",
            Some(&args.path),
            Some(child.id()),
            false,
            true,
            &detail,
            None,
            None,
        );
        Ok(ok_json(json!({
            "ok": true,
            "action": "launch_app",
            "path": args.path,
            "pid": child.id(),
        })))
    }

    fn read_clipboard(
        &self,
        config: &ComputerUseConfig,
        args: ReadClipboardArgs,
    ) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        if !args.confirm.unwrap_or(false) {
            return Err(
                "confirmation_required: set confirm=true to read the clipboard".to_string(),
            );
        }
        if !config
            .allow
            .iter()
            .any(|policy| policy.tier.allows(AppTier::Interact))
        {
            return Err(
                "app_not_allowlisted: add an app with interact access before reading the clipboard"
                    .to_string(),
            );
        }
        if config.dry_run {
            let detail = "would read the clipboard";
            audit_raw(
                config,
                "read_clipboard",
                None,
                None,
                true,
                true,
                detail,
                None,
                None,
            );
            return Ok(ok_json(
                json!({"dry_run": true, "action": "read_clipboard"}),
            ));
        }
        self.begin_action(config)?;
        let text = Clipboard::new()
            .map_err(|error| format!("clipboard_failed: {error}"))?
            .get_text()
            .map_err(|error| format!("clipboard_failed: {error}"))?;
        let text = truncate(&text, MAX_TEXT);
        let detail = format!("read {} chars from the clipboard", text.chars().count());
        audit_raw(
            config,
            "read_clipboard",
            None,
            None,
            false,
            true,
            &detail,
            None,
            None,
        );
        Ok(ok_json(json!({
            "ok": true,
            "action": "read_clipboard",
            "text": text,
        })))
    }

    fn write_clipboard(
        &self,
        config: &ComputerUseConfig,
        args: WriteClipboardArgs,
    ) -> Result<CallToolResult, String> {
        self.require_active(config)?;
        if !args.confirm.unwrap_or(false) {
            return Err(
                "confirmation_required: set confirm=true to write the clipboard".to_string(),
            );
        }
        if args.text.chars().count() > MAX_TEXT {
            return Err(format!("text_too_long: limit is {MAX_TEXT} characters"));
        }
        if !config
            .allow
            .iter()
            .any(|policy| policy.tier == AppTier::Full)
        {
            return Err(
                "tier_denied: clipboard write requires an app with full access".to_string(),
            );
        }
        if config.dry_run {
            let detail = format!(
                "would write {} chars to the clipboard",
                args.text.chars().count()
            );
            audit_raw(
                config,
                "write_clipboard",
                None,
                None,
                true,
                true,
                &detail,
                None,
                None,
            );
            return Ok(ok_json(json!({
                "dry_run": true,
                "action": "write_clipboard",
                "chars": args.text.chars().count(),
            })));
        }
        self.begin_action(config)?;
        Clipboard::new()
            .map_err(|error| format!("clipboard_failed: {error}"))?
            .set_text(&args.text)
            .map_err(|error| format!("clipboard_failed: {error}"))?;
        let detail = format!("wrote {} chars to the clipboard", args.text.chars().count());
        audit_raw(
            config,
            "write_clipboard",
            None,
            None,
            false,
            true,
            &detail,
            None,
            None,
        );
        Ok(ok_json(json!({
            "ok": true,
            "action": "write_clipboard",
            "chars": args.text.chars().count(),
        })))
    }

    fn thumb(
        &self,
        config: &ComputerUseConfig,
        element: &UIElement,
        info: &WindowInfo,
        label: &str,
    ) -> Option<String> {
        if !config.audit_thumbnails {
            return None;
        }
        let shot = capture_element(element, info).ok()?;
        let dir = crate::computer_use::audit_dir().ok()?;
        std::fs::create_dir_all(&dir).ok()?;
        let name = format!(
            "{}-{}-{}.png",
            now_ms(),
            label,
            uuid::Uuid::new_v4().simple()
        );
        shot.save_png(dir.join(&name)).ok()?;
        Some(name)
    }
}

fn tools() -> Vec<Tool> {
    vec![
        tool(
            "list_apps",
            "List running Windows apps with process id, executable path, windows, tier and hard-deny reason. Use this before choosing an app.",
            schema(json!({}), &[]),
            true,
        ),
        tool(
            "list_windows",
            "List top-level windows, optionally filtered by app name, path, pid or title.",
            schema(
                json!({
                    "app": {"type": "string", "description": "Optional app name, path, pid or title filter."}
                }),
                &[],
            ),
            true,
        ),
        tool(
            "get_state",
            "Read a compact UI Automation tree for an allowlisted app window. Returns a snapshot id and element ids for actions. Element ids expire.",
            schema(
                json!({
                    "app": {"type": "string", "description": "App name, executable path, pid or window title."},
                    "window": {"type": "string", "description": "Optional window title or class filter."},
                    "max_nodes": {"type": "integer", "minimum": 50, "maximum": 1200, "description": "Node cap; default 600."},
                    "screenshot": {"type": "boolean", "description": "Also return a PNG screenshot."}
                }),
                &["app"],
            ),
            true,
        ),
        tool(
            "screenshot",
            "Capture an allowlisted app window as a PNG. Use pixels only when the UI Automation tree is missing or canvas-based.",
            schema(
                json!({
                    "app": {"type": "string", "description": "App name, executable path, pid or window title."},
                    "window": {"type": "string", "description": "Optional window title or class filter."}
                }),
                &["app"],
            ),
            true,
        ),
        tool(
            "invoke",
            "Invoke an element from the current snapshot. Prefers the UI Automation invoke or toggle pattern and falls back to a click.",
            schema(
                json!({
                    "app": {"type": "string", "description": "Optional app check."},
                    "snapshot": {"type": "string", "description": "Snapshot id from get_state."},
                    "element": {"type": "string", "description": "Element id from the snapshot."}
                }),
                &["snapshot", "element"],
            ),
            false,
        ),
        tool(
            "click",
            "Click an element from the current snapshot, or a screen point with app plus x and y. Refuses password fields and offscreen points.",
            schema(
                json!({
                    "app": {"type": "string", "description": "App name, path, pid or title when clicking a point."},
                    "window": {"type": "string", "description": "Optional window title filter when clicking a point."},
                    "snapshot": {"type": "string", "description": "Snapshot id from get_state."},
                    "element": {"type": "string", "description": "Element id from the snapshot."},
                    "x": {"type": "integer", "description": "Screen x coordinate for a point click."},
                    "y": {"type": "integer", "description": "Screen y coordinate for a point click."},
                    "button": {"type": "string", "enum": ["left", "right"]},
                    "double": {"type": "boolean"}
                }),
                &[],
            ),
            false,
        ),
        tool(
            "type_text",
            "Type literal text into an element or the focused window. Pass snapshot and element, or app. Chromium windows expose only browser chrome, so click the page point first and pass confirm=true with app.",
            schema(
                json!({
                    "app": {"type": "string", "description": "App name, path, pid or title when no element is given."},
                    "snapshot": {"type": "string", "description": "Optional snapshot id."},
                    "element": {"type": "string", "description": "Optional element id."},
                    "text": {"type": "string", "description": "Literal text, up to 10,000 characters."},
                    "confirm": {"type": "boolean", "description": "Required for app-only typing in Chromium windows, where focus cannot be verified."}
                }),
                &["text"],
            ),
            false,
        ),
        tool(
            "set_value",
            "Set a value-pattern element from the current snapshot. Use for edit boxes and sliders.",
            schema(
                json!({
                    "app": {"type": "string", "description": "Optional app check."},
                    "snapshot": {"type": "string", "description": "Snapshot id from get_state."},
                    "element": {"type": "string", "description": "Element id from the snapshot."},
                    "value": {"type": "string", "description": "New value."}
                }),
                &["snapshot", "element", "value"],
            ),
            false,
        ),
        tool(
            "press_keys",
            "Press a key sequence such as {ctrl}c or {enter}. Secure-attention, elevation and shell-launcher sequences are refused. Alt+F4 needs confirm=true.",
            schema(
                json!({
                    "app": {"type": "string", "description": "App name, path, pid or title when no snapshot is given."},
                    "snapshot": {"type": "string", "description": "Optional snapshot id."},
                    "keys": {"type": "string", "description": "Key sequence."},
                    "confirm": {"type": "boolean", "description": "Required for Alt+F4."}
                }),
                &["keys"],
            ),
            false,
        ),
        tool(
            "scroll",
            "Scroll an element or window by a small or large step.",
            schema(
                json!({
                    "app": {"type": "string", "description": "App name, path, pid or title when no snapshot is given."},
                    "snapshot": {"type": "string", "description": "Optional snapshot id."},
                    "element": {"type": "string", "description": "Optional element id with a scroll pattern."},
                    "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                    "amount": {"type": "string", "enum": ["small", "large"]}
                }),
                &["direction"],
            ),
            false,
        ),
        tool(
            "drag",
            "Drag the left mouse button between two physical-pixel points inside an allowlisted window. Requires confirm=true.",
            schema(
                json!({
                    "app": {"type": "string", "description": "App name, path, pid or title."},
                    "from_x": {"type": "integer"},
                    "from_y": {"type": "integer"},
                    "to_x": {"type": "integer"},
                    "to_y": {"type": "integer"},
                    "confirm": {"type": "boolean"}
                }),
                &["app", "from_x", "from_y", "to_x", "to_y"],
            ),
            false,
        ),
        tool(
            "wait",
            "Wait up to 5 seconds for the UI to settle.",
            schema(
                json!({"ms": {"type": "integer", "minimum": 0, "maximum": 5000}}),
                &[],
            ),
            false,
        ),
        tool(
            "focus_window",
            "Focus an allowlisted app window.",
            schema(
                json!({
                    "app": {"type": "string", "description": "App name, path, pid or title."},
                    "window": {"type": "string", "description": "Optional window title or class filter."}
                }),
                &["app"],
            ),
            false,
        ),
        tool(
            "launch_app",
            "Launch an allowlisted executable with full access. Requires confirm=true. No shell is used.",
            schema(
                json!({
                    "path": {"type": "string", "description": "Absolute executable path."},
                    "args": {"type": "array", "items": {"type": "string"}, "maxItems": 32},
                    "confirm": {"type": "boolean"}
                }),
                &["path"],
            ),
            false,
        ),
        tool(
            "read_clipboard",
            "Read text from the clipboard. Requires an app with interact access and confirm=true.",
            schema(
                json!({
                    "confirm": {"type": "boolean"}
                }),
                &[],
            ),
            false,
        ),
        tool(
            "write_clipboard",
            "Write text to the clipboard. Requires an app with full access and confirm=true.",
            schema(
                json!({
                    "text": {"type": "string", "description": "Text up to 10,000 characters."},
                    "confirm": {"type": "boolean"}
                }),
                &["text"],
            ),
            false,
        ),
    ]
}

fn tool(name: &'static str, description: &'static str, schema: Value, read_only: bool) -> Tool {
    let object = schema.as_object().cloned().unwrap_or_default();
    Tool::new(name, description, object).with_annotations(
        ToolAnnotations::new()
            .read_only(read_only)
            .destructive(!read_only)
            .open_world(false),
    )
}

fn schema(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false,
    })
}

fn parse<T: DeserializeOwned>(value: &Value) -> Result<T, String> {
    serde_json::from_value(value.clone()).map_err(|error| format!("invalid_arguments: {error}"))
}

fn should_yield(idle_ms: Option<u32>, last_action_age: Option<Duration>) -> bool {
    let Some(age) = last_action_age else {
        return false;
    };
    if age < Duration::from_millis(750) {
        return false;
    }
    idle_ms.is_some_and(|idle| idle < 750)
}

fn error_result(message: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message.into())])
}

fn ok_json(value: Value) -> CallToolResult {
    CallToolResult::success(vec![ContentBlock::text(value.to_string())])
}

fn dry_run_result(action: &str, info: &WindowInfo, target: &str, detail: &str) -> CallToolResult {
    ok_json(json!({
        "dry_run": true,
        "action": action,
        "app": info.exe,
        "target": target,
        "detail": detail,
    }))
}

fn result_text(result: &CallToolResult) -> String {
    result
        .content
        .iter()
        .filter_map(|content| content.as_text().map(|text| text.text.clone()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn audit_failure(config: &ComputerUseConfig, action: &str, args: &Value, result: &CallToolResult) {
    let app = args.get("app").and_then(Value::as_str);
    let detail = result_text(result);
    audit_raw(config, action, app, None, false, false, &detail, None, None);
}

fn audit_action(
    config: &ComputerUseConfig,
    action: &str,
    info: &WindowInfo,
    dry_run: bool,
    detail: &str,
    before: Option<String>,
    after: Option<String>,
) {
    audit_raw(
        config,
        action,
        Some(&info.exe),
        Some(info.pid),
        dry_run,
        true,
        detail,
        before,
        after,
    );
}

#[allow(clippy::too_many_arguments)]
fn audit_raw(
    _config: &ComputerUseConfig,
    action: &str,
    app: Option<&str>,
    pid: Option<u32>,
    dry_run: bool,
    ok: bool,
    detail: &str,
    before: Option<String>,
    after: Option<String>,
) {
    crate::computer_use::append_audit(&AuditEntry {
        at: now_ms(),
        action: action.to_string(),
        app: app.map(str::to_string),
        pid,
        dry_run,
        ok,
        detail: truncate(detail, 2_000),
        before,
        after,
    });
}

fn automation() -> Result<UIAutomation, String> {
    UIAutomation::new().map_err(|error| format!("uia_failed: {error}"))
}

fn top_level_windows(automation: &UIAutomation) -> Result<Vec<(UIElement, WindowInfo)>, String> {
    let root = automation
        .get_root_element()
        .map_err(|error| format!("uia_failed: {error}"))?;
    let walker = automation
        .get_control_view_walker()
        .map_err(|error| format!("uia_failed: {error}"))?;
    let self_exe = std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let mut out = Vec::new();
    let mut current = match walker.get_first_child(&root) {
        Ok(element) => element,
        Err(_) => return Ok(out),
    };
    let mut guard = 0;
    loop {
        guard += 1;
        if guard > 2_000 {
            break;
        }
        if let Some(info) = window_info(&current, self_exe.as_deref()) {
            out.push((current.clone(), info));
        }
        match walker.get_next_sibling(&current) {
            Ok(next) => current = next,
            Err(_) => break,
        }
    }
    Ok(out)
}

fn window_info(element: &UIElement, self_exe: Option<&str>) -> Option<WindowInfo> {
    let handle = element.get_native_window_handle().ok()?;
    if handle.is_invalid() {
        return None;
    }
    let pid = element.get_process_id().ok()?;
    if pid == 0 {
        return None;
    }
    let rect = element.get_bounding_rectangle().ok()?;
    let rect = RectInfo {
        left: rect.get_left(),
        top: rect.get_top(),
        right: rect.get_right(),
        bottom: rect.get_bottom(),
    };
    if rect.width() <= 0 || rect.height() <= 0 {
        return None;
    }
    let exe = process_path(pid).unwrap_or_default();
    if let Some(self_exe) = self_exe
        && exe.eq_ignore_ascii_case(self_exe)
    {
        return None;
    }
    let name = file_name(&exe);
    let title = truncate(&element.get_name().unwrap_or_default(), 300);
    let class = truncate(&element.get_classname().unwrap_or_default(), 300);
    let hwnd: isize = handle.into();
    Some(WindowInfo {
        pid,
        hwnd,
        exe,
        name,
        title,
        class,
        rect,
        focused: element.has_keyboard_focus().unwrap_or(false),
        offscreen: element.is_offscreen().unwrap_or(false),
    })
}

fn resolve_window(
    automation: &UIAutomation,
    app: &str,
    window: Option<&str>,
) -> Result<(UIElement, WindowInfo), String> {
    let app = app.trim();
    if app.is_empty() {
        return Err("app_required: pass an app name, path, pid or title".to_string());
    }
    let windows = top_level_windows(automation)?;
    let pid_filter = app.parse::<u32>().ok();
    let needle = app.to_ascii_lowercase();
    let window_needle = window
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let mut matches: Vec<(UIElement, WindowInfo)> = windows
        .into_iter()
        .filter(|(_, info)| {
            let app_match = if let Some(pid) = pid_filter {
                info.pid == pid
            } else {
                let exe = info.exe.to_ascii_lowercase();
                let name = info.name.to_ascii_lowercase();
                let title = info.title.to_ascii_lowercase();
                let class = info.class.to_ascii_lowercase();
                exe == needle
                    || exe.ends_with(&needle)
                    || name == needle
                    || name.contains(&needle)
                    || title.contains(&needle)
                    || class.contains(&needle)
            };
            if !app_match {
                return false;
            }
            if let Some(window_needle) = &window_needle {
                let title = info.title.to_ascii_lowercase();
                let class = info.class.to_ascii_lowercase();
                if !title.contains(window_needle) && !class.contains(window_needle) {
                    return false;
                }
            }
            true
        })
        .collect();
    if matches.is_empty() {
        return Err(format!("app_not_found: no window matched {app:?}"));
    }
    matches.sort_by_key(|(_, info)| std::cmp::Reverse(info.rect.area()));
    if let Some(index) = matches.iter().position(|(_, info)| !info.offscreen) {
        return Ok(matches.swap_remove(index));
    }
    Ok(matches.swap_remove(0))
}

fn find_window_by_snapshot(
    automation: &UIAutomation,
    snapshot: &Snapshot,
) -> Result<(UIElement, WindowInfo), String> {
    let windows = top_level_windows(automation)?;
    let mut candidates: Vec<(UIElement, WindowInfo)> = windows
        .into_iter()
        .filter(|(_, info)| info.pid == snapshot.pid)
        .collect();
    if snapshot.hwnd != 0 {
        if let Some(index) = candidates
            .iter()
            .position(|(_, info)| info.hwnd == snapshot.hwnd)
        {
            return Ok(candidates.swap_remove(index));
        }
        return Err(
            "stale_snapshot: the bound window is gone; observe again with get_state".to_string(),
        );
    }
    candidates.retain(|(_, info)| {
        snapshot.window_class.is_empty() || info.class.eq_ignore_ascii_case(&snapshot.window_class)
    });
    if candidates.is_empty() {
        return Err("stale_snapshot: the window is gone; observe again with get_state".to_string());
    }
    if let Some(index) = candidates
        .iter()
        .position(|(_, info)| info.title == snapshot.window_title)
    {
        return Ok(candidates.swap_remove(index));
    }
    Ok(candidates.swap_remove(0))
}

fn resolve_snapshot_element(
    automation: &UIAutomation,
    snapshots: &Arc<Mutex<SnapshotStore>>,
    snapshot_id: &str,
    element_id: &str,
) -> Result<(Snapshot, ElementRef, UIElement, WindowInfo), String> {
    let snapshot = snapshots
        .lock()
        .map_err(|_| "state_lock_failed: snapshot store is unavailable".to_string())?
        .get(snapshot_id)
        .ok_or_else(|| "stale_snapshot: observe again with get_state".to_string())?;
    let element_ref = snapshot.elements.get(element_id).cloned().ok_or_else(|| {
        format!("stale_snapshot: element {element_id} is not in snapshot {snapshot_id}")
    })?;
    if element_ref.password {
        return Err("password_field: password fields are hard-denied".to_string());
    }
    let (window, info) = find_window_by_snapshot(automation, &snapshot)?;
    let condition = automation
        .create_property_condition(
            UIProperty::RuntimeId,
            Variant::from(VariantValue::ArrayI4(element_ref.runtime_id.clone())),
            None,
        )
        .map_err(|error| format!("uia_failed: {error}"))?;
    let element = window
        .find_first(TreeScope::Descendants, &condition)
        .map_err(|_| {
            format!("stale_snapshot: element {element_id} is gone; observe again with get_state")
        })?;
    if element.get_process_id().unwrap_or(0) != snapshot.pid {
        return Err(
            "stale_snapshot: the element now belongs to another process; observe again".to_string(),
        );
    }
    if element.is_password().unwrap_or(false) {
        return Err("password_field: password fields are hard-denied".to_string());
    }
    if element.is_offscreen().unwrap_or(false) {
        return Err("element_offscreen: scroll or focus the element into view first".to_string());
    }
    Ok((snapshot, element_ref, element, info))
}

fn build_state(
    automation: &UIAutomation,
    window: &UIElement,
    info: &WindowInfo,
    tier: AppTier,
    max_nodes: usize,
    max_depth: usize,
) -> Result<(Snapshot, Value), String> {
    let walker = automation
        .get_control_view_walker()
        .map_err(|error| format!("uia_failed: {error}"))?;
    let mut builder = TreeBuilder {
        walker: &walker,
        elements: HashMap::new(),
        nodes: Vec::new(),
        count: 0,
        max_nodes,
        max_depth,
    };
    if is_chromium_window(info) {
        builder.walk_breadth(window);
    } else {
        builder.walk(window, 0, None);
    }
    let truncated = builder.count >= max_nodes;
    let TreeBuilder {
        elements, nodes, ..
    } = builder;
    let has_document = nodes.iter().any(|node| {
        node["role"]
            .as_str()
            .map(|role| role.eq_ignore_ascii_case("Document"))
            .unwrap_or(false)
    });
    let snapshot = Snapshot {
        created: Instant::now(),
        pid: info.pid,
        hwnd: info.hwnd,
        window_title: info.title.clone(),
        window_class: info.class.clone(),
        has_document,
        elements,
    };
    let state = json!({
        "app": {
            "pid": info.pid,
            "exe": info.exe,
            "name": info.name,
            "tier": tier.as_str(),
        },
        "window": {
            "title": info.title,
            "class": info.class,
            "bounds": info.rect.to_json(),
            "focused": info.focused,
            "offscreen": info.offscreen,
        },
        "nodes": nodes,
        "truncated": truncated,
        "limits": {
            "max_nodes": max_nodes,
            "max_depth": max_depth,
        },
    });
    Ok((snapshot, state))
}

struct TreeBuilder<'a> {
    walker: &'a uiautomation::core::UITreeWalker,
    elements: HashMap<String, ElementRef>,
    nodes: Vec<Value>,
    count: usize,
    max_nodes: usize,
    max_depth: usize,
}

impl TreeBuilder<'_> {
    fn record(&mut self, element: &UIElement, depth: usize, parent: Option<&str>) -> String {
        let id = format!("e{}", self.count + 1);
        self.count += 1;
        let role = element
            .get_control_type()
            .map(|kind| format!("{kind:?}"))
            .unwrap_or_else(|_| "Custom".to_string());
        let name = truncate(&element.get_name().unwrap_or_default(), 200);
        let automation_id = truncate(&element.get_automation_id().unwrap_or_default(), 200);
        let class = truncate(&element.get_classname().unwrap_or_default(), 200);
        let password = element.is_password().unwrap_or(false);
        let enabled = element.is_enabled().unwrap_or(false);
        let focused = element.has_keyboard_focus().unwrap_or(false);
        let offscreen = element.is_offscreen().unwrap_or(false);
        let bounds = element.get_bounding_rectangle().ok().map(|rect| {
            json!({
                "left": rect.get_left(),
                "top": rect.get_top(),
                "right": rect.get_right(),
                "bottom": rect.get_bottom(),
            })
        });
        let patterns = pattern_names(element, &role);
        let value = if password {
            None
        } else {
            read_value(element, &role)
        };
        let runtime_id = element.get_runtime_id().ok();
        if let Some(runtime_id) = &runtime_id {
            self.elements.insert(
                id.clone(),
                ElementRef {
                    runtime_id: runtime_id.clone(),
                    name: name.clone(),
                    password,
                },
            );
        }
        let actionable = runtime_id.is_some();
        self.nodes.push(json!({
            "id": id,
            "parent": parent,
            "depth": depth,
            "role": role,
            "name": name,
            "automation_id": automation_id,
            "class": class,
            "bounds": bounds,
            "enabled": enabled,
            "focused": focused,
            "offscreen": offscreen,
            "password": password,
            "patterns": patterns,
            "value": value,
            "actionable": actionable,
        }));
        id
    }

    fn walk(&mut self, element: &UIElement, depth: usize, parent: Option<&str>) {
        if self.count >= self.max_nodes {
            return;
        }
        let id = self.record(element, depth, parent);
        if depth >= self.max_depth {
            return;
        }
        if let Ok(first) = self.walker.get_first_child(element) {
            let mut current = first;
            let mut guard = 0;
            loop {
                self.walk(&current, depth + 1, Some(&id));
                guard += 1;
                if guard >= 500 || self.count >= self.max_nodes {
                    break;
                }
                match self.walker.get_next_sibling(&current) {
                    Ok(next) => current = next,
                    Err(_) => break,
                }
            }
        }
    }

    fn walk_breadth(&mut self, root: &UIElement) {
        let mut queue: VecDeque<(UIElement, usize, Option<String>)> = VecDeque::new();
        queue.push_back((root.clone(), 0, None));
        while let Some((element, depth, parent)) = queue.pop_front() {
            if self.count >= self.max_nodes {
                break;
            }
            let id = self.record(&element, depth, parent.as_deref());
            if depth >= self.max_depth {
                continue;
            }
            if let Ok(mut child) = self.walker.get_first_child(&element) {
                let mut guard = 0;
                loop {
                    queue.push_back((child.clone(), depth + 1, Some(id.clone())));
                    guard += 1;
                    if guard >= 500 {
                        break;
                    }
                    match self.walker.get_next_sibling(&child) {
                        Ok(next) => child = next,
                        Err(_) => break,
                    }
                }
            }
        }
    }
}

fn pattern_names(element: &UIElement, role: &str) -> Vec<&'static str> {
    let role = role.to_ascii_lowercase();
    let mut out = Vec::new();
    if matches!(
        role.as_str(),
        "button"
            | "hyperlink"
            | "menuitem"
            | "splitbutton"
            | "listitem"
            | "tabitem"
            | "treeitem"
            | "dataitem"
    ) && element.get_pattern::<UIInvokePattern>().is_ok()
    {
        out.push("invoke");
    }
    if matches!(role.as_str(), "edit" | "combobox" | "document")
        && element.get_pattern::<UIValuePattern>().is_ok()
    {
        out.push("value");
    }
    if matches!(role.as_str(), "checkbox" | "radiobutton")
        && element.get_pattern::<UITogglePattern>().is_ok()
    {
        out.push("toggle");
    }
    if matches!(role.as_str(), "treeitem" | "menuitem" | "combobox")
        && element
            .get_pattern::<uiautomation::patterns::UIExpandCollapsePattern>()
            .is_ok()
    {
        out.push("expand_collapse");
    }
    if matches!(
        role.as_str(),
        "list" | "document" | "pane" | "window" | "datagrid"
    ) && element.get_pattern::<UIScrollPattern>().is_ok()
    {
        out.push("scroll");
    }
    if matches!(role.as_str(), "slider" | "spinner" | "progressbar")
        && element.get_pattern::<UIRangeValuePattern>().is_ok()
    {
        out.push("range_value");
    }
    out
}

fn read_value(element: &UIElement, role: &str) -> Option<String> {
    let role = role.to_ascii_lowercase();
    if !matches!(role.as_str(), "edit" | "combobox" | "document") {
        return None;
    }
    element
        .get_pattern::<UIValuePattern>()
        .ok()
        .and_then(|pattern| pattern.get_value().ok())
        .map(|value| truncate(&value, 300))
}

fn policy_for(config: &ComputerUseConfig, info: &WindowInfo) -> PolicyMatch {
    if let Some(reason) = crate::computer_use::hard_deny_reason(&info.exe, &info.title) {
        return PolicyMatch {
            tier: None,
            blocked: Some(reason),
            publisher: None,
        };
    }
    let name = file_name(&info.exe).to_ascii_lowercase();
    let exe = info.exe.to_ascii_lowercase();
    let title = info.title.to_ascii_lowercase();
    if let Some(rule) = config.deny.iter().find(|rule| {
        let rule = rule.to_ascii_lowercase();
        rule == name || (!exe.is_empty() && exe.ends_with(&rule)) || title.contains(&rule)
    }) {
        return PolicyMatch {
            tier: None,
            blocked: Some(format!("user deny rule {rule:?}")),
            publisher: None,
        };
    }
    let policy = config.allow.iter().find(|policy| {
        let policy_name = policy.name.to_ascii_lowercase();
        if policy.path.trim().is_empty() {
            !policy_name.is_empty() && policy_name == name
        } else {
            !exe.is_empty() && path_matches(&policy.path, &info.exe)
        }
    });
    PolicyMatch {
        tier: policy.map(|policy| policy.tier),
        blocked: None,
        publisher: policy.and_then(|policy| policy.publisher.clone()),
    }
}

fn require_app(
    config: &ComputerUseConfig,
    info: &WindowInfo,
    needed: AppTier,
) -> Result<AppTier, String> {
    let policy = policy_for(config, info);
    if let Some(reason) = policy.blocked {
        return Err(format!("hard_denied: {reason}"));
    }
    let tier = policy.tier.ok_or_else(|| {
        format!(
            "app_not_allowlisted: add {} in Settings > Computer use",
            if info.exe.is_empty() {
                info.name.as_str()
            } else {
                info.exe.as_str()
            }
        )
    })?;
    if !tier.allows(needed) {
        return Err(format!(
            "tier_denied: {} needs {} access; current tier is {}",
            info.exe,
            needed.as_str(),
            tier.as_str()
        ));
    }
    if let Some(expected) = policy.publisher.as_deref() {
        let actual = crate::computer_use::publisher_for(&info.exe);
        if actual.as_deref() != Some(expected) {
            return Err(format!(
                "publisher_mismatch: {} expected {expected}, got {}",
                info.exe,
                actual.as_deref().unwrap_or("unsigned or unverifiable")
            ));
        }
    }
    Ok(tier)
}

fn verify_app_argument(app: &Option<String>, info: &WindowInfo) -> Result<(), String> {
    if let Some(app) = app.as_deref()
        && !app.trim().is_empty()
        && !app_matches_info(app, info)
    {
        return Err(format!(
            "snapshot_mismatch: snapshot belongs to {}, not {app:?}",
            info.exe
        ));
    }
    Ok(())
}

fn app_matches_info(app: &str, info: &WindowInfo) -> bool {
    let app = app.trim().to_ascii_lowercase();
    if app.is_empty() {
        return true;
    }
    app == info.pid.to_string()
        || info.exe.to_ascii_lowercase().ends_with(&app)
        || info.name.to_ascii_lowercase().contains(&app)
        || info.title.to_ascii_lowercase().contains(&app)
}

fn path_matches(policy: &str, actual: &str) -> bool {
    let policy = policy.trim();
    !policy.is_empty()
        && Path::new(policy).is_absolute()
        && policy.eq_ignore_ascii_case(actual.trim())
}

fn chromium_root(automation: &UIAutomation, info: &WindowInfo, window: &UIElement) -> UIElement {
    let Some(renderer) = chromium_renderer(info.hwnd) else {
        return window.clone();
    };
    let Ok(element) = automation.element_from_handle(renderer.into()) else {
        return window.clone();
    };
    if chromium_is_active(info.hwnd) {
        let _ = element.get_name();
        if let Ok(tree) = build_state(automation, &element, info, AppTier::View, 40, 3)
            && nodes_have_document(&tree.1)
        {
            return element;
        }
    }
    for attempt in 0..12 {
        wake_chromium_accessibility(info.hwnd);
        let _ = element.get_name();
        std::thread::sleep(Duration::from_millis(if attempt == 0 { 150 } else { 250 }));
        if let Ok(tree) = build_state(automation, &element, info, AppTier::View, 40, 3)
            && nodes_have_document(&tree.1)
        {
            mark_chromium_active(info.hwnd);
            return element;
        }
    }
    element
}

fn chromium_active() -> &'static Mutex<Vec<(isize, Instant)>> {
    static ACTIVE: std::sync::OnceLock<Mutex<Vec<(isize, Instant)>>> = std::sync::OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(Vec::new()))
}

const CHROMIUM_READY_TTL: Duration = Duration::from_secs(120);

fn chromium_is_active(hwnd: isize) -> bool {
    chromium_active()
        .lock()
        .map(|items| {
            items
                .iter()
                .any(|(item, at)| *item == hwnd && at.elapsed() < CHROMIUM_READY_TTL)
        })
        .unwrap_or(false)
}

fn mark_chromium_active(hwnd: isize) {
    if let Ok(mut items) = chromium_active().lock() {
        items.retain(|(item, at)| *item != hwnd || at.elapsed() < CHROMIUM_READY_TTL);
        items.push((hwnd, Instant::now()));
    }
}

fn nodes_have_document(state: &Value) -> bool {
    state["nodes"]
        .as_array()
        .map(|nodes| {
            nodes.iter().any(|node| {
                node["role"]
                    .as_str()
                    .map(|role| role.eq_ignore_ascii_case("Document"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn is_chromium_window(info: &WindowInfo) -> bool {
    info.class.to_ascii_lowercase().contains("chrome_widgetwin")
}

unsafe extern "system" fn collect_child_window(hwnd: *mut std::ffi::c_void, lparam: isize) -> i32 {
    let children = unsafe { &mut *(lparam as *mut Vec<isize>) };
    children.push(hwnd as isize);
    1
}

fn wake_chromium_accessibility(hwnd: isize) {
    if let Some(renderer) = chromium_renderer(hwnd) {
        unsafe {
            SendMessageW(
                renderer as *mut std::ffi::c_void,
                WM_GETOBJECT,
                0,
                UIA_ROOT_OBJECT_ID,
            );
        }
    }
}

fn chromium_renderer(hwnd: isize) -> Option<isize> {
    if hwnd == 0 {
        return None;
    }
    let mut children: Vec<isize> = Vec::new();
    unsafe {
        EnumChildWindows(
            hwnd as *mut std::ffi::c_void,
            Some(collect_child_window),
            &mut children as *mut Vec<isize> as isize,
        );
    }
    children.into_iter().find(|child| {
        let mut buffer = [0u16; 256];
        let len = unsafe {
            GetClassNameW(
                *child as *mut std::ffi::c_void,
                buffer.as_mut_ptr(),
                buffer.len() as i32,
            )
        };
        len > 0
            && String::from_utf16_lossy(&buffer[..len as usize])
                .eq_ignore_ascii_case("Chrome_RenderWidgetHostHWND")
    })
}

fn password_label(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    ["password", "passwd", "passcode", "pwd", "secret"]
        .iter()
        .any(|needle| value.contains(needle))
}

fn element_looks_like_password(element: &UIElement) -> bool {
    if element.is_password().unwrap_or(false) {
        return true;
    }
    [
        element.get_name().unwrap_or_default(),
        element.get_automation_id().unwrap_or_default(),
        element.get_help_text().unwrap_or_default(),
        element.get_classname().unwrap_or_default(),
    ]
    .iter()
    .any(|value| password_label(value))
}

fn ensure_focus_not_password(automation: &UIAutomation) -> Result<(), String> {
    if let Ok(focused) = automation.get_focused_element()
        && element_looks_like_password(&focused)
    {
        return Err("password_field: the focused control is a password field".to_string());
    }
    Ok(())
}

fn ensure_focused_app(automation: &UIAutomation, pid: u32) -> Result<(), String> {
    let focused = automation
        .get_focused_element()
        .map_err(|error| format!("uia_failed: {error}"))?;
    if focused.get_process_id().unwrap_or(0) != pid {
        return Err("not_foreground: focus the allowlisted app before sending input".to_string());
    }
    Ok(())
}

fn focus_app_for_input(
    automation: &UIAutomation,
    window: &UIElement,
    pid: u32,
) -> Result<(), String> {
    ensure_focus_not_password(automation)?;
    let focused = automation
        .get_focused_element()
        .map_err(|error| format!("uia_failed: {error}"))?;
    if focused.get_process_id().unwrap_or(0) != pid {
        window
            .set_focus()
            .map_err(|error| format!("focus_failed: {error}"))?;
        ensure_focused_app(automation, pid)?;
        ensure_focus_not_password(automation)?;
    }
    Ok(())
}

fn element_click_point(element: &UIElement) -> Result<Point, String> {
    let rect = element
        .get_bounding_rectangle()
        .map_err(|error| format!("click_failed: {error}"))?;
    let center = Point::new(
        (rect.get_left() + rect.get_right()) / 2,
        (rect.get_top() + rect.get_bottom()) / 2,
    );
    let inside = |x: i32, y: i32| {
        x >= rect.get_left()
            && x <= rect.get_right()
            && y >= rect.get_top()
            && y <= rect.get_bottom()
    };
    match element.get_clickable_point() {
        Ok(Some(point)) if inside(point.get_x(), point.get_y()) => Ok(point),
        _ => Ok(center),
    }
}

fn require_point_matches_element(
    automation: &UIAutomation,
    point: Point,
    element: &UIElement,
    info: &WindowInfo,
) -> Result<(), String> {
    let expected = element
        .get_bounding_rectangle()
        .map_err(|error| format!("uia_failed: {error}"))?;
    let hit = automation
        .element_from_point(point)
        .map_err(|error| format!("uia_failed: {error}"))?;
    if hit.get_process_id().unwrap_or(0) != info.pid {
        return Err("not_foreground: the click point is covered by another app".to_string());
    }
    let Ok(actual) = hit.get_bounding_rectangle() else {
        return Ok(());
    };
    let inside = actual.get_left() >= expected.get_left() - 1
        && actual.get_top() >= expected.get_top() - 1
        && actual.get_right() <= expected.get_right() + 1
        && actual.get_bottom() <= expected.get_bottom() + 1;
    if inside {
        return Ok(());
    }
    Err(format!(
        "click_target_mismatch: point ({}, {}) resolves outside the observed element; expected {:?} got {:?}",
        point.get_x(),
        point.get_y(),
        (
            expected.get_left(),
            expected.get_top(),
            expected.get_right(),
            expected.get_bottom()
        ),
        (
            actual.get_left(),
            actual.get_top(),
            actual.get_right(),
            actual.get_bottom()
        )
    ))
}

fn require_point_in_app(automation: &UIAutomation, point: Point, pid: u32) -> Result<(), String> {
    let element = automation
        .element_from_point(point)
        .map_err(|error| format!("uia_failed: {error}"))?;
    if element.get_process_id().unwrap_or(0) != pid {
        return Err("not_foreground: the point is not inside the allowlisted app".to_string());
    }
    Ok(())
}

fn ensure_point_not_password(automation: &UIAutomation, point: Point) -> Result<(), String> {
    if let Ok(element) = automation.element_from_point(point)
        && element_looks_like_password(&element)
    {
        return Err("password_field: the point is inside a password field".to_string());
    }
    Ok(())
}

fn validate_keys(keys: &str, confirmed: bool) -> Result<(), String> {
    if keys.trim().is_empty() {
        return Err("invalid_keys: keys is empty".to_string());
    }
    if keys.len() > MAX_KEYS {
        return Err(format!("invalid_keys: limit is {MAX_KEYS} characters"));
    }
    let compact: String = keys
        .to_ascii_lowercase()
        .chars()
        .filter(|value| !value.is_whitespace() && *value != '{' && *value != '}')
        .collect();
    let has = |needle: &str| compact.contains(needle);
    let normalized = keys
        .to_ascii_lowercase()
        .replace("}{", "+")
        .replace(['{', '}'], "");
    let tokens: Vec<&str> = normalized
        .split('+')
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .collect();
    let has_token = |needle: &str| tokens.contains(&needle);
    let ctrl = has("ctrl") || has_token("control");
    if has("win") || has("super") || has("meta") || has("oskey") {
        return Err(format!(
            "hard_denied: {keys} uses the Windows key and can leave the allowlisted app"
        ));
    }
    if ctrl && has("alt") && (has("delete") || has("del")) {
        return Err("hard_denied: Ctrl+Alt+Del is reserved for the secure desktop".to_string());
    }
    if ctrl && has("shift") && (has("esc") || has("escape")) {
        return Err("hard_denied: Ctrl+Shift+Esc opens Task Manager".to_string());
    }
    if ctrl && (has("esc") || has("escape")) {
        return Err("hard_denied: Ctrl+Esc opens the Start menu".to_string());
    }
    if ctrl && has("shift") && (has("enter") || has("return")) {
        return Err("hard_denied: Ctrl+Shift+Enter requests elevation".to_string());
    }
    if has("alt") && (has("tab") || has("esc") || has("escape")) {
        return Err(
            "hard_denied: Alt+Tab and Alt+Esc switch away from the allowlisted app".to_string(),
        );
    }
    let clipboard = compact.contains("ctrlc")
        || compact.contains("ctrlx")
        || compact.contains("controlc")
        || compact.contains("controlx")
        || has_token("c")
        || has_token("x");
    if has("tab") && ctrl && clipboard {
        return Err(
            "hard_denied: do not combine Tab with a clipboard shortcut in one key sequence"
                .to_string(),
        );
    }
    if has("alt") && has("f4") && !confirmed {
        return Err(
            "confirmation_required: Alt+F4 closes the window; set confirm=true".to_string(),
        );
    }
    Ok(())
}

fn mouse_wheel(point: Point, horizontal: bool, delta: i32) -> Result<(), String> {
    Mouse::set_cursor_pos(&point).map_err(|error| format!("mouse_move_failed: {error}"))?;
    let mut input = INPUT {
        r#type: INPUT_MOUSE,
        ..Default::default()
    };
    input.Anonymous.mi = MOUSEINPUT {
        dx: 0,
        dy: 0,
        mouseData: delta as u32,
        dwFlags: if horizontal {
            MOUSEEVENTF_HWHEEL
        } else {
            MOUSEEVENTF_WHEEL
        },
        time: 0,
        dwExtraInfo: 0,
    };
    let sent = unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) };
    if sent == 0 {
        return Err("scroll_failed: SendInput failed".to_string());
    }
    Ok(())
}

fn capture_element(element: &UIElement, info: &WindowInfo) -> Result<Screenshot, String> {
    let rect = element
        .get_bounding_rectangle()
        .map_err(|error| format!("screenshot_failed: {error}"))?;
    let target = RectInfo {
        left: rect.get_left(),
        top: rect.get_top(),
        right: rect.get_right(),
        bottom: rect.get_bottom(),
    };
    let window = RectInfo {
        left: info.rect.left,
        top: info.rect.top,
        right: info.rect.right,
        bottom: info.rect.bottom,
    };
    let shot = capture_window(info.hwnd, window)?;
    if target.left == window.left
        && target.top == window.top
        && target.right == window.right
        && target.bottom == window.bottom
    {
        return Ok(shot);
    }
    let x = target.left - window.left;
    let y = target.top - window.top;
    crop(
        shot,
        x.max(0) as u32,
        y.max(0) as u32,
        target.width().max(1) as u32,
        target.height().max(1) as u32,
    )
}

fn raise_window(hwnd: isize) {
    if hwnd == 0 || is_foreground(hwnd) {
        return;
    }
    unsafe {
        if IsIconic(hwnd as *mut std::ffi::c_void) != 0 {
            ShowWindow(hwnd as *mut std::ffi::c_void, SW_RESTORE);
        }
        let foreground = GetForegroundWindow();
        let foreground_thread = if foreground.is_null() {
            0
        } else {
            GetWindowThreadProcessId(foreground, std::ptr::null_mut())
        };
        let current = GetCurrentThreadId();
        let attached = foreground_thread != 0 && foreground_thread != current;
        if attached {
            AttachThreadInput(current, foreground_thread, 1);
        }
        let _ = BringWindowToTop(hwnd as *mut std::ffi::c_void);
        let _ = SetForegroundWindow(hwnd as *mut std::ffi::c_void);
        let _ = SetFocus(hwnd as *mut std::ffi::c_void);
        if attached {
            AttachThreadInput(current, foreground_thread, 0);
        }
    }
}

fn window_rect(hwnd: isize) -> Option<RectInfo> {
    if hwnd == 0 {
        return None;
    }
    let mut rect = std::mem::MaybeUninit::uninit();
    let valid = unsafe { GetWindowRect(hwnd as *mut std::ffi::c_void, rect.as_mut_ptr()) } != 0;
    if !valid {
        return None;
    }
    let rect = unsafe { rect.assume_init() };
    let info = RectInfo {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    };
    (info.width() > 0 && info.height() > 0).then_some(info)
}

fn is_foreground(hwnd: isize) -> bool {
    hwnd != 0 && unsafe { GetForegroundWindow() == hwnd as *mut std::ffi::c_void }
}

fn require_window_foreground(info: &WindowInfo) -> Result<(), String> {
    if is_foreground(info.hwnd) {
        return Ok(());
    }
    Err(format!(
        "not_foreground: {} is behind another window, so a screen click would land elsewhere; bring it forward and retry",
        info.title
    ))
}

fn capture_window(hwnd: isize, rect: RectInfo) -> Result<Screenshot, String> {
    if rect.width() <= 0 || rect.height() <= 0 {
        return Err("screenshot_failed: window has no visible area".to_string());
    }
    if let Some(actual) = window_rect(hwnd) {
        if is_foreground(hwnd)
            && let Ok(shot) = Screenshot::capture_rect(uiautomation::types::Rect::new(
                actual.left,
                actual.top,
                actual.right,
                actual.bottom,
            ))
        {
            return Ok(shot);
        }
        if let Ok(shot) = print_window(hwnd, actual.width(), actual.height()) {
            return Ok(flip_rows(shot));
        }
    }
    Screenshot::capture_rect(uiautomation::types::Rect::new(
        rect.left,
        rect.top,
        rect.right,
        rect.bottom,
    ))
    .map_err(|error| format!("screenshot_failed: {error}"))
}

fn print_window(hwnd: isize, width: i32, height: i32) -> Result<Screenshot, String> {
    unsafe {
        let screen = GetDC(std::ptr::null_mut());
        if screen.is_null() {
            return Err("screenshot_failed: no screen dc".to_string());
        }
        let memory = CreateCompatibleDC(screen);
        if memory.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen);
            return Err("screenshot_failed: no memory dc".to_string());
        }
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        if bitmap.is_null() {
            DeleteDC(memory);
            ReleaseDC(std::ptr::null_mut(), screen);
            return Err("screenshot_failed: no bitmap".to_string());
        }
        let previous: HGDIOBJ = SelectObject(memory, bitmap);
        let printed = PrintWindow(hwnd as *mut std::ffi::c_void, memory, PW_RENDERFULLCONTENT);
        let header = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };
        let mut pixels = vec![0u8; (width as usize) * (height as usize) * 4];
        let mut info = BITMAPINFO {
            bmiHeader: header,
            bmiColors: [Default::default(); 1],
        };
        let copied = if printed != 0 {
            GetDIBits(
                memory,
                bitmap,
                0,
                height as u32,
                pixels.as_mut_ptr().cast(),
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };
        SelectObject(memory, previous);
        DeleteObject(bitmap);
        DeleteDC(memory);
        ReleaseDC(std::ptr::null_mut(), screen);
        if copied == 0 {
            return Err("screenshot_failed: PrintWindow returned no pixels".to_string());
        }
        Ok(Screenshot::new(pixels, width as u32, height as u32))
    }
}

fn flip_rows(shot: Screenshot) -> Screenshot {
    let width = shot.width() as usize;
    let height = shot.height() as usize;
    let pixels = shot.pixels();
    let row = width * 4;
    let mut out = vec![0u8; pixels.len()];
    for y in 0..height {
        let from = (height - 1 - y) * row;
        let to = y * row;
        out[to..to + row].copy_from_slice(&pixels[from..from + row]);
    }
    Screenshot::new(out, shot.width(), shot.height())
}

fn crop(shot: Screenshot, x: u32, y: u32, width: u32, height: u32) -> Result<Screenshot, String> {
    let source_width = shot.width();
    let source_height = shot.height();
    let width = width.min(source_width.saturating_sub(x));
    let height = height.min(source_height.saturating_sub(y));
    if width == 0 || height == 0 {
        return Ok(shot);
    }
    let pixels = shot.pixels();
    let mut out = vec![0u8; (width as usize) * (height as usize) * 4];
    for row in 0..height as usize {
        let from = ((y as usize + row) * source_width as usize + x as usize) * 4;
        let to = row * width as usize * 4;
        out[to..to + width as usize * 4].copy_from_slice(&pixels[from..from + width as usize * 4]);
    }
    Ok(Screenshot::new(out, width, height))
}

fn encode_png(shot: &Screenshot) -> Result<(String, u32, u32), String> {
    let path = std::env::temp_dir().join(format!(
        "myagent-cu-{}-{}-{}.png",
        std::process::id(),
        now_ms(),
        uuid::Uuid::new_v4().simple()
    ));
    shot.save_png(&path)
        .map_err(|error| format!("screenshot_save_failed: {error}"))?;
    let bytes = std::fs::read(&path).map_err(|error| {
        let _ = std::fs::remove_file(&path);
        format!("screenshot_read_failed: {error}")
    })?;
    let _ = std::fs::remove_file(&path);
    Ok((
        base64::engine::general_purpose::STANDARD.encode(bytes),
        shot.width(),
        shot.height(),
    ))
}

fn process_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut buffer = vec![0u16; 32_768];
        let mut len = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut len);
        let _ = CloseHandle(handle);
        if ok == 0 || len == 0 {
            return None;
        }
        let len = (len as usize).min(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..len]))
    }
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max).collect();
    out.push('…');
    out
}

#[derive(Clone)]
struct Snapshot {
    created: Instant,
    pid: u32,
    hwnd: isize,
    window_title: String,
    window_class: String,
    has_document: bool,
    elements: HashMap<String, ElementRef>,
}

#[derive(Clone)]
struct ElementRef {
    runtime_id: Vec<i32>,
    name: String,
    password: bool,
}

struct SnapshotStore {
    items: Vec<(String, Snapshot)>,
}

impl SnapshotStore {
    fn new() -> Self {
        Self { items: Vec::new() }
    }

    fn insert(&mut self, snapshot: Snapshot) -> String {
        let now = Instant::now();
        self.items
            .retain(|(_, item)| now.duration_since(item.created) < SNAPSHOT_TTL);
        while self.items.len() >= MAX_SNAPSHOTS {
            self.items.remove(0);
        }
        let id = format!("s_{}", uuid::Uuid::new_v4().simple());
        self.items.push((id.clone(), snapshot));
        id
    }

    fn get(&self, id: &str) -> Option<Snapshot> {
        let (_, snapshot) = self.items.iter().find(|(key, _)| key == id)?;
        if snapshot.created.elapsed() > SNAPSHOT_TTL {
            return None;
        }
        Some(snapshot.clone())
    }
}

#[derive(Clone)]
struct WindowInfo {
    pid: u32,
    hwnd: isize,
    exe: String,
    name: String,
    title: String,
    class: String,
    rect: RectInfo,
    focused: bool,
    offscreen: bool,
}

#[derive(Clone, Copy)]
struct RectInfo {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl RectInfo {
    fn width(self) -> i32 {
        self.right - self.left
    }

    fn height(self) -> i32 {
        self.bottom - self.top
    }

    fn area(self) -> i32 {
        self.width().max(0) * self.height().max(0)
    }

    fn center(self) -> Point {
        Point::new((self.left + self.right) / 2, (self.top + self.bottom) / 2)
    }

    fn contains(self, x: i32, y: i32) -> bool {
        x >= self.left && x <= self.right && y >= self.top && y <= self.bottom
    }

    fn to_json(self) -> Value {
        json!({
            "left": self.left,
            "top": self.top,
            "right": self.right,
            "bottom": self.bottom,
            "width": self.width(),
            "height": self.height(),
        })
    }
}

struct PolicyMatch {
    tier: Option<AppTier>,
    blocked: Option<String>,
    publisher: Option<String>,
}

struct AppEntry {
    pid: u32,
    exe: String,
    name: String,
    tier: Option<AppTier>,
    blocked: Option<String>,
    windows: u32,
    titles: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListWindowsArgs {
    app: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GetStateArgs {
    app: String,
    window: Option<String>,
    max_nodes: Option<usize>,
    screenshot: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ScreenshotArgs {
    app: String,
    window: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ElementArgs {
    app: Option<String>,
    snapshot: String,
    element: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClickArgs {
    app: Option<String>,
    window: Option<String>,
    snapshot: Option<String>,
    element: Option<String>,
    x: Option<i32>,
    y: Option<i32>,
    button: Option<String>,
    double: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TypeTextArgs {
    app: Option<String>,
    snapshot: Option<String>,
    element: Option<String>,
    text: String,
    confirm: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetValueArgs {
    app: Option<String>,
    snapshot: String,
    element: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PressKeysArgs {
    app: Option<String>,
    snapshot: Option<String>,
    keys: String,
    confirm: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ScrollArgs {
    app: Option<String>,
    snapshot: Option<String>,
    element: Option<String>,
    direction: String,
    amount: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DragArgs {
    app: String,
    from_x: i32,
    from_y: i32,
    to_x: i32,
    to_y: i32,
    confirm: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WaitArgs {
    ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FocusWindowArgs {
    app: String,
    window: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LaunchAppArgs {
    path: String,
    args: Option<Vec<String>>,
    confirm: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadClipboardArgs {
    confirm: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WriteClipboardArgs {
    text: String,
    confirm: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_guard_blocks_secure_attention_and_shell_launchers() {
        assert!(validate_keys("{ctrl}{alt}{delete}", true).is_err());
        assert!(validate_keys("{win}r", true).is_err());
        assert!(validate_keys("{win}x", true).is_err());
        assert!(validate_keys("{win}{r}", true).is_err());
        assert!(validate_keys("{alt}{tab}", true).is_err());
        assert!(validate_keys("{ctrl}{tab}", false).is_ok());
        assert!(validate_keys("{ctrl}{tab}{c}", false).is_err());
        assert!(validate_keys("{ctrl}{shift}{esc}", true).is_err());
        assert!(validate_keys("{ctrl}{esc}", true).is_err());
        assert!(validate_keys("{control}{esc}", true).is_err());
        assert!(validate_keys("{ctrl}{shift}{enter}", true).is_err());
        assert!(validate_keys("{alt}{f4}", false).is_err());
        assert!(validate_keys("{alt}{f4}", true).is_ok());
        assert!(validate_keys("{ctrl}c", false).is_ok());
    }

    #[test]
    fn yield_to_user_requires_idle_after_a_previous_action() {
        assert!(!should_yield(Some(10), None));
        assert!(!should_yield(Some(10), Some(Duration::from_millis(100))));
        assert!(should_yield(Some(10), Some(Duration::from_millis(1_000))));
        assert!(!should_yield(
            Some(2_000),
            Some(Duration::from_millis(1_000))
        ));
        assert!(!should_yield(None, Some(Duration::from_millis(1_000))));
    }

    #[test]
    fn password_labels_are_detected() {
        assert!(password_label("Password"));
        assert!(password_label("Enter your passwd"));
        assert!(password_label("pwd"));
        assert!(password_label("Passcode"));
        assert!(password_label("client secret"));
        assert!(!password_label("Search"));
        assert!(!password_label("Email"));
    }

    #[test]
    fn policy_requires_an_exact_app_match() {
        let config = ComputerUseConfig {
            allow: vec![crate::computer_use::AppPolicy {
                path: "C:\\Windows\\System32\\notepad.exe".to_string(),
                name: "notepad.exe".to_string(),
                tier: AppTier::Interact,
                publisher: None,
            }],
            ..ComputerUseConfig::default()
        };
        let info = WindowInfo {
            pid: 7,
            hwnd: 0,
            exe: "C:\\Windows\\System32\\notepad.exe".to_string(),
            name: "notepad.exe".to_string(),
            title: "Untitled - Notepad".to_string(),
            class: "Notepad".to_string(),
            rect: RectInfo {
                left: 0,
                top: 0,
                right: 100,
                bottom: 100,
            },
            focused: true,
            offscreen: false,
        };
        assert_eq!(policy_for(&config, &info).tier, Some(AppTier::Interact));
        let other = WindowInfo {
            exe: "C:\\Windows\\System32\\calc.exe".to_string(),
            name: "calc.exe".to_string(),
            ..info
        };
        assert!(policy_for(&config, &other).tier.is_none());
    }

    #[test]
    fn path_matching_requires_an_exact_absolute_path() {
        assert!(path_matches(
            "C:\\Apps\\notepad.exe",
            "C:\\Apps\\notepad.exe"
        ));
        assert!(path_matches(
            "C:\\Apps\\notepad.exe",
            "c:\\apps\\NOTEPAD.EXE"
        ));
        assert!(!path_matches(
            "C:\\Apps\\notepad.exe",
            "C:\\Apps\\notepad.exe.bak"
        ));
        assert!(!path_matches("notepad.exe", "C:\\Apps\\notepad.exe"));
    }

    #[test]
    fn hard_denied_apps_are_reported() {
        assert!(
            crate::computer_use::hard_deny_reason("C:\\Windows\\System32\\cmd.exe", "").is_some()
        );
        assert!(
            crate::computer_use::hard_deny_reason("C:\\Windows\\System32\\notepad.exe", "")
                .is_none()
        );
    }
}
