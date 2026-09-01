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

export const ATTRACTIONS: Attraction[] = [
  { id: "shaolin", name: "少林寺", region: "河南 · 登封", center: [112.935, 34.507], category: "世界遗产/古建", summary: "嵩山区域著名人文景点，可与官方开放游览线路组合规划。", sourceLabel: "景点档案示例 · 上线前补充官方导览链接" },
  { id: "longmen", name: "龙门石窟", region: "河南 · 洛阳", center: [112.477, 34.556], category: "世界遗产/博物馆", summary: "国内首批景点内容候选，后续仅接入获得授权或允许嵌入的讲解。", sourceLabel: "景点档案示例 · 不复制受版权保护讲解" },
  { id: "forbidden-city", name: "故宫博物院", region: "北京", center: [116.397, 39.916], category: "博物馆/古建", summary: "景点图层示例，后续可接官方开放数据、预约页和合规导览链接。", sourceLabel: "景点档案示例 · 上线前核验" },
  { id: "terracotta", name: "秦始皇帝陵博物院", region: "陕西 · 西安", center: [109.273, 34.385], category: "博物馆/遗址", summary: "历史讲解与馆内导览必须优先使用官方授权内容或跳转链接。", sourceLabel: "景点档案示例 · 上线前核验" },
];

export const OUTDOOR_NEWS: OutdoorNewsItem[] = [
  { id: "news-framework-1", title: "路线开放状态数据源接入队列", region: "中国", center: [104, 35], industry: "开放管理", importance: "高", publishedAt: "待接入", sourceLabel: "产品演示占位 · 不是实时新闻", verified: false },
  { id: "news-framework-2", title: "强降雨与山洪预警聚合接口", region: "中国西南", center: [102, 29], industry: "气象安全", importance: "高", publishedAt: "待接入", sourceLabel: "产品演示占位 · 不是实时预警", verified: false },
  { id: "news-framework-3", title: "全球户外行业动态筛选框架", region: "全球", center: [10, 15], industry: "户外行业", importance: "中", publishedAt: "待接入", sourceLabel: "产品演示占位 · 不是实时新闻", verified: false },
];
