import {needsGatewayRelay,gatewayRelayRequest} from './gateway-relay';
import {ROUTES as bundled,type HikingRoute} from './routes';
import {loadStaticPages,searchStatic,staticManifest,type StaticManifest} from './static-catalog';
import {discoveryTagHighlights} from '../../shared/data/discovery-tags';
export type OfficialNotice={id:string;title:string;url:string;region:string;sourceLabel:string;sourceUrl:string;publishedAt:string|null;fetchedAt:string;center:[number,number]};
const sources=['osm','usfs','hk'] as const;
const PAGE_SIZE=400;
function jsonObject(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid JSON object');return value as Record<string,any>;}
async function publicCatalogRequest(action:'catalog-feed'|'route-manage',data:Record<string,unknown>,timeout=15000):Promise<Record<string,any>>{
 if(needsGatewayRelay()){const result=await gatewayRelayRequest(action,data,undefined,timeout);if(result.status!==200||result.body?.ok!==true)throw new Error('public catalog unavailable');return jsonObject(result.body.data);}
 const response=await fetch('https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(timeout),
 });
 const envelope=await response.json() as {ok?:boolean;data?:unknown};
 if(!response.ok||envelope?.ok!==true)throw new Error('public catalog unavailable');
 return jsonObject(envelope.data);
}
let coverageSummary='';
export function publicCatalogCoverageSummary(){return coverageSummary;}
let coverageHasSourceFailures=false;
export function publicCatalogHasSourceFailures(){return coverageHasSourceFailures;}
const key=(r:HikingRoute)=>`${r.name.normalize('NFKC').toLowerCase().replace(/[\s·—_-]/g,'')}:${r.center.map(v=>v.toFixed(1)).join(',')}`;
const regions:Record<string,string>={china:'中国检索区域','hong-kong':'香港',macao:'澳门',europe:'欧洲','north-america':'北美',japan:'日本及周边检索区域',oceania:'大洋洲','south-america':'南美',africa:'非洲','south-asia':'南亚'};
function discover(raw:any,source:string,attribution:string):HikingRoute[]{
 if(!Array.isArray(raw)||raw.length>100000)throw new Error('catalog size invalid');
 return raw.filter((r:any)=>r&&typeof r.id==='string'&&typeof r.name==='string'&&Array.isArray(r.center)&&r.center.length===2&&r.center.every(Number.isFinite)&&Math.abs(r.center[0])<=180&&Math.abs(r.center[1])<=90).map((r:any)=>{
  const restrictionValue=source==='usfs'&&typeof r.sourceTags?.hikingRestricted==='string'?r.sourceTags.hikingRestricted.trim():'';
  const restrictionNotice=restrictionValue?` USDA Forest Service源字段“徒步限制”原值（去除首尾空格）：${restrictionValue}；含义和适用日期需查属地官方资料。`:'';
  return {id:r.id,name:r.name,region:regions[r.region]||r.region||'未注明区域',status:'待核验',center:r.center,path:source==='hk'&&r.referencePaths?.length===1?r.referencePaths[0]:[],distance:Number.isFinite(r.sourceTags?.distanceKm)?`${r.sourceTags.distanceKm.toFixed(1)} km`:r.sourceTags?.distance?`${r.sourceTags.distance}（来源原值，单位待核验）`:'待核验',ascent:'待核验',duration:'待核验',difficulty:'待核验',bestSeason:'待核验',bestSeasons:[],packStyle:'待核验',overnight:'待核验',surface:'待核验',trackMode:source==='hk'&&r.referencePaths?.length===1?'认知示意':'不展示轨迹',scenery:[],summary:'自动采集的徒步路线发现档案；装备、住宿、路况与开放许可尚未核验。',image:'/static/original-mountain-reference.png',imageCredit:'徒步地球原创几何示意 · 非路线实景',archive:{source:{label:attribution,url:r.sourceUrl},checkedAt:`采集 ${r.fetchedAt}；开放状态未核验`,highlights:discoveryTagHighlights(r.sourceTags,attribution),riskNotice:`地图收录不代表允许通行；来源标签为贡献者原始标注，不代表官方开放、安全或路线许可；装备、住宿和路况尚未核验；本档案不提供导航。${restrictionNotice}`}};
 });
}
async function apiFirstPage(source:string):Promise<Record<string,any> & {items:any[]}>{
 const first=await publicCatalogRequest('catalog-feed',{source,page:0,windowLimit:100000});
 if(!Array.isArray(first.items)||first.items.length>PAGE_SIZE||first.page!==0||!Number.isInteger(first.total)||first.total<0||!/^([a-f0-9]{64})$/.test(first.snapshot)||typeof first.key!=='string')throw new Error('catalog page invalid');
 if(first.total>100000)throw new Error('catalog exceeds safe read limit');
 const pageCount=Math.ceil(first.total/PAGE_SIZE);
 if(first.hasMore!==(pageCount>1))throw new Error('catalog page state invalid');
 return {...first,items:first.items};
}
async function apiPages(source:string,first:Record<string,any> & {items:any[]}):Promise<Record<string,any> & {items:any[]}>{
 const pageCount=Math.ceil(first.total/PAGE_SIZE),items=[...first.items];
 for(let start=1;start<pageCount;start+=8){
  const pageNumbers=Array.from({length:Math.min(8,pageCount-start)},(_,i)=>start+i);
  const later=await Promise.all(pageNumbers.map(page=>publicCatalogRequest('catalog-feed',{source,page,snapshot:first.snapshot,windowLimit:100000})));
  for(let i=0;i<later.length;i++){const page=pageNumbers[i],result=later[i];if(result.snapshot!==first.snapshot||result.total!==first.total||result.key!==first.key||!Array.isArray(result.items)||result.items.length>PAGE_SIZE||result.page!==page||result.hasMore!==(page<pageCount-1))throw new Error('catalog changed during read');items.push(...result.items);}
 }
 if(items.length!==first.total)throw new Error('catalog incomplete');return {...first,items};
}
function generatedAt(value:any){const time=Date.parse(value?.metadata?.generatedAt||'');return Number.isFinite(time)?time:-Infinity;}
async function pages(source:'osm'|'usfs'|'hk'|'news'){
 const [apiResult,staticResult]=await Promise.allSettled([apiFirstPage(source),staticManifest(source)]);
 if(apiResult.status==='rejected'&&staticResult.status==='rejected')throw apiResult.reason;
 if(apiResult.status==='rejected'&&staticResult.status==='fulfilled')return loadStaticPages(source,staticResult.value);
 if(apiResult.status==='rejected')throw apiResult.reason;
 if(staticResult.status==='rejected')return apiPages(source,apiResult.value);
 const remoteTime=generatedAt(apiResult.value),staticTime=generatedAt(staticResult.value);
 const remoteCount=Number.isInteger(apiResult.value.metadata?.sourceTotal)?apiResult.value.metadata.sourceTotal:apiResult.value.total;
 const preferStatic=staticTime>remoteTime||staticTime===remoteTime&&staticResult.value.total>=remoteCount;
 if(preferStatic){try{return await loadStaticPages(source,staticResult.value);}catch{return apiPages(source,apiResult.value);}}
 try{return await apiPages(source,apiResult.value);}catch{return loadStaticPages(source,staticResult.value);}
}
async function allReviews(){
 const first=await publicCatalogRequest('route-manage',{action:'list',page:0});
 if(!Array.isArray(first.items)||first.items.length>10||typeof first.hasMore!=='boolean')throw new Error('review snapshot invalid');
 const rows:any[]=[...first.items];let done=!first.hasMore;
 for(let start=1;!done&&start<100;start+=8){
  const pageNumbers=Array.from({length:Math.min(8,100-start)},(_,i)=>start+i);
  const later=await Promise.all(pageNumbers.map(page=>publicCatalogRequest('route-manage',{action:'list',page})));
  for(let i=0;i<later.length;i++){const response=later[i];if(!Array.isArray(response.items)||response.items.length>10||typeof response.hasMore!=='boolean')throw new Error('review snapshot invalid');rows.push(...response.items);if(!response.hasMore){done=true;break;}}
 }
 if(!done)throw new Error('review page limit');
 const ids=new Set<string>();for(const row of rows){if(!validReview(row)||ids.has(row.routeId))throw new Error('review snapshot invalid');ids.add(row.routeId);}
 return rows;
}
function validReviewTrack(track:any):boolean{
 if(track===null)return true;
 if(!track||typeof track!=='object'||typeof track.sourceUrl!=='string'||typeof track.license!=='string'||!track.license.trim()||track.license.length>1000||!Array.isArray(track.path)||track.path.length<2||track.path.length>3000)return false;
 try{const url=new URL(track.sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.port)return false;}catch{return false;}
 return track.path.every((point:any)=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=180&&Math.abs(point[1])<=90);
}
function validReview(row:any):boolean{
 if(!row||typeof row.routeId!=='string'||!row.routeId.trim()||row.routeId.length>128||!['开放中','即将开放','临时关闭','永久关闭','待核验'].includes(row.status)||typeof row.sourceUrl!=='string'||typeof row.summary!=='string'||row.summary.length>3000||typeof row.riskNotice!=='string'||row.riskNotice.length>3000||!Number.isFinite(Date.parse(row.checkedAt))||Date.parse(row.checkedAt)>Date.now()||!Number.isFinite(row.expiresAt)||row.expiresAt<Date.parse(row.checkedAt)||row.expiresAt>Date.parse(row.checkedAt)+7*86400000||!Number.isInteger(row.version)||row.version<1||row.track!==undefined&&!validReviewTrack(row.track))return false;
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
 let reviewRows:any[]=[];let reviewsAvailable=true;
 try{reviewRows=await allReviews();}catch{reviewsAvailable=false;}
 const defaultAttribution:Record<typeof sources[number],string>={osm:'© OpenStreetMap contributors · ODbL-1.0',usfs:'USDA Forest Service',hk:'DATA.GOV.HK-terms-1.2'};
 const updated=snapshots.flatMap(({source,snapshot})=>discover(snapshot.items,source,snapshot.metadata?.attribution||defaultAttribution[source]));
 const originals=new Map(bundled.map(r=>[r.id,r]));const byId=new Map<string,HikingRoute>();for(const route of updated)if(!byId.has(route.id))byId.set(route.id,route);
 const prefixes:Record<typeof sources[number],string>={osm:'osm-relation-',usfs:'usfs-',hk:'hk-afcd-'};
 const unavailableCounts:Record<typeof sources[number],number>={osm:0,usfs:0,hk:0};
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
 for(const raw of reviewRows){if(!byId.has(raw.routeId)&&!originals.has(raw.routeId))continue;const original=originals.get(raw.routeId);if(original?.status==='永久关闭')continue;const route=byId.get(raw.routeId)||{...original!};route.status=raw.status==='开放中'&&raw.expiresAt<=Date.now()?'待核验':raw.status;route.openingExpiresAt=raw.expiresAt;route.summary=raw.summary;route.archive={...route.archive,source:{label:'官方资料人工核验',url:raw.sourceUrl},checkedAt:raw.checkedAt,riskNotice:raw.riskNotice};const track=raw.track;if(route.status==='开放中'&&raw.expiresAt>Date.now()&&track&&validReviewTrack(track)){route.path=track.path;route.trackMode='已核验轨迹';route.archive.riskNotice+=`\n轨迹许可：${track.license}；来源：${track.sourceUrl}`;}byId.set(route.id,route);}
 const sourceNames:Record<typeof sources[number],string>={osm:'OSM',usfs:'美国国家森林',hk:'香港官方步道'};
 const summary=sources.map(source=>{
  const snapshot=snapshots.find(item=>item.source===source)?.snapshot;
  if(!snapshot)return `${sourceNames[source]}：来源暂不可用，沿用${unavailableCounts[source]}条本机档案并降为待核验`;
  const delivery=snapshot.deliverySource==='website-package'?'站点快照':('upstreamAvailable' in snapshot&&snapshot.upstreamAvailable===true)?'云端源':('upstreamAvailable' in snapshot&&snapshot.upstreamAvailable===false)?'云端回退':'云端目录';
  const date=Date.parse(snapshot.metadata?.generatedAt);
  return `${sourceNames[source]}：${delivery} ${snapshot.total}条 / 来源${snapshot.metadata?.sourceTotal??snapshot.total}条${Number.isFinite(date)?`，数据时间 ${new Date(date).toLocaleDateString()}`:''}${snapshot.metadata?.complete===false?'，其余可在线检索':''}`;
 });
 coverageSummary=summary.join('；')+`；路线审核：${reviewsAvailable?`已读取${reviewRows.length}条有效期审核记录`:'云端暂不可用，动态开放状态回退为待核验'}`;
 const base=bundled.map(r=>{const reviewed=byId.get(r.id);if(reviewed)return reviewed;return r.status==='开放中'?{...r,status:'待核验' as const,openingExpiresAt:0}:r;});return [...base,...[...byId.values()].filter(r=>!originals.has(r.id))];
}

