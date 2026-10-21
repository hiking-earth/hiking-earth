import {CATALOG_PAGE_SIZE,CATALOG_SOURCE_LIMIT} from './catalog-limits';
import {needsGatewayRelay,gatewayRelayRequest} from './gateway-relay';
import {ROUTES as bundled,reviewedRouteStatus,type HikingRoute} from './routes';
import {loadStaticPages,searchStatic,staticManifest,type StaticManifest} from './static-catalog';
import {discoveryNameReview,discoveryTagHighlights,discoveryTagValue} from './discovery-tags';
import officialSources from './official-sources.json';
import {hasCurrentOfficialFeedReview} from './official-source-review';
import {PUBLIC_ROUTE_SOURCES,type PublicRouteSource} from './catalog-sources';
export type OfficialNotice={id:string;title:string;url:string;region:string;sourceLabel:string;sourceUrl:string;publishedAt:string|null;fetchedAt:string;center?:[number,number]};
const sources=PUBLIC_ROUTE_SOURCES;
const PAGE_SIZE=CATALOG_PAGE_SIZE;
function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
type JsonRecord=Record<string,unknown>;
type CatalogPage=JsonRecord & {snapshot:string;key:string;total:number;page:number;hasMore:boolean;items:unknown[];metadata?:JsonRecord};
type ReviewTrack={sourceUrl:string;license:string;path:[number,number][]};
type ReviewRow={routeId:string;status:'开放中'|'即将开放'|'临时关闭'|'永久关闭'|'待核验';sourceUrl:string;summary:string;riskNotice:string;checkedAt:string;expiresAt:number;version:number;track?:ReviewTrack|null};
function jsonObject(value:unknown):JsonRecord{if(!isRecord(value))throw new Error('invalid JSON object');return value;}
function isUnknownArray(value:unknown):value is unknown[]{return Array.isArray(value);}
function isCatalogPage(value:unknown):value is CatalogPage{
 return isRecord(value)&&typeof value.snapshot==='string'&&typeof value.key==='string'
  &&typeof value.total==='number'&&typeof value.page==='number'&&typeof value.hasMore==='boolean'
  &&Array.isArray(value.items)&&(value.metadata===undefined||isRecord(value.metadata));
}
async function publicCatalogRequest(action:'catalog-feed'|'route-manage',data:Record<string,unknown>,timeout=15000):Promise<JsonRecord>{
 if(needsGatewayRelay()){const result=await gatewayRelayRequest(action,data,undefined,timeout),body=result.body;if(result.status!==200||!isRecord(body)||body.ok!==true||!isRecord(body.data))throw new Error('public catalog unavailable');return jsonObject(body.data);}
 const response=await fetch('https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(timeout),
 });
 const envelope:unknown=await response.json();
 if(!response.ok||!isRecord(envelope)||envelope.ok!==true)throw new Error('public catalog unavailable');
 return jsonObject(envelope.data);
}
let coverageSummary='';
export function publicCatalogCoverageSummary(){return coverageSummary;}
let coverageHasSourceFailures=false;
export function publicCatalogHasSourceFailures(){return coverageHasSourceFailures;}
const regions:Record<string,string>={china:'中国检索区域','hong-kong':'香港',macao:'澳门',europe:'欧洲','north-america':'北美',japan:'日本及周边检索区域',oceania:'大洋洲','south-america':'南美',africa:'非洲','south-asia':'南亚',asia:'亚洲'};
function validReferencePaths(value:unknown):value is [number,number][][]{
 if(!Array.isArray(value)||value.length>150)return false;
 let pointCount=0;
 for(const path of value){
  if(!Array.isArray(path)||path.length<2||path.length>151||!path.every(isCoordinate))return false;
  pointCount+=path.length;
  if(pointCount>15000)return false;
 }
 return true;
}
function safeHttpsUrl(value:unknown):value is string{
 if(typeof value!=='string'||value.length>2048)return false;
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port;}catch{return false;}
}
function plainSourceText(value:unknown,maxLength=240):string{
 if(typeof value!=='string')return '';
 let clean='';
 for(const character of value){const code=character.charCodeAt(0);clean+=code<0x20||code===0x7f?' ':character;}
 return clean.replace(/\s+/g,' ').trim().slice(0,maxLength);
}
function discover(raw:unknown,source:string,attribution:string):HikingRoute[]{
 if(!Array.isArray(raw)||raw.length>CATALOG_SOURCE_LIMIT)throw new Error('catalog size invalid');
 const rows=raw.filter((value):value is JsonRecord=>isRecord(value)&&typeof value.id==='string'&&!!value.id.trim()&&value.id.length<=300&&typeof value.name==='string'&&!!plainSourceText(value.name,500)&&typeof value.fetchedAt==='string'&&Number.isFinite(Date.parse(value.fetchedAt))&&Date.parse(value.fetchedAt)<=Date.now()+30000&&isCoordinate(value.center));
 if(rows.length!==raw.length)throw new Error('catalog row invalid');
 const ids=new Set<string>();
 for(const row of rows){const id=row.id as string;if(ids.has(id))throw new Error('duplicate route id in source');ids.add(id);}
 return rows.map(r=>{
  const sourceTags=isRecord(r.sourceTags)?r.sourceTags:{};
  const paths=r.referencePaths===undefined?[]:validReferencePaths(r.referencePaths)?r.referencePaths:[];
  const restrictionValue=source==='usfs'?plainSourceText(sourceTags.hikingRestricted,300):'';
  const restrictionNotice=restrictionValue?` USDA Forest Service源字段“徒步限制”原值（去除首尾空格）：${restrictionValue}；含义和适用日期需查属地官方资料。`:'';
 const japanTokai=source==='japan-tokai',nzdoc=source==='nzdoc',parkscanada=source==='parkscanada',nswnpws=source==='nsw-npws',england=source==='england',wales=source==='wales',scotlandArgyll=source==='scotland-argyll',niMidulster=source==='ni-midulster',norfolkProW=source==='norfolk-prow',cambridgeshireProW=source==='cambridgeshire-prow',npsPublicTrails=source==='nps-public-trails',usgsTrails=source==='usgs-trails',swisstopo=source==='swisstopo-wanderwege',victoria=source==='victoria-recreation-tracks',queensland=source==='queensland-qpws-trails',taiwan=source==='taiwan-trails',koreaDurunubi=source==='korea-durunubi-trails';
  const routeSourceUrl=[sourceTags.officialUrl,sourceTags.officialUrlEn,sourceTags.officialUrlFr,r.sourceUrl].find(safeHttpsUrl);
  const regionValue=plainSourceText(r.region,160);
  const region=regionValue?regions[regionValue]||regionValue:'未注明区域';
  const routeName=plainSourceText(r.name,500),sourceOriginator=plainSourceText(sourceTags.sourceOriginator,240);
  const distanceKm=sourceTags.distanceKm,distanceText=plainSourceText(sourceTags.distance,200),estimatedTime=plainSourceText(sourceTags.estimatedTime,200);
  const referenceSource=source==='hk'||nzdoc||parkscanada||nswnpws||england||wales||scotlandArgyll||niMidulster||norfolkProW||cambridgeshireProW||npsPublicTrails||usgsTrails||swisstopo||victoria||queensland||taiwan||japanTokai||koreaDurunubi;
  const hasReferencePath=referenceSource&&paths.length===1;
  return {id:r.id as string,name:routeName,region,status:'待核验',center:r.center as [number,number],path:hasReferencePath?paths[0]:[],distance:typeof distanceKm==='number'&&Number.isFinite(distanceKm)?`${distanceKm.toFixed(1)} km${nzdoc?'（DOC来源值，待核验）':parkscanada?'（Parks Canada来源值，待核验）':nswnpws?'（NSW单段长度，待核验）':england?'（Natural England来源值，待核验）':wales?'（威尔士来源值，待核验）':scotlandArgyll?'（议会来源值，待核验）':''}`:typeof distanceText==='string'?`${distanceText}（来源原值，单位待核验）`:'待核验',ascent:'待核验',duration:nzdoc&&typeof estimatedTime==='string'?`${estimatedTime}（DOC来源值，待核验）`:'待核验',difficulty:nzdoc?discoveryTagValue(sourceTags,'difficulty','DOC新西兰'):'待核验',bestSeason:'待核验',bestSeasons:[],packStyle:'待核验',overnight:'待核验',surface:'待核验',trackMode:hasReferencePath?'认知示意':'不展示轨迹',scenery:[],summary:japanTokai?'日本环境省公布的东海自然步道GPS参考资料；线形可能存在位置误差，关闭路段没有自动绕行资料，状态待核验，不能导航。':swisstopo?'瑞士 swisstopo SwissTLM3D 官方徒步网络中按具名线路聚合的参考资料；状态待核验，参考线不可用于导航。':nzdoc?'DOC提供的近似步道中心线参考资料；出行前请核验DOC的当前公告。':parkscanada?'Parks Canada的步道发现档案，官方说明数据覆盖可能不完整；出行前请查看属地公告，线条仅供参考。':england?'Natural England提供的英格兰国家步道参考几何；需核验现行路线、开放状态和属地公告，简化线条仅供参考。':wales?'Natural Resources Wales提供的威尔士国家步道参考几何；来源状态仅为原始字段，开放状态、通行权和导航精度均待核验。':scotlandArgyll?'阿盖尔-比特议会公布的核心通行步道，服务步行、骑行和骑马等多类用户；资料线仅供发现参考，地面状况、徒步适合度和现场通行情况仍需核验。':niMidulster?'OpenDataNI 与 Mid Ulster District Council 发布的公共通行权线形发现档案；原始状态和公共地图标记不证明当前开放或通行许可，简化线不能导航。':norfolkProW?'Norfolk County Council 公共通行权示意线，用于发现档案；不代表精确法律线形、当前开放状态或导航轨迹。':cambridgeshireProW?'Cambridgeshire County Council 每日更新的法定地图工作副本；该资料含错误或异常可能，不能用于确定法律线形或导航。':usgsTrails?'USGS全国步道汇总中的徒步类发现档案；保留原始来源单位，资料可能滞后，开放许可仍需核验。':npsPublicTrails?'美国国家公园管理局公共分发步道参考线；来源字段和公共地图标记不证明当前开放、通行许可、准确性或导航适用性。':victoria?'维多利亚州政府标记为步行用途的官方步道参考线；线形与关闭字段不证明当前开放、公众通行许可或导航适用性。':taiwan?'台湾观光署步道开放数据发现档案；原始服务状态和公共通行字段只作为来源记录，所有路线待核验，简化线不能导航。':koreaDurunubi?'韩国旅游发展局 DuruNubi 韩国环线步道 GPX 参考档案；数据门户许可范围为不限制复用，当前开放状态未核验，简化线不能导航。':'自动采集的徒步路线发现档案；装备、住宿、路况与开放许可尚未核验。',image:'/static/original-mountain-reference.png',imageCredit:'徒步地球原创几何示意 · 非路线实景',archive:{source:{label:attribution,...(routeSourceUrl?{url:routeSourceUrl}:{})},checkedAt:`采集 ${typeof r.fetchedAt==='string'?r.fetchedAt:'时间未知'}；开放状态未核验`,highlights:[...discoveryNameReview(routeName),...(sourceOriginator?[`原始来源单位：${sourceOriginator}`]:[]),...discoveryTagHighlights(sourceTags,attribution)],riskNotice:`地图收录不代表允许通行；来源标签为贡献者原始标注，不代表官方开放、安全或路线许可；装备、住宿和路况尚未核验；本档案不提供导航。${japanTokai?'日本环境省说明GPS线仍可能有位置误差，关闭路段没有自动绕行资料；此处抽稀线仅供发现，开放状态和通行许可待核验。':''}${nzdoc?'DOC将几何描述为近似中心线，并要求出行前向当地办公室或官网核实关闭状态。':''}${parkscanada?'加拿大官方数据说明路线目录可能不完整；请出行前查看当地Parks Canada公告。':nswnpws?'NSW NPWS提供的是资产库步道分段，不表示当前开放、公众通行许可或完整路线；长度不代表路线总长。':england?'英格兰国家步道数据不证明路线当前开放、通行权或路径准确；出行前核验属地官方信息。':wales?'威尔士来源的状态字段仅作为原始标记保留，不证明开放或许可；简化参考线不是导航轨迹。':scotlandArgyll?'阿盖尔-比特核心通行路径供多种用户使用，部分路线可能是道路、运河或不同地面类型；不能据此推断为徒步线路、当前无障碍、适合度或导航许可。':niMidulster?'米德阿尔斯特公共通行权记录中的状态、条件、断言和日期是来源字段，不是实时开放公告或许可；线形经过简化，仅用于发现参考，不可导航。':norfolkProW?'诺福克郡议会说明该图层是《确定地图》的解释版本，线形可能不完整或不准确，不能替代法定地图；所有记录待核验，不可导航。':cambridgeshireProW?'剑桥郡议会说明该资料为每日更新的《确定地图》电子工作副本，含错误和异常，不能用于确定路线位置或法律线形；所有记录待核验，不可导航。':usgsTrails?'USGS汇总不同机构与地区的步道资料，更新周期不一且可能滞后；请向原始来源单位核验当前开放、许可和现场状况。':npsPublicTrails?'NPS说明公共分发GIS数据不是法律文件，并且不保证准确性、可靠性或完整性。':''}${swisstopo?'SwissTLM3D为具名步行网络参考，并不证明当前开放、公共通行许可、路线完整性或导航准确性。':''}${koreaDurunubi?'韩国旅游发展局课程GPX经抽稀后仅作发现参考；请检查DuruNubi当前公告，不能用于导航。':''}${restrictionNotice}`}};
 });
}
async function apiFirstPage(source:string):Promise<CatalogPage>{
 const first=await publicCatalogRequest('catalog-feed',{source,page:0,windowLimit:CATALOG_SOURCE_LIMIT});
 const expectedKey=source==='news'?'items':'routes';
 if(!isCatalogPage(first)||first.key!==expectedKey||first.items.length>PAGE_SIZE||first.page!==0||!Number.isInteger(first.total)||first.total<0||!/^([a-f0-9]{64})$/.test(first.snapshot))throw new Error('catalog page invalid');
 if(first.total>CATALOG_SOURCE_LIMIT)throw new Error('catalog exceeds safe read limit');
 const pageCount=Math.ceil(first.total/PAGE_SIZE);
 if(first.hasMore!==(pageCount>1))throw new Error('catalog page state invalid');
 return {...first,items:first.items};
}
async function apiPages(source:string,first:CatalogPage):Promise<CatalogPage>{
 const pageCount=Math.ceil(first.total/PAGE_SIZE),items=[...first.items];
 for(let start=1;start<pageCount;start+=8){
  const pageNumbers=Array.from({length:Math.min(8,pageCount-start)},(_,i)=>start+i);
  const later=await Promise.all(pageNumbers.map(page=>publicCatalogRequest('catalog-feed',{source,page,snapshot:first.snapshot,windowLimit:CATALOG_SOURCE_LIMIT})));
  for(let i=0;i<later.length;i++){const page=pageNumbers[i],result=later[i];if(!isCatalogPage(result)||result.snapshot!==first.snapshot||result.total!==first.total||result.key!==first.key||result.items.length>PAGE_SIZE||result.page!==page||result.hasMore!==(page<pageCount-1))throw new Error('catalog changed during read');items.push(...result.items);}
 }
 if(items.length!==first.total)throw new Error('catalog incomplete');return {...first,items};
}
function generatedAt(value:unknown){if(!isRecord(value)||!isRecord(value.metadata)||typeof value.metadata.generatedAt!=='string')return -Infinity;const time=Date.parse(value.metadata.generatedAt);return Number.isFinite(time)?time:-Infinity;}
async function pages(source:PublicRouteSource|'news'){
 if(source==='japan-tokai')return apiPages(source,await apiFirstPage(source));
 const [apiResult,staticResult]=await Promise.allSettled([apiFirstPage(source),staticManifest(source)]);
 if(apiResult.status==='rejected'&&staticResult.status==='rejected')throw apiResult.reason;
 if(apiResult.status==='rejected'&&staticResult.status==='fulfilled')return loadStaticPages(source,staticResult.value);
 if(apiResult.status==='rejected')throw apiResult.reason;
 if(staticResult.status==='rejected')return apiPages(source,apiResult.value);
 const remoteTime=generatedAt(apiResult.value),staticTime=generatedAt(staticResult.value);
 const sourceTotal=apiResult.value.metadata?.sourceTotal;
 const remoteCount=typeof sourceTotal==='number'&&Number.isInteger(sourceTotal)?sourceTotal:apiResult.value.total;
 const preferStatic=staticTime>remoteTime||staticTime===remoteTime&&staticResult.value.total>=remoteCount;
 if(preferStatic){try{return await loadStaticPages(source,staticResult.value);}catch{return apiPages(source,apiResult.value);}}
 try{return await apiPages(source,apiResult.value);}catch{return loadStaticPages(source,staticResult.value);}
}
async function allReviews():Promise<ReviewRow[]>{
 const first=await publicCatalogRequest('route-manage',{action:'list',page:0});
 if(!isUnknownArray(first.items)||first.items.length>10||typeof first.hasMore!=='boolean')throw new Error('review snapshot invalid');
 const rows:unknown[]=[...first.items];let done=!first.hasMore;
 for(let start=1;!done&&start<100;start+=8){
  const pageNumbers=Array.from({length:Math.min(8,100-start)},(_,i)=>start+i);
  const later=await Promise.all(pageNumbers.map(page=>publicCatalogRequest('route-manage',{action:'list',page})));
  for(let i=0;i<later.length;i++){const response=later[i];if(!isUnknownArray(response.items)||response.items.length>10||typeof response.hasMore!=='boolean')throw new Error('review snapshot invalid');rows.push(...response.items);if(!response.hasMore){done=true;break;}}
 }
 if(!done)throw new Error('review page limit');
 const ids=new Set<string>(),validated:ReviewRow[]=[];for(const row of rows){if(!validReview(row)||ids.has(row.routeId))throw new Error('review snapshot invalid');ids.add(row.routeId);validated.push(row);}
 return validated;
}
function isCoordinate(value:unknown):value is [number,number]{return Array.isArray(value)&&value.length===2&&value.every((coordinate)=>typeof coordinate==='number'&&Number.isFinite(coordinate))&&Math.abs(value[0] as number)<=180&&Math.abs(value[1] as number)<=90;}
function validReviewTrack(track:unknown):track is ReviewTrack|null{
 if(track===null)return true;
 if(!isRecord(track)||typeof track.sourceUrl!=='string'||typeof track.license!=='string'||!track.license.trim()||track.license.length>1000||!isUnknownArray(track.path)||track.path.length<2||track.path.length>3000)return false;
 try{const url=new URL(track.sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.port)return false;}catch{return false;}
 return track.path.every(isCoordinate);
}
function validReview(row:unknown):row is ReviewRow{
 if(!isRecord(row)||typeof row.routeId!=='string'||!row.routeId.trim()||row.routeId.length>128||typeof row.status!=='string'||!['开放中','即将开放','临时关闭','永久关闭','待核验'].includes(row.status)||typeof row.sourceUrl!=='string'||typeof row.summary!=='string'||row.summary.length>3000||typeof row.riskNotice!=='string'||row.riskNotice.length>3000||typeof row.checkedAt!=='string'||!Number.isFinite(Date.parse(row.checkedAt))||Date.parse(row.checkedAt)>Date.now()||typeof row.expiresAt!=='number'||!Number.isFinite(row.expiresAt)||row.expiresAt<Date.parse(row.checkedAt)||row.expiresAt>Date.parse(row.checkedAt)+7*86400000||typeof row.version!=='number'||!Number.isInteger(row.version)||row.version<1||row.track!==undefined&&!validReviewTrack(row.track))return false;
 try{const url=new URL(row.sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.port)return false;}catch{return false;}
 return true;
}
export async function loadPublicRouteCatalog(previousRoutes:HikingRoute[]=[]):Promise<HikingRoute[]>{
 const sourceResults=await Promise.all(sources.map(async source=>{try{return {source,snapshot:await pages(source)};}catch{return {source,snapshot:null};}}));
 const snapshots:Array<{source:typeof sources[number];snapshot:Awaited<ReturnType<typeof pages>>}>=[];
 const unavailable:typeof sources[number][]=[];
 for(const result of sourceResults)if(result.snapshot)snapshots.push({source:result.source,snapshot:result.snapshot});else unavailable.push(result.source);
 coverageHasSourceFailures=unavailable.length>0;
 if(!snapshots.length)throw new Error('all route catalogs unavailable');
 let reviewRows:ReviewRow[]=[];let reviewsAvailable=true;
 try{reviewRows=await allReviews();}catch{reviewsAvailable=false;}
 const defaultAttribution:Record<PublicRouteSource,string>={osm:'© OpenStreetMap contributors · ODbL-1.0',usfs:'USDA Forest Service',hk:'DATA.GOV.HK-terms-1.2',nzdoc:`Crown Copyright: Department of Conservation Te Papa Atawhai ${new Date().getUTCFullYear()} · CC BY 3.0 NZ`,parkscanada:'Contains information licensed under the Open Government Licence – Canada. Source: Parks Canada (Trails APCA).','nsw-npws':'© State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2017. Source: NSW NPWS Asset Infrastructure – Track Section.',england:'© Natural England copyright. Contains Ordnance Survey data © Crown copyright and database right 2026.','japan-tokai':'Japan Ministry of the Environment · Tokai Nature Trail GPS data; Japan Public Data License 1.0.',wales:'Contains Natural Resources Wales information © Natural Resources Wales and Database Right. All rights Reserved. Contains Ordnance Survey Data. Ordnance Survey Licence number AC0000849444. Crown Copyright and Database Right.','scotland-argyll':'Contains spatial data licensed under Open Government Licence v3.0 from Argyll and Bute Council. Source: Adopted Core Paths.','ni-midulster':'Contains information licensed under the Open Government Licence v3.0 from OpenDataNI and Mid Ulster District Council. Source: Public Rights of Way.','norfolk-prow':'Contains Norfolk County Council Public Rights of Way data. © Norfolk County Council and © Crown copyright and database rights 2019 Ordnance Survey 100019340.','cambridgeshire-prow':'Contains information licensed under the Open Government Licence v3.0 from Cambridgeshire County Council. Source: Public Rights of Way.','nps-public-trails':'U.S. National Park Service, Public Trails dataset. NPS public-distribution data; no named layer-specific license. See source and NPS data disclaimer.','usgs-trails':'U.S. Geological Survey National Digital Trails. USGS public-domain aggregate; the original source originator is retained for each record.','swisstopo-wanderwege':'Federal Office of Topography swisstopo (SwissTLM3D hiking trails).','victoria-recreation-tracks':'Contains Victorian Government data from Recreation Tracks, Department of Energy, Environment and Climate Action. Licensed under CC BY 4.0.','queensland-qpws-trails':'Contains Queensland Government data from Queensland Parks and Wildlife Service (QPWS) Estate access. © The State of Queensland (Department of Environment and Science) 2020. Licensed under CC BY 4.0.','taiwan-trails':'Source: Taiwan Tourism Administration, Ministry of Transportation and Communications, Trail dataset (Tourism Data Standard v2.1). Released under the Open Government Data License, version 1.0.','korea-durunubi-trails':'Source: Korea Tourism Organization, DuruNubi Korea Dulle Trail API. Reuse scope: no restrictions, per DATA.GO.KR dataset 15101974.'};
 const updated:HikingRoute[]=[],validSnapshots:typeof snapshots=[],routeIds=new Set<string>();
 for(const {source,snapshot} of snapshots){
  try{
   const routes=discover(snapshot.items,source,typeof snapshot.metadata?.attribution==='string'?snapshot.metadata.attribution:defaultAttribution[source]);
   if(routes.some(route=>routeIds.has(route.id)))throw new Error('catalog route id appears in multiple sources');
   for(const route of routes)routeIds.add(route.id);
   updated.push(...routes);
   validSnapshots.push({source,snapshot});
  }catch{unavailable.push(source);}
 }
 snapshots.splice(0,snapshots.length,...validSnapshots);
 coverageHasSourceFailures=unavailable.length>0;
 if(!snapshots.length)throw new Error('all route catalogs failed validation');
 const originals=new Map(bundled.map(r=>[r.id,r]));const byId=new Map<string,HikingRoute>();for(const route of updated)if(!byId.has(route.id))byId.set(route.id,route);
 const prefixes:Record<PublicRouteSource,string>={osm:'osm-relation-',usfs:'usfs-',hk:'hk-afcd-',nzdoc:'nzdoc-',parkscanada:'parkscanada-','nsw-npws':'nsw-npws-',england:'england-trail-',wales:'wales-trail-','japan-tokai':'japan-tokai-trail-','scotland-argyll':'scotland-argyll-','ni-midulster':'ni-midulster-','norfolk-prow':'norfolk-prow-','cambridgeshire-prow':'cambridgeshire-prow-','nps-public-trails':'nps-trail-','usgs-trails':'usgs-trail-','swisstopo-wanderwege':'swiss-trail-','victoria-recreation-tracks':'vic-recreation-track-','queensland-qpws-trails':'queensland-qpws-','taiwan-trails':'taiwan-trail-','korea-durunubi-trails':'korea-durunubi-'};
 const unavailableCounts:Record<PublicRouteSource,number>={osm:0,usfs:0,hk:0,nzdoc:0,parkscanada:0,'nsw-npws':0,england:0,wales:0,'japan-tokai':0,'scotland-argyll':0,'ni-midulster':0,'norfolk-prow':0,'cambridgeshire-prow':0,'nps-public-trails':0,'usgs-trails':0,'swisstopo-wanderwege':0,'victoria-recreation-tracks':0,'queensland-qpws-trails':0,'taiwan-trails':0,'korea-durunubi-trails':0};
 for(const source of unavailable){
  for(const route of previousRoutes){
   if(!route.id.startsWith(prefixes[source])||originals.has(route.id)||byId.has(route.id))continue;
   const licenseMarker='\n轨迹许可：',licenseIndex=route.archive.riskNotice.lastIndexOf(licenseMarker);
   const priorRisk=route.trackMode==='已核验轨迹'&&licenseIndex>=0?route.archive.riskNotice.slice(0,licenseIndex):route.archive.riskNotice;
   const cached:HikingRoute={...route,status:'待核验',openingExpiresAt:0,archive:{...route.archive,checkedAt:`缓存资料；来源刷新失败；原检查记录：${route.archive.checkedAt}`,riskNotice:`${priorRisk}\n路线来源当前不可用，缓存的开放状态与导航轨迹已降为待核验。`}};
   if(route.trackMode!=='认知示意'){cached.path=[];cached.trackMode='不展示轨迹';}
   byId.set(cached.id,cached);unavailableCounts[source]++;
  }
 }
 for(const raw of reviewRows){if(!byId.has(raw.routeId)&&!originals.has(raw.routeId))continue;const original=originals.get(raw.routeId);if(original?.status==='永久关闭')continue;const route=byId.get(raw.routeId)||{...original!};route.status=reviewedRouteStatus(raw.status,raw.expiresAt);route.openingExpiresAt=route.status==='待核验'?0:raw.expiresAt;route.summary=raw.summary;route.archive={...route.archive,source:{label:'官方资料人工核验',url:raw.sourceUrl},checkedAt:raw.checkedAt,riskNotice:raw.riskNotice};const track=raw.track;if(route.status==='开放中'&&raw.expiresAt>Date.now()&&track&&validReviewTrack(track)){route.path=track.path;route.trackMode='已核验轨迹';route.archive.riskNotice+=`\n轨迹许可：${track.license}；来源：${track.sourceUrl}`;}byId.set(route.id,route);}
 const sourceNames:Record<PublicRouteSource,string>={osm:'OSM',usfs:'美国国家森林',hk:'香港官方步道',nzdoc:'新西兰环保部官方步道',parkscanada:'加拿大公园管理局','nsw-npws':'新南威尔士州公园步道',england:'英格兰国家步道',wales:'威尔士国家步道','japan-tokai':'日本·东海自然步道','scotland-argyll':'阿盖尔-比特议会核心步道','ni-midulster':'北爱尔兰米德阿尔斯特公共通行权','norfolk-prow':'诺福克公共通行权','cambridgeshire-prow':'剑桥郡公共通行权','nps-public-trails':'美国国家公园步道','usgs-trails':'美国国家数字步道（USGS）','swisstopo-wanderwege':'瑞士 swisstopo 官方徒步网络','victoria-recreation-tracks':'澳大利亚维多利亚州官方步道','queensland-qpws-trails':'澳大利亚昆士兰州官方步道','taiwan-trails':'台湾观光署官方步道','korea-durunubi-trails':'韩国·DuruNubi 韩国环线步道'};
 const summary=sources.map(source=>{
  const snapshot=snapshots.find(item=>item.source===source)?.snapshot;
  if(!snapshot)return `${sourceNames[source]}：来源暂不可用，沿用${unavailableCounts[source]}条本机档案并降为待核验`;
  const delivery=snapshot.deliverySource==='website-package'?'站点快照':('upstreamAvailable' in snapshot&&snapshot.upstreamAvailable===true)?'云端源':('upstreamAvailable' in snapshot&&snapshot.upstreamAvailable===false)?'云端回退':'云端目录';
  const date=generatedAt(snapshot),sourceTotal=snapshot.metadata?.sourceTotal;
  const total=typeof sourceTotal==='number'&&Number.isInteger(sourceTotal)?sourceTotal:snapshot.total;
  return `${sourceNames[source]}：${delivery} ${snapshot.total}条 / 来源${total}条${Number.isFinite(date)?`，数据时间 ${new Date(date).toLocaleDateString()}`:''}${snapshot.metadata?.complete===false?'，其余可在线检索':''}`;
 });
 coverageSummary=summary.join('；')+`；路线审核：${reviewsAvailable?`已读取${reviewRows.length}条有效期审核记录`:'云端暂不可用，动态开放状态回退为待核验'}`;
 const base=bundled.map(r=>{const reviewed=byId.get(r.id);if(reviewed)return reviewed;const status=reviewedRouteStatus(r.status,r.openingExpiresAt);return status===r.status?r:{...r,status,openingExpiresAt:0};});return [...base,...[...byId.values()].filter(r=>!originals.has(r.id))];
}

