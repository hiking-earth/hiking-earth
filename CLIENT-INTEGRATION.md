# 完整客户端入口

新增 `/client`，嵌入同源 `/client-app/index.html` 客户端资源。3D 地球主页保留，统一账号、轨迹、组队、社区由 clients 仓库同一实现生成，避免网页端另写一份不同的业务。

构建前 `scripts/prepare-client.mjs` 使用 HIKING_CLIENT_ROOT 指定源码；本机相邻 app 目录存在时直接使用。独立 CI 则按 clients.source.json 的精确提交拉取公开 clients 仓库。构建失败会停止，不发布缺失功能的空入口。

网页构建准备还会逐个核对固定客户端的目录源文件SHA是否等于分页manifest快照、OSM/USFS/香港/公告的记录数与分页配置是否一致、每个压缩分页及搜索索引的解压SHA和内容是否匹配源记录。目录先复制到临时位置，全部校验通过后再替换现有包；固定提交缺页、快照混用或索引错位时会保留旧目录并在前置步骤终止。该流程尚未通过构建运行验收。

部署时提供 VITE_CLIENT_API_URL=https://实际HTTP服务地址；未配置时账号页面明确关闭提交。此变量为公共地址，不能填写密钥。资源尚未生成、页面尚未测试或部署。

本次网页隔离工作树位于客户端工作区 web/，分支codex/client-entry；原始网页main保持原有文件。先完成所有平台功能，最后统一测试。

Worker变量CLIENT_API_ORIGIN配置为同一HTTPS网关的origin，加入精确CSP连接来源。/client-app静态资源通过ASSETS读取，允许同源iframe；仅/client页面与客户端资源允许同源相机权限，仍需浏览器主动授权。PWA按请求地址缓存导航页面，避免客户端覆盖3D主页的离线缓存。

## 2026-10-07 实际部署更新

固定客户端已更新为 f6e1ad7251e4dd4c52c179f4f94e0a52dea191ce。Sites独立副本完成构建/来源推送/归档，源码24684907f7c109e0e0b2a83cb10160aa0b952f8c，版本6部署succeeded，网址https://hiking-earth.nanyu20050927.chatgpt.site，访问范围public。本记录覆盖上文旧的未构建/未部署状态，但不代表账号、离线、天气或真机业务验收通过。

本轮新增天气代理采用MET Norway坐标预报，显示CC BY4.0署名并缓存；只发送两位小数路线坐标。公开隐私/举报邮箱由个人运营者确认。前台PWA更新提示保留未保存资料，正式多端更新清单仍ready=false。
