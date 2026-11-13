# 共享客户端资源候选入口

手动工作流client-resource-candidate.yml仅编译H5、微信与App资源，无发布权限，不启动应用，不运行功能测试，不替代现有client-build和验收流程。每平台独立Node22 npm ci，App先编译native-map；失败的编译日志保留，任一任务失败不取消其他平台。

record-client-resource-candidate.py核对期望Git提交和唯一输出目录，记录逐文件大小/SHA、200MB目标与500MB硬上限，不允许复写已有来源记录或资源符号链接。App资源不是APK/IPA，微信资源不是已上传或已审核的小程序。微信包体检查是编译产物大小盘点，不是功能测试；报告采用独占创建，不覆盖旧记录。

编译产物Artifact默认保存14天，取回后才能形成长期候选交付；不因存在Artifact开启stable更新。发布、真机、权限、升级、跨设备测试在另一会话。原client-build/desktop-release中的测试与发布门禁保持不变。

iOS打包辅助器补齐英文/中文未登录错误识别，避免CLI返回0就误报成功；本轮没有调用iOS打包。

本轮仅Python AST、Node --check及YAML解析，尚未执行新工作流或资源记录器；不能宣称新候选已产出。
