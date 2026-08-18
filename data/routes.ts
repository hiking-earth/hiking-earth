export type RouteStatus = "演示开放" | "待官方核验" | "季节性关闭";

export type HikingRoute = {
  id: string;
  name: string;
  region: string;
  status: RouteStatus;
  center: [number, number];
  path: [number, number][];
  distance: string;
  ascent: string;
  duration: string;
  difficulty: string;
  bestSeason: string;
  scenery: string[];
  summary: string;
  image: string;
  imageCredit: string;
  archive: {
    source: { label: string; url?: string };
    checkedAt: string;
    highlights: string[];
    riskNotice: string;
  };
};

export const STATUS_COLORS: Record<RouteStatus, string> = {
  "演示开放": "#b8f36b",
  "待官方核验": "#ffd166",
  "季节性关闭": "#ff7b72",
};

export const ROUTES: HikingRoute[] = [
  {
    id: "songshan",
    name: "太室山—峻极峰登山步道",
    region: "河南 · 登封",
    status: "演示开放",
    center: [113.057, 34.493],
    path: [[113.043, 34.49], [113.052, 34.499], [113.063, 34.504], [113.071, 34.492]],
    distance: "11.8 km",
    ascent: "820 m",
    duration: "5–7 小时",
    difficulty: "进阶",
    bestSeason: "春 · 秋",
    scenery: ["山岳", "古建", "秋色"],
    summary: "从太室山景区入口方向前往峻极峰的官方游览步道样本。页面只保存可追溯资料，不替代当天景区公告。",
    image: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    archive: {
      source: { label: "嵩山管委会《平安健康游嵩山》提示（2025-03-21）", url: "https://www.dengfeng.gov.cn/tzgg/9168329.jhtml" },
      checkedAt: "资料复核：2026-08-18 · 出行前仍须复核",
      highlights: ["官方开放游览线路样本", "太室山主峰峻极峰方向", "可与嵩阳书院游览串联"],
      riskNotice: "只走景区开放步道和旅游道路；非游览线风险较高，需按规定批准，陡峭台阶请备防滑鞋和饮水。",
    },
  },
  {
    id: "wugongshan",
    name: "石鼓寺—金顶户外体验线",
    region: "江西 · 萍乡",
    status: "待官方核验",
    center: [114.163, 27.46],
    path: [[114.151, 27.445], [114.16, 27.453], [114.171, 27.462], [114.18, 27.474]],
    distance: "18.6 km（演示测绘）",
    ascent: "1,280 m（演示估算）",
    duration: "1–2 天",
    difficulty: "进阶",
    bestSeason: "春末 · 秋初",
    scenery: ["草甸", "云海", "日出"],
    summary: "以石鼓寺、紫极宫、吊马桩和金顶为主的景区徒步样本；路线节点来自景区指南，轨迹和高度仍待正式测绘。",
    image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    archive: {
      source: { label: "萍乡武功山景区《户外体验一日游》指南", url: "https://www.wugongshan.cn/page/strategyList%21info.htm?id=104" },
      checkedAt: "资料复核：2026-08-18 · 出行前仍须复核",
      highlights: ["石鼓寺至金顶的景区徒步样本", "吊马桩衔接高山草甸景观", "金顶古祭坛群与环形栈道"],
      riskNotice: "景区指南提示一日徒步通常需合理安排时间，体力消耗较大；请备足饮水、干粮并以当天公告和天气为准。",
    },
  },
  {
    id: "nanji-luo",
    name: "南极洛高山湖群",
    region: "云南 · 迪庆",
    status: "待官方核验",
    center: [98.848, 28.313],
    path: [[98.837, 28.302], [98.843, 28.31], [98.852, 28.319], [98.859, 28.326]],
    distance: "约 12 km",
    ascent: "约 760 m",
    duration: "6–8 小时",
    difficulty: "高海拔进阶",
    bestSeason: "夏 · 秋",
    scenery: ["湖泊", "雪山", "花海"],
    summary: "高海拔与预约管理信息变化较快，正式上线前必须以属地公告为准。",
    image: "https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    archive: { source: { label: "演示资料，待补充官方来源" }, checkedAt: "未核验", highlights: ["高山湖泊", "雪山", "花海"], riskNotice: "高海拔与预约管理信息变化较快，出行前必须核验。" },
  },
  {
    id: "changchuanbi",
    name: "长穿毕穿越档案",
    region: "四川 · 阿坝",
    status: "季节性关闭",
    center: [102.896, 31.014],
    path: [[102.86, 30.99], [102.88, 31.006], [102.905, 31.024], [102.93, 31.04]],
    distance: "约 35 km",
    ascent: "约 1,900 m",
    duration: "3–4 天",
    difficulty: "高风险穿越",
    bestSeason: "窗口期核验",
    scenery: ["雪山", "森林", "垭口"],
    summary: "关闭状态下保留路线认知资料，但禁用导航、下载、推荐与约伴功能。",
    image: "https://images.unsplash.com/photo-1454496522488-7a8e488e8606?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    archive: { source: { label: "演示资料，待补充官方来源" }, checkedAt: "未核验", highlights: ["雪山", "森林", "垭口"], riskNotice: "关闭状态下不应将资料当作出行许可或导航依据。" },
  },
  {
    id: "wangmangling",
    name: "南太行 · 王莽岭候选线",
    region: "山西/河南 · 南太行",
    status: "待官方核验",
    center: [113.57, 35.73],
    path: [[113.548, 35.714], [113.56, 35.723], [113.576, 35.734], [113.59, 35.742]],
    distance: "约 16 km",
    ascent: "约 980 m",
    duration: "7–9 小时",
    difficulty: "进阶",
    bestSeason: "春 · 秋",
    scenery: ["峡谷", "绝壁", "云海"],
    summary: "作为南太行路线样本，后续将区分景区步道、合法户外线与禁止穿越区域。",
    image: "https://images.unsplash.com/photo-1464278533981-50106e6176b1?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    archive: { source: { label: "演示资料，待补充官方来源" }, checkedAt: "未核验", highlights: ["峡谷", "绝壁", "云海"], riskNotice: "须区分景区步道、合法户外线与禁止穿越区域。" },
  },
];
