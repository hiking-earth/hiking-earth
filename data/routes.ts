export type RouteStatus = "开放中" | "即将开放" | "临时关闭" | "永久关闭" | "待核验";
export type Season = "春" | "夏" | "秋" | "冬";
export type PackStyle = "轻装" | "重装" | "待核验";
export type OvernightStyle = "营地" | "住宿" | "无过夜" | "待核验";
export type SurfaceStyle = "景区成熟" | "未铺装" | "待核验";
export type TrackMode = "已核验轨迹" | "认知示意" | "不展示轨迹";

export type HikingRoute = {
  id: string;
  name: string;
  region: string;
  status: RouteStatus;
  openingExpiresAt?: number;
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
    name: "太室山景区入口—峻极峰登山步道",
    region: "河南 · 登封",
    status: "待核验",
    openingExpiresAt: 0,
    center: [113.057, 34.493],
    path: [],
    distance: "待核验",
    ascent: "待核验",
    duration: "待核验",
    difficulty: "待核验",
    bestSeason: "待核验",
    bestSeasons: [],
    packStyle: "待核验",
    overnight: "待核验",
    surface: "待核验",
    scenery: ["山岳", "古建", "秋色"],
    trackMode: "不展示轨迹",
    summary: "嵩山管委会2025-03-21将太室山景区入口—峻极峰列为开放游览线路之一；精确轨迹、里程、爬升及当天开放状态尚未核验。",
    image: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    weatherCityId: "101180101",
    archive: {
      source: { label: "嵩山管委会《平安健康游嵩山》提示（2025-03-21）", url: "https://www.dengfeng.gov.cn/tzgg/9168329.jhtml" },
      checkedAt: "官方安全提示发布日期：2025-03-21；当天开放状态待核验",
      highlights: ["官方资料列为开放游览线路：太室山景区入口—峻极峰登山步道"],
      riskNotice: "仅按景区当天开放的正式游览线路活动；官方资料警示非游览线路未经批准不得擅入。地图点为区域认知，不是入口或轨迹；当前不提供导航。",
    },
  },
  {
    id: "wugongshan",
    name: "石鼓寺—金顶景区体验线",
    region: "江西 · 萍乡",
    status: "待核验",
    center: [114.163, 27.46],
    path: [],
    distance: "待核验",
    ascent: "待核验",
    duration: "待核验",
    difficulty: "待核验",
    bestSeason: "待核验",
    bestSeasons: [],
    packStyle: "待核验",
    overnight: "待核验",
    surface: "待核验",
    scenery: ["草甸", "云海", "日出"],
    trackMode: "不展示轨迹",
    summary: "武功山景区2017指南列出石鼓寺、紫极宫、吊马桩、金顶等体验线路节点；该旧指南含索道与多分支，当前步道、轨迹和开放状态均须核验。",
    image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    weatherCityId: "101240901",
    archive: {
      source: { label: "萍乡武功山景区《户外体验一日游》指南", url: "https://www.wugongshan.cn/page/strategyList%21info.htm?id=104" },
      checkedAt: "景区路线指南发布日期：2017-06-25；路径与开放信息较旧",
      highlights: ["官方指南列出的沿途节点：石鼓寺、紫极宫、吊马桩、金顶古祭坛群及环形栈道"],
      riskNotice: "来源指南含索道及多个步道分支，不能据其拼接为可导航轨迹。地图点为区域认知，不是入口；出行前核验景区公告、索道和步道运营状态。",
    },
  },
  {
    id: "nanji-luo",
    name: "南极洛高山湖群",
    region: "云南 · 迪庆",
    status: "待核验",
    center: [98.848, 28.313],
    openingExpiresAt: 0,
    path: [],
    distance: "待核验",
    ascent: "待核验",
    duration: "待核验",
    difficulty: "待核验",
    bestSeason: "待核验",
    bestSeasons: [],
    packStyle: "待核验",
    overnight: "待核验",
    surface: "待核验",
    scenery: ["湖泊", "雪山", "花海"],
    trackMode: "不展示轨迹",
    summary: "德钦县2026年4月通告将南极洛列为未开发、未设旅游服务和安全保障设施区域，禁止开展旅游、探险活动。当前仅保留区域认知点，不提供路线和前往指引。",
    image: "https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    weatherCityId: "101291301",
    archive: { source: { label: "德钦县人民政府：禁止在未开发区域开展旅游、探险活动", url: "https://deqin.gov.cn/zfxxgk_deqin/fdzdgknr/tzgg/202604/20260410_239871.html" }, checkedAt: "官方通告发布日期：2026-04-10；路线和开放状态仍待核验", highlights: ["官方通告点名南极洛属于未开发区域"], riskNotice: "官方通告禁止进入未开发且未设旅游服务和安全保障设施的区域开展旅游、探险。地图中心点仅作区域认知，不是入口；不要据此规划或前往。" },
  },
  {
    id: "changchuanbi",
    name: "长穿毕穿越档案",
    region: "四川 · 阿坝",
    status: "待核验",
    center: [102.896, 31.014],
    openingExpiresAt: 0,
    path: [],
    distance: "待核验",
    ascent: "待核验",
    duration: "待核验",
    difficulty: "待核验",
    bestSeason: "待核验",
    bestSeasons: [],
    packStyle: "待核验",
    overnight: "待核验",
    surface: "待核验",
    scenery: ["雪山", "森林", "垭口"],
    trackMode: "不展示轨迹",
    summary: "保留路线名称作为待核验发现线索；当前没有可追溯的官方通行状态、里程、爬升或许可轨迹来源。",
    image: "https://images.unsplash.com/photo-1454496522488-7a8e488e8606?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    weatherCityId: "101271901",
    archive: { source: { label: "尚无可追溯的官方路线及通行来源" }, checkedAt: "未核验", highlights: [], riskNotice: "地图点仅为区域定位占位，不是路线起终点；不得将该发现线索当作路线许可或导航依据。出行前须向景区/属地管理部门核实路线合法性、开放状态和安全条件。" },
  },
  {
    id: "wangmangling",
    name: "南太行 · 王莽岭候选线",
    region: "山西 · 晋城 · 陵川",
    status: "待核验",
    center: [113.57, 35.73],
    openingExpiresAt: 0,
    path: [],
    distance: "待核验",
    ascent: "待核验",
    duration: "待核验",
    difficulty: "待核验",
    bestSeason: "待核验",
    bestSeasons: [],
    packStyle: "待核验",
    overnight: "待核验",
    surface: "待核验",
    scenery: ["峡谷", "绝壁", "云海"],
    trackMode: "不展示轨迹",
    summary: "晋城市政府资料确认王莽岭景区位于陵川县古郊乡；此处仅保留景区区域认知点，具体徒步路线、里程和当天开放信息尚未核验。",
    image: "https://images.unsplash.com/photo-1464278533981-50106e6176b1?auto=format&fit=crop&w=1200&q=82",
    imageCredit: "Unsplash 演示影像",
    weatherCityId: "101100501",
    archive: { source: { label: "晋城市人民政府：王莽岭景区介绍（2022-10-12）", url: "https://www.jcgov.gov.cn/dtxx/jcdt/202210/t20221012_1681147.shtml" }, checkedAt: "区域来源发布日期：2022-10-12；徒步路线与开放状态未核验", highlights: ["官方资料确认王莽岭景区位于陵川县古郊乡"], riskNotice: "中心点仅为景区区域认知，不是入口或步道轨迹；请按景区当天公告和正式开放步道活动，当前资料不提供导航。" },
  },
];