function parseOfficialNotice(value:unknown):OfficialNotice|null{
 if(!isRecord(value)||typeof value.id!=='string'||!value.id.trim()||value.id.length>160||typeof value.title!=='string'||!value.title.trim()||value.title.length>300||typeof value.region!=='string'||value.region.length>160||typeof value.sourceLabel!=='string'||value.sourceLabel.length>200||typeof value.sourceId!=='string'||typeof value.sourceUrl!=='string'||!safeHttpsUrl(value.sourceUrl)||typeof value.url!=='string'||!safeHttpsUrl(value.url)||typeof value.fetchedAt!=='string'||!Number.isFinite(Date.parse(value.fetchedAt))||Date.parse(value.fetchedAt)>Date.now()+30000)return null;
 const source=Array.isArray(officialSources.sources)?officialSources.sources.find((candidate:unknown)=>isRecord(candidate)&&candidate.id===value.sourceId):undefined;
 if(!isRecord(source)||source.reuse!=='metadata-links-only'||!hasCurrentOfficialFeedReview(source)||source.url!==value.sourceUrl||source.label!==value.sourceLabel||source.region!==value.region||!Array.isArray(source.articleHosts)||!source.articleHosts.length||!source.articleHosts.every((host:unknown)=>typeof host==='string'&&host.length>0))return null;
 try{const article=new URL(value.url);if(article.protocol!=='https:'||article.username||article.password||article.port||!source.articleHosts.includes(article.hostname))return null;}catch{return null;}
 const center=value.center===undefined?undefined:isCoordinate(value.center)?value.center:undefined;
 if(value.center!==undefined&&!center)return null;
 const publishedAt=value.publishedAt==null?null:value.publishedAt;
 if(publishedAt!==null&&(typeof publishedAt!=='string'||publishedAt.length>100||!Number.isFinite(Date.parse(publishedAt))))return null;
 return {id:value.id,title:value.title,url:value.url,region:value.region,sourceLabel:value.sourceLabel,sourceUrl:value.sourceUrl,publishedAt:publishedAt as string|null,fetchedAt:value.fetchedAt,...(center?{center}:{})};
}
export async function loadOfficialNotices():Promise<{items:OfficialNotice[];generatedAt:string;collectionStatus:{state:'success'|'partial'|'all-attempted-sources-failed';attemptedSourceCount:number;failedSourceCount:number}|null}>{
 const snapshot=await pages('news'),metadata=snapshot.metadata,generatedAtValue=metadata?.generatedAt;
 if(snapshot.key!=='items'||!metadata||typeof generatedAtValue!=='string'||!Number.isFinite(Date.parse(generatedAtValue)))throw new Error('公告快照格式无效');
 const rawStatus=metadata.collectionStatus;
 let collectionStatus:null|{state:'success'|'partial'|'all-attempted-sources-failed';attemptedSourceCount:number;failedSourceCount:number}=null;
 if(rawStatus!==undefined){
  if(!isRecord(rawStatus)||!['success','partial','all-sources-failed'].includes(String(rawStatus.state))
   ||!nonNegativeInteger(rawStatus.attemptedSourceCount)||!nonNegativeInteger(rawStatus.failedSourceCount)
   ||rawStatus.failedSourceCount>rawStatus.attemptedSourceCount||rawStatus.reviewedAt!==generatedAtValue
   ||rawStatus.cachedItemsRevalidated!==true)throw new Error('公告采集状态格式无效');
  const expected=rawStatus.failedSourceCount===0?'success':rawStatus.attemptedSourceCount>0&&rawStatus.failedSourceCount===rawStatus.attemptedSourceCount?'all-attempted-sources-failed':'partial';
  if(rawStatus.state!==expected)throw new Error('公告采集状态与来源结果不一致');
  collectionStatus={state:rawStatus.state as 'success'|'partial'|'all-attempted-sources-failed',attemptedSourceCount:rawStatus.attemptedSourceCount,failedSourceCount:rawStatus.failedSourceCount};
 }
 const itemCounts=new Map<string,number>(),parsed:OfficialNotice[]=[];
 for(const value of snapshot.items){const item=parseOfficialNotice(value);if(!item)continue;parsed.push(item);itemCounts.set(item.id,(itemCounts.get(item.id)||0)+1);}
 const cutoff=Date.now()-90*24*60*60*1000;
 const items=parsed.filter(row=>itemCounts.get(row.id)===1&&typeof row.publishedAt==='string'&&Date.parse(row.publishedAt)<=Date.now()+300000&&Date.parse(row.publishedAt)>=cutoff);
 return {items,generatedAt:generatedAtValue,collectionStatus};
}
function nonNegativeInteger(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
function positiveInteger(value:unknown):value is number{return nonNegativeInteger(value)&&value>0;}
function sumIntegerRecord(value:unknown):number|null{
 if(!isRecord(value)||Object.keys(value).length>64)return null;
 let total=0;
 for(const item of Object.values(value)){if(!nonNegativeInteger(item))return null;total+=item;if(total>500000)return null;}
 return total;
}
function validSwisstopoSearchPage(metadataValue:unknown,rowsValue:unknown):boolean{
 if(!isRecord(metadataValue)||!Array.isArray(rowsValue)||rowsValue.length>20)return false;
 const metadata=metadataValue,rows=rowsValue,reasons=metadata.withheldReasons,reasonTotal=sumIntegerRecord(reasons);
 const sourceFeatureCount=metadata.sourceFeatureCount,namedSourceFeatureCount=metadata.namedSourceFeatureCount;
 const catalogSourceFeatureCount=metadata.catalogSourceFeatureCount,catalogRouteCount=metadata.catalogRouteCount;
 const aggregatedSourceFeatureCount=metadata.aggregatedSourceFeatureCount,withheldRecords=metadata.withheldRecords;
 if(metadata.schemaVersion!==1
  ||metadata.license!=='swisstopo Open Government Data (OGD): free reuse, redistribution, adaptation and commercial use with source attribution; fair-use limits apply to services.'
  ||metadata.attribution!=='Federal Office of Topography swisstopo (SwissTLM3D hiking trails).'
  ||metadata.licenseUrl!=='https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste'
  ||metadata.sourceUrl!=='https://data.geo.admin.ch/ch.swisstopo.swisstlm3d-wanderwege/swisstlm3d-wanderwege/swisstlm3d-wanderwege_2056_5728.gpkg.zip'
  ||metadata.datasetUrl!=='https://opendata.swiss/en/dataset/swisstlm3d-wanderwege'
  ||typeof metadata.generatedAt!=='string'||!Number.isFinite(Date.parse(metadata.generatedAt))
  ||!positiveInteger(sourceFeatureCount)||sourceFeatureCount>500000
  ||!nonNegativeInteger(namedSourceFeatureCount)||namedSourceFeatureCount>20000
  ||!nonNegativeInteger(catalogSourceFeatureCount)
  ||!nonNegativeInteger(catalogRouteCount)||catalogRouteCount<rows.length
  ||!nonNegativeInteger(aggregatedSourceFeatureCount)
  ||catalogSourceFeatureCount!==catalogRouteCount+aggregatedSourceFeatureCount
  ||!nonNegativeInteger(withheldRecords)||sourceFeatureCount!==catalogSourceFeatureCount+withheldRecords
  ||typeof metadata.sourceModifiedAt!=='string'||!metadata.sourceModifiedAt.trim()
  ||typeof metadata.sourceETag!=='string'||!metadata.sourceETag.trim()
  ||reasonTotal===null||reasonTotal!==withheldRecords
  ||!isRecord(reasons)||!nonNegativeInteger(reasons['unnamed-walking-network-segment'])
  ||reasons['unnamed-walking-network-segment']!==sourceFeatureCount-namedSourceFeatureCount
  ||namedSourceFeatureCount!==catalogSourceFeatureCount+withheldRecords-reasons['unnamed-walking-network-segment']
  ||typeof metadata.routeStatusPolicy!=='string'||metadata.routeStatusPolicy.length>1200)return false;
 return rows.every((rowValue)=>{
  if(!isRecord(rowValue))return false;
  const row=rowValue,tags=row.sourceTags,paths=row.referencePaths;
  if(typeof row.id!=='string'||!/^swiss-trail-[a-f0-9]{24}$/.test(row.id)
   ||typeof row.name!=='string'||!row.name.trim()||row.name.length>500
   ||row.region!=='瑞士·瑞士TLM3D徒步网络'||!isCoordinate(row.center)
   ||row.sourceUrl!==metadata.sourceUrl||typeof row.fetchedAt!=='string'||!Number.isFinite(Date.parse(row.fetchedAt))
   ||row.status!=='待核验'||!isRecord(tags)||!Array.isArray(tags.trailTypes)
   ||tags.trailTypes.length<1||tags.trailTypes.length>3
   ||!tags.trailTypes.every((value)=>['Wanderweg','Bergwanderweg','Alpinwanderweg'].includes(String(value)))
   ||!positiveInteger(tags.sourceSegmentCount)||!Array.isArray(tags.sourceSegmentIds)
   ||tags.sourceSegmentIds.length!==tags.sourceSegmentCount||!tags.sourceSegmentIds.every(positiveInteger)
   ||!validReferencePaths(paths)||paths.length===0)return false;
  return true;
 });
}

function validUsgsSearchPage(metadataValue:unknown,rowsValue:unknown):boolean{
 const tagNames=['sourceOriginator','sourceObjectId','sourcePermanentIdentifier','trailType','hikerPedestrian','nationalTrailDesignation','lengthMiles','seasonOpen','sourcePublishedAt','sourceEditedAt','routeType'];
 if(!isRecord(metadataValue)||!Array.isArray(rowsValue)||rowsValue.length>20)return false;
 const metadata=metadataValue,rows=rowsValue,reasons=metadata.withheldReasons,reasonTotal=sumIntegerRecord(reasons);
 const sourceFeatureCount=metadata.sourceFeatureCount,catalogRouteCount=metadata.catalogRouteCount,withheldRecords=metadata.withheldRecords;
 if(metadata.schemaVersion!==1||metadata.license!=='USGS public-domain aggregate; source originator retained'
  ||metadata.attribution!=='U.S. Geological Survey National Digital Trails. USGS public-domain aggregate; the original source originator is retained for each record.'
  ||metadata.licenseUrl!=='https://www.usgs.gov/national-digital-trails/how-access-or-view-usgs-trails-dataset'
  ||metadata.sourceUrl!=='https://partnerships.nationalmap.gov/arcgis/rest/services/USGSTrails/MapServer/0'
  ||typeof metadata.routeStatusPolicy!=='string'||metadata.routeStatusPolicy.length>1200
  ||!positiveInteger(sourceFeatureCount)||sourceFeatureCount>150000
  ||!nonNegativeInteger(catalogRouteCount)||catalogRouteCount<rows.length
  ||!nonNegativeInteger(withheldRecords)||sourceFeatureCount!==catalogRouteCount+withheldRecords
  ||reasonTotal===null||reasonTotal!==withheldRecords)return false;
 return rows.every((rowValue)=>{
  if(!isRecord(rowValue))return false;
  const row=rowValue,sourceTags=row.sourceTags,paths=row.referencePaths;
  if(typeof row.id!=='string'||!/^usgs-trail-[1-9]\d*$/.test(row.id)
   ||typeof row.name!=='string'||!row.name.trim()||row.name.length>500
   ||typeof row.region!=='string'||!row.region.startsWith('美国·')||!isCoordinate(row.center)
   ||row.sourceUrl!==metadata.sourceUrl||typeof row.fetchedAt!=='string'||!Number.isFinite(Date.parse(row.fetchedAt))
   ||row.status!=='待核验'||!isRecord(sourceTags)||Object.keys(sourceTags).length!==tagNames.length
   ||!Object.keys(sourceTags).every((tag)=>tagNames.includes(tag))
   ||typeof sourceTags.sourceObjectId!=='string'||!/^\d+$/.test(sourceTags.sourceObjectId)
   ||row.id!==`usgs-trail-${sourceTags.sourceObjectId}`||sourceTags.trailType!=='Terra Trail'
   ||sourceTags.hikerPedestrian!=='Y'
   ||!Object.values(sourceTags).every((value)=>value===null||typeof value==='string'&&value.length<=300)
   ||!validReferencePaths(paths)||paths.length===0||paths.length>50)return false;
  return true;
 });
}

function validNpsSearchPage(metadataValue:unknown,rowsValue:unknown):boolean{
 const tagNames=['featureId','sourceStatus','surface','trailType','trailClass','trailUse','sourceEditedAt','sourceDate'];
 if(!isRecord(metadataValue)||!Array.isArray(rowsValue)||rowsValue.length>20)return false;
 const metadata=metadataValue,rows=rowsValue,reasons=metadata.withheldReasons,reasonTotal=sumIntegerRecord(reasons);
 const sourceFeatureCount=metadata.sourceFeatureCount,catalogRouteCount=metadata.catalogRouteCount,withheldRecords=metadata.withheldRecords;
 if(metadata.schemaVersion!==1
  ||metadata.license!=='U.S. federal public-distribution dataset; no named layer-specific license'
  ||metadata.attribution!=='U.S. National Park Service, Public Trails dataset. NPS public-distribution data; no named layer-specific license. See source and NPS data disclaimer.'
  ||metadata.licenseUrl!=='https://www.nps.gov/subjects/gisandmapping/data-disclaimers.htm'
  ||metadata.sourceUrl!=='https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0'
  ||typeof metadata.routeStatusPolicy!=='string'||metadata.routeStatusPolicy.length>1200
  ||!nonNegativeInteger(sourceFeatureCount)||sourceFeatureCount>50000
  ||!nonNegativeInteger(catalogRouteCount)||catalogRouteCount<rows.length
  ||!nonNegativeInteger(withheldRecords)||sourceFeatureCount!==catalogRouteCount+withheldRecords
  ||reasonTotal===null||reasonTotal!==withheldRecords)return false;
 return rows.every((rowValue)=>{
  if(!isRecord(rowValue))return false;
  const row=rowValue,sourceTags=row.sourceTags,paths=row.referencePaths;
  if(typeof row.id!=='string'||!/^nps-trail-[1-9]\d*$/.test(row.id)
   ||typeof row.name!=='string'||!row.name.trim()||row.name.length>500
   ||typeof row.region!=='string'||!row.region.startsWith('美国·')||!isCoordinate(row.center)
   ||row.sourceUrl!==metadata.sourceUrl||typeof row.fetchedAt!=='string'||!Number.isFinite(Date.parse(row.fetchedAt))
   ||row.status!==undefined&&row.status!=='待核验'||!isRecord(sourceTags)
   ||Object.keys(sourceTags).length!==tagNames.length||!Object.keys(sourceTags).every((tag)=>tagNames.includes(tag))
   ||!Object.values(sourceTags).every((value)=>value===null||typeof value==='string'&&value.length<=300)
   ||typeof sourceTags.trailUse!=='string'||!/(hiker|pedestrian)/i.test(sourceTags.trailUse)
   ||!validReferencePaths(paths)||paths.length===0||paths.length>150)return false;
  return true;
 });
}

export async function searchPublicRoutes(source:PublicRouteSource,query:string,offset=0,snapshot?:string):Promise<{routes:HikingRoute[];total:number;offset:number;snapshot:string;hasMore:boolean}>{
 if(query.trim().length<2||query.length>100||!Number.isInteger(offset)||offset<0||offset>CATALOG_SOURCE_LIMIT)throw new Error('搜索词或分页位置无效');
 let remote:CatalogPage|undefined;
 try{
  const data=await publicCatalogRequest('catalog-feed',{action:'search',source,query,offset,...(snapshot?{snapshot}:{})},55000);
  if(!isCatalogPage(data)||!/^([a-f0-9]{64})$/.test(data.snapshot)||snapshot&&snapshot!==data.snapshot||!Number.isInteger(data.total)||data.total<0||data.total>CATALOG_SOURCE_LIMIT||data.offset!==offset||data.key!=='routes'||data.items.length>20||data.hasMore!==(offset+data.items.length<data.total))throw new Error('online catalog page invalid');
  remote=data;
 }catch{/* A source failure is handled by a validated static snapshot or the explicit unavailable error below. */}
 let manifest:StaticManifest|undefined;try{if(source!=='nps-public-trails'&&source!=='usgs-trails'&&source!=='japan-tokai')manifest=await staticManifest(source);}catch{/* The request path continues with the direct search snapshot when present. */}
 if(source==='usgs-trails'){
  let bundledPage:Awaited<ReturnType<typeof searchStatic>>|undefined;
  try{bundledPage=await searchStatic(source,query,offset,snapshot);}catch{/* Keep the remote candidate and validate it before returning. */}
  const remoteValid=!!remote&&validUsgsSearchPage(remote.metadata,remote.items);
  const bundledValid=!!bundledPage&&validUsgsSearchPage(bundledPage.metadata,bundledPage.items);
  if(!remoteValid&&!bundledValid)throw new Error('USGS公共步道目录校验未通过，请稍后重试');
  const remoteTime=generatedAt(remote),staticTime=generatedAt(bundledPage);
  const useBundled=bundledValid&&(!remoteValid||staticTime>=remoteTime);
  const result=useBundled?bundledPage!:remote!;
  const routes=discover(result.items,source,typeof result.metadata?.attribution==='string'?result.metadata.attribution:'来源档案');
  if(routes.length!==result.items.length)throw new Error('USGS来源资料校验未通过');
  return {routes,total:result.total,offset,snapshot:result.snapshot,hasMore:result.hasMore};
 }
 if(source==='swisstopo-wanderwege'){
  let bundledPage:Awaited<ReturnType<typeof searchStatic>>|undefined;
  try{bundledPage=await searchStatic(source,query,offset,snapshot);}catch{/* Keep the remote candidate and validate it before returning. */}
  const remoteValid=!!remote&&validSwisstopoSearchPage(remote.metadata,remote.items);
  const bundledValid=!!bundledPage&&validSwisstopoSearchPage(bundledPage.metadata,bundledPage.items);
  if(!remoteValid&&!bundledValid)throw new Error('swisstopo瑞士步道目录校验未通过，请稍后重试');
  const remoteTime=generatedAt(remote),staticTime=generatedAt(bundledPage),useBundled=bundledValid&&(!remoteValid||staticTime>=remoteTime),result=useBundled?bundledPage!:remote!;
  const routes=discover(result.items,source,typeof result.metadata?.attribution==='string'?result.metadata.attribution:'swisstopo');
  if(routes.length!==result.items.length)throw new Error('swisstopo路线发现资料校验未通过');
  return {routes,total:result.total,offset,snapshot:result.snapshot,hasMore:result.hasMore};
 }
 if(source==='nps-public-trails'){
  let bundledPage:Awaited<ReturnType<typeof searchStatic>>|undefined;
  try{bundledPage=await searchStatic(source,query,offset,snapshot);}catch{/* Keep the remote candidate and validate it before returning. */}
  const remoteValid=!!remote&&validNpsSearchPage(remote.metadata,remote.items);
  const bundledValid=!!bundledPage&&validNpsSearchPage(bundledPage.metadata,bundledPage.items);
  if(!remoteValid&&!bundledValid)throw new Error('NPS公共目录校验未通过，请稍后重试');
  const remoteTime=generatedAt(remote),staticTime=generatedAt(bundledPage);
  const useBundled=bundledValid&&(!remoteValid||staticTime>=remoteTime);
  const result=useBundled?bundledPage!:remote!;
  const routes=discover(result.items,source,typeof result.metadata?.attribution==='string'?result.metadata.attribution:'来源档案');
  if(routes.length!==result.items.length)throw new Error('来源资料校验未通过');
  return {routes,total:result.total,offset,snapshot:result.snapshot,hasMore:result.hasMore};
 }
 if(source==='japan-tokai'){
  if(!remote)throw new Error('日本东海自然步道在线目录暂不可用，请稍后重试');
  const routes=discover(remote.items,source,typeof remote.metadata?.attribution==='string'?remote.metadata.attribution:'来源档案');
  if(routes.length!==remote.items.length)throw new Error('在线资料校验未通过');
  return {routes,total:remote.total,offset,snapshot:remote.snapshot,hasMore:remote.hasMore};
 }
 const remoteTime=generatedAt(remote),staticTime=generatedAt(manifest);
 const remoteSourceTotal=remote?.metadata?.sourceTotal;
 const remoteIsCurrent=!!remote&&(remoteTime>staticTime||remoteTime===staticTime&&!!manifest&&typeof remoteSourceTotal==='number'&&Number.isInteger(remoteSourceTotal)&&remoteSourceTotal>=manifest.total);
 if(remoteIsCurrent||remote&&!manifest){const routes=discover(remote!.items,source,typeof remote!.metadata?.attribution==='string'?remote!.metadata.attribution:'来源档案');if(routes.length!==remote!.items.length)throw new Error('在线资料校验未通过');return {routes,total:remote!.total,offset,snapshot:remote!.snapshot,hasMore:remote!.hasMore};}
 try{const data=await searchStatic(source,query,offset,snapshot);const routes=discover(data.items,source,typeof data.metadata?.attribution==='string'?data.metadata.attribution:'来源档案');if(routes.length!==data.items.length)throw new Error('bundled catalog page invalid');return {routes,total:data.total,offset,snapshot:data.snapshot,hasMore:data.hasMore};}
 catch{if(remote){const routes=discover(remote.items,source,typeof remote.metadata?.attribution==='string'?remote.metadata.attribution:'来源档案');return {routes,total:remote.total,offset,snapshot:remote.snapshot,hasMore:remote.hasMore};}throw new Error('在线检索暂不可用，请稍后重试');}
}
