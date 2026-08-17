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
    source: string;
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
    name: "嵩山经典步道",
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
    summary: "郑州周边优先展示路线。路线、入口与开放状态将在接入官方数据后逐项核验。",
    image: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    archive: {
      source: "演示资料，待补充官方来源",
      checkedAt: "未核验",
      // ===== 这是你的第一个编程练习，直接改下面 4 处文字即可。 =====
      highlights: ["待你填写：这条路线最吸引人的一个亮点", "待你填写：最适合拍照或休息的特点", "待你填写：你认为它值得去的理由"],
      riskNotice: "待你填写：请用一句话说明新手最需要注意的风险或准备。",
    },
  },
  {
    id: "wugongshan",
    name: "武功山高山草甸",
    region: "江西 · 萍乡",
    status: "演示开放",
    center: [114.163, 27.46],
    path: [[114.151, 27.445], [114.16, 27.453], [114.171, 27.462], [114.18, 27.474]],
    distance: "18.6 km",
    ascent: "1,280 m",
    duration: "1–2 天",
    difficulty: "进阶",
    bestSeason: "春末 · 秋初",
    scenery: ["草甸", "云海", "日出"],
    summary: "以高山草甸、云海和日出著称。首版轨迹为交互演示，不用于实际导航。",
    image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    archive: { source: "演示资料，待补充官方来源", checkedAt: "未核验", highlights: ["高山草甸", "云海", "日出"], riskNotice: "请以景区公告、天气预警和自身体能为准。" },
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
    archive: { source: "演示资料，待补充官方来源", checkedAt: "未核验", highlights: ["高山湖泊", "雪山", "花海"], riskNotice: "高海拔与预约管理信息变化较快，出行前必须核验。" },
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
    archive: { source: "演示资料，待补充官方来源", checkedAt: "未核验", highlights: ["雪山", "森林", "垭口"], riskNotice: "关闭状态下不应将资料当作出行许可或导航依据。" },
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
    archive: { source: "演示资料，待补充官方来源", checkedAt: "未核验", highlights: ["峡谷", "绝壁", "云海"], riskNotice: "须区分景区步道、合法户外线与禁止穿越区域。" },
  },
];
