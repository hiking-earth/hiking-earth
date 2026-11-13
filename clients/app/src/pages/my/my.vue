<template>
  <scroll-view scroll-y class="page">
    <!-- 账号 -->
    <view class="account">
      <view class="avatar">{{ nickname.slice(0, 1) }}</view>
      <view class="acc-info">
        <text class="nick">{{ nickname }}</text>
        <text class="acc-sub">{{ openid ? '已登录统一账号，可使用云端功能' : legacyIdentityPending ? '检测到旧版微信身份；请重新登录并关联到统一账号' : '登录后可用云同步、组队与社区' }}</text>
      </view>
      <button v-if="!openid" class="login" @click="login">{{ legacyIdentityPending ? '关联微信账号' : '登录' }}</button>
    </view>
    <!-- #ifdef MP-WEIXIN -->
    <view class="group"><view class="row" @click="go('/pages/account/qr-confirm')"><text class="row-icon">▣</text><text class="row-name">扫码登录网页或桌面</text><text class="row-go">›</text></view></view>
    <!-- #endif -->

    <!-- 功能入口 -->
    <view class="group"><view class="row" @click="go('/pages/route/news')"><text class="row-icon">◉</text><text class="row-name">官方户外公告</text><text class="row-go">›</text></view></view>
    <view class="group"><view class="row" @click="go('/pages/companion/social')"><text class="row-icon">✎</text><text class="row-name">云端日记、队聊与通知</text><text class="row-go">›</text></view></view>
    <view class="group"><view class="row" @click="go('/pages/library/library')"><text class="row-icon">♡</text><text class="row-name">收藏与行程</text><text class="row-go">›</text></view></view>
    <view class="group">
      <view class="row" @click="go('/pages/account/account')"><text class="row-icon">👤</text><text class="row-name">统一账号与账号管理</text><text class="row-go">›</text></view>
      <view class="row" @click="go('/pages/team/team')">
        <text class="row-icon">👥</text><text class="row-name">组队会合</text><text class="row-go">›</text>
      </view>
      <view class="row" @click="go('/pages/gear/scan')">
        <text class="row-icon">📷</text><text class="row-name">拍照识装备</text><text class="row-go">›</text>
      </view>
      <view class="row" @click="go('/pages/guide/guide')">
        <text class="row-icon">🎒</text><text class="row-name">装备导购</text><text class="row-go">›</text>
      </view>
    </view>

    <view class="group">
      <view class="row" @click="syncAll">
        <text class="row-icon">☁️</text><text class="row-name">云同步全部轨迹</text>
        <text class="row-sub">{{ unsynced }} 条待同步</text><text class="row-go">›</text>
      </view>
      <text v-if="!tracksValid" class="privacy-note">本机轨迹列表格式异常，轨迹上传已停用以保留原始定位资料。请勿清理应用数据。</text>
      <button v-if="!tracksValid" class="local-backup" @click="exportRawTrackStore">导出本机原始轨迹资料</button>
      <view class="row" @click="go('/pages/track/cloud')"><text class="row-icon">☁️</text><text class="row-name">恢复与管理云端轨迹</text><text class="row-go">›</text></view>
      <view class="row" @click="go('/pages/offline/offline')">
        <text class="row-icon">🗺️</text><text class="row-name">离线资料管理</text><text class="row-sub">本机轨迹</text><text class="row-go">›</text>
      </view>
    </view>

    <view class="group"><view class="row" @click="go('/pages/my/updates')"><text class="row-icon">↻</text><text class="row-name">自动同步与版本更新</text><text class="row-go">›</text></view></view>
    <view class="group">
      <view class="row" @click="go('/pages/my/privacy')">
        <text class="row-icon">🔒</text><text class="row-name">隐私设置</text><text class="row-go">›</text>
      </view>
      <view class="row" @click="go('/pages/my/terms')">
        <text class="row-icon">📄</text><text class="row-name">使用规则与户外安全</text><text class="row-go">›</text>
      </view>
      <view class="row" @click="about">
        <text class="row-icon">ℹ️</text><text class="row-name">关于徒步地球</text><text class="row-go">›</text>
      </view>
    </view>

    <view v-if="openid" class="group"><view class="row" @click="showOperations=!showOperations"><text class="row-name">运营工具</text><text class="row-sub">服务器按管理员身份授权</text><text class="row-go">›</text></view><view v-if="showOperations"><text class="operations-hint">路线风险、路线开放资料、商品来源及社区举报均需你人工核对后处理；自动筛查不会直接授予路线通行或导航许可。</text><button @click="go('/pages/my/route-review')">路线风险与官方资料审核</button><button @click="go('/pages/moderation/moderation')">社区内容与举报审核</button><button @click="go('/pages/guide/manage')">导购来源与有效期管理</button></view></view>
    <view class="ver">徒步地球客户端 v{{ APP_VERSION }} · 全端客户端</view>
  </scroll-view>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import { listTracks, uploadTrackToCloud, currentTrackOwner, trackNeedsManualBackup, trackStorageValid, rawTrackStoreSnapshot } from "@/services/tracks";
