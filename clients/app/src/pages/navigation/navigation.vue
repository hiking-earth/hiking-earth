<template>
  <view class="page">
    <view class="intro">
      <text class="intro-title">沿轨迹导航</text>
      <text class="intro-sub">精准箭头实时指向 · 偏航震动提醒 · 无需看地图</text>
    </view>

    <scroll-view scroll-y class="list">
      <view class="team-entry" @click="goTeam">
        <view class="team-l">
          <text class="team-t">👥 组队会合</text>
          <text class="team-s">队友实时位置互见 · 箭头导航会合</text>
        </view>
        <text class="go">→</text>
      </view>

      <view class="group-title">可导航路线（{{ navigableRoutes.length }}）</view>
      <view v-for="r in navigableRoutes" :key="r.id" class="card" @click="start(r.id)">
        <view class="card-l">
          <text class="card-name">{{ r.name }}</text>
          <text class="card-meta">{{ r.region }} · {{ r.distance }} · {{ r.difficulty }}</text>
        </view>
        <text class="go">→</text>
      </view>

      <view class="group-title">从我的轨迹导航</view>
      <view v-if="tracks.length === 0" class="empty">还没有已完成的轨迹，去「轨迹」页记录一条</view>
      <view v-for="t in tracks" :key="t.id" class="card" @click="startTrack(t.id)">
        <view class="card-l">
          <text class="card-name">{{ t.name }}</text>
          <text class="card-meta">{{ (t.distanceM / 1000).toFixed(1) }} km · {{ t.points.length }} 个点</text>
        </view>
        <text class="go">→</text>
      </view>

      <view class="notice">
        内置路线目前多为认知示意，不提供沿线导航。你可以导入有可靠来源的连续 GPX 或使用自己的实录轨迹。
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import { ROUTES } from "@/services/route-catalog";
import { isNavigable } from "@shared/types/route";
import { listCurrentOwnerTracks } from "@/services/tracks";
import type { TrackRecord } from "@shared/types/track";

const tracks = ref<TrackRecord[]>([]);

onShow(() => {
  tracks.value = listCurrentOwnerTracks().filter((t) => t.state === "finished" && t.points.length >= 2 && !t.points.slice(1).some(p => p.segmentStart));
});

const navigableRoutes = computed(() => ROUTES.filter(isNavigable));

function start(routeId: string) {
  uni.navigateTo({ url: `/pages/navigation/session?routeId=${routeId}` });
}
function startTrack(trackId: string) {
  uni.navigateTo({ url: `/pages/navigation/session?trackId=${trackId}` });
}
function goTeam() {
  uni.navigateTo({ url: "/pages/team/team" });
}
</script>

<style lang="scss" scoped>
.page { display: flex; flex-direction: column; height: 100vh; background: var(--he-color-background); }
.intro { padding: 20px 16px 12px; }
.intro-title { display: block; font-size: 22px; font-weight: 700; color: var(--he-color-text); }
.intro-sub { display: block; margin-top: 4px; font-size: 12px; color: var(--he-color-muted); }
.list { flex: 1; padding: 0 16px; box-sizing: border-box; }
.group-title { font-size: 12px; color: var(--he-color-muted); margin: 12px 0 8px; }
.card { display: flex; align-items: center; background: var(--he-color-panel); border-radius: var(--he-card-radius, 16px); padding: 14px 12px; margin-bottom: 8px; }
.card-l { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.card-name { font-size: 15px; font-weight: 600; color: var(--he-color-text); }
.card-meta { font-size: 11px; color: var(--he-color-muted); }
.go { font-size: 18px; color: var(--he-color-accent); }
.team-entry { display: flex; align-items: center; background: rgba(var(--he-color-accent-rgb), 0.1); border: 0.5px solid rgba(var(--he-color-accent-rgb), 0.3); border-radius: 10px; padding: 14px 12px; margin: 8px 0 4px; }
.team-l { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.team-t { font-size: 15px; font-weight: 600; color: var(--he-color-text); }
.team-s { font-size: 11px; color: var(--he-color-muted); }
.empty { color: var(--he-color-muted); font-size: 12px; padding: 12px 0; }
.notice { margin: 16px 0 24px; padding: 12px; background: var(--he-color-surface); border-radius: 8px; font-size: 11px; color: var(--he-color-muted); line-height: 1.7; }
</style>
