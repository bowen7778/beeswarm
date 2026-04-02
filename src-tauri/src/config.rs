use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HostConfig {
    pub runtime: RuntimeConfig,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfig {
    pub ui_host: String,
    pub ui_port: u16,
}

fn resolve_user_data_root() -> Option<PathBuf> {
    let env_data = std::env::var("BEEMCP_USER_DATA_DIR").unwrap_or_default();
    let trimmed = env_data.trim();
    if !trimmed.is_empty() {
        return Some(PathBuf::from(trimmed));
    }

    let app_name = "beemcp";

    #[cfg(target_os = "windows")]
    {
        let mut path = PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| {
            let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "".to_string());
            format!("{}\\AppData\\Roaming", home)
        }));
        path.push(app_name);
        Some(path)
    }

    #[cfg(target_os = "macos")]
    {
        let mut path = PathBuf::from(std::env::var("HOME").unwrap_or_default());
        path.push("Library");
        path.push("Application Support");
        path.push(app_name);
        Some(path)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let mut path = match std::env::var("XDG_CONFIG_HOME") {
            Ok(v) => PathBuf::from(v),
            Err(_) => {
                let mut p = PathBuf::from(std::env::var("HOME").unwrap_or_default());
                p.push(".config");
                p
            }
        };
        path.push(app_name);
        Some(path)
    }
}

pub fn get_config_path() -> Option<PathBuf> {
    let mut path = resolve_user_data_root()?;
    path.push("config");
    path.push("host.config.json");
    Some(path)
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterLock {
    #[allow(dead_code)]
    pub pid: u32,
    pub ui_port: u16,
}

pub fn get_lock_path() -> Option<PathBuf> {
    let mut path = resolve_user_data_root()?;
    path.push("system");
    path.push("host.lock");
    Some(path)
}

pub fn get_api_base() -> String {
    // 1. 优先从主锁文件中读取活跃端口 (Master Singleton)
    if let Some(path) = get_lock_path() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(lock) = serde_json::from_str::<MasterLock>(&content) {
                if lock.ui_port > 0 {
                    println!("[TAURI] Connecting to Master (PID: {}, Port: {})", lock.pid, lock.ui_port);
                    return format!("http://127.0.0.1:{}", lock.ui_port);
                }
            }
        }
    }

    // 2. 备选方案：从配置文件读取默认期望端口
    if let Some(path) = get_config_path() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<HostConfig>(&content) {
                return format!("http://{}:{}", config.runtime.ui_host, config.runtime.ui_port);
            }
        }
    }
    
    // 3. 最终回退
    "http://127.0.0.1:3000".to_string()
}
