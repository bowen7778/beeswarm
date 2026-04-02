use crate::config;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tauri::State;

#[derive(Default)]
pub struct BridgeState {
  stream: Mutex<StreamController>,
}

#[derive(Default)]
struct StreamController {
  task: Option<JoinHandle<()>>,
  buffer: Arc<Mutex<StreamBuffer>>,
}

#[derive(Default)]
struct StreamBuffer {
  opened: bool,
  error: Option<String>,
  events: Vec<String>,
}

#[derive(Serialize)]
pub struct IpcHttpResult {
  status: u16,
  body: String,
}

#[derive(Serialize)]
pub struct IpcStreamPollResult {
  opened: bool,
  error: Option<String>,
  events: Vec<String>,
}

fn push_event(shared: &Arc<Mutex<StreamBuffer>>, data: String) {
  let mut guard = shared.lock().expect("stream buffer poisoned");
  guard.events.push(data);
  if guard.events.len() > 400 {
    let drain_to = guard.events.len().saturating_sub(300);
    guard.events.drain(0..drain_to);
  }
}

fn set_error(shared: &Arc<Mutex<StreamBuffer>>, message: String) {
  let mut guard = shared.lock().expect("stream buffer poisoned");
  guard.error = Some(message);
}

fn normalize_api_path(path: &str) -> Result<String, String> {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return Err("empty api path".to_string());
  }
  if !trimmed.starts_with("/api/") && trimmed != "/api" {
    return Err("path must start with /api".to_string());
  }
  Ok(format!("{}{}", config::get_api_base(), trimmed))
}

use std::collections::HashMap;

#[tauri::command]
pub async fn ipc_http(
  path: String,
  method: Option<String>,
  body: Option<String>,
  headers: Option<HashMap<String, String>>,
) -> Result<IpcHttpResult, String> {
  let m = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
  let url = normalize_api_path(&path)?;
  let client = Client::new();
  let mut req = match m.as_str() {
    "POST" => client.post(url),
    "PUT" => client.put(url),
    "PATCH" => client.patch(url),
    "DELETE" => client.delete(url),
    _ => client.get(url),
  };

  if let Some(h_map) = headers {
    for (k, v) in h_map {
      req = req.header(k, v);
    }
  }

  if let Some(payload) = body {
    if !payload.is_empty() {
      req = req.header("Content-Type", "application/json").body(payload);
    }
  }

  let res = req.send().await.map_err(|e| e.to_string())?;
  let status = res.status().as_u16();
  let text = res.text().await.map_err(|e| e.to_string())?;
  Ok(IpcHttpResult { status, body: text })
}

#[tauri::command]
pub async fn ipc_stream_start(
  project_id: String,
  headers: Option<HashMap<String, String>>,
  state: State<'_, BridgeState>,
) -> Result<(), String> {
  let mut controller = state.stream.lock().map_err(|_| "stream lock failed".to_string())?;
  if let Some(task) = controller.task.take() {
    task.abort();
  }
  let shared = Arc::new(Mutex::new(StreamBuffer::default()));
  controller.buffer = shared.clone();
  let pid = project_id;
  let h_map = headers.unwrap_or_default();
  controller.task = Some(tauri::async_runtime::spawn(async move {
    let client = Client::new();
    let url = format!("{}/api/stream", config::get_api_base());
    println!("[TAURI] Starting stream request: {}?projectId={}", url, pid);
    
    let mut req = client.get(&url).query(&[("projectId", &pid)]);
    for (k, v) in h_map {
      req = req.header(k, v);
    }
    
    let response = match req.send().await {
      Ok(r) => r,
      Err(e) => {
        println!("[TAURI] Stream request failed: {}", e);
        set_error(&shared, format!("stream request failed: {}", e));
        return;
      }
    };
    
    println!("[TAURI] Stream response status: {}", response.status());
    if !response.status().is_success() {
      set_error(&shared, format!("stream status: {}", response.status()));
      return;
    }
    {
      let mut g = shared.lock().expect("stream buffer poisoned");
      g.opened = true;
      g.error = None;
    }
    println!("[TAURI] Stream connection established, reading chunks...");
    let mut chunk_stream = response.bytes_stream();
    let mut carry = String::new();
    while let Some(next) = chunk_stream.next().await {
      let bytes = match next {
        Ok(v) => v,
        Err(e) => {
          println!("[TAURI] Stream read error: {}", e);
          set_error(&shared, format!("stream read failed: {}", e));
          return;
        }
      };
      carry.push_str(&String::from_utf8_lossy(&bytes));
      while let Some(idx) = carry.find('\n') {
        let line = carry[..idx].trim_end_matches('\r').to_string();
        carry = carry[idx + 1..].to_string();
        if let Some(payload) = line.strip_prefix("data:") {
          push_event(&shared, payload.trim_start().to_string());
        }
      }
    }
    println!("[TAURI] Stream closed by server");
    set_error(&shared, "stream closed".to_string());
  }));
  Ok(())
}

#[tauri::command]
pub fn ipc_stream_poll(state: State<'_, BridgeState>) -> Result<IpcStreamPollResult, String> {
  let controller = state.stream.lock().map_err(|_| "stream lock failed".to_string())?;
  let mut guard = controller.buffer.lock().map_err(|_| "stream buffer lock failed".to_string())?;
  let events = std::mem::take(&mut guard.events);
  Ok(IpcStreamPollResult {
    opened: guard.opened,
    error: guard.error.take(),
    events,
  })
}

#[tauri::command]
pub fn ipc_stream_stop(state: State<'_, BridgeState>) -> Result<(), String> {
  let mut controller = state.stream.lock().map_err(|_| "stream lock failed".to_string())?;
  if let Some(task) = controller.task.take() {
    task.abort();
  }
  controller.buffer = Arc::new(Mutex::new(StreamBuffer::default()));
  Ok(())
}

#[tauri::command]
pub fn ipc_restart_app(app: tauri::AppHandle) -> Result<(), String> {
  std::thread::spawn(move || {
    std::thread::sleep(Duration::from_millis(150));
    app.restart();
  });
  Ok(())
}
