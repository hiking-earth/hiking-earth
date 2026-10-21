"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext's Next Link client navigation throws in the current runtime; use full-page navigation for these links. */
import { useEffect, useState } from "react";
import { Download, Globe2, Laptop, Smartphone } from "lucide-react";

type Artifact = { url: string; sha256: string; size: number };
type DesktopPlatform = "windows" | "macos-aarch64" | "macos-x86_64" | "linux";
type ReleaseManifest = {
  schemaVersion: 1;
  ready: boolean;
  version: string;
  publishedAt: string | null;
  android: Artifact | null;
  desktop: {
    version: string;
    platforms: Partial<Record<DesktopPlatform, Artifact>>;
  } | null;
};

const DESKTOP_PLATFORMS: Array<{ id: DesktopPlatform; label: string; detail: string }> = [
  { id: "windows", label: "Windows", detail: "64 位安装包" },
  { id: "macos-aarch64", label: "macOS Apple 芯片", detail: "M 系列 Mac" },
  { id: "macos-x86_64", label: "macOS Intel", detail: "Intel Mac" },
  { id: "linux", label: "Linux", detail: "AppImage" },
];

function isArtifact(value: unknown, maxBytes: number): value is Artifact {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Artifact>;
  return typeof item.url === "string"
    && /^https:\/\/github\.com\/hiking-earth\/clients\/releases\/download\/[^/]+\/[^?#]+$/.test(item.url)
    && typeof item.sha256 === "string" && /^[a-f0-9]{64}$/.test(item.sha256)
    && Number.isSafeInteger(item.size) && (item.size ?? 0) > 0 && (item.size ?? 0) <= maxBytes;
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? (bytes / (1024 * 1024)).toFixed(1) + " MB"
    : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

function DownloadAction({ artifact }: { artifact: Artifact | null }) {
  if (!artifact) return <span className="download-unavailable">正式版本准备中</span>;
  return <a className="download-action" href={artifact.url} rel="noreferrer">
    <Download size={15} /> 下载 · {formatSize(artifact.size)}
  </a>;
}

export function DownloadCenter() {
  const [release, setRelease] = useState<ReleaseManifest | null>(null);
  const [manifestState, setManifestState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/downloads/stable.json", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("release manifest unavailable");
        return response.json() as Promise<ReleaseManifest>;
      })
      .then((value) => {
        if (value?.schemaVersion !== 1 || typeof value.ready !== "boolean"
          || typeof value.version !== "string" || !value.version) throw new Error("invalid release manifest");
        setRelease(value);
        setManifestState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setManifestState("unavailable");
      });
    return () => controller.abort();
  }, []);

  const readyManifest = release?.ready === true ? release : null;
  const androidCandidate = readyManifest?.android ?? null;
  const android = isArtifact(androidCandidate, 500 * 1024 * 1024) ? androidCandidate : null;
  const desktopManifest = readyManifest && readyManifest.desktop?.version === readyManifest.version
    ? readyManifest.desktop : null;
  const desktopPlatforms = desktopManifest?.platforms ?? null;
  const status = manifestState === "loading"
    ? "正在读取正式版本清单…"
    : manifestState === "unavailable"
      ? "暂时无法读取版本清单；网页和 PWA 仍可直接使用。"
      : readyManifest
        ? "正式版本 " + readyManifest.version + (readyManifest.publishedAt ? " · " + new Date(readyManifest.publishedAt).toLocaleDateString("zh-CN") : "")
        : "客户端正式版本尚未发布；候选包不会出现在下载按钮中。";

  return <section className="download-center" aria-label="多端下载">
    <div className="download-release-status"><span className="download-status-dot" />{status}</div>

    <div className="download-grid">
      <article className="download-card download-card-primary">
        <div className="download-card-icon"><Globe2 size={20} /></div>
        <div className="download-card-copy">
          <span className="download-platform-label">WEB · PWA</span>
          <h2>网页与渐进式网页应用</h2>
          <p>电脑和手机都可直接打开；支持的浏览器可将徒步地球安装到桌面或主屏幕。</p>
          <a className="download-action" href="/"><Globe2 size={15} />打开网页版</a>
          <small>网页端无需下载安装包，登录后可直接使用路线、轨迹与社区功能。</small>
        </div>
      </article>

      <article className="download-card">
        <div className="download-card-icon"><Smartphone size={20} /></div>
        <div className="download-card-copy">
          <span className="download-platform-label">IOS · IPADOS</span>
          <h2>iPhone 与 iPad</h2>
          <p>目前提供免费的 PWA 安装方式，不需要 App Store 账号或签名安装包。</p>
          <a className="download-action" href="/"><Globe2 size={15} />打开网页并安装</a>
          <small>在 Safari 打开后，点“分享”→“添加到主屏幕”。本项目暂不提供原生 IPA。</small>
        </div>
      </article>

      <article className="download-card">
        <div className="download-card-icon"><Smartphone size={20} /></div>
        <div className="download-card-copy">
          <span className="download-platform-label">ANDROID</span>
          <h2>Android 手机</h2>
          <p>{android ? "正式版本 " + release?.version + " · 发布清单提供 SHA-256 与文件大小，可供下载后核对。" : "仅在正式版本和完整性信息通过发布门禁后提供 APK。"}</p>
          <DownloadAction artifact={android} />
          {android && <small>SHA-256：{android.sha256}</small>}
        </div>
      </article>

      <article className="download-card">
        <div className="download-card-icon"><Laptop size={20} /></div>
        <div className="download-card-copy">
          <span className="download-platform-label">DESKTOP</span>
          <h2>Windows、Mac 与 Linux</h2>
          <p>只展示与正式版本号一致、来自官方 Release 且包含 SHA-256 摘要信息的桌面安装资产。</p>
          <div className="download-platform-list">
            {DESKTOP_PLATFORMS.map((platform) => {
              const candidate = desktopPlatforms?.[platform.id];
              const artifact = isArtifact(candidate, 500 * 1024 * 1024) ? candidate : null;
              return <div className="download-platform-item" key={platform.id}>
                <div className="download-platform-row">
                  <span><b>{platform.label}</b><small>{platform.detail}</small></span>
                  <DownloadAction artifact={artifact} />
                </div>
                {artifact && <small className="download-platform-sha">SHA-256：{artifact.sha256}</small>}
              </div>;
            })}
          </div>
        </div>
      </article>

      <article className="download-card">
        <div className="download-card-icon"><Smartphone size={20} /></div>
        <div className="download-card-copy">
          <span className="download-platform-label">WECHAT MINI PROGRAM</span>
          <h2>微信小程序</h2>
          <p>小程序无需下载独立安装包；正式入口将在微信后台发布并完成真机验收后提供。</p>
          <span className="download-unavailable">小程序正式发布后开放入口</span>
        </div>
      </article>

      <article className="download-card">
        <div className="download-card-icon"><Globe2 size={20} /></div>
        <div className="download-card-copy">
          <span className="download-platform-label">H5 CLIENT</span>
          <h2>移动网页客户端</h2>
          <p>不想安装应用时，可直接使用网页中的完整客户端。</p>
          <a className="download-action" href="/client"><Globe2 size={15} />打开移动网页客户端</a>
        </div>
      </article>
    </div>

    <p className="download-map-link">需要离线地图？<a href="/offline-map">查看地图区域与下载管理器</a>。地图包按地区选择，不会自动塞进应用安装包。</p>
  </section>;
}
