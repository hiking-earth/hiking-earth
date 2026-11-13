<template><view class="map-shell"><button v-if="!online" @click="enableOnline">显示在线底图</button><text class="note">在线底图会向地图服务请求当前视野；轨迹线在本机绘制。离线时可切回本机参考线。</text><button v-if="online" @click="disableOnline">切回离线资料</button><text v-if="error" class="note">{{error}}</text>
<!-- #ifdef H5 --><view v-if="online" :id="containerId" :style="{height:height+'px',width:'100%'}" /><!-- #endif -->
<!-- #ifdef MP-WEIXIN --><map v-if="online" :latitude="nativeCenter.latitude" :longitude="nativeCenter.longitude" :polyline="nativeLines" :markers="nativeMarkers" :scale="14" :layer-style="WECHAT_MAP_LAYER_STYLE" :show-location="false" :style="{height:height+'px',width:'100%'}" @error="mapError" /><!-- #endif -->
<!-- #ifdef APP-PLUS --><map v-if="online" :latitude="nativeCenter.latitude" :longitude="nativeCenter.longitude" :polyline="nativeLines" :markers="nativeMarkers" :scale="14" :show-location="false" :style="{height:height+'px',width:'100%'}" @error="mapError" /><!-- #endif -->
<TrackCanvas v-if="!online" :points="points" :position="position" :height="height" :layers="layers" :attribution="attribution" /></view></template>
<script setup lang="ts">
import { HE_PALETTE } from '@shared/design/palette';
import {createHikingRouteMapStyle} from '@shared/maps/route-map-style';
import {prepareMapViewer} from '@/services/map-viewer';
import {computed,nextTick,onUnmounted,ref,watch} from 'vue';import {toMapPoint} from '@shared/api/coordinates';import TrackCanvas from './TrackCanvas.vue';
// #ifdef MP-WEIXIN
import {WECHAT_MAP_LAYER_STYLE} from '@/services/map-style';
// #endif
// #ifdef H5
import {Map as LibreMap,NavigationControl,LngLatBounds, setWorkerUrl,type GeoJSONSource} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let map:LibreMap|undefined;
// #endif
 type Point={latitude:number;longitude:number;segmentStart?:boolean};
const props=withDefaults(defineProps<{points:Point[];position?:Point|null;height?:number;layers?:[number,number][][];attribution?:string}>(),{height:300,layers:()=>[],attribution:''});const online=ref(false),error=ref('');const containerId=`basemap-${Math.random().toString(36).slice(2)}`;
const segments=computed(()=>{const lines:Point[][]=[];for(const p of props.points){if(!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))continue;if(!lines.length||p.segmentStart)lines.push([]);lines[lines.length-1].push(p);}return lines;});
const nativeCenter=computed(()=>toMapPoint(props.position||props.points[0]||{longitude:104,latitude:35}));
const nativeLines=computed(()=>segments.value.filter(line=>line.length>=2).map(points=>({points:points.map(toMapPoint),color:HE_PALETTE.accent,width:4,dottedLine:false})));
const nativeMarkers=computed(()=>props.position?[{id:1,...toMapPoint(props.position),title:'当前位置',width:24,height:24}]:[]);
function mapError(){error.value='底图未加载，请检查地图服务配置；离线资料仍可查看。';disableOnline();}
function disableOnline(){online.value=false;
 // #ifdef H5
 map?.remove();map=undefined;
 // #endif
}
async function enableOnline(){
 const answer=await uni.showModal({title:'显示在线地图',content:'地图服务会收到当前视野的瓦片请求。是否继续？'});if(!answer.confirm)return;
 // #ifdef APP-PLUS
 prepareMapViewer(props.points,props.position);uni.navigateTo({url:'/pages/map/viewer'});return;
 // #endif
 online.value=true;error.value='';
 // #ifdef H5
 await nextTick();try{const activeMap=new LibreMap({container:containerId,style:createHikingRouteMapStyle(),center:[props.position?.longitude??props.points[0]?.longitude??104,props.position?.latitude??props.points[0]?.latitude??35],zoom:13,attributionControl:{compact:false}});map=activeMap;activeMap.addControl(new NavigationControl());activeMap.on('load',()=>{if(!map)return;activeMap.addSource('local-lines',{type:'geojson',data:{type:'FeatureCollection',features:[]}});activeMap.addLayer({id:'local-lines',type:'line',source:'local-lines',paint:{'line-color':HE_PALETTE.accent,'line-width':4}});activeMap.addSource('local-position',{type:'geojson',data:{type:'FeatureCollection',features:[]}});activeMap.addLayer({id:'local-position',type:'circle',source:'local-position',paint:{'circle-radius':6,'circle-color':HE_PALETTE.info,'circle-stroke-color':'white','circle-stroke-width':2}});updateMap();const bounds=new LngLatBounds();props.points.forEach(p=>bounds.extend([p.longitude,p.latitude]));if(!bounds.isEmpty())activeMap.fitBounds(bounds,{padding:32,maxZoom:16});});activeMap.on('error',()=>{error.value='部分在线地图资料未加载，可切回离线资料。';});}catch{mapError();}
 // #endif
}
// #ifdef H5
function updateMap(){if(!map?.getSource('local-lines'))return;const source=map.getSource('local-lines') as GeoJSONSource;source.setData({type:'FeatureCollection',features:segments.value.filter(line=>line.length>=2).map(line=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:line.map(p=>[p.longitude,p.latitude])}}))});const location=map.getSource('local-position') as GeoJSONSource;location.setData({type:'FeatureCollection',features:props.position?[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[props.position.longitude,props.position.latitude]}}]:[]});}
watch(()=>[props.points,props.position],updateMap,{deep:true});
// #endif
onUnmounted(disableOnline);
</script><style scoped>.map-shell{width:100%}.note{display:block;font-size:12px;color:var(--he-color-muted);padding:10px}button{font-size:14px;margin:10px 0}</style>
