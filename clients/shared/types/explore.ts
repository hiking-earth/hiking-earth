/**
 * 探索图层数据模型 —— 与上游 data/explore.ts @ 3304520 对齐
 */

export type Attraction = {
  id: string;
  name: string;
  region: string;
  center: [number, number];
  category: string;
  summary: string;
  sourceLabel: string;
};

export type OutdoorNewsItem = {
  id: string;
  title: string;
  region: string;
  center: [number, number];
  industry: "开放管理" | "气象安全" | "户外行业";
  importance: "高" | "中" | "低";
  publishedAt: string;
  sourceLabel: string;
  verified: boolean;
};
