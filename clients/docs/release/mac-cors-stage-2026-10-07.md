# Mac实际运行与HTTP网关CORS

## 已核实

- 已验签desktop-17 Apple Silicon候选可启动；发现、我的、账号管理和本机装备识别页可打开。
- 原先扫码显示网络失败，WebKit日志标记isAccessControl=1。真实响应头为`tauri://localhost,*`，网关拼接了函数CORS头。
- r6移除函数CORS头后，Mac真实界面能生成二维码、显示等待小程序确认，并成功取消。
- r7试验同源反射仍被网关拼成`tauri://localhost,tauri://localhost`，已撤回；r8恢复仅网关管理CORS，两次部署均回读源码一致。
- 最终线上协议检查：Mac来源预检204、天气200、唯一允许来源通过。公开Sites来源预检无允许来源，未通过。报告保留为passed:false。
- 添加精确Sites域名的CLI请求被腾讯云拒绝：`[CreateAuthDomain] 当前套餐无法执行此操作`。未升级套餐、未付费。
- 现有默认CloudBase静态托管online，默认域名已在安全域名表中，可继续评估免费同源托管或受限中转方案。

## 未完成

公开Sites跨域修复、微信确认登录、手机绑定、装备真实图像推理、桌面全业务及升级验收仍未完成。网页浏览器能显示数据不能证明真实Safari/WebKit跨域通过。

旧失败日志与r6/r7/r8远端备份保存在所有者本机私有acceptance/backups目录；不发布登录挑战或凭据。
