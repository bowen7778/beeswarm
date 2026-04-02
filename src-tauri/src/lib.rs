use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use std::path::{Path, PathBuf};

mod bridge;
mod config;

fn read_manifest_version(manifest_path: &Path) -> Option<String> {
  let content = std::fs::read_to_string(manifest_path).ok()?;
  let json = serde_json::from_str::<serde_json::Value>(&content).ok()?;
  Some(json["version"].as_str().unwrap_or("0.0.0").to_string())
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
  let left_parts: Vec<u32> = left.split('.').map(|part| part.parse::<u32>().unwrap_or(0)).collect();
  let right_parts: Vec<u32> = right.split('.').map(|part| part.parse::<u32>().unwrap_or(0)).collect();
  let max_len = left_parts.len().max(right_parts.len());

  for index in 0..max_len {
    let left_part = *left_parts.get(index).unwrap_or(&0);
    let right_part = *right_parts.get(index).unwrap_or(&0);
    match left_part.cmp(&right_part) {
      std::cmp::Ordering::Equal => continue,
      ordering => return ordering,
    }
  }

  std::cmp::Ordering::Equal
}

fn resolve_slot_payload_root(slot_dir: &Path) -> Option<PathBuf> {
  let candidates = [
    slot_dir.to_path_buf(),
    slot_dir.join("kernel"),
  ];

  for candidate in candidates {
    let manifest_path = candidate.join("manifest.json");
    let script_path = candidate.join("dist").join("cli.cjs");
    if manifest_path.exists() && script_path.exists() {
      return Some(candidate);
    }
  }

  None
}

fn resolve_runtime_root(resource_dir: &Path, bin_dir: &Path) -> (PathBuf, PathBuf, String) {
  let builtin_script = resource_dir.join("build").join("dist").join("cli.cjs");
  let mut final_script_path = builtin_script;
  let mut final_program_root = resource_dir.to_path_buf();
  let mut current_version = read_manifest_version(&resource_dir.join("manifest.json")).unwrap_or_else(|| "0.0.0".to_string());

  if let Ok(entries) = std::fs::read_dir(bin_dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if !path.is_dir() {
        continue;
      }

      let Some(runtime_root) = resolve_slot_payload_root(&path) else {
        continue;
      };
      let manifest_path = runtime_root.join("manifest.json");

      if let Some(version) = read_manifest_version(&manifest_path) {
        if compare_versions(&version, &current_version).is_gt() {
          current_version = version;
          final_program_root = runtime_root.clone();
          final_script_path = runtime_root.join("dist").join("cli.cjs");
        }
      }
    }
  }

  (final_script_path, final_program_root, current_version)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        if cfg!(debug_assertions) {
          println!("[TAURI] Dev mode detected, skipping internal backend spawn (managed by dev.mjs)");
          return;
        }

        let resource_dir = handle.path().resource_dir().expect("failed to get resource dir");
        let app_data_dir = handle.path().app_data_dir().expect("failed to get app data dir");
        let bin_dir = app_data_dir.join("bin");
        let (final_script_path, final_program_root, current_version) = resolve_runtime_root(&resource_dir, &bin_dir);

        println!("[TAURI] Production mode: Using version {}", current_version);
        let mut sidecar_command = handle.shell().sidecar("node").expect("failed to setup sidecar");
        sidecar_command = sidecar_command.args([final_script_path.to_string_lossy().to_string()]);

        println!("[TAURI] Launching Node backend from {:?}", final_program_root);

        let (mut rx, _child) = sidecar_command
          .env("BEEMCP_IS_SIDECAR", "1")
          .env("BEEMCP_PROGRAM_ROOT", final_program_root.to_string_lossy().to_string())
          .spawn()
          .expect("failed to spawn backend process");

        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(line) => {
              println!("[BACKEND] {}", String::from_utf8_lossy(&line).trim());
            }
            CommandEvent::Stderr(line) => {
              eprintln!("[BACKEND_ERR] {}", String::from_utf8_lossy(&line).trim());
            }
            CommandEvent::Terminated(payload) => {
              println!("[BACKEND] Process terminated with code {:?}", payload.code);
            }
            _ => {}
          }
        }
      });

      Ok(())
    })
    .manage(bridge::BridgeState::default())
    .invoke_handler(tauri::generate_handler![
      bridge::ipc_http,
      bridge::ipc_stream_start,
      bridge::ipc_stream_poll,
      bridge::ipc_stream_stop,
      bridge::ipc_restart_app
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
