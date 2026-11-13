# 地图原生控制按钮修复

- 根因：uni CSS 标签重写把 MapLibre 原生 button/a 选择器变成 uni-button/uni-a，实际库创建原生 DOM 不匹配。
- 修复：Vite 前置插件只针对 maplibre-gl/dist/maplibre-gl.css，将按钮选择器改为 type 属性选择器、署名链接改为 href 属性选择器，保留 SVG 和原库其余样式。
- 验证：H5 构建退出 0；生成 CSS 不含三类错误选择器，保留放大按钮属性选择器；实际本机浏览器地图下载校验保存，三控制按钮 29×29、图标 SVG 正常，点击放大后截图显示实际地图。
- 证据：map-controls-fixed-2026-10-07.png。
- 边界：本机 H5 已验证；公网网站和新桌面包尚需重新构建部署及运行验收。没有据此开启正式发布门槛。
