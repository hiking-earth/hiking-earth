<template><scroll-view scroll-y class="page" :scroll-into-view="mapScrollTarget" scroll-with-animation>
  <text class="title">离线资料</text>
<!-- #ifdef APP-PLUS --><TerrainPacksMobile @changed="refreshNativeMaps" /><!-- #endif -->
<!-- #ifdef MP-WEIXIN --><TerrainPacksMobile @changed="refreshWechatMaps" /><!-- #endif -->
<!-- #ifdef H5 --><TerrainPacks @changed="refreshBasemaps" /><!-- #endif --><text class="hint">本机轨迹可离线查看。本页可导入你有权使用的WGS84 GeoJSON道路或边界资料，不下载商业地图瓦片，不含地形高程。</text>
  <view v-for="layer in layers" :key="layer.id" class="card"><text class="title">{{ layer.name }}</text><text class="hint">{{ layer.attribution }} · {{ layer.license }} · {{ (layer.bytes/1024).toFixed(0) }} KB</text><button :disabled="busy" @click="activate(layer.id)">{{ active === layer.id ? '正在使用' : '用于轨迹与导航示意' }}</button><button :disabled="busy" @click="remove(layer.id)">删除资料</button></view>
  <TrackCanvas v-if="preview" :points="[]" :layers="preview.paths" :attribution="preview.attribution" />
  <!-- #ifdef H5 || MP-WEIXIN || APP-PLUS -->
  <view class="card"><text class="title">查找位置的离线地图</text><view class="map-coordinates"><view><text class="map-coordinate-label">纬度</text><input class="map-coordinate-input" v-model="mapLatitude" placeholder="例如 22.23" /></view><view><text class="map-coordinate-label">经度</text><input class="map-coordinate-input" v-model="mapLongitude" placeholder="例如 113.95" /></view></view><button :disabled="busy" @click="filterMapLocation">查找覆盖此位置的地图</button><text v-if="mapLocationMessage" class="hint">{{mapLocationMessage}}</text><button v-if="mapLocation" :disabled="busy" @click="mapLocation=null;mapLocationMessage=''">显示全部地区</button><text v-if="mapLocation" class="hint">仅显示目录中已生成、覆盖此位置的地图；没有结果表示暂无已生成的详细包。全球概览不含详细道路。详细矢量地图不覆盖南北纬85.05°以外区域。</text></view>
  <view v-if="mapLocation" class="card"><text class="title">申请免费生成自选区域地图</text><text class="hint">填写地点名称和半径（1–10公里）。确认后只提交你填写的中心坐标、范围与地点名称，并关联当前账号；不会读取实时位置。坐标会发送至CloudBase及GitHub Actions构建服务，生成的地图包发布在公开GitHub Release下载，他人可能从地图内容判断区域。删除申请只删除账号中状态，不会删除已发布的地图包。区域地图由免费构建队列生成，单包受64 MiB限制，不保证每个区域都能成功生成。</text><input class="map-coordinate-input map-request-name" v-model="mapRequestName" maxlength="65" placeholder="地点名称，例如 香港大屿山" /><input class="map-coordinate-input map-request-radius" v-model="mapRequestRadius" type="digit" placeholder="半径（公里，1–10）" /><button :disabled="busy" @click="confirmMapRequest">提交地图申请</button><button :disabled="busy" @click="refreshMapRequests">刷新申请状态</button><text v-if="mapRequestMessage" class="hint">{{mapRequestMessage}}</text><view v-for="request in mapRequests" :key="request.id" class="map-request-row"><text>{{request.name}} · {{request.radiusKm}} km · {{mapRequestStatus(request.status)}}</text><button v-if="request.retryable" :disabled="busy" @click="retryMapRequest(request)">重新排队</button><button v-if="request.downloadUrl" :disabled="busy" @click="openMapRequestDownload(request.downloadUrl)">复制下载链接</button><!-- #ifdef MP-WEIXIN --><button v-if="request.downloadUrl && request.bytes && request.sha256" :disabled="busy" @click="importMapRequestArchive(request)">从微信聊天选择ZIP并导入</button><text v-if="request.downloadUrl" class="hint">先打开下载链接保存ZIP，再将ZIP发到自己的微信聊天（例如文件传输助手），然后在这里选择导入。</text><!-- #endif --><!-- #ifdef APP-PLUS --><button v-if="request.downloadUrl && request.bytes && request.sha256" :disabled="busy" @click="importMapRequestArchive(request)">从系统文件选择ZIP并导入</button><text v-if="request.downloadUrl" class="hint">先打开下载链接，将ZIP保存到“文件”或“下载”目录，再返回此处选择导入。</text><!-- #endif --><!-- #ifdef H5 --><button v-if="request.downloadUrl && request.bytes && request.sha256" :disabled="busy" @click="importMapRequestArchive(request)">从电脑选择ZIP并导入</button><text v-if="request.downloadUrl" class="hint">先打开下载链接保存ZIP，再从电脑文件中选择导入。</text><!-- #endif --><text v-if="request.downloadUrl" class="hint">导入前会校验压缩包、地图文件和来源清单；解压总量受本机192 MiB地图容量限制。</text><text v-if="request.retryable" class="hint">上次免费构建未完成，可以重试此申请，不会占用新的申请名额。</text><text v-if="request.failureCode === 'invalid-request'" class="hint">申请资料无法通过构建前校验，请删除此记录并重新填写地图申请。</text><text v-else-if="request.failureCode && !request.retryable" class="hint">本次免费申请已用完3次构建尝试；申请创建满24小时后可重新提交。</text><button v-if="request.status!=='processing'" :disabled="busy" @click="deleteMapRequest(request)">删除申请记录</button></view></view>
  <!-- #endif -->
  <!-- #ifdef H5 -->
  <text class="title">区域离线底图</text><button :disabled="busy" @click="chooseBasemap">打开本机PMTiles地图包</button><text class="hint">支持最多64 MiB的PMTiles v3矢量地图包。本机读取，不上传；当前为道路和地物视图，导入后保存到本机，总量最多192 MiB。浏览器清理站点数据会删除地图，请保留原包。</text><OfflineMapCapacity :bytes="savedBasemapBytes" /><view v-for="pack in visibleBasemaps" :key="pack.name" class="card"><text>{{pack.label}} · {{(pack.bytes/1048576).toFixed(2)}} MiB</text><text class="hint">{{pack.attribution}} · {{pack.license}}。仅底图，不代表步道开放许可。</text><button class="he-primary" :disabled="busy" @click="downloadMapPack(pack)">下载并保存区域地图</button></view><view v-for="pack in savedBasemaps" :key="pack.id" class="card"><text>{{pack.name}} · {{(pack.bytes/1048576).toFixed(2)}} MiB</text><OfflineMapUpdateNotice :name="pack.name" :catalog="availableBasemaps" :saved="savedBasemaps" :disabled="busy" @download="downloadMapPack" /><button :disabled="busy" @click="viewSavedBasemap(pack.blob)">查看地图</button><button :disabled="busy" @click="removeBasemap(pack.id)">删除地图包</button></view><view v-if="basemapFile" id="offline-map-preview"><OfflineBasemap :file="basemapFile" /></view>
  <!-- #endif -->
  <!-- #ifdef MP-WEIXIN -->
  <text class="title">区域离线底图</text><view v-for="pack in visibleWechatMaps" :key="pack.name" class="card"><text>{{pack.label}} · {{(pack.bytes/1048576).toFixed(2)}} MiB</text><text class="hint">{{pack.attribution}} · {{pack.license}}</text><button class="he-primary" :disabled="busy" @click="downloadWechatMap(pack)">下载并保存区域地图</button></view><button :disabled="busy" @click="chooseWechatBasemap">从聊天文件保存PMTiles地图</button><text class="hint">每包最多64 MiB，总量最多192 MiB，保存在微信本机文件中、不上传。微信清理数据可能删除地图，请保留原包。</text><OfflineMapCapacity :bytes="wechatSavedMapBytes" /><view v-for="pack in wechatSavedMaps" :key="pack.id" class="card"><text>{{pack.name}} · {{(pack.bytes/1048576).toFixed(2)}} MiB</text><text v-if="pack.issue" class="hint">{{pack.issue}}</text><OfflineMapUpdateNotice :name="pack.name" :catalog="wechatAvailableMaps" :saved="wechatSavedMaps" :disabled="busy" @download="downloadWechatMap" /><button :disabled="busy||!pack.available" @click="viewWechatBasemap(pack.id)">查看地图</button><button :disabled="busy" @click="removeWechatBasemap(pack.id)">删除地图包</button></view><view v-if="wechatBasemap" id="offline-map-preview"><WechatBasemap :key="wechatBasemap.path" :file-path="wechatBasemap.path" :bytes="wechatBasemap.bytes" /></view>
  <!-- #endif -->
  <!-- #ifdef APP-PLUS -->
  <text class="title">区域离线底图</text><text class="hint">每包最多64 MiB，本机总量最多192 MiB；道路地物底图不含地名、高程或当前步道开放许可。卸载或清理应用数据会删除地图。</text><OfflineMapCapacity :bytes="nativeSavedMapBytes" />
  <view v-for="pack in visibleNativeMaps" :key="pack.name" class="card"><text>{{pack.label}} · {{(pack.bytes/1048576).toFixed(2)}} MiB</text><text class="hint">{{pack.attribution}} · {{pack.license}}</text><button class="he-primary" :disabled="busy" @click="downloadNativeMap(pack)">下载并保存区域地图</button></view>
  <view v-for="pack in nativeSavedMaps" :key="pack.id" class="card"><text>{{pack.name}} · {{(pack.bytes/1048576).toFixed(2)}} MiB</text><text v-if="pack.issue" class="hint">{{pack.issue}}</text><OfflineMapUpdateNotice :name="pack.name" :catalog="nativeAvailableMaps" :saved="nativeSavedMaps" :disabled="busy" @download="downloadNativeMap" /><button :disabled="busy||!pack.available" @click="viewNativeMap(pack.id)">查看地图</button><button :disabled="busy" @click="removeNativeMap(pack.id)">删除地图包</button></view>
  <view v-if="nativeBasemap" id="offline-map-preview"><NativeBasemap :key="nativeBasemap.path" :file-path="nativeBasemap.path" :bytes="nativeBasemap.bytes" /></view>
  <!-- #endif -->
  <text class="title">全球离线概览</text><button :disabled="busy" @click="saveWorld">保存全球陆地轮廓到本机</button><text class="hint">内置 Natural Earth 公共领域全球陆地轮廓（1:110m），无需联网即可保存和查看。仅供全球概览，不含详细道路、地形高程和导航信息。</text>
  <text class="title">官方参考资料</text><button :disabled="busy" @click="downloadHk">{{downloading ? '下载中…' : '下载香港郊野公园官方步道参考线'}}</button><text class="hint">来源：香港政府渔农自然护理署 / DATA.GOV.HK。参考线不包含底图、高程或当前开放许可；下载后可离线叠加查看。</text>
  <view class="card"><text>前台自动更新已下载的官方参考线</text><switch :color="HE_PALETTE.accent" :checked="offlineUpdateState.enabled" @change="toggleOfficialUpdates" /><text class="hint">默认关闭；开启后联网检查，会使用网络流量。只更新已有官方参考线，删除后不会自动重新下载。{{offlineUpdateState.message}}</text></view>
  <text class="title">导入资料</text>
  <!-- #ifdef APP-PLUS --><button @click="chooseNative">从系统文件选择</button><!-- #endif -->
  <!-- #ifdef H5 --><button @click="choose">选择 JSON 资料</button><!-- #endif -->
  <!-- #ifdef MP-WEIXIN --><button @click="chooseWechat">从聊天文件选择 JSON</button><!-- #endif -->
  <textarea v-model="source" :maxlength="5242880" placeholder="粘贴离线资料JSON内容" class="input" /><button :disabled="busy" @click="save">导入并保存</button><text class="hint">{{ message }}</text>
  <text class="hint">格式：format=hiking-earth-offline-v1，name、attribution、license均必填，geometry为GeoJSON FeatureCollection；支持LineString/MultiLineString/Polygon/MultiPolygon。每份最多5 MB、50000点，总量8 MB。导入后不会上传。</text>
