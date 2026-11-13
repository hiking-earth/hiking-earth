<template>
 <view class="inventory">
  <text class="title">全目录人工核验</text>
  <text class="note">含无风险信号及已审核记录；目录收录不代表允许通行。点击路线后读取服务器上的单条审核资料。</text>
  <picker :range="sources" range-key="name" :value="sourceIndex" :disabled="busy || disabled" @change="changeSource"><view class="source">来源：{{sources[sourceIndex].name}} ▾</view></picker>
  <input v-if="isLive" v-model="query" :disabled="busy || disabled" maxlength="100" placeholder="USGS 实时检索：输入至少两个字" @input="invalidateQuery" />
  <text v-if="isLive" class="note">此来源提供实时搜索，不是全量不可变目录；数量仅为本次检索结果。</text>
  <button size="mini" :disabled="busy || disabled" @click="refresh">{{busy?'读取中…':'读取 / 刷新目录'}}</button>
  <text class="note">{{message}}</text>
  <view v-if="loaded">
   <text class="note">{{isLive?'本次检索':'来源目录'}}共 {{total}} 条（不是待审核总数），当前 {{displayStart}}–{{displayEnd}} 条</text>
   <view v-for="route in visibleRoutes" :key="route.id" class="row">
    <text>{{route.name}}</text><text class="note">{{route.region}} · 未读取单条审核状态</text>
    <button size="mini" :disabled="busy || disabled || !usable" @click="select(route)">载入审核资料</button>
   </view>
   <view class="actions"><button size="mini" :disabled="busy || disabled || !usable || position===0" @click="previous">上一页</button><button size="mini" :disabled="busy || disabled || !usable || displayEnd>=total" @click="next">下一页</button></view>
  </view>
 </view>
</template>
<script setup lang="ts">
import {computed,onUnmounted,ref} from 'vue';
import {HE_PALETTE} from '@shared/design/palette';
import {accountSession,onAccountChange} from '@/services/account';
import {browsePublicCatalog,searchPublicCatalog,type PublicCatalogSource} from '@/services/catalog-search';
import type {HikingRoute} from '@shared/types/route';
defineProps<{disabled?:boolean}>();
const emit=defineEmits<{(event:'select',route:{id:string;name:string}):void}>();
const sources:{id:PublicCatalogSource;name:string}[]=[
 {id:'osm',name:'OpenStreetMap'},{id:'usfs',name:'美国林务局'},{id:'hk',name:'香港'},{id:'nzdoc',name:'新西兰 DOC'},{id:'parkscanada',name:'加拿大国家公园'},{id:'nsw-npws',name:'澳大利亚新南威尔士'},{id:'england',name:'英格兰'},{id:'wales',name:'威尔士'},{id:'japan-tokai',name:'日本东海自然步道'},{id:'scotland-argyll',name:'苏格兰 Argyll'},{id:'ni-midulster',name:'北爱尔兰 Mid Ulster'},{id:'norfolk-prow',name:'英国 Norfolk'},{id:'cambridgeshire-prow',name:'英国 Cambridgeshire'},{id:'nps-public-trails',name:'美国国家公园'},{id:'swisstopo-wanderwege',name:'瑞士 swisstopo'},{id:'victoria-recreation-tracks',name:'澳大利亚维多利亚'},{id:'queensland-qpws-trails',name:'澳大利亚昆士兰'},{id:'taiwan-trails',name:'台湾步道'},{id:'korea-durunubi-trails',name:'韩国 Durunubi'},{id:'usgs-trails',name:'USGS 实时搜索'}
];
const sourceIndex=ref(0),query=ref(''),busy=ref(false),loaded=ref(false),usable=ref(false),rows=ref<HikingRoute[]>([]),total=ref(0),position=ref(0),message=ref('选择来源后主动读取，每次最多读取 400 条，仅显示 20 条。');
let generation=0,alive=true,snapshot='',loadedPage=-1;
const isLive=computed(()=>sources[sourceIndex.value].id==='usgs-trails');
const visibleRoutes=computed(()=>isLive.value?rows.value:rows.value.slice(position.value%400,position.value%400+20));
const displayStart=computed(()=>total.value?position.value+1:0);
const displayEnd=computed(()=>position.value+visibleRoutes.value.length);
function reset(){generation++;busy.value=false;loaded.value=false;usable.value=false;rows.value=[];total.value=0;position.value=0;snapshot='';loadedPage=-1;message.value='目录尚未读取。';}
function changeSource(event:any){const index=Number(event.detail.value);if(!Number.isInteger(index)||!sources[index])return;reset();sourceIndex.value=index;}
function invalidateQuery(){reset();}
async function load(target:number){
 if(busy.value)return;
 const source=sources[sourceIndex.value].id,term=query.value.trim();
 if(source==='usgs-trails'&&(term.length<2||term.length>100)){message.value='请输入 2–100 字的检索词。';return;}
 const token=accountSession()?.token;
 if(!token){reset();message.value='登录状态已失效，请重新进入审核页。';return;}
 const current=++generation;busy.value=true;usable.value=false;
 try{
  const page=Math.floor(target/400);
  const result=source==='usgs-trails'?await searchPublicCatalog(source,term,target,snapshot||undefined):await browsePublicCatalog(source,page,snapshot||undefined);
  if(!alive||current!==generation||accountSession()?.token!==token)return;
  rows.value=result.routes;total.value=result.total;snapshot=result.snapshot;loadedPage=page;position.value=target;loaded.value=true;usable.value=true;message.value='仅载入公开目录参考资料；开放、预约及轨迹许可请逐条核验。';
 }catch(error){if(alive&&current===generation){message.value=error instanceof Error?error.message:'目录读取失败，请刷新。';usable.value=false;}}
 finally{if(alive&&current===generation)busy.value=false;}
}
function refresh(){reset();void load(0);}
function move(target:number){if(target<0||target>=total.value)return;if(!isLive.value&&Math.floor(target/400)===loadedPage){position.value=target;return;}void load(target);}
function previous(){move(position.value-20);}
function next(){move(position.value+20);}
function select(route:HikingRoute){if(!usable.value||busy.value)return;emit('select',{id:route.id,name:route.name});message.value='已选择，请在本页下方查看并填写审核表单。';}
const offAccount=onAccountChange(reset);
onUnmounted(()=>{alive=false;reset();offAccount();});
</script>
<style scoped>
.inventory{margin:24rpx 0;padding:24rpx;border:1px solid v-bind('HE_PALETTE.border');border-radius:20rpx;background:v-bind('HE_PALETTE.surface')}
.title{display:block;font-size:32rpx;font-weight:600}.note{display:block;font-size:24rpx;line-height:1.6;color:v-bind('HE_PALETTE.muted');margin:12rpx 0}.source{padding:20rpx 0}.row{padding:20rpx 0;border-bottom:1px solid v-bind('HE_PALETTE.border')}.actions{display:flex;gap:16rpx;margin-top:20rpx}input{padding:16rpx;border:1px solid v-bind('HE_PALETTE.border');margin-bottom:16rpx}button{margin:8rpx 0}
</style>
