# 景点图片候选与正式目录准备

## 发现

`discover-commons-scenic-images.py` 使用官方Commons API，仅元数据，不下载图片。查询表为 `shared/data/content/scenic-image-searches.json`。候选默认 pending-human-review；重新发现保留人工历史，来源/许可/区域改变退回待审核，不自动覆盖已发布目录。工作流需 HIKING_SCENIC_DISCOVERY_READY=true 且默认分支，默认关闭。

## 审核后准备

由有仓库权限的审核者核对候选文件页、摄影者、地区对应、许可署名及人物隐私/其他权利。每项 approved 记录需 reviewedBy（公开仓库审核账号，不是App私密openid）、reviewedAt（带时区）、expiresAt（未来且距审核不超过90天）、rightsConfirmed（source-author、region-match、license-attribution、privacy-other-rights），以及 approvedSourceRevision（同一Commons File的永久oldid链接）。fileSha1和id必须一致。

运行 `python3 scripts/prepare-approved-scenic-images.py --candidates <候选JSON> --reviewer <预期公开审核账号> --output <不存在的新目录文件.json>`。工具不发送网络、不推送、不发布；拒绝覆盖现有目录，输出目录及来源/输出SHA回执。未批准或过期项不进入新目录；不合法的已批准字段中止，不默认放行。不将reviewedBy写入客户端公开目录。

准备结果是完整的新候选目录：正式目录中仍需保留的图片也必须列入候选并重新确认，不能把输出误当只追加增量覆盖而丢掉原条目。审核后由开发端在独立源码PR更新正式scenic-images.json并正常构建发布；本会话未运行准备或发布。审核记录只是操作依据，不自动证明所有法律权利。

## 客户端到期边界

共享scenicReviewCurrent按checkedAt最多90天；新条目还核对reviewStatus=approved及expiresAt，旧人工维护条目沿用checkedAt同样最长90天。到期/未来日期/无效日期不显示。客户端增加共享时钟：前台每30秒、网页恢复可见/pageshow、App恢复前台时重新判断；查看图片前再次读取当前时间。后台计时仍受系统节流影响，不能承诺后台毫秒级撤回。网页切换地区后不会沿用上一地区的查看授权。另一会话需补到期、恢复前台及跨地区同意范围验收。

来源变化/许可撤回需重新同步目录；离线旧客户端在未更新前不能保证实时获知。不能把地区历史图片当作路线现况或通行许可。

## 本轮证据

只做Python AST、TS/Vue/YAML语法解析；没有实际采集、准备、图片加载、功能测试、部署或发布。
