<template><view class="terrain-card"><text class="heading">可选离线高程包</text><text class="hint">从你选择的本机ZIP导入，不自动下载或上传。与道路地图共用192 MiB，地形单包最多33 MiB。此端按瓦片显示二维高程晕渲，不含道路与通行许可。</text><button :disabled="busy" @click="choose">选择地形ZIP</button><text class="hint">{{message}}</text><view v-for="row in rows" :key="row.id"><text>{{row.name}} · {{(row.bytes/1048576).toFixed(2)}} MiB</text><text v-if="!row.available" class="hint">{{row.issue}}</text><button :disabled="busy||!row.available" @click="inspect(row)">查看离线地形</button><button :disabled="busy" @click="remove(row.id)">删除</button></view><view v-if="archive"><canvas :canvas-id="canvasId" :id="canvasId" class="terrain-canvas" :width="256" :height="256"/><text class="hint">{{tileInfo}}</text><button :disabled="busy||tileIndex===0" @click="draw(tileIndex-1)">上一瓦片</button><button :disabled="busy||tileIndex>=archive.manifest.tiles.length-1" @click="draw(tileIndex+1)">下一瓦片</button><text class="credits">{{archive.manifest.attribution}} · {{archive.manifest.licenseUrl}}</text></view></view></template>
<script setup lang="ts">
import {ref,shallowRef,markRaw,onMounted,onBeforeUnmount,getCurrentInstance,nextTick} from 'vue';
import {createTerrainFileStore} from '@/services/terrain-file-store';
import type {TerrainArchive} from '@/services/terrain-archive';
import type {SavedMapApi,WechatMapView} from '@/services/wechat-basemap-store';
import {fileRangeReader} from '@/services/basemap-file-reader';
import {decodeTerrainPng,shadeTerrain} from '@/services/terrain-png';
// #ifdef APP-PLUS
import {chooseNativeMapArchive} from '@/services/files';
import {createNativeMapApi} from '@/services/native-map-api';
import {nativeMapRangeReader,nativeArchiveSize,type NativeMapIO} from '@/services/native-basemap-reader';
// #endif
const rows=ref<WechatMapView[]>([]),busy=ref(false),message=ref(''),tileInfo=ref(''),tileIndex=ref(0),archive=shallowRef<TerrainArchive|null>(null);
const canvasId='terrain-'+Math.random().toString(36).slice(2),instance=getCurrentInstance()?.proxy;let disposed=false,store:ReturnType<typeof createTerrainFileStore>|undefined;
const emit=defineEmits<{(e:'changed'):void}>();
function init(){if(store)return store;
 // #ifdef MP-WEIXIN
 const api=uni as unknown as SavedMapApi;store=createTerrainFileStore(api,(path,bytes)=>{const read=fileRangeReader(uni.getFileSystemManager(),path,bytes);return{size:bytes,read:async(o,n)=>new Uint8Array(await read(o,n))};},'wechat');
 // #endif
 // #ifdef APP-PLUS
 const io=plus.io as unknown as NativeMapIO;const api=createNativeMapApi(uni as unknown as Parameters<typeof createNativeMapApi>[0],io,path=>path.startsWith('_doc/')?path:plus.io.convertAbsoluteFileSystem(path),value=>uni.base64ToArrayBuffer(value));store=createTerrainFileStore(api,(path,bytes)=>{const read=nativeMapRangeReader(io,path,bytes,value=>uni.base64ToArrayBuffer(value));return{size:bytes,read:async(o,n)=>new Uint8Array(await read(o,n))};},'native');
 // #endif
 if(!store)throw new Error('当前平台不支持地形文件');return store;
}
async function refresh(){try{rows.value=await init().list();}catch(e){message.value=e instanceof Error?e.message:'目录读取失败';}}
onMounted(refresh);onBeforeUnmount(()=>{disposed=true;archive.value=null;});
async function save(path:string,bytes:number){if(busy.value||disposed)return;busy.value=true;try{await init().import(path,bytes);await refresh();emit('changed');message.value='高程包已校验并保存在本机，没有上传。';}catch(e){message.value=e instanceof Error?e.message:'导入失败';}finally{busy.value=false;}}
async function choose(){if(busy.value)return;
 // #ifdef MP-WEIXIN
 uni.chooseMessageFile({count:1,type:'file',extension:['zip'],success:r=>{const f=r.tempFiles[0];if(f)void save(f.path,f.size);},fail:()=>{message.value='未选择文件';}});
 // #endif
 // #ifdef APP-PLUS
 try{const path=await chooseNativeMapArchive();if(path)await save(path,await nativeArchiveSize(plus.io as unknown as NativeMapIO,path));}catch(e){message.value=e instanceof Error?e.message:'文件选择失败';}
 // #endif
}
async function inspect(row:WechatMapView){if(busy.value||disposed)return;busy.value=true;try{const value=await init().inspect(row.path,row.bytes);if(disposed)return;archive.value=markRaw(value);await nextTick();await draw(0);}catch(e){message.value=e instanceof Error?e.message:'地形读取失败';}finally{busy.value=false;}}
async function draw(index:number){const a=archive.value;if(disposed||!a||!Number.isInteger(index)||index<0||index>=a.manifest.tiles.length)return;try{const row=a.manifest.tiles[index],data=a.tiles.get(row.path);if(!data)throw new Error('缺少瓦片');const shaded=shadeTerrain(decodeTerrainPng(data),row.z,row.y);await new Promise<void>((resolve,reject)=>{uni.canvasPutImageData({canvasId,x:0,y:0,width:256,height:256,data:shaded.pixels,success:()=>resolve(),fail:()=>reject(new Error('当前系统不支持高程画布显示，可保留文件及署名资料'))},instance);});if(disposed)return;tileIndex.value=index;tileInfo.value=`${index+1}/${a.manifest.tiles.length} · z${row.z}/${row.x}/${row.y} · ${shaded.min.toFixed(0)}–${shaded.max.toFixed(0)} 米（参考）`;}catch(e){message.value=e instanceof Error?e.message:'地形绘图失败';}}
function remove(id:string){if(busy.value)return;uni.showModal({title:'删除本机高程包',content:'只删除本机副本，不影响轨迹；请保留原始ZIP。',success:async r=>{if(!r.confirm||busy.value||disposed)return;busy.value=true;try{await init().remove(id);archive.value=null;await refresh();emit('changed');}catch(e){message.value=e instanceof Error?e.message:'删除失败';}finally{busy.value=false;}}});}
</script>
<style scoped>.terrain-card{margin:12px 0;padding:14px;background:var(--he-color-panel);border:1px solid var(--he-color-border);border-radius:14px;color:var(--he-color-text)}.heading{display:block;font-size:17px;font-weight:650}.hint,.credits{display:block;font-size:12px;line-height:1.6;margin:8px 0;color:var(--he-color-muted)}.credits{font-size:10px;overflow-wrap:anywhere}.terrain-canvas{width:256px;height:256px;margin:10px auto}button{margin-top:8px}</style>
