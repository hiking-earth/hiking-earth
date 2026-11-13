<template><view class="terrain-preview"><view :id="containerId" class="canvas" /><text class="hint">离线高程地形 · 真实比例（不夸大高程）· 此图不含道路或通行许可</text><text v-if="message" class="hint">{{message}}</text><text class="credits">{{archive.manifest.attribution}}</text></view></template>
<script setup lang="ts">
import {onMounted,onBeforeUnmount,nextTick} from 'vue';
import {Map as TerrainMap,NavigationControl,addProtocol,removeProtocol,type StyleSpecification} from 'maplibre-gl';
import {ref} from 'vue';
import type {TerrainArchive} from '@/services/terrain-archive';
const props=defineProps<{archive:TerrainArchive}>();
const containerId='terrain-'+Math.random().toString(36).slice(2),scheme='heterrain'+Math.random().toString(36).slice(2);
const message=ref('');let map:TerrainMap|undefined,disposed=false,registered=false;
onMounted(async()=>{
 await nextTick();if(disposed)return;
 try{
  addProtocol(scheme,async(request,controller)=>{
   if(disposed||controller.signal.aborted)throw new Error('地形查看已取消');
   const suffix=request.url.slice((scheme+'://').length);
   if(!request.url.startsWith(scheme+'://')||!/^\d+\/\d+\/\d+\.png$/.test(suffix))throw new Error('地形请求无效');
   const bytes=props.archive.tiles.get('tiles/'+suffix);if(!bytes)throw new Error('该瓦片不在离线包中');
   return {data:bytes.slice().buffer};
  });registered=true;
  const manifest=props.archive.manifest;
  const style:StyleSpecification={version:8,sources:{dem:{type:'raster-dem',tiles:[`${scheme}://{z}/{x}/{y}.png`],tileSize:256,encoding:'terrarium',minzoom:manifest.zoom,maxzoom:manifest.zoom,bounds:manifest.bounds,attribution:'Mapzen Terrain Tiles · 完整来源见下方'}},terrain:{source:'dem',exaggeration:1},layers:[{id:'background',type:'background',paint:{'background-color':'#182b27'}},{id:'shade',type:'hillshade',source:'dem',paint:{'hillshade-shadow-color':'#153b32','hillshade-highlight-color':'#d4edbc','hillshade-accent-color':'#5c9c76','hillshade-exaggeration':0.45}}]};
  map=new TerrainMap({container:containerId,style,center:[(manifest.bounds[0]+manifest.bounds[2])/2,(manifest.bounds[1]+manifest.bounds[3])/2],zoom:manifest.zoom,pitch:45,maxZoom:Math.min(20,manifest.zoom+4),attributionControl:{compact:false}});
  map.addControl(new NavigationControl());map.fitBounds([[manifest.bounds[0],manifest.bounds[1]],[manifest.bounds[2],manifest.bounds[3]]],{padding:24,duration:0});
  map.on('error',()=>{message.value='部分离线地形未能显示，请保留原包；本次未请求在线瓦片。';});
 }catch{message.value='当前浏览器不支持离线三维地形，可保留地形包并查看署名资料。';}
});
onBeforeUnmount(()=>{disposed=true;map?.remove();map=undefined;if(registered)removeProtocol(scheme);});
</script>
<style scoped>.canvas{height:340px;min-height:240px;width:100%;border-radius:12px;overflow:hidden}.hint{display:block;margin:8px 0;font-size:12px;color:var(--he-color-muted)}.credits{display:block;font-size:10px;line-height:1.5;color:var(--he-color-muted);overflow-wrap:anywhere}</style>
