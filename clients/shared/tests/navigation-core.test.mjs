/**
 * 导航核心算法单元测试（Node 22 --experimental-strip-types 直跑 TS，无额外依赖）
 * 运行：node --experimental-strip-types shared/tests/navigation-core.test.mjs
 */
import {
  haversineM, bearingDeg, norm360, shortestAngleDiff, HeadingFilter,
  arrowDeg, nextWaypoint, offRouteDistanceM, pointToSegmentM, formatDistance,
} from "../api/navigation-core.ts";
import { trackToGpx } from "../types/track.ts";
import { isNavigable } from "../types/route.ts";
import { ROUTES } from "../data/routes.seed.ts";

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
function near(a, b, tol = 1) { return Math.abs(a - b) <= tol; }

console.log("== haversineM / bearingDeg ==");
{
  const a = { latitude: 34.0, longitude: 113.0 };
  const b = { latitude: 34.0, longitude: 113.001 };
  // 赤道上 0.001° 经度 ≈ 111m，34°N 约 92m
  ok(near(haversineM(a, b), 92.2, 2), "同纬度 0.001° 经度距离≈92m");
  ok(near(bearingDeg(a, b), 90, 0.5), "正东方向方位角=90");
  const c = { latitude: 34.001, longitude: 113.0 };
  ok(near(bearingDeg(a, c), 0, 0.5), "正北方向方位角=0");
  ok(near(bearingDeg(a, a), 0, 360), "同点方位角不崩溃");
}

console.log("== norm360 / shortestAngleDiff ==");
{
  ok(norm360(-10) === 350, "-10° → 350°");
  ok(norm360(370) === 10, "370° → 10°");
  ok(shortestAngleDiff(350, 10) === 20, "350→10 最短差=20（跨 0°）");
  ok(shortestAngleDiff(10, 350) === -20, "10→350 最短差=-20");
}

console.log("== HeadingFilter ==");
{
  const f = new HeadingFilter(0.5);
  f.push(350);
  const v = f.push(10); // 跨界：350 → 10，应向 360/0 方向收敛而非反向绕 340°
  ok(v > 350 || v < 10, `跨界平滑不绕远（got ${v}）`);
  const g = new HeadingFilter(0.2);
  g.push(100);
  const smooth = g.push(100);
  ok(near(smooth, 100, 0.01), "同值输入输出稳定");
}

console.log("== arrowDeg ==");
{
  ok(arrowDeg(90, 90) === 0, "目标正前方箭头=0");
  ok(arrowDeg(120, 90) === 30, "目标右偏 30");
  ok(arrowDeg(90, 120) === 330, "目标左偏 30 → 330");
}

console.log("== nextWaypoint ==");
{
  const path = [
    { latitude: 34.000, longitude: 113.000 },
    { latitude: 34.001, longitude: 113.001 },
    { latitude: 34.002, longitude: 113.002 },
  ];
  // 用户站在起点 → 目标应是第 2 点
  const r1 = nextWaypoint(path[0], path);
  ok(r1.index === 1, "起点处目标=第2点");
  // 用户在第2点 5m 内 → arrived（阈值15m）
  const nearP2 = { latitude: 34.00101, longitude: 113.001 };
  const r2 = nextWaypoint(nearP2, path);
  ok(r2.arrived === true && r2.finished === false, "接近中间点=到达但未完");
  // 用户在终点 5m 内 → finished
  const nearEnd = { latitude: 34.00201, longitude: 113.002 };
  const r3 = nextWaypoint(nearEnd, path);
  ok(r3.finished === true, "接近终点=完成");
}

console.log("== offRouteDistanceM / pointToSegmentM ==");
{
  const path = [
    { latitude: 34.0, longitude: 113.0 },
    { latitude: 34.0, longitude: 113.01 },
  ];
  // 线段中点正北约 111m 处
  const off = { latitude: 34.001, longitude: 113.005 };
  ok(near(offRouteDistanceM(off, path), 111, 5), "偏航距离≈111m");
  const on = { latitude: 34.0, longitude: 113.005 };
  ok(pointToSegmentM(on, path[0], path[1]) < 1, "线上点距离≈0");
}

console.log("== formatDistance ==");
{
  ok(formatDistance(850) === "850 m", "米级显示");
  ok(formatDistance(1500) === "1.5 km", "公里级显示");
}

console.log("== trackToGpx ==");
{
  const gpx = trackToGpx({
    id: "t1", name: "测试 <轨迹>", points: [
      { latitude: 34.0, longitude: 113.0, altitude: 100, timestamp: 1727740800000 },
    ],
    distanceM: 100, ascentM: 10, descentM: 0, startedAt: 1727740800000, state: "finished", synced: false,
  });
  ok(gpx.includes("<trkpt lat=\"34.0000000\" lon=\"113.0000000\">"), "GPX 轨迹点格式");
  ok(gpx.includes("测试 &lt;轨迹&gt;"), "GPX XML 转义");
  ok(gpx.includes("<ele>100.0</ele>"), "GPX 海拔");
}

console.log("== 上游路线数据（种子） ==");
{
  ok(ROUTES.length === 20, `路线数=20（got ${ROUTES.length}）`);
  const aotai = ROUTES.find((r) => r.id === "aotai-warning");
  ok(aotai && !isNavigable(aotai), "鳌太警示档案禁导航");
  const songshan = ROUTES.find((r) => r.id === "songshan");
  ok(songshan && isNavigable(songshan), "嵩山开放线可导航");
  const changchuanbi = ROUTES.find((r) => r.id === "changchuanbi");
  ok(changchuanbi && !isNavigable(changchuanbi), "临时关闭线禁导航");
  ok(ROUTES.every((r) => r.center.length === 2), "全部路线有中心坐标");
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
