#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![ensure_backend])
        .run(tauri::generate_context!())
        .expect("error while running PC Repair Agent");
}

use serde::Serialize;
use std::{
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 8765;

#[derive(Default)]
struct BackendState {
    child: Mutex<Option<Child>>,
}

#[derive(Serialize)]
struct BackendStatus {
    base_url: String,
    reused: bool,
}

#[tauri::command]
fn ensure_backend(state: tauri::State<'_, BackendState>) -> Result<BackendStatus, String> {
    let base_url = format!("http://{}:{}", BACKEND_HOST, BACKEND_PORT);

    if is_backend_listening() {
        return Ok(BackendStatus {
            base_url,
            reused: true,
        });
    }

    if std::env::var("PC_AGENT_SKIP_BACKEND_AUTOSTART").is_ok() {
        return Err(format!(
            "backend is not listening at {base_url}; autostart is disabled"
        ));
    }

    let repo_root = repo_root()?;
    let backend_dir = repo_root.join("backend");
    if !backend_dir.is_dir() {
        return Err(format!("backend directory not found: {}", backend_dir.display()));
    }

    let mut command = Command::new("uv");
    command
        .arg("run")
        .arg("python")
        .arg("-m")
        .arg("pc_agent_backend.main")
        .arg("--host")
        .arg(BACKEND_HOST)
        .arg("--port")
        .arg(BACKEND_PORT.to_string())
        .arg("--workspace")
        .arg(&repo_root)
        .current_dir(&backend_dir)
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("failed to start backend with uv: {error}"))?;

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "backend state lock poisoned".to_string())?;
        *guard = Some(child);
    }

    for _ in 0..60 {
        if is_backend_listening() {
            return Ok(BackendStatus {
                base_url,
                reused: false,
            });
        }
        thread::sleep(Duration::from_millis(250));
    }

    Err("backend did not start within 15 seconds".to_string())
}

fn is_backend_listening() -> bool {
    let address = format!("{}:{}", BACKEND_HOST, BACKEND_PORT);
    let Ok(mut addresses) = address.to_socket_addrs() else {
        return false;
    };
    let Some(address) = addresses.next() else {
        return false;
    };
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn repo_root() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|error| format!("failed to read cwd: {error}"))?;
    if cwd.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        return cwd
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("failed to derive repo root from {}", cwd.display()));
    }
    Ok(cwd)
}
