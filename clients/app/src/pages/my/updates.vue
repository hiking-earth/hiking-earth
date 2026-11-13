<template>
  <scroll-view scroll-y class="page">
    <view class="card"><text class="title">自动同步</text><text>开启后，收藏和行程会在同一账号的各端自动同步；已完成轨迹只有同时在隐私设置中开启“云端轨迹备份”后才会自动同步。关闭自动同步会停止后续自动上传；手动轨迹备份由“云端轨迹备份”授权单独控制。关闭任一开关都不会删除已存在的云端资料。自动同步默认关闭。</text>
      <view class="row"><text>当前账号自动同步</text><switch :color="HE_PALETTE.accent" :checked="enabled" :disabled="!signedIn" @change="toggle" /></view>
      <text v-if="!signedIn">登录统一账号后，才能在本机与其他设备之间同步资料。</text>
      <button v-if="!signedIn" class="he-primary" @click="openAccount">登录统一账号</button>
      <text>后台同步暂停，回到前台后继续。不会自动申请定位或共享位置。</text>
      <text v-if="syncState.lastSuccess">上次同步：{{ new Date(syncState.lastSuccess).toLocaleString() }}</text>
      <text v-if="syncState.continuing">云端轨迹较多，正在分批同步；后台暂停后会在回到前台时继续。</text>
      <text v-if="syncState.error" class="error">{{ syncState.error }}</text>
      <button class="he-primary" :disabled="!enabled || syncState.running" @click="syncNow(true)">{{ syncState.running?'同步中…':'立即同步' }}</button>
      <button v-if="syncState.conflict" @click="goConflict">处理收藏与行程冲突</button>
    </view>
    <view class="card"><text class="title">版本更新</text><text>当前客户端 {{ APP_VERSION }}。App启动或回到前台时自动检查，每六小时最多一次；网页随网站发布更新；微信小程序由微信在启动时检查。</text>
      <text v-if="updateState.available">新版本 {{ updateState.version }} · {{ updateState.notes }}</text>
      <text v-if="updateState.message" class="error">{{ updateState.message }}</text>
      <text v-if="updateState.installing && isDesktop()">正在验证并安装桌面更新，完成后将自动重新打开</text>
      <text v-else-if="updateState.installing">正在准备更新 {{ updateState.progress }}%</text>
      <!-- #ifndef MP-WEIXIN -->
      <button :disabled="updateState.checking || updateState.installing" @click="checkForUpdate(true)">{{ updateState.checking?'检查中…':'检查版本' }}</button>
      <!-- #endif -->
      <button v-if="updateState.available" class="he-primary" :disabled="updateState.installing" @click="install">更新并重新打开</button>
      <text>更新前请保存当前工作。桌面和原生 App 会校验后安装；微信小程序由微信管理下载与重启；网页/PWA 由网站更新服务处理。系统要求安装授权时，再按提示确认。</text>
    </view>
  </scroll-view>
</template>
<script setup lang="ts">
import { HE_PALETTE } from '@shared/design/palette';
import { isDesktop } from '@/services/desktop';
import {ref} from 'vue';
import {onShow,onUnload} from '@dcloudio/uni-app';
import {autoSyncEnabled,setAutoSync,syncNow,syncState} from '@/services/sync';
import {accountSession,onAccountChange} from '@/services/account';
import {APP_VERSION,checkForUpdate,applyUpdate,updateState} from '@/services/updates';
const enabled=ref(false),signedIn=ref(!!accountSession());
onShow(()=>{signedIn.value=!!accountSession();enabled.value=autoSyncEnabled();});
const unsubscribeAccount=onAccountChange(()=>{signedIn.value=!!accountSession();enabled.value=autoSyncEnabled();});
onUnload(unsubscribeAccount);
function openAccount(){uni.navigateTo({url:'/pages/account/account'});}
async function toggle(event:Event){
  if(!(event as Event & {detail:{value:boolean}}).detail.value){try{setAutoSync(false);enabled.value=false;}catch(e:any){signedIn.value=!!accountSession();enabled.value=autoSyncEnabled();uni.showToast({title:e.message,icon:'none'});}return;}
  const original=accountSession();
  if(!original){signedIn.value=false;enabled.value=false;uni.showToast({title:'请先登录统一账号',icon:'none'});return;}
  const result=await uni.showModal({title:'开启自动同步',content:'将本机收藏、行程以及已授权备份的完成轨迹同步到当前账号；其他设备可恢复。账号切换后需单独开启。'});
  const current=accountSession();
  if(!current||current.openid!==original.openid||current.token!==original.token){signedIn.value=!!current;enabled.value=autoSyncEnabled();uni.showToast({title:'账号已变化，请重新确认同步',icon:'none'});return;}
  if(!result.confirm){enabled.value=autoSyncEnabled();return;}
  try{setAutoSync(true);enabled.value=true;}catch(e:any){enabled.value=false;uni.showToast({title:e.message,icon:'none'});}
}
function goConflict(){uni.navigateTo({url:'/pages/library/library'});}
async function install(){const result=await uni.showModal({title:'更新客户端',content:'请先保存当前工作。确认后下载更新；系统可能要求安装或重启。'});if(result.confirm)await applyUpdate();}
</script>
<style scoped>
.page{min-height:100vh;background:var(--he-color-background);padding:12px;box-sizing:border-box;color:var(--he-color-text)}.card{background:var(--he-color-surface);border-radius: var(--he-card-radius, 16px);padding:14px;margin-bottom:12px;display:flex;flex-direction:column;gap:10px}.title{font-size:18px;font-weight:700}.row{display:flex;align-items:center;justify-content:space-between}.error{color:var(--he-color-warning)}
</style>
