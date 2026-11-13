//! Native system location. Never substitutes IP coordinates for a device fix.
use robius_location::{Access, Accuracy, Handler, Location, Manager as LocationManager};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Serialize)]
pub struct Point {
    latitude: f64, longitude: f64, altitude: Option<f64>, speed: Option<f64>,
    // This provider does not expose measured accuracy. Never invent it.
    accuracy: Option<f64>, timestamp: u64,
}
#[derive(Clone, Default, Serialize)]
pub struct Snapshot { point: Option<Point>, error: Option<String> }
struct Session { id: String, manager: LocationManager }
#[derive(Clone, Default)]
pub struct DesktopLocation {
    desired: Arc<Mutex<Option<String>>>,
    snapshot: Arc<Mutex<Snapshot>>,
}
thread_local! { static MANAGER: std::cell::RefCell<Option<Session>> = const { std::cell::RefCell::new(None) }; }
struct Listener { id: String, state: DesktopLocation }
impl DesktopLocation {
    fn active(&self, id: &str) -> bool {
        self.desired.lock().map(|v| v.as_deref() == Some(id)).unwrap_or(false)
    }
    fn fail(&self, id: &str, message: &str) {
        if self.active(id) {
            if let Ok(mut value) = self.snapshot.lock() {
                *value = Snapshot { point: None, error: Some(message.into()) };
            }
        }
    }
}
fn message(error: robius_location::Error) -> &'static str {
    match error {
        robius_location::Error::AuthorizationDenied => "系统定位未授权，请在系统隐私设置中允许徒步地球使用位置",
        robius_location::Error::PermanentlyUnavailable => "此电脑的系统定位服务不可用，请启用定位或使用外接定位设备",
        _ => "暂时无法获取系统位置，请检查定位服务后重试",
    }
}
impl Handler for Listener {
    fn handle(&self, location: Location<'_>) {
        if !self.state.active(&self.id) { return; }
        let Ok(coords) = location.coordinates() else { return; };
        if !coords.latitude.is_finite() || coords.latitude.abs() > 90.0
            || !coords.longitude.is_finite() || coords.longitude.abs() > 180.0 { return; }
        let now = SystemTime::now();
        let acquired = location.time().unwrap_or(now);
        let Ok(age) = now.duration_since(acquired) else { return; };
        if age.as_secs() > 30 { return; }
        let timestamp = acquired.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        let point = Point { latitude: coords.latitude, longitude: coords.longitude,
            altitude: location.altitude().ok().filter(|v| v.is_finite()),
            speed: location.speed().ok().filter(|v| v.is_finite() && *v >= 0.0),
            accuracy: None, timestamp };
        if let Ok(mut value) = self.state.snapshot.lock() {
            if self.state.active(&self.id) { *value = Snapshot { point: Some(point), error: None }; }
        }
    }
    fn error(&self, error: robius_location::Error) { self.state.fail(&self.id, message(error)); }
}
fn dispatch(app: tauri::AppHandle, task: impl FnOnce() + Send + 'static) -> Result<(), String> {
    // Apple/Windows require main-thread calls; Linux D-Bus must not block that thread.
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        type Task = Box<dyn FnOnce() + Send>;
        static WORKER: std::sync::OnceLock<std::sync::mpsc::Sender<Task>> = std::sync::OnceLock::new();
        let worker = WORKER.get_or_init(|| {
            let (tx, rx) = std::sync::mpsc::channel::<Task>();
            std::thread::spawn(move || { for task in rx { task(); } });
            tx
        });
        worker.send(Box::new(task)).map_err(|_| "无法启动系统定位".into())
    }
    #[cfg(not(target_os = "linux"))]
    { app.run_on_main_thread(task).map_err(|_| "无法启动系统定位".into()) }
}
#[tauri::command]
pub fn desktop_location_start(session: String, app: tauri::AppHandle, state: tauri::State<'_, DesktopLocation>) -> Result<(), String> {
    if session.is_empty() || session.len() > 80 { return Err("定位会话无效".into()); }
    *state.desired.lock().map_err(|_| "定位状态不可用")? = Some(session.clone());
    *state.snapshot.lock().map_err(|_| "定位状态不可用")? = Snapshot::default();
    let state = state.inner().clone();
    dispatch(app, move || MANAGER.with(|cell| {
        let mut slot = cell.borrow_mut();
        if !state.active(&session) { return; }
        if let Some(mut previous) = slot.take() { let _ = previous.manager.stop_updates(); }
        let result = (|| {
            let mut manager = LocationManager::new_with_desktop_id(
                Listener { id: session.clone(), state: state.clone() }, "earth.hiking.desktop")?;
            manager.request_authorization(Access::Foreground, Accuracy::Precise)?;
            if !state.active(&session) { let _ = manager.stop_updates(); return Ok(None); }
            manager.start_updates()?;
            if !state.active(&session) { let _ = manager.stop_updates(); return Ok(None); }
            Ok(Some(Session { id: session.clone(), manager }))
        })();
        match result { Ok(value) => *slot = value, Err(error) => state.fail(&session, message(error)) }
    }))
}
#[tauri::command]
pub fn desktop_location_read(session: String, state: tauri::State<'_, DesktopLocation>) -> Result<Snapshot, String> {
    if !state.active(&session) { return Err("定位会话已结束".into()); }
    state.snapshot.lock().map(|v| v.clone()).map_err(|_| "定位状态不可用".into())
}
#[tauri::command]
pub fn desktop_location_stop(session: String, app: tauri::AppHandle, state: tauri::State<'_, DesktopLocation>) -> Result<(), String> {
    {
        let mut desired = state.desired.lock().map_err(|_| "定位状态不可用")?;
        if desired.as_deref() == Some(&session) { *desired = None; }
    }
    dispatch(app, move || MANAGER.with(|cell| {
        {
            let mut slot = cell.borrow_mut();
            if slot.as_ref().map(|v| v.id.as_str()) == Some(&session) {
                if let Some(mut old) = slot.take() { let _ = old.manager.stop_updates(); }
            }
        }
    }))
}