</scroll-view></template>
<script setup lang="ts">
// #ifdef APP-PLUS || MP-WEIXIN
import TerrainPacksMobile from '@/components/TerrainPacksMobile.vue';
import {validateWechatMapInventory as terrainInventory} from '@/services/wechat-basemap-store';
function platformTerrainBytes(platform:'native'|'wechat'){return terrainInventory(uni.getStorageSync(`he_${platform}_terrain_v1`)).reduce((n,r)=>n+r.bytes,0);}
// #endif
// #ifdef H5
import TerrainPacks from '@/components/TerrainPacks.vue';
import {listTerrain} from '@/services/terrain-store';
// #endif
import { HE_PALETTE } from '@shared/design/palette';
import OfflineMapCapacity from '@/components/OfflineMapCapacity.vue';
import OfflineMapUpdateNotice from '@/components/OfflineMapUpdateNotice.vue';
import { assertOfflineMapCapacity } from '@/services/offline-map-limits';
import {offlineUpdateState,setOfficialOfflineUpdates} from '@/services/offline-updates';
import {publicSnapshot} from '@/services/public-data';
import { chooseNativeText, chooseNativeMapArchive, removeNativeMapArchive } from '@/services/files';
import { computed, ref, watch, nextTick } from 'vue';
import { accountRequest, accountSession, onAccountChange } from '@/services/account';
import type { AccountSession } from '@/services/account';
import { readCustomMapArchive } from '@/services/custom-map-archive';
const mapScrollTarget=ref('');
// #ifdef H5 || MP-WEIXIN || APP-PLUS
import {mapsCoveringLocation,PUBLIC_MAP_DISTRIBUTION} from '@/services/basemap-catalog';
const mapLocationMessage=ref('');
const mapLatitude=ref(''),mapLongitude=ref(''),mapLocation=ref<{latitude:number;longitude:number}|null>(null);
const MAX_OFFLINE_MERCATOR_LATITUDE=85.05112878;
function filterMapLocation(){try{if(!mapLatitude.value.trim()||!mapLongitude.value.trim())throw new Error('请填写纬度和经度');const latitude=Number(mapLatitude.value),longitude=Number(mapLongitude.value);mapsCoveringLocation([],latitude,longitude);if(latitude<=-MAX_OFFLINE_MERCATOR_LATITUDE||latitude>=MAX_OFFLINE_MERCATOR_LATITUDE)throw new Error('详细离线矢量地图仅覆盖南北纬85.05°之间；极区可查看全球概览');mapLocation.value={latitude,longitude};mapLocationMessage.value='位置筛选已更新';}catch(e){mapLocationMessage.value=e instanceof Error?e.message:'位置无效';}}
type MapRequest={id:string;name:string;latitude:number;longitude:number;radiusKm:number;status:'queued'|'processing'|'complete'|'failed';retryable?:boolean;downloadUrl?:string;bytes?:number;sha256?:string;failureCode?:string};
const PUBLIC_RELEASE_DISCLOSURE_VERSION='public-map-release-v1';
const mapRequestName=ref(''),mapRequestRadius=ref('5'),mapRequestMessage=ref(''),mapRequests=ref<MapRequest[]>([]);
let mapRequestPageActive=false,mapRequestPollTimer:ReturnType<typeof setTimeout>|undefined;
const mapRequestRefreshes=new Set<string>();
function stopMapRequestPolling(){if(mapRequestPollTimer)clearTimeout(mapRequestPollTimer);mapRequestPollTimer=undefined;}
function scheduleMapRequestPolling(){stopMapRequestPolling();if(!mapRequestPageActive||!mapRequests.value.some(row=>row.status==='queued'||row.status==='processing'))return;mapRequestPollTimer=setTimeout(()=>{mapRequestPollTimer=undefined;void refreshMapRequests();},60_000);}
function mapRequestStatus(status:MapRequest['status']){return status==='queued'?'排队中':status==='processing'?'生成中':status==='complete'?'已生成':status==='failed'?'失败':'状态未知';}
function mapRequestSessionCurrent(expected:AccountSession|null){if(!expected)return false;const current=accountSession();return !!current&&current.openid===expected.openid&&current.token===expected.token;}
async function refreshMapRequests(){const expected=accountSession();if(!expected){mapRequests.value=[];stopMapRequestPolling();return;}const requestKey=`${expected.openid}:${expected.token}`;if(mapRequestRefreshes.has(requestKey))return;mapRequestRefreshes.add(requestKey);try{const result=await accountRequest<{requests:MapRequest[]}>('offline-map-request',{action:'list'});if(!mapRequestSessionCurrent(expected))return;if(!result.ok){if(result.errMsg)mapRequestMessage.value=result.errMsg;return;}const data=result.data;if(data&&Array.isArray(data.requests))mapRequests.value=data.requests;else mapRequestMessage.value='申请状态暂时无法更新，请稍后重试';}catch{if(mapRequestSessionCurrent(expected))mapRequestMessage.value='申请状态暂时无法更新，请稍后重试';}finally{mapRequestRefreshes.delete(requestKey);if(mapRequestSessionCurrent(expected))scheduleMapRequestPolling();}}
function confirmMapRequest(){const location=mapLocation.value,radius=Number(mapRequestRadius.value),name=mapRequestName.value.trim()||'自选区域',expected=accountSession();if(!location){mapRequestMessage.value='请先查找一个位置';return;}if(!expected){mapRequestMessage.value='请先登录徒步地球账号';return;}if(!Number.isFinite(radius)||radius<1||radius>10){mapRequestMessage.value='半径须为1至10公里';return;}if(Math.abs(location.latitude)+radius/110>=MAX_OFFLINE_MERCATOR_LATITUDE){mapRequestMessage.value='所选范围超出详细离线地图纬度，缩小半径或选择南北纬85.05°之间的区域';return;}uni.showModal({title:'申请区域离线地图',content:`将提交“${name}”、纬度${location.latitude.toFixed(5)}、经度${location.longitude.toFixed(5)}和${radius}公里范围，并关联当前账号。坐标会发送至CloudBase及GitHub Actions构建服务；地图包发布在公开GitHub Release，他人可能从地图判断区域。删除申请不会删除已发布的包。不会读取实时定位。确认即表示同意这些地点信息用于生成并公开地图包。`,success:async result=>{if(!result.confirm||busy.value)return;if(!mapRequestSessionCurrent(expected)){mapRequestMessage.value='账号已切换，请重新确认后再提交';return;}mutating.value=true;mapRequestMessage.value='正在提交申请';try{const response=await accountRequest<MapRequest>('offline-map-request',{action:'create',name,latitude:location.latitude,longitude:location.longitude,radiusKm:radius,publicReleaseDisclosureVersion:PUBLIC_RELEASE_DISCLOSURE_VERSION});if(!mapRequestSessionCurrent(expected))return;if(!response.ok||!response.data)throw new Error(response.errMsg||'申请未提交');mapRequests.value=[response.data,...mapRequests.value.filter(row=>row.id!==response.data!.id)].slice(0,20);mapRequestMessage.value='申请已进入免费构建队列';scheduleMapRequestPolling();}catch(error){if(mapRequestSessionCurrent(expected))mapRequestMessage.value=error instanceof Error?error.message:'地图申请失败';}finally{mutating.value=false;}}});}
async function retryMapRequest(request:MapRequest){if(busy.value||!request.retryable)return;const expected=accountSession();if(!expected){mapRequestMessage.value='请先登录徒步地球账号';return;}mutating.value=true;mapRequestMessage.value='正在重新排队';try{const response=await accountRequest<MapRequest>('offline-map-request',{action:'retry',requestId:request.id});if(!mapRequestSessionCurrent(expected))return;if(!response.ok||!response.data)throw new Error(response.errMsg||'未能重新排队');mapRequests.value=mapRequests.value.map(row=>row.id===request.id?response.data!:row);mapRequestMessage.value='申请已重新进入免费构建队列';scheduleMapRequestPolling();}catch(error){if(mapRequestSessionCurrent(expected))mapRequestMessage.value=error instanceof Error?error.message:'重新排队失败';}finally{mutating.value=false;}}
function deleteMapRequest(request:MapRequest){if(busy.value||request.status==='processing')return;const expected=accountSession();if(!expected){mapRequestMessage.value='请先登录徒步地球账号';return;}uni.showModal({title:'删除地图申请记录',content:'删除账号内的申请状态和下载地址。已发布的公共地图包本身不会删除。',success:async result=>{if(!result.confirm||busy.value)return;if(!mapRequestSessionCurrent(expected)){mapRequestMessage.value='账号已切换，请重新确认后再操作';return;}mutating.value=true;try{const response=await accountRequest<{deleted:boolean}>('offline-map-request',{action:'delete',requestId:request.id});if(!mapRequestSessionCurrent(expected))return;if(!response.ok||!response.data?.deleted)throw new Error(response.errMsg||'记录未删除');mapRequests.value=mapRequests.value.filter(row=>row.id!==request.id);mapRequestMessage.value='申请记录已删除';}catch(error){if(mapRequestSessionCurrent(expected))mapRequestMessage.value=error instanceof Error?error.message:'删除记录失败';}finally{mutating.value=false;}}});}
function openMapRequestDownload(url:string){if(!/^https:\/\/github\.com\/hiking-earth\/clients\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.zip$/.test(url)){mapRequestMessage.value='下载地址无效';return;}uni.setClipboardData({data:url,success:()=>{mapRequestMessage.value='下载链接已复制，请在浏览器中打开';},fail:()=>{mapRequestMessage.value='无法复制下载链接';}});}
const unsubscribeMapAccountChange=onAccountChange(()=>{mapRequests.value=[];stopMapRequestPolling();mapRequestMessage.value='';mapLocation.value=null;mapLatitude.value='';mapLongitude.value='';mapRequestName.value='';mapLocationMessage.value='';if(mapRequestPageActive)void refreshMapRequests();});
onShow(()=>{mapRequestPageActive=true;void refreshMapRequests();});onHide(()=>{mapRequestPageActive=false;stopMapRequestPolling();});onUnload(()=>{mapRequestPageActive=false;stopMapRequestPolling();unsubscribeMapAccountChange();});
// #endif
async function revealMap(){mapScrollTarget.value='';await nextTick();mapScrollTarget.value='offline-map-preview';}
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import TrackCanvas from '@/components/TrackCanvas.vue';
import { offlineLayers, importOfflineLayer, deleteOfflineLayer, selectOfflineLayer, restoreOfflineLayers } from '@/services/offline';
import world from '@/data/offline-world.json';
// #ifdef H5
import OfflineBasemap from '@/components/OfflineBasemap.vue';
import bundledBasemaps from '@/data/basemap-packs.json';
import {createMapCatalog,requestMapCatalog,mapDistributionBase} from '@/services/basemap-catalog';
import {isDesktop,requestDesktopMapCatalog,requestDesktopMapDownload} from '@/services/desktop';
const mapBase=mapDistributionBase(isDesktop(),new URL(import.meta.env.BASE_URL,location.href).href);
const mapCatalog=createMapCatalog(bundledBasemaps,()=>isDesktop()?requestDesktopMapCatalog():requestMapCatalog(mapBase));
const availableBasemaps=ref(mapCatalog.snapshot());
const visibleBasemaps=computed(()=>mapLocation.value?mapsCoveringLocation(availableBasemaps.value,mapLocation.value.latitude,mapLocation.value.longitude):availableBasemaps.value);
onShow(async()=>{try{availableBasemaps.value=await mapCatalog.refresh();}catch{message.value='地图目录暂时无法更新，保留已有目录';}});
import {findVerifiedSavedBasemap} from '@/services/verified-basemap';
import {downloadBasemap,downloadDesktopBasemap,type BasemapDownload} from '@/services/basemap-download';
async function downloadMapPack(pack:BasemapDownload){if(busy.value)return;mutating.value=true;message.value='正在核对本机地图版本';try{const rows=await listBasemaps();const existing=await findVerifiedSavedBasemap(rows,pack);if(existing){savedBasemaps.value=rows;basemapInventoryReady.value=true;basemapFile.value=existing.blob;message.value='本机已有相同版本，已校验并打开';return;}assertOfflineMapCapacity(rows.reduce((sum,row)=>sum+row.bytes,0),pack.bytes);message.value='正在下载并校验地图，请稍候';const file=isDesktop()?await downloadDesktopBasemap(pack,requestDesktopMapDownload):await downloadBasemap(pack,mapBase,undefined,bytes=>{message.value=`地图下载 ${(bytes/1048576).toFixed(2)} MiB`;});const saved=await saveBasemap(file);await refreshBasemaps();basemapFile.value=saved.blob;message.value='地图已校验并保存';}catch(e){message.value=e instanceof Error?e.message:'地图下载失败';}finally{mutating.value=false;}}
import {listBasemaps,saveBasemap,deleteBasemap,type SavedBasemap} from '@/services/basemap-store';
const basemapFile=ref<Blob|null>(null),savedBasemaps=ref<SavedBasemap[]>([]),basemapInventoryReady=ref(false);
const savedTerrainBytes=ref(0);
const savedBasemapBytes=computed(()=>basemapInventoryReady.value?savedBasemaps.value.reduce((total,pack)=>total+pack.bytes,0)+savedTerrainBytes.value:null);
function viewSavedBasemap(file:Blob){basemapFile.value=file;void revealMap();}
watch(basemapFile,file=>{if(file)void revealMap();});
async function refreshBasemaps(){try{const [maps,terrain]=await Promise.all([listBasemaps(),listTerrain()]);savedBasemaps.value=maps;savedTerrainBytes.value=terrain.reduce((n,r)=>n+r.bytes,0);basemapInventoryReady.value=true;}catch(e){basemapInventoryReady.value=false;message.value=e instanceof Error?e.message:'地图目录读取失败';}}
onShow(refreshBasemaps);
function chooseBasemap(){const input=document.createElement('input');input.type='file';input.accept='.pmtiles';input.onchange=async()=>{const file=input.files?.[0];if(!file||busy.value)return;mutating.value=true;try{const saved=await saveBasemap(file);await refreshBasemaps();basemapFile.value=saved.blob;message.value='地图包已保存到本机';}catch(e){message.value=e instanceof Error?e.message:'地图保存失败';}finally{mutating.value=false;}};input.click();}
function removeBasemap(id:string){uni.showModal({title:'删除地图包',content:'仅删除本机副本，请保留原始地图文件。',success:async result=>{if(!result.confirm||busy.value)return;mutating.value=true;try{await deleteBasemap(id);basemapFile.value=null;await refreshBasemaps();}catch(e){message.value=e instanceof Error?e.message:'删除失败';}finally{mutating.value=false;}}});}
async function importWebMapRequestArchive(request:MapRequest){
 if(busy.value||!request.bytes||!request.sha256)return;
 const expectedBytes=request.bytes,expectedSha256=request.sha256;
 const input=document.createElement('input');input.type='file';input.accept='.zip,application/zip';
 input.onchange=async()=>{const file=input.files?.[0];if(!file)return;mutating.value=true;mapRequestMessage.value='正在校验地图压缩包';const savedIds:string[]=[];
  try{
   const maps=await readCustomMapArchive({size:file.size,read:async(offset,length)=>new Uint8Array(await file.slice(offset,offset+length).arrayBuffer())},{bytes:expectedBytes,sha256:expectedSha256},n=>{mapRequestMessage.value=`正在读取地图包 ${(n/1048576).toFixed(1)} MiB`;});
   const current=await listBasemaps(),used=current.reduce((sum,row)=>sum+row.bytes,0),needed=maps.filter(map=>!current.some(row=>row.name===map.name&&row.bytes===map.bytes)).reduce((sum,row)=>sum+row.bytes,0);
   assertOfflineMapCapacity(used,needed);
   for(const map of maps){const before=await listBasemaps(),existing=await findVerifiedSavedBasemap(before,map);if(existing)continue;const stored=await saveBasemap(new File([map.data],map.name,{type:'application/octet-stream'}));savedIds.push(stored.id);}
   await refreshBasemaps();const latest=await listBasemaps();basemapFile.value=latest.find(row=>row.id===savedIds[0])?.blob||latest.find(row=>maps.some(map=>map.name===row.name&&map.bytes===row.bytes))?.blob||null;mapRequestMessage.value=`已校验并导入${maps.length}张区域地图`;
  }catch(error){for(const id of savedIds.reverse())try{await deleteBasemap(id);}catch{}await refreshBasemaps();mapRequestMessage.value=error instanceof Error?error.message:'地图包导入失败';}
  finally{mutating.value=false;}
 };
 input.click();
}
// #endif
async function saveWorld(){if(busy.value)return;mutating.value=true;try{const layer=await importOfflineLayer(JSON.stringify(world));await useSavedLayer(layer.id,'全球陆地轮廓已保存，可离线查看');}catch(e){message.value=e instanceof Error?e.message:'全球轮廓保存失败';}finally{mutating.value=false;}}
function toggleOfficialUpdates(event:any){try{setOfficialOfflineUpdates(event.detail.value===true);}catch{message.value='未能保存自动更新设置';}}
const downloading=ref(false),mutating=ref(false);
const busy=computed(()=>downloading.value||mutating.value);
async function useSavedLayer(id:string,success:string){
 try{selectOfflineLayer(id);message.value=success;}catch{message.value='资料已保存，但未能设为当前图层；请重新点击使用';}
 await load();
}
async function downloadHk(){if(busy.value)return;downloading.value=true;message.value='';try{const text=JSON.stringify(await publicSnapshot('offline-hk'));const layer=await importOfflineLayer(text,'hk-afcd');await useSavedLayer(layer.id,'官方参考线已保存，可离线查看');}catch(e:any){message.value=e.message;}finally{downloading.value=false;}}
const layers = ref(offlineLayers()), active = ref(String(uni.getStorageSync('he_offline_active') || '')), source = ref(''), message = ref('');
const preview = computed(() => layers.value.find(p => p.id === active.value));
async function load() { await restoreOfflineLayers();layers.value = offlineLayers(); active.value = String(uni.getStorageSync('he_offline_active') || ''); }
onShow(load);
async function activate(id: string) { if(busy.value)return;try{selectOfflineLayer(id);await load();message.value='已设为当前图层';}catch(e){message.value=e instanceof Error?e.message:'设置图层失败';} }
function remove(id: string) { if(busy.value)return;uni.showModal({ title: '删除离线资料', content: '删除这份本机资料？不影响轨迹文件。', success: async r => { if (r.confirm&&!busy.value) { mutating.value=true;try { await deleteOfflineLayer(id); await load();message.value='资料已删除'; } catch { message.value = '删除失败，原资料已保留'; } finally{mutating.value=false;} } } }); }
async function save() { if(busy.value)return;mutating.value=true;const text=source.value;try { const layer = await importOfflineLayer(text); if(source.value===text)source.value = ''; await useSavedLayer(layer.id,'已保存到本机'); } catch (e) { message.value = e instanceof Error ? e.message : '导入失败'; } finally{mutating.value=false;} }
async function chooseNative() { try { const text = await chooseNativeText(); if (text !== null) source.value = text; } catch (e) { message.value = e instanceof Error ? e.message : '文件读取失败'; } }
// #ifdef H5
function choose() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.geojson,application/json';
  input.onchange = async () => { const file = input.files?.[0]; if (!file) return; if (file.size > 5*1024*1024) { message.value = '资料超过5 MB'; return; } try { source.value = await file.text(); } catch { message.value = '读取失败'; } }; input.click();
}
// #endif
// #ifdef APP-PLUS
import NativeBasemap from '@/components/WechatBasemap.vue';
import bundledNativeMaps from '@/data/basemap-packs.json';
import {createMapCatalog as createNativeCatalog,requestMapCatalog as requestNativeCatalog} from '@/services/basemap-catalog';
import {createNativeMapApi} from '@/services/native-map-api';
import {nativeMapRangeReader,type NativeMapIO} from '@/services/native-basemap-reader';
import {createWechatMapStore as createNativeMapStore,type WechatMapView as NativeMapView} from '@/services/wechat-basemap-store';
import {downloadWechatBasemap as downloadNativePack,type MapDownloadPack as NativeDownloadPack} from '@/services/wechat-basemap-download';
import {verifyBasemapDigest as verifyNativeDigest} from '@/services/basemap-digest';
import {openLocalBasemap as openNativeArchive} from '@/services/local-basemap';
import {nativeArchiveSize,readNativeArchiveChunk} from '@/services/native-basemap-reader';
const nativeIO=plus.io as unknown as NativeMapIO;
const nativeApi=createNativeMapApi(uni as unknown as Parameters<typeof createNativeMapApi>[0],nativeIO,path=>path.startsWith('_doc/')?path:plus.io.convertAbsoluteFileSystem(path),value=>uni.base64ToArrayBuffer(value));
const nativeRead=(path:string,bytes:number)=>nativeMapRangeReader(nativeIO,path,bytes,value=>uni.base64ToArrayBuffer(value));
const nativeStore=createNativeMapStore(nativeApi,(path,bytes)=>openNativeArchive(`native-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,bytes,nativeRead(path,bytes)),'native');
const nativeCatalog=createNativeCatalog(bundledNativeMaps,()=>requestNativeCatalog(PUBLIC_MAP_DISTRIBUTION));
const nativeAvailableMaps=ref(nativeCatalog.snapshot()),nativeSavedMaps=ref<NativeMapView[]>([]),nativeBasemap=ref<{path:string;bytes:number}|null>(null),nativeInventoryReady=ref(false);
const nativeTerrainBytes=ref(0);
const nativeSavedMapBytes=computed(()=>nativeInventoryReady.value?nativeSavedMaps.value.reduce((total,pack)=>total+pack.bytes,0)+nativeTerrainBytes.value:null);
const visibleNativeMaps=computed(()=>mapLocation.value?mapsCoveringLocation(nativeAvailableMaps.value,mapLocation.value.latitude,mapLocation.value.longitude):nativeAvailableMaps.value);
watch(nativeBasemap,file=>{if(file)void revealMap();});
async function refreshNativeMaps(){try{nativeSavedMaps.value=await nativeStore.list();nativeTerrainBytes.value=platformTerrainBytes('native');nativeInventoryReady.value=true;}catch(error){nativeInventoryReady.value=false;throw error;}}
onShow(async()=>{try{await refreshNativeMaps();}catch(e){message.value=e instanceof Error?e.message:'地图目录恢复失败';}try{nativeAvailableMaps.value=await nativeCatalog.refresh();}catch{message.value='地图目录暂时无法更新，保留已有目录';}});
async function downloadNativeMap(pack:NativeDownloadPack){if(busy.value)return;mutating.value=true;try{
 const existing=await nativeStore.find(pack.name,pack.bytes);
 if(existing){message.value='正在校验已有地图';await verifyNativeDigest(nativeRead(existing.path,existing.bytes),existing.bytes,pack.sha256);await refreshNativeMaps();nativeBasemap.value={path:existing.path,bytes:existing.bytes};message.value='已有地图校验通过，无需重复下载';return;}
 const currentMaps=await nativeStore.list();assertOfflineMapCapacity(currentMaps.reduce((sum,row)=>sum+row.bytes,0),pack.bytes);
 const file=await downloadNativePack(nativeApi,pack,(n,stage)=>{message.value=`地图${stage==='verify'?'校验':'下载'} ${(n/1048576).toFixed(2)} MiB`;});
 const saved=await nativeStore.save(file.path,file.bytes,pack.name);await refreshNativeMaps();nativeBasemap.value={path:saved.path,bytes:saved.bytes};message.value='地图已校验并保存到本机';
}catch(e){message.value=e instanceof Error?e.message:'地图下载失败';}finally{mutating.value=false;}}
async function viewNativeMap(id:string){if(busy.value)return;mutating.value=true;try{await refreshNativeMaps();const pack=nativeSavedMaps.value.find(row=>row.id===id);if(!pack)throw new Error('地图不在本机目录中');if(!pack.available)throw new Error(pack.issue);nativeBasemap.value={path:pack.path,bytes:pack.bytes};}catch(e){message.value=e instanceof Error?e.message:'地图读取失败';}finally{mutating.value=false;}}
function removeNativeMap(id:string){if(busy.value)return;uni.showModal({title:'删除地图包',content:'删除本机地图副本？请保留原包。',success:async result=>{if(!result.confirm||busy.value)return;mutating.value=true;try{await nativeStore.remove(id);nativeBasemap.value=null;await refreshNativeMaps();message.value='地图已删除';}catch(e){message.value=e instanceof Error?e.message:'地图删除失败';}finally{mutating.value=false;}}});}
async function importNativeMapRequestArchive(request:MapRequest){
 if(busy.value||!request.bytes||!request.sha256)return;
 const expectedBytes=request.bytes,expectedSha256=request.sha256;
 let archivePath:string|null=null;mutating.value=true;mapRequestMessage.value='正在选择地图压缩包';const savedIds:string[]=[];
 try{
  archivePath=await chooseNativeMapArchive();if(!archivePath)return;
  const size=await nativeArchiveSize(nativeIO,archivePath);if(size!==expectedBytes)throw new Error('压缩包大小与申请记录不一致');
  const maps=await readCustomMapArchive({size,read:async(offset,length)=>readNativeArchiveChunk(nativeIO,archivePath!,offset,length)},{bytes:expectedBytes,sha256:expectedSha256},n=>{mapRequestMessage.value=`正在校验地图包 ${(n/1048576).toFixed(1)} MiB`;});
  const current=await nativeStore.list(),used=current.reduce((sum,row)=>sum+row.bytes,0),needed=maps.filter(map=>!current.some(row=>row.name===map.name&&row.bytes===map.bytes)).reduce((sum,row)=>sum+row.bytes,0);
  assertOfflineMapCapacity(used,needed);
  for(let index=0;index<maps.length;index++){
   const map=maps[index],old=await nativeStore.find(map.name,map.bytes);
   if(old){await verifyNativeDigest(nativeRead(old.path,old.bytes),old.bytes,map.sha256);continue;}
   const tempName=`he-map-import-${Date.now().toString(36)}-${index}.pmtiles`;
   const tempPath=await new Promise<string>((resolve,reject)=>nativeIO.resolveLocalFileSystemURL('_doc/',(directory:any)=>directory.getFile(tempName,{create:true,exclusive:true},(entry:any)=>{
    entry.createWriter((writer:any)=>{writer.onerror=()=>reject(new Error('地图文件暂存失败，请检查设备空间'));writer.onwrite=()=>resolve(entry.toLocalURL());writer.write(new Blob([map.data]));},()=>reject(new Error('地图文件暂存失败')));
   },()=>reject(new Error('地图文件暂存失败'))),()=>reject(new Error('无法访问应用本机地图目录'))));
   try{const stored=await nativeStore.save(tempPath,map.bytes,map.name);savedIds.push(stored.id);}
   finally{await new Promise<void>(resolve=>nativeIO.resolveLocalFileSystemURL(tempPath,(entry:any)=>entry.remove(()=>resolve(),()=>resolve()),()=>resolve()));}
  }
  await refreshNativeMaps();const latest=await nativeStore.list();nativeSavedMaps.value=latest;const first=latest.find(row=>row.id===savedIds[0])||latest.find(row=>maps.some(map=>map.name===row.name&&map.bytes===row.bytes));
  if(first?.available)nativeBasemap.value={path:first.path,bytes:first.bytes};mapRequestMessage.value=`已校验并导入${maps.length}张区域地图`;
 }catch(error){for(const id of savedIds.reverse())try{await nativeStore.remove(id);}catch{}await refreshNativeMaps();mapRequestMessage.value=error instanceof Error?error.message:'地图包导入失败';}
 finally{if(archivePath)removeNativeMapArchive(archivePath);mutating.value=false;}
}
// #endif
// #ifdef MP-WEIXIN
import WechatBasemap from '@/components/WechatBasemap.vue';
import bundledWechatMaps from '@/data/basemap-packs.json';
import {createMapCatalog as createWechatCatalog,requestMapCatalog as requestWechatCatalog} from '@/services/basemap-catalog';
const wechatCatalog=createWechatCatalog(bundledWechatMaps,()=>requestWechatCatalog(PUBLIC_MAP_DISTRIBUTION));
const wechatAvailableMaps=ref(wechatCatalog.snapshot());
const visibleWechatMaps=computed(()=>mapLocation.value?mapsCoveringLocation(wechatAvailableMaps.value,mapLocation.value.latitude,mapLocation.value.longitude):wechatAvailableMaps.value);
onShow(async()=>{try{wechatAvailableMaps.value=await wechatCatalog.refresh();}catch{message.value='地图目录暂时无法更新，保留已有目录';}});
import {downloadWechatBasemap,type MapDownloadPack} from '@/services/wechat-basemap-download';
import {verifyBasemapDigest} from '@/services/basemap-digest';
async function downloadWechatMap(pack:MapDownloadPack){if(busy.value)return;mutating.value=true;try{const existing=await wechatMapStore.find(pack.name,pack.bytes);if(existing){message.value='正在校验已有地图';await verifyBasemapDigest(fileRangeReader(uni.getFileSystemManager(),existing.path,existing.bytes),existing.bytes,pack.sha256);await refreshWechatMaps();wechatBasemap.value={path:existing.path,bytes:existing.bytes};message.value='已有地图校验通过，已直接打开，无需重复下载';return;}const currentMaps=await wechatMapStore.list();assertOfflineMapCapacity(currentMaps.reduce((sum,row)=>sum+row.bytes,0),pack.bytes);const file=await downloadWechatBasemap(uni,pack,(n,stage)=>{message.value=`地图${stage==='verify'?'校验':'下载'} ${(n/1048576).toFixed(2)} MiB`;});const saved=await wechatMapStore.save(file.path,file.bytes,pack.name);await refreshWechatMaps();wechatBasemap.value={path:saved.path,bytes:saved.bytes};message.value='地图已校验并保存到本机';}catch(e){message.value=e instanceof Error?e.message:'地图下载失败';}finally{mutating.value=false;}}

const wechatBasemap=ref<{path:string;bytes:number}|null>(null);
watch(wechatBasemap,file=>{if(file)void revealMap();});
import {createWechatMapStore,type WechatMapView} from '@/services/wechat-basemap-store';
import {fileRangeReader} from '@/services/basemap-file-reader';
import {openLocalBasemap} from '@/services/local-basemap';
const wechatSavedMaps=ref<WechatMapView[]>([]);
const wechatInventoryReady=ref(false);
const wechatTerrainBytes=ref(0);
const wechatSavedMapBytes=computed(()=>wechatInventoryReady.value?wechatSavedMaps.value.reduce((total,pack)=>total+pack.bytes,0)+wechatTerrainBytes.value:null);
const wechatMapStore=createWechatMapStore(uni,(path,bytes)=>openLocalBasemap('wechat-validate',bytes,fileRangeReader(uni.getFileSystemManager(),path,bytes)));
async function viewWechatBasemap(id:string){if(busy.value)return;mutating.value=true;message.value='正在读取已保存地图';try{const packs=await wechatMapStore.list();wechatSavedMaps.value=packs;wechatInventoryReady.value=true;const pack=packs.find(row=>row.id===id);if(!pack)throw new Error('地图不在本机目录中');if(!pack.available)throw new Error(pack.issue||'地图暂时无法读取，请保留原包');wechatBasemap.value={path:pack.path,bytes:pack.bytes};}catch(error){message.value=error instanceof Error?error.message:'地图读取失败';}finally{mutating.value=false;}}
async function refreshWechatMaps(){try{wechatSavedMaps.value=await wechatMapStore.list();wechatTerrainBytes.value=platformTerrainBytes('wechat');wechatInventoryReady.value=true;}catch(e){wechatInventoryReady.value=false;message.value=e instanceof Error?e.message:'地图目录恢复失败';}}
onShow(refreshWechatMaps);
async function importWechatMapRequestArchive(request:MapRequest){
 if(busy.value||!request.bytes||!request.sha256)return;
 const expectedBytes=request.bytes,expectedSha256=request.sha256;
 uni.chooseMessageFile({count:1,type:'file',extension:['zip'],success:async result=>{
  const file=result.tempFiles?.[0];if(!file)return;if(!Number.isSafeInteger(file.size)||file.size!==expectedBytes){mapRequestMessage.value='压缩包大小与申请记录不一致';return;}
  mutating.value=true;mapRequestMessage.value='正在校验地图压缩包';const savedIds:string[]=[],manager=uni.getFileSystemManager() as any;let fd:string|undefined;
  try{
   fd=await new Promise<string>((resolve,reject)=>manager.open({filePath:file.path,flag:'r',success:(value:any)=>resolve(value.fd),fail:()=>reject(new Error('无法读取地图压缩包'))}));
   const maps=await readCustomMapArchive({size:file.size,read:(offset,length)=>new Promise<Uint8Array>((resolve,reject)=>manager.read({fd:fd!,arrayBuffer:new ArrayBuffer(length),offset:0,length,position:offset,success:(value:any)=>{if(value.bytesRead!==length)return reject(new Error('地图压缩包读取不完整'));resolve(new Uint8Array(value.arrayBuffer,0,length).slice());},fail:()=>reject(new Error('地图压缩包读取失败'))}))},{bytes:expectedBytes,sha256:expectedSha256},n=>{mapRequestMessage.value=`正在校验地图包 ${(n/1048576).toFixed(1)} MiB`;});
   const current=await wechatMapStore.list(),used=current.reduce((sum,row)=>sum+row.bytes,0),needed=maps.filter(map=>!current.some(row=>row.name===map.name&&row.bytes===map.bytes)).reduce((sum,row)=>sum+row.bytes,0);
   assertOfflineMapCapacity(used,needed);
   const dataRoot=(globalThis as any).wx?.env?.USER_DATA_PATH;if(typeof dataRoot!=='string'||!dataRoot.startsWith('wxfile://'))throw new Error('无法创建本机地图临时文件');
   for(let index=0;index<maps.length;index++){
    const map=maps[index],old=await wechatMapStore.find(map.name,map.bytes);
    if(old){await verifyBasemapDigest(fileRangeReader(uni.getFileSystemManager(),old.path,old.bytes),old.bytes,map.sha256);continue;}
    const tempPath=`${dataRoot}/he-map-import-${Date.now().toString(36)}-${index}.pmtiles`;
    await new Promise<void>((resolve,reject)=>manager.writeFile({filePath:tempPath,data:map.data.buffer,success:()=>resolve(),fail:()=>reject(new Error('地图暂存失败，请检查微信存储空间'))}));
    try{const saved=await wechatMapStore.save(tempPath,map.bytes,map.name);savedIds.push(saved.id);}
    finally{await new Promise<void>(resolve=>manager.unlink({filePath:tempPath,success:()=>resolve(),fail:()=>resolve()}));}
   }
   await refreshWechatMaps();const latest=await wechatMapStore.list();wechatSavedMaps.value=latest;const first=latest.find(row=>row.id===savedIds[0])||latest.find(row=>maps.some(map=>map.name===row.name&&map.bytes===row.bytes));
   if(first?.available)wechatBasemap.value={path:first.path,bytes:first.bytes};mapRequestMessage.value=`已校验并导入${maps.length}张区域地图`;
  }catch(error){for(const id of savedIds.reverse())try{await wechatMapStore.remove(id);}catch{}await refreshWechatMaps();mapRequestMessage.value=error instanceof Error?error.message:'地图包导入失败';}
  finally{if(fd)manager.close({fd,fail:()=>{}});mutating.value=false;}
 },fail:()=>{mapRequestMessage.value='未选择地图压缩包';}});
}
function chooseWechatBasemap(){if(busy.value)return;uni.chooseMessageFile({count:1,type:'file',extension:['pmtiles'],success:async r=>{const file=r.tempFiles[0];if(!file||!Number.isSafeInteger(file.size)||file.size<127||file.size>64*1024*1024){message.value='地图包无效或超过64 MiB';return;}mutating.value=true;try{const saved=await wechatMapStore.save(file.path,file.size,file.name||'区域地图');await refreshWechatMaps();wechatBasemap.value={path:saved.path,bytes:saved.bytes};message.value='地图包已保存到本机';}catch(e){message.value=e instanceof Error?e.message:'地图保存失败';}finally{mutating.value=false;}},fail:()=>{message.value='未打开地图文件';}});}
function removeWechatBasemap(id:string){if(busy.value)return;uni.showModal({title:'删除地图包',content:'删除本机地图副本？请保留原始地图包。',success:async r=>{if(!r.confirm||busy.value)return;mutating.value=true;try{await wechatMapStore.remove(id);wechatBasemap.value=null;await refreshWechatMaps();message.value='地图已删除';}catch(e){message.value=e instanceof Error?e.message:'地图删除失败';}finally{mutating.value=false;}}});}

function chooseWechat() { uni.chooseMessageFile({ count: 1, type: 'file', extension: ['json','geojson'], success: r => {
  const file = r.tempFiles[0]; if (file.size > 5*1024*1024) { message.value = '资料超过5 MB'; return; }
  uni.getFileSystemManager().readFile({ filePath: file.path, encoding: 'utf8', success: r => { source.value = String(r.data); }, fail: () => { message.value = '读取失败'; } });
} }); }
// #endif
async function importMapRequestArchive(request:MapRequest){
 // #ifdef H5
 return importWebMapRequestArchive(request);
 // #endif
 // #ifdef APP-PLUS
 return importNativeMapRequestArchive(request);
 // #endif
 // #ifdef MP-WEIXIN
 return importWechatMapRequestArchive(request);
 // #endif
}
</script>
<style scoped>.page{height:100vh;padding:24px 20px;box-sizing:border-box;background:var(--he-color-background);color:var(--he-color-text)}.title{display:block;font-size:20px}.hint{display:block;font-size:13px;color:var(--he-color-muted);line-height:1.7;margin:12px 0}.card{padding:16px;border-radius: var(--he-card-radius, 16px);background:var(--he-color-panel);margin-bottom:16px}.input{width:100%;height:220px;box-sizing:border-box;padding:12px;background:var(--he-color-surface);margin:16px 0}button{background:var(--he-color-accent);color:var(--he-color-on-accent);margin:12px 0;font-size:14px}.map-coordinates{display:flex;gap:12px;margin-top:16px}.map-coordinates>view{flex:1;min-width:0}.map-coordinate-label{display:block;font-size:13px;color:var(--he-color-muted);margin-bottom:6px}.map-coordinate-input{height:44px;border:1px solid var(--he-color-border);border-radius: var(--he-input-radius, 13px);padding:0 12px;background:var(--he-color-surface);color:var(--he-color-text);font-size:16px;box-sizing:border-box}.map-request-name,.map-request-radius{width:100%;margin-top:12px}.map-request-row{border-top:1px solid var(--he-color-border);padding-top:10px;margin-top:10px;color:var(--he-color-text)}</style>
