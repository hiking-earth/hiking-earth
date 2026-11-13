# 装备识别服务配置

本目录的配置只用于 CloudBase 服务端。`env.example` 是空值模板，不是会被自动加载的密钥文件；不要将真实密钥写入仓库或客户端构建变量。

1. 在 CloudBase 控制台为 `gear-scan` 与 `client-api` 设置相同的 `GEAR_SCAN_INTERNAL_TOKEN`。值为安全随机生成的 64 位十六进制字符串。不要将该值发到聊天。对外调用必须经过 `client-api` 的账号会话、账号级照片授权和限流。
2. 默认设置 `GEAR_SCAN_BACKEND=cpu`，使用本目录固定的自托管模型。外部模型密钥不会在此模式生效。未知后端名称会返回配置错误，不会静默改用另一个后端。
3. 若启用千问，先在百炼控制台确认北京地域相应模型的免费额度、有效期，并开启“免费额度用完即停”。复制控制台提供的北京工作空间兼容接口地址至 `GEAR_QWEN_BASE_URL`；在服务端设置密钥、模型名、两个免费保护标志为 `true`，最后将后端切换为 `external`。项目标志只表示所有者已完成控制台配置，不能替代阿里云计费设置。
4. 严格免费方案保留 `GEAR_DEEPSEEK_ALLOW_PAID=false`。只有所有者另行决定接受计费，才配置 DeepSeek 密钥并启用此开关；已授权的同一照片届时可能在千问请求失败后发送给 DeepSeek。
5. 撤回照片授权后，`client-api` 阻止后续请求；已经发送的服务商请求无法召回。代码不将照片写入业务数据库，但服务商自身的数据处理规则仍适用。

接口读取超时为 30 秒、响应最大 1 MiB、图片最大 4 MiB。账号入口现有限流为每账号每 15 分钟 10 次；它不是服务商免费额度统计。所有者应在服务商控制台限制费用与额度。

配置模板、源码或部署命令不等于服务已运行。本会话只开发，真实模型调用、授权撤回和多端效果由另一验收会话检查。

官方资料：[百炼免费额度与用完即停](https://help.aliyun.com/en/model-studio/new-free-quota)、[百炼视觉模型](https://help.aliyun.com/en/model-studio/vision-model/)、[DeepSeek 视觉接口](https://api-docs.deepseek.com/guides/vision/)。
