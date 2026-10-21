import { hasCurrentOfficialReview, type HikingRoute } from "@/data/routes";

export type SourceReadiness = "可本地展示" | "待官方核验" | "待授权";

export type SourceRecord = {
  label: string;
  url: string;
  readiness: SourceReadiness;
  checkedAt: string;
  note: string;
};

export const OFFICIAL_SOURCE_REGISTRY = {
  openingStatus: {
    label: "属地景区/政府开放公告",
    url: "https://public.dengfeng.gov.cn/D49Y/6807572.jhtml",
    readiness: "待官方核验" as SourceReadiness,
    checkedAt: "未建立自动抓取",
    note: "静态公告不能直接代表今天可进入；发布前必须人工复核最新公告、预约和限流规则。",
  },
  weather: {
    label: "MET Norway 全球天气预报",
    url: "https://api.met.no/doc/TermsOfService",
    readiness: "可本地展示" as SourceReadiness,
    checkedAt: "2026-10-19 · 官方API、许可与全球模型文档复核",
    note: "Locationforecast 2.0 全球开放预报，数据按 CC BY 4.0/NLOD 2.0 署名；当前代理不配置 API 密钥。北欧/北极以外约9公里分辨率，复杂地形风速较粗；需规范 User-Agent、HTTPS、坐标精度与缓存；无 SLA。来源已核验，线上代理仍待统一验收。",
  },
  route: {
    label: "景区/属地官方路线资料",
    url: "https://www.dengfeng.gov.cn/tzgg/9168329.jhtml",
    readiness: "待官方核验" as SourceReadiness,
    checkedAt: "2026-08-18 · 仅资料复核",
    note: "路线长度、爬升和轨迹必须逐条确认；认知示意不得当作导航轨迹。",
  },
  image: {
    label: "原创示意封面",
    url: "https://github.com/hiking-earth/clients/blob/codex/mobile-privacy-controls/scripts/create-original-cover.py",
    readiness: "可本地展示" as SourceReadiness,
    checkedAt: "2026-10-05 · 原创几何绘制",
    note: "展示封面为本项目原创示意，不是路线实景。历史演示照片不再展示；官方图片与讲解仅链接原页面。",
  },
} satisfies Record<string, SourceRecord>;

export const RELEASE_SOURCE_REGISTRY: SourceRecord[] = [
  OFFICIAL_SOURCE_REGISTRY.openingStatus,
  OFFICIAL_SOURCE_REGISTRY.weather,
  OFFICIAL_SOURCE_REGISTRY.route,
  OFFICIAL_SOURCE_REGISTRY.image,
  {
    label: "OpenFreeMap / OpenMapTiles / OpenStreetMap",
    url: "https://openfreemap.org/",
    readiness: "可本地展示",
    checkedAt: "2026-08-24 · 官方条款核验",
    note: "允许商业使用，必须显示 OpenFreeMap、OpenMapTiles 和 OpenStreetMap 数据署名；服务不提供 SLA。",
  },
  {
    label: "Mapzen Terrain Tiles on AWS",
    url: "https://registry.opendata.aws/terrain-tiles/",
    readiness: "可本地展示",
    checkedAt: "2026-08-24 · AWS Open Data Registry 核验",
    note: "当前只使用本地低缩放回退瓦片，页面保留 Mapzen 与 AWS Open Data 来源说明。",
  },
  {
    label: "NASA Earthdata GIBS / MODIS Terra 季节影像",
    url: "https://www.earthdata.nasa.gov/data/tools/gibs",
    readiness: "可本地展示",
    checkedAt: "2026-10-19 · 官方 WMTS 时间范围核验",
    note: "春夏秋冬按当前 UTC 日期选择近年北半球代表日真实色 MODIS Terra 影像，并预留 3 天处理缓冲；仅用于季相观察，不代表实时地表或路线开放状态，页面保留 NASA Earth Observatory / GIBS 署名。",
  },
];

export function getRouteSourceRecords(route: HikingRoute): SourceRecord[] {
  const routeSource: SourceRecord = route.archive.source.url
    ? {
        label: route.archive.source.label,
        url: route.archive.source.url,
        readiness: route.archive.checkedAt.includes("未核验") ? "待官方核验" : "可本地展示",
        checkedAt: route.archive.checkedAt,
        note: route.archive.riskNotice,
      }
    : OFFICIAL_SOURCE_REGISTRY.route;

  const openingStatus: SourceRecord = hasCurrentOfficialReview(route)
    ? {
        ...OFFICIAL_SOURCE_REGISTRY.openingStatus,
        url: route.archive.source.url || OFFICIAL_SOURCE_REGISTRY.openingStatus.url,
        readiness: "可本地展示",
        checkedAt: route.archive.checkedAt,
        note: route.archive.riskNotice,
      }
    : { ...OFFICIAL_SOURCE_REGISTRY.openingStatus, readiness: "待官方核验" };

  return [
    routeSource,
    openingStatus,
    OFFICIAL_SOURCE_REGISTRY.weather,
    { ...OFFICIAL_SOURCE_REGISTRY.image, note: `${route.imageCredit}；${OFFICIAL_SOURCE_REGISTRY.image.note}` },
  ];
}

export function isPublishReady(route: HikingRoute) {
  return getRouteSourceRecords(route).every((source) => source.readiness === "可本地展示");
}
