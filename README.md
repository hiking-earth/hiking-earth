# 徒步地球 Hiking Earth

一个以可旋转 3D 卫星地球为入口的徒步路线发现与行前决策网页。它聚合路线档案、季节与地形观察、风险提示、装备建议和本地优先的约伴/足迹原型；包含人工维护的中国种子路线，并持续从 OSM、美国国家森林和香港 AFCD 来源加载发现档案。

> 当前为公开候选版，不是导航工具，也不构成通行许可或安全建议。出发前请以属地管理方、景区和气象部门的最新公告为准。

## 在线体验

- 主站（Cloudflare Workers）：[hiking-earth.hiking-earth.workers.dev](https://hiking-earth.hiking-earth.workers.dev/)
- 备用站（ChatGPT Sites）：[hiking-earth.nanyu20050927.chatgpt.site](https://hiking-earth.nanyu20050927.chatgpt.site/)
- 源码仓库：[hiking-earth/hiking-earth](https://github.com/hiking-earth/hiking-earth)

中国大陆正式入口仍在准备中：需完成自有域名、备案与国内地图资源替换后再对外提供。

## 已实现

- 完整 3D 卫星地球、路线锚点、路线详情与地图聚焦。
- 路线状态、季节、负重、夜宿、路面与关键词筛选。
- 人工维护的中国种子档案，以及在线/API和静态快照提供的 OSM、美国国家森林与香港官方路线发现目录；自动发现不等于开放核验，未获授权或待核验的路线不会显示为可导航轨迹。
- 近景按需开启立体地形和 NASA 季相影像，避免首屏不必要的地图加载。
- 装备建议、天气读取降级提示、风险提醒、PWA 离线壳与移动端安全区适配。
- 本地优先的推荐、约伴、留言、日记足迹与管理台原型。
- 数据来源、隐私、条款、发布状态和健康检查页面。

## 技术栈

- React 19、TypeScript、Vinext/Vite
- MapLibre GL JS（3D 地球与地图交互）
- Cloudflare Workers（海外运行时与 API）
- Drizzle ORM（数据层预留）

## 统一开发入口（2026-11-13）

后续开发统一在 `hiking-earth/hiking-earth`，本地只使用当前工作文件夹。
网站源码位于根目录，共享客户端、移动端、桌面端和后端源码位于 `clients/`；两者在同一次 Git 提交中版本化，构建不会再次克隆客户端。

```bash
npm run setup          # 安装网站、客户端与桌面工具依赖
npm run dev            # 网站
npm run dev:client     # 共享 H5 客户端
npm run dev:desktop    # 桌面开发
npm run build:desktop  # 覆盖同一位置的本机候选 .app，不生成其他平台包
```

本机软件本体固定为 `clients/desktop/src-tauri/target/release/bundle/macos/徒步地球.app`。
该本机构建关闭正式更新签名产物，不代表稳定发布。开发、安装与真机验收状态见 [整合记录](docs/仓库整合与开发准备-2026-11-13.md)。

## 本地开发

项目统一使用 Node.js 22；仓库根目录的 `.nvmrc` 同时供本地 nvm 与 CI 读取。首次安装可运行 `nvm install && nvm use`。

```bash
npm ci
npm run dev
```

默认访问 `http://localhost:8080/`。

```bash
npm run lint
npm test
```

`npm test` 会先执行生产构建，再运行 14 项页面结构与产品边界回归测试。

## 发布流程

Cloudflare Workers 是主站运行环境，GitHub 仓库保存源码和 CI 证据；当前仓库没有自动部署工作流，需在发布候选通过检查后手动部署。生产部署配置位于构建产物 `dist/server/wrangler.json`。

```bash
npm run build
cd dist/server
npx wrangler deploy --config wrangler.json
```

## 数据与使用边界

网页默认矢量底图使用 OpenFreeMap/OpenMapTiles 和 OpenStreetMap 数据；用户主动切换时可查看 NASA 历史季相影像，地形使用 Mapzen/AWS 开放高程资料。Esri World Imagery 已从默认地图移除。各来源、署名和当前可用范围见：[数据来源页](https://hiking-earth.hiking-earth.workers.dev/sources)。

路线开放状态、预约、天气和高风险信息必须由用户在出发前向官方再次核实。未完成授权或核验的数据不得作为导航、救援、商业运营或安全决策依据。

## 贡献与安全

- 贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)
- 安全问题请按 [SECURITY.md](SECURITY.md) 所述方式报告，不要公开提交漏洞细节。
- 仓库尚未选择开源许可证。在许可证添加前，代码仅供查看与讨论，不自动授予复制、修改或再发布权利。

## 项目结构

```text
app/                 页面与 Cloudflare 兼容 API
components/          功能中心与界面组件
data/                路线、来源和探索数据
tests/               产品边界与渲染回归测试
docs/                验收、数据许可、发布与回滚资料
```

## 项目状态

目前仍保留发布闸门：路线逐条核验、图片权利台账、天气正式凭据、法律联系信息，以及跨端实机验收完成前，不应把本项目宣传为正式的徒步导航或实时开放状态服务。
