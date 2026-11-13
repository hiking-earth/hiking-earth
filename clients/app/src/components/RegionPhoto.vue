<template><view v-if="photo" class="region-photo"><button v-if="!shown" @click="showPhoto">查看地区实景（从 Wikimedia 加载）</button><view v-else><text class="notice">点击后会向 Wikimedia Commons 请求图片；该图片只代表拍摄地区，不代表这条路线的实际路况、开放状态或当前景观。</text><image v-if="!failed" :src="photo.imageUrl" mode="widthFix" style="width:100%" @error="failed=true"/><text v-else>图片加载失败，可查看原始来源。</text><button v-if="failed" @click="showPhoto">重试加载图片</button><button @click="shown=false;failed=false">收起图片</button><text>{{photo.title}}</text><text>{{photo.author}} · {{photo.license}}</text><text>{{photo.changes}}</text><button @click="open(photo.sourceUrl)">图片来源与作者</button><button @click="open(photo.licenseUrl)">查看图片许可</button></view></view></template>
<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue';
import {subscribeScenicClock} from '@shared/content/scenic-clock';
import {scenicReviewCurrent} from '@shared/content/scenic-review';
import registry from '@shared/data/content/scenic-images.json';
const props=defineProps<{region:string}>();
const shown=ref(false),failed=ref(false),now=ref(Date.now());
let unsubscribe:(()=>void)|undefined;
onMounted(()=>{unsubscribe=subscribeScenicClock(value=>{now.value=value;});});
onUnmounted(()=>{unsubscribe?.();});
const photo=computed(()=>registry.items.find(item=>scenicReviewCurrent(item,now.value)&&(item.region===props.region||item.matchRegions?.includes(props.region))));
watch(photo,()=>{shown.value=false;failed.value=false;});
watch(()=>props.region,()=>{shown.value=false;failed.value=false;});
function showPhoto(){
 now.value=Date.now();
 if(!photo.value||!scenicReviewCurrent(photo.value,now.value)){shown.value=false;return;}
 shown.value=true;failed.value=false;
}
function open(url:string){
 // #ifdef APP-PLUS
 plus.runtime.openURL(url);return;
 // #endif
 // #ifdef H5
 window.open(url,'_blank','noopener,noreferrer');return;
 // #endif
 // #ifdef MP-WEIXIN
 uni.setClipboardData({data:url});
 // #endif
}
</script>
<style scoped>.region-photo{padding:10px;background:var(--he-color-surface);border-radius:8px;margin:10px 0}text{display:block;margin:6px 0}</style>
