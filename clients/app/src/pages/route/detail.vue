<template>
  <scroll-view scroll-y class="page" v-if="route">
    <image v-if="route.image" class="banner" :src="route.image" mode="aspectFill" />
    <view class="body">
      <view class="head">
        <view class="dot" :style="{ background: STATUS_COLORS[route.status] }"></view>
        <text class="status">{{ route.status }}</text>
        <text class="region">{{ route.region }}</text>
      </view>
<RegionPhoto :region="route.region" />
<text class="name">{{ route.name }}</text>
      <button @click="favorite">{{ favorited ? '取消收藏' : '收藏路线' }}</button>

      <view class="grid">
        <view class="cell"><text class="cell-v">{{ route.distance }}</text><text class="cell-k">里程</text></view>
        <view class="cell"><text class="cell-v">{{ route.ascent }}</text><text class="cell-k">爬升</text></view>
        <view class="cell"><text class="cell-v">{{ route.duration }}</text><text class="cell-k">用时</text></view>
        <view class="cell"><text class="cell-v">{{ route.difficulty }}</text><text class="cell-k">难度</text></view>
      </view>

      <view class="section">
        <text class="sec-title">概况</text>
        <text class="sec-text">{{ route.summary }}</text>
      </view>
      <view class="section">
        <text class="sec-title">亮点</text>
        <view class="hl" v-for="h in route.archive.highlights" :key="h">
          <text class="hl-dot">·</text><text class="sec-text">{{ h }}</text>
        </view>
      </view>
      <view class="section">
        <text class="sec-title">路线区域天气预报</text>
        <text v-if="forecast?.status === 'available' && forecast.weather" class="sec-text">{{ forecast.weather.temperature }} · 风 {{ forecast.weather.wind }} · 湿度 {{ forecast.weather.humidity }} · {{ forecast.weather.rain }}</text>
        <text v-if="forecast?.providerNotice" class="sec-sub">{{ forecast.providerNotice }}</text>
        <text class="sec-sub">{{ forecast?.status === 'available' ? `预报时刻 ${forecast.weather?.observedAt}` : forecast?.message || '正在获取预报…' }}</text>
        <text v-if="forecast?.status === 'available' && forecast.weather?.fetchedAt" class="sec-sub">数据获取时间：{{ forecast.weather.fetchedAt }}（UTC）</text>
        <text class="sec-sub">天气数据由 MET Norway 提供，本应用将预报字段转换展示；数据依据 CC BY 4.0 许可。全球预报覆盖，北欧/北极以外约9公里网格、每天更新4次。复杂地形的风速可能无法反映山脊与山谷差异。本页只查询路线中心坐标、不使用海拔；不能代替属地预警，也不能证明路线开放。</text>
        <text class="external-link" @tap="openExternalLink('https://api.met.no/doc/TermsOfService')">查看 MET Norway 天气服务条款</text>
        <text class="external-link" @tap="openExternalLink('https://creativecommons.org/licenses/by/4.0/')">查看 CC BY 4.0 数据许可</text>
        <view v-if="forecast?.status === 'available' && weatherAdvice.available" class="weather-gear">
          <text class="sec-title">天气装备提示（预报参考）</text>
          <text v-for="item in weatherAdvice.items" :key="item" class="sec-text">· {{ item }}</text>
          <text v-for="notice in weatherAdvice.notices" :key="notice" class="sec-sub">{{ notice }}</text>
        </view>
        <text v-else-if="forecast?.status === 'unavailable'" class="sec-sub">天气不可用，未应用天气装备调整；请查看属地预警。</text>
        <button :disabled="forecastBusy" @click="loadForecast(true)">刷新天气预报</button>
      </view>
      <view class="section warn">
        <text class="sec-title">风险提示</text>
        <text class="sec-text">{{ route.archive.riskNotice }}</text>
      </view>
      <view class="section">
        <text class="sec-title">资料来源</text>
        <text class="sec-text">{{ route.archive.source.label }}</text>
        <text v-if="sourceUrl" class="external-link" @tap="openExternalLink(sourceUrl)">查看来源原文</text>
        <text class="sec-sub">{{ route.archive.checkedAt }} · 图片：{{ route.imageCredit }}</text>
        <text class="sec-sub validity-note">{{ routeValidityMessage }}</text>
      </view>
      <view class="section meta">
        <text class="sec-text">最佳季节 {{ route.bestSeason }} · {{ route.packStyle }} · {{ route.overnight }} · {{ route.surface }}</text>
      </view>
    </view>

    <view class="footer">
      <button v-if="navigable" class="btn primary he-primary" @click="startNav">开始导航</button>
      <button v-else class="btn disabled" disabled>该路线不开放导航</button>
    </view>
  <button v-if="route" @click="openSocial">路线留言与日记</button>
    </scroll-view>
</template>

<script setup lang="ts">
function openSocial(){if(route.value)uni.navigateTo({url:`/pages/companion/social?tab=comments&routeId=${encodeURIComponent(route.value.id)}`});}
import RegionPhoto from '@/components/RegionPhoto.vue';
import { readLibrary, toggleFavorite } from '@/services/library';
import { computed, ref } from "vue";
import { onLoad, onShow, onHide, onUnload } from "@dcloudio/uni-app";
import { routeForecast, type RouteForecast } from '@/services/weather';
import { weatherGearAdvice } from '@shared/weather-gear-advice';
import { ROUTES } from "@/services/route-catalog";
import { STATUS_COLORS, isNavigable, type HikingRoute } from "@shared/types/route";

