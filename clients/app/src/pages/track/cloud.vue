<template>
  <scroll-view scroll-y class="page">
    <text class="hint">云端轨迹仅供当前账号查看。恢复到本机会保留云端副本。</text>
    <text v-if="!storeValid" class="error">本机轨迹列表格式异常；恢复、删除和自动同步本机写入已停用，原始资料仍保留，请勿清理应用数据。</text>
    <text v-if="accountMergePending" class="hint">账号资料仍在安全合并；完成后即可恢复或删除云端轨迹。</text>
    <text v-if="error" class="error">{{ error }}</text>
    <button @click="reload" :disabled="busy">刷新</button>
    <view v-for="t in rows" :key="t.trackId" class="card">
      <text>{{ t.name }} · {{ (t.distanceM / 1000).toFixed(2) }} km</text>
      <button :disabled="busy || !storeValid || accountMergePending" @click="restore(t.trackId)">恢复到本机</button>
      <button :disabled="busy || !storeValid || accountMergePending" @click="remove(t.trackId)">删除云端副本</button>
    </view>
    <text v-if="!rows.length && !error && !busy">暂无云端轨迹</text>
    <button v-if="hasMore" :disabled="busy" @click="load">加载更多</button>
  </scroll-view>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { accountSession, onAccountChange } from '@/services/account';