import { saveLocalTextFile } from '@/services/files';
import { hasPrivacyConsent } from "@/services/privacy";
import { accountSession, saveAccount } from '@/services/account';
import { exchangeMiniProgramWeChat } from '@/services/wechat-login';
import { APP_VERSION } from '@/services/version';

const openid = ref("");
const legacyIdentityPending = ref(false);
const showOperations=ref(false);
const nickname = ref("未登录");
const unsynced = ref(0);
const tracksValid=ref(trackStorageValid());
let syncingTracks=false;

onShow(() => {
  tracksValid.value=trackStorageValid();
  unsynced.value = listTracks().filter((t) => trackNeedsManualBackup(t)).length;
  const session = accountSession();
  const saved = uni.getStorageSync("he_openid");
  openid.value = ''; nickname.value = '未登录'; legacyIdentityPending.value = false;
  if (session) { openid.value = session.openid; nickname.value = session.nickname; }
  // #ifdef MP-WEIXIN
  else if (saved && saved !== "local-mock-user" && !String(saved).startsWith("account:")) {
    // Retain the legacy identity so trusted login can resolve/migrate it, but
    // never present a local identifier as an authenticated unified session.
    legacyIdentityPending.value = true;
    nickname.value = "山友";
  }
  // #endif
});

async function login() {
  // #ifdef MP-WEIXIN
  try {
    const session = await exchangeMiniProgramWeChat();
    if (accountSession()) throw new Error('账号已改变，请确认当前账号后重试');
    const localReady=saveAccount(session);
    openid.value = session.openid;
    nickname.value = session.nickname;
    if(localReady)uni.showToast({ title: "登录成功", icon: "success" });
    else uni.showModal({title:'登录已完成',content:'账号已登录；部分本机旧资料暂未合并，应用会保留提示并重试。',showCancel:false});
  } catch (error) { uni.showToast({ title: error instanceof Error ? error.message : '微信登录失败', icon: 'none' }); }
  // #endif
  // #ifndef MP-WEIXIN
  go('/pages/account/account');
  // #endif
}

async function syncAll() {
  if(syncingTracks)return;
  tracksValid.value=trackStorageValid();
  if(!tracksValid.value){uni.showModal({title:'轨迹资料格式异常',content:'为避免覆盖定位记录，已停止云同步。请保留应用数据并等待修复。',showCancel:false});return;}
  if (!hasPrivacyConsent("trackCloudSync")) {
    uni.showModal({
      title: "需要轨迹备份授权",
      content: "手动备份或已另行开启的账号自动同步，都需要先在隐私设置中启用云端轨迹备份。",
      showCancel: false,
    });
    return;
  }
  const owner=currentTrackOwner();
  if(!owner){uni.showModal({title:'请先登录',content:'登录统一账号后才能备份轨迹到云端。',showCancel:false});return;}
  const list = listTracks().filter((t) => trackNeedsManualBackup(t,owner));
  const transferCount=list.filter(t=>t.localOwner!==owner||(t.cloudOwner&&t.cloudOwner!==owner)).length;
  if(transferCount>0){
    const accepted=await new Promise<boolean>(resolve=>uni.showModal({title:'确认转入当前账号？',content:`有 ${transferCount} 条轨迹属于其他账号或旧版未记录归属。确认后会将本机轨迹副本上传到当前账号。`,success:r=>resolve(r.confirm===true),fail:()=>resolve(false)}));
    if(!accepted||owner!==currentTrackOwner())return;
  }
  if (list.length === 0) {
    uni.showToast({ title: "没有待同步轨迹", icon: "none" });
    return;
  }
  syncingTracks=true;
  uni.showLoading({ title: "同步中" });
  let okCount = 0,attempted=0,interrupted=false,cloudConflict=false;
  try { for (const t of list) {
    if(owner!==currentTrackOwner()||!hasPrivacyConsent("trackCloudSync")){interrupted=true;break;}
    attempted++;
    const result=await uploadTrackToCloud(t,{restoreDeleted:true,transferAccount:true});if(result.ok)okCount++;else if(result.errMsg.includes('云端轨迹已在其他设备更新'))cloudConflict=true;
    if(owner!==currentTrackOwner()||!hasPrivacyConsent("trackCloudSync")){interrupted=true;break;}
  }} finally { syncingTracks=false;uni.hideLoading(); }
  unsynced.value = listTracks().filter((t) => trackNeedsManualBackup(t,owner)).length;
  const conflict=cloudConflict;
  uni.showToast({ title: interrupted?`已确认 ${okCount} 条；因账号或授权变化停止，${unsynced.value} 条仍待同步`:conflict?`已确认 ${okCount}/${attempted} 条；存在云端新版本，请到云端轨迹恢复最新副本，${unsynced.value} 条仍待同步`:`已确认 ${okCount}/${attempted} 条；${unsynced.value} 条仍待同步`, icon: "none" });
}

