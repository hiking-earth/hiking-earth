<template>
  <view class="page">
    <!-- 顶栏 -->
    <view class="topbar">
      <view class="quit" @click="quit">‹ 退出</view>
      <text class="title">{{ navTitle }}</text>
      <view class="mode" @click="mode = mode === 'arrow' ? 'map' : 'arrow'">
        {{ mode === 'arrow' ? '地图' : '箭头' }}
      </view>
    </view>

    <!-- 箭头模式 -->
    <view v-if="mode === 'arrow'" class="arrow-wrap">
      <!-- 罗盘环 -->
      <view class="ring">
        <view
          v-for="(mark, i) in compassMarks" :key="i"
          class="mark"
          :style="{ transform: `rotate(${mark.deg - heading}deg) translateY(-260rpx)` }"
        >
          <text class="mark-text" :class="{ cardinal: mark.cardinal }">{{ mark.label }}</text>
        </view>
        <!-- 目标箭头：类苹果查找 -->
        <view v-if="hasFix && (!memberMode || memberPos)" class="arrow" :style="{ transform: `rotate(${arrowAngle}deg)` }">
          <view class="arrow-body"></view>
          <view class="arrow-head"></view>
        </view>
        <!-- 中心信息 -->
        <view v-if="hasFix && (!memberMode || memberPos)" class="center">
          <text class="dist">{{ formatDistance(targetDistance) }}</text>
          <text class="bearing">{{ Math.round(targetBearing) }}°</text>
          <text class="wp">{{ memberMode ? `与 ${memberName} 相向而行` : `路径点 ${waypointIndex + 1}/${path.length}` }}</text>
        </view>
      </view>

      <view v-if="offRoute && !memberMode" class="offroute">⚠ 已偏离轨迹 {{ Math.round(offRouteDist) }} m，请回到路线</view>
      <view v-if="finished" class="finished-banner">{{ memberMode ? '🎉 已会合' : '🎉 已到达终点' }}</view>
      <view v-if="!hasFix" class="nofix">正在获取定位…请先在“我的 → 隐私设置”启用导航定位，并按系统提示授权</view>
      <view v-else-if="memberMode && !memberPos" class="nofix">等待队友位置上报…</view>
    </view>

    <!-- 地图模式 -->
    <view v-else class="map-wrap">
      <RouteMap :layers="offlineLayer?.paths || []" :attribution="offlineLayer?.attribution || ''" :points="path" :position="position" :height="400" />
      <view class="map-hud">
        <text>距下一路径点 {{ formatDistance(targetDistance) }}</text>
        <text v-if="offRoute" class="hud-warn">偏航 {{ Math.round(offRouteDist) }} m</text>
      </view>
    </view>

    <!-- 底部数据条 -->
    <view class="hud">
      <view class="hud-cell"><text class="hud-v">{{ formatDistance(remainM) }}</text><text class="hud-k">剩余</text></view>
      <view class="hud-cell"><text class="hud-v">{{ formatDistance(walkedM) }}</text><text class="hud-k">已走</text></view>
      <view class="hud-cell"><text class="hud-v">{{ elapsedText }}</text><text class="hud-k">用时</text></view>
      <view class="hud-cell sos" @click="triggerSos"><text class="hud-v sos-v">SOS</text><text class="hud-k">一键求救</text></view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { HE_PALETTE } from '@shared/design/palette';
import { activeOfflineLayer,restoreOfflineLayers } from '@/services/offline';

import RouteMap from '@/components/RouteMap.vue';
import { toMapPoint } from "@shared/api/coordinates";
import { isNavigable } from "@shared/types/route";
import { computed, onUnmounted, ref } from "vue";
import { onLoad,onShow } from "@dcloudio/uni-app";
const offlineLayer = computed(()=>activeOfflineLayer());
onShow(()=>{void restoreOfflineLayers();});
import { ROUTES } from "@/services/route-catalog";
import type { LatLng } from "@shared/api/navigation-core";
import {
  arrowDeg, bearingDeg, formatDistance, haversineM, nextWaypoint, offRouteDistanceM,
} from "@shared/api/navigation-core";
import { MAP } from "@shared/constants";
import { startCompass, stopCompass, startLocationUpdates, stopLocationUpdates, getLocationError } from "@/services/location";
import { getCurrentOwnerTrack, currentTrackOwner } from "@/services/tracks";
import { callCloud } from "@/services/cloud";
import { onPrivacyChange } from "@/services/privacy";
import { accountSession, onAccountChange } from "@/services/account";
import type { TrackPoint } from "@shared/types/track";

