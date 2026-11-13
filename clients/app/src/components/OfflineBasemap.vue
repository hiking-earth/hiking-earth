<template><view><text class="hint">{{message}}</text><view :id="containerId" class="basemap" /></view></template>
<script setup lang="ts">
import {nextTick,onUnmounted,ref,watch} from 'vue';
import {Map as LibreMap,NavigationControl,Marker,setWorkerUrl} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import {openLocalBasemap,localBasemapStyle} from '@/services/local-basemap';
import {placeMapLabels,type MapLabel} from '@/services/basemap-canvas';
import {registerOfflineArchive,releaseOfflineArchive} from '@/services/offline-map-protocol';
setWorkerUrl(workerUrl);
const props=defineProps<{file:Blob|null}>();
const containerId=`offline-basemap-${Math.random().toString(36).slice(2)}`;
const message=ref('选择本机区域地图包');
let map:LibreMap|undefined,key='',generation=0,disposed=false;
let markers:Marker[]=[],labelSignature='';
function clearLabels(){for(const marker of markers)marker.remove();markers=[];labelSignature='';}
function drawLabels(current:LibreMap){
 if(map!==current||disposed||!current.isStyleLoaded())return;
 const candidates:MapLabel[]=[],coordinates=new Map<string,[number,number]>();
 try{layers:for(const layer of ['places','pois'])for(const feature of current.querySourceFeatures('basemap',{sourceLayer:layer}).slice(0,12000)){
  if(feature.geometry.type!=='Point')continue;
  const value=feature.properties?.['name:zh']||feature.properties?.name;if(typeof value!=='string')continue;
  const text=value.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim();if(!text||text.length>64)continue;
  const [lng,lat]=feature.geometry.coordinates;if(!Number.isFinite(lng)||!Number.isFinite(lat)||Math.abs(lat)>85.05112878||Math.abs(lng)>180)continue;
  const pixel=current.project([lng,lat]),rawRank=feature.properties?.min_zoom;const rank=layer==='places'?(typeof rawRank==='number'&&Number.isFinite(rawRank)?Math.max(0,Math.min(30,rawRank)):10):30;const candidate={text,x:pixel.x,y:pixel.y,rank};
  candidates.push(candidate);coordinates.set(JSON.stringify([text,pixel.x,pixel.y]),[lng,lat]);
  if(candidates.length>=4608)break layers;
 }
 const size=current.getCanvas();const labels=placeMapLabels(candidates,size.clientWidth,Math.max(1,size.clientHeight-35));const signature=JSON.stringify(labels);if(signature===labelSignature)return;clearLabels();labelSignature=signature;
 for(const label of labels){const coordinate=coordinates.get(JSON.stringify([label.text,label.x,label.y]));if(!coordinate)continue;const element=document.createElement('span');element.textContent=label.text;element.style.cssText='font:12px system-ui,sans-serif;color:var(--he-color-map-label);background:var(--he-color-panel);padding:2px 4px;border-radius:3px;white-space:nowrap;pointer-events:none';markers.push(new Marker({element,anchor:'center'}).setLngLat(coordinate).addTo(current));}
 }catch{clearLabels();message.value='部分地名读取失败，道路底图仍可查看。';}
}
function clear(){clearLabels();map?.remove();map=undefined;if(key)releaseOfflineArchive(key);key='';}
watch(()=>props.file,async file=>{
 const epoch=++generation;clear();
 if(!file){message.value='选择本机区域地图包';return;}
 message.value='读取本机区域地图…';
 try{
  const local=await openLocalBasemap(`file-${Date.now()}-${Math.random().toString(36).slice(2)}`,file.size,(offset,length)=>file.slice(offset,offset+length).arrayBuffer());
  await nextTick();if(disposed||generation!==epoch)return;
  registerOfflineArchive(local.archive);key=local.key;
  const {header}=local;
  const current=new LibreMap({container:containerId,style:localBasemapStyle(key),bounds:[[header.minLon,header.minLat],[header.maxLon,header.maxLat]],maxBounds:[[header.minLon,header.minLat],[header.maxLon,header.maxLat]],minZoom:header.minZoom,maxZoom:17,fitBoundsOptions:{padding:20},attributionControl:{compact:false}});
  map=current;current.addControl(new NavigationControl());
  current.on('load',()=>{if(!disposed&&generation===epoch){message.value='已读取本机道路、地物及地图包内地名，可断网查看。不含高程。';drawLabels(current);}});
  current.on('moveend',()=>drawLabels(current));current.on('idle',()=>drawLabels(current));
  current.on('error',()=>{if(!disposed&&generation===epoch)message.value='部分地图内容读取失败，请保留地图包后重新选择。';});
 }catch(error){if(!disposed&&generation===epoch){clear();message.value=error instanceof Error?error.message:'本机地图打开失败';}}
},{immediate:true});
onUnmounted(()=>{disposed=true;generation++;clear();});
</script>
<style scoped>.hint{display:block;color:var(--he-color-muted);font-size:13px;line-height:1.7;margin:12px 0}.basemap{height:420px;width:100%;border-radius:12px;overflow:hidden}</style>
