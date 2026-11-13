# USGS发现候选源码

官方资料 https://www.usgs.gov/national-digital-trails/how-access-or-view-usgs-trails-dataset 说明全国公共领域空间数据聚合及服务入口。保留source originator，不把收录/活动类型当开放或导航许可。

采集器按ID分批，完整性验证后才能形成候选；缺页或错误保留原目录。每请求最多3次，只有瞬时网络/特定HTTP状态重试，总时间默认1200秒；响应/记录/几何/输出都有上限。`--output`独占新建候选，未指定时保留原脚本的原子更新行为。

新增月度/手动workflow只上传Artifact，无写仓库/云权限；`HIKING_USGS_DISCOVERY_READY=true`和默认分支双门禁，默认关闭。启用及真实采集留给验收后开发步骤，不要求所有者自己写脚本。不自动把候选接入线上目录，也不将示意线作为导航。已有在线USGS搜索不受更改。

本轮只Python AST、YAML语法和源码差异检查；没有运行采集、网络功能测试或生产发布，不能宣称实际发现数量增加。
