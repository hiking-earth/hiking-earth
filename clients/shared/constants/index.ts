/**
 * 品牌与端配置常量（客户端自有，品牌资产以网页端仓库为准）
 * 上游：hiking-earth/hiking-earth @ 3304520
 */

export const BRAND = {
  name: "徒步地球",
  nameEn: "Hiking Earth",
  /** 网页端部署地址（Tauri 桌面端直接包裹） */
  webUrlOverseas: "https://hiking-earth.hiking-earth.workers.dev/",
  /** 上游源码仓库 */
  upstreamRepo: "https://github.com/hiking-earth/hiking-earth",
  upstreamCommit: "3304520",
} as const;

/** 腾讯地图相关：key 由各端自行申请并注入，本仓库不含任何可用 key */
export const MAP = {
  provider: "tencent" as const,
  coordSystem: "GCJ-02（渲染前由 WGS84 转换）",
  arriveThresholdM: 15,
  offRouteThresholdM: 30,
} as const;

/** 云开发环境 id（用户提供，2026-10-03） */
export const CLOUD_ENV = "cloud1-d9g4fl3fu2491914f";

/** Public HTTPS service address; contains no account credential. */
export const CLIENT_API_URL = "https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api";
