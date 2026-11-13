/**
 * 导航核心算法（客户端自有，跨端纯函数，可单测）
 * 精准箭头：箭头角度 = 目标方位角 bearing − 设备航向 heading，低通滤波防抖。
 * 坐标：输入均为 WGS84；户外短距离（<50km）用球面近似足够。
 */

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** 两点大圆距离（米，haversine） */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/** a 指向 b 的方位角（度，0=正北，顺时针 0~360） */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** 角度归一化到 0~360 */
export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 两个角度的最短差值（-180~180，用于平滑插值，避免 359°→1° 跳变） */
export function shortestAngleDiff(from: number, to: number): number {
  let diff = norm360(to) - norm360(from);
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

/**
 * 罗盘低通滤波器：对航向做指数平滑，处理 0/360 跨界。
 * alpha 越小越平滑（建议 0.15~0.3）。
 */
export class HeadingFilter {
  private value: number | null = null;
  private alpha: number;
  constructor(alpha = 0.2) {
    this.alpha = alpha;
  }
  push(heading: number): number {
    const h = norm360(heading);
    if (this.value === null) {
      this.value = h;
    } else {
      this.value = norm360(this.value + shortestAngleDiff(this.value, h) * this.alpha);
    }
    return this.value;
  }
  get current(): number | null {
    return this.value;
  }
  reset(): void {
    this.value = null;
  }
}

/**
 * 箭头角度：目标方位角 − 设备航向。
 * 返回 0 表示目标在手机正前方；正值向右偏。
 */
export function arrowDeg(targetBearing: number, deviceHeading: number): number {
  return norm360(targetBearing - deviceHeading);
}

/**
 * 轨迹上的当前目标点（前视法）：
 * - 找轨迹上距用户最近的点 n
 * - 用户已进入 n 的到达阈值 → 判定"到达路径点 n"（用于震动提示），目标前视到 n+1
 * - 否则目标前视为 n+1（保持在轨迹前进方向上，不回指）
 * - n 已是终点且在阈值内 → finished
 */
export function nextWaypoint(
  user: LatLng,
  path: LatLng[],
  arriveThresholdM = 15,
): { index: number; point: LatLng; distanceM: number; arrived: boolean; finished: boolean } {
  if (path.length === 0) {
    return { index: -1, point: user, distanceM: 0, arrived: false, finished: true };
  }
  let nearest = 0;
  let nearestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversineM(user, path[i]);
    if (d < nearestD) {
      nearestD = d;
      nearest = i;
    }
  }
  const last = path.length - 1;
  const arrivedAtNearest = nearestD <= arriveThresholdM;
  if (nearest === last && arrivedAtNearest) {
    return { index: last, point: path[last], distanceM: nearestD, arrived: true, finished: true };
  }
  const targetIdx = Math.min(nearest + 1, last);
  const target = path[targetIdx];
  return {
    index: targetIdx,
    point: target,
    distanceM: haversineM(user, target),
    arrived: arrivedAtNearest,
    finished: false,
  };
}

/** 偏航检测：用户到轨迹折线的最短距离是否超阈值（米） */
export function offRouteDistanceM(user: LatLng, path: LatLng[]): number {
  if (path.length < 2) return path.length === 1 ? haversineM(user, path[0]) : Infinity;
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    min = Math.min(min, pointToSegmentM(user, path[i], path[i + 1]));
  }
  return min;
}

/** 点到线段最短距离（米，局部投影近似，户外尺度够用） */
export function pointToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  // 以 p 为原点的局部平面（米）
  const latRef = toRad(p.latitude);
  const kx = EARTH_RADIUS_M * Math.cos(latRef) * (Math.PI / 180);
  const ky = EARTH_RADIUS_M * (Math.PI / 180);
  const ax = (a.longitude - p.longitude) * kx;
  const ay = (a.latitude - p.latitude) * ky;
  const bx = (b.longitude - p.longitude) * kx;
  const by = (b.latitude - p.latitude) * ky;
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(ax, ay);
  let t = -(ax * abx + ay * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(cx, cy);
}

/** 格式化距离显示（导航大字） */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
