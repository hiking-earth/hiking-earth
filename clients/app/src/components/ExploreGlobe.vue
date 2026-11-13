<template>
 <view class="globe-shell">
  <canvas :id="textureId" :canvas-id="textureId" class="earth-photo" :width="photoCanvasSize" :height="photoCanvasSize" :style="photoStyle" />
  <canvas :id="id" :canvas-id="id" class="globe-canvas" :width="canvasWidth" :height="height" :style="{height:height+'px'}" @touchstart="start" @touchmove.stop.prevent="move" @touchend="end" @touchcancel="cancel" />
  <view class="globe-tools"><button class="globe-tool" aria-label="放大地球" @click="zoomBy(1.2)">＋</button><button class="globe-tool" aria-label="缩小地球" @click="zoomBy(1/1.2)">−</button><button class="globe-tool reset" @click="reset">全球</button></view>
  <view v-if="renderNotice" class="globe-render-notice" role="status"><text>{{ renderNotice }}</text><button @click="retryRender">重试</button></view>
  <text class="globe-credit">NASA Earth Observatory Blue Marble（2004年6月历史合成，非实时）</text>
 </view>
</template>
<script setup lang="ts">
import {getCurrentInstance,onMounted,onUnmounted,nextTick,watch,ref} from 'vue';
import {renderEarth} from './earth-texture-renderer';
import {projectGlobe,prioritizeSelectedGlobeRoute,rotateGlobe} from './globe-projection';
import {globePoint,globeTouchDistance,hitGlobePin} from './globe-input';
import {HE_PALETTE} from '@shared/design/palette';
import {STATUS_COLORS,type RouteStatus} from '@shared/types/route';
const props=defineProps<{routes:{id:string;center:[number,number];status?:RouteStatus}[];selectedId?:string;pageScrollTop?:number}>();
const emit=defineEmits<{(e:'select',id:string):void}>();
const id='earth-'+Math.random().toString(36).slice(2,9),instance=getCurrentInstance();
// Match the 1024px source texture on capable desktop/tablet screens while
// keeping smaller and low-power devices on bounded raster sizes. Interaction
// frames still use the lower previewResolution below.
const windowInfo=uni.getWindowInfo();let lowPowerDevice=false;
// #ifdef H5
const navigatorInfo=typeof navigator!=='undefined'?navigator as Navigator&{deviceMemory?:number}:undefined;
lowPowerDevice=Boolean(navigatorInfo&&((navigatorInfo.deviceMemory||8)<=4||(navigatorInfo.hardwareConcurrency||8)<=4));
// #endif
const narrowViewport=windowInfo.windowWidth<600;
let resolution=narrowViewport?(lowPowerDevice?512:640):(lowPowerDevice?768:1024);
// Mini Program canvasPutImageData serializes the full RGBA buffer across the
// simulator/native bridge. A 256px raster keeps the initial transfer to 256 KiB
// (about 56% less than the previous 384px payload); H5 and desktop retain their
// higher-resolution adaptive path.
// #ifdef MP-WEIXIN
resolution=Math.min(resolution,256);
// #endif
const preferredResolution=resolution,renderNotice=ref('');
const previewResolution=windowInfo.windowWidth<600?160:224;
const textureId=id+'-photo',photoCanvasSize=ref(resolution),canvasWidth=ref(400),photoStyle=ref<Record<string,string>>({width:resolution+'px',height:resolution+'px',left:'0px',top:'0px'});
const height=ref(400);let width=400,lon=105,lat=28,zoom=1,disposed=false,queued=false,interacting=false,textureGeneration=0;
let wheelPreviewTimer:ReturnType<typeof setTimeout>|undefined;
let touch:{x:number;y:number}|null=null,origin:{x:number;y:number}|null=null,moved=false,pinch=0;
let hits:{id:string;x:number;y:number}[]=[];
let canvasBounds={left:0,top:0};
function point(e:any,ending=false){
 // #ifdef H5
 const rect=nativeCanvas?.getBoundingClientRect();if(rect)canvasBounds={left:rect.left,top:rect.top};
 // #endif
 return globePoint(e,{...canvasBounds,scrollTop:props.pageScrollTop||0},ending);
}
function distance(e:any){return globeTouchDistance(e);}
function start(e:any){if(wheelPreviewTimer)clearTimeout(wheelPreviewTimer);wheelPreviewTimer=undefined;touch=point(e);origin=touch;moved=false;pinch=distance(e);interacting=true;schedule();}
function move(e:any){if(!touch)return;const p=point(e),d=distance(e);if(!p)return;if(d&&pinch){zoom=Math.max(.8,Math.min(3,zoom*d/pinch));moved=true;}else{const v=rotateGlobe(lon,lat,p.x-touch.x,p.y-touch.y,Math.min(width,height.value)/2);lon=v.lon;lat=v.lat;if(origin&&Math.hypot(p.x-origin.x,p.y-origin.y)>5)moved=true;}touch=p;pinch=d;schedule();}
function mouseStart(e:any){start(e);}
function mouseMove(e:any){if(e.buttons===1)move(e);}
function cancel(){touch=null;origin=null;pinch=0;interacting=false;schedule();}
function end(e:any){if(!moved&&touch){const p=point(e,true),hit=p&&hitGlobePin(hits,p);if(hit)emit('select',hit.id);}cancel();}
function wheel(e:any){e.preventDefault?.();zoom=Math.max(.8,Math.min(3,zoom*(e.deltaY>0?.92:1.08)));interacting=true;if(wheelPreviewTimer)clearTimeout(wheelPreviewTimer);wheelPreviewTimer=setTimeout(()=>{wheelPreviewTimer=undefined;interacting=false;schedule();},120);schedule();}
function zoomBy(f:number){zoom=Math.max(.8,Math.min(3,zoom*f));schedule();}
function reset(){lon=105;lat=28;zoom=1;schedule();}
function retryRender(){resolution=preferredResolution;renderNotice.value='';schedule();}
function schedule(){if(queued||disposed)return;queued=true;setTimeout(()=>{queued=false;if(!disposed)draw();},16);}
function lowerRenderResolution(size:number,generation:number){
 if(disposed||generation!==textureGeneration||interacting)return;
 if(size>192){resolution=Math.max(192,Math.floor(size/2));renderNotice.value='当前设备渲染资源有限，已降低地球清晰度';schedule();}
 else renderNotice.value='地球暂时无法显示，请重试';
}
function drawRouteMarker(ctx:any,x:number,y:number,route:{id:string;status?:RouteStatus}){
 const selected=route.id===props.selectedId;
 if(selected){ctx.beginPath();ctx.arc(x,y-21,16,0,Math.PI*2);ctx.setStrokeStyle(HE_PALETTE.accent);ctx.setLineWidth(2);ctx.stroke();}
 ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x-4,y-5,x-13,y-12,x-13,y-21);ctx.bezierCurveTo(x-13,y-35,x+13,y-35,x+13,y-21);ctx.bezierCurveTo(x+13,y-12,x+4,y-5,x,y);ctx.closePath();
 ctx.setFillStyle(route.status?STATUS_COLORS[route.status]:HE_PALETTE.routeMarker);ctx.fill();ctx.setStrokeStyle('rgba(255,255,255,.85)');ctx.setLineWidth(1.6);ctx.stroke();
 ctx.beginPath();ctx.arc(x,y-21,3.5,0,Math.PI*2);ctx.setFillStyle('#132014');ctx.fill();
}
function draw(){
 const ctx=uni.createCanvasContext(id,instance?.proxy),h=height.value,cx=width/2,cy=width<600?h*.60:h/2+12,r=Math.min(width*.43,h*(width<600?.32:.39))*zoom,size=interacting?previewResolution:resolution;
 const generation=++textureGeneration;
 ctx.clearRect(0,0,width,h);
 photoCanvasSize.value=size;
 photoStyle.value={width:size+'px',height:size+'px',left:(cx-r)+'px',top:(cy-r)+'px',transform:'scale('+2*r/size+')'};
 let rgba:Uint8ClampedArray|undefined;
 try{rgba=renderEarth(size,lon,lat);}catch{lowerRenderResolution(size,generation);}
 if(rgba)void nextTick(()=>{
  if(disposed||generation!==textureGeneration)return;
  try{uni.canvasPutImageData({canvasId:textureId,x:0,y:0,width:size,height:size,data:rgba!,success:()=>{if(!disposed&&generation===textureGeneration)renderNotice.value='';},fail:()=>lowerRenderResolution(size,generation)},instance?.proxy);}
  catch{lowerRenderResolution(size,generation);}
 });
 const markers:{route:{id:string;center:[number,number];status?:RouteStatus};x:number;y:number}[]=[],cells=new Set<string>();for(const route of prioritizeSelectedGlobeRoute(props.routes,props.selectedId)){const v=projectGlobe(route.center[0],route.center[1],lon,lat);if(v.z<.04)continue;const x=cx+v.x*r,y=cy-v.y*r,key=Math.floor(x/18)+':'+Math.floor(y/18);if(cells.has(key)&&route.id!==props.selectedId)continue;cells.add(key);if(markers.length>=240)break;markers.push({route,x,y});}
 const drawOrder=markers.filter(item=>item.route.id!==props.selectedId).concat(markers.filter(item=>item.route.id===props.selectedId));hits=drawOrder.map(({route,x,y})=>({id:route.id,x,y}));for(const marker of drawOrder)drawRouteMarker(ctx,marker.x,marker.y,marker.route);
 ctx.draw();
}
async function measure(){await nextTick();uni.createSelectorQuery().in(instance?.proxy).select('#'+id).boundingClientRect((v:any)=>{if(v?.width){width=v.width;canvasWidth.value=Math.max(1,Math.round(v.width));canvasBounds={left:v.left,top:v.top};void nextTick(schedule);}}).exec();}
function resize(){const w=uni.getWindowInfo();height.value=w.windowWidth>=800?Math.max(360,w.windowHeight-162):Math.max(360,w.windowHeight);void measure();}
// #ifdef H5
let nativeCanvas:HTMLElement|null=null;
const mouseBindings=[['mousedown',mouseStart],['mousemove',mouseMove],['mouseup',end],['mouseleave',cancel],['wheel',wheel]] as const;
// #endif
onMounted(async()=>{resize();uni.onWindowResize(resize);
 // #ifdef H5
 await nextTick();nativeCanvas=document.getElementById(id);for(const [name,handler] of mouseBindings)nativeCanvas?.addEventListener(name,handler as EventListener,{passive:false});
 // #endif
});onUnmounted(()=>{disposed=true;if(wheelPreviewTimer)clearTimeout(wheelPreviewTimer);wheelPreviewTimer=undefined;uni.offWindowResize(resize);
 // #ifdef H5
 for(const [name,handler] of mouseBindings)nativeCanvas?.removeEventListener(name,handler as EventListener);nativeCanvas=null;
 // #endif
});watch(()=>props.routes,schedule,{deep:false});watch(()=>props.selectedId,()=>{const route=props.routes.find(r=>r.id===props.selectedId);if(route){lon=route.center[0];lat=route.center[1];}schedule();});
</script>
<style scoped>
.globe-shell{position:relative;width:100%;overflow:hidden;background:var(--he-bg, var(--he-color-background));border-radius:24px}.earth-photo{position:absolute;transform-origin:top left;pointer-events:none;border-radius:50%;box-shadow:0 0 20px rgba(var(--he-color-accent-rgb),.24),0 15px 45px rgba(1,3,10,.38)}.globe-canvas{position:relative;width:100%;touch-action:none}.globe-tools{position:absolute;right:18px;bottom:42px;display:flex;gap:6px}.globe-tool{width:36px;height:36px;line-height:34px;padding:0;margin:0;background:var(--he-overlay, rgba(5,12,18,.84));color:var(--he-text, var(--he-color-text));border:1px solid var(--he-overlay-border, rgba(255,255,255,.12));border-radius:var(--he-control-radius, 12px);font-size:20px;backdrop-filter:blur(12px)}.reset{width:52px;font-size:12px}.globe-credit{position:absolute;bottom:16px;left:20px;font-size:10px;color:var(--he-muted, var(--he-color-muted))}.globe-render-notice{position:absolute;z-index:2;top:12px;left:12px;right:104px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--he-overlay-border, rgba(255,255,255,.12));border-radius:var(--he-control-radius, 12px);background:var(--he-overlay, rgba(5,12,18,.88));color:var(--he-text, var(--he-color-text));font-size:12px}.globe-render-notice button{flex:none;margin:0;padding:4px 10px;border-radius:999px;background:var(--he-color-accent);color:var(--he-color-on-accent);font-size:12px}
@media(max-width:900px){.globe-tools{top:78px;right:14px;bottom:auto}.globe-credit{bottom:calc(var(--he-home-mobile-panel-height, 49vh) + 74px);left:14px}}
</style>
