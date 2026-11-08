// main.rs — the "behind the scenes" part of the Windows app.
// It opens the window, saves/loads your tasks, shows Windows pop-up alerts and installs updates.
// The screen itself lives in ../src (the same files the iPhone version uses).

// Don't open a black console window next to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// The name Windows uses to recognise the app (pop-ups show "Task Timer").
#[cfg_attr(not(windows), allow(dead_code))]
const AUMID: &str = "KyleTam.TaskTimer";
const DEFAULT_UPDATE_URL: &str = "https://api.github.com/repos/kylejtam/Task-Timer/releases/latest";

/// %APPDATA%\Task Timer — the same folder earlier versions used, so your tasks carry over.
fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .config_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("Task Timer")
}

fn read_data(app: &AppHandle) -> Value {
    fs::read_to_string(data_dir(app).join("tasks.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null)
}

/// Saves your tasks. Writes a temporary file first, then swaps it in,
/// so a crash in the middle of saving can't damage the file.
#[tauri::command]
fn save_data(app: AppHandle, data: Value) -> Result<(), String> {
    let dir = data_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("tasks.json.tmp");
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("tasks.json")).map_err(|e| e.to_string())
}

/// Shows a Windows pop-up alert.
#[tauri::command]
fn notify(title: String, body: String) {
    #[cfg(windows)]
    windows::toast(&title, &body);
    #[cfg(not(windows))]
    let _ = (title, body);
}

/// Downloads the new version, swaps it in for this .exe, and reopens the app.
#[tauri::command]
async fn install_update(app: AppHandle, url: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let exe = tauri::async_runtime::spawn_blocking(move || windows::download_and_swap(&url))
            .await
            .map_err(|e| e.to_string())??;
        windows::reopen_after_exit(&exe)?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, url);
        Err("Updating is only available in the Windows app.".into())
    }
}

fn main() {
    tauri::Builder::default()
        // Only one copy of the app at a time: opening it again brings the first copy forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        // Remembers the window's size and position.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![save_data, notify, install_update])
        .setup(|app| {
            let handle = app.handle().clone();
            #[cfg(windows)]
            windows::setup(&data_dir(&handle));

            let data = read_data(&handle);
            let settings = data.get("settings");
            let on_top = settings
                .and_then(|s| s.get("alwaysOnTop"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let theme = match settings.and_then(|s| s.get("theme")).and_then(Value::as_str) {
                Some("light") => Some(tauri::Theme::Light),
                Some("system") => None,
                _ => Some(tauri::Theme::Dark),
            };
            let update_url =
                std::env::var("TASK_TIMER_UPDATE_URL").unwrap_or_else(|_| DEFAULT_UPDATE_URL.into());
            // Hand the saved tasks to the screen before it starts, so they appear instantly.
            let init = format!(
                "window.__TASK_TIMER_DATA__ = {};\nwindow.__TASK_TIMER_UPDATE_URL__ = {};",
                data,
                Value::String(update_url)
            );

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Task Timer")
                .inner_size(380.0, 680.0)
                .min_inner_size(300.0, 420.0)
                .always_on_top(on_top)
                .theme(theme)
                .initialization_script(&init)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Task Timer could not start");
}

#[cfg(windows)]
mod windows {
    use std::{
        fs,
        os::windows::process::CommandExt,
        path::{Path, PathBuf},
        process::Command,
    };

    /// Stops helper programs from flashing a black window.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    /// Runs at start-up: tidies up after an update, and tells Windows the app's
    /// display name and icon so pop-up alerts say "Task Timer".
    pub fn setup(data_dir: &Path) {
        if let Ok(exe) = std::env::current_exe() {
            let _ = fs::remove_file(old_path(&exe));
        }
        let icon = data_dir.join("icon.png");
        let _ = fs::create_dir_all(data_dir);
        let _ = fs::write(&icon, include_bytes!("../icons/128x128.png"));

        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let key_path = format!(r"Software\Classes\AppUserModelId\{}", super::AUMID);
        if let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(key_path) {
            let _ = key.set_value("DisplayName", &"Task Timer");
            let _ = key.set_value("IconUri", &icon.to_string_lossy().to_string());
        }
    }

    pub fn toast(title: &str, body: &str) {
        use tauri_winrt_notification::Toast;
        // The app plays its own alert sound, so the pop-up itself is silent.
        let shown = Toast::new(super::AUMID).title(title).text1(body).sound(None).show();
        if shown.is_err() {
            let _ = Toast::new(Toast::POWERSHELL_APP_ID).title(title).text1(body).sound(None).show();
        }
    }

    fn old_path(exe: &Path) -> PathBuf {
        exe.with_extension("exe.old")
    }

    /// Downloads the update next to this .exe (using curl, which is built into Windows),
    /// then swaps the files. Windows allows renaming a running .exe, so the old one
    /// is moved aside and deleted the next time the app starts.
    pub fn download_and_swap(url: &str) -> Result<PathBuf, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let new = exe.with_extension("exe.download");
        let status = Command::new("curl.exe")
            .args(["--location", "--fail", "--silent", "--show-error", "--output"])
            .arg(&new)
            .arg(url)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("Could not start the download: {e}"))?;
        let size = fs::metadata(&new).map(|m| m.len()).unwrap_or(0);
        if !status.success() || size < 500_000 {
            let _ = fs::remove_file(&new);
            return Err("The download didn't finish.".into());
        }
        let old = old_path(&exe);
        let _ = fs::remove_file(&old);
        fs::rename(&exe, &old).map_err(|e| format!("Could not replace the app: {e}"))?;
        if let Err(e) = fs::rename(&new, &exe) {
            let _ = fs::rename(&old, &exe);
            return Err(format!("Could not replace the app: {e}"));
        }
        Ok(exe)
    }

    /// Waits about 2 seconds (so this copy has closed), then opens the new version.
    pub fn reopen_after_exit(exe: &Path) -> Result<(), String> {
        Command::new("cmd.exe")
            .raw_arg(format!("/c ping -n 3 127.0.0.1 >nul & start \"\" \"{}\"", exe.display()))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}
