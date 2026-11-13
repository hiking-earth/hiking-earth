<template>
  <scroll-view scroll-y class="page">
    <view class="intro">
      <text class="intro-title">拍照识装备</text>
      <text class="intro-sub">选择照片，获取图像检测候选和出行核对清单</text>
    </view>

    <!-- #ifdef H5 || APP-PLUS -->
    <view class="sec scan-provider">
      <text class="sec-title">识别方式</text>
      <view class="scan-modes">
        <view class="scan-mode" :class="{ active: scanMode === 'local' }" @tap="scanMode = 'local'">本机识别（默认）</view>
        <view class="scan-mode" :class="{ active: scanMode === 'cloud' }" @tap="scanMode = 'cloud'">云端 AI（需授权）</view>
      </view>
      <text class="notice">本机模式不上传照片。云端模式需登录并在隐私设置单独授权；服务端优先使用已配置的千问免费额度。只有服务端所有者单独启用付费 DeepSeek 后，千问失败时才会转交；否则会停止本次识别。</text>
    </view>
    <!-- #endif -->

    <!-- 选路线（可选，影响规划建议） -->
    <RouteSearchPicker v-model="routeId" placeholder="搜索或选择关联路线（可选，让规划更准）" @selected="onRouteSelected" />

    <view class="sec planning">
      <text class="sec-title">行前规划</text>
      <picker mode="date" :value="departureDate" @change="onDepartureDate">
        <view class="date-picker">计划出发日期：{{ departureDate || '请选择' }}</view>
      </picker>
      <view class="pack-modes"><button v-for="mode in gearModes" :key="mode" :class="{ active: gearMode === mode }" @click="gearMode = mode">{{ mode }}</button></view>
      <text class="forecast-hint">{{ forecastHint }}</text>
      <view v-if="routeWeather?.status === 'available'" class="forecast-attribution">
        <text class="forecast-link" @tap="openExternalLink('https://api.met.no/doc/TermsOfService')">查看 MET Norway 天气服务条款</text>
        <text class="forecast-link" @tap="openExternalLink('https://creativecommons.org/licenses/by/4.0/')">查看 CC BY 4.0 数据许可</text>
      </view>
    </view>

    <!-- 拍照区 -->
    <view class="shot" @click="chooseImage">
      <image v-if="imagePath" :src="imagePath" mode="aspectFill" class="shot-img" />
      <view v-else class="shot-empty">
        <text class="shot-icon">📷</text>
        <text class="shot-text">拍照或从相册选择</text>
      </view>
    </view>

    <button class="btn primary he-primary" :disabled="!imagePath || analyzing" @click="analyze">
      {{ analyzing ? '识别中…' : '开始识别' }}
    </button>

    <!-- 识别结果 -->
    <template v-if="result">
      <view class="sec">
        <text class="sec-title">识别到的装备（{{ result.items.length }}）</text>
        <text class="result-source">识别来源：{{ resultSourceLabel }}</text>
        <view v-for="(it, i) in result.items" :key="i" class="item">
          <text class="item-name">{{ it.name }}</text>
          <text class="item-cat">{{ it.category }}</text>
        </view>
      </view>

      <view class="sec" v-if="result.missing.length">
        <text class="sec-title warn">还缺这些（按优先级）</text>
        <view v-for="(m, i) in result.missing" :key="i" class="item">
          <text class="item-name">{{ m.name }}</text>
          <text class="item-why">{{ m.reason }}</text>
        </view>
      </view>

      <view class="sec" v-if="result.usage.length">
        <text class="sec-title">使用要点</text>
        <view v-for="(u, i) in result.usage" :key="i" class="usage">
          <text class="usage-dot">·</text><text class="usage-text">{{ u }}</text>
        </view>
      </view>

    </template>

    <view class="sec" v-if="gearAdvice">
      <text class="sec-title">规划提醒</text>
      <view v-for="(notice, i) in gearAdvice.notices" :key="`notice-${i}`" class="usage">
        <text class="usage-dot">·</text><text class="usage-text">{{ notice }}</text>
      </view>
    </view>
    <view class="sec" v-if="planItems.length">
      <text class="sec-title accent">出行装备清单（可勾选）</text>
      <view v-for="(name, i) in planItems" :key="`${name}-${i}`" class="plan" @click="togglePlan(name)">
        <view class="check" :class="{ on: checkedPlan[name] }">{{ checkedPlan[name] ? '✓' : '' }}</view>
        <text class="plan-text" :class="{ done: checkedPlan[name] }">{{ name }}</text>
      </view>
      <text class="notice">清单按路线资料、出发日期、负重方式和可用的当前坐标天气规则生成，不是从照片推断缺失装备；请核对属地公告和现场情况。</text>
    </view>

    <view v-if="scanMode === 'local'" class="notice">本机图像检测：照片不上传，模型首次使用会读取约19 MB资料。仅识别部分通用物体；候选结果须本人确认，不能判断完整装备或安全性。</view>
    <view v-else class="notice">云端识别须登录并在隐私设置主动授权：点击开始后，所选照片（最多4 MB）及可选路线名称会发送到徒步地球云端。服务端优先使用已配置的千问免费额度；只有服务端所有者单独启用付费 DeepSeek 后，千问失败时才会转交；否则会停止本次识别。默认模型可能是徒步地球自托管 CPU 候选检测；具体来源显示在结果中。照片不会写入徒步地球业务数据库。请用 JPEG 或 PNG，候选结果须本人确认。</view>
  </scroll-view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