const route = ref<HikingRoute | null>(null);
const favorited = ref(false);
const sourceUrl = computed(() => safeExternalUrl(route.value?.archive.source.url));
const routeValidityMessage = computed(() => {
  const selected = route.value;
  if (!selected) return '';
  if (selected.status === '永久关闭') return '资料标记为永久关闭，不提供导航。';
  if (selected.status === '临时关闭') return '资料标记为临时关闭，不提供导航。';
  if (selected.status === '待核验') return '开放状态尚未核验；路线资料不能作为通行许可或导航依据。';
  const expiresAt = selected.openingExpiresAt;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return '开放核验期限缺失或已过期；当前资料不能作为开放或导航依据。';
  }
  const statusLabel = selected.status === '即将开放' ? '本次即将开放资料' : '本次开放资料';
  return `${statusLabel}有效至 ${new Date(expiresAt).toLocaleString()}；出行前仍须查看属地官方原文。`;
});
const forecast=ref<RouteForecast|null>(null),forecastBusy=ref(false);
const weatherAdvice=computed(()=>weatherGearAdvice(forecast.value?.status==='available'?forecast.value.weather:null));
let forecastRefreshTimer:ReturnType<typeof setInterval>|undefined;
async function loadForecast(force=false){if(!route.value||forecastBusy.value)return;const selected=route.value;forecastBusy.value=true;try{const value=await routeForecast(selected.center,force);if(route.value?.id===selected.id)forecast.value=value;}catch{if(route.value?.id===selected.id)forecast.value={status:'unavailable',message:'天气预报暂不可用，请查属地预警。',sourceUrl:'https://api.met.no/doc/TermsOfService'};}finally{forecastBusy.value=false;}}
function safeExternalUrl(value: unknown): string {
 if (typeof value !== 'string' || value.length > 2048) return '';
 try {
  const url = new URL(value.trim());
  return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.port ? url.href : '';
 } catch { return ''; }
}
function openExternalLink(url:string){
 const safeUrl = safeExternalUrl(url);
 if (!safeUrl) { uni.showToast({title:'来源链接无效',icon:'none'}); return; }
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
function favorite() { if (route.value) { try { favorited.value = toggleFavorite(route.value.id); } catch (e) { uni.showToast({ title: String(e), icon: 'none' }); } } }

onLoad((q) => {
  const id = q?.id as string;
  route.value = ROUTES.find((r) => r.id === id) ?? null;
  favorited.value = readLibrary().favorites.includes(id);
  if (route.value) { uni.setNavigationBarTitle({ title: route.value.name }); void loadForecast(); }
});
onShow(()=>{
  if(forecastRefreshTimer)clearInterval(forecastRefreshTimer);
  forecastRefreshTimer=setInterval(()=>{void loadForecast(true);},30*60*1000);
  // Reuse the route-coordinate cache on page return. The explicit refresh
  // button and long-lived page timer remain the only forced refresh paths.
  if(route.value)void loadForecast();
});
function stopForecastRefresh(){if(forecastRefreshTimer){clearInterval(forecastRefreshTimer);forecastRefreshTimer=undefined;}}
onHide(stopForecastRefresh);onUnload(stopForecastRefresh);

const navigable = computed(() => (route.value ? isNavigable(route.value) : false));

function startNav() {
  if (!route.value) return;
  uni.navigateTo({ url: `/pages/navigation/session?routeId=${route.value.id}` });
}
</script>

<style lang="scss" scoped>
.page { height: 100vh; background: var(--he-color-background); }
.banner { width: 100%; height: 210px; }
.body { padding: 16px; padding-bottom: 80px; }
.head { display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.status { font-size: 12px; color: var(--he-color-muted); }
.region { margin-left: auto; font-size: 12px; color: var(--he-color-muted); }
.name { display: block; margin-top: 6px; font-size: 22px; font-weight: 700; color: var(--he-color-text); }
.grid { display: flex; margin-top: 14px; background: var(--he-color-panel); border-radius: 10px; padding: 12px 0; }
.cell { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.cell-v { font-size: 13px; font-weight: 600; color: var(--he-color-text); }
.cell-k { font-size: 10px; color: var(--he-color-muted); }
.section { margin-top: 16px; }
.sec-title { display: block; font-size: 14px; font-weight: 600; color: var(--he-color-text); margin-bottom: 6px; }
.sec-text { font-size: 13px; color: var(--he-color-muted); line-height: 1.7; }
.sec-sub { display: block; margin-top: 4px; font-size: 11px; color: var(--he-color-muted); }
.validity-note { color: var(--he-color-text); }
.external-link { display: block; margin-top: 6px; color: var(--he-color-accent); font-size: 11px; text-decoration: underline; }
.weather-gear { margin-top: 10px; padding: 10px 12px; background: var(--he-color-surface); border-radius: 10px; }
.weather-gear .sec-title { margin-top: 0; }
.hl { display: flex; gap: 4px; }
.hl-dot { color: var(--he-color-accent); }
.warn .sec-title { color: var(--he-color-caution); }
.footer { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: linear-gradient(transparent, var(--he-color-background) 30%); }
.btn { border-radius: 499.5px; font-size: 15px; font-weight: 600; }
.btn.primary { background: var(--he-color-accent); color: var(--he-color-on-accent); }
.btn.disabled { background: var(--he-color-surface); color: var(--he-color-muted); }
</style>