type CandidateSeed = Pick<HikingRoute, "id" | "name" | "region" | "center" | "scenery"> & {
  summary?: string;
  archiveSource?: { label: string; url?: string };
  archiveRisk?: string;
  checkedAt?: string;
};

function candidateRoute(seed: CandidateSeed): HikingRoute {
  return {
    ...seed,
    status: "待核验",
    openingExpiresAt: 0,
    path: [],
    distance: "待核验",
    ascent: "待核验",
    duration: "待核验",
    difficulty: "待核验",
    bestSeason: "待核验",
    bestSeasons: [],
    packStyle: "待核验",
    overnight: "待核验",
    surface: "待核验",
    trackMode: "不展示轨迹",
    summary: seed.summary ?? "区域认知点，不代表已核验徒步路线。里程、难度、季节、装备、住宿、开放状态和许可轨迹均未核实。",
    image: "/static/original-mountain-reference.png",
    imageCredit: "徒步地球原创几何示意 · 非路线实景",
    archive: {
      source: seed.archiveSource ?? { label: "候选档案，尚无可追溯的属地官方路线来源" },
      checkedAt: seed.checkedAt ?? "未核验 · 不作为出行依据",
      highlights: seed.scenery,
      riskNotice: seed.archiveRisk ?? "中心点仅作区域认知，不是步道入口或轨迹；出发前须核验属地公告、开放状态、预约、保护区边界和道路安全。当前档案不提供导航。",
    },
  };
}