// #ifdef H5 || APP-PLUS
import { analyzeGearLocally } from "@/services/gear-local";
// #endif
declare const plus: any;
import RouteSearchPicker from '@/components/RouteSearchPicker.vue';
import { callCloud } from "@/services/cloud";
import {onShow,onHide,onUnload} from "@dcloudio/uni-app";
import {accountSession,onAccountChange} from "@/services/account";
import { hasPrivacyConsent,onPrivacyChange } from "@/services/privacy";
import {createPhotoSelection} from '@/services/photo-selection';
import {routeForecast,type RouteForecast} from '@/services/weather';
import {buildGearAdvice,type GearMode} from '@shared/gear-advice';
import type {HikingRoute} from '@shared/types/route';

type GearItem = { name: string; category: string };
type GearResult = {
  items: GearItem[];
  missing: { name: string; reason: string }[];
  usage: string[];
  plan: { name: string; checked: boolean }[];
  provider?: string;
  model?: string;
};

const scanMode = ref<'local' | 'cloud'>('local');
// #ifdef MP-WEIXIN
scanMode.value = 'cloud';
// #endif
const routeId = ref("");
const routeName = ref("");
const selectedRoute=ref<HikingRoute|null>(null);
const departureDate=ref(''),gearMode=ref<GearMode>('轻装'),gearModes:GearMode[]=['轻装','中度','重装'];
const routeWeather=ref<RouteForecast|null>(null),weatherLoading=ref(false),checkedPlan=ref<Record<string,boolean>>({});
const imagePath = ref("");
const analyzing = ref(false);
const result = ref<GearResult | null>(null);
const resultSourceLabel = computed(() => {
  const labels: Record<string, string> = {
    device: '本机通用物体候选检测',
    'cloud-cpu': '徒步地球云端免费 CPU 候选检测',
    qwen: '通义千问视觉模型',
    deepseek: 'DeepSeek 视觉模型',
  };
  const provider = result.value?.provider || 'device';
  const model = result.value?.model;
  return `${labels[provider] || '服务端识别'}${model ? `（${model}）` : ''}`;
});
const gearAdvice=computed(()=>selectedRoute.value?buildGearAdvice(selectedRoute.value,gearMode.value,departureDate.value,routeWeather.value?.status==='available'?routeWeather.value.weather:undefined):null);
const planItems=computed(()=>gearAdvice.value?.items??result.value?.plan.map(item=>item.name)??[]);
function localToday(){const today=new Date();return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;}
const forecastHint=computed(()=>!selectedRoute.value?'选择路线并将出发日期设为今天后，才会请求该路线坐标天气；不读取当前定位。':!departureDate.value?'请选择计划出发日期；只有选定今天时才请求路线坐标天气。':departureDate.value!==localToday()?'当前天气仅用于今天；所选日期不是今天，因此不会请求或使用路线天气。':weatherLoading.value?'正在读取该路线坐标的近期天气预报…':routeWeather.value?.status==='available'?`路线坐标近期预报：${routeWeather.value.weather?.temperature}，降水 ${routeWeather.value.weather?.rain}，风 ${routeWeather.value.weather?.wind}。数据获取时间 ${routeWeather.value.weather?.fetchedAt}（UTC）。MET Norway · CC BY 4.0。全球预报在北欧/北极以外约为9公里网格、每天更新4次，复杂地形风速可能不代表局地。${routeWeather.value.providerNotice?` ${routeWeather.value.providerNotice}`:''}`:'路线坐标天气暂不可用；清单不会据此添加天气装备。');
function openExternalLink(value:string){
  let safeUrl='';try{const url=new URL(value);if(url.protocol==='https:'&&url.hostname&&!url.username&&!url.password&&!url.port)safeUrl=url.href;}catch{}
  if(!safeUrl){uni.showToast({title:'来源链接无效',icon:'none'});return;}
  // #ifdef APP-PLUS
  plus.runtime.openURL(safeUrl);return;
  // #endif
  // #ifdef H5
  window.open(safeUrl,'_blank','noopener,noreferrer');return;
  // #endif
  // #ifdef MP-WEIXIN
  uni.setClipboardData({data:safeUrl,success:()=>uni.showToast({title:'链接已复制，可在浏览器打开',icon:'none'})});
  // #endif
}
function onDepartureDate(event:any){departureDate.value=String(event?.detail?.value||'');}
function togglePlan(name:string){checkedPlan.value={...checkedPlan.value,[name]:!checkedPlan.value[name]};}