import { callCloud } from '@/services/cloud';
import { acquireTrackCloudLock, getTrack, saveTrack, setTrackAutoSyncExcluded, trackStorageValid } from '@/services/tracks';
import type { TrackRecord } from '@shared/types/track';
type Row = { trackId: string; name: string; distanceM: number; version:number };
const rows = ref<Row[]>([]), busy = ref(false), error = ref(''), hasMore = ref(false), accountMergePending=ref(!!accountSession()?.mergedIdentities?.length);
const storeValid=ref(trackStorageValid());
let page = 0;
let visible=true;
const currentOwner=()=>String(uni.getStorageSync('he_openid')||'');
let reloadPending=false;
const unsubscribeAccount=onAccountChange(()=>{accountMergePending.value=!!accountSession()?.mergedIdentities?.length;rows.value=[];page=0;hasMore.value=false;error.value='';reloadPending=true;if(visible&&!busy.value){reloadPending=false;reload();}});
function resumePendingReload(){if(reloadPending&&visible&&!busy.value){reloadPending=false;reload();}}
onShow(()=>{visible=true;storeValid.value=trackStorageValid();accountMergePending.value=!!accountSession()?.mergedIdentities?.length;resumePendingReload();});
onHide(()=>{visible=false;reloadPending=true;});
onUnload(()=>{visible=false;reloadPending=false;unsubscribeAccount();rows.value=[];});
onLoad(reload);
async function load() {
  if (busy.value) return;
  busy.value = true;
  const owner=currentOwner();
  try {
    const res = await callCloud<{ tracks: Row[]; hasMore: boolean }>('track-manage', { action: 'list', page });
    if(!visible||owner!==currentOwner()){rows.value=[];page=0;hasMore.value=false;return;}
    if (!res.ok || !res.data) throw new Error(res.errMsg ?? '加载失败');
    if(!Array.isArray(res.data.tracks)||res.data.tracks.length>20||typeof res.data.hasMore!=='boolean'
      ||(res.data.hasMore&&res.data.tracks.length!==20)
      ||!res.data.tracks.every(t=>t&&typeof t.trackId==='string'&&t.trackId.length>0&&t.trackId.length<=128
        &&typeof t.name==='string'&&Number.isFinite(t.distanceM)&&t.distanceM>=0&&Number.isSafeInteger(t.version)&&t.version>=0)
      ||new Set(res.data.tracks.map(t=>t.trackId)).size!==res.data.tracks.length)throw new Error('云端轨迹目录格式无效');
    error.value = ''; page++; hasMore.value = res.data.hasMore;
    for (const t of res.data.tracks) if (!rows.value.some(r => r.trackId === t.trackId)) rows.value.push(t);
  } catch(e) { if(visible&&owner===currentOwner())error.value=e instanceof Error?e.message:'加载失败'; }
  finally { busy.value=false;resumePendingReload(); }
}
function reload() { if (busy.value) return; rows.value = []; hasMore.value=false; page = 0; void load(); }
function confirm(title: string, content: string) { return new Promise<boolean>(resolve => uni.showModal({ title, content, success: r => resolve(r.confirm === true), fail: () => resolve(false) })); }
async function restore(id: string) {
  accountMergePending.value=!!accountSession()?.mergedIdentities?.length;if(accountMergePending.value)return;
  storeValid.value=trackStorageValid();if (busy.value || !storeValid.value) return;
  const owner=currentOwner();
  const local=getTrack(id),baseline=JSON.stringify(local);
  if (local) {
    const belongsElsewhere=local.localOwner!==owner;
    const accepted=await confirm(belongsElsewhere?'覆盖其他账号本机轨迹？':'覆盖本机同名轨迹？',belongsElsewhere
      ?'本机同ID轨迹属于其他账号或归属未确认。继续会用当前账号云端副本替换本机轨迹；原本机副本无法从此操作恢复。'
      :'本机已有相同 ID 的轨迹，恢复将用云端副本替换。');
    if(!accepted)return;
  }
  accountMergePending.value=!!accountSession()?.mergedIdentities?.length;if(accountMergePending.value)return;
  if(!visible||busy.value||owner!==currentOwner())return;
  busy.value = true;
  let releaseCloud:(()=>void)|undefined;
  try {
    releaseCloud=await acquireTrackCloudLock();
    accountMergePending.value=!!accountSession()?.mergedIdentities?.length;if(accountMergePending.value)return;
    if(!visible||owner!==currentOwner()||JSON.stringify(getTrack(id))!==baseline)throw new Error('账号或本机轨迹已变化，请刷新后重新确认');
    const res = await callCloud<{ track: TrackRecord }>('track-manage', { action: 'get', trackId: id });
    if (!res.ok || !res.data) throw new Error(res.errMsg ?? '恢复失败');
    if(!visible||owner!==currentOwner())return;
    if(JSON.stringify(getTrack(id))!==baseline)throw new Error('本机轨迹已变化，请重新确认恢复');
    if(!res.data.track||res.data.track.id!==id||res.data.track.state!=='finished'||res.data.track.synced!==true
      ||!Number.isSafeInteger(res.data.track.cloudVersion)||(res.data.track.cloudVersion??-1)<0)throw new Error('云端轨迹与请求不一致，本机资料未覆盖');
    if(!trackStorageValid()){storeValid.value=false;throw new Error('本机轨迹资料格式异常，云端副本未写入本机');}
    saveTrack({...res.data.track,localOwner:owner,cloudOwner:owner});
    setTrackAutoSyncExcluded(id,false);
    uni.showToast({ title: '已恢复到本机', icon: 'success' });
  } catch (e) { if(visible&&owner===currentOwner())error.value = e instanceof Error ? e.message : '保存失败'; }
  finally { releaseCloud?.();busy.value = false;resumePendingReload(); }
}
async function remove(id: string) {
  accountMergePending.value=!!accountSession()?.mergedIdentities?.length;if(accountMergePending.value)return;
  storeValid.value=trackStorageValid();if(!storeValid.value){error.value='本机轨迹资料格式异常，已停用云端删除以避免本地版本状态不一致';return;}
  const owner=currentOwner();
  const row=rows.value.find(item=>item.trackId===id);if(!row)return;
  if (busy.value || !await confirm('删除云端轨迹？', '云端轨迹点将删除；为防止旧设备恢复已删副本，服务器仅保留不含轨迹点的版本记录。本机轨迹保留。')) return;
  accountMergePending.value=!!accountSession()?.mergedIdentities?.length;if(accountMergePending.value)return;
  if(!visible||busy.value||owner!==currentOwner())return;
  busy.value = true;
  let releaseCloud:(()=>void)|undefined;
  let removed=false;
  try {
    releaseCloud=await acquireTrackCloudLock();
    accountMergePending.value=!!accountSession()?.mergedIdentities?.length;if(accountMergePending.value)return;
    if(!visible||owner!==currentOwner())return;
    const res = await callCloud<{deleted:boolean;version:number}>('track-manage', { action: 'delete', trackId: id, expectedVersion:row.version });
    if(!visible||owner!==currentOwner())return;
    if (!res.ok || res.data?.deleted!==true || !Number.isSafeInteger(res.data.version) || res.data.version<1) throw new Error(res.errMsg ?? '删除未确认，请刷新云端目录');
    if(!trackStorageValid()){storeValid.value=false;throw new Error('云端副本已删除，但本机资料发生格式异常；本机原始轨迹未覆盖，请保留应用数据');}
    setTrackAutoSyncExcluded(id,true);
    const local = getTrack(id); if (local&&(local.localOwner===owner||local.cloudOwner===owner)) saveTrack({...local,synced:false,cloudOwner:owner,cloudVersion:res.data.version});
    removed=true;
  } catch(e) { if(visible&&owner===currentOwner())error.value=e instanceof Error?e.message:'删除失败'; }
  finally { releaseCloud?.();busy.value=false;resumePendingReload(); }
  if(removed)reload();
}
</script>
<style scoped>
.page { box-sizing: border-box; padding: 16px; background: var(--he-color-background); color: var(--he-color-text); min-height: 100vh; }
.hint { display: block; margin-bottom: 12px; color: var(--he-color-muted); }
.card { padding: 12px; margin: 12px 0; background: var(--he-color-panel); border-radius: var(--he-card-radius, 16px); }
button { margin-top: 8px; background: var(--he-color-surface); color: var(--he-color-accent); }
.error { color: var(--he-color-danger); }
</style>
