import type { HikingRoute } from './routes';
import { weatherGearAdvice, type RouteWeatherValues } from './weather-gear-advice';

export type GearMode = '轻装' | '中度' | '重装';
export type GearAdvice = { items: string[]; notices: string[] };

/** Shared conservative packing rules for the web, desktop, phone and mini-program. */
export function buildGearAdvice(route: HikingRoute, mode: GearMode, departureDate: string, weather?: RouteWeatherValues) : GearAdvice {
  const parsedMonth = departureDate ? Number(departureDate.split('-')[1]) : NaN;
  const month = Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : null;
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const forecastAppliesToSelectedDate = Boolean(departureDate) && departureDate === localToday;
  const routeText = `${route.name}${route.region}${route.difficulty}${route.summary}${route.archive.riskNotice}${route.scenery.join('')}`;
  const latitude = Number.isFinite(route.center?.[1]) ? route.center[1] : null;
  const isNorthernTemperateOrPolar = latitude !== null && latitude >= 23.5;
  const isSouthernTemperateOrPolar = latitude !== null && latitude <= -23.5;
  const isColdSeason = month !== null && (
    (isNorthernTemperateOrPolar && (month >= 11 || month <= 3))
    || (isSouthernTemperateOrPolar && month >= 5 && month <= 9)
  );
  const isHighAltitude = /高海拔|雪山|垭口/.test(routeText);
  const isRemoteOrHighRisk = /偏远|穿越|高风险/.test(routeText);
  const needsCamp = route.overnight === '营地' || mode === '重装';
  const items = new Set(['离线地图与充电宝', '头灯与备用电量', '饮水与应急能量食品', '基础急救包', '防晒与个人证件', '轻便防雨层']);

  if (mode === '轻装') ['15–25L 背包', '轻量防风层', '速干层与防滑徒步鞋'].forEach(item => items.add(item));
  if (mode === '中度') ['30–45L 背包', '保暖中层与备用袜', '登山杖', '背包防雨罩'].forEach(item => items.add(item));
  if (mode === '重装') ['50–70L 背包', '承重徒步鞋与双杖', '炉头燃料与净水工具'].forEach(item => items.add(item));
  if (needsCamp) ['适温睡袋', '帐篷与地钉', '隔潮垫', '营地照明'].forEach(item => items.add(item));
  if (isColdSeason || isHighAltitude) ['保暖帽和手套', '保温层', '应急保温毯'].forEach(item => items.add(item));
  const forecastAdvice = weatherGearAdvice(forecastAppliesToSelectedDate ? weather : undefined);
  forecastAdvice.items.forEach(item => items.add(item));

  const notices = ['出发前再次核验开放状态、天气、预约和属地公告。', '把路线、返回时间和紧急联系人留给未同行人员。'];
  if (route.packStyle === '待核验' || route.overnight === '待核验' || route.surface === '待核验') notices.unshift('该路线的装备、住宿或路面资料尚未核验；以下为通用规则清单，不是路线许可或专业建议。');
  if (weather && !forecastAppliesToSelectedDate) {
    notices.push(departureDate
      ? '当前坐标天气预报只供近期参考；所选出发日期不是今天，因此未用于装备调整。临近出发时重新查看天气和属地预警。'
      : '请选择计划出发日期后再查看天气装备建议；当前坐标天气预报只供近期参考，不会自动套用于未指定的日期。');
  }
  if (isHighAltitude) notices.push('安排高海拔适应和撤退点；出现明显不适时停止上升并及时下撤。');
  if (isRemoteOrHighRisk) notices.push('偏远或高风险路段应优先结伴；预留导航冗余、通信方案和返程时间。');
  else if (route.surface === '未铺装') notices.push('该路线标记为未铺装；请出发前核对现场路况，并选择合适的鞋袜和防滑装备。');
  if (/四川|云南|新疆|西藏|森林/.test(routeText)) notices.push('野生动物活动信息须向保护区核实；食物密封、保持距离，防熊喷雾等用品需遵守运输与属地规定。');
  notices.push(...forecastAdvice.notices);
  if (route.status !== '开放中') notices.unshift(`当前路线状态为“${route.status}”，本清单不代表允许进入或可以成行。`);

  return { items: [...items], notices };
}