let generation=0,weatherGeneration=0,visible=true;
function invalidate(){generation++;analyzing.value=false;result.value=null;}
function loadRouteWeather(route:HikingRoute|null){
  const request=++weatherGeneration;weatherLoading.value=false;routeWeather.value=null;
  if(!route||departureDate.value!==localToday())return;
  weatherLoading.value=true;
  void routeForecast(route.center).then(value=>{if(request===weatherGeneration&&selectedRoute.value?.id===route.id)routeWeather.value=value;}).catch(()=>{if(request===weatherGeneration&&selectedRoute.value?.id===route.id)routeWeather.value={status:'unavailable',message:'天气预报暂不可用',sourceUrl:'https://api.met.no/doc/TermsOfService'};}).finally(()=>{if(request===weatherGeneration)weatherLoading.value=false;});
}
const photoSelection=createPhotoSelection(()=>accountSession()?.token,path=>{imagePath.value=path;result.value=null;});
const offAccount=onAccountChange(()=>{photoSelection.reset();invalidate();imagePath.value="";});
const offPrivacy=onPrivacyChange(consents=>{if(!consents.gearImageUpload&&scanMode.value==='cloud')invalidate();});
onShow(()=>{visible=true;photoSelection.show();});onHide(()=>{visible=false;photoSelection.hide();invalidate();});onUnload(()=>{visible=false;photoSelection.dispose();invalidate();weatherGeneration++;offAccount();offPrivacy();});
function validResult(value:any):value is GearResult{
 const text=(v:any,max:number)=>typeof v==="string"&&v.trim().length>0&&v.length<=max;
 return !!value&&Array.isArray(value.items)&&value.items.length<=100&&value.items.every((i:any)=>i&&text(i.name,200)&&text(i.category,100))&&Array.isArray(value.missing)&&value.missing.length<=100&&value.missing.every((i:any)=>i&&text(i.name,200)&&text(i.reason,1000))&&Array.isArray(value.usage)&&value.usage.length<=30&&value.usage.every((i:any)=>text(i,1000))&&Array.isArray(value.plan)&&value.plan.length<=100&&value.plan.every((i:any)=>i&&text(i.name,200))&&(value.provider===undefined||text(value.provider,32))&&(value.model===undefined||text(value.model,100));
}
function onRouteSelected(route: HikingRoute | null) {
  invalidate();
  routeId.value = route?.id ?? "";
  routeName.value = route?.name ?? "";
  selectedRoute.value=route;checkedPlan.value={};
  loadRouteWeather(route);
}
watch(departureDate,()=>loadRouteWeather(selectedRoute.value));
watch([departureDate,gearMode,planItems],()=>{checkedPlan.value={};});
watch(scanMode,()=>invalidate());