const CANDIDATE_SEEDS: CandidateSeed[] = [
  { id: "wutaishan", name: "五台山朝台路线", region: "山西 · 忻州", center: [113.59, 39.04], scenery: ["古建", "台顶", "日出"] },
  { id: "yubeng", name: "梅里雪山·雨崩徒步", region: "云南 · 迪庆", center: [98.78, 28.39], scenery: ["雪山", "森林", "冰湖"] },
  { id: "hutiaoxia", name: "虎跳峡高路徒步", region: "云南 · 丽江", center: [100.12, 27.25], scenery: ["峡谷", "雪山", "金沙江"] },
  { id: "siguniang", name: "四姑娘山长坪沟", region: "四川 · 阿坝", center: [102.84, 31.08], scenery: ["雪山", "森林", "河谷"] },
  { id: "genie", name: "格聂南线认知档案", region: "四川 · 甘孜", center: [99.62, 29.91], scenery: ["雪山", "草原", "海子"] },
  { id: "dangling", name: "党岭徒步认知档案", region: "四川 · 甘孜", center: [101.58, 31.17], scenery: ["彩林", "海子", "雪山"] },
  { id: "haba-heihai", name: "哈巴雪山·黑海路线", region: "云南 · 迪庆", center: [100.13, 27.36], scenery: ["雪山", "黑海", "森林"] },
  { id: "kanas", name: "喀纳斯东西线认知档案", region: "新疆 · 阿勒泰", center: [87.02, 48.7], scenery: ["森林", "湖泊", "秋色"] },
  { id: "wusun", name: "乌孙古道认知档案", region: "新疆 · 伊犁", center: [81.16, 42.12], scenery: ["草原", "天堂湖", "河谷"] },
  { id: "taibaishan", name: "太白山景区登山线", region: "陕西 · 宝鸡", center: [107.77, 33.95], scenery: ["高山湖", "云海", "冰川遗迹"] },
  {
    id: "aotai-warning", name: "鳌太线警示档案", region: "陕西 · 秦岭", center: [107.55, 33.91],
    scenery: ["法规警示", "生态保护", "高风险"],
    summary: "鳌太线核心区域未经批准禁止进入；本记录仅作安全与法规警示，不表示路线开放。",
    archiveSource: { label: "宝鸡市发展和改革委员会：鳌太穿越保护区法律红线说明（2025-11-20）", url: "https://fgw.baoji.gov.cn/zzzb/wndt/202511/t20251120_1227808.html" },
    checkedAt: "官方安全说明发布日期：2025-11-20；具体管理规定出行前仍须核验",
    archiveRisk: "鳌太线核心路线横穿太白山国家级自然保护区核心区，未经批准进入属违法行为；地形、天气和救援风险极高。地图点仅供区域认知，不是入口或起终点；这里不展示轨迹或穿越指引。",
  },
  { id: "motuo", name: "墨脱徒步认知档案", region: "西藏 · 林芝", center: [94.91, 29.33], scenery: ["峡谷", "雨林", "雪山"] },
  { id: "everest-east", name: "珠峰东坡认知档案", region: "西藏 · 日喀则", center: [87.04, 27.94], scenery: ["雪峰", "冰川", "高山湖"] },
  { id: "fuliushan", name: "伏牛山徒步候选线", region: "河南 · 洛阳/南阳", center: [111.73, 33.72], scenery: ["森林", "花岗岩", "秋色"] },
  { id: "qinglongshan", name: "古荥·青龙山徒步候选线", region: "河南 · 郑州", center: [113.48, 34.91], scenery: ["丘陵", "古道", "近郊"] },
];
const CANDIDATE_ROUTES: HikingRoute[] = CANDIDATE_SEEDS.map(candidateRoute);

export const ROUTES: HikingRoute[] = [...CORE_ROUTES, ...CANDIDATE_ROUTES];

// Demo photographs are retained in historical source only, never rendered.
ROUTES.forEach(route=>{if(route.image){route.image="/static/original-mountain-reference.png";route.imageCredit="徒步地球原创几何示意 · 非路线实景";}});
