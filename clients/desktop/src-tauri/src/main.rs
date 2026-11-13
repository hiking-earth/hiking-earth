#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{fs, io::Read};
mod map_network;
mod location;
const MAX_GPX: u64 = 5 * 1024 * 1024;
const MAX_LOCAL_BACKUP: u64 = 25 * 1024 * 1024;

// Paths are selected in native dialogs, never provided by web content.
#[tauri::command]
async fn choose_gpx() -> Result<Option<String>, String> {
    let selected = rfd::AsyncFileDialog::new().add_filter("GPX", &["gpx"]).pick_file().await;
    let Some(file) = selected else { return Ok(None); };
    let file = fs::File::open(file.path()).map_err(|_| "无法打开文件".to_string())?;
    if !file.metadata().map_err(|_| "无法读取文件信息".to_string())?.is_file() {
        return Err("请选择普通 GPX 文件".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_GPX + 1).read_to_end(&mut bytes).map_err(|_| "文件读取失败".to_string())?;
    if bytes.len() as u64 > MAX_GPX { return Err("文件超过5 MB".into()); }
    String::from_utf8(bytes).map(Some).map_err(|_| "GPX文件需要UTF-8编码".into())
}
#[tauri::command]
async fn save_gpx(name: String, content: String) -> Result<bool, String> {
    if content.len() as u64 > MAX_GPX { return Err("文件超过5 MB".into()); }
    let safe: String = name.chars().filter(|c| !c.is_control() && !"/\\:*?\"<>|".contains(*c)).take(80).collect();
    let filename = format!("{}.gpx", if safe.is_empty() { "徒步轨迹" } else { safe.trim_end_matches(".gpx") });
    let selected = rfd::AsyncFileDialog::new().add_filter("GPX", &["gpx"]).set_file_name(&filename).save_file().await;
    let Some(file) = selected else { return Ok(false); };
    // Do not truncate an existing file until a complete new copy exists.
    let parent = file.path().parent().ok_or("保存位置无效")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建保存文件".to_string())?;
    use std::io::Write;
    temporary.write_all(content.as_bytes()).map_err(|_| "文件写入失败".to_string())?;
    temporary.as_file().sync_all().map_err(|_| "文件写入失败".to_string())?;
    temporary.persist(file.path()).map_err(|_| "无法完成保存，请检查文件权限".to_string())?;
    Ok(true)
}

#[tauri::command]
async fn save_local_text(name: String, content: String) -> Result<bool, String> {
    if content.len() as u64 > MAX_LOCAL_BACKUP { return Err("文件超过25 MB".into()); }
    let safe: String = name.chars().filter(|c| !c.is_control() && !"/\\:*?\"<>|".contains(*c)).take(120).collect();
    let filename = if safe.is_empty() { "徒步地球本机备份.json".to_string() } else { safe };
    let extension = if filename.ends_with(".json") { "json" } else if filename.ends_with(".txt") { "txt" } else { return Err("只允许导出JSON或TXT本地备份".into()); };
    let selected = rfd::AsyncFileDialog::new().add_filter(if extension == "json" { "JSON" } else { "文本" }, &[extension]).set_file_name(&filename).save_file().await;
    let Some(file) = selected else { return Ok(false); };
    let parent = file.path().parent().ok_or("保存位置无效")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建保存文件".to_string())?;
    use std::io::Write;
    temporary.write_all(content.as_bytes()).map_err(|_| "文件写入失败".to_string())?;
    temporary.as_file().sync_all().map_err(|_| "文件写入失败".to_string())?;
    temporary.persist(file.path()).map_err(|_| "无法完成保存，请检查文件权限".to_string())?;
    Ok(true)
}

use std::sync::Mutex;
use tauri_plugin_updater::{Update, UpdaterExt};
#[derive(Default)]
struct PendingUpdate(Mutex<Option<Update>>);
#[derive(serde::Serialize)]
struct UpdateInfo { version: String, notes: String }
#[tauri::command]
async fn check_app_update(app: tauri::AppHandle, pending: tauri::State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater_builder().timeout(std::time::Duration::from_secs(30)).build()
        .map_err(|_| "更新服务不可用".to_string())?.check().await.map_err(|_| "无法检查更新，请稍后重试".to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone().unwrap_or_default() });
    *pending.0.lock().map_err(|_| "更新状态不可用".to_string())? = update;
    Ok(info)
}
#[tauri::command]
async fn install_app_update(version: String, pending: tauri::State<'_, PendingUpdate>) -> Result<(), String> {
    let update = {
        let mut locked = pending.0.lock().map_err(|_| "更新状态不可用".to_string())?;
        if locked.as_ref().map(|u| u.version.as_str()) != Some(version.as_str()) { return Err("更新已变化，请重新检查".into()); }
        locked.take().ok_or("请先检查更新")?
    };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|_| "更新失败，签名或网络校验未通过；现有版本保持不变".to_string())?;
    Ok(())
}
#[tauri::command]
fn restart_app(app: tauri::AppHandle) { app.restart(); }

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .manage(location::DesktopLocation::default())
        .invoke_handler(tauri::generate_handler![choose_gpx, save_gpx, save_local_text, check_app_update, install_app_update, restart_app, map_network::map_catalog, map_network::map_download, location::desktop_location_start, location::desktop_location_read, location::desktop_location_stop])
        .run(tauri::generate_context!())
        .expect("运行徒步地球桌面端失败");
}