function chooseImage() {
  if(analyzing.value)return;
  invalidate();
  const ticket=photoSelection.begin();
  uni.chooseImage({
    count: 1,
    sourceType: ["camera", "album"],
    success: (res) => {
      photoSelection.complete(ticket,res.tempFilePaths[0]);
    },
  });
}

async function analyze() {
  if (!imagePath.value || analyzing.value) return;
  if (scanMode.value === 'cloud' && !accountSession()) {
    uni.showToast({ title: '云端识别需要先登录徒步地球账号', icon: 'none' });
    return;
  }
  if (scanMode.value === 'cloud' && !hasPrivacyConsent("gearImageUpload")) {
    uni.showModal({
      title: "需要照片分析授权",
      content: "云端识别会将你选中的照片（最多4 MB）及可选路线名称发送到徒步地球服务。服务端优先使用千问免费额度；DeepSeek 只有服务端所有者单独启用付费后才可能作为备选。请先阅读说明，并在“我的 → 隐私设置”中启用装备照片云端分析。",
      showCancel: false,
    });
    return;
  }
  analyzing.value = true;
  const epoch=++generation,path=imagePath.value,selectedRoute=routeId.value,selectedName=routeName.value,token=accountSession()?.token;
  const requiresUpload=scanMode.value==='cloud';
  const current=()=>visible&&epoch===generation&&(!requiresUpload||hasPrivacyConsent("gearImageUpload"))&&accountSession()?.token===token&&imagePath.value===path&&routeId.value===selectedRoute;
  try {
    if (scanMode.value === 'local') {
      // #ifdef H5
      const localResult=await analyzeGearLocally(path);
      if(current())result.value={...localResult,provider:'device',plan:localResult.plan.map(p=>({...p,checked:false}))};
      // #endif
      // #ifdef APP-PLUS
      const dataUrl=await readAppImageDataUrl(path);
      if(!current())return;
      const localResult=await analyzeGearLocally(dataUrl);
      if(current())result.value={...localResult,provider:'device',plan:localResult.plan.map(p=>({...p,checked:false}))};
      // #endif
    } else {
      const base64=await readImageBase64(path);
      if(!current())return;
      if(base64.length>Math.ceil(4*1024*1024/3)*4)throw new Error("请选择4 MB以内的照片");
      const res = await callCloud<any>("gear-scan", { image: base64, routeId: selectedRoute, routeName: selectedName });
      if(!current())return;
      if (res.ok && validResult(res.data)) {
        const provider=['cloud-cpu','qwen','deepseek'].includes(res.data.provider) ? res.data.provider : 'cloud-cpu';
        result.value = {
          items:res.data.items,missing:res.data.missing,usage:res.data.usage,provider,
          ...(typeof res.data.model==='string'&&res.data.model.length<=100?{model:res.data.model}:{}),
          plan: (res.data.plan ?? []).map((p: any) => ({ name: p.name ?? p, checked: false })),
        };
      } else {
        uni.showToast({ title: res.errMsg ?? "识别失败", icon: "none" });
      }
    }
  } catch (e) {
    if(!current())return;
    uni.showToast({ title: e instanceof Error ? e.message : "图片读取或识别失败", icon: "none" });
  } finally {
    if(epoch===generation)analyzing.value = false;
  }
}

