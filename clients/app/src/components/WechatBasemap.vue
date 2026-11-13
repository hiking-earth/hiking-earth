<template><view><canvas :id="id" :canvas-id="id" class="map" /><view class="controls"><button class="control-button" size="mini" @click="pan(-1,0)">西</button><button class="control-button" size="mini" @click="pan(1,0)">东</button><button class="control-button" size="mini" @click="pan(0,-1)">北</button><button class="control-button" size="mini" @click="pan(0,1)">南</button><button class="control-button" size="mini" @click="zoom(1)">＋</button><button class="control-button" size="mini" @click="zoom(-1)">－</button></view><text class="hint">{{status}}</text><text class="hint">© OpenStreetMap contributors · Protomaps · ODbL。道路地物底图，地名取自地图包；不含高程及步道开放许可。</text></view></template>
<script setup lang="ts">
import { HE_PALETTE } from '@shared/design/palette';
import {getCurrentInstance,onMounted,onUnmounted,ref,watch,nextTick} from 'vue';
import {openLocalBasemap} from '@/services/local-basemap';
import {fileRangeReader} from '@/services/basemap-file-reader';
// #ifdef APP-PLUS
import {nativeMapRangeReader,type NativeMapIO} from '@/services/native-basemap-reader';
// #endif
import {decodeMapShapes,decodeMapLabels,placeMapLabels,mapTileCenter} from '@/services/basemap-canvas';
const props=defineProps<{filePath:string;bytes:number}>(),instance=getCurrentInstance();
const id=`basemap-${Math.random().toString(36).slice(2,10)}`,status=ref('正在读取本机地图');
let generation=0,disposed=false,width=300,archive:Awaited<ReturnType<typeof openLocalBasemap>>|null=null,z=0,x=0,y=0;
function shapeColor(layer:string,kind:string){
 if(layer==='earth')return HE_PALETTE.mapOcean;
 if(layer==='landuse')return ({wood:HE_PALETTE.mapWood,grass:HE_PALETTE.mapGrass,ice:HE_PALETTE.mapIce,sand:HE_PALETTE.mapSand} as Record<string,string>)[kind]||HE_PALETTE.mapLand;
 if(layer==='water')return HE_PALETTE.mapWater;
 if(layer==='buildings')return HE_PALETTE.mapBuilding;
 if(kind==='path'||kind==='track')return HE_PALETTE.accent;
 if(kind==='motorway'||kind==='trunk')return HE_PALETTE.mapRoadTrunk;
 if(kind==='primary'||kind==='secondary')return HE_PALETTE.mapRoadPrimary;
 return layer==='roads'?HE_PALETTE.mapRoad:HE_PALETTE.mapBoundary;
}
async function open(){const token=++generation;archive=null;status.value='正在读取本机地图';try{
 let read: (offset:number,length:number)=>Promise<ArrayBuffer>;
 // #ifdef MP-WEIXIN
 read=fileRangeReader(uni.getFileSystemManager(),props.filePath,props.bytes);
 // #endif
 // #ifdef APP-PLUS
 read=nativeMapRangeReader(plus.io as unknown as NativeMapIO,props.filePath,props.bytes,value=>uni.base64ToArrayBuffer(value));
 // #endif
 // #ifndef APP-PLUS || MP-WEIXIN
 throw new Error('当前平台不支持原生文件地图');
 // #endif
 // Each open gets a distinct PMTiles cache identity, even for replaced same-size files.
 const result=await openLocalBasemap(`local-${Date.now()}-${Math.random().toString(36).slice(2,12)}`,props.bytes,read!);
 if(disposed||token!==generation)return;archive=result;z=result.header.maxZoom;const h=result.header,c=mapTileCenter((h.minLon+h.maxLon)/2,(h.minLat+h.maxLat)/2,z);x=c.x;y=c.y;await draw();
}catch{if(!disposed&&token===generation)status.value='地图读取失败，请保留原始地图包';}}
async function draw(){const current=archive;if(!current||disposed)return;const token=++generation;
 status.value='正在绘制本机地图';try{
 const tiles: {dx:number;dy:number;shapes:ReturnType<typeof decodeMapShapes>;labels:ReturnType<typeof decodeMapLabels>}[]=[];
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  if(disposed||token!==generation)return;const tx=x+dx,ty=y+dy;if(tx<0||ty<0||tx>=2**z||ty>=2**z)continue;
  const tile=await current.archive.getZxy(z,tx,ty);if(tile)tiles.push({dx,dy,shapes:decodeMapShapes(tile.data),labels:decodeMapLabels(tile.data)});
 }
 if(disposed||token!==generation)return;await nextTick();if(disposed||token!==generation)return;
 const ctx=uni.createCanvasContext(id,instance?.proxy),size=256,left=(width-size)/2,top=(320-size)/2;
 ctx.setFillStyle(HE_PALETTE.mapOcean);ctx.fillRect(0,0,width,320);
 // Draw layers across all tiles before roads, so adjacent polygons cannot hide paths.
 for(const layer of ['earth','landuse','water','buildings','roads','boundaries'])for(const tile of tiles)for(const shape of tile.shapes){
  if(shape.layer!==layer)continue;ctx.beginPath();
  for(const path of shape.paths){path.forEach((p,i)=>{const px=left+(tile.dx+p.x)*size,py=top+(tile.dy+p.y)*size;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);});if(shape.type===3)ctx.closePath();}
  const color=shapeColor(layer,shape.kind);
  if(shape.type===3){ctx.setFillStyle(color);ctx.fill();}else{ctx.setStrokeStyle(color);ctx.setLineWidth(layer==='roads'?1.5:1);ctx.stroke();}
 }
 const labels=placeMapLabels(tiles.flatMap(tile=>tile.labels.map(label=>({...label,x:left+(tile.dx+label.x)*size,y:top+(tile.dy+label.y)*size}))),width,320);
 ctx.setFontSize(12);ctx.setTextAlign('center');ctx.setTextBaseline('middle');
 for(const label of labels){ctx.setFillStyle(HE_PALETTE.panel);ctx.fillRect(label.x-label.width/2,label.y-9,label.width,18);ctx.setFillStyle(HE_PALETTE.mapLabel);ctx.fillText(label.text,label.x,label.y);}
 ctx.draw(false,()=>{if(!disposed&&token===generation)status.value=`本机底图 · 缩放 ${z} · ${tiles.length} 块瓦片`;});
 }catch{if(!disposed&&token===generation)status.value='地图绘制失败，请保留原始地图包';}}
function pan(dx:number,dy:number){if(!archive)return;const h=archive.header,a=mapTileCenter(h.minLon,h.maxLat,z),b=mapTileCenter(h.maxLon,h.minLat,z);x=Math.max(a.x,Math.min(b.x,x+dx));y=Math.max(a.y,Math.min(b.y,y+dy));void draw();}
function zoom(delta:number){if(!archive)return;const next=Math.max(archive.header.minZoom,Math.min(archive.header.maxZoom,z+delta)),factor=2**(next-z);x=Math.floor((x+.5)*factor);y=Math.floor((y+.5)*factor);z=next;pan(0,0);}
onMounted(()=>{uni.createSelectorQuery().in(instance?.proxy).select(`#${id}`).boundingClientRect((r:any)=>{if(r?.width)width=r.width;void open();}).exec();});
watch(()=>[props.filePath,props.bytes],()=>void open());onUnmounted(()=>{disposed=true;generation++;archive=null;});
</script>
<style scoped>.map{width:100%;height:320px;background:var(--he-color-map-ocean)}.controls{display:flex;flex-wrap:wrap;gap:4px}.control-button{font-size:12px}.hint{display:block;font-size:12px;color:var(--he-color-muted);padding:8px}</style>
