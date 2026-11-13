use std::time::Duration;
use std::sync::atomic::{AtomicBool, Ordering};
static NETWORK_BUSY: AtomicBool = AtomicBool::new(false);
struct Permit;
impl Drop for Permit { fn drop(&mut self) { NETWORK_BUSY.store(false, Ordering::Release); } }
fn acquire() -> Result<Permit, String> {
    NETWORK_BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "地图网络请求正在进行，请稍后重试".to_string())?;
    Ok(Permit)
}
const BASE: &str = "https://hiking-earth.hiking-earth.workers.dev/client-app/static/offline-maps/";
const MAX_MAP: u64 = 64 * 1024 * 1024;
fn valid_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".pmtiles") else { return false; };
    !stem.is_empty() && stem.len() <= 80 && stem.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
async fn fetch_bounded(name: &str, limit: u64, exact: bool) -> Result<Vec<u8>, String> {
    let _permit = acquire()?;
    let client = reqwest::Client::builder().https_only(true)
        .redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 HikingEarthDesktop/0.2.3")
        .build().map_err(|_| "地图网络服务不可用".to_string())?;
    let mut response = client.get(format!("{BASE}{name}")).send().await.map_err(|error| {
        #[cfg(test)] eprintln!("map request failure: timeout={} connect={} cause={}", error.is_timeout(), error.is_connect(), error);
        "地图请求失败".to_string()
    })?;
    if response.status() != reqwest::StatusCode::OK { return Err("地图请求未成功".into()); }
    if let Some(length) = response.content_length() {
        if length > limit || (exact && length != limit) { return Err("地图响应大小不一致".into()); }
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "地图下载中断".to_string())? {
        if chunk.len() as u64 > limit.saturating_sub(bytes.len() as u64) { return Err("地图响应超过限制".into()); }
        bytes.extend_from_slice(&chunk);
    }
    if exact && bytes.len() as u64 != limit { return Err("地图下载不完整".into()); }
    Ok(bytes)
}
#[tauri::command]
pub async fn map_catalog() -> Result<String, String> {
    String::from_utf8(fetch_bounded("catalog.json", 256 * 1024, false).await?).map_err(|_| "地图目录编码无效".into())
}
#[tauri::command]
pub async fn map_download(name: String, bytes: u64) -> Result<tauri::ipc::Response, String> {
    if !valid_name(&name) || !(127..=MAX_MAP).contains(&bytes) { return Err("地图下载清单无效".into()); }
    Ok(tauri::ipc::Response::new(fetch_bounded(&name, bytes, true).await?))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "live public network acceptance"]
    fn public_catalog_request() {
        let text = tauri::async_runtime::block_on(map_catalog()).expect("public map catalog");
        let rows: serde_json::Value = serde_json::from_str(&text).expect("catalog JSON");
        assert!(!rows.as_array().expect("catalog array").is_empty());
        assert!(text.len() <= 256 * 1024);
        let row = &rows.as_array().unwrap()[0];
        let name = row["name"].as_str().expect("name");
        let size = row["bytes"].as_u64().expect("size");
        assert!(valid_name(name));
        assert!((127..=MAX_MAP).contains(&size));
        let data = tauri::async_runtime::block_on(fetch_bounded(name, size, true)).expect("real map download");
        use sha2::{Digest, Sha256};
        assert_eq!(format!("{:x}", Sha256::digest(&data)), row["sha256"].as_str().expect("SHA"));
        println!("real map byte count and SHA verified: {} bytes", data.len());
    }
    #[test] fn filenames_are_confined() {
        assert!(valid_name("monaco-20261006.pmtiles"));
        for name in ["../map.pmtiles", "https://x/map.pmtiles", "map.pmtiles?x", "MAP.pmtiles", ".pmtiles"] { assert!(!valid_name(name)); }
    }
}