async function readImageBase64(path:string):Promise<string>{
  let dataUrl='';
  // #ifdef H5
  dataUrl=await readH5ImageDataUrl(path);
  // #endif
  // #ifdef APP-PLUS
  dataUrl=await readAppImageDataUrl(path);
  // #endif
  // #ifdef MP-WEIXIN
  return readAsBase64(path);
  // #endif
  const match=dataUrl.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+=*)$/);
  if(!match)throw new Error('云端识别目前仅接受 JPEG 或 PNG 图片');
  return match[2];
}

// #ifdef H5
function readH5ImageDataUrl(path:string):Promise<string>{
  return new Promise((resolve,reject)=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    void fetch(path,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('无法读取所选照片');
      const blob=await response.blob();
      if(!blob.size||blob.size>4*1024*1024)throw new Error('请选择4 MB以内的照片');
      if(!['image/jpeg','image/png'].includes(blob.type.toLowerCase()))throw new Error('云端识别目前仅接受 JPEG 或 PNG 图片');
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('无法读取所选照片'));
      reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('照片读取结果无效'));
      reader.readAsDataURL(blob);
    }).catch(error=>reject(error instanceof Error&&error.name==='AbortError'?new Error('读取照片超时，请重试'):error)).finally(()=>clearTimeout(timeout));
  });
}
// #endif

// #ifdef APP-PLUS
function readAppImageDataUrl(path:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  let settled=false,reader:any,timeout:ReturnType<typeof setTimeout>;
  const finish=(error?:Error,value?:string)=>{
   if(settled)return;
   settled=true;clearTimeout(timeout);
   if(error)reject(error);else resolve(value||'');
  };
  const unavailable=()=>finish(new Error('无法在本机读取所选照片'));
  timeout=setTimeout(()=>{
   if(settled)return;
   settled=true;
   try{reader?.abort?.();}catch{}
   reject(new Error('本机读取照片超时，请重新选择后重试'));
  },15000);
  try{plus.io.resolveLocalFileSystemURL(path,(entry:any)=>{
   if(settled)return;
   if(!entry||typeof entry.file!=='function'){unavailable();return;}
   try{entry.file((file:any)=>{
    if(settled)return;
    if(!file||!Number.isFinite(file.size)||file.size<=0||file.size>4*1024*1024){finish(new Error('请选择4 MB以内的照片'));return;}
    try{
     reader=new plus.io.FileReader();
     reader.onload=(event:any)=>{
      const dataUrl=event?.target?.result;
      if(typeof dataUrl!=='string'||!/^data:image\/(jpeg|png|webp|gif);base64,/.test(dataUrl))unavailable();
      else finish(undefined,dataUrl);
     };
     reader.onerror=unavailable;
     reader.onabort=()=>finish(new Error('本机读取照片已取消'));
     reader.readAsDataURL(file);
    }catch{unavailable();}
   },unavailable);}catch{unavailable();}
  },unavailable);}catch{unavailable();}
 });
}
// #endif

