import { DocumentShell } from "@/components/DocumentShell";
import { RELEASE_SOURCE_REGISTRY } from "@/data/source-registry";

export default function SourcesPage() {
  return (
    <DocumentShell eyebrow="SOURCES" title="数据来源与许可状态" updatedAt="2026-08-24">
      <p>正式上线采用“来源可追溯、状态可复核、许可可证明”的发布闸门。下表中的阻断项未解决前，网站不得切换为公开发布状态。</p>
      <div className="document-source-list">
        {RELEASE_SOURCE_REGISTRY.map((source) => (
          <section key={source.label}>
            <div><h2>{source.label}</h2><strong data-readiness={source.readiness}>{source.readiness}</strong></div>
            <p>{source.note}</p>
            <small>{source.checkedAt}</small>
            <a href={source.url} target="_blank" rel="noreferrer">打开官方来源</a>
          </section>
        ))}
      </div>
    </DocumentShell>
  );
}
