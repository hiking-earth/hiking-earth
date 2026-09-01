import Link from "next/link";
import type { ReactNode } from "react";

export function DocumentShell({ eyebrow, title, updatedAt, children }: { eyebrow: string; title: string; updatedAt: string; children: ReactNode }) {
  return (
    <main className="document-page">
      <header className="document-header">
        <Link href="/">← 返回徒步地球</Link>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>更新日期：{updatedAt}</p>
      </header>
      <article className="document-card">{children}</article>
      <nav className="document-nav" aria-label="发布与法律文档">
        <Link href="/privacy">隐私说明</Link>
        <Link href="/terms">使用规则</Link>
        <Link href="/sources">数据来源</Link>
        <Link href="/release">发布状态</Link>
      </nav>
    </main>
  );
}