export async function loadOfficialNotices():Promise<{items:OfficialNotice[];generatedAt:string}>{
 const snapshot=await pages('news');
 if(snapshot.key!=='items'||!Number.isFinite(Date.parse(snapshot.metadata?.generatedAt))||!Array.isArray(snapshot.items))throw new Error('公告快照格式无效');
 const items=snapshot.items.filter((row:any)=>{
  if(!row||typeof row.id!=='string'||typeof row.title!=='string'||!row.title.trim()||row.title.length>300||typeof row.region!=='string'||typeof row.sourceLabel!=='string'||typeof row.fetchedAt!=='string'||!Number.isFinite(Date.parse(row.fetchedAt)))return false;
  if(!Array.isArray(row.center)||row.center.length!==2||!row.center.every(Number.isFinite)||Math.abs(row.center[0])>180||Math.abs(row.center[1])>90)return false;
  for(const value of [row.url,row.sourceUrl]){try{const parsed=new URL(value);if(parsed.protocol!=='https:'||parsed.hostname!=='www.nps.gov'||parsed.username||parsed.password)return false;}catch{return false;}}
  return row.publishedAt==null||typeof row.publishedAt==='string'&&Number.isFinite(Date.parse(row.publishedAt));
 }).map((row:any)=>({id:row.id,title:row.title,url:row.url,region:row.region,sourceLabel:row.sourceLabel,sourceUrl:row.sourceUrl,publishedAt:row.publishedAt,fetchedAt:row.fetchedAt,center:row.center as [number,number]}));
 if(items.length!==snapshot.items.length)throw new Error('公告条目校验未通过');
 return {items,generatedAt:snapshot.metadata.generatedAt};
}

