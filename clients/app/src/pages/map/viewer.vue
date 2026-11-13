<template><view class="fallback"><text>{{message}}</text><button @click="back">返回</button></view></template>
<script setup lang="ts">
import {getCurrentInstance,onUnmounted,ref} from 'vue';
import {onReady} from '@dcloudio/uni-app';
import {takeMapViewer} from '@/services/map-viewer';
import {HE_PALETTE} from '@shared/design/palette';
const instance=getCurrentInstance();const message=ref('准备地图…');let viewer:any;
function back(){uni.navigateBack();}
onReady(()=>{
 const data=takeMapViewer();if(!data){message.value='地图资料已失效，请返回重新打开';return;}
 // #ifdef APP-PLUS
 try{const owner=(instance?.proxy as any)?.$getAppWebview();if(!owner)throw new Error('页面未准备好');viewer=plus.webview.create('_www/static/native-map/viewer.html',`map-${Date.now()}`,{top:'0px',bottom:'0px',background:HE_PALETTE.surface},{hikingMapData:data});viewer.addEventListener('error',()=>{message.value='地图加载失败，请返回查看本机资料';viewer?.close();});owner.append(viewer);viewer.show();}catch{message.value='地图打开失败，请返回查看本机资料';}
 // #endif
 // #ifndef APP-PLUS
 message.value='请在路线页面直接查看地图';
 // #endif
});
onUnmounted(()=>{viewer?.close();viewer=null;});
</script><style scoped>.fallback{padding:25px;color:var(--he-color-text);background:var(--he-color-panel);min-height:100vh}</style>
