<template>
  <view class="page" v-if="track">
    <view class="head">
      <text class="name">{{ track.name }}</text>
      <text class="date">{{ formatFull(track.startedAt) }}</text>
    </view>
    <text v-if="!storeValid" class="warning">本机轨迹列表格式异常。查看、导航和导出仍可用；本机删除与云端写入已停用，请勿清理应用数据。</text>

    <view class="grid">
      <view class="cell"><text class="v">{{ (track.distanceM / 1000).toFixed(2) }} km</text><text class="k">里程</text></view>
      <view class="cell"><text class="v">{{ track.ascentM.toFixed(0) }} m</text><text class="k">爬升</text></view>
      <view class="cell"><text class="v">{{ durationText }}</text><text class="k">用时</text></view>
      <view class="cell"><text class="v">{{ track.points.length }}</text><text class="k">轨迹点</text></view>
    </view>

    <RouteMap :layers="offlineLayer?.paths || []" :attribution="offlineLayer?.attribution || ''" :points="track.points" />

    <view class="actions">
      <button class="btn primary he-primary" @click="navAlong">沿此轨迹导航</button>
      <button class="btn" @click="exportGpx">导出 GPX</button>
      <button v-if="showSyncAction" class="btn" :disabled="syncing || !storeValid" @click="sync">{{syncing?'同步中…':'云同步'}}</button>
      <button class="btn danger" :disabled="!storeValid" @click="remove">删除</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { HE_PALETTE } from '@shared/design/palette';
import { saveNativeGpx } from '@/services/files';
import { activeOfflineLayer,restoreOfflineLayers } from '@/services/offline';

import RouteMap from '@/components/RouteMap.vue';
import { isDesktop, saveDesktopGpx } from '@/services/desktop';
import { toMapPoint } from "@shared/api/coordinates";
import { computed, ref } from "vue";
import { onLoad,onShow,onUnload } from "@dcloudio/uni-app";
const offlineLayer = computed(()=>activeOfflineLayer());
import { trackToGpx, type TrackRecord } from "@shared/types/track";
import { deleteTrack, getCurrentOwnerTrack, uploadTrackToCloud, currentTrackOwner, trackNeedsManualBackup, trackStorageValid } from "@/services/tracks";
import { hasPrivacyConsent } from "@/services/privacy";
import { onAccountChange } from '@/services/account';

declare const plus: any;
declare const wx: any;
const track = ref<TrackRecord | null>(null);
const storeValid=ref(trackStorageValid());
const showSyncAction = computed(() => !!track.value && trackNeedsManualBackup(track.value));
const trackId = ref('');
const syncing=ref(false);
function reloadOwnedTrack(){
  if(!trackId.value)return;
  storeValid.value=trackStorageValid();
  track.value=getCurrentOwnerTrack(trackId.value);
  if(!track.value){uni.showToast({title:'轨迹不存在或属于其他本机账号',icon:'none'});setTimeout(()=>uni.navigateBack(),600);}
}
onShow(()=>{void restoreOfflineLayers();reloadOwnedTrack();});

onLoad((q) => {
  trackId.value = String(q?.id || '');
  const t = getCurrentOwnerTrack(trackId.value);
  if (!t) {
    uni.showToast({ title: "轨迹不存在或属于其他本机账号", icon: "none" });
    setTimeout(() => uni.navigateBack(), 1000);
    return;
  }
  track.value = t;
  uni.setNavigationBarTitle({ title: t.name });
});

const center = computed(() => {
  const pts = track.value!.points;
  const mid = pts[Math.floor(pts.length / 2)];
  return toMapPoint(mid);
});

const polyline = computed(() => {
  const segments: { latitude: number; longitude: number }[][] = [];
  for (const p of track.value!.points) {
    if (!segments.length || p.segmentStart) segments.push([]);
    segments[segments.length - 1].push(toMapPoint(p));
  }
  return segments.filter(s => s.length >= 2).map(points => ({ points, color: HE_PALETTE.accent, width: 4, arrowLine: true }));
});

const markers = computed(() => {
  const pts = track.value!.points;
  const first = toMapPoint(pts[0]);
  const last = toMapPoint(pts[pts.length - 1]);
  return [
    { id: 1, latitude: first.latitude, longitude: first.longitude, title: "起点", width: 24, height: 24 },
    { id: 2, latitude: last.latitude, longitude: last.longitude, title: "终点", width: 24, height: 24 },
  ];
});

const durationText = computed(() => {
  const t = track.value!;
  if (!t.endedAt || t.points.every(p => p.timeEstimated)) return "-";
  const s = Math.floor((t.activeDurationMs ?? (t.endedAt - t.startedAt)) / 1000);
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
});

function navAlong() {
  if (track.value!.points.slice(1).some(p => p.segmentStart)) { uni.showModal({ title: "轨迹包含中断", content: "分段之间没有路径记录，暂不提供跨段导航。请导入连续轨迹。", showCancel: false }); return; }
  uni.navigateTo({ url: `/pages/navigation/session?trackId=${track.value!.id}` });
}

