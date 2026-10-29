use std::sync::OnceLock;

use tauri::{AppHandle, Emitter};
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN, RegisterHotKey, UnregisterHotKey,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetMessageW, MSG, PostThreadMessageW, WM_APP, WM_HOTKEY,
};

use crate::computer_use::{load_config, save_config};

const HOTKEY_ID: i32 = 1;
const WM_RELOAD: u32 = WM_APP + 1;
static THREAD_ID: OnceLock<u32> = OnceLock::new();
static STARTED: std::sync::Once = std::sync::Once::new();

pub fn start(app: AppHandle) {
    STARTED.call_once(|| {
        std::thread::spawn(move || run(app));
    });
}

pub fn reload() {
    let Some(thread_id) = THREAD_ID.get() else {
        return;
    };
    unsafe {
        let _ = PostThreadMessageW(*thread_id, WM_RELOAD, 0, 0);
    }
}

fn run(app: AppHandle) {
    let thread_id = unsafe { GetCurrentThreadId() };
    let _ = THREAD_ID.set(thread_id);
    let mut state = HotkeyState::default();
    state.apply();
    let mut message = MSG::default();
    loop {
        let result = unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) };
        if result <= 0 {
            break;
        }
        if message.message == WM_HOTKEY && message.wParam == HOTKEY_ID as usize {
            toggle_pause(&app);
        } else if message.message == WM_RELOAD {
            state.apply();
        }
    }
    state.clear();
}

fn toggle_pause(app: &AppHandle) {
    let mut config = load_config();
    config.paused = !config.paused;
    match save_config(config) {
        Ok(config) => {
            if let Err(error) = app.emit("computer-use-paused", config.paused) {
                eprintln!("computer-use: pause event failed: {error}");
            }
        }
        Err(error) => eprintln!("computer-use: pause toggle failed: {error}"),
    }
}

#[derive(Default)]
struct HotkeyState {
    registered: bool,
}

impl HotkeyState {
    fn clear(&mut self) {
        if self.registered {
            unsafe {
                let _ = UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID);
            }
            self.registered = false;
        }
    }

    fn apply(&mut self) {
        self.clear();
        let config = load_config();
        if !config.enabled {
            return;
        }
        match parse_hotkey(&config.hotkey) {
            Ok((modifiers, key)) => {
                let registered = unsafe {
                    RegisterHotKey(
                        std::ptr::null_mut(),
                        HOTKEY_ID,
                        modifiers | MOD_NOREPEAT,
                        key,
                    )
                };
                if registered == 0 {
                    eprintln!(
                        "computer-use: hotkey {} is unavailable; choose another in Settings",
                        config.hotkey
                    );
                } else {
                    self.registered = true;
                }
            }
            Err(error) => eprintln!("computer-use: hotkey parse failed: {error}"),
        }
    }
}

pub(crate) fn validate(raw: &str) -> Result<(), String> {
    parse_hotkey(raw).map(|_| ())
}

fn parse_hotkey(raw: &str) -> Result<(u32, u32), String> {
    let mut modifiers = 0u32;
    let mut key = None;
    for part in raw
        .split('+')
        .map(|value| value.trim().to_ascii_lowercase())
    {
        if part.is_empty() {
            continue;
        }
        match part.as_str() {
            "ctrl" | "control" => modifiers |= MOD_CONTROL,
            "alt" => modifiers |= MOD_ALT,
            "shift" => modifiers |= MOD_SHIFT,
            "win" | "windows" | "super" | "meta" => modifiers |= MOD_WIN,
            _ => {
                if key.is_some() {
                    return Err(format!("{raw:?} has more than one non-modifier key"));
                }
                key = Some(virtual_key(&part)?);
            }
        }
    }
    if modifiers == 0 {
        return Err("the hotkey needs Ctrl, Alt, Shift or Win".to_string());
    }
    let key = key.ok_or_else(|| "the hotkey needs a key".to_string())?;
    Ok((modifiers, key))
}

fn virtual_key(value: &str) -> Result<u32, String> {
    if value.len() == 1 {
        let byte = value.as_bytes()[0];
        if byte.is_ascii_alphanumeric() {
            return Ok(byte.to_ascii_uppercase() as u32);
        }
    }
    if let Some(number) = value.strip_prefix('f')
        && let Ok(number) = number.parse::<u32>()
        && (1..=24).contains(&number)
    {
        return Ok(0x70 + number - 1);
    }
    let key = match value {
        "space" => 0x20,
        "tab" => 0x09,
        "enter" | "return" => 0x0D,
        "esc" | "escape" => 0x1B,
        "backspace" => 0x08,
        "delete" | "del" => 0x2E,
        "insert" | "ins" => 0x2D,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" | "page-up" => 0x21,
        "pagedown" | "page-down" => 0x22,
        "left" => 0x25,
        "up" => 0x26,
        "right" => 0x27,
        "down" => 0x28,
        "printscreen" | "print-screen" => 0x2C,
        "pause" => 0x13,
        _ => return Err(format!("unknown key {value:?}")),
    };
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_default_hotkey() {
        let (modifiers, key) = parse_hotkey("Ctrl+Alt+Shift+P").expect("default hotkey");
        assert_eq!(modifiers, MOD_CONTROL | MOD_ALT | MOD_SHIFT);
        assert_eq!(key, 'P' as u32);
    }

    #[test]
    fn rejects_hotkeys_without_modifiers() {
        assert!(parse_hotkey("P").is_err());
        assert!(parse_hotkey("Ctrl+").is_err());
        assert!(parse_hotkey("Ctrl+Shift").is_err());
    }

    #[test]
    fn parses_function_keys() {
        let (_, key) = parse_hotkey("Ctrl+F12").expect("function key");
        assert_eq!(key, 0x7B);
    }
}