/* ---------- 数据源：路线 / 我的轨迹 / 会合队友 ---------- */
const navTitle = ref("导航");
const path = ref<LatLng[]>([]);
const reverse = ref(false);
const memberMode = ref(false);
const memberId = ref("");
const memberName = ref("");
const memberPos = ref<LatLng | null>(null);
const teamId = ref("");
let memberTimer: ReturnType<typeof setInterval> | null = null;
let sourceTrackId='';

onLoad((q) => {
  if (q?.mode === "member") {
    // 会合模式：目标是队友实时位置（动态点）
    memberMode.value = true;
    teamId.value = (q.teamId as string) ?? "";
    memberId.value = (q.memberId as string) ?? "";
    memberName.value = decodeURIComponent((q.name as string) ?? "队友");
    navTitle.value = `会合 · ${memberName.value}`;
    boot();
    pollMember();
    memberTimer = setInterval(pollMember, 10000);
    return;
  }
  if (q?.routeId) {
    const r = ROUTES.find((x) => x.id === q.routeId);
    if (r && isNavigable(r)) {
      navTitle.value = r.name;
      path.value = r.path.map(([longitude, latitude]) => ({ latitude, longitude }));
    }
  } else if (q?.trackId) {
    sourceTrackId=String(q.trackId);
    const t = getCurrentOwnerTrack(sourceTrackId);
    if (t && !t.points.slice(1).some(p => p.segmentStart)) {
      navTitle.value = t.name;
      path.value = t.points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
    }
  }
  if (q?.reverse === "1") {
    path.value = [...path.value].reverse();
    reverse.value = true;
  }
  if (path.value.length < 2) {
    uni.showToast({ title: "导航数据不可用", icon: "none" });
    setTimeout(() => uni.navigateBack(), 1200);
    return;
  }
  boot();
});

async function pollMember() {
  const res = await callCloud<{ members: { openid: string; latitude: number; longitude: number; updatedAt: number }[] }>(
    "team-locations", { teamId: teamId.value },
  );
  const m = res.data?.members?.find((x) => x.openid === memberId.value);
  memberPos.value = m && Number.isFinite(m.latitude) && Number.isFinite(m.longitude) && m.updatedAt > 0 && Date.now() - m.updatedAt <= 60000 ? { latitude: m.latitude, longitude: m.longitude } : null;
  if (!memberPos.value) finished.value = false;
  // 会合模式下如果已有双方位置，立即刷新指向
  if (memberPos.value && position.value) updateMemberNav(position.value);
}

/* ---------- 导航状态 ---------- */
const mode = ref<"arrow" | "map">("arrow");
const heading = ref(0);
const position = ref<TrackPoint | null>(null);
const hasFix = computed(() => position.value !== null);
const unsubscribePrivacy = onPrivacyChange(c => { if (!c.location) { position.value = null; finished.value = false; } });
const unsubscribeAccount=onAccountChange(()=>{
  position.value=null;memberPos.value=null;stopCompass(onHeading);stopLocationUpdates(onLocation);
  if(sourceTrackId||memberMode.value){path.value=[];if(timer)clearInterval(timer);if(memberTimer)clearInterval(memberTimer);uni.navigateBack();}
});
const targetBearing = ref(0);
const targetDistance = ref(0);
const waypointIndex = ref(0);
const finished = ref(false);
const offRoute = ref(false);
const offRouteDist = ref(0);
const walkedM = ref(0);
const startedAt = ref(Date.now());
const elapsedText = ref("0:00");
let lastPoint: TrackPoint | null = null;
let offRouteNotifiedAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const arrowAngle = computed(() => arrowDeg(targetBearing.value, heading.value));

const remainM = computed(() => {
  if (!position.value || path.value.length === 0) return 0;
  let remain = targetDistance.value;
  for (let i = waypointIndex.value; i < path.value.length - 1; i++) {
    remain += haversineM(path.value[i], path.value[i + 1]);
  }
  return remain;
});

/* 罗盘刻度 */
const compassMarks = [
  { label: "北", deg: 0, cardinal: true },
  { label: "东", deg: 90, cardinal: true },
  { label: "南", deg: 180, cardinal: true },
  { label: "西", deg: 270, cardinal: true },
  ...[30, 60, 120, 150, 210, 240, 300, 330].map((deg) => ({ label: "·", deg, cardinal: false })),
];

