# 完整客户端入口

新增 `/client`，嵌入同源 `/client-app/index.html` 客户端资源。3D 地球主页保留，统一账号、轨迹、组队、社区由 clients 仓库同一实现生成，避免网页端另写一份不同的业务。

构建前 `scripts/prepare-client.mjs` 使用 HIKING_CLIENT_ROOT 指定源码；本机相邻 app 目录存在时直接使用。独立 CI 则按 clients.source.json 的精确提交拉取公开 clients 仓库。构建失败会停止，不发布缺失功能的空入口。

部署时提供 VITE_CLIENT_API_URL=https://实际HTTP服务地址；未配置时账号页面明确关闭提交。此变量为公共地址，不能填写密钥。资源尚未生成、页面尚未测试或部署。

本次网页隔离工作树位于客户端工作区 web/，分支codex/client-entry；原始网页main保持原有文件。先完成所有平台功能，最后统一测试。

Worker变量CLIENT_API_ORIGIN配置为同一HTTPS网关的origin，加入精确CSP连接来源。/client-app静态资源通过ASSETS读取，允许同源iframe；仅/client页面与客户端资源允许同源相机权限，仍需浏览器主动授权。PWA按请求地址缓存导航页面，避免客户端覆盖3D主页的离线缓存。
