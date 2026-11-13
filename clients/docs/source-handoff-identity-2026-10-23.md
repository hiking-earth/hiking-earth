# 跨电脑源码交接身份

`scripts/export-client-source-record.py`只读取指定源码和Git对象，独占创建JSON，不运行客户端或测试。先显式fetch主线，再从远端独立读取完整SHA，传入`--compare-ref origin/main --expected-comparison-commit <完整SHA> --output <新JSON路径>`。不一致即停止，不能用旧跟踪ref当远端当前版本。

报告含工作区基线、dirty状态、GPS/账号核心/地图/装备/图片审核来源SHA。工作区缺失和主线差异必须保留记录；不可据此自动删除或覆盖。文件SHA仅证明输入，不能证明安装包包含、GPS运行、部署或功能验收。原有GPS主线文件在旧工作区缺失时，不得把缺失当作要提交的删除。
