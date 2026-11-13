# 可选区域离线高程实现边界

- 构建：build-terrain-region.py固定免费公开Terrarium源，区域/256瓦片/32MiB/900秒/3次请求预算，PNG/SHA及多源credit，独占候选ZIP。默认不运行，不生成全球预装资产。
- 导入：分段有界ZIP读取，拒绝未知重复条目/不匹配哈希/元信息/尺寸/署名；不按ZIP路径写任意文件。自己计算归档SHA用于本机一致性，不等于官方签名或来源真实性，只有审核的来源候选可公开分发。
- 网页/桌面：IndexedDB新增terrain store保留maps，保存两个类别共用事务和192MiB预算，主动选择、查看三维Terrarium/hillshade、署名、确认删除。三维比例1，协议仅返回已校验本机PNG，不配置在线地图或字体。
- 微信/原生：复用平台文件选择、范围读取、saveFile，地图/地形目录独立但共用平台串行队列及192MiB预算。纯PNG解码只支持256像素8位RGB/RGBA非交错，校验PNG CRC并限制inflate；二维按瓦片晕渲/切换及高程范围。不将二维图宣称与WebGL三维相同，不含道路底图或导航许可。
- 失败保留原包与目录，默认不上传/不自动下载。地形来源分辨率各地不同，不能作为测量、救援或通行依据。此功能不补齐全球任意地点的合法步道轨迹。

官方来源：https://registry.opendata.aws/terrain-tiles/ ，https://github.com/tilezen/joerd/blob/master/docs/formats.md ，https://github.com/tilezen/joerd/blob/master/docs/attribution.md 。画布API说明：https://uniapp.dcloud.net.cn/api/canvas/canvasPutImageData.html 。

证据限源码解析与候选编译。另会话须检查新旧数据库升级、并发预算、损坏ZIP/PNG、真实包各端绘图、隐藏/销毁时取消、平台空间清理、删除失败恢复和用户授权。未运行这些测试，不宣称验收或线上可用。
