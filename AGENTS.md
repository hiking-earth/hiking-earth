# 开发约定

- 唯一开发仓库为 hiking-earth/hiking-earth；唯一工作目录为当前仓库。
- 直接在本目录迭代，不创建第二份 clone、worktree、软件副本或按日期保存的应用本体。
- 网站在根目录，客户端与桌面端在 clients/；客户端构建始终读取本仓库 clients/，禁止重新拉取 clients 独立副本。
- 本机软件本体使用 clients/desktop/src-tauri/target/release/bundle/macos/徒步地球.app，重新构建覆盖这个位置；不要复制到其他目录或另外生成 DMG。
- 保留 shared/releases/stable.json 的 ready=false，直到正式发布与验收有证据完成。
- 历史归档是开发资料，不能充当当前软件；未经明确授权，不把私有归档推入公开仓库。
- 修改后执行相应的 lint、类型检查、构建与已有回归测试；将未通过的检查如实记录。
