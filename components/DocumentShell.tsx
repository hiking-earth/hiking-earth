import type { ReactNode } from "react";

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext's Next Link client navigation throws in the current runtime; use full-page navigation for this route. */
export function DocumentShell({ eyebrow, title, updatedAt, children }: { eyebrow: string; title: string; updatedAt: string; children: ReactNode }) {
  return (
    <main className="document-page">
      <header className="document-header">
        <a href="/">← 返回徒步地球</a>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>更新日期：{updatedAt}</p>
      </header>
      <article className="document-card">{children}</article>
      <nav className="document-nav" aria-label="发布与法律文档">
        <a href="/download">多端下载</a>
        <a href="/offline-map">离线地图</a>
        <a href="/privacy">隐私说明</a>
        <a href="/terms">使用规则</a>
        <a href="/report">举报与帮助</a>
        <a href="/sources">数据来源</a>
        <a href="/release">发布状态</a>
      </nav>
    </main>
  );
}