const onHeading = (deg: number) => { heading.value = deg; };
let disposed = false;
async function boot() {
  if (!(await startLocationUpdates(onLocation)) || disposed) {
    stopLocationUpdates(onLocation);
    if (!disposed) uni.showToast({ title: getLocationError() || "请启用隐私设置中的定位并授权", icon: "none" });
    return;
  }
  uni.setKeepScreenOn?.({ keepScreenOn: true });
  startCompass(onHeading);
  timer = setInterval(() => {
    const s = Math.floor((Date.now() - startedAt.value) / 1000);
    elapsedText.value = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
}

function onLocation(p: TrackPoint) {
  if (lastPoint) {
    const d = haversineM(lastPoint, p);
    if (d < 50) walkedM.value += d; // 跳点过滤
  }
  lastPoint = p;
  position.value = p;

  if (memberMode.value) {
    updateMemberNav(p);
    return;
  }

  const me: LatLng = { latitude: p.latitude, longitude: p.longitude };
  const wp = nextWaypoint(me, path.value, MAP.arriveThresholdM);
  waypointIndex.value = wp.index;
  targetDistance.value = wp.distanceM;
  targetBearing.value = bearingDeg(me, wp.point);

  if (wp.arrived && !wp.finished) {
    uni.vibrateShort?.({ complete: () => {} });
  }
  if (wp.finished && !finished.value) {
    finished.value = true;
    uni.vibrateLong?.({ complete: () => {} });
  }

  const off = offRouteDistanceM(me, path.value);
  offRouteDist.value = off;
  const nowOff = off > MAP.offRouteThresholdM;
  if (nowOff && !offRoute.value && Date.now() - offRouteNotifiedAt > 15000) {
    offRouteNotifiedAt = Date.now();
    uni.vibrateLong?.({ complete: () => {} });
    uni.showToast({ title: "已偏离轨迹", icon: "none" });
  }
  offRoute.value = nowOff;
}

/** 会合模式：箭头指向队友实时位置，双向距离随两人移动更新 */
function updateMemberNav(p: TrackPoint) {
  if (!memberPos.value) return;
  const me: LatLng = { latitude: p.latitude, longitude: p.longitude };
  targetDistance.value = haversineM(me, memberPos.value);
  targetBearing.value = bearingDeg(me, memberPos.value);
  if (targetDistance.value <= MAP.arriveThresholdM && !finished.value) {
    finished.value = true;
    uni.vibrateLong?.({ complete: () => {} });
    uni.showToast({ title: `已与 ${memberName.value} 会合`, icon: "none" });
  }
}

/* ---------- 地图模式数据 ---------- */
const mapCenter = computed(() => { const p = position.value ?? path.value[0]; return p ? toMapPoint(p) : null; });
const mapScale = computed(() => {
  if (targetDistance.value < 200) return 17;
  if (targetDistance.value < 1000) return 15;
  return 13;
});
const mapMarkers = computed(() => {
  if (path.value.length === 0) return [];
  const end = toMapPoint(path.value[path.value.length - 1]);
  const first = toMapPoint(path.value[0]);
  return [
    { id: 1, latitude: first.latitude, longitude: first.longitude, title: "起点", width: 24, height: 24 },
    { id: 2, latitude: end.latitude, longitude: end.longitude, title: "终点", width: 24, height: 24 },
  ];
});
const mapPolyline = computed(() => [
  {
    points: path.value.map(toMapPoint),
    color: HE_PALETTE.accent, width: 4, arrowLine: true,
  },
]);

/* ---------- SOS ---------- */
async function triggerSos() {
  const p = position.value;
  if (!p) {
    uni.showToast({ title: "暂无定位，无法上报", icon: "none" });
    return;
  }
  const owner=currentTrackOwner(),token=accountSession()?.token;
  let savedTeamId = teamId.value;
  if (!savedTeamId) { try { const raw=uni.getStorageSync("he_team");const cached=typeof raw==='string'?JSON.parse(raw||'null'):raw;const id=cached?.teamId??cached?.id;savedTeamId=typeof id==='string'?id:''; } catch {} }
  const confirmed = await new Promise<boolean>((resolve) => uni.showModal({
    title: "上传求助位置？",
    content: savedTeamId ? "将当前位置和导航求助说明保存到云端；有效队友打开组队页面时可见，信号只显示最近1小时。正常情况下记录在24–30小时内由定时清理删除；任务异常时可能延迟。没有短信或系统推送，也不会联系救援机构；紧急情况请直接拨打当地求救电话。" : "将当前位置和导航求助说明保存到云端求助记录；当前没有队伍，无人接收。正常情况下记录在24–30小时内由定时清理删除；任务异常时可能延迟。没有短信或系统推送，也不会联系救援机构；紧急情况请直接拨打当地求救电话。",
    success: (result) => resolve(result.confirm === true), fail: () => resolve(false),
  }));
  if (!confirmed||owner!==currentTrackOwner()||token!==accountSession()?.token) return;
  const res = await callCloud("sos-trigger", {
    teamId: savedTeamId, latitude: p.latitude, longitude: p.longitude, message: `导航「${navTitle.value}」中触发`,
  });
  if (res.ok) {
    uni.showModal({ title: "SOS 已上报", content: savedTeamId ? "求助记录已保存，队友打开组队页面时可见；信号仅显示最近1小时。正常情况下，记录会在24–30小时内由定时任务删除，任务异常时可能延迟。没有后台推送或救援接警，请直接电话求助。" : "求助记录已保存，但当前无人接收。正常情况下，记录会在24–30小时内由定时任务删除，任务异常时可能延迟；请直接电话求助。", showCancel: false });
  } else {
    uni.showToast({ title: "上报失败：" + res.errMsg, icon: "none" });
  }
}

function quit() {
  uni.showModal({
    title: "结束导航？",
    success: (r) => { if (r.confirm) uni.navigateBack(); },
  });
}

onUnmounted(() => {
  disposed = true;
  unsubscribePrivacy();
  unsubscribeAccount();
  stopCompass(onHeading);
  stopLocationUpdates(onLocation);
  if (timer) clearInterval(timer);
  if (memberTimer) clearInterval(memberTimer);
  uni.setKeepScreenOn?.({ keepScreenOn: false });
});
</script>

<style lang="scss" scoped>
.page { display: flex; flex-direction: column; height: 100vh; background: var(--he-color-background); }
.topbar { display: flex; align-items: center; padding: 44px 16px 8px; }
.quit { font-size: 14px; color: var(--he-color-muted); width: 60px; }
.title { flex: 1; text-align: center; font-size: 15px; font-weight: 600; color: var(--he-color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mode { width: 60px; text-align: right; font-size: 13px; color: var(--he-color-accent); }

.arrow-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; }
.ring { position: relative; width: 300px; height: 300px; border-radius: 50%; border: 1px solid var(--he-color-surface); display: flex; align-items: center; justify-content: center; }
.mark { position: absolute; left: 50%; top: 50%; margin: -10px 0 0 -10px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; }
.mark-text { font-size: 12px; color: var(--he-color-muted); }
.mark-text.cardinal { color: var(--he-color-muted); font-weight: 600; }
.arrow { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transition: transform 0.15s linear; }
.arrow-body { position: absolute; left: -7px; top: -110px; width: 14px; height: 80px; background: var(--he-color-accent); border-radius: 7px; }
.arrow-head { position: absolute; left: -22px; top: -140px; width: 0; height: 0; border-left: 22px solid transparent; border-right: 22px solid transparent; border-bottom: 36px solid var(--he-color-accent); }
.center { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.dist { font-size: 40px; font-weight: 700; color: var(--he-color-text); }
.bearing { font-size: 15px; color: var(--he-color-muted); }
.wp { font-size: 11px; color: var(--he-color-muted); }
.offroute { position: absolute; bottom: 20px; padding: 8px 16px; background: rgba(var(--he-color-caution-rgb), 0.15); color: var(--he-color-caution); border-radius: 499.5px; font-size: 13px; }
.finished-banner { position: absolute; bottom: 20px; padding: 8px 16px; background: rgba(var(--he-color-accent-rgb), 0.15); color: var(--he-color-accent); border-radius: 499.5px; font-size: 13px; }
.nofix { position: absolute; top: 16px; font-size: 12px; color: var(--he-color-warning); }

.map-wrap { flex: 1; position: relative; }
.map { width: 100%; height: 100%; }
.map-h5-tip { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--he-color-muted); font-size: 13px; padding: 0 32px; text-align: center; }
.map-hud { position: absolute; left: 16px; right: 16px; bottom: 16px; display: flex; justify-content: space-between; background: var(--he-overlay, rgba(5, 12, 18, 0.84)); border: 1px solid var(--he-overlay-border, rgba(255, 255, 255, 0.12)); border-radius: 8px; padding: 10px 12px; font-size: 13px; color: var(--he-color-text); backdrop-filter: blur(12px); }
.hud-warn { color: var(--he-color-caution); }

.hud { display: flex; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); gap: 8px; }
.hud-cell { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; background: var(--he-color-panel); border-radius: 8px; padding: 10px 0; }
.hud-v { font-size: 14px; font-weight: 600; color: var(--he-color-text); }
.hud-k { font-size: 10px; color: var(--he-color-muted); }
.hud-cell.sos { background: rgba(var(--he-color-danger-rgb), 0.12); }
.sos-v { color: var(--he-color-danger); }
</style>
