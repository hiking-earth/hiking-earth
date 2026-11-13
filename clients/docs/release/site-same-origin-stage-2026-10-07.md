# 网站同源代理收尾

## 已核实

- Sites版本14公开部署成功，源码`30bde2350102e81d5244e9e280226e72e15b45fe`，部署`appgdep_6ac5bbc5dd348191b387f3ec23662e55`。
- 上游固定CloudBase地址，本站`/api/client-api`支持POST；只转发Bearer，不转发Cookie或客户端来源/IP头；账号结果不缓存，6 MiB请求体限制，拒绝上游重定向。
- 原天气代理错误由Cloudflare不支持`redirect:error`造成。改`manual`，真实天气GET返回200、MET Norway及CC BY 4.0署名。
- 3项代理单元检查通过：固定地址与凭据、重定向拒绝、坏凭据/JSON/超大体拒绝。
- 5项线上协议检查通过：天气、香港167条目录、过期凭据401及no-store、匿名扫码挑战生成、取消。初次上线传播期返回HTML的失败报告保留为initial。
- 真实网页账号页面生成二维码、等待确认、取消后显示“已取消扫码登录”；截图不保留二维码。
- 真实主页读取77128条发现资料、0条审核记录及20.4°C预报。收录不代表开放或可导航。
- MapLibre Worker和共享模块显式发布到`/vendor/maplibre/`，包含MIT许可；生产Worker GET200/18592字节，实际地球可见。

## 免费方案调查及退回

CloudBase当前套餐拒绝新增Sites安全域名。原域名直连CORS报告仍失败；正式网页改本站代理，免除该直连依赖。

试验静态中转文件上传及远端字节校验通过，但默认CloudBase托管域名存在访问提示页及attachment限制，不能作无交互正式中转。已停用iframe路径；仅保留试验源代码与历史。依据：https://docs.cloudbase.net/service/alias 。未升级套餐或开启付费服务。

## 仍未完成

真实微信端扫码确认/统一身份、手机号登录绑定、社交和同步全业务、多设备隐私验收、图片识别真图及原生方案、合法导航路线/开放公告和自动内容审核、完整全球离线地图、最终所有安装包升级回退、iPhone与微信真机验收、商店发布均未完成。账号管理员ID、微信上传授权等所有者事项留待独立项完成后集中处理。

证据：`deployed-site-api-acceptance-2026-10-07.json`、`site-api-proxy.test.cjs`、`site-qr-cancel-2026-10-07.png`、`site-14-public-page-2026-10-07.png`。正式stable仍ready:false。