export async function searchPublicRoutes(source:'osm'|'usfs'|'hk',query:string,offset=0,snapshot?:string):Promise<{routes:HikingRoute[];total:number;offset:number;snapshot:string;hasMore:boolean}>{
 if(query.trim().length<2||query.length>100||!Number.isInteger(offset)||offset<0||offset>250000)throw new Error('搜索词或分页位置无效');
 let remote:Record<string,any>|undefined;
 try{
  const data=await publicCatalogRequest('catalog-feed',{action:'search',source,query,offset,...(snapshot?{snapshot}:{})},55000);
  if(!/^([a-f0-9]{64})$/.test(data.snapshot)||snapshot&&snapshot!==data.snapshot||!Number.isInteger(data.total)||data.total<0||data.total>250000||data.offset!==offset||data.key!=='routes'||!Array.isArray(data.items)||data.items.length>20||data.hasMore!==(offset+data.items.length<data.total))throw new Error('online catalog page invalid');
  remote=data;
 }catch{}
 let manifest:StaticManifest|undefined;try{manifest=await staticManifest(source);}catch{}
 const remoteTime=generatedAt(remote),staticTime=generatedAt(manifest);
 const remoteIsCurrent=!!remote&&(remoteTime>staticTime||remoteTime===staticTime&&manifest&&Number.isInteger(remote.metadata?.sourceTotal)&&remote.metadata.sourceTotal>=manifest.total);
 if(remoteIsCurrent||remote&&!manifest){const routes=discover(remote!.items,source,remote!.metadata?.attribution||'来源档案');if(routes.length!==remote!.items.length)throw new Error('在线资料校验未通过');return {routes,total:remote!.total,offset,snapshot:remote!.snapshot,hasMore:remote!.hasMore};}
 try{const data=await searchStatic(source,query,offset,snapshot);const routes=discover(data.items,source,data.metadata?.attribution||'来源档案');if(routes.length!==data.items.length)throw new Error('bundled catalog page invalid');return {routes,total:data.total,offset,snapshot:data.snapshot,hasMore:data.hasMore};}
 catch{if(remote){const routes=discover(remote.items,source,remote.metadata?.attribution||'来源档案');return {routes,total:remote.total,offset,snapshot:remote.snapshot,hasMore:remote.hasMore};}throw new Error('在线检索暂不可用，请稍后重试');}
}
