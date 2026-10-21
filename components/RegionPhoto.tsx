"use client";

import { useState } from "react";
import Image from "next/image";
import scenicImages from "@/data/scenic-images.json";

type ScenicImage = (typeof scenicImages.items)[number];

function safeCommonsUrl(value: string, hosts: string[]): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.includes(url.hostname) && !url.username && !url.password && !url.port
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function photoForRegion(region: string): ScenicImage | undefined {
  return scenicImages.items.find((item) => item.region === region || item.matchRegions?.includes(region));
}

export function RegionPhoto({ region }: { region: string }) {
  const photo = photoForRegion(region);
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!photo) return null;

  const imageUrl = safeCommonsUrl(photo.imageUrl, ["upload.wikimedia.org"]);
  const sourceUrl = safeCommonsUrl(photo.sourceUrl, ["commons.wikimedia.org"]);
  const licenseUrl = safeCommonsUrl(photo.licenseUrl, ["creativecommons.org"]);
  if (!imageUrl || !sourceUrl || !licenseUrl) return null;

  return (
    <section className="region-photo" aria-label="地区历史实景">
      {!shown ? (
        <button type="button" onClick={() => setShown(true)}>查看地区实景（从 Wikimedia 加载）</button>
      ) : (
        <>
          <p>点击后会向 Wikimedia Commons 请求图片；该图片只代表拍摄地区，不代表这条路线的实际路况、开放状态或当前景观。</p>
          {!failed ? <Image src={imageUrl} alt={photo.title} width={1200} height={720} sizes="(max-width: 560px) 100vw, 500px" unoptimized loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <p role="status">图片加载失败，可查看原始来源。</p>}
          {failed && <button type="button" onClick={() => setFailed(false)}>重试加载图片</button>}
          <button type="button" onClick={() => { setShown(false); setFailed(false); }}>收起图片</button>
          <strong>{photo.title}</strong>
          <span>{photo.author} · {photo.license}</span>
          <small>{photo.changes}</small>
          <div className="region-photo-links">
            <a href={sourceUrl} target="_blank" rel="noreferrer">图片来源与作者</a>
            <a href={licenseUrl} target="_blank" rel="noreferrer">查看图片许可</a>
          </div>
        </>
      )}
    </section>
  );
}
