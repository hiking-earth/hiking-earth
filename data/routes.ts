export type RouteStatus = "开放中" | "即将开放" | "临时关闭" | "永久关闭" | "待核验";
export type Season = "春" | "夏" | "秋" | "冬";
export type PackStyle = "轻装" | "重装";
export type OvernightStyle = "营地" | "住宿" | "无过夜";
export type SurfaceStyle = "景区成熟" | "未铺装";
export type TrackMode = "已核验轨迹" | "认知示意" | "不展示轨迹";

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
  bestSeasons: Season[];
  packStyle: PackStyle;
  overnight: OvernightStyle;
  surface: SurfaceStyle;
  trackMode?: TrackMode;
  scenery: string[];
  summary: string;
  image: string;
  imageCredit: string;
  weatherCityId?: string;
  archive: {
    source: { label: string; url?: string };
    checkedAt: string;
    highlights: string[];
    riskNotice: string;
  };
};

export const STATUS_COLORS: Record<RouteStatus, string> = {
  "开放中": "#b8f36b",
  "即将开放": "#65c7ff",
  "临时关闭": "#ff9a62",
  "永久关闭": "#ff7b72",
  "待核验": "#ffd166",
};

const CORE_ROUTES: HikingRoute[] = [
  {
    id: "songshan",
    name: "太室山—峻极峰登山步道",
    region: "河南 · 登封",
    status: "开放中",
    center: [113.057, 34.493],
    path: [[113.043, 34.49], [113.052, 34.499], [113.063, 34.504], [113.071, 34.492]],
    distance: "11.8 km",
    ascent: "820 m",
    duration: "5–7 小时",
    difficulty: "进阶",
    bestSeason: "春 · 秋",
    bestSeasons: ["春", "秋"],
    packStyle: "轻装",
    overnight: "无过夜",
    surface: "景区成熟",
    scenery: ["山岳", "古建", "秋色"],
    summary: "从太室山景区入口方向前往峻极峰的官方游览步道样本。页面只保存可追溯资料，不替代当天景区公告。",
    image: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    weatherCityId: "101180101",
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
    status: "待核验",
    center: [114.163, 27.46],
    path: [[114.151, 27.445], [114.16, 27.453], [114.171, 27.462], [114.18, 27.474]],
    distance: "18.6 km（演示测绘）",
    ascent: "1,280 m（演示估算）",
    duration: "1–2 天",
    difficulty: "进阶",
    bestSeason: "春末 · 秋初",
    bestSeasons: ["春", "秋"],
    packStyle: "轻装",
    overnight: "营地",
    surface: "景区成熟",
    scenery: ["草甸", "云海", "日出"],
    summary: "以石鼓寺、紫极宫、吊马桩和金顶为主的景区徒步样本；路线节点来自景区指南，轨迹和高度仍待正式测绘。",
    image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    weatherCityId: "101240901",
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
    status: "待核验",
    center: [98.848, 28.313],
    path: [[98.837, 28.302], [98.843, 28.31], [98.852, 28.319], [98.859, 28.326]],
    distance: "约 12 km",
    ascent: "约 760 m",
    duration: "6–8 小时",
    difficulty: "高海拔进阶",
    bestSeason: "夏 · 秋",
    bestSeasons: ["夏", "秋"],
    packStyle: "轻装",
    overnight: "无过夜",
    surface: "未铺装",
    scenery: ["湖泊", "雪山", "花海"],
    summary: "高海拔与预约管理信息变化较快，正式上线前必须以属地公告为准。",
    image: "https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    weatherCityId: "101291301",
    archive: { source: { label: "演示资料，待补充官方来源" }, checkedAt: "未核验", highlights: ["高山湖泊", "雪山", "花海"], riskNotice: "高海拔与预约管理信息变化较快，出行前必须核验。" },
  },
  {
    id: "changchuanbi",
    name: "长穿毕穿越档案",
    region: "四川 · 阿坝",
    status: "临时关闭",
    center: [102.896, 31.014],
    path: [[102.86, 30.99], [102.88, 31.006], [102.905, 31.024], [102.93, 31.04]],
    distance: "约 35 km",
    ascent: "约 1,900 m",
    duration: "3–4 天",
    difficulty: "高风险穿越",
    bestSeason: "窗口期核验",
    bestSeasons: ["夏", "秋"],
    packStyle: "重装",
    overnight: "营地",
    surface: "未铺装",
    scenery: ["雪山", "森林", "垭口"],
    summary: "关闭状态下保留路线认知资料，但禁用导航、下载、推荐与约伴功能。",
    image: "https://images.unsplash.com/photo-1454496522488-7a8e488e8606?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    weatherCityId: "101271901",
    archive: { source: { label: "演示资料，待补充官方来源" }, checkedAt: "未核验", highlights: ["雪山", "森林", "垭口"], riskNotice: "关闭状态下不应将资料当作出行许可或导航依据。" },
  },
  {
    id: "wangmangling",
    name: "南太行 · 王莽岭候选线",
    region: "山西/河南 · 南太行",
    status: "待核验",
    center: [113.57, 35.73],
    path: [[113.548, 35.714], [113.56, 35.723], [113.576, 35.734], [113.59, 35.742]],
    distance: "约 16 km",
    ascent: "约 980 m",
    duration: "7–9 小时",
    difficulty: "进阶",
    bestSeason: "春 · 秋",
    bestSeasons: ["春", "秋"],
    packStyle: "轻装",
    overnight: "无过夜",
    surface: "未铺装",
    scenery: ["峡谷", "绝壁", "云海"],
    summary: "作为南太行路线样本，后续将区分景区步道、合法户外线与禁止穿越区域。",
    image: "https://images.unsplash.com/photo-1464278533981-50106e6176b1?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    weatherCityId: "101100501",
    archive: { source: { label: "演示资料，待补充官方来源" }, checkedAt: "未核验", highlights: ["峡谷", "绝壁", "云海"], riskNotice: "须区分景区步道、合法户外线与禁止穿越区域。" },
  },
];

