export type Attraction = {
  id: string;
  name: string;
  region: string;
  center: [number, number];
  category: string;
  summary: string;
  sourceLabel: string;
  sourceUrl: string;
  checkedAt: string;
};

export const ATTRACTIONS: Attraction[] = [
  { id: "shaolin", name: "少林寺", region: "河南 · 登封", center: [112.935, 34.507], category: "世界遗产/古建", summary: "嵩山区域著名人文景点，可与官方开放游览线路组合规划。", sourceUrl:"https://www.shaolin.org.cn/", checkedAt:"2026-10-05", sourceLabel: "少林寺官方网站，仅提供原文链接" },
  { id: "longmen", name: "龙门石窟", region: "河南 · 洛阳", center: [112.477, 34.556], category: "世界遗产/博物馆", summary: "官方站点提供景区开放时间、交通指南及票务信息；请通过官方渠道核实当天安排。", sourceUrl:"https://www.lmsk.cn/", checkedAt:"2026-10-05", sourceLabel: "龙门石窟官方网站，仅提供原文链接" },
  { id: "forbidden-city", name: "故宫博物院", region: "北京", center: [116.397, 39.916], category: "博物馆/古建", summary: "官方站点提供开放时间、参观须知及预约入口；本页不复制馆方图片和讲解。", sourceUrl:"https://www.dpm.org.cn/", checkedAt:"2026-10-05", sourceLabel: "故宫博物院官方网站，预约和开放时间以官方为准" },
  { id: "terracotta", name: "秦始皇帝陵博物院", region: "陕西 · 西安", center: [109.273, 34.385], category: "博物馆/遗址", summary: "历史讲解与馆内导览必须优先使用官方授权内容或跳转链接。", sourceUrl:"https://www.bmy.com.cn/index.htm", checkedAt:"2026-10-05", sourceLabel: "秦始皇帝陵博物院官方网站，预约信息以官方为准" },
];
