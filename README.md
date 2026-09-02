# 徒步地球 Hiking Earth

一个以可旋转 3D 卫星地球为入口的徒步路线发现与行前决策网页。它聚合路线档案、季节与地形观察、风险提示、装备建议和本地优先的约伴/足迹原型；首批收录 20 条中国徒步路线。

> 当前为公开候选版，不是导航工具，也不构成通行许可或安全建议。出发前请以属地管理方、景区和气象部门的最新公告为准。

## 在线体验

- 海外体验站：[hiking-earth.hiking-earth.workers.dev](https://hiking-earth.hiking-earth.workers.dev/)
- 源码仓库：[hiking-earth/hiking-earth](https://github.com/hiking-earth/hiking-earth)

中国大陆正式入口仍在准备中：需完成自有域名、备案与国内地图资源替换后再对外提供。

## 已实现

- 完整 3D 卫星地球、路线锚点、路线详情与地图聚焦。
- 路线状态、季节、负重、夜宿、路面与关键词筛选。
- 20 条首批路线档案；高风险或不开放路线不会展示精确轨迹。
- 近景按需开启立体地形和 NASA 季相影像，避免首屏不必要的地图加载。
- 装备建议、天气读取降级提示、风险提醒、PWA 离线壳与移动端安全区适配。
- 本地优先的推荐、约伴、留言、日记足迹与管理台原型。
- 数据来源、隐私、条款、发布状态和健康检查页面。

## 技术栈

- React 19、TypeScript、Vinext/Vite
- MapLibre GL JS（3D 地球与地图交互）
- Cloudflare Workers（海外运行时与 API）
- Tencent EdgeOne（国内测试部署）
- Drizzle ORM（数据层预留）

## 本地开发

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

默认访问 `http://localhost:8080/`。

```bash
npm run lint
npm test
```

`npm test` 会先执行生产构建，再运行 14 项页面结构与产品边界回归测试。

## 发布流程

`main` 是发布分支。推送到 GitHub 后，Cloudflare Workers 与 EdgeOne 会分别构建海外/国内版本；Cloudflare 的生产部署配置位于构建产物 `dist/server/wrangler.json`。

```bash
npm run build
cd dist/server
npx wrangler deploy --config wrangler.json
```

## 数据与使用边界

项目当前使用或参考 Esri 卫星影像、OpenFreeMap/OpenMapTiles/OSM、NASA Earthdata GIBS、Mapzen/AWS 高程、Unsplash 演示图片及中国天气网公开实况。各来源、当前可用范围和正式发布阻断项见：[数据来源页](https://hiking-earth.hiking-earth.workers.dev/sources)。

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
edgeone-domestic/    国内 EdgeOne 独立部署入口
docs/                验收、数据许可、发布与回滚资料
```

## 项目状态

目前仍保留发布闸门：路线逐条核验、图片权利台账、天气正式凭据、法律联系信息，以及跨端实机验收完成前，不应把本项目宣传为正式的徒步导航或实时开放状态服务。