// #ifdef MP-WEIXIN
function readAsBase64(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled=false;
    const finish=(error?:Error,value?:string)=>{
      if(settled)return;
      settled=true;clearTimeout(timeout);
      if(error)reject(error);else resolve(value||'');
    };
    const timeout=setTimeout(()=>finish(new Error("读取照片超时，请重新选择后重试")),15000);
    try{uni.getFileInfo({
      filePath: path,
      success: (info: { size: number }) => {
        if(settled)return;
        if (!info || !Number.isFinite(info.size) || info.size <= 0 || info.size > 4 * 1024 * 1024) {
          finish(new Error("请选择 4 MB 以内的照片"));
          return;
        }
        try{uni.getFileSystemManager().readFile({
          filePath: path,
          encoding: "base64",
          success: (res: any) => {
            if(settled)return;
            if(typeof res?.data!=="string")finish(new Error("照片读取结果无效，请重新选择"));
            else finish(undefined,res.data);
          },
          fail: () => finish(new Error("无法读取所选照片")),
        });}catch{finish(new Error("无法读取所选照片"));}
      },
      fail: () => finish(new Error("无法读取所选照片")),
    });}catch{finish(new Error("无法读取所选照片"));}
  });
}
// #endif
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--he-color-background); padding: 16px; box-sizing: border-box; }
.intro-title { display: block; font-size: 22px; font-weight: 700; color: var(--he-color-text); }
.intro-sub { display: block; margin-top: 4px; font-size: 12px; color: var(--he-color-muted); }
.picker { margin-top: 12px; background: var(--he-color-surface); border-radius: 8px; padding: 10px 12px; font-size: 13px; color: var(--he-color-muted); }
.shot { margin-top: 12px; height: 210px; background: var(--he-color-panel); border-radius: 10px; overflow: hidden; }
.shot-img { width: 100%; height: 100%; }
.shot-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.shot-icon { font-size: 36px; }
.shot-text { font-size: 13px; color: var(--he-color-muted); }
.btn.primary { margin-top: 12px; background: var(--he-color-accent); color: var(--he-color-on-accent); font-weight: 600; border-radius: 499.5px; font-size: 15px; }
.btn[disabled] { background: var(--he-color-surface); color: var(--he-color-muted); }
.sec { margin-top: 18px; }
.scan-provider{padding:12px;background:var(--he-color-panel);border-radius:10px}.scan-modes{display:flex;gap:8px}.scan-mode{flex:1;padding:10px 8px;border:1px solid var(--he-color-border);border-radius:8px;text-align:center;color:var(--he-color-muted);font-size:12px}.scan-mode.active{border-color:var(--he-color-accent);background:var(--he-color-surface);color:var(--he-color-text);font-weight:700}.result-source{display:block;margin:-3px 0 8px;color:var(--he-color-muted);font-size:11px}
.planning{padding:12px;background:var(--he-color-panel);border-radius:10px}.date-picker{padding:10px;background:var(--he-color-surface);border-radius:8px;color:var(--he-color-text);font-size:13px}.pack-modes{display:flex;gap:8px;margin-top:8px}.pack-modes button{flex:1;margin:0;background:var(--he-color-surface);color:var(--he-color-muted);font-size:13px}.pack-modes button.active{background:var(--he-color-accent);color:var(--he-color-on-accent);font-weight:700}.forecast-hint{display:block;margin-top:8px;color:var(--he-color-muted);font-size:11px;line-height:1.6}.forecast-attribution{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}.forecast-link{font-size:11px;color:var(--he-color-accent);text-decoration:underline}
.sec-title { display: block; font-size: 14px; font-weight: 600; color: var(--he-color-text); margin-bottom: 8px; }
.sec-title.warn { color: var(--he-color-warning); }
.sec-title.accent { color: var(--he-color-accent); }
.item { display: flex; align-items: center; justify-content: space-between; background: var(--he-color-panel); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; }
.item-name { font-size: 14px; color: var(--he-color-text); }
.item-cat { font-size: 11px; color: var(--he-color-muted); }
.item-why { font-size: 11px; color: var(--he-color-warning); max-width: 60%; text-align: right; }
.usage { display: flex; gap: 6px; margin-bottom: 4px; }
.usage-dot { color: var(--he-color-accent); }
.usage-text { font-size: 13px; color: var(--he-color-muted); line-height: 1.6; }
.plan { display: flex; align-items: center; gap: 10px; background: var(--he-color-panel); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; }
.check { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--he-color-muted); display: flex; align-items: center; justify-content: center; color: var(--he-color-on-accent); font-size: 12px; }
.check.on { background: var(--he-color-accent); border-color: var(--he-color-accent); font-weight: 700; }
.plan-text { font-size: 14px; color: var(--he-color-text); }
.plan-text.done { color: var(--he-color-muted); text-decoration: line-through; }
.notice { margin: 18px 0 32px; font-size: 10px; color: var(--he-color-muted); line-height: 1.7; }
</style>
