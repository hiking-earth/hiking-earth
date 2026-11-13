# 候选归档完整性修正

run39834041339三个编译job均success，但下载逐文件盘点后：微信196文件/1724427字节、App71文件/24030021字节与来源清单逐项匹配；H5应112文件/73502671字节，Artifact遗漏两个以点开头的TensorFlow生成chunk，因此H5 Artifact不完整，不能作为可用候选交付。见output/candidates/client-resources-run-39834041339/download-inspection.json。不是功能测试，是实际归档内容核对。

upload-artifact设置include-hidden-files:true，仅作用于明确的编译输出、公开来源记录和编译日志路径，不扫描仓库.env或签名资料。新流程加入WeChat输出AppID与源码manifest的核对；这不是AppID授权证明。修正后需要新构建并重新收取逐文件验证；旧失败产物和清单全部保留。

调色板生成器补齐现有颜色/布局字段，但移除自动写web/.client-source等旧固定源码副本及嵌套网站仓库的行为。网站构建自己的prepare-client继续以clients.source.json为唯一来源，不能因运行根生成器覆盖网站未提交或固定版本。没有重新设计颜色或地球。

本轮Node/YAML语法解析通过；没有执行调色板生成器、功能测试、安装或部署。
