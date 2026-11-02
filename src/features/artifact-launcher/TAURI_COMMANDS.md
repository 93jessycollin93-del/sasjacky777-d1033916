// Tauri Commands for Artifact Launcher
// Add to src-tauri/src/main.rs

use tauri::Manager;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
async fn list_artifacts() -> Result<serde_json::Value, String> {
    let artifacts_path = PathBuf::from("app/artifacts.json");
    if !artifacts_path.exists() {
        return Err("Artifacts manifest not found".to_string());
    }
    
    let content = fs::read_to_string(artifacts_path)
        .map_err(|e| format!("Failed to read artifacts: {}", e))?;
    
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse artifacts: {}", e))
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    let file_path = PathBuf::from(path);
    
    // Security: Validate path is within artifacts directory
    let artifacts_dir = PathBuf::from("artifacts");
    if !file_path.starts_with(&artifacts_dir) {
        return Err("Access denied: Path outside artifacts directory".to_string());
    }
    
    fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
async fn export_indexeddb(artifact_id: String) -> Result<String, String> {
    let export_path = PathBuf::from(format!("artifacts/{}/indexeddb-export.json", artifact_id));
    
    if !export_path.exists() {
        return Err("IndexedDB export not found".to_string());
    }
    
    fs::read_to_string(export_path)
        .map_err(|e| format!("Failed to read export: {}", e))
}

#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    let folder_path = PathBuf::from(path);
    
    if !folder_path.exists() {
        return Err("Folder not found".to_string());
    }
    
    // Use OS-specific command to open folder
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
async fn spawn_local_model(cmd: String, args: Vec<String>) -> Result<String, String> {
    // Security: Only allow if user opted in
    // This is a placeholder - implement proper validation
    Err("Local model spawning requires explicit user consent".to_string())
}

// Add commands to tauri builder in main.rs
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_artifacts,
            read_file,
            export_indexeddb,
            open_folder,
            spawn_local_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}