async function exportGpx() {
  const gpx = trackToGpx(track.value!);
  // #ifdef H5
  if (isDesktop()) {
    try { const saved = await saveDesktopGpx(track.value!.name, gpx); if (saved) uni.showToast({ title: 'GPX已保存', icon: 'success' }); }
    catch (e) { uni.showToast({ title: String(e), icon: 'none' }); }
    return;
  }
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${track.value!.name}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  // #endif
  // #ifdef MP-WEIXIN
  const fileName = `track-${Date.now()}.gpx`;
  const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
  wx.getFileSystemManager().writeFile({ filePath, data: gpx, encoding: "utf8", success: () => {
    if (typeof wx.shareFileMessage === "function") wx.shareFileMessage({ filePath, fileName, fail: () => uni.showToast({ title: "文件分享未完成，可重试导出", icon: "none" }) });
    else uni.setClipboardData({ data: gpx });
  }, fail: () => uni.showToast({ title: "GPX 文件保存失败", icon: "none" }) });
  // #endif
  // #ifdef APP-PLUS
  try { const saved = await saveNativeGpx(track.value!.name, gpx); if (saved) uni.showToast({ title: 'GPX已保存', icon: 'success' }); }
  catch (e) { uni.showToast({ title: e instanceof Error ? e.message : 'GPX保存失败', icon: 'none' }); }
  // #endif
}

async function sync() {
  if (!track.value || syncing.value) return;
  if (!hasPrivacyConsent("trackCloudSync")) {
    uni.showModal({title:"需要轨迹备份授权",content:"请先在“我的 → 隐私设置”中启用云端轨迹备份。",showCancel:false});
    return;
  }
  const snapshot=track.value;syncing.value=true;uni.showLoading({title:"同步中"});
  try{
    const owner=currentTrackOwner();
    if(!owner){uni.showToast({title:'请先登录统一账号',icon:'none'});return;}
    if(snapshot.localOwner!==owner||(snapshot.cloudOwner&&snapshot.cloudOwner!==owner)){
      const accepted=await new Promise<boolean>(resolve=>uni.showModal({title:'确认转入当前账号？',content:'此轨迹属于其他账号或旧版未记录本机归属。确认后会把本机轨迹副本上传到当前账号。',success:r=>resolve(r.confirm===true),fail:()=>resolve(false)}));
      if(!accepted||owner!==currentTrackOwner())return;
    }
    const result=await uploadTrackToCloud(snapshot,{restoreDeleted:true,transferAccount:true});
    if(result.ok){track.value=getCurrentOwnerTrack(snapshot.id);uni.showToast({title:"已同步",icon:"success"});}
    else uni.showToast({title:result.errMsg,icon:"none"});
  }finally{syncing.value=false;uni.hideLoading();}
}

function remove() {
  const snapshot=track.value,owner=currentTrackOwner();if(!snapshot)return;
  uni.showModal({
    title: "删除该轨迹？",
    content: "删除本机轨迹后不可恢复；已上传的云端副本不会随之删除。",
    success: (r) => {
      if (r.confirm&&owner===currentTrackOwner()&&JSON.stringify(getCurrentOwnerTrack(snapshot.id))===JSON.stringify(snapshot)) {
        try { deleteTrack(snapshot.id); uni.navigateBack(); }
        catch (e: any) { storeValid.value=trackStorageValid(); uni.showToast({title:e?.message||'删除失败，轨迹资料仍保留',icon:'none'}); }
      } else if(r.confirm) {
        uni.showToast({title:'账号或轨迹已变化，未删除；请刷新后重试',icon:'none'});
      }
    },
  });
}

function formatFull(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const unsubscribeAccount=onAccountChange(reloadOwnedTrack);
onUnload(unsubscribeAccount);
</script>

<style lang="scss" scoped>
.page { display: flex; flex-direction: column; height: 100vh; background: var(--he-color-background); }
.head { padding: 16px 16px 8px; }
.name { display: block; font-size: 20px; font-weight: 700; color: var(--he-color-text); }
.date { display: block; margin-top: 4px; font-size: 12px; color: var(--he-color-muted); }
.grid { display: flex; margin: 8px 16px; background: var(--he-color-panel); border-radius: 10px; padding: 12px 0; }
.cell { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.v { font-size: 14px; font-weight: 600; color: var(--he-color-text); }
.k { font-size: 10px; color: var(--he-color-muted); }
.map { width: calc(100% - 32px); height: 190px; margin: 8px 16px; border-radius: 10px; }
.map-h5-tip { margin: 8px 16px; height: 190px; display: flex; align-items: center; justify-content: center; background: var(--he-color-panel); border-radius: 10px; color: var(--he-color-muted); font-size: 12px; text-align: center; padding: 0 24px; }
.actions { margin-top: auto; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 8px; }
.btn { border-radius: 499.5px; font-size: 14px; background: var(--he-color-surface); color: var(--he-color-text); }
.btn.primary { background: var(--he-color-accent); color: var(--he-color-on-accent); font-weight: 600; }
.btn.danger { color: var(--he-color-danger); }
.warning { display:block; margin:8px 16px; padding:10px; color:var(--he-color-warning); background:rgba(var(--he-color-warning-rgb),.12); border-radius:6px; line-height:1.6; }
</style>
