import type { HikingRoute } from "@/data/routes";

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
    label: "中国气象局 SmartWeatherAPI",
    url: "https://www.weather.com.cn/wzfw/smart/weatherapi.shtml",
    readiness: "待官方核验" as SourceReadiness,
    checkedAt: "未配置接口凭据",
    note: "接口需要申请并配置凭据；未配置时只显示官方入口，不显示伪造的实时天气。",
  },
  route: {
    label: "景区/属地官方路线资料",
    url: "https://www.dengfeng.gov.cn/tzgg/9168329.jhtml",
    readiness: "待官方核验" as SourceReadiness,
    checkedAt: "2026-08-18 · 仅资料复核",
    note: "路线长度、爬升和轨迹必须逐条确认；认知示意不得当作导航轨迹。",
  },
  image: {
    label: "图片权利记录",
    url: "https://unsplash.com/license",
    readiness: "待授权" as SourceReadiness,
    checkedAt: "2026-08-24 · 已核验平台许可，未完成逐图台账",
    note: "Unsplash 许可允许广泛使用，但当前路线图片缺逐张作者、原始页面和许可快照记录；正式发布前必须补齐或替换为自有素材。",
  },
} satisfies Record<string, SourceRecord>;

export const RELEASE_SOURCE_REGISTRY: SourceRecord[] = [
  OFFICIAL_SOURCE_REGISTRY.openingStatus,
  OFFICIAL_SOURCE_REGISTRY.weather,
  OFFICIAL_SOURCE_REGISTRY.route,
  OFFICIAL_SOURCE_REGISTRY.image,
  {
    label: "Esri World Imagery 卫星底图",
    url: "https://developers.arcgis.com/documentation/mapping-and-location-services/mapping/basemaps/introduction-static-basemap-tiles-service/",
    readiness: "待官方核验",
    checkedAt: "2026-08-24 · 已核验署名要求",
    note: "当前已显示 Esri 和数据提供方署名；正式上线前仍需确认生产账号、授权方式、配额和计费模型。",
  },
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
    checkedAt: "2026-08-24 · 官方服务与四个代表日瓦片已核验",
    note: "春夏秋冬使用 2025 年北半球代表日真实色 MODIS Terra 影像；仅用于季相观察，不代表实时地表或路线开放状态，页面保留 NASA Earth Observatory / GIBS 署名。",
  },
];

export function getRouteSourceRecords(route: HikingRoute): SourceRecord[] {
  const routeSource = route.archive.source.url
    ? {
        label: route.archive.source.label,
        url: route.archive.source.url,
        readiness: route.archive.checkedAt.includes("未核验") ? "待官方核验" : "可本地展示",
        checkedAt: route.archive.checkedAt,
        note: route.archive.riskNotice,
      }
    : OFFICIAL_SOURCE_REGISTRY.route;

  return [
    routeSource,
    { ...OFFICIAL_SOURCE_REGISTRY.openingStatus, readiness: route.status === "待核验" ? "待官方核验" : "可本地展示" },
    OFFICIAL_SOURCE_REGISTRY.weather,
    { ...OFFICIAL_SOURCE_REGISTRY.image, note: `${route.imageCredit}；${OFFICIAL_SOURCE_REGISTRY.image.note}` },
  ];
}

export function isPublishReady(route: HikingRoute) {
  return getRouteSourceRecords(route).every((source) => source.readiness === "可本地展示");
}