async function exportRawTrackStore() {
  const snapshot=rawTrackStoreSnapshot();
  if(!snapshot){uni.showToast({title:'未读取到可导出的本机轨迹资料',icon:'none'});return;}
  const accepted=await new Promise<boolean>(resolve=>uni.showModal({
    title:'导出原始定位资料？',
    content:'备份文件包含精确 GPS 轨迹点，也可能包含格式异常或其他账号的本机记录。文件只保存到你选择的位置或本机剪贴板，不会上传。请仅保存到你信任的位置。',
    confirmText:'继续导出',cancelText:'取消',success:r=>resolve(r.confirm===true),fail:()=>resolve(false)
  }));
  if(!accepted)return;
  const latest=rawTrackStoreSnapshot();
  if(!latest){uni.showToast({title:'原始资料已不可读取，未导出',icon:'none'});return;}
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const name=`徒步地球-本机原始轨迹-${stamp}.${latest.extension}`;
  try{
    const saved=await saveLocalTextFile(name,latest.text,latest.extension==='json'?'application/json':'text/plain');
    if(saved)uni.showToast({title:'已生成本机备份',icon:'success'});
  }catch(error){uni.showModal({title:'备份导出失败',content:error instanceof Error?error.message:'未能保存原始轨迹资料',showCancel:false});}
}

function go(url: string) {
  uni.navigateTo({ url });
}

function offlineTip() {
  uni.showModal({ title: "离线数据", content: "已保存和导入的轨迹保存在本机，箭头导航使用设备定位。地图底图仍需要网络；当前未提供离线地形地图下载。", showCancel: false });
}

function about() {
  uni.showModal({
    title: "徒步地球",
    content: "以 3D 地球发现全球徒步路线。客户端候选版：不构成导航服务或许可，出行以属地公告为准。\\n上游：github.com/hiking-earth/hiking-earth",
    showCancel: false,
  });
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--he-color-background); padding: 20px 16px; box-sizing: border-box; }
.account { display: flex; align-items: center; background: var(--he-color-panel); border-radius: 10px; padding: 16px 12px; }
.avatar { width: 48px; height: 48px; border-radius: 50%; background: var(--he-color-surface); color: var(--he-color-accent); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; }
.acc-info { flex: 1; min-width: 0; margin-left: 12px; display: flex; flex-direction: column; gap: 4px; }
.avatar, .login { flex-shrink: 0; }
.nick { font-size: 16px; font-weight: 600; color: var(--he-color-text); }
.acc-sub { font-size: 11px; color: var(--he-color-muted); }
.login { padding: 0 20px; height: 32px; line-height: 32px; background: var(--he-color-accent); color: var(--he-color-on-accent); font-size: 13px; font-weight: 600; border-radius: 499.5px; }
.group { margin-top: 14px; background: var(--he-color-panel); border-radius: 10px; overflow: hidden; }
.row { display: flex; align-items: center; padding: 14px 12px; border-bottom: 0.5px solid var(--he-color-surface); }
.row:last-child { border-bottom: none; }
.row-icon { font-size: 16px; width: 28px; }
.row-name { flex: 1; font-size: 14px; color: var(--he-color-text); }
.row-sub { font-size: 11px; color: var(--he-color-muted); margin-right: 6px; }
.row-go { font-size: 16px; color: var(--he-color-muted); }
.operations-hint { display: block; padding: 12px; color: var(--he-color-muted); font-size: 11px; line-height: 1.6; }
.ver { margin-top: 24px; text-align: center; font-size: 10px; color: var(--he-color-muted); }
</style>
