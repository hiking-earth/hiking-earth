import type { Metadata } from "next";
import { DocumentShell } from "@/components/DocumentShell";
import { DownloadCenter } from "@/components/DownloadCenter";

export const metadata: Metadata = {
  title: "多端下载 | 徒步地球",
  description: "在网页中查找徒步地球的 Web、iPhone/iPad PWA、Android、Windows、macOS、Linux 和微信小程序入口。",
};

export default function DownloadPage() {
  return (
    <DocumentShell eyebrow="DOWNLOADS" title="选择你的徒步地球" updatedAt="2026-10-20">
      <p>这里集中提供 Web、iPhone/iPad PWA、Android、Windows、macOS、Linux、微信小程序和移动 H5 的使用入口及发布状态。Android 与桌面安装包只会在正式版本、来源和完整性校验信息齐备后开放下载。</p>
      <DownloadCenter />
      <h2>下载与安全说明</h2>
      <ul>
        <li>安装包只从徒步地球官方 GitHub Release 下载，并显示发布清单中的版本与 SHA-256。</li>
        <li>小程序通过微信官方入口使用，不提供独立安装包；审核发布前不会显示为可用。</li>
        <li>iPhone 目前优先使用 Safari 添加到主屏幕的免费 PWA；未签名 IPA 不能直接安装到普通 iPhone。</li>
      </ul>
    </DocumentShell>
  );
}