type CandidateSeed = Pick<HikingRoute, "id" | "name" | "region" | "center" | "distance" | "ascent" | "duration" | "difficulty" | "bestSeason" | "bestSeasons" | "packStyle" | "overnight" | "surface" | "scenery"> & {
  status?: RouteStatus;
  trackMode?: TrackMode;
  summary?: string;
};

const CANDIDATE_IMAGES = [
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1464278533981-50106e6176b1?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1454496522488-7a8e488e8606?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=1200&q=80",
];

function candidateRoute(seed: CandidateSeed, index: number): HikingRoute {
  const [lng, lat] = seed.center;
  const withheld = seed.trackMode === "不展示轨迹";
  return {
    ...seed,
    status: seed.status ?? "待核验",
    trackMode: seed.trackMode ?? "认知示意",
    path: withheld ? [] : [[lng - 0.018, lat - 0.012], [lng, lat], [lng + 0.018, lat + 0.012]],
    summary: seed.summary ?? "首批中国路线认知档案。当前只用于地图发现与产品演示，精确轨迹、开放状态和许可边界须由管理员补充官方来源后才能发布为导航资料。",
    image: CANDIDATE_IMAGES[index % CANDIDATE_IMAGES.length],
    imageCredit: "Unsplash 演示影像",
    archive: {
      source: { label: "候选档案：待管理员补充属地官方来源" },
      checkedAt: "未核验 · 不作为出行依据",
      highlights: seed.scenery,
      riskNotice: withheld
        ? "该路线涉及明确禁止或争议区域，本产品仅保留警示档案，不展示精确轨迹，也不开放导航、下载、推荐和约伴。"
        : "当前为认知级示意点，不是可导航轨迹。出发前须核验属地公告、天气、预约、保护区边界和道路状态。",
    },
  };
}

