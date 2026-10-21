import type { Metadata } from "next";
import { DocumentShell } from "@/components/DocumentShell";
import { OfflineMapCatalog } from "@/components/OfflineMapCatalog";

export const metadata: Metadata = {
  title: "离线地图 | 徒步地球",
  description: "查看徒步地球已发布的全球概览和区域离线地图，并在当前设备管理下载。",
};

export default function OfflineMapPage() {
  return (
    <DocumentShell eyebrow="OFFLINE MAPS" title="把地图带到路上" updatedAt="2026-10-17">
      <p>先选需要的地区，再下载到当前设备。地图目录与网页随包发布的客户端共用；打开管理器后，可按覆盖范围选择地图并查看本机占用。</p>
      <OfflineMapCatalog />
      <h2>使用边界</h2>
      <ul>
        <li>全球包是低缩放级别概览，不提供全球详细道路导航或高程。</li>
        <li>区域地图的许可和署名随包显示；地图收录不等于路线当前开放或允许通行。</li>
        <li>下载前请在 Wi‑Fi 下确认设备空间。部分浏览器会在清理站点数据时删除本机离线内容。</li>
      </ul>
    </DocumentShell>
  );
}
