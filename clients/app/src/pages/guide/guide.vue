<template>
  <scroll-view scroll-y class="page">
    <view class="intro">
      <text class="intro-title">装备导购</text>
      <text class="intro-sub">个人主体导购模式 · 跳转第三方成交 · 不自营收款</text>
    </view>

    <scroll-view scroll-x class="chips" :show-scrollbar="false">
      <view class="chips-inner">
        <view
          v-for="c in categories" :key="c"
          class="chip" :class="{ on: category === c }"
          @click="category = category === c ? '' : c"
        >{{ c || '全部' }}</view>
      </view>
    </scroll-view>

    <text v-if="error" class="notice">{{error}}</text>
    <button :disabled="loading" @click="load">{{loading ? "正在加载" : "更新导购资料"}}</button>
    <view class="list">
      <view v-for="it in filtered" :key="it.id" class="card" @click="open(it)">
        <view class="card-l">
          <text class="card-title">{{ it.title }}</text>
          <text class="card-summary">{{ it.summary }}</text>
          <view class="card-foot">
            <text class="cat">{{ it.category }}</text>
            <text v-if="it.sourcePlatform && it.sourcePlatform !== 'unknown'" class="platform">{{ platformName(it.sourcePlatform) }}</text>
            <text v-if="it.priceHint" class="price">{{ it.priceHint }}</text>
            <text v-if="it.expiresAt" class="expiry">有效至 {{ new Date(it.expiresAt).toLocaleDateString() }}</text>
          </view>
        </view>
        <text class="go">›</text>
      </view>
      <view v-if="filtered.length === 0" class="empty">
        <text>{{ emptyMessage }}</text>
        <view v-if="!loading && !error && items.length === 0" class="empty-action" @click="openGearPlanner">
          <text>打开装备识别与行前清单</text><text>›</text>
        </view>
      </view>
    </view>

    <view class="notice">导购链接跳转至第三方平台成交，价格、库存与售后以第三方为准；本应用不收取货款。部分链接可能属于平台联盟推广链接，平台可能按其规则向本应用运营者提供推广收益。</view>
  </scroll-view>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow, onHide, onUnload } from "@dcloudio/uni-app";
import type { GuideItem } from "@shared/types/social";
import { callCloud } from "@/services/cloud";

const items = ref<GuideItem[]>([]);
const category = ref("");
const loading=ref(false),error=ref("");
const categories = ["", "鞋靴", "背包", "服装", "露营", "导航", "应急", "其他"];
let visible = false, loadEpoch = 0;
const emptyMessage = computed(() =>
  loading.value ? "正在加载" : error.value ? "未取得导购资料" : category.value ? `${category.value}暂无已发布的导购条目` : "暂无已核验授权并发布的商品条目",
);

function safeLink(value:unknown):value is string {
  return typeof value === "string" && value.length <= 2048 && /^https:\/\/[^\s/@:#?]+(?:\:443)?\/[^\\\s\u0000-\u001f\u007f]*$/.test(value);
}
async function load() {
  if(loading.value)return;
  const requestEpoch = ++loadEpoch;
  const isCurrent = () => visible && requestEpoch === loadEpoch;
  loading.value=true;error.value="";
  try {
    const res=await callCloud<{items:GuideItem[]}>("guide-list");
    if(!isCurrent())return;
    if(!res.ok || !res.data || !Array.isArray(res.data.items))throw new Error("未取得导购资料，请稍后重试");
    const rows=res.data.items;
    if(rows.length>100 || rows.some(i=>!i || typeof i.id!=="string" || !i.id || typeof i.title!=="string" || !i.title.trim() || i.title.length>200 || typeof i.summary!=="string" || i.summary.length>2000 || !categories.includes(i.category) || !i.category || !safeLink(i.link) || i.sourcePlatform!==undefined&&!['taobao','jd','pdd','xianyu','other','unknown'].includes(i.sourcePlatform) || i.expiresAt!==undefined&&!Number.isSafeInteger(i.expiresAt)) || new Set(rows.map(i=>i.id)).size!==rows.length)throw new Error("导购资料格式有误，请稍后重试");
    items.value=rows;
  }catch(e){if(isCurrent()){items.value=[];error.value=e instanceof Error?e.message:"加载失败，请稍后重试";}}
  finally{if(requestEpoch===loadEpoch)loading.value=false;}
}
onShow(()=>{visible=true;void load();});
onHide(()=>{visible=false;loadEpoch++;loading.value=false;});
onUnload(()=>{visible=false;loadEpoch++;loading.value=false;});

const filtered = computed(() =>
  category.value ? items.value.filter((i) => i.category === category.value) : items.value,
);

function open(it: GuideItem) {
  if (!safeLink(it.link)) {
    uni.showToast({ title: "导购链接待配置", icon: "none" });
    return;
  }
  // #ifdef H5
  window.open(it.link, "_blank", "noopener,noreferrer");
  // #endif
  // #ifdef APP-PLUS
  plus.runtime.openURL(it.link);
  // #endif
  // #ifdef MP-WEIXIN
  uni.setClipboardData({
    data: it.link,
    success: () => uni.showToast({ title: "链接已复制，去浏览器打开", icon: "none" }),
  });
  // #endif
}

function platformName(id:string){return ({taobao:'淘宝/淘宝联盟',jd:'京东/京东联盟',pdd:'拼多多/多多进宝',xianyu:'闲鱼合作方',other:'授权来源'} as Record<string,string>)[id]||'其他来源';}

function openGearPlanner() {
  uni.navigateTo({ url: "/pages/gear/scan" });
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--he-color-background); }
.intro { padding: 20px 16px 8px; }
.intro-title { display: block; font-size: 22px; font-weight: 700; color: var(--he-color-text); }
.intro-sub { display: block; margin-top: 4px; font-size: 11px; color: var(--he-color-muted); }
.chips { white-space: nowrap; padding: 4px 0; }
.chips-inner { display: inline-flex; gap: 8px; padding: 0 16px; }
.chip { padding: 5px 12px; font-size: 12px; color: var(--he-color-muted); background: var(--he-color-surface); border-radius: 499.5px; }
.chip.on { color: var(--he-color-on-accent); background: var(--he-color-accent); font-weight: 600; }
.list { padding: 8px 16px 0; }
.card { display: flex; align-items: center; background: var(--he-color-panel); border-radius: var(--he-card-radius, 16px); padding: 14px 12px; margin-bottom: 8px; }
.card-l { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.card-title { font-size: 15px; font-weight: 600; color: var(--he-color-text); }
.card-summary { font-size: 12px; color: var(--he-color-muted); line-height: 1.5; }
.card-foot { display: flex; gap: 8px; margin-top: 2px; }
.cat { font-size: 10px; color: var(--he-color-accent); background: var(--he-color-surface); padding: 2px 7px; border-radius: 4px; }
.platform,.expiry { font-size: 10px; color: var(--he-color-muted); }
.price { font-size: 11px; color: var(--he-color-warning); }
.go { font-size: 20px; color: var(--he-color-muted); }
.empty { text-align: center; color: var(--he-color-muted); font-size: 12px; padding: 32px 0; }
.empty-action { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 16px auto 0; padding: 11px 14px; width: fit-content; color: var(--he-color-on-accent); background: var(--he-color-accent); border-radius: 999px; font-size: 13px; font-weight: 600; }
.notice { margin: 12px 16px 32px; font-size: 10px; color: var(--he-color-muted); line-height: 1.7; }
</style>
