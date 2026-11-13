# iPhone 发布验收门槛修正

免费 iPhone 分发已确定为 PWA。旧发布脚本允许 ios=blocked-owner 继续，可能把等待 Apple 签名当作 iPhone 已处理。现两类发布入口共用 release_acceptance.py：要求 ios.status=passed，明确 delivery=pwa/native，device=physical-iphone，installation/offlineRestore/permissionWithdrawal/update 四项均 passed 且引用非空证据。PWA 证据不能支持原生商店 URL。

报告模板仍为 complete=false，各检查 pending；本轮没有填写虚假真机通过，也没有发布候选或修改 stable.json。证据引用结构校验不能证明引用内容真实，最终审核必须读取相应实机记录。

验证：iphone-release-acceptance.test.py 5项通过；desktop-promotion-platforms.test.py 5项通过，其中缺Intel资产仍阻止发布。测试中的 fixture-only 只用于隔离结构回归，不是生产验收。

后续：独立开发验收继续推进，最终集中处理真实 iPhone 的安装、离线恢复、权限撤回与更新检查。
