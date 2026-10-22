# 徒步地球静态备用入口

此目录可作为独立静态站点上传，不依赖 Next.js、CloudBase 密钥或构建步骤。它只提供主站、下载中心和 GitHub Releases 的导航；路线搜索、账号、同步、天气、地图申请和社区仍由 Cloudflare 动态主站提供。

当前页将 `https://hiking-earth.hiking-earth.workers.dev/` 作为主站地址、将 `https://github.com/hiking-earth/clients/releases` 作为客户端公开发布入口。若域名或仓库迁移，先改 `index.html` 的链接后再上传。

不要把此页描述为完整离线客户端，也不要把 `stable.json` 中未就绪的包展示成正式下载。静态文件尚未部署或通过用户指定的另一会话验收。

静态页使用 `blue-marble-mercator-4096.webp` 展示写实地球，来源为 NASA Earth Observatory Blue Marble Next Generation（2004 年 6 月合成，非实时影像）；来源、处理方式和 SHA-256 记录在同目录 `.provenance.json`。该素材仅增加约 1.2 MB 静态资源，不进入客户端安装包。

## 可移交的打包与 Pages 入口

`python3 scripts/prepare-static-fallback.py --output <一个尚不存在的新目录>` 只复制页面、地球影像和来源记录三类指定文件，核对影像来源哈希，并生成 `source-record.json` 与 `.nojekyll`。它不运行 Next.js、不读取云密钥、不覆盖旧目录。来源记录区分提交与未提交改动，打包不代表功能验收或部署完成。

网站仓库的 `.github/workflows/static-fallback-pages.yml` 仅手动触发。默认 `publish=false`，只生成保留14天的静态 Artifact，可用于其他静态平台；不会更新现有网站。功能验收会话检查后，所有者可在仓库 Settings → Pages 将 Source 设为 GitHub Actions，再从 main 手动选择 `publish=true`。流程只向该仓库的 GitHub Pages 发布，不接触 Cloudflare 或 Sites。

若已有 Pages 站点，发布步骤要求其公开来源记录确认它已经是本项目静态备用页；自定义域名、来源不明或其他 Pages 网站会停止并保留。首次 Pages 启用和环境保护规则需要仓库权限。成功 URL 由 deploy-pages 的输出提供，不能在流程尚未执行时宣称已有可访问备用网址。

此工作流与脚本本轮仅开发，尚未执行或部署。官方流程依据：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
