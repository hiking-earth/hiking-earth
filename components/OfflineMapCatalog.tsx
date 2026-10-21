"use client";

import { useEffect, useState } from "react";

type OfflineMapPack = {
  name: string;
  label: string;
  url: string;
  bytes: number;
  sha256: string;
  attribution: string;
  license: string;
};

const MANAGER_URL = "/client-app/#/pages/offline/offline";

function isPack(value: unknown): value is OfflineMapPack {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<OfflineMapPack>;
  return typeof row.name === "string" && /^[a-z0-9-]{1,80}\.pmtiles$/.test(row.name)
    && typeof row.label === "string" && row.label.trim().length > 0 && row.label.length <= 80
    && row.url === `static/offline-maps/${row.name}`
    && Number.isSafeInteger(row.bytes) && Number(row.bytes) >= 127 && Number(row.bytes) <= 64 * 1024 * 1024
    && typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256)
    && typeof row.attribution === "string" && row.attribution.length <= 300
    && row.license === "ODbL-1.0 Produced Work";
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function OfflineMapCatalog() {
  const [packs, setPacks] = useState<OfflineMapPack[]>([]);
  const [status, setStatus] = useState("正在读取随网站发布的地图目录…");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/client-app/static/offline-maps/catalog.json", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("当前网站版本没有发布地图目录。");
        const value: unknown = await response.json();
        if (!Array.isArray(value) || value.length === 0 || value.length > 128 || !value.every(isPack)) {
          throw new Error("地图目录格式未通过校验。");
        }
        const names = new Set(value.map((pack) => pack.name));
        const totalBytes = value.reduce((sum, pack) => sum + pack.bytes, 0);
        if (names.size !== value.length || totalBytes > 500_000_000) throw new Error("地图目录重复或超过发布容量上限。");
        setPacks(value);
        setStatus("");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus(error instanceof Error ? error.message : "地图目录暂时无法读取。");
      });
    return () => controller.abort();
  }, []);

  const overview = packs.filter((pack) => pack.name.startsWith("world-overview-"));
  const regional = packs.filter((pack) => !pack.name.startsWith("world-overview-"));
  const totalBytes = packs.reduce((sum, pack) => sum + pack.bytes, 0);

  return (
    <section className="offline-map-catalog" aria-label="已发布离线地图包">
      <div className="offline-map-summary" aria-live="polite">
        <span><b>{packs.length || "—"}</b> 个已发布地图包</span>
        <span>下载体积 {packs.length ? formatBytes(totalBytes) : "读取中"}</span>
      </div>
      {status && <p className="offline-map-status" role="status">{status}</p>}
      {!!overview.length && <div className="offline-map-section">
        <h2>全球概览</h2>
        {overview.map((pack) => <article className="offline-map-pack" key={pack.name}>
          <div><b>{pack.label}</b><small>{formatBytes(pack.bytes)} · {pack.attribution}</small></div>
          <span>缩放级别 0–5 · 概览</span>
        </article>)}
        <p>全球概览用于离线查看大范围地形，不包含全球道路导航、高程和逐条路线轨迹。</p>
      </div>}
      {!!regional.length && <div className="offline-map-section">
        <h2>区域详细地图</h2>
        <div className="offline-map-list">
          {regional.map((pack) => <article className="offline-map-pack" key={pack.name}>
            <div><b>{pack.label}</b><small>{formatBytes(pack.bytes)} · {pack.attribution}</small></div>
            <span>区域包</span>
          </article>)}
        </div>
        <p>覆盖区域和细节因地图包而异；目录不代表路线开放状态。地图数据按 ODbL 许可注明来源。</p>
      </div>}
      <a className="offline-map-open-button" href={MANAGER_URL}>打开网页离线地图管理器 <span aria-hidden="true">→</span></a>
      <p className="offline-map-footnote">管理器可查看覆盖范围、下载到当前设备并管理离线地图。本机可用容量受设备浏览器、系统空间和 192 MiB 客户端缓存上限共同限制；网站本身不会在后台预下载地图。</p>
    </section>
  );
}
