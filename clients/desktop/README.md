# 徒步地球桌面端

本仓库包含共享客户端和 Tauri 桌面应用源码，主线 `main` 是跨电脑接手的基准。

## 系统定位与轨迹记录

桌面端实现了系统定位、连续位置更新、路线导航、轨迹记录及 GPX 导入导出。
不是仅提供轨迹查询，也不把 IP 地址查询当成 GPS。

- 入口：应用“轨迹 → 开始记录”和路线导航。先在“我的 → 隐私设置”同意定位，再完成系统授权。
- Rust 桥接：`src-tauri/src/location.rs`；调用 `robius-location 0.3.1` 的系统定位。
- macOS：CoreLocation，并在 `src-tauri/Info.plist` 提供定位用途说明。
- Windows：系统 Geolocator；需要打开 Windows 定位服务并允许桌面应用访问位置。
- Linux：XDG Location Portal / GeoClue，未提供服务时明确报错。
- 前端：`app/src/services/desktop-location.ts`，由 `location.ts` 的桌面分支调用；不会退回 IP 定位。
- 停止、撤回应用定位同意、失败和超时会停止订阅；旧会话的迟到结果不会导入新轨迹。
- 无系统定位源或硬件时会失败；电脑位置可能来自 Wi-Fi 或外接 GPS。
- 当前依赖未公开水平精度，精度保留为空，不能当成已确认高精度导航。轨迹采样时间保留系统时间（Windows 不提供时用接收时间）。
- 本轮属于源码与定向检查，Windows VM / Mac 真机的系统弹窗、移动轨迹及休眠行为仍需测试会话验收。

## 同步与构建

`npm --prefix app run type-check` 检查共享前端；`cargo check --manifest-path desktop/src-tauri/Cargo.toml --locked` 检查原生源码。
`npm --prefix desktop run build` 会从当前提交重新生成共享前端，不能以旧安装包代替当前源码。
安装包仍须经过平台验收和正式发布门禁；仓库能力存在不表示用户安装的旧版本包含此功能。
