import { DocumentShell } from "@/components/DocumentShell";
import { RELEASE_SOURCE_REGISTRY } from "@/data/source-registry";

const releaseReady = process.env.NEXT_PUBLIC_RELEASE_READY === "true";

export default function ReleasePage() {
  const blockers = RELEASE_SOURCE_REGISTRY.filter((source) => source.readiness !== "可本地展示");
  return (
    <DocumentShell eyebrow="RELEASE GATE" title="发布准备状态" updatedAt="2026-08-24">
      <div className={releaseReady && blockers.length === 0 ? "release-status ready" : "release-status blocked"}>
        <b>{releaseReady && blockers.length === 0 ? "允许发布" : "禁止正式发布"}</b>
        <span>{releaseReady ? "环境发布开关已开启" : "环境发布开关保持关闭"} · 当前阻断项 {blockers.length} 个</span>
      </div>
      <h2>当前阻断项</h2>
      <ul>{blockers.map((source) => <li key={source.label}><b>{source.label}</b>：{source.note}</li>)}</ul>
      <h2>最终上线动作</h2>
      <p>只有完成官方数据、图片授权、地图生产使用、真实设备、隐私主体信息和部署回滚验收后，才允许把 NEXT_PUBLIC_RELEASE_READY 改为 true，并执行最终部署。</p>
      <h2>多端下载</h2>
      <p>网页、PWA、Android、桌面端和微信小程序的入口与正式版本状态见 <a href="/download">多端下载中心</a>。网站公开访问不代表客户端安装包已发布。</p>
    </DocumentShell>
  );
}