const CANDIDATE_ROUTES: HikingRoute[] = [
  { id: "wutaishan", name: "五台山朝台路线", region: "山西 · 忻州", center: [113.59, 39.04], distance: "约 50–70 km", ascent: "待核验", duration: "2–4 天", difficulty: "长距离进阶", bestSeason: "夏 · 秋", bestSeasons: ["夏", "秋"], packStyle: "轻装", overnight: "住宿", surface: "景区成熟", scenery: ["古建", "台顶", "日出"] },
  { id: "yubeng", name: "梅里雪山·雨崩徒步", region: "云南 · 迪庆", center: [98.78, 28.39], distance: "约 45–70 km", ascent: "待核验", duration: "4–6 天", difficulty: "高海拔进阶", bestSeason: "春 · 秋", bestSeasons: ["春", "秋"], packStyle: "轻装", overnight: "住宿", surface: "未铺装", scenery: ["雪山", "森林", "冰湖"] },
  { id: "hutiaoxia", name: "虎跳峡高路徒步", region: "云南 · 丽江", center: [100.12, 27.25], distance: "约 22 km", ascent: "待核验", duration: "2 天", difficulty: "进阶", bestSeason: "春 · 秋", bestSeasons: ["春", "秋"], packStyle: "轻装", overnight: "住宿", surface: "未铺装", scenery: ["峡谷", "雪山", "金沙江"] },
  { id: "siguniang", name: "四姑娘山长坪沟", region: "四川 · 阿坝", center: [102.84, 31.08], distance: "约 29 km", ascent: "待核验", duration: "1–2 天", difficulty: "高海拔进阶", bestSeason: "夏 · 秋", bestSeasons: ["夏", "秋"], packStyle: "轻装", overnight: "营地", surface: "未铺装", scenery: ["雪山", "森林", "河谷"] },
  { id: "genie", name: "格聂南线认知档案", region: "四川 · 甘孜", center: [99.62, 29.91], distance: "长距离", ascent: "待核验", duration: "6–9 天", difficulty: "高风险穿越", bestSeason: "夏 · 秋", bestSeasons: ["夏", "秋"], packStyle: "重装", overnight: "营地", surface: "未铺装", scenery: ["雪山", "草原", "海子"] },
  { id: "dangling", name: "党岭徒步认知档案", region: "四川 · 甘孜", center: [101.58, 31.17], distance: "待核验", ascent: "待核验", duration: "2–4 天", difficulty: "高海拔进阶", bestSeason: "秋", bestSeasons: ["秋"], packStyle: "重装", overnight: "营地", surface: "未铺装", scenery: ["彩林", "海子", "雪山"] },
  { id: "haba-heihai", name: "哈巴雪山·黑海路线", region: "云南 · 迪庆", center: [100.13, 27.36], distance: "待核验", ascent: "待核验", duration: "2–3 天", difficulty: "高海拔进阶", bestSeason: "春 · 秋", bestSeasons: ["春", "秋"], packStyle: "重装", overnight: "营地", surface: "未铺装", scenery: ["雪山", "黑海", "森林"] },
  { id: "kanas", name: "喀纳斯东西线认知档案", region: "新疆 · 阿勒泰", center: [87.02, 48.7], distance: "长距离", ascent: "待核验", duration: "4–8 天", difficulty: "高风险穿越", bestSeason: "夏 · 秋", bestSeasons: ["夏", "秋"], packStyle: "重装", overnight: "营地", surface: "未铺装", scenery: ["森林", "湖泊", "秋色"] },
  { id: "wusun", name: "乌孙古道认知档案", region: "新疆 · 伊犁", center: [81.16, 42.12], distance: "约 120 km", ascent: "待核验", duration: "6–8 天", difficulty: "高风险穿越", bestSeason: "夏", bestSeasons: ["夏"], packStyle: "重装", overnight: "营地", surface: "未铺装", scenery: ["草原", "天堂湖", "河谷"] },
  { id: "taibaishan", name: "太白山景区登山线", region: "陕西 · 宝鸡", center: [107.77, 33.95], distance: "待核验", ascent: "待核验", duration: "1–3 天", difficulty: "高海拔进阶", bestSeason: "夏 · 秋", bestSeasons: ["夏", "秋"], packStyle: "轻装", overnight: "住宿", surface: "景区成熟", scenery: ["高山湖", "云海", "冰川遗迹"] },
  { id: "aotai-warning", name: "鳌太线警示档案", region: "陕西 · 秦岭", center: [107.55, 33.91], distance: "不展示", ascent: "不展示", duration: "不推荐", difficulty: "禁止穿越警示", bestSeason: "不适用", bestSeasons: [], packStyle: "重装", overnight: "营地", surface: "未铺装", status: "永久关闭", trackMode: "不展示轨迹", scenery: ["法规警示", "极端天气", "救援困难"] },
  { id: "motuo", name: "墨脱徒步认知档案", region: "西藏 · 林芝", center: [94.91, 29.33], distance: "长距离", ascent: "待核验", duration: "4–7 天", difficulty: "高风险穿越", bestSeason: "窗口期核验", bestSeasons: ["春", "秋"], packStyle: "重装", overnight: "住宿", surface: "未铺装", scenery: ["峡谷", "雨林", "雪山"] },
  { id: "everest-east", name: "珠峰东坡认知档案", region: "西藏 · 日喀则", center: [87.04, 27.94], distance: "长距离", ascent: "待核验", duration: "7–10 天", difficulty: "高海拔高风险", bestSeason: "春 · 秋", bestSeasons: ["春", "秋"], packStyle: "重装", overnight: "营地", surface: "未铺装", scenery: ["雪峰", "冰川", "高山湖"] },
  { id: "fuliushan", name: "伏牛山徒步候选线", region: "河南 · 洛阳/南阳", center: [111.73, 33.72], distance: "待核验", ascent: "待核验", duration: "1–2 天", difficulty: "进阶", bestSeason: "春 · 秋", bestSeasons: ["春", "秋"], packStyle: "轻装", overnight: "住宿", surface: "未铺装", scenery: ["森林", "花岗岩", "秋色"] },
  { id: "qinglongshan", name: "古荥·青龙山徒步候选线", region: "河南 · 郑州", center: [113.48, 34.91], distance: "待核验", ascent: "待核验", duration: "半日–1 天", difficulty: "入门", bestSeason: "春 · 秋", bestSeasons: ["春", "秋"], packStyle: "轻装", overnight: "无过夜", surface: "未铺装", scenery: ["丘陵", "古道", "近郊"] },
].map(candidateRoute);

export const ROUTES: HikingRoute[] = [...CORE_ROUTES, ...CANDIDATE_ROUTES];
